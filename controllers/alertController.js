const { admin, db } = require('../config/firebase');

// ─── UPDATED: Trigger Alert (Alerts specific chosen guardians) ─────────────
exports.triggerAlert = async (req, res) => {
  try {
    const { victimId, victimName, alertType, lat, lng } = req.body;

    const googleMapsLink = `https://www.google.com/maps/search/?api=1&query=$${lat},${lng}`;
    const navigationLink = `https://www.google.com/maps/dir/?api=1&destination=$${lat},${lng}`;

    const alertData = {
      victimId: victimId || 'Unknown ID',
      victimName: victimName || 'Unknown',
      alertType: alertType || 'Manual SOS',
      location: { lat, lng, googleMapsLink, navigationLink },
      status: 'Active',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    const alertRef = await db.collection('alerts').add(alertData);

    // ── 1. Find the victim's explicitly chosen guardians ──
    let targetGuardianIds = [];
    if (victimId) {
      const victimDoc = await db.collection('users').doc(victimId).get();
      if (victimDoc.exists && victimDoc.data().assignedGuardians) {
        targetGuardianIds = victimDoc.data().assignedGuardians;
      }
    }

    // ── 2. Fetch FCM Tokens for those specific guardians ──
    const allTokens = [];
    if (targetGuardianIds.length > 0) {
      // Fetch only selected guardians
      for (const gId of targetGuardianIds) {
        const gDoc = await db.collection('users').doc(gId).get();
        if (gDoc.exists && gDoc.data().fcmToken) {
          allTokens.push(gDoc.data().fcmToken);
        }
      }
    } else {
      // FALLBACK: If they haven't chosen anyone, alert ALL wardens
      const wardensSnap = await db.collection('users').where('role', 'in', ['warden', 'parent']).get();
      wardensSnap.forEach(doc => {
        if (doc.data().fcmToken) allTokens.push(doc.data().fcmToken);
      });
    }

    if (allTokens.length > 0) {
      const message = {
        notification: {
          title: '🚨 EMERGENCY ALERT!',
          body: `${alertType} — ${victimName}! Tap to navigate.`,
        },
        android: { priority: 'high' },
        data: {
          alertId: alertRef.id,
          mapsLink: navigationLink,
          lat: String(lat),
          lng: String(lng),
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        tokens: allTokens,
      };
      await admin.messaging().sendEachForMulticast(message);
    }

    res.status(201).json({ success: true, alertId: alertRef.id, notified: allTokens.length });
  } catch (err) {
    console.error('triggerAlert error:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// ─── Dead Man's Switch — Victim Heartbeat ──────────────────────────────────
exports.heartbeat = async (req, res) => {
  try {
    const { victimId, intervalMinutes = 5 } = req.body;
    const expiresAt = new Date(Date.now() + intervalMinutes * 60 * 1000);

    await db.collection('heartbeats').doc(victimId).set({
      victimId,
      expiresAt: expiresAt.toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, expiresAt });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

// ─── Check Expired Heartbeats ──────────────────────────────────────────────
exports.checkHeartbeats = async (req, res) => {
  try {
    const now = new Date().toISOString();
    const snap = await db.collection('heartbeats')
      .where('expiresAt', '<', now)
      .get();

    for (const doc of snap.docs) {
      const { victimId } = doc.data();
      
      const userSnap = await db.collection('users').doc(victimId).get();
      if (!userSnap.exists) continue;
      const victim = userSnap.data();

      // Auto-trigger SOS
      await exports.triggerAlert({
        body: {
          victimId: victimId,
          victimName: victim.name,
          alertType: 'Dead Man\'s Switch — No Check-In',
          lat: victim.lastLat || 0,
          lng: victim.lastLng || 0,
        }
      }, { status: () => ({ json: () => {} }) });

      await doc.ref.delete();
    }

    res.json({ success: true, checked: snap.size });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

// ─── Safe Walk — Start / End ───────────────────────────────────────────────
exports.startSafeWalk = async (req, res) => {
  try {
    const { victimId, victimName, durationMinutes, startLat, startLng } = req.body;
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

    const walkRef = await db.collection('safe_walks').add({
      victimId,
      victimName,
      status: 'Active',
      durationMinutes,
      expiresAt: expiresAt.toISOString(),
      startLocation: { lat: startLat, lng: startLng },
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, walkId: walkRef.id, expiresAt });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

exports.endSafeWalk = async (req, res) => {
  try {
    const { walkId, arrived } = req.body;

    await db.collection('safe_walks').doc(walkId).update({
      status: arrived ? 'Completed' : 'Abandoned',
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

// ─── Acknowledge Alert (Warden) ───────────────────────────────────────────
exports.acknowledgeAlert = async (req, res) => {
  try {
    const { alertId, wardenId, wardenName } = req.body;

    await db.collection('alerts').doc(alertId).update({
      status: 'Acknowledged',
      acknowledgedBy: { id: wardenId, name: wardenName },
      acknowledgedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

// ─── Resolve Alert ────────────────────────────────────────────────────────
exports.resolveAlert = async (req, res) => {
  try {
    const { alertId, resolvedBy } = req.body;

    await db.collection('alerts').doc(alertId).update({
      status: 'Resolved',
      resolvedBy,
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

// ─── Get Active Alerts ────────────────────────────────────────────────────
exports.getActiveAlerts = async (req, res) => {
  try {
    const snap = await db.collection('alerts')
      .where('status', 'in', ['Active', 'Acknowledged'])
      .orderBy('timestamp', 'desc')
      .get();

    const alerts = [];
    snap.forEach(doc => alerts.push({ id: doc.id, ...doc.data() }));

    res.json({ success: true, data: alerts });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

// ─── Register FCM Token + Location ────────────────────────────────────────
exports.registerUser = async (req, res) => {
  try {
    const { userId, name, role, fcmToken, lat, lng } = req.body;

    await db.collection('users').doc(userId).set({
      name,
      role,
      fcmToken,
      lastLat: lat,
      lastLng: lng,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};

// ─── NEW: Get All Guardians (For the frontend list) ────────────────────────
exports.getAllGuardians = async (req, res) => {
  try {
    const snap = await db.collection('users')
      .where('role', 'in', ['warden', 'parent'])
      .get();
    
    const guardians = [];
    snap.forEach(doc => {
      guardians.push({ id: doc.id, ...doc.data() });
    });

    res.json({ success: true, data: guardians });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

// ─── NEW: Assign Guardians to a Victim ─────────────────────────────────────
exports.assignGuardians = async (req, res) => {
  try {
    const { victimId, guardianIds } = req.body; 
    
    await db.collection('users').doc(victimId).update({
      assignedGuardians: guardianIds,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, message: "Guardians updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};
const { admin, db } = require('../config/firebase');

// ─── Trigger Alert (from ESP32 / App button) ────────────────────────────────
exports.triggerAlert = async (req, res) => {
  try {
    const { victimName, alertType, lat, lng, deviceId, audioEvidenceUrl } = req.body;

    const googleMapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const navigationLink = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

    const alertData = {
      victimName: victimName || 'Unknown',
      alertType: alertType || 'Manual SOS',
      location: { lat, lng, googleMapsLink, navigationLink },
      status: 'Active',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      deviceId: deviceId || null,
      audioEvidenceUrl: audioEvidenceUrl || null,
      acknowledgedBy: null,
      escalatedAt: null,
      witnessAlerted: false,
      witnessCount: 0,
    };

    const alertRef = await db.collection('alerts').add(alertData);

    // ── 1. Notify Wardens + Parents ───────────────────────────────────────
    const wardensSnap = await db.collection('users')
      .where('role', 'in', ['warden', 'parent'])
      .get();

    const allTokens = [];
    wardensSnap.forEach(doc => {
      const u = doc.data();
      if (u.fcmToken) allTokens.push(u.fcmToken);
    });

    if (allTokens.length > 0) {
      const message = {
        notification: {
          title: '🚨 EMERGENCY ALERT!',
          body: `${alertType} — ${victimName}! Tap to navigate.`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'sos_channel',
            defaultVibrateTimings: false,
            vibrateTimingsMillis: [0, 500, 200, 500, 200, 1000],
            sound: 'alarm',
          },
        },
        apns: {
          payload: { aps: { sound: 'alarm.caf', badge: 1 } },
        },
        data: {
          alertId: alertRef.id,
          mapsLink: navigationLink,
          lat: String(lat),
          lng: String(lng),
          victimName,
          alertType,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        tokens: allTokens,
      };
      await admin.messaging().sendEachForMulticast(message);
    }

    // ── 2. Crowd Witness Mode — notify nearby users ───────────────────────
    // Queries users with geo-proximity (simplified: all 'witness'-role users)
    // In production: use GeoFirestore or Firestore geo-queries
    const witnessSnap = await db.collection('users')
      .where('role', '==', 'witness')
      .get();

    const witnessTokens = [];
    witnessSnap.forEach(doc => {
      const u = doc.data();
      if (u.fcmToken) witnessTokens.push(u.fcmToken);
    });

    if (witnessTokens.length > 0) {
      const witnessMsg = {
        notification: {
          title: '👁 Nearby SOS — Be a Witness',
          body: `Someone near you needs help. Tap to see location.`,
        },
        android: { priority: 'high' },
        data: {
          alertId: alertRef.id,
          mapsLink: googleMapsLink,
          type: 'witness_request',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        tokens: witnessTokens,
      };
      await admin.messaging().sendEachForMulticast(witnessMsg);
      await alertRef.update({
        witnessAlerted: true,
        witnessCount: witnessTokens.length,
      });
    }

    // ── 3. Schedule Escalation (60s) — if no warden acks, notify parents ─
    // This uses a Firestore timestamp marker; a Cloud Function / cron checks it
    await alertRef.update({
      escalationDue: new Date(Date.now() + 60_000).toISOString(),
    });

    res.status(201).json({
      success: true,
      alertId: alertRef.id,
      notified: allTokens.length,
      witnesses: witnessTokens.length,
    });

  } catch (err) {
    console.error('triggerAlert error:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};


// ─── Dead Man's Switch — Victim Heartbeat ──────────────────────────────────
// Call this endpoint periodically from the app to reset the DMS
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


// ─── Check Expired Heartbeats (called by cron / Cloud Scheduler) ──────────
exports.checkHeartbeats = async (req, res) => {
  try {
    const now = new Date().toISOString();
    const snap = await db.collection('heartbeats')
      .where('expiresAt', '<', now)
      .get();

    for (const doc of snap.docs) {
      const { victimId } = doc.data();
      
      // Get victim info
      const userSnap = await db.collection('users').doc(victimId).get();
      if (!userSnap.exists) continue;
      const victim = userSnap.data();

      // Auto-trigger SOS
      await exports.triggerAlert({
        body: {
          victimName: victim.name,
          alertType: 'Dead Man\'s Switch — No Check-In',
          lat: victim.lastLat || 0,
          lng: victim.lastLng || 0,
        }
      }, { status: () => ({ json: () => {} }) });

      // Remove heartbeat so it doesn't re-trigger
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

    // Notify guardians that a safe walk started
    const wardensSnap = await db.collection('users')
      .where('role', 'in', ['warden', 'parent'])
      .get();
    const tokens = [];
    wardensSnap.forEach(d => { if (d.data().fcmToken) tokens.push(d.data().fcmToken); });

    if (tokens.length > 0) {
      await admin.messaging().sendEachForMulticast({
        notification: {
          title: '🚶 Safe Walk Started',
          body: `${victimName} started a ${durationMinutes}-min safe walk.`,
        },
        data: { walkId: walkRef.id, type: 'safe_walk_start' },
        tokens,
      });
    }

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

    if (!arrived) {
      // Walk ended without confirmation → trigger SOS
      const walkDoc = await db.collection('safe_walks').doc(walkId).get();
      const walk = walkDoc.data();
      await exports.triggerAlert({
        body: {
          victimName: walk.victimName,
          alertType: 'Safe Walk — Did Not Arrive',
          lat: walk.startLocation.lat,
          lng: walk.startLocation.lng,
        }
      }, { status: () => ({ json: () => {} }) });
    }

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
    res.status(500).json({ success: false });
  }
};
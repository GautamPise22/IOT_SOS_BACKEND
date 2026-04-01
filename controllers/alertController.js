// ─── UPDATED: Trigger Alert (Alerts specific chosen guardians) ─────────────
exports.triggerAlert = async (req, res) => {
    try {
      // Note: We now expect victimId (phone number) from the ESP32 or App
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
      const { victimId, guardianIds } = req.body; // array of guardian IDs
      
      await db.collection('users').doc(victimId).update({
        assignedGuardians: guardianIds,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
  
      res.json({ success: true, message: "Guardians updated successfully" });
    } catch (err) {
      res.status(500).json({ success: false });
    }
  };
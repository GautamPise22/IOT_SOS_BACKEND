const { admin, db } = require('../config/firebase');

exports.triggerAlert = async (req, res) => {
  try {
    const { victimName, alertType, lat, lng } = req.body;

    // 1. Generate the Google Maps Link
    const googleMapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

    // 2. Create the Alert Data Object
    const alertData = {
      victimName: victimName || "Unknown Victim",
      alertType: alertType,
      location: { lat, lng, googleMapsLink },
      status: 'Active',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    // 3. Save to Firebase Firestore (Creates an 'alerts' collection automatically)
    const alertRef = await db.collection('alerts').add(alertData);

    // 4. Send Firebase Push Notification
    // We fetch users from a 'users' collection where role is warden or parent
    const wardensSnapshot = await db.collection('users').where('role', 'in', ['warden', 'parent']).get();
    
    const fcmTokens = [];
    wardensSnapshot.forEach(doc => {
      const user = doc.data();
      if (user.fcmToken) fcmTokens.push(user.fcmToken);
    });

    if (fcmTokens.length > 0) {
      const message = {
        notification: {
          title: '🚨 EMERGENCY ALERT!',
          body: `${alertType} triggered by ${victimName}! Tap for location.`,
        },
        data: { mapsLink: googleMapsLink, alertId: alertRef.id },
        tokens: fcmTokens
      };
      await admin.messaging().sendEachForMulticast(message);
    }

    res.status(201).json({ 
      success: true, 
      message: 'Alert saved in Firestore & Notifications sent!', 
      alertId: alertRef.id 
    });

  } catch (error) {
    console.error("Firebase Error:", error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Function for the Warden Dashboard to see all active alerts
exports.getActiveAlerts = async (req, res) => {
  try {
    const alertsSnapshot = await db.collection('alerts').where('status', '==', 'Active').get();
    const activeAlerts = [];
    
    alertsSnapshot.forEach(doc => {
      activeAlerts.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json({ success: true, data: activeAlerts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
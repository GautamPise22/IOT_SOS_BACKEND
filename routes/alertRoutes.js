const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/alertController');
 
// Alerts
router.post('/trigger', ctrl.triggerAlert);
router.get('/active', ctrl.getActiveAlerts);
router.post('/acknowledge', ctrl.acknowledgeAlert);
router.post('/resolve', ctrl.resolveAlert);
 
// Dead Man's Switch
router.post('/heartbeat', ctrl.heartbeat);
router.get('/check-heartbeats', ctrl.checkHeartbeats); // Called by cron
 
// Safe Walk
router.post('/walk/start', ctrl.startSafeWalk);
router.post('/walk/end', ctrl.endSafeWalk);
 
// User registration
router.post('/users/register', ctrl.registerUser);
 
module.exports = router;
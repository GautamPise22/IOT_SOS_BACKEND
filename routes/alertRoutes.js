const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/alertController');

// Alerts
router.post('/trigger', ctrl.triggerAlert);
router.get('/active', ctrl.getActiveAlerts);
router.post('/acknowledge', ctrl.acknowledgeAlert);
router.post('/resolve', ctrl.resolveAlert);

// Dead Man's Switch & Safe Walk
router.post('/heartbeat', ctrl.heartbeat);
router.get('/check-heartbeats', ctrl.checkHeartbeats); 
router.post('/walk/start', ctrl.startSafeWalk);
router.post('/walk/end', ctrl.endSafeWalk);

// Users & Guardians (NEW)
router.post('/users/register', ctrl.registerUser);
router.get('/guardians', ctrl.getAllGuardians);
router.post('/users/assign-guardians', ctrl.assignGuardians);
router.get('/users/:id', ctrl.getUser);

module.exports = router;
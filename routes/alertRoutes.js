const express = require('express');
const router = express.Router();
const { triggerAlert, getActiveAlerts } = require('../controllers/alertController');

router.post('/trigger', triggerAlert);
router.get('/active', getActiveAlerts);

module.exports = router;
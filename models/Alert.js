const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  victimId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  alertType: { type: String, enum: ['Manual Button', 'Auto-Crash', 'Audio Trigger'], required: true },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    googleMapsLink: { type: String, required: true }
  },
  status: { type: String, enum: ['Active', 'Resolved'], default: 'Active' },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Alert', alertSchema);


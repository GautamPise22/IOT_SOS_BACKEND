const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  role: { type: String, enum: ['victim', 'warden', 'parent'], required: true },
  fcmToken: { type: String }, // The unique ID for their specific phone
  hostelRoom: { type: String } // Optional context
});

module.exports = mongoose.model('User', userSchema);
const express = require('express');
const cors = require('cors');

// Initialize Firebase
require('./config/firebase');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// A simple route to check if your Vercel deployment is live!
app.get('/', (req, res) => {
  res.send('🚀 IoT SOS Backend is live on Vercel!');
});

// Your API Routes
app.use('/api/alerts', require('./routes/alertRoutes'));

// EXPORT the app for Vercel Serverless Functions
module.exports = app;

// Only listen on a port if we are running locally, NOT on Vercel
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running locally on port ${PORT}`);
  });
}
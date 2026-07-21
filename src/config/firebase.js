const admin = require('firebase-admin');
const config = require('./index');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.resolve(config.firebase.serviceAccountPath);

if (config.env === 'production' || !fs.existsSync(serviceAccountPath)) {
  // Cloud Environment or Production (Use Default Credentials)
  try {
      console.log('Attempting to initialize Firebase Admin...');
      admin.initializeApp({
        databaseURL: config.firebase.databaseURL || undefined // Ensure undefined if null/empty
      });
      console.log('Firebase Admin Initialized (Default Credentials)');
  } catch (error) {
      console.error('CRITICAL: Firebase Admin Initialization Failed:', error);
      // Do not throw, allowing server to start without Firebase
  }
} else {
  // Local Development (Use Service Account)
  try {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: config.firebase.databaseURL
      });
      console.log('Firebase Admin Initialized (Service Account)');
  } catch (error) {
      console.error('CRITICAL: Firebase Admin Local Init Failed:', error);
  }
}

// Attach db to admin to prevent destructuring failures
try {
  admin.db = admin.firestore();
} catch (error) {
  console.error('Failed to attach Firestore db to admin:', error);
}

module.exports = admin;

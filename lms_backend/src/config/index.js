const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Check if we are running in production or development
const nodeEnv = process.env.NODE_ENV || 'development';

// Load corresponding environment file
const envFile = nodeEnv === 'production' ? '.env.production' : '.env.development';
const envPath = path.resolve(process.cwd(), envFile);

if (fs.existsSync(envPath)) {
  console.log(`[Backend Config] Loading configurations from: ${envFile}`);
  dotenv.config({ path: envPath });
} else {
  console.log(`[Backend Config] ${envFile} not found. Falling back to standard .env`);
  dotenv.config();
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  firebase: {
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './src/config/serviceAccountKey.json',
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  },
  razorpay: {
    key_id: (() => {
      const val = (process.env.NODE_ENV === 'production')
        ? (process.env.RAZORPAY_LIVE_KEY_ID || process.env.RAZORPAY_KEY_ID)
        : (process.env.RAZORPAY_TEST_KEY_ID || process.env.RAZORPAY_KEY_ID);
      return val ? val.replace(/['"]/g, '').trim() : undefined;
    })(),
    key_secret: (() => {
      const val = (process.env.NODE_ENV === 'production')
        ? (process.env.RAZORPAY_LIVE_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET)
        : (process.env.RAZORPAY_TEST_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET);
      return val ? val.replace(/['"]/g, '').trim() : undefined;
    })(),
  },
  email: {
    service: process.env.EMAIL_SERVICE || 'smtp', 
    host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
    port: process.env.EMAIL_PORT || 587,
    secure: false, // true for 465, false for other ports
    user: process.env.EMAIL_USER || 'eliseo.schumm@ethereal.email', // Fallback for dev
    pass: process.env.EMAIL_PASS || 'S8733221', // Fallback for dev (placeholder)
  },
  fcm: {
    // FCM configs if needed separately, usually handled by firebase-admin
  },
};

module.exports = config;

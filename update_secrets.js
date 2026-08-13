const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const envPath = path.join(__dirname, '.env.production');
if (!fs.existsSync(envPath)) {
  console.error(`.env.production not found at ${envPath}`);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const secrets = {};

// Parse .env.production file
envContent.split(/\r?\n/).forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    let val = match[2].trim();
    // remove surrounding quotes if any
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    secrets[key] = val;
  }
});

const secretsToUpdate = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'EMAIL_USER',
  'EMAIL_PASS',
  'EMAIL_SERVICE',
  'GROQ_API_KEY'
];

console.log('Checking Firebase CLI login status...');
try {
  execSync('npx firebase-tools projects:list', { stdio: 'ignore' });
  console.log('Firebase CLI is authenticated.');
} catch (e) {
  console.log('\n❌ Firebase CLI is not logged in.');
  console.log('Please run the following command in your terminal to log in:');
  console.log('\n  npx firebase-tools login\n');
  console.log('After logging in, run this script again:\n');
  console.log('  node update_secrets.js\n');
  process.exit(1);
}

const backendId = 'aipharmaguru';
const projectId = 'aipharmaguru';

console.log(`Starting secret updates for backend: ${backendId} (project: ${projectId})...\n`);

for (const key of secretsToUpdate) {
  const value = secrets[key];
  if (!value) {
    console.warn(`⚠️ Key ${key} not found in .env.production, skipping.`);
    continue;
  }
  
  console.log(`[${key}] Setting secret value...`);
  try {
    // We use stdin to pass the secret securely
    const cmd = `npx firebase-tools apphosting:secrets:set ${key} --data-file - --project ${projectId} --force`;
    execSync(cmd, { input: value, stdio: ['pipe', 'ignore', 'inherit'] });
    console.log(`[${key}] ✅ Secret successfully set.`);
    
    console.log(`[${key}] Granting access to backend ${backendId}...`);
    const grantCmd = `npx firebase-tools apphosting:secrets:grantaccess ${key} --backend ${backendId} --project ${projectId}`;
    execSync(grantCmd, { stdio: 'inherit' });
    console.log(`[${key}] ✅ Access granted.\n`);
  } catch (error) {
    console.error(`[${key}] ❌ Error:`, error.message);
  }
}

console.log('🎉 Secret update process completed!');

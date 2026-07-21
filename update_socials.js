const admin = require('firebase-admin');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const serviceAccountFn = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountFn) {
    console.error('Error: FIREBASE_SERVICE_ACCOUNT_PATH not found in .env');
    process.exit(1);
}

const serviceAccount = require(path.resolve(__dirname, serviceAccountFn));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const db = admin.firestore();

async function updateSocialLinks() {
    try {
        console.log('Updating social links in Firestore...');
        
        const contactRef = db.collection('site_settings').doc('contact_info');
        
        const socialData = {
            email: 'support@aipharmaguru.com', // Keeping a sensible default
            // phone: '', // Optional, keeping existing or empty
            socials: [
                { platform: 'youtube', url: 'https://youtube.com/@aipharmaguru?si=KuSqKH-jTOBvT5AW' },
                { platform: 'linkedin', url: 'https://www.linkedin.com/company/ai-cure-academy/' },
                { platform: 'twitter', url: 'https://x.com/curesas24797?s=21' },
                { platform: 'instagram', url: 'https://www.instagram.com/sasaipharmaguru?igsh=eG1sYmZlbDNycXZq' },
                { platform: 'facebook', url: 'https://www.facebook.com/share/1Ad1zMiMWP/?mibextid=wwXIfr' }
            ],
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Use set with merge: true to avoid overwriting other fields if they exist
        await contactRef.set(socialData, { merge: true });
        
        console.log('Successfully updated social links!');
    } catch (error) {
        console.error('Error updating social links:', error);
    }
}

updateSocialLinks();

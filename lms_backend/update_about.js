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

const DEFAULT_ABOUT = {
    hero: {
        badge: "About AI Cure Academy",
        title: "Bridging",
        titleAccent: "Pharmacy and Artificial Intelligence",
        image: "https://ik.imagekit.io/sruwwxef5/ChatGPT%20Image%20May%2016,%202026,%2005_44_37%20PM.png"
    },
    missionVision: {
        mission: {
            title: "Our Mission",
            description: "To build India’s most trusted ecosystem for AI-driven pharmaceutical education, creating a generation of professionals who lead global drug discovery innovation.",
            icon: "Target"
        },
        vision: {
            title: "Our Vision",
            description: "To bridge the gap between pharmaceutical education and AI technology by delivering practical, industry aligned training that transforms career trajectories.",
            icon: "Eye"
        }
    },
    story: {
        badge: "The Journey",
        title: "India trains more pharmacy graduates than almost any country in the world.",
        paragraphs: [
            "Yet walk into a pharmaceutical R&D lab today — at Sun Pharma, Dr. Reddy's, or any global CRO operating out of Hyderabad or Pune — and ask the hiring manager what they're struggling to find. The answer is the same everywhere: people who understand both science and technology.",
            "Artificial intelligence is no longer on the horizon of drug discovery. It is the workflow — how targets are identified, molecules screened, toxicity predicted, and clinical trials redesigned. Yet most pharmacy graduates arrive at their first interview having never opened a machine learning model.",
            "We are a Pune-based specialized training institute with a single focus: equipping pharmacy, biotechnology, and life sciences graduates with real, applied AI skills for pharmaceutical research.",
            "That is our story. And it is still being written — one trained professional at a time."
        ],
        image: "https://images.unsplash.com/photo-1576086213369-97a306d36557?auto=format&fit=crop&q=80&w=800&h=900",
        foundedYear: "Founded in Pune",
        quote: "The pharma industry didn't wait for education to catch up. We decided not to wait either."
    },
    values: {
        title: "Our Core Values",
        subtitle: "The principles that guide every course we create and every student we teach.",
        items: [
            { 
                title: "Relevance", 
                description: "Every module reflects actual industry needs and real-world pharmaceutical workflows.", 
                icon: "Target", 
                color: "blue" 
            },
            { 
                title: "Accessibility", 
                description: "World-class training made accessible to every pharmacy and life science student.", 
                icon: "Globe", 
                color: "indigo" 
            },
            { 
                title: "Integrity", 
                description: "We deliver honest, rigorous education with measurable outcomes.", 
                icon: "Shield", 
                color: "green" 
            },
            { 
                title: "Innovation", 
                description: "Our curriculum continuously evolves with advancements in AI and pharmaceutical research.", 
                icon: "Zap", 
                color: "purple" 
            }
        ]
    },
    team: {
        title: "Meet Our Experts",
        subtitle: "The practitioners and researchers behind AiCure Academy's curriculum.",
        members: [
            { name: "Santosh R Y", role: "Founder & CEO at AiCure Academy PVT LTD", bio: "Founder and Chief Executive Officer guiding the strategic direction and growth of AiCure Academy.", image: "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=400" },
            { name: "Prasad Y L", role: "Principal Trainer — 25+ years in Pharma & Life Sciences", bio: "Leading training initiatives with over 25 years of extensive industry experience in pharmaceuticals and life sciences.", image: "https://images.pexels.com/photos/1516680/pexels-photo-1516680.jpeg?auto=compress&cs=tinysrgb&w=400" },
            { name: "Dr. Ayushi Gade", role: "Head · Business Development — PhD in Pharmaceutical Chemistry", bio: "Driving business strategy and academic partnerships, bringing deep scientific expertise with a PhD in Pharmaceutical Chemistry.", image: "https://images.pexels.com/photos/1181690/pexels-photo-1181690.jpeg?auto=compress&cs=tinysrgb&w=400" },
            { name: "Akshay Hemant", role: "Business Development Manager — M.Tech Biotechnology", bio: "Managing business expansion and student outreach, combining technical biotech insights with market strategy.", image: "https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=400" }
        ]
    }
};

async function runSeeder() {
    try {
        console.log('Seeding site_settings/about_content...');
        const ref = db.collection('site_settings').doc('about_content');
        await ref.set(DEFAULT_ABOUT);
        console.log('Success! Firestore database updated with correct template images and text.');
        process.exit(0);
    } catch (e) {
        console.error('Error seeding data:', e);
        process.exit(1);
    }
}

runSeeder();

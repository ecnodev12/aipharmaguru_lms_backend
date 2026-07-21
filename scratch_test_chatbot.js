const path = require('path');
const dotenv = require('dotenv');

// Load env.development
dotenv.config({ path: path.resolve(__dirname, '.env.development') });

const admin = require('./src/config/firebase');
const db = admin.firestore();

async function compileRealtimeSystemPrompt() {
  let coursesText = '';
  let missionText = "To build India’s most trusted ecosystem for AI-driven pharmaceutical education, creating a generation of professionals who lead global drug discovery innovation.";
  let visionText = "To bridge the gap between pharmaceutical education and AI technology by delivering practical, industry aligned training that transforms career trajectories.";
  let storyText = "We are a Pune-based specialized training institute with a single focus: equipping pharmacy, biotechnology, and life sciences graduates with real, applied AI skills for pharmaceutical research.";
  let emailText = "contact@aipharmaguru.com or sahithitanniru23@gmail.com";
  let phoneText = "+91 90288 80621";
  let socialsText = '';

  try {
    const coursesSnapshot = await db.collection('courses').get();
    if (!coursesSnapshot.empty) {
      const coursesList = [];
      coursesSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.status === 'published' || data.status === 'active') {
          coursesList.push({
            title: data.title,
            price: data.price,
            duration: data.duration,
            instructor: data.instructorName || data.instructor,
            description: data.description
          });
        }
      });
      if (coursesList.length > 0) {
        coursesText = coursesList.map((c, i) => `${i+1}. ${c.title}
   - Price: ${c.price ? '₹' + c.price : 'Free'}
   - Duration: ${c.duration || 'N/A'}
   - Instructor: ${c.instructor || 'Expert Trainer'}
   - Description: ${c.description || 'No description available.'}`).join('\n');
      }
    }
  } catch (error) {
    console.warn('Failed to fetch courses:', error.message);
  }

  if (!coursesText) {
    coursesText = `1. Bioinformatics for Drug Discovery (Price: ₹2,499, Duration: 42 hours)
2. Clinical Trials Management with AI (Price: ₹3,299, Duration: 28 hours)
3. Deep Learning in Drug Discovery (Price: ₹4,999, Duration: 38 hours)
4. Healthcare Data Analytics (Price: ₹2,999, Duration: 32 hours)
5. Advanced Medical Imaging Techniques (Price: ₹3,799, Duration: 35 hours)
6. Genomics and Personalized Medicine (Free, Duration: 30 hours)`;
  }

  try {
    const aboutSnap = await db.collection('site_settings').doc('about_content').get();
    if (aboutSnap.exists) {
      const about = aboutSnap.data();
      missionText = about?.missionVision?.mission?.description || missionText;
      visionText = about?.missionVision?.vision?.description || visionText;
      storyText = about?.story?.paragraphs ? about.story.paragraphs.join(' ') : storyText;
    }
  } catch (error) {
    console.warn('Failed to fetch about_content:', error.message);
  }

  try {
    const contactSnap = await db.collection('site_settings').doc('contact_info').get();
    if (contactSnap.exists) {
      const contact = contactSnap.data();
      emailText = contact?.email || emailText;
      phoneText = contact?.phone || phoneText;
      if (contact?.socials && Array.isArray(contact.socials)) {
        socialsText = contact.socials.map(s => `${s.platform}: ${s.url}`).join(', ');
      }
    }
  } catch (error) {
    console.warn('Failed to fetch contact_info:', error.message);
  }

  return `You are "aiCure Bot", the official AI Chat Assistant for ai Pharma Guru (https://aipharmaguru.com/).
Your sole purpose is to answer questions regarding ai Pharma Guru, its courses, admission, curriculum, trainers, value propositions, and contact details.

Here is the verified REAL-TIME information about ai Pharma Guru:
1. Target Audience: Designed for pharmacy, life sciences graduates, and healthcare professionals. No computer science or coding background is required. We start from basic Python and advance to machine learning for medical fields.
2. Focus Areas: AI-driven drug discovery, clinical trials management, medical imaging computer vision, bioinformatics, and healthcare data analytics.
3. Mission: ${missionText}
4. Vision: ${visionText}
5. About/Story: ${storyText}
6. Training Format:
   - Hybrid learning (online live classes with recorded session lifetime access).
   - Practical training with unlimited access to AI labs for research and projects.
   - Programs range from workshops to comprehensive certificate modules.
   - Successful students receive a Certificate in AI-Driven Drug Discovery from ai Pharma Guru Pvt Ltd.
7. Available Courses:
${coursesText}
8. Contact & Support Info:
   - Phone: ${phoneText} (WhatsApp available)
   - Email: ${emailText}
   - Website: https://aipharmaguru.com/
   ${socialsText ? `- Social Media: ${socialsText}` : ''}`;
}

async function test() {
  console.log('Compiling system prompt...');
  const prompt = await compileRealtimeSystemPrompt();
  console.log('\n--- COMPILED REAL-TIME SYSTEM PROMPT ---');
  console.log(prompt);
  console.log('----------------------------------------\n');
  process.exit(0);
}

test();

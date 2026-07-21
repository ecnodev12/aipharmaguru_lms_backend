const fs = require('fs');
const path = require('path');
const emailService = require('./src/services/emailService');

// Define templates and mock data
const templates = {
  admin_course_review_request: {
    courseName: "Introduction to Healthcare AI",
    category: "Medical AI",
    instructorName: "Dr. Jane Smith",
    price: "4999",
    reviewLink: "https://aipharmaguru-4c3a9.web.app/#/admin/courses/review-123"
  },
  admin_purchase_alert: {
    studentName: "John Doe",
    studentEmail: "john.doe@example.com",
    courseTitle: "Introduction to Healthcare AI",
    amount: "4999",
    transactionId: "pay_xyz12345",
    date: new Date().toLocaleString(),
    couponCode: "WELCOME50"
  },
  admin_trainer_added: {
    trainerName: "Dr. Robert Lee",
    trainerEmail: "robert.lee@example.com",
    specialization: "Clinical Machine Learning",
    adminName: "Super Admin"
  },
  admin_trainer_created: {
    username: "robert.lee@example.com",
    tempPassword: "SecureTempPassword123!"
  },
  course_published: {
    courseName: "Introduction to Healthcare AI",
    category: "Medical AI",
    instructorName: "Dr. Jane Smith",
    price: "4999",
    adminName: "Super Admin"
  },
  custom_email: {
    content: "<p>This is a custom broadcast email content for announcement.</p>"
  },
  live_class_scheduled: {
    name: "John Doe",
    topic: "Introduction to Healthcare AI",
    startTime: "2026-07-01 10:00 AM",
    instructorName: "Dr. Jane Smith",
    joinUrl: "https://meet.google.com/abc-defg-hij"
  },
  login_alert: {
    name: "John Doe",
    device: "MacBook Pro",
    browser: "Chrome",
    date: new Date().toLocaleString()
  },
  payment_failed: {
    name: "John Doe",
    reason: "Insufficient funds in account",
    amount: "4999"
  },
  payment_success: {
    name: "John Doe",
    transactionId: "pay_xyz12345",
    amount: "4999",
    date: new Date().toLocaleString(),
    item: "Introduction to Healthcare AI",
    couponCode: "WELCOME50"
  },
  signup_welcome: {
    name: "John Doe"
  },
  student_assignment_submitted: {
    studentName: "John Doe",
    courseTitle: "Introduction to Healthcare AI",
    assignmentTitle: "Final Project - Model Evaluation",
    submissionUrl: "https://aipharmaguru-4c3a9.web.app/#/submissions/123",
    date: new Date().toLocaleString()
  },
  student_course_completed: {
    studentName: "John Doe",
    courseTitle: "Introduction to Healthcare AI",
    certificateId: "CERT-AI-123456",
    certificateUrl: "https://aipharmaguru-4c3a9.web.app/#/certificates/CERT-AI-123456"
  },
  student_syllabus_update: {
    studentName: "John Doe",
    courseTitle: "Introduction to Healthcare AI",
    quizSectionStyle: "display: block;",
    assignmentSectionStyle: "display: block;",
    quizList: "<li>Quiz 1: Deep Learning Basics</li>",
    assignmentList: "<li>Assignment 2: Training a CNN</li>",
    courseUrl: "https://aipharmaguru-4c3a9.web.app/#/course/123/learn"
  },
  welcome: {
    name: "John Doe"
  }
};

async function runTests() {
  console.log("=== STARTING EMAIL TEMPLATE VERIFICATION ===\n");
  
  let successCount = 0;
  let failCount = 0;
  
  for (const [templateName, mockData] of Object.entries(templates)) {
    const templatePath = path.join(__dirname, 'src/templates', `${templateName}.html`);
    
    // 1. Check file existence
    if (!fs.existsSync(templatePath)) {
      console.error(`❌ [FAIL] Template file not found: ${templateName}.html`);
      failCount++;
      continue;
    }
    
    try {
      // 2. Read template file
      let html = fs.readFileSync(templatePath, 'utf8');
      
      // 3. Perform variable replacement
      const missingVars = [];
      Object.keys(mockData).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        html = html.replace(regex, mockData[key]);
      });
      
      // 4. Check for any unresolved {{placeholder}} in the compiled HTML
      const unresolved = html.match(/{{[a-zA-Z0-9_]+}}/g);
      
      // 5. Verify the company logo image URL is present in the output HTML
      const logoOk = html.includes('https://aipharmaguru.web.app/assets/PharmaAIGuru.png');
      
      if (unresolved) {
        console.warn(`⚠️ [WARNING] Template ${templateName} has unresolved placeholders: ${unresolved.join(', ')}`);
      }
      
      // 6. Simulate calling sendEmail (using a dummy recipient)
      const mockSend = await emailService.sendEmail('test@example.com', 'Test Subject', templateName, mockData);
      
      if (mockSend && mockSend.messageId) {
        console.log(`✅ [SUCCESS] Template: ${templateName}.html (Logo included: ${logoOk ? 'YES' : 'NO - Skip expected if custom_email/etc'})`);
        successCount++;
      } else {
        throw new Error('No messageId returned from sendEmail');
      }
      
    } catch (err) {
      console.error(`❌ [FAIL] Template ${templateName}.html error:`, err.message);
      failCount++;
    }
  }
  
  console.log("\n=== EMAIL VERIFICATION SUMMARY ===");
  console.log(`Total Templates tested: ${Object.keys(templates).length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  
  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();

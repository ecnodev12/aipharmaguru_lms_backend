const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const path = require('path');
const fs = require('fs');
const admin = require('../config/firebase');

// const db = admin.firestore(); // Moved inside routes to prevent startup crash if init fails

// Email sending endpoints
// Generic send (optional, keeping for flexibility)
router.post('/send', async (req, res) => {
  try {
    const { to, subject, template, data } = req.body;
    if (!to || !subject || !template || !data) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    await emailService.sendEmail(to, subject, template, data);
    res.status(200).json({ message: 'Email sent successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Specific Endpoints for Better Frontend Integration

// 1. Signup Welcome
router.post('/signup-welcome', async (req, res) => {
    try {
        const { to, name } = req.body;
        if (!to || !name) return res.status(400).json({ error: 'Missing to or name' });
        
        await emailService.sendEmail(to, 'Welcome to aiCure Academy!', 'signup_welcome', { name });
        res.status(200).json({ message: 'Welcome email sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Payment Success
router.post('/payment-success', async (req, res) => {
    try {
        const { to, name, transactionId, amount, date, item, courseName, couponCode } = req.body;
        if (to === undefined || name === undefined || amount === undefined) return res.status(400).json({ error: 'Missing payment details' });

        const courseTitle = item || courseName || 'Course';

        // 1. Send confirmation email to the student
        await emailService.sendEmail(to, 'Payment Successful', 'payment_success', { 
            name,
            transactionId: transactionId || 'N/A',
            amount,
            date,
            item: courseTitle,
            couponCode: couponCode || 'None'
        });

        // 2. Send notification email to the admin(s)
        try {
            const db = admin.firestore();
            const adminsSnap = await db.collection('users').where('role', '==', 'admin').get();
            const adminEmails = [];
            adminsSnap.forEach(doc => {
                const data = doc.data();
                if (data.email) adminEmails.push(data.email);
            });

            const recipientEmails = adminEmails.length > 0 ? adminEmails : ['admin@example.com'];
            for (const adminEmail of recipientEmails) {
                await emailService.sendEmail(adminEmail, 'Alert: New Course Enrollment', 'admin_purchase_alert', {
                    studentName: name,
                    studentEmail: to,
                    courseTitle: courseTitle,
                    amount: amount,
                    transactionId: transactionId || 'N/A',
                    date: date || new Date().toLocaleString(),
                    couponCode: couponCode || 'None'
                });
            }
        } catch (adminEmailError) {
            console.error('Failed to send admin purchase notification email:', adminEmailError);
        }

        res.status(200).json({ message: 'Payment success and admin alert emails sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Payment Failed
router.post('/payment-failed', async (req, res) => {
    try {
        const { to, name, reason, amount } = req.body;
        if (!to) return res.status(400).json({ error: 'Missing recipient' });

        await emailService.sendEmail(to, 'Payment Failed', 'payment_failed', { 
            name, reason, amount 
        });
        res.status(200).json({ message: 'Payment failed email sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Admin - Trainer Added
router.post('/admin/trainer-added', async (req, res) => {
    try {
        const { to, trainerName, trainerEmail, specialization, expertise, adminName } = req.body;
        // 'to' would be the admin email(s)
        await emailService.sendEmail(to, 'New Trainer Added', 'admin_trainer_added', {
            trainerName, trainerEmail, specialization: specialization || expertise || 'General', adminName
        });
        res.status(200).json({ message: 'Trainer added notification sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Course Published (To Instructor)
router.post('/course-published', async (req, res) => {
    try {
        const { to, courseName, category, instructorName, price, adminName } = req.body;
        // 'to' is now the Instructor's email
        await emailService.sendEmail(to, 'Course Approved & Live!', 'course_published', {
            courseName, category: category || 'General', instructorName, price, adminName
        });
        res.status(200).json({ message: 'Course published email sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Admin - Trainer Created (Credentials)
router.post('/admin/trainer-created', async (req, res) => {
    try {
        const { to, username, tempPassword } = req.body;
        await emailService.sendEmail(to, 'Trainer Account Credentials', 'admin_trainer_created', {
            username, tempPassword
        });
        res.status(200).json({ message: 'Trainer credential email sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6.5. Admin - Support Staff Created (Credentials)
router.post('/admin/support-created', async (req, res) => {
    try {
        const { to, username, tempPassword } = req.body;
        await emailService.sendEmail(to, 'Support Account Credentials', 'admin_support_created', {
            username, tempPassword
        });
        res.status(200).json({ message: 'Support credential email sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 7. Admin - Course Review Request (From Instructor)
router.post('/admin/course-review-request', async (req, res) => {
    try {
        const { to, courseName, category, instructorName, price, reviewLink } = req.body;
        // 'to' is the Admin email
        await emailService.sendEmail(to, 'New Course Submission for Review', 'admin_course_review_request', {
             courseName, category: category || 'General', instructorName, price, reviewLink
        });
        // Note: The previous code read the file manually, but didn't actually use the 'html' variable in the sendEmail call correctly if it was using the template service. 
        // The service takes a template name and data. 
        // If we want to send raw HTML, we might need a different method or just pass current implementation.
        // Assuming 'admin_course_review_request' template exists and takes these vars.
        
        res.status(200).json({ message: 'Admin review request sent' });
    } catch (error) {
        console.error('Error sending admin review request:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8. User Login Alert
router.post('/login-alert', async (req, res) => {
    try {
        const { to, name, device, browser, date } = req.body;
        if (!to || !name) return res.status(400).json({ error: 'Missing recipient or user details' });

        await emailService.sendEmail(to, 'Security Alert: New Sign-in Detected', 'login_alert', { 
            name, 
            device: device || 'Unknown Device', 
            browser: browser || 'Unknown Browser', 
            date: date || new Date().toLocaleString()
        });
        res.status(200).json({ message: 'Login alert email sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 8. Admin - Custom Email (Newsletter/Announcement)
router.post('/admin/send-custom', async (req, res) => {
    try {
        const { to, subject, htmlContent, recipientType, scheduledAt } = req.body;
        // recipientType: 'specific', 'all-students', 'all-instructors', 'list'
        
        // Basic validation
        if (!subject || !htmlContent) {
            return res.status(400).json({ error: 'Missing subject or content' });
        }
        if (recipientType === 'specific' && !to) {
            return res.status(400).json({ error: 'Missing recipient email for specific type' });
        }
        if (recipientType === 'list' && (!to || !to.length)) {
             return res.status(400).json({ error: 'Missing recipient list' });
        }

        // Check if Scheduler - REMOVED
        if (scheduledAt) {
             return res.status(400).json({ error: 'Scheduling emails is no longer supported.' });
        }

        let recipients = [];

        // Logic to fetch tokens based on recipientType
        if (recipientType === 'all-students' || recipientType === 'all-instructors') {
            const db = admin.firestore(); // Lazy init
            const role = recipientType === 'all-students' ? 'student' : 'instructor';
            const rosterRef = db.collection('role_rosters').doc(role);
            const rosterDoc = await rosterRef.get();
            
            if (rosterDoc.exists) {
                console.log(`Using optimized Role Roster for ${role} (Email).`);
                const rosterData = rosterDoc.data();
                if (rosterData.users && Array.isArray(rosterData.users)) {
                    recipients = rosterData.users.map(u => ({ email: u.email, name: u.name }));
                }
            } else {
                console.log(`Role Roster for ${role} missing (Email). Building from scratch.`);
                // Fallback: Query users
                const usersSnap = await db.collection('users').where('role', '==', role).get();
                const rosterUsers = [];
                
                usersSnap.forEach(doc => {
                    const userData = doc.data();
                    const userObj = {
                        uid: doc.id,
                        email: userData.email,
                        name: userData.fullName || 'User',
                        fcmToken: userData.fcmToken || null
                    };
                    rosterUsers.push(userObj);
                    recipients.push({ email: userObj.email, name: userObj.name });
                });

                // Save to Roster
                await rosterRef.set({
                    role,
                    users: rosterUsers,
                    updatedAt: new Date().toISOString()
                });
                console.log(`Created Role Roster for ${role} with ${rosterUsers.length} users.`);
            }
        } else if (recipientType === 'list') {
             const list = Array.isArray(to) ? to : to.split(',');
             recipients = list.map(email => ({ email: email.trim(), name: 'User' }));
        } else {
            // Specific
            recipients = [{ email: to, name: 'User' }];
        }

        let successCount = 0;
        let failCount = 0;

        for (const recipient of recipients) {
            // Personalize
            let personalizedHtml = htmlContent;
            if (recipient.name) {
                 personalizedHtml = personalizedHtml.replace(/{{name}}/g, recipient.name);
            }
            personalizedHtml = personalizedHtml.replace(/{{email}}/g, recipient.email);
            
            try {
                 await emailService.sendEmail(recipient.email, subject, 'custom_email', { content: personalizedHtml });
                 successCount++;
            } catch (err) {
                console.error(`Failed to send to ${recipient.email}`, err);
                failCount++;
            }
        }
        
        res.status(200).json({ message: `Emails processed. Success: ${successCount}, Failed: ${failCount}` });
    } catch (error) {
        console.error('Error sending custom email:', error);
        
        // Force CORS for debugging
        const origin = req.headers.origin;
        if (origin) {
            res.header("Access-Control-Allow-Origin", origin);
            res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        }
        
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// 9. Assignment Submitted
router.post('/assignment-submitted', async (req, res) => {
    try {
        const { to, studentName, courseTitle, assignmentTitle, submissionUrl, date } = req.body;
        if (!to || !studentName || !courseTitle || !assignmentTitle) {
            return res.status(400).json({ error: 'Missing submission details' });
        }

        await emailService.sendEmail(to, `Submission Confirmed: ${assignmentTitle}`, 'student_assignment_submitted', {
            studentName,
            courseTitle,
            assignmentTitle,
            submissionUrl: submissionUrl || '#',
            date: date || new Date().toLocaleString()
        });
        res.status(200).json({ message: 'Assignment submission confirmation email sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 10. Notify Syllabus Update (Quizzes / Assignments added)
router.post('/notify-syllabus-update', async (req, res) => {
    try {
        const { courseId, courseName, newQuizzes, newAssignments } = req.body;
        if (!courseId || !courseName) {
            return res.status(400).json({ error: 'Missing course details' });
        }
        if ((!newQuizzes || newQuizzes.length === 0) && (!newAssignments || newAssignments.length === 0)) {
            return res.status(400).json({ error: 'No new quizzes or assignments' });
        }

        const db = admin.firestore();
        const rosterRef = db.collection('course_rosters').doc(courseId);
        const rosterDoc = await rosterRef.get();
        let students = [];

        if (rosterDoc.exists) {
            const rosterData = rosterDoc.data();
            if (rosterData.students && Array.isArray(rosterData.students)) {
                students = rosterData.students;
            }
        } else {
            const usersSnapshot = await db.collection('users')
                .where('enrolledCourses', 'array-contains', courseId)
                .get();
            if (!usersSnapshot.empty) {
                usersSnapshot.forEach(doc => {
                    const data = doc.data();
                    if (data.email) {
                        students.push({
                            uid: doc.id,
                            email: data.email,
                            fullName: data.fullName || 'Student'
                        });
                    }
                });
            }
        }

        if (students.length === 0) {
            return res.status(200).json({ message: 'No students enrolled, skipping notifications.' });
        }

        const quizSectionStyle = newQuizzes && newQuizzes.length > 0 ? 'display: block;' : 'display: none;';
        const assignmentSectionStyle = newAssignments && newAssignments.length > 0 ? 'display: block;' : 'display: none;';
        
        let quizList = '';
        if (newQuizzes && newQuizzes.length > 0) {
            quizList = newQuizzes.map(q => `<li>${q}</li>`).join('');
        }
        
        let assignmentList = '';
        if (newAssignments && newAssignments.length > 0) {
            assignmentList = newAssignments.map(a => `<li>${a}</li>`).join('');
        }

        const origin = req.headers.referer || 'https://aicureacademy-4c3a9.web.app';
        const courseUrl = `${origin.split('/#/')[0]}/#/course/${courseId}/learn`;

        for (const student of students) {
            await emailService.sendEmail(student.email, `New Learning Activities: ${courseName}`, 'student_syllabus_update', {
                studentName: student.fullName || 'Student',
                courseTitle: courseName,
                quizSectionStyle,
                assignmentSectionStyle,
                quizList: quizList || '<li>None</li>',
                assignmentList: assignmentList || '<li>None</li>',
                courseUrl
            });
        }

        res.status(200).json({ message: `Syllabus update emails sent to ${students.length} students.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 11. Course Completed Notification (with Certificate Link)
router.post('/course-completed', async (req, res) => {
    try {
        const { to, studentName, courseTitle, certificateId, certificateUrl } = req.body;
        if (!to || !studentName || !courseTitle || !certificateId || !certificateUrl) {
            return res.status(400).json({ error: 'Missing completion details' });
        }

        await emailService.sendEmail(to, `Congratulations on completing: ${courseTitle}!`, 'student_course_completed', {
            studentName,
            courseTitle,
            certificateId,
            certificateUrl
        });
        res.status(200).json({ message: 'Course completion email sent successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

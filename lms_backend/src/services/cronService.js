const cron = require('node-cron');
const admin = require('../config/firebase');
const emailService = require('./emailService');

const db = admin.db;

/**
 * Main function to check and notify students of batches starting tomorrow
 */
const sendBatchStartingTomorrowEmails = async () => {
    console.log('[cronService] Checking for batches starting tomorrow...');
    try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0]; // "YYYY-MM-DD"
        
        if (!db) {
            console.error('[cronService] Firestore database is not initialized. Cannot run batch reminders.');
            return;
        }

        const coursesSnap = await db.collection('courses').get();
        let notifiedCount = 0;

        for (const doc of coursesSnap.docs) {
            const courseData = doc.data();
            const courseId = doc.id;
            const batches = courseData.batches || [];

            // Find batches starting tomorrow
            const startingBatches = batches.filter(b => b.startDate === tomorrowStr);
            if (startingBatches.length === 0) continue;

            console.log(`[cronService] Course "${courseData.title}" (${courseId}) has ${startingBatches.length} batch(es) starting tomorrow (${tomorrowStr}).`);

            for (const batch of startingBatches) {
                // Fetch student users enrolled in this course
                const studentsSnap = await db.collection('users')
                    .where('role', '==', 'student')
                    .where('enrolledCourses', 'array-contains', courseId)
                    .get();

                for (const studentDoc of studentsSnap.docs) {
                    const studentData = studentDoc.data();
                    const enrollmentMeta = studentData.enrollmentMeta || {};
                    const courseMeta = enrollmentMeta[courseId] || {};

                    // Verify if the student is assigned to this specific batch
                    if (courseMeta.batchId === batch.id) {
                        const studentEmail = studentData.email;
                        const studentName = studentData.fullName || 'Student';

                        if (studentEmail) {
                            const originUrl = 'https://aicureacademy-4c3a9.web.app';
                            const courseUrl = `${originUrl}/#/course/${courseId}/learn`;

                            try {
                                await emailService.sendEmail(studentEmail, `Reminder: Your Course Starts Tomorrow!`, 'course_starting_tomorrow', {
                                    studentName,
                                    courseTitle: courseData.title,
                                    batchName: batch.name || 'Default Batch',
                                    startDate: batch.startDate,
                                    courseUrl
                                });
                                notifiedCount++;
                            } catch (e) {
                                console.error(`[cronService] Failed to send course starting email to ${studentEmail}:`, e);
                            }
                        }
                    }
                }
            }
        }
        console.log(`[cronService] Batch reminder complete. Sent ${notifiedCount} email(s).`);
    } catch (error) {
        console.error('[cronService] Error in sendBatchStartingTomorrowEmails:', error);
    }
};

/**
 * Main function to check and notify admins/trainers about inactive students (7+ days)
 */
const sendInactiveStudentsReport = async () => {
    console.log('[cronService] Checking for inactive students...');
    try {
        if (!db) {
            console.error('[cronService] Firestore database is not initialized. Cannot run inactive student report.');
            return;
        }

        const now = new Date();
        const usersSnap = await db.collection('users').get();
        const coursesSnap = await db.collection('courses').get();

        // 1. Build a map of courseId -> instructor details
        const courseInstructorMap = {};
        const instructorDetailsMap = {};

        // Also compile all instructor info
        const instructorSnap = await db.collection('users').where('role', '==', 'instructor').get();
        instructorSnap.forEach(doc => {
            const data = doc.data();
            instructorDetailsMap[doc.id] = {
                id: doc.id,
                email: data.email,
                fullName: data.fullName || 'Instructor'
            };
        });

        coursesSnap.forEach(doc => {
            const data = doc.data();
            const instructorId = data.instructorId;
            if (instructorId && instructorDetailsMap[instructorId]) {
                courseInstructorMap[doc.id] = instructorDetailsMap[instructorId];
            }
        });

        const ensureDate = (date) => {
            if (!date) return null;
            if (date.toDate) return date.toDate();
            if (typeof date === 'object' && (date.seconds || date._seconds)) {
                return new Date((date.seconds || date._seconds) * 1000);
            }
            if (typeof date === 'number') return new Date(date);
            const parsed = new Date(date);
            return isNaN(parsed.getTime()) ? null : parsed;
        };

        const inactiveList = [];

        usersSnap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.role !== 'student') return;

            const lastLogin = ensureDate(data.lastLogin || data.lastLoginAt || data.createdAt);
            let daysSince = 99; // Never logged in default

            if (lastLogin) {
                daysSince = Math.floor((now.getTime() - lastLogin.getTime()) / (1000 * 60 * 60 * 24));
            }

            if (daysSince >= 7) {
                inactiveList.push({
                    id: docSnap.id,
                    fullName: data.fullName || 'Unknown Student',
                    email: data.email || 'No Email',
                    inactiveDays: daysSince,
                    enrolledCourses: data.enrolledCourses || []
                });
            }
        });

        if (inactiveList.length === 0) {
            console.log('[cronService] No inactive students found.');
            return;
        }

        console.log(`[cronService] Found ${inactiveList.length} inactive student(s). Sending reports...`);

        // A. Send Report to Admins
        // Fetch all admins
        const adminsSnap = await db.collection('users').where('role', '==', 'admin').get();
        const adminEmails = [];
        adminsSnap.forEach(d => {
            if (d.data().email) adminEmails.push(d.data().email);
        });
        const recipients = adminEmails.length > 0 ? adminEmails : ['admin@example.com'];

        const adminStudentRows = inactiveList.map(s => `
            <tr>
                <td style="padding: 12px 16px; border-bottom: 1px solid #E5E7EB;">${s.fullName}</td>
                <td style="padding: 12px 16px; border-bottom: 1px solid #E5E7EB;">${s.email}</td>
                <td style="padding: 12px 16px; border-bottom: 1px solid #E5E7EB; font-weight: bold; color: #EF4444;">${s.inactiveDays} Days</td>
            </tr>
        `).join('');

        for (const adminEmail of recipients) {
            try {
                await emailService.sendEmail(adminEmail, `Daily Student Inactivity Report: ${inactiveList.length} Inactive Student(s)`, 'admin_inactive_students_report', {
                    count: inactiveList.length,
                    studentRows: adminStudentRows
                });
            } catch (err) {
                console.error(`[cronService] Failed to send inactivity report to admin ${adminEmail}:`, err);
            }
        }

        // B. Send Reports to Trainers
        // Group inactive students by trainer
        const trainerInactiveMap = {}; // instructorId -> list of students
        inactiveList.forEach(student => {
            const courseIds = student.enrolledCourses || [];
            const instructorIds = new Set();
            courseIds.forEach(cid => {
                const instructor = courseInstructorMap[cid];
                if (instructor) {
                    instructorIds.add(instructor.id);
                }
            });

            instructorIds.forEach(instId => {
                if (!trainerInactiveMap[instId]) {
                    trainerInactiveMap[instId] = [];
                }
                trainerInactiveMap[instId].push(student);
            });
        });

        for (const instId of Object.keys(trainerInactiveMap)) {
            const instructor = instructorDetailsMap[instId];
            if (!instructor || !instructor.email) continue;

            const trainerStudents = trainerInactiveMap[instId];
            const trainerStudentRows = trainerStudents.map(s => `
                <tr>
                    <td style="padding: 12px 16px; border-bottom: 1px solid #E5E7EB;">${s.fullName}</td>
                    <td style="padding: 12px 16px; border-bottom: 1px solid #E5E7EB;">${s.email}</td>
                    <td style="padding: 12px 16px; border-bottom: 1px solid #E5E7EB; font-weight: bold; color: #EF4444;">${s.inactiveDays} Days</td>
                </tr>
            `).join('');

            try {
                await emailService.sendEmail(instructor.email, `Student Engagement Alert: Inactive Students in Your Courses`, 'trainer_inactive_students_report', {
                    trainerName: instructor.fullName,
                    count: trainerStudents.length,
                    studentRows: trainerStudentRows
                });
            } catch (err) {
                console.error(`[cronService] Failed to send inactivity report to instructor ${instructor.email}:`, err);
            }
        }

        console.log('[cronService] Inactive student reports sent successfully.');
    } catch (err) {
        console.error('[cronService] Error in sendInactiveStudentsReport:', err);
    }
};

/**
 * Initialize Cron Schedulers
 */
const initializeCronJobs = () => {
    console.log('[cronService] Initializing Cron schedulers...');

    // Schedule daily check at 9:00 AM
    cron.schedule('0 9 * * *', async () => {
        console.log('[cronService] Running scheduled daily batch start check...');
        await sendBatchStartingTomorrowEmails();
        console.log('[cronService] Running scheduled daily student inactivity check...');
        await sendInactiveStudentsReport();
    });

    console.log('[cronService] Cron jobs scheduled for 09:00 AM daily.');
};

module.exports = {
    initializeCronJobs,
    sendBatchStartingTomorrowEmails,
    sendInactiveStudentsReport
};

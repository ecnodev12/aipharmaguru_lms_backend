const admin = require('../config/firebase');
const db = admin.firestore();
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');

/**
 * Send Live Class Notification to Enrolled Students
 * POST /api/notifications/live-class
 * Body: { courseId, topic, startTime, joinUrl, instructorName }
 */
const sendLiveClassNotification = async (req, res) => {
    try {
        const { courseId, topic, startTime, joinUrl, instructorName } = req.body;

        if (!courseId || !topic || !startTime) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        console.log(`Starting notification process for Live Class: ${topic}`);

        // 2. Fetch Enrolled Students (Optimized with Roster)
        const rosterRef = db.collection('course_rosters').doc(courseId);
        const rosterDoc = await rosterRef.get();
        
        let students = [];

        if (rosterDoc.exists) {
            console.log('Using optimized Course Roster.');
            const rosterData = rosterDoc.data();
            if (rosterData.students && Array.isArray(rosterData.students)) {
                students = rosterData.students;
            }
        } else {
            console.log('Course Roster missing. Building from scratch (Fall back to query).');
            // Fallback: Query users where 'enrolledCourses' array contains 'courseId'
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
                            fullName: data.fullName || 'Student',
                            fcmToken: data.fcmToken || null
                        });
                    }
                });

                // Save to Roster for next time
                await rosterRef.set({
                    courseId,
                    students: students
                });
                console.log(`Created Course Roster for ${courseId} with ${students.length} students.`);
            }
        }

        if (students.length === 0) {
            console.log('No students enrolled in this course.');
            return res.status(200).json({ message: 'No students to notify.' });
        }

        console.log(`Found ${students.length} students to notify.`);

        // FCM
        const fcmTokens = students.filter(s => s.fcmToken).map(s => s.fcmToken);
        let fcmCount = 0;
        if (fcmTokens.length > 0) {
            const fcmRes = await notificationService.sendPushNotification(
                fcmTokens,
                `Live Class: ${topic}`,
                `Join now! Starting: ${startTime}`,
                { type: 'live_class', courseId, joinUrl }
            );
            fcmCount = fcmRes.successCount;
        }

        // Email
        let emailCount = 0;
        const emailPromises = students.map(student => {
            return emailService.sendEmail(
                student.email,
                `Live Class: ${topic}`,
                'live_class_scheduled', // Use the specific template
                {
                    name: student.fullName || student.name || 'Student',
                    topic,
                    startTime,
                    instructorName: instructorName || 'Instructor',
                    joinUrl: joinUrl || '#'
                }
            ).then(() => emailCount++).catch(e => console.error(`Email fail: ${e.message}`));
        });

        await Promise.allSettled(emailPromises);

        res.status(200).json({
            success: true,
            emailsSent: emailCount,
            fcmSent: fcmCount
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    sendLiveClassNotification
};

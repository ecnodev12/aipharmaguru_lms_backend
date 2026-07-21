const admin = require('../config/firebase');
const emailService = require('./emailService');

const db = admin.db;
const serviceStartupTime = new Date();
const gracePeriodMs = 5 * 60 * 1000; // 5 minutes grace period for events created right before startup

/**
 * Helper to get all admin emails
 */
const getAdminEmails = async () => {
    const emails = [];
    try {
        const adminsSnap = await db.collection('users').where('role', '==', 'admin').get();
        adminsSnap.forEach(d => {
            if (d.data().email) emails.push(d.data().email);
        });
    } catch (error) {
        console.error('[dbListenerService] Error fetching admin emails:', error);
    }
    return emails.length > 0 ? emails : ['admin@example.com'];
};

/**
 * Helper to get student email and details for a course
 */
const getEnrolledStudents = async (courseId) => {
    const students = [];
    try {
        // 1. Try course_rosters document first
        const rosterRef = db.collection('course_rosters').doc(courseId);
        const rosterDoc = await rosterRef.get();
        if (rosterDoc.exists) {
            const rosterData = rosterDoc.data();
            if (rosterData.students && Array.isArray(rosterData.students)) {
                return rosterData.students.map(s => ({
                    uid: s.uid,
                    email: s.email,
                    fullName: s.fullName || s.name || 'Student'
                }));
            }
        }

        // 2. Fallback: Query all student users enrolled in this course
        const usersSnap = await db.collection('users')
            .where('role', '==', 'student')
            .where('enrolledCourses', 'array-contains', courseId)
            .get();

        usersSnap.forEach(doc => {
            const data = doc.data();
            if (data.email) {
                students.push({
                    uid: doc.id,
                    email: data.email,
                    fullName: data.fullName || 'Student'
                });
            }
        });
    } catch (error) {
        console.error(`[dbListenerService] Error fetching students for course ${courseId}:`, error);
    }
    return students;
};

/**
 * Run a one-time startup backfill to mark historical documents/records as notified.
 * This prevents duplicate email notifications for data created before the service started.
 */
const runStartupBackfill = async () => {
    console.log('[dbListenerService] Starting historical data backfill safeguard...');
    try {
        // 1. Backfill Courses (Curriculum lessons, Live Classes, and Course creation/modification state)
        const coursesSnap = await db.collection('courses').get();
        let courseUpdates = 0;
        for (const doc of coursesSnap.docs) {
            const courseData = doc.data();
            let needsUpdate = false;

            // Curriculum lessons
            const curriculum = courseData.curriculum || [];
            const updatedCurriculum = curriculum.map(section => {
                const lessons = section.lessons || [];
                return {
                    ...section,
                    lessons: lessons.map(lesson => {
                        if (lesson.notified === undefined) {
                            needsUpdate = true;
                            return { ...lesson, notified: true };
                        }
                        return lesson;
                    })
                };
            });

            // Live Classes
            const liveClasses = courseData.liveClasses || [];
            const updatedLiveClasses = liveClasses.map(lc => {
                if (lc.emailSent === undefined) {
                    needsUpdate = true;
                    return { ...lc, emailSent: true };
                }
                return lc;
            });

            // Course creation/modification notified state
            const updates = {
                curriculum: updatedCurriculum,
                liveClasses: updatedLiveClasses
            };

            if (courseData.adminNotifiedCreated === undefined) {
                updates.adminNotifiedCreated = true;
                needsUpdate = true;
            }
            if (courseData.adminNotifiedModified === undefined) {
                updates.adminNotifiedModified = true;
                needsUpdate = true;
            }
            if (courseData.adminNotifiedApproval === undefined) {
                updates.adminNotifiedApproval = true;
                needsUpdate = true;
            }

            if (needsUpdate) {
                await doc.ref.update(updates);
                courseUpdates++;
            }
        }
        console.log(`[dbListenerService] Backfill: Marked lessons/live classes/state in ${courseUpdates} course(s).`);

        // 2. Backfill Assignment Submissions
        const submissionsSnap = await db.collection('assignmentSubmissions').get();
        let submissionUpdates = 0;
        for (const doc of submissionsSnap.docs) {
            if (doc.data().trainerNotified === undefined) {
                await doc.ref.update({ trainerNotified: true });
                submissionUpdates++;
            }
        }
        console.log(`[dbListenerService] Backfill: Marked ${submissionUpdates} assignment submission(s).`);

        // 3. Backfill Q&A Questions
        const questionsSnap = await db.collectionGroup('questions').get();
        let questionUpdates = 0;
        for (const doc of questionsSnap.docs) {
            if (doc.data().trainerNotified === undefined) {
                await doc.ref.update({ trainerNotified: true });
                questionUpdates++;
            }
        }
        console.log(`[dbListenerService] Backfill: Marked ${questionUpdates} Q&A question(s).`);

        // 4. Backfill Support Tickets
        const ticketsSnap = await db.collection('support_tickets').get();
        let ticketUpdates = 0;
        for (const doc of ticketsSnap.docs) {
            const data = doc.data();
            const updates = {};
            let needsUpdate = false;

            if (data.notified === undefined) {
                updates.notified = true;
                updates.lastNotifiedStatus = data.status || 'Open';
                needsUpdate = true;
            }
            if (data.adminNotifiedAssign === undefined) {
                updates.adminNotifiedAssign = true;
                needsUpdate = true;
            }

            if (needsUpdate) {
                await doc.ref.update(updates);
                ticketUpdates++;
            }
        }
        console.log(`[dbListenerService] Backfill: Marked ${ticketUpdates} support ticket(s).`);

        // 5. Backfill Quiz Submissions (in reviews and user profiles)
        const reviewsSnap = await db.collectionGroup('reviews').get();
        let reviewUpdates = 0;
        for (const doc of reviewsSnap.docs) {
            if (doc.data().trainerNotified === undefined) {
                await doc.ref.update({ trainerNotified: true });
                reviewUpdates++;
            }
        }
        console.log(`[dbListenerService] Backfill: Marked ${reviewUpdates} course review(s).`);

        const usersSnap = await db.collection('users').where('role', '==', 'student').get();
        let userUpdates = 0;
        for (const doc of usersSnap.docs) {
            const userData = doc.data();
            if (userData.completedLessons && userData.notifiedCompletedLessons === undefined) {
                await doc.ref.update({ notifiedCompletedLessons: userData.completedLessons });
                userUpdates++;
            }
        }
        console.log(`[dbListenerService] Backfill: Marked completed lessons in ${userUpdates} student profile(s).`);

        console.log('[dbListenerService] Historical data backfill completed successfully.');
    } catch (error) {
        console.error('[dbListenerService] Error running startup backfill:', error);
    }
};

/**
 * Initialize Firestore Realtime Listeners
 */
const initializeListeners = async () => {
    if (!db) {
        console.error('[dbListenerService] Firestore database object is not initialized. Listeners will not start.');
        return;
    }

    // Run backfill first to protect historical data
    await runStartupBackfill();

    console.log('[dbListenerService] Initializing Firestore listeners...');

    // 1. Transactions Listener (Purchase confirmations)
    db.collection('transactions').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'added' || change.type === 'modified') {
                const doc = change.doc;
                const data = doc.data();

                // Skip if not successful or already notified
                if (data.status !== 'success') return;
                if (data.studentEmailSent && data.adminEmailSent) return;

                // Check timestamp safeguard
                const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || 0);
                if (createdAt < new Date(serviceStartupTime.getTime() - gracePeriodMs)) {
                    return;
                }

                console.log(`[dbListenerService] Processing transaction purchase confirmation: ${doc.id}`);

                try {
                    const userId = data.userId;
                    const courseId = data.courseId || data.itemId;

                    if (!userId || !courseId) return;

                    // Fetch student details
                    const studentDoc = await db.collection('users').doc(userId).get();
                    if (!studentDoc.exists) return;
                    const studentData = studentDoc.data();
                    const studentEmail = studentData.email;
                    const studentName = studentData.fullName || 'Student';

                    // Fetch course details
                    const courseDoc = await db.collection('courses').doc(courseId).get();
                    const courseTitle = courseDoc.exists ? (courseDoc.data().title || 'Course') : 'Course';

                    const transactionId = data.id || data.transactionId || 'N/A';
                    const amount = data.amount || 0;
                    const date = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleString() : new Date().toLocaleString();
                    const couponCode = data.couponCode || 'None';

                    const updates = {};

                    // Send student email
                    if (!data.studentEmailSent && studentEmail) {
                        try {
                            await emailService.sendEmail(studentEmail, 'Payment Successful & Course Enrolled', 'payment_success', {
                                name: studentName,
                                transactionId,
                                amount,
                                date,
                                item: courseTitle,
                                couponCode
                            });
                            updates.studentEmailSent = true;
                        } catch (e) {
                            console.error('[dbListenerService] Failed to send student purchase email:', e);
                        }
                    }

                    // Send admin email
                    if (!data.adminEmailSent) {
                        try {
                            const adminEmails = await getAdminEmails();
                            for (const email of adminEmails) {
                                await emailService.sendEmail(email, 'Alert: New Course Enrollment', 'admin_purchase_alert', {
                                    studentName,
                                    studentEmail,
                                    courseTitle,
                                    amount,
                                    transactionId,
                                    date,
                                    couponCode
                                });
                            }
                            updates.adminEmailSent = true;
                        } catch (e) {
                            console.error('[dbListenerService] Failed to send admin purchase alert email:', e);
                        }
                    }

                    if (Object.keys(updates).length > 0) {
                        await doc.ref.update(updates);
                    }

                } catch (err) {
                    console.error('[dbListenerService] Error handling transaction change:', err);
                }
            }
        });
    });

    // 2. Courses Listener (Live Classes, Quizzes, Assignments, Video Updates, Creation, Modifications, Approval Requests)
    db.collection('courses').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            const doc = change.doc;
            const courseId = doc.id;
            const courseData = doc.data();

            // Check timestamp safeguard (courses created/updated after startup)
            const updatedAt = courseData.updatedAt?.toDate ? courseData.updatedAt.toDate() : (courseData.createdAt?.toDate ? courseData.createdAt.toDate() : new Date(0));
            if (updatedAt < new Date(serviceStartupTime.getTime() - gracePeriodMs)) {
                return;
            }

            // A. COURSE CREATION NOTIFICATION
            if (change.type === 'added') {
                if (!courseData.adminNotifiedCreated && courseData.status !== 'published') {
                    console.log(`[dbListenerService] New Course Created: ${courseData.title} by instructor ${courseData.instructorId}`);
                    try {
                        let trainerName = 'Instructor';
                        if (courseData.instructorId) {
                            const instDoc = await db.collection('users').doc(courseData.instructorId).get();
                            if (instDoc.exists) trainerName = instDoc.data().fullName || 'Instructor';
                        }

                        const admins = await getAdminEmails();
                        for (const adminEmail of admins) {
                            await emailService.sendEmail(adminEmail, `New Course Created: ${courseData.title}`, 'admin_course_created', {
                                courseTitle: courseData.title,
                                trainerName,
                                date: new Date().toLocaleDateString()
                            });
                        }
                        await doc.ref.update({ adminNotifiedCreated: true });
                    } catch (e) {
                        console.error('[dbListenerService] Failed to notify admins of course creation:', e);
                    }
                }
            }

            // B. COURSE MODIFICATIONS & APPROVAL REQUESTS (Triggered on updates)
            if (change.type === 'modified') {
                try {
                    let trainerName = 'Instructor';
                    if (courseData.instructorId) {
                        const instDoc = await db.collection('users').doc(courseData.instructorId).get();
                        if (instDoc.exists) trainerName = instDoc.data().fullName || 'Instructor';
                    }

                    // --- B1. APPROVAL REQUESTS ---
                    if ((courseData.status === 'pending' || courseData.hasPendingChanges === true) && !courseData.adminNotifiedApproval) {
                        console.log(`[dbListenerService] Course Sent for Approval: ${courseData.title}`);
                        const admins = await getAdminEmails();
                        for (const adminEmail of admins) {
                            await emailService.sendEmail(adminEmail, `Action Required: Course Sent for Approval - ${courseData.title}`, 'admin_course_approval_request', {
                                courseTitle: courseData.title,
                                trainerName,
                                price: courseData.suggestedPrice || courseData.price || 'N/A',
                                date: new Date().toLocaleDateString()
                            });
                        }
                        await doc.ref.update({ adminNotifiedApproval: true });
                    }

                    // --- B2. GENERAL TRAINER MODIFICATIONS ---
                    if ((courseData.status === 'draft' || courseData.status === 'published') && !courseData.adminNotifiedModified) {
                        console.log(`[dbListenerService] Course Modified: ${courseData.title}`);
                        const admins = await getAdminEmails();
                        for (const adminEmail of admins) {
                            await emailService.sendEmail(adminEmail, `Course Modified: ${courseData.title} by ${trainerName}`, 'admin_course_modified', {
                                courseTitle: courseData.title,
                                trainerName,
                                date: new Date().toLocaleDateString()
                            });
                        }
                        await doc.ref.update({ adminNotifiedModified: true });
                    }

                    // Only send updates for published courses to avoid spamming drafts
                    if (courseData.status !== 'published') return;

                    // --- B3. LIVE CLASSES NOTIFICATION ---
                    const liveClasses = courseData.liveClasses || [];
                    let hasLiveClassUpdate = false;
                    const updatedLiveClasses = [];

                    for (const lc of liveClasses) {
                        // Check if live class is scheduled, has a meeting link, and hasn't sent notification yet
                        if (lc.status === 'scheduled' && lc.meetingLink && !lc.emailSent) {
                            // Check creation timestamp safeguard (if exists, or default to epoch)
                            const createdAt = lc.createdAt ? new Date(lc.createdAt) : new Date(0);
                            if (createdAt >= new Date(serviceStartupTime.getTime() - gracePeriodMs)) {
                                console.log(`[dbListenerService] Sending notification for Live Class: ${lc.title}`);
                                
                                // Fetch enrolled students
                                const students = await getEnrolledStudents(courseId);
                                const startTimeStr = `${lc.date} at ${lc.time} (${lc.duration} mins)`;

                                for (const student of students) {
                                    try {
                                        await emailService.sendEmail(student.email, `🔴 Live Class Scheduled: ${lc.title}`, 'live_class_scheduled', {
                                            name: student.fullName,
                                            topic: lc.title,
                                            startTime: startTimeStr,
                                            instructorName: trainerName,
                                            joinUrl: lc.meetingLink
                                        });
                                    } catch (err) {
                                        console.error(`[dbListenerService] Failed to send live class email to ${student.email}:`, err);
                                    }
                                }
                            }
                            updatedLiveClasses.push({ ...lc, emailSent: true });
                            hasLiveClassUpdate = true;
                        } else {
                            updatedLiveClasses.push(lc);
                        }
                    }

                    if (hasLiveClassUpdate) {
                        await doc.ref.update({ liveClasses: updatedLiveClasses });
                    }

                    // --- B4. CURRICULUM SYLLABUS UPDATES (Quizzes, Assignments, Videos) ---
                    const curriculum = courseData.curriculum || [];
                    const notifiedLessonIds = new Set();
                    const newQuizzes = [];
                    const newAssignments = [];
                    const newVideos = [];

                    curriculum.forEach(section => {
                        const lessons = section.lessons || [];
                        lessons.forEach(lesson => {
                            if (!lesson.notified) {
                                if (lesson.type === 'quiz') {
                                    newQuizzes.push(lesson);
                                } else if (lesson.type === 'assignment') {
                                    newAssignments.push(lesson);
                                } else if (lesson.type === 'video' || lesson.type === 'document') {
                                    newVideos.push(lesson);
                                }
                            }
                        });
                    });

                    if (newQuizzes.length > 0 || newAssignments.length > 0 || newVideos.length > 0) {
                        const students = await getEnrolledStudents(courseId);

                        // Find origin URL for course details page
                        const originUrl = 'https://aipharmaguru-4c3a9.web.app';
                        const courseUrl = `${originUrl}/#/course/${courseId}/learn`;

                        // Send Quiz Assigned Emails
                        for (const quiz of newQuizzes) {
                            for (const student of students) {
                                try {
                                    await emailService.sendEmail(student.email, `New Quiz Assigned: ${quiz.title}`, 'student_quiz_assigned', {
                                        studentName: student.fullName,
                                        courseTitle: courseData.title,
                                        quizTitle: quiz.title,
                                        courseUrl
                                    });
                                } catch (e) {
                                    console.error(`[dbListenerService] Failed quiz email to ${student.email}:`, e);
                                }
                            }
                            notifiedLessonIds.add(quiz.id);
                        }

                        // Send Assignment Assigned Emails
                        for (const assignment of newAssignments) {
                            for (const student of students) {
                                try {
                                    await emailService.sendEmail(student.email, `New Assignment Assigned: ${assignment.title}`, 'student_assignment_assigned', {
                                        studentName: student.fullName,
                                        courseTitle: courseData.title,
                                        assignmentTitle: assignment.title,
                                        courseUrl
                                    });
                                } catch (e) {
                                    console.error(`[dbListenerService] Failed assignment email to ${student.email}:`, e);
                                }
                            }
                            notifiedLessonIds.add(assignment.id);
                        }

                        // Send Video uploaded / Syllabus modified emails
                        if (newVideos.length > 0) {
                            const videoList = newVideos.map(v => `<li>${v.title} (${v.type.toUpperCase()})</li>`).join('');
                            for (const student of students) {
                                try {
                                    await emailService.sendEmail(student.email, `Syllabus Update: ${courseData.title}`, 'student_syllabus_update', {
                                        studentName: student.fullName,
                                        courseTitle: courseData.title,
                                        quizSectionStyle: 'display: none;',
                                        assignmentSectionStyle: 'display: block;',
                                        quizList: '<li>None</li>',
                                        assignmentList: videoList,
                                        courseUrl
                                    });
                                } catch (e) {
                                    console.error(`[dbListenerService] Failed syllabus update email to ${student.email}:`, e);
                                }
                            }
                            newVideos.forEach(v => notifiedLessonIds.add(v.id));
                        }

                        // Mark notified lessons in Firestore
                        if (notifiedLessonIds.size > 0) {
                            const updatedCurriculum = curriculum.map(section => {
                                const lessons = section.lessons || [];
                                return {
                                    ...section,
                                    lessons: lessons.map(lesson => {
                                        if (notifiedLessonIds.has(lesson.id)) {
                                            return { ...lesson, notified: true };
                                        }
                                        return lesson;
                                    })
                                };
                            });
                            await doc.ref.update({ curriculum: updatedCurriculum });
                        }
                    }

                } catch (err) {
                    console.error(`[dbListenerService] Error handling course curriculum update for ${courseId}:`, err);
                }
            }
        });
    });

    // 3. Users Listener (Quiz Completion triggers for enrolled students)
    db.collection('users').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'modified') {
                const doc = change.doc;
                const studentId = doc.id;
                const studentData = doc.data();

                // Only process students completing lessons
                if (studentData.role !== 'student') return;

                const completedLessons = studentData.completedLessons || {};
                const notifiedCompletedLessons = studentData.notifiedCompletedLessons || {};

                let hasNewCompletions = false;
                const updatedNotified = { ...notifiedCompletedLessons };

                for (const courseId of Object.keys(completedLessons)) {
                    const completedList = completedLessons[courseId] || [];
                    const notifiedList = notifiedCompletedLessons[courseId] || [];

                    const newlyCompletedList = completedList.filter(id => !notifiedList.includes(id));
                    if (newlyCompletedList.length === 0) continue;

                    // Fetch course syllabus to check if the completed lesson is a quiz
                    try {
                        const courseDoc = await db.collection('courses').doc(courseId).get();
                        if (!courseDoc.exists) continue;

                        const courseData = courseDoc.data();
                        const curriculum = courseData.curriculum || [];

                        // Map of lessonId -> lesson
                        const lessonMap = {};
                        curriculum.forEach(section => {
                            (section.lessons || []).forEach(lesson => {
                                lessonMap[lesson.id] = lesson;
                            });
                        });

                        for (const lessonId of newlyCompletedList) {
                            const lesson = lessonMap[lessonId];
                            if (lesson && lesson.type === 'quiz') {
                                console.log(`[dbListenerService] Quiz completion detected for student ${studentId} in course ${courseId}: ${lesson.title}`);
                                
                                const instructorId = courseData.instructorId;
                                if (instructorId) {
                                    const instructorDoc = await db.collection('users').doc(instructorId).get();
                                    if (instructorDoc.exists) {
                                        const instructorData = instructorDoc.data();
                                        const trainerEmail = instructorData.email;
                                        const trainerName = instructorData.fullName || 'Instructor';

                                        if (trainerEmail) {
                                            await emailService.sendEmail(trainerEmail, `Quiz Submitted: ${lesson.title} by ${studentData.fullName || 'Student'}`, 'trainer_quiz_submitted', {
                                                trainerName,
                                                studentName: studentData.fullName || 'Student',
                                                courseTitle: courseData.title,
                                                quizTitle: lesson.title,
                                                date: new Date().toLocaleString()
                                            });
                                        }
                                    }
                                }
                            }
                        }

                        updatedNotified[courseId] = [...notifiedList, ...newlyCompletedList];
                        hasNewCompletions = true;

                    } catch (err) {
                        console.error(`[dbListenerService] Error handling quiz completion check for student ${studentId}:`, err);
                    }
                }

                if (hasNewCompletions) {
                    await doc.ref.update({ notifiedCompletedLessons: updatedNotified });
                }
            }
        });
    });

    // 4. Assignment Submissions Listener (Notifies Trainer)
    db.collection('assignmentSubmissions').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'added' || change.type === 'modified') {
                const doc = change.doc;
                const data = doc.data();

                // Skip if not pending/re-uploaded or already notified
                if (data.trainerNotified) return;
                if (data.status !== 'pending' && data.status !== 're-uploaded') return;

                // Safeguard: Check timestamp
                const submittedAt = data.submittedAt ? new Date(data.submittedAt) : new Date(0);
                if (submittedAt < new Date(serviceStartupTime.getTime() - gracePeriodMs)) {
                    return;
                }

                console.log(`[dbListenerService] Processing assignment submission notification: ${doc.id}`);

                try {
                    const instructorId = data.instructorId;
                    if (!instructorId) return;

                    // Fetch instructor email details
                    const instructorDoc = await db.collection('users').doc(instructorId).get();
                    if (!instructorDoc.exists) return;
                    const instructorData = instructorDoc.data();
                    const trainerEmail = instructorData.email;
                    const trainerName = instructorData.fullName || 'Instructor';

                    if (trainerEmail) {
                        await emailService.sendEmail(trainerEmail, `Assignment Submitted: ${data.lessonTitle}`, 'trainer_assignment_submitted', {
                            trainerName,
                            studentName: data.userName || 'Student',
                            courseTitle: data.courseTitle || 'Course',
                            assignmentTitle: data.lessonTitle || 'Assignment',
                            date: data.submittedAt ? new Date(data.submittedAt).toLocaleString() : new Date().toLocaleString(),
                            submissionUrl: data.fileUrl || '#'
                        });

                        await doc.ref.update({ trainerNotified: true });
                    }
                } catch (err) {
                    console.error('[dbListenerService] Error handling assignment submission notification:', err);
                }
            }
        });
    });

    // 5. Q&A Questions Listener (Notifies Trainer on New Video Q&A Questions)
    db.collectionGroup('questions').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'added') {
                const doc = change.doc;
                const data = doc.data();

                // Skip if already notified
                if (data.trainerNotified) return;

                // Safeguard: Check timestamp
                const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(0);
                if (createdAt < new Date(serviceStartupTime.getTime() - gracePeriodMs)) {
                    return;
                }

                console.log(`[dbListenerService] Processing Q&A question notification: ${doc.id}`);

                try {
                    const courseId = data.courseId;
                    if (!courseId) return;

                    // Fetch course instructorId
                    const courseDoc = await db.collection('courses').doc(courseId).get();
                    if (!courseDoc.exists) return;
                    const courseData = courseDoc.data();
                    const instructorId = courseData.instructorId;

                    if (instructorId) {
                        // Fetch instructor details
                        const instructorDoc = await db.collection('users').doc(instructorId).get();
                        if (instructorDoc.exists) {
                            const instructorData = instructorDoc.data();
                            const trainerEmail = instructorData.email;
                            const trainerName = instructorData.fullName || 'Instructor';

                            if (trainerEmail) {
                                const originUrl = 'https://aipharmaguru-4c3a9.web.app';
                                const qaUrl = `${originUrl}/#/course/${courseId}/learn?tab=qa`;

                                await emailService.sendEmail(trainerEmail, `New Q&A Question in ${courseData.title}`, 'trainer_qa_question', {
                                    trainerName,
                                    studentName: data.userName || 'Student',
                                    courseTitle: courseData.title,
                                    questionTitle: data.title || 'No Title',
                                    questionContent: data.content || '',
                                    qaUrl
                                });

                                await doc.ref.update({ trainerNotified: true });
                            }
                        }
                    }
                } catch (err) {
                    console.error('[dbListenerService] Error handling Q&A question notification:', err);
                }
            }
        });
    });

    // 6. Course Reviews Listener (Notifies Trainer on New Student Reviews)
    db.collectionGroup('reviews').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'added') {
                const doc = change.doc;
                const data = doc.data();

                // Skip if already notified
                if (data.trainerNotified) return;

                // Safeguard: Check timestamp
                const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(0);
                if (createdAt < new Date(serviceStartupTime.getTime() - gracePeriodMs)) {
                    return;
                }

                console.log(`[dbListenerService] Processing Course Review notification: ${doc.id}`);

                try {
                    const courseRef = doc.ref.parent.parent;
                    if (!courseRef) return;

                    const courseDoc = await courseRef.get();
                    if (!courseDoc.exists) return;

                    const courseData = courseDoc.data();
                    const instructorId = courseData.instructorId;

                    if (instructorId) {
                        const instructorDoc = await db.collection('users').doc(instructorId).get();
                        if (instructorDoc.exists) {
                            const instructorData = instructorDoc.data();
                            const trainerEmail = instructorData.email;
                            const trainerName = instructorData.fullName || 'Instructor';

                            if (trainerEmail) {
                                await emailService.sendEmail(trainerEmail, `New Course Review: ${data.rating} Stars for ${courseData.title}`, 'trainer_course_review', {
                                    trainerName,
                                    studentName: data.userName || 'Student',
                                    courseTitle: courseData.title,
                                    rating: data.rating || 0,
                                    comment: data.comment || 'No comment provided.',
                                    date: data.createdAt?.toDate ? data.createdAt.toDate().toLocaleString() : new Date().toLocaleString()
                                });

                                await doc.ref.update({ trainerNotified: true });
                            }
                        }
                    }
                } catch (err) {
                    console.error('[dbListenerService] Error handling course review notification:', err);
                }
            }
        });
    });

    // 7. Support Tickets Listener (Notifies Admin and Trainers on assignment/update)
    db.collection('support_tickets').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'added' || change.type === 'modified') {
                const doc = change.doc;
                const data = doc.data();

                // Safeguard: Check timestamp
                const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(0);
                if (createdAt < new Date(serviceStartupTime.getTime() - gracePeriodMs)) {
                    return;
                }

                console.log(`[dbListenerService] Processing Support Ticket notification: ${doc.id}`);

                try {
                    // --- A. NOTIFY TRAINERS ON ASSIGNMENT/CREATION ---
                    if (!data.notified || data.lastNotifiedStatus !== data.status) {
                        const recipientEmails = new Set();
                        
                        // Fetch all admins
                        const adminsSnap = await db.collection('users').where('role', '==', 'admin').get();
                        adminsSnap.forEach(d => {
                            if (d.data().email) recipientEmails.add(d.data().email);
                        });

                        // Fetch student's course instructors
                        const studentId = data.studentId;
                        if (studentId) {
                            const studentDoc = await db.collection('users').doc(studentId).get();
                            if (studentDoc.exists) {
                                const enrolledCourses = studentDoc.data().enrolledCourses || [];
                                for (const courseId of enrolledCourses) {
                                    const courseDoc = await db.collection('courses').doc(courseId).get();
                                    if (courseDoc.exists) {
                                        const instructorId = courseDoc.data().instructorId;
                                        if (instructorId) {
                                            const instructorDoc = await db.collection('users').doc(instructorId).get();
                                            if (instructorDoc.exists && instructorDoc.data().email) {
                                                recipientEmails.add(instructorDoc.data().email);
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        const emailList = Array.from(recipientEmails);
                        if (emailList.length > 0) {
                            const originUrl = 'https://aipharmaguru-4c3a9.web.app';
                            const ticketUrl = `${originUrl}/#/instructor-dashboard?tab=support`;

                            for (const email of emailList) {
                                try {
                                    await emailService.sendEmail(email, `Support Ticket Update: ${data.subject}`, 'support_assigned', {
                                        recipientName: 'Team Member',
                                        studentName: data.studentName || 'Student',
                                        studentEmail: data.studentEmail || 'N/A',
                                        subject: data.subject || 'No Subject',
                                        message: data.message || '',
                                        priority: data.priority || 'Medium',
                                        status: data.status || 'Open',
                                        ticketUrl
                                    });
                                } catch (e) {
                                    console.error(`[dbListenerService] Failed support ticket email to ${email}:`, e);
                                }
                            }

                            await doc.ref.update({
                                notified: true,
                                lastNotifiedStatus: data.status
                            });
                        }
                    }

                    // --- B. NOTIFY ADMINS WHEN TRAINER ASSIGNS / RESOLVES / UPDATES TICKET ---
                    if (data.status !== 'Open' && !data.adminNotifiedAssign) {
                        console.log(`[dbListenerService] Support Ticket ${doc.id} Status Updated by Trainer to ${data.status}. Notifying Admins...`);
                        
                        let trainerName = 'Instructor';
                        const studentId = data.studentId;
                        if (studentId) {
                            const studentDoc = await db.collection('users').doc(studentId).get();
                            if (studentDoc.exists) {
                                const enrolledCourses = studentDoc.data().enrolledCourses || [];
                                if (enrolledCourses.length > 0) {
                                    const courseDoc = await db.collection('courses').doc(enrolledCourses[0]).get();
                                    if (courseDoc.exists) {
                                        const instructorId = courseDoc.data().instructorId;
                                        if (instructorId) {
                                            const instructorDoc = await db.collection('users').doc(instructorId).get();
                                            if (instructorDoc.exists) {
                                                trainerName = instructorDoc.data().fullName || 'Instructor';
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        const admins = await getAdminEmails();
                        for (const adminEmail of admins) {
                            try {
                                await emailService.sendEmail(adminEmail, `Support Ticket Updated by Trainer: ${doc.id}`, 'admin_support_assigned', {
                                    ticketId: doc.id,
                                    trainerName,
                                    studentName: data.studentName || 'Student',
                                    subject: data.subject || 'No Subject',
                                    status: data.status || 'Updated',
                                    date: new Date().toLocaleString()
                                });
                            } catch (e) {
                                console.error(`[dbListenerService] Failed admin ticket notification to ${adminEmail}:`, e);
                            }
                        }

                        await doc.ref.update({ adminNotifiedAssign: true });
                    }

                } catch (err) {
                    console.error('[dbListenerService] Error handling support ticket notification:', err);
                }
            }
        });
    });
};

module.exports = {
    initializeListeners
};

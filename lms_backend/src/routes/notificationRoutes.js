const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const notificationController = require('../controllers/notificationController'); // Import controller
const { db } = require('../config/firebase'); 

// POST /live-class - Notify students about a live class
router.post('/live-class', notificationController.sendLiveClassNotification);

// POST /admin/send-push
router.post('/admin/send-push', async (req, res) => {
    try {
        const { recipientType, to, title, body, data, imageUrl } = req.body;
        // recipientType: 'specific', 'all-students', 'all-instructors', 'list', 'all-users', 'course-enrolled', 'general-users'
        
        if (!title || !body) {
            return res.status(400).json({ error: 'Missing title or body' });
        }

        const tokens = [];

        // Logic to fetch tokens based on recipientType
        if (['all-users', 'course-enrolled', 'general-users'].includes(recipientType)) {
            let topic = 'all_users';
            if (recipientType === 'course-enrolled') topic = 'course_enrolled';
            if (recipientType === 'general-users') topic = 'general_users';

            console.log(`Sending topic broadcast to: ${topic}`);
            const response = await notificationService.sendTopicNotification(topic, title, body, data, imageUrl);
            return res.status(200).json({ 
                message: `Notification broadcasted securely to ${topic}`, 
                success: response.successCount, 
                failure: response.failureCount 
            });
        } else if (recipientType === 'all-students' || recipientType === 'all-instructors') {
            const role = recipientType === 'all-students' ? 'student' : 'instructor';
            const rosterRef = db.collection('role_rosters').doc(role);
            const rosterDoc = await rosterRef.get();
            let usersList = [];
            if (rosterDoc.exists) {
                const rosterData = rosterDoc.data();
                usersList = rosterData.users || [];
            } else {
                console.log(`Role roster for ${role} missing. Building from scratch.`);
                const usersSnapshot = await db.collection('users')
                    .where('role', '==', role)
                    .get();
                if (!usersSnapshot.empty) {
                    usersSnapshot.forEach(doc => {
                        const data = doc.data();
                        usersList.push({
                            uid: doc.id,
                            email: data.email,
                            name: data.fullName || 'User',
                            fcmToken: data.fcmToken || null
                        });
                    });
                    await rosterRef.set({
                        role,
                        users: usersList,
                        updatedAt: new Date().toISOString()
                    });
                }
            }
            usersList.forEach(u => {
                if (u.fcmToken) {
                    tokens.push(u.fcmToken);
                }
            });
        } else if (recipientType === 'list') {
            // "to" is a comma separated string of emails. We need to look them up.
            const emails = Array.isArray(to) ? to : to.split(',').map(e => e.trim());
            
            const promises = emails.map(email => db.collection('users').where('email', '==', email).limit(1).get());
            const snapshots = await Promise.all(promises);
            snapshots.forEach(snap => {
                if (!snap.empty) {
                    const userData = snap.docs[0].data();
                    if (userData.fcmToken) tokens.push(userData.fcmToken);
                }
            });
        } else if (recipientType === 'specific') {
            // "to" is an email
            const userSnap = await db.collection('users').where('email', '==', to).limit(1).get();
            if (!userSnap.empty) {
                const userData = userSnap.docs[0].data();
                if (userData.fcmToken) tokens.push(userData.fcmToken);
            }
        }

        if (tokens.length === 0) {
            return res.status(200).json({ 
                message: 'No registered devices found for these recipients (skipped smoothly).',
                success: 0,
                failure: 0
            });
        }

        const response = await notificationService.sendPushNotification(tokens, title, body, data, imageUrl);
        
        res.status(200).json({ 
            message: 'Notification process completed', 
            success: response.successCount, 
            failure: response.failureCount 
        });

    } catch (error) {
        console.error('Error in send-push route:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

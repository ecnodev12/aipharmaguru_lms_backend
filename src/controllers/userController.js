const admin = require('../config/firebase');
const db = admin.firestore();

/**
 * Sync User with Backend (and Roster)
 * POST /api/users/sync
 * Body: { uid, email, fullName, role, fcmToken }
 */
const syncUser = async (req, res) => {
    try {
        const { uid, email, fullName, role, fcmToken } = req.body;

        if (!uid || !email) {
            return res.status(400).json({ error: 'Missing required fields: uid, email' });
        }

        const userRole = role || 'student';
        const userRef = db.collection('users').doc(uid);

        // 1. Update/Create User Document
        const userData = {
            uid,
            email,
            fullName: fullName || 'User',
            role: userRole,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (fcmToken) {
            userData.fcmToken = fcmToken;
        }

        await userRef.set(userData, { merge: true });

        // 2. Add to Role Roster (Optimization)
        const rosterRef = db.collection('role_rosters').doc(userRole);
        const rosterUser = {
            uid,
            email,
            name: fullName || 'User',
            fcmToken: fcmToken || null
        };

        await rosterRef.set({
            role: userRole,
            users: admin.firestore.FieldValue.arrayUnion(rosterUser),
            updatedAt: new Date().toISOString()
        }, { merge: true });

        res.status(200).json({ message: 'User synced successfully' });

    } catch (error) {
        console.error('Error syncing user:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    syncUser
};

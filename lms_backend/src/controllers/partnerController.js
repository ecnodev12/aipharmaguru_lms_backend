const { db } = require('../config/firebase');

// Get all partnership applications (admin only)
const getAllApplications = async (req, res) => {
    try {
        const applicationsRef = db.collection('partner_applications');
        const snapshot = await applicationsRef.orderBy('createdAt', 'desc').get();
        
        const applications = [];
        snapshot.forEach(doc => {
            applications.push({
                id: doc.id,
                ...doc.data()
            });
        });

        res.status(200).json(applications);
    } catch (error) {
        console.error('Error fetching applications:', error);
        res.status(500).json({ error: 'Failed to fetch applications' });
    }
};

// Get single application by ID (admin only)
const getApplicationById = async (req, res) => {
    try {
        const { id } = req.params;
        const docRef = db.collection('partner_applications').doc(id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Application not found' });
        }

        res.status(200).json({
            id: doc.id,
            ...doc.data()
        });
    } catch (error) {
        console.error('Error fetching application:', error);
        res.status(500).json({ error: 'Failed to fetch application' });
    }
};

// Create new partnership application (public)
const createApplication = async (req, res) => {
    try {
        const {
            companyName,
            contactPerson,
            email,
            phone,
            partnershipType,
            country,
            website,
            message
        } = req.body;

        // Validation
        if (!companyName || !contactPerson || !email || !phone || !partnershipType) {
            return res.status(400).json({ 
                error: 'Missing required fields: companyName, contactPerson, email, phone, partnershipType' 
            });
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const applicationData = {
            companyName,
            contactPerson,
            email,
            phone,
            partnershipType,
            country: country || '',
            website: website || '',
            message: message || '',
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const docRef = await db.collection('partner_applications').add(applicationData);

        res.status(201).json({
            id: docRef.id,
            ...applicationData,
            message: 'Partnership application submitted successfully'
        });
    } catch (error) {
        console.error('Error creating application:', error);
        res.status(500).json({ error: 'Failed to submit application' });
    }
};

// Update application status (admin only)
const updateApplicationStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !['pending', 'approved', 'rejected'].includes(status)) {
            return res.status(400).json({ 
                error: 'Invalid status. Must be: pending, approved, or rejected' 
            });
        }

        const docRef = db.collection('partner_applications').doc(id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Application not found' });
        }

        await docRef.update({
            status,
            updatedAt: new Date()
        });

        res.status(200).json({
            id,
            status,
            message: 'Application status updated successfully'
        });
    } catch (error) {
        console.error('Error updating application:', error);
        res.status(500).json({ error: 'Failed to update application' });
    }
};

// Delete application (admin only)
const deleteApplication = async (req, res) => {
    try {
        const { id } = req.params;
        const docRef = db.collection('partner_applications').doc(id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Application not found' });
        }

        await docRef.delete();

        res.status(200).json({ 
            message: 'Application deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting application:', error);
        res.status(500).json({ error: 'Failed to delete application' });
    }
};

module.exports = {
    getAllApplications,
    getApplicationById,
    createApplication,
    updateApplicationStatus,
    deleteApplication
};

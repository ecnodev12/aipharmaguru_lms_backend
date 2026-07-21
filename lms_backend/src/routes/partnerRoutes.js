const express = require('express');
const router = express.Router();
const partnerController = require('../controllers/partnerController');

// Public route - Submit partnership application
router.post('/', partnerController.createApplication);

// Admin routes - Manage applications
router.get('/admin', partnerController.getAllApplications);
router.get('/admin/:id', partnerController.getApplicationById);
router.put('/admin/:id', partnerController.updateApplicationStatus);
router.delete('/admin/:id', partnerController.deleteApplication);

module.exports = router;

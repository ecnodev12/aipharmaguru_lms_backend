const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const auth = require('../middleware/authMiddleware');

// Protected Routes
router.post('/orders', auth, paymentController.createOrder);
router.post('/verify', auth, paymentController.verifyPayment);
router.post('/verify-ownership', auth, paymentController.verifyOwnership);
router.post('/failure', auth, paymentController.recordPaymentFailure);
router.get('/history', auth, paymentController.getPaymentHistory);

// Debug Route (temporary for diagnosing Firebase App Hosting secrets)
router.get('/debug-keys', paymentController.debugKeys);

module.exports = router;

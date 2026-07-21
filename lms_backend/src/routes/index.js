const express = require('express');
const router = express.Router();

const emailRoutes = require('./emailRoutes');
const notificationRoutes = require('./notificationRoutes');
const paymentRoutes = require('./paymentRoutes');
const couponRoutes = require('./couponRoutes');
const userRoutes = require('./userRoutes');
const eventRoutes = require('./eventRoutes');
const partnerRoutes = require('./partnerRoutes');
const chatbotRoutes = require('./chatbotRoutes');

router.use('/email', emailRoutes);
router.use('/notifications', notificationRoutes);
router.use('/payment', paymentRoutes);
router.use('/coupons', couponRoutes);
router.use('/users', userRoutes);
router.use('/events', eventRoutes);
router.use('/partners', partnerRoutes);
router.use('/chatbot', chatbotRoutes);

module.exports = router;

const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');

const auth = require('../middleware/authMiddleware');

// Admin routes (Protected)
router.post('/create', auth, couponController.createCoupon);
router.get('/', auth, couponController.getAllCoupons);
router.put('/:code', auth, couponController.updateCoupon);
router.delete('/:code', auth, couponController.deleteCoupon);

// User routes
router.post('/validate', couponController.validateCoupon);

module.exports = router;

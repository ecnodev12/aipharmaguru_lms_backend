const admin = require('../config/firebase');
const db = admin.firestore();

/**
 * Create a new coupon
 * @param {string} code - Coupon code
 * @param {string} type - 'percentage' or 'fixed'
 * @param {number} value - Discount value
 * @param {Date} expiryDate - Expiration date
 * @param {number} maxUses - Maximum number of uses
 */
const createCoupon = async (req, res) => {
  try {
    const { code, type, value, expiryDate, maxUses, allowedCourses } = req.body;

    // Basic validation
    if (!code || !type || !value) {
      return res.status(400).json({ error: 'Missing required code, type, or value' });
    }

    if (type === 'percentage' && (Number(value) < 0 || Number(value) > 100)) {
      return res.status(400).json({ error: 'Percentage discount value must be between 0% and 100%' });
    }

    // Standardize to Uppercase
    const upperCode = code.toUpperCase();

    const couponRef = db.collection('coupons').doc(upperCode);
    const doc = await couponRef.get();

    if (doc.exists) {
      return res.status(400).json({ error: 'Coupon code already exists' });
    }

    await couponRef.set({
      code: upperCode,
      type,
      value: Number(value),
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      maxUses: maxUses ? Number(maxUses) : null,
      usedCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true,
      allowedCourses: Array.isArray(allowedCourses) ? allowedCourses : null,
    });

    res.status(201).json({ message: 'Coupon created successfully' });
  } catch (error) {
    console.error('Error creating coupon:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * Validate a coupon
 * @param {string} code - Coupon code
 */
const validateCoupon = async (req, res) => {
  try {
    const { code, userId, courseId } = req.body;

    if (!code) {
      return res.status(200).json({ valid: false, message: 'Coupon code is required' });
    }

    // Force uppercase for consistent lookup
    const searchCode = code.toUpperCase();
    const couponRef = db.collection('coupons').doc(searchCode);
    const doc = await couponRef.get();

    if (!doc.exists) {
      return res.status(200).json({ valid: false, message: 'Invalid coupon code' });
    }

    const coupon = doc.data();

    // Check if active
    if (!coupon.isActive) {
      return res.status(400).json({ valid: false, message: 'Coupon is inactive' });
    }

    // Check expiry (if set)
    const now = new Date();
    if (coupon.expiryDate && now > coupon.expiryDate.toDate()) {
        return res.status(400).json({ valid: false, message: 'Coupon has expired' });
    }

    // Check usage limits (if set)
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      return res.status(400).json({ valid: false, message: 'Coupon usage limit reached' });
    }

    // Check course restrictions
    if (coupon.allowedCourses && Array.isArray(coupon.allowedCourses) && coupon.allowedCourses.length > 0) {
      if (!courseId) {
        return res.status(200).json({ valid: false, message: 'This coupon is not valid for this course' });
      }

      const courseIds = courseId.split(',');
      const isCourseAllowed = courseIds.some(id => coupon.allowedCourses.includes(id));
      if (!isCourseAllowed) {
        return res.status(200).json({ valid: false, message: 'This coupon is not valid for this course' });
      }
    }

    res.status(200).json({
      valid: true,
      message: 'Coupon is valid',
      discount: {
        type: coupon.type,
        value: coupon.value,
      },
    });
  } catch (error) {
    console.error('Error validating coupon:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * Get all coupons
 */
const getAllCoupons = async (req, res) => {
  try {
    const snapshot = await db.collection('coupons').orderBy('createdAt', 'desc').get();
    const coupons = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(coupons);
  } catch (error) {
    console.error('Error fetching coupons:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * Update a coupon
 * @param {string} code - Coupon code (URL param)
 */
const updateCoupon = async (req, res) => {
  try {
    const { code } = req.params;
    const { type, value, expiryDate, maxUses, isActive, allowedCourses } = req.body;

    const couponRef = db.collection('coupons').doc(code);
    const doc = await couponRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    const resolvedType = type || doc.data().type;
    const resolvedValue = value !== undefined ? Number(value) : doc.data().value;
    if (resolvedType === 'percentage' && (resolvedValue < 0 || resolvedValue > 100)) {
      return res.status(400).json({ error: 'Percentage discount value must be between 0% and 100%' });
    }

    const updates = {};
    if (type) updates.type = type;
    if (value !== undefined) updates.value = Number(value);
    // Allow null to remove expiry
    if (expiryDate !== undefined) updates.expiryDate = expiryDate ? new Date(expiryDate) : null;
    if (maxUses !== undefined) updates.maxUses = maxUses ? Number(maxUses) : null;
    if (isActive !== undefined) updates.isActive = isActive;
    if (allowedCourses !== undefined) updates.allowedCourses = Array.isArray(allowedCourses) ? allowedCourses : null;

    await couponRef.update(updates);

    res.status(200).json({ message: 'Coupon updated successfully' });
  } catch (error) {
    console.error('Error updating coupon:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * Delete a coupon
 * @param {string} code - Coupon code (URL param)
 */
const deleteCoupon = async (req, res) => {
  try {
    const { code } = req.params;
    await db.collection('coupons').doc(code).delete();
    res.status(200).json({ message: 'Coupon deleted successfully' });
  } catch (error) {
    console.error('Error deleting coupon:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = {
  createCoupon,
  getAllCoupons,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
};

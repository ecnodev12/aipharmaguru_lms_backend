const Razorpay = require('razorpay');
const crypto = require('crypto');
const config = require('../config');

// Initialize Razorpay
let razorpay;
try {
  if (config.razorpay.key_id && config.razorpay.key_secret) {
    razorpay = new Razorpay({
      key_id: config.razorpay.key_id,
      key_secret: config.razorpay.key_secret,
    });
  } else {
    console.warn('WARNING: Razorpay keys missing. Payment features will fail.');
  }
} catch (err) {
  console.error('Error initializing Razorpay:', err.message);
}

/**
 * Create a new Razorpay order
 * @param {number} amount - Amount in paise
 * @param {string} currency - Currency code
 * @param {string} receipt - Receipt ID
 * @param {object} notes - Notes (metadata)
 */
const createOrder = async (amount, currency = 'INR', receipt, notes = {}) => {
  try {
    const options = {
      amount,
      currency,
      receipt,
      notes,
    };
    
    if (!razorpay) {
      throw new Error('Razorpay not initialized (missing keys)');
    }

    const order = await razorpay.orders.create(options);
    return order;
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    throw error;
  }
};

/**
 * Fetch a payment by ID to verify details
 * @param {string} paymentId 
 */
const fetchPayment = async (paymentId) => {
    try {
        if (!razorpay) {
            throw new Error('Razorpay not initialized (missing keys)');
        }
        const payment = await razorpay.payments.fetch(paymentId);
        return payment;
    } catch (error) {
        console.error('Error fetching Razorpay payment:', error);
        throw error;
    }
};

/**
 * Verify Razorpay payment signature
 * @param {string} orderId - Razorpay Order ID
 * @param {string} paymentId - Razorpay Payment ID
 * @param {string} signature - Razorpay Signature
 */
const verifyPaymentSignature = (orderId, paymentId, signature) => {
  const generatedSignature = crypto
    .createHmac('sha256', config.razorpay.key_secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return generatedSignature === signature;
};

module.exports = {
  createOrder,
  fetchPayment,
  verifyPaymentSignature,
};

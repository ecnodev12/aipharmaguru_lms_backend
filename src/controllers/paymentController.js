const admin = require('../config/firebase');
const db = admin.firestore();
const paymentService = require('../services/paymentService');
const config = require('../config');

/**
 * Create Order with Backend Price Calculation
 */
const createOrder = async (req, res) => {
  try {
    const { courseId, couponCode, batchId } = req.body;
    const userId = req.user.uid;

    if (!courseId) {
      return res.status(400).json({ error: 'Missing courseId' });
    }

    const courseIds = typeof courseId === 'string' ? courseId.split(',') : [courseId];

    // Check if user is already enrolled in any of the courses
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData.enrolledCourses) {
            const alreadyEnrolled = courseIds.filter(id => userData.enrolledCourses.includes(id));
            if (alreadyEnrolled.length > 0) {
                return res.status(400).json({ error: `You are already enrolled in: ${alreadyEnrolled.join(', ')}` });
            }
        }
    }

    // 1. Fetch Course Prices and calculate total
    let price = 0;
    for (const id of courseIds) {
      const courseRef = db.collection('courses').doc(id);
      const courseDoc = await courseRef.get();

      if (!courseDoc.exists) {
        return res.status(404).json({ error: `Course not found: ${id}` });
      }

      const courseData = courseDoc.data();

      // Batch Validation
      if (courseData.batchEnabled && !batchId) {
        return res.status(400).json({ error: 'A batch selection is required for this course' });
      }
      if (batchId) {
        const batches = courseData.batches || [];
        const selectedBatch = batches.find(b => b.id === batchId);
        if (!selectedBatch) {
          return res.status(400).json({ error: 'Selected batch does not exist' });
        }
        if (!selectedBatch.isOpen) {
          return res.status(400).json({ error: 'Selected batch is closed for enrollment' });
        }
        if (selectedBatch.seats > 0 && selectedBatch.enrolledCount >= selectedBatch.seats) {
          return res.status(400).json({ error: 'Selected batch is full' });
        }
      }

      const isCourseFree = courseData.isFree === true || courseData.isFree === 'true';
      const coursePrice = isCourseFree ? 0 : Number(courseData.price || courseData.suggestedPrice || 0);
      price += coursePrice;
    }

    // 2. Apply Coupon (if provided)
    if (couponCode) {
      const normalizedCoupon = couponCode.toUpperCase();
      const couponRef = db.collection('coupons').doc(normalizedCoupon);
      const couponDoc = await couponRef.get();

      if (couponDoc.exists) {
        const coupon = couponDoc.data();
        const now = new Date();
        
        // Debug Log
        console.log(`Applying coupon: ${normalizedCoupon}, Type: ${coupon.type}, Value: ${coupon.value}`);

        // Check Validity (Expiry, Uses, Active)
        const isExpired = coupon.expiryDate && now > coupon.expiryDate.toDate();
        const isLimitReached = coupon.maxUses && coupon.usedCount >= coupon.maxUses;

        // Course Restriction Check (valid if at least one course in the cart is allowed)
        if (coupon.allowedCourses && Array.isArray(coupon.allowedCourses) && coupon.allowedCourses.length > 0) {
            const hasAllowedCourse = courseIds.some(id => coupon.allowedCourses.includes(id));
            if (!hasAllowedCourse) {
                return res.status(400).json({ error: 'This coupon is not valid for any course in your order' });
            }
        }

        if (coupon.isActive && !isExpired && !isLimitReached) {
            if (coupon.type === 'percentage') {
                price = price - (price * (coupon.value / 100));
            } else {
                price = price - coupon.value;
            }
            price = Math.max(0, price); // Allow price to be 0 for 100% coupon discount
            console.log(`Price after discount: ${price}`);
        } else {
            return res.status(400).json({ error: 'Coupon is expired, inactive, or usage limit reached' });
        }
      } else {
          return res.status(400).json({ error: 'Invalid coupon code' });
      }
    }

    if (price === 0) {
        const receipt = `order_${Date.now()}`;
        const transactionId = `free_coupon_${receipt}`;
        
        const batch = db.batch();
        
        // Enroll User
        const userRef = db.collection('users').doc(userId);
        const userSnap = await userRef.get();
        const userData = userSnap.exists ? userSnap.data() : {};

        const enrolledAt = new Date();
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 6);

        // Add all courses to user's enrolledCourses list
        batch.update(userRef, {
            enrolledCourses: admin.firestore.FieldValue.arrayUnion(...courseIds)
        });

        // Add meta for each course, update rosters, and increment studentsCount
        for (const cId of courseIds) {
            const courseDocRef = db.collection('courses').doc(cId);
            const courseDoc = await courseDocRef.get();
            let selectedBatch = null;
            if (courseDoc.exists) {
                const courseData = courseDoc.data();
                const batches = courseData.batches || [];
                const updatedBatches = batches.map(b => {
                    if (b.id === batchId) {
                        selectedBatch = b;
                        return {
                            ...b,
                            enrolledCount: (b.enrolledCount || 0) + 1
                        };
                    }
                    return b;
                });
                if (selectedBatch) {
                    batch.update(courseDocRef, { batches: updatedBatches });
                }
            }

            const metaUpdate = {
                [`enrollmentMeta.${cId}.enrolledAt`]: enrolledAt.toISOString(),
                [`enrollmentMeta.${cId}.expiresAt`]: expiresAt.toISOString()
            };
            if (selectedBatch) {
                metaUpdate[`enrollmentMeta.${cId}.batchId`] = selectedBatch.id;
                metaUpdate[`enrollmentMeta.${cId}.batchName`] = selectedBatch.name;
                metaUpdate[`enrollmentMeta.${cId}.batchStartDate`] = selectedBatch.startDate;
                metaUpdate[`enrollmentMeta.${cId}.batchEndDate`] = selectedBatch.endDate;
            }
            batch.update(userRef, metaUpdate);

            // Update Course Roster (Optimization)
            const rosterRef = db.collection('course_rosters').doc(cId);
            const studentData = {
                uid: userId,
                email: userData.email || '',
                name: userData.fullName || 'Student',
                fcmToken: userData.fcmToken || null
            };
            
            batch.set(rosterRef, {
                courseId: cId,
                students: admin.firestore.FieldValue.arrayUnion(studentData)
            }, { merge: true });

            // Increment student count on the course document
            batch.update(courseDocRef, {
                studentsCount: admin.firestore.FieldValue.increment(1)
            });
        }

        // Increment Coupon Usage
        if (couponCode) {
            const normalizedCoupon = couponCode.toUpperCase();
            const couponRef = db.collection('coupons').doc(normalizedCoupon);
            batch.update(couponRef, {
                usedCount: admin.firestore.FieldValue.increment(1)
            });
        }

        // Log successful Transaction in Firestore
        const transactionRef = db.collection('transactions').doc(receipt);
        batch.set(transactionRef, {
            userId,
            courseId: courseIds.join(','),
            orderId: receipt,
            paymentId: transactionId,
            signature: 'free_coupon_signature_bypass',
            amount: 0,
            currency: 'INR',
            status: 'success',
            couponCode: couponCode || null,
            batchId: batchId || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            receipt
        });

        await batch.commit();

        return res.status(200).json({
            isFree: true,
            amount: 0,
            currency: 'INR',
            orderId: receipt,
            paymentId: transactionId,
            status: 'success'
        });
    }

    const amountInPaise = Math.round(price * 100);
    const receipt = `order_${Date.now()}`;

    // 3. Create Razorpay Order with Metadata
    const order = await paymentService.createOrder(amountInPaise, 'INR', receipt, {
      courseId: courseIds.join(','),
      userId,
      couponCode: couponCode || '',
      batchId: batchId || '',
    });

    // 4. Log Transaction (Pending)
    await db.collection('transactions').doc(order.id).set({
        userId,
        courseId: courseIds.join(','),
        orderId: order.id,
        amount: price,
        currency: 'INR',
        status: 'pending',
        couponCode: couponCode || null,
        batchId: batchId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        receipt
    });

    res.status(200).json({
      ...order,
      key_id: config.razorpay.key_id, // Send key_id to frontend
    });

  } catch (error) {
    console.error('Error in createOrder:', error);
    // Razorpay errors typically live inside error.error.description
    const errorMessage = error.error?.description || error.message || (typeof error === 'string' ? error : 'Payment system error');
    res.status(500).json({ error: errorMessage });
  }
};

/**
 * Verify Payment and Enroll User
 */
const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    // 1. Verify Signature
    const isSignatureValid = paymentService.verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isSignatureValid) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // 2. Fetch Payment to Verify Amount & Status
    const payment = await paymentService.fetchPayment(razorpay_payment_id);

    if (payment.status !== 'captured') {
        return res.status(400).json({ error: 'Payment not captured' });
    }
    
    // 3. Enroll User (using Metadata from Order)
    const { courseId, userId, couponCode, batchId } = payment.notes;

    if (courseId && userId) {
        const batch = db.batch();
        const courseIds = courseId.split(',');
        
        // Enroll User
        const userRef = db.collection('users').doc(userId);
        // We need user data for the roster
        const userSnap = await userRef.get();
        const userData = userSnap.exists ? userSnap.data() : {};

        const enrolledAt = new Date();
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 6);

        // Add all courses to user's enrolledCourses list
        batch.update(userRef, {
            enrolledCourses: admin.firestore.FieldValue.arrayUnion(...courseIds)
        });

        // Add meta for each course, update rosters, and increment studentsCount
        for (const cId of courseIds) {
            const courseDocRef = db.collection('courses').doc(cId);
            const courseDoc = await courseDocRef.get();
            let selectedBatch = null;
            if (courseDoc.exists) {
                const courseData = courseDoc.data();
                const batches = courseData.batches || [];
                const updatedBatches = batches.map(b => {
                    if (b.id === batchId) {
                        selectedBatch = b;
                        return {
                            ...b,
                            enrolledCount: (b.enrolledCount || 0) + 1
                        };
                    }
                    return b;
                });
                if (selectedBatch) {
                    batch.update(courseDocRef, { batches: updatedBatches });
                }
            }

            const metaUpdate = {
                [`enrollmentMeta.${cId}.enrolledAt`]: enrolledAt.toISOString(),
                [`enrollmentMeta.${cId}.expiresAt`]: expiresAt.toISOString()
            };
            if (selectedBatch) {
                metaUpdate[`enrollmentMeta.${cId}.batchId`] = selectedBatch.id;
                metaUpdate[`enrollmentMeta.${cId}.batchName`] = selectedBatch.name;
                metaUpdate[`enrollmentMeta.${cId}.batchStartDate`] = selectedBatch.startDate;
                metaUpdate[`enrollmentMeta.${cId}.batchEndDate`] = selectedBatch.endDate;
            }
            batch.update(userRef, metaUpdate);

            // Update Course Roster (Optimization)
            const rosterRef = db.collection('course_rosters').doc(cId);
            const studentData = {
                uid: userId,
                email: userData.email || '',
                name: userData.fullName || 'Student',
                fcmToken: userData.fcmToken || null
            };
            
            batch.set(rosterRef, {
                courseId: cId,
                students: admin.firestore.FieldValue.arrayUnion(studentData)
            }, { merge: true });

            // Increment student count on the course document
            batch.update(courseDocRef, {
                studentsCount: admin.firestore.FieldValue.increment(1)
            });
        }

        // Increment Coupon Usage (if used)
        if (couponCode) {
            const couponRef = db.collection('coupons').doc(couponCode);
            const couponDoc = await couponRef.get();
            if (couponDoc.exists) {
                const coupon = couponDoc.data();
                // Course Restriction Check (valid if at least one course was allowed)
                if (coupon.allowedCourses && Array.isArray(coupon.allowedCourses) && coupon.allowedCourses.length > 0) {
                    const hasAllowedCourse = courseIds.some(cId => coupon.allowedCourses.includes(cId));
                    if (!hasAllowedCourse) {
                        return res.status(400).json({ error: 'Payment verification failed: Coupon not valid for this course' });
                    }
                }
            }
            batch.update(couponRef, {
                usedCount: admin.firestore.FieldValue.increment(1)
            });
        }

        // Update Transaction Status
        const transactionRef = db.collection('transactions').doc(razorpay_order_id);
        const transUpdate = {
            status: 'success',
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
            verifiedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        if (batchId) {
            transUpdate.batchId = batchId;
        }
        batch.update(transactionRef, transUpdate);

        // INCREMENT TOTAL REVENUE (Stats)
        const statsRef = db.collection('stats').doc('finance');
        batch.set(statsRef, {
            totalRevenue: admin.firestore.FieldValue.increment(payment.amount / 100) // Razorpay amount is in paise
        }, { merge: true });

        await batch.commit();
        return res.status(200).json({ status: 'success', message: 'Payment verified and user enrolled' });
    } 

    res.status(200).json({ status: 'success', message: 'Payment verified (No enrollment data found)' });

  } catch (error) {
    console.error('Error in verifyPayment:', error);
    res.status(500).json({ error: error.message });
  }
};



/**
 * Get Payment History for User
 */
const getPaymentHistory = async (req, res) => {
    try {
        const userId = req.user.uid;
        
        const snapshot = await db.collection('transactions')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .get();

        const transactions = [];
        // Fetch course names efficiently? Or just return IDs.
        // Let's return IDs and let frontend fetch or we can map if we have a cache.
        // For now, let's fetch course details here to make frontend easier, or just return basic info.
        // Frontend likely has course list or can fetch details. Returning full list is safer.
        
        // To show course name, we might need to fetch course data.
        // Let's do a set of promises if not too many, or just return ID.
        // User wants "Course Name" in history.
        
        const courseIds = new Set();
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            transactions.push({ id: doc.id, ...data });
            if (data.courseId) courseIds.add(data.courseId);
        });

        // Fetch course details
        const courseMap = {};
        if (courseIds.size > 0) {
            const courseRefs = [...courseIds].map(id => db.collection('courses').doc(id));
            const courseSnaps = await db.getAll(...courseRefs);
            courseSnaps.forEach(snap => {
                if (snap.exists) {
                    courseMap[snap.id] = snap.data().title;
                }
            });
        }

        const history = transactions.map(t => ({
            ...t,
            courseName: courseMap[t.courseId] || 'Unknown Course'
        }));

        res.status(200).json(history);

    } catch (error) {
        console.error('Error in getPaymentHistory:', error);
        res.status(500).json({ error: error.message });
    }
};

const debugKeys = (req, res) => {
    const keyId = config.razorpay.key_id;
    const keySecret = config.razorpay.key_secret;
    res.status(200).json({
        hasKeyId: !!keyId,
        keyIdPrefix: keyId ? keyId.substring(0, 6) : 'missing',
        keyIdLength: keyId ? keyId.length : 0,
        hasKeySecret: !!keySecret,
        keySecretPrefix: keySecret ? keySecret.substring(0, 4) : 'none',
        keySecretLength: keySecret ? keySecret.length : 0,
        envNode: process.env.NODE_ENV,
        note: "Keys have been stripped of quotes and trailing whitespace for robustness."
    });
};

/**
 * Verify Course Ownership
 */
const verifyOwnership = async (req, res) => {
  try {
    const { courseId } = req.body;
    const userId = req.user.uid;

    if (!courseId) {
      return res.status(400).json({ error: 'Course ID is required' });
    }

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userSnap.data();
    const role = userData.role || 'student';
    
    // Admins, Instructors, and Trainers always have access
    if (role === 'admin' || role === 'instructor' || role === 'trainer') {
      return res.status(200).json({ valid: true, message: 'Admin/Instructor access' });
    }

    // Check if course is in user's enrolledCourses list
    if (!userData.enrolledCourses || !userData.enrolledCourses.includes(courseId)) {
      return res.status(403).json({ valid: false, message: 'User is not enrolled in this course' });
    }

    // Check if course is free
    const courseRef = db.collection('courses').doc(courseId);
    const courseDoc = await courseRef.get();
    if (courseDoc.exists) {
      const courseData = courseDoc.data();
      if (courseData.isFree === true || courseData.isFree === 'true' || Number(courseData.price || courseData.suggestedPrice || 0) === 0) {
        return res.status(200).json({ valid: true, message: 'Free course access granted' });
      }
    }

    // 1. Verify payment transactions in Firestore
    const transactionsSnapshot = await db.collection('transactions')
      .where('userId', '==', userId)
      .where('status', '==', 'success')
      .get();

    const isPurchased = transactionsSnapshot.docs.some(doc => {
      const data = doc.data();
      const courseIds = data.courseId ? data.courseId.split(',') : [];
      return courseIds.includes(courseId);
    });

    if (isPurchased) {
      return res.status(200).json({ valid: true, message: 'Valid payment transaction found' });
    }

    // 2. Check for manual enrollment flags on the user metadata
    const enrollmentMeta = userData.enrollmentMeta || {};
    const meta = enrollmentMeta[courseId];
    if (meta && (meta.enrolledByAdmin || meta.manualEnrollment || meta.byAdmin || meta.enrolledAt)) {
      return res.status(200).json({ valid: true, message: 'Enrolled via admin / lifetime metadata' });
    }

    // 3. Fallback: Check if they are in the course roster
    const rosterRef = db.collection('course_rosters').doc(courseId);
    const rosterSnap = await rosterRef.get();
    if (rosterSnap.exists) {
      const rosterData = rosterSnap.data();
      const students = rosterData.students || [];
      const isRestored = students.some(s => s.uid === userId);
      if (isRestored) {
        return res.status(200).json({ valid: true, message: 'Enrolled via course roster' });
      }
    }

    return res.status(403).json({ valid: false, message: 'No valid purchase or manual enrollment records found' });
  } catch (error) {
    console.error('Error in verifyOwnership:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createOrder,
  verifyPayment,
  getPaymentHistory,
  debugKeys,
  verifyOwnership
};

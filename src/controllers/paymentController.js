const admin = require('../config/firebase');
const db = admin.firestore();
const paymentService = require('../services/paymentService');
const config = require('../config');

/**
 * Robust helper to determine if a course is free based on all potential flags/fields
 * Handles:
 * - courseData.isFree === true || 'true'
 * - courseData.publishedVersion.isFree === true || 'true'
 * - courseData.price === 0 || '0'
 * - courseData.publishedVersion.price === 0 || '0'
 */
const checkIsCourseFree = (courseData) => {
  if (!courseData) return false;
  if (courseData.isFree === true || courseData.isFree === 'true') return true;
  if (courseData.publishedVersion && (courseData.publishedVersion.isFree === true || courseData.publishedVersion.isFree === 'true')) return true;

  const rootPrice = courseData.price !== undefined && courseData.price !== null && courseData.price !== '' ? Number(courseData.price) : null;
  const pubPrice = courseData.publishedVersion?.price !== undefined && courseData.publishedVersion?.price !== null && courseData.publishedVersion?.price !== '' 
    ? Number(courseData.publishedVersion.price) 
    : null;

  if (rootPrice === 0 || pubPrice === 0) return true;
  return false;
};

/**
 * Helper to check if a specific user was granted free/bulk enrollment by owner/admin
 * Checks:
 * 1. `enrollments` collection by doc `${userId}_${courseId}`
 * 2. `enrollments` collection query by userId
 * 3. `enrollments` collection query by studentEmail
 * 4. `pending_enrollments` collection query by studentEmail
 * 5. `bulk_enrollments` collection query by studentEmail
 * 6. `userData.enrollmentMeta[courseId]`
 */
const checkUserFreeGrant = async (userId, userEmail, courseId, userData = null) => {
  try {
    const normalizedEmail = (userEmail || '').toLowerCase().trim();

    // 1. Check userData.enrollmentMeta
    if (userData && userData.enrollmentMeta && userData.enrollmentMeta[courseId]) {
      const meta = userData.enrollmentMeta[courseId];
      if (meta.isFreeAccess === true || meta.enrolledByAdmin || meta.manualEnrollment || meta.byAdmin) {
        return { hasGrant: true, type: 'user_meta', data: meta };
      }
    }

    // 2. Check `enrollments` collection by specific docId
    const specificRef = db.collection('enrollments').doc(`${userId}_${courseId}`);
    const specificSnap = await specificRef.get();
    if (specificSnap.exists) {
      const data = specificSnap.data();
      if (data.isFreeAccess === true || data.grantedBy === 'admin' || data.grantedBy === 'owner' || data.isFree === true) {
        return { hasGrant: true, type: 'enrollments_doc', data, ref: specificRef };
      }
    }

    // 3. Check `enrollments` collection by userId query
    const enrollQuery = await db.collection('enrollments')
      .where('userId', '==', userId)
      .where('courseId', '==', courseId)
      .limit(1)
      .get();
    if (!enrollQuery.empty) {
      const data = enrollQuery.docs[0].data();
      if (data.isFreeAccess === true || data.grantedBy === 'admin' || data.grantedBy === 'owner' || data.isFree === true) {
        return { hasGrant: true, type: 'enrollments_query', data, ref: enrollQuery.docs[0].ref };
      }
    }

    // 4. Check email-based collections if email is available
    if (normalizedEmail) {
      const emailEnrollQuery = await db.collection('enrollments')
        .where('studentEmail', '==', normalizedEmail)
        .where('courseId', '==', courseId)
        .limit(1)
        .get();
      if (!emailEnrollQuery.empty) {
        const data = emailEnrollQuery.docs[0].data();
        return { hasGrant: true, type: 'enrollments_email', data, ref: emailEnrollQuery.docs[0].ref };
      }

      // 5. Check `pending_enrollments`
      const pendingQuery = await db.collection('pending_enrollments')
        .where('studentEmail', '==', normalizedEmail)
        .where('courseId', '==', courseId)
        .limit(1)
        .get();
      if (!pendingQuery.empty) {
        return { hasGrant: true, type: 'pending_enrollments', data: pendingQuery.docs[0].data(), ref: pendingQuery.docs[0].ref };
      }

      // 6. Check `bulk_enrollments` audit log
      const bulkQuery = await db.collection('bulk_enrollments')
        .where('studentEmail', '==', normalizedEmail)
        .where('courseId', '==', courseId)
        .limit(1)
        .get();
      if (!bulkQuery.empty) {
        return { hasGrant: true, type: 'bulk_enrollments', data: bulkQuery.docs[0].data(), ref: bulkQuery.docs[0].ref };
      }
    }

    return { hasGrant: false };
  } catch (err) {
    console.error('Error checking user free grant:', err);
    return { hasGrant: false };
  }
};

/**
 * Create Order with Backend Price Calculation & Free Course / Bulk Grant Bypass
 */
const createOrder = async (req, res) => {
  try {
    const { courseId, couponCode, batchId } = req.body;
    const userId = req.user.uid;

    if (!courseId) {
      return res.status(400).json({ error: 'Missing courseId' });
    }

    const courseIds = typeof courseId === 'string' 
      ? courseId.split(',').map(s => s.trim()).filter(Boolean) 
      : (Array.isArray(courseId) ? courseId : [courseId]);

    if (courseIds.length === 0) {
      return res.status(400).json({ error: 'At least one courseId is required' });
    }

    // Fetch user details
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const userEmail = (userData.email || req.user.email || '').toLowerCase().trim();
    const userName = userData.fullName || req.user.name || 'Student';

    // Check if user is already enrolled in any or all courses
    const userEnrolledList = Array.isArray(userData.enrolledCourses) ? userData.enrolledCourses : [];
    
    // Check both enrolledCourses array and active documents in `enrollments` collection
    const alreadyEnrolledCourses = [];
    for (const id of courseIds) {
      if (userEnrolledList.includes(id)) {
        alreadyEnrolledCourses.push(id);
      } else {
        const enrollDoc = await db.collection('enrollments').doc(`${userId}_${id}`).get();
        if (enrollDoc.exists) {
          alreadyEnrolledCourses.push(id);
        }
      }
    }

    if (alreadyEnrolledCourses.length === courseIds.length) {
      return res.status(400).json({ 
        error: `You are already enrolled in: ${alreadyEnrolledCourses.join(', ')}` 
      });
    }

    // 1. Fetch Course Prices and calculate total, taking into account Free courses and Owner Free Grants
    let price = 0;
    const coursesDataMap = {};
    const freeGrantMap = {};

    for (const id of courseIds) {
      const courseDocRef = db.collection('courses').doc(id);
      const courseDoc = await courseDocRef.get();

      if (!courseDoc.exists) {
        return res.status(404).json({ error: `Course not found: ${id}` });
      }

      const courseData = courseDoc.data();
      coursesDataMap[id] = courseData;

      // Batch Validation
      if (courseData.batchEnabled && !batchId) {
        return res.status(400).json({ error: `A batch selection is required for course: ${courseData.title || id}` });
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

      // Check if course itself is marked free
      const isCourseFree = checkIsCourseFree(courseData);
      
      // Check if this student was granted free access by owner/admin via bulk enrollment or pending upload
      const userGrant = await checkUserFreeGrant(userId, userEmail, id, userData);
      freeGrantMap[id] = userGrant;

      if (isCourseFree || userGrant.hasGrant) {
        // Course is completely free for this student
        price += 0;
      } else {
        const coursePrice = Number(courseData.price || courseData.suggestedPrice || 0);
        price += Math.max(0, coursePrice);
      }
    }

    // 2. Apply Coupon (if provided and price > 0)
    if (couponCode && price > 0) {
      const normalizedCoupon = couponCode.toUpperCase().trim();
      const couponRef = db.collection('coupons').doc(normalizedCoupon);
      const couponDoc = await couponRef.get();

      if (couponDoc.exists) {
        const coupon = couponDoc.data();
        const now = new Date();

        console.log(`Applying coupon: ${normalizedCoupon}, Type: ${coupon.type}, Value: ${coupon.value}`);

        const isExpired = coupon.expiryDate && now > coupon.expiryDate.toDate();
        const isLimitReached = coupon.maxUses && coupon.usedCount >= coupon.maxUses;

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
          price = Math.max(0, price);
          console.log(`Price after discount: ${price}`);
        } else {
          return res.status(400).json({ error: 'Coupon is expired, inactive, or usage limit reached' });
        }
      } else {
        return res.status(400).json({ error: 'Invalid coupon code' });
      }
    }

    // 3. If Price is 0 (Free Course, Owner Bulk Grant, or 100% Discount Coupon)
    if (price === 0) {
      const receipt = `order_${Date.now()}`;
      const transactionId = `free_enrollment_${receipt}`;
      const batch = db.batch();

      const enrolledAt = new Date();
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 6);

      // Add all courses to user's enrolledCourses list
      batch.set(userRef, {
        enrolledCourses: admin.firestore.FieldValue.arrayUnion(...courseIds),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      for (const cId of courseIds) {
        const courseData = coursesDataMap[cId] || {};
        const courseDocRef = db.collection('courses').doc(cId);
        const userGrant = freeGrantMap[cId] || { hasGrant: false };

        let selectedBatch = null;
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

        const courseUpdates = {
          studentsCount: admin.firestore.FieldValue.increment(1),
          enrolledCount: admin.firestore.FieldValue.increment(1)
        };
        if (selectedBatch) {
          courseUpdates.batches = updatedBatches;
        }
        batch.update(courseDocRef, courseUpdates);

        // Update enrollmentMeta on user
        const grantSource = userGrant.hasGrant 
          ? (userGrant.type === 'pending_enrollments' ? 'bulk_owner_upload' : 'admin_bulk_grant')
          : (couponCode ? `coupon:${couponCode.toUpperCase()}` : 'free_course');

        const metaUpdate = {
          [`enrollmentMeta.${cId}.enrolledAt`]: enrolledAt.toISOString(),
          [`enrollmentMeta.${cId}.expiresAt`]: expiresAt.toISOString(),
          [`enrollmentMeta.${cId}.isFreeAccess`]: true,
          [`enrollmentMeta.${cId}.grantedBy`]: grantSource,
          [`enrollmentMeta.${cId}.manualEnrollment`]: true
        };
        if (selectedBatch) {
          metaUpdate[`enrollmentMeta.${cId}.batchId`] = selectedBatch.id;
          metaUpdate[`enrollmentMeta.${cId}.batchName`] = selectedBatch.name;
          metaUpdate[`enrollmentMeta.${cId}.batchStartDate`] = selectedBatch.startDate;
          metaUpdate[`enrollmentMeta.${cId}.batchEndDate`] = selectedBatch.endDate;
        }
        batch.update(userRef, metaUpdate);

        // Update / create document in `enrollments` collection for unified consistency
        const enrollmentRef = db.collection('enrollments').doc(`${userId}_${cId}`);
        batch.set(enrollmentRef, {
          userId,
          courseId: cId,
          courseTitle: courseData.title || '',
          instructorName: courseData.instructorName || '',
          enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
          progress: 0,
          completedLectures: [],
          isFreeAccess: true,
          grantedBy: grantSource,
          studentName: userName,
          studentEmail: userEmail,
          collegeName: userData.collegeName || ''
        }, { merge: true });

        // Update Course Roster
        const rosterRef = db.collection('course_rosters').doc(cId);
        const studentData = {
          uid: userId,
          email: userEmail,
          name: userName,
          fcmToken: userData.fcmToken || null
        };
        batch.set(rosterRef, {
          courseId: cId,
          students: admin.firestore.FieldValue.arrayUnion(studentData)
        }, { merge: true });

        // If user was in pending_enrollments, mark as completed
        if (userEmail) {
          const pendingSnap = await db.collection('pending_enrollments')
            .where('studentEmail', '==', userEmail)
            .where('courseId', '==', cId)
            .where('status', '==', 'pending')
            .get();
          pendingSnap.forEach(pDoc => {
            batch.update(pDoc.ref, {
              status: 'completed',
              userId,
              completedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          });
        }
      }

      // Increment Coupon Usage (if coupon was used)
      if (couponCode) {
        const normalizedCoupon = couponCode.toUpperCase().trim();
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
        signature: 'free_enrollment_bypass',
        amount: 0,
        currency: 'INR',
        status: 'success',
        isFree: true,
        couponCode: couponCode || null,
        batchId: batchId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        receipt,
        enrollmentType: couponCode ? 'coupon' : 'free_enrollment'
      });

      await batch.commit();

      return res.status(200).json({
        isFree: true,
        amount: 0,
        currency: 'INR',
        orderId: receipt,
        paymentId: transactionId,
        status: 'success',
        message: 'Enrollment successful! Free access granted.'
      });
    }

    // 4. Paid Course - Create Razorpay Order
    const amountInPaise = Math.round(price * 100);
    const receipt = `order_${Date.now()}`;

    const order = await paymentService.createOrder(amountInPaise, 'INR', receipt, {
      courseId: courseIds.join(','),
      userId,
      couponCode: couponCode || '',
      batchId: batchId || '',
    });

    // Log Transaction (Pending)
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
      key_id: config.razorpay.key_id,
    });

  } catch (error) {
    console.error('Error in createOrder:', error);
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
      const courseIds = courseId.split(',').map(s => s.trim()).filter(Boolean);
      
      const userRef = db.collection('users').doc(userId);
      const userSnap = await userRef.get();
      const userData = userSnap.exists ? userSnap.data() : {};
      const userEmail = (userData.email || '').toLowerCase().trim();
      const userName = userData.fullName || 'Student';

      const enrolledAt = new Date();
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 6);

      // Add all courses to user's enrolledCourses list
      batch.update(userRef, {
        enrolledCourses: admin.firestore.FieldValue.arrayUnion(...courseIds),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Add meta for each course, update rosters, update enrollments collection, and increment counts
      for (const cId of courseIds) {
        const courseDocRef = db.collection('courses').doc(cId);
        const courseDoc = await courseDocRef.get();
        let selectedBatch = null;
        let courseTitle = '';
        let instructorName = '';

        if (courseDoc.exists) {
          const courseData = courseDoc.data();
          courseTitle = courseData.title || '';
          instructorName = courseData.instructorName || '';
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
          
          const courseUpdates = {
            studentsCount: admin.firestore.FieldValue.increment(1),
            enrolledCount: admin.firestore.FieldValue.increment(1)
          };
          if (selectedBatch) {
            courseUpdates.batches = updatedBatches;
          }
          batch.update(courseDocRef, courseUpdates);
        }

        const metaUpdate = {
          [`enrollmentMeta.${cId}.enrolledAt`]: enrolledAt.toISOString(),
          [`enrollmentMeta.${cId}.expiresAt`]: expiresAt.toISOString(),
          [`enrollmentMeta.${cId}.isFreeAccess`]: false,
          [`enrollmentMeta.${cId}.grantedBy`]: 'purchase'
        };
        if (selectedBatch) {
          metaUpdate[`enrollmentMeta.${cId}.batchId`] = selectedBatch.id;
          metaUpdate[`enrollmentMeta.${cId}.batchName`] = selectedBatch.name;
          metaUpdate[`enrollmentMeta.${cId}.batchStartDate`] = selectedBatch.startDate;
          metaUpdate[`enrollmentMeta.${cId}.batchEndDate`] = selectedBatch.endDate;
        }
        batch.update(userRef, metaUpdate);

        // Update Course Roster
        const rosterRef = db.collection('course_rosters').doc(cId);
        const studentData = {
          uid: userId,
          email: userEmail,
          name: userName,
          fcmToken: userData.fcmToken || null
        };
        batch.set(rosterRef, {
          courseId: cId,
          students: admin.firestore.FieldValue.arrayUnion(studentData)
        }, { merge: true });

        // Update `enrollments` collection
        const enrollmentRef = db.collection('enrollments').doc(`${userId}_${cId}`);
        batch.set(enrollmentRef, {
          userId,
          courseId: cId,
          courseTitle,
          instructorName,
          enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
          progress: 0,
          completedLectures: [],
          isFreeAccess: false,
          grantedBy: 'purchase',
          studentName: userName,
          studentEmail: userEmail,
          collegeName: userData.collegeName || ''
        }, { merge: true });

        // If user was previously in pending_enrollments, complete it
        if (userEmail) {
          const pendingSnap = await db.collection('pending_enrollments')
            .where('studentEmail', '==', userEmail)
            .where('courseId', '==', cId)
            .where('status', '==', 'pending')
            .get();
          pendingSnap.forEach(pDoc => {
            batch.update(pDoc.ref, {
              status: 'completed',
              userId,
              completedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          });
        }
      }

      // Increment Coupon Usage (if used)
      if (couponCode) {
        const couponRef = db.collection('coupons').doc(couponCode.toUpperCase().trim());
        const couponDoc = await couponRef.get();
        if (couponDoc.exists) {
          batch.update(couponRef, {
            usedCount: admin.firestore.FieldValue.increment(1)
          });
        }
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
        totalRevenue: admin.firestore.FieldValue.increment(payment.amount / 100)
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
 * Get Payment History for User (including free bulk grants)
 */
const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = (req.user.email || '').toLowerCase().trim();
    
    const snapshot = await db.collection('transactions')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const transactions = [];
    const courseIds = new Set();
    const recordedCourseIds = new Set();

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      transactions.push({ id: doc.id, ...data });
      if (data.courseId) {
        const ids = data.courseId.split(',').map(s => s.trim());
        ids.forEach(id => {
          courseIds.add(id);
          recordedCourseIds.add(id);
        });
      }
    });

    // Also check `enrollments` collection for any free / bulk grants without a transactions entry
    const enrollmentsSnap = await db.collection('enrollments')
      .where('userId', '==', userId)
      .get();

    enrollmentsSnap.docs.forEach(doc => {
      const data = doc.data();
      if (data.courseId && !recordedCourseIds.has(data.courseId)) {
        recordedCourseIds.add(data.courseId);
        courseIds.add(data.courseId);
        transactions.push({
          id: `grant_${doc.id}`,
          userId,
          courseId: data.courseId,
          orderId: `free_grant_${data.courseId}`,
          amount: 0,
          currency: 'INR',
          status: 'success',
          isFree: true,
          grantedBy: data.grantedBy || 'admin',
          createdAt: data.enrolledAt || new Date().toISOString(),
          receipt: `free_grant_${data.courseId}`
        });
      }
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

    const history = transactions.map(t => {
      let displayName = 'Unknown Course';
      if (t.courseId) {
        const ids = t.courseId.split(',').map(s => s.trim());
        const titles = ids.map(id => courseMap[id] || id);
        displayName = titles.join(', ');
      }
      return {
        ...t,
        courseName: displayName
      };
    });

    res.status(200).json(history);

  } catch (error) {
    console.error('Error in getPaymentHistory:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Debug Keys Route
 */
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
 * Verify Course Ownership & Access While Playing Courses
 * Called by CourseViewer.tsx: POST /api/payment/verify-ownership
 * 
 * Verifies if the authenticated student has valid ownership/access to play the course:
 * - Admin, Instructor, Trainer roles
 * - Course creator / owner / co-instructor
 * - Course is globally marked FREE (isFree: true or price: 0)
 * - User was enrolled via Admin Bulk Enrollment (`enrollments` or `bulk_enrollments`)
 * - User has pending enrollment uploaded by owner (`pending_enrollments`)
 * - User has valid successful purchase transaction (`transactions`)
 * - User has valid manual enrollment flags in `enrollmentMeta`
 * - User is enrolled in `course_rosters`
 * - User is in `enrolledCourses` array
 * 
 * In addition to verification, it AUTO-HEALS any desynchronized records (enrolledCourses,
 * enrollmentMeta, enrollments doc, course_rosters) to ensure seamless instant playback.
 */
const verifyOwnership = async (req, res) => {
  try {
    const { courseId } = req.body;
    const userId = req.user.uid;
    const userEmail = (req.user.email || '').toLowerCase().trim();

    if (!courseId) {
      return res.status(400).json({ error: 'Course ID is required' });
    }

    // 1. Fetch user doc
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    let userData = userSnap.exists ? userSnap.data() : {};
    const email = (userData.email || userEmail).toLowerCase().trim();
    const role = (userData.role || 'student').trim().toLowerCase();
    const userName = userData.fullName || req.user.name || 'Student';

    // 2. Fetch course doc
    const courseRef = db.collection('courses').doc(courseId);
    const courseDoc = await courseRef.get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const courseData = courseDoc.data();

    // 3. Admins, Instructors, and Trainers always have full playback access
    if (role === 'admin' || role === 'instructor' || role === 'trainer') {
      return res.status(200).json({ valid: true, message: 'Admin/Instructor access' });
    }

    // 4. Course Owner / Instructor / Co-Instructor check
    const isCourseOwner = courseData.instructorId === userId || 
                          courseData.userId === userId ||
                          (email && courseData.instructorEmail && courseData.instructorEmail.toLowerCase() === email) ||
                          (Array.isArray(courseData.coInstructors) && courseData.coInstructors.includes(userId));
    if (isCourseOwner) {
      return res.status(200).json({ valid: true, message: 'Course instructor/owner access' });
    }

    // 5. Check if course is marked FREE
    const isGloballyFree = checkIsCourseFree(courseData);

    // 6. Check user document enrolledCourses array
    const userEnrolledList = Array.isArray(userData.enrolledCourses) ? userData.enrolledCourses : [];
    const isEnrolledInUserDoc = userEnrolledList.includes(courseId);

    // 7. Check `enrollments` collection
    let hasEnrollmentDoc = false;
    let enrollmentDocData = null;

    const specificEnrollRef = db.collection('enrollments').doc(`${userId}_${courseId}`);
    const specificEnrollSnap = await specificEnrollRef.get();
    if (specificEnrollSnap.exists) {
      hasEnrollmentDoc = true;
      enrollmentDocData = specificEnrollSnap.data();
    } else {
      const enrollQuery = await db.collection('enrollments')
        .where('userId', '==', userId)
        .where('courseId', '==', courseId)
        .limit(1)
        .get();
      if (!enrollQuery.empty) {
        hasEnrollmentDoc = true;
        enrollmentDocData = enrollQuery.docs[0].data();
      } else if (email) {
        const emailEnrollQuery = await db.collection('enrollments')
          .where('studentEmail', '==', email)
          .where('courseId', '==', courseId)
          .limit(1)
          .get();
        if (!emailEnrollQuery.empty) {
          hasEnrollmentDoc = true;
          enrollmentDocData = emailEnrollQuery.docs[0].data();
        }
      }
    }

    // 8. Check `pending_enrollments` collection (owner uploaded before user completed signup/login)
    let hasPendingEnrollment = false;
    let pendingDocRef = null;
    let pendingDocData = null;
    if (email) {
      const pendingQuery = await db.collection('pending_enrollments')
        .where('studentEmail', '==', email)
        .where('courseId', '==', courseId)
        .limit(1)
        .get();
      if (!pendingQuery.empty) {
        hasPendingEnrollment = true;
        pendingDocRef = pendingQuery.docs[0].ref;
        pendingDocData = pendingQuery.docs[0].data();
      }
    }

    // 9. Check `bulk_enrollments` collection (audit record of owner bulk upload)
    let hasBulkEnrollment = false;
    let bulkDocData = null;
    if (email) {
      const bulkQuery = await db.collection('bulk_enrollments')
        .where('studentEmail', '==', email)
        .where('courseId', '==', courseId)
        .limit(1)
        .get();
      if (!bulkQuery.empty) {
        hasBulkEnrollment = true;
        bulkDocData = bulkQuery.docs[0].data();
      }
    }

    // 10. Check `transactions` collection for successful payment/free order
    const transactionsSnapshot = await db.collection('transactions')
      .where('userId', '==', userId)
      .where('status', '==', 'success')
      .get();

    const hasSuccessfulTransaction = transactionsSnapshot.docs.some(doc => {
      const data = doc.data();
      const courseIds = data.courseId ? data.courseId.split(',').map(s => s.trim()) : [];
      return courseIds.includes(courseId);
    });

    // 11. Check `enrollmentMeta` on user doc
    const enrollmentMeta = userData.enrollmentMeta || {};
    const meta = enrollmentMeta[courseId];
    const hasMetaEnrollment = !!(meta && (meta.isFreeAccess || meta.enrolledByAdmin || meta.manualEnrollment || meta.byAdmin || meta.enrolledAt));

    // 12. Check `course_rosters` collection
    const rosterRef = db.collection('course_rosters').doc(courseId);
    const rosterSnap = await rosterRef.get();
    let inRoster = false;
    if (rosterSnap.exists) {
      const rosterData = rosterSnap.data();
      const students = rosterData.students || [];
      inRoster = students.some(s => s.uid === userId || (email && s.email && s.email.toLowerCase() === email));
    }

    // 13. Determine if user has valid access
    const isValid = isGloballyFree ||
                    hasEnrollmentDoc || 
                    hasPendingEnrollment || 
                    hasBulkEnrollment || 
                    hasSuccessfulTransaction || 
                    hasMetaEnrollment || 
                    inRoster ||
                    isEnrolledInUserDoc;

    if (!isValid) {
      return res.status(403).json({ 
        valid: false, 
        message: 'No valid purchase or enrollment records found for this course' 
      });
    }

    // 14. AUTO-HEALING & SYNCHRONIZATION:
    // If the student has valid access but any secondary records are missing, heal them in Firestore
    try {
      const batch = db.batch();
      let needsHealing = false;

      // Ensure courseId is present in user's enrolledCourses
      if (!isEnrolledInUserDoc) {
        batch.set(userRef, {
          enrolledCourses: admin.firestore.FieldValue.arrayUnion(courseId),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        needsHealing = true;
      }

      // Ensure user has enrollmentMeta
      if (!meta || !meta.enrolledAt) {
        const enrolledAt = new Date().toISOString();
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 6);
        const grantType = isGloballyFree 
          ? 'free_course' 
          : (enrollmentDocData?.grantedBy || (hasBulkEnrollment || hasPendingEnrollment ? 'admin_bulk_grant' : 'manual_enrollment'));

        batch.set(userRef, {
          [`enrollmentMeta.${courseId}.enrolledAt`]: enrolledAt,
          [`enrollmentMeta.${courseId}.expiresAt`]: expiresAt.toISOString(),
          [`enrollmentMeta.${courseId}.isFreeAccess`]: isGloballyFree || !!(enrollmentDocData?.isFreeAccess ?? true),
          [`enrollmentMeta.${courseId}.grantedBy`]: grantType,
          [`enrollmentMeta.${courseId}.manualEnrollment`]: true
        }, { merge: true });
        needsHealing = true;
      }

      // Ensure doc exists in `enrollments` collection
      if (!hasEnrollmentDoc) {
        const targetEnrollRef = db.collection('enrollments').doc(`${userId}_${courseId}`);
        const isFree = isGloballyFree || hasPendingEnrollment || hasBulkEnrollment || (enrollmentDocData?.isFreeAccess ?? true);
        batch.set(targetEnrollRef, {
          userId,
          courseId,
          courseTitle: courseData.title || '',
          instructorName: courseData.instructorName || '',
          enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
          progress: 0,
          completedLectures: [],
          isFreeAccess: isFree,
          grantedBy: isGloballyFree ? 'free_course' : (hasPendingEnrollment ? 'pending_bulk_enrollment' : 'admin'),
          studentName: userName,
          studentEmail: email,
          collegeName: userData.collegeName || ''
        }, { merge: true });
        needsHealing = true;
      }

      // Ensure student is present in course_rosters
      if (!inRoster) {
        const studentData = {
          uid: userId,
          email: email || '',
          name: userName,
          fcmToken: userData.fcmToken || null
        };
        batch.set(rosterRef, {
          courseId,
          students: admin.firestore.FieldValue.arrayUnion(studentData)
        }, { merge: true });
        needsHealing = true;
      }

      // If pending_enrollment was pending, mark it completed
      if (hasPendingEnrollment && pendingDocRef && pendingDocData?.status === 'pending') {
        batch.update(pendingDocRef, {
          status: 'completed',
          userId,
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        needsHealing = true;
      }

      if (needsHealing) {
        await batch.commit().catch(e => console.warn('Ownership auto-heal batch warning (non-fatal):', e.message));
      }
    } catch (healError) {
      console.warn('Auto-healing skipped or non-fatal error:', healError.message);
    }

    const isFreeAccess = isGloballyFree || !!(enrollmentDocData?.isFreeAccess ?? true);
    return res.status(200).json({ 
      valid: true, 
      message: isGloballyFree ? 'Free course access granted' : 'Course access verified',
      isFree: isFreeAccess
    });

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
  verifyOwnership,
  checkIsCourseFree,
  checkUserFreeGrant
};

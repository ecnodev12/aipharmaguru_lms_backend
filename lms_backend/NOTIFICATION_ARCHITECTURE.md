# Notification System Architecture & Usage Guide

## Overview
This document outlines the architecture of the LMS notification system, specifically focusing on the **Live Class Notifications** and **Global Broadcasts**. The system has been optimized to minimize Firestore read costs using an **Aggregation/Roster Pattern**.

## Core Problem & Solution
**Problem**: Sending a notification to "All Students" (e.g., 10,000 users) traditionally requires reading 10,000 user documents to fetch emails and FCM tokens. This is slow and expensive (O(N) reads).

**Solution**: We implemented the **Roster Pattern**.
- **O(1) Reads**: We maintain "Roster" documents that aggregated necessary user data (Email, FCM Token, Name) into a single document (or set of documents).
- **Lazy Loading**: If a roster is missing, the system automatically builds it from the `users` collection on the first run.
- **Auto-Sync**: When users sign up or enroll, they are automatically added to the relevant rosters.

## Architecture Components

### 1. Course Rosters (`course_rosters` collection)
Used for notifying students enrolled in a specific course.
- **Document ID**: `{courseId}`
- **Structure**: `{ courseId: string, students: Array<{uid, email, name, fcmToken}> }`
- **Maintenance**:
    -   **On Enrollment**: `paymentController.js` adds the student to the roster immediately upon successful payment.
    -   **On Usage**: `notificationController.js` reads this roster. If missing, it builds it from `users` query.

### 2. Role Rosters (`role_rosters` collection)
Used for global broadcasts (e.g., "All Students", "All Instructors").
- **Document ID**: `student` or `instructor`
- **Structure**: `{ role: string, users: Array<{uid, email, name, fcmToken}> }`
- **Maintenance**:
    -   **On Signup/Login**: The frontend **MUST** call `POST /api/users/sync` to add the user to the roster.
    -   **On Usage**: `notificationRoutes.js` and `emailRoutes.js` read this roster. If missing, it builds it from `users` query.

## API Endpoints

### 1. Trigger Live Class Notification
**Endpoint**: `POST /api/notifications/live-class`
**Description**: Sends Email and FCM notification to all students enrolled in the course.
**Body**:
```json
{
  "courseId": "course_123",
  "topic": "Advanced React Patterns",
  "startTime": "2026-02-15 10:00 AM",
  "joinUrl": "https://meet.google.com/abc-xyz",
  "instructorName": "John Doe"
}
```

### 2. Sync User (Critical for Optimization)
**Endpoint**: `POST /api/users/sync`
**Description**: Ensures the user is present in the `role_rosters` for global broadcasts. Call this on frontend after `createUserWithEmailAndPassword` or `signIn`.
**Body**:
```json
{
  "uid": "user_xyz",
  "email": "user@example.com",
  "fullName": "Jane Doe",
  "role": "student",
  "fcmToken": "token_123" 
}
```

### 3. Send Global Broadcast (Admin)
**Endpoint**: `POST /api/email/admin/send-custom`
**Body**:
```json
{
  "recipientType": "all-students",
  "subject": "System Maintenance",
  "htmlContent": "<p>We are upgrading...</p>"
}
```

## Best Practices for Future

1.  **Frontend Responsibilities**:
    -   Always call `/sync` when a user's profile is updated (e.g., new FCM token, name change) to keep the roster fresh.
    -   Call `/live-class` immediately after scheduling a class.

2.  **Roster Size Limits**:
    -   Firestore documents are limited to **1 MiB**.
    -   This supports roughly **5,000 - 8,000 students** per roster.
    -   **Future Scaling**: If a course/role exceeds 5k users, you must implement **Sharding**.
        -   *Strategy*: `course_rosters/{courseId}` becomes a collection or use sub-documents `chunk_1`, `chunk_2`.
        -   Currently, the system assumes < 5k users per course/role.

3.  **Cost Monitoring**:
    -   Keep an eye on Firestore Read usage.
    -   If rosters get deleted, the next run will spike reads (to rebuild). Avoid manual deletion of `role_rosters` or `course_rosters`.

4.  **Security**:
    -   Protect `/api/users/sync` and `/api/notifications/live-class` with auth middleware if not already done (currently relying on `app.js` middleware stack). Ensure only authorized users/instructors can trigger these.

## Code Map
- **Controller**: `src/controllers/notificationController.js` (Live Class Logic)
- **Controller**: `src/controllers/userController.js` (Sync Logic)
- **Controller**: `src/controllers/paymentController.js` (Enrollment Update)
- **Routes**: `src/routes/notificationRoutes.js` (Global Push)
- **Routes**: `src/routes/emailRoutes.js` (Global Email)

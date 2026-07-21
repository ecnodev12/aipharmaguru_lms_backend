# Backend API & Optimization Guide

## Overview
This document details the backend APIs and key optimization strategies implemented to ensure scalability and cost-efficiency (specifically minimizing Firestore reads).

## Core Optimization Strategies

### 1. Roster Pattern (O(1) Reads)
**Problem**: Sending a notification to "All Students" (e.g., 10,000 users) traditionally requires reading 10,000 user documents to fetch emails and FCM tokens. This is slow and expensive.
**Solution**: We maintain aggregated "Roster" documents (`course_rosters/{courseId}` and `role_rosters/{role}`) that contain all necessary user data (Email, FCM Token, Name) in a single document (or set of documents).
**Impact**: Reads reduced from **N** (number of recipients) to **1** (the roster document).

### 2. Lazy Loading & Fallback
**Concept**: The system is self-healing. If a roster document is missing (e.g., first run or accidentally deleted), the notification logic automatically:
1.  Detects the missing roster.
2.  Falls back to the "expensive" query (reads all users) to fetch recipients.
3.  **Rebuilds and saves** the roster immediately for future use.
**Benefit**: No manual setup required; the system optimizes itself over time.

### 3. Asymmetric Sync
**Concept**: Since user creation happens client-side (Firebase Auth), the backend `role_rosters` need a way to stay fresh.
**Solution**: The frontend calls `POST /api/users/sync` after signup/login. This endpoint updates the roster *without* needing to read the entire user database.

## Key API Reference

### 1. User Synchronization
> **CRITICAL**: Frontend MUST call this after `createUserWithEmailAndPassword` or `signIn` to ensure the user receives global notifications.

-   **Endpoint**: `POST /api/users/sync`
-   **Description**: Adds/Updates the user in the `role_rosters` and `users` collection.
-   **Body**:
    ```json
    {
      "uid": "user_123",
      "email": "student@example.com",
      "fullName": "John Doe",
      "role": "student", // "student" or "instructor"
      "fcmToken": "fcm_token_xyz" 
    }
    ```

### 2. Live Class Notification
-   **Endpoint**: `POST /api/notifications/live-class`
-   **Description**: Notifies all students enrolled in a specific course.
-   **Optimization**: Uses `course_rosters`.
-   **Body**:
    ```json
    {
      "courseId": "course_abc",
      "topic": "Intro to AI",
      "startTime": "2026-03-10 10:00 AM",
      "joinUrl": "https://meet.google.com/...",
      "instructorName": "Prof. Smith"
    }
    ```

### 3. Global Broadcast (Email)
-   **Endpoint**: `POST /api/email/admin/send-custom`
-   **Description**: Sends a custom HTML email to a large group.
-   **Optimization**: Uses `role_rosters` when `recipientType` is `all-students` or `all-instructors`.
-   **Body**:
    ```json
    {
      "recipientType": "all-students",
      "subject": "Platform Update",
      "htmlContent": "<h1>New Feature!</h1>..."
    }
    ```

### 4. Global Broadcast (Push Notification)
-   **Endpoint**: `POST /api/notifications/admin/send-push`
-   **Description**: Sends an FCM push notification to a large group.
-   **Optimization**: Uses `role_rosters` when `recipientType` is `all-students` or `all-instructors`.
-   **Body**:
    ```json
    {
      "recipientType": "all-instructors",
      "title": "Trainer Meeting",
      "body": "Join us at 5 PM."
    }
    ```

### 5. Payment Verification (Enrollment)
-   **Endpoint**: `POST /api/payment/verify-payment`
-   **Note**: This endpoint has a **side-effect**. Upon successful payment verification, it automatically adds the student to the `course_rosters/{courseId}` document, keeping the course roster fresh.

## Code Locations

| Feature | File Path |
| :--- | :--- |
| **Notification Logic** | `src/controllers/notificationController.js` |
| **User Sync Logic** | `src/controllers/userController.js` |
| **Enrollment Update** | `src/controllers/paymentController.js` |
| **Global Push Route** | `src/routes/notificationRoutes.js` |
| **Global Email Route** | `src/routes/emailRoutes.js` |

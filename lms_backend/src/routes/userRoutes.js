const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Sync user (called after signup/login)
router.post('/sync', userController.syncUser);

module.exports = router;

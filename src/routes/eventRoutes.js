const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');

// Public routes
router.get('/', eventController.getAllEvents);
router.get('/:id', eventController.getEventById);

// Admin routes (TODO: Add authentication middleware)
router.post('/admin', eventController.createEvent);
router.put('/admin/:id', eventController.updateEvent);
router.delete('/admin/:id', eventController.deleteEvent);

module.exports = router;

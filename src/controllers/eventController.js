const admin = require('../config/firebase');
const db = admin.firestore();

/**
 * Get all events
 * GET /api/events
 * Query params: 
 *   - filter: 'upcoming' | 'past' | 'all' (default: 'all')
 *   - category: filter by category
 */
const getAllEvents = async (req, res) => {
    try {
        const { filter = 'all', category } = req.query;
        let eventsRef = db.collection('events');
        
        // Apply category filter
        if (category) {
            eventsRef = eventsRef.where('category', '==', category);
        }
        
        // Order by date
        eventsRef = eventsRef.orderBy('date', 'desc');
        
        const snapshot = await eventsRef.get();
        let events = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        // Apply time-based filter
        if (filter === 'upcoming') {
            const now = new Date();
            events = events.filter(event => {
                const eventDate = event.date?.toDate ? event.date.toDate() : new Date(event.date);
                return eventDate >= now;
            });
        } else if (filter === 'past') {
            const now = new Date();
            events = events.filter(event => {
                const eventDate = event.date?.toDate ? event.date.toDate() : new Date(event.date);
                return eventDate < now;
            });
        }
        
        res.status(200).json({ 
            success: true, 
            count: events.length,
            events 
        });
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
};

/**
 * Get single event by ID
 * GET /api/events/:id
 */
const getEventById = async (req, res) => {
    try {
        const { id } = req.params;
        const eventDoc = await db.collection('events').doc(id).get();
        
        if (!eventDoc.exists) {
            return res.status(404).json({ 
                success: false,
                error: 'Event not found' 
            });
        }
        
        res.status(200).json({ 
            success: true,
            event: {
                id: eventDoc.id,
                ...eventDoc.data()
            }
        });
    } catch (error) {
        console.error('Error fetching event:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
};

/**
 * Create new event (Admin only)
 * POST /api/admin/events
 */
const createEvent = async (req, res) => {
    try {
        const { 
            title, 
            description, 
            date, 
            location, 
            imageUrl, 
            category,
            registrationLink 
        } = req.body;
        
        // Validation
        if (!title || !description || !date) {
            return res.status(400).json({ 
                success: false,
                error: 'Missing required fields: title, description, date' 
            });
        }
        
        const eventData = {
            title,
            description,
            date: new Date(date),
            location: location || '',
            imageUrl: imageUrl || '',
            category: category || 'general',
            registrationLink: registrationLink || '',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        const docRef = await db.collection('events').add(eventData);
        
        res.status(201).json({ 
            success: true,
            message: 'Event created successfully',
            eventId: docRef.id
        });
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
};

/**
 * Update event (Admin only)
 * PUT /api/admin/events/:id
 */
const updateEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            title, 
            description, 
            date, 
            location, 
            imageUrl, 
            category,
            registrationLink 
        } = req.body;
        
        const eventRef = db.collection('events').doc(id);
        const eventDoc = await eventRef.get();
        
        if (!eventDoc.exists) {
            return res.status(404).json({ 
                success: false,
                error: 'Event not found' 
            });
        }
        
        const updateData = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        if (title) updateData.title = title;
        if (description) updateData.description = description;
        if (date) updateData.date = new Date(date);
        if (location !== undefined) updateData.location = location;
        if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
        if (category) updateData.category = category;
        if (registrationLink !== undefined) updateData.registrationLink = registrationLink;
        
        await eventRef.update(updateData);
        
        res.status(200).json({ 
            success: true,
            message: 'Event updated successfully'
        });
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
};

/**
 * Delete event (Admin only)
 * DELETE /api/admin/events/:id
 */
const deleteEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const eventRef = db.collection('events').doc(id);
        const eventDoc = await eventRef.get();
        
        if (!eventDoc.exists) {
            return res.status(404).json({ 
                success: false,
                error: 'Event not found' 
            });
        }
        
        await eventRef.delete();
        
        res.status(200).json({ 
            success: true,
            message: 'Event deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
};

module.exports = {
    getAllEvents,
    getEventById,
    createEvent,
    updateEvent,
    deleteEvent
};

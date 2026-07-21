const admin = require('firebase-admin');

try {
    console.log('Attempting to initialize app with undefined databaseURL...');
    admin.initializeApp({
        databaseURL: undefined
    });
    console.log('Initialization success!');
    
    console.log('Attempting to access firestore...');
    const db = admin.firestore();
    console.log('Firestore access success!');
    
} catch (error) {
    console.error('Crash detected:', error);
}

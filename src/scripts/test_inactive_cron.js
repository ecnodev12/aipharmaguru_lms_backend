// Configure dotenv first
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.development') });

const admin = require('../config/firebase');
const cronService = require('../services/cronService');

async function testCron() {
    console.log('--- Starting manual test of sendInactiveStudentsReport ---');
    try {
        await cronService.sendInactiveStudentsReport();
        console.log('--- Test finished successfully! ---');
    } catch (err) {
        console.error('Error running test:', err);
    }
    process.exit(0);
}

testCron();

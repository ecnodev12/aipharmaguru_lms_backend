const axios = require('axios');

const BASE_URL = 'http://localhost:5001/api/email';

// Mock Data
const TEST_EMAIL = 'test@example.com'; // In a real scenario, this would be a valid email

const tests = [
    {
        name: 'Signup Welcome',
        endpoint: '/signup-welcome',
        data: {
            to: TEST_EMAIL,
            name: 'John Doe'
        }
    },
    {
        name: 'Payment Success',
        endpoint: '/payment-success',
        data: {
            to: TEST_EMAIL,
            name: 'Jane Doe',
            transactionId: 'TXN123456789',
            amount: '$99.00',
            date: '2026-02-08',
            item: 'Full Stack Development Course'
        }
    },
    {
        name: 'Payment Failed',
        endpoint: '/payment-failed',
        data: {
            to: TEST_EMAIL,
            name: 'Jane Doe',
            reason: 'Insufficient Funds',
            amount: '$99.00'
        }
    },
    {
        name: 'Admin - Trainer Added',
        endpoint: '/admin/trainer-added',
        data: {
            to: TEST_EMAIL,
            trainerName: 'Alice Smith',
            trainerEmail: 'alice@trainer.com',
            specialization: 'Data Science',
            adminName: 'Super Admin'
        }
    },
    {
        name: 'Admin - Course Added',
        endpoint: '/admin/course-added',
        data: {
            to: TEST_EMAIL,
            courseName: 'Advanced React Patterns',
            category: 'Web Development',
            instructorName: 'Bob Martin',
            price: '$49.99'
        }
    },
    {
        name: 'Admin - Trainer Created',
        endpoint: '/admin/trainer-created',
        data: {
            to: TEST_EMAIL,
            username: 'alice_trainer',
            tempPassword: 'TemporaryPassword123!'
        }
    },
    {
        name: 'Admin - Support Created',
        endpoint: '/admin/support-created',
        data: {
            to: TEST_EMAIL,
            username: 'support_agent_test',
            tempPassword: 'TempSupportPassword321!'
        }
    }
];

const runTests = async () => {
    console.log('Starting Email Endpoint Tests...\n');

    for (const test of tests) {
        try {
            console.log(`Testing: ${test.name}`);
            const response = await axios.post(`${BASE_URL}${test.endpoint}`, test.data);
            console.log(`✅ Success: ${response.data.message}`);
        } catch (error) {
            console.error(`❌ Failed: ${test.name}`);
            if (error.response) {
                console.error(`   Status: ${error.response.status}`);
                console.error(`   Error: ${JSON.stringify(error.response.data)}`);
            } else {
                console.error(`   Error: ${error.message}`);
            }
        }
        console.log('-----------------------------------');
    }
};

runTests();

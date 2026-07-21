const admin = require('./src/config/firebase'); // Relative to lms_backend
const db = admin.firestore();

async function listTransactions() {
    console.log('Listing recent transactions from lms_backend...');
    try {
        const snapshot = await db.collection('transactions').limit(5).get();
        if (snapshot.empty) {
            console.log('No transactions found in collection "transactions".');
        } else {
            console.log(`Found ${snapshot.size} recent transactions.`);
            snapshot.forEach(doc => {
                console.log(`ID: ${doc.id}`);
                console.log(`Data:`, JSON.stringify(doc.data(), null, 2));
                console.log('---');
            });
        }
        
        // Specific check
        const specificId = 'order_SEtm5RF5ruaTRi';
        console.log(`\nChecking specific ID: ${specificId}`);
        const docRef = db.collection('transactions').doc(specificId);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            console.log(`FOUND Specific Transaction (${specificId}):`);
            console.log(JSON.stringify(docSnap.data(), null, 2));
        } else {
             console.log(`Specific Transaction (${specificId}) NOT FOUND.`);
        }

    } catch (error) {
        console.error('Error listing transactions:', error);
    } finally {
        process.exit();
    }
}

listTransactions();

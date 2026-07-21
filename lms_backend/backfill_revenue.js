const admin = require('./src/config/firebase'); // Relative to lms_backend
const db = admin.firestore();

async function backfillRevenue() {
    console.log('Starting revenue backfill...');
    
    try {
        const transactionsRef = db.collection('transactions');
        const snapshot = await transactionsRef.where('status', '==', 'success').get();
        
        if (snapshot.empty) {
            console.log('No successful transactions found.');
        } else {
            let totalRevenue = 0;
            let count = 0;
            
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.amount) {
                    totalRevenue += Number(data.amount);
                    count++;
                }
            });
            
            console.log(`Found ${count} successful transactions.`);
            console.log(`Calculated Total Revenue: ${totalRevenue}`);
            
            await db.collection('stats').doc('finance').set({
                totalRevenue: totalRevenue,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
            
            console.log('Successfully updated stats/finance document.');
        }

    } catch (error) {
        console.error('Error backfilling revenue:', error);
    } finally {
        process.exit();
    }
}

backfillRevenue();

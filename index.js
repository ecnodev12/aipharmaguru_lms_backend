const app = require('./src/app');
const config = require('./src/config');
const firebase = require('./src/config/firebase'); // Initialize Firebase

// Use PORT from environment (App Hosting injects this) or config default
const PORT = process.env.PORT || config.port || 8080;

console.log(`Starting server... Attempting to listen on port ${PORT}`);

const server = app.listen(PORT, () => {
  console.log(`Server running in ${config.env} mode on port ${PORT}`);
  
  // Initialize Database Listeners & Cron Services
  try {
    const dbListenerService = require('./src/services/dbListenerService');
    const cronService = require('./src/services/cronService');
    
    dbListenerService.initializeListeners();
    cronService.initializeCronJobs();
  } catch (error) {
    console.error('Failed to initialize listeners/cron services:', error);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});

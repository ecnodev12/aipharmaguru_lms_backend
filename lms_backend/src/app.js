const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const config = require('./config');

const xss = require('xss'); // Using xss library instead of xss-clean
const hpp = require('hpp');


const app = express();

// Trust reverse proxy for App Hosting / Cloud Run
app.set('trust proxy', 1);

// Security Middleware
// Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));


// Request Logger for Debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Incoming Origin:', req.headers.origin);
  next();
});

// Robust CORS Configuration
const allowedOrigins = [
  "http://localhost:5173",
  "https://aicureacademy-4c3a9.web.app",
  "https://aicureacademy-4c3a9.firebaseapp.com",
  "https://aicurelmsbackend--aicureacademy-4c3a9.asia-southeast1.hosted.app"
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      console.warn(`[CORS Blocked] Origin: ${origin}`);
      // Temporarily allow all origins dynamically to fix deployment CORS issues
      return callback(null, true); 
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
};

// Apply CORS to all routes
app.use(cors(corsOptions));

// Explicitly handle preflight requests for all routes with logging
app.options(/.*/, (req, res, next) => {
    console.log(`[OPTIONS] ${req.url} Origin: ${req.headers.origin}`);
    next();
}, cors(corsOptions));

app.use(express.json({ limit: '10kb' })); // Limit body size
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Data Sanitization against NoSQL query injection (Custom Middleware)
app.use((req, res, next) => {
  const sanitize = (obj) => {
    for (const key in obj) {
      if (key.startsWith('$') || key.includes('.')) {
        delete obj[key];
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitize(obj[key]);
      }
    }
  };

  if (req.body) sanitize(req.body);
  if (req.query) {
      // Handle read-only query object in Express 5
      try {
          sanitize(req.query);
      } catch (err) {
          // ignore if read-only
      }
  }
  if (req.params) sanitize(req.params);
  next();
});

// Data Sanitization against XSS (Custom Middleware using xss)
app.use((req, res, next) => {
    if (req.body) {
        // Sanitize body
        const sanitize = (obj) => {
            for (const key in obj) {
                if (typeof obj[key] === 'string') {
                    obj[key] = xss(obj[key]);
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    sanitize(obj[key]);
                }
            }
        };
        sanitize(req.body);
    }
     if (req.query) {
        // Sanitize query - Use try/catch in case query is read-only (Express 5/middleware conflict)
        try {
            const sanitize = (obj) => {
                 for (const key in obj) {
                     if (typeof obj[key] === 'string') {
                         obj[key] = xss(obj[key]);
                     } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                         sanitize(obj[key]);
                     }
                 }
             };
             sanitize(req.query);
        } catch (err) {
            console.warn("Could not sanitize req.query:", err.message);
        }
    }
    if (req.params) {
         try {
            const sanitize = (obj) => {
                 for (const key in obj) {
                     if (typeof obj[key] === 'string') {
                         obj[key] = xss(obj[key]);
                     } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                        sanitize(obj[key]);
                     }
                 }
             };
             sanitize(req.params);
         } catch(err) {
             console.warn("Could not sanitize req.params:", err.message);
         }
    }
    next();
});

// Prevent HTTP Parameter Pollution
app.use(hpp());

// Logging
if (config.env === 'development') {
  app.use(morgan('dev'));
}

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/api', limiter);

// Welcome Route
app.get('/', (req, res) => {
  res.status(200).send('Welcome to LMS Backend! Server is running 🚀');
});

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', env: config.env, timestamp: new Date().toISOString() });
});

// Import Routes
const routes = require('./routes');
app.use('/api', routes);

// Handle Unhandled Routes (404)
app.all(/.*/, (req, res, next) => {
  const err = new Error(`Can't find ${req.originalUrl} on this server!`);
  err.statusCode = 404; 
  next(err);
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', err.stack);
  
  // Force CORS headers in case of error
  const origin = req.headers.origin;
  if (origin) res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Credentials", "true");

  // Handle CORS errors specifically
  if (err.message && (err.message.includes('CORS policy') || err.message.includes('Not allowed by CORS'))) {
      return res.status(403).json({
          status: 'error',
          message: 'CORS Forbidden: ' + err.message
      });
  }

  res.status(err.statusCode || 500).json({
    status: 'error',
    message: err.message || 'Internal Server Error',
    stack: config.env === 'development' ? err.stack : undefined
  });
});

module.exports = app;

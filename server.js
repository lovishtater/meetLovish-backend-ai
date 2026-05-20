const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Initialize MongoDB connection
const database = require('./models/database');

const app = express();

// Trust proxy for accurate IP addresses (important for rate limiting)
app.set('trust proxy', true);

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || '*', // Configure this to your frontend URL in production
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress;
  console.log(`${timestamp} - ${req.method} ${req.originalUrl} - IP: ${ip}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

// API Routes
const chatRoutes = require('./api/chat');
const adminRoutes = require('./api/admin');

app.use('/api', chatRoutes);
app.use('/api/admin', adminRoutes);

// Root endpoint with basic info
app.get('/', (req, res) => {
  res.json({
    name: `${process.env.USER_NAME} AI Assistant Backend`,
    description: `Backend API for the AI assistant integrated into ${process.env.USER_NAME}'s portfolio website`,
    version: '1.0.0',
    endpoints: {
      chat: {
        init: 'POST /api/chat/init - Initialize a new chat session',
        send: 'POST /api/chat - Send a message to the AI assistant',
        status: 'GET /api/chat/status - Get session status and rate limits',
      },
      health: 'GET /health - Health check endpoint',
      // admin: {
      //   dashboard: 'GET /api/admin/dashboard?secret=SECRET - Admin dashboard data',
      //   chats: 'GET /api/admin/chats?secret=SECRET - Recent chat sessions',
      //   tools: 'GET /api/admin/tools?secret=SECRET - Recent tool calls',
      //   users: 'GET /api/admin/users?secret=SECRET - Recent users',
      //   analytics: 'GET /api/admin/analytics?secret=SECRET - Analytics data',
      //   status: 'GET /api/admin/status?secret=SECRET - System status',
      //   sessions: 'GET /api/admin/sessions/:sessionId?secret=SECRET - Session history',
      //   search: 'GET /api/admin/search?q=query&type=all&secret=SECRET - Search chats/users',
      // },
    },
    rateLimits: {
      daily: '200 messages per day per IP',
      hourly: '50 messages per hour per IP',
    },
  });
});

// Error handling middleware
app.use((err, req, res) => {
  console.error('Error:', err);

  // Handle different types of errors
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }

  // Default error response
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: ['GET /', 'GET /health', 'POST /api/chat/init', 'POST /api/chat', 'GET /api/chat/status'],
  });
});


// Kick off DB connection immediately — runs on cold start before any request arrives.
// waitForConnection() in each route handler waits for this to complete.
database.connect().catch(err => console.error('❌ Database connection failed:', err.message));

// Validate environment variables
if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️  Warning: OPENAI_API_KEY not set in environment variables');
}
if (!process.env.ADMIN_SECRET || process.env.ADMIN_SECRET === 'your-secret-key-here') {
  console.warn('⚠️  Warning: ADMIN_SECRET not set or using default. Please set a secure secret.');
}
if (!process.env.MONGODB_URI && !process.env.DATABASE_URL) {
  console.warn('⚠️  Warning: MONGODB_URI/DATABASE_URL not set. Using local MongoDB.');
}

// Local development only — Vercel handles HTTP itself and ignores this
const PORT = process.env.PORT || 8008;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Health check: http://localhost:${PORT}/health`);
    console.log(`💬 Chat endpoint: http://localhost:${PORT}/api/chat`);
  });
}

module.exports = app;

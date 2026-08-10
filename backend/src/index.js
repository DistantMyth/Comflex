/**
 * Comflex Backend — Express + Socket.IO Server Entry Point
 *
 * Initializes Express, registers middleware/routes, seeds admin,
 * initializes Socket.IO for real-time chat + DMs, and starts listening.
 */

const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const errorHandler = require('./middleware/errorHandler');
const { seedAdmin } = require('./services/seedService');
const { initSocket } = require('./services/chatSocketService');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const systemRoutes = require('./routes/system');
const groupRoutes = require('./routes/groups');
const friendRoutes = require('./routes/friends');
const dmRoutes = require('./routes/dm');
const eventRoutes = require('./routes/events');
const resourceRoutes = require('./routes/resources');
const storeRoutes = require('./routes/store');
const chatbotRoutes = require('./routes/chatbotRoutes');
const notificationRoutes = require('./routes/notifications');

const app = express();
const httpServer = http.createServer(app);

// ============================================================
// MIDDLEWARE
// ============================================================

// Trust one reverse-proxy hop in production so req.ip resolves to the real
// client IP (used by the IP rate limiter) instead of the proxy's address.
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// CORS — allow frontend origin (in dev, allow any origin for LAN access)
app.use(cors({
  origin: env.NODE_ENV === 'development' ? true : env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Parse JSON and URL-encoded bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve uploaded files (avatars) — dev only; use S3/CDN in production
app.use('/uploads', express.static(env.STORAGE_PATH));

// ============================================================
// ROUTES
// ============================================================

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/system', systemRoutes);
app.use('/api/v1/groups', groupRoutes);
app.use('/api/v1/friends', friendRoutes);
app.use('/api/v1/dm', dmRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/resources', resourceRoutes);
app.use('/api/v1/store', storeRoutes);
app.use('/api/v1/chatbot', chatbotRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// ERROR HANDLING (must be registered after all routes)
// ============================================================

app.use(errorHandler);

// ============================================================
// START SERVER
// ============================================================

async function startServer() {
  try {
    // Seed the admin user on first boot (idempotent)
    await seedAdmin();

    // Initialize Socket.IO for real-time chat + DMs
    initSocket(httpServer, env.FRONTEND_URL);

    httpServer.listen(env.PORT, '0.0.0.0', () => {
      console.log(`\n🚀 Comflex Backend running on http://0.0.0.0:${env.PORT}`);
      console.log(`   Environment: ${env.NODE_ENV}`);
      console.log(`   Frontend URL: ${env.FRONTEND_URL}`);
      console.log(`   WebSocket: enabled`);
      console.log(`   Email: ${env.EMAIL_PROVIDER} mode\n`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

module.exports = app;

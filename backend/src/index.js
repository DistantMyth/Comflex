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
const prisma = require('./prisma');
const authMiddleware = require('./middleware/auth');
const { seedAdmin } = require('./services/seedService');
const { initSocket } = require('./services/chatSocketService');
const { enforceBatchAccess } = require('./utils/batchAccess');

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

// Security headers for every API response (equivalent of helmet's basics,
// without the extra dependency). Add HSTS in production so browsers enforce
// HTTPS for the API origin.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0'); // legacy header; modern XSS defense is CSP
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Anon-Identity', 'X-Anon-Sessions'],
}));

// Parse JSON and URL-encoded bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve uploaded files (avatars) — dev only; use S3/CDN in production.
// Security headers: even if an attacker managed to store an .html/.svg file
// before the fileFilter hardening, nosniff + a sandboxing CSP prevent it
// from executing in a browser under the app origin.
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Resource files (/uploads/resources/...) are batch-scoped: seniors' notes
// must not be fetchable by URL guessing. Require a valid JWT and enforce
// batch access against the subject BEFORE the static handler runs.
// (Avatars, badge images and chat media stay public — browsers fetch them
// with <img src> which cannot carry an Authorization header.)
app.use('/uploads/resources', authMiddleware, async (req, res, next) => {
  try {
    const fileUrl = `/uploads/resources${req.path}`;
    const resource = await prisma.resource.findFirst({ where: { fileUrl } });
    if (!resource) return res.status(404).json({ error: 'File not found.' });

    const subject = await prisma.resourceSubject.findUnique({ where: { id: resource.subjectId } });
    if (subject && !enforceBatchAccess(req, subject.subCategory, subject.yearGroup)) {
      return res.status(403).json({ error: 'You only have access to your own batch and your immediate juniors.' });
    }
    next();
  } catch (err) {
    next(err);
  }
});
app.use('/uploads/resources', express.static(path.join(env.STORAGE_PATH, 'resources')));

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

// ============================================================
// PARTIAL UNIQUE INDEX ON TRANSACTION (type, referenceId)
// ============================================================
// Prisma can't express partial indexes, so the one guarding credit-payout
// idempotency (buy-credits claims, event rewards, distribution, downloads)
// is created directly. Missing never fails boot — worst case the app falls
// back to its findFirst guards.
async function ensureUniqueIndexes() {
  try {
    await prisma.$runCommandRaw({
      createIndexes: 'Transaction',
      indexes: [{
        key: { type: 1, referenceId: 1 },
        name: 'unique_type_referenceId',
        unique: true,
        // Only rows that actually carry a referenceId participate; rows with
        // null referenceId (transfers, admin mints) are exempt.
        partialFilterExpression: { referenceId: { $type: 'string' } },
        background: true,
      }],
    });
    console.log('[DB] Transaction (type, referenceId) unique index ensured.');
  } catch (err) {
    console.warn('[DB] Could not ensure Transaction unique index (continuing):', err.message);
  }
}

async function startServer() {
  // Bounded backoff: a transient DB/DNS outage at boot (e.g. Atlas resume,
  // DNS propagation) must not put the service into an instant crash loop —
  // Render restarts would keep failing until external action is taken.
  // Boot only fails hard after ~3 minutes of continuous failure.
  const MAX_BOOT_ATTEMPTS = 8;
  for (let attempt = 1; ; attempt++) {
    try {
      // Ensure the ledger idempotency index exists (best-effort)
      await ensureUniqueIndexes();

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
      return;
    } catch (err) {
      if (attempt > MAX_BOOT_ATTEMPTS) {
        console.error(`❌ Failed to start server after ${MAX_BOOT_ATTEMPTS} attempts:`, err);
        process.exit(1);
      }
      const waitMs = Math.min(30_000, 1_500 * 2 ** attempt);
      console.error(`[BOOT] Database unreachable (attempt ${attempt}/${MAX_BOOT_ATTEMPTS}): ${err.message}`);
      console.error(`[BOOT] Retrying in ${Math.round(waitMs / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

startServer();

module.exports = app;

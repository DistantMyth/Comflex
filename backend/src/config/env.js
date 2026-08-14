/**
 * Environment Configuration
 * 
 * Centralizes all environment variable access. Every env var used
 * anywhere in the backend MUST be exported from here — no direct
 * process.env access elsewhere.
 */

const dotenv = require('dotenv');
dotenv.config();

const env = {
  // Server
  PORT: parseInt(process.env.PORT, 10) || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Database
  DATABASE_URL: process.env.DATABASE_URL,

  // JWT
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
  JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRY || '15m',
  JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY || '7d',

  // Seed Admin
  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,
  SEED_ADMIN_DISPLAY_NAME: process.env.SEED_ADMIN_DISPLAY_NAME || 'Platform Admin',

  // CORS
  FRONTEND_URL: (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, ''),

  // Google OAuth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',

  // Email Service — provider can be: "smtp" | "console"
  // "console" logs emails to terminal (default for development)
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || 'console',
  EMAIL_FROM: process.env.EMAIL_FROM || 'noreply@comflex.dev',

  // SMTP config (only used when EMAIL_PROVIDER=smtp)
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',

  // Email API key (for future providers like Resend/SendGrid)
  EMAIL_API_KEY: process.env.EMAIL_API_KEY || '',

  // File Storage Path (local dev only — Render wipes /tmp)
  STORAGE_PATH: process.env.STORAGE_PATH || require('path').join(__dirname, '../../uploads'),

  // Cloudinary (optional locally, required on Render/Vercel)
  // Files uploaded here survive restarts, unlike Render's ephemeral /tmp.
  CLOUDINARY_URL: (process.env.CLOUDINARY_URL || '').trim(),
  CLOUDINARY_CLOUD_NAME: (process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || '').trim(),
  CLOUDINARY_API_KEY: (process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY || '').trim(),
  CLOUDINARY_API_SECRET: (process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET || '').trim(),
};

// ── Fail-fast secrets validation ──────────────────────────────────────────
// Any deployment that is not the local development server MUST run with
// strong, non-default JWT secrets — otherwise an attacker can forge admin
// tokens (HS256), and the anon-identity HMAC pepper below it. Refuse to
// boot rather than ship insecure.
const WEAK_JWT_SECRETS = ['dev-access-secret', 'dev-refresh-secret', 'your-access-secret-here-change-in-production', 'your-refresh-secret-here-change-in-production'];

function assertStrongSecret(name, value) {
  if (!value || value.length < 32 || WEAK_JWT_SECRETS.includes(value)) {
    console.error(`[ENV] ❌ ${name} is missing, too short (<32 chars), or uses a known default value.`);
    console.error(`[ENV] Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`);
    process.exit(1);
  }
}

// 'development' is the only environment allowed to run with dev defaults
// (local machine, no real users). Staging/preview/test/production must all
// present real secrets.
if (env.NODE_ENV !== 'development') {
  assertStrongSecret('JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET);
  assertStrongSecret('JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET);
}

module.exports = env;

/**
 * Environment Configuration
 * 
 * Centralizes all environment variable access. Every env var used
 * anywhere in the backend MUST be exported from here — no direct
 * process.env access elsewhere.
 */

const dotenv = require('dotenv');
dotenv.config();

function cleanEnvString(val) {
  if (!val) return '';
  return String(val).replace(/^["']|["']$/g, '').trim();
}

const env = {
  // Server
  PORT: parseInt(process.env.PORT, 10) || 5000,
  NODE_ENV: cleanEnvString(process.env.NODE_ENV) || 'development',

  // Database
  DATABASE_URL: cleanEnvString(process.env.DATABASE_URL),

  // JWT
  JWT_ACCESS_SECRET: cleanEnvString(process.env.JWT_ACCESS_SECRET) || 'dev-access-secret',
  JWT_REFRESH_SECRET: cleanEnvString(process.env.JWT_REFRESH_SECRET) || 'dev-refresh-secret',
  JWT_ACCESS_EXPIRY: cleanEnvString(process.env.JWT_ACCESS_EXPIRY) || '15m',
  JWT_REFRESH_EXPIRY: cleanEnvString(process.env.JWT_REFRESH_EXPIRY) || '7d',

  // Seed Admin
  SEED_ADMIN_EMAIL: cleanEnvString(process.env.SEED_ADMIN_EMAIL),
  SEED_ADMIN_PASSWORD: cleanEnvString(process.env.SEED_ADMIN_PASSWORD),
  SEED_ADMIN_DISPLAY_NAME: cleanEnvString(process.env.SEED_ADMIN_DISPLAY_NAME) || 'Platform Admin',

  // CORS
  FRONTEND_URL: (cleanEnvString(process.env.FRONTEND_URL) || 'http://localhost:5173').replace(/\/+$/, ''),

  // Google OAuth
  GOOGLE_CLIENT_ID: cleanEnvString(process.env.GOOGLE_CLIENT_ID),

  // Email Service — provider can be: "smtp" | "console"
  EMAIL_PROVIDER: cleanEnvString(process.env.EMAIL_PROVIDER) || 'console',
  EMAIL_FROM: cleanEnvString(process.env.EMAIL_FROM) || 'noreply@comflex.dev',

  // SMTP config (only used when EMAIL_PROVIDER=smtp)
  SMTP_HOST: cleanEnvString(process.env.SMTP_HOST),
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_USER: cleanEnvString(process.env.SMTP_USER),
  SMTP_PASS: cleanEnvString(process.env.SMTP_PASS),

  // Email API key (for future providers like Resend/SendGrid)
  EMAIL_API_KEY: cleanEnvString(process.env.EMAIL_API_KEY),

  // File Storage Path (local dev only — Render wipes /tmp)
  STORAGE_PATH: cleanEnvString(process.env.STORAGE_PATH) || require('path').join(__dirname, '../../uploads'),

  // Cloudinary (optional locally, required on Render/Vercel)
  CLOUDINARY_URL: cleanEnvString(process.env.CLOUDINARY_URL),
  CLOUDINARY_CLOUD_NAME: cleanEnvString(process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME),
  CLOUDINARY_API_KEY: cleanEnvString(process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY),
  CLOUDINARY_API_SECRET: cleanEnvString(process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET),

  // Google Gemini AI
  GEMINI_API_KEY: cleanEnvString(process.env.GEMINI_API_KEY),
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

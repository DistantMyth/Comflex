/**
 * Email Service — Pluggable email transport
 *
 * Reads EMAIL_PROVIDER from env to determine transport:
 *   - "console" (default/dev) → logs emails to the terminal
 *   - "smtp" → uses Nodemailer with SMTP credentials
 *
 * All email sending goes through this service so the transport
 * can be swapped via .env without touching any business logic.
 */

const env = require('../config/env');
const { createEmailSendLimiter, normalizeEmailKey } = require('../utils/emailRateLimit');

// Chokepoint backstop: EVERY email send is capped per recipient address,
// regardless of which flow triggered it. The per-flow limiters in authService
// (verification / password reset) remain the primary control with tighter
// caps; this guarantees that any future flow — welcome emails, invites,
// event reminders — gets a baseline anti-abuse guard automatically, even if
// it forgets its own limiter. Cap is generous (10/10min per recipient) so
// combined legitimate flows never trip it.
const recipientLimiter = createEmailSendLimiter({
  maxSends: 10,
  message: 'Too many emails sent to this address.',
});

/**
 * Internal: create the appropriate transport based on EMAIL_PROVIDER.
 * Lazily initialized on first send to avoid import overhead in tests.
 */
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  if (env.EMAIL_PROVIDER === 'smtp') {
    const nodemailer = require('nodemailer');
    _transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465, // true for 465, false for other ports
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    return _transporter;
  }

  // Default: "console" provider — just logs. Credentials and reset/verify
  // tokens must NOT be written to logs (shared terminals, CI logs, crash
  // dumps), so the recipient is masked and URL query params are redacted.
  const redactUrl = (text) =>
    text.replace(/([?&](?:token|code|key)=)[^&\s]+/gi, '$1[REDACTED]');
  const maskEmail = (email) => {
    const at = (email || '').indexOf('@');
    if (at <= 2) return '***';
    return email.slice(0, 2) + '***@***' + email.slice(at + 1, at + 2) + '*';
  };
  _transporter = {
    sendMail: async (opts) => {
      const body = redactUrl(opts.text || '(HTML only)');
      console.log('\n📧 [EMAIL — CONSOLE MODE]');
      console.log(`   To:      ${maskEmail(opts.to)}`);
      console.log(`   Subject: ${opts.subject}`);
      console.log(`   Body:    ${body}`);
      console.log('');
      return { messageId: `console-${Date.now()}` };
    },
  };
  return _transporter;
}

async function sendMailWithFallback(mailOptions) {
  if (env.EMAIL_PROVIDER !== 'smtp') {
    const transporter = getTransporter();
    return transporter.sendMail(mailOptions);
  }

  const nodemailer = require('nodemailer');
  const portsToTry = [env.SMTP_PORT, env.SMTP_PORT === 465 ? 587 : 465];

  let lastErr = null;
  for (const port of portsToTry) {
    try {
      const isSsl = port === 465;
      const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: isSsl,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 12000,
        tls: { rejectUnauthorized: false }
      });

      return await transporter.sendMail(mailOptions);
    } catch (err) {
      console.warn(`[emailService] ⚠️ SMTP send failed on port ${port}:`, err.message);
      lastErr = err;
    }
  }

  throw lastErr || new Error('Failed to send email through SMTP');
}

/**
 * Send a password reset email.
 *
 * @param {string} to - Recipient email address
 * @param {string} resetUrl - Full URL with reset token
 */
async function sendPasswordReset(to, resetUrl) {
  await recipientLimiter.check(normalizeEmailKey(to));
  return sendMailWithFallback({
    from: env.EMAIL_FROM,
    to,
    subject: 'Comflex — Reset Your Password',
    text: `You requested a password reset.\n\nClick this link to reset your password:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Reset Your Password</h2>
        <p>You requested a password reset for your Comflex account.</p>
        <p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 8px;">Reset Password</a></p>
        <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}

/**
 * Send a personal email verification email.
 *
 * @param {string} to - Personal email to verify
 * @param {string} verifyUrl - Full URL with verification token
 */
async function sendEmailVerification(to, verifyUrl) {
  await recipientLimiter.check(normalizeEmailKey(to));
  return sendMailWithFallback({
    from: env.EMAIL_FROM,
    to,
    subject: 'Comflex — Verify Your Personal Email',
    text: `Verify your personal email by clicking this link:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Verify Your Email</h2>
        <p>Click the button below to verify your personal email on Comflex.</p>
        <p><a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 8px;">Verify Email</a></p>
        <p style="color: #666; font-size: 14px;">This link expires in 24 hours.</p>
      </div>
    `,
  });
}

module.exports = { sendPasswordReset, sendEmailVerification };

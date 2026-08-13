/**
 * Email Service — Pluggable email transport
 *
 * Reads EMAIL_PROVIDER from env to determine transport:
 *   - "console" (default/dev) → logs emails to the terminal
 *   - "smtp" → uses Nodemailer with SMTP credentials
 *   - "brevo" → uses the Brevo transactional API (no SMTP login,
 *     no IP allowlisting — works from any egress, e.g. Render free tier).
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
    });
    return _transporter;
  }

  if (env.EMAIL_PROVIDER === 'brevo') {
    if (!env.EMAIL_API_KEY) {
      throw new Error('EMAIL_PROVIDER=brevo requires EMAIL_API_KEY (generate one in Brevo → SMTP & API → API Keys).');
    }
    if (!env.EMAIL_FROM) {
      throw new Error('EMAIL_PROVIDER=brevo requires EMAIL_FROM set to an approved sender in Brevo.');
    }
    _transporter = {
      sendMail: async (opts) => {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': env.EMAIL_API_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            sender: { email: env.EMAIL_FROM },
            to: [{ email: opts.to }],
            subject: opts.subject,
            textContent: opts.text,
            htmlContent: opts.html,
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`Brevo API error ${res.status}: ${detail.slice(0, 300)}`);
        }
        const data = await res.json().catch(() => ({}));
        return { messageId: data.messageId || `brevo-${Date.now()}` };
      },
    };
    return _transporter;
  }

  // Default: "console" provider — just logs
  _transporter = {
    sendMail: async (opts) => {
      console.log('\n📧 [EMAIL — CONSOLE MODE]');
      console.log(`   To:      ${opts.to}`);
      console.log(`   Subject: ${opts.subject}`);
      console.log(`   Body:    ${opts.text || '(HTML only)'}`);
      console.log('');
      return { messageId: `console-${Date.now()}` };
    },
  };
  return _transporter;
}

/**
 * Send a password reset email.
 *
 * @param {string} to - Recipient email address
 * @param {string} resetUrl - Full URL with reset token
 */
async function sendPasswordReset(to, resetUrl) {
  await recipientLimiter.check(normalizeEmailKey(to));
  const transporter = getTransporter();
  await transporter.sendMail({
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
  const transporter = getTransporter();
  await transporter.sendMail({
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

/**
 * Auth Service
 * 
 * Business logic for authentication: register, login, refresh token,
 * Google OAuth login, password management, username, email verification.
 * Registration is gated — only allowed after the Seed Admin configures
 * the institution (isConfigured === true).
 */

const prisma = require('../prisma');
const crypto = require('crypto');
const { hashPassword, comparePassword } = require('../utils/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { assignCohortTags } = require('./cohortService');
const { verifyGoogleToken } = require('./googleAuthService');
const { sendPasswordReset, sendEmailVerification } = require('./emailService');
const { createEmailSendLimiter, normalizeEmailKey } = require('../utils/emailRateLimit');
const env = require('../config/env');

/**
 * Normalize an email for storage/lookup: trim + lowercase.
 */
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Hash a refresh token before storing (like reset/verify tokens).
 * DB leaks never yield usable session tokens.
 */
function hashRefreshToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Register a new user (email/password — legacy, kept for admin accounts).
 * 1. Check institution is configured (registration gate)
 * 2. Enforce the institution email domain when configured
 * 3. Check email is not already taken
 * 4. Hash password, create user
 * 5. Auto-assign cohort tags
 * 6. Return JWT pair
 */
async function register(email, password, displayName) {
  const normalizedEmail = normalizeEmail(email);

  // Gate: institution must be configured before registration is allowed
  const config = await prisma.institutionConfig.findFirst();
  if (!config || !config.isConfigured) {
    throw Object.assign(new Error('Registration is disabled. The platform has not been configured yet.'), { statusCode: 403, code: 'REGISTRATION_DISABLED' });
  }

  // Enforce the institution email domain when one is configured
  if (config.domain) {
    const domain = config.domain.toLowerCase().replace(/^@/, '');
    if (!normalizedEmail.endsWith(`@${domain}`)) {
      throw Object.assign(new Error(`Only institutional (@${domain}) email addresses can register.`), { statusCode: 403, code: 'DOMAIN_NOT_ALLOWED' });
    }
  }

  // Check for duplicate email
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw Object.assign(new Error('An account with this email already exists.'), { statusCode: 409, code: 'DUPLICATE_EMAIL' });
  }

  // Auto-generate a unique temporary username
  const baseUsername = normalizedEmail.split('@')[0];
  let tempUsername = baseUsername;
  let counter = 1;
  while (await prisma.user.findUnique({ where: { username: tempUsername } })) {
    tempUsername = `${baseUsername}${counter}`;
    counter++;
  }

  // Create the user with hashed password
  const hashedPw = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      username: tempUsername,
      password: hashedPw,
      displayName,
      globalRing: 3, // Default: Member
      hasPassword: true,
      cohortTags: [],
      displayBadges: [],
      creditBalance: config.defaultCredits ?? 0,
    },
  });

  // Auto-assign cohort tags based on email parsing rules
  const tags = await assignCohortTags(user.id, normalizedEmail);

  // Fetch the updated user (with tags)
  const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });

  // Generate tokens
  const accessToken = signAccessToken(updatedUser);
  const refreshToken = signRefreshToken(updatedUser.id);

  // Store ONLY the hash of the refresh token
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: hashRefreshToken(refreshToken) },
  });

  return {
    accessToken,
    refreshToken,
    user: sanitizeUser(updatedUser),
  };
}

/**
 * Google OAuth Login/Register.
 * 1. Verify the Google ID token
 * 2. Find existing user by googleId or email
 * 3. If new user → create account (no password yet)
 * 4. Auto-assign cohort tags
 * 5. Return JWT pair + needsPassword + needsUsername flags
 */
async function googleLogin(idToken) {
  // Gate: institution must be configured
  const config = await prisma.institutionConfig.findFirst();
  if (!config || !config.isConfigured) {
    throw Object.assign(new Error('Registration is disabled. The platform has not been configured yet.'), { statusCode: 403, code: 'REGISTRATION_DISABLED' });
  }

  // Verify the Google token and get user info
  const googleUser = await verifyGoogleToken(idToken);
  const googleEmail = normalizeEmail(googleUser.email);

  // Look up user by googleId first, then by email
  let user = await prisma.user.findFirst({ where: { googleId: googleUser.googleId } });
  let isNewUser = false;

  if (!user) {
    // Check if an account with this email already exists (password-based)
    user = await prisma.user.findUnique({ where: { email: googleEmail } });

    if (user) {
      if (user.googleId && user.googleId !== googleUser.googleId) {
        throw Object.assign(
          new Error('This email is linked to a different Google account.'),
          { statusCode: 409, code: 'GOOGLE_LINK_CONFLICT' }
        );
      }
      if (user.hasPassword && !user.googleId) {
        // Never silently absorb a password account into a Google identity —
        // an attacker could pre-register a victim's email otherwise.
        throw Object.assign(
          new Error('An account with this email already exists. Please sign in with your email and password.'),
          { statusCode: 409, code: 'EMAIL_TAKEN' }
        );
      }
      // Link the existing Google-only account (or previously linked) to Google
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: googleUser.googleId },
      });
    } else {
      // Create brand new user — no password yet
      isNewUser = true;
      const baseUsername = googleEmail.split('@')[0];
      let tempUsername = baseUsername;
      let counter = 1;
      while (await prisma.user.findUnique({ where: { username: tempUsername } })) {
        tempUsername = `${baseUsername}${counter}`;
        counter++;
      }

      user = await prisma.user.create({
        data: {
          email: googleEmail,
          username: tempUsername,
          password: '', // No password — Google-only for now
          displayName: googleUser.name,
          avatarUrl: googleUser.picture,
          googleId: googleUser.googleId,
          hasPassword: false,
          globalRing: 3,
          cohortTags: [],
          displayBadges: [],
          creditBalance: config.defaultCredits ?? 0,
        },
      });

      // Auto-assign cohort tags
      await assignCohortTags(user.id, user.email);
      user = await prisma.user.findUnique({ where: { id: user.id } });
    }
  }

  // Generate tokens
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: hashRefreshToken(refreshToken) },
  });

  return {
    accessToken,
    refreshToken,
    user: sanitizeUser(user),
    needsPassword: !user.hasPassword,
    needsUsername: !user.username || user.username.includes('@') || /^\d+$/.test(user.username.replace(/[a-zA-Z]/g, '')), // Assuming a generated name is likely to look like this
    isNewUser,
  };
}

/**
 * Set password for a Google-only user (hasPassword === false), or change
 * the password of an existing account — the latter REQUIRES the current
 * password to prevent a stolen access token from taking over the account.
 */
async function setPassword(userId, newPassword, currentPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw Object.assign(new Error('User not found.'), { statusCode: 404, code: 'USER_NOT_FOUND' });
  }

  if (user.hasPassword) {
    if (!currentPassword) {
      throw Object.assign(
        new Error('Your current password is required to change your password.'),
        { statusCode: 400, code: 'CURRENT_PASSWORD_REQUIRED' }
      );
    }
    const valid = await comparePassword(currentPassword, user.password);
    if (!valid) {
      throw Object.assign(
        new Error('Current password is incorrect.'),
        { statusCode: 401, code: 'INVALID_CURRENT_PASSWORD' }
      );
    }
  }

  const hashedPw = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: {
      password: hashedPw,
      hasPassword: true,
      refreshToken: null, // Invalidate all sessions after a password change
    },
  });

  return { message: 'Password has been set successfully.' };
}

/**
 * Set a username for the user. Must be unique, 3-30 chars, alphanumeric + underscores.
 */
async function setUsername(userId, username) {
  // Validate username format
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    throw Object.assign(
      new Error('Username must be 3–30 characters, containing only letters, numbers, and underscores.'),
      { statusCode: 400, code: 'INVALID_USERNAME' }
    );
  }

  // Get current user to check cooldown
  const currentUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!currentUser) {
    throw Object.assign(new Error('User not found.'), { statusCode: 404, code: 'USER_NOT_FOUND' });
  }

  // Enforce 30-day cooldown (only if user already has a username)
  if (currentUser.username && currentUser.usernameChangedAt) {
    const daysSinceChange = (Date.now() - new Date(currentUser.usernameChangedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceChange < 30) {
      const daysLeft = Math.ceil(30 - daysSinceChange);
      throw Object.assign(
        new Error(`You can change your username again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`),
        { statusCode: 429, code: 'USERNAME_COOLDOWN' }
      );
    }
  }

  // Check uniqueness (case-insensitive)
  const existing = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
  });
  if (existing && existing.id !== userId) {
    throw Object.assign(
      new Error('This username is already taken.'),
      { statusCode: 409, code: 'USERNAME_TAKEN' }
    );
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { username, usernameChangedAt: new Date() },
  });

  return { message: 'Username set successfully.', username: user.username };
}

/**
 * Check if a username is available.
 */
async function checkUsername(username) {
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    return { available: false, reason: 'Invalid format. Use 3–30 alphanumeric characters or underscores.' };
  }

  const existing = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
  });

  return { available: !existing };
}

/**
 * Login an existing user.
 * 1. Find user by email
 * 2. Compare password hash
 * 3. Return JWT pair
 */
async function login(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !user.hasPassword) {
    // Identical message for unknown accounts and Google-only accounts —
    // prevents account enumeration.
    throw Object.assign(new Error('Invalid email or password.'), { statusCode: 401, code: 'INVALID_CREDENTIALS' });
  }

  const valid = await comparePassword(password, user.password);
  if (!valid) {
    throw Object.assign(new Error('Invalid email or password.'), { statusCode: 401, code: 'INVALID_CREDENTIALS' });
  }

  // Generate tokens
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user.id);

  // Store ONLY the hash of the refresh token
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: hashRefreshToken(refreshToken) },
  });

  return {
    accessToken,
    refreshToken,
    user: sanitizeUser(user),
  };
}

/**
 * Refresh an access token using a valid refresh token.
 * Rotates the refresh token on every use and detects reuse:
 * if a valid-signed token no longer matches the stored hash, the whole
 * session is revoked (the token was replayed or stolen).
 */
async function refreshAccessToken(token) {
  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw Object.assign(new Error('Invalid or expired refresh token.'), { statusCode: 401, code: 'INVALID_REFRESH_TOKEN' });
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
  if (!user) {
    throw Object.assign(new Error('Account no longer exists.'), { statusCode: 401, code: 'USER_NOT_FOUND' });
  }

  const presentedHash = hashRefreshToken(token);
  if (user.refreshToken !== presentedHash) {
    // Reuse of an old/revoked token — revoke the whole session.
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: null },
    });
    throw Object.assign(new Error('Refresh token has been revoked.'), { statusCode: 401, code: 'TOKEN_REVOKED' });
  }

  // Rotate: issue a fresh refresh token and store its hash.
  const newRefreshToken = signRefreshToken(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: hashRefreshToken(newRefreshToken) },
  });

  const accessToken = signAccessToken(user);
  return { accessToken, refreshToken: newRefreshToken };
}

/**
 * Logout — invalidate the refresh token.
 */
async function logout(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: null },
  });
}

/**
 * Forgot Password — generate a reset token and send via email service.
 *
 * @param {string} email - The user's email address
 */
async function forgotPassword(email) {
  const normalized = normalizeEmailKey(email);
  // Rate-limit per account (normalized address) BEFORE anything else —
  // prevents reset-email bombing and caps lookups for unknown addresses.
  await resetEmailLimiter.check(normalized);

  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    // Don't reveal whether the email exists — always return success
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  // Generate a random reset token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Store hashed token + 1 hour expiry
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken: hashedToken,
      resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    },
  });

  // Send via email service (console mode in dev, SMTP in prod)
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;
  try {
    await sendPasswordReset(email, resetUrl);
  } catch (err) {
    // Surface per-recipient backstop 429s — they are rate limits, not
    // delivery failures; other send errors are logged and ignored.
    if (err.code === 'RATE_LIMITED') throw err;
    console.error('[AUTH] Failed to send password reset email:', err.message);
  }

  return { message: 'If that email exists, a reset link has been sent.' };
}

/**
 * Reset Password — validate the token, update the password, clear the token.
 *
 * @param {string} token - The raw reset token from the URL
 * @param {string} newPassword - The new password
 */
async function resetPassword(token, newPassword) {
  // Hash the incoming token to compare with stored hash
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await prisma.user.findFirst({
    where: {
      resetToken: hashedToken,
      resetTokenExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    throw Object.assign(
      new Error('Invalid or expired reset token.'),
      { statusCode: 400, code: 'INVALID_RESET_TOKEN' }
    );
  }

  // Update password and clear reset token
  const hashedPw = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPw,
      hasPassword: true,
      resetToken: null,
      resetTokenExpiry: null,
      refreshToken: null, // Invalidate all sessions
    },
  });

  return { message: 'Password has been reset successfully. Please log in.' };
}

// ── Email-send rate limiting (verification + password reset) ────────────
// Shared per-key limiter factory (see utils/emailRateLimit.js): max 3 email
// ATTEMPTS per 10 minutes per key. The frontend also enforces a 60s
// client-side cooldown, and the emailService adds a per-recipient backstop
// for every send regardless of which flow triggered it.
const verifyEmailLimiter = createEmailSendLimiter({ message: 'Too many verification emails sent.' });
const resetEmailLimiter = createEmailSendLimiter({ message: 'Too many password reset emails sent.' });

/**
 * Report the current user's verification rate-limit state so the UI can
 * show an accurate countdown instead of a guess.
 */
function getVerifyRateLimitStatus(userId) {
  return verifyEmailLimiter.status(userId);
}

/**
 * Report the password-reset rate-limit state for an email address.
 */
function getResetRateLimitStatus(email) {
  return resetEmailLimiter.status(normalizeEmailKey(email));
}

/**
 * Send a verification email for the user's personal email.
 */
async function sendPersonalEmailVerification(userId, personalEmail) {
  await verifyEmailLimiter.check(userId);

  // The personal email must not already belong to another account (as a
  // primary or personal email) — otherwise an attacker could claim+verify
  // a victim's address on their own account.
  const normalized = normalizeEmail(personalEmail);
  const clash = await prisma.user.findFirst({
    where: {
      id: { not: userId },
      OR: [
        { email: normalized },
        { personalEmail: { equals: normalized, mode: 'default' } },
      ],
    },
    select: { id: true },
  });
  if (clash) {
    throw Object.assign(
      new Error('This email address is already in use by another account.'),
      { statusCode: 409, code: 'EMAIL_IN_USE' }
    );
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  await prisma.user.update({
    where: { id: userId },
    data: {
      personalEmail: normalized,
      personalEmailVerified: false,
      emailVerifyToken: hashedToken,
      emailVerifyExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    },
  });

  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${rawToken}`;
  try {
    await sendEmailVerification(normalized, verifyUrl);
  } catch (err) {
    // Surface per-recipient backstop 429s (see forgotPassword note).
    if (err.code === 'RATE_LIMITED') throw err;
    console.error('[AUTH] Failed to send email verification:', err.message);
  }

  return { message: 'Verification email sent.' };
}

/**
 * Remove the user's personal email and clear verification state.
 */
async function removePersonalEmail(userId) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      personalEmail: null,
      personalEmailVerified: false,
      emailVerifyToken: null,
      emailVerifyExpiry: null,
    },
  });
}

/**
 * Verify a personal email using the token.
 */
async function verifyPersonalEmail(token) {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await prisma.user.findFirst({
    where: {
      emailVerifyToken: hashedToken,
      emailVerifyExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    throw Object.assign(
      new Error('Invalid or expired verification token.'),
      { statusCode: 400, code: 'INVALID_VERIFY_TOKEN' }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      personalEmailVerified: true,
      emailVerifyToken: null,
      emailVerifyExpiry: null,
    },
  });

  return { message: 'Personal email verified successfully.' };
}

/**
 * Strip sensitive fields before returning user data to the client.
 */
function sanitizeUser(user) {
  const { password, refreshToken, resetToken, resetTokenExpiry, emailVerifyToken, emailVerifyExpiry, ...safe } = user;
  return safe;
}

module.exports = {
  register,
  login,
  googleLogin,
  setPassword,
  setUsername,
  checkUsername,
  refreshAccessToken,
  logout,
  forgotPassword,
  resetPassword,
  sendPersonalEmailVerification,
  getVerifyRateLimitStatus,
  getResetRateLimitStatus,
  removePersonalEmail,
  verifyPersonalEmail,
  sanitizeUser,
  normalizeEmail,
};

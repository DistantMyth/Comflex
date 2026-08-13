/**
 * Auth Routes — /api/v1/auth/*
 * 
 * Handles: register, login, logout, refresh token, Google OAuth,
 * password management, username, email verification.
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const authService = require('../services/authService');
const authMiddleware = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimit');
const { success, error } = require('../utils/apiResponse');
const { setRefreshCookie, clearRefreshCookie, REFRESH_COOKIE_NAME } = require('../utils/refreshCookie');
const env = require('../config/env');

const router = express.Router();

// General per-IP throttle for all auth endpoints (login/register/refresh/etc.)
router.use(rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'Too many authentication requests from this IP.',
  keyPrefix: 'auth-ip',
}));

// Per-account login throttling — keyed by the normalized email so a brute
// force against ONE account is capped even when distributed across IPs.
const loginEmailLimit = rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts for this account. Try again later.',
  keyPrefix: 'auth-login-email',
  keyFn: (req) => (typeof req.body?.email === 'string' ? authService.normalizeEmail(req.body.email) : null),
});

/**
 * POST /api/v1/auth/register
 * Create a new user account (email/password — legacy flow).
 */
router.post(
  '/register',
  [
    body('email').isEmail().withMessage('A valid email is required.'),
    body('password').isLength({ min: 8, max: 72 }).withMessage('Password must be 8–72 characters.'),
    body('displayName').trim().isLength({ min: 2, max: 50 }).withMessage('Display name must be 2–50 characters.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const { email, password, displayName } = req.body;
      const result = await authService.register(email, password, displayName);
      setRefreshCookie(res, result.refreshToken);
      return success(res, result, 201);
    } catch (err) {
      if (err.statusCode) {
        return error(res, err.code, err.message, err.statusCode);
      }
      next(err);
    }
  }
);

/**
 * POST /api/v1/auth/google
 * Login or register via Google OAuth.
 * Expects: { idToken } from the frontend Google Sign-In.
 */
router.post(
  '/google',
  [body('idToken').notEmpty().withMessage('Google ID token is required.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const result = await authService.googleLogin(req.body.idToken);
      setRefreshCookie(res, result.refreshToken);
      return success(res, result);
    } catch (err) {
      if (err.statusCode) {
        return error(res, err.code, err.message, err.statusCode);
      }
      next(err);
    }
  }
);

/**
 * POST /api/v1/auth/set-password
 * Set password for a Google-only user (no password yet), or change it with
 * the current password. Requires authentication.
 */
router.post(
  '/set-password',
  authMiddleware,
  [
    body('newPassword').isLength({ min: 8, max: 72 }).withMessage('Password must be 8–72 characters.'),
    body('currentPassword').optional().isString().withMessage('Current password must be a string.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const result = await authService.setPassword(req.user.id, req.body.newPassword, req.body.currentPassword);
      clearRefreshCookie(res);
      return success(res, result);
    } catch (err) {
      if (err.statusCode) {
        return error(res, err.code, err.message, err.statusCode);
      }
      next(err);
    }
  }
);

/**
 * POST /api/v1/auth/set-username
 * Choose a username. Requires authentication.
 */
router.post(
  '/set-username',
  authMiddleware,
  [body('username').trim().isLength({ min: 3, max: 30 }).withMessage('Username must be 3–30 characters.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const result = await authService.setUsername(req.user.id, req.body.username);
      return success(res, result);
    } catch (err) {
      if (err.statusCode) {
        return error(res, err.code, err.message, err.statusCode);
      }
      next(err);
    }
  }
);

/**
 * GET /api/v1/auth/check-username/:username
 * Check if a username is available. Public endpoint.
 */
router.get('/check-username/:username', async (req, res, next) => {
  try {
    const result = await authService.checkUsername(req.params.username);
    return success(res, result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/login
 * Authenticate with email/password and receive JWT + refresh token.
 */
router.post(
  '/login',
  loginEmailLimit,
  [
    body('email').isEmail().withMessage('A valid email is required.'),
    body('password').notEmpty().withMessage('Password is required.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const { email, password } = req.body;
      const result = await authService.login(email, password);
      setRefreshCookie(res, result.refreshToken);
      return success(res, result);
    } catch (err) {
      if (err.statusCode) {
        return error(res, err.code, err.message, err.statusCode);
      }
      next(err);
    }
  }
);

/**
 * POST /api/v1/auth/refresh
 * Issue a new access token using a valid refresh token.
 * The token may arrive via the httpOnly cookie (recommended) or the body.
 */
router.post(
  '/refresh',
  [
    body('refreshToken').optional().isString(),
    body('x-csrf-token').optional().isString(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      // CSRF guard: when the refresh token comes via cookie (cross-site
      // SameSite=None path), only accept requests whose Origin is ours
      // or absent (same-origin navigations / curl).
      const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body.refreshToken;
      if (!token) {
        return error(res, 'VALIDATION_ERROR', 'Refresh token is required.', 400);
      }

      const origin = req.headers.origin;
      if (origin) {
        const allowed = new Set([env.FRONTEND_URL]);
        if (env.NODE_ENV !== 'production') allowed.add('http://localhost:5173');
        let originOk = false;
        for (const a of allowed) {
          if (origin.toLowerCase() === a.toLowerCase()) originOk = true;
        }
        if (!originOk) {
          return error(res, 'FORBIDDEN', 'Cross-origin refresh requests are not allowed.', 403);
        }
      }

      const result = await authService.refreshAccessToken(token);
      if (result.refreshToken) {
        // Rotated refresh token — set it as a fresh cookie.
        setRefreshCookie(res, result.refreshToken);
      }
      return success(res, result);
    } catch (err) {
      if (err.statusCode) {
        clearRefreshCookie(res);
        return error(res, err.code, err.message, err.statusCode);
      }
      next(err);
    }
  }
);

/**
 * POST /api/v1/auth/logout
 * Invalidate the current session / refresh token.
 */
router.post('/logout', authMiddleware, async (req, res, next) => {
  try {
    await authService.logout(req.user.id);
    clearRefreshCookie(res);
    return success(res, { message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/forgot-password
 * Rate-limited tighter per IP — this endpoint sends an email.
 */
router.post('/forgot-password', rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many password reset requests from this IP.',
  keyPrefix: 'auth-forgot-ip',
}), [
    body('email').isEmail().withMessage('A valid email is required.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      await authService.forgotPassword(req.body.email);
      return success(res, { message: 'If an account exists for that email, a reset link has been sent.' });
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

/**
 * GET /api/v1/auth/reset-email-status?email=
 * Report password-reset rate-limit state (public — limiter state only, no PII).
 * Rate-limited per IP so attackers can't scrape limiter state for arbitrary
 * addresses or use it as an enumeration oracle.
 */
router.get('/reset-email-status', rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Too many status checks from this IP.',
  keyPrefix: 'auth-reset-status-ip',
}), async (req, res, next) => {
  try {
    const status = authService.getResetRateLimitStatus(req.query.email);
    return success(res, status);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/reset-password
 * Reset password using the token from the reset email.
 */
router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required.'),
    body('newPassword').isLength({ min: 8, max: 72 }).withMessage('Password must be 8–72 characters.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const result = await authService.resetPassword(req.body.token, req.body.newPassword);
      return success(res, result);
    } catch (err) {
      if (err.statusCode) {
        return error(res, err.code, err.message, err.statusCode);
      }
      next(err);
    }
  }
);

/**
 * POST /api/v1/auth/verify-personal-email
 * Verify a personal email using the verification token.
 */
router.post(
  '/verify-personal-email',
  [body('token').notEmpty().withMessage('Verification token is required.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const result = await authService.verifyPersonalEmail(req.body.token);
      return success(res, result);
    } catch (err) {
      if (err.statusCode) {
        return error(res, err.code, err.message, err.statusCode);
      }
      next(err);
    }
  }
);

module.exports = router;

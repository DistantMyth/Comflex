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

const router = express.Router();

// General per-IP throttle for all auth endpoints (login/register/refresh/etc.)
router.use(rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'Too many authentication requests from this IP.',
  keyPrefix: 'auth-ip',
}));

/**
 * POST /api/v1/auth/register
 * Create a new user account (email/password — legacy flow).
 */
router.post(
  '/register',
  [
    body('email').isEmail().withMessage('A valid email is required.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
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
 * Set password for a Google-only user (no password yet).
 * Requires authentication.
 */
router.post(
  '/set-password',
  authMiddleware,
  [body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const result = await authService.setPassword(req.user.id, req.body.newPassword);
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
 */
router.post(
  '/refresh',
  [body('refreshToken').notEmpty().withMessage('Refresh token is required.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const result = await authService.refreshAccessToken(req.body.refreshToken);
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
 * POST /api/v1/auth/logout
 * Invalidate the current session / refresh token.
 */
router.post('/logout', authMiddleware, async (req, res, next) => {
  try {
    await authService.logout(req.user.id);
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
 */
router.get('/reset-email-status', async (req, res, next) => {
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
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
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

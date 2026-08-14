/**
 * User Routes — /api/v1/users/*
 * 
 * Handles: get own profile, update profile, upload avatar.
 * See /docs/api/users.md for the full contract.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const authMiddleware = require('../middleware/auth');
const userService = require('../services/userService');
const { rateLimiter } = require('../middleware/rateLimit');
const { success, error } = require('../utils/apiResponse');
const { storeFile } = require('../utils/fileStorage');
const { validateStoredFile } = require('../utils/fileMagic');

const router = express.Router();

// ============================================================
// Avatar Upload Config (multer)
// Stored locally in /uploads for dev; use S3 in production.
// ============================================================
const uploadDir = env.STORAGE_PATH;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `avatar-${req.user.id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
    }
  },
});

/**
 * GET /api/v1/users/me
 * Retrieve the authenticated user's profile.
 */
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    let user = await userService.getUserById(req.user.id);
    return success(res, user);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * PATCH /api/v1/users/me
 * Update display name, bio, badge selection, CF handle, personal email, etc.
 */
// Per-IP throttles for PATCH /me — the general one protects the endpoint,
// the conditional one counts only verification-email sends so multi-account
// attackers can't spam the email service from one IP.
const patchMeIpLimit = rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 100,
  message: 'Too many profile update requests from this IP.',
  keyPrefix: 'users-patch-ip',
});
const verifyEmailIpLimit = rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many verification emails requested from this IP.',
  keyPrefix: 'verify-email-ip',
  shouldCount: (req) => typeof req.body?.personalEmail === 'string' && req.body.personalEmail.length > 0,
});

router.patch(
  '/me',
  authMiddleware,
  patchMeIpLimit,
  verifyEmailIpLimit,
  [
    body('displayName').optional().trim().isLength({ min: 2, max: 50 }),
    body('bio').optional().isLength({ max: 500 }),
    body('displayBadges').optional().isArray({ max: 5 }),
    body('cfHandle').optional().isString(),
    // personalEmail: valid email to (re)set, or null/'' to remove
    body('personalEmail')
      .optional({ values: 'null' })
      .custom((value) =>
        value === '' || (typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      )
      .withMessage('Invalid personal email.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      // personalEmail handling: null/'' removes it, a real email triggers verification
      if (req.body.personalEmail !== undefined) {
        const authService = require('../services/authService');
        if (req.body.personalEmail === null || req.body.personalEmail === '') {
          await authService.removePersonalEmail(req.user.id);
        } else {
          await authService.sendPersonalEmailVerification(req.user.id, req.body.personalEmail);
        }
        delete req.body.personalEmail; // Don't pass to generic update
      }

      const user = await userService.updateProfile(req.user.id, req.body);
      return success(res, user);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

/**
 * POST /api/v1/users/me/avatar
 * Upload a profile picture (JPEG/PNG/WebP, max 5MB).
 */
router.get('/me/personal-email/status', authMiddleware, async (req, res, next) => {
  try {
    const authService = require('../services/authService');
    const status = authService.getVerifyRateLimitStatus(req.user.id);
    return success(res, status);
  } catch (err) {
    next(err);
  }
});

router.post('/me/avatar', authMiddleware, upload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) {
      return error(res, 'UPLOAD_REQUIRED', 'No file uploaded. Please attach an image.', 400);
    }

    // Magic-byte check regardless of the client-declared mimetype — a spoofed
    // Content-Type must not skip the header inspection.
    if (!validateStoredFile(req.file.path, req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return error(res, 'INVALID_FILE_TYPE', 'The uploaded file is not a valid image.', 400);
    }
    const avatarUrl = await storeFile(req.file, { folder: 'comflex/avatars' });
    const user = await userService.updateAvatar(req.user.id, avatarUrl);
    return success(res, user);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * GET /api/v1/users/me/tags
 * Retrieve the current user's cohort tags.
 */
router.get('/me/tags', authMiddleware, async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.user.id);
    return success(res, { cohortTags: user.cohortTags });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/users/search?q=<query>
 * Public (authenticated) user search — for friend finder, mentions, etc.
 * Searches by partial username, email, or displayName.
 * Returns max 10 results, excludes the requesting user.
 */
router.get('/search', authMiddleware, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return success(res, []);
    }

    const prisma = require('../prisma');
    const users = await prisma.user.findMany({
      where: {
        id: { not: req.user.id },
        OR: [
          { username: { startsWith: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        displayName: true,
        username: true,
        avatarUrl: true,
        bio: true,
        globalRing: true,
        cohortTags: true,
      },
      take: 10,
      orderBy: { displayName: 'asc' },
    });

    // Fetch friendship statuses for these users
    const userIds = users.map(u => u.id);
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { requesterId: req.user.id, addresseeId: { in: userIds } },
          { requesterId: { in: userIds }, addresseeId: req.user.id },
        ],
      },
    });

    const result = users.map(u => {
      const f = friendships.find(f => (f.requesterId === u.id || f.addresseeId === u.id));
      return {
        ...u,
        friendshipStatus: f ? f.status : null,
        friendshipId: f ? f.id : null,
        isRequester: f ? f.requesterId === req.user.id : null,
      };
    });

    return success(res, result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/users/:id/profile
 * View any user's public profile by ID.
 */
router.get('/:id/profile', authMiddleware, async (req, res, next) => {
  try {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid user id.', 400);
    }
    const prisma = require('../prisma');
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        displayName: true,
        username: true,
        avatarUrl: true,
        bio: true,
        globalRing: true,
        cohortTags: true,
        cfHandle: true,
        cfRating: true,
        displayBadges: true,
        createdAt: true,
      },
    });
    if (!user) {
      return error(res, 'USER_NOT_FOUND', 'User not found.', 404);
    }

    // Check friendship status with requesting user
    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: req.user.id, addresseeId: req.params.id },
          { requesterId: req.params.id, addresseeId: req.user.id },
        ],
      },
    });

    return success(res, {
      ...user,
      friendshipStatus: friendship ? friendship.status : null,
      friendshipId: friendship ? friendship.id : null,
      isRequester: friendship ? friendship.requesterId === req.user.id : null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

/**
 * Friend Routes — /api/v1/friends/*
 *
 * Handles: list friends, pending/sent requests, send/accept/reject/remove.
 * All routes require authentication.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const friendService = require('../services/friendService');
const { success, error } = require('../utils/apiResponse');

const router = express.Router();

// All friend routes require authentication
router.use(authMiddleware);

/**
 * GET /api/v1/friends — List accepted friends.
 */
router.get('/', async (req, res, next) => {
  try {
    const friends = await friendService.listFriends(req.user.id);
    return success(res, friends);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/friends/requests — List incoming pending requests.
 */
router.get('/requests', async (req, res, next) => {
  try {
    const requests = await friendService.listPendingRequests(req.user.id);
    return success(res, requests);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/friends/sent — List outgoing pending requests.
 */
router.get('/sent', async (req, res, next) => {
  try {
    const requests = await friendService.listSentRequests(req.user.id);
    return success(res, requests);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/friends/request — Send a friend request.
 * Body: { userId: string }
 * Per-user throttle: max 30 outgoing requests per 10 minutes so a single
 * account can't spam the recipient's inbox with requests.
 */
const requestLimit = require('../middleware/rateLimit').rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Too many friend requests sent. Try again later.',
  keyPrefix: 'friend-request-ip',
});

router.post(
  '/request',
  requestLimit,
  [body('userId').notEmpty().withMessage('userId is required.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }
      if (!/^[0-9a-fA-F]{24}$/.test(req.body.userId)) {
        return error(res, 'VALIDATION_ERROR', 'Invalid userId.', 400);
      }

      const result = await friendService.sendRequest(req.user.id, req.body.userId);
      return success(res, result, 201);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

const ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * POST /api/v1/friends/:id/accept — Accept a friend request.
 */
router.post('/:id/accept', async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.id)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid request id.', 400);
    }
    const result = await friendService.acceptRequest(req.params.id, req.user.id);
    return success(res, result);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * POST /api/v1/friends/:id/reject — Reject a friend request.
 */
router.post('/:id/reject', async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.id)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid request id.', 400);
    }
    const result = await friendService.rejectRequest(req.params.id, req.user.id);
    return success(res, result);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * DELETE /api/v1/friends/:id — Remove a friend (unfriend).
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.id)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid friend id.', 400);
    }
    const result = await friendService.removeFriend(req.params.id, req.user.id);
    return success(res, result);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

module.exports = router;

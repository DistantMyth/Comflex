/**
 * Notifications API — in-app notification bell endpoints.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { success, error } = require('../utils/apiResponse');

const router = express.Router();

// All notification routes require authentication
router.use(authMiddleware);

/**
 * GET /api/v1/notifications — list notifications for the current user
 * Query: page, limit
 */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const result = await notificationService.listNotifications(req.user.id, { page, limit });
    return success(res, result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/notifications/unread-count — unread count for the badge
 */
router.get('/unread-count', async (req, res, next) => {
  try {
    const unread = await notificationService.getUnreadCount(req.user.id);
    return success(res, { unread });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/notifications/read-all — mark everything as read
 */
router.post('/read-all', async (req, res, next) => {
  try {
    const result = await notificationService.markAllRead(req.user.id);
    return success(res, result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/notifications/mark-read — mark by filter (type and/or actorId)
 * Body: { type?, actorId? } — marks ALL unread matching. No body marks all.
 */
router.post('/mark-read', async (req, res, next) => {
  try {
    const { type, actorId } = req.body || {};
    const result = await notificationService.markReadByFilter(req.user.id, { type, actorId });
    return success(res, result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/notifications/:id/read — mark one notification as read
 */
router.post('/:id/read', async (req, res, next) => {
  try {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid notification id.', 400);
    }
    const result = await notificationService.markRead(req.user.id, req.params.id);
    if (result.updated === 0) {
      return error(res, 'NOT_FOUND', 'Notification not found.', 404);
    }
    return success(res, result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

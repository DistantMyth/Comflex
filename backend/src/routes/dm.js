/**
 * DM Routes — /api/v1/dm/*
 *
 * Handles: list conversations, get/send messages, mark read, delete.
 * All routes require authentication + friendship with the target user.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const authMiddleware = require('../middleware/auth');
const dmService = require('../services/dmService');
const { rateLimiter } = require('../middleware/rateLimit');
const { success, error } = require('../utils/apiResponse');
const { storeFile } = require('../utils/fileStorage');
const { validateStoredFile } = require('../utils/fileMagic');

const router = express.Router();

const ID_RE = /^[0-9a-fA-F]{24}$/;

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
    cb(null, `dm-${req.user.id}-${Date.now()}${ext}`);
  },
});

// DM attachments — common media + documents only. Executable formats
// (.html/.svg/.js) are rejected to prevent same-origin stored XSS.
const ALLOWED_DM_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  '.pdf', '.txt', '.md', '.csv',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.rar', '.7z', '.mp3', '.mp4', '.mov', '.webm',
];
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_DM_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only common media and document types are allowed.'));
    }
  },
});


// All DM routes require authentication
router.use(authMiddleware);

// Per-user throttle on DM attachments — blocks storage/Cloudinary exhaustion
// via unbounded uploads from a single account.
const dmUploadLimit = rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many file uploads. Please slow down.',
  keyPrefix: 'dm-upload-user',
  keyFn: (req) => req.user?.id || null,
});

/**
 * POST /api/v1/dm/upload — Upload a file attachment for a DM.
 * Returns the file data including its URL.
 */
router.post('/upload', dmUploadLimit, upload.single('attachment'), async (req, res, next) => {
  try {
    if (!req.file) {
      return error(res, 'UPLOAD_REQUIRED', 'No file uploaded.', 400);
    }
    if (!validateStoredFile(req.file.path, req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return error(res, 'INVALID_FILE_TYPE', 'The uploaded file header does not match its type.', 400);
    }
    const fileUrl = await storeFile(req.file, { folder: 'comflex/dm' });
    return success(res, {
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/dm — List all DM conversations.
 * Returns partner info, last message, and unread count.
 */
router.get('/', async (req, res, next) => {
  try {
    const conversations = await dmService.listConversations(req.user.id);
    return success(res, conversations);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/dm/:userId — Get messages with a specific user.
 * Query: ?page=1&limit=50
 */
router.get('/:userId', async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.userId)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid userId.', 400);
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 100);
    const result = await dmService.getConversation(req.user.id, req.params.userId, { page, limit });
    return success(res, result);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * POST /api/v1/dm/:userId — Send a DM to a user.
 * Body: { content: string }
 */
router.post(
  '/:userId',
  [body('content').trim().notEmpty().withMessage('Message content is required.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }
      if (!ID_RE.test(req.params.userId)) {
        return error(res, 'VALIDATION_ERROR', 'Invalid userId.', 400);
      }

      const message = await dmService.sendDM(req.user.id, req.params.userId, req.body);
      return success(res, message, 201);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

/**
 * PUT /api/v1/dm/messages/:msgId — Edit a DM (own messages only).
 */
router.put('/messages/:msgId', [body('content').trim().notEmpty().withMessage('Message content is required.')], async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.msgId)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid message id.', 400);
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400, errors.array().map(e => ({ field: e.path, issue: e.msg })));
    }
    const result = await dmService.editDM(req.params.msgId, req.user.id, req.body.content);
    return success(res, result);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * PATCH /api/v1/dm/:userId/read — Mark all messages from a user as read.
 */
router.patch('/:userId/read', async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.userId)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid userId.', 400);
    }
    const result = await dmService.markAsRead(req.user.id, req.params.userId);
    return success(res, result);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/dm/messages/:msgId — Soft-delete a DM (own messages only).
 */
router.delete('/messages/:msgId', async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.msgId)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid message id.', 400);
    }
    const result = await dmService.deleteDM(req.params.msgId, req.user.id);
    return success(res, result);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

module.exports = router;

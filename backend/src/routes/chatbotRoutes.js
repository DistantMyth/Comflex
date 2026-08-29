const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const authMiddleware = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimit');
const prisma = require('../prisma');
const { success, error } = require('../utils/apiResponse');
const { uploadFileToGemini, deleteGeminiFile, chatWithContext } = require('../services/chatbotService');
const { enforceBatchAccess } = require('../utils/batchAccess');
const { validateStoredFile } = require('../utils/fileMagic');

const router = express.Router();

const ID_RE = /^[0-9a-fA-F]{24}$/;

const uploadDir = path.join(env.STORAGE_PATH, 'chatbot');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `cb-${suffix}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max per file

router.use(authMiddleware);

// Dedicated rate limiters
const uploadRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Upload limit reached. Please wait a few minutes before uploading more notes.',
  keyFn: (req) => req.user?.id || req.ip,
  keyPrefix: 'chatbot-upload-user',
});

const chatRateLimiter = rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: 'Too many chat requests. Please slow down.',
  keyFn: (req) => req.user?.id || req.ip,
  keyPrefix: 'chatbot-chat-user',
});

// Middleware to daily-reset counters with UTC boundary
async function checkAndResetDailyLimits(req, res, next) {
  try {
    let user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return error(res, 'AUTH_ERROR', 'User not found.', 401);

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const lastUpload = user.lastUploadDate ? new Date(user.lastUploadDate) : new Date(0);

    if (lastUpload < todayStart) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { dailyUploadCount: 0, dailyChatTokens: 20, lastUploadDate: new Date() }
      });
    }
    
    // Apply null safety for older user records
    user.chatbotStorageUsed = user.chatbotStorageUsed || 0;
    user.dailyUploadCount = user.dailyUploadCount || 0;
    user.dailyChatTokens = user.dailyChatTokens ?? 20;

    req.dbUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

const FREE_LIMITS = { uploads: 2, storage: 50 * 1024 * 1024 }; // 50MB total

const ALLOWED_MIMES = ['application/pdf', 'application/rtf', 'text/csv', 'text/plain', 'text/markdown'];
const ALLOWED_EXTENSIONS = ['.pdf', '.rtf', '.csv', '.txt', '.md', '.markdown'];
function isMimeAllowed(mime) {
  return ALLOWED_MIMES.includes(mime);
}
function isExtAllowed(filename) {
  return ALLOWED_EXTENSIONS.includes(path.extname(filename || '').toLowerCase());
}

// GET my notes
router.get('/', async (req, res, next) => {
  try {
    const notes = await prisma.chatbotNote.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
    return success(res, notes);
  } catch (err) {
    next(err);
  }
});

// GET user limits
router.get('/limits', checkAndResetDailyLimits, (req, res) => {
  const user = req.dbUser;
  return success(res, {
    dailyUploadCount: user.dailyUploadCount,
    maxUploads: FREE_LIMITS.uploads,
    dailyChatTokens: user.dailyChatTokens,
    storageUsed: user.chatbotStorageUsed,
    maxStorage: FREE_LIMITS.storage
  });
});

// POST upload local file
router.post('/upload/local', uploadRateLimiter, checkAndResetDailyLimits, upload.single('file'), async (req, res, next) => {
  let reserved = false;
  let geminiData = null;
  const tempPath = req.file ? req.file.path : null;

  try {
    const user = req.dbUser;
    if (!req.file) return error(res, 'VALIDATION', 'No file uploaded', 400);

    const rawTitle = (req.body.title || req.file.originalname || '').trim();
    const finalTitle = rawTitle.slice(0, 100) || 'Untitled Note';

    if (!isMimeAllowed(req.file.mimetype) || !isExtAllowed(req.file.originalname)) {
      return error(res, 'UNSUPPORTED_FORMAT', 'Unsupported file format. Please upload PDF, TXT, CSV, or Markdown files.', 400);
    }

    // Header check — magic bytes
    if (!validateStoredFile(req.file.path, req.file.mimetype)) {
      return error(res, 'UNSUPPORTED_FORMAT', 'The uploaded file header does not match its type.', 400);
    }

    const existingNote = await prisma.chatbotNote.findFirst({ where: { userId: user.id, title: finalTitle } });
    if (existingNote) return error(res, 'ALREADY_EXISTS', 'A note with this name already exists.', 409);

    // Atomically reserve quota to prevent race conditions
    const updateResult = await prisma.user.updateMany({
      where: {
        id: user.id,
        dailyUploadCount: { lt: FREE_LIMITS.uploads },
        chatbotStorageUsed: { lte: FREE_LIMITS.storage - req.file.size }
      },
      data: {
        dailyUploadCount: { increment: 1 },
        chatbotStorageUsed: { increment: req.file.size }
      }
    });

    if (updateResult.count === 0) {
      return error(res, 'LIMIT_EXCEEDED', 'Daily upload limit (2/day) or storage limit (50MB) reached.', 429);
    }
    reserved = true;

    // Upload to Gemini
    geminiData = await uploadFileToGemini(req.file.path, req.file.mimetype, finalTitle);

    const note = await prisma.chatbotNote.create({
      data: {
        userId: user.id,
        title: finalTitle,
        geminiFileUri: geminiData.uri,
        geminiFileName: geminiData.name,
        fileSize: req.file.size,
        mimetype: req.file.mimetype
      }
    });

    return success(res, note, 201);
  } catch (err) {
    if (reserved) {
      try {
        await prisma.user.update({
          where: { id: req.user.id },
          data: {
            dailyUploadCount: { decrement: 1 },
            chatbotStorageUsed: { decrement: req.file ? req.file.size : 0 }
          }
        });
      } catch { /* ignore */ }
    }
    if (geminiData?.name) {
      deleteGeminiFile(geminiData.name).catch(() => {});
    }
    next(err);
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    }
  }
});

// POST upload from resource
router.post('/upload/resource', uploadRateLimiter, checkAndResetDailyLimits, [
  body('resourceId').notEmpty().isString()
], async (req, res, next) => {
  let reserved = false;
  let geminiData = null;
  let physicalPath = null;
  let isTempRemoteFile = false;

  try {
    const errs = validationResult(req);
    if (!errs.isEmpty() || !ID_RE.test(req.body.resourceId)) return error(res, 'VALIDATION', 'Invalid resourceId', 400);

    const user = req.dbUser;

    const resource = await prisma.resource.findUnique({ where: { id: req.body.resourceId } });
    if (!resource) return error(res, 'NOT_FOUND', 'Resource not found', 404);

    const resSubject = await prisma.resourceSubject.findUnique({ where: { id: resource.subjectId } });
    if (!resSubject || !enforceBatchAccess(req, resSubject.subCategory, resSubject.yearGroup)) {
      return error(res, 'FORBIDDEN', 'You only have access to your own batch and your immediate juniors.', 403);
    }

    if (!isMimeAllowed(resource.mimetype) || !isExtAllowed(resource.fileName)) {
      return error(res, 'UNSUPPORTED_FORMAT', 'Resource format not supported by Gemini (use PDF, TXT, CSV, MD).', 400);
    }

    const rawTitle = (resource.title || resource.fileName || '').trim();
    const finalTitle = rawTitle.slice(0, 100) || 'Untitled Resource Note';

    const existingNote = await prisma.chatbotNote.findFirst({ where: { userId: user.id, title: finalTitle } });
    if (existingNote) return error(res, 'ALREADY_EXISTS', 'This resource has already been added to your notes.', 409);

    // Atomically reserve quota
    const updateResult = await prisma.user.updateMany({
      where: {
        id: user.id,
        dailyUploadCount: { lt: FREE_LIMITS.uploads },
        chatbotStorageUsed: { lte: FREE_LIMITS.storage - resource.fileSize }
      },
      data: {
        dailyUploadCount: { increment: 1 },
        chatbotStorageUsed: { increment: resource.fileSize }
      }
    });

    if (updateResult.count === 0) {
      return error(res, 'LIMIT_EXCEEDED', 'Daily upload limit (2/day) or storage limit (50MB) reached.', 429);
    }
    reserved = true;

    // Resolve physical file path (local or remote Cloudinary)
    if (resource.fileUrl.startsWith('http://') || resource.fileUrl.startsWith('https://')) {
      const https = require('https');
      const http = require('http');
      const tempPath = path.join(uploadDir, `res-temp-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(resource.fileName || '')}`);
      const client = resource.fileUrl.startsWith('https') ? https : http;
      
      await new Promise((resolve, reject) => {
        client.get(resource.fileUrl, (resp) => {
          if (resp.statusCode !== 200) {
            return reject(new Error(`Failed to fetch remote resource: ${resp.statusCode}`));
          }
          const fileStream = fs.createWriteStream(tempPath);
          resp.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
          fileStream.on('error', reject);
        }).on('error', reject);
      });
      physicalPath = tempPath;
      isTempRemoteFile = true;
    } else {
      physicalPath = path.resolve(env.STORAGE_PATH, resource.fileUrl.replace(/^\/?uploads\//, ''));
      if (!fs.existsSync(physicalPath)) {
        const altPath = path.join(__dirname, '../../', resource.fileUrl);
        if (fs.existsSync(altPath)) {
          physicalPath = altPath;
        } else {
          return error(res, 'FILE_MISSING', 'Physical resource file missing on server.', 404);
        }
      }
    }

    geminiData = await uploadFileToGemini(physicalPath, resource.mimetype, resource.fileName);

    const note = await prisma.chatbotNote.create({
      data: {
        userId: user.id,
        title: finalTitle,
        geminiFileUri: geminiData.uri,
        geminiFileName: geminiData.name,
        fileSize: resource.fileSize,
        mimetype: resource.mimetype
      }
    });

    return success(res, note, 201);
  } catch (err) {
    if (reserved) {
      try {
        await prisma.user.update({
          where: { id: req.user.id },
          data: {
            dailyUploadCount: { decrement: 1 },
            chatbotStorageUsed: { decrement: resource ? resource.fileSize : 0 }
          }
        });
      } catch { /* ignore */ }
    }
    if (geminiData?.name) {
      deleteGeminiFile(geminiData.name).catch(() => {});
    }
    next(err);
  } finally {
    if (isTempRemoteFile && physicalPath && fs.existsSync(physicalPath)) {
      try { fs.unlinkSync(physicalPath); } catch { /* ignore */ }
    }
  }
});

// DELETE /:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.id)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid note id.', 400);
    }
    const note = await prisma.chatbotNote.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!note) return error(res, 'NOT_FOUND', 'Note not found.', 404);

    await deleteGeminiFile(note.geminiFileName);
    await prisma.chatbotNote.delete({ where: { id: note.id } });
    await prisma.user.update({
      where: { id: req.user.id },
      data: { chatbotStorageUsed: { decrement: note.fileSize } }
    });

    return success(res, { message: 'Note deleted.' });
  } catch (err) {
    next(err);
  }
});

// POST /chat
router.post('/chat', chatRateLimiter, checkAndResetDailyLimits, [
  body('noteId').notEmpty().isString(),
  body('query').notEmpty().isString(),
  body('history').optional().isArray()
], async (req, res, next) => {
  let tokenDeducted = false;
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty() || !ID_RE.test(req.body.noteId)) return error(res, 'VALIDATION', 'Invalid data', 400);

    const user = req.dbUser;

    // Atomically decrement 1 chat token
    const updateResult = await prisma.user.updateMany({
      where: { id: user.id, dailyChatTokens: { gt: 0 } },
      data: { dailyChatTokens: { decrement: 1 } }
    });

    if (updateResult.count === 0) {
      return error(res, 'LIMIT_EXCEEDED', 'You are out of chat tokens today. Please try again tomorrow.', 403);
    }
    tokenDeducted = true;

    const note = await prisma.chatbotNote.findFirst({
      where: { id: req.body.noteId, userId: req.user.id }
    });
    if (!note) {
      // Refund token
      await prisma.user.update({ where: { id: user.id }, data: { dailyChatTokens: { increment: 1 } } });
      tokenDeducted = false;
      return error(res, 'NOT_FOUND', 'Linked note not found.', 404);
    }

    const answer = await chatWithContext(
      { fileUri: note.geminiFileUri, mimeType: note.mimetype },
      req.body.query,
      req.body.history || []
    );

    const freshUser = await prisma.user.findUnique({ where: { id: user.id }, select: { dailyChatTokens: true } });

    return success(res, { answer, remainingTokens: freshUser?.dailyChatTokens ?? (user.dailyChatTokens - 1) });
  } catch (err) {
    if (tokenDeducted) {
      try {
        await prisma.user.update({
          where: { id: req.user.id },
          data: { dailyChatTokens: { increment: 1 } }
        });
      } catch { /* ignore */ }
    }
    next(err);
  }
});

module.exports = router;

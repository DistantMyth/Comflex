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

// Middleware to daily-reset counters
async function checkAndResetDailyLimits(req, res, next) {
  let user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(401).json({ error: 'User not found' });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const lastUpload = user.lastUploadDate || new Date(0);

  if (lastUpload < todayStart) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { dailyUploadCount: 0, dailyChatTokens: 20, lastUploadDate: new Date() }
    });
  }
  
  // Apply null safety for old users
  user.subscriptionPlan = user.subscriptionPlan || 'free';
  user.chatbotStorageUsed = user.chatbotStorageUsed || 0;
  user.dailyUploadCount = user.dailyUploadCount || 0;
  user.dailyChatTokens = user.dailyChatTokens ?? 20;

  req.dbUser = user;
  next();
}

const TIER_LIMITS = {
  free: { uploads: 2, storage: 50 * 1024 * 1024 }, // 50MB total
  pro: { uploads: 5, storage: 500 * 1024 * 1024 }, // 500MB
  ultra: { uploads: 10, storage: 2 * 1024 * 1024 * 1024 } // 2GB
};

// text/html and image/svg+xml are deliberately excluded — they can carry
// active content and are served from the same origin via /uploads.
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
  const T = TIER_LIMITS[user.subscriptionPlan] || TIER_LIMITS.free;
  return success(res, {
    plan: user.subscriptionPlan,
    dailyUploadCount: user.dailyUploadCount,
    maxUploads: T.uploads,
    dailyChatTokens: user.dailyChatTokens,
    storageUsed: user.chatbotStorageUsed,
    maxStorage: T.storage
  });
});

// POST upload local file (ULTRA ONLY)
router.post('/upload/local', checkAndResetDailyLimits, upload.single('file'), async (req, res, next) => {
  try {
    const user = req.dbUser;
    if (user.subscriptionPlan !== 'ultra') {
      return error(res, 'FORBIDDEN', 'Local uploads are locked to the Ultra plan. Please upgrade.', 403);
    }
    if (!req.file) return error(res, 'VALIDATION', 'No file uploaded', 400);

    const limit = TIER_LIMITS.ultra;
    if (user.dailyUploadCount >= limit.uploads) {
      return error(res, 'LIMIT_EXCEEDED', 'Daily upload limit reached.', 429);
    }
    if (user.chatbotStorageUsed + req.file.size > limit.storage) {
      return error(res, 'LIMIT_EXCEEDED', 'Storage limit exceeded. Delete some notes first.', 429);
    }

    const { title } = req.body;
    const finalTitle = title || req.file.originalname;

    if (!isMimeAllowed(req.file.mimetype) || !isExtAllowed(req.file.originalname)) {
      return error(res, 'UNSUPPORTED_FORMAT', 'Unsupported file format. Please upload PDF, TXT, CSV, or Markdown files.', 400);
    }

    // Header check — a file can't claim to be a PDF and be something else.
    if (!validateStoredFile(req.file.path, req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return error(res, 'UNSUPPORTED_FORMAT', 'The uploaded file header does not match its type.', 400);
    }

    const existingNote = await prisma.chatbotNote.findFirst({ where: { userId: user.id, title: finalTitle } });
    if (existingNote) return error(res, 'ALREADY_EXISTS', 'A note with this name already exists.', 409);

    // Upload to Gemini
    const geminiData = await uploadFileToGemini(req.file.path, req.file.mimetype, finalTitle);

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

    await prisma.user.update({
      where: { id: user.id },
      data: { 
        dailyUploadCount: { increment: 1 },
        chatbotStorageUsed: { increment: req.file.size }
      }
    });

    // Cleanup local temp file — one copy is enough (Gemini holds the original)
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

    return success(res, note, 201);
  } catch (err) {
    next(err);
  }
});

// POST upload from resource (FREE, PRO, ULTRA)
router.post('/upload/resource', checkAndResetDailyLimits, body('resourceId').notEmpty(), async (req, res, next) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return error(res, 'VALIDATION', 'Missing resourceId', 400);

    const user = req.dbUser;
    const limit = TIER_LIMITS[user.subscriptionPlan] || TIER_LIMITS.free;

    if (user.dailyUploadCount >= limit.uploads) {
      return error(res, 'LIMIT_EXCEEDED', 'Daily upload limit reached for your plan.', 429);
    }

    const resource = await prisma.resource.findUnique({ where: { id: req.body.resourceId } });
    if (!resource) return error(res, 'NOT_FOUND', 'Resource not found', 404);

    // A chatbot resource upload forwards the file to Gemini — enforce the
    // same batch access rules as the resources module so juniors can't
    // exfiltrate seniors' notes to a third party.
    const resSubject = await prisma.resourceSubject.findUnique({ where: { id: resource.subjectId } });
    if (!resSubject || !enforceBatchAccess(req, resSubject.subCategory)) {
      return error(res, 'FORBIDDEN', 'You only have access to your own batch and your immediate juniors.', 403);
    }

    if (user.chatbotStorageUsed + resource.fileSize > limit.storage) {
      return error(res, 'LIMIT_EXCEEDED', 'Storage limit exceeded. Delete or upgrade.', 429);
    }

    const physicalPath = path.join(__dirname, '../../', resource.fileUrl);
    if (!fs.existsSync(physicalPath)) return error(res, 'FILE_MISSING', 'Physical resource file missing', 404);

    if (!isMimeAllowed(resource.mimetype)) {
      return error(res, 'UNSUPPORTED_FORMAT', 'Resource format not supported by Gemini (use PDF, TXT, CSV).', 400);
    }

    const finalTitle = resource.title || resource.fileName;
    const existingNote = await prisma.chatbotNote.findFirst({ where: { userId: user.id, title: finalTitle } });
    if (existingNote) return error(res, 'ALREADY_EXISTS', 'This resource has already been added to your notes.', 409);

    const geminiData = await uploadFileToGemini(physicalPath, resource.mimetype, resource.fileName);

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

    await prisma.user.update({
      where: { id: user.id },
      data: { 
        dailyUploadCount: { increment: 1 },
        chatbotStorageUsed: { increment: resource.fileSize }
      }
    });

    return success(res, note, 201);
  } catch (err) {
    next(err);
  }
});

// DELETE
router.delete('/:id', async (req, res, next) => {
  try {
    const note = await prisma.chatbotNote.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!note) return error(res, 'NOT_FOUND', 'Note not found', 404);

    await deleteGeminiFile(note.geminiFileName);
    await prisma.chatbotNote.delete({ where: { id: note.id } });
    await prisma.user.update({
      where: { id: req.user.id },
      data: { chatbotStorageUsed: { decrement: note.fileSize } }
    });

    return success(res, { message: 'Note deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /chat
router.post('/chat', rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Too many chat requests. Please slow down.',
  keyPrefix: 'chatbot-chat-ip',
}), checkAndResetDailyLimits, [
  body('noteId').notEmpty(),
  body('query').notEmpty()
], async (req, res, next) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return error(res, 'VALIDATION', 'Invalid data', 400);

    const user = req.dbUser;
    if (user.subscriptionPlan === 'free' && user.dailyChatTokens <= 0) {
      return error(res, 'LIMIT_EXCEEDED', 'You are out of free chat tokens today. Please upgrade.', 403);
    }

    const note = await prisma.chatbotNote.findFirst({
      where: { id: req.body.noteId, userId: req.user.id }
    });
    if (!note) return error(res, 'NOT_FOUND', 'Linked note not found.', 404);

    const answer = await chatWithContext({ fileUri: note.geminiFileUri, mimeType: note.mimetype }, req.body.query);

    if (user.subscriptionPlan === 'free') {
      await prisma.user.update({
        where: { id: user.id },
        data: { dailyChatTokens: { decrement: 1 } }
      });
    }

    return success(res, { answer, remainingTokens: user.subscriptionPlan === 'free' ? user.dailyChatTokens - 1 : 'unlimited' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

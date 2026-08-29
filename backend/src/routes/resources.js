/**
 * Resources API Routes
 * Mounts at /api/v1/resources
 */
const express = require('express');
const { body, query, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const authMiddleware = require('../middleware/auth');
const prisma = require('../prisma');
const { success, error } = require('../utils/apiResponse');
const { storeFile, deleteStoredFile } = require('../utils/fileStorage');
const { enforceBatchAccess } = require('../utils/batchAccess');
const { validateStoredFile } = require('../utils/fileMagic');

const router = express.Router();

const ID_RE = /^[0-9a-fA-F]{24}$/;

// Ensure upload dir exists
const uploadDir = path.join(env.STORAGE_PATH, 'resources');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer config - 75 MB limit
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `res-${uniqueSuffix}${ext}`);
  }
});

// Documents/resources only — .html/.svg/.js and other executable formats are
// rejected to prevent same-origin stored XSS via /uploads.
const ALLOWED_RESOURCE_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.txt', '.md', '.csv', '.zip', '.rar', '.7z',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
];
const upload = multer({
  storage,
  limits: { fileSize: 75 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_RESOURCE_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only documents and common media types are allowed (PDF, DOC, PPT, XLS, TXT, ZIP, images).'));
    }
  },
});

const { rateLimiter } = require('../middleware/rateLimit');

const resourceUploadRateLimit = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: 'Upload rate limit exceeded. Please wait before uploading more files.',
  keyPrefix: 'resource-upload',
});

router.use(authMiddleware);

// ==========================================
// SUBJECTS
// ==========================================

// Get subjects matching a hierarchy
router.get('/subjects', async (req, res, next) => {
  try {
    const { category, subCategory, yearGroup } = req.query;
    
    if (subCategory && !enforceBatchAccess(req, subCategory, yearGroup)) {
      return error(res, 'FORBIDDEN', 'You only have access to your own batch and your immediate juniors.', 403);
    }

    const where = {};
    if (category) where.category = category;
    if (subCategory) where.subCategory = subCategory;
    if (yearGroup) where.yearGroup = yearGroup;

    const subjects = await prisma.resourceSubject.findMany({ where });
    const filtered = req.user.globalRing === 0
      ? subjects
      : subjects.filter(s => enforceBatchAccess(req, s.subCategory, s.yearGroup));

    return success(res, filtered);
  } catch (err) {
    next(err);
  }
});

// Create subject (Admin or users with canManageResources)
router.post('/subjects', [
  body('name').notEmpty(),
  body('category').isIn(['Academics', 'Technical'])
], async (req, res, next) => {
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser.globalRing !== 0 && !dbUser.canManageResources) {
      return error(res, 'FORBIDDEN', 'You do not have permission to create subjects', 403);
    }
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) return error(res, 'VALIDATION', 'Invalid data', 400);

    const { name, category, subCategory, yearGroup } = req.body;

    if (!enforceBatchAccess(req, subCategory, yearGroup)) {
       return error(res, 'FORBIDDEN', 'You only have access to your own batch and your immediate juniors.', 403);
    }

    const exists = await prisma.resourceSubject.findUnique({
      where: {
        name_category_subCategory_yearGroup: {
          name, category, 
          subCategory: subCategory || null, 
          yearGroup: yearGroup || null
        }
      }
    });

    if (exists) return error(res, 'DUPLICATE', 'Subject already exists', 400);

    const subject = await prisma.resourceSubject.create({
      data: {
        name, category, 
        subCategory: subCategory || null, 
        yearGroup: yearGroup || null
      }
    });

    return success(res, subject, 201);
  } catch (err) {
    next(err);
  }
});

// Delete subject
router.delete('/subjects/:id', async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.id)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid subject id.', 400);
    }
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser.globalRing !== 0 && !dbUser.canManageResources) {
      return error(res, 'FORBIDDEN', 'No permission', 403);
    }
    const subject = await prisma.resourceSubject.findUnique({ where: { id: req.params.id } });
    if (!subject) return error(res, 'NOT_FOUND', 'Subject not found', 404);

    if (!enforceBatchAccess(req, subject.subCategory, subject.yearGroup)) {
       return error(res, 'FORBIDDEN', 'You only have access to your own batch and your immediate juniors.', 403);
    }

    // Clean up physical files of associated resources
    const resources = await prisma.resource.findMany({
      where: { subjectId: req.params.id },
      select: { fileUrl: true }
    });

    await prisma.resourceSubject.delete({ where: { id: req.params.id } });

    for (const r of resources) {
      await deleteStoredFile(r.fileUrl).catch(() => {});
    }

    return success(res, { message: 'Subject deleted' });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// FILES (Resources)
// ==========================================

// Get files for a subject
router.get('/', async (req, res, next) => {
  try {
    const { subjectId } = req.query;
    if (!subjectId) return error(res, 'VALIDATION', 'subjectId is required', 400);
    if (!ID_RE.test(subjectId)) return error(res, 'VALIDATION_ERROR', 'Invalid subjectId', 400);

    const subject = await prisma.resourceSubject.findUnique({ where: { id: subjectId } });
    if (!subject) return error(res, 'NOT_FOUND', 'Subject not found', 404);

    // Batch access applies to listing too
    if (!enforceBatchAccess(req, subject.subCategory, subject.yearGroup)) {
      return error(res, 'FORBIDDEN', 'You only have access to your own batch and your immediate juniors.', 403);
    }

    const resources = await prisma.resource.findMany({
      where: { subjectId },
      include: {
        uploader: { select: { id: true, displayName: true, avatarUrl: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return success(res, resources);
  } catch (err) {
    next(err);
  }
});

// Upload a file
router.post('/upload', resourceUploadRateLimit, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return error(res, 'VALIDATION', 'No file uploaded', 400);
    const { title, subjectId } = req.body;
    
    if (!subjectId) return error(res, 'VALIDATION', 'subjectId is required', 400);
    if (!ID_RE.test(subjectId)) return error(res, 'VALIDATION_ERROR', 'Invalid subjectId', 400);

    // Verify subject exists
    const subject = await prisma.resourceSubject.findUnique({ where: { id: subjectId } });
    if (!subject) return error(res, 'NOT_FOUND', 'Subject not found', 404);

    if (!enforceBatchAccess(req, subject.subCategory, subject.yearGroup)) {
       return error(res, 'FORBIDDEN', 'You only have access to your own batch and your immediate juniors.', 403);
    }

    // Magic-byte check for image/PDF/archive claims
    if (!validateStoredFile(req.file.path, req.file.mimetype, req.file.originalname)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return error(res, 'INVALID_FILE_TYPE', 'The uploaded file header does not match its type or extension.', 400);
    }

    const fileUrl = await storeFile(req.file, { folder: 'comflex/resources', localUrlPrefix: '/uploads/resources' });

    const resource = await prisma.resource.create({
      data: {
        title: title || req.file.originalname,
        subjectId,
        fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimetype: req.file.mimetype,
        uploaderId: req.user.id
      },
      include: {
        uploader: { select: { id: true, displayName: true, avatarUrl: true } }
      }
    });

    return success(res, resource, 201);
  } catch (err) {
    next(err);
  }
});

// Delete a file
router.delete('/:id', async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.id)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid file id.', 400);
    }
    const resource = await prisma.resource.findUnique({ where: { id: req.params.id } });
    if (!resource) return error(res, 'NOT_FOUND', 'File not found', 404);

    // Permission check: admin, user with canManageResources, or uploader
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (
      dbUser.globalRing !== 0 && 
      !dbUser.canManageResources && 
      resource.uploaderId !== req.user.id
    ) {
      return error(res, 'FORBIDDEN', 'You do not have permission to delete this file', 403);
    }

    const subject = await prisma.resourceSubject.findUnique({ where: { id: resource.subjectId } });
    if (subject && !enforceBatchAccess(req, subject.subCategory, subject.yearGroup)) {
       return error(res, 'FORBIDDEN', 'You only have access to your own batch and your immediate juniors.', 403);
    }

    await prisma.resource.delete({ where: { id: req.params.id } });

    // Delete physical file (local disk or Cloudinary best-effort)
    await deleteStoredFile(resource.fileUrl);

    return success(res, { message: 'File deleted' });
  } catch (err) {
    next(err);
  }
});

// Download a resource and reward uploader with credits
router.get('/download/:id', async (req, res, next) => {
  try {
    if (!ID_RE.test(req.params.id)) {
      return error(res, 'VALIDATION_ERROR', 'Invalid file id.', 400);
    }
    const resource = await prisma.resource.findUnique({ where: { id: req.params.id } });
    if (!resource) return res.status(404).json({ error: 'File not found' });

    // Batch access applies to downloads as well.
    const subject = await prisma.resourceSubject.findUnique({ where: { id: resource.subjectId } });
    if (subject && !enforceBatchAccess(req, subject.subCategory, subject.yearGroup)) {
      return error(res, 'FORBIDDEN', 'You only have access to your own batch and your immediate juniors.', 403);
    }

    // Check configuration for download reward
    const config = await prisma.institutionConfig.findFirst();
    const rewardAmount = config?.notesDownloadReward || 0;

    // Issue reward to the uploader if it's someone downloading another's notes
    if (rewardAmount > 0 && resource.uploaderId !== req.user.id) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      await prisma.$transaction(async (tx) => {
        // Prevent duplicate rewards per user per file
        const existingTx = await tx.transaction.findFirst({
          where: {
            receiverId: resource.uploaderId,
            type: 'download_reward',
            referenceId: `${resource.id}_${req.user.id}`
          }
        });
        
        if (!existingTx) {
          // Check daily limit on download rewards for the uploader (max 50 credits/day)
          const dailyTotal = await tx.transaction.aggregate({
            where: {
              receiverId: resource.uploaderId,
              type: 'download_reward',
              createdAt: { gte: todayStart }
            },
            _sum: { amount: true }
          });

          if ((dailyTotal._sum.amount || 0) + rewardAmount <= 50) {
            // Increment uploader's credits
            await tx.user.update({
              where: { id: resource.uploaderId },
              data: { creditBalance: { increment: rewardAmount } }
            });
            
            // Log transaction
            await tx.transaction.create({
              data: {
                senderId: null, // system 
                receiverId: resource.uploaderId,
                amount: rewardAmount,
                type: 'download_reward',
                referenceId: `${resource.id}_${req.user.id}`
              }
            });
          }
        }
      });
    }

    // Local file → stream from disk; Cloudinary URL → redirect to the CDN
    const cleanRelPath = resource.fileUrl.replace(/^\/uploads\/?/, '');
    const resolvedPath = path.resolve(env.STORAGE_PATH, cleanRelPath);
    if (!resolvedPath.startsWith(path.resolve(env.STORAGE_PATH))) {
      return error(res, 'FORBIDDEN', 'Invalid file path.', 403);
    }

    if (resource.fileUrl.startsWith('/uploads/') && fs.existsSync(resolvedPath)) {
      res.download(resolvedPath, resource.fileName);
    } else if (resource.fileUrl.startsWith('http')) {
      res.redirect(resource.fileUrl);
    } else {
      res.status(404).json({ error: 'File physical missing' });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;

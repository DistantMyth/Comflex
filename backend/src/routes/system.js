/**
 * System Routes — /api/v1/system/*
 * 
 * Public endpoints for system status checks.
 * No authentication required.
 */

const express = require('express');
const env = require('../config/env');
const prisma = require('../prisma');
const { success } = require('../utils/apiResponse');

const router = express.Router();

/**
 * GET /api/v1/system/status
 * Returns whether the platform has been configured.
 * Used by the frontend to decide whether to show setup wizard or login.
 */
router.get('/status', async (req, res, next) => {
  try {
    const config = await prisma.institutionConfig.findFirst();

    const { isCloudinaryConfigured } = require('../utils/fileStorage');
    const cloudinaryDebug = {
      hasUrl: Boolean(process.env.CLOUDINARY_URL || env.CLOUDINARY_URL),
      hasCloudName: Boolean(process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || env.CLOUDINARY_CLOUD_NAME),
      hasApiKey: Boolean(process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY || env.CLOUDINARY_API_KEY),
      hasApiSecret: Boolean(process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET || env.CLOUDINARY_API_SECRET),
      foundCloudKeys: Object.keys(process.env).filter(k => k.toUpperCase().includes('CLOUD') || k.toUpperCase().includes('CLD')),
    };

    return success(res, {
      isConfigured: config?.isConfigured ?? false,
      institutionName: config?.isConfigured ? config.name : null,
      registrationEnabled: config?.isConfigured ?? false,
      branchMapping: config?.emailParsingRules?.branchMapping || {},
      mediaStorage: isCloudinaryConfigured() ? 'cloudinary' : 'local_ephemeral',
      cloudinaryDebug,
      version: '1.0.2-debug',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

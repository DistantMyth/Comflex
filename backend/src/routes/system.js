/**
 * System Routes — /api/v1/system/*
 * 
 * Public endpoints for system status checks.
 * No authentication required.
 */

const express = require('express');
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
    return success(res, {
      isConfigured: config?.isConfigured ?? false,
      institutionName: config?.isConfigured ? config.name : null,
      registrationEnabled: config?.isConfigured ?? false,
      branchMapping: config?.emailParsingRules?.branchMapping || {},
      mediaStorage: isCloudinaryConfigured() ? 'cloudinary' : 'local_ephemeral',
      version: '1.0.1-cloudinary-persistent',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

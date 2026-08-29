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
    const fs = require('fs');
    const { isCloudinaryConfigured } = require('../utils/fileStorage');

    const envKeys = Object.keys(process.env).sort();
    
    function inspectDir(dir) {
      const results = [];
      try {
        if (fs.existsSync(dir)) {
          const entries = fs.readdirSync(dir);
          for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isDirectory()) {
                results.push({ path: fullPath, type: 'dir', children: fs.readdirSync(fullPath) });
              } else {
                const rawContent = fs.readFileSync(fullPath, 'utf8');
                results.push({ path: fullPath, type: 'file', size: stat.size, preview: rawContent.slice(0, 30) });
              }
            } catch (e) {
              results.push({ path: fullPath, error: e.message });
            }
          }
        }
      } catch (e) {
        results.push({ dir, error: e.message });
      }
      return results;
    }

    const secretsInspection = inspectDir('/etc/secrets');

    const diagnostics = {
      mediaStorage: isCloudinaryConfigured() ? 'cloudinary' : 'local_ephemeral',
      hasCloudName: Boolean(process.env.CLOUDINARY_CLOUD_NAME || env.CLOUDINARY_CLOUD_NAME),
      hasApiKey: Boolean(process.env.CLOUDINARY_API_KEY || env.CLOUDINARY_API_KEY),
      hasApiSecret: Boolean(process.env.CLOUDINARY_API_SECRET || env.CLOUDINARY_API_SECRET),
      hasCloudinaryUrl: Boolean(process.env.CLOUDINARY_URL || env.CLOUDINARY_URL),
      cloudNameLen: (env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || '').length,
      apiKeyLen: (env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY || '').length,
      apiSecretLen: (env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_SECRET || '').length,
      allEnvKeyNames: envKeys,
      secretsInspection,
      buildTimestamp: new Date().toISOString(),
    };

    return success(res, {
      isConfigured: config?.isConfigured ?? false,
      institutionName: config?.isConfigured ? config.name : null,
      registrationEnabled: config?.isConfigured ?? false,
      branchMapping: config?.emailParsingRules?.branchMapping || {},
      mediaStorage: isCloudinaryConfigured() ? 'cloudinary' : 'local_ephemeral',
      diagnostics,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

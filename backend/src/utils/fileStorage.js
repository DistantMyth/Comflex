/**
 * fileStorage — Unified file storage layer.
 *
 * Cloud Storage (Cloudinary):
 *   Supports both CLOUDINARY_URL (standard single connection string)
 *   and individual CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
 *   environment variables.
 *
 * Local fallback (dev only):
 *   Files stay on disk and return relative /uploads/... path.
 */

const fs = require('fs');
const path = require('path');
const env = require('../config/env');

let cloudinary = null;
let cloudinaryReady = false;

function cleanEnvString(val) {
  if (!val) return '';
  return String(val).replace(/^["']|["']$/g, '').trim();
}

/**
 * Resolve Cloudinary credentials from any standard environment format.
 */
function getCloudinaryConfig() {
  const rawUrl = process.env.CLOUDINARY_URL || env.CLOUDINARY_URL;
  const url = cleanEnvString(rawUrl);
  if (url && url.startsWith('cloudinary://')) {
    const match = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (match) {
      return {
        api_key: decodeURIComponent(match[1]),
        api_secret: decodeURIComponent(match[2]),
        cloud_name: match[3].replace(/\/+$/, ''),
        secure: true,
      };
    }
    try {
      const parsed = new URL(url);
      return {
        cloud_name: parsed.hostname,
        api_key: decodeURIComponent(parsed.username),
        api_secret: decodeURIComponent(parsed.password),
        secure: true,
      };
    } catch {
      // Fallback
    }
  }

  const cloud_name = cleanEnvString(env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || process.env.CLOUD_NAME);
  const api_key = cleanEnvString(env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY || process.env.API_KEY);
  const api_secret = cleanEnvString(env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET || process.env.API_SECRET);

  if (cloud_name && api_key && api_secret) {
    return { cloud_name, api_key, api_secret, secure: true };
  }

  return null;
}

function isCloudinaryConfigured() {
  return Boolean(getCloudinaryConfig());
}

function getCloudinary() {
  if (cloudinaryReady && cloudinary) return cloudinary;
  const config = getCloudinaryConfig();
  if (!config) return null;

  try {
    cloudinary = require('cloudinary').v2;
    cloudinary.config(config);
    cloudinaryReady = true;
    console.log(`[fileStorage] ✅ Cloudinary enabled for cloud "${config.cloud_name || 'custom'}" — uploads go to Cloudinary CDN.`);
  } catch (err) {
    console.error('[fileStorage] ❌ Cloudinary initialization failed:', err.message);
    cloudinaryReady = false;
  }
  return cloudinary;
}

/**
 * Persist a multer-uploaded file to Cloudinary (or local disk in development).
 *
 * @param {object} file - req.file from multer (has .path, .filename, .originalname, .mimetype)
 * @param {object} opts
 * @param {string} opts.folder - Cloudinary folder (e.g. "comflex/avatars")
 * @param {string} opts.localUrlPrefix - URL prefix for the local fallback (e.g. "/uploads/resources")
 * @param {string} [opts.publicId] - optional Cloudinary public id
 * @returns {Promise<string>} absolute Cloudinary URL or relative local path
 */
async function storeFile(file, { folder = 'comflex', localUrlPrefix = '/uploads', publicId } = {}) {
  if (!file) return null;

  const cld = getCloudinary();
  if (cld && file.path) {
    try {
      const result = await cld.uploader.upload(file.path, {
        folder,
        resource_type: 'auto',
        ...(publicId ? { public_id: publicId } : {}),
        use_filename: true,
        unique_filename: true,
      });
      // Remove the local temp copy now that it's stored in Cloudinary
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      return result.secure_url;
    } catch (err) {
      console.error('[fileStorage] ❌ Cloudinary upload failed:', err.message);
      // Clean up local temp file before throwing
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      throw Object.assign(new Error(`Failed to upload media to Cloudinary: ${err.message}`), {
        statusCode: 502,
        code: 'CLOUD_STORAGE_ERROR',
      });
    }
  }

  if (env.NODE_ENV === 'production' && !isCloudinaryConfigured()) {
    console.warn('[fileStorage] ⚠️ WARNING: Uploading to ephemeral disk in production. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/KEY/SECRET on Render to persist uploads!');
  }

  // Local fallback (development) — frontend resolveAsset() adds the origin.
  return `${localUrlPrefix}/${file.filename}`;
}

/**
 * Delete a stored file.
 * - Local files are removed from disk.
 * - Cloudinary files are destroyed by public id (handles image, raw, video).
 */
async function deleteStoredFile(url) {
  if (!url) return;

  if (url.startsWith('/uploads/')) {
    const filePath = path.join(env.STORAGE_PATH, url.replace('/uploads/', ''));
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
    return;
  }

  // Cloudinary URL → destroy by public id & resource type
  if (url.includes('res.cloudinary.com')) {
    try {
      const match = url.match(/\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i);
      if (match && match[2]) {
        const resourceType = match[1].toLowerCase();
        const publicId = match[2];
        const cld = getCloudinary();
        await cld?.uploader.destroy(publicId, { resource_type: resourceType });
      }
    } catch { /* ignore */ }
  }
}

module.exports = { storeFile, deleteStoredFile, isCloudinaryConfigured, getCloudinary };

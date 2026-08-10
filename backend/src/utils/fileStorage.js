/**
 * fileStorage — Unified file storage layer.
 *
 * Why this exists:
 *   Render (free tier) uses an ephemeral filesystem at /tmp that is wiped on
 *   deploy and on inactivity. Any file saved locally is LOST.
 *
 * Solution:
 *   - If Cloudinary is configured (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET),
 *     every upload is pushed to Cloudinary and we store the absolute https URL.
 *   - Otherwise (local dev), files stay on disk and we return a relative
 *     /uploads/... path — the frontend resolveAsset() helper prefixes the
 *     backend origin when rendering, so images work even cross-origin (Vercel → Render).
 */

const fs = require('fs');
const path = require('path');
const env = require('../config/env');

let cloudinary = null;
let cloudinaryReady = false;

function isCloudinaryConfigured() {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET
  );
}

function getCloudinary() {
  if (cloudinaryReady) return cloudinary;
  if (!isCloudinaryConfigured()) return null;
  // Lazy-require so local dev without the package still works.
  try {
    cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    cloudinaryReady = true;
    console.log('[fileStorage] Cloudinary enabled — uploads go to the cloud. 🎉');
  } catch (err) {
    console.error('[fileStorage] cloudinary package not installed:', err.message);
    cloudinaryReady = true; // don't retry every upload
  }
  return cloudinary;
}

/**
 * Persist a multer-uploaded file.
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
        // Keep filenames readable in the Cloudinary console
        use_filename: true,
        unique_filename: true,
      });
      // Remove the local temp copy now that it's safe in the cloud
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      return result.secure_url;
    } catch (err) {
      console.error('[fileStorage] Cloudinary upload failed — falling back to local disk:', err.message);
    }
  }

  // Local fallback (development) — frontend resolveAsset() adds the origin.
  return `${localUrlPrefix}/${file.filename}`;
}

/**
 * Delete a stored file.
 * - Local files are removed from disk.
 * - Cloudinary files are only deleted when a publicId is passed (we don't
 *   store publicIds in the DB, so this is best-effort by URL parse).
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

  // Cloudinary URL → try to destroy by public id derived from the URL
  if (url.includes('res.cloudinary.com')) {
    try {
      const match = url.match(/\/image\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z]+)?$/);
      if (match) {
        const cld = getCloudinary();
        await cld?.uploader.destroy(match[1].replace(/\//g, ':'));
      }
    } catch { /* ignore */ }
  }
}

module.exports = { storeFile, deleteStoredFile, isCloudinaryConfigured };

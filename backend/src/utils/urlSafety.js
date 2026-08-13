/**
 * urlSafety — shared URL validation for user-supplied media URLs.
 *
 * avatars and similar fields accept either a local /uploads/... path
 * (produced by our own fileStorage) or a remote http(s)/image-data: URL.
 * Everything else (javascript:, data:text/html, vbscript:, ...) is rejected
 * so that a stored avatar URL can never become a click-XSS / javascript:
 * sink in the frontend (see resolveAsset.js, which enforces the same rule
 * client-side).
 */

const SAFE_SCHEMES = new Set(['http:', 'https:']);
const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i;

function isSafeUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith('/uploads/')) return true;

  try {
    const u = new URL(trimmed);
    if (u.protocol === 'data:') {
      // data: URIs must be base64 images only — never text/html or svg+xml.
      return SAFE_DATA_IMAGE_RE.test(trimmed);
    }
    return SAFE_SCHEMES.has(u.protocol);
  } catch {
    return false;
  }
}

/**
 * Returns the trimmed URL when safe, or null when it is a local '/uploads/'
 * path was invalid / a dangerous scheme. Pass the value straight into
 * Prisma data — undefined/null pass through untouched.
 */
function sanitizeUrl(value) {
  if (value === undefined || value === null || value === '') return value;
  return isSafeUrl(value) ? value.trim() : null;
}

module.exports = { isSafeUrl, sanitizeUrl };
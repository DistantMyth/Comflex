/**
 * resolveAsset — Resolve stored file/image URLs for cross-origin deployments.
 *
 * Backend uploads are stored as relative paths like `/uploads/avatars/x.jpg`
 * (or absolute Cloudinary URLs when configured). On Vercel the frontend is on
 * a different origin than the Render backend, so relative paths must be
 * prefixed with the backend origin to render.
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

const IMAGE_DATA_RE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i;

export function resolveAsset(url) {
  if (!url) return url;
  if (typeof url !== 'string') return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/uploads') || url.startsWith('/api')) {
    return `${BACKEND_URL}${url}`;
  }
  if (IMAGE_DATA_RE.test(url)) return url;
  return null;
}

/** Resolve the websocket/socket.io origin (backend URL, else same-origin in dev). */
export function socketOrigin() {
  return BACKEND_URL || window.location.origin;
}

export default resolveAsset;

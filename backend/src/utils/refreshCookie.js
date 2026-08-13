/**
 * Refresh-token httpOnly cookie helpers.
 *
 * The refresh token is delivered ONLY via an httpOnly, Secure, SameSite=None
 * cookie (production) so it never touches JS-accessible storage. Cross-site
 * (Vercel -> Render) cookie delivery requires SameSite=None + Secure.
 */

const env = require('../config/env');

const REFRESH_COOKIE_NAME = 'comflex_refresh';

function refreshCookieOptions() {
  const isProd = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd, // HTTPS in prod; dev is localhost http
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days — matches JWT_REFRESH_EXPIRY
  };
}

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions());
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
  });
}

module.exports = { REFRESH_COOKIE_NAME, setRefreshCookie, clearRefreshCookie };
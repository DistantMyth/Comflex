/**
 * JWT Utility
 * 
 * Sign and verify JSON Web Tokens for access and refresh tokens.
 * Access tokens are short-lived (15m), refresh tokens are long-lived (7d).
 */

const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Generate an access token containing user claims.
 * Payload includes: sub, email, globalRing, cohortTags, displayBadges, avatarUrl
 */
function signAccessToken(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    globalRing: user.globalRing,
    cohortTags: user.cohortTags || [],
    displayBadges: user.displayBadges || [],
    avatarUrl: user.avatarUrl || null,
  };

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRY,
  });
}

/**
 * Generate a refresh token (minimal payload — just user ID).
 */
function signRefreshToken(userId) {
  return jwt.sign({ sub: userId }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRY,
  });
}

/**
 * Verify an access token and return the decoded payload.
 * Throws if token is invalid or expired.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
}

/**
 * Verify a refresh token and return the decoded payload.
 * Throws if token is invalid or expired.
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};

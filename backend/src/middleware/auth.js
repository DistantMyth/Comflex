/**
 * Auth Middleware
 * 
 * Verifies the JWT access token from the Authorization header.
 * Attaches the decoded user payload to `req.user` for downstream use.
 * 
 * Usage: router.get('/protected', authMiddleware, handler)
 */

const { verifyAccessToken } = require('../utils/jwt');
const { error } = require('../utils/apiResponse');
const prisma = require('../prisma');
const cacheService = require('../services/cacheService');

function authMiddleware(req, res, next) {
  try {
    // Extract token from "Bearer <token>" header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'AUTH_REQUIRED', 'Authentication required. Please provide a valid token.', 401);
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return error(res, 'AUTH_REQUIRED', 'Authentication required. Token is missing.', 401);
    }

    // Verify and decode the token
    const decoded = verifyAccessToken(token);

    // Legacy tokens may carry a non-ObjectId (or missing) `sub` — Prisma
    // would 500 on it. Treat as invalid, not a server error.
    if (!decoded.sub || !/^[a-f0-9]{24}$/i.test(decoded.sub)) {
      return error(res, 'INVALID_TOKEN', 'Invalid authentication token.', 401);
    }

    // Re-read user claims from multi-tier cache (L1: 3s, L2: 2m) with
    // secVersion check to ensure immediate revocation on demotions/bans.
    cacheService
      .getOrSet(
        `auth:user:${decoded.sub}`,
        () =>
          prisma.user.findUnique({
            where: { id: decoded.sub },
            select: {
              id: true,
              email: true,
              globalRing: true,
              cohortTags: true,
              displayBadges: true,
              avatarUrl: true,
              secVersion: true,
            },
          }),
        120,
        { l1TtlMs: 3000 }
      )
      .then((dbUser) => {
        if (!dbUser) {
          return error(res, 'USER_NOT_FOUND', 'Account no longer exists.', 401);
        }

        // Backward-compatible secVersion epoch check:
        // Existing active tokens without secVersion (tokenSecVer = 0) pass if currentSecVer = 0,
        // but any subsequent demotion or ban increments secVersion and revokes them instantly.
        const tokenSecVer = typeof decoded.secVersion === 'number' ? decoded.secVersion : 0;
        const currentSecVer = dbUser.secVersion || 0;
        if (tokenSecVer < currentSecVer) {
          return error(res, 'TOKEN_REVOKED', 'Session has been revoked. Please log in again.', 401);
        }

        // Overwrite JWT claims with fresh cached values
        req.user = {
          id: dbUser.id,
          email: dbUser.email,
          globalRing: dbUser.globalRing,
          cohortTags: dbUser.cohortTags || [],
          displayBadges: dbUser.displayBadges || [],
          avatarUrl: dbUser.avatarUrl || null,
          secVersion: currentSecVer,
        };
        next();
      })
      .catch(() => error(res, 'AUTH_ERROR', 'Could not verify account.', 500));
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return error(res, 'TOKEN_EXPIRED', 'Access token has expired. Please refresh.', 401);
    }
    return error(res, 'INVALID_TOKEN', 'Invalid authentication token.', 401);
  }
}

module.exports = authMiddleware;

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

    // Re-read the user from the DB so deletions, demotions, and permission
    // changes take effect immediately instead of lingering for the token's
    // full lifetime. Cheap indexed lookup — fine at this scale.
    prisma.user
      .findUnique({ where: { id: decoded.sub } })
      .then((dbUser) => {
        if (!dbUser) {
          return error(res, 'USER_NOT_FOUND', 'Account no longer exists.', 401);
        }
        // Overwrite JWT claims with fresh DB values
        req.user = {
          id: dbUser.id,
          email: dbUser.email,
          globalRing: dbUser.globalRing,
          cohortTags: dbUser.cohortTags || [],
          displayBadges: dbUser.displayBadges || [],
          avatarUrl: dbUser.avatarUrl || null,
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

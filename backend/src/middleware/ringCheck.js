/**
 * Ring Check Middleware
 * 
 * Enforces the concentric-ring permission model from RULES.md §5.
 * Lower ring number = more power. Ring 0 = Admin.
 * 
 * Usage:
 *   router.get('/admin-only', authMiddleware, requireRing(0), handler)
 *   router.get('/manager-plus', authMiddleware, requireRing(1), handler)
 */

const { error } = require('../utils/apiResponse');

/**
 * Factory: creates middleware that requires the user's GLOBAL ring
 * to be <= maxRing. Ring 0 users pass all checks.
 * 
 * @param {number} maxRing - Maximum allowed ring level (inclusive)
 * @returns {Function} Express middleware
 */
function requireRing(maxRing) {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 'AUTH_REQUIRED', 'Authentication required.', 401);
    }

    // Ring 0 always passes; otherwise check against maxRing
    if (req.user.globalRing > maxRing) {
      return error(
        res,
        'INSUFFICIENT_RING',
        `This action requires Ring ${maxRing} or higher. Your ring: ${req.user.globalRing}.`,
        403
      );
    }

    next();
  };
}

/**
 * Validate that the acting user's ring is strictly less than the target user's ring.
 * Used for moderation actions (mute, kick, elevate, etc.)
 * 
 * @param {number} actorRing - The acting user's ring level
 * @param {number} targetRing - The target user's ring level
 * @returns {boolean} True if actor can act on target
 */
function canActOnUser(actorRing, targetRing) {
  // Actor must have strictly lower ring (= more power) than target
  return actorRing < targetRing;
}

/**
 * Validate that an elevation request is legal per RULES.md ring rules:
 * - Actor can elevate target up to actor's own ring (not above)
 * - Actor's ring must be strictly less than target's current ring
 * - Only Ring 0 can elevate to Ring 0
 * 
 * @param {number} actorRing
 * @param {number} targetCurrentRing
 * @param {number} desiredRing
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateElevation(actorRing, targetCurrentRing, desiredRing, actorId = null, targetId = null) {
  // Prevent self-demotion for admins
  if (actorId && targetId && actorId === targetId && desiredRing > actorRing) {
    return { valid: false, reason: 'Admins cannot demote their own account.' };
  }

  // Ring 0 (Admin) can modify any other user's ring level
  if (actorRing === 0) {
    return { valid: true };
  }

  // Non-root rings: Actor must outrank target
  if (actorRing >= targetCurrentRing) {
    return { valid: false, reason: 'You cannot modify the ring of someone at your level or above.' };
  }

  // Cannot elevate above actor's own ring
  if (desiredRing < actorRing) {
    return { valid: false, reason: 'You cannot elevate someone above your own ring level.' };
  }

  // Only Ring 0 can create Ring 0
  if (desiredRing === 0) {
    return { valid: false, reason: 'Only Ring 0 (Admin) can assign Ring 0.' };
  }

  return { valid: true };
}

module.exports = {
  requireRing,
  canActOnUser,
  validateElevation,
};

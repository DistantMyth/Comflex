/**
 * Group Permission Middleware
 *
 * Factory middleware that verifies a user has a specific permission
 * in the group specified by the route's :id param.
 *
 * MUST be used after authMiddleware so req.user is available.
 * Reads the group membership from DB and checks the permission key.
 * Ring 0 (global admin) bypasses all permission checks.
 *
 * Anonymous groups: there are no rings or permissions. Access is authorized
 * by the client-presented identity secret (`x-anon-identity: <id>.<secret>`),
 * and any identity in the group can use the group's chat features.
 *
 * Usage:
 *   router.post('/groups/:id/messages', auth, requireGroupPermission('can_send_messages'), handler)
 */

const prisma = require('../prisma');
const { error } = require('../utils/apiResponse');
const groupService = require('../services/groupService');

/**
 * Validate that every "id-like" route param is a MongoDB ObjectId.
 * Prevents malformed ids from reaching Prisma (P2023 → 500) and stops
 * cross-resource probing via non-canonical ids.
 */
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
const ID_PARAMS = ['id', 'groupId', 'userId', 'inviteId', 'msgId', 'identityId'];

function requireMongoParams(req, res, next) {
  for (const name of ID_PARAMS) {
    const value = req.params[name];
    if (value !== undefined && !OBJECT_ID_RE.test(value)) {
      return error(res, 'VALIDATION_ERROR', `Invalid ${name}.`, 400);
    }
  }
  next();
}

/**
 * Check that the current user is a member of the group and attach membership to req.
 * For anonymous groups, verifies the identity secret instead and attaches req.anonIdentity.
 */
async function requireGroupMember(req, res, next) {
  try {
    // Reject malformed ids cleanly (also covers :userId/:inviteId/:msgId etc.
    // on routes that compose requireGroupMember).
    for (const name of ID_PARAMS) {
      const value = req.params[name];
      if (value !== undefined && !OBJECT_ID_RE.test(value)) {
        return error(res, 'VALIDATION_ERROR', `Invalid ${name}.`, 400);
      }
    }

    const groupId = req.params.id || req.params.groupId;
    if (!groupId) return error(res, 'MISSING_GROUP', 'Group ID is required.', 400);

    const group = await prisma.cohortGroup.findUnique({
      where: { id: groupId },
      select: { id: true, isAnonymous: true, creatorId: true, ringConfig: true },
    });
    if (!group) return error(res, 'GROUP_NOT_FOUND', 'Group not found.', 404);

    if (group.isAnonymous) {
      // Zero-knowledge path: prove possession of the identity secret.
      const header = req.headers['x-anon-identity'];
      if (header && typeof header === 'string') {
        const [identityId, secret] = header.split('.');
        if (identityId && secret) {
          const identity = await groupService.resolveAnonIdentity(identityId, secret);
          if (identity && identity.groupId === groupId) {
            if (identity.bannedAt) {
              return error(res, 'IDENTITY_BANNED', 'This identity is banned from the group.', 403);
            }
            req.anonIdentity = {
              identityId: identity.id,
              alias: identity.alias,
              aliasTag: identity.aliasTag,
              avatarUrl: identity.avatarUrl,
              groupId: identity.groupId,
            };
            return next();
          }
        }
      }

      // Group creator or global admin can access group metadata even without active anon identity
      if (req.user.globalRing === 0 || group.creatorId === req.user.id) {
        req.groupMembership = { ring: 0, permissions: {} };
        return next();
      }

      // Check if user has an enrolled join record in this anonymous group
      const join = await prisma.anonGroupJoin.findUnique({
        where: { groupId_userId: { groupId, userId: req.user.id } },
        select: { id: true },
      }).catch(() => null);

      if (join) {
        req.anonEnrolled = true;
        req.groupMembership = { ring: 3, permissions: {} };
        return next();
      }

      return error(res, 'NOT_A_MEMBER', 'You are not a member of this group.', 403);
    }

    // Normal (non-anonymous) group: Ring 0 bypasses membership check
    if (req.user.globalRing === 0) {
      req.groupMembership = { ring: 0, permissions: {} };
      return next();
    }

    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.id, groupId } },
      include: { group: { select: { ringConfig: true, creatorId: true } } },
    });

    if (!membership) {
      return error(res, 'NOT_A_MEMBER', 'You are not a member of this group.', 403);
    }

    req.groupMembership = membership;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Factory: creates middleware that checks a specific permission key.
 * Must be used after requireGroupMember.
 */
function requireGroupPermission(permissionKey) {
  return (req, res, next) => {
    // Anonymous groups have no permission system — any identity can chat.
    if (req.anonIdentity) return next();

    // Ring 0 bypasses
    if (req.user.globalRing === 0) return next();

    const membership = req.groupMembership;
    if (!membership) {
      return error(res, 'NOT_A_MEMBER', 'You are not a member of this group.', 403);
    }

    // Evaluate permissions: explicit member override > ring permission > default ring permission
    const memberPerms = membership.permissions || {};
    const ringPerms = membership.group?.ringConfig?.ringPermissions?.[membership.ring] || {};
    const defaultPerms = groupService.getDefaultPermissions(membership.ring);

    let hasPermission = false;
    if (memberPerms[permissionKey] !== undefined) {
      hasPermission = memberPerms[permissionKey] === true;
    } else if (ringPerms[permissionKey] !== undefined) {
      hasPermission = ringPerms[permissionKey] === true;
    } else {
      hasPermission = defaultPerms[permissionKey] === true;
    }

    if (!hasPermission && membership.group?.creatorId !== req.user.id) {
      return error(res, 'PERMISSION_DENIED', `You do not have the "${permissionKey}" permission in this group.`, 403);
    }

    next();
  };
}

module.exports = { requireGroupMember, requireGroupPermission, requireMongoParams };
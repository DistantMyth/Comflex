/**
 * Group Routes — /api/v1/groups/*
 *
 * Handles: list groups, get group, create/update/delete, member management,
 * ring changes, permission management, mute/unmute, invites, read receipts,
 * and group avatar upload.
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimit');
const { requireRing, canActOnUser } = require('../middleware/ringCheck');
const { requireGroupMember, requireGroupPermission, requireMongoParams } = require('../middleware/groupPermission');
const groupService = require('../services/groupService');
const messageService = require('../services/messageService');
const dmService = require('../services/dmService');
const prisma = require('../prisma');
const env = require('../config/env');
const { extractCohortYear, extractBranch } = require('../services/cohortService');
const { emitToGroup } = require('../services/chatSocketService');
const { success, error } = require('../utils/apiResponse');
const { storeFile } = require('../utils/fileStorage');
const { validateStoredFile } = require('../utils/fileMagic');

const router = express.Router();

// Mentions arrive as a JSON string in multipart bodies — parse safely,
// cap the array, and only accept string IDs.
function parseMentions(raw) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((id) => typeof id === 'string' && id.length <= 64).slice(0, 50);
  } catch {
    return undefined;
  }
}

// Multer config for group avatar uploads
const groupUploadDir = path.join(env.STORAGE_PATH, 'groups');
if (!fs.existsSync(groupUploadDir)) {
  fs.mkdirSync(groupUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: groupUploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `group-${req.params.id}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Multer config for message attachments
const messageUploadDir = path.join(env.STORAGE_PATH, 'messages');
if (!fs.existsSync(messageUploadDir)) {
  fs.mkdirSync(messageUploadDir, { recursive: true });
}

const messageStorage = multer.diskStorage({
  destination: messageUploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `msg-${req.params.id}-${Date.now()}${ext}`);
  },
});
const messageUpload = multer({
  storage: messageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit requested by user
  fileFilter: (req, file, cb) => {
    // Images, stickers, and documents
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.txt', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// All group routes require authentication
router.use(authMiddleware);

// Per-user throttle on group creation — batch auto-adds blast DMs to
// hundreds of seniors, so the per-user cap matters more than per-IP.
const groupCreateUserLimit = rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Too many groups created. Please slow down.',
  keyPrefix: 'group-create-user',
  keyFn: (req) => req.user?.id || null,
});

// Per-user throttle on adding members — an addMember call can trigger a DM
// invite, so unlimited adds = unlimited DM spam.
const groupAddMemberUserLimit = rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'Too many membership changes. Please slow down.',
  keyPrefix: 'group-addmember-user',
  keyFn: (req) => req.user?.id || null,
});

// ============================================================
// GROUP CRUD
// ============================================================

/**
 * POST /api/v1/groups/join/:token — Join a group using an invite link.
 */
router.post('/join/:token', [
  body('alias').optional().trim(),
  body('avatarUrl').optional().trim(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
        errors.array().map(e => ({ field: e.path, issue: e.msg }))
      );
    }
    // Anonymous groups require an alias — joinWithLink mints the identity.
    const result = await groupService.joinViaLink(req.params.token, req.user.id, req.body.alias, req.body.avatarUrl);
    return success(res, result, 201);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * GET /api/v1/groups — List all groups the user belongs to (with unread counts).
 * Anonymous memberships come from `x-anon-sessions` header: a JSON array of
 * { groupId, identityId, secret } presented by the client.
 */
router.get('/', async (req, res, next) => {
  try {
    let anonSessions = [];
    try {
      const raw = req.headers['x-anon-sessions'];
      if (raw && typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
          anonSessions = parsed
            .filter(s => s && typeof s === 'object' && typeof s.groupId === 'string' && OBJECT_ID_RE.test(s.groupId) && typeof s.identityId === 'string' && OBJECT_ID_RE.test(s.identityId) && s.secret)
            .map(s => ({ groupId: s.groupId, identityId: s.identityId, secret: String(s.secret) }));
        }
      }
    } catch { /* malformed header — ignore */ }
    const groups = await groupService.listUserGroups(req.user.id, anonSessions);
    return success(res, groups);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/groups/invites — List pending group invites for the current user.
 */
router.get('/invites', async (req, res, next) => {
  try {
    const invites = await groupService.listUserInvites(req.user.id);
    return success(res, invites);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/groups/:id — Get group info.
 */
router.get('/:id', requireGroupMember, async (req, res, next) => {
  try {
    const group = await groupService.getGroup(req.params.id);
    return success(res, group);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * POST /api/v1/groups — Create a new group.
 * Any authenticated user can create a group.
 */
router.post(
  '/',
  groupCreateUserLimit,
  rateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: 'Too many groups created from this IP.',
    keyPrefix: 'group-create-ip',
  }),
  [
    body('name').trim().notEmpty().withMessage('Group name is required.'),
    body('displayName').optional().trim(),
    body('description').optional().trim(),
    body('type').optional().isIn(['primary', 'cross-year', 'custom']),
    body('memberIds').optional().isArray({ max: 100 }).withMessage('Up to 100 members can be added at once.'),
    body('autoAdd').optional().isIn(['batch', 'branch-batch', 'cohort']),
    body('targetYears').optional().isArray(),
    body('targetBranches').optional().isArray(),
    body('isAnonymous').optional().isBoolean().withMessage('isAnonymous must be a boolean.')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const group = await groupService.createGroup({
        ...req.body,
        creatorId: req.user.id,
      });

      // Add initial members
      let memberIds = req.body.memberIds || [];
      const results = [];
      const isAutoAdd = req.body.autoAdd;
      const creatorYear = extractCohortYear(req.user.cohortTags) || 0; // fallback to 0 if none
      const myBranch = extractBranch(req.user.cohortTags);

      // If autoAdd is checked, we enforce privileges and find auto-members
      if (isAutoAdd) {
        const prisma = require('../prisma');
        const callingUser = await prisma.user.findUnique({ where: { id: req.user.id } });
        
        if (!callingUser.canCreateGroups && req.user.globalRing !== 0) {
           return error(res, 'PERMISSION_DENIED', 'Only users with group creation rights can auto-add members.', 403);
        }

        const allUsers = await prisma.user.findMany({
            where: { id: { not: req.user.id } },
            select: { id: true, cohortTags: true }
        });

        // Resolve targets based on autoAdd strategy
        if (isAutoAdd === 'batch' || isAutoAdd === 'branch-batch') {
          if (!creatorYear) return error(res, 'NO_COHORT', 'You do not have a standard cohort year to auto-create from.', 400);
          if (isAutoAdd === 'branch-batch' && !myBranch) return error(res, 'NO_BRANCH', 'You do not have a branch tag to auto-create a branch group.', 400);

          for (const u of allUsers) {
             const uYear = extractCohortYear(u.cohortTags);
             if (uYear && uYear >= creatorYear) {
                 if (isAutoAdd === 'batch' && uYear === creatorYear) memberIds.push(u.id);
                 else if (isAutoAdd === 'branch-batch' && uYear === creatorYear && extractBranch(u.cohortTags) === myBranch) memberIds.push(u.id);
             }
          }
        } else if (isAutoAdd === 'cohort') {
          const { targetYears, targetBranches } = req.body;
          for (const u of allUsers) {
             const uYear = extractCohortYear(u.cohortTags);
             const uBranch = extractBranch(u.cohortTags);
             
             let match = true;
             
             if (targetYears && targetYears.length > 0) {
               if (!targetYears.map(y => parseInt(y, 10)).includes(uYear)) match = false;
             }
             if (targetBranches && targetBranches.length > 0) {
               if (!targetBranches.includes(uBranch)) match = false;
             }
             
             if (match && uYear) {
               memberIds.push(u.id);
             }
          }
        }
        
        memberIds = [...new Set(memberIds)];
      }

      // Hard cap on members processed per request (autoAdd can expand wildly)
      if (memberIds.length > 200) {
        memberIds = memberIds.slice(0, 200);
      }

      // Process each member
      let dmInvitesSent = 0;
      const MAX_DM_INVITES_PER_CREATE = 25; // cap DM blast per group creation
      for (const memberId of memberIds) {
        try {
          // Fetch target strictly for logic checks
          const prisma = require('../prisma');
          const targetUser = await prisma.user.findUnique({where: {id: memberId}, select: {id: true, cohortTags: true}});
          let bypassFriendCheck = false;
          
          if (targetUser) {
             const targetYear = extractCohortYear(targetUser.cohortTags);
             
             // If autoAdd mode is cohort or batch
             if (isAutoAdd) {
               if (targetYear && creatorYear && targetYear < creatorYear) {
                 // Target is SENIOR (Graduation year < my graduation year)
                 const isFriend = await groupService.areFriends(req.user.id, memberId);
                 if (isFriend) {
                   bypassFriendCheck = true; // Add directly
                 } else {
// Senior & NOT friend -> Send DM link instead of directly adding
                 if (dmInvitesSent >= MAX_DM_INVITES_PER_CREATE) {
                   results.push({ userId: memberId, status: 'dm_invite_skipped' });
                   continue;
                 }
                 try {
                   const linkObj = await groupService.getInviteLink(group.id);
                   await groupService.createInvite(group.id, memberId, req.user.id);
                    await dmService.sendDM(req.user.id, memberId, { 
                     content: `Hi there! I've created a group "${group.displayName || group.name}". As you are a senior, I'm inviting you via link. Join using this link: ${env.FRONTEND_URL}/join/${linkObj.token}` 
                   }, true);
                   dmInvitesSent++;
                   results.push({ userId: memberId, status: 'dm_invite_sent' });
                   } catch (dmErr) {
                     results.push({ userId: memberId, error: 'Failed to send DM invite.' });
                   }
                   continue; // skip the direct groupService.addMember
                 }
               } else {
                 // Target is JUNIOR or BATCHMATE (targetYear >= creatorYear)
                 bypassFriendCheck = true;
               }
             }
          }

          const result = await groupService.addMember(group.id, memberId, req.user.id, undefined, bypassFriendCheck);
          results.push({ userId: memberId, ...result });
        } catch (err) {
          results.push({ userId: memberId, error: err.message });
        }
      }

      return success(res, { group, memberResults: results }, 201);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/groups/:id — Update group info.
 */
router.patch('/:id', requireGroupMember, requireAnonCreator, requireGroupPermission('can_edit_group_info'), async (req, res, next) => {
  try {
    const group = await groupService.updateGroup(req.params.id, req.body);
    return success(res, group);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/groups/:id/avatar — Upload group avatar.
 */
router.post('/:id/avatar', requireGroupMember, requireAnonCreator, requireGroupPermission('can_edit_group_info'), upload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) {
      return error(res, 'NO_FILE', 'No avatar file uploaded.', 400);
    }
    // Magic-byte check regardless of the client-declared mimetype — a
    // spoofed Content-Type must not skip the header inspection.
    if (!validateStoredFile(req.file.path, req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return error(res, 'INVALID_FILE_TYPE', 'The uploaded file is not a valid image.', 400);
    }
    const avatarUrl = await storeFile(req.file, { folder: 'comflex/groups', localUrlPrefix: '/uploads/groups' });
    const group = await groupService.updateGroup(req.params.id, { avatarUrl });
    return success(res, group);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/groups/:id — Delete group (Platform Admin, Group Creator, or Highest Ring Level 0).
 */
router.delete('/:id', requireMongoParams, async (req, res, next) => {
  try {
    const group = await prisma.cohortGroup.findUnique({
      where: { id: req.params.id },
      select: { id: true, creatorId: true, isAnonymous: true },
    });
    if (!group) return error(res, 'GROUP_NOT_FOUND', 'Group not found.', 404);

    let canDelete = req.user.globalRing === 0 || group.creatorId === req.user.id;
    if (!canDelete && !group.isAnonymous) {
      const membership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: req.user.id, groupId: req.params.id } },
        select: { ring: true },
      });
      if (membership && membership.ring === 0) {
        canDelete = true;
      }
    }

    if (!canDelete) {
      return error(res, 'PERMISSION_DENIED', 'Only the group creator, group admin (Ring 0), or platform admin can delete this group.', 403);
    }

    await groupService.deleteGroup(req.params.id);
    return success(res, { message: 'Group deleted.' });
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * DELETE /api/v1/groups/:id/leave — Leave a group.
 */
router.delete('/:id/leave', requireGroupMember, async (req, res, next) => {
  try {
    const group = await prisma.cohortGroup.findUnique({
      where: { id: req.params.id },
      select: { id: true, creatorId: true, isAnonymous: true },
    });
    if (!group) return error(res, 'GROUP_NOT_FOUND', 'Group not found.', 404);

    if (group.creatorId === req.user.id) {
      return error(res, 'CREATOR_CANNOT_LEAVE', 'The group creator cannot leave. Transfer ownership or delete the group.', 400);
    }

    if (group.isAnonymous) {
      if (req.anonIdentity?.identityId) {
        await prisma.anonymousIdentity.delete({ where: { id: req.anonIdentity.identityId } }).catch(() => {});
      }
      await prisma.anonGroupJoin.deleteMany({ where: { groupId: req.params.id, userId: req.user.id } });
      return success(res, { message: 'You have left the anonymous group.' });
    }

    await groupService.removeMember(req.params.id, req.user.id);
    const { evictUserFromGroup } = require('../services/chatSocketService');
    evictUserFromGroup(req.user.id, req.params.id);
    return success(res, { message: 'You have left the group.' });
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

// ============================================================
// MEMBERS
// ============================================================

/**
 * GET /api/v1/groups/:id/members — List group members.
 */
router.get('/:id/members', requireGroupMember, async (req, res, next) => {
  try {
    const members = await groupService.listMembers(req.params.id);
    return success(res, members);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/groups/:id/members — Add a member (friends added directly, others get invites).
 */
router.post(
  '/:id/members',
  requireGroupMember,
  requireGroupPermission('can_add_members'),
  groupAddMemberUserLimit,
  [body('userId').notEmpty().withMessage('userId is required.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const result = await groupService.addMember(req.params.id, req.body.userId, req.user.id);
      
      // If the user was invited (i.e. not added directly because they aren't friends), send a DM
      if (result.invited) {
        try {
          const group = await groupService.getGroup(req.params.id);
          const linkObj = await groupService.getInviteLink(req.params.id);
          await dmService.sendDM(req.user.id, req.body.userId, { 
            content: `Hi there! I'm inviting you to join the group "${group.displayName || group.name}". Join using this link: ${env.FRONTEND_URL}/join/${linkObj.token}` 
          }, true);
          result.dmSent = true;
        } catch (linkErr) {
          result.dmFailed = true;
        }
      }

      const status = result.invited ? 201 : 201;
      return success(res, result, status);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/groups/:id/members/:userId — Kick a member.
 */
router.delete('/:id/members/:userId', requireGroupMember, requireGroupPermission('can_kick_members'), async (req, res, next) => {
  try {
    // Verify ring hierarchy: actor must outrank target
    const targetMembership = await groupService.getMembership(req.params.id, req.params.userId);
    const actorRing = Math.min(req.user.globalRing ?? 3, req.groupMembership?.ring ?? 3);

    if (!canActOnUser(actorRing, targetMembership.ring)) {
      return error(res, 'RING_VIOLATION', 'Cannot kick a user at your level or above.', 403);
    }

    await groupService.removeMember(req.params.id, req.params.userId);
    const { evictUserFromGroup } = require('../services/chatSocketService');
    evictUserFromGroup(req.params.userId, req.params.id);
    emitToGroup(req.params.id, 'member:kicked', { userId: req.params.userId, kickedBy: req.user.id });
    return success(res, { message: 'Member removed.' });
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

// ============================================================
// USER SEARCH FOR GROUP INVITES
// ============================================================

/**
 * GET /api/v1/groups/:id/search-users?q=<query>
 * Search platform users to invite. Returns up to 15 results with isMember flag.
 */
router.get('/:id/search-users', requireGroupMember, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return success(res, []);

    const prisma = require('../prisma');
    const users = await prisma.user.findMany({
      where: {
        id: { not: req.user.id },
        OR: [
          { username: { startsWith: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true, displayName: true, username: true, avatarUrl: true,
      },
      take: 15,
      orderBy: { displayName: 'asc' },
    });

    // Tag each result with membership status
    const memberIds = (await prisma.groupMember.findMany({
      where: { groupId: req.params.id, userId: { in: users.map(u => u.id) } },
      select: { userId: true },
    })).map(m => m.userId);

    const pendingInviteIds = (await prisma.groupInvite.findMany({
      where: { groupId: req.params.id, userId: { in: users.map(u => u.id) }, status: 'pending' },
      select: { userId: true },
    })).map(i => i.userId);

    const results = users.map(u => ({
      ...u,
      isMember: memberIds.includes(u.id),
      hasPendingInvite: pendingInviteIds.includes(u.id),
    }));

    return success(res, results);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GROUP INVITES
// ============================================================

/**
 * GET /api/v1/groups/:id/invites — List pending invites for a group (admin view).
 */
router.get('/:id/invites', requireGroupMember, async (req, res, next) => {
  try {
    const invites = await groupService.listGroupInvites(req.params.id);
    return success(res, invites);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/groups/:id/invites — Create an invite for a non-friend user.
 */
router.post(
  '/:id/invites',
  requireGroupMember,
  requireGroupPermission('can_add_members'),
  [body('userId').notEmpty().withMessage('userId is required.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const invite = await groupService.createInvite(req.params.id, req.body.userId, req.user.id);
      return success(res, invite, 201);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

/**
 * POST /api/v1/groups/:id/invites/:inviteId/accept — Accept a group invite.
 * Anonymous groups: acceptance mints an identity; alias is required.
 */
router.post('/:id/invites/:inviteId/accept', requireMongoParams, [
  body('alias').optional().trim(),
  body('avatarUrl').optional().trim(),
], async (req, res, next) => {
  try {
    const { alias, avatarUrl } = req.body || {};
    const member = await groupService.acceptInvite(req.params.inviteId, req.user.id, alias, avatarUrl);
    return success(res, member);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * POST /api/v1/groups/:id/invites/:inviteId/reject — Reject a group invite.
 */
router.post('/:id/invites/:inviteId/reject', requireMongoParams, async (req, res, next) => {
  try {
    const result = await groupService.rejectInvite(req.params.inviteId, req.user.id);
    return success(res, result);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * Guard: in anonymous groups the group creator (and global admins) keep
 * moderation powers — but they act through their identity, so plain ring
 * permission checks don't apply. Must run after requireGroupMember.
 */
async function requireAnonCreator(req, res, next) {
  try {
    const group = req.group || await prisma.cohortGroup.findUnique({
      where: { id: req.params.id },
      select: { creatorId: true, isAnonymous: true },
    });
    if (!group) return error(res, 'GROUP_NOT_FOUND', 'Group not found.', 404);
    if (!group.isAnonymous) return next();

    const isCreator = group.creatorId === req.user.id;
    const isGlobalAdmin = req.user.globalRing === 0;

    if (!isCreator && !isGlobalAdmin) {
      return error(res, 'PERMISSION_DENIED', 'Only the group creator or platform admin can perform this action.', 403);
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/groups/:id/invite-link — Get or create the group's invite link.
 */
router.get('/:id/invite-link', requireGroupMember, requireAnonCreator, requireGroupPermission('can_add_members'), async (req, res, next) => {
  try {
    const linkObj = await groupService.getInviteLink(req.params.id);
    return success(res, linkObj);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// MUTE / UNMUTE
// ============================================================

/**
 * POST /api/v1/groups/:id/members/:userId/mute — Mute a member.
 */
router.post(
  '/:id/members/:userId/mute',
  requireGroupMember,
  requireGroupPermission('can_mute_members'),
  async (req, res, next) => {
    try {
      const targetMembership = await groupService.getMembership(req.params.id, req.params.userId);
      const actorRing = Math.min(req.user.globalRing ?? 3, req.groupMembership?.ring ?? 3);

      if (!canActOnUser(actorRing, targetMembership.ring)) {
        return error(res, 'RING_VIOLATION', 'Cannot mute a user at your level or above.', 403);
      }

      const durationMinutes = Math.min(Math.max(parseInt(req.body.durationMinutes, 10) || 60, 1), 525600); // max 1 year
      const mute = await groupService.muteMember(req.params.id, req.params.userId, req.user.id, durationMinutes);
      emitToGroup(req.params.id, 'member:muted', { userId: req.params.userId, mutedUntil: mute.mutedUntil, mutedBy: req.user.id });
      return success(res, mute);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/groups/:id/members/:userId/mute — Unmute a member.
 */
router.delete('/:id/members/:userId/mute', requireGroupMember, requireGroupPermission('can_mute_members'), async (req, res, next) => {
  try {
    const targetMembership = await groupService.getMembership(req.params.id, req.params.userId);
    const actorRing = Math.min(req.user.globalRing ?? 3, req.groupMembership?.ring ?? 3);

    if (!canActOnUser(actorRing, targetMembership.ring)) {
      return error(res, 'RING_VIOLATION', 'Cannot unmute a user at your level or above.', 403);
    }

    await groupService.unmuteMember(req.params.id, req.params.userId);
    emitToGroup(req.params.id, 'member:unmuted', { userId: req.params.userId });
    return success(res, { message: 'Member unmuted.' });
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

// ============================================================
// RING CONFIG (customizable ring names & count)
// ============================================================

/**
 * PATCH /api/v1/groups/:id/rings — Update ring configuration.
 * Body: { ringCount: 5, ringLabels: { "0": "Admin", "1": "Moderator", ... } }
 */
router.patch(
  '/:id/rings',
  requireGroupMember,
  requireGroupPermission('can_manage_roles'),
  async (req, res, next) => {
    try {
      const group = await prisma.cohortGroup.findUnique({ where: { id: req.params.id }, select: { creatorId: true } });
      const actorRing = Math.min(req.user.globalRing ?? 3, req.groupMembership?.ring ?? 3);
      if (actorRing !== 0 && group?.creatorId !== req.user.id) {
        return error(res, 'FORBIDDEN', 'Only the group creator or admin can modify ring configurations.', 403);
      }

      const result = await groupService.updateRingConfig(req.params.id, req.body);
      return success(res, result);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

// ============================================================
// RING & PERMISSIONS (per-group)
// ============================================================

/**
 * GET /api/v1/groups/:id/members/:userId/ring
 */
router.get('/:id/members/:userId/ring', requireGroupMember, async (req, res, next) => {
  try {
    const result = await groupService.getMemberRing(req.params.id, req.params.userId);
    return success(res, result);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * PATCH /api/v1/groups/:id/members/:userId/ring
 */
router.patch(
  '/:id/members/:userId/ring',
  requireGroupMember,
  requireGroupPermission('can_manage_roles'),
  [body('ring').isInt({ min: 0 }).withMessage('Ring must be a non-negative integer.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const actorRing = Math.min(req.user.globalRing ?? 3, req.groupMembership?.ring ?? 3);
      const result = await groupService.setMemberRing(req.params.id, actorRing, req.user.id, req.user.globalRing, req.params.userId, req.body.ring);
      emitToGroup(req.params.id, 'member:ring_changed', { userId: req.params.userId, newRing: req.body.ring });
      return success(res, result);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

/**
 * GET /api/v1/groups/:id/members/:userId/permissions
 */
router.get('/:id/members/:userId/permissions', requireGroupMember, async (req, res, next) => {
  try {
    const perms = await groupService.getMemberPermissions(req.params.id, req.params.userId);
    return success(res, perms);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * PATCH /api/v1/groups/:id/members/:userId/permissions
 */
router.patch(
  '/:id/members/:userId/permissions',
  requireGroupMember,
  requireGroupPermission('can_manage_roles'),
  async (req, res, next) => {
    try {
      const group = await prisma.cohortGroup.findUnique({ where: { id: req.params.id }, select: { creatorId: true } });
      const actorRing = Math.min(req.user.globalRing ?? 3, req.groupMembership?.ring ?? 3);
      const isCreatorOrAdmin = req.user.globalRing === 0 || group?.creatorId === req.user.id;
      const actorPerms = req.groupMembership?.permissions || {};

      const result = await groupService.setMemberPermissions(req.params.id, actorRing, req.params.userId, req.body, actorPerms, isCreatorOrAdmin);
      emitToGroup(req.params.id, 'member:permissions_changed', { userId: req.params.userId, permissions: result.permissions });
      return success(res, result);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

// ============================================================
// ANONYMOUS GROUPS — identity claim, rename, reports, bans, word bans
// ============================================================

/**
 * POST /api/v1/groups/:id/anons/claim — Creator claims their alias right
 * after creating an anonymous group. The resulting secret is given to the
 * client once and never stored.
 */
router.post('/:id/anons/claim', authMiddleware, requireMongoParams, [
  body('alias').trim().notEmpty().withMessage('Alias is required.'),
  body('avatarUrl').optional().trim(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
        errors.array().map(e => ({ field: e.path, issue: e.msg }))
      );
    }
    const group = await prisma.cohortGroup.findUnique({
      where: { id: req.params.id },
      select: { creatorId: true, isAnonymous: true },
    });
    if (!group) return error(res, 'GROUP_NOT_FOUND', 'Group not found.', 404);
    if (!group.isAnonymous) return error(res, 'NOT_ANONYMOUS', 'This group is not anonymous.', 400);
    if (group.creatorId !== req.user.id && req.user.globalRing !== 0) {
      return error(res, 'PERMISSION_DENIED', 'Only the group creator can claim the first identity.', 403);
    }

    const identity = await groupService.claimAnonIdentity(req.params.id, req.user.id, req.body.alias, req.body.avatarUrl);
    return success(res, identity, 201);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * GET /api/v1/groups/:id/anons/me — The current identity (needs
 * x-anon-identity header). Used to re-auth on page reload.
 */
router.get('/:id/anons/me', requireGroupMember, async (req, res, next) => {
  try {
    if (!req.anonIdentity) return error(res, 'NOT_ANONYMOUS', 'This group is not anonymous.', 400);
    return success(res, req.anonIdentity);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/groups/:id/anons/enter — Lightweight "have I joined?" check for
 * anon groups WITHOUT needing an identity header. Used when the user opens an
 * anonymous group with no session (e.g. cookies cleared): joined:true means
 * "prompt for your saved key", false means "you need an invite".
 */
router.get('/:id/anons/enter', authMiddleware, requireMongoParams, async (req, res, next) => {
  try {
    const group = await prisma.cohortGroup.findUnique({
      where: { id: req.params.id },
      select: { id: true, isAnonymous: true, creatorId: true, name: true, displayName: true, avatarUrl: true, description: true },
    });
    if (!group) return error(res, 'GROUP_NOT_FOUND', 'Group not found.', 404);
    if (!group.isAnonymous) return error(res, 'NOT_ANONYMOUS', 'This group is not anonymous.', 400);

    const joined = await groupService.hasAnonJoin(group.id, req.user.id);
    return success(res, {
      groupId: group.id,
      joined,
      isAnonymous: true,
      name: group.name,
      displayName: group.displayName,
      avatarUrl: group.avatarUrl,
      description: group.description,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/groups/:id/anons/restore — Restore an identity from a saved
 * cryptographic key (`identityId.secret`). Enrollment requires the boolean
 * AnonGroupJoin flag (or the creator). On success the client stores the SAME
 * key back into cookies — the key never changes, no server copy exists.
 */
router.post('/:id/anons/restore', authMiddleware, requireMongoParams, [
  body('key').trim().notEmpty().withMessage('Your saved key is required.'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
        errors.array().map(e => ({ field: e.path, issue: e.msg }))
      );
    }
    const identity = await groupService.restoreAnonIdentity(
      req.params.id, req.body.key.trim(), req.user.id
    );
    return success(res, identity);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * POST /api/v1/groups/:id/anons/rename — Rename own identity + rotate secret.
 * The old alias is permanently released (no cross-name tracking).
 */
router.post('/:id/anons/rename', requireGroupMember, [
  body('alias').trim().notEmpty().withMessage('Alias is required.'),
  body('avatarUrl').optional().trim(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
        errors.array().map(e => ({ field: e.path, issue: e.msg }))
      );
    }
    if (!req.anonIdentity) return error(res, 'NOT_ANONYMOUS', 'This group is not anonymous.', 400);
    const secret = req.anonIdentity.secret || req.headers['x-anon-identity']?.split('.')[1];
    const result = await groupService.renameAnonIdentity(
      req.anonIdentity.identityId,
      secret,
      req.body.alias,
      req.body.avatarUrl
    );
    // Other clients see the new alias via the refresh below.
    emitToGroup(req.params.id, 'anon:identityChanged', { identityId: req.anonIdentity.identityId });
    return success(res, result);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

const anonReportIpLimit = rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many reports submitted. Please wait a bit.',
  keyPrefix: 'anon-report-ip',
});

/**
 * POST /api/v1/groups/:id/anons/report — Report an identity (hidden report:
 * the creator sees only the alias + report count, never anyone's real user).
 */
router.post('/:id/anons/report', requireGroupMember, anonReportIpLimit, [
  body('targetIdentityId').notEmpty().withMessage('targetIdentityId is required.'),
  body('reason').trim().isLength({ max: 500 }).withMessage('A short reason is required (max 500 chars).'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
        errors.array().map(e => ({ field: e.path, issue: e.msg }))
      );
    }
    if (!req.anonIdentity) return error(res, 'NOT_ANONYMOUS', 'An anonymous identity is required to report in this group.', 400);
    if (req.anonIdentity.identityId === req.body.targetIdentityId) {
      return error(res, 'SELF_REPORT', 'You cannot report yourself.', 400);
    }
    const target = await prisma.anonymousIdentity.findFirst({
      where: { id: req.body.targetIdentityId, groupId: req.params.id },
      select: { id: true, bannedAt: true },
    });
    if (!target) return error(res, 'NOT_FOUND', 'Identity not found in this group.', 404);

    const existing = await prisma.anonReport.findFirst({
      where: {
        groupId: req.params.id,
        targetIdentityId: req.body.targetIdentityId,
        reporterIdentityId: req.anonIdentity.identityId,
        status: 'open',
      },
    });
    if (existing) {
      return error(res, 'REPORT_EXISTS', 'You already have an open report for this identity.', 409);
    }

    await prisma.anonReport.create({
      data: {
        groupId: req.params.id,
        targetIdentityId: req.body.targetIdentityId,
        reporterIdentityId: req.anonIdentity.identityId,
        reason: req.body.reason.slice(0, 500),
      },
    });
    return success(res, { message: 'Report submitted. The group creator can review it.' }, 201);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * GET /api/v1/groups/:id/anons/reports — Creator view: identities with
 * open reports (alias + tag + avatar only — never user info).
 */
router.get('/:id/anons/reports', requireGroupMember, requireAnonCreator, async (req, res, next) => {
  try {
    const grp = await prisma.cohortGroup.findUnique({ where: { id: req.params.id }, select: { isAnonymous: true } });
    if (!grp?.isAnonymous) return error(res, 'NOT_ANONYMOUS', 'This group is not anonymous.', 400);

    const reports = await prisma.anonReport.findMany({
      where: { groupId: req.params.id, status: 'open' },
      orderBy: { createdAt: 'desc' },
    });
    const ids = [...new Set(reports.map(r => r.targetIdentityId))];
    const identities = ids.length > 0
      ? await prisma.anonymousIdentity.findMany({ where: { id: { in: ids } }, select: { id: true, alias: true, aliasTag: true, avatarUrl: true, bannedAt: true } })
      : [];
    const byId = Object.fromEntries(identities.map(i => [i.id, i]));

    const grouped = {};
    for (const r of reports) {
      if (!grouped[r.targetIdentityId]) {
        grouped[r.targetIdentityId] = {
          identity: byId[r.targetIdentityId] || { id: r.targetIdentityId, alias: 'Unknown', aliasTag: '????' },
          reports: [],
        };
      }
      grouped[r.targetIdentityId].reports.push({
        reason: r.reason, createdAt: r.createdAt,
      });
    }
    return success(res, Object.values(grouped));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/groups/:id/anons/:identityId/ban — Creator bans an identity.
 * The owner is never revealed; their future posts are rejected and their
 * messages are hidden from the feed.
 */
router.post('/:id/anons/:identityId/ban', requireGroupMember, requireAnonCreator, async (req, res, next) => {
  try {
    const grp = await prisma.cohortGroup.findUnique({ where: { id: req.params.id }, select: { isAnonymous: true } });
    if (!grp?.isAnonymous) return error(res, 'NOT_ANONYMOUS', 'This group is not anonymous.', 400);

    const target = await prisma.anonymousIdentity.findFirst({
      where: { id: req.params.identityId, groupId: req.params.id },
    });
    if (!target) return error(res, 'NOT_FOUND', 'Identity not found in this group.', 404);

    await prisma.anonymousIdentity.update({
      where: { id: target.id },
      data: { bannedAt: new Date() },
    });
    // Close open reports against them.
    await prisma.anonReport.updateMany({
      where: { groupId: req.params.id, targetIdentityId: target.id, status: 'open' },
      data: { status: 'cleared' },
    });
    const { evictAnonIdentityFromGroup } = require('../services/chatSocketService');
    evictAnonIdentityFromGroup(target.id, req.params.id);

    emitToGroup(req.params.id, 'anon:moderation', {
      type: 'ban', identityId: target.id,
      groupId: req.params.id, at: new Date().toISOString(),
    });
    return success(res, { message: 'Identity banned.', identityId: target.id });
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * POST /api/v1/groups/:id/anons/:identityId/unban — Creator un-bans.
 */
router.post('/:id/anons/:identityId/unban', requireGroupMember, requireAnonCreator, async (req, res, next) => {
  try {
    const grp = await prisma.cohortGroup.findUnique({ where: { id: req.params.id }, select: { isAnonymous: true } });
    if (!grp?.isAnonymous) return error(res, 'NOT_ANONYMOUS', 'This group is not anonymous.', 400);

    const target = await prisma.anonymousIdentity.findFirst({
      where: { id: req.params.identityId, groupId: req.params.id },
    });
    if (!target) return error(res, 'NOT_FOUND', 'Identity not found in this group.', 404);
    await prisma.anonymousIdentity.update({
      where: { id: target.id },
      data: { bannedAt: null },
    });
    emitToGroup(req.params.id, 'anon:moderation', {
      type: 'unban', identityId: target.id,
      groupId: req.params.id, at: new Date().toISOString(),
    });
    return success(res, { message: 'Identity un-banned.', identityId: target.id });
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * PUT /api/v1/groups/:id/wordbans — Creator sets the word-ban list.
 * Body: { words: ["...", "..."] }
 */
router.put('/:id/wordbans', requireGroupMember, requireAnonCreator, [
  body('words').isArray({ max: 100 }).withMessage('words must be an array (max 100).'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
        errors.array().map(e => ({ field: e.path, issue: e.msg }))
      );
    }
    const words = req.body.words
      .map(w => String(w).trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 100);
    await prisma.cohortGroup.update({
      where: { id: req.params.id },
      data: { wordBanList: words },
    });
    return success(res, { message: 'Word ban list updated.', words });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/groups/:id/anons/leave — Permanently delete own identity.
 * Past messages keep the alias snapshot; the alias+freedom secret is released.
 */
router.post('/:id/anons/leave', requireGroupMember, async (req, res, next) => {
  try {
    if (!req.anonIdentity) return error(res, 'NOT_ANONYMOUS', 'This group is not anonymous.', 400);
    await prisma.anonymousIdentity.delete({ where: { id: req.anonIdentity.identityId } }).catch(() => {});
    await prisma.anonGroupJoin.deleteMany({ where: { groupId: req.params.id, userId: req.user.id } });
    return success(res, { message: 'Identity deleted. Your alias is released.' });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// MESSAGES (REST fallback — prefer WebSocket for real-time)
// ============================================================

/**
 * GET /api/v1/groups/:id/messages — Paginated message history.
 */
router.get('/:id/messages', requireGroupMember, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 100);
    const result = await messageService.getMessages(req.params.id, { page, limit }, req.user.id, !!req.anonIdentity);
    return success(res, result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/groups/:id/messages/pinned — List pinned messages.
 */
router.get('/:id/messages/pinned', requireGroupMember, async (req, res, next) => {
  try {
    const messages = await messageService.getPinnedMessages(req.params.id);
    return success(res, messages);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/groups/:id/messages/:msgId — Get a single message.
 */
router.get('/:id/messages/:msgId', requireGroupMember, async (req, res, next) => {
  try {
    const msg = await messageService.getMessage(req.params.msgId, req.params.id, !!req.anonIdentity);
    return success(res, msg);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * PATCH /api/v1/groups/:id/messages/:msgId/react — Toggle emoji reaction on a message.
 */
router.patch('/:id/messages/:msgId/react', requireGroupMember, async (req, res, next) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return error(res, 'VALIDATION_ERROR', 'Emoji is required.', 400);

    const grp = await prisma.cohortGroup.findUnique({
      where: { id: req.params.id },
      select: { isAnonymous: true },
    });
    if (grp?.isAnonymous && !req.anonIdentity) {
      return error(res, 'ANON_IDENTITY_REQUIRED', 'An anonymous identity is required to react in this group.', 403);
    }

    const msg = await messageService.toggleReaction(req.params.msgId, req.user.id, emoji, req.params.id, req.anonIdentity || null);
    // Notify clients instantly of the updated reaction strip
    emitToGroup(req.params.id, 'message:react', { messageId: msg.id, reactions: msg.reactions });
    
    return success(res, msg);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * POST /api/v1/groups/:id/messages — Send a message, optionally with an attachment, reply, or forward.
 */
router.post(
  '/:id/messages',
  requireGroupMember,
  requireGroupPermission('can_send_messages'),
  messageUpload.single('attachment'),
  async (req, res, next) => {
    try {
      // Manual validation because body may be multipart form-data
      const content = (req.body.content || '').trim();
      if (!content && !req.file) {
        return error(res, 'VALIDATION_ERROR', 'Message content or attachment is required.', 400);
      }

      const grp = await prisma.cohortGroup.findUnique({
        where: { id: req.params.id },
        select: { wordBanList: true, isAnonymous: true },
      });
      if (grp?.isAnonymous && !req.anonIdentity) {
        return error(res, 'ANON_IDENTITY_REQUIRED', 'An anonymous identity is required to participate in this group.', 403);
      }

      // Check mute status (user-level — anonymous identities can't be muted,
      // only banned; this check is skipped for anon groups).
      if (!req.anonIdentity) {
        const muteStatus = await groupService.isMuted(req.params.id, req.user.id);
        if (muteStatus) {
          return error(res, 'USER_MUTED', `You are muted until ${muteStatus.mutedUntil.toISOString()}.`, 403);
        }
      }

      const params = {
        content,
        mentions: req.anonIdentity ? [] : parseMentions(req.body.mentions),
        replyToId: req.body.replyToId || undefined,
        forwarded: req.body.forwarded === 'true',
        msgType: req.body.msgType || 'text',
      };

      if (req.file) {
        if (!validateStoredFile(req.file.path, req.file.mimetype)) {
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
          return error(res, 'INVALID_FILE_TYPE', 'The uploaded file header does not match its type.', 400);
        }
        params.fileUrl = await storeFile(req.file, { folder: 'comflex/messages', localUrlPrefix: '/uploads/messages' });
        const ext = path.extname(req.file.originalname) || '';
        params.fileName = req.anonIdentity ? `attachment${ext}` : req.file.originalname;
        params.fileSize = req.file.size;
        params.mimetype = req.file.mimetype;
        if (params.msgType === 'text') {
           // auto detect type
           if (req.file.mimetype.startsWith('image/')) params.msgType = 'image';
           else params.msgType = 'document';
        }
      }

      // Word-ban filter (creator-configured, anonymous and normal groups)
      if (content) {
        const bannedWord = groupService.containsBannedWord(content, grp?.wordBanList);
        if (bannedWord) {
          return error(res, 'BANNED_WORD', `Your message contains a banned word ("${bannedWord}").`, 403);
        }
      }

      const msg = await messageService.sendMessage(
        req.params.id,
        req.user.id,
        params,
        req.anonIdentity || null
      );
      
      // We emit a socket here so real-time clients see it immediately
      emitToGroup(req.params.id, 'message:new', msg);

      return success(res, msg, 201);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/groups/:id/messages/read — Mark all messages in group as read.
 * Advances the caller's lastReadAt high-water mark (single field write).
 */
router.post('/:id/messages/read', requireGroupMember, async (req, res, next) => {
  try {
    // Anonymous groups have no per-user unread tracking — skip.
    if (req.anonIdentity) return success(res, { success: true, anonSkipped: true });
    await groupService.markGroupRead(req.params.id, req.user.id);
    return success(res, { success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/groups/:id/unread — Get unread count for current user.
 */
// Anonymous groups have no per-user unread tracking — report 0.
    router.get('/:id/unread', requireGroupMember, async (req, res, next) => {
      try {
        if (req.anonIdentity) return success(res, { unreadCount: 0 });
        const count = await groupService.getUnreadCount(req.params.id, req.user.id);
        return success(res, { unreadCount: count });
      } catch (err) {
        next(err);
      }
    });

/**
 * PATCH /api/v1/groups/:id/messages/:msgId — Edit own message.
 */
router.patch(
  '/:id/messages/:msgId',
  requireGroupMember,
  [body('content').trim().notEmpty().withMessage('Content is required.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      if (!req.anonIdentity) {
        const muteStatus = await groupService.isMuted(req.params.id, req.user.id);
        if (muteStatus) {
          return error(res, 'USER_MUTED', `You are muted until ${muteStatus.mutedUntil.toISOString()}.`, 403);
        }
      }
      const grp = await prisma.cohortGroup.findUnique({
        where: { id: req.params.id },
        select: { wordBanList: true },
      });
      const bannedWord = groupService.containsBannedWord(req.body.content, grp?.wordBanList);
      if (bannedWord) {
        return error(res, 'BANNED_WORD', `Your message contains a banned word ("${bannedWord}").`, 403);
      }

      const msg = await messageService.editMessage(req.params.msgId, req.user.id, req.body.content, req.params.id, req.anonIdentity || null);

      // Broadcast edit to all connected clients in the group
      emitToGroup(req.params.id, 'message:edit', msg);

      return success(res, msg);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/groups/:id/messages/:msgId — Delete a message.
 */
router.delete('/:id/messages/:msgId', requireGroupMember, async (req, res, next) => {
  try {
    const perms = req.groupMembership?.permissions || {};
    const grp = await prisma.cohortGroup.findUnique({
      where: { id: req.params.id },
      select: { creatorId: true, isAnonymous: true },
    });
    let canDeleteOthers = grp?.creatorId === req.user.id || req.user.globalRing === 0;
    if (!grp?.isAnonymous && !canDeleteOthers) {
      canDeleteOthers = perms.can_delete_others_messages === true;
    }

    const actorRing = Math.min(req.user.globalRing ?? 3, req.groupMembership?.ring ?? 3);
    const msg = await messageService.deleteMessage(req.params.msgId, req.user.id, canDeleteOthers, req.params.id, req.anonIdentity || null, actorRing);

    // Broadcast deletion to all connected clients in the group
    emitToGroup(req.params.id, 'message:delete', {
      messageId: req.params.msgId,
      groupId: req.params.id,
      deletedBy: req.anonIdentity ? `anon:${req.anonIdentity.identityId}` : req.user.id,
    });

    return success(res, { message: 'Message deleted.' });
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * POST /api/v1/groups/:id/messages/:msgId/pin — Pin a message.
 */
router.post('/:id/messages/:msgId/pin', requireGroupMember, requireAnonCreator, requireGroupPermission('can_pin_messages'), async (req, res, next) => {
  try {
    const { msg, unpinnedIds } = await messageService.pinMessage(req.params.msgId, req.params.id);
    emitToGroup(req.params.id, 'message:pinnedUpdate', { pinnedMsg: msg, unpinnedIds });
    return success(res, { msg, unpinnedIds });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/groups/:id/messages/:msgId/pin — Unpin a message.
 */
router.delete('/:id/messages/:msgId/pin', requireGroupMember, requireAnonCreator, requireGroupPermission('can_pin_messages'), async (req, res, next) => {
  try {
    const msg = await messageService.unpinMessage(req.params.msgId, req.params.id);
    emitToGroup(req.params.id, 'message:unpinned', { messageId: msg.id });
    return success(res, msg);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

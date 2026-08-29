/**
 * Group Service
 *
 * Business logic for group CRUD, membership management,
 * ring/permission changes, mute/unmute, and group invites.
 */

const prisma = require('../prisma');
const { canActOnUser } = require('../middleware/ringCheck');
const { issueSecret, hashSecret, verifySecret, issueAliasTag } = require('../utils/anonIdentity');
const { sanitizeUrl } = require('../utils/urlSafety');

const ALIAS_MAX_LEN = 24;

// Prisma 6 (Mongo) translates `bannedAt: null` into "field exists AND equals
// null", which misses documents where the optional field was never written.
// "Not banned" must match both a stored null and an absent field.
const NOT_BANNED = { OR: [{ bannedAt: null }, { bannedAt: { isSet: false } }] };

// All permission keys that may ever be granted — anything outside this set
// is dropped, so a client-supplied permissions blob can't smuggle arbitrary
// JSON into the membership document or future keys we don't know about yet.
const ALL_PERMISSION_KEYS = new Set([
  'can_send_messages', 'can_delete_own_messages', 'can_delete_others_messages',
  'can_mute_members', 'can_kick_members', 'can_add_members', 'can_tag_members',
  'can_manage_economy', 'can_create_events', 'can_pin_messages',
  'can_manage_roles', 'can_edit_group_info', 'can_stop_others_tagging',
]);

/** Whitelist a raw permissions object down to known boolean keys. */
function cleanPermissions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of ALL_PERMISSION_KEYS) {
    if (raw[key] === true || raw[key] === 'true' || raw[key] === 1) out[key] = true;
    else if (raw[key] === false || raw[key] === 'false' || raw[key] === 0) out[key] = false;
  }
  return out;
}

/**
 * Strip invite secrets + rotate-on-next-fetch state from a group object
 * before it reaches any client that is not the link-holder. Invite tokens
 * are only (re)shared through getInviteLink.
 */
function sanitizeGroup(group) {
  if (!group) return group;
  const { inviteToken, inviteTokenExpiry, ...safe } = group;
  return safe;
}

// Full admin permissions object
const ADMIN_PERMISSIONS = {
  can_send_messages: true, can_delete_own_messages: true,
  can_delete_others_messages: true, can_mute_members: true,
  can_kick_members: true, can_add_members: true, can_tag_members: true,
  can_manage_economy: true, can_create_events: true, can_pin_messages: true,
  can_manage_roles: true, can_edit_group_info: true, can_stop_others_tagging: true,
};

const ELEVATED_PERMISSIONS = {
  can_send_messages: true, can_delete_own_messages: true,
  can_delete_others_messages: true, can_mute_members: true,
  can_kick_members: true, can_add_members: true, can_tag_members: true,
  can_manage_economy: false, can_create_events: false, can_pin_messages: true,
  can_manage_roles: false, can_edit_group_info: false, can_stop_others_tagging: true,
};

const MEMBER_PERMISSIONS = {
  can_send_messages: true, can_delete_own_messages: true,
  can_delete_others_messages: false, can_mute_members: false,
  can_kick_members: false, can_add_members: false, can_tag_members: true,
  can_manage_economy: false, can_create_events: false, can_pin_messages: false,
  can_manage_roles: false, can_edit_group_info: false, can_stop_others_tagging: false,
};

function getDefaultPermissions(ring) {
  if (ring === 0) return { ...ADMIN_PERMISSIONS };
  if (ring <= 2) return { ...ELEVATED_PERMISSIONS };
  return { ...MEMBER_PERMISSIONS };
}

/**
 * List all groups the user belongs to, with unread counts.
 * Anonymous memberships are merged in from the identity sessions the client
 * presents — the server never learns an identity's owner, so it can't look
 * anon groups up by userId.
 * @param {string} userId
 * @param {Array<{groupId: string, identityId: string, secret: string}>} anonSessions
 */
async function listUserGroups(userId, anonSessions = []) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    include: {
      group: {
        include: { _count: { select: { members: true } } },
      },
    },
    orderBy: { joinedAt: 'desc' },
  });

  // Get unread counts for each group
  const groupIds = memberships.map(m => m.groupId);
  const unreadCounts = await getUnreadCountsBatch(userId, groupIds);

  const groups = memberships.map((m) => ({
    ...sanitizeGroup(m.group),
    memberCount: m.group?._count?.members || 0,
    userRing: m.ring,
    userPermissions: m.permissions,
    unreadCount: unreadCounts[m.groupId] || 0,
  }));

  // Identify-only sessions for anonymous groups
  if (Array.isArray(anonSessions) && anonSessions.length > 0) {
    const validIdentityIds = anonSessions
      .map(s => s && typeof s === 'object' ? s.identityId : null)
      .filter(id => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id));

    if (validIdentityIds.length > 0) {
      const identities = await prisma.anonymousIdentity.findMany({
        where: {
          id: { in: validIdentityIds },
          ...NOT_BANNED,
        },
      });
      const anonGroupIds = [...new Set(identities.map(i => i.groupId))];
      if (anonGroupIds.length > 0) {
        const anonGroups = await prisma.cohortGroup.findMany({
          where: { id: { in: anonGroupIds }, isAnonymous: true },
          include: { _count: { select: { anonIdentities: true } } },
        });
        const counts = await prisma.anonymousIdentity.groupBy({
          by: ['groupId'],
          _count: { _all: true },
          where: { groupId: { in: anonGroupIds }, ...NOT_BANNED },
        }).catch(() => []);
        const countMap = Object.fromEntries(counts.map(c => [c.groupId, c._count._all]));

        for (const session of anonSessions) {
          if (!session || !session.identityId || !session.secret) continue;
          const identity = identities.find(i => i.id === session.identityId);
          if (!identity || !verifySecret(session.secret, identity.secretHash)) continue;
          const group = anonGroups.find(g => g.id === identity.groupId);
          if (!group) continue;
          if (groups.some(g => g.id === group.id)) continue; // dedupe
          groups.push({
            ...sanitizeGroup(group),
            memberCount: countMap[group.id] ?? group._count?.anonIdentities ?? 0,
            isAnonymous: true,
            userRing: null,
            userPermissions: null,
            unreadCount: 0,
            myIdentity: {
              identityId: identity.id,
              alias: identity.alias,
              aliasTag: identity.aliasTag,
              avatarUrl: identity.avatarUrl,
            },
          });
        }
      }
    }
  }

  // Groups the user has joined anonymously (boolean flag in AnonGroupJoin) but
  // for which they currently hold no valid session — e.g. cookies cleared.
  // They still appear so the UI can prompt for the saved key to restore in.
  const anonJoins = await prisma.anonGroupJoin.findMany({
    where: { userId },
    include: {
      group: {
        include: { _count: { select: { anonIdentities: true } } },
      },
    },
    orderBy: { joinedAt: 'desc' },
  });
  for (const join of anonJoins) {
    if (!join.group || !join.group.isAnonymous) continue;
    if (groups.some(g => g.id === join.groupId)) continue; // dedupe (active session)
    groups.push({
      ...sanitizeGroup(join.group),
      memberCount: join.group._count?.anonIdentities || 0,
      isAnonymous: true,
      userRing: null,
      userPermissions: null,
      unreadCount: 0,
      myIdentity: null,   // no session on this device — restore via key
      needsKeyRestore: true,
    });
  }

  // Anonymous groups the user created. The creator isn't stored as an identity
  // (they have not claimed an alias yet) and has no GroupMember row, so it
  // would otherwise never surface in the list. It appears so the creator can
  // reopen the group and claim their identity.
  const createdAnon = await prisma.cohortGroup.findMany({
    where: { creatorId: userId, isAnonymous: true },
    include: { _count: { select: { anonIdentities: true } } },
  });
  for (const group of createdAnon) {
    // The creator does not explicitly de-anonymise; they may hold a session
    // via AnonGroupJoin or an active identity, so dedupe broadly.
    if (groups.some(g => g.id === group.id)) continue;
    groups.push({
      ...sanitizeGroup(group),
      memberCount: group._count?.anonIdentities || 0,
      isAnonymous: true,
      userRing: null,
      userPermissions: null,
      unreadCount: 0,
      myIdentity: null,
      needsKeyRestore: false,
    });
  }

  return groups;
}

/**
 * Get unread counts for multiple groups at once.
 */
async function getUnreadCountsBatch(userId, groupIds) {
  const counts = {};
  for (const gid of groupIds) {
    counts[gid] = await getUnreadCount(gid, userId);
  }
  return counts;
}

/**
 * Get unread message count for a user in a group.
 * A message is "unread" if it was sent after the user's lastReadAt
 * high-water mark (falling back to their join time), wasn't authored by
 * them, and isn't deleted.
 */
async function getUnreadCount(groupId, userId) {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (!membership) return 0;

  const waterMark = membership.lastReadAt || membership.joinedAt;
  return prisma.message.count({
    where: {
      groupId,
      authorId: { not: userId },
      isDeleted: false,
      createdAt: { gt: waterMark },
    },
  });
}

/**
 * Mark all messages in a group as read for a user by advancing their
 * lastReadAt high-water mark. One field update — no per-message writes.
 */
async function markGroupRead(groupId, userId) {
  return prisma.groupMember.update({
    where: { userId_groupId: { userId, groupId } },
    data: { lastReadAt: new Date() },
  });
}

/**
 * Get a single group with member count.
 */
async function getGroup(groupId) {
  const group = await prisma.cohortGroup.findUnique({
    where: { id: groupId },
    include: { _count: { select: { members: true, anonIdentities: { where: { ...NOT_BANNED } } } } },
  });
  if (!group) throw Object.assign(new Error('Group not found.'), { statusCode: 404, code: 'GROUP_NOT_FOUND' });
  const memberCount = group.isAnonymous ? group._count.anonIdentities : group._count.members;
  const { _count, ...safe } = group;
  return { ...sanitizeGroup(safe), memberCount };
}

/**
 * Create a new group. Any authenticated user can create.
 * Creator is automatically added as Ring 0 admin (normal groups) — for
 * anonymous groups there are no rings and no GroupMember rows; the creator
 * claims an alias via POST /groups/:id/anons/claim right after.
 */
async function createGroup({ name, displayName, description, type = 'custom', creatorId, avatarUrl, isAnonymous = false }) {
  const existing = await prisma.cohortGroup.findUnique({ where: { name } });
  if (existing) throw Object.assign(new Error('A group with this name already exists.'), { statusCode: 409, code: 'DUPLICATE_GROUP' });

  const group = await prisma.cohortGroup.create({
    data: { name, displayName, description, type, creatorId, avatarUrl: sanitizeUrl(avatarUrl), isAnonymous },
  });

  // Auto-add creator as Ring 0 admin with full permissions
  if (creatorId && !isAnonymous) {
    await prisma.groupMember.create({
      data: {
        userId: creatorId,
        groupId: group.id,
        ring: 0,
        permissions: ADMIN_PERMISSIONS,
      },
    });
  }

  return sanitizeGroup(group);
}

/**
 * Update group info.
 */
async function updateGroup(groupId, updates) {
  const allowed = {};
  if (updates.displayName !== undefined) allowed.displayName = updates.displayName;
  if (updates.description !== undefined) allowed.description = updates.description;
  if (updates.avatarUrl !== undefined) allowed.avatarUrl = sanitizeUrl(updates.avatarUrl);
  if (updates.ringConfig !== undefined) allowed.ringConfig = updates.ringConfig;

  return sanitizeGroup(await prisma.cohortGroup.update({ where: { id: groupId }, data: allowed }));
}

/**
 * Delete a group and all associated data.
 */
async function deleteGroup(groupId) {
  try {
    const { emitToGroup } = require('./chatSocketService');
    emitToGroup(groupId, 'group:deleted', { groupId });
  } catch { /* socket emission is best effort */ }
  await prisma.cohortGroup.delete({ where: { id: groupId } });
}

/**
 * List group members with user profile data.
 */
async function listMembers(groupId) {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    include: {
      user: {
        select: {
          id: true, displayName: true, username: true, avatarUrl: true,
          globalRing: true, cohortTags: true, displayBadges: true, cfHandle: true, cfRating: true,
        },
      },
    },
    orderBy: { ring: 'asc' },
  });

  // Get group to check creatorId
  const group = await prisma.cohortGroup.findUnique({ where: { id: groupId }, select: { creatorId: true } });

  return members.map((m) => ({
    ...m.user,
    groupRing: m.ring,
    permissions: m.permissions,
    joinedAt: m.joinedAt,
    isCreator: group?.creatorId === m.userId,
  }));
}

/**
 * Get a user's membership in a group.
 */
async function getMembership(groupId, userId) {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (!membership) throw Object.assign(new Error('User is not a member of this group.'), { statusCode: 404, code: 'NOT_A_MEMBER' });
  return membership;
}

/**
 * Check if two users are friends.
 */
async function areFriends(userId1, userId2) {
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: 'accepted',
      OR: [
        { requesterId: userId1, addresseeId: userId2 },
        { requesterId: userId2, addresseeId: userId1 },
      ],
    },
  });
  return !!friendship;
}

/**
 * Add a member to a group.
 * If the target is a friend of the adder, add directly.
 * If not a friend, create a group invite instead (unless bypassFriendCheck is true).
 */
async function addMember(groupId, userId, addedByUserId, ringInput, bypassFriendCheck = false) {
  const existing = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (existing) throw Object.assign(new Error('User is already a member.'), { statusCode: 409, code: 'ALREADY_MEMBER' });

  // Anonymous groups have no GroupMember rows — membership is an identity the
  // invitee claims themselves (they must pick an alias). Route through invites.
  const groupInfo = await prisma.cohortGroup.findUnique({ where: { id: groupId }, select: { isAnonymous: true, ringConfig: true } });
  if (groupInfo?.isAnonymous) {
    return createInvite(groupId, userId, addedByUserId || userId);
  }

  // Check friendship (skip for system/admin additions where addedByUserId is null, or if bypass requested)
  if (!bypassFriendCheck && addedByUserId && addedByUserId !== userId) {
    const friends = await areFriends(addedByUserId, userId);
    if (!friends) {
      // Create an invite instead of adding directly
      return createInvite(groupId, userId, addedByUserId);
    }
  }

  // Get default joining ring
  const defaultRingSetting = groupInfo?.ringConfig?.defaultRing !== undefined ? groupInfo.ringConfig.defaultRing : 3;
  const computedRing = ringInput !== undefined ? ringInput : defaultRingSetting;

  const permissions = getDefaultPermissions(computedRing);

  const member = await prisma.groupMember.create({
    data: { userId, groupId, ring: computedRing, permissions },
  });

  return { ...member, invited: false };
}

/**
 * Remove (kick) a member from a group.
 */
async function removeMember(groupId, userId) {
  // Prevent kicking the group creator
  const group = await prisma.cohortGroup.findUnique({ where: { id: groupId }, select: { creatorId: true } });
  if (group?.creatorId === userId) {
    throw Object.assign(new Error('Cannot remove the group creator.'), { statusCode: 403, code: 'CANNOT_REMOVE_CREATOR' });
  }

  await prisma.groupMember.delete({
    where: { userId_groupId: { userId, groupId } },
  });
}

/**
 * Get a member's ring in a group.
 */
async function getMemberRing(groupId, userId) {
  const m = await getMembership(groupId, userId);
  return { ring: m.ring };
}

/**
 * Set a member's ring in a group. Enforces ring hierarchy.
 * Cannot demote the group creator. Actors can only assign rings
 * STRICTLY below their own — moderators can never promote anyone
 * (including themselves via a puppet) to their level or above.
 */
async function setMemberRing(groupId, actorRing, actorUserId, actorGlobalRing, targetUserId, newRing) {
  const target = await getMembership(groupId, targetUserId);

  // Protect group creator from demotion
  const group = await prisma.cohortGroup.findUnique({ where: { id: groupId }, select: { creatorId: true } });
  if (group?.creatorId === targetUserId && newRing > target.ring) {
    throw Object.assign(new Error('Cannot demote the group creator.'), { statusCode: 403, code: 'CANNOT_DEMOTE_CREATOR' });
  }

  // Actors cannot modify users at their own level or above
  if (!canActOnUser(actorRing, target.ring)) {
    throw Object.assign(new Error('Cannot modify ring of a user at your level or above.'), { statusCode: 403, code: 'RING_VIOLATION' });
  }

  // HARDENING: An actor can elevate up to their own ring level (e.g. Ring 1
  // manager can elevate a member to Ring 1), but cannot elevate above their own level.
  // Ring 0 (admin) is strictly reserved for the group creator or global admin.
  const actorIsCreator = group?.creatorId === actorUserId;
  const actorIsGlobalAdmin = actorGlobalRing === 0;
  if (newRing < actorRing && !actorIsCreator && !actorIsGlobalAdmin) {
    throw Object.assign(
      new Error('You cannot elevate someone above your own ring level.'),
      { statusCode: 403, code: 'RING_ESCALATION_BLOCKED' }
    );
  }
  if (newRing === 0 && actorRing !== 0 && !actorIsCreator && !actorIsGlobalAdmin) {
    throw Object.assign(
      new Error('Only the group creator or a global admin can assign Ring 0.'),
      { statusCode: 403, code: 'RING_0_RESERVED' }
    );
  }

  // Update permissions to match new ring level
  const permissions = getDefaultPermissions(newRing);

  return prisma.groupMember.update({
    where: { userId_groupId: { userId: targetUserId, groupId } },
    data: { ring: newRing, permissions },
  });
}

/**
 * Get a member's permissions.
 */
async function getMemberPermissions(groupId, userId) {
  const m = await getMembership(groupId, userId);
  return m.permissions || {};
}

/**
 * Set a member's permissions.
 * Cannot modify permissions of the group creator.
 * Actors cannot grant permissions they do not possess themselves.
 */
async function setMemberPermissions(groupId, actorRing, targetUserId, permissions, actorPermissions = {}, isCreatorOrAdmin = false) {
  const target = await getMembership(groupId, targetUserId);

  // Protect group creator
  const group = await prisma.cohortGroup.findUnique({ where: { id: groupId }, select: { creatorId: true } });
  if (group?.creatorId === targetUserId) {
    throw Object.assign(new Error('Cannot modify permissions of the group creator.'), { statusCode: 403, code: 'CANNOT_MODIFY_CREATOR' });
  }

  if (!canActOnUser(actorRing, target.ring)) {
    throw Object.assign(new Error('Cannot modify permissions of a user at your level or above.'), { statusCode: 403, code: 'RING_VIOLATION' });
  }

  const cleaned = cleanPermissions(permissions);
  if (!isCreatorOrAdmin && actorRing > 0) {
    for (const [key, val] of Object.entries(cleaned)) {
      if (val === true && !actorPermissions[key]) {
        throw Object.assign(
          new Error(`Cannot grant permission '${key}' that you do not possess.`),
          { statusCode: 403, code: 'PERMISSION_ESCALATION' }
        );
      }
    }
  }

  return prisma.groupMember.update({
    where: { userId_groupId: { userId: targetUserId, groupId } },
    data: { permissions: cleaned },
  });
}

// ============================================================
// GROUP INVITES
// ============================================================

/**
 * Create a group invite for a non-friend user.
 */
async function createInvite(groupId, userId, invitedBy) {
  // Check if user exists
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found.'), { statusCode: 404, code: 'USER_NOT_FOUND' });

  // Check if already a member
  const existing = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (existing) throw Object.assign(new Error('User is already a member.'), { statusCode: 409, code: 'ALREADY_MEMBER' });

  // Upsert invite
  const invite = await prisma.groupInvite.upsert({
    where: { groupId_userId: { groupId, userId } },
    update: { invitedBy, status: 'pending' },
    create: { groupId, userId, invitedBy, status: 'pending' },
  });

  return { ...invite, invited: true };
}

/**
 * Accept a group invite. Only the invited user can accept.
 * Anonymous groups: acceptance mints an identity — the real user is never
 * recorded, only the alias and a one-way hash of the client-held secret.
 */
async function acceptInvite(inviteId, userId, alias, avatarUrl) {
  const invite = await prisma.groupInvite.findUnique({ where: { id: inviteId } });
  if (!invite) throw Object.assign(new Error('Invite not found.'), { statusCode: 404, code: 'INVITE_NOT_FOUND' });
  if (invite.userId !== userId) {
    throw Object.assign(new Error('Only the invited user can accept this invite.'), { statusCode: 403, code: 'NOT_INVITED_USER' });
  }
  if (invite.status !== 'pending') {
    throw Object.assign(new Error('This invite is no longer pending.'), { statusCode: 400, code: 'NOT_PENDING' });
  }

  const groupInfo = await prisma.cohortGroup.findUnique({ where: { id: invite.groupId }, select: { isAnonymous: true, ringConfig: true } });
  if (groupInfo?.isAnonymous) {
    const anonResult = await claimAnonIdentity(invite.groupId, userId, alias, avatarUrl);
    // Only mark invite accepted once alias claim succeeded
    await prisma.groupInvite.update({
      where: { id: inviteId },
      data: { status: 'accepted' },
    });
    return anonResult;
  }

  const joinRing = groupInfo?.ringConfig?.defaultRing !== undefined ? groupInfo.ringConfig.defaultRing : 3;

  // Add user as member
  const permissions = getDefaultPermissions(joinRing);
  const member = await prisma.groupMember.create({
    data: { userId, groupId: invite.groupId, ring: joinRing, permissions },
  });

  // Update invite status
  await prisma.groupInvite.update({
    where: { id: inviteId },
    data: { status: 'accepted' },
  });

  return member;
}

/**
 * Reject a group invite.
 */
async function rejectInvite(inviteId, userId) {
  const invite = await prisma.groupInvite.findUnique({ where: { id: inviteId } });
  if (!invite) throw Object.assign(new Error('Invite not found.'), { statusCode: 404, code: 'INVITE_NOT_FOUND' });
  if (invite.userId !== userId) {
    throw Object.assign(new Error('Only the invited user can reject this invite.'), { statusCode: 403, code: 'NOT_INVITED_USER' });
  }

  await prisma.groupInvite.update({
    where: { id: inviteId },
    data: { status: 'rejected' },
  });

  return { message: 'Invite rejected.' };
}

/**
 * List pending invites for a group (admin view).
 */
async function listGroupInvites(groupId) {
  const invites = await prisma.groupInvite.findMany({
    where: { groupId, status: 'pending' },
    orderBy: { createdAt: 'desc' },
  });

  const userIds = [...new Set([...invites.map(i => i.userId), ...invites.map(i => i.invitedBy)])];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true, username: true, avatarUrl: true },
  });

  return invites.map(inv => ({
    ...inv,
    user: users.find(u => u.id === inv.userId),
    invitedByUser: users.find(u => u.id === inv.invitedBy),
  }));
}

/**
 * List pending invites for a user (their incoming invites).
 */
async function listUserInvites(userId) {
  const invites = await prisma.groupInvite.findMany({
    where: { userId, status: 'pending' },
    include: {
      group: {
        include: { _count: { select: { members: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const inviterIds = invites.map(i => i.invitedBy);
  const inviters = await prisma.user.findMany({
    where: { id: { in: inviterIds } },
    select: { id: true, displayName: true, username: true, avatarUrl: true },
  });

  return invites.map(inv => ({
    ...inv,
    invitedByUser: inviters.find(u => u.id === inv.invitedBy),
    group: {
      ...sanitizeGroup(inv.group),
      memberCount: inv.group._count.members,
    },
  }));
}

// ============================================================
// INVITE LINKS
// ============================================================

/**
 * Get or create the unique invite link token for a group.
 * Tokens rotate: a link older than INVITE_LINK_TTL_MS is silently replaced
 * with a fresh token on the next fetch, so shared links stop working.
 */
const INVITE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const crypto = require('crypto');

async function getInviteLink(groupId) {
  const group = await prisma.cohortGroup.findUnique({ where: { id: groupId } });
  if (!group) throw Object.assign(new Error('Group not found.'), { statusCode: 404 });

  // Existing link still valid
  if (group.inviteToken && group.inviteTokenExpiry && group.inviteTokenExpiry.getTime() > Date.now()) {
    return { token: group.inviteToken, expiresAt: group.inviteTokenExpiry };
  }

  // No token, or the old one expired → rotate with a fresh secret & TTL.
  // Note: we do NOT delete old tokens; a stale token simply stops resolving
  // because joinViaLink checks expiry. This keeps previously copied links
  // from being silently hijacked after rotation.
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_LINK_TTL_MS);
  await prisma.cohortGroup.update({
    where: { id: groupId },
    data: { inviteToken: token, inviteTokenExpiry: expiresAt },
  });

  return { token, expiresAt };
}

/**
 * Join a group using an invite token.
 */
async function joinViaLink(token, userId, alias, avatarUrl) {
  const group = await prisma.cohortGroup.findFirst({ where: { inviteToken: token } });
  if (!group) throw Object.assign(new Error('Invalid or expired invite link.'), { statusCode: 404, code: 'INVALID_LINK' });

  if (!group.inviteTokenExpiry || group.inviteTokenExpiry.getTime() < Date.now()) {
    // Rotate the stale token out immediately.
    await prisma.cohortGroup.update({ where: { id: group.id }, data: { inviteToken: null, inviteTokenExpiry: null } });
    throw Object.assign(new Error('This invite link has expired. Ask for a fresh link.'), { statusCode: 410, code: 'LINK_EXPIRED' });
  }

  if (group.isAnonymous) {
    // Claims an alias-based identity; joining twice creates a second identity
    // (inherent to zero-knowledge — a banned alias just rejoins with a new one).
    return claimAnonIdentity(group.id, userId, alias, avatarUrl);
  }

  // Add the user bypassing friend check
  // get default joining ring
  const defaultRingSetting = group.ringConfig?.defaultRing !== undefined ? group.ringConfig.defaultRing : 3;
  
  const existing = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: group.id } },
  });
  if (existing) throw Object.assign(new Error('User is already a member.'), { statusCode: 409, code: 'ALREADY_MEMBER' });

  const permissions = getDefaultPermissions(defaultRingSetting);

  const member = await prisma.groupMember.create({
    data: { userId, groupId: group.id, ring: defaultRingSetting, permissions },
  });

  // Also transition any pending db invite for this user to 'accepted', if it exists
  await prisma.groupInvite.updateMany({
    where: { groupId: group.id, userId, status: 'pending' },
    data: { status: 'accepted' }
  });

  return { member, group: sanitizeGroup(group) };
}


// ============================================================
// RING CONFIGURATION
// ============================================================

/**
 * Update ring configuration for a group.
 * Validates ringCount (2-10) and ringLabels format.
 */
async function updateRingConfig(groupId, config) {
  const { ringCount = 5, ringLabels = {}, ringPermissions = {}, defaultRing } = config;
  const clampedCount = Math.max(2, Math.min(10, parseInt(ringCount) || 5));
  
  // defaultRing 0 is reserved for the creator — a group-admin-controlled
  // 0 would let them mint full group admins. Lowest valid tier is 1.
  let safeDefaultRing = parseInt(defaultRing);
  if (isNaN(safeDefaultRing) || safeDefaultRing < 1 || safeDefaultRing >= clampedCount) {
    safeDefaultRing = clampedCount - 1; // Default to lowest ring tier if invalid
  }

  // Clean labels & permissions: only keep entries within range
  const cleanLabels = {};
  const cleanRingPermissions = {};
  for (let i = 0; i < clampedCount; i++) {
    cleanLabels[i] = ringLabels[i] || getDefaultRingLabel(i);
    // Sanitize permissions object for this ring to only hold booleans for valid keys
    cleanRingPermissions[i] = cleanPermissions(ringPermissions[i]);
  }

  const ringConfig = { 
    ringCount: clampedCount, 
    ringLabels: cleanLabels, 
    ringPermissions: cleanRingPermissions,
    defaultRing: safeDefaultRing 
  };
  return prisma.cohortGroup.update({
    where: { id: groupId },
    data: { ringConfig },
  });
}

function getDefaultRingLabel(ring) {
  const defaults = ['Admin', 'Manager', 'Elevated', 'Member', 'Restricted'];
  return defaults[ring] || `Ring ${ring}`;
}

// ============================================================
// MUTE / UNMUTE
// ============================================================

/**
 * Mute a member in a group for a given duration.
 */
async function muteMember(groupId, targetUserId, mutedByUserId, durationMinutes = 60) {
  const mutedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);

  return prisma.muteRecord.upsert({
    where: { userId_groupId: { userId: targetUserId, groupId } },
    update: { mutedUntil, mutedBy: mutedByUserId },
    create: { userId: targetUserId, groupId, mutedBy: mutedByUserId, mutedUntil },
  });
}

/**
 * Unmute a member by deleting the mute record.
 */
async function unmuteMember(groupId, targetUserId) {
  await prisma.muteRecord.deleteMany({
    where: { userId: targetUserId, groupId },
  });
}

/**
 * Check if a user is currently muted in a group.
 */
async function isMuted(groupId, userId) {
  const mute = await prisma.muteRecord.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (!mute) return false;
  if (mute.mutedUntil < new Date()) {
    // Mute expired — clean up
    await prisma.muteRecord.delete({ where: { id: mute.id } });
    return false;
  }
  return { muted: true, mutedUntil: mute.mutedUntil };
}

// ============================================================
// ANONYMOUS GROUP IDENTITIES  (zero-knowledge by design)
// ============================================================

function sanitizeAlias(alias) {
  if (typeof alias !== 'string') return null;
  const clean = alias.trim().slice(0, ALIAS_MAX_LEN);
  return clean;
}

/**
 * Mint an anonymous identity for a group. `userId` is used only for the
 * caller checks done BEFORE this runs (link token / invite ownership /
 * creator claim); it is never persisted here or on any message.
 * Returns the identity + the one-time secret — the controller hands the
 * secret to the client and nothing reversible survives in the DB.
 */
async function claimAnonIdentity(groupId, userId, alias, avatarUrl) {
  const cleanAlias = sanitizeAlias(alias);
  if (!cleanAlias) {
    throw Object.assign(new Error('A display alias is required for anonymous groups.'), { statusCode: 400, code: 'ALIAS_REQUIRED' });
  }

  const group = await prisma.cohortGroup.findUnique({ where: { id: groupId } });
  if (!group) throw Object.assign(new Error('Group not found.'), { statusCode: 404, code: 'GROUP_NOT_FOUND' });

  if (!group.isAnonymous) {
    throw Object.assign(new Error('This group is not anonymous.'), { statusCode: 400, code: 'NOT_ANONYMOUS' });
  }

  // Word-ban check for alias
  const bannedWord = containsBannedWord(cleanAlias, group.wordBanList);
  if (bannedWord) {
    throw Object.assign(new Error(`Alias contains a banned word ("${bannedWord}").`), { statusCode: 400, code: 'BANNED_WORD' });
  }

  // Alias must be unique in the group case-insensitively (impersonation guard).
  const aliasKey = cleanAlias.toLowerCase();
  const clash = await prisma.anonymousIdentity.findFirst({
    where: { groupId, aliasKey, ...NOT_BANNED },
    select: { id: true },
  });
  if (clash) {
    throw Object.assign(new Error('That alias is already taken in this group. Try another.'), { statusCode: 409, code: 'ALIAS_TAKEN' });
  }

  // Free a tag: regenerate until it doesn't collide (trivial chance).
  let aliasTag;
  let tagClash = true;
  while (tagClash) {
    aliasTag = issueAliasTag();
    const dup = await prisma.anonymousIdentity.findFirst({ where: { groupId, aliasTag }, select: { id: true } });
    tagClash = !!dup;
  }

  const secret = issueSecret();
  const identity = await prisma.anonymousIdentity.create({
    data: {
      groupId, alias: cleanAlias, aliasKey, aliasTag,
      avatarUrl: sanitizeUrl(avatarUrl),
      secretHash: hashSecret(secret),
    },
  });

  // Boolean "has joined" flag (user-level, no identity link). This is what
  // lets the app prompt for a saved key later instead of forcing a new alias.
  if (userId) {
    await prisma.anonGroupJoin.upsert({
      where: { groupId_userId: { groupId, userId } },
      update: {},
      create: { groupId, userId },
    });
  }

  return {
    groupId: identity.groupId,
    identityId: identity.id,
    secret,               // given to the client exactly once — never stored
    alias: cleanAlias,
    aliasTag,
    avatarUrl: identity.avatarUrl,
    _anonWarning: 'This secret is the only thing proving your identity in this group. It is not stored on the server.',
  };
}

/**
 * Resolve + authorize an anonymous identity from a client-presented
 * `identityId.secret` pair. Returns the identity or null (never throws
 * identity-existence info to APIs that shouldn't have it).
 */
async function resolveAnonIdentity(identityId, secret) {
  if (!identityId || !secret) return null;
  // Reject malformed ObjectIds before Prisma can (clean 400, not a 500).
  if (!/^[a-f0-9]{24}$/i.test(identityId)) return null;
  const identity = await prisma.anonymousIdentity.findUnique({ where: { id: identityId } }).catch(() => null);
  if (!identity) return null;
  if (!verifySecret(secret, identity.secretHash)) return null;
  return identity;
}

/**
 * Restore an anonymous identity from a saved key (`identityId.secret`).
 * Enrollment rule: the user must hold the boolean AnonGroupJoin for the group
 * (or be the creator) — the key proves WHO the identity is, the join flag
 * proves the user belongs. Returns the identity + the secret (the key itself),
 * mirroring claimAnonIdentity's shape so the client can store it verbatim.
 */
async function restoreAnonIdentity(groupId, key, userId) {
  if (!key || typeof key !== 'string') {
    throw Object.assign(new Error('Your saved key is required.'), { statusCode: 400, code: 'KEY_REQUIRED' });
  }
  const dot = key.indexOf('.');
  if (dot <= 0 || dot === key.length - 1) {
    throw Object.assign(new Error('That key does not look right. It should be in the format identityId.secret.'), { statusCode: 400, code: 'KEY_MALFORMED' });
  }
  const identityId = key.slice(0, dot);
  const secret = key.slice(dot + 1);

  const identity = await resolveAnonIdentity(identityId, secret);
  if (!identity) {
    throw Object.assign(new Error('That key is invalid or has been rotated. If you renamed your alias, the old key no longer works.'), { statusCode: 401, code: 'INVALID_KEY' });
  }
  if (identity.groupId !== groupId) {
    throw Object.assign(new Error('That key belongs to a different group.'), { statusCode: 400, code: 'WRONG_GROUP' });
  }
  if (identity.bannedAt) {
    throw Object.assign(new Error('This identity is banned in the group.'), { statusCode: 403, code: 'IDENTITY_BANNED' });
  }

  // The user must genuinely have joined this group (boolean flag). The creator
  // is implicitly enrolled via their own flag when they claimed their alias.
  const group = await prisma.cohortGroup.findUnique({ where: { id: groupId }, select: { id: true, isAnonymous: true, creatorId: true } });
  if (!group) throw Object.assign(new Error('Group not found.'), { statusCode: 404, code: 'GROUP_NOT_FOUND' });
  if (!group.isAnonymous) {
    throw Object.assign(new Error('This group is not anonymous.'), { statusCode: 400, code: 'NOT_ANONYMOUS' });
  }
  if (userId) {
    const joined = await prisma.anonGroupJoin.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { id: true },
    }).catch(() => null);
    if (!joined && group.creatorId !== userId) {
      throw Object.assign(new Error('You are not enrolled in this group.'), { statusCode: 403, code: 'NOT_JOINED' });
    }
    // Keep the flag fresh so the group still surfaces in the user's list.
    await prisma.anonGroupJoin.upsert({
      where: { groupId_userId: { groupId, userId } },
      update: {},
      create: { groupId, userId },
    });
  }

  return {
    groupId: identity.groupId,
    identityId: identity.id,
    secret,             // the preserved key — unchanged by restore
    alias: identity.alias,
    aliasTag: identity.aliasTag,
    avatarUrl: identity.avatarUrl,
  };
}

/** Does this user hold a join flag (or own) the given (anon) group? */
async function hasAnonJoin(groupId, userId) {
  if (!userId) return false;
  const group = await prisma.cohortGroup.findUnique({
    where: { id: groupId },
    select: { creatorId: true, isAnonymous: true },
  });
  if (!group || !group.isAnonymous) return false;
  if (group.creatorId === userId) return true;
  const join = await prisma.anonGroupJoin.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { id: true },
  }).catch(() => null);
  return !!join;
}

/** Word-ban filtering — case-insensitive word-boundary match on each word. */
function containsBannedWord(content, wordBanList) {
  if (!wordBanList?.length || !content) return null;
  for (const w of wordBanList) {
    if (!w || !w.trim()) continue;
    const escaped = w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, 'i');
    if (regex.test(content)) return w.trim();
  }
  return null;
}

/** Rename an identity / rotate its secret. Returns {secret} — new secret. */
async function renameAnonIdentity(identityId, secret, newAlias, avatarUrl) {
  const identity = await resolveAnonIdentity(identityId, secret);
  if (!identity) throw Object.assign(new Error('Invalid identity secret.'), { statusCode: 401, code: 'INVALID_IDENTITY' });
  if (identity.bannedAt) throw Object.assign(new Error('This identity is banned.'), { statusCode: 403, code: 'IDENTITY_BANNED' });

  const cleanAlias = sanitizeAlias(newAlias);
  if (!cleanAlias) throw Object.assign(new Error('An alias is required.'), { statusCode: 400, code: 'ALIAS_REQUIRED' });

  const group = await prisma.cohortGroup.findUnique({ where: { id: identity.groupId }, select: { wordBanList: true } });
  const bannedWord = containsBannedWord(cleanAlias, group?.wordBanList);
  if (bannedWord) {
    throw Object.assign(new Error(`Alias contains a banned word ("${bannedWord}").`), { statusCode: 400, code: 'BANNED_WORD' });
  }

  const aliasKey = cleanAlias.toLowerCase();
  if (aliasKey !== identity.aliasKey) {
    const clash = await prisma.anonymousIdentity.findFirst({
      where: { groupId: identity.groupId, aliasKey, id: { not: identityId }, ...NOT_BANNED },
      select: { id: true },
    });
    if (clash) throw Object.assign(new Error('That alias is already taken in this group.'), { statusCode: 409, code: 'ALIAS_TAKEN' });
  }

  // Rotate the secret so a previously-shared link/device dies; the old alias
  // name is dropped forever (rename = fresh start, no tracking across names).
  const newSecret = issueSecret();
  const cleanAvatar = sanitizeUrl(avatarUrl); // undefined = keep current
  await prisma.anonymousIdentity.update({
    where: { id: identityId },
    data: {
      alias: cleanAlias,
      aliasKey,
      avatarUrl: cleanAvatar === undefined ? identity.avatarUrl : cleanAvatar,
      secretHash: hashSecret(newSecret),
    },
  });

  return { groupId: identity.groupId, identityId: identity.id, secret: newSecret, alias: cleanAlias, aliasTag: identity.aliasTag, avatarUrl: cleanAvatar === undefined ? identity.avatarUrl : cleanAvatar };
}

module.exports = {
  listUserGroups, getGroup, createGroup, updateGroup, deleteGroup,
  listMembers, getMembership, addMember, removeMember,
  getMemberRing, setMemberRing, getMemberPermissions, setMemberPermissions,
  muteMember, unmuteMember, isMuted, getUnreadCount, markGroupRead,
  createInvite, acceptInvite, rejectInvite, listGroupInvites, listUserInvites,
  getInviteLink, joinViaLink,
  areFriends, getDefaultPermissions, updateRingConfig,
  claimAnonIdentity, resolveAnonIdentity, renameAnonIdentity, containsBannedWord,
  restoreAnonIdentity, hasAnonJoin,
};

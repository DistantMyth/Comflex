/**
 * Group Service
 *
 * Business logic for group CRUD, membership management,
 * ring/permission changes, mute/unmute, and group invites.
 */

const prisma = require('../prisma');
const { canActOnUser } = require('../middleware/ringCheck');

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
 */
async function listUserGroups(userId) {
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

  return memberships.map((m) => ({
    ...m.group,
    memberCount: m.group._count.members,
    userRing: m.ring,
    userPermissions: m.permissions,
    unreadCount: unreadCounts[m.groupId] || 0,
  }));
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
 * A message is "unread" if the user has no read receipt for it,
 * it was sent after the user joined, and the user is not the author.
 */
async function getUnreadCount(groupId, userId) {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (!membership) return 0;

  // Count messages the user hasn't read (not authored by them, not deleted)
  const totalMessages = await prisma.message.count({
    where: {
      groupId,
      authorId: { not: userId },
      isDeleted: false,
      createdAt: { gte: membership.joinedAt },
    },
  });

  const readMessages = await prisma.messageReadReceipt.count({
    where: {
      userId,
      message: {
        groupId,
        authorId: { not: userId },
        isDeleted: false,
        createdAt: { gte: membership.joinedAt },
      },
    },
  });

  return Math.max(0, totalMessages - readMessages);
}

/**
 * Get a single group with member count.
 */
async function getGroup(groupId) {
  const group = await prisma.cohortGroup.findUnique({
    where: { id: groupId },
    include: { _count: { select: { members: true } } },
  });
  if (!group) throw Object.assign(new Error('Group not found.'), { statusCode: 404, code: 'GROUP_NOT_FOUND' });
  return { ...group, memberCount: group._count.members };
}

/**
 * Create a new group. Any authenticated user can create.
 * Creator is automatically added as Ring 0 admin.
 */
async function createGroup({ name, displayName, description, type = 'custom', creatorId, avatarUrl }) {
  const existing = await prisma.cohortGroup.findUnique({ where: { name } });
  if (existing) throw Object.assign(new Error('A group with this name already exists.'), { statusCode: 409, code: 'DUPLICATE_GROUP' });

  const group = await prisma.cohortGroup.create({
    data: { name, displayName, description, type, creatorId, avatarUrl },
  });

  // Auto-add creator as Ring 0 admin with full permissions
  if (creatorId) {
    await prisma.groupMember.create({
      data: {
        userId: creatorId,
        groupId: group.id,
        ring: 0,
        permissions: ADMIN_PERMISSIONS,
      },
    });
  }

  return group;
}

/**
 * Update group info.
 */
async function updateGroup(groupId, updates) {
  const allowed = {};
  if (updates.displayName !== undefined) allowed.displayName = updates.displayName;
  if (updates.description !== undefined) allowed.description = updates.description;
  if (updates.avatarUrl !== undefined) allowed.avatarUrl = updates.avatarUrl;
  if (updates.ringConfig !== undefined) allowed.ringConfig = updates.ringConfig;

  return prisma.cohortGroup.update({ where: { id: groupId }, data: allowed });
}

/**
 * Delete a group and all associated data.
 */
async function deleteGroup(groupId) {
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

  // Check friendship (skip for system/admin additions where addedByUserId is null, or if bypass requested)
  if (!bypassFriendCheck && addedByUserId && addedByUserId !== userId) {
    const friends = await areFriends(addedByUserId, userId);
    if (!friends) {
      // Create an invite instead of adding directly
      return createInvite(groupId, userId, addedByUserId);
    }
  }

  // Get default joining ring
  const groupInfo = await prisma.cohortGroup.findUnique({ where: { id: groupId }, select: { ringConfig: true } });
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

  // HARDENING: never let an actor set anyone's ring to a level equal to or
  // above their own — otherwise any moderator could promote a puppet to
  // ring 0 (full group admin). Only the group creator or a global admin
  // (ring 0) may assign ring 0.
  const actorIsCreator = group?.creatorId === actorUserId;
  const actorIsGlobalAdmin = actorGlobalRing === 0;
  if (newRing <= actorRing && !actorIsCreator && !actorIsGlobalAdmin) {
    throw Object.assign(
      new Error('You cannot assign a ring at or above your own level.'),
      { statusCode: 403, code: 'RING_ESCALATION_BLOCKED' }
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
 */
async function setMemberPermissions(groupId, actorRing, targetUserId, permissions) {
  const target = await getMembership(groupId, targetUserId);

  // Protect group creator
  const group = await prisma.cohortGroup.findUnique({ where: { id: groupId }, select: { creatorId: true } });
  if (group?.creatorId === targetUserId) {
    throw Object.assign(new Error('Cannot modify permissions of the group creator.'), { statusCode: 403, code: 'CANNOT_MODIFY_CREATOR' });
  }

  if (!canActOnUser(actorRing, target.ring)) {
    throw Object.assign(new Error('Cannot modify permissions of a user at your level or above.'), { statusCode: 403, code: 'RING_VIOLATION' });
  }

  return prisma.groupMember.update({
    where: { userId_groupId: { userId: targetUserId, groupId } },
    data: { permissions },
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
 */
async function acceptInvite(inviteId, userId) {
  const invite = await prisma.groupInvite.findUnique({ where: { id: inviteId } });
  if (!invite) throw Object.assign(new Error('Invite not found.'), { statusCode: 404, code: 'INVITE_NOT_FOUND' });
  if (invite.userId !== userId) {
    throw Object.assign(new Error('Only the invited user can accept this invite.'), { statusCode: 403, code: 'NOT_INVITED_USER' });
  }
  if (invite.status !== 'pending') {
    throw Object.assign(new Error('This invite is no longer pending.'), { statusCode: 400, code: 'NOT_PENDING' });
  }

  // Update invite status
  await prisma.groupInvite.update({
    where: { id: inviteId },
    data: { status: 'accepted' },
  });

  const groupInfo = await prisma.cohortGroup.findUnique({ where: { id: invite.groupId }, select: { ringConfig: true } });
  const joinRing = groupInfo?.ringConfig?.defaultRing !== undefined ? groupInfo.ringConfig.defaultRing : 3;

  // Add user as member
  const permissions = getDefaultPermissions(joinRing);
  const member = await prisma.groupMember.create({
    data: { userId, groupId: invite.groupId, ring: joinRing, permissions },
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
      ...inv.group,
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
async function joinViaLink(token, userId) {
  const group = await prisma.cohortGroup.findFirst({ where: { inviteToken: token } });
  if (!group) throw Object.assign(new Error('Invalid or expired invite link.'), { statusCode: 404, code: 'INVALID_LINK' });

  if (!group.inviteTokenExpiry || group.inviteTokenExpiry.getTime() < Date.now()) {
    // Rotate the stale token out immediately.
    await prisma.cohortGroup.update({ where: { id: group.id }, data: { inviteToken: null, inviteTokenExpiry: null } });
    throw Object.assign(new Error('This invite link has expired. Ask for a fresh link.'), { statusCode: 410, code: 'LINK_EXPIRED' });
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

  return { member, group };
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
  
  let safeDefaultRing = parseInt(defaultRing);
  if (isNaN(safeDefaultRing) || safeDefaultRing < 0 || safeDefaultRing >= clampedCount) {
    safeDefaultRing = clampedCount - 1; // Default to lowest ring tier if invalid
  }

  // Clean labels & permissions: only keep entries within range
  const cleanLabels = {};
  const cleanPermissions = {};
  for (let i = 0; i < clampedCount; i++) {
    cleanLabels[i] = ringLabels[i] || getDefaultRingLabel(i);
    // Sanitize permissions object for this ring to only hold booleans for valid keys
    const rawPerms = ringPermissions[i] || {};
    const sanitized = {};
    for (const key of Object.keys(rawPerms)) {
      sanitized[key] = !!rawPerms[key];
    }
    cleanPermissions[i] = sanitized;
  }

  const ringConfig = { 
    ringCount: clampedCount, 
    ringLabels: cleanLabels, 
    ringPermissions: cleanPermissions,
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

module.exports = {
  listUserGroups, getGroup, createGroup, updateGroup, deleteGroup,
  listMembers, getMembership, addMember, removeMember,
  getMemberRing, setMemberRing, getMemberPermissions, setMemberPermissions,
  muteMember, unmuteMember, isMuted, getUnreadCount,
  createInvite, acceptInvite, rejectInvite, listGroupInvites, listUserInvites,
  getInviteLink, joinViaLink,
  areFriends, getDefaultPermissions, updateRingConfig,
};

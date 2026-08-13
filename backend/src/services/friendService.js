/**
 * Friend Service
 *
 * Business logic for friend requests and friendships.
 * Friendships are bidirectional — once accepted, both users are friends.
 */

const prisma = require('../prisma');
const notificationService = require('./notificationService');

/**
 * Send a friend request.
 * Prevents: duplicate requests, self-friendship, reverse-duplicate.
 */
async function sendRequest(requesterId, addresseeId) {
  if (requesterId === addresseeId) {
    throw Object.assign(new Error('Cannot send a friend request to yourself.'), { statusCode: 400, code: 'SELF_REQUEST' });
  }

  // Check if any friendship already exists (either direction)
  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId, addresseeId },
        { requesterId: addresseeId, addresseeId: requesterId },
      ],
    },
  });

  if (existing) {
    if (existing.status === 'accepted') {
      throw Object.assign(new Error('You are already friends.'), { statusCode: 409, code: 'ALREADY_FRIENDS' });
    }
    if (existing.status === 'pending') {
      // If the other person sent us a request, auto-accept
      if (existing.requesterId === addresseeId) {
        return acceptRequest(existing.id, requesterId);
      }
      throw Object.assign(new Error('Friend request already sent.'), { statusCode: 409, code: 'REQUEST_EXISTS' });
    }
    if (existing.status === 'blocked') {
      throw Object.assign(new Error('Unable to send friend request.'), { statusCode: 403, code: 'BLOCKED' });
    }
  }

  // Verify the target user exists
  const targetUser = await prisma.user.findUnique({ where: { id: addresseeId } });
  if (!targetUser) {
    throw Object.assign(new Error('User not found.'), { statusCode: 404, code: 'USER_NOT_FOUND' });
  }

  let friendship;
  try {
    friendship = await prisma.friendship.create({
      data: { requesterId, addresseeId, status: 'pending' },
    });
  } catch (err) {
    // Unique (requesterId, addresseeId) index — concurrent duplicate request
    if (err && err.code === 'P2002') {
      throw Object.assign(new Error('Friend request already sent.'), { statusCode: 409, code: 'REQUEST_EXISTS' });
    }
    throw err;
  }

  // Notify the recipient of the incoming request
  try {
    const requester = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { id: true, displayName: true, avatarUrl: true },
    });
    await notificationService.createNotification(addresseeId, {
      type: 'friend_request',
      title: 'New friend request',
      body: `${requester.displayName} sent you a friend request`,
      actorId: requesterId,
      data: { friendshipId: friendship.id, actorAvatarUrl: requester.avatarUrl, link: '/friends' },
    });
  } catch (err) {
    console.error('[Friend] Notification failed:', err.message);
  }

  return friendship;
}

/**
 * Accept a friend request. Only the addressee can accept.
 */
async function acceptRequest(friendshipId, userId) {
  const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });
  if (!friendship) {
    throw Object.assign(new Error('Friend request not found.'), { statusCode: 404, code: 'NOT_FOUND' });
  }
  if (friendship.addresseeId !== userId) {
    throw Object.assign(new Error('Only the recipient can accept this request.'), { statusCode: 403, code: 'NOT_ADDRESSEE' });
  }
  if (friendship.status !== 'pending') {
    throw Object.assign(new Error('This request is no longer pending.'), { statusCode: 400, code: 'NOT_PENDING' });
  }

  const updated = await prisma.friendship.update({
    where: { id: friendshipId },
    data: { status: 'accepted' },
  });

  // Notify the original requester that their request was accepted
  try {
    const acceptor = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, avatarUrl: true },
    });
    await notificationService.createNotification(friendship.requesterId, {
      type: 'friend_accept',
      title: 'Friend request accepted',
      body: `${acceptor.displayName} accepted your friend request`,
      actorId: userId,
      data: { friendshipId: friendship.id, actorAvatarUrl: acceptor.avatarUrl, link: '/friends' },
    });
  } catch (err) {
    console.error('[Friend] Notification failed:', err.message);
  }

  return updated;
}

/**
 * Reject a friend request. Only the addressee can reject.
 */
async function rejectRequest(friendshipId, userId) {
  const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });
  if (!friendship) {
    throw Object.assign(new Error('Friend request not found.'), { statusCode: 404, code: 'NOT_FOUND' });
  }
  if (friendship.addresseeId !== userId) {
    throw Object.assign(new Error('Only the recipient can reject this request.'), { statusCode: 403, code: 'NOT_ADDRESSEE' });
  }
  if (friendship.status !== 'pending') {
    throw Object.assign(new Error('This request is no longer pending.'), { statusCode: 400, code: 'NOT_PENDING' });
  }

  // Delete the request entirely so they can re-send later
  await prisma.friendship.delete({ where: { id: friendshipId } });
  return { message: 'Friend request rejected.' };
}

/**
 * Remove a friend (unfriend). Either party can do this.
 */
async function removeFriend(friendshipId, userId) {
  const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });
  if (!friendship) {
    throw Object.assign(new Error('Friendship not found.'), { statusCode: 404, code: 'NOT_FOUND' });
  }
  if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
    throw Object.assign(new Error('Not your friendship.'), { statusCode: 403, code: 'NOT_PARTY' });
  }

  await prisma.friendship.delete({ where: { id: friendshipId } });
  return { message: 'Friend removed.' };
}

/**
 * List accepted friends for a user.
 * Returns enriched user data for each friend.
 */
async function listFriends(userId) {
  const friendships = await prisma.friendship.findMany({
    where: {
      status: 'accepted',
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
  });

  // Get the "other" user's info for each friendship
  const friendIds = friendships.map(f => f.requesterId === userId ? f.addresseeId : f.requesterId);
  const users = await prisma.user.findMany({
    where: { id: { in: friendIds } },
    select: { id: true, displayName: true, username: true, avatarUrl: true, bio: true, globalRing: true, cohortTags: true, displayBadges: true },
  });

  // Merge friendship ID with user data
  return friendships.map(f => {
    const friendId = f.requesterId === userId ? f.addresseeId : f.requesterId;
    const user = users.find(u => u.id === friendId);
    return { friendshipId: f.id, ...user };
  });
}

/**
 * List incoming pending friend requests for a user.
 */
async function listPendingRequests(userId) {
  const requests = await prisma.friendship.findMany({
    where: { addresseeId: userId, status: 'pending' },
  });

  const requesterIds = requests.map(r => r.requesterId);
  const users = await prisma.user.findMany({
    where: { id: { in: requesterIds } },
    select: { id: true, displayName: true, username: true, avatarUrl: true, bio: true },
  });

  return requests.map(r => ({
    friendshipId: r.id,
    createdAt: r.createdAt,
    ...users.find(u => u.id === r.requesterId),
  }));
}

/**
 * List outgoing pending friend requests for a user.
 */
async function listSentRequests(userId) {
  const requests = await prisma.friendship.findMany({
    where: { requesterId: userId, status: 'pending' },
  });

  const addresseeIds = requests.map(r => r.addresseeId);
  const users = await prisma.user.findMany({
    where: { id: { in: addresseeIds } },
    select: { id: true, displayName: true, username: true, avatarUrl: true, bio: true },
  });

  return requests.map(r => ({
    friendshipId: r.id,
    createdAt: r.createdAt,
    ...users.find(u => u.id === r.addresseeId),
  }));
}

module.exports = { sendRequest, acceptRequest, rejectRequest, removeFriend, listFriends, listPendingRequests, listSentRequests };

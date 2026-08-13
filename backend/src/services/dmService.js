/**
 * DM (Direct Message) Service
 *
 * Business logic for 1-on-1 personal messaging between friends.
 * DMs require an accepted friendship between the two users.
 */

const prisma = require('../prisma');
const notificationService = require('./notificationService');

// Serialize the "check-then-create" burst-dedupe per (receiver, sender) pair so
// concurrent DMs can't both pass the unread-check and create duplicate bells.
const dmNotifLocks = new Map();
function withDmNotifLock(receiverId, senderId, fn) {
  const key = `${receiverId}:${senderId}`;
  const prev = dmNotifLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  // Store a never-rejecting wrapper so failures don't poison the chain
  const wrapped = next.catch(() => {});
  dmNotifLocks.set(key, wrapped);
  wrapped.finally(() => {
    if (dmNotifLocks.get(key) === wrapped) dmNotifLocks.delete(key);
  });
  return next; // caller still sees the original outcome
}

/**
 * Check that two users are friends (accepted friendship exists).
 * Throws if not friends.
 */
async function requireFriendship(userId, otherUserId) {
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: 'accepted',
      OR: [
        { requesterId: userId, addresseeId: otherUserId },
        { requesterId: otherUserId, addresseeId: userId },
      ],
    },
  });

  if (!friendship) {
    throw Object.assign(
      new Error('You can only message friends. Send a friend request first.'),
      { statusCode: 403, code: 'NOT_FRIENDS' }
    );
  }

  return friendship;
}

/**
 * Send a direct message to a user.
 * Requires an accepted friendship between the two users — EXCEPT for
 * server-internal system messages (e.g. group invite links), which must
 * explicitly pass bypassFriendship = true. No API route may set it.
 */
async function sendDM(senderId, receiverId, data, bypassFriendship = false) {
  if (senderId === receiverId) {
    throw Object.assign(new Error('Cannot message yourself.'), { statusCode: 400, code: 'SELF_MESSAGE' });
  }

  // Verify receiver exists
  const receiver = await prisma.user.findUnique({ where: { id: receiverId } });
  if (!receiver) {
    throw Object.assign(new Error('User not found.'), { statusCode: 404, code: 'USER_NOT_FOUND' });
  }

  // Friendship is required — prevents DMs (and spam) to arbitrary users.
  if (!bypassFriendship) {
    await requireFriendship(senderId, receiverId);
  }

  const message = await prisma.directMessage.create({
    data: {
      senderId,
      receiverId,
      content: data.content || '',
      replyToId: data.replyToId || null,
      forwarded: data.forwarded || false,
      msgType: data.msgType || 'text',
      fileUrl: data.fileUrl || null,
      fileName: data.fileName || null,
      fileSize: data.fileSize || null,
    },
  });

  // Notify the receiver — one bell item per unread burst (skip if an
  // unread DM notification from this sender already exists). Serialized
  // per pair to avoid duplicate creations under concurrent sends.
  try {
    await withDmNotifLock(receiverId, senderId, async () => {
      const existingUnread = await prisma.notification.findFirst({
        where: { userId: receiverId, type: 'dm', isRead: false, actorId: senderId },
        select: { id: true },
      });
      if (existingUnread) return;

      const sender = await prisma.user.findUnique({
        where: { id: senderId },
        select: { id: true, displayName: true, avatarUrl: true },
      });
      const preview = (message.content || '').slice(0, 120);
      await notificationService.createNotification(receiverId, {
        type: 'dm',
        title: `New message from ${sender.displayName}`,
        body: preview || (message.fileUrl ? 'Sent an attachment' : 'Sent a message'),
        actorId: senderId,
        data: { messageId: message.id, actorAvatarUrl: sender.avatarUrl, link: `/messages/${senderId}` },
      });
    });
  } catch (err) {
    console.error('[DM] Notification failed:', err.message);
  }

  return message;
}

/**
 * Get paginated conversation between two users.
 * Requires an accepted friendship — blocks reading another user's DMs.
 */
async function getConversation(userId, otherUserId, { page = 1, limit = 50 } = {}) {
  await requireFriendship(userId, otherUserId);

  const skip = (page - 1) * limit;

  const messages = await prisma.directMessage.findMany({
    where: {
      OR: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId },
      ],
      isDeleted: false,
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  // Fetch senders to attach author object
  const senderIds = [...new Set(messages.map(m => m.senderId))];
  const senders = await prisma.user.findMany({
    where: { id: { in: senderIds } },
    select: { id: true, displayName: true, username: true, avatarUrl: true, globalRing: true, displayBadges: true },
  });

  const messagesWithAuthor = messages.map(msg => {
    const author = senders.find(s => s.id === msg.senderId);
    return { ...msg, author };
  });

  const total = await prisma.directMessage.count({
    where: {
      OR: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId },
      ],
      isDeleted: false,
    },
  });

  return {
    messages: messagesWithAuthor.reverse(), // Return in chronological order
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * List all DM conversations for a user — returns the other user's info
 * plus the last message and unread count.
 */
async function listConversations(userId) {
  // Get all DMs involving this user
  const allDMs = await prisma.directMessage.findMany({
    where: {
      OR: [{ senderId: userId }, { receiverId: userId }],
      isDeleted: false,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Group by conversation partner
  const conversationMap = new Map();
  for (const dm of allDMs) {
    const partnerId = dm.senderId === userId ? dm.receiverId : dm.senderId;
    if (!conversationMap.has(partnerId)) {
      conversationMap.set(partnerId, {
        lastMessage: dm,
        unreadCount: 0,
      });
    }
    // Count unread messages sent TO this user
    if (dm.receiverId === userId && !dm.isRead) {
      const entry = conversationMap.get(partnerId);
      entry.unreadCount++;
    }
  }

  // Fetch partner user data
  const partnerIds = Array.from(conversationMap.keys());
  const partners = await prisma.user.findMany({
    where: { id: { in: partnerIds } },
    select: { id: true, displayName: true, username: true, avatarUrl: true },
  });

  // Check which partners are currently friends
  const friendships = await prisma.friendship.findMany({
    where: {
      status: 'accepted',
      OR: [
        { requesterId: userId, addresseeId: { in: partnerIds } },
        { requesterId: { in: partnerIds }, addresseeId: userId },
      ],
    },
  });

  const friendIds = new Set();
  for (const f of friendships) {
    if (f.requesterId === userId) friendIds.add(f.addresseeId);
    else friendIds.add(f.requesterId);
  }

  // Build response
  return partnerIds.map(partnerId => {
    const { lastMessage, unreadCount } = conversationMap.get(partnerId);
    const partner = partners.find(p => p.id === partnerId);
    return {
      partner: {
        ...partner,
        isFriend: friendIds.has(partnerId)
      },
      lastMessage: {
        content: lastMessage.content,
        createdAt: lastMessage.createdAt,
        isMine: lastMessage.senderId === userId,
      },
      unreadCount,
    };
  });
}

/**
 * Mark all messages from a specific user as read.
 */
async function markAsRead(userId, otherUserId) {
  await prisma.directMessage.updateMany({
    where: {
      senderId: otherUserId,
      receiverId: userId,
      isRead: false,
    },
    data: { isRead: true, readAt: new Date() },
  });

  return { message: 'Messages marked as read.' };
}

/**
 * Soft-delete a DM (only the sender can delete their own message).
 */
async function deleteDM(messageId, userId) {
  const message = await prisma.directMessage.findUnique({ where: { id: messageId } });
  if (!message) {
    throw Object.assign(new Error('Message not found.'), { statusCode: 404, code: 'NOT_FOUND' });
  }
  if (message.senderId !== userId) {
    throw Object.assign(new Error('You can only delete your own messages.'), { statusCode: 403, code: 'NOT_SENDER' });
  }

  await prisma.directMessage.update({
    where: { id: messageId },
    data: { isDeleted: true },
  });

  return { message: 'Message deleted.' };
}

/**
 * Edit a DM (only the sender can edit their own message).
 */
async function editDM(messageId, userId, newContent) {
  const message = await prisma.directMessage.findUnique({ where: { id: messageId } });
  if (!message) {
    throw Object.assign(new Error('Message not found.'), { statusCode: 404, code: 'NOT_FOUND' });
  }
  if (message.senderId !== userId) {
    throw Object.assign(new Error('You can only edit your own messages.'), { statusCode: 403, code: 'NOT_SENDER' });
  }
  if (message.isDeleted) {
    throw Object.assign(new Error('Cannot edit a deleted message.'), { statusCode: 400, code: 'DELETED' });
  }

  const updated = await prisma.directMessage.update({
    where: { id: messageId },
    data: { content: newContent, editedAt: new Date() },
  });

  return updated;
}

module.exports = { sendDM, getConversation, listConversations, markAsRead, deleteDM, editDM, requireFriendship };

/**
 * Notification Service
 *
 * Creates in-app notifications (friend requests, DMs, mentions) and
 * delivers them in real-time to the recipient's Socket.IO personal room.
 *
 * NOTE: chatSocketService is lazy-required inside functions to avoid a
 * circular dependency (chatSocketService -> messageService -> notificationService).
 */

const prisma = require('../prisma');

/**
 * Create a notification and emit it to the recipient's personal room.
 * @param {string} userId - recipient
 * @param {object} payload
 * @param {string} payload.type - friend_request | friend_accept | dm | mention
 * @param {string} payload.title
 * @param {string} [payload.body]
 * @param {string} [payload.actorId] - who triggered it
 * @param {object} [payload.data] - extra context { groupId?, messageId?, friendshipId?, link? }
 */
async function createNotification(userId, payload) {
  if (!userId) return null;

  const notification = await prisma.notification.create({
    data: {
      userId,
      type: payload.type,
      title: payload.title,
      body: payload.body || null,
      actorId: payload.actorId || null,
      data: payload.data || undefined,
    },
  });

  try {
    // Lazy require to avoid circular dependency at load time
    const { emitToUser } = require('./chatSocketService');
    emitToUser(userId, 'notification:new', notification);
  } catch (err) {
    console.error('[Notification] Socket emit failed:', err.message);
  }

  return notification;
}

/**
 * List notifications for a user (newest first).
 */
async function listNotifications(userId, { page = 1, limit = 30 } = {}) {
  const skip = (page - 1) * limit;

  const [notifications, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return {
    notifications,
    unread,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Get unread notification count.
 */
async function getUnreadCount(userId) {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

/**
 * Mark a single notification as read (must belong to the user).
 */
async function markRead(userId, notificationId) {
  const updated = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
  return { updated: updated.count };
}

/**
 * Mark notifications as read by filters (type and/or actor).
 * Used when the user opens a conversation, group, etc.
 */
async function markReadByFilter(userId, { type, actorId } = {}) {
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      isRead: false,
      ...(type ? { type } : {}),
      ...(actorId ? { actorId } : {}),
    },
    data: { isRead: true },
  });
  return { updated: result.count };
}

/**
 * Mark all notifications as read.
 */
async function markAllRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
  return { updated: result.count };
}

module.exports = {
  createNotification,
  listNotifications,
  getUnreadCount,
  markRead,
  markReadByFilter,
  markAllRead,
};

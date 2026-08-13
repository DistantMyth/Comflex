/**
 * Message Service
 *
 * Business logic for chat messages: send, edit, delete, pin/unpin,
 * read receipts, and unread tracking.
 */

const prisma = require('../prisma');
const notificationService = require('./notificationService');

/**
 * Get paginated messages for a group (newest first), with read receipt info.
 * In anonymous groups, read receipts don't exist (they'd leak identities) and
 * message authors resolve to their frozen alias snapshot.
 */
async function getMessages(groupId, { page = 1, limit = 50 } = {}, currentUserId = null, isAnon = false) {
  const baseInclude = isAnon
    ? {}
    : {
        author: {
          select: {
            id: true, displayName: true, avatarUrl: true,
            globalRing: true, displayBadges: true,
          },
        },
        readReceipts: {
          select: {
            userId: true,
            readAt: true,
          },
        },
        _count: { select: { readReceipts: true } },
      };

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: { groupId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: baseInclude,
    }),
    prisma.message.count({ where: { groupId } }),
  ]);

  return {
    messages: messages.map(msg => formatMessage(msg, currentUserId)),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Assert that a message belongs to the given group (IDOR guard).
 * Throws 404 if the message doesn't exist or lives in another group.
 */
async function assertMessageInGroup(messageId, groupId) {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, groupId: true },
  });
  if (!msg) throw Object.assign(new Error('Message not found.'), { statusCode: 404, code: 'MESSAGE_NOT_FOUND' });
  if (groupId && msg.groupId !== groupId) {
    throw Object.assign(new Error('Message not found in this group.'), { statusCode: 404, code: 'MESSAGE_NOT_IN_GROUP' });
  }
  return msg;
}

/**
 * Get a single message by ID.
 */
async function getMessage(messageId, groupId = null, isAnon = false) {
  await assertMessageInGroup(messageId, groupId);
  const include = isAnon
    ? {}
    : {
        author: {
          select: {
            id: true, displayName: true, avatarUrl: true,
            globalRing: true, displayBadges: true,
          },
        },
        readReceipts: {
          select: { userId: true, readAt: true },
        },
        _count: { select: { readReceipts: true } },
      };
  const msg = await prisma.message.findUnique({ where: { id: messageId }, include });
  if (!msg) throw Object.assign(new Error('Message not found.'), { statusCode: 404, code: 'MESSAGE_NOT_FOUND' });
  return formatMessage(msg);
}

/**
 * Send a new message.
 * @param {string} groupId
 * @param {string|null} authorId — real user id (null for anonymous groups)
 * @param {object} params
 * @param {object|null} anon — { identityId, alias, aliasTag, avatarUrl } for anon groups
 */
async function sendMessage(groupId, authorId, params, anon = null) {
  const { content, mentions = [], attachments = [], replyToId, forwarded = false, msgType = 'text', fileUrl, fileName, fileSize, mimetype } = params;

  const isAnon = !!anon;
  const data = isAnon
    ? {
        groupId,
        authorId: null,
        authorType: 'anon',
        anonAuthorId: anon.identityId,
        authorSnapshot: { alias: anon.alias, aliasTag: anon.aliasTag, avatarUrl: anon.avatarUrl || null },
        content, attachments,
        mentions: [], // mentions leak identity — never allowed in anon groups
        replyToId, forwarded, msgType, fileUrl, fileName, fileSize, mimetype,
      }
    : {
        groupId, authorId, content, mentions, attachments,
        replyToId, forwarded, msgType, fileUrl, fileName, fileSize, mimetype,
      };

  const msg = await prisma.message.create({
    data,
    include: isAnon ? {} : {
      author: {
        select: {
          id: true, displayName: true, avatarUrl: true,
          globalRing: true, displayBadges: true,
        },
      },
    },
  });

  if (isAnon) {
    return formatMessage(msg);
  }

  // Auto-create read receipt for the author
  await prisma.messageReadReceipt.create({
    data: { messageId: msg.id, userId: authorId },
  }).catch(() => {}); // Ignore if already exists

  // Notify mentioned users (excluding the author) — fire-and-forget
  const mentionIds = [...new Set((mentions || []).filter((id) => id && id !== authorId))];
  if (mentionIds.length > 0) {
    try {
      const group = await prisma.cohortGroup.findUnique({
        where: { id: groupId },
        select: { displayName: true, name: true },
      });
      const groupName = group?.displayName || group?.name || 'a group';
      const preview = (content || '').slice(0, 120);
      for (const mentionedId of mentionIds) {
        await notificationService.createNotification(mentionedId, {
          type: 'mention',
          title: `You were mentioned in ${groupName}`,
          body: preview || 'You were mentioned in a message',
          actorId: authorId,
          data: { groupId, messageId: msg.id, link: `/groups/${groupId}` },
        });
      }
    } catch (err) {
      console.error('[Message] Mention notification failed:', err.message);
    }
  }

  return formatMessage({ ...msg, readReceipts: [{ userId: authorId, readAt: new Date() }], _count: { readReceipts: 1 } });
}

/**
 * Edit own message (only content can change).
 * Anonymous groups: ownership is proven by the identity secret.
 */
async function editMessage(messageId, userId, newContent, groupId = null, anon = null) {
  await assertMessageInGroup(messageId, groupId);
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg) throw Object.assign(new Error('Message not found.'), { statusCode: 404, code: 'MESSAGE_NOT_FOUND' });
  if (msg.authorType === 'anon') {
    if (!anon || msg.anonAuthorId !== anon.identityId) {
      throw Object.assign(new Error('You can only edit your own messages.'), { statusCode: 403, code: 'NOT_AUTHOR' });
    }
  } else if (msg.authorId !== userId) {
    throw Object.assign(new Error('You can only edit your own messages.'), { statusCode: 403, code: 'NOT_AUTHOR' });
  }
  if (msg.isDeleted) {
    throw Object.assign(new Error('Cannot edit a deleted message.'), { statusCode: 400, code: 'MESSAGE_DELETED' });
  }

  const include = anon
    ? {}
    : {
        author: {
          select: {
            id: true, displayName: true, avatarUrl: true,
            globalRing: true, displayBadges: true,
          },
        },
        readReceipts: {
          select: { userId: true, readAt: true },
        },
        _count: { select: { readReceipts: true } },
      };

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { content: newContent, editedAt: new Date() },
    include,
  });
  return formatMessage(updated);
}

/**
 * Delete a message (soft delete — marks as deleted).
 * Anonymous groups: ownership is proven by the identity secret.
 */
async function deleteMessage(messageId, userId, canDeleteOthers = false, groupId = null, anon = null) {
  await assertMessageInGroup(messageId, groupId);
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg) throw Object.assign(new Error('Message not found.'), { statusCode: 404, code: 'MESSAGE_NOT_FOUND' });

  const isOwn = msg.authorType === 'anon'
    ? (anon && msg.anonAuthorId === anon.identityId)
    : msg.authorId === userId;
  if (!isOwn && !canDeleteOthers) {
    throw Object.assign(new Error('You do not have permission to delete this message.'), { statusCode: 403, code: 'PERMISSION_DENIED' });
  }

  return prisma.message.update({
    where: { id: messageId },
    data: { isDeleted: true, content: '[Message deleted]' },
  });
}

/**
 * Toggle a reaction on a message.
 * Anonymous groups: reactions are keyed by identity (anon:<identityId>) so
 * reactor identities never appear in payloads.
 */
async function toggleReaction(messageId, reactorId, emoji, groupId = null, anon = null) {
  await assertMessageInGroup(messageId, groupId);
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg) throw Object.assign(new Error('Message not found.'), { statusCode: 404, code: 'MESSAGE_NOT_FOUND' });

  const reactorKey = anon ? `anon:${anon.identityId}` : reactorId;

  // Reactions are structured as { "👍": ["userId1", "userId2"] }
  const currentReactions = msg.reactions || {};
  let usersForEmoji = currentReactions[emoji] || [];

  if (usersForEmoji.includes(reactorKey)) {
    // Remove if already reacted
    usersForEmoji = usersForEmoji.filter(id => id !== reactorKey);
  } else {
    // Add reaction
    usersForEmoji.push(reactorKey);
  }

  // If no users left, remove the emoji key entirely
  const updatedReactions = { ...currentReactions };
  if (usersForEmoji.length === 0) {
    delete updatedReactions[emoji];
  } else {
    updatedReactions[emoji] = usersForEmoji;
  }

  const include = anon
    ? {}
    : {
        author: {
          select: {
            id: true, displayName: true, avatarUrl: true,
            globalRing: true, displayBadges: true,
          },
        },
        readReceipts: { select: { userId: true, readAt: true } },
        _count: { select: { readReceipts: true } },
      };

  const updatedMsg = await prisma.message.update({
    where: { id: messageId },
    data: { reactions: updatedReactions },
    include,
  });
  return formatMessage(updatedMsg);
}

/**
 * Pin a message.
 */
async function pinMessage(messageId, groupId = null) {
  await assertMessageInGroup(messageId, groupId);
  // First, find the message to get its groupId
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { groupId: true, isPinned: true },
  });
  
  if (!msg) throw Object.assign(new Error('Message not found.'), { statusCode: 404, code: 'MESSAGE_NOT_FOUND' });
  
  if (msg.isPinned) {
    const existing = await prisma.message.findUnique({ where: { id: messageId } });
    return { msg: formatMessage(existing), unpinnedIds: [] };
  }

  // Find all currently pinned messages in this group, ordered by oldest first
  const pinnedMessages = await prisma.message.findMany({
    where: { groupId: msg.groupId, isPinned: true, isDeleted: false },
    orderBy: { pinnedAt: 'asc' }, // nulls first, then oldest Date
    select: { id: true, pinnedAt: true, createdAt: true },
  });
  
  // Sort robustly in javascript to handle nulls properly (fallback to createdAt)
  pinnedMessages.sort((a, b) => {
    const timeA = new Date(a.pinnedAt || a.createdAt).getTime();
    const timeB = new Date(b.pinnedAt || b.createdAt).getTime();
    return timeA - timeB;
  });

  const unpinnedIds = [];
  // If there are 5 or more, unpin the oldest one(s) so that adding 1 keeps it at 5 max.
  if (pinnedMessages.length >= 5) {
    const toUnpin = pinnedMessages.slice(0, pinnedMessages.length - 4).map(m => m.id);
    if (toUnpin.length > 0) {
      await prisma.message.updateMany({
        where: { id: { in: toUnpin } },
        data: { isPinned: false, pinnedAt: null },
      });
      unpinnedIds.push(...toUnpin);
    }
  }

  // Now pin the new one
  const updatedMsg = await prisma.message.update({
    where: { id: messageId },
    data: { isPinned: true, pinnedAt: new Date() },
    include: {
      author: {
        select: {
          id: true, displayName: true, avatarUrl: true,
          globalRing: true, displayBadges: true,
        },
      },
    },
  });
  
  return { msg: formatMessage(updatedMsg), unpinnedIds };
}

/**
 * Unpin a message.
 */
async function unpinMessage(messageId, groupId = null) {
  await assertMessageInGroup(messageId, groupId);
  return prisma.message.update({
    where: { id: messageId },
    data: { isPinned: false, pinnedAt: null },
  });
}

/**
 * Get all pinned messages in a group.
 */
async function getPinnedMessages(groupId) {
  const messages = await prisma.message.findMany({
    where: { groupId, isPinned: true, isDeleted: false },
    orderBy: { pinnedAt: 'desc' },
    include: {
      author: {
        select: {
          id: true, displayName: true, avatarUrl: true,
          globalRing: true, displayBadges: true,
        },
      },
    },
  });
  return messages.map(formatMessage);
}

// ============================================================
// READ RECEIPTS
// ============================================================

/**
 * Mark a single message as read by a user.
 */
async function markMessageRead(messageId, userId, groupId = null) {
  await assertMessageInGroup(messageId, groupId);
  return prisma.messageReadReceipt.upsert({
    where: { messageId_userId: { messageId, userId } },
    update: { readAt: new Date() },
    create: { messageId, userId },
  });
}

/**
 * Mark all unread messages in a group as read for a user.
 * Returns the count of newly-read messages.
 */
async function markGroupMessagesRead(groupId, userId) {
  // Get all message IDs in this group that the user hasn't read yet
  const unreadMessages = await prisma.message.findMany({
    where: {
      groupId,
      isDeleted: false,
      authorId: { not: userId },
      readReceipts: {
        none: { userId },
      },
    },
    select: { id: true },
  });

  if (unreadMessages.length === 0) return { markedCount: 0 };

  // Create read receipts in batch
  const receipts = unreadMessages.map(m => ({
    messageId: m.id,
    userId,
  }));

  // Use createMany for efficiency (skipDuplicates is not supported on MongoDB)
  try {
    const result = await prisma.messageReadReceipt.createMany({
      data: receipts,
    });
    return { markedCount: result.count };
  } catch (err) {
    // If a duplicate constraint error occurs during race conditions, just return 0
    return { markedCount: 0 };
  }
}

/**
 * Get read receipts for a specific message.
 */
async function getReadReceipts(messageId, groupId = null) {
  await assertMessageInGroup(messageId, groupId);
  const receipts = await prisma.messageReadReceipt.findMany({
    where: { messageId },
    orderBy: { readAt: 'desc' },
  });

  const userIds = receipts.map(r => r.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true, avatarUrl: true, username: true },
  });

  return receipts.map(r => ({
    ...r,
    user: users.find(u => u.id === r.userId),
  }));
}

/**
 * Format a message for API response.
 * Anonymous-group messages surface the frozen alias snapshot as `author`
 * and never include read-receipt material (there are no receipts for anon).
 */
function formatMessage(msg, currentUserId = null) {
  const isAnonMsg = msg.authorType === 'anon';
  const snapshot = msg.authorSnapshot || null;

  const base = {
    id: msg.id,
    groupId: msg.groupId,
    authorId: isAnonMsg ? null : msg.authorId,
    author: isAnonMsg
      ? {
          id: msg.anonAuthorId,
          displayName: snapshot?.alias || 'Anonymous',
          aliasTag: snapshot?.aliasTag || null,
          avatarUrl: snapshot?.avatarUrl || null,
          isAnonymous: true,
        }
      : (msg.author || null),
    content: msg.isDeleted ? '[Message deleted]' : msg.content,
    attachments: msg.attachments || [],
    mentions: msg.mentions || [],
    isPinned: msg.isPinned,
    pinnedAt: msg.pinnedAt || null,
    isDeleted: msg.isDeleted,
    createdAt: msg.createdAt,
    editedAt: msg.editedAt,
    
    // Extensions
    replyToId: msg.replyToId || null,
    reactions: msg.reactions || {},
    forwarded: msg.forwarded || false,
    msgType: msg.msgType || 'text',
    fileUrl: msg.fileUrl || null,
    fileName: msg.fileName || null,
    fileSize: msg.fileSize || null,
    mimetype: msg.mimetype || null,
  };

  // Add read receipt summary if available (never for anonymous messages)
  if (!isAnonMsg) {
    if (msg._count) {
      base.readCount = msg._count.readReceipts || 0;
    }
    if (msg.readReceipts) {
      base.readBy = msg.readReceipts.slice(0, 5).map(r => r.userId);
      if (currentUserId) {
        base.isReadByMe = msg.readReceipts.some(r => r.userId === currentUserId);
      }
    }
  }

  return base;
}

module.exports = {
  getMessages, getMessage, sendMessage, editMessage, deleteMessage,
  pinMessage, unpinMessage, getPinnedMessages, toggleReaction,
  markMessageRead, markGroupMessagesRead, getReadReceipts,
};

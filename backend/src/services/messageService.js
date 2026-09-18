/**
 * Message Service
 *
 * Business logic for chat messages: send, edit, delete, pin/unpin,
 * read receipts, and unread tracking.
 */

const prisma = require('../prisma');
const notificationService = require('./notificationService');

const ID_RE = /^[0-9a-fA-F]{24}$/;
function isValidMongoId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

/**
 * Format a referenced message preview for quoted replies.
 * In anonymous groups or for anon authors, surfaces frozen alias snapshot as author.
 * Deleted messages sanitize content and file attachments.
 */
function formatReplyPreview(msg, isAnon = false) {
  if (!msg) return null;
  const isAnonMsg = msg.authorType === 'anon' || isAnon;
  const snapshot = msg.authorSnapshot || null;

  return {
    id: msg.id,
    content: msg.isDeleted ? '[Message deleted]' : (msg.content || ''),
    msgType: msg.msgType || 'text',
    fileName: msg.isDeleted ? null : (msg.fileName || null),
    fileUrl: msg.isDeleted ? null : (msg.fileUrl || null),
    isDeleted: Boolean(msg.isDeleted),
    author: isAnonMsg
      ? {
          id: msg.anonAuthorId,
          displayName: snapshot?.alias || 'Anonymous',
          aliasTag: snapshot?.aliasTag || null,
          avatarUrl: snapshot?.avatarUrl || null,
          isAnonymous: true,
        }
      : (msg.author
          ? {
              id: msg.author.id,
              displayName: msg.author.displayName || 'Unknown',
              avatarUrl: msg.author.avatarUrl || null,
              globalRing: typeof msg.author.globalRing === 'number' ? msg.author.globalRing : 3,
            }
          : null),
  };
}

/**
 * Get paginated messages for a group (newest first).
 * In anonymous groups, message authors resolve to their frozen alias snapshot.
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

  // Batch-fetch referenced reply messages within this group (IDOR-safe & ObjectId-safe)
  const replyIds = [...new Set(messages.map(m => m.replyToId).filter(isValidMongoId))];
  let replyMap = new Map();
  if (replyIds.length > 0) {
    const replies = await prisma.message.findMany({
      where: { id: { in: replyIds }, groupId },
      include: isAnon ? {} : {
        author: {
          select: {
            id: true, displayName: true, avatarUrl: true, globalRing: true,
          },
        },
      },
    });
    replyMap = new Map(replies.map(r => [r.id, formatReplyPreview(r, isAnon)]));
    // Tombstone fallback for hard-deleted or cross-group messages
    for (const rid of replyIds) {
      if (!replyMap.has(rid)) {
        replyMap.set(rid, {
          id: rid,
          content: '[Message deleted]',
          msgType: 'text',
          fileName: null,
          fileUrl: null,
          isDeleted: true,
          author: null,
        });
      }
    }
  }

  return {
    messages: messages.map(msg => formatMessage(msg, currentUserId, replyMap.get(msg.replyToId) || null)),
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
      };
  const msg = await prisma.message.findUnique({ where: { id: messageId }, include });
  if (!msg) throw Object.assign(new Error('Message not found.'), { statusCode: 404, code: 'MESSAGE_NOT_FOUND' });

  let replyPreview = null;
  if (isValidMongoId(msg.replyToId)) {
    const replyMsg = await prisma.message.findFirst({
      where: { id: msg.replyToId, ...(groupId ? { groupId } : {}) },
      include: isAnon ? {} : {
        author: {
          select: {
            id: true, displayName: true, avatarUrl: true, globalRing: true,
          },
        },
      },
    });
    if (replyMsg) {
      replyPreview = formatReplyPreview(replyMsg, isAnon);
    } else {
      replyPreview = {
        id: msg.replyToId,
        content: '[Message deleted]',
        msgType: 'text',
        fileName: null,
        fileUrl: null,
        isDeleted: true,
        author: null,
      };
    }
  }

  return formatMessage(msg, null, replyPreview);
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

  const cleanReplyToId = isValidMongoId(replyToId) ? replyToId : null;
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
        replyToId: cleanReplyToId, forwarded, msgType, fileUrl, fileName, fileSize, mimetype,
      }
    : {
        groupId, authorId, content, mentions, attachments,
        replyToId: cleanReplyToId, forwarded, msgType, fileUrl, fileName, fileSize, mimetype,
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

  // Resolve reply preview if cleanReplyToId is provided
  let replyPreview = null;
  if (cleanReplyToId) {
    const replyMsg = await prisma.message.findFirst({
      where: { id: cleanReplyToId, groupId },
      include: isAnon ? {} : {
        author: {
          select: {
            id: true, displayName: true, avatarUrl: true, globalRing: true,
          },
        },
      },
    });
    if (replyMsg) {
      replyPreview = formatReplyPreview(replyMsg, isAnon);
    } else {
      replyPreview = {
        id: cleanReplyToId,
        content: '[Message deleted]',
        msgType: 'text',
        fileName: null,
        fileUrl: null,
        isDeleted: true,
        author: null,
      };
    }
  }

  if (isAnon) {
    return formatMessage(msg, null, replyPreview);
  }

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

  return formatMessage(msg, null, replyPreview);
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
      };

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { content: newContent, editedAt: new Date() },
    include,
  });

  let replyPreview = null;
  if (isValidMongoId(updated.replyToId)) {
    const replyMsg = await prisma.message.findFirst({
      where: { id: updated.replyToId, ...(groupId ? { groupId } : {}) },
      include: anon ? {} : {
        author: {
          select: {
            id: true, displayName: true, avatarUrl: true, globalRing: true,
          },
        },
      },
    });
    if (replyMsg) {
      replyPreview = formatReplyPreview(replyMsg, !!anon);
    } else {
      replyPreview = {
        id: updated.replyToId,
        content: '[Message deleted]',
        msgType: 'text',
        fileName: null,
        fileUrl: null,
        isDeleted: true,
        author: null,
      };
    }
  }

  return formatMessage(updated, null, replyPreview);
}

/**
 * Delete a message (soft delete — marks as deleted).
 * Anonymous groups: ownership is proven by the identity secret.
 */
async function deleteMessage(messageId, userId, canDeleteOthers = false, groupId = null, anon = null, actorRing = 3) {
  await assertMessageInGroup(messageId, groupId);
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg) throw Object.assign(new Error('Message not found.'), { statusCode: 404, code: 'MESSAGE_NOT_FOUND' });

  const isOwn = msg.authorType === 'anon'
    ? (anon && msg.anonAuthorId === anon.identityId)
    : msg.authorId === userId;
  if (!isOwn) {
    if (!canDeleteOthers) {
      throw Object.assign(new Error('You do not have permission to delete this message.'), { statusCode: 403, code: 'PERMISSION_DENIED' });
    }
    // Check ring hierarchy if author is in normal group
    if (msg.authorId && groupId) {
      const authorMembership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: msg.authorId, groupId } },
        select: { ring: true },
      });
      const authorRing = authorMembership?.ring ?? 3;
      if (actorRing !== 0 && authorRing <= actorRing) {
        throw Object.assign(
          new Error('Cannot delete messages from users at your level or above.'),
          { statusCode: 403, code: 'RING_VIOLATION' }
        );
      }
    }
  }

  return prisma.message.update({
    where: { id: messageId },
    data: {
      isDeleted: true,
      content: '[Message deleted]',
      fileUrl: null,
      fileName: null,
      fileSize: null,
      mimetype: null,
      attachments: [],
    },
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

  const replyIds = [...new Set(messages.map(m => m.replyToId).filter(isValidMongoId))];
  let replyMap = new Map();
  if (replyIds.length > 0) {
    const replies = await prisma.message.findMany({
      where: { id: { in: replyIds }, groupId },
      include: {
        author: {
          select: {
            id: true, displayName: true, avatarUrl: true, globalRing: true,
          },
        },
      },
    });
    replyMap = new Map(replies.map(r => [r.id, formatReplyPreview(r, false)]));
    for (const rid of replyIds) {
      if (!replyMap.has(rid)) {
        replyMap.set(rid, {
          id: rid,
          content: '[Message deleted]',
          msgType: 'text',
          fileName: null,
          fileUrl: null,
          isDeleted: true,
          author: null,
        });
      }
    }
  }

  return messages.map(msg => formatMessage(msg, null, replyMap.get(msg.replyToId) || null));
}

// ============================================================
// READ RECEIPTS
// ============================================================

/**
 * Format a message for API response.
 * Anonymous-group messages surface the frozen alias snapshot as `author`.
 */
function formatMessage(msg, currentUserId = null, replyTo = null) {
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
    attachments: msg.isDeleted ? [] : (msg.attachments || []),
    mentions: msg.isDeleted ? [] : (msg.mentions || []),
    isPinned: msg.isPinned,
    pinnedAt: msg.pinnedAt || null,
    isDeleted: msg.isDeleted,
    createdAt: msg.createdAt,
    editedAt: msg.editedAt,
    
    // Extensions
    replyToId: msg.replyToId || null,
    replyTo: replyTo !== null ? replyTo : (msg.replyTo ? formatReplyPreview(msg.replyTo, isAnonMsg) : null),
    reactions: msg.reactions || {},
    forwarded: msg.forwarded || false,
    msgType: msg.isDeleted ? 'text' : (msg.msgType || 'text'),
    fileUrl: msg.isDeleted ? null : (msg.fileUrl || null),
    fileName: msg.isDeleted ? null : (msg.fileName || null),
    fileSize: msg.isDeleted ? null : (msg.fileSize || null),
    mimetype: msg.isDeleted ? null : (msg.mimetype || null),
  };

  return base;
}

module.exports = {
  getMessages, getMessage, sendMessage, editMessage, deleteMessage,
  pinMessage, unpinMessage, getPinnedMessages, toggleReaction,
  formatReplyPreview, formatMessage,
};

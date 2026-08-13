/**
 * Chat Socket Service — Socket.IO WebSocket Server
 *
 * Handles real-time messaging: send/receive group messages, DMs,
 * typing indicators, read receipts, and moderation events.
 *
 * Authentication: JWT verification on handshake.
 * Rooms: each group ID is a Socket.IO room, each user has a personal room (user:<id>).
 */

const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../prisma');
const messageService = require('./messageService');
const groupService = require('./groupService');
const dmService = require('./dmService');

let io;

/**
 * Initialize Socket.IO on the HTTP server.
 */
function initSocket(httpServer, frontendUrl) {
  const env = require('../config/env');
  io = new Server(httpServer, {
    cors: {
      origin: env.NODE_ENV === 'development' ? true : frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Authentication Middleware ──────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required.'));

    try {
      const decoded = verifyAccessToken(token);
      socket.user = {
        id: decoded.sub,
        email: decoded.email,
        globalRing: decoded.globalRing,
        displayName: decoded.displayName || decoded.email,
      };
      next();
    } catch {
      next(new Error('Invalid or expired token.'));
    }
  });

  // ── Connection Handler ────────────────────────────────
  io.on('connection', async (socket) => {
    console.log(`[WS] ✅ Connected: ${socket.user.email} (${socket.id})`);

    // Re-read the user from the DB (like the REST auth middleware) so
    // demotions, bans, and deletions take effect immediately instead of
    // trusting stale JWT claims for the session's lifetime.
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: socket.user.id },
        select: { id: true, email: true, globalRing: true, displayName: true, avatarUrl: true },
      });
      if (!dbUser) {
        socket.emit('auth:error', { error: 'Account no longer exists.' });
        socket.disconnect(true);
        return;
      }
      socket.user = {
        id: dbUser.id,
        email: dbUser.email,
        globalRing: dbUser.globalRing,
        displayName: dbUser.displayName || dbUser.email,
      };
    } catch (err) {
      console.error(`[WS] Failed to load user for ${socket.user.id}:`, err.message);
      socket.disconnect(true);
      return;
    }

    // Join personal room for DM delivery
    socket.join(`user:${socket.user.id}`);

    // Auto-join all group rooms the user belongs to
    try {
      const memberships = await prisma.groupMember.findMany({
        where: { userId: socket.user.id },
        select: { groupId: true },
      });
      for (const m of memberships) {
        socket.join(m.groupId);
      }
      console.log(`[WS] Joined ${memberships.length} group rooms + personal room for ${socket.user.email}`);
    } catch (err) {
      console.error(`[WS] Failed to join rooms for ${socket.user.email}:`, err.message);
    }

    // ── message:send (group messages) ─────────────────────
    socket.on('message:send', async (data, callback) => {
      try {
        const { groupId, content, mentions = [], attachments = [], replyToId, forwarded, msgType } = data;
        if (!groupId || (!content?.trim() && !attachments.length)) {
          return callback?.({ error: 'groupId and content are required.' });
        }

        // Check membership
        const membership = await prisma.groupMember.findUnique({
          where: { userId_groupId: { userId: socket.user.id, groupId } },
        });
        if (!membership && socket.user.globalRing !== 0) {
          return callback?.({ error: 'Not a member of this group.' });
        }

        // Check permissions
        const perms = membership?.permissions || {};
        if (!perms.can_send_messages && socket.user.globalRing !== 0) {
          return callback?.({ error: 'You do not have permission to send messages.' });
        }

        // Check mute
        const muteStatus = await groupService.isMuted(groupId, socket.user.id);
        if (muteStatus) {
          return callback?.({ error: `Muted until ${muteStatus.mutedUntil.toISOString()}` });
        }

        const msg = await messageService.sendMessage(groupId, socket.user.id, {
          content: content?.trim() || '',
          mentions,
          attachments,
          replyToId,
          forwarded,
          msgType
        });

        // Broadcast to room
        io.to(groupId).emit('message:new', msg);
        callback?.({ success: true, message: msg });
      } catch (err) {
        console.error('[WS] message:send error:', err.message);
        callback?.({ error: err.message });
      }
    });

    // ── message:read (mark group messages as read) ────────
    socket.on('message:read', async (data, callback) => {
      try {
        const { groupId } = data;
        if (!groupId) {
          return callback?.({ error: 'groupId is required.' });
        }

        const result = await messageService.markGroupMessagesRead(groupId, socket.user.id);

        // Broadcast read update to the group so others see read receipts update
        socket.to(groupId).emit('message:readUpdate', {
          userId: socket.user.id,
          displayName: socket.user.displayName,
          groupId,
          markedCount: result.markedCount,
        });

        callback?.({ success: true, ...result });
      } catch (err) {
        console.error('[WS] message:read error:', err.message);
        callback?.({ error: err.message });
      }
    });

    // ── typing:start (groups) ────────────────────────────
    socket.on('typing:start', ({ groupId }) => {
      if (groupId) {
        socket.to(groupId).emit('typing:start', {
          userId: socket.user.id,
          displayName: socket.user.displayName,
          groupId,
        });
      }
    });

    // ── typing:stop (groups) ─────────────────────────────
    socket.on('typing:stop', ({ groupId }) => {
      if (groupId) {
        socket.to(groupId).emit('typing:stop', {
          userId: socket.user.id,
          groupId,
        });
      }
    });

    // ── dm:send — Send a direct message ──────────────────
    socket.on('dm:send', async (data, callback) => {
      try {
        const { receiverId, content } = data;
        if (!receiverId || !content?.trim()) {
          return callback?.({ error: 'receiverId and content are required.' });
        }

        const message = await dmService.sendDM(socket.user.id, receiverId, { content: content.trim() });

        // Deliver to receiver's personal room
        io.to(`user:${receiverId}`).emit('dm:new', {
          ...message,
          senderDisplayName: socket.user.displayName,
        });

        // Also echo back to sender
        socket.emit('dm:new', message);

        callback?.({ success: true, message });
      } catch (err) {
        console.error('[WS] dm:send error:', err.message);
        callback?.({ error: err.message });
      }
    });

    // ── dm:read — Mark DMs as read and notify sender ─────
    socket.on('dm:read', async (data, callback) => {
      try {
        const { userId: otherUserId } = data;
        if (!otherUserId) {
          return callback?.({ error: 'userId is required.' });
        }

        await dmService.markAsRead(socket.user.id, otherUserId);

        // Notify the other user that their messages were read
        io.to(`user:${otherUserId}`).emit('dm:readUpdate', {
          readByUserId: socket.user.id,
          readAt: new Date().toISOString(),
        });

        callback?.({ success: true });
      } catch (err) {
        console.error('[WS] dm:read error:', err.message);
        callback?.({ error: err.message });
      }
    });

    // ── dm:typing:start ──────────────────────────────────
    socket.on('dm:typing:start', ({ receiverId }) => {
      if (receiverId) {
        io.to(`user:${receiverId}`).emit('dm:typing:start', {
          userId: socket.user.id,
          displayName: socket.user.displayName,
        });
      }
    });

    // ── dm:typing:stop ───────────────────────────────────
    socket.on('dm:typing:stop', ({ receiverId }) => {
      if (receiverId) {
        io.to(`user:${receiverId}`).emit('dm:typing:stop', {
          userId: socket.user.id,
        });
      }
    });

    // ── disconnect ──────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[WS] ❌ Disconnected: ${socket.user.email} (${reason})`);
    });
  });

  return io;
}

/**
 * Get the Socket.IO instance (for emitting from routes/services).
 */
function getIO() {
  if (!io) throw new Error('Socket.IO not initialized. Call initSocket first.');
  return io;
}

/**
 * Emit a moderation event to a group room.
 */
function emitToGroup(groupId, event, data) {
  if (io) io.to(groupId).emit(event, data);
}

/**
 * Emit a DM event to a specific user.
 */
function emitToUser(userId, event, data) {
  if (io) io.to(`user:${userId}`).emit(event, data);
}

module.exports = { initSocket, getIO, emitToGroup, emitToUser };

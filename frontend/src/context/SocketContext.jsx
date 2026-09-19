/**
 * SocketContext — Shared Socket.IO client provider for real-time features.
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../hooks/useAuth';
import { socketOrigin } from '../utils/resolveAsset';
import { getAccessToken, getAnonSessions, refreshAccessToken, getCurrentUserId, removeAnonSession } from '../api/client';
import { clientCache } from '../utils/clientCache';

const SOCKET_URL = socketOrigin();

export const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [socketInstance, setSocketInstance] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
        setSocketInstance(null);
      }
      return;
    }

    const token = getAccessToken();
    if (!token) return;

    const anonSessions = Object.entries(getAnonSessions())
      .filter(([, s]) => s?.identityId && s?.secret)
      .map(([groupId, s]) => ({ groupId, identityId: s.identityId, secret: s.secret }));

    const socket = io(SOCKET_URL, {
      auth: { token, anon: anonSessions },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', async (err) => {
      setConnected(false);
      if (/token|auth|unauthorized/i.test(err.message || '')) {
        try {
          const freshToken = await refreshAccessToken();
          const currentAnon = Object.entries(getAnonSessions())
            .filter(([, s]) => s?.identityId && s?.secret)
            .map(([groupId, s]) => ({ groupId, identityId: s.identityId, secret: s.secret }));
          socket.auth = { ...(socket.auth || {}), token: freshToken, anon: currentAnon };
          socket.disconnect();
          socket.connect();
        } catch {
          // Refresh failed
        }
      }
    });

    const handleStorage = (e) => {
      if (e.key === 'comflex-anon-sessions' && socketRef.current) {
        const currentAnon = Object.entries(getAnonSessions())
          .filter(([, s]) => s?.identityId && s?.secret)
          .map(([groupId, s]) => ({ groupId, identityId: s.identityId, secret: s.secret }));
        socketRef.current.auth = { ...(socketRef.current.auth || {}), anon: currentAnon };
      }
    };
    window.addEventListener('storage', handleStorage);

    // Real-time client cache synchronization
    socket.on('message:new', (message) => {
      if (!message?.groupId) return;

      // Mutate recent messages cache so navigation and SWR maintain real-time sync
      clientCache.mutate(`messages:group:${message.groupId}:recent`, (current) => {
        if (!current) return current;
        const payload = current?.data?.data || current?.data || current;
        const list = Array.isArray(payload?.messages) ? payload.messages : (Array.isArray(payload) ? payload : null);
        if (!list) return current;

        if (list.some((m) => m.id === message.id)) return current;
        const updatedList = [message, ...list];

        if (payload?.messages) {
          if (current?.data?.data) return { ...current, data: { ...current.data, data: { ...payload, messages: updatedList } } };
          if (current?.data) return { ...current, data: { ...payload, messages: updatedList } };
        }
        return updatedList;
      });

      clientCache.mutate('groups:list', (groups) => {
        if (!Array.isArray(groups)) return groups;
        const index = groups.findIndex((g) => g.id === message.groupId);
        if (index === -1) {
          // Unrecognized group: trigger background revalidation
          clientCache.invalidate('groups:list');
          return groups;
        }

        const currentGroup = groups[index];
        const currentUserId = getCurrentUserId();
        const localAnonId = getAnonSessions()[message.groupId]?.identityId || currentGroup.myIdentity?.identityId;
        const isCurrentSender =
          (message.authorId && message.authorId === currentUserId) ||
          (message.author?.id && (message.author.id === currentUserId || message.author.id === localAnonId)) ||
          (message.anonAuthorId && message.anonAuthorId === localAnonId);
        const isInsideActiveGroup = typeof window !== 'undefined' && window.location.pathname === `/groups/${message.groupId}`;
        const shouldIncrement = !isCurrentSender && !isInsideActiveGroup;

        const updatedGroup = {
          ...currentGroup,
          unreadCount: shouldIncrement ? (currentGroup.unreadCount || 0) + 1 : (currentGroup.unreadCount || 0),
          lastMessage: message,
          lastMessageAt: message.createdAt || new Date().toISOString(),
        };

        const nextGroups = [...groups];
        nextGroups.splice(index, 1);
        return [updatedGroup, ...nextGroups];
      });
    });

    socket.on('message:reaction', ({ messageId, reactions, groupId }) => {
      if (!groupId) return;
      clientCache.mutate(`messages:group:${groupId}:recent`, (current) => {
        if (!current) return current;
        const payload = current?.data?.data || current?.data || current;
        const list = Array.isArray(payload?.messages) ? payload.messages : (Array.isArray(payload) ? payload : null);
        if (!list) return current;

        const updatedList = list.map((m) => (m.id === messageId ? { ...m, reactions } : m));
        if (payload?.messages) {
          if (current?.data?.data) return { ...current, data: { ...current.data, data: { ...payload, messages: updatedList } } };
          if (current?.data) return { ...current, data: { ...payload, messages: updatedList } };
        }
        return updatedList;
      });
    });

    socket.on('message:delete', ({ messageId, groupId }) => {
      if (!groupId) return;
      clientCache.mutate(`messages:group:${groupId}:recent`, (current) => {
        if (!current) return current;
        const payload = current?.data?.data || current?.data || current;
        const list = Array.isArray(payload?.messages) ? payload.messages : (Array.isArray(payload) ? payload : null);
        if (!list) return current;

        const updatedList = list.map((m) =>
          m.id === messageId ? { ...m, isDeleted: true, content: '[Message deleted]', fileUrl: null } : m
        );
        if (payload?.messages) {
          if (current?.data?.data) return { ...current, data: { ...current.data, data: { ...payload, messages: updatedList } } };
          if (current?.data) return { ...current, data: { ...payload, messages: updatedList } };
        }
        return updatedList;
      });
    });

    socket.on('notification:new', (notification) => {
      if (!notification?.type) return;
      if (notification.type.includes('invite') || notification.type === 'group_invite') {
        clientCache.invalidate('groups:invites');
      }
      if (notification.type.includes('friend') || notification.type === 'friend_request' || notification.type === 'friend_accept') {
        clientCache.invalidate('friends:all');
      }
      clientCache.invalidate('notifications');
    });

    socket.on('dm:new', () => {
      clientCache.invalidate('dm:conversations');
    });
    socket.on('dm:readUpdate', () => {
      clientCache.invalidate('dm:conversations');
    });
    socket.on('dm:delete', () => {
      clientCache.invalidate('dm:conversations');
    });
    socket.on('dm:edit', () => {
      clientCache.invalidate('dm:conversations');
    });
    socket.on('anon:banned', (data) => {
      if (data?.groupId) {
        removeAnonSession(data.groupId);
      }
      clientCache.invalidate('groups:list');
    });

    socketRef.current = socket;
    setSocketInstance(socket);

    return () => {
      window.removeEventListener('storage', handleStorage);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      setSocketInstance(null);
    };
  }, [isAuthenticated]);

  const sendMessage = useCallback((groupId, content, mentions = [], replyToId, forwarded = false, msgType = 'text', anonIdentityId, anonSecret) => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current?.connected) {
        return reject(new Error('Not connected'));
      }
      socketRef.current.emit('message:send', { groupId, content, mentions, replyToId, forwarded, msgType, anonIdentityId, anonSecret }, (response) => {
        if (response?.error) reject(new Error(response.error));
        else resolve(response?.message);
      });
    });
  }, []);

  const joinAnonGroup = useCallback((groupId, identityId, secret) => {
    return new Promise((resolve, reject) => {
      if (socketRef.current) {
        const currentAnon = (socketRef.current.auth?.anon || []).filter(s => s.groupId !== groupId);
        currentAnon.push({ groupId, identityId, secret });
        socketRef.current.auth = { ...(socketRef.current.auth || {}), anon: currentAnon };
      }
      if (!socketRef.current?.connected) {
        return reject(new Error('Not connected'));
      }
      socketRef.current.emit('anon:join', { groupId, identityId, secret }, (response) => {
        if (response?.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }, []);

  const startTyping = useCallback((groupId) => {
    socketRef.current?.emit('typing:start', { groupId });
  }, []);

  const stopTyping = useCallback((groupId) => {
    socketRef.current?.emit('typing:stop', { groupId });
  }, []);

  const markRead = useCallback((groupId) => {
    // 1. Optimistically zero cache immediately (0ms)
    clientCache.mutate('groups:list', (groups) => {
      if (!Array.isArray(groups)) return groups;
      return groups.map((g) => (g.id === groupId ? { ...g, unreadCount: 0 } : g));
    });

    // 2. Transmit read receipt over socket
    return new Promise((resolve, reject) => {
      if (!socketRef.current?.connected) {
        return reject(new Error('Not connected'));
      }
      socketRef.current.emit('message:read', { groupId }, (response) => {
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }, []);

  const markDMRead = useCallback((userId) => {
    // 1. Optimistically zero cache immediately (0ms)
    clientCache.mutate('dm:conversations', (convs) => {
      if (!Array.isArray(convs)) return convs;
      return convs.map((c) => (c.partner?.id === userId ? { ...c, unreadCount: 0 } : c));
    });

    // 2. Transmit read receipt over socket
    return new Promise((resolve, reject) => {
      if (!socketRef.current?.connected) {
        return reject(new Error('Not connected'));
      }
      socketRef.current.emit('dm:read', { userId }, (response) => {
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }, []);

  const onEvent = useCallback((event, handler) => {
    const socket = socketRef.current;
    if (!socket) return () => {};
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, []);

  const value = {
    socket: socketInstance,
    connected,
    sendMessage,
    joinAnonGroup,
    startTyping,
    stopTyping,
    markRead,
    markDMRead,
    onEvent,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

export default SocketContext;

/**
 * useSocket — Socket.IO client hook for real-time chat.
 *
 * Connects on authentication, auto-disconnects on logout.
 * Exposes: socket instance, connection status, and helper methods.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './useAuth';
import { socketOrigin } from '../utils/resolveAsset';
import { getAccessToken, getAnonSessions, refreshAccessToken } from '../api/client';

// In dev, Vite proxies /socket.io to the backend. In production (Vercel → Render)
// the socket must connect to the backend origin directly.
const SOCKET_URL = socketOrigin();

export function useSocket() {
  const { isAuthenticated } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    const token = getAccessToken();
    if (!token) return;

    // Anonymous group sessions ride along — verified on handshake so the
    // server can join the corresponding rooms without knowing who we are.
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
      console.log('[Socket] Connected:', socket.id);
      setConnected(true);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', async (err) => {
      console.error('[Socket] Connection error:', err.message);
      setConnected(false);

      // The access token lives in memory and expires every ~15m — a
      // reconnect after that is rejected with an auth error. Refresh
      // silently via the httpOnly cookie and retry once with the new token.
      if (/token|auth|unauthorized/i.test(err.message || '')) {
        try {
          const freshToken = await refreshAccessToken();
          socket.auth = { ...(socket.auth || {}), token: freshToken };
          socket.disconnect();
          socket.connect();
        } catch {
          // Refresh failed — AuthContext's axios interceptor handles redirect.
        }
      }
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [isAuthenticated]);

  const sendMessage = useCallback((groupId, content, mentions = [], replyToId, forwarded = false, msgType = 'text', anonIdentityId) => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current?.connected) {
        return reject(new Error('Not connected'));
      }
      socketRef.current.emit('message:send', { groupId, content, mentions, replyToId, forwarded, msgType, anonIdentityId }, (response) => {
        if (response?.error) reject(new Error(response.error));
        else resolve(response?.message);
      });
    });
  }, []);

  /**
   * Join an anonymous group room mid-session (right after claiming an
   * identity via link/invite/creator claim).
   */
  const joinAnonGroup = useCallback((groupId, identityId, secret) => {
    return new Promise((resolve, reject) => {
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

  /**
   * Mark all messages in a group as read via socket.
   */
  const markRead = useCallback((groupId) => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current?.connected) {
        return reject(new Error('Not connected'));
      }
      socketRef.current.emit('message:read', { groupId }, (response) => {
        if (response?.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }, []);

  /**
   * Mark DMs as read via socket (notifies the other user in real-time).
   */
  const markDMRead = useCallback((userId) => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current?.connected) {
        return reject(new Error('Not connected'));
      }
      socketRef.current.emit('dm:read', { userId }, (response) => {
        if (response?.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }, []);

  const onEvent = useCallback((event, handler) => {
    socketRef.current?.on(event, handler);
    return () => socketRef.current?.off(event, handler);
  }, []);

  return {
    socket: socketRef.current,
    connected,
    sendMessage,
    joinAnonGroup,
    startTyping,
    stopTyping,
    markRead,
    markDMRead,
    onEvent,
  };
}

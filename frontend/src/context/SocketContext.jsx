/**
 * SocketContext — Shared Socket.IO client provider for real-time features.
 *
 * Maintains a single, shared Socket.IO connection across the entire app.
 * Connects when authenticated, auto-disconnects on logout.
 * Exposes: socket instance (via state/getter), connected status, and helper methods.
 */

/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../hooks/useAuth';
import { socketOrigin } from '../utils/resolveAsset';
import { getAccessToken, getAnonSessions, refreshAccessToken } from '../api/client';

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
          socket.auth = { ...(socket.auth || {}), token: freshToken };
          socket.disconnect();
          socket.connect();
        } catch {
          // Token refresh failed; auth interceptor handles redirection
        }
      }
    });

    socketRef.current = socket;
    setSocketInstance(socket);

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      setSocketInstance(null);
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

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}

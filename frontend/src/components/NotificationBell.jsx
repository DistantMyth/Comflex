/**
 * NotificationBell — Real-time notification bell.
 *
 * Shows an unread-count badge and a dropdown list of notifications.
 * Subscribes to the shared socket via the `onEvent` prop passed from
 * Layout (so no second socket connection is opened).
 *
 * Props:
 *   onEvent    — (event, handler) => unsubscribe, from useSocket()
 *   connected  — socket connection status
 *   className  — applied to the positioning wrapper
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellRing, Users, Send, AtSign, CheckCheck, Loader2, Inbox } from 'lucide-react';
import { notificationsApi } from '../api/notificationsApi';
import resolveAsset from '../utils/resolveAsset';

const TYPE_ICONS = {
  friend_request: Users,
  friend_accept: Users,
  dm: Send,
  mention: AtSign,
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function NotificationBell({ onEvent, connected, className = '' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [listRes, countRes] = await Promise.all([
        notificationsApi.list(30).catch(() => null),
        notificationsApi.unreadCount().catch(() => null),
      ]);
      if (listRes) setNotifications(listRes.data?.data?.notifications || []);
      if (countRes) setUnread(countRes.data?.data?.unread || 0);
    } catch {
      /* ignore */
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial fetch + periodic fallback refresh
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Keep the badge in sync when the route changes (e.g. Layout marks DM
  // notifications read when a conversation is opened)
  useEffect(() => {
    fetchData(true);
  }, [location.pathname, fetchData]);

  // Real-time: new notification arrives via socket
  useEffect(() => {
    if (!onEvent) return undefined;
    const off = onEvent('notification:new', (notification) => {
      setNotifications((prev) => {
        if (prev.some((n) => n.id === notification.id)) return prev;
        return [notification, ...prev].slice(0, 50);
      });
      setUnread((u) => u + 1);
    });
    return off;
  }, [onEvent]);

  // Close on outside click
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchData(); // fresh list on open
  };

  const handleItemClick = async (notification) => {
    setOpen(false);
    const link = notification.data?.link;
    if (link) navigate(link);
    if (!notification.isRead) {
      setUnread((u) => Math.max(0, u - 1));
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
      );
      notificationsApi.markRead(notification.id).catch(() => {});
    }
  };

  const handleMarkAllRead = async () => {
    setUnread(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await notificationsApi.markAllRead().catch(() => {});
  };

  const Icon = (type) => TYPE_ICONS[type] || Bell;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      {/* Bell button */}
      <button
        onClick={toggle}
        className="relative p-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] hover:scale-105 active:scale-95 transition-all"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
      >
        {unread > 0 ? <BellRing size={20} className="text-[var(--color-accent)]" /> : <Bell size={20} />}
        {unread > 0 && (
          <motion.span
            key={unread}
            initial={{ scale: 0.5 }}
            animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 bg-[var(--color-danger)] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-lg"
          >
            {unread > 99 ? '99+' : unread}
          </motion.span>
        )}
        {!connected && (
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[var(--color-warning)] border-2 border-[var(--color-bg-card)]" title="Offline" />
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-full mt-2 w-[340px] max-w-[calc(100vw-2rem)] glass-card !rounded-2xl shadow-2xl overflow-hidden z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50">
              <h3 className="text-sm font-bold font-display">Notifications</h3>
              {unread > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs font-semibold text-[var(--color-accent)] hover:underline flex items-center gap-1"
                >
                  <CheckCheck size={13} /> Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-[360px] overflow-y-auto">
              {loading && notifications.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={20} className="animate-spin text-[var(--color-text-muted)]" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Inbox size={26} className="text-[var(--color-text-muted)] mb-2" />
                  <p className="text-sm text-[var(--color-text-muted)]">No notifications yet</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-70">Friend requests, DMs and mentions will appear here.</p>
                </div>
              ) : (
                <ul>
                  {notifications.map((n) => {
                    const NIcon = Icon(n.type);
                    const unreadItem = !n.isRead;
                    return (
                      <li key={n.id}>
                        <button
                          onClick={() => handleItemClick(n)}
                          className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                            unreadItem
                              ? 'bg-[var(--color-accent)]/[0.06] hover:bg-[var(--color-accent)]/[0.12]'
                              : 'hover:bg-[var(--color-bg-secondary)]'
                          }`}
                        >
                          {n.data?.actorAvatarUrl ? (
                            <img
                              src={resolveAsset(n.data.actorAvatarUrl)}
                              alt=""
                              className={`w-8 h-8 rounded-lg object-cover shrink-0 mt-0.5 ${unreadItem ? 'ring-2 ring-[var(--color-accent)]/40' : 'ring-1 ring-[var(--color-border)]'}`}
                            />
                          ) : (
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                              unreadItem
                                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                                : 'bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)]'
                            }`}>
                              <NIcon size={15} />
                            </span>
                          )}
                          <span className="flex-1 min-w-0">
                            <span className={`block text-sm ${unreadItem ? 'font-semibold' : 'font-medium text-[var(--color-text-secondary)]'}`}>
                              {n.title}
                            </span>
                            {n.body && (
                              <span className="block text-xs text-[var(--color-text-muted)] mt-0.5 truncate">
                                {n.body}
                              </span>
                            )}
                            <span className="block text-[10px] text-[var(--color-text-muted)] mt-1 opacity-70">
                              {timeAgo(n.createdAt)}
                            </span>
                          </span>
                          {unreadItem && <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] mt-2.5 shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

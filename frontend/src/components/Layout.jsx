/**
 * Layout — Main app shell.
 * Desktop: animated matte glass sidebar with lucide icons + sliding active pill.
 * Mobile: top bar + slide-over drawer with Escape key support.
 * Shows unread badges on Groups/Messages/Friends nav, live from socket events.
 * Notification bell dropdown with unread count and quick mark-read actions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, MessagesSquare, Users, Send, BookOpen, CalendarDays, Store,
  ClipboardList, ShieldCheck, LogOut, Sun, Moon, Menu, X, Coins, Zap,
  Bell, Check, Trash2,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import { useTheme } from '../context/ThemeContext';
import { groupApi } from '../api/groupApi';
import { dmApi } from '../api/dmApi';
import { notificationsApi } from '../api/notificationsApi';
import Avatar from './Avatar';
import ComflexLogo from './ComflexLogo';
import ThemeToggle from './ThemeToggle';
import LiquidGlassFilter from './LiquidGlassFilter';
import ErrorBoundary from './ErrorBoundary';

const RING_LABELS = {
  0: { label: 'Admin', color: 'ring-badge-0' },
  1: { label: 'Manager', color: 'ring-badge-1' },
  2: { label: 'Elevated', color: 'ring-badge-2' },
  3: { label: 'Member', color: 'ring-badge-3' },
};

const Logo = () => (
  <Link to="/" className="flex items-center px-5 py-5" aria-label="Comflex Home">
    <ComflexLogo variant="fullWithWordmark" size="md" animated={true} />
  </Link>
);

const NavList = ({ navItems, isActive, onNavigate }) => (
  <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto" aria-label="Main Navigation">
    {navItems.map((item) => {
      const Icon = item.icon;
      const active = isActive(item.path);
      return (
        <Link
          key={item.path}
          to={item.path}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className={`relative flex items-center gap-3 px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all duration-200 select-none ${
            active
              ? 'text-white'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]'
          }`}
        >
          {active && (
            <motion.span
              layoutId="active-nav-pill"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              className="absolute inset-0 rounded-2xl bg-gradient-to-r from-[var(--color-accent)] to-[#528976] shadow-[0_4px_20px_-4px_rgba(104,166,145,0.4)]"
            />
          )}
          <Icon size={18} className="relative z-10 flex-shrink-0" strokeWidth={active ? 2.4 : 2} />
          <span className="relative z-10 flex-1 truncate">{item.label}</span>
          {item.badge > 0 && (
            <span className="relative z-10 bg-[var(--color-danger)] text-white text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 shadow-sm">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </Link>
      );
    })}
  </nav>
);

const UserCard = ({ user, ringInfo, connected, theme, onToggleTheme, onLogout }) => (
  <div className="p-3.5 border-t border-[var(--color-border)] bg-[var(--color-bg-matte)]/50 rounded-b-3xl">
    <div className="flex items-center gap-3 px-1 mb-3">
      <Avatar
        src={user?.avatarUrl}
        name={user?.displayName}
        className="w-10 h-10 rounded-full ring-2 ring-[var(--color-border)] shadow-sm"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-[var(--color-text-primary)] truncate">{user?.displayName}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${ringInfo.color}`}>
            {ringInfo.label}
          </span>
          {user?.globalRing !== 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-warning)] font-bold">
              <Coins size={12} /> {user?.creditBalance ?? 0}
            </span>
          )}
        </div>
      </div>
      <span
        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
          connected ? 'text-[var(--color-success)] bg-[var(--color-success)]/10' : 'text-[var(--color-warning)] bg-[var(--color-warning)]/10'
        }`}
        title={connected ? 'Connected to live campus network' : 'Reconnecting...'}
      >
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-[var(--color-success)] animate-pulse' : 'bg-[var(--color-warning)]'}`} />
        {connected ? 'Live' : 'Off'}
      </span>
    </div>
    <div className="flex gap-2">
      <ThemeToggle
        theme={theme}
        onToggle={onToggleTheme}
        variant="pill"
        size="sm"
        showLabel
        className="flex-1 py-1.5"
      />
      <button onClick={onLogout} className="btn btn-secondary flex-1 text-xs py-2 text-[var(--color-danger)]" title="Log out" type="button">
        <LogOut size={14} /> Logout
      </button>
    </div>
  </div>
);

export default function Layout({ children }) {
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const { connected, onEvent } = useSocket();
  const [totalUnread, setTotalUnread] = useState({ groups: 0, dms: 0, friends: 0 });
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const fetchTimeoutRef = useRef(null);
  const notifRef = useRef(null);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const fetchUnread = useCallback(async () => {
    if (!user) return;
    try {
      const [groupRes, dmRes, notifRes] = await Promise.all([
        groupApi.listGroups().catch(() => ({ data: { data: [] } })),
        dmApi.listConversations().catch(() => ({ data: { data: [] } })),
        notificationsApi.list(40).catch(() => ({ data: { data: { notifications: [], totalUnread: 0 } } })),
      ]);
      const groups = groupRes.data?.data || [];
      const dms = dmRes.data?.data || [];
      const notifList = notifRes.data?.data?.notifications || [];
      const totalUnreadCount = notifRes.data?.data?.totalUnread || notifList.filter(n => !n.isRead).length;

      setNotifications(notifList);
      setUnreadNotifCount(totalUnreadCount);

      const friendUnread = notifList.filter(
        (n) => (n.type === 'friend_request' || n.type === 'friend_accept') && !n.isRead
      ).length;

      setTotalUnread({
        groups: groups.reduce((s, g) => s + (g.unreadCount || 0), 0),
        dms: dms.reduce((s, c) => s + (c.unreadCount || 0), 0),
        friends: friendUnread,
      });
    } catch { /* ignore unread refresh errors */ }
  }, [user]);

  const debouncedFetchUnread = useCallback(() => {
    clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(fetchUnread, 300);
  }, [fetchUnread]);

  useEffect(() => {
    if (!user) return;
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => {
      clearInterval(interval);
      clearTimeout(fetchTimeoutRef.current);
    };
  }, [user, fetchUnread]);

  useEffect(() => {
    debouncedFetchUnread();
  }, [location.pathname, debouncedFetchUnread]);

  useEffect(() => {
    if (!connected || !onEvent) return;
    const cleanups = [
      onEvent('message:new', debouncedFetchUnread),
      onEvent('message:delete', debouncedFetchUnread),
      onEvent('dm:new', debouncedFetchUnread),
      onEvent('dm:readUpdate', debouncedFetchUnread),
      onEvent('notification:new', debouncedFetchUnread),
    ];
    return () => cleanups.forEach((fn) => fn?.());
  }, [connected, onEvent, debouncedFetchUnread]);

  useEffect(() => {
    if (!user) return;
    const m = location.pathname.match(/^\/messages\/([^/]+)$/);
    if (m) notificationsApi.markReadByFilter({ type: 'dm', actorId: m[1] }).catch(() => {});
  }, [location.pathname, user]);

  useEffect(() => {
    if (!user) return;
    if (location.pathname === '/friends') {
      notificationsApi.markReadByFilter({ type: 'friend_request' }).catch(() => {});
      notificationsApi.markReadByFilter({ type: 'friend_accept' }).catch(() => {});
    }
  }, [location.pathname, user]);

  useEffect(() => {
    setDrawerOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Click outside to close notification dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadNotifCount(0);
    } catch { /* ignore */ }
  };

  const handleMarkNotificationRead = async (id) => {
    try {
      await notificationsApi.markRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? ({ ...n, isRead: true }) : n));
      setUnreadNotifCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const ringInfo = RING_LABELS[user?.globalRing] || RING_LABELS[3];

  const navItems = [
    { path: '/profile', label: 'Profile', icon: User },
    { path: '/groups', label: 'Groups', icon: MessagesSquare, badge: totalUnread.groups },
    { path: '/friends', label: 'Friends', icon: Users, badge: totalUnread.friends },
    { path: '/messages', label: 'Messages', icon: Send, badge: totalUnread.dms },
    { path: '/resources', label: 'Resources', icon: BookOpen },
    { path: '/events', label: 'Events', icon: CalendarDays },
    { path: '/manage-events', label: 'Manage Events', icon: ClipboardList },
    { path: '/store', label: 'Store', icon: Store },
    ...(isAdmin ? [{ path: '/admin', label: 'Admin', icon: ShieldCheck }] : []),
  ];

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className="min-h-screen flex bg-[var(--color-bg-primary)]">
      <LiquidGlassFilter />
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[268px] glass-panel flex-col fixed inset-y-0 left-0 z-30 border-r border-[var(--color-border)] shadow-sm">
        <Logo />
        <NavList navItems={navItems} isActive={isActive} onNavigate={closeDrawer} />
        <UserCard
          user={user}
          ringInfo={ringInfo}
          connected={connected}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
        />
      </aside>

      {/* Top action bar (for Notification Bell & Mobile Menu) */}
      <header className="fixed top-0 inset-x-0 lg:left-[268px] z-40 flex items-center justify-between px-4 sm:px-8 py-3.5 glass-panel border-b border-[var(--color-border)]">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="hidden lg:flex items-center gap-2 text-xs font-semibold text-[var(--color-text-muted)]">
          <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
          <span>Comflex Workspace</span>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {/* Notification Bell Dropdown */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative p-2.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)] hover:border-[var(--color-accent)] transition-colors shadow-sm"
              aria-label="Notifications"
            >
              <Bell size={18} />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-[var(--color-danger)] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-sm animate-scale-in">
                  {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                </span>
              )}
            </button>

            <AnimatePresence>
              {notifOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                  className="absolute right-0 mt-2 w-80 sm:w-96 glass-card p-4 shadow-2xl border border-[var(--color-border)] z-50 rounded-3xl"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold font-display text-sm text-[var(--color-text-primary)]">Notifications</h3>
                      {unreadNotifCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                          {unreadNotifCount} new
                        </span>
                      )}
                    </div>
                    {unreadNotifCount > 0 && (
                      <button
                        onClick={handleMarkAllRead}
                        className="text-xs font-semibold text-[var(--color-accent)] hover:underline flex items-center gap-1"
                      >
                        <Check size={12} /> Mark all read
                      </button>
                    )}
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-[var(--color-border)]/50 mt-1">
                    {notifications.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[var(--color-text-muted)]">
                        No notifications right now
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`py-3 px-2 flex items-start gap-3 transition-colors rounded-xl ${
                            !n.isRead ? 'bg-[var(--color-bg-secondary)]' : 'opacity-75'
                          }`}
                        >
                          <div className="w-8 h-8 rounded-xl bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Bell size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-[var(--color-text-primary)] leading-tight">
                              {n.title || n.message || 'Notification'}
                            </p>
                            {n.body && <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5 line-clamp-2">{n.body}</p>}
                            <span className="text-[10px] text-[var(--color-text-muted)] mt-1 block">
                              {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {!n.isRead && (
                            <button
                              onClick={() => handleMarkNotificationRead(n.id)}
                              className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)] p-1"
                              title="Mark read"
                            >
                              <Check size={14} />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden p-2.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-sm"
            aria-label="Open menu"
            type="button"
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
            />
            <motion.aside
              className="lg:hidden fixed inset-y-0 left-0 z-50 w-[280px] glass-panel flex flex-col border-r border-[var(--color-border)]"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', stiffness: 350, damping: 32 }}
            >
              <div className="flex items-center justify-between pr-3">
                <Logo />
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-2 rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  aria-label="Close menu"
                >
                  <X size={20} />
                </button>
              </div>
              <NavList navItems={navItems} isActive={isActive} onNavigate={closeDrawer} />
              <UserCard
                user={user}
                ringInfo={ringInfo}
                connected={connected}
                theme={theme}
                onToggleTheme={toggleTheme}
                onLogout={handleLogout}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main page content container */}
      <main className="flex-1 lg:ml-[268px] min-h-screen overflow-x-hidden pt-16">
        <ErrorBoundary>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="px-4 sm:px-6 lg:px-10 py-6 max-w-7xl mx-auto"
          >
            {children}
          </motion.div>
        </ErrorBoundary>
      </main>
    </div>
  );
}

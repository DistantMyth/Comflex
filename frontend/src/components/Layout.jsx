/**
 * Layout — Main app shell.
 * Desktop: animated glass sidebar with lucide icons + sliding active pill.
 * Mobile: top bar + slide-over drawer with Escape key support and focus management.
 * Shows unread badges on Groups/Messages/Friends nav, live from socket events.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, MessagesSquare, Users, Send, BookOpen, CalendarDays, Store,
  ClipboardList, ShieldCheck, LogOut, Sun, Moon, Menu, X, Coins, Zap,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import { useTheme } from '../context/ThemeContext';
import { groupApi } from '../api/groupApi';
import { dmApi } from '../api/dmApi';
import Avatar from './Avatar';
import { notificationsApi } from '../api/notificationsApi';
import ErrorBoundary from './ErrorBoundary';

const RING_LABELS = {
  0: { label: 'Admin', color: 'ring-badge-0' },
  1: { label: 'Manager', color: 'ring-badge-1' },
  2: { label: 'Elevated', color: 'ring-badge-2' },
  3: { label: 'Member', color: 'ring-badge-3' },
};

const Logo = () => (
  <Link to="/" className="flex items-center gap-2.5 px-4 py-5" aria-label="Comflex Home">
    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--color-accent-light)] via-[var(--color-accent)] to-[#2563eb] flex items-center justify-center text-white shadow-[0_6px_20px_-4px_rgba(124,58,237,0.6)]">
      <Zap size={18} strokeWidth={2.5} className="animate-pulse-glow" />
    </div>
    <div>
      <h1 className="text-xl font-bold font-display gradient-text leading-none">Comflex</h1>
      <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">College Community Platform</p>
    </div>
  </Link>
);

const NavList = ({ navItems, isActive, onNavigate }) => (
  <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto" aria-label="Main Navigation">
    {navItems.map((item) => {
      const Icon = item.icon;
      const active = isActive(item.path);
      return (
        <Link
          key={item.path}
          to={item.path}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className={`relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors duration-200 ${
            active ? 'text-white' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]'
          }`}
        >
          {active && (
            <motion.span
              layoutId="active-nav-pill"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 rounded-xl bg-gradient-to-r from-[var(--color-accent)] to-[#2563eb] shadow-[0_8px_24px_-6px_rgba(124,58,237,0.5)]"
            />
          )}
          <Icon size={18} className="relative z-10 flex-shrink-0" strokeWidth={active ? 2.4 : 2} />
          <span className="relative z-10 flex-1 truncate">{item.label}</span>
          {item.badge > 0 && (
            <span className="relative z-10 bg-[var(--color-danger)] text-white text-[11px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 animate-scale-in">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </Link>
      );
    })}
  </nav>
);

const UserCard = ({ user, ringInfo, connected, theme, onToggleTheme, onLogout }) => (
  <div className="p-3 border-t border-[var(--color-border)]">
    <div className="flex items-center gap-3 px-1 mb-3">
      <Avatar
        src={user?.avatarUrl}
        name={user?.displayName}
        className="w-10 h-10 rounded-full object-cover avatar-glow ring-2 ring-[var(--color-border)]"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{user?.displayName}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] text-white ${ringInfo.color}`}>
            {ringInfo.label}
          </span>
          {user?.globalRing !== 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-warning)] font-semibold">
              <Coins size={12} /> {user?.creditBalance ?? 0}
            </span>
          )}
        </div>
      </div>
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
        connected ? 'text-[var(--color-success)] bg-[var(--color-success)]/10' : 'text-[var(--color-warning)] bg-[var(--color-warning)]/10'
      }`} title={connected ? 'Live' : 'Connecting'}>
        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${connected ? 'bg-[var(--color-success)] animate-pulse' : 'bg-[var(--color-warning)]'}`} />
        {connected ? 'Live' : 'Off'}
      </span>
    </div>
    <div className="flex gap-2">
      <button onClick={onToggleTheme} className="btn btn-secondary flex-1 text-xs py-2" title="Toggle theme" type="button">
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const fetchTimeoutRef = useRef(null);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Debounced fetch to avoid rapid re-fetching
  const fetchUnread = useCallback(async () => {
    if (!user) return;
    try {
      const [groupRes, dmRes, notifRes] = await Promise.all([
        groupApi.listGroups().catch(() => ({ data: { data: [] } })),
        dmApi.listConversations().catch(() => ({ data: { data: [] } })),
        notificationsApi.list(100).catch(() => ({ data: { data: { notifications: [] } } })),
      ]);
      const groups = groupRes.data?.data || [];
      const dms = dmRes.data?.data || [];
      const notifications = notifRes.data?.data?.notifications || [];
      const friendUnread = notifications.filter(
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

  // Opening a DM conversation clears that sender's bell notifications
  useEffect(() => {
    if (!user) return;
    const m = location.pathname.match(/^\/messages\/([^/]+)$/);
    if (m) notificationsApi.markReadByFilter({ type: 'dm', actorId: m[1] }).catch(() => {});
  }, [location.pathname, user]);

  // Visiting the Friends page clears friendship notifications
  useEffect(() => {
    if (!user) return;
    if (location.pathname === '/friends') {
      notificationsApi.markReadByFilter({ type: 'friend_request' }).catch(() => {});
      notificationsApi.markReadByFilter({ type: 'friend_accept' }).catch(() => {});
    }
  }, [location.pathname, user]);

  // Auto-close mobile drawer on route change & reset scroll position
  useEffect(() => {
    setDrawerOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Handle Escape key to close mobile drawer & body scroll lock
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && drawerOpen) {
        setDrawerOpen(false);
      }
    };
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [drawerOpen]);

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
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[264px] glass-panel flex-col fixed inset-y-0 left-0 z-30">
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

      {/* Mobile top bar */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 flex items-center justify-between px-4 py-3 glass-panel border-b border-[var(--color-border)]">
        <Logo />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)]"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-controls="mobile-drawer"
            type="button"
          >
            <Menu size={20} />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              id="mobile-drawer"
              className="lg:hidden fixed inset-y-0 left-0 z-50 w-[280px] glass-panel flex flex-col"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation Menu"
            >
              <div className="flex items-center justify-between pr-3">
                <Logo />
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-2 rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  aria-label="Close menu"
                  type="button"
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

      {/* Main content — animate only this area on route change */}
      <main className="flex-1 lg:ml-[264px] min-h-screen overflow-x-hidden">
        <ErrorBoundary>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="px-4 sm:px-6 lg:px-10 pt-20 lg:pt-8 pb-16 max-w-7xl mx-auto"
          >
            {children}
          </motion.div>
        </ErrorBoundary>
      </main>
    </div>
  );
}

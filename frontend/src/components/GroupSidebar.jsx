/**
 * GroupSidebar — High-fidelity member directory, pinned messages, and invite hub.
 *
 * Implements:
 * 1. Channel member list with real-time online status indicators, ring rank badges,
 *    and click-to-view user profile.
 * 2. Moderation controls (Mute duration selector, Kick confirmation) based on RBAC permissions.
 * 3. Pinned messages section with live socket syncing (`message:pinnedUpdate`, `message:unpinned`),
 *    jump-to-message dispatch, and unpin actions.
 * 4. Shareable invite link generator and debounced user discovery search.
 * 5. Matte + glassy design system (#efc7c2, #ffe5d4, #bfd3c1, #68a691, #694f5d) with
 *    tactile Framer Motion animations.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Pin,
  PinOff,
  Search,
  UserPlus,
  Link2,
  Copy,
  Check,
  ExternalLink,
  VolumeX,
  Volume2,
  UserX,
  Crown,
  Settings,
  Clock,
  Loader2,
  X,
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  Sparkles,
  ArrowRight,
  ChevronDown
} from 'lucide-react';
import { groupApi } from '../api/groupApi';
import { useSocket } from '../hooks/useSocket';
import Avatar from './Avatar';
import { cn } from '../utils/cn';

const DEFAULT_RING_LABELS = ['Admin', 'Manager', 'Elevated', 'Member', 'Restricted'];

const getRingBadgeClass = (ring) => {
  if (ring === 0) return 'ring-badge-0';
  if (ring === 1) return 'ring-badge-1';
  if (ring === 2) return 'ring-badge-2';
  return 'ring-badge-3';
};

export default function GroupSidebar({
  groupId,
  group,
  userPermissions = {},
  currentUserId,
  isAdmin = false,
  onUserClick,
  onJumpToMessage,
  onOpenSettings,
  onlineUsers,
  className
}) {
  const { onEvent } = useSocket() || {};

  const [activeTab, setActiveTab] = useState('members'); // 'members' | 'pins'
  const [members, setMembers] = useState([]);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingPins, setLoadingPins] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  // Modals & Action overlays
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [mutingMember, setMutingMember] = useState(null);
  const [muteDuration, setMuteDuration] = useState(60);
  const [confirmKickMember, setConfirmKickMember] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Invite states
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [inviteStatus, setInviteStatus] = useState({});
  const [inviteToken, setInviteToken] = useState(group?.inviteToken || null);
  const [fetchingLink, setFetchingLink] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const inviteSearchTimeout = useRef(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 2800);
  };

  // Ring configuration mapping
  const ringConfig = useMemo(() => group?.ringConfig || {}, [group?.ringConfig]);
  const ringLabels = useMemo(() => ringConfig.ringLabels || {}, [ringConfig]);
  const getRingLabel = useCallback(
    (ring) => ringLabels[ring] || DEFAULT_RING_LABELS[ring] || `Ring ${ring}`,
    [ringLabels]
  );

  // Fetch members
  const fetchMembers = useCallback(async () => {
    if (!groupId) return;
    setLoadingMembers(true);
    try {
      const res = await groupApi.listMembers(groupId);
      setMembers(res.data?.data || []);
    } catch {
      // Graceful fallback
    } finally {
      setLoadingMembers(false);
    }
  }, [groupId]);

  // Fetch pinned messages
  const fetchPinnedMessages = useCallback(async () => {
    if (!groupId) return;
    setLoadingPins(true);
    try {
      const res = await groupApi.getPinnedMessages(groupId);
      setPinnedMessages(res.data?.data || []);
    } catch {
      // Graceful fallback
    } finally {
      setLoadingPins(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchMembers();
    fetchPinnedMessages();
  }, [fetchMembers, fetchPinnedMessages]);

  // Real-time socket subscriptions for pinned messages and member updates
  useEffect(() => {
    if (!onEvent || !groupId) return;

    // Pinned update event
    const unsubPinned = onEvent('message:pinnedUpdate', ({ pinnedMsg, unpinnedIds }) => {
      setPinnedMessages((prev) => {
        let updated = prev.filter((p) => !unpinnedIds?.includes(p.id));
        if (pinnedMsg && !updated.some((p) => p.id === pinnedMsg.id)) {
          updated = [pinnedMsg, ...updated];
        }
        return updated;
      });
    });

    // Unpinned event
    const unsubUnpinned = onEvent('message:unpinned', ({ messageId }) => {
      setPinnedMessages((prev) => prev.filter((p) => p.id !== messageId));
    });

    // Member kicked or left
    const unsubMemberRemoved = onEvent('member:removed', ({ userId }) => {
      setMembers((prev) => prev.filter((m) => m.id !== userId));
    });

    // Member ring changed
    const unsubRingChanged = onEvent('member:ring_changed', ({ userId, newRing }) => {
      setMembers((prev) =>
        prev.map((m) => (m.id === userId ? { ...m, groupRing: newRing } : m))
      );
    });

    return () => {
      unsubPinned?.();
      unsubUnpinned?.();
      unsubMemberRemoved?.();
      unsubRingChanged?.();
    };
  }, [onEvent, groupId]);

  // Sorted and filtered members
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    const list = q
      ? members.filter(
          (m) =>
            m.displayName?.toLowerCase().includes(q) ||
            m.username?.toLowerCase().includes(q) ||
            m.email?.toLowerCase().includes(q)
        )
      : members;

    // Sort by Ring (Ring 0 Admins first, then 1, 2, 3...)
    return [...list].sort((a, b) => {
      if (a.isCreator && !b.isCreator) return -1;
      if (!a.isCreator && b.isCreator) return 1;
      return (a.groupRing ?? 3) - (b.groupRing ?? 3);
    });
  }, [members, memberSearch]);

  // Member Moderation: Mute
  const handleExecuteMute = async () => {
    if (!mutingMember) return;
    setActionLoading(true);
    try {
      await groupApi.muteMember(groupId, mutingMember.id, muteDuration);
      showToast(`${mutingMember.displayName} muted for ${muteDuration}m`);
      setMutingMember(null);
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to mute member', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Member Moderation: Kick
  const handleExecuteKick = async () => {
    if (!confirmKickMember) return;
    setActionLoading(true);
    try {
      await groupApi.removeMember(groupId, confirmKickMember.id);
      setMembers((prev) => prev.filter((m) => m.id !== confirmKickMember.id));
      showToast(`${confirmKickMember.displayName} removed from group`);
      setConfirmKickMember(null);
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to remove member', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Jump to Pinned Message
  const handleJump = (msgId) => {
    if (onJumpToMessage) {
      onJumpToMessage(msgId);
    } else {
      window.dispatchEvent(new CustomEvent('comflex:jumpToMessage', { detail: { messageId: msgId } }));
    }
  };

  // Unpin Message
  const handleUnpin = async (msgId, e) => {
    e?.stopPropagation();
    try {
      await groupApi.unpinMessage(groupId, msgId);
      setPinnedMessages((prev) => prev.filter((p) => p.id !== msgId));
      showToast('Message unpinned');
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to unpin message', 'error');
    }
  };

  // Invite Search with debounce
  const handleInviteSearch = (q) => {
    setInviteQuery(q);
    clearTimeout(inviteSearchTimeout.current);
    if (q.trim().length < 2) {
      setInviteResults([]);
      return;
    }
    inviteSearchTimeout.current = setTimeout(async () => {
      setInviteSearching(true);
      try {
        const res = await groupApi.searchUsersForGroup(groupId, q.trim());
        setInviteResults(res.data?.data || []);
      } catch {
        setInviteResults([]);
      } finally {
        setInviteSearching(false);
      }
    }, 350);
  };

  // Direct Invite User
  const handleInviteUser = async (userId) => {
    try {
      const res = await groupApi.addMember(groupId, userId);
      const data = res.data?.data;
      if (data?.invited) {
        setInviteStatus((prev) => ({ ...prev, [userId]: 'invited' }));
        showToast('Invite sent');
      } else {
        setInviteStatus((prev) => ({ ...prev, [userId]: 'added' }));
        showToast('Member added');
        fetchMembers();
      }
    } catch (err) {
      setInviteStatus((prev) => ({ ...prev, [userId]: 'error' }));
      showToast(err.response?.data?.error?.message || 'Failed to invite', 'error');
    }
  };

  // Copy or Generate Invite Link
  const handleCopyLink = async () => {
    let token = inviteToken;
    if (!token) {
      setFetchingLink(true);
      try {
        const res = await groupApi.getInviteLink(groupId);
        token = res.data?.data?.token;
        setInviteToken(token);
      } catch (err) {
        showToast(err.response?.data?.error?.message || 'Failed to generate link', 'error');
        setFetchingLink(false);
        return;
      }
      setFetchingLink(false);
    }

    if (!token) return;
    const url = `${window.location.origin}/join/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      showToast('Invite link copied to clipboard!');
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      showToast('Could not copy link', 'error');
    }
  };

  const canAddMembers = isAdmin || userPermissions.can_add_members;
  const canPinMessages = isAdmin || userPermissions.can_pin_messages;
  const canMute = isAdmin || userPermissions.can_mute_members;
  const canKick = isAdmin || userPermissions.can_kick_members;

  return (
    <aside
      className={cn(
        'w-full h-full flex flex-col bg-[var(--color-bg-glass)] backdrop-blur-md border-l border-[var(--color-border)] select-none overflow-hidden relative',
        className
      )}
    >
      {/* Top Header with Segmented Navigation & Shortcuts */}
      <div className="p-3 border-b border-[var(--color-border)] bg-[var(--color-bg-matte)]/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          {/* Segmented Control */}
          <div className="flex items-center gap-1 bg-[var(--color-bg-secondary)] p-1 rounded-xl border border-[var(--color-border)]">
            <button
              onClick={() => setActiveTab('members')}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer select-none',
                activeTab === 'members'
                  ? 'text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              )}
            >
              {activeTab === 'members' && (
                <motion.div
                  layoutId="sidebar-tab-pill"
                  className="absolute inset-0 rounded-lg bg-[var(--color-bg-matte)] shadow-sm border border-[var(--color-border)]"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <Users size={13} className="relative z-10" />
              <span className="relative z-10">Members</span>
              <span className="relative z-10 text-[10px] font-mono opacity-80">
                ({members.length})
              </span>
            </button>

            <button
              onClick={() => setActiveTab('pins')}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer select-none',
                activeTab === 'pins'
                  ? 'text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              )}
            >
              {activeTab === 'pins' && (
                <motion.div
                  layoutId="sidebar-tab-pill"
                  className="absolute inset-0 rounded-lg bg-[var(--color-bg-matte)] shadow-sm border border-[var(--color-border)]"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <Pin size={13} className="relative z-10" />
              <span className="relative z-10">Pins</span>
              {pinnedMessages.length > 0 && (
                <span className="relative z-10 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--color-accent)] text-white font-bold">
                  {pinnedMessages.length}
                </span>
              )}
            </button>
          </div>

          {/* Quick Actions (Invite + Settings) */}
          <div className="flex items-center gap-1">
            {canAddMembers && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
                title="Invite to Group"
              >
                <UserPlus size={15} />
              </button>
            )}

            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
                title="Group Settings"
              >
                <Settings size={15} />
              </button>
            )}
          </div>
        </div>

        {/* Member Search Bar (only on members tab) */}
        {activeTab === 'members' && (
          <div className="relative mt-2">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <input
              type="text"
              placeholder="Search members..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="matte-input pl-8 pr-7 py-1.5 text-xs w-full font-medium"
            />
            {memberSearch && (
              <button
                onClick={() => setMemberSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Toast Alert */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={cn(
              'mx-3 mt-2 px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm border flex-shrink-0',
              toast.type === 'error'
                ? 'bg-[var(--color-danger)]/15 border-[var(--color-danger)]/30 text-[var(--color-danger)]'
                : 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/30 text-[var(--color-accent)]'
            )}
          >
            {toast.type === 'error' ? <AlertTriangle size={13} /> : <Check size={13} />}
            <span className="flex-1 truncate">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-none">
        <AnimatePresence mode="wait">
          {/* ── TAB 1: MEMBERS LIST ── */}
          {activeTab === 'members' && (
            <motion.div
              key="tab-members"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-1"
            >
              {loadingMembers ? (
                <div className="space-y-2 p-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-11 rounded-xl bg-[var(--color-bg-secondary)] animate-pulse" />
                  ))}
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="text-center py-8 text-xs text-[var(--color-text-muted)]">
                  {memberSearch ? 'No members match search.' : 'No members found.'}
                </div>
              ) : (
                filteredMembers.map((m) => {
                  const isSelf = m.id === currentUserId;
                  const isOnline = onlineUsers ? onlineUsers.has?.(m.id) || onlineUsers.includes?.(m.id) : isSelf;

                  return (
                    <div
                      key={m.id}
                      onClick={() => onUserClick?.(m.id)}
                      className="group flex items-center justify-between p-2 rounded-xl hover:bg-[var(--color-bg-secondary)] transition-all cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Avatar with Online Status Indicator */}
                        <div className="relative flex-shrink-0">
                          <Avatar
                            src={m.avatarUrl}
                            name={m.displayName}
                            className="w-8 h-8 rounded-full text-xs"
                          />
                          {/* Online status indicator dot */}
                          <span
                            className={cn(
                              'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--color-bg-primary)]',
                              isOnline
                                ? 'bg-[var(--color-success)] ring-1 ring-[var(--color-success)]/40 shadow-xs'
                                : 'bg-[var(--color-text-muted)]/50'
                            )}
                            title={isOnline ? 'Online' : 'Offline'}
                          />
                        </div>

                        {/* Name, Username & Badges */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-bold text-[var(--color-text-primary)] truncate hover:underline">
                              {m.displayName}
                            </p>
                            {m.isCreator && (
                              <span title="Group Creator">
                                <Crown size={11} className="text-[var(--color-warning)] flex-shrink-0" />
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span
                              className={cn(
                                'text-[9px] font-bold px-1.5 py-0.2 rounded-full leading-tight',
                                getRingBadgeClass(m.groupRing)
                              )}
                            >
                              {getRingLabel(m.groupRing)}
                            </span>
                            {m.username && (
                              <span className="text-[10px] text-[var(--color-text-muted)] truncate">
                                @{m.username}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Moderation Controls on Hover */}
                      {!isSelf && !m.isCreator && (
                        <div
                          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {canMute && (
                            <button
                              onClick={() => setMutingMember(m)}
                              className="p-1 rounded-lg hover:bg-[var(--color-bg-matte)] text-[var(--color-text-muted)] hover:text-[var(--color-warning)] cursor-pointer"
                              title="Mute Member"
                            >
                              <VolumeX size={13} />
                            </button>
                          )}
                          {canKick && (
                            <button
                              onClick={() => setConfirmKickMember(m)}
                              className="p-1 rounded-lg hover:bg-[var(--color-bg-matte)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] cursor-pointer"
                              title="Kick Member"
                            >
                              <UserX size={13} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </motion.div>
          )}

          {/* ── TAB 2: PINNED MESSAGES ── */}
          {activeTab === 'pins' && (
            <motion.div
              key="tab-pins"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-2 p-1"
            >
              {loadingPins ? (
                <div className="space-y-2 p-1">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 rounded-xl bg-[var(--color-bg-secondary)] animate-pulse" />
                  ))}
                </div>
              ) : pinnedMessages.length === 0 ? (
                <div className="text-center py-10 px-4 space-y-2">
                  <div className="w-10 h-10 rounded-2xl bg-[var(--color-bg-secondary)] flex items-center justify-center mx-auto text-[var(--color-text-muted)]">
                    <Pin size={18} />
                  </div>
                  <p className="text-xs font-bold text-[var(--color-text-primary)]">
                    No Pinned Messages
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
                    Important messages or announcements pinned in chat will appear here for easy reference.
                  </p>
                </div>
              ) : (
                pinnedMessages.map((pin) => {
                  const author = pin.user || {};
                  const hasMedia = Array.isArray(pin.attachments) && pin.attachments.length > 0;
                  const dateStr = pin.createdAt
                    ? new Date(pin.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })
                    : '';

                  return (
                    <div
                      key={pin.id}
                      onClick={() => handleJump(pin.id)}
                      className="group p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-matte)] hover:border-[var(--color-accent)]/50 transition-all cursor-pointer shadow-xs space-y-2"
                    >
                      {/* Author & Timestamp */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar
                            src={author.avatarUrl}
                            name={author.displayName}
                            className="w-6 h-6 rounded-full text-[10px]"
                          />
                          <span className="text-xs font-bold text-[var(--color-text-primary)] truncate">
                            {author.displayName || 'Member'}
                          </span>
                        </div>
                        <span className="text-[10px] text-[var(--color-text-muted)] font-medium flex-shrink-0">
                          {dateStr}
                        </span>
                      </div>

                      {/* Content preview */}
                      <p className="text-xs text-[var(--color-text-secondary)] line-clamp-3 leading-relaxed">
                        {pin.content || (hasMedia ? 'Media attachment' : '')}
                      </p>

                      {/* Attachment indicator if present */}
                      {hasMedia && (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-bg-secondary)] text-[10px] font-semibold text-[var(--color-text-muted)]">
                          <ImageIcon size={10} />
                          <span>Attachment</span>
                        </div>
                      )}

                      {/* Bottom actions: Jump + Unpin */}
                      <div className="flex items-center justify-between pt-1 border-t border-[var(--color-border)]/60 text-[11px]">
                        <span className="text-[var(--color-accent)] font-semibold flex items-center gap-1 group-hover:underline">
                          Jump to message <ArrowRight size={11} />
                        </span>

                        {canPinMessages && (
                          <button
                            onClick={(e) => handleUnpin(pin.id, e)}
                            className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
                            title="Unpin message"
                          >
                            <PinOff size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 1: Quick Invite Hub */}
      {/* ───────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showInviteModal && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
            onClick={() => setShowInviteModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="glass-card w-full max-w-md p-5 space-y-4 shadow-2xl border border-[var(--color-border)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                <div className="flex items-center gap-2">
                  <UserPlus size={16} className="text-[var(--color-accent)]" />
                  <h3 className="text-sm font-bold text-[var(--color-text-primary)]">Invite to Group</h3>
                </div>
                <button
                  onClick={() => setShowInviteModal(false)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Shareable Link Card */}
              <div className="space-y-2 p-3 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--color-text-primary)] flex items-center gap-1.5">
                    <Link2 size={13} className="text-[var(--color-accent)]" /> Shareable Invite Link
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">7-day link</span>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    readOnly
                    value={
                      inviteToken
                        ? `${window.location.origin}/join/${inviteToken}`
                        : 'Click copy to generate link'
                    }
                    className="matte-input text-xs font-mono py-1.5 px-2.5 flex-1 select-all"
                  />
                  <button
                    onClick={handleCopyLink}
                    disabled={fetchingLink}
                    className="btn btn-primary text-xs px-3 py-1.5 flex items-center gap-1 flex-shrink-0 cursor-pointer"
                  >
                    {fetchingLink ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : copiedLink ? (
                      <Check size={13} />
                    ) : (
                      <Copy size={13} />
                    )}
                    {copiedLink ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* User Search & Direct Invite */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                  Invite Specific User
                </label>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input
                    type="text"
                    placeholder="Search by name, username, or email..."
                    value={inviteQuery}
                    onChange={(e) => handleInviteSearch(e.target.value)}
                    className="matte-input pl-8 pr-3 py-1.5 text-xs w-full"
                  />
                </div>

                {inviteSearching && (
                  <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 py-1">
                    <Loader2 size={12} className="animate-spin" /> Searching...
                  </p>
                )}

                {inviteResults.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pt-1">
                    {inviteResults.map((u) => {
                      const status = inviteStatus[u.id];
                      return (
                        <div
                          key={u.id}
                          className="flex items-center justify-between p-2 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Avatar src={u.avatarUrl} name={u.displayName} className="w-7 h-7 rounded-full text-[10px]" />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[var(--color-text-primary)] truncate">{u.displayName}</p>
                              <p className="text-[10px] text-[var(--color-text-muted)] truncate">{u.username ? `@${u.username}` : u.email}</p>
                            </div>
                          </div>

                          <div>
                            {u.isMember ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)]">
                                Member
                              </span>
                            ) : u.hasPendingInvite || status === 'invited' ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
                                Invited
                              </span>
                            ) : status === 'added' ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)]">
                                Added ✓
                              </span>
                            ) : (
                              <button
                                onClick={() => handleInviteUser(u.id)}
                                className="btn btn-primary text-xs px-2.5 py-1 cursor-pointer"
                              >
                                Invite
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 2: Mute Member Duration Dialog */}
      {/* ───────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {mutingMember && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
            onClick={() => setMutingMember(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card w-full max-w-sm p-5 space-y-4 shadow-2xl border border-[var(--color-border)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-warning)]">
                <VolumeX size={17} />
                <span>Mute {mutingMember.displayName}</span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                Muted members cannot send messages for the duration.
              </p>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[var(--color-text-primary)]">
                  Mute Duration
                </label>
                <select
                  className="matte-input text-xs font-semibold cursor-pointer w-full"
                  value={muteDuration}
                  onChange={(e) => setMuteDuration(parseInt(e.target.value, 10))}
                >
                  <option value={15}>15 Minutes</option>
                  <option value={60}>1 Hour</option>
                  <option value={360}>6 Hours</option>
                  <option value={1440}>24 Hours</option>
                  <option value={10080}>7 Days</option>
                </select>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleExecuteMute}
                  disabled={actionLoading}
                  className="btn btn-primary flex-1 text-xs py-2 cursor-pointer"
                >
                  {actionLoading ? 'Muting...' : `Confirm Mute (${muteDuration}m)`}
                </button>
                <button
                  onClick={() => setMutingMember(null)}
                  disabled={actionLoading}
                  className="btn btn-secondary text-xs px-3 py-2 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL 3: Kick Member Confirmation */}
      {/* ───────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {confirmKickMember && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
            onClick={() => setConfirmKickMember(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card w-full max-w-sm p-5 space-y-4 shadow-2xl border border-[var(--color-border)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-danger)]">
                <UserX size={17} />
                <span>Remove Member</span>
              </div>
              <p className="text-xs text-[var(--color-text-primary)] leading-relaxed">
                Remove <strong>{confirmKickMember.displayName}</strong> from the group?
              </p>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleExecuteKick}
                  disabled={actionLoading}
                  className="btn btn-danger flex-1 text-xs py-2 cursor-pointer"
                >
                  {actionLoading ? 'Removing...' : 'Remove Member'}
                </button>
                <button
                  onClick={() => setConfirmKickMember(null)}
                  disabled={actionLoading}
                  className="btn btn-secondary text-xs px-3 py-2 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </aside>
  );
}

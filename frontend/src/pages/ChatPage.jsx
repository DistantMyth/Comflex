import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings, Users, Pin, ArrowLeft, Send, Paperclip, X, CornerDownLeft,
  Share2, KeyRound, Loader2, Smile, AlertCircle, ChevronRight, Check, Flag
} from 'lucide-react';
import Avatar from '../components/Avatar';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import { groupApi } from '../api/groupApi';
import { friendApi } from '../api/friendApi';
import { storeApi } from '../api/storeApi';
import { getAnonSessions, setAnonSession, removeAnonSession } from '../api/client';
import MessageBubble from '../components/MessageBubble';
import GroupSidebar from '../components/GroupSidebar';
import UserProfilePanel from '../components/UserProfilePanel';
import GroupSettingsPanel from '../components/GroupSettingsPanel';
import AnonGroupPanel from '../components/AnonGroupPanel';
import resolveAsset from '../utils/resolveAsset';

export default function ChatPage() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    connected, sendMessage: wsSendMessage, startTyping, stopTyping,
    markRead, onEvent, joinAnonGroup
  } = useSocket();

  const [group, setGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [membership, setMembership] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [members, setMembers] = useState([]);
  const [friendIds, setFriendIds] = useState([]);
  const [badgeMap, setBadgeMap] = useState({});

  // @mention state
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [pendingMentions, setPendingMentions] = useState([]);

  // Advanced messaging states
  const [replyingTo, setReplyingTo] = useState(null);
  const [fileAttachment, setFileAttachment] = useState(null);

  // Anonymous group state
  const [isAnon, setIsAnon] = useState(false);
  const [myIdentity, setMyIdentity] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState('');
  const [anonGate, setAnonGate] = useState(null);
  const [restoreKey, setRestoreKey] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  // Modals for forwarding
  const [forwardingMsg, setForwardingMsg] = useState(null);
  const [allGroups, setAllGroups] = useState([]);
  const [forwardSearch, setForwardSearch] = useState('');

  // Pinned Messages state
  const [currentPinnedIndex, setCurrentPinnedIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const chatContainerRef = useRef(null);

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  const isAdmin = user?.globalRing === 0;

  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return members.filter(m => m.id !== user?.id).slice(0, 8);
    const q = mentionQuery.toLowerCase();
    return members
      .filter(m => m.id !== user?.id && (
        m.displayName?.toLowerCase().includes(q) ||
        m.username?.toLowerCase().includes(q)
      ))
      .slice(0, 8);
  }, [members, mentionQuery, user?.id]);

  const pinnedMessages = useMemo(() => {
    return messages
      .filter((m) => m.isPinned && !m.isDeleted)
      .sort((a, b) => {
        const timeA = new Date(a.pinnedAt || a.createdAt).getTime();
        const timeB = new Date(b.pinnedAt || b.createdAt).getTime();
        return timeB - timeA;
      })
      .slice(0, 5);
  }, [messages]);

  useEffect(() => {
    if (pinnedMessages.length > 0 && currentPinnedIndex >= pinnedMessages.length) {
      setCurrentPinnedIndex(0);
    }
  }, [pinnedMessages.length, currentPinnedIndex]);

  const loadOlderMessages = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await groupApi.getMessages(groupId, page + 1, 50);
      const newMsgs = Array.isArray(res?.data?.data?.messages)
        ? res.data.data.messages
        : (Array.isArray(res?.data?.data) ? res.data.data : []);
      if (newMsgs.length < 50) setHasMore(false);
      setMessages(prev => [...[...newMsgs].reverse(), ...prev]);
      setPage(p => p + 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!groupId) return;

    setPage(1);
    setHasMore(true);

    const loadData = async () => {
      setLoading(true);
      try {
        const [groupRes, msgsRes, friendsRes, badgesRes] = await Promise.all([
          groupApi.getGroup(groupId),
          groupApi.getMessages(groupId, 1, 50),
          friendApi.listFriends().catch(() => ({ data: { data: [] } })),
          storeApi.getAllBadges().catch(() => ({ data: { data: [] } })),
        ]);
        const grp = groupRes?.data?.data;
        setGroup(grp);
        const msgList = Array.isArray(msgsRes?.data?.data?.messages)
          ? msgsRes.data.data.messages
          : (Array.isArray(msgsRes?.data?.data) ? msgsRes.data.data : []);
        setMessages([...msgList].reverse());
        if (msgList.length < 50) setHasMore(false);
        setFriendIds((friendsRes?.data?.data || []).map(f => f.id));

        const bMap = {};
        (badgesRes.data?.data || []).forEach(b => bMap[b.id] = b);
        setBadgeMap(bMap);

        const anon = grp?.isAnonymous === true;
        setIsAnon(anon);

        if (anon) {
          const identity = getAnonSessions()[groupId] || null;
          setMyIdentity(identity);
          if (!identity) {
            try {
              const enterRes = await groupApi.anonEnterCheck(groupId);
              const enter = enterRes.data?.data;
              setAnonGate({ joined: !!enter?.joined, group: enter || grp });
            } catch {
              setAnonGate({ joined: true, group: grp });
            }
          } else {
            setAnonGate(null);
          }
          setMembers([]);
          setMembership(null);
          if (connected && joinAnonGroup && identity?.identityId && identity?.secret) {
            joinAnonGroup(groupId, identity.identityId, identity.secret).catch(() => {});
          }
        } else {
          try {
            const membersRes = await groupApi.listMembers(groupId);
            const membersList = membersRes.data?.data || [];
            setMembers(membersList);
            const me = membersList.find((m) => m.id === user?.id);
            if (me) setMembership(me);
          } catch { /* ignore */ }
        }

        try {
          if (connected) {
            markRead(groupId).catch(() => {});
          } else {
            groupApi.markMessagesRead(groupId).catch(() => {});
          }
        } catch { /* ignore */ }
      } catch {
        try {
          const enterRes = await groupApi.anonEnterCheck(groupId);
          const enter = enterRes.data?.data;
          setAnonGate({ joined: !!enter?.joined, group: enter });
          setIsAnon(true);
          setMyIdentity(null);
          setMembers([]);
          setMembership(null);
        } catch { /* ignore */ }
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [groupId, user?.id, connected, markRead, joinAnonGroup]);

  const handleRestoreKey = async () => {
    const key = restoreKey.trim();
    if (!key) return;
    setRestoring(true);
    setRestoreError('');
    try {
      const res = await groupApi.restoreAnonIdentity(groupId, key);
      const idn = res.data?.data;
      setAnonSession(groupId, {
        identityId: idn.identityId,
        secret: idn.secret,
        alias: idn.alias,
        aliasTag: idn.aliasTag,
        avatarUrl: idn.avatarUrl,
      });
      if (joinAnonGroup && idn.identityId && idn.secret) {
        joinAnonGroup(groupId, idn.identityId, idn.secret).catch(() => {});
      }
      setAnonGate(null);
      setRestoreKey('');
      const [groupRes, msgsRes] = await Promise.all([
        groupApi.getGroup(groupId),
        groupApi.getMessages(groupId, 1, 50),
      ]);
      setGroup(groupRes?.data?.data);
      setMyIdentity(getAnonSessions()[groupId]);
      const msgList = Array.isArray(msgsRes?.data?.data?.messages)
        ? msgsRes.data.data.messages
        : (Array.isArray(msgsRes?.data?.data) ? msgsRes.data.data : []);
      setMessages([...msgList].reverse());
    } catch (err) {
      setRestoreError(err.response?.data?.error?.message || 'Invalid recovery key format.');
    } finally {
      setRestoring(false);
    }
  };

  // Real-time socket events
  useEffect(() => {
    if (!connected || !onEvent || !groupId) return;

    const cleanups = [
      onEvent('message:new', (msg) => {
        if (msg.groupId !== groupId) return;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        markRead(groupId).catch(() => {});
      }),
      onEvent('message:edit', (updatedMsg) => {
        if (updatedMsg.groupId !== groupId) return;
        setMessages((prev) => prev.map((m) => (m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m)));
      }),
      onEvent('message:delete', ({ messageId, groupId: gId }) => {
        if (gId !== groupId) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, isDeleted: true, content: '[Message deleted]', fileUrl: null, fileName: null }
              : m
          )
        );
      }),
      onEvent('message:reaction', ({ messageId, reactions }) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
        );
      }),
      onEvent('message:pin', ({ messageId, isPinned, pinnedAt }) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, isPinned, pinnedAt } : m))
        );
      }),
      onEvent('typing:update', ({ users, groupId: gId }) => {
        if (gId === groupId) {
          setTypingUsers(users || []);
        }
      }),
    ];

    return () => cleanups.forEach((fn) => fn?.());
  }, [connected, onEvent, groupId, markRead]);

  // Auto-scroll on new message
  useEffect(() => {
    if (!loadingMore) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, loadingMore]);

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!messageInput.trim() && !fileAttachment) return;
    if (!groupId) return;

    setSending(true);
    try {
      if (fileAttachment) {
        const formData = new FormData();
        formData.append('content', messageInput.trim());
        formData.append('attachment', fileAttachment);
        formData.append('file', fileAttachment);
        if (replyingTo?.id) formData.append('replyToId', replyingTo.id);
        if (pendingMentions.length > 0) {
          formData.append('mentions', JSON.stringify(pendingMentions));
        }
        await groupApi.sendMessage(groupId, formData);
        setFileAttachment(null);
      } else {
        await groupApi.sendMessage(groupId, {
          content: messageInput.trim(),
          replyToId: replyingTo?.id,
          mentions: pendingMentions,
        });
      }
      setMessageInput('');
      setReplyingTo(null);
      setPendingMentions([]);
      setShowMentionPopup(false);
      stopTyping?.(groupId);
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setMessageInput(val);
    startTyping?.(groupId);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => stopTyping?.(groupId), 2000);

    if (!isAnon) {
      const cursor = e.target.selectionStart ?? val.length;
      const textBeforeCursor = val.slice(0, cursor);
      const match = textBeforeCursor.match(/@([a-zA-Z0-9_-]*)$/);
      if (match) {
        setMentionQuery(match[1]);
        setShowMentionPopup(true);
        setMentionIndex(0);
      } else {
        setShowMentionPopup(false);
      }
    }
  };

  const handleSelectMention = (member) => {
    if (!member) return;
    const cursor = inputRef.current?.selectionStart ?? messageInput.length;
    const textBefore = messageInput.slice(0, cursor).replace(/@([a-zA-Z0-9_-]*)$/, `@${member.displayName || member.username} `);
    const textAfter = messageInput.slice(cursor);
    setMessageInput(textBefore + textAfter);
    setPendingMentions((prev) => [...new Set([...prev, member.id])]);
    setShowMentionPopup(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleInputKeyDown = (e) => {
    if (showMentionPopup && mentionSuggestions.length > 0 && !isAnon) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectMention(mentionSuggestions[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionPopup(false);
        return;
      }
    }
  };

  const handleReact = async (messageId, emoji) => {
    try {
      await groupApi.reactToMessage(groupId, messageId, emoji);
    } catch { /* ignore */ }
  };

  const handlePin = async (messageId) => {
    try {
      await groupApi.pinMessage(groupId, messageId);
    } catch { /* ignore */ }
  };

  const handleEdit = async (messageId, content) => {
    try {
      await groupApi.editMessage(groupId, messageId, content);
    } catch { /* ignore */ }
  };

  const handleDelete = async (messageId) => {
    if (!window.confirm('Delete message?')) return;
    try {
      await groupApi.deleteMessage(groupId, messageId);
    } catch { /* ignore */ }
  };

  const handleReport = async () => {
    if (!reportTarget || !reportReason.trim()) return;
    try {
      await groupApi.reportAnonIdentity(groupId, reportTarget.identityId, reportReason.trim());
      alert('Report submitted for moderator review.');
      setReportTarget(null);
      setReportReason('');
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Report failed.');
    }
  };

  const jumpToMessage = (messageId) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('bg-[var(--palette-teal)]/15');
      setTimeout(() => el.classList.remove('bg-[var(--palette-teal)]/15'), 2000);
    }
  };

  const handleForwardSearch = async (val) => {
    setForwardSearch(val);
    if (!allGroups.length) {
      try {
        const res = await groupApi.listGroups();
        const groups = res.data?.data?.groups || res.data?.data || [];
        setAllGroups(groups);
      } catch { /* ignore */ }
    }
  };

  const submitForward = async (targetGroupId) => {
    if (!forwardingMsg) return;
    try {
      await groupApi.sendMessage(targetGroupId, {
        content: forwardingMsg.content,
        forwarded: true,
        msgType: forwardingMsg.msgType || 'text',
        fileUrl: forwardingMsg.fileUrl,
        fileName: forwardingMsg.fileName,
        fileSize: forwardingMsg.fileSize,
      });
      alert('Message forwarded successfully!');
      setForwardingMsg(null);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to forward message.');
    }
  };

  useEffect(() => {
    if (forwardingMsg && allGroups.length === 0) {
      groupApi.listGroups().then((res) => {
        setAllGroups(res.data?.data?.groups || res.data?.data || []);
      }).catch(() => {});
    }
  }, [forwardingMsg, allGroups.length]);

  useEffect(() => {
    const isMobileDrawerActive = showSidebar && typeof window !== 'undefined' && window.innerWidth < 1024;
    const hasActiveOverlay = isMobileDrawerActive || showSettings || selectedUserId || forwardingMsg || reportTarget;

    if (hasActiveOverlay) {
      document.body.style.overflow = 'hidden';
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          setForwardingMsg(null);
          setReportTarget(null);
          setShowSettings(false);
          if (window.innerWidth < 1024) setShowSidebar(false);
          setSelectedUserId(null);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        document.body.style.overflow = '';
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [showSidebar, showSettings, selectedUserId, forwardingMsg, reportTarget]);

  return (
    <div className="flex h-[calc(100dvh-12.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] sm:h-[calc(100dvh-13.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] lg:h-[calc(100vh-9.5rem)] rounded-2xl sm:rounded-3xl border border-[var(--color-border)] glass-card overflow-hidden shadow-xl relative">
      {/* Key Restore Gate for Anonymous Groups */}
      {anonGate && (
        <div className="absolute inset-0 z-40 bg-[var(--color-bg-primary)] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card p-8 rounded-3xl max-w-md w-full text-center border border-[var(--color-border)] shadow-2xl"
          >
            <div className="w-16 h-16 rounded-3xl bg-[var(--palette-rose)]/20 border border-[var(--palette-rose)]/30 flex items-center justify-center mx-auto mb-4 text-[var(--palette-plum)]">
              <KeyRound size={32} />
            </div>
            <h2 className="text-xl font-bold font-display text-[var(--color-text-primary)]">Restore Anonymous Identity</h2>
            <p className="text-xs text-[var(--color-text-secondary)] mt-2 leading-relaxed mb-5">
              Enter your saved <code>identityId.secret</code> key for <strong>{anonGate.group?.displayName || 'this channel'}</strong> to restore your messaging alias.
            </p>

            {restoreError && (
              <div className="p-3 rounded-2xl bg-[var(--color-danger)]/15 text-[var(--color-danger)] text-xs font-semibold mb-4">
                {restoreError}
              </div>
            )}

            <input
              type="password"
              placeholder="Paste identity key..."
              value={restoreKey}
              onChange={(e) => setRestoreKey(e.target.value)}
              className="matte-input text-xs font-mono mb-4 text-center"
              autoFocus
            />

            <div className="flex gap-2">
              <button
                onClick={handleRestoreKey}
                disabled={restoring || !restoreKey.trim()}
                className="btn btn-primary flex-1 py-2.5 text-xs shadow-md"
              >
                {restoring ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                <span>Restore & Enter</span>
              </button>
              <button
                onClick={() => navigate('/groups')}
                className="btn btn-secondary text-xs px-4"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Main Chat Feed */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--color-bg-primary)]/40">
        {/* Chat Top Header */}
        <div className="p-3.5 px-5 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg-card)]/70 backdrop-blur-md z-10">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/groups" className="p-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              <ArrowLeft size={16} />
            </Link>

            {group?.avatarUrl ? (
              <img src={resolveAsset(group.avatarUrl)} alt="" className="w-10 h-10 rounded-2xl object-cover ring-1 ring-[var(--color-border)] shadow-xs flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[var(--palette-teal)] to-[var(--palette-plum)] flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-xs">
                {group?.displayName?.charAt(0) || group?.name?.charAt(0) || '#'}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-xs sm:text-sm text-[var(--color-text-primary)] truncate">{group?.displayName || group?.name || 'Channel'}</h2>
                {isAnon ? (
                  <span className="text-[9px] px-2 py-0.2 rounded-full font-bold bg-[var(--palette-rose)]/20 text-[var(--palette-plum)] border border-[var(--palette-rose)]/30">
                    {myIdentity?.alias ? `🎭 ${myIdentity.alias}` : '🎭 Anonymous'}
                  </span>
                ) : (
                  <span className="text-[9px] text-[var(--color-text-muted)] font-medium">
                    {members.length} members
                  </span>
                )}
              </div>
              <p className="text-[10px] text-[var(--color-text-muted)] truncate mt-0.5">
                {group?.description || (isAnon ? 'Cryptographic zero-knowledge space' : 'Cohort Channel')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] shadow-xs"
              title="Group Settings"
            >
              <Settings size={16} />
            </button>
            {!isAnon && (
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className="p-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] shadow-xs"
                title="Members & Pins"
              >
                <Users size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Pinned Messages Carousel Banner */}
        {pinnedMessages.length > 0 && (
          <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/70 flex items-center justify-between text-xs backdrop-blur-xs">
            <div className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer" onClick={() => jumpToMessage(pinnedMessages[currentPinnedIndex].id)}>
              <Pin size={13} className="text-[var(--color-accent)] flex-shrink-0" />
              <span className="font-bold text-[var(--color-text-primary)]">Pinned:</span>
              <span className="text-[var(--color-text-secondary)] truncate">
                {pinnedMessages[currentPinnedIndex].content || '[Attachment]'}
              </span>
            </div>
            {pinnedMessages.length > 1 && (
              <button
                onClick={() => setCurrentPinnedIndex((prev) => (prev + 1) % pinnedMessages.length)}
                className="text-[10px] text-[var(--color-accent)] font-semibold hover:underline ml-2"
              >
                {currentPinnedIndex + 1}/{pinnedMessages.length}
              </button>
            )}
          </div>
        )}

        {/* Messages Stream View */}
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {hasMore && (
            <div className="text-center py-2">
              <button
                onClick={loadOlderMessages}
                disabled={loadingMore}
                className="text-xs text-[var(--color-accent)] font-semibold hover:underline disabled:opacity-50"
              >
                {loadingMore ? 'Loading earlier messages...' : '↑ Load earlier history'}
              </button>
            </div>
          )}

          {loading && messages.length === 0 && (
            <div className="py-16 text-center flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
              <span>Fetching group messages...</span>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} id={`msg-${msg.id}`} className="transition-colors rounded-2xl">
              <MessageBubble
                message={msg}
                currentUserId={user?.id}
                permissions={membership?.permissions || {}}
                isAdmin={isAdmin}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onPin={handlePin}
                onUserClick={(uid) => setSelectedUserId(uid)}
                members={members}
                badgeMap={badgeMap}
                onReply={(m) => setReplyingTo(m)}
                onForward={(m) => setForwardingMsg(m)}
                anonMode={isAnon}
                myIdentityId={myIdentity?.identityId}
                isAnonCreator={group?.creatorId === user?.id}
                onReport={(identityIdOrObj, alias) => {
                  if (typeof identityIdOrObj === 'object' && identityIdOrObj !== null) {
                    setReportTarget({
                      identityId: identityIdOrObj.identityId || identityIdOrObj.id,
                      alias: identityIdOrObj.alias || identityIdOrObj.displayName || 'Anonymous',
                    });
                  } else {
                    setReportTarget({
                      identityId: identityIdOrObj,
                      alias: alias || 'Anonymous',
                    });
                  }
                }}
                onReact={handleReact}
              />
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Quoted Message / File Attachment Preview Banner */}
        <div className="space-y-1">
          {replyingTo && (
            <div className="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 truncate">
                <CornerDownLeft size={14} className="text-[var(--color-accent)]" />
                <span className="font-bold">Replying to: </span>
                <span className="truncate text-[var(--color-text-secondary)]">{replyingTo.content || '[Attachment]'}</span>
              </div>
              <button onClick={() => setReplyingTo(null)} className="p-1 hover:text-[var(--color-danger)]">
                <X size={14} />
              </button>
            </div>
          )}

          {fileAttachment && (
            <div className="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between text-xs">
              <span className="font-bold truncate text-[var(--palette-teal)]">📎 {fileAttachment.name}</span>
              <button onClick={() => setFileAttachment(null)} className="p-1 hover:text-[var(--color-danger)]">
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSendMessage} className="p-2 sm:p-3 border-t border-[var(--color-border)] bg-[var(--color-bg-card)]/70 flex items-center gap-1.5 sm:gap-2 relative">
          {showMentionPopup && mentionSuggestions.length > 0 && !isAnon && (
            <div className="absolute bottom-full left-2 sm:left-4 mb-2 w-64 max-h-48 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]/95 backdrop-blur-md shadow-xl z-30 p-1 divide-y divide-[var(--color-border)]/50">
              {mentionSuggestions.map((m, idx) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelectMention(m)}
                  onMouseEnter={() => setMentionIndex(idx)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors ${
                    idx === mentionIndex
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]'
                  }`}
                >
                  <Avatar src={m.avatarUrl} name={m.displayName || m.username} size="xs" />
                  <div className="truncate flex-1">
                    <p className="font-semibold truncate leading-tight">{m.displayName}</p>
                    {m.username && (
                      <p className={`text-[10px] truncate ${idx === mentionIndex ? 'text-white/80' : 'text-[var(--color-text-muted)]'}`}>
                        @{m.username}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files?.[0]) {
                setFileAttachment(e.target.files[0]);
              }
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 sm:p-2.5 rounded-2xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors shrink-0"
            title="Attach file or screenshot"
          >
            <Paperclip size={16} />
          </button>

          <input
            ref={inputRef}
            type="text"
            value={messageInput}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder={isAnon ? 'Send anonymous message...' : `Message #${group?.name || 'chat'}...`}
            className="matte-input flex-1 text-xs sm:text-sm py-2 sm:py-2.5"
          />

          <button
            type="submit"
            disabled={sending || (!messageInput.trim() && !fileAttachment)}
            className="btn btn-primary px-3 sm:px-4 py-2 sm:py-2.5 shadow-sm shrink-0"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
      </div>

      {/* Member & Pinned Sidebar (Desktop inline, Mobile overlay drawer) */}
      {!isAnon && showSidebar && (
        <div className="w-72 border-l border-[var(--color-border)] hidden lg:block bg-[var(--color-bg-card)]/40 overflow-hidden">
          <GroupSidebar
            group={group}
            members={members}
            pinnedMessages={pinnedMessages}
            isAdmin={isAdmin}
            onUserClick={(uid) => setSelectedUserId(uid)}
            onJumpToMessage={jumpToMessage}
          />
        </div>
      )}

      {/* Mobile slide-over drawer for members & pins */}
      <AnimatePresence>
        {!isAnon && showSidebar && (
          <div
            className="lg:hidden fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs"
            onClick={() => setShowSidebar(false)}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs sm:max-w-sm h-full bg-[var(--color-bg-primary)] border-l border-[var(--color-border)] shadow-2xl flex flex-col pt-safe pb-safe"
            >
              <div className="p-3.5 border-b border-[var(--color-border)] flex items-center justify-between">
                <h3 className="font-bold font-display text-sm text-[var(--color-text-primary)]">Members & Pins</h3>
                <button
                  onClick={() => setShowSidebar(false)}
                  className="p-1.5 rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <GroupSidebar
                  group={group}
                  members={members}
                  pinnedMessages={pinnedMessages}
                  isAdmin={isAdmin}
                  onUserClick={(uid) => {
                    setSelectedUserId(uid);
                    setShowSidebar(false);
                  }}
                  onJumpToMessage={(mid) => {
                    jumpToMessage(mid);
                    setShowSidebar(false);
                  }}
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Anonymous Group Administration Drawer */}
      <AnimatePresence>
        {showSettings && isAnon && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs"
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg h-full bg-[var(--color-bg-primary)] border-l border-[var(--color-border)] shadow-2xl flex flex-col pt-safe pb-safe"
            >
              <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
                <h3 className="font-bold font-display text-sm text-[var(--color-text-primary)]">Anonymous Administration</h3>
                <button onClick={() => setShowSettings(false)} className="p-1 hover:opacity-75">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <AnonGroupPanel
                  groupId={groupId}
                  myIdentity={myIdentity}
                  isCreator={group?.creatorId === user?.id || isAdmin}
                  onLeft={() => navigate('/groups')}
                  onIdentityUpdated={(newId) => setMyIdentity(newId)}
                  className="w-full border-none p-0 overflow-visible shadow-none"
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Standard Group Settings Modal Dialog */}
      <AnimatePresence>
        {showSettings && !isAnon && (
          <GroupSettingsPanel
            groupId={groupId}
            group={group}
            currentUserId={user?.id}
            isAdmin={isAdmin}
            onClose={() => setShowSettings(false)}
            onGroupUpdated={() => {
              groupApi.getGroup(groupId).then(res => setGroup(res.data?.data));
            }}
            onGroupDeleted={() => navigate('/groups')}
          />
        )}
      </AnimatePresence>

      {/* User Profile Modal / Slide-Over Drawer */}
      <AnimatePresence>
        {selectedUserId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs"
            onClick={() => setSelectedUserId(null)}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="h-full flex flex-col pt-safe pb-safe max-w-full"
            >
              <UserProfilePanel
                userId={selectedUserId}
                currentUserId={user?.id}
                onClose={() => setSelectedUserId(null)}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Message Forwarding Modal */}
      <AnimatePresence>
        {forwardingMsg && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
            onClick={() => setForwardingMsg(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card p-6 rounded-3xl max-w-sm w-full border border-[var(--color-border)] shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)] mb-4">
                <div className="flex items-center gap-2 text-[var(--color-accent)]">
                  <Share2 size={16} />
                  <h3 className="font-bold font-display text-sm text-[var(--color-text-primary)]">Forward Message</h3>
                </div>
                <button onClick={() => setForwardingMsg(null)} className="p-1 hover:opacity-75">
                  <X size={16} />
                </button>
              </div>

              <input
                type="text"
                placeholder="Search group to forward to..."
                value={forwardSearch}
                onChange={(e) => handleForwardSearch(e.target.value)}
                className="matte-input text-xs mb-3"
              />

              <div className="max-h-48 overflow-y-auto space-y-1.5 divide-y divide-[var(--color-border)]/50">
                {allGroups
                  .filter((g) => g.id !== groupId && (!forwardSearch.trim() || (g.displayName || g.name || '').toLowerCase().includes(forwardSearch.toLowerCase())))
                  .map((g) => (
                    <button
                      key={g.id}
                      onClick={() => submitForward(g.id)}
                      className="w-full flex items-center gap-2 p-2 rounded-xl hover:bg-[var(--color-bg-secondary)] text-left"
                    >
                      <Avatar src={g.avatarUrl} name={g.displayName || g.name} className="w-7 h-7 rounded-xl" />
                      <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">{g.displayName || g.name}</span>
                    </button>
                  ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Anonymous Report Modal */}
      <AnimatePresence>
        {reportTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
            onClick={() => setReportTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card p-6 rounded-3xl max-w-sm w-full border border-[var(--color-border)] shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)] mb-4">
                <div className="flex items-center gap-2 text-rose-500">
                  <Flag size={16} />
                  <h3 className="font-bold font-display text-sm text-[var(--color-text-primary)]">Report Post</h3>
                </div>
                <button onClick={() => setReportTarget(null)} className="p-1 hover:opacity-75">
                  <X size={16} />
                </button>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mb-3">
                Report anonymous identity <strong>{reportTarget.alias || reportTarget.identityId}</strong> to group moderators.
              </p>
              <textarea
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                placeholder="Why are you reporting this message?"
                className="matte-input text-xs w-full h-24 mb-4 resize-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReportTarget(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleReport}
                  disabled={!reportReason.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-500 text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                  Submit Report
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

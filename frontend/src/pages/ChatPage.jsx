/**
 * ChatPage — Full chat interface for a single group.
 *
 * Real-time messaging via Socket.IO, message history via REST,
 * typing indicators, pinned messages, member sidebar, read receipts,
 * @mention autocomplete, and group settings panel.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Settings, Users } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import { groupApi } from '../api/groupApi';
import MessageBubble from '../components/MessageBubble';
import GroupSidebar from '../components/GroupSidebar';
import UserProfilePanel from '../components/UserProfilePanel';
import GroupSettingsPanel from '../components/GroupSettingsPanel';

import { friendApi } from '../api/friendApi';
import { storeApi } from '../api/storeApi';
import resolveAsset from '../utils/resolveAsset';

export default function ChatPage() {
  const { id: groupId } = useParams();
  const { user } = useAuth();
  const { connected, sendMessage: wsSendMessage, startTyping, stopTyping, markRead, onEvent } = useSocket();

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
  const [pendingMentions, setPendingMentions] = useState([]); // [{ userId, displayName }]

  // Advanced messaging states
  const [replyingTo, setReplyingTo] = useState(null);
  const [fileAttachment, setFileAttachment] = useState(null);
  
  // Modals for forwarding
  const [forwardingMsg, setForwardingMsg] = useState(null);
  const [allGroups, setAllGroups] = useState([]);
  const [forwardSearch, setForwardSearch] = useState('');
  
  // Pinned Messages state
  const [currentPinnedIndex, setCurrentPinnedIndex] = useState(0);

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  const isAdmin = user?.globalRing === 0;

  // Filtered members for mention autocomplete
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

  // Handle pinned messages (top 5, newest first)
  const pinnedMessages = useMemo(() => {
    return messages
      .filter(m => m.isPinned)
      .sort((a, b) => {
        const timeA = new Date(a.pinnedAt || a.createdAt).getTime();
        const timeB = new Date(b.pinnedAt || b.createdAt).getTime();
        return timeB - timeA; // newest first
      })
      .slice(0, 5);
  }, [messages]);

  useEffect(() => {
    if (pinnedMessages.length > 0 && currentPinnedIndex >= pinnedMessages.length) {
      setCurrentPinnedIndex(0);
    }
  }, [pinnedMessages.length, currentPinnedIndex]);

  // Load group info, messages, and members
  useEffect(() => {
    if (!groupId) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const [groupRes, msgsRes, friendsRes, badgesRes] = await Promise.all([
          groupApi.getGroup(groupId),
          groupApi.getMessages(groupId, 1, 50),
          friendApi.listFriends().catch(() => ({ data: { data: [] } })),
          storeApi.getAllBadges().catch(() => ({ data: { data: [] } })),
        ]);
        setGroup(groupRes.data.data);
        setMessages(msgsRes.data.data.messages.reverse()); // oldest first
        setFriendIds(friendsRes.data.data.map(f => f.id));

        const bMap = {};
        (badgesRes.data?.data || []).forEach(b => bMap[b.id] = b);
        setBadgeMap(bMap);

        // Get members for mention autocomplete
        try {
          const membersRes = await groupApi.listMembers(groupId);
          const membersList = membersRes.data.data || [];
          setMembers(membersList);
          const me = membersList.find((m) => m.id === user?.id);
          if (me) setMembership(me);
        } catch { /* ignore */ }

        // Mark messages as read
        try {
          if (connected) {
            markRead(groupId).catch(() => {});
          } else {
            groupApi.markMessagesRead(groupId).catch(() => {});
          }
        } catch {}
      } catch { /* ignore */ }
      finally { setLoading(false); }
    };

    loadData();
  }, [groupId, user?.id]);

  // Subscribe to real-time events
  useEffect(() => {
    if (!connected || !onEvent) return;

    const cleanups = [
      onEvent('message:new', (msg) => {
        if (msg.groupId === groupId) {
          setMessages((prev) => {
            // Prevent duplicate if sender gets their own message back
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          // Auto-mark as read since we're viewing this group
          markRead(groupId).catch(() => {});
        }
      }),
      onEvent('message:edit', (msg) => {
        if (msg.groupId === groupId) {
          setMessages((prev) => prev.map((m) => m.id === msg.id ? msg : m));
        }
      }),
      onEvent('message:delete', ({ messageId, groupId: gid }) => {
        if (gid === groupId) {
          setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, isDeleted: true, content: '[Message deleted]' } : m));
        }
      }),
      onEvent('message:readUpdate', ({ userId, groupId: gid }) => {
        if (gid === groupId) {
          // Update read counts on messages
          setMessages((prev) => prev.map(m => ({
            ...m,
            readCount: (m.readCount || 0) + 1,
            readBy: [...(m.readBy || []), userId],
          })));
        }
      }),
      onEvent('typing:start', ({ userId, displayName, groupId: gid }) => {
        if (gid === groupId && userId !== user?.id) {
          setTypingUsers((prev) => {
            if (prev.find((u) => u.userId === userId)) return prev;
            return [...prev, { userId, displayName }];
          });
        }
      }),
      onEvent('typing:stop', ({ userId, groupId: gid }) => {
        if (gid === groupId) {
          setTypingUsers((prev) => prev.filter((u) => u.userId !== userId));
        }
      }),
      onEvent('message:react', ({ messageId, reactions, groupId: gid }) => {
        // Technically message:react emission might not have groupId if we didn't send it, but we only subbed here so it's fine.
        setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions } : m));
      }),
      onEvent('message:pinnedUpdate', ({ pinnedMsg, unpinnedIds }) => {
        setMessages((prev) => prev.map((m) => {
          if (m.id === pinnedMsg.id) return { ...m, ...pinnedMsg }; 
          if (unpinnedIds && unpinnedIds.includes(m.id)) return { ...m, isPinned: false };
          return m;
        }));
      }),
      onEvent('message:unpinned', ({ messageId }) => {
        setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, isPinned: false } : m));
      }),
    ];

    return () => cleanups.forEach((fn) => fn?.());
  }, [connected, onEvent, groupId, user?.id, markRead]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle @mention detection in input
  const detectMention = useCallback((value, cursorPos) => {
    // Find the @ before the cursor
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex === -1) {
      setShowMentionPopup(false);
      return;
    }
    // Check that there's no space between @ and cursor (or it's at the @)
    const query = textBeforeCursor.slice(lastAtIndex + 1);
    if (query.includes(' ') && query.length > 15) {
      setShowMentionPopup(false);
      return;
    }
    // Check that @ is at start or preceded by a space
    if (lastAtIndex > 0 && textBeforeCursor[lastAtIndex - 1] !== ' ') {
      setShowMentionPopup(false);
      return;
    }
    setMentionQuery(query);
    setMentionIndex(0);
    setShowMentionPopup(true);
  }, []);

  // Handle typing indicator
  const handleInputChange = useCallback((e) => {
    const value = e.target.value;
    setMessageInput(value);
    detectMention(value, e.target.selectionStart || value.length);

    if (value.trim()) {
      startTyping(groupId);
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => stopTyping(groupId), 2000);
    } else {
      stopTyping(groupId);
    }
  }, [groupId, startTyping, stopTyping, detectMention]);

  // Insert a mention into the input
  const insertMention = useCallback((member) => {
    const input = inputRef.current;
    const cursorPos = input?.selectionStart || messageInput.length;
    const textBeforeCursor = messageInput.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex === -1) return;

    const before = messageInput.slice(0, lastAtIndex);
    const after = messageInput.slice(cursorPos);
    const mention = `@${member.displayName} `;
    const newValue = before + mention + after;

    setMessageInput(newValue);
    setShowMentionPopup(false);
    setPendingMentions(prev => {
      if (prev.some(m => m.userId === member.id)) return prev;
      return [...prev, { userId: member.id, displayName: member.displayName }];
    });

    // Refocus input
    setTimeout(() => {
      if (input) {
        input.focus();
        const newPos = before.length + mention.length;
        input.setSelectionRange(newPos, newPos);
      }
    }, 0);
  }, [messageInput]);

  // Handle keyboard in mention popup
  const handleInputKeyDown = useCallback((e) => {
    if (showMentionPopup && mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(prev => (prev + 1) % mentionSuggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(prev => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        if (showMentionPopup) {
          e.preventDefault();
          insertMention(mentionSuggestions[mentionIndex]);
          return;
        }
      } else if (e.key === 'Escape') {
        setShowMentionPopup(false);
      }
    }
  }, [showMentionPopup, mentionSuggestions, mentionIndex, insertMention]);

  // Send message
  const handleSend = async (e) => {
    e?.preventDefault();
    if (showMentionPopup) return; // Don't send if mention popup is open
    const content = messageInput.trim();
    if ((!content && !fileAttachment) || sending) return;

    setSending(true);
    stopTyping(groupId);

    // Provide instant UI feedback and allow typing the next message immediately
    setMessageInput('');
    setReplyingTo(null);
    setPendingMentions([]);
    setShowMentionPopup(false);

    // Extract mention user IDs
    const mentionIds = pendingMentions
      .filter(m => content.includes(`@${m.displayName}`))
      .map(m => m.userId);

    try {
      if (fileAttachment) {
        // Multipart payload
        const formData = new FormData();
        if (content) formData.append('content', content);
        if (mentionIds.length) formData.append('mentions', JSON.stringify(mentionIds));
        if (replyingTo) formData.append('replyToId', replyingTo.id);
        formData.append('attachment', fileAttachment);

        const res = await groupApi.sendMessage(groupId, formData);
        setMessages((prev) => {
          if (prev.some(m => m.id === res.data.data.id)) return prev;
          return [...prev, res.data.data];
        });
        
        // Reset file
        setFileAttachment(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        // Standard payload via WebSocket or REST
        if (connected) {
          const newMsg = await wsSendMessage(groupId, content, mentionIds, replyingTo?.id);
          if (newMsg) {
            setMessages((prev) => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
          }
        } else {
          const res = await groupApi.sendMessage(groupId, { 
            content, 
            mentions: mentionIds, 
            replyToId: replyingTo?.id 
          });
          setMessages((prev) => {
            if (prev.some(m => m.id === res.data.data.id)) return prev;
            return [...prev, res.data.data];
          });
        }
      }

    } catch (err) {
      alert(err.message || err.response?.data?.error?.message || 'Failed to send message.');
      // Optionally restore input on failure if it was empty, though complex to merge if they started typing.
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleReact = async (msgId, emoji) => {
    try {
      const res = await groupApi.reactToMessage(groupId, msgId, emoji);
      // Optimistically update the UI in case socket event is missed
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, reactions: res.data.data.reactions } : m));
    } catch (err) {
      // alert on error?
    }
  };

  const handleForward = async (msg) => {
    try {
      const res = await groupApi.listGroups(); // fetch user groups
      setAllGroups(res.data.data || []);
      setForwardingMsg(msg);
    } catch {
      alert("Failed to load your groups for forwarding.");
    }
  };

  const submitForward = async (targetGroupId) => {
    if (!forwardingMsg) return;
    try {
      if (forwardingMsg.fileUrl) {
         alert("Forwarding files natively hasn't been implemented, only text will be forwarded.");
      }
      await groupApi.sendMessage(targetGroupId, {
        content: forwardingMsg.content,
        forwarded: true,
        msgType: 'text'
      });
      alert('Message forwarded successfully.');
      setForwardingMsg(null);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to forward message.');
    }
  };

  // Edit message
  const handleEdit = async (msgId, newContent) => {
    try {
      const res = await groupApi.editMessage(groupId, msgId, newContent);
      setMessages((prev) => prev.map((m) => m.id === msgId ? res.data.data : m));
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to edit.');
    }
  };

  // Delete message
  const handleDelete = async (msgId) => {
    try {
      await groupApi.deleteMessage(groupId, msgId);
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isDeleted: true, content: '[Message deleted]' } : m));
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to delete.');
    }
  };

  // Pin/unpin
  const handlePin = async (msgId, shouldPin) => {
    try {
      if (shouldPin) {
        const res = await groupApi.pinMessage(groupId, msgId);
        const { msg, unpinnedIds } = res.data.data;
        setMessages((prev) => prev.map((m) => {
           if (m.id === msg.id) return { ...m, isPinned: true };
           if (unpinnedIds && unpinnedIds.includes(m.id)) return { ...m, isPinned: false };
           return m;
        }));
      } else {
        await groupApi.unpinMessage(groupId, msgId);
        setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isPinned: false } : m));
      }
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to pin/unpin.');
    }
  };

  const userPerms = membership?.permissions || {};
  const canManageSettings = userPerms.can_edit_group_info || userPerms.can_manage_roles || isAdmin || membership?.isCreator;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="skeleton h-8 w-48 mb-4" />
        <div className="skeleton h-96 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <>
    <div className="max-w-5xl mx-auto flex flex-col h-[calc(100vh-120px)]">
        {/* Header */}
        <div className="flex items-center gap-4 mb-4 flex-shrink-0">
          <Link to="/groups" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
            ← Back
          </Link>
          {/* Group avatar */}
          {group?.avatarUrl ? (
            <img src={resolveAsset(group.avatarUrl)} alt="" className="w-10 h-10 rounded-xl object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center text-white font-bold">
              {group?.displayName?.charAt(0) || '#'}
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-lg font-bold">{group?.displayName || group?.name}</h1>
            <p className="text-xs text-[var(--color-text-muted)]">
              {group?.memberCount} members
              {connected && <span className="ml-2 text-[var(--color-success)]">● Live</span>}
              {!connected && <span className="ml-2 text-[var(--color-warning)]">● Reconnecting...</span>}
            </p>
          </div>
          <div className="flex gap-2">
            {canManageSettings && (
              <button
                onClick={() => setShowSettings(true)}
                className="btn btn-secondary text-sm px-3 py-2"
                title="Group Settings"
              >
                <Settings size={15} /> Settings
              </button>
            )}
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="btn btn-secondary text-sm px-3 py-2"
            >
              <Users size={15} /> {showSidebar ? 'Hide' : 'Members'}
            </button>
          </div>
        </div>

        {/* Main area */}
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Chat panel */}
          <div className="flex-1 flex flex-col glass-card overflow-hidden">
            {/* Pinned Message Banner */}
            {pinnedMessages.length > 0 && (
              <div 
                className="bg-[var(--color-bg-primary)] border-b border-[var(--color-border)] p-2 px-4 flex items-center justify-between text-sm shadow-sm z-10 cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors"
                onClick={() => {
                  const targetId = pinnedMessages[currentPinnedIndex]?.id;
                  if (targetId) {
                    const el = document.getElementById(`msg-${targetId}`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el.classList.add('bg-[var(--color-accent)]/20');
                      setTimeout(() => el.classList.remove('bg-[var(--color-accent)]/20'), 1500);
                    }
                  }
                  if (pinnedMessages.length > 1) {
                    setCurrentPinnedIndex((prev) => (prev + 1) % pinnedMessages.length);
                  }
                }}
              >
                <div className="flex items-center gap-3 overflow-hidden whitespace-nowrap w-full">
                  {pinnedMessages.length > 1 && (
                    <div className="flex flex-col gap-0.5 mt-0.5 h-full justify-center">
                      {pinnedMessages.map((_, idx) => (
                        <div key={idx} className={`w-1 h-1 rounded-full ${idx === currentPinnedIndex ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]/40'}`} />
                      ))}
                    </div>
                  )}
                  <span>📌</span>
                  <span className="font-semibold text-[var(--color-accent)] whitespace-nowrap">Pinned:</span>
                  <div className="flex-1 overflow-hidden relative h-5">
                    {pinnedMessages.map((pm, idx) => (
                      <span 
                        key={pm.id} 
                        className={`absolute left-0 top-0 w-full truncate transition-opacity duration-300 ${idx === currentPinnedIndex ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
                      >
                        {pm.content || 'Media Message'}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
                  No messages yet. Start the conversation!
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    replyMessage={messages.find(m => m.id === msg.replyToId)}
                    currentUserId={user?.id}
                    permissions={userPerms}
                    isAdmin={isAdmin}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onPin={handlePin}
                    onReact={handleReact}
                    onReply={(m) => { setReplyingTo(m); inputRef.current?.focus(); }}
                    onForward={handleForward}
                    onUserClick={(userId) => setSelectedUserId(userId)}
                    groupId={groupId}
                    members={members}
                    badgeMap={badgeMap}
                    isFriend={msg.authorId !== user?.id && friendIds.includes(msg.authorId)}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing indicator */}
            {typingUsers.length > 0 && (
              <div className="px-4 py-1 text-xs text-[var(--color-text-muted)] animate-pulse">
                {typingUsers.map((u) => u.displayName).join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
              </div>
            )}

            {/* @Mention autocomplete popup */}
            {showMentionPopup && mentionSuggestions.length > 0 && (
              <div className="mx-3 mb-1 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-lg overflow-hidden max-h-[200px] overflow-y-auto">
                {mentionSuggestions.map((m, i) => (
                  <button
                    key={m.id}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      i === mentionIndex
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'hover:bg-[var(--color-bg-secondary)]'
                    }`}
                    onClick={() => insertMention(m)}
                    onMouseEnter={() => setMentionIndex(i)}
                  >
                    {m.avatarUrl ? (
                      <img src={resolveAsset(m.avatarUrl)} alt="" className="w-6 h-6 rounded-full object-cover" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[var(--color-accent-light)] flex items-center justify-center text-white text-xs font-bold">
                        {m.displayName?.charAt(0)?.toUpperCase()}
                      </div>
                    )}
                    <span className="font-medium truncate">{m.displayName}</span>
                    {m.username && <span className={`text-xs ${i === mentionIndex ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}>@{m.username}</span>}
                  </button>
                ))}
              </div>
            )}

            {/* Input Overlay (Reply Context & File Preview) */}
            {(replyingTo || fileAttachment) && (
              <div className="px-3 pt-2 pb-1 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between">
                <div className="flex flex-col flex-1 min-w-0 pr-2">
                  {replyingTo && (
                     <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-2 mb-1">
                       <span className="font-semibold text-[var(--color-accent)]">Replying to {replyingTo.author?.displayName}:</span>
                       <span className="truncate flex-1">{replyingTo.content || '[Media]'}</span>
                     </div>
                  )}
                  {fileAttachment && (
                     <div className="text-xs text-[var(--color-success)] flex items-center gap-2">
                       <span>📎 Attached:</span>
                       <span className="truncate">{fileAttachment.name} ({(fileAttachment.size / 1024).toFixed(1)} KB)</span>
                     </div>
                  )}
                </div>
                <div className="flex gap-2">
                  {replyingTo && (
                    <button onClick={() => setReplyingTo(null)} className="text-xs text-[var(--color-danger)] p-1 hover:underline">Cancel Reply</button>
                  )}
                  {fileAttachment && (
                    <button onClick={() => { setFileAttachment(null); fileInputRef.current.value=''; }} className="text-xs text-[var(--color-danger)] p-1 hover:underline">Remove File</button>
                  )}
                </div>
              </div>
            )}

            {/* Input Form */}
            <form onSubmit={handleSend} className="flex gap-2 p-3 border-t border-[var(--color-border)] items-center pb-20 lg:pb-3">
              <button 
                type="button" 
                onClick={() => fileInputRef.current?.click()} 
                className="btn btn-secondary p-2.5 text-xl relative group focus:outline-none"
                title="Attach image or document (Max 5MB)"
              >
                📎
              </button>
              <input 
                type="file" 
                className="hidden" 
                ref={fileInputRef} 
                accept="image/*,.pdf,.doc,.docx,.txt"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) return alert('File exceeds 5MB limit.');
                  setFileAttachment(file);
                }} 
              />
              <input
                ref={inputRef}
                type="text"
                value={messageInput}
                onChange={handleInputChange}
                onKeyDown={handleInputKeyDown}
                placeholder="Type a message... (@ to mention)"
                className="flex-1 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
              />
              <button
                type="submit"
                disabled={(!messageInput.trim() && !fileAttachment) || sending}
                className="btn btn-primary px-5 py-2.5"
              >
                {sending ? '...' : 'Send'}
              </button>
            </form>
          </div>

          {/* Forwarding Modal */}
          {forwardingMsg && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="glass-card w-full max-w-sm flex flex-col p-5">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold">Forward Message</h3>
                  <button onClick={() => setForwardingMsg(null)} className="text-[var(--color-text-muted)] hover:text-white">✕</button>
                </div>
                <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg p-3 text-sm text-[var(--color-text-secondary)] mb-4 saturate-50">
                   {forwardingMsg.content || '[Media]'}
                </div>
                <input 
                  type="text" 
                  placeholder="Search groups..." 
                  value={forwardSearch} 
                  onChange={(e) => setForwardSearch(e.target.value)} 
                  className="w-full mb-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]" 
                />
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {allGroups.filter(g => g.id !== groupId && (g.displayName || g.name || '').toLowerCase().includes(forwardSearch.toLowerCase())).length === 0 && (
                    <p className="text-xs text-[var(--color-text-muted)]">No other active groups found.</p>
                  )}
                  {allGroups.filter(g => g.id !== groupId && (g.displayName || g.name || '').toLowerCase().includes(forwardSearch.toLowerCase())).map(g => (
                    <div key={g.id} className="flex items-center justify-between p-2 rounded hover:bg-[var(--color-bg-secondary)] border border-transparent hover:border-[var(--color-border)]">
                      <span className="text-sm">{g.displayName}</span>
                      <button onClick={() => submitForward(g.id)} className="btn btn-primary py-1 px-3 text-xs">Send</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* User Profile Panel */}
          {selectedUserId && (
            <UserProfilePanel
              userId={selectedUserId}
              currentUserId={user?.id}
              onClose={() => setSelectedUserId(null)}
            />
          )}

          {/* Sidebar */}
          {showSidebar && !selectedUserId && (
            <div className="w-64 glass-card overflow-y-auto flex-shrink-0 hidden md:block">
              <GroupSidebar
                groupId={groupId}
                userPermissions={userPerms}
                currentUserId={user?.id}
                isAdmin={isAdmin}
                onUserClick={(userId) => setSelectedUserId(userId)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Group Settings Modal */}
      {showSettings && (
        <GroupSettingsPanel
          groupId={groupId}
          group={group}
          currentUserId={user?.id}
          onClose={() => setShowSettings(false)}
          onGroupUpdated={(updated) => setGroup(prev => ({ ...prev, ...updated }))}
        />
      )}
    </>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send, Search, Coins, ArrowLeft, CornerDownLeft, X, CornerUpRight,
  Pencil, Trash2, Check, CheckCheck, Loader2, Share2, Sparkles, MessageSquare
} from 'lucide-react';
import { dmApi } from '../api/dmApi';
import { storeApi } from '../api/storeApi';
import { userApi } from '../api/userApi';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import Avatar from '../components/Avatar';

export default function MessagesPage() {
  const { userId: activeUserId } = useParams();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const { connected, markDMRead, onEvent } = useSocket();

  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState('');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [showCreditTransfer, setShowCreditTransfer] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditMsg, setCreditMsg] = useState('');
  const [fallbackPartner, setFallbackPartner] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [forwardingMsg, setForwardingMsg] = useState(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardUsers, setForwardUsers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await dmApi.listConversations();
      setConversations(res.data?.data || []);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }, []);

  const fetchMessages = useCallback(async (silent = false) => {
    if (!activeUserId) return;
    if (!silent) setLoading(true);
    try {
      const res = await dmApi.getMessages(activeUserId, 1, 50);
      const fetched = res.data?.data?.messages || [];
      setMessages(fetched);
      setPage(1);
      const totalPages = res.data?.data?.pagination?.totalPages || 1;
      setHasMore(totalPages > 1);

      try {
        if (connected) {
          markDMRead(activeUserId).catch(() => {});
        } else {
          await dmApi.markRead(activeUserId);
        }
      } catch { /* ignore */ }
      await fetchConversations();
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeUserId, fetchConversations, connected, markDMRead]);

  const loadOlderMessages = async () => {
    if (loadingOlder || !hasMore || !activeUserId) return;
    setLoadingOlder(true);
    try {
      const nextPage = page + 1;
      const res = await dmApi.getMessages(activeUserId, nextPage, 50);
      const older = res.data?.data?.messages || [];
      setMessages(prev => [...older, ...prev]);
      setPage(nextPage);
      const totalPages = res.data?.data?.pagination?.totalPages || 1;
      setHasMore(nextPage < totalPages);
    } catch (err) {
      console.error('Failed to load older messages:', err);
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => { fetchConversations(); }, [fetchConversations]);
  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  useEffect(() => {
    setFallbackPartner(null);
    if (!activeUserId) return;
    userApi.getUserProfile(activeUserId)
      .then(res => setFallbackPartner(res.data?.data))
      .catch((err) => console.error('Failed to load partner info', err));
  }, [activeUserId]);

  useEffect(() => {
    if (!connected || !onEvent) return;

    const cleanups = [
      onEvent('dm:new', (msg) => {
        if (activeUserId && (msg.senderId === activeUserId || msg.receiverId === activeUserId)) {
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          if (msg.senderId === activeUserId) {
            markDMRead(activeUserId).catch(() => {});
          }
        }
        fetchConversations();
      }),
      onEvent('dm:readUpdate', ({ readByUserId }) => {
        if (readByUserId === activeUserId) {
          setMessages(prev => prev.map(m =>
            m.senderId === currentUser?.id && !m.isRead
              ? { ...m, isRead: true, readAt: new Date().toISOString() }
              : m
          ));
        }
      }),
      onEvent('dm:edit', (updatedMsg) => {
        setMessages(prev => prev.map(m => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m));
      }),
      onEvent('dm:delete', ({ messageId }) => {
        setMessages(prev => prev.map(m =>
          m.id === messageId
            ? { ...m, isDeleted: true, content: '[Message deleted]', fileUrl: null, fileName: null, fileSize: null }
            : m
        ));
      }),
    ];

    return () => cleanups.forEach(fn => fn?.());
  }, [connected, onEvent, activeUserId, currentUser?.id, markDMRead, fetchConversations]);

  useEffect(() => {
    if (!loadingOlder) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, loadingOlder]);

  useEffect(() => {
    if (!activeUserId) return;
    if (connected) return;
    const interval = setInterval(() => fetchMessages(true), 6000);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearInterval(interval);
  }, [activeUserId, fetchMessages, connected]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeUserId) return;

    setSending(true);
    try {
      await dmApi.sendMessage(activeUserId, { content: newMessage.trim(), replyToId: replyingTo?.id });
      setNewMessage('');
      setReplyingTo(null);
      await fetchMessages(true);
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const activePartner = conversations.find(c => c.partner?.id === activeUserId)?.partner || fallbackPartner;

  const handleCreditTransfer = async () => {
    const amount = parseInt(creditAmount, 10);
    if (!amount || amount <= 0) return setCreditMsg('Please specify a positive credit amount.');
    setCreditMsg('');
    setSending(true);
    try {
      await storeApi.transferCredits(activeUserId, amount);
      await dmApi.sendMessage(activeUserId, { content: `💸 Transferred ${amount} credits to your account.` });
      setCreditAmount('');
      setShowCreditTransfer(false);
      setCreditMsg('');
      await fetchMessages(true);
    } catch (err) {
      setCreditMsg(err.response?.data?.error?.message || 'Transfer failed.');
    } finally {
      setSending(false);
    }
  };

  const handleForwardSearch = async (val) => {
    setForwardSearch(val);
    if (val.trim().length < 2) return setForwardUsers([]);
    try {
      const res = await userApi.searchUsers(val);
      setForwardUsers(res.data?.data || []);
    } catch { /* ignore */ }
  };

  const submitForward = async (targetUserId) => {
    if (!forwardingMsg) return;
    try {
      await dmApi.sendMessage(targetUserId, {
        content: forwardingMsg.content,
        forwarded: true,
        msgType: forwardingMsg.msgType || 'text',
        fileUrl: forwardingMsg.fileUrl,
        fileName: forwardingMsg.fileName,
        fileSize: forwardingMsg.fileSize,
      });
      setForwardingMsg(null);
      setForwardSearch('');
      setForwardUsers([]);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to forward message.');
    }
  };

  return (
    <div className="flex h-[calc(100dvh-8rem)] sm:h-[calc(100vh-8.5rem)] rounded-2xl sm:rounded-3xl border border-[var(--color-border)] glass-card overflow-hidden shadow-xl">
      {/* Conversations Sidebar */}
      <div className={`w-full md:w-80 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg-card)]/40 ${activeUserId ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-bold font-display text-[var(--color-text-primary)]">Direct Messages</h2>
          <div className="relative mt-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="matte-input text-xs pl-8.5 py-1.5"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)]/50">
          {conversations.length === 0 && (
            <div className="text-center text-[var(--color-text-muted)] py-12 px-4 text-xs">
              <MessageSquare size={28} className="mx-auto mb-2 opacity-50" />
              <p>No active conversations.<br />Start one from the Friends tab.</p>
            </div>
          )}

          {conversations
            .filter(c => (c.partner?.displayName || c.partner?.username || '').toLowerCase().includes(search.toLowerCase()))
            .map(conv => {
              const isActive = activeUserId === conv.partner?.id;
              return (
                <button
                  key={conv.partner?.id}
                  onClick={() => navigate(`/messages/${conv.partner?.id}`)}
                  className={`w-full flex items-center gap-3 p-3.5 text-left transition-colors relative ${
                    isActive ? 'bg-[var(--color-accent)]/15 font-medium' : 'hover:bg-[var(--color-bg-secondary)]'
                  }`}
                >
                  <Avatar
                    src={conv.partner?.avatarUrl}
                    name={conv.partner?.displayName}
                    className="w-10 h-10 rounded-2xl flex-shrink-0 ring-1 ring-[var(--color-border)]"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="font-bold text-xs text-[var(--color-text-primary)] truncate">{conv.partner?.displayName}</p>
                      {conv.unreadCount > 0 && (
                        <span className="bg-[var(--color-danger)] text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 font-bold flex-shrink-0">
                          {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--color-text-muted)] truncate mt-0.5">
                      {conv.lastMessage?.isMine ? 'You: ' : ''}{conv.lastMessage?.content || 'Sent an attachment'}
                    </p>
                  </div>
                </button>
              );
            })}
        </div>
      </div>

      {/* Main Conversation Stream */}
      <div className={`flex-1 flex flex-col ${!activeUserId ? 'hidden md:flex' : 'flex'}`}>
        {activeUserId ? (
          <>
            {/* Chat Top Header */}
            <div className="p-3.5 px-5 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg-card)]/60 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate('/messages')}
                  className="md:hidden p-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                >
                  <ArrowLeft size={16} />
                </button>
                <Avatar
                  src={activePartner?.avatarUrl}
                  name={activePartner?.displayName}
                  className="w-9 h-9 rounded-2xl ring-1 ring-[var(--color-border)] shadow-xs"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="font-bold text-xs text-[var(--color-text-primary)]">{activePartner?.displayName || 'Loading...'}</p>
                    {activePartner?.isFriend && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] font-bold">
                        Friend
                      </span>
                    )}
                  </div>
                  {activePartner?.username && (
                    <p className="text-[10px] text-[var(--color-text-muted)] font-medium">@{activePartner.username}</p>
                  )}
                </div>
              </div>

              {/* Header Right Actions */}
              <button
                onClick={() => setShowCreditTransfer(true)}
                className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 text-[var(--color-warning)]"
              >
                <Coins size={14} />
                <span>Send Credits</span>
              </button>
            </div>

            {/* Messages Scroll View */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 bg-[var(--color-bg-primary)]/40">
              {hasMore && (
                <div className="text-center py-2">
                  <button
                    onClick={loadOlderMessages}
                    disabled={loadingOlder}
                    className="text-xs text-[var(--color-accent)] font-semibold hover:underline disabled:opacity-50"
                  >
                    {loadingOlder ? 'Loading earlier messages...' : '↑ Load earlier history'}
                  </button>
                </div>
              )}

              {loading && messages.length === 0 && (
                <div className="text-center py-12 text-xs text-[var(--color-text-muted)] flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
                  <span>Loading messages...</span>
                </div>
              )}

              {messages.map((msg) => {
                const isMine = msg.senderId === currentUser?.id;
                const repliedMessage = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;

                const handleSaveEdit = async () => {
                  if (!editContent.trim()) return;
                  try {
                    const res = await dmApi.editMessage(msg.id, editContent.trim());
                    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...res.data.data } : m));
                    setEditingId(null);
                  } catch {
                    alert('Failed to edit message.');
                  }
                };

                return (
                  <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} group items-end gap-1.5`}>
                    {!isMine && !msg.isDeleted && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pb-1">
                        <button
                          onClick={() => setReplyingTo(msg)}
                          className="p-1 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]"
                          title="Reply"
                        >
                          <CornerDownLeft size={13} />
                        </button>
                        <button
                          onClick={() => setForwardingMsg(msg)}
                          className="p-1 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]"
                          title="Forward"
                        >
                          <Share2 size={13} />
                        </button>
                      </div>
                    )}

                    <div className={`max-w-[85%] sm:max-w-[65%] px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl text-xs sm:text-sm break-words relative shadow-xs ${
                      isMine
                        ? 'bg-gradient-to-br from-[var(--color-accent)] to-[#528976] text-white rounded-br-xs'
                        : 'glass-card text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-bl-xs'
                    }`}>
                      {msg.isDeleted ? (
                        <p className="italic opacity-60 text-xs py-0.5">[Message deleted]</p>
                      ) : (
                        <>
                          {msg.forwarded && (
                            <p className={`text-[10px] italic flex items-center gap-1 mb-1 font-semibold ${isMine ? 'text-white/80' : 'text-[var(--color-text-muted)]'}`}>
                              <Share2 size={10} /> Forwarded
                            </p>
                          )}

                          {msg.replyToId && (
                            <div className="text-[11px] px-2.5 py-1.5 mb-2 rounded-xl border-l-2 bg-black/15 border-white/40 truncate">
                              <span className="font-bold">{repliedMessage?.author?.displayName || 'Quoted'}: </span>
                              <span>{repliedMessage?.content || '[Attachment]'}</span>
                            </div>
                          )}

                          {editingId === msg.id ? (
                            <div className="flex flex-col gap-2 min-w-[220px]">
                              <input
                                type="text"
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="matte-input text-xs py-1"
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                              />
                              <div className="flex gap-1.5 justify-end">
                                <button onClick={handleSaveEdit} className="btn btn-primary text-[10px] py-1 px-2.5">
                                  Save
                                </button>
                                <button onClick={() => setEditingId(null)} className="btn btn-secondary text-[10px] py-1 px-2">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="leading-relaxed">{msg.content}</p>
                          )}

                          <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${isMine ? 'text-white/80' : 'text-[var(--color-text-muted)]'}`}>
                            <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {isMine && (
                              <span title={msg.isRead ? 'Read' : 'Sent'}>
                                {msg.isRead ? <CheckCheck size={13} className="text-white" /> : <Check size={13} className="text-white/70" />}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {isMine && !msg.isDeleted && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pb-1">
                        <button
                          onClick={() => { setEditingId(msg.id); setEditContent(msg.content); }}
                          className="p-1 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]"
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={async () => {
                            if (!window.confirm('Delete message?')) return;
                            try {
                              await dmApi.deleteMessage(msg.id);
                              setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isDeleted: true, content: '[Message deleted]' } : m));
                            } catch { /* ignore */ }
                          }}
                          className="p-1 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-danger)]"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Quoted Message Indicator */}
            {replyingTo && (
              <div className="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]/80 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 truncate">
                  <CornerDownLeft size={14} className="text-[var(--color-accent)]" />
                  <span className="font-bold">Replying to: </span>
                  <span className="truncate text-[var(--color-text-secondary)]">{replyingTo.content}</span>
                </div>
                <button onClick={() => setReplyingTo(null)} className="p-1 hover:text-[var(--color-danger)]">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Input Bar */}
            <form onSubmit={handleSend} className="p-2 sm:p-3 border-t border-[var(--color-border)] bg-[var(--color-bg-card)]/60 flex items-center gap-1.5 sm:gap-2">
              <input
                ref={inputRef}
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder={`Message ${activePartner?.displayName || ''}...`}
                className="matte-input flex-1 text-xs sm:text-sm py-2 sm:py-2.5"
                autoFocus
              />
              <button
                type="submit"
                disabled={sending || !newMessage.trim()}
                className="btn btn-primary px-3 sm:px-4 py-2 sm:py-2.5 shadow-sm shrink-0"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[var(--color-text-muted)]">
            <div className="w-16 h-16 rounded-3xl bg-[var(--palette-teal)]/15 border border-[var(--palette-teal)]/30 flex items-center justify-center mb-4 text-[var(--palette-teal)]">
              <MessageSquare size={28} />
            </div>
            <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">Your Campus Direct Messages</h3>
            <p className="text-xs text-[var(--color-text-secondary)] max-w-sm mt-1">
              Select an existing chat or navigate to Friends to initiate a direct conversation.
            </p>
          </div>
        )}
      </div>

      {/* Credit Transfer Modal */}
      <AnimatePresence>
        {showCreditTransfer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card p-6 rounded-3xl max-w-sm w-full border border-[var(--color-border)] shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)] mb-4">
                <div className="flex items-center gap-2 text-[var(--color-warning)]">
                  <Coins size={18} />
                  <h3 className="font-bold font-display text-sm text-[var(--color-text-primary)]">Transfer Campus Credits</h3>
                </div>
                <button onClick={() => setShowCreditTransfer(false)} className="p-1 hover:opacity-75">
                  <X size={16} />
                </button>
              </div>

              <p className="text-xs text-[var(--color-text-secondary)] mb-4">
                Send credits directly to <strong className="text-[var(--color-text-primary)]">{activePartner?.displayName}</strong>.
              </p>

              {creditMsg && (
                <div className="p-3 rounded-2xl bg-[var(--color-danger)]/15 text-[var(--color-danger)] text-xs font-semibold mb-3">
                  {creditMsg}
                </div>
              )}

              <input
                type="number"
                min={1}
                placeholder="Credit amount (e.g. 50)"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                className="matte-input text-sm mb-4"
              />

              <div className="flex gap-2">
                <button onClick={handleCreditTransfer} disabled={sending || !creditAmount} className="btn btn-primary flex-1 py-2 text-xs">
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Coins size={14} />}
                  <span>Confirm Transfer</span>
                </button>
                <button onClick={() => setShowCreditTransfer(false)} className="btn btn-secondary text-xs px-3">
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Forwarding Modal */}
      <AnimatePresence>
        {forwardingMsg && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
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
                placeholder="Search user to forward to..."
                value={forwardSearch}
                onChange={(e) => handleForwardSearch(e.target.value)}
                className="matte-input text-xs mb-3"
              />

              <div className="max-h-48 overflow-y-auto space-y-1.5 divide-y divide-[var(--color-border)]/50">
                {forwardUsers.map(u => (
                  <button
                    key={u.id}
                    onClick={() => submitForward(u.id)}
                    className="w-full flex items-center gap-2 p-2 rounded-xl hover:bg-[var(--color-bg-secondary)] text-left"
                  >
                    <Avatar src={u.avatarUrl} name={u.displayName} className="w-7 h-7 rounded-xl" />
                    <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">{u.displayName}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

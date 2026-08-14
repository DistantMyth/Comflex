/**
 * MessagesPage — DM conversations list & active chat.
 * Shows all DM conversations in a sidebar and the active chat in the main area.
 * Features: read receipt tick marks (✓ sent, ✓✓ read), real-time updates.
 */

import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { dmApi } from '../api/dmApi';
import { storeApi } from '../api/storeApi';
import { userApi } from '../api/userApi';
import { AuthContext } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import MessageBubble from '../components/MessageBubble';
import resolveAsset from '../utils/resolveAsset';

export default function MessagesPage() {
  const { userId: activeUserId } = useParams();
  const { user: currentUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const { connected, markDMRead, onEvent } = useSocket();

  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState('');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showCreditTransfer, setShowCreditTransfer] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditMsg, setCreditMsg] = useState('');
  const [fallbackPartner, setFallbackPartner] = useState(null);
  const messagesEndRef = useRef(null);

  // Fetch conversation list
  const fetchConversations = useCallback(async () => {
    try {
      const res = await dmApi.listConversations();
      setConversations(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }, []);

  // Fetch messages for the active conversation
  // `silent` skips the loading indicator — background refreshes (socket
  // updates, polls) must not flicker a "Loading messages..." label.
  const fetchMessages = useCallback(async (silent = false) => {
    if (!activeUserId) return;
    if (!silent) setLoading(true);
    try {
      const res = await dmApi.getMessages(activeUserId);
      setMessages(res.data.data?.messages || []);
      // Mark as read via socket (for real-time notification) or REST fallback
      try {
        if (connected) {
          markDMRead(activeUserId).catch(() => {});
        } else {
          await dmApi.markRead(activeUserId);
        }
      } catch { /* ignore mark-read errors */ }
      // Refresh conversations to update unread counts
      await fetchConversations();
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeUserId, fetchConversations, connected, markDMRead]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);
  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  // Fetch partner profile if it's a new conversation
  useEffect(() => {
    setFallbackPartner(null);
    if (!activeUserId) return;
    userApi.getUserProfile(activeUserId)
      .then(res => setFallbackPartner(res.data.data))
      .catch((err) => console.error('Failed to load partner info', err));
  }, [activeUserId]);

  // Subscribe to real-time DM events
  useEffect(() => {
    if (!connected || !onEvent) return;

    const cleanups = [
      onEvent('dm:new', (msg) => {
        // If we're in the active conversation, add the message
        if (activeUserId && (msg.senderId === activeUserId || msg.receiverId === activeUserId)) {
          setMessages(prev => [...prev, msg]);
          // Auto-mark as read since we're viewing this conversation
          if (msg.senderId === activeUserId) {
            markDMRead(activeUserId).catch(() => {});
          }
        }
        // Refresh conversation list for unread counts
        fetchConversations();
      }),
      onEvent('dm:readUpdate', ({ readByUserId }) => {
        // The other user read our messages — update tick marks
        if (readByUserId === activeUserId) {
          setMessages(prev => prev.map(m =>
            m.senderId === currentUser?.id && !m.isRead
              ? { ...m, isRead: true, readAt: new Date().toISOString() }
              : m
          ));
        }
      }),
    ];

    return () => cleanups.forEach(fn => fn?.());
  }, [connected, onEvent, activeUserId, currentUser?.id, markDMRead, fetchConversations]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll for new messages when disconnected from the socket (5s). While
  // connected, real-time events already keep the conversation fresh.
  useEffect(() => {
    if (!activeUserId) return;
    if (connected) return;
    const interval = setInterval(() => fetchMessages(true), 5000);
    // Auto-focus input when opening a conversation
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearInterval(interval);
  }, [activeUserId, fetchMessages, connected]);

  const [replyingTo, setReplyingTo] = useState(null);
  const [forwardingMsg, setForwardingMsg] = useState(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');

  const submitForward = async (targetUserId) => {
    if (!forwardingMsg) return;
    try {
      await dmApi.sendMessage(targetUserId, {
        content: forwardingMsg.content,
        forwarded: true,
        msgType: forwardingMsg.msgType || 'text'
      });
      alert('Message forwarded successfully.');
      setForwardingMsg(null);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to forward message.');
    }
  };

  const inputRef = useRef(null);

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
      // Wait for React to re-enable the input before focusing
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const activePartner = conversations.find(c => c.partner?.id === activeUserId)?.partner || fallbackPartner;

  const handleCreditTransfer = async () => {
    const amount = parseInt(creditAmount, 10);
    if (!amount || amount <= 0) return setCreditMsg('Enter a valid amount.');
    setCreditMsg('');
    setSending(true);
    try {
      await storeApi.transferCredits(activeUserId, amount);
      // Send a chat message confirming the transfer
      await dmApi.sendMessage(activeUserId, { content: `💸 Sent ${amount} credits` });
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

  // Read receipt tick component
  const ReadTick = ({ message }) => {
    if (message.senderId !== currentUser?.id) return null;
    const isRead = message.isRead;
    return (
      <span
        className={`text-[10px] ml-1 ${isRead ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}
        title={isRead && message.readAt ? `Read at ${new Date(message.readAt).toLocaleTimeString()}` : 'Sent'}
      >
        {isRead ? '✓✓' : '✓'}
      </span>
    );
  };

  return (
    <>
    <div className="flex h-[calc(100dvh-9rem)] lg:h-[calc(100dvh-6rem)] min-h-[440px] relative">
        {/* Conversations sidebar */}
        <div className="w-80 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg-secondary)]">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h2 className="text-lg font-bold">Messages</h2>
            <input 
              type="text" 
              placeholder="Search conversations..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              className="w-full mt-3 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]" 
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 && (
              <p className="text-center text-[var(--color-text-muted)] py-8 text-sm">
                No conversations yet.<br />
                Send a message from your Friends page!
              </p>
            )}
            {conversations.filter(c => (c.partner?.displayName || c.partner?.username || '').toLowerCase().includes(search.toLowerCase())).map(conv => (
              <button
                key={conv.partner?.id}
                onClick={() => navigate(`/messages/${conv.partner?.id}`)}
                className={`w-full flex items-center gap-3 p-4 text-left transition-colors border-b border-[var(--color-border)] ${
                  activeUserId === conv.partner?.id
                    ? 'bg-[rgba(108,99,255,0.1)]'
                    : 'hover:bg-[var(--color-bg-card)]'
                }`}
              >
                {conv.partner?.avatarUrl ? (
                  <img src={resolveAsset(conv.partner.avatarUrl)} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {conv.partner?.displayName?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="font-semibold text-sm truncate">{conv.partner?.displayName}</p>
                      {conv.partner?.isFriend && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--color-success)] text-white shadow-sm flex items-center gap-0.5 flex-shrink-0" title="In your friends list">
                          ★ Friend
                        </span>
                      )}
                    </div>
                    {conv.unreadCount > 0 && (
                      <span className="bg-[var(--color-danger)] text-white text-xs rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5 font-bold flex-shrink-0">
                        {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] truncate">
                    {conv.lastMessage?.isMine ? 'You: ' : ''}{conv.lastMessage?.content}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col">
          {activeUserId ? (
            <>
              {/* Chat header */}
              <div className="p-4 border-b border-[var(--color-border)] flex items-center gap-3 bg-[var(--color-bg-secondary)]">
                {activePartner?.avatarUrl ? (
                  <img src={resolveAsset(activePartner.avatarUrl)} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white font-bold text-xs">
                    {activePartner?.displayName?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                )}
                <div>
                  <p className="font-semibold text-sm">{activePartner?.displayName || 'Loading...'}</p>
                  {activePartner?.username && <p className="text-xs text-[var(--color-text-muted)]">@{activePartner.username}</p>}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {loading && messages.length === 0 && <p className="text-center text-[var(--color-text-muted)] animate-pulse">Loading messages...</p>}
                {messages.map(msg => {
                  const isMine = msg.senderId === currentUser?.id;

                  const handleSaveEdit = async () => {
                    if (!editContent.trim()) return;
                    try {
                      const res = await dmApi.editMessage(msg.id, editContent.trim());
                      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...res.data.data } : m));
                      setEditingId(null);
                    } catch { alert('Failed to edit message'); }
                  };

                  return (
                    <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} group relative items-center gap-2`}>
                      {!isMine && (
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity order-last">
                           <button onClick={() => setReplyingTo(msg)} className="text-xs text-[var(--color-text-muted)] hover:text-white p-1" title="Reply">↩</button>
                           <button onClick={() => setForwardingMsg(msg)} className="text-xs text-[var(--color-text-muted)] hover:text-white p-1" title="Forward">➦</button>
                        </div>
                      )}

                      <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm break-words relative shadow-sm ${
                        isMine
                          ? 'bg-[var(--color-accent)] text-white rounded-br-sm'
                          : 'bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-bl-sm'
                      }`}>
                        {msg.isDeleted ? (
                           <p className="italic text-white/50 text-xs py-1">[Message deleted]</p>
                        ) : (
                          <>
                            {editingId === msg.id ? (
                              <div className="flex flex-col gap-2 min-w-[200px]">
                                <input
                                  type="text"
                                  value={editContent}
                                  onChange={e => setEditContent(e.target.value)}
                                  className="text-black px-2 py-1 rounded text-sm w-full focus:outline-none"
                                  autoFocus
                                  onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
                                />
                                <div className="flex justify-end gap-2 text-xs">
                                  <button onClick={() => setEditingId(null)} className="hover:underline">Cancel</button>
                                  <button onClick={handleSaveEdit} className="font-bold hover:underline">Save</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {msg.fileUrl && (
                                  <div className="mb-2">
                                    {msg.fileUrl.match(/\.(jpeg|jpg|gif|png|webp)$/i) ? (
                                      <img src={resolveAsset(msg.fileUrl)} alt="Attached" className="max-w-full rounded-lg max-h-60 object-contain cursor-pointer hover:opacity-90" onClick={() => window.open(resolveAsset(msg.fileUrl), '_blank')} />
                                    ) : (
                                      <a href={resolveAsset(msg.fileUrl)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 bg-[var(--color-bg-secondary)] rounded-lg hover:bg-[var(--color-bg-card)] w-full font-medium">
                                        📄 {msg.fileName || 'Attachment'}
                                      </a>
                                    )}
                                  </div>
                                )}
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                              </>
                            )}
                          </>
                        )}
                        <div className={`flex items-center justify-end gap-1.5 mt-1.5 ${isMine ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}>
                          {msg.editedAt && !msg.isDeleted && <span className="text-[10px] italic">edited</span>}
                          <span className="text-[10px]">
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <ReadTick message={msg} />
                        </div>
                      </div>

                      {isMine && !msg.isDeleted && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mr-1 order-first">
                           <button onClick={() => { setEditContent(msg.content); setEditingId(msg.id); }} className="text-xs text-[var(--color-text-muted)] hover:text-white p-1" title="Edit">✎</button>
                           <button onClick={async () => {
                             try {
                               await dmApi.deleteMessage(msg.id);
                               setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isDeleted: true, content: '[Message deleted]' } : m));
                             } catch { alert('Failed to delete'); }
                           }} className="text-xs text-[var(--color-danger)] hover:text-red-400 p-1" title="Delete">🗑</button>
                           <button onClick={() => setReplyingTo(msg)} className="text-xs text-[var(--color-text-muted)] hover:text-white p-1" title="Reply">↩</button>
                           <button onClick={() => setForwardingMsg(msg)} className="text-xs text-[var(--color-text-muted)] hover:text-white p-1" title="Forward">➦</button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Credit Transfer Overlay */}
              {showCreditTransfer && (
                <div className="px-4 pt-3 pb-2 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">🪙</span>
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5">Send Credits to {activePartner?.displayName || 'this user'}</p>
                      <div className="flex gap-2 items-center">
                        <input
                          type="number"
                          min="1"
                          placeholder="Amount..."
                          value={creditAmount}
                          onChange={e => setCreditAmount(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleCreditTransfer()}
                          className="w-32 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
                          autoFocus
                          disabled={sending}
                        />
                        <button
                          onClick={handleCreditTransfer}
                          disabled={sending || !creditAmount}
                          className="btn text-sm py-1.5 px-4 bg-[var(--color-success)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          {sending ? '...' : 'Send'}
                        </button>
                        <button
                          onClick={() => { setShowCreditTransfer(false); setCreditAmount(''); setCreditMsg(''); }}
                          className="text-xs text-[var(--color-danger)] hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                      {creditMsg && (
                        <p className="text-xs mt-1.5 text-[var(--color-danger)]">{creditMsg}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Input Overlay (Reply Context) */}
              {replyingTo && (
                <div className="px-3 pt-2 pb-1 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between">
                  <div className="flex flex-col flex-1 min-w-0 pr-2">
                    <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-2 mb-1">
                      <span className="font-semibold text-[var(--color-accent)]">Replying to message:</span>
                      <span className="truncate flex-1">{replyingTo.content || '[Media]'}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setReplyingTo(null)} className="text-xs text-[var(--color-danger)] p-1 hover:underline">Cancel</button>
                  </div>
                </div>
              )}

              {/* Input */}
              <form onSubmit={handleSend} className="p-4 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] relative pb-24 lg:pb-4">
                <div className="flex gap-2 items-center">
                  <label className={`cursor-pointer p-2 rounded-full hover:bg-[var(--color-bg-primary)] transition-colors ${sending ? 'opacity-50 pointer-events-none' : ''}`} title="Attach file (Up to 5MB)">
                    <input 
                      type="file" 
                      className="hidden" 
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 5 * 1024 * 1024) return alert('File limit is 5MB.');
                        setSending(true);
                        try {
                           const res = await dmApi.uploadAttachment(file);
                           const fileData = res.data.data;
                           await dmApi.sendMessage(activeUserId, {
                             content: '', // Optionally text can be sent if required
                             replyToId: replyingTo?.id,
                             ...fileData
                           });
                           await fetchMessages(true);
                           setReplyingTo(null);
                        } catch {
                           alert('Failed to send attachment.');
                        } finally {
                           setSending(false);
                           e.target.value = null; // Clear input
                        }
                      }}
                    />
                    <svg className="w-5 h-5 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowCreditTransfer(!showCreditTransfer)}
                    className={`p-2 rounded-full transition-colors ${showCreditTransfer ? 'bg-[var(--color-success)]/20 text-[var(--color-success)]' : 'hover:bg-[var(--color-bg-primary)] text-[var(--color-text-muted)]'}`}
                    title="Send Credits"
                  >
                    🪙
                  </button>
                  <input
                    ref={inputRef}
                    type="text"
                    className="input flex-1"
                    placeholder="Type a message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    disabled={sending}
                  />
                  <button type="submit" className="btn btn-primary px-6" disabled={sending || !newMessage.trim()}>
                    {sending ? '...' : 'Send'}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
              <div className="text-center">
                <p className="text-4xl mb-4">💬</p>
                <p className="text-lg font-medium">Select a conversation</p>
                <p className="text-sm mt-1">or start a new one from your Friends page</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Forwarding Modal */}
      {forwardingMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass-card w-full max-w-sm flex flex-col p-5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-2xl shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg">Forward Message</h3>
              <button onClick={() => setForwardingMsg(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">✕</button>
            </div>
            <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg p-3 text-sm text-[var(--color-text-secondary)] mb-4 saturate-50">
               {forwardingMsg.content || '[Media message]'}
            </div>
            <input 
              type="text" 
              placeholder="Search friends..." 
              value={forwardSearch} 
              onChange={(e) => setForwardSearch(e.target.value)} 
              className="w-full mb-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]" 
            />
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {conversations.filter(c => c.partner?.id !== activeUserId && (c.partner?.displayName || c.partner?.username || '').toLowerCase().includes(forwardSearch.toLowerCase())).length === 0 && (
                <p className="text-xs text-[var(--color-text-muted)] p-2">No friends found.</p>
              )}
              {conversations.filter(c => c.partner?.id !== activeUserId && (c.partner?.displayName || c.partner?.username || '').toLowerCase().includes(forwardSearch.toLowerCase())).map(c => (
                <div key={c.partner?.id} className="flex items-center justify-between p-2 rounded hover:bg-[var(--color-bg-secondary)] border border-transparent hover:border-[var(--color-border)] transition-colors">
                  <div className="flex items-center gap-2">
                    {c.partner?.avatarUrl ? (
                      <img src={resolveAsset(c.partner.avatarUrl)} alt="" className="w-6 h-6 rounded-full object-cover" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white text-[10px] font-bold">
                        {c.partner?.displayName?.charAt(0)?.toUpperCase()}
                      </div>
                    )}
                    <span className="text-sm font-medium">{c.partner?.displayName}</span>
                  </div>
                  <button onClick={() => submitForward(c.partner.id)} className="btn btn-primary py-1 px-3 text-xs shadow-none">Send</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, UserCheck, Send, UserPlus, Search, Loader2, Check, X,
  MessageSquare, UserMinus, ShieldAlert
} from 'lucide-react';
import { friendApi } from '../api/friendApi';
import { userApi } from '../api/userApi';
import Avatar from '../components/Avatar';

export default function FriendsPage() {
  const [tab, setTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [sent, setSent] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [message, setMessage] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [friendsRes, requestsRes, sentRes] = await Promise.all([
        friendApi.listFriends(),
        friendApi.listRequests(),
        friendApi.listSent(),
      ]);
      setFriends(friendsRes.data?.data || []);
      setRequests(requestsRes.data?.data || []);
      setSent(sentRes.data?.data || []);
    } catch (err) {
      console.error('Failed to fetch friends data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (tab !== 'search' || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await userApi.searchUsers(searchQuery);
        setSearchResults(res.data?.data || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      setSearching(false);
    };
  }, [searchQuery, tab]);

  const handleAction = async (action, id) => {
    setActionLoading(id);
    setMessage('');
    try {
      switch (action) {
        case 'accept':
          await friendApi.accept(id);
          setMessage('Friend request accepted!');
          break;
        case 'reject':
          await friendApi.reject(id);
          setMessage('Friend request rejected.');
          break;
        case 'remove':
          await friendApi.remove(id);
          setMessage('Friend removed.');
          break;
        case 'send':
          await friendApi.sendRequest(id);
          setMessage('Friend request sent!');
          break;
      }
      await fetchData();
      if (tab === 'search' && searchQuery.trim().length >= 2) {
        const res = await userApi.searchUsers(searchQuery);
        setSearchResults(res.data?.data || []);
      }
    } catch (err) {
      setMessage(err.response?.data?.error?.message || err.response?.data?.message || 'Action failed.');
    } finally {
      setActionLoading('');
    }
  };

  const tabs = [
    { key: 'friends', label: 'Friends', count: friends.length, icon: Users },
    { key: 'requests', label: 'Requests', count: requests.length, icon: UserCheck },
    { key: 'sent', label: 'Sent', count: sent.length, icon: Send },
    { key: 'search', label: 'Find People', icon: Search },
  ];

  const UserCard = ({ user, actions }) => (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between p-4 rounded-2xl glass-card border border-[var(--color-border)] hover-lift"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Avatar
          src={user.avatarUrl}
          name={user.displayName}
          className="w-11 h-11 rounded-2xl ring-1 ring-[var(--color-border)] shadow-sm flex-shrink-0"
        />
        <div className="min-w-0 flex-1 pr-2">
          <p className="font-bold text-sm text-[var(--color-text-primary)] truncate">{user.displayName}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {user.username && <span className="text-xs text-[var(--color-text-muted)] font-medium">@{user.username}</span>}
            {user.globalRing !== undefined && (
              <span className={`text-[10px] px-2 py-0.2 rounded-full font-bold ring-badge-${Math.min(user.globalRing, 3)}`}>
                Ring {user.globalRing}
              </span>
            )}
          </div>
          {user.email && <p className="text-[11px] text-[var(--color-text-muted)] truncate mt-0.5">{user.email}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {actions}
      </div>
    </motion.div>
  );

  return (
    <div className="max-w-3xl mx-auto pb-12">
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-display text-[var(--color-text-primary)]">Friends & Connections</h1>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Connect with campus peers, manage requests, and discover classmates</p>
      </div>

      {message && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3.5 rounded-2xl bg-[var(--palette-teal)]/15 border border-[var(--palette-teal)]/30 text-[var(--palette-teal)] text-xs font-semibold mb-5 flex items-center justify-between"
        >
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="p-1 hover:opacity-75">
            <X size={14} />
          </button>
        </motion.div>
      )}

      {/* Tabs Switcher */}
      <div className="flex gap-1.5 p-1.5 bg-[var(--color-bg-matte)] rounded-2xl border border-[var(--color-border)] mb-6">
        {tabs.map((t) => {
          const active = tab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                active ? 'text-white' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="friends-tab-pill"
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-[var(--color-accent)] to-[#528976] shadow-md"
                />
              )}
              <Icon size={14} className="relative z-10" />
              <span className="relative z-10">{t.label}</span>
              {t.count !== undefined && (
                <span className={`relative z-10 text-[10px] px-1.5 py-0.2 rounded-full ${
                  active ? 'bg-white/20 text-white' : 'bg-[var(--color-bg-card)] text-[var(--color-text-muted)]'
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="py-12 flex justify-center items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={18} className="animate-spin text-[var(--color-accent)]" />
          <span>Synchronizing connections...</span>
        </div>
      )}

      {/* Friends List Tab */}
      {tab === 'friends' && !loading && (
        <div className="space-y-3">
          {friends.length === 0 ? (
            <div className="glass-card p-10 text-center border border-[var(--color-border)]">
              <Users size={32} className="mx-auto text-[var(--color-text-muted)] mb-3 opacity-60" />
              <h3 className="text-sm font-bold text-[var(--color-text-primary)]">No friends connected yet</h3>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1 max-w-sm mx-auto">
                Search for classmates by name, email, or handle to build your campus network.
              </p>
              <button onClick={() => setTab('search')} className="btn btn-primary text-xs py-2 px-4 mt-4 shadow-sm">
                Find Classmates
              </button>
            </div>
          ) : (
            friends.map((f) => (
              <UserCard
                key={f.friendshipId}
                user={f}
                actions={
                  <>
                    <Link to={`/messages/${f.id}`} className="btn btn-primary text-xs py-1.5 px-3 shadow-xs flex items-center gap-1">
                      <MessageSquare size={13} />
                      <span>Message</span>
                    </Link>
                    <button
                      onClick={() => handleAction('remove', f.friendshipId)}
                      className="btn btn-secondary text-xs py-1.5 px-3 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                      disabled={actionLoading === f.friendshipId}
                      title="Unfriend"
                    >
                      {actionLoading === f.friendshipId ? <Loader2 size={13} className="animate-spin" /> : <UserMinus size={13} />}
                      <span className="hidden sm:inline">Unfriend</span>
                    </button>
                  </>
                }
              />
            ))
          )}
        </div>
      )}

      {/* Pending Incoming Requests */}
      {tab === 'requests' && !loading && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="glass-card p-10 text-center border border-[var(--color-border)]">
              <UserCheck size={32} className="mx-auto text-[var(--color-text-muted)] mb-3 opacity-60" />
              <h3 className="text-sm font-bold text-[var(--color-text-primary)]">No pending requests</h3>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">When someone sends you a friend request, it will appear here.</p>
            </div>
          ) : (
            requests.map((r) => (
              <UserCard
                key={r.friendshipId}
                user={r}
                actions={
                  <>
                    <button
                      onClick={() => handleAction('accept', r.friendshipId)}
                      className="btn btn-primary text-xs py-1.5 px-3 shadow-xs flex items-center gap-1"
                      disabled={actionLoading === r.friendshipId}
                    >
                      {actionLoading === r.friendshipId ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      <span>Accept</span>
                    </button>
                    <button
                      onClick={() => handleAction('reject', r.friendshipId)}
                      className="btn btn-secondary text-xs py-1.5 px-3"
                      disabled={actionLoading === r.friendshipId}
                    >
                      <X size={13} />
                      <span>Reject</span>
                    </button>
                  </>
                }
              />
            ))
          )}
        </div>
      )}

      {/* Sent Requests */}
      {tab === 'sent' && !loading && (
        <div className="space-y-3">
          {sent.length === 0 ? (
            <div className="glass-card p-10 text-center border border-[var(--color-border)]">
              <Send size={32} className="mx-auto text-[var(--color-text-muted)] mb-3 opacity-60" />
              <h3 className="text-sm font-bold text-[var(--color-text-primary)]">No outgoing requests</h3>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">Friend requests you have sent to others will be displayed here.</p>
            </div>
          ) : (
            sent.map((s) => (
              <UserCard
                key={s.friendshipId}
                user={s}
                actions={
                  <>
                    <span className="text-[11px] text-[var(--color-warning)] font-bold px-2.5 py-1 rounded-full bg-[var(--color-warning)]/15 border border-[var(--color-warning)]/30">
                      Pending
                    </span>
                    <button
                      onClick={() => handleAction('remove', s.friendshipId)}
                      className="btn btn-secondary text-xs py-1.5 px-3 text-[var(--color-danger)]"
                      disabled={actionLoading === s.friendshipId}
                    >
                      {actionLoading === s.friendshipId ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                      <span>Cancel</span>
                    </button>
                  </>
                }
              />
            ))
          )}
        </div>
      )}

      {/* Search & Discovery Tab */}
      {tab === 'search' && (
        <div>
          <div className="relative mb-5">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              className="matte-input pl-10 pr-10"
              placeholder="Search by username, email, or display name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searching && (
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-accent)]">
                <Loader2 size={16} className="animate-spin" />
              </div>
            )}
          </div>

          {searchQuery.trim().length > 0 && searchQuery.trim().length < 2 && (
            <p className="text-xs text-[var(--color-text-muted)] mb-4">Please type at least 2 characters to search campus directory...</p>
          )}

          <div className="space-y-3">
            {searchResults.map((u) => (
              <UserCard
                key={u.id}
                user={u}
                actions={
                  <>
                    {u.friendshipStatus === 'accepted' && (
                      <Link to={`/messages/${u.id}`} className="btn btn-primary text-xs py-1.5 px-3 flex items-center gap-1 shadow-xs">
                        <MessageSquare size={13} /> Message
                      </Link>
                    )}
                    {u.friendshipStatus === 'accepted' ? (
                      <button
                        onClick={() => handleAction('remove', u.friendshipId)}
                        className="btn btn-secondary text-[var(--color-danger)] text-xs py-1.5 px-3"
                        disabled={actionLoading === u.friendshipId}
                      >
                        Unfriend
                      </button>
                    ) : u.friendshipStatus === 'pending' ? (
                      u.isRequester ? (
                        <button
                          onClick={() => handleAction('remove', u.friendshipId)}
                          className="btn btn-secondary text-xs py-1.5 px-3 text-[var(--color-danger)]"
                          disabled={actionLoading === u.friendshipId}
                        >
                          Cancel Request
                        </button>
                      ) : (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleAction('accept', u.friendshipId)}
                            className="btn btn-primary text-xs py-1.5 px-3"
                            disabled={actionLoading === u.friendshipId}
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => handleAction('reject', u.friendshipId)}
                            className="btn btn-secondary text-xs py-1.5 px-3"
                            disabled={actionLoading === u.friendshipId}
                          >
                            Reject
                          </button>
                        </div>
                      )
                    ) : (
                      <button
                        onClick={() => handleAction('send', u.id)}
                        className="btn btn-primary text-xs py-1.5 px-3 shadow-xs flex items-center gap-1"
                        disabled={actionLoading === u.id}
                      >
                        {actionLoading === u.id ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                        <span>Add Friend</span>
                      </button>
                    )}
                  </>
                }
              />
            ))}
            {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
              <div className="glass-card p-8 text-center border border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-text-muted)]">No users found matching &quot;{searchQuery}&quot;</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

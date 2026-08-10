/**
 * FriendsPage — View friends, pending requests, and search for users.
 */

import { useState, useEffect, useCallback } from 'react';
import { friendApi } from '../api/friendApi';
import { userApi } from '../api/userApi';
import resolveAsset from '../utils/resolveAsset';

export default function FriendsPage() {
  const [tab, setTab] = useState('friends'); // 'friends' | 'requests' | 'sent' | 'search'
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
      setFriends(friendsRes.data.data || []);
      setRequests(requestsRes.data.data || []);
      setSent(sentRes.data.data || []);
    } catch (err) {
      console.error('Failed to fetch friends data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Live autocomplete search with debounce
  useEffect(() => {
    if (tab !== 'search' || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await userApi.searchUsers(searchQuery);
        setSearchResults(res.data.data || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => { clearTimeout(timer); setSearching(false); };
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
        setSearchResults(res.data.data || []);
      }
    } catch (err) {
      setMessage(err.response?.data?.error?.message || err.response?.data?.message || 'Action failed.');
    } finally {
      setActionLoading('');
    }
  };

  const tabs = [
    { key: 'friends', label: 'Friends', count: friends.length },
    { key: 'requests', label: 'Requests', count: requests.length },
    { key: 'sent', label: 'Sent', count: sent.length },
    { key: 'search', label: 'Find People' },
  ];

  const UserCard = ({ user, actions }) => (
    <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
      <div className="flex items-center gap-3">
        {user.avatarUrl ? (
          <img src={resolveAsset(user.avatarUrl)} alt="" className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white font-bold text-sm">
            {user.displayName?.charAt(0)?.toUpperCase() || '?'}
          </div>
        )}
        <div>
          <p className="font-semibold text-sm">{user.displayName}</p>
          {user.username && <p className="text-xs text-[var(--color-text-muted)]">@{user.username}</p>}
          {user.email && <p className="text-xs text-[var(--color-text-muted)]">{user.email}</p>}
        </div>
      </div>
      <div className="flex gap-2">
        {actions}
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Friends</h1>

        {message && (
          <div className="alert alert-info mb-4">
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 bg-[var(--color-bg-secondary)] rounded-xl">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                tab === t.key
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {t.label} {t.count !== undefined && `(${t.count})`}
            </button>
          ))}
        </div>

        {loading && <p className="text-center text-[var(--color-text-muted)] animate-pulse">Loading...</p>}

        {/* Friends list */}
        {tab === 'friends' && (
          <div className="space-y-3">
            {friends.length === 0 && !loading && (
              <p className="text-center text-[var(--color-text-muted)] py-8">No friends yet. Search for people to connect!</p>
            )}
            {friends.map(f => (
              <UserCard key={f.friendshipId} user={f} actions={
                <>
                  <a href={`/messages/${f.id}`} className="btn btn-primary text-xs py-1.5 px-3">Message</a>
                  <button 
                    onClick={() => handleAction('remove', f.friendshipId)} 
                    className="btn btn-secondary text-xs py-1.5 px-3"
                    disabled={actionLoading === f.friendshipId}
                  >
                    Unfriend
                  </button>
                </>
              } />
            ))}
          </div>
        )}

        {/* Pending requests */}
        {tab === 'requests' && (
          <div className="space-y-3">
            {requests.length === 0 && !loading && (
              <p className="text-center text-[var(--color-text-muted)] py-8">No pending requests.</p>
            )}
            {requests.map(r => (
              <UserCard key={r.friendshipId} user={r} actions={
                <>
                  <button onClick={() => handleAction('accept', r.friendshipId)} className="btn btn-primary text-xs py-1.5 px-3" disabled={actionLoading === r.friendshipId}>Accept</button>
                  <button onClick={() => handleAction('reject', r.friendshipId)} className="btn btn-secondary text-xs py-1.5 px-3" disabled={actionLoading === r.friendshipId}>Reject</button>
                </>
              } />
            ))}
          </div>
        )}

        {/* Sent requests */}
        {tab === 'sent' && (
          <div className="space-y-3">
            {sent.length === 0 && !loading && (
              <p className="text-center text-[var(--color-text-muted)] py-8">No sent requests.</p>
            )}
            {sent.map(s => (
              <UserCard key={s.friendshipId} user={s} actions={
                <>
                  <span className="text-xs text-[var(--color-warning)] bg-[var(--color-bg-card)] px-3 py-1.5 rounded-lg flex items-center">Pending</span>
                  <button 
                    onClick={() => handleAction('remove', s.friendshipId)} 
                    className="btn btn-secondary text-xs py-1.5 px-3"
                    disabled={actionLoading === s.friendshipId}
                  >
                    Cancel
                  </button>
                </>
              } />
            ))}
          </div>
        )}

        {/* Search */}
        {tab === 'search' && (
          <div>
            <div className="relative mb-4">
              <input
                type="text"
                className="input w-full"
                placeholder="Search by username, email, or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              {searching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <span className="spinner" style={{ width: 16, height: 16 }} />
                </div>
              )}
            </div>
            {searchQuery.trim().length > 0 && searchQuery.trim().length < 2 && (
              <p className="text-xs text-[var(--color-text-muted)] mb-4">Type at least 2 characters to search...</p>
            )}
            <div className="space-y-3">
              {searchResults.map(u => (
                <UserCard key={u.id} user={u} actions={
                  <>
                    <a href={`/messages/${u.id}`} className="btn btn-secondary text-[var(--color-accent)] text-xs py-1.5 px-3">
                      Message
                    </a>
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
                          className="btn btn-secondary text-xs py-1.5 px-3"
                          disabled={actionLoading === u.friendshipId}
                        >
                          Cancel Request
                        </button>
                      ) : (
                        <div className="flex gap-1">
                          <button onClick={() => handleAction('accept', u.friendshipId)} className="btn btn-primary text-xs py-1.5 px-3" disabled={actionLoading === u.friendshipId}>Accept</button>
                          <button onClick={() => handleAction('reject', u.friendshipId)} className="btn btn-secondary text-xs py-1.5 px-3" disabled={actionLoading === u.friendshipId}>Reject</button>
                        </div>
                      )
                    ) : (
                      <button 
                        onClick={() => handleAction('send', u.id)} 
                        className="btn btn-primary text-xs py-1.5 px-3"
                        disabled={actionLoading === u.id}
                      >
                        Add Friend
                      </button>
                    )}
                  </>
                } />
              ))}
              {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <p className="text-center text-[var(--color-text-muted)] py-8">No users found matching &quot;{searchQuery}&quot;</p>
              )}
            </div>
          </div>
        )}
      </div>
  );
}


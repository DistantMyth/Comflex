/**
 * UserProfilePanel — Discord-style user profile sidebar.
 * Shows user info, stats, cohort tags, and friend actions.
 * Slides in from the right when a user's name is clicked in chat.
 */

import { useState, useEffect } from 'react';
import { userApi } from '../api/userApi';
import { friendApi } from '../api/friendApi';
import { storeApi } from '../api/storeApi';
import Avatar from './Avatar';

const RING_LABELS = ['Admin', 'Manager', 'Elevated', 'Member'];

export default function UserProfilePanel({ userId, onClose, currentUserId }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setMessage('');
    userApi.getUserProfile(userId)
      .then((res) => setProfile(res.data.data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [userId]);

  const handleFriendAction = async (action) => {
    setActionLoading(true);
    setMessage('');
    try {
      if (action === 'send') {
        await friendApi.sendRequest(userId);
        setMessage('Friend request sent!');
      } else if (action === 'accept') {
        await friendApi.accept(profile.friendshipId);
        setMessage('Friend request accepted!');
      } else if (action === 'remove') {
        await friendApi.remove(profile.friendshipId);
        setMessage('Friend removed.');
      }
      // Refresh profile to get updated friendship status
      const res = await userApi.getUserProfile(userId);
      setProfile(res.data.data);
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Action failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTransfer = async () => {
    const amount = parseInt(transferAmount, 10);
    if (!amount || amount <= 0) return setMessage('Enter a valid amount');
    setActionLoading(true);
    setMessage('');
    try {
      await storeApi.transferCredits(userId, amount);
      setMessage(`Successfully sent ${amount} credits.`);
      setShowTransfer(false);
      setTransferAmount('');
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Transfer failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const isSelf = userId === currentUserId;

  if (!userId) return null;

  return (
    <div className="w-80 flex-shrink-0 border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col h-full overflow-y-auto">
      {/* Close button */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
        <h3 className="font-semibold text-sm">User Profile</h3>
        <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg">
          ✕
        </button>
      </div>

      {loading ? (
        <div className="p-6 space-y-4">
          <div className="skeleton h-20 w-20 rounded-full mx-auto" />
          <div className="skeleton h-5 w-32 mx-auto" />
          <div className="skeleton h-4 w-24 mx-auto" />
        </div>
      ) : !profile ? (
        <div className="p-6 text-center text-[var(--color-text-muted)]">
          <p>User not found.</p>
        </div>
      ) : (
        <div className="p-5 space-y-5">
          {/* Avatar & Name */}
          <div className="text-center">
            <Avatar 
              src={profile.avatarUrl} 
              name={profile.displayName} 
              className="w-20 h-20 rounded-full mx-auto border-2 border-[var(--color-border)]" 
            />
            <h3 className="text-lg font-bold mt-3">{profile.displayName}</h3>
            {profile.username && (
              <p className="text-sm text-[var(--color-text-muted)]">@{profile.username}</p>
            )}
            <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs text-white ring-badge-${Math.min(profile.globalRing, 3)}`}>
              {RING_LABELS[profile.globalRing] || 'Restricted'}
            </span>
          </div>

          {/* Bio */}
          {profile.bio && (
            <div className="bg-[var(--color-bg-card)] rounded-xl p-3">
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{profile.bio}</p>
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            {profile.cfHandle && (
              <div className="bg-[var(--color-bg-card)] rounded-xl p-3 text-center">
                <p className="text-xs text-[var(--color-text-muted)] mb-1">Codeforces</p>
                <p className="text-sm font-semibold">{profile.cfHandle}</p>
                {profile.cfRating && (
                  <p className="text-xs text-[var(--color-accent-light)]">{profile.cfRating}</p>
                )}
              </div>
            )}
            <div className="bg-[var(--color-bg-card)] rounded-xl p-3 text-center">
              <p className="text-xs text-[var(--color-text-muted)] mb-1">Credits</p>
              <p className="text-sm font-semibold">{profile.globalRing === 0 ? '∞' : (profile.creditBalance ?? 0)}</p>
            </div>
            <div className="bg-[var(--color-bg-card)] rounded-xl p-3 text-center">
              <p className="text-xs text-[var(--color-text-muted)] mb-1">Joined</p>
              <p className="text-sm font-semibold">{new Date(profile.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          {/* Cohort Tags */}
          {profile.cohortTags?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">Cohort Groups</p>
              <div className="flex flex-wrap gap-1.5">
                {profile.cohortTags.map((tag) => (
                  <span key={tag} className="px-2 py-1 chip-accent rounded-full text-xs">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Badges */}
          {profile.displayBadges?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">Badges</p>
              <div className="flex flex-wrap gap-1.5">
                {profile.displayBadges.map((badge) => (
                  <span key={badge} className="px-2 py-1 bg-[var(--color-bg-card)] rounded-full text-xs">
                    {badge}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Message */}
          {message && (
            <div className={`text-xs p-2 rounded-lg text-center ${
              message.includes('sent') || message.includes('accepted')
                ? 'bg-[rgba(16,185,129,0.1)] text-green-400'
                : 'bg-[rgba(239,68,68,0.1)] text-red-400'
            }`}>{message}</div>
          )}

          {/* Friend Actions */}
          {!isSelf && (
            <div className="space-y-2">
              <a href={`/messages/${userId}`} className="btn btn-primary w-full text-center text-sm block">
                💬 Message
              </a>
              {profile.friendshipStatus === 'accepted' ? (
                <button
                  onClick={() => handleFriendAction('remove')}
                    disabled={actionLoading}
                    className="btn btn-secondary w-full text-sm"
                  >
                    Unfriend
                  </button>
              ) : profile.friendshipStatus === 'pending' ? (
                profile.isRequester ? (
                  <button disabled className="btn btn-secondary w-full text-sm">
                    ⏳ Request Sent
                  </button>
                ) : (
                  <button
                    onClick={() => handleFriendAction('accept')}
                    disabled={actionLoading}
                    className="btn btn-primary w-full text-sm"
                  >
                    ✅ Accept Request
                  </button>
                )
              ) : (
                <button
                  onClick={() => handleFriendAction('send')}
                  disabled={actionLoading}
                  className="btn btn-primary w-full text-sm"
                >
                  {actionLoading ? <span className="spinner" /> : '👋 Send Friend Request'}
                </button>
              )}
              
              <div className="pt-2 border-t border-[var(--color-border)]">
                {showTransfer ? (
                  <div className="flex flex-col gap-2">
                    <input type="number" placeholder="Amount..." min="1" value={transferAmount} onChange={e => setTransferAmount(e.target.value)}
                           className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2 rounded text-sm focus:outline-[var(--color-accent)]" />
                    <div className="flex gap-2">
                      <button onClick={handleTransfer} disabled={actionLoading} className="btn bg-[var(--color-success)] text-white w-full text-sm">Send</button>
                      <button onClick={() => setShowTransfer(false)} className="btn btn-secondary w-full text-sm">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowTransfer(true)} className="btn btn-secondary w-full text-sm">
                    🪙 Send Credits
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

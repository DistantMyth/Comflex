/**
 * UserProfilePanel — Discord-style user profile sidebar / drawer.
 * Shows user details, stats, cohort tags, badges, friend interactions, and credit transfer.
 * Styled with matte frosted glass and Comflex palette (#efc7c2, #ffe5d4, #bfd3c1, #68a691, #694f5d).
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  X,
  MessageSquare,
  UserPlus,
  UserCheck,
  UserMinus,
  UserX,
  Coins,
  Send,
  Award,
  Calendar,
  Code2,
  Sparkles,
  ShieldCheck,
  Shield,
  Clock,
  Loader2,
  Check,
  AlertCircle,
} from 'lucide-react';
import { userApi } from '../api/userApi';
import { friendApi } from '../api/friendApi';
import { storeApi } from '../api/storeApi';
import Avatar from './Avatar';
import resolveAsset from '../utils/resolveAsset';

const RING_CONFIG = {
  0: { label: 'Admin', color: 'ring-badge-0', icon: ShieldCheck },
  1: { label: 'Manager', color: 'ring-badge-1', icon: Shield },
  2: { label: 'Elevated', color: 'ring-badge-2', icon: Award },
  3: { label: 'Member', color: 'ring-badge-3', icon: null },
};

export default function UserProfilePanel({
  userId,
  onClose,
  currentUserId,
  className = '',
}) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', text: string }
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [badgeMap, setBadgeMap] = useState({});

  // Fetch all store badges once on mount to populate badge names and images
  useEffect(() => {
    storeApi.getAllBadges()
      .then((res) => {
        const map = {};
        (res.data?.data || []).forEach((b) => {
          map[b.id] = b;
        });
        setBadgeMap(map);
      })
      .catch(() => {});
  }, []);

  // Fetch target user's profile whenever userId changes
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setFeedback(null);
    setShowTransfer(false);
    setTransferAmount('');

    userApi.getUserProfile(userId)
      .then((res) => setProfile(res.data?.data || null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [userId]);

  // Handle ESC key to close panel
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && onClose) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const refreshProfile = async () => {
    try {
      const res = await userApi.getUserProfile(userId);
      setProfile(res.data?.data || null);
    } catch {
      // Keep existing profile on silent refresh error
    }
  };

  const handleFriendAction = async (action) => {
    setActionLoading(true);
    setFeedback(null);
    try {
      if (action === 'send') {
        await friendApi.sendRequest(userId);
        setFeedback({ type: 'success', text: 'Friend request sent!' });
      } else if (action === 'accept') {
        await friendApi.accept(profile.friendshipId);
        setFeedback({ type: 'success', text: 'Friend request accepted!' });
      } else if (action === 'reject') {
        await friendApi.reject(profile.friendshipId);
        setFeedback({ type: 'success', text: 'Friend request declined.' });
      } else if (action === 'remove') {
        await friendApi.remove(profile.friendshipId);
        setFeedback({ type: 'success', text: 'Friend removed.' });
      }
      await refreshProfile();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error?.message || err.response?.data?.message || 'Action failed. Please try again.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleTransfer = async (e) => {
    e?.preventDefault();
    const amount = parseInt(transferAmount, 10);
    if (!amount || amount <= 0) {
      setFeedback({ type: 'error', text: 'Please enter a valid credit amount.' });
      return;
    }

    setActionLoading(true);
    setFeedback(null);
    try {
      await storeApi.transferCredits(userId, amount);
      setFeedback({ type: 'success', text: `Successfully sent ${amount} credits!` });
      setShowTransfer(false);
      setTransferAmount('');
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.error?.message || err.response?.data?.message || 'Credit transfer failed.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  if (!userId) return null;

  const isSelf = userId === currentUserId;
  const ringIndex = Math.min(profile?.globalRing ?? 3, 3);
  const ringInfo = RING_CONFIG[ringIndex] || RING_CONFIG[3];
  const RingIcon = ringInfo.icon;

  return (
    <aside
      className={`w-full max-w-xs sm:w-80 md:w-88 max-w-[100vw] flex-shrink-0 border-l border-[var(--color-border)] bg-[var(--color-bg-matte)] backdrop-blur-2xl flex flex-col h-full overflow-hidden shadow-2xl z-20 select-none ${className}`}
      aria-label="User Profile"
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-[var(--color-accent)]" />
          <h3 className="font-display font-bold text-sm tracking-wide text-[var(--color-text-primary)]">
            User Profile
          </h3>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-all cursor-pointer"
          aria-label="Close profile panel"
          type="button"
        >
          <X size={17} />
        </button>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {loading ? (
          <div className="py-12 space-y-4 text-center">
            <div className="w-20 h-20 rounded-full mx-auto animate-pulse bg-[var(--color-border)]" />
            <div className="h-4 w-32 mx-auto rounded animate-pulse bg-[var(--color-border)]" />
            <div className="h-3 w-20 mx-auto rounded animate-pulse bg-[var(--color-border)]/60" />
            <div className="flex items-center justify-center gap-2 pt-4 text-xs text-[var(--color-text-muted)]">
              <Loader2 size={15} className="animate-spin text-[var(--color-accent)]" />
              <span>Loading profile...</span>
            </div>
          </div>
        ) : !profile ? (
          <div className="py-16 text-center text-[var(--color-text-muted)] space-y-2">
            <AlertCircle size={28} className="mx-auto text-[var(--color-text-muted)] opacity-60" />
            <p className="text-sm font-medium">User not found or unavailable.</p>
          </div>
        ) : (
          <>
            {/* User Hero / Avatar Card */}
            <div className="relative rounded-2xl p-5 border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-sm text-center overflow-hidden">
              {/* Decorative background aura with palette gradient */}
              <div
                className="absolute -top-12 -left-12 w-32 h-32 rounded-full opacity-35 blur-2xl pointer-events-none"
                style={{ backgroundColor: 'var(--palette-rose)' }}
              />
              <div
                className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-30 blur-2xl pointer-events-none"
                style={{ backgroundColor: 'var(--palette-teal)' }}
              />

              <div className="relative inline-block">
                <Avatar
                  src={profile.avatarUrl}
                  name={profile.displayName}
                  className="w-22 h-22 rounded-full mx-auto ring-4 ring-[var(--color-bg-matte)] shadow-md object-cover"
                />
              </div>

              <h2 className="text-lg font-bold font-display text-[var(--color-text-primary)] mt-3 truncate">
                {profile.displayName}
              </h2>

              {profile.username && (
                <p className="text-xs text-[var(--color-text-muted)] font-mono mt-0.5">
                  @{profile.username}
                </p>
              )}

              {/* Ring RBAC Badge */}
              <div className="mt-2.5 flex items-center justify-center">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shadow-xs ${ringInfo.color}`}
                >
                  {RingIcon && <RingIcon size={13} />}
                  <span>{ringInfo.label}</span>
                </span>
              </div>
            </div>

            {/* Bio Section */}
            {profile.bio && (
              <div className="p-3.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]/80 backdrop-blur-sm">
                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                  About
                </p>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                  {profile.bio}
                </p>
              </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-2.5">
              {profile.cfHandle ? (
                <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]/70 text-center">
                  <div className="flex items-center justify-center gap-1 text-[11px] text-[var(--color-text-muted)] font-medium mb-1">
                    <Code2 size={13} className="text-[var(--color-accent)]" />
                    <span>Codeforces</span>
                  </div>
                  <p className="text-sm font-bold text-[var(--color-text-primary)] truncate">
                    {profile.cfHandle}
                  </p>
                  {profile.cfRating != null && (
                    <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--palette-teal)]/15 text-[var(--palette-teal)]">
                      {profile.cfRating}
                    </span>
                  )}
                </div>
              ) : null}

              <div className={`p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]/70 text-center ${!profile.cfHandle ? 'col-span-2' : ''}`}>
                <div className="flex items-center justify-center gap-1 text-[11px] text-[var(--color-text-muted)] font-medium mb-1">
                  <Calendar size={13} className="text-[var(--palette-rose)]" />
                  <span>Joined</span>
                </div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {profile.createdAt
                    ? new Date(profile.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        year: 'numeric',
                      })
                    : 'Unknown'}
                </p>
              </div>
            </div>

            {/* Academic Cohort Tags */}
            {profile.cohortTags?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                  Academic Cohorts
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.cohortTags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--palette-rose)]/15 text-[var(--palette-plum)] dark:text-[var(--palette-rose)] border border-[var(--palette-rose)]/30"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Displayed Badges */}
            {profile.displayBadges?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                  Showcased Badges
                </p>
                <div className="flex flex-wrap gap-2">
                  {profile.displayBadges.map((badgeId) => {
                    const badge = badgeMap[badgeId];
                    const badgeImg = badge?.imageUrl ? resolveAsset(badge.imageUrl) : null;
                    const badgeName = badge?.name || 'Badge';
                    return (
                      <div
                        key={badgeId}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-full text-xs shadow-xs hover:border-[var(--color-accent)] transition-all"
                        title={badge?.description || badgeName}
                      >
                        {badgeImg ? (
                          <img
                            src={badgeImg}
                            alt={badgeName}
                            className="w-4 h-4 object-contain rounded-full flex-shrink-0"
                            loading="lazy"
                          />
                        ) : (
                          <Award size={14} className="text-[var(--color-warning)] flex-shrink-0" />
                        )}
                        <span className="font-semibold text-[var(--color-text-primary)] truncate max-w-[110px]">
                          {badgeName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Feedback / Alert Notice */}
            {feedback && (
              <div
                className={`flex items-center gap-2 p-3 rounded-xl text-xs font-medium border ${
                  feedback.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
                }`}
              >
                {feedback.type === 'success' ? <Check size={15} /> : <AlertCircle size={15} />}
                <span className="flex-1">{feedback.text}</span>
              </div>
            )}

            {/* Action Buttons Section */}
            {!isSelf && (
              <div className="space-y-2.5 pt-2 border-t border-[var(--color-border)]">
                {/* Send Direct Message */}
                <Link
                  to={`/messages/${userId}`}
                  onClick={onClose}
                  className="btn btn-primary w-full flex items-center justify-center gap-2 text-sm shadow-md"
                >
                  <MessageSquare size={16} />
                  <span>Direct Message</span>
                </Link>

                {/* Friendship Action Buttons */}
                {profile.friendshipStatus === 'accepted' ? (
                  <button
                    onClick={() => handleFriendAction('remove')}
                    disabled={actionLoading}
                    className="btn btn-secondary w-full flex items-center justify-center gap-2 text-sm text-red-500 dark:text-red-400 hover:border-red-400/40"
                    type="button"
                  >
                    {actionLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <>
                        <UserMinus size={16} />
                        <span>Remove Friend</span>
                      </>
                    )}
                  </button>
                ) : profile.friendshipStatus === 'pending' ? (
                  profile.isRequester ? (
                    <button
                      disabled
                      className="btn btn-secondary w-full flex items-center justify-center gap-2 text-sm opacity-75 cursor-not-allowed"
                      type="button"
                    >
                      <Clock size={16} className="text-[var(--color-warning)]" />
                      <span>Request Sent</span>
                    </button>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleFriendAction('accept')}
                        disabled={actionLoading}
                        className="btn btn-primary flex items-center justify-center gap-1.5 text-xs font-bold"
                        type="button"
                      >
                        {actionLoading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <>
                            <UserCheck size={14} />
                            <span>Accept</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleFriendAction('reject')}
                        disabled={actionLoading}
                        className="btn btn-secondary flex items-center justify-center gap-1.5 text-xs text-red-500 dark:text-red-400 hover:border-red-400/40"
                        type="button"
                      >
                        {actionLoading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <>
                            <UserX size={14} />
                            <span>Decline</span>
                          </>
                        )}
                      </button>
                    </div>
                  )
                ) : (
                  <button
                    onClick={() => handleFriendAction('send')}
                    disabled={actionLoading}
                    className="btn btn-secondary w-full flex items-center justify-center gap-2 text-sm hover:border-[var(--color-accent)]"
                    type="button"
                  >
                    {actionLoading ? (
                      <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
                    ) : (
                      <>
                        <UserPlus size={16} className="text-[var(--color-accent)]" />
                        <span>Send Friend Request</span>
                      </>
                    )}
                  </button>
                )}

                {/* Credit Transfer Toggle & Form */}
                <div className="pt-2 border-t border-[var(--color-border)]/60">
                  {showTransfer ? (
                    <form onSubmit={handleTransfer} className="space-y-2 p-3 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)]">
                      <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] font-semibold mb-1">
                        <span className="flex items-center gap-1.5">
                          <Coins size={13} className="text-[var(--color-warning)]" />
                          Transfer Credits
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowTransfer(false)}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <input
                        type="number"
                        placeholder="Amount of credits..."
                        min="1"
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        className="matte-input text-xs py-2"
                        autoFocus
                      />

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="submit"
                          disabled={actionLoading || !transferAmount}
                          className="btn btn-primary text-xs py-1.5 flex items-center justify-center gap-1"
                        >
                          {actionLoading ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <>
                              <Send size={12} />
                              <span>Send</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowTransfer(false)}
                          disabled={actionLoading}
                          className="btn btn-secondary text-xs py-1.5"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => setShowTransfer(true)}
                      className="btn btn-ghost w-full flex items-center justify-center gap-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card)]"
                      type="button"
                    >
                      <Coins size={14} className="text-[var(--color-warning)]" />
                      <span>Send Campus Credits</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/**
 * CreateGroupModal — Modal for creating a new custom group in Comflex.
 * Features:
 * - Matte + Glassy design system with blush, bisque, sage, sage teal, and slate mauve palette.
 * - Framer Motion spring backdrop and container scaling.
 * - Avatar selection with preview and removal.
 * - Group name, display name, and rich description inputs.
 * - Anonymous group toggle with alias setup and one-time key backup flow.
 * - Interactive friend selector with search filter and selected count.
 * - Full feature parity with legacy implementation.
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Camera,
  Upload,
  Users,
  Lock,
  Sparkles,
  Check,
  Search,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { friendApi } from '../api/friendApi';
import { groupApi } from '../api/groupApi';
import { setAnonSession } from '../api/client';
import BackupKeyModal from './BackupKeyModal';
import Avatar from './Avatar';

export default function CreateGroupModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [friends, setFriends] = useState([]);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [alias, setAlias] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingAnonGroup, setPendingAnonGroup] = useState(null); // { group, identity }
  const fileRef = useRef(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !pendingAnonGroup) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pendingAnonGroup]);

  // Load friends list
  useEffect(() => {
    let mounted = true;
    friendApi
      .listFriends()
      .then((res) => {
        if (mounted) {
          setFriends(res?.data?.data || []);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Cleanup object URL preview on unmount or file change
  useEffect(() => {
    return () => {
      if (avatarPreview) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const removeAvatar = (e) => {
    e.stopPropagation();
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const toggleFriend = (friendId) => {
    setSelectedFriends((prev) =>
      prev.includes(friendId) ? prev.filter((id) => id !== friendId) : [...prev, friendId]
    );
  };

  const selectAllFilteredFriends = () => {
    const filteredIds = filteredFriends.map((f) => f.id);
    const newSelected = Array.from(new Set([...selectedFriends, ...filteredIds]));
    setSelectedFriends(newSelected);
  };

  const clearSelectedFriends = () => {
    setSelectedFriends([]);
  };

  const filteredFriends = friends.filter((f) => {
    if (!friendSearch.trim()) return true;
    const q = friendSearch.toLowerCase();
    return (
      f.displayName?.toLowerCase().includes(q) ||
      f.username?.toLowerCase().includes(q) ||
      f.email?.toLowerCase().includes(q)
    );
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Group name is required.');
    if (isAnonymous && !alias.trim()) {
      return setError('Your alias is required for anonymous groups.');
    }

    setLoading(true);
    setError('');

    try {
      const baseSlug =
        name
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '') || 'group';
      const slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;

      const res = await groupApi.createGroup({
        name: slug,
        displayName: displayName.trim() || name.trim(),
        description: description.trim(),
        type: 'custom',
        memberIds: isAnonymous ? [] : selectedFriends,
        isAnonymous,
      });

      const group = res.data?.data?.group || res.data?.data;

      // Upload avatar if selected
      if (avatarFile && group?.id) {
        try {
          await groupApi.uploadGroupAvatar(group.id, avatarFile);
        } catch {
          // Non-critical, group is still successfully created
        }
      }

      // Anonymous groups: claim first alias and trigger backup key flow
      if (isAnonymous && group?.id) {
        const claimRes = await groupApi.claimAnonIdentity(group.id, alias.trim());
        const idn = claimRes.data?.data;
        setAnonSession(group.id, {
          identityId: idn.identityId,
          secret: idn.secret,
          alias: idn.alias,
          aliasTag: idn.aliasTag,
          avatarUrl: idn.avatarUrl,
        });
        setPendingAnonGroup({ group, identity: idn });
        return; // wait for user key acknowledgement in BackupKeyModal
      }

      onCreated?.(group);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to create group.');
    } finally {
      setLoading(false);
    }
  };

  const handleAnonKeyDone = () => {
    if (!pendingAnonGroup) return;
    const { group, identity: idn } = pendingAnonGroup;
    setAnonSession(group.id, {
      identityId: idn.identityId,
      secret: idn.secret,
      alias: idn.alias,
      aliasTag: idn.aliasTag,
      avatarUrl: idn.avatarUrl,
    });
    onCreated?.(group);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        {/* Animated Spring Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="fixed inset-0 bg-black/60 backdrop-blur-md"
          onClick={onClose}
        />

        {/* Modal Window Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.93, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.93, y: 15 }}
          transition={{ type: 'spring', damping: 27, stiffness: 320 }}
          className="relative w-full max-w-xl max-h-[92vh] flex flex-col rounded-3xl glass-card border border-[var(--color-border)] shadow-2xl z-10 overflow-hidden my-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4.5 border-b border-[var(--color-border)] bg-[var(--color-bg-matte)]/60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#efc7c2] to-[#68a691] flex items-center justify-center text-white shadow-sm">
                <Sparkles size={19} className="stroke-[2.2]" />
              </div>
              <div>
                <h2 className="text-lg font-bold font-display text-[var(--color-text-primary)]">
                  Create New Group
                </h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Start a study room, club, or project team
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Avatar Upload */}
            <div className="flex flex-col items-center justify-center pt-1 pb-2">
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="relative w-22 h-22 rounded-3xl bg-gradient-to-br from-[#ffe5d4] via-[#efc7c2] to-[#68a691] p-0.5 shadow-md hover:shadow-lg transition-all duration-200 overflow-hidden flex items-center justify-center"
                >
                  <div className="w-full h-full rounded-[22px] bg-[var(--color-bg-matte)] flex items-center justify-center overflow-hidden">
                    {avatarPreview ? (
                      <img
                        src={avatarPreview}
                        alt="Group Avatar Preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors">
                        <Camera size={26} className="stroke-[1.8]" />
                        <span className="text-[10px] font-semibold mt-1">Upload</span>
                      </div>
                    )}
                  </div>
                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white">
                    <Upload size={18} />
                    <span className="text-[10px] font-bold mt-1">Change</span>
                  </div>
                </button>

                {avatarPreview && (
                  <button
                    type="button"
                    onClick={removeAvatar}
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-[var(--color-danger)] text-white flex items-center justify-center shadow-md hover:scale-110 transition-transform"
                    title="Remove avatar"
                  >
                    <X size={13} strokeWidth={2.5} />
                  </button>
                )}
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <span className="text-[11px] text-[var(--color-text-muted)] mt-2 font-medium">
                Optional custom group icon
              </span>
            </div>

            {/* Group Name (Required) */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
                Group Name <span className="text-[var(--color-accent)]">*</span>
              </label>
              <input
                type="text"
                className="matte-input"
                placeholder="e.g. Distributed Systems Lab"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {/* Display Name (Optional) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Display Title
                </label>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  Defaults to group name
                </span>
              </div>
              <input
                type="text"
                className="matte-input"
                placeholder="e.g. CS401 Distributed Systems Research Group"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
                Description
              </label>
              <textarea
                className="matte-input resize-none"
                rows={3}
                placeholder="Share the purpose, meeting schedules, or project goals..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Anonymous Group Mode Toggle */}
            <div className="p-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30 hover:bg-[var(--color-bg-secondary)]/50 transition-colors">
              <label className="flex items-start gap-3.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded text-[var(--color-accent)] focus:ring-[var(--color-accent)] border-[var(--color-border)] cursor-pointer accent-[#68a691]"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Lock size={15} className="text-[var(--color-accent)]" />
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">
                      Anonymous Group
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-[var(--palette-bisque)] text-[#694f5d] border border-[#efc7c2]/50">
                      Zero-Knowledge
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                    No member or administrator can link aliases back to your real student account. Your identity is a device-bound cryptographic secret.
                  </p>
                </div>
              </label>

              {/* Anonymous Alias Input */}
              {isAnonymous && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 pt-3.5 border-t border-[var(--color-border)]"
                >
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
                    Your Creator Alias <span className="text-[var(--color-accent)]">*</span>
                  </label>
                  <input
                    type="text"
                    className="matte-input"
                    placeholder="e.g. GhostCoder, ShadowRaven"
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    maxLength={32}
                    required
                  />
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5 flex items-center gap-1.5">
                    <ShieldCheck size={13} className="text-[var(--color-accent)] flex-shrink-0" />
                    <span>
                      A unique one-time backup secret key will be generated for you after creation.
                    </span>
                  </p>
                </motion.div>
              )}
            </div>

            {/* Friend Selection (Hidden if Anonymous) */}
            {!isAnonymous && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users size={15} className="text-[var(--color-accent)]" />
                    <label className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                      Invite Friends
                    </label>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[var(--color-accent-tint)] text-[var(--color-accent)] border border-[var(--color-accent-light)]/40">
                      {selectedFriends.length} selected
                    </span>
                  </div>
                  {friends.length > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={selectAllFilteredFriends}
                        className="text-[var(--color-accent)] hover:underline font-medium"
                      >
                        Select all
                      </button>
                      <span className="text-[var(--color-border)]">|</span>
                      <button
                        type="button"
                        onClick={clearSelectedFriends}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] font-medium"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                {friends.length === 0 ? (
                  <div className="text-center p-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/20">
                    <p className="text-xs text-[var(--color-text-muted)]">
                      No friends found yet. You can invite friends to this group anytime later!
                    </p>
                  </div>
                ) : (
                  <div className="border border-[var(--color-border)] rounded-2xl p-2.5 bg-[var(--color-bg-primary)]/70 space-y-2">
                    {/* Search bar inside friends list */}
                    <div className="relative">
                      <Search
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                      />
                      <input
                        type="text"
                        className="w-full pl-8.5 pr-3 py-1.5 text-xs rounded-xl bg-[var(--color-bg-input)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                        placeholder="Search your friends..."
                        value={friendSearch}
                        onChange={(e) => setFriendSearch(e.target.value)}
                      />
                    </div>

                    {/* Friend Scrollable List */}
                    <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                      {filteredFriends.length === 0 ? (
                        <p className="text-center py-4 text-xs text-[var(--color-text-muted)]">
                          No matching friends found.
                        </p>
                      ) : (
                        filteredFriends.map((f) => {
                          const isSelected = selectedFriends.includes(f.id);
                          return (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => toggleFriend(f.id)}
                              className={`w-full flex items-center gap-3 p-2 rounded-xl text-left transition-all ${
                                isSelected
                                  ? 'bg-[var(--color-accent-tint)] border border-[var(--color-accent)] shadow-sm'
                                  : 'hover:bg-[var(--color-bg-secondary)] border border-transparent'
                              }`}
                            >
                              <Avatar
                                src={f.avatarUrl}
                                name={f.displayName || f.username}
                                className="w-8 h-8 rounded-full ring-1 ring-[var(--color-border)] flex-shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-[var(--color-text-primary)] truncate">
                                  {f.displayName || f.username}
                                </p>
                                {f.username && (
                                  <p className="text-[10px] text-[var(--color-text-muted)] truncate">
                                    @{f.username}
                                  </p>
                                )}
                              </div>
                              <div
                                className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                                  isSelected
                                    ? 'bg-[var(--color-accent)] text-white scale-100 shadow-sm'
                                    : 'border border-[var(--color-border)] bg-[var(--color-bg-input)]'
                                }`}
                              >
                                {isSelected && <Check size={12} className="stroke-[3]" />}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2.5 p-3 rounded-2xl bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 text-[var(--color-danger)] text-xs font-medium"
              >
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center gap-3 pt-3 border-t border-[var(--color-border)]">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="btn btn-secondary flex-1 py-2.5 rounded-2xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="btn btn-primary flex-1 py-2.5 rounded-2xl text-xs font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : (
                  'Create Group'
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>

      {/* One-time key backup modal for anonymous group creation */}
      {pendingAnonGroup && (
        <BackupKeyModal
          groupName={pendingAnonGroup.group.displayName || pendingAnonGroup.group.name}
          identity={pendingAnonGroup.identity}
          onDone={handleAnonKeyDone}
        />
      )}
    </>
  );
}

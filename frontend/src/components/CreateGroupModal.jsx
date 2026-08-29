/**
 * CreateGroupModal — Modal for creating a new group.
 * Lets user specify name, description, optional avatar, and add friends as initial members.
 */

import { useState, useEffect, useRef } from 'react';
import { friendApi } from '../api/friendApi';
import { groupApi } from '../api/groupApi';
import { setAnonSession } from '../api/client';
import BackupKeyModal from './BackupKeyModal';
import resolveAsset from '../utils/resolveAsset';

export default function CreateGroupModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [friends, setFriends] = useState([]);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [alias, setAlias] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingAnonGroup, setPendingAnonGroup] = useState(null); // { group, identity }
  const fileRef = useRef(null);

  useEffect(() => {
    friendApi.listFriends()
      .then(res => setFriends(res.data.data || []))
      .catch(() => {});
  }, []);

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const toggleFriend = (friendId) => {
    setSelectedFriends(prev =>
      prev.includes(friendId) ? prev.filter(id => id !== friendId) : [...prev, friendId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Group name is required.');
    if (isAnonymous && !alias.trim()) return setError('Your alias is required for anonymous groups.');

    setLoading(true);
    setError('');

    try {
      const baseSlug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'group';
      const slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
      const res = await groupApi.createGroup({
        name: slug,
        displayName: displayName.trim() || name.trim(),
        description: description.trim(),
        type: 'custom',
        memberIds: isAnonymous ? [] : selectedFriends,
        isAnonymous,
      });

      const group = res.data.data?.group || res.data.data;

      // Upload avatar if selected
      if (avatarFile && group?.id) {
        try {
          await groupApi.uploadGroupAvatar(group.id, avatarFile);
        } catch {
          // Non-critical, group is still created
        }
      }

      // Anonymous groups: creator claims the first alias — the returned
      // secret is stored on this device only, and the key shown via modal.
      if (isAnonymous && group?.id) {
        const claimRes = await groupApi.claimAnonIdentity(group.id, alias.trim());
        const idn = claimRes.data.data;
        setAnonSession(group.id, {
          identityId: idn.identityId,
          secret: idn.secret,
          alias: idn.alias,
          aliasTag: idn.aliasTag,
          avatarUrl: idn.avatarUrl,
        });
        setPendingAnonGroup({ group, identity: idn });
        return; // wait for ack before finishing
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Create Group</h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Avatar */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center text-white text-2xl font-bold overflow-hidden hover:opacity-90 transition-opacity"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <span>📷</span>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity text-xs">
                Upload
              </div>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Group Name *</label>
            <input
              type="text"
              className="input w-full"
              placeholder="e.g. Study Group DS"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Display Name</label>
            <input
              type="text"
              className="input w-full"
              placeholder="e.g. Data Structures Study Group"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Description</label>
            <textarea
              className="input w-full resize-none"
              rows={3}
              placeholder="What's this group about?"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* Anonymous group toggle */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={e => setIsAnonymous(e.target.checked)}
                  className="rounded text-[var(--color-accent)]"
                />
                <span>🔒 Anonymous group</span>
              </label>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                No one can link aliases to your account — your identity is a
                device key that only you hold.
              </p>
            </div>
          </div>

          {isAnonymous && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Your Alias (shown to the group) *</label>
              <input
                type="text"
                className="input w-full"
                placeholder="e.g. NightOwl"
                value={alias}
                onChange={e => setAlias(e.target.value)}
                maxLength={32}
                required
              />
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                You'll receive a one-time cryptographic key after creation —
                keep it safe to restore your identity on another device.
              </p>
            </div>
          )}

          {/* Add Friends */}
          {!isAnonymous && friends.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">Add Friends ({selectedFriends.length} selected)</label>
              <div className="max-h-40 overflow-y-auto space-y-1 border border-[var(--color-border)] rounded-xl p-2">
                {friends.map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFriend(f.id)}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${
                      selectedFriends.includes(f.id)
                        ? 'bg-[rgba(108,99,255,0.15)] border border-[var(--color-accent)]'
                        : 'hover:bg-[var(--color-bg-secondary)]'
                    }`}
                  >
                    {f.avatarUrl ? (
                      <img src={resolveAsset(f.avatarUrl)} alt="" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white text-xs font-bold">
                        {f.displayName?.charAt(0)?.toUpperCase()}
                      </div>
                    )}
                    <span className="text-sm font-medium flex-1">{f.displayName}</span>
                    {selectedFriends.includes(f.id) && <span className="text-[var(--color-accent)]">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-[var(--color-danger)] bg-[rgba(255,71,87,0.1)] p-3 rounded-lg">{error}</p>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1">
              {loading ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>

      {/* One-time key backup for anonymous group creation */}
      {pendingAnonGroup && (
        <BackupKeyModal
          groupName={pendingAnonGroup.group.displayName || pendingAnonGroup.group.name}
          identity={pendingAnonGroup.identity}
          onDone={handleAnonKeyDone}
        />
      )}
    </div>
  );
}

/**
 * GroupSettingsPanel — Full group settings accessible from chat header.
 *
 * Features:
 * - Edit group name, description, avatar
 * - Manage member permissions (toggle individual permissions)
 * - Promote/demote members (change ring level)
 * - Search & filter members
 * - Invite new members (with user search)
 * - Pending invites management
 * - Leave group option
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { groupApi } from '../api/groupApi';
import resolveAsset from '../utils/resolveAsset';

const DEFAULT_RING_LABELS = ['Admin', 'Manager', 'Elevated', 'Member', 'Restricted'];

const PERMISSION_LABELS = {
  can_send_messages: 'Send Messages',
  can_delete_own_messages: 'Delete Own Messages',
  can_delete_others_messages: 'Delete Others\' Messages',
  can_mute_members: 'Mute Members',
  can_kick_members: 'Kick Members',
  can_add_members: 'Add Members',
  can_tag_members: 'Tag Members',
  can_pin_messages: 'Pin Messages',
  can_manage_roles: 'Manage Roles',
  can_edit_group_info: 'Edit Group Info',
  can_stop_others_tagging: 'Stop Others from Tagging',
};

export default function GroupSettingsPanel({ groupId, group, currentUserId, onClose, onGroupUpdated }) {
  const [tab, setTab] = useState('info');
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState(group?.displayName || '');
  const [editDesc, setEditDesc] = useState(group?.description || '');
  const [saving, setSaving] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const fileRef = useRef(null);

  // Invite search state
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [inviteStatus, setInviteStatus] = useState({}); // { [userId]: 'invited' | 'added' | 'error' }
  const inviteTimeoutRef = useRef(null);

  // Get ring labels (custom or default)
  const ringConfig = useMemo(() => group?.ringConfig || {}, [group?.ringConfig]);
  const ringLabels = useMemo(() => ringConfig.ringLabels || {}, [ringConfig]);
  const ringCount = ringConfig.ringCount || DEFAULT_RING_LABELS.length;
  const ringPermissions = useMemo(() => ringConfig.ringPermissions || {}, [ringConfig]);
  const defaultRing = ringConfig.defaultRing !== undefined ? ringConfig.defaultRing : 3;
  const getRingLabel = (ring) => ringLabels[ring] || DEFAULT_RING_LABELS[ring] || `Ring ${ring}`;

  const [editRingCount, setEditRingCount] = useState(ringCount);
  const [editRingLabels, setEditRingLabels] = useState({ ...ringLabels });
  const [editRingPermissions, setEditRingPermissions] = useState({ ...ringPermissions });
  const [editDefaultRing, setEditDefaultRing] = useState(defaultRing);
  const [savingRoles, setSavingRoles] = useState(false);

  // Invite Link State
  const [inviteLinkToken, setInviteLinkToken] = useState(null);
  const [fetchingLink, setFetchingLink] = useState(false);

  // Sync state if group config changes
  useEffect(() => {
    setEditRingCount(ringCount);
    setEditRingLabels({ ...ringLabels });
    setEditRingPermissions({ ...ringPermissions });
    setEditDefaultRing(defaultRing);
  }, [ringCount, ringLabels, ringPermissions, defaultRing]);

  useEffect(() => {
    if (!groupId) return;
    setLoading(true);
    Promise.all([
      groupApi.listMembers(groupId).then(r => setMembers(r.data.data || [])),
      groupApi.listGroupInvites(groupId).then(r => setInvites(r.data.data || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [groupId]);

  const currentMember = members.find(m => m.id === currentUserId);
  const isHighestLevel = currentMember?.groupRing === 0 || currentMember?.isCreator || group?.creatorId === currentUserId;
  const isGroupAdmin = isHighestLevel;
  const canManageRoles = currentMember?.permissions?.can_manage_roles || isGroupAdmin;
  const canAddMembers = currentMember?.permissions?.can_add_members || isGroupAdmin;

  // Filter members by search query
  const filteredMembers = memberSearch.trim()
    ? members.filter(m =>
        m.displayName?.toLowerCase().includes(memberSearch.toLowerCase()) ||
        m.username?.toLowerCase().includes(memberSearch.toLowerCase()) ||
        m.email?.toLowerCase().includes(memberSearch.toLowerCase())
      )
    : members;

  // Invite search with debounce
  const handleInviteSearch = useCallback((q) => {
    setInviteQuery(q);
    clearTimeout(inviteTimeoutRef.current);
    if (q.trim().length < 2) {
      setInviteResults([]);
      return;
    }
    inviteTimeoutRef.current = setTimeout(async () => {
      setInviteSearching(true);
      try {
        const res = await groupApi.searchUsersForGroup(groupId, q.trim());
        setInviteResults(res.data.data || []);
      } catch { setInviteResults([]); }
      finally { setInviteSearching(false); }
    }, 400);
  }, [groupId]);

  const handleInviteUser = async (userId) => {
    try {
      const res = await groupApi.addMember(groupId, userId);
      const data = res.data.data;
      if (data.invited) {
        setInviteStatus(prev => ({ ...prev, [userId]: 'invited' }));
        // Refresh invites
        groupApi.listGroupInvites(groupId).then(r => setInvites(r.data.data || [])).catch(() => {});
      } else {
        setInviteStatus(prev => ({ ...prev, [userId]: 'added' }));
        // Refresh members
        groupApi.listMembers(groupId).then(r => setMembers(r.data.data || [])).catch(() => {});
      }
    } catch (err) {
      setInviteStatus(prev => ({ ...prev, [userId]: 'error' }));
      alert(err.response?.data?.error?.message || 'Failed to invite user.');
    }
  };

  const handleGetInviteLink = async () => {
    setFetchingLink(true);
    try {
      const res = await groupApi.getInviteLink(groupId);
      setInviteLinkToken(res.data.data.token);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to get invite link.');
    } finally {
      setFetchingLink(false);
    }
  };

  const currentInviteUrl = inviteLinkToken ? `${window.location.origin}/join/${inviteLinkToken}` : '';

  const handleSaveRoles = async () => {
    setSavingRoles(true);
    try {
      const res = await groupApi.updateRingConfig(groupId, {
        ringCount: editRingCount,
        ringLabels: editRingLabels,
        ringPermissions: editRingPermissions,
        defaultRing: editDefaultRing,
      });
      onGroupUpdated?.(res.data.data);
      alert('Roles updated successfully.');
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to update roles.');
    } finally {
      setSavingRoles(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!confirm('Are you sure you want to leave this group?')) return;
    try {
      await groupApi.leaveGroup(groupId);
      // Wait a moment then redirect or let layout handle fallback
      window.location.href = '/dashboard';
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to leave group.');
    }
  };

  const handleDeleteGroup = async () => {
    if (!confirm('Are you sure you want to completely DELETE this group? This cannot be undone.')) return;
    try {
      await groupApi.deleteGroup(groupId);
      window.location.href = '/dashboard';
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to delete group.');
    }
  };

  const handleSaveInfo = async () => {
    setSaving(true);
    try {
      const res = await groupApi.updateGroup(groupId, {
        displayName: editName.trim(),
        description: editDesc.trim(),
      });
      onGroupUpdated?.(res.data.data);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to update group.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await groupApi.uploadGroupAvatar(groupId, file);
      onGroupUpdated?.(res.data.data);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to upload avatar.');
    }
  };

  const handleRingChange = async (userId, newRing) => {
    try {
      await groupApi.setMemberRing(groupId, userId, parseInt(newRing));
      const res = await groupApi.listMembers(groupId);
      setMembers(res.data.data || []);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to change ring.');
    }
  };

  const handlePermissionToggle = async (userId, permKey, currentValue) => {
    const member = members.find(m => m.id === userId);
    if (!member) return;
    const newPerms = { ...(member.permissions || {}), [permKey]: !currentValue };
    try {
      await groupApi.setMemberPermissions(groupId, userId, newPerms);
      setMembers(prev => prev.map(m =>
        m.id === userId ? { ...m, permissions: newPerms } : m
      ));
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to update permission.');
    }
  };

  const handleKick = async (userId) => {
    if (!confirm('Remove this member from the group?')) return;
    try {
      await groupApi.removeMember(groupId, userId);
      setMembers(prev => prev.filter(m => m.id !== userId));
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to remove member.');
    }
  };

  const tabs = [
    { id: 'info', label: '📝 Info' },
    { id: 'members', label: `👥 Members (${members.length})` },
    { id: 'invites', label: `📩 Invites (${invites.length})` },
    ...(canManageRoles ? [{ id: 'roles', label: '🛡️ Roles' }] : []),
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="glass-card w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-bold">Group Settings</h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-xl">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--color-border)]">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="skeleton h-12 w-full" />)}
            </div>
          ) : tab === 'info' ? (
            /* ── Info Tab ── */
            <div className="space-y-5">
              {/* Avatar */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => isGroupAdmin && fileRef.current?.click()}
                  className="relative w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center text-white text-2xl font-bold"
                  style={{ cursor: isGroupAdmin ? 'pointer' : 'default' }}
                >
                  {group?.avatarUrl ? (
                    <img src={resolveAsset(group.avatarUrl)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span>{group?.displayName?.charAt(0) || '#'}</span>
                  )}
                  {isGroupAdmin && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity text-xs">📷</div>
                  )}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              </div>

              {isGroupAdmin ? (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Display Name</label>
                    <input
                      type="text"
                      className="input w-full"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Description</label>
                    <textarea
                      className="input w-full resize-none"
                      rows={3}
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                    />
                  </div>
                  <button onClick={handleSaveInfo} disabled={saving} className="btn btn-primary w-full">
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </>
              ) : (
                <div className="text-center text-[var(--color-text-muted)] text-sm">
                  Only group admins can edit group info.
                </div>
              )}

              <div className="pt-3 flex gap-3">
                {(!currentMember?.isCreator && group?.creatorId !== currentUserId) && (
                  <button onClick={handleLeaveGroup} className="btn btn-secondary text-[var(--color-warning)] hover:border-[var(--color-warning)] w-full">Leave Group</button>
                )}
                {isHighestLevel && (
                  <button onClick={handleDeleteGroup} className="btn bg-[var(--color-danger)] text-white w-full">Delete Group</button>
                )}
              </div>

              <div className="pt-3 border-t border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-text-muted)]">
                  Group ID: {groupId}<br />
                  Type: {group?.type}<br />
                  Created: {new Date(group?.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          ) : tab === 'members' ? (
            /* ── Members Tab ── */
            <div className="space-y-3">
              {/* Search & Invite area */}
              <div className="space-y-3 mb-2">
                {/* Member search/filter */}
                <input
                  type="text"
                  placeholder="🔍 Search members..."
                  className="input w-full text-sm"
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                />

                {/* Invite new members */}
                {canAddMembers && (
                  <div className="p-3 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                    <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">➕ Invite New Member</p>
                    <input
                      type="text"
                      placeholder="Search by name, username, or email..."
                      className="input w-full text-sm mb-2"
                      value={inviteQuery}
                      onChange={e => handleInviteSearch(e.target.value)}
                    />
                    {inviteSearching && (
                      <p className="text-xs text-[var(--color-text-muted)] animate-pulse">Searching...</p>
                    )}
                    {inviteResults.length > 0 && (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {inviteResults.map(u => (
                          <div key={u.id} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-bg-secondary)]">
                            {u.avatarUrl ? (
                              <img src={resolveAsset(u.avatarUrl)} alt="" className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white text-xs font-bold">
                                {u.displayName?.charAt(0)?.toUpperCase()}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{u.displayName}</p>
                              <p className="text-xs text-[var(--color-text-muted)]">{u.username ? `@${u.username}` : u.email}</p>
                            </div>
                            {u.isMember ? (
                              <span className="text-xs px-2 py-1 rounded-full bg-[var(--color-success)] text-white">Member</span>
                            ) : u.hasPendingInvite || inviteStatus[u.id] === 'invited' ? (
                              <span className="text-xs px-2 py-1 rounded-full bg-[var(--color-warning)] text-white">Invited</span>
                            ) : inviteStatus[u.id] === 'added' ? (
                              <span className="text-xs px-2 py-1 rounded-full bg-[var(--color-success)] text-white">Added ✓</span>
                            ) : (
                              <button
                                onClick={() => handleInviteUser(u.id)}
                                className="btn btn-primary text-xs px-3 py-1"
                              >
                                Invite
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {inviteQuery.length >= 2 && !inviteSearching && inviteResults.length === 0 && (
                      <p className="text-xs text-[var(--color-text-muted)] text-center py-2">No users found.</p>
                    )}

                    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                      <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">🔗 Shareable Invite Link</p>
                      {!inviteLinkToken ? (
                        <button
                          onClick={handleGetInviteLink}
                          disabled={fetchingLink}
                          className="btn btn-secondary text-xs px-4 py-2 w-full"
                        >
                          {fetchingLink ? 'Generating...' : 'Generate Invite Link'}
                        </button>
                      ) : (
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            className="input w-full text-xs font-mono bg-[var(--color-bg-secondary)]"
                            readOnly
                            value={currentInviteUrl}
                          />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(currentInviteUrl);
                              alert('Link copied to clipboard!');
                            }}
                            className="btn btn-primary text-xs px-3 py-2 flex-shrink-0"
                          >
                            Copy
                          </button>
                        </div>
                      )}
                      <p className="text-[10px] text-[var(--color-text-muted)] mt-2">Anyone with this link can join the group.</p>
                    </div>
                  </div>
                )}
              </div>

              {selectedMember ? (
                /* Member detail / permission editor */
                <div>
                  <button onClick={() => setSelectedMember(null)} className="text-sm text-[var(--color-accent)] hover:underline mb-4">
                    ← Back to Members
                  </button>
                  {(() => {
                    const m = members.find(mem => mem.id === selectedMember);
                    if (!m) return null;
                    const perms = m.permissions || {};
                    return (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          {m.avatarUrl ? (
                            <img src={resolveAsset(m.avatarUrl)} alt="" className="w-12 h-12 rounded-full object-cover" />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white font-bold">
                              {m.displayName?.charAt(0)?.toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-semibold">{m.displayName}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">
                              {m.username && `@${m.username} · `}
                              {getRingLabel(m.groupRing)}
                              {m.isCreator && ' · 👑 Creator'}
                            </p>
                          </div>
                        </div>

                        {/* Ring selector */}
                        {canManageRoles && !m.isCreator && (
                          <div>
                            <label className="block text-sm font-medium mb-1.5">Role (Ring Level)</label>
                            <select
                              className="input w-full"
                              value={m.groupRing}
                              onChange={e => handleRingChange(m.id, e.target.value)}
                            >
                              {Array.from({ length: ringCount }, (_, i) => (
                                <option key={i} value={i}>{i} — {getRingLabel(i)}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Permissions toggles */}
                        {canManageRoles && !m.isCreator && (
                          <div>
                            <label className="block text-sm font-medium mb-2">Permissions</label>
                            <div className="space-y-1.5">
                              {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                                <label key={key} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--color-bg-secondary)] cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!perms[key]}
                                    onChange={() => handlePermissionToggle(m.id, key, perms[key])}
                                    className="w-4 h-4 rounded accent-[var(--color-accent)]"
                                  />
                                  <span className="text-sm">{label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Kick */}
                        {canManageRoles && !m.isCreator && m.id !== currentUserId && (
                          <button onClick={() => handleKick(m.id)} className="btn bg-[var(--color-danger)] text-white w-full hover:opacity-90">
                            Remove from Group
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                /* Members list */
                <>
                  {filteredMembers.length === 0 ? (
                    <p className="text-center text-sm text-[var(--color-text-muted)] py-4">No members match your search.</p>
                  ) : (
                    filteredMembers.map(m => (
                      <div
                        key={m.id}
                        className="flex items-center gap-3 p-3 rounded-xl hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
                        onClick={() => canManageRoles && m.id !== currentUserId && setSelectedMember(m.id)}
                      >
                        {m.avatarUrl ? (
                          <img src={resolveAsset(m.avatarUrl)} alt="" className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white text-sm font-bold">
                            {m.displayName?.charAt(0)?.toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {m.displayName}
                            {m.isCreator && <span className="ml-1.5 text-xs">👑</span>}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {getRingLabel(m.groupRing)}
                          </p>
                        </div>
                        {canManageRoles && m.id !== currentUserId && !m.isCreator && (
                          <span className="text-xs text-[var(--color-text-muted)]">⚙️</span>
                        )}
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          ) : tab === 'invites' ? (
            /* ── Invites Tab ── */
            <div className="space-y-2">
              {invites.length === 0 ? (
                <p className="text-center text-sm text-[var(--color-text-muted)] py-8">No pending invites.</p>
              ) : (
                invites.map(inv => (
                  <div key={inv.id} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--color-bg-secondary)]">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white text-xs font-bold">
                      {inv.user?.displayName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{inv.user?.displayName}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Invited by {inv.invitedByUser?.displayName}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-[var(--color-warning)] text-white">Pending</span>
                  </div>
                ))
              )}
            </div>
          ) : tab === 'roles' && canManageRoles ? (
            /* ── Roles Tab ── */
            <div className="space-y-5">
              <div className="p-4 bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border)]">
                <h3 className="text-sm font-bold mb-1">Role Architecture</h3>
                <p className="text-xs text-[var(--color-text-muted)] mb-4">
                  Groups are structured into "Rings". Ring 0 is the highest (usually Admin).
                  Members with a higher ring number have lower privileges.
                </p>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Total Number of Rings (2-10)</label>
                      <select
                        className="input w-full"
                        value={editRingCount}
                        onChange={e => {
                          const val = parseInt(e.target.value);
                          setEditRingCount(val);
                          // Ensure default ring stays inside bounds if ring count drastically shrinks
                          if (editDefaultRing >= val) setEditDefaultRing(val - 1);
                        }}
                      >
                        {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(h => <option key={h} value={h}>{h} Rings</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Default Ring on Join</label>
                      <select
                        className="input w-full"
                        value={editDefaultRing}
                        onChange={e => setEditDefaultRing(parseInt(e.target.value))}
                      >
                        {Array.from({ length: editRingCount }, (_, i) => (
                          <option key={`def-ring-${i}`} value={i}>
                            Ring {i}: {editRingLabels[i] || DEFAULT_RING_LABELS[i] || `Ring ${i}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Ring Names</label>
                    <div className="space-y-2">
                      {Array.from({ length: editRingCount }, (_, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-xs font-mono w-12 text-[var(--color-text-muted)]">Ring {i}</span>
                          <input
                            type="text"
                            className="input flex-1 py-1 px-3 text-sm"
                            value={editRingLabels[i] || DEFAULT_RING_LABELS[i] || `Ring ${i}`}
                            onChange={e => setEditRingLabels({ ...editRingLabels, [i]: e.target.value })}
                            placeholder={`e.g. ${DEFAULT_RING_LABELS[i] || 'Member'}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-3 mt-4">Ring Default Permissions</label>
                    <div className="space-y-4">
                      {Array.from({ length: editRingCount }, (_, i) => (
                        <div key={`perm-${i}`} className="p-3 bg-[var(--color-bg-primary)] rounded-lg border border-[var(--color-border)]">
                          <p className="text-sm font-semibold mb-2">Ring {i}: {editRingLabels[i] || DEFAULT_RING_LABELS[i] || `Ring ${i}`}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                            {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                              <label key={key} className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-[var(--color-bg-secondary)]">
                                <input
                                  type="checkbox"
                                  className="w-3.5 h-3.5 rounded accent-[var(--color-accent)]"
                                  checked={!!editRingPermissions[i]?.[key]}
                                  onChange={e => {
                                    const val = e.target.checked;
                                    setEditRingPermissions(prev => ({
                                      ...prev,
                                      [i]: { ...(prev[i] || {}), [key]: val }
                                    }));
                                  }}
                                />
                                <span className="text-xs text-[var(--color-text-primary)]">{label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button onClick={handleSaveRoles} disabled={savingRoles} className="btn btn-primary w-full mt-4">
                    {savingRoles ? 'Saving...' : 'Save Role Configuration'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

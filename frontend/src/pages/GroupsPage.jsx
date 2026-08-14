/**
 * GroupsPage — Lists all groups the user belongs to.
 * Shows unread badges, group avatars, and "Create Group" button.
 * Shows pending group invites.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { groupApi } from '../api/groupApi';
import { adminApi } from '../api/adminApi';
import { setAnonSession } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Mail, MessagesSquare, Users, KeyRound, Trash2 } from 'lucide-react';
import CreateGroupModal from '../components/CreateGroupModal';
import CreateCohortGroupModal from '../components/CreateCohortGroupModal';
import BackupKeyModal from '../components/BackupKeyModal';
import resolveAsset from '../utils/resolveAsset';

const TYPE_LABELS = { primary: 'Cohort', 'cross-year': 'Cross-Year', custom: 'Custom' };
const TYPE_ICONS = { primary: '🎓', 'cross-year': '🔗', custom: '✨' };

export default function GroupsPage() {
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState('');
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateCohort, setShowCreateCohort] = useState(false);
  const [aliasGroupId, setAliasGroupId] = useState(null); // anon invite awaiting alias
  const [pendingAnon, setPendingAnon] = useState(null); // { inviteId, groupId, identity }
  const [aliasInput, setAliasInput] = useState('');
  const [loadingAliasInvite, setLoadingAliasInvite] = useState(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.globalRing === 0;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [groupsRes, invitesRes] = await Promise.all([
        groupApi.listGroups().catch(() => ({ data: { data: [] } })),
        groupApi.listMyInvites().catch(() => ({ data: { data: [] } })),
      ]);
      setGroups(groupsRes?.data?.data || groupsRes?.data || []);
      setInvites(invitesRes?.data?.data || invitesRes?.data || []);
    } catch { /* ignore list errors */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAcceptInvite = async (groupId, inviteId) => {
    try {
      const res = await groupApi.acceptInvite(groupId, inviteId);
      const payload = res.data.data;
      if (payload?.identityId && payload?.secret) {
        // Save session immediately so it's not lost on modal close
        setAnonSession(groupId, {
          identityId: payload.identityId,
          secret: payload.secret,
          alias: payload.alias,
          aliasTag: payload.aliasTag,
          avatarUrl: payload.avatarUrl,
        });
        setPendingAnon({ inviteId, groupId, identity: payload });
        return;
      }
      fetchData();
    } catch (err) {
      const apiErr = err.response?.data?.error;
      if (apiErr?.code === 'ALIAS_REQUIRED') {
        setAliasGroupId(groupId);
        return;
      }
      alert(apiErr?.message || 'Failed to accept invite.');
    }
  };

  const handleRejectInvite = async (groupId, inviteId) => {
    try {
      await groupApi.rejectInvite(groupId, inviteId);
      setInvites(prev => prev.filter(i => i.id !== inviteId));
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to reject invite.');
    }
  };

  const acceptAnonWithAlias = async (groupId, inviteId) => {
    if (!aliasInput.trim()) return;
    setLoadingAliasInvite(inviteId);
    try {
      const res = await groupApi.acceptInvite(groupId, inviteId, aliasInput.trim());
      const payload = res.data.data;
      setAliasGroupId(null);
      setAliasInput('');
      if (payload?.identityId && payload?.secret) {
        setAnonSession(groupId, {
          identityId: payload.identityId,
          secret: payload.secret,
          alias: payload.alias,
          aliasTag: payload.aliasTag,
          avatarUrl: payload.avatarUrl,
        });
      }
      setPendingAnon({ groupId, identity: payload });
    } catch (err) {
      setAliasGroupId(null);
      setAliasInput('');
      alert(err.response?.data?.error?.message || 'Failed to accept invite.');
    } finally {
      setLoadingAliasInvite(null);
    }
  };

  const handlePendingAnonDone = () => {
    if (!pendingAnon) return;
    const { groupId, identity } = pendingAnon;
    setAnonSession(groupId, {
      identityId: identity.identityId,
      secret: identity.secret,
      alias: identity.alias,
      aliasTag: identity.aliasTag,
      avatarUrl: identity.avatarUrl,
    });
    setPendingAnon(null);
    fetchData();
  };

  const canDeleteGroup = (group) =>
    isAdmin ||
    group.creatorId === user?.id ||
    (!group.isAnonymous && group.userRing === 0);

  const handleDeleteGroup = async (e, group) => {
    e.preventDefault();
    e.stopPropagation();
    const name = group.displayName || group.name;
    if (!confirm(`Delete "${name}" permanently? This cannot be undone.`)) return;
    try {
      await groupApi.deleteGroup(group.id);
      setGroups(prev => prev.filter(g => g.id !== group.id));
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to delete group.');
    }
  };

  return (
    <>
    <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Groups</h1>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <span className="text-xs px-2.5 py-1 rounded-full chip-accent">
                Admin View — All Groups
              </span>
            )}
            {user?.canCreateGroups && (
               <button onClick={() => setShowCreateCohort(true)} className="btn btn-secondary text-sm px-4 py-2 border border-[var(--color-accent)]">
                 + Create Cohort Group
               </button>
            )}
            <button onClick={() => setShowCreate(true)} className="btn btn-primary text-sm px-4 py-2">
              + Create Group
            </button>
            <span className="text-sm text-[var(--color-text-muted)]">{groups.length} groups</span>
          </div>
        </div>

        <input
          type="text"
          placeholder="Search groups by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full mb-6 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
        />

        {/* Pending Invites */}
        {invites.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
              <span className="inline-flex items-center gap-1.5"><Mail size={14} /> Pending Invites ({invites.length})</span>
            </h2>
            <div className="space-y-2">
              {invites.map(inv => (
                <div key={inv.id} className="glass-card p-4 flex items-center gap-4 border border-[var(--color-warning)] border-opacity-30">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--color-warning)] to-[var(--color-accent)] flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
                    {inv.group?.avatarUrl ? (
                      <img src={resolveAsset(inv.group.avatarUrl)} alt="" className="w-full h-full rounded-xl object-cover" />
                    ) : (
                      inv.group?.displayName?.charAt(0) || '#'
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{inv.group?.displayName || inv.group?.name}</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Invited by {inv.invitedByUser?.displayName} · {inv.group?.memberCount} members
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAcceptInvite(inv.groupId, inv.id)}
                      disabled={loadingAliasInvite === inv.id}
                      className="btn btn-primary text-xs px-3 py-1.5"
                    >
                      {loadingAliasInvite === inv.id ? 'Joining...' : 'Accept'}
                    </button>
                      {aliasGroupId === inv.groupId && (
                        <input
                          autoFocus
                          type="text"
                          placeholder="Choose an anonymous alias..."
                          value={aliasInput}
                          maxLength={32}
                          onChange={e => setAliasInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') acceptAnonWithAlias(inv.groupId, inv.id);
                          }}
                          className="input !w-44 !py-1.5 !text-xs"
                        />
                      )}
                    <button
                      onClick={() => handleRejectInvite(inv.groupId, inv.id)}
                      className="btn btn-secondary text-xs px-3 py-1.5"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-20 w-full rounded-xl" />)}
          </div>
        ) : groups.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/25 flex items-center justify-center">
              <MessagesSquare size={30} className="text-[var(--color-accent)]" />
            </div>
            <h2 className="text-lg font-semibold mb-2 font-display">No Groups Yet</h2>
            <p className="text-[var(--color-text-secondary)] text-sm mb-4">
              Create a group to start chatting with your friends!
            </p>
            <button onClick={() => setShowCreate(true)} className="btn btn-primary">
              Create Your First Group
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.filter(g => (g.displayName || g.name || '').toLowerCase().includes(search.toLowerCase())).map((group) => (
              <Link
                key={group.id}
                to={`/groups/${group.id}`}
                className="glass-card p-4 flex items-center gap-4 hover:border-[var(--color-accent)] border border-transparent transition-all"
              >
                {/* Group avatar */}
                {group.avatarUrl ? (
                  <img src={resolveAsset(group.avatarUrl)} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
                    {group.displayName?.charAt(0) || group.name?.charAt(0)?.toUpperCase() || '#'}
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{group.displayName || group.name}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {TYPE_ICONS[group.type] || '✨'} {TYPE_LABELS[group.type] || group.type}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      <Users size={11} className="inline mr-0.5" /> {group.memberCount || group._count?.members || 0} members
                    </span>
                    {group.description && (
                      <span className="text-xs text-[var(--color-text-muted)] truncate hidden md:inline">
                        {group.description}
                      </span>
                    )}
                  </div>
                </div>

                {/* Unread badge */}
                {group.unreadCount > 0 && (
                  <span className="bg-[var(--color-danger)] text-white text-xs rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5 font-bold">
                    {group.unreadCount > 99 ? '99+' : group.unreadCount}
                  </span>
                )}

                {/* Needs key restore badge */}
                {group.needsKeyRestore && (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border border-[var(--color-warning)] text-[var(--color-warning)]"
                    title="Your anonymous identity key for this group was removed from this device. Click to restore it."
                  >
                    <KeyRound size={12} /> Restore key
                  </span>
                )}

                {/* Ring / Anon badge */}
                {group.isAnonymous ? (
                  <span className="px-2.5 py-1 rounded-full text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-accent)] text-[var(--color-accent)]">
                    {group.myIdentity?.alias ? `Anon · ${group.myIdentity.alias}${group.myIdentity.aliasTag ? '#' + group.myIdentity.aliasTag : ''}` : 'Anonymous'}
                  </span>
                ) : group.userRing !== null && group.userRing !== undefined ? (
                  <span className={`px-2.5 py-1 rounded-full text-xs text-white ring-badge-${Math.min(group.userRing ?? 3, 3)}`}>
                    Ring {group.userRing}
                  </span>
                ) : isAdmin ? (
                  <span className="px-2.5 py-1 rounded-full text-xs text-white bg-[var(--color-accent)]">
                    Admin
                  </span>
                ) : null}

                {/* Delete group (creator or admin) */}
                {canDeleteGroup(group) && (
                  <button
                    onClick={(e) => handleDeleteGroup(e, group)}
                    title="Delete group"
                    className="p-2 rounded-lg text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors flex-shrink-0"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateGroupModal
          onClose={() => setShowCreate(false)}
          onCreated={(group) => {
            fetchData();
            if (group?.id) navigate(`/groups/${group.id}`);
          }}
        />
      )}

      {showCreateCohort && (
        <CreateCohortGroupModal
          onClose={() => setShowCreateCohort(false)}
          onCreated={(group) => {
            fetchData();
            if (group?.id) navigate(`/groups/${group.id}`);
          }}
        />
      )}
    {pendingAnon && (
        <BackupKeyModal
          groupName={pendingAnon.identity.alias ? `your anonymous group` : 'this group'}
          identity={pendingAnon.identity}
          onDone={handlePendingAnonDone}
        />
      )}
    </>
  );
}

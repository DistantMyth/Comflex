import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail, MessagesSquare, Users, KeyRound, Trash2, Plus, Search,
  GraduationCap, Sparkles, AlertCircle, ArrowRight, Loader2
} from 'lucide-react';
import { groupApi } from '../api/groupApi';
import { setAnonSession, removeAnonSession } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import CreateGroupModal from '../components/CreateGroupModal';
import CreateCohortGroupModal from '../components/CreateCohortGroupModal';
import BackupKeyModal from '../components/BackupKeyModal';
import resolveAsset from '../utils/resolveAsset';

const TYPE_LABELS = { primary: 'Academic Cohort', 'cross-year': 'Cross-Cohort', custom: 'Community Squad' };
const TYPE_ICONS = { primary: '🎓', 'cross-year': '🔗', custom: '✨' };

export default function GroupsPage() {
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState('');
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateCohort, setShowCreateCohort] = useState(false);
  const [aliasGroupId, setAliasGroupId] = useState(null);
  const [pendingAnon, setPendingAnon] = useState(null);
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
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAcceptInvite = async (groupId, inviteId) => {
    try {
      const res = await groupApi.acceptInvite(groupId, inviteId);
      const payload = res.data?.data;
      if (payload?.identityId && payload?.secret) {
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
      const payload = res.data?.data;
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
    if (!confirm(`Permanently delete "${name}"? This action cannot be undone.`)) return;
    try {
      await groupApi.deleteGroup(group.id);
      if (group.isAnonymous) {
        removeAnonSession(group.id);
      }
      setGroups(prev => prev.filter(g => g.id !== group.id));
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to delete group.');
    }
  };

  const filteredGroups = groups.filter(g =>
    (g.displayName || g.name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto pb-12">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-[var(--color-text-primary)] flex items-center gap-2">
            <MessagesSquare size={24} className="text-[var(--color-accent)]" />
            <span>Campus Groups</span>
          </h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Cohort communities, academic study hubs, and anonymous spaces
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] border border-[var(--palette-teal)]/30">
              Administrator View
            </span>
          )}
          {user?.canCreateGroups && (
            <button
              onClick={() => setShowCreateCohort(true)}
              className="btn btn-secondary text-xs py-2 px-3.5 shadow-xs flex items-center gap-1.5"
            >
              <GraduationCap size={14} />
              <span>Create Cohort</span>
            </button>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="btn btn-primary text-xs py-2 px-4 shadow-sm flex items-center gap-1.5"
          >
            <Plus size={15} />
            <span>Create Group</span>
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="text"
          placeholder="Filter groups by name or topic..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="matte-input pl-10 text-xs sm:text-sm py-2.5"
        />
      </div>

      {/* Pending Invitations Section */}
      {invites.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
            <Mail size={13} className="text-[var(--color-accent)]" />
            <span>Pending Group Invites ({invites.length})</span>
          </h2>
          <div className="space-y-2.5">
            {invites.map(inv => (
              <div
                key={inv.id}
                className="glass-card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-[var(--palette-teal)]/30 bg-[var(--palette-teal)]/5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[var(--palette-teal)] to-[var(--palette-plum)] flex items-center justify-center text-white text-base font-bold flex-shrink-0 shadow-sm">
                    {inv.group?.avatarUrl ? (
                      <img src={resolveAsset(inv.group.avatarUrl)} alt="" className="w-full h-full rounded-2xl object-cover" />
                    ) : (
                      inv.group?.displayName?.charAt(0) || '#'
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-xs sm:text-sm text-[var(--color-text-primary)] truncate">
                      {inv.group?.displayName || inv.group?.name}
                    </h3>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Invited by {inv.invitedByUser?.displayName || 'Peer'} • {inv.group?.memberCount || 0} members
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
                  {aliasGroupId === inv.groupId && (
                    <input
                      autoFocus
                      type="text"
                      placeholder="Choose anonymous alias..."
                      value={aliasInput}
                      maxLength={32}
                      onChange={e => setAliasInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') acceptAnonWithAlias(inv.groupId, inv.id);
                      }}
                      className="matte-input text-xs py-1.5 w-44"
                    />
                  )}
                  <button
                    onClick={() => handleAcceptInvite(inv.groupId, inv.id)}
                    disabled={loadingAliasInvite === inv.id}
                    className="btn btn-primary text-xs py-1.5 px-3.5 shadow-xs"
                  >
                    {loadingAliasInvite === inv.id ? 'Joining...' : 'Accept'}
                  </button>
                  <button
                    onClick={() => handleRejectInvite(inv.groupId, inv.id)}
                    className="btn btn-secondary text-xs py-1.5 px-3"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Groups List */}
      {loading ? (
        <div className="py-16 flex justify-center items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={18} className="animate-spin text-[var(--color-accent)]" />
          <span>Synchronizing campus channels...</span>
        </div>
      ) : groups.length === 0 ? (
        <div className="glass-card p-12 text-center border border-[var(--color-border)]">
          <MessagesSquare size={36} className="mx-auto text-[var(--color-text-muted)] mb-3 opacity-50" />
          <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">No Groups Found</h3>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1 max-w-sm mx-auto mb-5">
            You are not enrolled in any groups yet. Create a group or join via an invite link.
          </p>
          <button onClick={() => setShowCreate(true)} className="btn btn-primary text-xs py-2 px-4 shadow-sm">
            Create First Group
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map((group) => (
            <Link
              key={group.id}
              to={`/groups/${group.id}`}
              className="glass-card p-4 px-5 flex items-center gap-4 border border-[var(--color-border)] hover-lift transition-all group"
            >
              {/* Group Avatar */}
              {group.avatarUrl ? (
                <img src={resolveAsset(group.avatarUrl)} alt="" className="w-12 h-12 rounded-2xl object-cover flex-shrink-0 ring-1 ring-[var(--color-border)] shadow-xs" />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--palette-teal)] to-[var(--palette-plum)] flex items-center justify-center text-white text-base font-bold flex-shrink-0 shadow-xs">
                  {group.displayName?.charAt(0) || group.name?.charAt(0)?.toUpperCase() || '#'}
                </div>
              )}

              {/* Group Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors truncate">
                    {group.displayName || group.name}
                  </h3>
                  {group.unreadCount > 0 && (
                    <span className="bg-[var(--color-danger)] text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 font-bold">
                      {group.unreadCount > 99 ? '99+' : group.unreadCount}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-text-muted)]">
                  <span className="font-semibold">{TYPE_ICONS[group.type] || '✨'} {TYPE_LABELS[group.type] || group.type}</span>
                  <span>•</span>
                  <span><Users size={12} className="inline mr-1" />{group.memberCount || group._count?.members || 0} members</span>
                  {group.description && (
                    <span className="hidden md:inline truncate max-w-xs">• {group.description}</span>
                  )}
                </div>
              </div>

              {/* Needs key restore badge */}
              {group.needsKeyRestore && (
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border border-[var(--color-warning)] text-[var(--color-warning)] bg-[var(--color-warning)]/10 flex-shrink-0"
                  title="Your cryptographic alias key was not detected on this device. Click to restore."
                >
                  <KeyRound size={12} />
                  <span>Restore Key</span>
                </span>
              )}

              {/* Ring / Anon Badge */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {group.isAnonymous ? (
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[var(--palette-rose)]/20 text-[var(--palette-plum)] border border-[var(--palette-rose)]/30">
                    {group.myIdentity?.alias ? `🎭 ${group.myIdentity.alias}${group.myIdentity.aliasTag ? '#' + group.myIdentity.aliasTag : ''}` : '🎭 Anonymous'}
                  </span>
                ) : group.userRing !== null && group.userRing !== undefined ? (
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ring-badge-${Math.min(group.userRing ?? 3, 3)}`}>
                    Ring {group.userRing}
                  </span>
                ) : isAdmin ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold ring-badge-0">
                    Admin
                  </span>
                ) : null}

                {/* Delete button (creators and admins) */}
                {canDeleteGroup(group) && (
                  <button
                    onClick={(e) => handleDeleteGroup(e, group)}
                    title="Delete group"
                    className="p-2 rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Modals */}
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
          groupName={pendingAnon.identity?.alias ? `your anonymous space` : 'this channel'}
          identity={pendingAnon.identity}
          onDone={handlePendingAnonDone}
        />
      )}
    </div>
  );
}

/**
 * GroupSettingsPanel — Comprehensive group settings, RBAC role management, and moderation panel.
 *
 * Implements:
 * - Overview / Metadata edit (display name, description, avatar upload with preview & validation, metadata badges)
 * - Ring Permission configuration (dynamic ring count 2-10, custom ring titles, permission matrix per ring)
 * - Member management (search, filter, promote/demote, permission overrides, mute/unmute with duration, kick)
 * - Transfer Ownership (promote successor to Ring 0 with full ownership privileges)
 * - Word Bans / Moderation list (add, remove, test word filtering against active list)
 * - Anonymous Reports review (review reported aliases, reason history, zero-knowledge ban/unban)
 * - Invite links & search (debounced user discovery, shareable token invite link with 1-click copy)
 * - Leave & Delete group actions with high-visibility confirmation modals
 * - Matte + glassy design system (#efc7c2, #ffe5d4, #bfd3c1, #68a691, #694f5d) & Framer Motion animations
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Settings,
  Users,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserX,
  VolumeX,
  Volume2,
  Crown,
  Link2,
  Copy,
  Check,
  Search,
  Upload,
  Camera,
  Trash2,
  AlertTriangle,
  ArrowLeft,
  Plus,
  Sparkles,
  Lock,
  Loader2,
  Mail,
  UserPlus,
  ChevronRight
} from 'lucide-react';
import { groupApi } from '../api/groupApi';
import Avatar from './Avatar';
import { cn } from '../utils/cn';

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

const getRingBadgeClass = (ring) => {
  if (ring === 0) return 'ring-badge-0';
  if (ring === 1) return 'ring-badge-1';
  if (ring === 2) return 'ring-badge-2';
  return 'ring-badge-3';
};

export default function GroupSettingsPanel({
  groupId,
  group,
  currentUserId,
  isAdmin = false,
  onClose,
  onGroupUpdated,
  onGroupDeleted,
}) {
  const [tab, setTab] = useState('info');
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingReports, setLoadingReports] = useState(false);

  // Overview / metadata editing state
  const [editName, setEditName] = useState(group?.displayName || group?.name || '');
  const [editDesc, setEditDesc] = useState(group?.description || '');
  const [savingInfo, setSavingInfo] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileRef = useRef(null);

  // Toast notification state
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 3200);
  };

  // Member inspection & filtering
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [mutingMember, setMutingMember] = useState(null);
  const [muteMinutes, setMuteMinutes] = useState(60);
  const [actionLoading, setActionLoading] = useState(false);

  // Confirmation dialog states
  const [confirmKickMember, setConfirmKickMember] = useState(null);
  const [confirmTransferMember, setConfirmTransferMember] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');

  // Ring configuration state
  const ringConfig = useMemo(() => group?.ringConfig || {}, [group?.ringConfig]);
  const ringLabels = useMemo(() => ringConfig.ringLabels || {}, [ringConfig]);
  const ringCount = ringConfig.ringCount || DEFAULT_RING_LABELS.length;
  const ringPermissions = useMemo(() => ringConfig.ringPermissions || {}, [ringConfig]);
  const defaultRing = ringConfig.defaultRing !== undefined ? ringConfig.defaultRing : 3;

  const [editRingCount, setEditRingCount] = useState(ringCount);
  const [editRingLabels, setEditRingLabels] = useState({ ...ringLabels });
  const [editRingPermissions, setEditRingPermissions] = useState({ ...ringPermissions });
  const [editDefaultRing, setEditDefaultRing] = useState(defaultRing);
  const [savingRoles, setSavingRoles] = useState(false);

  // Word bans state
  const [bannedWords, setBannedWords] = useState(group?.wordBanList || []);
  const [newWordInput, setNewWordInput] = useState('');
  const [savingWordBans, setSavingWordBans] = useState(false);
  const [wordFilterTest, setWordFilterTest] = useState('');

  // Invite discovery & link state
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [inviteStatus, setInviteStatus] = useState({});
  const [inviteLinkToken, setInviteLinkToken] = useState(group?.inviteToken || null);
  const [fetchingLink, setFetchingLink] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const inviteTimeoutRef = useRef(null);

  // Sync state if group prop changes
  useEffect(() => {
    if (group) {
      setEditName(group.displayName || group.name || '');
      setEditDesc(group.description || '');
      setBannedWords(group.wordBanList || []);
      setEditRingCount(ringCount);
      setEditRingLabels({ ...ringLabels });
      setEditRingPermissions({ ...ringPermissions });
      setEditDefaultRing(defaultRing);
      if (group.inviteToken) setInviteLinkToken(group.inviteToken);
    }
  }, [group, ringCount, ringLabels, ringPermissions, defaultRing]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (confirmKickMember || confirmTransferMember || mutingMember || confirmLeave || confirmDelete) {
          setConfirmKickMember(null);
          setConfirmTransferMember(null);
          setMutingMember(null);
          setConfirmLeave(false);
          setConfirmDelete(false);
        } else if (selectedMemberId) {
          setSelectedMemberId(null);
        } else {
          onClose?.();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, confirmKickMember, confirmTransferMember, mutingMember, confirmLeave, confirmDelete, selectedMemberId]);

  // Load initial members, invites, and reports
  const fetchGroupData = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        groupApi.listMembers(groupId).catch(() => ({ data: { data: [] } })),
        groupApi.listGroupInvites(groupId).catch(() => ({ data: { data: [] } })),
      ]);
      setMembers(membersRes.data?.data || []);
      setInvites(invitesRes.data?.data || []);
    } catch {
      showToast('Failed to load group details', 'error');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchGroupData();
  }, [fetchGroupData]);

  // Load anon reports if group is anonymous or user is creator
  useEffect(() => {
    if (!groupId || !group?.isAnonymous) return;
    setLoadingReports(true);
    groupApi.getAnonReports(groupId)
      .then((res) => setReports(res.data?.data || []))
      .catch(() => {})
      .finally(() => setLoadingReports(false));
  }, [groupId, group?.isAnonymous]);

  // Permissions & Role resolution
  const currentMember = useMemo(() => {
    return members.find((m) => m.id === currentUserId);
  }, [members, currentUserId]);

  const isCreator = useMemo(() => {
    return currentMember?.isCreator || group?.creatorId === currentUserId;
  }, [currentMember, group?.creatorId, currentUserId]);

  const currentUserRing = currentMember ? currentMember.groupRing : 3;
  const isGroupAdmin = isCreator || currentUserRing === 0 || isAdmin;
  const canManageRoles = isGroupAdmin || !!currentMember?.permissions?.can_manage_roles;
  const canEditGroupInfo = isGroupAdmin || !!currentMember?.permissions?.can_edit_group_info;
  const canAddMembers = isGroupAdmin || !!currentMember?.permissions?.can_add_members;
  const canMuteMembers = isGroupAdmin || !!currentMember?.permissions?.can_mute_members;
  const canKickMembers = isGroupAdmin || !!currentMember?.permissions?.can_kick_members;

  const getRingLabel = useCallback((ring) => {
    return editRingLabels[ring] || ringLabels[ring] || DEFAULT_RING_LABELS[ring] || `Ring ${ring}`;
  }, [editRingLabels, ringLabels]);

  // Filtered members list
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      m.displayName?.toLowerCase().includes(q) ||
      m.username?.toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q)
    );
  }, [members, memberSearch]);

  const selectedMember = useMemo(() => {
    return members.find((m) => m.id === selectedMemberId);
  }, [members, selectedMemberId]);

  // ─────────────────────────────────────────────────────────────
  // Action Handlers
  // ─────────────────────────────────────────────────────────────

  // Save metadata
  const handleSaveInfo = async (e) => {
    e?.preventDefault();
    if (!editName.trim()) {
      showToast('Group name cannot be empty', 'error');
      return;
    }
    setSavingInfo(true);
    try {
      const res = await groupApi.updateGroup(groupId, {
        displayName: editName.trim(),
        description: editDesc.trim(),
      });
      onGroupUpdated?.(res.data?.data);
      showToast('Group overview updated successfully');
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to update group info', 'error');
    } finally {
      setSavingInfo(false);
    }
  };

  // Avatar upload
  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showToast('Avatar file must be under 5MB', 'error');
      if (e.target) e.target.value = '';
      return;
    }

    setUploadingAvatar(true);
    try {
      const res = await groupApi.uploadGroupAvatar(groupId, file);
      onGroupUpdated?.(res.data?.data);
      setAvatarPreview(URL.createObjectURL(file));
      showToast('Group avatar updated');
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to upload avatar', 'error');
    } finally {
      setUploadingAvatar(false);
      if (e.target) e.target.value = '';
    }
  };

  // Debounced User Search for Invites
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
        setInviteResults(res.data?.data || []);
      } catch {
        setInviteResults([]);
      } finally {
        setInviteSearching(false);
      }
    }, 350);
  }, [groupId]);

  // Invite or directly add user
  const handleInviteUser = async (userId) => {
    try {
      const res = await groupApi.addMember(groupId, userId);
      const data = res.data?.data;
      if (data?.invited) {
        setInviteStatus((prev) => ({ ...prev, [userId]: 'invited' }));
        showToast('Invite sent to user');
        const invRes = await groupApi.listGroupInvites(groupId).catch(() => null);
        if (invRes?.data?.data) setInvites(invRes.data.data);
      } else {
        setInviteStatus((prev) => ({ ...prev, [userId]: 'added' }));
        showToast('User joined the group');
        const memRes = await groupApi.listMembers(groupId).catch(() => null);
        if (memRes?.data?.data) setMembers(memRes.data.data);
      }
    } catch (err) {
      setInviteStatus((prev) => ({ ...prev, [userId]: 'error' }));
      showToast(err.response?.data?.error?.message || 'Failed to add user', 'error');
    }
  };

  // Generate / Fetch Shareable Invite Link
  const handleGetInviteLink = async () => {
    setFetchingLink(true);
    try {
      const res = await groupApi.getInviteLink(groupId);
      const token = res.data?.data?.token;
      setInviteLinkToken(token);
      return token;
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to generate link', 'error');
      return null;
    } finally {
      setFetchingLink(false);
    }
  };

  const handleCopyInviteLink = async () => {
    let token = inviteLinkToken;
    if (!token) {
      token = await handleGetInviteLink();
    }
    if (!token) return;
    const url = `${window.location.origin}/join/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      showToast('Invite link copied to clipboard!');
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      showToast('Could not copy to clipboard', 'error');
    }
  };

  // Ring Role Configuration Save
  const handleSaveRoles = async () => {
    setSavingRoles(true);
    try {
      const res = await groupApi.updateRingConfig(groupId, {
        ringCount: editRingCount,
        ringLabels: editRingLabels,
        ringPermissions: editRingPermissions,
        defaultRing: editDefaultRing,
      });
      onGroupUpdated?.(res.data?.data);
      showToast('Role permissions and labels saved');
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to update roles', 'error');
    } finally {
      setSavingRoles(false);
    }
  };

  // Member moderation: Change Ring
  const handleRingChange = async (userId, newRing) => {
    const parsed = parseInt(newRing, 10);
    try {
      await groupApi.setMemberRing(groupId, userId, parsed);
      setMembers((prev) =>
        prev.map((m) => (m.id === userId ? { ...m, groupRing: parsed } : m))
      );
      showToast(`Member rank changed to ${getRingLabel(parsed)}`);
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to change ring', 'error');
    }
  };

  // Member moderation: Individual Permission Toggle
  const handlePermissionToggle = async (userId, permKey, currentValue) => {
    const member = members.find((m) => m.id === userId);
    if (!member) return;
    const newPerms = { ...(member.permissions || {}), [permKey]: !currentValue };
    try {
      await groupApi.setMemberPermissions(groupId, userId, newPerms);
      setMembers((prev) =>
        prev.map((m) => (m.id === userId ? { ...m, permissions: newPerms } : m))
      );
      showToast('Permission updated');
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to modify permission', 'error');
    }
  };

  // Member moderation: Mute
  const handleExecuteMute = async () => {
    if (!mutingMember) return;
    setActionLoading(true);
    try {
      await groupApi.muteMember(groupId, mutingMember.id, muteMinutes);
      showToast(`${mutingMember.displayName} muted for ${muteMinutes} minutes`);
      setMutingMember(null);
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to mute member', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Member moderation: Unmute
  const handleExecuteUnmute = async (userId, memberName) => {
    setActionLoading(true);
    try {
      await groupApi.unmuteMember(groupId, userId);
      showToast(`${memberName} unmuted successfully`);
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to unmute member', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Member moderation: Kick
  const handleExecuteKick = async () => {
    if (!confirmKickMember) return;
    setActionLoading(true);
    try {
      await groupApi.removeMember(groupId, confirmKickMember.id);
      setMembers((prev) => prev.filter((m) => m.id !== confirmKickMember.id));
      showToast(`${confirmKickMember.displayName} removed from group`);
      if (selectedMemberId === confirmKickMember.id) setSelectedMemberId(null);
      setConfirmKickMember(null);
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to kick member', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Transfer Ownership
  const handleExecuteTransferOwnership = async () => {
    if (!confirmTransferMember) return;
    setActionLoading(true);
    try {
      const res = await groupApi.transferOwnership(groupId, confirmTransferMember.id);
      onGroupUpdated?.(res.data?.data);
      // Promote new owner to Ring 0 locally
      setMembers((prev) =>
        prev.map((m) => {
          if (m.id === confirmTransferMember.id) return { ...m, isCreator: true, groupRing: 0 };
          if (m.id === currentUserId) return { ...m, isCreator: false };
          return m;
        })
      );
      showToast(`Ownership successfully transferred to ${confirmTransferMember.displayName}`);
      setConfirmTransferMember(null);
      setSelectedMemberId(null);
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to transfer ownership', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Word Bans: Add, Remove, and Save
  const handleAddBannedWord = (e) => {
    e?.preventDefault();
    const raw = newWordInput.trim();
    if (!raw) return;

    const parts = raw
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0);

    const merged = Array.from(new Set([...bannedWords, ...parts]));
    setBannedWords(merged);
    setNewWordInput('');
  };

  const handleRemoveBannedWord = (wordToRemove) => {
    setBannedWords((prev) => prev.filter((w) => w !== wordToRemove));
  };

  const handleSaveWordBans = async () => {
    setSavingWordBans(true);
    try {
      await groupApi.setWordBans(groupId, bannedWords);
      showToast('Banned words list updated');
      onGroupUpdated?.({ ...group, wordBanList: bannedWords });
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to save banned words', 'error');
    } finally {
      setSavingWordBans(false);
    }
  };

  // Anon Reports: Ban and Unban
  const handleBanAnon = async (identityId) => {
    try {
      await groupApi.banAnonIdentity(groupId, identityId);
      setReports((prev) => prev.filter((r) => r.identity?.id !== identityId));
      showToast('Identity banned and posts removed');
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to ban identity', 'error');
    }
  };

  const handleUnbanAnon = async (identityId) => {
    try {
      await groupApi.unbanAnonIdentity(groupId, identityId);
      showToast('Identity unbanned');
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to unban identity', 'error');
    }
  };

  // Leave Group
  const handleExecuteLeave = async () => {
    setActionLoading(true);
    try {
      await groupApi.leaveGroup(groupId);
      showToast('You have left the group');
      setTimeout(() => {
        window.location.href = '/groups';
      }, 500);
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to leave group', 'error');
      setActionLoading(false);
    }
  };

  // Delete Group
  const handleExecuteDelete = async () => {
    const targetA = (group?.displayName || '').trim().toLowerCase();
    const targetB = (group?.name || '').trim().toLowerCase();
    const input = deleteConfirmationText.trim().toLowerCase();
    if (!input || (input !== targetA && input !== targetB)) {
      showToast('Group name confirmation does not match', 'error');
      return;
    }
    setActionLoading(true);
    try {
      await groupApi.deleteGroup(groupId);
      showToast('Group permanently deleted');
      if (onGroupDeleted) {
        onGroupDeleted();
      } else {
        setTimeout(() => {
          window.location.href = '/groups';
        }, 500);
      }
    } catch (err) {
      showToast(err.response?.data?.error?.message || 'Failed to delete group', 'error');
      setActionLoading(false);
    }
  };

  // Tabs definition
  const tabs = [
    { id: 'info', label: 'Overview', icon: Settings },
    { id: 'members', label: `Members (${members.length})`, icon: Users },
    { id: 'invites', label: `Invites (${invites.length})`, icon: Mail },
    ...(canManageRoles ? [{ id: 'roles', label: 'Roles & RBAC', icon: Shield }] : []),
    ...(isGroupAdmin ? [{ id: 'wordbans', label: 'Word Bans', icon: ShieldAlert }] : []),
    ...(group?.isAnonymous && isCreator ? [{ id: 'reports', label: `Reports (${reports.length})`, icon: ShieldAlert }] : []),
    { id: 'danger', label: 'Danger Zone', icon: AlertTriangle },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl relative border border-[var(--color-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-matte)]/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[var(--palette-teal)] to-[var(--palette-plum)] flex items-center justify-center text-white font-bold shadow-sm">
              {group?.displayName?.charAt(0)?.toUpperCase() || 'G'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                  {group?.displayName || group?.name || 'Group Settings'}
                </h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)] uppercase tracking-wider">
                  {group?.type || 'custom'}
                </span>
                {group?.isAnonymous && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--palette-rose)]/20 text-[var(--palette-plum)] border border-[var(--palette-rose)]/40 flex items-center gap-1">
                    <Lock size={10} /> Anon
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-muted)] font-mono truncate max-w-md">
                ID: {groupId}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Global Toast Notification */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={cn(
                'mx-6 mt-3 px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between shadow-md border',
                toast.type === 'error'
                  ? 'bg-[var(--color-danger)]/15 border-[var(--color-danger)]/30 text-[var(--color-danger)]'
                  : 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/30 text-[var(--color-accent)]'
              )}
            >
              <div className="flex items-center gap-2">
                {toast.type === 'error' ? <AlertTriangle size={15} /> : <Check size={15} />}
                <span>{toast.message}</span>
              </div>
              <button onClick={() => setToast(null)} className="opacity-70 hover:opacity-100 cursor-pointer">
                <X size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tabs Bar */}
        <div className="flex px-4 border-b border-[var(--color-border)] bg-[var(--color-bg-matte)]/30 overflow-x-auto scrollbar-none">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setSelectedMemberId(null);
                }}
                className={cn(
                  'relative flex items-center gap-2 py-3 px-4 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer select-none',
                  active
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                )}
              >
                <Icon size={14} strokeWidth={active ? 2.4 : 2} />
                <span>{t.label}</span>
                {active && (
                  <motion.div
                    layoutId="active-settings-tab"
                    className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-[var(--color-accent)] rounded-t-full"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="space-y-4 py-8 max-w-xl mx-auto">
              <div className="flex items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
                <Loader2 size={18} className="animate-spin text-[var(--color-accent)]" />
                Loading group configuration...
              </div>
              <div className="h-12 rounded-xl bg-[var(--color-bg-secondary)] animate-pulse" />
              <div className="h-28 rounded-xl bg-[var(--color-bg-secondary)] animate-pulse" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {/* ── TAB 1: OVERVIEW & METADATA ── */}
              {tab === 'info' && (
                <motion.div
                  key="info"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="max-w-2xl mx-auto space-y-6"
                >
                  {/* Avatar Upload */}
                  <div className="flex flex-col sm:flex-row items-center gap-6 p-5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                    <div className="relative group">
                      <Avatar
                        src={avatarPreview || group?.avatarUrl}
                        name={editName || group?.displayName}
                        className="w-24 h-24 rounded-2xl text-2xl shadow-md border-2 border-[var(--color-border)]"
                      />
                      {canEditGroupInfo && (
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          disabled={uploadingAvatar}
                          className="absolute inset-0 rounded-2xl bg-black/50 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-xs cursor-pointer"
                        >
                          {uploadingAvatar ? (
                            <Loader2 size={20} className="animate-spin" />
                          ) : (
                            <>
                              <Camera size={20} />
                              <span className="text-[10px] font-bold mt-1">Change</span>
                            </>
                          )}
                        </button>
                      )}
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleAvatarUpload}
                      />
                    </div>
                    <div className="flex-1 text-center sm:text-left space-y-1">
                      <h4 className="text-sm font-bold text-[var(--color-text-primary)]">Group Avatar</h4>
                      <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                        Recommended 500x500 PNG, JPG, or WEBP. Max file size: 5MB.
                      </p>
                      {canEditGroupInfo && (
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          disabled={uploadingAvatar}
                          className="btn btn-secondary text-xs px-3 py-1.5 mt-2 cursor-pointer"
                        >
                          <Upload size={13} />
                          {uploadingAvatar ? 'Uploading...' : 'Upload Image'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Form fields */}
                  <form onSubmit={handleSaveInfo} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider mb-1.5">
                        Group Display Name
                      </label>
                      <input
                        type="text"
                        disabled={!canEditGroupInfo}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="e.g. Class of 2028"
                        maxLength={50}
                        className="matte-input w-full font-medium"
                      />
                      <span className="text-[10px] text-[var(--color-text-muted)] block text-right mt-1">
                        {editName.length}/50
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider mb-1.5">
                        Description & Purpose
                      </label>
                      <textarea
                        disabled={!canEditGroupInfo}
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder="What is this channel or cohort about?"
                        rows={3}
                        maxLength={300}
                        className="matte-input w-full resize-none font-normal"
                      />
                      <span className="text-[10px] text-[var(--color-text-muted)] block text-right mt-1">
                        {editDesc.length}/300
                      </span>
                    </div>

                    {/* Meta info boxes */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                        <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Group Type</span>
                        <p className="text-xs font-semibold text-[var(--color-text-primary)] capitalize mt-0.5">
                          {group?.type || 'Custom'} {group?.isAnonymous ? '• Anonymous Identity Mode' : '• Standard RBAC'}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                        <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Created</span>
                        <p className="text-xs font-semibold text-[var(--color-text-primary)] mt-0.5">
                          {group?.createdAt ? new Date(group.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Unknown'}
                        </p>
                      </div>
                    </div>

                    {canEditGroupInfo ? (
                      <div className="pt-3">
                        <button
                          type="submit"
                          disabled={savingInfo}
                          className="btn btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {savingInfo ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                          {savingInfo ? 'Saving Changes...' : 'Save Overview Settings'}
                        </button>
                      </div>
                    ) : (
                      <div className="p-3 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-center text-xs text-[var(--color-text-muted)]">
                        🔒 Only group administrators can modify group metadata.
                      </div>
                    )}
                  </form>
                </motion.div>
              )}

              {/* ── TAB 2: MEMBERS & MODERATION ── */}
              {tab === 'members' && (
                <motion.div
                  key="members"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-4"
                >
                  {/* Subview: Selected Member Permission & Role Inspector */}
                  {selectedMember ? (
                    <div className="space-y-6 max-w-2xl mx-auto">
                      <button
                        onClick={() => setSelectedMemberId(null)}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--color-accent)] hover:underline cursor-pointer"
                      >
                        <ArrowLeft size={14} /> Back to Members List
                      </button>

                      {/* Member profile header card */}
                      <div className="p-5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center gap-4">
                        <Avatar
                          src={selectedMember.avatarUrl}
                          name={selectedMember.displayName}
                          className="w-14 h-14 rounded-2xl text-xl shadow-sm"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-[var(--color-text-primary)] truncate">
                              {selectedMember.displayName}
                            </h3>
                            {selectedMember.isCreator && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-warning)]/15 text-[var(--color-warning)] font-bold flex items-center gap-1">
                                <Crown size={11} /> Creator
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[var(--color-text-muted)] truncate">
                            {selectedMember.username ? `@${selectedMember.username}` : selectedMember.email}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', getRingBadgeClass(selectedMember.groupRing))}>
                              {getRingLabel(selectedMember.groupRing)} (Ring {selectedMember.groupRing})
                            </span>
                            {selectedMember.joinedAt && (
                              <span className="text-[10px] text-[var(--color-text-muted)]">
                                Joined {new Date(selectedMember.joinedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Change Ring Selector */}
                      {canManageRoles && !selectedMember.isCreator && (
                        <div className="p-5 rounded-2xl bg-[var(--color-bg-matte)] border border-[var(--color-border)] space-y-2">
                          <label className="block text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                            Change Role / Ring Level
                          </label>
                          <p className="text-xs text-[var(--color-text-muted)] mb-3 leading-relaxed">
                            Rings define privilege hierarchy. Ring 0 has administrative control. You can elevate members up to your own ring level.
                          </p>
                          <select
                            className="matte-input w-full font-semibold cursor-pointer"
                            value={selectedMember.groupRing}
                            onChange={(e) => handleRingChange(selectedMember.id, e.target.value)}
                          >
                            {Array.from({ length: editRingCount }, (_, i) => {
                              const disabled = !isCreator && currentUserRing !== 0 && i < currentUserRing;
                              return (
                                <option key={i} value={i} disabled={disabled}>
                                  Ring {i} — {getRingLabel(i)} {disabled ? '(Requires higher rank)' : ''}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      )}

                      {/* Granular Permission Overrides */}
                      {canManageRoles && !selectedMember.isCreator && (
                        <div className="p-5 rounded-2xl bg-[var(--color-bg-matte)] border border-[var(--color-border)] space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                                Individual Permission Overrides
                              </h4>
                              <p className="text-xs text-[var(--color-text-muted)]">
                                Overrides default ring permissions specifically for this member.
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                            {Object.entries(PERMISSION_LABELS).map(([key, label]) => {
                              const checked = !!selectedMember.permissions?.[key];
                              return (
                                <label
                                  key={key}
                                  className="flex items-center gap-3 p-2.5 rounded-xl bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border)]/30 transition-colors cursor-pointer select-none"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => handlePermissionToggle(selectedMember.id, key, checked)}
                                    className="w-4 h-4 rounded accent-[var(--color-accent)] cursor-pointer"
                                  />
                                  <span className="text-xs font-medium text-[var(--color-text-primary)]">{label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Action buttons: Mute, Unmute, Kick, Transfer Ownership */}
                      <div className="space-y-3 pt-2">
                        {canMuteMembers && !selectedMember.isCreator && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => setMutingMember(selectedMember)}
                              className="btn btn-secondary flex-1 text-xs font-semibold py-2.5 flex items-center justify-center gap-2 cursor-pointer"
                            >
                              <VolumeX size={15} /> Mute Member...
                            </button>
                            <button
                              onClick={() => handleExecuteUnmute(selectedMember.id, selectedMember.displayName)}
                              disabled={actionLoading}
                              className="btn btn-secondary text-xs font-semibold py-2.5 px-4 flex items-center justify-center gap-1.5 cursor-pointer"
                              title="Unmute Member"
                            >
                              <Volume2 size={15} /> Unmute
                            </button>
                          </div>
                        )}

                        {canKickMembers && !selectedMember.isCreator && selectedMember.id !== currentUserId && (
                          <button
                            onClick={() => setConfirmKickMember(selectedMember)}
                            className="btn btn-secondary text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white w-full text-xs font-semibold py-2.5 flex items-center justify-center gap-2 border-[var(--color-danger)]/30 cursor-pointer"
                          >
                            <UserX size={15} /> Remove From Group
                          </button>
                        )}

                        {isCreator && selectedMember.id !== currentUserId && (
                          <button
                            onClick={() => setConfirmTransferMember(selectedMember)}
                            className="btn btn-secondary text-[var(--color-warning)] hover:bg-[var(--color-warning)] hover:text-white w-full text-xs font-semibold py-2.5 flex items-center justify-center gap-2 border-[var(--color-warning)]/30 cursor-pointer"
                          >
                            <Crown size={15} /> Transfer Group Ownership
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Default: Members Directory List */
                    <div className="space-y-4">
                      {/* Search and filter toolbar */}
                      <div className="flex flex-col sm:flex-row items-center gap-3">
                        <div className="relative flex-1 w-full">
                          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                          <input
                            type="text"
                            placeholder="Search members by name or username..."
                            value={memberSearch}
                            onChange={(e) => setMemberSearch(e.target.value)}
                            className="matte-input pl-10 pr-4 py-2 text-xs w-full"
                          />
                          {memberSearch && (
                            <button
                              onClick={() => setMemberSearch('')}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        {canAddMembers && (
                          <button
                            onClick={() => setTab('invites')}
                            className="btn btn-primary text-xs px-3.5 py-2 whitespace-nowrap flex-shrink-0 cursor-pointer"
                          >
                            <UserPlus size={14} /> Invite New Member
                          </button>
                        )}
                      </div>

                      {/* Members list */}
                      <div className="space-y-2">
                        {filteredMembers.length === 0 ? (
                          <div className="text-center py-12 text-[var(--color-text-muted)] text-xs">
                            No members found matching "{memberSearch}".
                          </div>
                        ) : (
                          filteredMembers.map((m) => {
                            const isSelf = m.id === currentUserId;
                            const isEditable = canManageRoles && !m.isCreator && !isSelf;
                            return (
                              <div
                                key={m.id}
                                onClick={() => isEditable && setSelectedMemberId(m.id)}
                                className={cn(
                                  'flex items-center justify-between p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] transition-all',
                                  isEditable ? 'hover:bg-[var(--color-border)]/20 cursor-pointer' : 'cursor-default'
                                )}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <Avatar
                                    src={m.avatarUrl}
                                    name={m.displayName}
                                    className="w-10 h-10 rounded-full text-sm flex-shrink-0"
                                  />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-xs font-bold text-[var(--color-text-primary)] truncate">
                                        {m.displayName}
                                      </p>
                                      {m.isCreator && (
                                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--color-warning)]/15 text-[var(--color-warning)] font-bold flex items-center gap-0.5">
                                          <Crown size={10} /> Owner
                                        </span>
                                      )}
                                      {isSelf && (
                                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-bold">
                                          You
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-[var(--color-text-muted)] truncate">
                                      {m.username ? `@${m.username}` : m.email}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-3 flex-shrink-0">
                                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', getRingBadgeClass(m.groupRing))}>
                                    {getRingLabel(m.groupRing)}
                                  </span>
                                  {isEditable && (
                                    <ChevronRight size={14} className="text-[var(--color-text-muted)]" />
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── TAB 3: INVITES & USER SEARCH ── */}
              {tab === 'invites' && (
                <motion.div
                  key="invites"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="max-w-2xl mx-auto space-y-6"
                >
                  {/* Shareable Link Card */}
                  <div className="p-5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Link2 size={16} className="text-[var(--color-accent)]" />
                        <h4 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                          Shareable Invite Link
                        </h4>
                      </div>
                      <span className="text-[10px] text-[var(--color-text-muted)] font-medium">
                        Expires in 7 days
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                      Anyone with this private link can join this group automatically.
                    </p>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={inviteLinkToken ? `${window.location.origin}/join/${inviteLinkToken}` : 'Click generate to create an invite link'}
                        className="matte-input font-mono text-xs flex-1 truncate select-all"
                      />
                      <button
                        onClick={handleCopyInviteLink}
                        disabled={fetchingLink}
                        className="btn btn-primary text-xs px-4 py-2 flex items-center gap-1.5 flex-shrink-0 cursor-pointer"
                      >
                        {fetchingLink ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : copiedLink ? (
                          <Check size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                        {copiedLink ? 'Copied!' : 'Copy Link'}
                      </button>
                    </div>
                  </div>

                  {/* Search Users to Invite directly */}
                  {canAddMembers && (
                    <div className="p-5 rounded-2xl bg-[var(--color-bg-matte)] border border-[var(--color-border)] space-y-3">
                      <div className="flex items-center gap-2">
                        <UserPlus size={16} className="text-[var(--color-accent)]" />
                        <h4 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                          Invite User Directly
                        </h4>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Search across the campus platform by name, @username, or student email.
                      </p>

                      <div className="relative">
                        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                        <input
                          type="text"
                          placeholder="Search users..."
                          value={inviteQuery}
                          onChange={(e) => handleInviteSearch(e.target.value)}
                          className="matte-input pl-10 pr-4 py-2 text-xs w-full"
                        />
                      </div>

                      {inviteSearching && (
                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] py-2">
                          <Loader2 size={13} className="animate-spin" /> Searching platform users...
                        </div>
                      )}

                      {inviteResults.length > 0 && (
                        <div className="space-y-1.5 max-h-56 overflow-y-auto pt-1">
                          {inviteResults.map((u) => {
                            const status = inviteStatus[u.id];
                            return (
                              <div
                                key={u.id}
                                className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <Avatar src={u.avatarUrl} name={u.displayName} className="w-8 h-8 rounded-full text-xs" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-[var(--color-text-primary)] truncate">{u.displayName}</p>
                                    <p className="text-[10px] text-[var(--color-text-muted)] truncate">{u.username ? `@${u.username}` : u.email}</p>
                                  </div>
                                </div>

                                <div>
                                  {u.isMember ? (
                                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)]">
                                      Member
                                    </span>
                                  ) : u.hasPendingInvite || status === 'invited' ? (
                                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
                                      Invited
                                    </span>
                                  ) : status === 'added' ? (
                                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)]">
                                      Added ✓
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => handleInviteUser(u.id)}
                                      className="btn btn-primary text-xs px-3 py-1 cursor-pointer"
                                    >
                                      Invite
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {inviteQuery.trim().length >= 2 && !inviteSearching && inviteResults.length === 0 && (
                        <p className="text-xs text-[var(--color-text-muted)] text-center py-3">
                          No users matched your query.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Pending invites list */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                      Pending Invitations ({invites.length})
                    </h4>
                    {invites.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)] text-center py-6 border border-dashed border-[var(--color-border)] rounded-2xl">
                        No pending invitations currently active.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {invites.map((inv) => (
                          <div
                            key={inv.id}
                            className="flex items-center justify-between p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Avatar src={inv.user?.avatarUrl} name={inv.user?.displayName} className="w-9 h-9 rounded-full text-xs" />
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-[var(--color-text-primary)] truncate">{inv.user?.displayName || 'Invited User'}</p>
                                <p className="text-[11px] text-[var(--color-text-muted)] truncate">
                                  Invited by {inv.invitedByUser?.displayName || 'Admin'}
                                </p>
                              </div>
                            </div>
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
                              Pending
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ── TAB 4: ROLES & RING CONFIG (RBAC) ── */}
              {tab === 'roles' && canManageRoles && (
                <motion.div
                  key="roles"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="max-w-3xl mx-auto space-y-6"
                >
                  <div className="p-4 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                    <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider mb-1">
                      Ring Permission Architecture
                    </h3>
                    <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                      Comflex structures permissions into concentric Rings (Ring 0 to Ring N-1). Ring 0 is the highest administrative level. Any ring level inherits customizable permissions.
                    </p>
                  </div>

                  {/* Architecture controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider mb-1.5">
                        Total Number of Rings (2-10)
                      </label>
                      <select
                        className="matte-input w-full font-semibold cursor-pointer"
                        value={editRingCount}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setEditRingCount(val);
                          if (editDefaultRing >= val) setEditDefaultRing(val - 1);
                        }}
                      >
                        {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => (
                          <option key={count} value={count}>{count} Rings</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider mb-1.5">
                        Default Ring On Join
                      </label>
                      <select
                        className="matte-input w-full font-semibold cursor-pointer"
                        value={editDefaultRing}
                        onChange={(e) => setEditDefaultRing(parseInt(e.target.value, 10))}
                      >
                        {Array.from({ length: editRingCount }, (_, i) => (
                          <option key={i} value={i}>
                            Ring {i}: {editRingLabels[i] || DEFAULT_RING_LABELS[i] || `Ring ${i}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Ring Names / Labels customization */}
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                      Custom Ring Titles
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {Array.from({ length: editRingCount }, (_, i) => (
                        <div key={i} className="flex items-center gap-2 p-2 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                          <span className={cn('text-[10px] font-mono px-2 py-0.5 rounded-full font-bold', getRingBadgeClass(i))}>
                            Ring {i}
                          </span>
                          <input
                            type="text"
                            className="matte-input text-xs py-1.5 px-2.5 flex-1"
                            value={editRingLabels[i] || DEFAULT_RING_LABELS[i] || ''}
                            onChange={(e) =>
                              setEditRingLabels((prev) => ({ ...prev, [i]: e.target.value }))
                            }
                            placeholder={DEFAULT_RING_LABELS[i] || `Ring ${i}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Ring Default Permissions Matrix */}
                  <div className="space-y-4">
                    <label className="block text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                      Default Permissions Per Ring
                    </label>

                    <div className="space-y-3">
                      {Array.from({ length: editRingCount }, (_, i) => (
                        <div key={i} className="p-4 rounded-2xl bg-[var(--color-bg-matte)] border border-[var(--color-border)]">
                          <div className="flex items-center justify-between mb-3">
                            <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', getRingBadgeClass(i))}>
                              Ring {i}: {editRingLabels[i] || DEFAULT_RING_LABELS[i] || `Ring ${i}`}
                            </span>
                            <span className="text-[10px] text-[var(--color-text-muted)]">
                              {i === 0 ? 'Full admin rights' : 'Custom rank'}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {Object.entries(PERMISSION_LABELS).map(([key, label]) => {
                              const checked = !!editRingPermissions[i]?.[key];
                              return (
                                <label
                                  key={key}
                                  className="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border)]/30 transition-colors cursor-pointer select-none"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const isChecked = e.target.checked;
                                      setEditRingPermissions((prev) => ({
                                        ...prev,
                                        [i]: { ...(prev[i] || {}), [key]: isChecked },
                                      }));
                                    }}
                                    className="w-3.5 h-3.5 rounded accent-[var(--color-accent)] cursor-pointer"
                                  />
                                  <span className="text-[11px] font-medium text-[var(--color-text-primary)] truncate">
                                    {label}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Save roles button */}
                  <button
                    onClick={handleSaveRoles}
                    disabled={savingRoles}
                    className="btn btn-primary w-full py-3 text-sm flex items-center justify-center gap-2 shadow-md cursor-pointer"
                  >
                    {savingRoles ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                    {savingRoles ? 'Saving Role Settings...' : 'Save Role Configuration'}
                  </button>
                </motion.div>
              )}

              {/* ── TAB 5: WORD BANS & MODERATION LIST ── */}
              {tab === 'wordbans' && isGroupAdmin && (
                <motion.div
                  key="wordbans"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="max-w-2xl mx-auto space-y-6"
                >
                  <div className="p-4 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] space-y-1">
                    <div className="flex items-center gap-2">
                      <ShieldAlert size={16} className="text-[var(--color-danger)]" />
                      <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                        Real-Time Message Filtering
                      </h3>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                      Messages containing these prohibited keywords will be automatically blocked by channel moderation filters.
                    </p>
                  </div>

                  {/* Add word input */}
                  <form onSubmit={handleAddBannedWord} className="space-y-2">
                    <label className="block text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                      Add Banned Words (single or comma-separated)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="e.g. spam, leak, abuse"
                        value={newWordInput}
                        onChange={(e) => setNewWordInput(e.target.value)}
                        className="matte-input text-xs flex-1"
                      />
                      <button
                        type="submit"
                        disabled={!newWordInput.trim()}
                        className="btn btn-secondary text-xs px-4 py-2 flex items-center gap-1 flex-shrink-0 cursor-pointer"
                      >
                        <Plus size={14} /> Add Word
                      </button>
                    </div>
                  </form>

                  {/* Active word chips */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                        Active Banned Keywords ({bannedWords.length})
                      </span>
                      {bannedWords.length > 0 && (
                        <button
                          onClick={() => setBannedWords([])}
                          className="text-[11px] text-[var(--color-danger)] hover:underline cursor-pointer"
                        >
                          Clear All
                        </button>
                      )}
                    </div>

                    {bannedWords.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)] text-center py-6 border border-dashed border-[var(--color-border)] rounded-2xl">
                        No banned words active. All appropriate messages are allowed.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2 p-3 rounded-2xl bg-[var(--color-bg-matte)] border border-[var(--color-border)]">
                        {bannedWords.map((word) => (
                          <span
                            key={word}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--color-danger)]/15 text-[var(--color-danger)] border border-[var(--color-danger)]/30"
                          >
                            <span>{word}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveBannedWord(word)}
                              className="hover:opacity-80 p-0.5 cursor-pointer"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Test filter tool */}
                  <div className="p-4 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] space-y-2">
                    <span className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                      Test Content Filter
                    </span>
                    <input
                      type="text"
                      placeholder="Type a sample sentence to test word detection..."
                      value={wordFilterTest}
                      onChange={(e) => setWordFilterTest(e.target.value)}
                      className="matte-input text-xs w-full"
                    />
                    {wordFilterTest.trim() && (
                      <div className="text-xs pt-1">
                        {(() => {
                          const lower = wordFilterTest.toLowerCase();
                          const found = bannedWords.filter((w) => lower.includes(w.toLowerCase()));
                          if (found.length > 0) {
                            return (
                              <span className="text-[var(--color-danger)] font-bold flex items-center gap-1">
                                <AlertTriangle size={13} /> Message blocked! Contains banned: {found.join(', ')}
                              </span>
                            );
                          }
                          return (
                            <span className="text-[var(--color-success)] font-bold flex items-center gap-1">
                              <Check size={13} /> Message passes word filter
                            </span>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Save word bans button */}
                  <button
                    onClick={handleSaveWordBans}
                    disabled={savingWordBans}
                    className="btn btn-primary w-full py-2.5 text-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {savingWordBans ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    {savingWordBans ? 'Saving List...' : 'Save Word Bans'}
                  </button>
                </motion.div>
              )}

              {/* ── TAB 6: ANON REPORTS REVIEW ── */}
              {tab === 'reports' && (
                <motion.div
                  key="reports"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="max-w-2xl mx-auto space-y-4"
                >
                  <div className="p-4 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                    <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider mb-1">
                      Zero-Knowledge Reports
                    </h3>
                    <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                      Reports submitted against anonymous identities in this channel. You can ban malicious identities while user privacy remains strictly zero-knowledge.
                    </p>
                  </div>

                  {loadingReports ? (
                    <div className="text-center py-8 text-xs text-[var(--color-text-muted)] flex items-center justify-center gap-2">
                      <Loader2 size={15} className="animate-spin" /> Loading report logs...
                    </div>
                  ) : reports.length === 0 ? (
                    <div className="text-center py-12 text-xs text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-2xl">
                      🎉 No reports currently filed against anonymous identities.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {reports.map((r) => (
                        <div
                          key={r.identity?.id}
                          className="p-4 rounded-2xl bg-[var(--color-bg-matte)] border border-[var(--color-border)] space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Avatar
                                src={r.identity?.avatarUrl}
                                name={r.identity?.alias}
                                className="w-10 h-10 rounded-full text-sm"
                              />
                              <div>
                                <p className="text-xs font-bold text-[var(--color-text-primary)]">
                                  {r.identity?.alias || 'Unknown'}
                                  {r.identity?.aliasTag && (
                                    <span className="text-[var(--color-text-muted)] font-mono">
                                      #{r.identity.aliasTag}
                                    </span>
                                  )}
                                </p>
                                <span className="text-[10px] text-[var(--color-danger)] font-bold">
                                  {r.reports?.length || 1} report(s) filed
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {r.identity?.bannedAt ? (
                                <button
                                  onClick={() => handleUnbanAnon(r.identity.id)}
                                  className="btn btn-secondary text-xs px-3 py-1.5 cursor-pointer"
                                >
                                  Unban
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleBanAnon(r.identity.id)}
                                  className="btn btn-secondary text-[var(--color-danger)] border-[var(--color-danger)]/30 hover:bg-[var(--color-danger)] hover:text-white text-xs px-3 py-1.5 cursor-pointer"
                                >
                                  Ban Identity
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Reasons list */}
                          <div className="space-y-1.5 pt-2 border-t border-[var(--color-border)]">
                            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                              Report Reasons:
                            </span>
                            <div className="space-y-1">
                              {(r.reports || []).map((rep, idx) => (
                                <p
                                  key={idx}
                                  className="text-xs p-2 rounded-lg bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] leading-relaxed italic"
                                >
                                  "{rep.reason}"
                                </p>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── TAB 7: DANGER ZONE ── */}
              {tab === 'danger' && (
                <motion.div
                  key="danger"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="max-w-2xl mx-auto space-y-6"
                >
                  <div className="p-5 rounded-2xl bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 space-y-4">
                    <div className="flex items-center gap-2 text-[var(--color-danger)] font-bold text-sm">
                      <AlertTriangle size={18} />
                      <span>Destructive Group Actions</span>
                    </div>

                    {/* Leave Group Action */}
                    <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[var(--color-danger)]/20 pb-4">
                      <div>
                        <h4 className="text-xs font-bold text-[var(--color-text-primary)]">Leave Group</h4>
                        <p className="text-xs text-[var(--color-text-muted)] max-w-sm">
                          {isCreator
                            ? 'As group creator, you cannot leave directly. Transfer ownership to another member first.'
                            : 'Remove yourself from this group. You will lose access to member conversations.'}
                        </p>
                      </div>
                      <button
                        onClick={() => setConfirmLeave(true)}
                        disabled={isCreator}
                        className="btn btn-secondary text-[var(--color-warning)] border-[var(--color-warning)]/30 text-xs px-4 py-2 whitespace-nowrap flex-shrink-0 cursor-pointer"
                      >
                        Leave Group
                      </button>
                    </div>

                    {/* Delete Group Action */}
                    {isGroupAdmin && (
                      <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                          <h4 className="text-xs font-bold text-[var(--color-danger)]">Delete Entire Group</h4>
                          <p className="text-xs text-[var(--color-text-muted)] max-w-sm">
                            Permanently delete this group, its messages, attachments, and settings for all members. This action cannot be reversed.
                          </p>
                        </div>
                        <button
                          onClick={() => setConfirmDelete(true)}
                          className="btn btn-danger text-xs px-4 py-2 whitespace-nowrap flex-shrink-0 shadow-md cursor-pointer"
                        >
                          <Trash2 size={14} /> Delete Group
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* MODAL DIALOGS: Mute, Kick, Transfer, Leave, Delete */}
        {/* ───────────────────────────────────────────────────────────── */}

        {/* Mute Modal */}
        <AnimatePresence>
          {mutingMember && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs" onClick={() => setMutingMember(null)}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-card w-full max-w-md p-6 space-y-4 shadow-2xl border border-[var(--color-border)]"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-warning)]">
                  <VolumeX size={18} />
                  <span>Mute {mutingMember.displayName}</span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                  Muting blocks this member from posting messages in this group for the designated duration.
                </p>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                    Select Duration
                  </label>
                  <select
                    className="matte-input text-xs font-semibold cursor-pointer w-full"
                    value={muteMinutes}
                    onChange={(e) => setMuteMinutes(parseInt(e.target.value, 10))}
                  >
                    <option value={15}>15 Minutes</option>
                    <option value={60}>1 Hour</option>
                    <option value={360}>6 Hours</option>
                    <option value={1440}>24 Hours</option>
                    <option value={10080}>7 Days</option>
                  </select>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleExecuteMute}
                    disabled={actionLoading}
                    className="btn btn-primary flex-1 text-xs py-2 cursor-pointer"
                  >
                    {actionLoading ? 'Muting...' : `Confirm Mute (${muteMinutes} min)`}
                  </button>
                  <button
                    onClick={() => setMutingMember(null)}
                    disabled={actionLoading}
                    className="btn btn-secondary text-xs px-4 py-2 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Kick Modal */}
        <AnimatePresence>
          {confirmKickMember && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs" onClick={() => setConfirmKickMember(null)}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-card w-full max-w-md p-6 space-y-4 shadow-2xl border border-[var(--color-border)]"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-danger)]">
                  <UserX size={18} />
                  <span>Remove Member</span>
                </div>
                <p className="text-xs text-[var(--color-text-primary)] leading-relaxed">
                  Are you sure you want to remove <strong>{confirmKickMember.displayName}</strong> from this group? They will need a new invite to rejoin.
                </p>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleExecuteKick}
                    disabled={actionLoading}
                    className="btn btn-danger flex-1 text-xs py-2 cursor-pointer"
                  >
                    {actionLoading ? 'Removing...' : 'Yes, Remove Member'}
                  </button>
                  <button
                    onClick={() => setConfirmKickMember(null)}
                    disabled={actionLoading}
                    className="btn btn-secondary text-xs px-4 py-2 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Transfer Ownership Modal */}
        <AnimatePresence>
          {confirmTransferMember && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs" onClick={() => setConfirmTransferMember(null)}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-card w-full max-w-md p-6 space-y-4 shadow-2xl border border-[var(--color-border)]"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-warning)]">
                  <Crown size={18} />
                  <span>Transfer Group Ownership</span>
                </div>
                <p className="text-xs text-[var(--color-text-primary)] leading-relaxed">
                  Transfer full group ownership to <strong>{confirmTransferMember.displayName}</strong>?
                  They will become the primary Creator with Ring 0 privileges.
                </p>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleExecuteTransferOwnership}
                    disabled={actionLoading}
                    className="btn btn-primary flex-1 text-xs py-2 cursor-pointer"
                  >
                    {actionLoading ? 'Transferring...' : 'Yes, Transfer Ownership'}
                  </button>
                  <button
                    onClick={() => setConfirmTransferMember(null)}
                    disabled={actionLoading}
                    className="btn btn-secondary text-xs px-4 py-2 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Leave Group Modal */}
        <AnimatePresence>
          {confirmLeave && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs" onClick={() => setConfirmLeave(false)}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-card w-full max-w-md p-6 space-y-4 shadow-2xl border border-[var(--color-border)]"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-warning)]">
                  <AlertTriangle size={18} />
                  <span>Leave Group?</span>
                </div>
                <p className="text-xs text-[var(--color-text-primary)] leading-relaxed">
                  Are you sure you want to leave this group? You will stop receiving messages and updates from its members.
                </p>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleExecuteLeave}
                    disabled={actionLoading}
                    className="btn btn-primary flex-1 text-xs py-2 cursor-pointer"
                  >
                    {actionLoading ? 'Leaving...' : 'Yes, Leave Group'}
                  </button>
                  <button
                    onClick={() => setConfirmLeave(false)}
                    disabled={actionLoading}
                    className="btn btn-secondary text-xs px-4 py-2 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Delete Group Modal */}
        <AnimatePresence>
          {confirmDelete && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs" onClick={() => { setConfirmDelete(false); setDeleteConfirmationText(''); }}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-card w-full max-w-md p-6 space-y-4 shadow-2xl border border-[var(--color-danger)]/40"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-danger)]">
                  <Trash2 size={18} />
                  <span>Permanently Delete Group</span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                  This action is irreversible. All messages, files, and role records will be erased forever.
                </p>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-[var(--color-text-primary)]">
                    Type <strong>{group?.displayName || group?.name}</strong> to confirm:
                  </label>
                  <input
                    type="text"
                    placeholder="Enter group name"
                    value={deleteConfirmationText}
                    onChange={(e) => setDeleteConfirmationText(e.target.value)}
                    className="matte-input text-xs w-full border-[var(--color-danger)]/40"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleExecuteDelete}
                    disabled={
                      actionLoading ||
                      !deleteConfirmationText.trim() ||
                      (deleteConfirmationText.trim().toLowerCase() !== (group?.displayName || '').trim().toLowerCase() &&
                       deleteConfirmationText.trim().toLowerCase() !== (group?.name || '').trim().toLowerCase())
                    }
                    className="btn btn-danger flex-1 text-xs py-2 cursor-pointer"
                  >
                    {actionLoading ? 'Deleting Group...' : 'Permanently Delete'}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmDelete(false);
                      setDeleteConfirmationText('');
                    }}
                    disabled={actionLoading}
                    className="btn btn-secondary text-xs px-4 py-2 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

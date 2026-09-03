/**
 * AnonGroupPanel — Sidebar & Moderation Panel for Anonymous Groups.
 *
 * Provides:
 * 1. Anonymous identity management: current alias, tag, avatar, and rotation/rename (drops old secret).
 * 2. Instant invite link generator for group creators with clipboard copy.
 * 3. Creator moderation tools: open anonymous reports, zero-knowledge identity ban/unban, and real-time word-ban list.
 * 4. Zero-knowledge privacy guarantees: no identity mapping is ever accessible to any user or creator.
 * 5. Safe leave and group deletion actions with confirmation modals.
 *
 * Implemented with Comflex matte + glassy design system and Framer Motion transitions.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Flag,
  Trash2,
  UserRoundCog,
  Link2,
  Copy,
  Check,
  Loader2,
  Edit3,
  Ban,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  LogOut,
  Info
} from 'lucide-react';
import { groupApi } from '../api/groupApi';
import { updateAnonSession, removeAnonSession } from '../api/client';
import { useSocket } from '../hooks/useSocket';
import Avatar from './Avatar';
import { cn } from '../utils/cn';

export default function AnonGroupPanel({
  groupId,
  myIdentity,
  isCreator,
  onLeft,
  onIdentityUpdated,
  className
}) {
  const { joinAnonGroup } = useSocket() || {};

  const [aliasInput, setAliasInput] = useState(myIdentity?.alias || '');
  const [renaming, setRenaming] = useState(false);
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [wordBans, setWordBans] = useState('');
  const [savingBans, setSavingBans] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);
  const [banningId, setBanningId] = useState(null);

  // Sync alias input when identity changes
  useEffect(() => {
    if (myIdentity?.alias) {
      setAliasInput(myIdentity.alias);
    }
  }, [myIdentity?.alias]);

  // Flash message toast notification
  const flash = (message, type = 'success') => {
    setActionMsg({ message, type });
    setTimeout(() => {
      setActionMsg((curr) => (curr?.message === message ? null : curr));
    }, 3200);
  };

  // Fetch creator reports and existing group info (e.g. banned words)
  useEffect(() => {
    if (!isCreator || !groupId) return;

    setLoadingReports(true);
    groupApi.getAnonReports(groupId)
      .then((res) => {
        setReports(res.data?.data || []);
      })
      .catch(() => {
        // Silently fail if forbidden or offline
      })
      .finally(() => {
        setLoadingReports(false);
      });

    // Optional: Pre-fill wordbans if available from group metadata
    groupApi.getGroup(groupId)
      .then((res) => {
        const words = res.data?.data?.bannedWords;
        if (Array.isArray(words) && words.length > 0) {
          setWordBans(words.join(', '));
        }
      })
      .catch(() => {});
  }, [groupId, isCreator]);

  // Copy anonymous invite link
  const handleCopyInviteLink = async () => {
    setCopyingLink(true);
    try {
      const res = await groupApi.getInviteLink(groupId);
      const token = res.data?.data?.token;
      if (!token) throw new Error('No invite token returned from server');
      const url = `${window.location.origin}/join/${token}`;
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      flash('Anonymous invite link copied to clipboard!', 'success');
      setTimeout(() => setCopiedLink(false), 3000);
    } catch (err) {
      flash(err.response?.data?.error?.message || 'Failed to generate invite link.', 'error');
    } finally {
      setCopyingLink(false);
    }
  };

  // Rename anonymous identity & rotate cryptographic secret
  const handleRename = async (e) => {
    e.preventDefault();
    const cleanAlias = aliasInput.trim();
    if (!cleanAlias) return;
    if (cleanAlias === myIdentity?.alias) {
      flash('That is already your current alias.', 'info');
      return;
    }

    setRenaming(true);
    try {
      const res = await groupApi.renameAnonIdentity(groupId, cleanAlias);
      const updatedIdentity = {
        identityId: myIdentity?.identityId,
        secret: res.data.data.secret,
        alias: res.data.data.alias,
        aliasTag: res.data.data.aliasTag,
        avatarUrl: res.data.data.avatarUrl,
      };

      // Store new credentials in local storage / session cookie
      updateAnonSession(groupId, updatedIdentity);

      // Re-join socket room with newly issued secret
      if (joinAnonGroup && updatedIdentity.identityId && updatedIdentity.secret) {
        joinAnonGroup(groupId, updatedIdentity.identityId, updatedIdentity.secret).catch(() => {});
      }

      onIdentityUpdated?.(updatedIdentity);
      flash('Alias updated — old secret rotated forever.', 'success');
    } catch (err) {
      flash(err.response?.data?.error?.message || 'Failed to rename alias.', 'error');
    } finally {
      setRenaming(false);
    }
  };

  // Ban identity
  const handleBan = async (identityId) => {
    setBanningId(identityId);
    try {
      await groupApi.banAnonIdentity(groupId, identityId);
      // Remove or mark banned in local reports list
      setReports((prev) =>
        prev.map((r) =>
          r.identity?.id === identityId
            ? { ...r, identity: { ...r.identity, bannedAt: new Date().toISOString() } }
            : r
        )
      );
      flash('Identity banned from this group.', 'success');
    } catch (err) {
      flash(err.response?.data?.error?.message || 'Failed to ban identity.', 'error');
    } finally {
      setBanningId(null);
    }
  };

  // Unban identity
  const handleUnban = async (identityId) => {
    setBanningId(identityId);
    try {
      await groupApi.unbanAnonIdentity(groupId, identityId);
      setReports((prev) =>
        prev.map((r) =>
          r.identity?.id === identityId
            ? { ...r, identity: { ...r.identity, bannedAt: null } }
            : r
        )
      );
      flash('Identity un-banned.', 'success');
    } catch (err) {
      flash(err.response?.data?.error?.message || 'Failed to unban identity.', 'error');
    } finally {
      setBanningId(null);
    }
  };

  // Save banned words list
  const handleWordBans = async (e) => {
    e.preventDefault();
    setSavingBans(true);
    try {
      const words = wordBans
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean);
      await groupApi.setWordBans(groupId, words);
      flash(`Saved ${words.length} banned word${words.length === 1 ? '' : 's'}.`, 'success');
    } catch (err) {
      flash(err.response?.data?.error?.message || 'Failed to save word bans.', 'error');
    } finally {
      setSavingBans(false);
    }
  };

  // Leave group
  const handleLeave = async () => {
    try {
      await groupApi.leaveAnonIdentity(groupId);
      removeAnonSession(groupId);
      flash('You left the anonymous group.', 'info');
      onLeft?.();
    } catch (err) {
      flash(err.response?.data?.error?.message || 'Failed to leave group.', 'error');
    }
  };

  // Creator delete group
  const handleDeleteGroup = async () => {
    try {
      await groupApi.deleteGroup(groupId);
      removeAnonSession(groupId);
      onLeft?.();
    } catch (err) {
      flash(err.response?.data?.error?.message || 'Failed to delete group.', 'error');
    }
  };

  return (
    <aside
      aria-label="Anonymous Group Information & Moderation"
      className={cn(
        'w-72 lg:w-80 glass-panel border-l border-[var(--color-border)] overflow-y-auto flex-shrink-0 p-4 space-y-4 text-[var(--color-text-primary)] flex flex-col',
        className
      )}
    >
      {/* 1. Anonymous Privacy Banner */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-[var(--palette-teal)]/12 via-[var(--palette-sage)]/10 to-[var(--palette-rose)]/12 border border-[var(--palette-teal)]/25 relative overflow-hidden">
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-accent)] mb-1">
          <span className="w-6 h-6 rounded-lg bg-[var(--palette-teal)]/20 flex items-center justify-center text-[var(--palette-teal)]">
            <Shield size={13} strokeWidth={2.5} />
          </span>
          <span className="tracking-tight uppercase text-[11px] font-display">Anonymous Channel</span>
        </div>
        <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
          Zero-knowledge identity mode. No one — not even group moderators — can trace messages back to your main account.
        </p>
      </div>

      {/* Floating / Inline Flash message banner */}
      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'px-3 py-2 rounded-xl text-xs flex items-center gap-2 border shadow-sm',
              actionMsg.type === 'error'
                ? 'bg-[var(--color-danger)]/15 border-[var(--color-danger)]/30 text-[var(--color-danger)]'
                : actionMsg.type === 'info'
                ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/30 text-[var(--color-accent)]'
                : 'bg-[var(--color-success)]/15 border-[var(--color-success)]/30 text-[var(--color-success)]'
            )}
          >
            <Sparkles size={13} className="flex-shrink-0" />
            <span className="leading-snug">{actionMsg.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Invite Link (Creator Only) */}
      {isCreator && (
        <section className="glass-card p-3.5 rounded-2xl border border-[var(--color-border)] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--color-text-primary)] flex items-center gap-1.5">
              <Link2 size={13} className="text-[var(--color-accent)]" /> Anonymous Invite Link
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] font-semibold border border-[var(--palette-teal)]/30">
              Creator
            </span>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
            Invite anyone to join this channel. Recipients choose their own anonymous alias upon entering.
          </p>
          <button
            type="button"
            onClick={handleCopyInviteLink}
            disabled={copyingLink}
            className="btn btn-secondary text-xs w-full py-2 flex items-center justify-center gap-2 hover:border-[var(--color-accent)] transition-all"
          >
            {copyingLink ? (
              <>
                <Loader2 size={13} className="animate-spin text-[var(--color-accent)]" />
                <span>Generating link...</span>
              </>
            ) : copiedLink ? (
              <>
                <Check size={13} className="text-[var(--color-success)]" />
                <span className="text-[var(--color-success)] font-semibold">Link Copied!</span>
              </>
            ) : (
              <>
                <Copy size={13} />
                <span>Copy Invite Link</span>
              </>
            )}
          </button>
        </section>
      )}

      {/* 3. My Identity Card */}
      <section className="glass-card p-3.5 rounded-2xl border border-[var(--color-border)] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--color-text-primary)] flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-[var(--color-accent)]" /> Your Persona
          </span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
            This is you
          </span>
        </div>

        {/* Avatar + Alias Tag */}
        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
          <Avatar
            src={myIdentity?.avatarUrl}
            name={myIdentity?.alias}
            className="w-10 h-10 rounded-xl shadow-sm border border-[var(--color-border)] flex-shrink-0"
            fallbackChar={myIdentity?.alias?.charAt(0)?.toUpperCase() || '?'}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate flex items-center gap-1">
              <span>{myIdentity?.alias || 'Anonymous'}</span>
              {myIdentity?.aliasTag && (
                <span className="text-xs font-mono text-[var(--palette-teal)] opacity-85">
                  #{myIdentity.aliasTag}
                </span>
              )}
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" /> Active in room
            </div>
          </div>
        </div>

        {/* Rename Form */}
        <form onSubmit={handleRename} className="space-y-2">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              maxLength={24}
              placeholder="Change alias..."
              className="matte-input text-xs py-1.5 px-2.5 rounded-lg flex-1"
            />
            <button
              type="submit"
              disabled={renaming || !aliasInput.trim() || aliasInput.trim() === myIdentity?.alias}
              className="btn btn-primary text-xs px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              {renaming ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <span className="flex items-center gap-1">
                  <Edit3 size={11} />
                  <span>Rename</span>
                </span>
              )}
            </button>
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)] leading-tight flex items-start gap-1">
            <Info size={11} className="flex-shrink-0 mt-0.5 opacity-70" />
            <span>Renaming drops your old secret and permanently severs prior alias history.</span>
          </p>
        </form>
      </section>

      {/* 4. Creator Moderation Tools */}
      {isCreator && (
        <>
          {/* Word Bans */}
          <section className="glass-card p-3.5 rounded-2xl border border-[var(--color-border)] space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-primary)]">
              <UserRoundCog size={13} className="text-[var(--color-accent)]" /> Banned Words Filter
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] leading-tight">
              Messages containing these words are automatically rejected for all members.
            </p>
            <form onSubmit={handleWordBans} className="space-y-2">
              <input
                type="text"
                value={wordBans}
                onChange={(e) => setWordBans(e.target.value)}
                placeholder="spam, insult1, insult2..."
                className="matte-input text-xs py-1.5 px-2.5 rounded-lg"
              />
              <button
                type="submit"
                disabled={savingBans}
                className="btn btn-secondary text-xs w-full py-1.5 rounded-lg"
              >
                {savingBans ? (
                  <>
                    <Loader2 size={12} className="animate-spin text-[var(--color-accent)]" />
                    <span>Saving words...</span>
                  </>
                ) : (
                  <span>Save Banned Words</span>
                )}
              </button>
            </form>
          </section>

          {/* Open Reports */}
          <section className="glass-card p-3.5 rounded-2xl border border-[var(--color-border)] space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-primary)]">
                <Flag size={13} className="text-[var(--color-warning)]" />
                <span>Reports</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[var(--palette-rose)]/15 text-[var(--color-danger)] border border-[var(--palette-rose)]/30">
                {reports.length}
              </span>
            </div>

            {loadingReports && (
              <div className="py-4 flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Loader2 size={13} className="animate-spin text-[var(--color-accent)]" />
                <span>Loading reports...</span>
              </div>
            )}

            {!loadingReports && reports.length === 0 && (
              <p className="text-[11px] text-[var(--color-text-muted)] italic py-1">
                No open reports in this channel.
              </p>
            )}

            <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
              {reports.map((r, idx) => {
                const targetId = r.identity?.id;
                const isBanned = Boolean(r.identity?.bannedAt);
                const isBusy = banningId === targetId;

                return (
                  <div
                    key={targetId || `report-${idx}`}
                    className="text-xs p-2.5 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--color-text-primary)] truncate">
                        {r.identity?.alias || 'Unknown'}
                        {r.identity?.aliasTag ? (
                          <span className="font-mono text-[10px] text-[var(--palette-teal)] ml-0.5">
                            #{r.identity.aliasTag}
                          </span>
                        ) : ''}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-muted)] font-mono">
                        {r.reports?.length || 1}×
                      </span>
                    </div>

                    {r.reports && r.reports.length > 0 && (
                      <p className="text-[10px] text-[var(--color-text-muted)] line-clamp-2 bg-[var(--color-bg-primary)]/70 p-1.5 rounded-lg border border-[var(--color-border)]">
                        "{r.reports[r.reports.length - 1]?.reason || 'No description'}"
                      </p>
                    )}

                    <div className="flex gap-1.5 pt-1">
                      {!isBanned ? (
                        <button
                          type="button"
                          onClick={() => handleBan(targetId)}
                          disabled={isBusy}
                          className="btn text-[10px] py-1 px-2.5 rounded-lg bg-[var(--color-danger)]/12 text-[var(--color-danger)] border border-[var(--color-danger)]/25 hover:bg-[var(--color-danger)] hover:text-white transition-colors"
                        >
                          {isBusy ? <Loader2 size={10} className="animate-spin" /> : <Ban size={10} />}
                          <span>Ban Identity</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleUnban(targetId)}
                          disabled={isBusy}
                          className="btn btn-secondary text-[10px] py-1 px-2.5 rounded-lg"
                        >
                          {isBusy ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                          <span>Unban</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* Spacer to push actions to bottom */}
      <div className="flex-1" />

      {/* 5. Danger Zone & Leave Group */}
      <div className="pt-2 border-t border-[var(--color-border)] space-y-2">
        {/* Leave Group */}
        {!confirmLeave ? (
          <button
            type="button"
            onClick={() => setConfirmLeave(true)}
            className="w-full text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-2 rounded-xl hover:bg-[var(--color-bg-secondary)] flex items-center justify-center gap-2 transition-colors font-medium"
          >
            <LogOut size={13} />
            <span>Leave group (delete my alias)</span>
          </button>
        ) : (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 rounded-xl bg-[var(--palette-rose)]/12 border border-[var(--palette-rose)]/30 space-y-2 text-xs"
          >
            <div className="flex items-start gap-1.5 text-[var(--color-danger)]">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                Leaving permanently erases this alias and your stored cryptographic key.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleLeave}
                className="btn btn-danger text-xs py-1.5 px-3 flex-1 rounded-lg"
              >
                Yes, leave
              </button>
              <button
                type="button"
                onClick={() => setConfirmLeave(false)}
                className="btn btn-secondary text-xs py-1.5 px-3 flex-1 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}

        {/* Creator Delete Group */}
        {isCreator && (
          <div>
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="w-full text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 p-2 rounded-xl flex items-center justify-center gap-2 transition-colors font-medium"
              >
                <Trash2 size={13} />
                <span>Delete entire group</span>
              </button>
            ) : (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-3 rounded-xl bg-[var(--color-danger)]/15 border border-[var(--color-danger)]/35 space-y-2 text-xs"
              >
                <div className="flex items-start gap-1.5 text-[var(--color-danger)]">
                  <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] font-medium leading-relaxed">
                    Permanently delete this anonymous group and all messages for everyone?
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDeleteGroup}
                    className="btn btn-danger text-xs py-1.5 px-3 flex-1 rounded-lg font-semibold"
                  >
                    Yes, delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="btn btn-secondary text-xs py-1.5 px-3 flex-1 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

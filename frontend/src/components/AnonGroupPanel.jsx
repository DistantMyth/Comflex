/**
 * AnonGroupPanel — Sidebar for anonymous groups.
 *
 * Shows your alias, lets you rename (secret rotates), and gives the group
 * creator the hidden-moderation tools: open reports (alias + reason only),
 * ban/unban an identity, and maintain the word-ban list. Nothing here can
 * ever reveal who an alias belongs to.
 */

import { useState, useEffect } from 'react';
import { Shield, Flag, Trash2, UserRoundCog } from 'lucide-react';
import { groupApi } from '../api/groupApi';
import { updateAnonSession, removeAnonSession } from '../api/client';
import resolveAsset from '../utils/resolveAsset';

export default function AnonGroupPanel({ groupId, myIdentity, isCreator, onLeft }) {
  const [aliasInput, setAliasInput] = useState(myIdentity?.alias || '');
  const [renaming, setRenaming] = useState(false);
  const [reports, setReports] = useState([]);
  const [wordBans, setWordBans] = useState('');
  const [savingBans, setSavingBans] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const flash = (msg) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(''), 2500);
  };

  const handleDeleteGroup = async () => {
    try {
      await groupApi.deleteGroup(groupId);
      removeAnonSession(groupId);
      onLeft?.();
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to delete group.');
    }
  };

  useEffect(() => {
    if (!isCreator) return;
    groupApi.getAnonReports(groupId)
      .then((res) => setReports(res.data.data || []))
      .catch(() => {});
  }, [groupId, isCreator]);

  const handleRename = async (e) => {
    e.preventDefault();
    if (!aliasInput.trim()) return;
    setRenaming(true);
    try {
      const res = await groupApi.renameAnonIdentity(groupId, aliasInput.trim());
      updateAnonSession(groupId, {
        secret: res.data.data.secret,
        alias: res.data.data.alias,
        aliasTag: res.data.data.aliasTag,
        avatarUrl: res.data.data.avatarUrl,
      });
      flash('Alias updated — your old name is gone forever.');
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Rename failed.');
    } finally {
      setRenaming(false);
    }
  };

  const handleBan = async (identityId) => {
    if (!window.confirm('Ban this identity? Their future posts are blocked and their messages are hidden. You will never know who they were.')) return;
    try {
      await groupApi.banAnonIdentity(groupId, identityId);
      setReports((prev) => prev.filter((r) => r.identity?.id !== identityId));
      flash('Identity banned.');
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Ban failed.');
    }
  };

  const handleUnban = async (identityId) => {
    try {
      await groupApi.unbanAnonIdentity(groupId, identityId);
      flash('Identity un-banned.');
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Unban failed.');
    }
  };

  const handleWordBans = async (e) => {
    e.preventDefault();
    setSavingBans(true);
    try {
      const words = wordBans.split(',').map((w) => w.trim()).filter(Boolean);
      await groupApi.setWordBans(groupId, words);
      flash('Word bans saved.');
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to save word bans.');
    } finally {
      setSavingBans(false);
    }
  };

  const handleLeave = async () => {
    try {
      await groupApi.leaveAnonIdentity(groupId);
      removeAnonSession(groupId);
      onLeft?.();
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to leave.');
    }
  };

  return (
    <div className="w-64 glass-card overflow-y-auto flex-shrink-0 hidden md:block p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-accent)]">
        <Shield size={14} /> Anonymous group
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
        No one here — not even the creator — can see who wrote any message.
      </p>

      {/* My identity */}
      <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-2 mb-1">
          {myIdentity?.avatarUrl ? (
            <img src={resolveAsset(myIdentity.avatarUrl)} alt="" className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[var(--color-accent)]/20 flex items-center justify-center text-white text-xs font-bold">
              {myIdentity?.alias?.charAt(0)?.toUpperCase() || '?'}
            </div>
          )}
          <div>
            <div className="text-sm font-semibold">
              {myIdentity?.alias || 'Alias'}{myIdentity?.aliasTag ? `#${myIdentity.aliasTag}` : ''}
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)]">this is you</div>
          </div>
        </div>

        <form onSubmit={handleRename} className="flex gap-1.5 mt-2">
          <input
            type="text"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            maxLength={24}
            placeholder="New alias"
            className="flex-1 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button type="submit" disabled={renaming} className="btn btn-primary text-xs px-2.5 py-1.5">
            {renaming ? '...' : 'Rename'}
          </button>
        </form>
        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
          Renaming permanently drops the old alias.
        </p>
      </div>

      {actionMsg && <p className="text-[11px] text-[var(--color-success)]">{actionMsg}</p>}

      {/* Creator moderation */}
      {isCreator && (
        <>
          <form onSubmit={handleWordBans} className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-text-primary)]">
              <UserRoundCog size={13} /> Banned words
            </div>
            <input
              type="text"
              value={wordBans}
              onChange={(e) => setWordBans(e.target.value)}
              placeholder="badword1, badword2, ..."
              className="w-full text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[var(--color-accent)]"
            />
            <button type="submit" disabled={savingBans} className="btn btn-secondary text-xs w-full py-1.5">
              {savingBans ? 'Saving...' : 'Save'}
            </button>
          </form>

          <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-text-primary)]">
              <Flag size={13} /> Reports ({reports.length})
            </div>
            {reports.length === 0 && (
              <p className="text-[11px] text-[var(--color-text-muted)]">No open reports.</p>
            )}
            {reports.map((r) => (
              <div key={r.identity?.id} className="text-xs border-t border-[var(--color-border)] pt-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {r.identity?.alias || 'Unknown'}{r.identity?.aliasTag ? `#${r.identity.aliasTag}` : ''}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">{r.reports.length}×</span>
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] line-clamp-2">
                  {r.reports[r.reports.length - 1]?.reason}
                </p>
                <div className="flex gap-1.5">
                  <button onClick={() => handleBan(r.identity.id)} className="btn text-[10px] py-1 px-2 bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white">
                    Ban
                  </button>
                  {r.identity.bannedAt && (
                    <button onClick={() => handleUnban(r.identity.id)} className="btn btn-secondary text-[10px] py-1 px-2">
                      Unban
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Leave */}
      <div className="pt-2">
        {!confirmLeave ? (
          <button onClick={() => setConfirmLeave(true)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)] flex items-center gap-1.5">
            <Trash2 size={12} /> Leave group (delete my identity)
          </button>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[11px] text-[var(--color-danger)]">
              Leaving deletes your alias. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={handleLeave} className="btn text-xs py-1 px-2 bg-[var(--color-danger)] text-white">Yes, leave</button>
              <button onClick={() => setConfirmLeave(false)} className="btn btn-secondary text-xs py-1 px-2">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Creator delete group */}
      {isCreator && (
        <div className="pt-2 border-t border-[var(--color-border)]">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-[var(--color-danger)] hover:underline flex items-center gap-1.5 font-medium"
            >
              <Trash2 size={12} /> Delete entire group
            </button>
          ) : (
            <div className="space-y-1.5 p-2.5 rounded-lg bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30">
              <p className="text-[11px] text-[var(--color-danger)] font-medium">
                Permanently delete this group and all its messages for everyone?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleDeleteGroup}
                  className="btn text-xs py-1 px-2.5 bg-[var(--color-danger)] text-white font-medium"
                >
                  Yes, delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="btn btn-secondary text-xs py-1 px-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
/**
 * CreateCohortGroupModal — Modal for creating an official cohort/branch group.
 * Allows users with 'canCreateGroups' permission to create groups targeted to a specific year/branch.
 */

import { useState, useRef, useEffect } from 'react';
import { groupApi } from '../api/groupApi';
import client from '../api/client';

export default function CreateCohortGroupModal({ onClose, onCreated }) {
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [targetYears, setTargetYears] = useState([]);
  const [targetBranches, setTargetBranches] = useState([]);
  const [availableBranches, setAvailableBranches] = useState({});
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  // Derive sensible years
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 3, currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2, currentYear + 3, currentYear + 4];

  useEffect(() => {
    // Fetch branch mapping from system status
    client.get('/system/status').then(res => {
      if (res.data?.data?.branchMapping) {
        setAvailableBranches(res.data.data.branchMapping);
      }
    }).catch(console.error);
  }, []);

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleYearToggle = (y) => {
    setTargetYears(prev => prev.includes(y) ? prev.filter(item => item !== y) : [...prev, y]);
  };

  const handleBranchToggle = (b) => {
    setTargetBranches(prev => prev.includes(b) ? prev.filter(item => item !== b) : [...prev, b]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!displayName.trim()) return setError('Group Name is required.');

    setLoading(true);
    setError('');

    try {
      const slug = displayName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const uniqueSlug = `${slug}-${Date.now().toString().slice(-4)}`;

      const data = {
        name: uniqueSlug,
        displayName: displayName.trim(),
        description: description.trim(),
        type: 'primary',
        autoAdd: 'cohort',
      };

      if (targetYears.length > 0) data.targetYears = targetYears;
      if (targetBranches.length > 0) data.targetBranches = targetBranches;

      const res = await groupApi.createGroup(data);
      const group = res.data.data?.group || res.data.data;

      // Upload avatar if selected
      if (avatarFile && group?.id) {
        try {
          await groupApi.uploadGroupAvatar(group.id, avatarFile);
        } catch {
          // Non-critical
        }
      }

      onCreated?.(group);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to create group.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[var(--color-accent)]">Create Official Cohort Group</h2>
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

          {/* Group Name */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Group Name *</label>
            <input
              type="text"
              className="input w-full"
              placeholder="e.g. CS Batch 2028"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              required
            />
          </div>

          {/* Target Filters Checkboxes */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Target Year(s) (Optional)</label>
              <div className="text-xs text-[var(--color-text-muted)] mb-2">Leave all unchecked for ALL years.</div>
              <div className="max-h-32 overflow-y-auto space-y-1 bg-[var(--color-bg-primary)] p-2 rounded-lg border border-[var(--color-border)]">
                {yearOptions.map(y => (
                  <label key={y} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-[var(--color-bg-secondary)] p-1 rounded">
                    <input
                      type="checkbox"
                      onChange={() => handleYearToggle(y)}
                      checked={targetYears.includes(y)}
                      className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                    />
                    {y}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Target Branch(es) (Optional)</label>
              <div className="text-xs text-[var(--color-text-muted)] mb-2">Leave all unchecked for ALL branches.</div>
              <div className="max-h-32 overflow-y-auto space-y-1 bg-[var(--color-bg-primary)] p-2 rounded-lg border border-[var(--color-border)]">
                {Object.keys(availableBranches).length === 0 && (
                   <div className="text-xs text-[var(--color-warning)] p-1">No branches mapped in admin config.</div>
                )}
                {Object.entries(availableBranches).map(([code, name]) => (
                  <label key={code} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-[var(--color-bg-secondary)] p-1 rounded">
                    <input
                      type="checkbox"
                      onChange={() => handleBranchToggle(code)}
                      checked={targetBranches.includes(code)}
                      className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                    />
                    {name} ({code.toUpperCase()})
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="text-xs text-[var(--color-text-muted)] bg-[rgba(108,99,255,0.1)] p-3 rounded-lg border border-[var(--color-accent)]">
            <strong>Note:</strong> Seniors who are not your friends will receive a private message with a link to join, instead of being added directly. Juniors, batchmates, and senior friends will be added instantly.
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Description (Optional)</label>
            <textarea
              className="input w-full resize-none"
              rows={3}
              placeholder="What's this group about?"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-[var(--color-danger)] bg-[rgba(255,71,87,0.1)] p-3 rounded-lg">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1">
              {loading ? 'Creating...' : 'Create Cohort Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

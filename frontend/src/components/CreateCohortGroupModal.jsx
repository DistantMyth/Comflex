/**
 * CreateCohortGroupModal — Modal for creating an official cohort/branch group.
 * Features:
 * - Matte + Glassy design system with blush, bisque, sage, sage teal, and slate mauve palette.
 * - Framer Motion spring backdrop and container scaling.
 * - Interactive tag/chip selectors for target academic years and branches.
 * - System branch mapping retrieval from /system/status with sensible fallbacks.
 * - Cohort automated enrollment rule notice.
 * - Avatar selection with preview and removal.
 * - Full feature parity with legacy implementation.
 */

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Camera,
  Upload,
  GraduationCap,
  Calendar,
  Building2,
  Check,
  Info,
  AlertCircle,
} from 'lucide-react';
import { groupApi } from '../api/groupApi';
import client from '../api/client';

const FALLBACK_BRANCHES = {
  cse: 'Computer Science & Engineering',
  it: 'Information Technology',
  ece: 'Electronics & Communication',
  ee: 'Electrical Engineering',
  me: 'Mechanical Engineering',
  ce: 'Civil Engineering',
};

export default function CreateCohortGroupModal({ onClose, onCreated }) {
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [targetYears, setTargetYears] = useState([]);
  const [targetBranches, setTargetBranches] = useState([]);
  const [availableBranches, setAvailableBranches] = useState(FALLBACK_BRANCHES);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  // Derive academic years (e.g., current year - 3 through current year + 4)
  const currentYear = new Date().getFullYear();
  const yearOptions = [
    currentYear - 3,
    currentYear - 2,
    currentYear - 1,
    currentYear,
    currentYear + 1,
    currentYear + 2,
    currentYear + 3,
    currentYear + 4,
  ];

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Fetch branch mapping from system status
  useEffect(() => {
    let mounted = true;
    client
      .get('/system/status')
      .then((res) => {
        if (mounted && res.data?.data?.branchMapping && Object.keys(res.data.data.branchMapping).length > 0) {
          setAvailableBranches(res.data.data.branchMapping);
        }
      })
      .catch(() => {
        // Fallback already pre-populated
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Cleanup object URL preview on unmount
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

  const handleYearToggle = (y) => {
    setTargetYears((prev) =>
      prev.includes(y) ? prev.filter((item) => item !== y) : [...prev, y]
    );
  };

  const handleBranchToggle = (b) => {
    setTargetBranches((prev) =>
      prev.includes(b) ? prev.filter((item) => item !== b) : [...prev, b]
    );
  };

  const selectAllYears = () => setTargetYears([...yearOptions]);
  const clearYears = () => setTargetYears([]);

  const branchKeys = Object.keys(availableBranches);
  const selectAllBranches = () => setTargetBranches([...branchKeys]);
  const clearBranches = () => setTargetBranches([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!displayName.trim()) return setError('Group Name is required.');

    setLoading(true);
    setError('');

    try {
      const slug = displayName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '') || 'cohort';
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
      const group = res.data?.data?.group || res.data?.data;

      // Upload avatar if selected
      if (avatarFile && group?.id) {
        try {
          await groupApi.uploadGroupAvatar(group.id, avatarFile);
        } catch {
          // Non-critical, group created
        }
      }

      onCreated?.(group);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to create cohort group.');
    } finally {
      setLoading(false);
    }
  };

  return (
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
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#bfd3c1] to-[#68a691] flex items-center justify-center text-white shadow-sm">
              <GraduationCap size={20} className="stroke-[2.2]" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-display text-[var(--color-text-primary)]">
                Create Official Cohort Group
              </h2>
              <p className="text-xs text-[var(--color-text-muted)]">
                Targeted to specific academic batches and branches
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
                className="relative w-22 h-22 rounded-3xl bg-gradient-to-br from-[#ffe5d4] via-[#bfd3c1] to-[#68a691] p-0.5 shadow-md hover:shadow-lg transition-all duration-200 overflow-hidden flex items-center justify-center"
              >
                <div className="w-full h-full rounded-[22px] bg-[var(--color-bg-matte)] flex items-center justify-center overflow-hidden">
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="Cohort Avatar Preview"
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
              Optional cohort emblem / badge
            </span>
          </div>

          {/* Group Name (Required) */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
              Cohort Name <span className="text-[var(--color-accent)]">*</span>
            </label>
            <input
              type="text"
              className="matte-input"
              placeholder="e.g. CS Batch 2028"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>

          {/* Target Academic Years Filter */}
          <div className="space-y-2 p-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar size={15} className="text-[var(--color-accent)]" />
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Target Year(s)
                </label>
                {targetYears.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--color-accent-tint)] text-[var(--color-accent)] border border-[var(--color-accent-light)]/40">
                    {targetYears.length} selected
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={selectAllYears}
                  className="text-[var(--color-accent)] hover:underline font-medium"
                >
                  Select all
                </button>
                <span className="text-[var(--color-border)]">|</span>
                <button
                  type="button"
                  onClick={clearYears}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] font-medium"
                >
                  Clear
                </button>
              </div>
            </div>

            <p className="text-[11px] text-[var(--color-text-muted)]">
              {targetYears.length === 0
                ? 'All graduation years included (leave unselected for entire student body).'
                : `Active only for batch(es): ${targetYears.sort().join(', ')}`}
            </p>

            {/* Year Tag Chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {yearOptions.map((year) => {
                const isSelected = targetYears.includes(year);
                return (
                  <button
                    key={year}
                    type="button"
                    onClick={() => handleYearToggle(year)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all select-none ${
                      isSelected
                        ? 'bg-[var(--color-accent)] text-white shadow-sm scale-100'
                        : 'bg-[var(--color-bg-matte)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:border-[var(--color-accent-light)]'
                    }`}
                  >
                    {isSelected && <Check size={13} className="stroke-[2.6]" />}
                    <span>{year}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target Branches Filter */}
          <div className="space-y-2 p-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 size={15} className="text-[var(--color-accent)]" />
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Target Branch(es)
                </label>
                {targetBranches.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--color-accent-tint)] text-[var(--color-accent)] border border-[var(--color-accent-light)]/40">
                    {targetBranches.length} selected
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={selectAllBranches}
                  className="text-[var(--color-accent)] hover:underline font-medium"
                >
                  Select all
                </button>
                <span className="text-[var(--color-border)]">|</span>
                <button
                  type="button"
                  onClick={clearBranches}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] font-medium"
                >
                  Clear
                </button>
              </div>
            </div>

            <p className="text-[11px] text-[var(--color-text-muted)]">
              {targetBranches.length === 0
                ? 'All branches included (leave unselected for campus-wide cohort).'
                : `Filtered to: ${targetBranches.map((b) => b.toUpperCase()).join(', ')}`}
            </p>

            {/* Branch Tag Chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {Object.entries(availableBranches).map(([code, name]) => {
                const isSelected = targetBranches.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => handleBranchToggle(code)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all select-none ${
                      isSelected
                        ? 'bg-[var(--color-accent)] text-white shadow-sm scale-100'
                        : 'bg-[var(--color-bg-matte)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:border-[var(--color-accent-light)]'
                    }`}
                    title={name}
                  >
                    {isSelected && <Check size={13} className="stroke-[2.6]" />}
                    <span>{code.toUpperCase()}</span>
                    <span
                      className={`text-[10px] max-w-[120px] truncate ${
                        isSelected ? 'text-white/80' : 'text-[var(--color-text-muted)]'
                      }`}
                    >
                      ({name})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
              Description <span className="text-[11px] text-[var(--color-text-muted)] font-normal">(Optional)</span>
            </label>
            <textarea
              className="matte-input resize-none"
              rows={3}
              placeholder="What is this cohort group about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Policy / Automated Rules Notice */}
          <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-[var(--palette-bisque)]/40 dark:bg-[var(--palette-plum)]/20 border border-[var(--palette-rose)]/40 text-[var(--color-text-secondary)]">
            <Info size={17} className="text-[var(--color-accent)] flex-shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed">
              <strong className="text-[var(--color-text-primary)]">Enrollment Note:</strong> Seniors who are not already your friends will receive a private invitation link instead of being added directly. Juniors, batchmates, and senior friends will be enrolled instantly.
            </p>
          </div>

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
              disabled={loading || !displayName.trim()}
              className="btn btn-primary flex-1 py-2.5 rounded-2xl text-xs font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating...
                </span>
              ) : (
                'Create Cohort Group'
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

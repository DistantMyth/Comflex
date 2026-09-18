import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Tags, Users, Link2, Activity, Database, Search, RefreshCw,
  Trash2, ShieldCheck, UserPlus, CheckCircle2, XCircle, Loader2, AlertCircle,
  HardDrive, Clock, Check, X, ChevronLeft, ChevronRight, Info, ChevronDown, ChevronUp
} from 'lucide-react';
import { adminApi } from '../api/adminApi';
import resolveAsset from '../utils/resolveAsset';

const RING_LABELS = ['Admin (Ring 0)', 'Manager (Ring 1)', 'Elevated (Ring 2)', 'Member (Ring 3)', 'Restricted (Ring 4)'];

const RING_PERMISSIONS_INFO = {
  0: {
    label: 'Admin (Ring 0)',
    badge: 'bg-red-500/15 text-red-400 border-red-500/30',
    description: 'Full root platform admin. Unrestricted privileges across all groups, events, settings, and user permissions.',
  },
  1: {
    label: 'Manager (Ring 1)',
    badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    description: 'Platform manager. Can manage groups, moderate users, and elevate users up to Ring 1.',
  },
  2: {
    label: 'Elevated (Ring 2)',
    badge: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    description: 'Elevated member. Senior cohort moderation powers (mute, kick, pin, delete others\' messages in cross-year groups).',
  },
  3: {
    label: 'Member (Ring 3)',
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    description: 'Standard member. Can read, write messages, upload resources, and participate across assigned cohorts.',
  },
  4: {
    label: 'Restricted (Ring 4)',
    badge: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    description: 'Restricted / read-only member. Muted or restricted access applied as a moderation boundary.',
  },
};

export default function AdminDashboard() {
  const [tab, setTab] = useState('institution');

  const tabs = [
    { key: 'institution', label: 'Institution', icon: Building2 },
    { key: 'cohort', label: 'Cohort Rules', icon: Tags },
    { key: 'groups', label: 'Groups Hub', icon: Users },
    { key: 'autojoin', label: 'Auto-Join Rules', icon: Link2 },
    { key: 'users', label: 'User Directory', icon: UserPlus },
    { key: 'diagnostics', label: 'Diagnostics', icon: Activity },
    { key: 'database', label: 'Database Snapshots', icon: Database },
  ];

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-display text-[var(--color-text-primary)]">Admin Control Center</h1>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Platform configuration, cohort rules, user RBAC privileges, and diagnostics</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 p-1.5 bg-[var(--color-bg-matte)] rounded-2xl border border-[var(--color-border)] mb-6 overflow-x-auto">
        {tabs.map((t) => {
          const active = tab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative flex-1 py-2 px-3.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center justify-center gap-1.5 ${
                active ? 'text-white' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="admin-tab-pill"
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-[var(--color-accent)] to-[#528976] shadow-md"
                />
              )}
              <Icon size={14} className="relative z-10" />
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div>
        {tab === 'institution' && <InstitutionTab />}
        {tab === 'cohort' && <CohortTab />}
        {tab === 'groups' && <GroupsTab />}
        {tab === 'autojoin' && <AutoJoinTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'diagnostics' && <DiagnosticsTab />}
        {tab === 'database' && <DatabaseTab />}
      </div>
    </div>
  );
}

// ---------------- INSTITUTION TAB ----------------
function InstitutionTab() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', domain: '', defaultCredits: 0 });
  const [status, setStatus] = useState({ message: '', isError: false });

  useEffect(() => {
    adminApi.getInstitution().then((res) => {
      const data = res.data?.data;
      setConfig(data);
      setForm({ name: data?.name || '', domain: data?.domain || '', defaultCredits: data?.defaultCredits ?? 0 });
    }).catch(() => setStatus({ message: 'Failed to load configuration.', isError: true }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus({ message: '', isError: false });
    try {
      await adminApi.updateInstitution(form);
      setStatus({ message: 'Institution settings updated successfully!', isError: false });
    } catch (err) {
      setStatus({ message: err.response?.data?.error?.message || 'Save failed.', isError: true });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-12 text-center text-xs text-[var(--color-text-muted)]">Loading settings...</div>;

  return (
    <div className="glass-card p-6 border border-[var(--color-border)] space-y-4 max-w-xl">
      <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">Institutional Identity</h3>
      {status.message && (
        <div className={`text-xs p-3 rounded-2xl font-medium ${
          status.isError ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]' : 'bg-[var(--palette-teal)]/15 text-[var(--palette-teal)]'
        }`}>
          {status.message}
        </div>
      )}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
          University / Organization Name
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="matte-input text-xs"
        />
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
          Allowed Email Domain
        </label>
        <input
          type="text"
          value={form.domain}
          onChange={(e) => setForm({ ...form, domain: e.target.value })}
          className="matte-input text-xs"
          placeholder="university.edu"
        />
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
          Starting Balance for New Students
        </label>
        <input
          type="number"
          value={form.defaultCredits}
          onChange={(e) => setForm({ ...form, defaultCredits: Number(e.target.value) })}
          min={0}
          className="matte-input text-xs"
        />
      </div>
      <button onClick={handleSave} disabled={saving} className="btn btn-primary text-xs py-2 px-5 shadow-xs">
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        <span>Save Changes</span>
      </button>
    </div>
  );
}

// ---------------- COHORT RULES TAB ----------------
function CohortTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    pattern: '', captureGroup: 1, yearOffset: 0,
    branchCaptureGroup: '', branchMapping: {},
  });
  const [branchMapInput, setBranchMapInput] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    adminApi.getCohortConfig().then((res) => {
      const rules = res.data?.data?.emailParsingRules;
      if (rules) {
        setForm({
          pattern: rules.pattern || '',
          captureGroup: rules.captureGroup ?? 1,
          yearOffset: rules.yearOffset ?? 0,
          branchCaptureGroup: rules.branchCaptureGroup ?? '',
          branchMapping: rules.branchMapping || {},
        });
        if (rules.branchMapping) {
          setBranchMapInput(
            Object.entries(rules.branchMapping).map(([k, v]) => `${k}=${v}`).join(', ')
          );
        }
      }
    }).finally(() => setLoading(false));
  }, []);

  const parseBranchMapping = (str) => {
    const map = {};
    str.split(',').forEach((pair) => {
      const [k, v] = pair.split('=').map(s => s.trim());
      if (k && v) map[k.toLowerCase()] = v;
    });
    return map;
  };

  const handlePreview = async () => {
    setPreview(null);
    try {
      const payload = {
        email: testEmail,
        pattern: form.pattern,
        captureGroup: String(form.captureGroup),
        yearOffset: Number(form.yearOffset) || 0,
        branchMapping: Object.keys(form.branchMapping).length > 0 ? form.branchMapping : parseBranchMapping(branchMapInput),
      };
      if (form.branchCaptureGroup !== '' && form.branchCaptureGroup !== undefined) {
        payload.branchCaptureGroup = Number(form.branchCaptureGroup);
      }
      const res = await adminApi.previewCohortConfig(payload);
      setPreview(res.data?.data);
    } catch (err) {
      setPreview({ matched: false, message: err.response?.data?.error?.message || 'Preview failed' });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const rules = {
        pattern: form.pattern,
        captureGroup: Number(form.captureGroup),
        yearOffset: Number(form.yearOffset) || 0,
      };
      if (form.branchCaptureGroup !== '' && form.branchCaptureGroup !== undefined) {
        rules.branchCaptureGroup = Number(form.branchCaptureGroup);
      }
      rules.branchMapping = parseBranchMapping(branchMapInput);
      await adminApi.updateCohortConfig({
        emailParsingRules: rules,
        cohortConfig: { seniorOffset: -1, juniorOffset: 1, seniorAutoElevate: true },
      });
      setMessage('Cohort rules configured successfully!');
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to save rules.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-12 text-center text-xs text-[var(--color-text-muted)]">Loading parsing rules...</div>;

  return (
    <div className="glass-card p-6 border border-[var(--color-border)] space-y-4 max-w-xl">
      <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">Email Parsing & Cohort Rules</h3>
      {message && <div className="text-xs p-3 rounded-2xl bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] font-medium">{message}</div>}

      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
          Regex Pattern
        </label>
        <input
          type="text"
          value={form.pattern}
          onChange={(e) => setForm({ ...form, pattern: e.target.value })}
          className="matte-input text-xs font-mono"
          placeholder="^([a-z]+)(\d{4})(\d{3,})@university\.edu$"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-bold text-[var(--color-text-secondary)] mb-1">Year Group #</label>
          <input
            type="number"
            value={form.captureGroup}
            onChange={(e) => setForm({ ...form, captureGroup: Number(e.target.value) })}
            className="matte-input text-xs"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-[var(--color-text-secondary)] mb-1">Year Offset</label>
          <input
            type="number"
            value={form.yearOffset}
            onChange={(e) => setForm({ ...form, yearOffset: Number(e.target.value) })}
            className="matte-input text-xs"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-[var(--color-text-secondary)] mb-1">Branch Group #</label>
          <input
            type="number"
            value={form.branchCaptureGroup}
            onChange={(e) => setForm({ ...form, branchCaptureGroup: e.target.value })}
            className="matte-input text-xs"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
          Branch Code Mapping
        </label>
        <input
          type="text"
          value={branchMapInput}
          onChange={(e) => setBranchMapInput(e.target.value)}
          className="matte-input text-xs"
          placeholder="cs=Computer Science, ci=AI & Data Science"
        />
      </div>

      <div className="pt-3 border-t border-[var(--color-border)]">
        <label className="block text-xs font-bold text-[var(--color-text-primary)] mb-1.5">🧪 Test Regex Resolution</label>
        <div className="flex gap-2">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="e.g. cs2026001@university.edu"
            className="matte-input text-xs flex-1"
          />
          <button onClick={handlePreview} disabled={!testEmail} className="btn btn-secondary text-xs px-3">
            Simulate
          </button>
        </div>

        {preview && (
          <div className="mt-3 p-3 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-xs">
            {preview.extractedYear != null ? (
              <p className="text-[var(--palette-teal)] font-semibold">
                ✅ Year: <strong>{preview.extractedYear}</strong> • Branch: <strong>{preview.extractedBranch || 'None'}</strong> • Tags: {preview.predictedTags?.join(', ')}
              </p>
            ) : (
              <p className="text-[var(--color-danger)] font-medium">❌ {preview.message || 'No match found'}</p>
            )}
          </div>
        )}
      </div>

      <button onClick={handleSave} disabled={saving} className="btn btn-primary text-xs py-2 px-5 shadow-xs">
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        <span>Save Cohort Rules</span>
      </button>
    </div>
  );
}

// ---------------- GROUPS HUB TAB ----------------
function GroupsTab() {
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listAllGroups();
      setGroups(res.data?.data || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete group "${name}"?`)) return;
    try {
      await adminApi.deleteGroup(id);
      fetchGroups();
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Delete failed.');
    }
  };

  return (
    <div className="glass-card p-6 border border-[var(--color-border)] space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">All Platform Channels</h3>
        <span className="text-xs text-[var(--color-text-muted)]">{groups.length} groups</span>
      </div>

      <input
        type="text"
        placeholder="Filter groups..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="matte-input text-xs max-w-sm"
      />

      {loading ? (
        <div className="py-8 text-center text-xs text-[var(--color-text-muted)]">Loading groups...</div>
      ) : (
        <div className="space-y-2">
          {groups.filter(g => (g.displayName || g.name || '').toLowerCase().includes(search.toLowerCase())).map(g => (
            <div key={g.id} className="p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold text-[var(--color-text-primary)] truncate">{g.displayName || g.name}</p>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{g.type} • {g.memberCount ?? 0} members</p>
              </div>
              <button
                onClick={() => handleDelete(g.id, g.displayName || g.name)}
                className="btn btn-secondary text-xs py-1 px-2.5 text-[var(--color-danger)]"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- AUTO-JOIN RULES TAB ----------------
function AutoJoinTab() {
  const [rules, setRules] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([
      adminApi.getAutoJoinRules(),
      adminApi.listAllGroups(),
    ]).then(([rulesRes, groupsRes]) => {
      setRules(rulesRes.data?.data?.autoJoinRules || []);
      setGroups(groupsRes.data?.data || []);
    }).finally(() => setLoading(false));
  }, []);

  const addRule = () => {
    setRules([...rules, { matchField: 'year', matchValue: '', groupId: '' }]);
  };

  const removeRule = (idx) => {
    setRules(rules.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await adminApi.updateAutoJoinRules(rules);
      setMessage('Auto-join rules successfully updated!');
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to save rules.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-12 text-center text-xs text-[var(--color-text-muted)]">Loading auto-join rules...</div>;

  return (
    <div className="glass-card p-6 border border-[var(--color-border)] space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">Auto-Join Rules</h3>
        <button onClick={addRule} className="btn btn-secondary text-xs py-1.5 px-3">
          + Add Mapping
        </button>
      </div>

      {message && <div className="text-xs p-3 rounded-2xl bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] font-medium">{message}</div>}

      <div className="space-y-2.5">
        {rules.map((rule, idx) => (
          <div key={idx} className="p-3 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center gap-3 flex-wrap">
            <select
              value={rule.matchField}
              onChange={(e) => {
                const updated = [...rules];
                updated[idx].matchField = e.target.value;
                setRules(updated);
              }}
              className="matte-input text-xs py-1 w-28"
            >
              <option value="year">Year</option>
              <option value="branch">Branch</option>
              <option value="both">Both</option>
            </select>

            <input
              type="text"
              value={rule.matchValue}
              onChange={(e) => {
                const updated = [...rules];
                updated[idx].matchValue = e.target.value;
                setRules(updated);
              }}
              placeholder="e.g. 2026 or cs"
              className="matte-input text-xs py-1 w-32"
            />

            <span className="text-xs text-[var(--color-text-muted)]">→</span>

            <select
              value={rule.groupId}
              onChange={(e) => {
                const updated = [...rules];
                updated[idx].groupId = e.target.value;
                setRules(updated);
              }}
              className="matte-input text-xs py-1 flex-1 min-w-[160px]"
            >
              <option value="">Select target channel...</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.displayName || g.name}</option>
              ))}
            </select>

            <button onClick={() => removeRule(idx)} className="p-1 text-[var(--color-danger)]">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <button onClick={handleSave} disabled={saving} className="btn btn-primary text-xs py-2 px-5 shadow-xs">
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        <span>Save Rules</span>
      </button>
    </div>
  );
}

// ---------------- USER MANAGEMENT & CAPABILITIES TAB ----------------
function UsersTab() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [ringFilter, setRingFilter] = useState('');
  const [modal, setModal] = useState({ show: false, title: '', message: '', onConfirm: null, isDanger: false });
  const [banner, setBanner] = useState({ show: false, text: '', isError: false });
  const [retaggingAll, setRetaggingAll] = useState(false);
  const [showRingGuide, setShowRingGuide] = useState(false);
  const [showCreateTestUser, setShowCreateTestUser] = useState(false);

  const showBanner = (text, isError = false) => {
    setBanner({ show: true, text, isError });
    setTimeout(() => setBanner({ show: false, text: '', isError: false }), 4500);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchUsers = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 10 };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (ringFilter !== '') params.ring = ringFilter;
      const res = await adminApi.listUsers(params);
      setUsers(res.data?.data?.users || []);
      setPagination(res.data?.data?.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
    } catch {
      showBanner('Failed to load user directory.', true);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, ringFilter]);

  useEffect(() => {
    fetchUsers(1);
  }, [fetchUsers]);

  const handleTogglePermission = async (userId, field, label, currentValue) => {
    const newValue = !currentValue;
    // Optimistic UI update
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, [field]: newValue } : u))
    );

    try {
      await adminApi.setUserPermissions(userId, { [field]: newValue });
      showBanner(`${label} privilege ${newValue ? 'enabled' : 'revoked'}.`);
    } catch (err) {
      // Rollback on error
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, [field]: currentValue } : u))
      );
      showBanner(err.response?.data?.error?.message || `Failed to update ${label}.`, true);
    }
  };

  const handleRingChangePrompt = (userId, displayName, newRing, currentRing) => {
    if (newRing === currentRing) return;
    const ringMeta = RING_PERMISSIONS_INFO[newRing] || { label: `Ring ${newRing}` };
    const isDanger = newRing === 0;

    setModal({
      show: true,
      title: 'Update Role & Ring Level Permissions',
      message: `Are you sure you want to change "${displayName}"'s role to ${ringMeta.label}? ${
        isDanger
          ? '⚠️ WARNING: Ring 0 grants full root platform administrator authority across all systems.'
          : `This will configure their platform-wide ring level permissions to ${ringMeta.label}.`
      }`,
      isDanger,
      onConfirm: async () => {
        try {
          await adminApi.setUserRing(userId, newRing);
          showBanner(`Role for "${displayName}" updated to ${ringMeta.label}.`);
          fetchUsers(pagination.page);
        } catch (err) {
          showBanner(err.response?.data?.error?.message || 'Failed to update ring level.', true);
        } finally {
          setModal({ show: false, title: '', message: '', onConfirm: null, isDanger: false });
        }
      },
    });
  };

  const handleRetag = async (userId, displayName) => {
    try {
      const res = await adminApi.retagUser(userId);
      const tags = res.data?.data?.cohortTags || [];
      showBanner(`Re-tagged "${displayName}". Tags: ${tags.join(', ') || 'none'}`);
      fetchUsers(pagination.page);
    } catch (err) {
      showBanner(err.response?.data?.error?.message || 'Retagging user failed.', true);
    }
  };

  const handleRetagAll = () => {
    setModal({
      show: true,
      title: 'Re-tag All Platform Users',
      message: 'Re-process ALL users through the current cohort rules and auto-join mappings? This will recalculate cohort tags and group memberships for everyone based on current regex configuration.',
      isDanger: false,
      onConfirm: async () => {
        setRetaggingAll(true);
        try {
          const res = await adminApi.retagAllUsers();
          const d = res.data?.data;
          showBanner(`✅ ${d?.message || 'Re-tagging complete.'} (Processed: ${d?.processed || 0}/${d?.total || 0})`);
          fetchUsers(pagination.page);
        } catch (err) {
          showBanner(err.response?.data?.error?.message || 'Bulk retagging failed.', true);
        } finally {
          setRetaggingAll(false);
          setModal({ show: false, title: '', message: '', onConfirm: null, isDanger: false });
        }
      },
    });
  };

  const handleDeleteUser = (userId, displayName) => {
    setModal({
      show: true,
      title: 'Delete User Account Permanently',
      message: `⚠️ Permanently delete "${displayName}"? This will irreversibly remove their account, messages, event organizer records, friendships, and badges. This action CANNOT be undone.`,
      isDanger: true,
      onConfirm: async () => {
        try {
          await adminApi.deleteUser(userId);
          showBanner(`User "${displayName}" permanently deleted.`);
          fetchUsers(pagination.page);
        } catch (err) {
          showBanner(err.response?.data?.error?.message || 'Failed to delete user.', true);
        } finally {
          setModal({ show: false, title: '', message: '', onConfirm: null, isDanger: false });
        }
      },
    });
  };

  const getCapabilitiesList = (u) => [
    {
      key: 'canCreateGroups',
      label: 'Create Channels',
      desc: 'Allowed to create custom and cohort channels',
      enabled: !!u.canCreateGroups,
    },
    {
      key: 'canCreateEvents',
      label: 'Organize Events',
      desc: 'Allowed to host and manage platform events',
      enabled: !!u.canCreateEvents,
    },
    {
      key: 'canManageResources',
      label: 'Curate Resources',
      desc: 'Allowed to manage subjects and study notes',
      enabled: !!u.canManageResources,
    },
    {
      key: 'canManageStore',
      label: 'Manage Store',
      desc: 'Allowed to create badges and marketplace listings',
      enabled: !!u.canManageStore,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Confirmation Modal */}
      {modal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className={`glass-card p-6 rounded-2xl max-w-md w-full border ${modal.isDanger ? 'border-[var(--color-danger)] shadow-red-500/10' : 'border-[var(--color-accent)] shadow-teal-500/10'} shadow-2xl`}>
            <h3 className={`text-base font-bold font-display mb-2 ${modal.isDanger ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-primary)]'}`}>
              {modal.title}
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-6 leading-relaxed">
              {modal.message}
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setModal({ show: false, title: '', message: '', onConfirm: null, isDanger: false })}
                className="btn btn-secondary text-xs py-1.5 px-3.5"
              >
                Cancel
              </button>
              <button
                onClick={modal.onConfirm}
                className={`btn text-xs font-bold text-white py-1.5 px-4 ${modal.isDanger ? 'bg-[var(--color-danger)] hover:bg-red-600' : 'btn-primary'}`}
              >
                Confirm Action
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Banner Feedback */}
      {banner.show && (
        <div className={`p-3 rounded-2xl text-xs flex items-center justify-between gap-3 border transition-all ${
          banner.isError
            ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)] border-[var(--color-danger)]/30'
            : 'bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] border-[var(--palette-teal)]/30 font-medium'
        }`}>
          <span>{banner.text}</span>
          <button onClick={() => setBanner({ show: false, text: '', isError: false })} className="opacity-70 hover:opacity-100">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Action Header & Filter Controls */}
      <div className="glass-card p-5 border border-[var(--color-border)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] flex items-center gap-2">
              <Users size={16} className="text-[var(--color-accent)]" /> User Capabilities & Ring RBAC
            </h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Control granular user capabilities, promote/demote ring levels, and execute cohort re-evaluations
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowRingGuide(!showRingGuide)}
              className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <Info size={12} />
              <span>Ring Hierarchy Guide</span>
              {showRingGuide ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            <button
              onClick={() => setShowCreateTestUser(!showCreateTestUser)}
              className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <UserPlus size={12} />
              <span>+ Test User</span>
            </button>

            <button
              onClick={handleRetagAll}
              disabled={retaggingAll}
              className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
              title="Apply current cohort + auto-join rules to all registered users"
            >
              <RefreshCw size={12} className={retaggingAll ? 'animate-spin' : ''} />
              <span>{retaggingAll ? 'Re-tagging...' : 'Re-tag All'}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Ring Permissions Architecture Guide */}
        {showRingGuide && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-4 rounded-2xl bg-[var(--color-bg-matte)] border border-[var(--color-border)] space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-primary)] flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-[var(--color-accent)]" />
                Concentric Ring Permission Model (RULES.md §5)
              </h4>
              <span className="text-[10px] text-[var(--color-text-muted)]">Lower Ring # = Higher Privilege</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {Object.entries(RING_PERMISSIONS_INFO).map(([ringKey, meta]) => (
                <div key={ringKey} className="p-3 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.badge}`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed mt-1">
                    {meta.description}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Collapsible Create Test User Form */}
        {showCreateTestUser && (
          <CreateTestUserForm
            onCreated={() => fetchUsers(pagination.page)}
            onClose={() => setShowCreateTestUser(false)}
          />
        )}

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
          <div className="relative flex-1 w-full">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, handle, or email address..."
              className="matte-input text-xs pl-9 w-full"
            />
          </div>

          <select
            value={ringFilter}
            onChange={(e) => setRingFilter(e.target.value)}
            className="matte-input text-xs py-2 px-3 w-full sm:w-auto min-w-[190px]"
          >
            <option value="">All Platform Rings (0–4)</option>
            {[0, 1, 2, 3, 4].map((r) => (
              <option key={r} value={r}>{RING_LABELS[r]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* User Directory Cards */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card p-5 border border-[var(--color-border)] animate-pulse h-40 rounded-2xl" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="glass-card p-12 text-center text-xs text-[var(--color-text-muted)] border border-[var(--color-border)]">
          No users matching the query or filter.
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => {
            const ringMeta = RING_PERMISSIONS_INFO[u.globalRing] || RING_PERMISSIONS_INFO[4];
            const isRootAdmin = u.globalRing === 0;

            return (
              <div
                key={u.id}
                className="glass-card p-5 border border-[var(--color-border)] space-y-4 rounded-2xl hover:border-[var(--color-border-hover)] transition-all"
              >
                {/* User Identity & Top Controls */}
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    {u.avatarUrl ? (
                      <img
                        src={resolveAsset(u.avatarUrl)}
                        alt={u.displayName}
                        className="w-11 h-11 rounded-full object-cover border border-[var(--color-border)] flex-shrink-0"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[#528976] flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-xs">
                        {u.displayName?.charAt(0)?.toUpperCase() || 'U'}
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-bold text-[var(--color-text-primary)] truncate">{u.displayName}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ringMeta.badge}`}>
                          {ringMeta.label}
                        </span>
                        {isRootAdmin && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                            Root Authority
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 truncate">
                        @{u.username || 'unnamed'} • {u.email}
                      </p>

                      {/* Cohort tags chips */}
                      {u.cohortTags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {u.cohortTags.map((tag) => (
                            <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-[var(--color-bg-matte)] border border-[var(--color-border)] text-[var(--palette-teal)]">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleRetag(u.id, u.displayName)}
                      className="btn btn-secondary text-xs p-2"
                      title="Re-evaluate cohort tags for this user"
                    >
                      <RefreshCw size={13} />
                    </button>
                    <button
                      onClick={() => handleDeleteUser(u.id, u.displayName)}
                      className="btn btn-secondary text-xs p-2 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
                      title="Permanently delete user"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Capabilities & Delegated Privileges Section */}
                <div className="pt-3 border-t border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck size={13} className="text-[var(--color-accent)]" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                        Admin-Delegated Capabilities
                      </span>
                    </div>
                    {isRootAdmin && (
                      <span className="text-[10px] text-[var(--color-text-muted)] italic">
                        Ring 0 bypasses checks; toggles apply if demoted
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {getCapabilitiesList(u).map((p) => (
                      <button
                        key={p.key}
                        onClick={() => handleTogglePermission(u.id, p.key, p.label, p.enabled)}
                        title={p.desc}
                        className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border text-xs font-medium transition-all text-left ${
                          p.enabled
                            ? 'bg-[var(--palette-teal)]/10 border-[var(--palette-teal)]/30 text-[var(--color-text-primary)]'
                            : 'bg-[var(--color-bg-matte)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-hover)]'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {p.enabled ? (
                            <CheckCircle2 size={14} className="text-[var(--palette-teal)] flex-shrink-0" />
                          ) : (
                            <XCircle size={14} className="text-[var(--color-text-muted)] flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="block text-[11px] font-bold text-[var(--color-text-primary)] truncate">
                              {p.label}
                            </span>
                            <span className="block text-[10px] text-[var(--color-text-muted)] truncate">
                              {p.desc}
                            </span>
                          </div>
                        </div>

                        {/* Switch Pill */}
                        <div
                          className={`relative w-8 h-[18px] rounded-full transition-colors flex-shrink-0 ${
                            p.enabled ? 'bg-[var(--palette-teal)]' : 'bg-[var(--color-border)]'
                          }`}
                        >
                          <span
                            className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-xs transition-all ${
                              p.enabled ? 'left-[16px]' : 'left-[2px]'
                            }`}
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ring Level Permissions & Role Selector */}
                <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <span className="text-[11px] font-bold text-[var(--color-text-secondary)] block">
                      Platform Role & Ring Level Permissions
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)] block">
                      {ringMeta.description}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={u.globalRing}
                      onChange={(e) => handleRingChangePrompt(u.id, u.displayName, Number(e.target.value), u.globalRing)}
                      className="matte-input text-xs py-1.5 px-3 min-w-[170px]"
                    >
                      {[0, 1, 2, 3, 4].map((r) => (
                        <option key={r} value={r}>
                          {RING_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Bar */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 pt-3 flex-wrap">
          <span className="text-xs text-[var(--color-text-muted)]">
            Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} total users)
          </span>

          <div className="flex items-center gap-1.5">
            <button
              disabled={pagination.page <= 1}
              onClick={() => fetchUsers(pagination.page - 1)}
              className="btn btn-secondary text-xs p-2 disabled:opacity-40"
              title="Previous Page"
            >
              <ChevronLeft size={13} />
            </button>

            {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === pagination.totalPages || Math.abs(p - pagination.page) <= 1)
              .map((p, idx, arr) => (
                <div key={p} className="flex items-center gap-1">
                  {idx > 0 && arr[idx - 1] !== p - 1 && (
                    <span className="text-xs text-[var(--color-text-muted)] px-1">...</span>
                  )}
                  <button
                    onClick={() => fetchUsers(p)}
                    className={`w-7 h-7 rounded-xl text-xs font-bold transition-all ${
                      pagination.page === p
                        ? 'bg-[var(--color-accent)] text-white shadow-xs'
                        : 'bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {p}
                  </button>
                </div>
              ))}

            <button
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => fetchUsers(pagination.page + 1)}
              className="btn btn-secondary text-xs p-2 disabled:opacity-40"
              title="Next Page"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- CREATE TEST USER SUB-TOOL ----------------
function CreateTestUserForm({ onCreated, onClose }) {
  const [form, setForm] = useState({ email: '', displayName: '', password: '' });
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState({ message: '', isError: false });

  const handleCreate = async () => {
    if (!form.email.trim() || !form.displayName.trim()) return;
    setCreating(true);
    setStatus({ message: '', isError: false });
    try {
      const res = await adminApi.createTestUser({
        email: form.email.trim(),
        displayName: form.displayName.trim(),
        password: form.password || undefined,
      });
      const d = res.data?.data;
      setStatus({ message: `✅ ${d?.message || 'Test user created successfully!'}`, isError: false });
      setForm({ email: '', displayName: '', password: '' });
      onCreated?.();
    } catch (err) {
      setStatus({ message: err.response?.data?.error?.message || 'Failed to create test user.', isError: true });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-4 rounded-2xl bg-[var(--color-bg-matte)] border border-[var(--color-border)] space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold font-display text-[var(--color-text-primary)] flex items-center gap-1.5">
          <UserPlus size={14} className="text-[var(--color-accent)]" /> Create Test User Account
        </h4>
        {onClose && (
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-1">
            <X size={14} />
          </button>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        Directly creates an account (bypasses registration gating). Cohort tags and auto-join groups will be resolved automatically from email.
      </p>

      {status.message && (
        <div className={`text-xs p-2.5 rounded-xl font-medium ${
          status.isError ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)] border border-[var(--color-danger)]/20' : 'bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] border border-[var(--palette-teal)]/20'
        }`}>
          {status.message}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
            Email *
          </label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="e.g. cs2029001@university.edu"
            className="matte-input text-xs"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
            Display Name *
          </label>
          <input
            type="text"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="e.g. Alex Hunter"
            className="matte-input text-xs"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
            Password (optional)
          </label>
          <input
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="test123"
            className="matte-input text-xs"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={handleCreate}
          disabled={creating || !form.email.trim() || !form.displayName.trim()}
          className="btn btn-primary text-xs py-1.5 px-4"
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          <span>Create Account</span>
        </button>
      </div>
    </div>
  );
}

// ---------------- DIAGNOSTICS TAB ----------------
function DiagnosticsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchDiagnostics = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getDiagnostics();
      setData(res.data?.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchDiagnostics(); }, []);

  if (loading) return <div className="py-12 text-center text-xs text-[var(--color-text-muted)]">Inspecting node telemetry...</div>;

  return (
    <div className="glass-card p-6 border border-[var(--color-border)] space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">System Diagnostics</h3>
        <button onClick={fetchDiagnostics} className="btn btn-secondary text-xs py-1.5 px-3">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
          <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)]">Health</p>
          <p className="text-sm font-bold text-[var(--palette-teal)] mt-1">🟢 {data?.status || 'Online'}</p>
        </div>
        <div className="p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
          <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)]">Memory (RSS)</p>
          <p className="text-sm font-bold text-[var(--color-text-primary)] mt-1">{data?.memoryUsage?.rssMb || 0} MB</p>
        </div>
        <div className="p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
          <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)]">Total Users</p>
          <p className="text-sm font-bold text-[var(--color-text-primary)] mt-1">{data?.counts?.users || 0}</p>
        </div>
        <div className="p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
          <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)]">Messages Logged</p>
          <p className="text-sm font-bold text-[var(--color-text-primary)] mt-1">{data?.counts?.messages || 0}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------- DATABASE TAB ----------------
function DatabaseTab() {
  const [loadingBackup, setLoadingBackup] = useState(false);

  const handleBackup = async () => {
    setLoadingBackup(true);
    try {
      const res = await adminApi.backupDatabase();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'comflex-backup.json');
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
    } catch {
      alert('Backup failed.');
    } finally {
      setLoadingBackup(false);
    }
  };

  return (
    <div className="glass-card p-6 border border-[var(--color-border)] space-y-4 max-w-xl">
      <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">Data Snapshots & Backup</h3>
      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
        Download a JSON archive containing all platform database records (users, groups, memberships, events, ledger).
      </p>
      <button onClick={handleBackup} disabled={loadingBackup} className="btn btn-primary text-xs py-2.5 px-5 shadow-xs">
        {loadingBackup ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} />}
        <span>Download Snapshot</span>
      </button>
    </div>
  );
}

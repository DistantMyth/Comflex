import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Tags, Users, Link2, Activity, Database, Search, RefreshCw,
  Trash2, ShieldCheck, UserPlus, CheckCircle2, XCircle, Loader2, AlertCircle,
  HardDrive, Clock, Check, X
} from 'lucide-react';
import { adminApi } from '../api/adminApi';
import resolveAsset from '../utils/resolveAsset';

const RING_LABELS = ['Admin (Ring 0)', 'Manager (Ring 1)', 'Elevated (Ring 2)', 'Member (Ring 3)', 'Restricted (Ring 4)'];

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

// ---------------- USER DIRECTORY TAB ----------------
function UsersTab() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listUsers({ search, limit: 30 });
      setUsers(res.data?.data?.users || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleRingChange = async (userId, ring) => {
    try {
      await adminApi.setUserRing(userId, ring);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to update ring');
    }
  };

  return (
    <div className="glass-card p-6 border border-[var(--color-border)] space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">User RBAC Registry</h3>
        <span className="text-xs text-[var(--color-text-muted)]">{users.length} users</span>
      </div>

      <input
        type="text"
        placeholder="Search users..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="matte-input text-xs max-w-sm"
      />

      <div className="space-y-2.5">
        {users.map((u) => (
          <div key={u.id} className="p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs font-bold text-[var(--color-text-primary)] truncate">{u.displayName}</p>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">@{u.username} • {u.email}</p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--color-text-muted)]">Role:</span>
              <select
                value={u.globalRing}
                onChange={(e) => handleRingChange(u.id, Number(e.target.value))}
                className="matte-input text-xs py-1 px-2"
              >
                {[0, 1, 2, 3, 4].map(r => (
                  <option key={r} value={r}>{RING_LABELS[r]}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
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

/**
 * AdminDashboard — Institution config, cohort rules, groups, auto-join, user management.
 *
 * Only accessible to Ring 0 (Admin) users.
 * Six tabs: Institution | Cohort Rules | Groups | Auto-Join | Users | Diagnostics | Database
 */

import { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../api/adminApi';
import resolveAsset from '../utils/resolveAsset';
import {
  Search, RefreshCw, Trash2, ShieldCheck, UserPlus,
  CheckCircle2, XCircle, Users, Activity,
} from 'lucide-react';

const RING_LABELS = ['Admin', 'Manager', 'Elevated', 'Member', 'Restricted'];

export default function AdminDashboard() {
  const [tab, setTab] = useState('institution');

  return (
    <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>

        {/* Tabs */}
        <div className="flex gap-1 bg-[var(--color-bg-card)] rounded-xl p-1 mb-8 overflow-x-auto">
          {[
            { key: 'institution', label: '🏛 Institution' },
            { key: 'cohort', label: '🏷 Cohort Rules' },
            { key: 'groups', label: '📋 Groups' },
            { key: 'autojoin', label: '🔗 Auto-Join' },
            { key: 'users', label: '👥 Users' },
            { key: 'diagnostics', label: '📊 Diagnostics' },
            { key: 'database', label: '💾 Database' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                tab === t.key
                  ? 'bg-[var(--color-accent)] text-white shadow-lg'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={tab === 'institution' ? 'block' : 'hidden'}><InstitutionTab /></div>
        <div className={tab === 'cohort' ? 'block' : 'hidden'}><CohortTab /></div>
        <div className={tab === 'groups' ? 'block' : 'hidden'}><GroupsTab /></div>
        <div className={tab === 'autojoin' ? 'block' : 'hidden'}><AutoJoinTab /></div>
        <div className={tab === 'users' ? 'block' : 'hidden'}><UsersTab /></div>
        <div className={tab === 'diagnostics' ? 'block' : 'hidden'}><DiagnosticsTab /></div>
        <div className={tab === 'database' ? 'block' : 'hidden'}><DatabaseTab /></div>
      </div>
  );
}

// ============================================================
// Institution Tab
// ============================================================
function InstitutionTab() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', domain: '', defaultCredits: 0 });
  const [status, setStatus] = useState({ message: '', isError: false });

  useEffect(() => {
    adminApi.getInstitution().then((res) => {
      const data = res.data.data;
      setConfig(data);
      setForm({ name: data?.name || '', domain: data?.domain || '', defaultCredits: data?.defaultCredits ?? 0 });
    }).catch(() => setStatus({ message: 'Failed to load config.', isError: true }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus({ message: '', isError: false });
    try {
      await adminApi.updateInstitution(form);
      setStatus({ message: 'Institution settings updated!', isError: false });
    } catch (err) {
      setStatus({ message: err.response?.data?.error?.message || 'Save failed.', isError: true });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="space-y-3"><div className="skeleton h-12 w-full" /><div className="skeleton h-12 w-full" /></div>;

  return (
    <div className="glass-card p-6 space-y-4">
      <h3 className="text-lg font-semibold">Institution Settings</h3>
      {status.message && (
        <div className={`text-sm p-3 rounded-lg ${status.isError ? 'bg-red-500/10 text-[var(--color-danger)] border border-red-500/20' : 'bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/20'}`}>
          {status.message}
        </div>
      )}
      <div>
        <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Institution Name</label>
        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Email Domain</label>
        <input type="text" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
      </div>
      <div>
        <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Default Credits for New Users</label>
        <input type="number" value={form.defaultCredits} onChange={(e) => setForm({ ...form, defaultCredits: e.target.value })} min={0} />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-[var(--color-text-muted)]">Status:</span>
        <span className={`px-2 py-0.5 rounded-full text-xs text-white ${config?.isConfigured ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'}`}>
          {config?.isConfigured ? 'Configured' : 'Not Configured'}
        </span>
      </div>
      <button onClick={handleSave} disabled={saving} className="btn btn-primary">
        {saving ? <span className="spinner" /> : 'Save Changes'}
      </button>
    </div>
  );
}

// ============================================================
// Cohort Rules Tab — with branch detection
// ============================================================
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
      const rules = res.data.data?.emailParsingRules;
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
      setPreview(res.data.data);
    } catch (err) {
      console.error('Preview error:', err.response?.data || err);
      setPreview({ matched: false, message: err.response?.data?.error?.message || 'Preview request failed. Check console.' });
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
      // Always save branch fields so they persist
      if (form.branchCaptureGroup !== '' && form.branchCaptureGroup !== undefined) {
        rules.branchCaptureGroup = Number(form.branchCaptureGroup);
      }
      rules.branchMapping = parseBranchMapping(branchMapInput);
      await adminApi.updateCohortConfig({
        emailParsingRules: rules,
        cohortConfig: { seniorOffset: -1, juniorOffset: 1, seniorAutoElevate: true },
      });
      setMessage('Cohort rules saved!');
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="skeleton h-48 w-full" />;

  return (
    <div className="glass-card p-6 space-y-4">
      <h3 className="text-lg font-semibold">Email Parsing Rules</h3>
      {message && <div className="text-sm text-[var(--color-success)]">{message}</div>}

      <div>
        <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Regex Pattern</label>
        <input type="text" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })}
          className="font-mono text-sm" placeholder="^l(cs|ci|cb)(\d{4})(\d{3,})@iiitl\.ac\.in$" />
        <p className="text-xs text-[var(--color-text-muted)] mt-1">Use capture groups () for year and branch</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Year Capture Group</label>
          <input type="number" value={form.captureGroup} min={0}
            onChange={(e) => setForm({ ...form, captureGroup: parseInt(e.target.value) || 0 })} />
        </div>
        <div>
          <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Year Offset</label>
          <input type="number" value={form.yearOffset}
            onChange={(e) => setForm({ ...form, yearOffset: parseInt(e.target.value) || 0 })} />
        </div>
        <div>
          <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Branch Capture Group</label>
          <input type="number" value={form.branchCaptureGroup} min={0}
            placeholder="optional"
            onChange={(e) => setForm({ ...form, branchCaptureGroup: e.target.value })} />
        </div>
      </div>

      {/* Branch mapping */}
      <div>
        <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Branch Mapping</label>
        <input type="text" value={branchMapInput}
          onChange={(e) => {
            setBranchMapInput(e.target.value);
            setForm({ ...form, branchMapping: parseBranchMapping(e.target.value) });
          }}
          placeholder="cs=Computer Science, ci=AI, cb=CS Business" />
        <p className="text-xs text-[var(--color-text-muted)] mt-1">Format: code=Name, code=Name (comma separated)</p>
      </div>

      {/* Live Test */}
      <div className="border-t border-[var(--color-border)] pt-4">
        <h4 className="text-sm font-semibold mb-2">🧪 Live Test</h4>
        <div className="flex gap-2">
          <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
            placeholder="lcs2023001@iiitl.ac.in" className="flex-1" />
          <button onClick={handlePreview} disabled={!testEmail} className="btn btn-secondary text-sm">Test</button>
        </div>
        {preview && (
          <div className={`mt-3 p-3 rounded-xl text-sm`}
            style={{
              backgroundColor: preview.matched && preview.extractedYear != null
                ? 'rgba(34,197,94,0.1)' : preview.matched ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.15)',
              color: preview.matched && preview.extractedYear != null
                ? '#22c55e' : '#eab308',
            }}>
            {preview.extractedYear != null
              ? <div>
                  <div>✅ Year: <strong>{preview.extractedYear}</strong>
                  {preview.extractedBranch ? <> | Branch: <strong>{preview.extractedBranch}</strong></> : null}</div>
                  <div style={{ marginTop: '4px' }}>Tags: {preview.predictedTags?.join(', ') || 'none'}</div>
                </div>
              : <div>{preview.message || (preview.matched ? '⚠ Matched but could not extract year — check your Year Capture Group index.' : '❌ No match')}</div>
            }
          </div>
        )}
      </div>

      <button onClick={handleSave} disabled={saving} className="btn btn-primary">
        {saving ? <span className="spinner" /> : 'Save Rules'}
      </button>
    </div>
  );
}

// ============================================================
// Groups Tab — Create, list, delete groups
// ============================================================
function GroupsTab() {
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', displayName: '', description: '', type: 'custom' });
  const [status, setStatus] = useState({ message: '', isError: false });
  const [deleteModal, setDeleteModal] = useState({ show: false, id: null, name: '' });

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      // List all groups (admin can see all via the service)
      const res = await adminApi.listAllGroups();
      setGroups(res.data.data || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const handleCreate = async () => {
    if (!newGroup.name.trim()) return;
    setCreating(true);
    setStatus({ message: '', isError: false });
    try {
      await adminApi.createGroup(newGroup);
      setStatus({ message: 'Group created successfully!', isError: false });
      setNewGroup({ name: '', displayName: '', description: '', type: 'custom' });
      await fetchGroups();
    } catch (err) {
      setStatus({ message: err.response?.data?.error?.message || 'Failed to create group.', isError: true });
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModal.id) return;
    try {
      await adminApi.deleteGroup(deleteModal.id);
      setStatus({ message: `Group "${deleteModal.name}" deleted.`, isError: false });
      setDeleteModal({ show: false, id: null, name: '' });
      await fetchGroups();
    } catch (err) {
      setStatus({ message: err.response?.data?.error?.message || 'Failed to delete group.', isError: true });
      setDeleteModal({ show: false, id: null, name: '' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Delete Group Modal */}
      {deleteModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-card p-6 rounded-2xl max-w-md w-full border-2 border-[var(--color-danger)] shadow-2xl">
            <h3 className="text-lg font-bold text-[var(--color-danger)] mb-2">Delete Group</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6 leading-relaxed">
              Are you sure you want to delete the group <strong>"{deleteModal.name}"</strong>? This will remove all group messages and memberships. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteModal({ show: false, id: null, name: '' })}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="btn bg-[var(--color-danger)] text-white hover:bg-red-600 text-sm font-semibold"
              >
                Delete Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create new group */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="text-lg font-semibold">Create Group</h3>
        {status.message && (
          <div className={`text-sm p-3 rounded-lg ${status.isError ? 'bg-red-500/10 text-[var(--color-danger)] border border-red-500/20' : 'bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/20'}`}>
            {status.message}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Internal Name *</label>
            <input type="text" value={newGroup.name}
              onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
              placeholder="cohort-29-cs" />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Display Name</label>
            <input type="text" value={newGroup.displayName}
              onChange={(e) => setNewGroup({ ...newGroup, displayName: e.target.value })}
              placeholder="'29 CS Group" />
          </div>
        </div>
        <div>
          <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Description</label>
          <input type="text" value={newGroup.description}
            onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
            placeholder="Computer Science batch of 2029" />
        </div>
        <div>
          <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Type</label>
          <select value={newGroup.type}
            onChange={(e) => setNewGroup({ ...newGroup, type: e.target.value })}
            className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm px-3 py-2">
            <option value="custom">Custom</option>
            <option value="primary">Primary (Cohort)</option>
            <option value="cross-year">Cross-Year</option>
          </select>
        </div>
        <button onClick={handleCreate} disabled={creating || !newGroup.name.trim()} className="btn btn-primary">
          {creating ? <span className="spinner" /> : 'Create Group'}
        </button>
      </div>

      {/* Group list */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">All Groups</h3>
          <span className="text-sm text-[var(--color-text-muted)]">{groups.length} groups</span>
        </div>

        {/* Search */}
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name..." className="mb-4 w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]" />

        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-14 w-full" />)}</div>
        ) : groups.length === 0 ? (
          <p className="text-center text-[var(--color-text-muted)] py-6">No groups yet.</p>
        ) : (
          <div className="space-y-2">
            {groups.filter(g => (g.displayName || g.name || '').toLowerCase().includes(search.toLowerCase())).map(g => (
              <div key={g.id} className="flex items-center gap-4 p-3 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)]">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {(g.displayName || g.name)?.charAt(0)?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{g.displayName || g.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{g.name} · {g.type} · {g.memberCount ?? '?'} members</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-bg-card)] text-[var(--color-text-muted)]">{g.type}</span>
                <button onClick={() => setDeleteModal({ show: true, id: g.id, name: g.displayName || g.name })} className="text-xs text-[var(--color-danger)] hover:underline">Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Auto-Join Tab — Configure year/branch → group auto-join rules
// ============================================================
function AutoJoinTab() {
  const [rules, setRules] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([
      adminApi.getAutoJoinRules(),
      adminApi.listAllGroups(),
    ]).then(([rulesRes, groupsRes]) => {
      setRules(rulesRes.data.data?.autoJoinRules || []);
      setGroups(groupsRes.data.data || []);
    }).finally(() => setLoading(false));
  }, []);

  const addRule = () => {
    setRules([...rules, { matchField: 'year', matchValue: '', groupId: '' }]);
  };

  const updateRule = (index, field, value) => {
    const updated = [...rules];
    if (typeof field === 'object') {
      // Allow updating multiple fields at once: updateRule(idx, { matchField: 'year', matchValue: '' })
      updated[index] = { ...updated[index], ...field };
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setRules(updated);
  };

  const removeRule = (index) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await adminApi.updateAutoJoinRules(rules);
      setMessage('Auto-join rules saved!');
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    setPreview(null);
    try {
      const res = await adminApi.previewAutoJoinRules(testEmail);
      setPreview(res.data.data);
    } catch {
      setPreview({ autoJoinGroups: [] });
    }
  };

  if (loading) return <div className="skeleton h-48 w-full" />;

  return (
    <div className="space-y-6">
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Auto-Join Rules</h3>
          <button onClick={addRule} className="btn btn-secondary text-sm">+ Add Rule</button>
        </div>
        {message && <div className="text-sm text-[var(--color-success)]">{message}</div>}

        <p className="text-xs text-[var(--color-text-muted)]">
          When a new user registers, their email is parsed for year/branch. Auto-join rules add them to matching groups automatically.<br />
          <strong>Match Field</strong>: year (e.g., "29"), branch (e.g., "cs"), or both (e.g., "29-cs")
        </p>

        {rules.length === 0 && (
          <p className="text-center text-[var(--color-text-muted)] py-4">No auto-join rules configured. Click "+ Add Rule" to start.</p>
        )}

        <div className="space-y-3">
          {rules.map((rule, idx) => (
            <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)] flex-wrap">
              <span className="text-xs text-[var(--color-text-muted)] w-6">#{idx + 1}</span>

              <div>
                <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Match by</label>
                <select value={rule.matchField} onChange={(e) => {
                  updateRule(idx, { matchField: e.target.value, matchValue: '' });
                }}
                  className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg text-sm px-2 py-1.5">
                  <option value="year">Year</option>
                  <option value="branch">Branch</option>
                  <option value="both">Year + Branch</option>
                </select>
              </div>

              {rule.matchField === 'both' ? (
                <div className="flex items-center gap-2">
                  <div>
                    <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Year</label>
                    <input type="text"
                      value={rule.matchValue?.split('-')[0] || ''}
                      onChange={(e) => {
                        const branch = rule.matchValue?.split('-')[1] || '';
                        updateRule(idx, 'matchValue', `${e.target.value}-${branch}`);
                      }}
                      placeholder="29" className="w-16 text-sm" />
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)] mt-3">+</span>
                  <div>
                    <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Branch</label>
                    <input type="text"
                      value={rule.matchValue?.split('-')[1] || ''}
                      onChange={(e) => {
                        const year = rule.matchValue?.split('-')[0] || '';
                        updateRule(idx, 'matchValue', `${year}-${e.target.value}`);
                      }}
                      placeholder="cs" className="w-16 text-sm" />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">
                    {rule.matchField === 'year' ? 'Year (e.g. 29)' : 'Branch code (e.g. cs)'}
                  </label>
                  <input type="text" value={rule.matchValue}
                    onChange={(e) => updateRule(idx, 'matchValue', e.target.value)}
                    placeholder={rule.matchField === 'year' ? '29' : 'cs'}
                    className="w-28 text-sm" />
                </div>
              )}

              <span className="text-xs text-[var(--color-text-muted)] mt-3">→</span>

              <div className="flex-1">
                <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Auto-join group</label>
                <select value={rule.groupId} onChange={(e) => updateRule(idx, 'groupId', e.target.value)}
                  className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg text-sm px-2 py-1.5">
                  <option value="">Select group...</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.displayName || g.name}</option>
                  ))}
                </select>
              </div>

              <button onClick={() => removeRule(idx)} className="text-[var(--color-danger)] text-sm hover:underline mt-3">✕</button>
            </div>
          ))}
        </div>

        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? <span className="spinner" /> : 'Save Rules'}
        </button>
      </div>

      {/* Preview */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="text-lg font-semibold">🧪 Test Auto-Join</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Enter a sample email to see which groups a new user would auto-join.</p>
        <div className="flex gap-2">
          <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
            placeholder="lcs2029001@iiitl.ac.in" className="flex-1" />
          <button onClick={handlePreview} disabled={!testEmail} className="btn btn-secondary text-sm">Test</button>
        </div>
        {preview && (
          <div className="p-3 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-sm">
            <p>Year: <strong>{preview.extractedYear ?? 'N/A'}</strong> | Branch: <strong>{preview.extractedBranch ?? 'N/A'}</strong></p>
            {preview.autoJoinGroups?.length > 0 ? (
              <div className="mt-2">
                <p className="text-[var(--color-success)]">✅ Would auto-join:</p>
                <ul className="list-disc list-inside mt-1">
                  {preview.autoJoinGroups.map((g, i) => (
                    <li key={i}>{g.displayName || g.groupName} ({g.rule.matchField}={g.rule.matchValue})</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[var(--color-warning)] mt-2">⚠ No auto-join rules matched.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Users Tab — with canCreateGroups toggle, debounced search & confirmation modals
// ============================================================
function UsersTab() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [ringFilter, setRingFilter] = useState('');
  const [modal, setModal] = useState({ show: false, title: '', message: '', onConfirm: null, isDanger: false });
  const [banner, setBanner] = useState({ show: false, text: '', isError: false });

  const showBanner = (text, isError = false) => {
    setBanner({ show: true, text, isError });
    setTimeout(() => setBanner({ show: false, text: '', isError: false }), 4000);
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
      setUsers(res.data.data.users);
      setPagination(res.data.data.pagination);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [debouncedSearch, ringFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleRingChange = (userId, displayName, newRing) => {
    setModal({
      show: true,
      title: 'Change User Role',
      message: `Are you sure you want to change "${displayName}"'s role to Ring ${newRing} (${RING_LABELS[newRing] || 'Restricted'})?`,
      isDanger: newRing === 0,
      onConfirm: async () => {
        try {
          await adminApi.setUserRing(userId, newRing);
          showBanner('Role updated successfully.');
          fetchUsers(pagination.page);
        } catch (err) {
          showBanner(err.response?.data?.error?.message || 'Failed to change ring.', true);
        } finally {
          setModal({ show: false, title: '', message: '', onConfirm: null, isDanger: false });
        }
      }
    });
  };

  const handleRetag = async (userId) => {
    try {
      await adminApi.retagUser(userId);
      showBanner('User cohort tags re-processed.');
      fetchUsers(pagination.page);
    } catch {
      showBanner('Retag failed.', true);
    }
  };

  const handleTogglePermission = async (userId, field, current) => {
    try {
      await adminApi.setUserPermissions(userId, { [field]: !current });
      showBanner('Permissions updated.');
      fetchUsers(pagination.page);
    } catch (err) {
      showBanner(err.response?.data?.error?.message || 'Failed to update permissions.', true);
    }
  };

  const handleDeleteUser = (userId, displayName) => {
    setModal({
      show: true,
      title: 'Delete User Permanently',
      message: `⚠️ Permanently delete "${displayName}"? This will remove their account, messages, team records, friendships, and badges. This action CANNOT be undone.`,
      isDanger: true,
      onConfirm: async () => {
        try {
          await adminApi.deleteUser(userId);
          showBanner(`User "${displayName}" deleted.`);
          fetchUsers(pagination.page);
        } catch (err) {
          showBanner(err.response?.data?.error?.message || 'Failed to delete user.', true);
        } finally {
          setModal({ show: false, title: '', message: '', onConfirm: null, isDanger: false });
        }
      }
    });
  };

  const [retagging, setRetagging] = useState(false);
  const handleRetagAll = () => {
    setModal({
      show: true,
      title: 'Re-tag All Platform Users',
      message: 'Re-process ALL users through current cohort + auto-join rules? This will update cohort group memberships based on the current configuration.',
      isDanger: false,
      onConfirm: async () => {
        setRetagging(true);
        try {
          const res = await adminApi.retagAllUsers();
          const d = res.data.data;
          showBanner(`✅ ${d.message} (Processed: ${d.processed}/${d.total})`);
          fetchUsers(pagination.page);
        } catch (err) {
          showBanner(err.response?.data?.error?.message || 'Retag all failed.', true);
        } finally {
          setRetagging(false);
          setModal({ show: false, title: '', message: '', onConfirm: null, isDanger: false });
        }
      }
    });
  };

  const ringBadge = (ring) => {
    const styles = {
      0: 'bg-[rgba(239,68,68,0.15)] text-red-400 border-[rgba(239,68,68,0.3)]',
      1: 'bg-[rgba(249,115,22,0.15)] text-orange-400 border-[rgba(249,115,22,0.3)]',
      2: 'bg-[rgba(168,85,247,0.15)] text-purple-400 border-[rgba(168,85,247,0.3)]',
      3: 'bg-[rgba(16,185,129,0.15)] text-emerald-400 border-[rgba(16,185,129,0.3)]',
      4: 'bg-[var(--color-bg-card)] text-[var(--color-text-muted)] border-[var(--color-border)]',
    };
    return styles[ring] || styles[4];
  };

  const permissionToggles = (u) => [
    {
      key: 'canCreateGroups',
      label: 'Create Groups',
      enabled: u.canCreateGroups,
      onToggle: () => handleTogglePermission(u.id, 'canCreateGroups', u.canCreateGroups),
      hint: u.canCreateGroups ? 'Allowed to create groups' : 'Cannot create groups',
    },
    {
      key: 'canCreateEvents',
      label: 'Create Events',
      enabled: u.canCreateEvents,
      onToggle: () => handleTogglePermission(u.id, 'canCreateEvents', u.canCreateEvents),
      hint: u.canCreateEvents ? 'Allowed to create events' : 'Cannot create events',
    },
    {
      key: 'canManageResources',
      label: 'Manage Resources',
      enabled: u.canManageResources,
      onToggle: () => handleTogglePermission(u.id, 'canManageResources', u.canManageResources),
      hint: u.canManageResources ? 'Allowed to manage resources' : 'Cannot manage resources',
    },
    {
      key: 'canManageStore',
      label: 'Manage Store',
      enabled: u.canManageStore,
      onToggle: () => handleTogglePermission(u.id, 'canManageStore', u.canManageStore),
      hint: u.canManageStore ? 'Allowed to manage the store' : 'Cannot manage the store',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Confirmation Modal */}
      {modal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className={`glass-card p-6 rounded-2xl max-w-md w-full border-2 shadow-2xl ${modal.isDanger ? 'border-[var(--color-danger)]' : 'border-[var(--color-accent)]'}`}>
            <h3 className="text-lg font-bold mb-2">{modal.title}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6 leading-relaxed">{modal.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setModal({ show: false, title: '', message: '', onConfirm: null, isDanger: false })}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={modal.onConfirm}
                className={`btn text-sm font-semibold text-white ${modal.isDanger ? 'bg-[var(--color-danger)] hover:bg-red-600' : 'btn-primary'}`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Banner */}
      {banner.show && (
        <div className={`p-3 rounded-lg text-sm transition-all animate-fade-in ${banner.isError ? 'bg-red-500/10 text-[var(--color-danger)] border border-red-500/20' : 'bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/20'}`}>
          {banner.text}
        </div>
      )}

      {/* Create Test User */}
      <CreateTestUserForm onCreated={() => fetchUsers(pagination.page)} />

      <div className="glass-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users size={18} className="text-[var(--color-accent)]" /> User Management
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRetagAll}
              disabled={retagging}
              className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
              title="Apply current cohort + auto-join rules to all existing users"
            >
              <RefreshCw size={12} className={retagging ? 'animate-spin' : ''} />
              {retagging ? 'Retagging...' : 'Retag All Users'}
            </button>
            <span className="text-sm text-[var(--color-text-muted)]">{pagination.total || 0} users</span>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, username, or email..."
              className="pl-10 w-full"
            />
          </div>
          <select
            value={ringFilter}
            onChange={(e) => setRingFilter(e.target.value)}
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg text-sm px-3 py-2 text-[var(--color-text-primary)]"
          >
            <option value="">All Roles (Rings 0-4)</option>
            {[0, 1, 2, 3, 4].map((r) => (
              <option key={r} value={r}>Ring {r} - {RING_LABELS[r] || 'Restricted'}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-32 w-full" />)}
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-10 text-sm text-[var(--color-text-muted)]">
            No users found.
          </div>
        ) : (
          <div className="space-y-4">
            {users.map((u) => (
              <div key={u.id} className="rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)] overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  {u.avatarUrl ? (
                    <img src={resolveAsset(u.avatarUrl)} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {u.displayName?.charAt(0)?.toUpperCase()}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{u.displayName}</p>
                      <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ringBadge(u.globalRing)}`}>
                        Ring {u.globalRing} · {RING_LABELS[u.globalRing] || 'Restricted'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">@{u.username || 'unnamed'} · {u.email}</p>
                    {u.cohortTags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {u.cohortTags.slice(0, 3).map((tag) => (
                          <span key={tag} className="px-2 py-0.5 rounded text-[10px] chip-accent">
                            {tag}
                          </span>
                        ))}
                        {u.cohortTags.length > 3 && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                            +{u.cohortTags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleRetag(u.id)}
                      className="p-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                      title="Re-process cohort tags"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteUser(u.id, u.displayName)}
                      className="p-2 rounded-lg border border-[rgba(239,68,68,0.3)] text-red-400 hover:bg-[rgba(239,68,68,0.1)] transition-colors"
                      title="Delete user permanently"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="border-t border-[var(--color-border)] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <ShieldCheck size={14} className="text-[var(--color-text-muted)]" />
                    <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Permissions</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {permissionToggles(u).map((p) => (
                      <button
                        key={p.key}
                        onClick={p.onToggle}
                        title={p.hint}
                        className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                          p.enabled
                            ? 'bg-[rgba(16,185,129,0.1)] border-[rgba(16,185,129,0.35)] text-[var(--color-text-primary)]'
                            : 'bg-[var(--color-bg-card)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-hover)]'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          {p.enabled
                            ? <CheckCircle2 size={14} className="text-[var(--color-success)] flex-shrink-0" />
                            : <XCircle size={14} className="flex-shrink-0" />}
                          {p.label}
                        </span>
                        <span className={`relative w-8 h-[18px] rounded-full transition-colors flex-shrink-0 ${
                          p.enabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border)]'
                        }`}>
                          <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${
                            p.enabled ? 'left-[16px]' : 'left-[2px]'
                          }`} />
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-[var(--color-border)]">
                    <span className="text-xs font-medium text-[var(--color-text-secondary)]">Role</span>
                    <select
                      value={u.globalRing}
                      onChange={(e) => handleRingChange(u.id, u.displayName, parseInt(e.target.value, 10))}
                      className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg text-sm px-2 py-1 text-[var(--color-text-primary)]"
                    >
                      {[0, 1, 2, 3, 4].map((r) => (
                        <option key={r} value={r}>Ring {r} - {RING_LABELS[r] || 'Restricted'}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {pagination.totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            {Array.from({ length: pagination.totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => fetchUsers(i + 1)}
                className={`w-8 h-8 rounded-lg text-sm ${
                  pagination.page === i + 1
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Create Test User Form
// ============================================================
function CreateTestUserForm({ onCreated }) {
  const [form, setForm] = useState({ email: '', displayName: '', password: '' });
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState({ message: '', isError: false });

  const handleCreate = async () => {
    if (!form.email.trim() || !form.displayName.trim()) return;
    setCreating(true);
    setStatus({ message: '', isError: false });
    try {
      const res = await adminApi.createTestUser({
        email: form.email,
        displayName: form.displayName,
        password: form.password || undefined,
      });
      const d = res.data.data;
      setStatus({ message: `✅ ${d.message}`, isError: false });
      setForm({ email: '', displayName: '', password: '' });
      onCreated?.();
    } catch (err) {
      setStatus({ message: err.response?.data?.error?.message || 'Failed to create test user.', isError: true });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="glass-card p-6 space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <UserPlus size={18} className="text-[var(--color-accent)]" /> Create Test User
      </h3>
      <p className="text-xs text-[var(--color-text-muted)]">
        Create a user directly (bypasses registration flow). Cohort tags are auto-assigned from email.
      </p>
      {status.message && (
        <div className={`text-sm p-3 rounded-lg ${
          status.isError
            ? 'bg-red-500/10 text-[var(--color-danger)] border border-red-500/20'
            : 'bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/20'
        }`}>
          {status.message}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Email *</label>
          <input type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="lcs2029001@iiitl.ac.in" />
        </div>
        <div>
          <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Display Name *</label>
          <input type="text" value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="Test User" />
        </div>
        <div>
          <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Password</label>
          <input type="text" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="test123 (default)" />
        </div>
      </div>
      <button onClick={handleCreate} disabled={creating || !form.email.trim() || !form.displayName.trim()}
        className="btn btn-primary">
        {creating ? <span className="spinner" /> : 'Create Test User'}
      </button>
    </div>
  );
}

// ============================================================
// Diagnostics Tab — System Telemetry & Record Counts
// ============================================================
function DiagnosticsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDiagnostics = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.getDiagnostics();
      setData(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load diagnostics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  if (loading) return <div className="skeleton h-64 w-full rounded-xl" />;
  if (error) return <div className="text-sm text-[var(--color-danger)] p-4 glass-card">{error}</div>;

  const formatUptime = (seconds) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? `${d}d ` : ''}${h}h ${m}m ${s}s`;
  };

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Activity size={20} className="text-[var(--color-accent)]" /> Platform Health & Diagnostics
          </h3>
          <button onClick={fetchDiagnostics} className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-muted)]">Server Status</p>
            <p className="text-lg font-bold text-[var(--color-success)] capitalize mt-1">🟢 {data?.status || 'Online'}</p>
          </div>
          <div className="p-4 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-muted)]">Uptime</p>
            <p className="text-lg font-bold text-[var(--color-primary)] mt-1">{formatUptime(data?.uptime || 0)}</p>
          </div>
          <div className="p-4 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-muted)]">Node.js Version</p>
            <p className="text-lg font-bold text-[var(--color-text-primary)] mt-1">{data?.nodeVersion || 'N/A'}</p>
          </div>
          <div className="p-4 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-muted)]">Process Memory (RSS)</p>
            <p className="text-lg font-bold text-[var(--color-accent)] mt-1">{data?.memoryUsage?.rssMb || 0} MB</p>
          </div>
        </div>

        <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">Database Records</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          <div className="p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-center">
            <span className="text-2xl font-extrabold">{data?.counts?.users || 0}</span>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Users</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-center">
            <span className="text-2xl font-extrabold">{data?.counts?.groups || 0}</span>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Groups</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-center">
            <span className="text-2xl font-extrabold">{data?.counts?.messages || 0}</span>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Messages</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-center">
            <span className="text-2xl font-extrabold">{data?.counts?.events || 0}</span>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Events</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-center">
            <span className="text-2xl font-extrabold">{data?.counts?.resources || 0}</span>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Resources</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-center">
            <span className="text-2xl font-extrabold">{data?.counts?.transactions || 0}</span>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Transactions</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Database Tab — Backup and Clear functions with Password Verification
// ============================================================
function DatabaseTab() {
  const [loadingBackup, setLoadingBackup] = useState(false);
  const [loadingClear, setLoadingClear] = useState(false);
  const [status, setStatus] = useState({ message: '', isError: false });
  const [showClearModal, setShowClearModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');

  const handleBackup = async () => {
    setLoadingBackup(true);
    setStatus({ message: '', isError: false });
    try {
      const res = await adminApi.backupDatabase();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'comflex-backup.json');
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      setStatus({ message: 'Backup downloaded successfully.', isError: false });
    } catch {
      setStatus({ message: 'Failed to create backup.', isError: true });
    } finally {
      setLoadingBackup(false);
    }
  };

  const handleConfirmClear = async (e) => {
    e.preventDefault();
    if (!adminPassword) return;
    setLoadingClear(true);
    setStatus({ message: '', isError: false });
    try {
      const res = await adminApi.clearDatabase(adminPassword);
      setStatus({ message: res.data?.data?.message || 'Database successfully cleared.', isError: false });
      setShowClearModal(false);
      setAdminPassword('');
    } catch (err) {
      setStatus({ message: err.response?.data?.error?.message || 'Failed to clear database.', isError: true });
    } finally {
      setLoadingClear(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Password Confirmation Modal for Wipe */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-card p-6 rounded-2xl max-w-md w-full border-2 border-[var(--color-danger)] shadow-2xl">
            <h3 className="text-lg font-bold text-[var(--color-danger)] mb-2">⚠️ Confirm Full Database Wipe</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4 leading-relaxed">
              This will permanently purge all platform data (users, messages, groups, events, resources). Only your admin account and institution config will be kept.
            </p>
            <form onSubmit={handleConfirmClear} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                  Enter your Admin Password to confirm:
                </label>
                <input
                  type="password"
                  required
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Admin Password"
                  className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2 rounded focus:outline-[var(--color-danger)]"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setShowClearModal(false); setAdminPassword(''); }}
                  className="btn btn-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingClear || !adminPassword}
                  className="btn bg-[var(--color-danger)] text-white hover:bg-red-600 text-sm font-bold"
                >
                  {loadingClear ? <span className="spinner" /> : 'Yes, Clear All Data'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="glass-card p-6 space-y-4">
        <h3 className="text-lg font-semibold">Database Management</h3>
        {status.message && (
          <div className={`text-sm p-3 rounded-lg ${status.isError ? 'bg-red-500/10 text-[var(--color-danger)] border border-red-500/20' : 'bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/20'}`}>
            {status.message}
          </div>
        )}

        <div className="p-4 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)]">
          <h4 className="font-semibold mb-1">Backup Database</h4>
          <p className="text-sm text-[var(--color-text-muted)] mb-3">Download a full JSON dump of all records (users, groups, messages, events, etc) in the Prisma schema.</p>
          <button onClick={handleBackup} disabled={loadingBackup} className="btn btn-secondary text-sm">
            {loadingBackup ? <span className="spinner" /> : '📥 Download Backup'}
          </button>
        </div>

        <div className="p-4 rounded-xl bg-[rgba(239,68,68,0.05)] border border-[rgba(239,68,68,0.3)]">
          <h4 className="font-semibold text-red-500 mb-1">Clear Database</h4>
          <p className="text-sm text-[var(--color-text-muted)] mb-3">Permanently delete all non-essential data. Your admin account and the core institution configuration will be preserved.</p>
          <button onClick={() => setShowClearModal(true)} className="btn border border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white transition-colors text-sm font-semibold">
            🛑 Clear All Data
          </button>
        </div>
      </div>
    </div>
  );
}

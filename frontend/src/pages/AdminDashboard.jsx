/**
 * AdminDashboard — Institution config, cohort rules, groups, auto-join, user management.
 *
 * Only accessible to Ring 0 (Admin) users.
 * Five tabs: Institution | Cohort Rules | Groups | Auto-Join | Users
 */

import { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../api/adminApi';
import resolveAsset from '../utils/resolveAsset';

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

        {tab === 'institution' && <InstitutionTab />}
        {tab === 'cohort' && <CohortTab />}
        {tab === 'groups' && <GroupsTab />}
        {tab === 'autojoin' && <AutoJoinTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'database' && <DatabaseTab />}
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
  const [message, setMessage] = useState('');

  useEffect(() => {
    adminApi.getInstitution().then((res) => {
      const data = res.data.data;
      setConfig(data);
      setForm({ name: data?.name || '', domain: data?.domain || '', defaultCredits: data?.defaultCredits ?? 0 });
    }).catch(() => setMessage('Failed to load config.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await adminApi.updateInstitution(form);
      setMessage('Institution settings updated!');
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="space-y-3"><div className="skeleton h-12 w-full" /><div className="skeleton h-12 w-full" /></div>;

  return (
    <div className="glass-card p-6 space-y-4">
      <h3 className="text-lg font-semibold">Institution Settings</h3>
      {message && <div className="text-sm text-[var(--color-success)]">{message}</div>}
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
  const [message, setMessage] = useState('');

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
    setMessage('');
    try {
      await adminApi.createGroup(newGroup);
      setMessage('Group created!');
      setNewGroup({ name: '', displayName: '', description: '', type: 'custom' });
      await fetchGroups();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to create group.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete group "${name}"? This cannot be undone.`)) return;
    try {
      await adminApi.deleteGroup(id);
      await fetchGroups();
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to delete group.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Create new group */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="text-lg font-semibold">Create Group</h3>
        {message && <div className="text-sm text-[var(--color-success)]">{message}</div>}
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
                <button onClick={() => handleDelete(g.id, g.name)} className="text-xs text-[var(--color-danger)] hover:underline">Delete</button>
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
// Users Tab — with canCreateGroups toggle
// ============================================================
function UsersTab() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchUsers = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const res = await adminApi.listUsers({ search, page, limit: 10 });
      setUsers(res.data.data.users);
      setPagination(res.data.data.pagination);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleRingChange = async (userId, newRing) => {
    try {
      await adminApi.setUserRing(userId, newRing);
      fetchUsers(pagination.page);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to change ring.');
    }
  };

  const handleRetag = async (userId) => {
    try {
      await adminApi.retagUser(userId);
      fetchUsers(pagination.page);
    } catch {
      alert('Retag failed.');
    }
  };

  const handleToggleCreateGroups = async (userId, current) => {
    try {
      await adminApi.setUserPermissions(userId, { canCreateGroups: !current });
      fetchUsers(pagination.page);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to update permissions.');
    }
  };

  const handleToggleCreateEvents = async (userId, current) => {
    try {
      await adminApi.setUserPermissions(userId, { canCreateEvents: !current });
      fetchUsers(pagination.page);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to update permissions.');
    }
  };

  const handleToggleManageResources = async (userId, current) => {
    try {
      await adminApi.setUserPermissions(userId, { canManageResources: !current });
      fetchUsers(pagination.page);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to update permissions.');
    }
  };

  const handleToggleManageStore = async (userId, current) => {
    try {
      await adminApi.setUserPermissions(userId, { canManageStore: !current });
      fetchUsers(pagination.page);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to update permissions.');
    }
  };

  const handleDeleteUser = async (userId, displayName) => {
    if (!confirm(`⚠️ Permanently delete "${displayName}"?\n\nThis will remove their account, messages, group memberships, friendships, and DMs. This cannot be undone.`)) return;
    try {
      await adminApi.deleteUser(userId);
      fetchUsers(pagination.page);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to delete user.');
    }
  };

  const [retagging, setRetagging] = useState(false);
  const handleRetagAll = async () => {
    if (!confirm('Re-process ALL users through current cohort + auto-join rules?\n\nThis will remove existing group memberships and re-assign based on current config.')) return;
    setRetagging(true);
    try {
      const res = await adminApi.retagAllUsers();
      const d = res.data.data;
      alert(`✅ ${d.message}\nProcessed: ${d.processed}/${d.total}`);
      fetchUsers(pagination.page);
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Retag all failed.');
    } finally {
      setRetagging(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Create Test User */}
      <CreateTestUserForm onCreated={() => fetchUsers(pagination.page)} />

      <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">User Management</h3>
        <div className="flex items-center gap-3">
          <button onClick={handleRetagAll} disabled={retagging}
            className="btn btn-secondary text-xs px-3 py-1.5"
            title="Apply current cohort + auto-join rules to all existing users">
            {retagging ? '⏳ Retagging...' : '🔄 Retag All Users'}
          </button>
          <span className="text-sm text-[var(--color-text-muted)]">{pagination.total || 0} users</span>
        </div>
      </div>

      {/* Search */}
      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email..." className="mb-4" />

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 w-full" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)]">
              {/* Avatar */}
              {u.avatarUrl ? (
                <img src={resolveAsset(u.avatarUrl)} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white font-bold text-sm">
                  {u.displayName?.charAt(0)?.toUpperCase()}
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{u.displayName}</p>
                <p className="text-xs text-[var(--color-text-muted)] truncate">{u.email}</p>
              </div>

              {/* Tags */}
              <div className="hidden lg:flex gap-1 flex-shrink-0">
                {u.cohortTags?.slice(0, 2).map((tag) => (
                  <span key={tag} className="px-2 py-0.5 chip-accent rounded text-xs">
                    {tag}
                  </span>
                ))}
              </div>

              {/* Can create groups badge */}
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => handleToggleCreateGroups(u.id, u.canCreateGroups)}
                  className={`text-[10px] px-2 py-1 rounded-lg transition-colors flex-shrink-0 ${
                    u.canCreateGroups
                      ? 'chip-accent border border-[rgba(16,185,129,0.3)]'
                      : 'bg-[var(--color-bg-card)] text-[var(--color-text-muted)] border border-[var(--color-border)]'
                  }`}
                  title={u.canCreateGroups ? 'Click to revoke group creation' : 'Click to grant group creation'}
                >
                  {u.canCreateGroups ? '✅ Groups' : '🚫 Groups'}
                </button>
                <button
                  onClick={() => handleToggleCreateEvents(u.id, u.canCreateEvents)}
                  className={`text-[10px] px-2 py-1 rounded-lg transition-colors flex-shrink-0 ${
                    u.canCreateEvents
                      ? 'chip-accent border border-[rgba(16,185,129,0.3)]'
                      : 'bg-[var(--color-bg-card)] text-[var(--color-text-muted)] border border-[var(--color-border)]'
                  }`}
                  title={u.canCreateEvents ? 'Click to revoke event creation' : 'Click to grant event creation'}
                >
                  {u.canCreateEvents ? '✅ Events' : '🚫 Events'}
                </button>
                <button
                  onClick={() => handleToggleManageResources(u.id, u.canManageResources)}
                  className={`text-[10px] px-2 py-1 rounded-lg transition-colors flex-shrink-0 ${
                    u.canManageResources
                      ? 'chip-accent border border-[rgba(16,185,129,0.3)]'
                      : 'bg-[var(--color-bg-card)] text-[var(--color-text-muted)] border border-[var(--color-border)]'
                  }`}
                  title={u.canManageResources ? 'Click to revoke resource management' : 'Click to grant resource management'}
                >
                  {u.canManageResources ? '✅ Resources' : '🚫 Resources'}
                </button>
                <button
                  onClick={() => handleToggleManageStore(u.id, u.canManageStore)}
                  className={`text-[10px] px-2 py-1 rounded-lg transition-colors flex-shrink-0 ${
                    u.canManageStore
                      ? 'chip-accent border border-[rgba(16,185,129,0.3)]'
                      : 'bg-[var(--color-bg-card)] text-[var(--color-text-muted)] border border-[var(--color-border)]'
                  }`}
                  title={u.canManageStore ? 'Click to revoke store management' : 'Click to grant store management'}
                >
                  {u.canManageStore ? '✅ Store' : '🚫 Store'}
                </button>
              </div>

              {/* Ring selector */}
              <select
                value={u.globalRing}
                onChange={(e) => handleRingChange(u.id, parseInt(e.target.value))}
                className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg text-sm px-2 py-1 text-[var(--color-text-primary)] flex-shrink-0"
              >
                {[0, 1, 2, 3, 4].map((r) => (
                  <option key={r} value={r}>Ring {r} - {RING_LABELS[r] || 'Restricted'}</option>
                ))}
              </select>

              {/* Retag button */}
              <button onClick={() => handleRetag(u.id)} className="btn btn-secondary text-xs px-2 py-1"
                title="Re-process cohort tags">
                🔄
              </button>

              {/* Delete button */}
              <button
                onClick={() => handleDeleteUser(u.id, u.displayName)}
                className="text-xs px-2 py-1 rounded-lg border border-[rgba(239,68,68,0.3)] text-red-400 hover:bg-[rgba(239,68,68,0.1)] transition-colors flex-shrink-0"
                title="Delete user permanently"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
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
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success');

  const handleCreate = async () => {
    if (!form.email.trim() || !form.displayName.trim()) return;
    setCreating(true);
    setMessage('');
    try {
      const res = await adminApi.createTestUser({
        email: form.email,
        displayName: form.displayName,
        password: form.password || undefined,
      });
      const d = res.data.data;
      setMessageType('success');
      setMessage(`✅ ${d.message}`);
      setForm({ email: '', displayName: '', password: '' });
      onCreated?.();
    } catch (err) {
      setMessageType('error');
      setMessage(err.response?.data?.error?.message || 'Failed to create test user.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="glass-card p-6 space-y-4">
      <h3 className="text-lg font-semibold">🧪 Create Test User</h3>
      <p className="text-xs text-[var(--color-text-muted)]">
        Create a user directly (bypasses registration flow). Cohort tags are auto-assigned from email.
      </p>
      {message && (
        <div className={`text-sm ${
          messageType === 'success' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'
        }`}>{message}</div>
      )}
      <div className="grid grid-cols-3 gap-4">
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
// Database Tab — Backup and Clear functions
// ============================================================
function DatabaseTab() {
  const [loadingBackup, setLoadingBackup] = useState(false);
  const [loadingClear, setLoadingClear] = useState(false);
  const [message, setMessage] = useState('');

  const handleBackup = async () => {
    setLoadingBackup(true);
    setMessage('');
    try {
      const res = await adminApi.backupDatabase();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'comflex-backup.json');
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      setMessage('Backup downloaded successfully.');
    } catch {
      setMessage('Failed to create backup.');
    } finally {
      setLoadingBackup(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('⚠️ DANGER: Are you absolutely sure you want to clear the entire database?\n\nThis will permanently delete all users (except yourself), groups, messages, and events. This CANNOT BE UNDONE. Make sure you take a backup first!')) return;
    
    setLoadingClear(true);
    setMessage('');
    try {
      const res = await adminApi.clearDatabase();
      setMessage(res.data?.data?.message || 'Database successfully cleared.');
      window.alert('Database cleared successfully.');
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to clear database.');
    } finally {
      setLoadingClear(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-card p-6 space-y-4">
        <h3 className="text-lg font-semibold">Database Management</h3>
        {message && <div className={`text-sm ${message.includes('Failed') ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'}`}>{message}</div>}
        
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
          <button onClick={handleClear} disabled={loadingClear} className="btn border border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white transition-colors text-sm">
            {loadingClear ? <span className="spinner" /> : '🛑 Clear All Data'}
          </button>
        </div>
      </div>
    </div>
  );
}

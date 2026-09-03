import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Plus, Trash2, Link as LinkIcon, Check, Copy,
  Users, Clock, ShieldCheck, AlertCircle, Loader2, ArrowRight
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { eventApi } from '../api/eventApi';

function InviteLinkButton({ eventId }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const handleCopy = async () => {
    setError('');
    try {
      const res = await eventApi.createInviteLink(eventId);
      const token = res.data?.data?.token;
      const url = `${window.location.origin}/events/invite/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to create link.');
    }
  };

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={handleCopy}
        className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-xs"
        title="Copy shareable invite link"
      >
        {copied ? <Check size={13} className="text-[var(--color-success)]" /> : <LinkIcon size={13} />}
        <span>{copied ? 'Copied' : 'Invite Link'}</span>
      </button>
      {error && <span className="text-[10px] text-[var(--color-danger)] mt-1">{error}</span>}
    </div>
  );
}

export default function ManageEventsPage() {
  const { user } = useAuth();
  const [managedEvents, setManagedEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const isAdminUser = user?.globalRing === 0;
  const mayTargetGroups = isAdminUser || user?.canCreateEvents === true;

  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    startDate: '',
    durationHours: 0,
    durationMinutes: 0,
    taskViewMode: 'all',
    category: '',
    targetTags: '',
    isTeamEvent: false,
    minTeamSize: 1,
    maxTeamSize: 4,
    autoStart: true,
    inviteOnly: false,
    allowedCohorts: '',
    blockedCohorts: '',
    allowedUserIds: '',
    blockedUserIds: '',
  });
  const [message, setMessage] = useState('');

  const fetchEvents = () => {
    setLoading(true);
    eventApi.listManagedEvents()
      .then(res => setManagedEvents(res.data?.data || []))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (form.isTeamEvent && Number(form.minTeamSize) > Number(form.maxTeamSize)) {
      setMessage('Minimum team size cannot be greater than maximum team size.');
      return;
    }
    setCreating(true);
    setMessage('');

    try {
      const payload = {
        ...form,
        inviteMode: mayTargetGroups && !form.inviteOnly ? 'open' : 'invite_only',
        targetTags: form.targetTags ? form.targetTags.split(',').map(t => t.trim()).filter(Boolean) : [],
        allowedCohorts: form.allowedCohorts ? form.allowedCohorts.split(',').map(t => t.trim()).filter(Boolean) : [],
        blockedCohorts: form.blockedCohorts ? form.blockedCohorts.split(',').map(t => t.trim()).filter(Boolean) : [],
        allowedUserIds: form.allowedUserIds ? form.allowedUserIds.split(',').map(t => t.trim()).filter(Boolean) : [],
        blockedUserIds: form.blockedUserIds ? form.blockedUserIds.split(',').map(t => t.trim()).filter(Boolean) : [],
        startDate: new Date(form.startDate).toISOString(),
      };

      await eventApi.createEvent(payload);
      setMessage('Event successfully created!');
      setShowForm(false);
      setForm({
        title: '', description: '', startDate: '', durationHours: 0, durationMinutes: 0, taskViewMode: 'all', category: '', targetTags: '',
        isTeamEvent: false, minTeamSize: 1, maxTeamSize: 4, autoStart: true,
        inviteOnly: false, allowedCohorts: '', blockedCohorts: '', allowedUserIds: '', blockedUserIds: '',
      });
      fetchEvents();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to create event.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id, title) => {
    if (!confirm(`Delete event "${title}"? This cannot be undone.`)) return;
    try {
      await eventApi.deleteEvent(id);
      fetchEvents();
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to delete event.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* Top Banner */}
      <div className="glass-card p-6 border border-[var(--color-border)] mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-[var(--color-text-primary)]">Manage Campus Events</h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Create, oversee challenges, grade task submissions, and distribute rewards</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn btn-primary text-xs py-2 px-4 shadow-sm flex items-center gap-1.5"
        >
          <Plus size={15} />
          <span>{showForm ? 'Cancel Creation' : 'Create Event'}</span>
        </button>
      </div>

      {/* Creation Modal / Form */}
      <AnimatePresence>
        {showForm && (
          <motion.form
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onSubmit={handleCreateEvent}
            className="glass-card p-6 sm:p-8 border border-[var(--color-border)] shadow-xl mb-6 space-y-4"
          >
            <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] mb-2">Create New Event</h3>

            {message && (
              <div className="p-3 rounded-2xl bg-[var(--color-warning)]/15 text-[var(--color-warning)] text-xs font-semibold">
                {message}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
                  Event Title *
                </label>
                <input
                  required
                  type="text"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Winter Hackathon 2026"
                  className="matte-input text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
                  Start Date & Time *
                </label>
                <input
                  required
                  type="datetime-local"
                  value={form.startDate}
                  onChange={e => setForm({ ...form, startDate: e.target.value })}
                  className="matte-input text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
                  Category *
                </label>
                <select
                  required
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                  className="matte-input text-xs"
                >
                  <option value="">Select Category...</option>
                  <option value="cybersec">Cyber Security</option>
                  <option value="app">App Development</option>
                  <option value="web">Web Development</option>
                  <option value="cp">Competitive Programming</option>
                  <option value="design">UI/UX Design</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
                  Target Cohort Tags
                </label>
                {mayTargetGroups ? (
                  <input
                    type="text"
                    value={form.targetTags}
                    onChange={e => setForm({ ...form, targetTags: e.target.value })}
                    placeholder="e.g. cohort-2026, branch-cs"
                    className="matte-input text-xs"
                  />
                ) : (
                  <p className="text-[11px] text-[var(--color-warning)] p-2 rounded-xl bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20">
                    Cohort auto-enrollment requires admin elevation. Events will be distributed via shareable invite links.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
                  Duration (Hours : Minutes)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    value={form.durationHours}
                    onChange={e => setForm({ ...form, durationHours: Number(e.target.value) })}
                    className="matte-input text-xs flex-1 text-center"
                    placeholder="Hours"
                  />
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={form.durationMinutes}
                    onChange={e => setForm({ ...form, durationMinutes: Number(e.target.value) })}
                    className="matte-input text-xs flex-1 text-center"
                    placeholder="Minutes"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
                  Task View Mode
                </label>
                <select
                  value={form.taskViewMode}
                  onChange={e => setForm({ ...form, taskViewMode: e.target.value })}
                  className="matte-input text-xs"
                >
                  <option value="all">All Tasks Visible At Once</option>
                  <option value="dynamic">Dynamic Sequential Unlocking</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Guidelines, rules, and overview..."
                rows={3}
                className="matte-input text-xs resize-none"
              />
            </div>

            <div className="flex items-center gap-6 p-4 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex-wrap">
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--color-text-primary)]">
                <input
                  type="checkbox"
                  checked={form.isTeamEvent}
                  onChange={e => setForm({ ...form, isTeamEvent: e.target.checked })}
                />
                Team Event Format
              </label>

              {form.isTeamEvent && (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[var(--color-text-muted)]">Min:</span>
                    <input
                      type="number"
                      min="1"
                      value={form.minTeamSize}
                      onChange={e => setForm({ ...form, minTeamSize: Number(e.target.value) })}
                      className="matte-input text-xs w-16 text-center py-1"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[var(--color-text-muted)]">Max:</span>
                    <input
                      type="number"
                      min="1"
                      value={form.maxTeamSize}
                      onChange={e => setForm({ ...form, maxTeamSize: Number(e.target.value) })}
                      className="matte-input text-xs w-16 text-center py-1"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={creating || !form.title || !form.startDate || !form.category}
                className="btn btn-primary text-xs py-2.5 px-6 shadow-md"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                <span>{creating ? 'Creating Event...' : 'Publish Event'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn btn-secondary text-xs px-4"
              >
                Cancel
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Managed Events List */}
      {loading ? (
        <div className="py-12 flex justify-center items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={18} className="animate-spin text-[var(--color-accent)]" />
          <span>Loading managed events...</span>
        </div>
      ) : managedEvents.length === 0 ? (
        <div className="glass-card p-10 text-center border border-[var(--color-border)]">
          <CalendarDays size={32} className="mx-auto text-[var(--color-text-muted)] mb-2 opacity-50" />
          <p className="text-xs text-[var(--color-text-muted)]">You are not organizing any events yet. Click &quot;Create Event&quot; to begin.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {managedEvents.map(event => (
            <div
              key={event.id}
              className="glass-card p-4.5 px-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-[var(--color-border)] hover-lift"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="font-bold text-sm text-[var(--color-text-primary)] truncate">{event.title}</h3>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
                    {event.category}
                  </span>
                  <span className={`text-[9px] font-bold px-2 py-0.2 rounded-full uppercase ${
                    event.status === 'draft' ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]' : 'bg-[var(--palette-teal)]/15 text-[var(--palette-teal)]'
                  }`}>
                    {event.status}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                  Starts: {new Date(event.startDate).toLocaleString()} • {event.isTeamEvent ? `Team (${event.minTeamSize}–${event.maxTeamSize})` : 'Individual'}
                  {event.rewardRules?.length > 0 ? ` • ${event.rewardRules.length} reward rules` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <InviteLinkButton eventId={event.id} />
                <Link to={`/events/${event.id}`} className="btn btn-primary text-xs py-1.5 px-3 shadow-xs">
                  Workspace
                </Link>
                <button
                  onClick={() => handleDelete(event.id, event.title)}
                  className="btn btn-secondary text-xs p-1.5 text-[var(--color-danger)]"
                  title="Delete event"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

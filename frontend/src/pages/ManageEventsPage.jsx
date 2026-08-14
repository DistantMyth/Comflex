import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { eventApi } from '../api/eventApi';
import { Link } from 'react-router-dom';

function InviteLinkButton({ eventId }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const handleCopy = async () => {
    setError('');
    try {
      const res = await eventApi.createInviteLink(eventId);
      const token = res.data.data.token;
      const url = `${window.location.origin}/events/invite/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to create invite link.');
    }
  };

  return (
    <span className="flex flex-col items-end">
      <button onClick={handleCopy} className="btn btn-secondary text-xs px-3 py-1.5" title="Copy shareable invite link (valid 7 days)">
        {copied ? '✓ Copied' : 'Copy Invite Link'}
      </button>
      {error && <span className="text-[10px] text-[var(--color-danger)] mt-1">{error}</span>}
    </span>
  );
}

export default function ManageEventsPage() {
  const { user } = useAuth();
  const [managedEvents, setManagedEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const isAdminUser = user?.globalRing === 0;
  const mayTargetGroups = isAdminUser || user?.canCreateEvents === true;
  
  // Creation Form State
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
    blockedUserIds: ''
  });
  const [message, setMessage] = useState('');

  const fetchEvents = () => {
    setLoading(true);
    eventApi.listManagedEvents()
      .then(res => setEvents(res.data.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };
  
  const setEvents = (data) => {
    setManagedEvents(data);
  };

  useEffect(() => {
    setLoading(true);
    eventApi.listManagedEvents()
      .then(res => setManagedEvents(res.data.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const handleCreateEvent = async (e) => {
    e.preventDefault();
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
        startDate: new Date(form.startDate).toISOString()
      };
      
      await eventApi.createEvent(payload);
      setMessage('Event successfully created!');
      setShowForm(false);
      
      // Reset form
      setForm({
        title: '', description: '', startDate: '', durationHours: 0, durationMinutes: 0, taskViewMode: 'all', category: '', targetTags: '', 
        isTeamEvent: false, minTeamSize: 1, maxTeamSize: 4, autoStart: true,
        inviteOnly: false, allowedCohorts: '', blockedCohorts: '', allowedUserIds: '', blockedUserIds: ''
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
    <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-center bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-6 shadow-sm">
          <div>
            <h2 className="text-2xl font-bold gradient-text">Manage Events</h2>
            <p className="text-[var(--color-text-secondary)] mt-1">
              Create, oversee, and manage permissions for events.
            </p>
          </div>
          <button 
            onClick={() => setShowForm(!showForm)} 
            className="btn btn-primary"
          >
            {showForm ? 'Cancel' : '+ Create Event'}
          </button>
        </div>

        {/* Create Form */}
        {showForm && (
          <form onSubmit={handleCreateEvent} className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-2xl p-6 shadow-lg">
            <h3 className="text-lg font-bold mb-4">Create New Event</h3>
            {message && <div className="text-sm text-[var(--color-warning)] mb-4">{message}</div>}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Title *</label>
                <input required type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g. Cybersec Capture The Flag" className="w-full text-sm" />
              </div>
              <div>
                 <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Start Date & Time *</label>
                 <input required type="datetime-local" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} className="w-full text-sm" />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Category *</label>
                <select required value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg px-3 py-2">
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
                <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Target Tags (Comma separated)</label>
                {mayTargetGroups ? (
                  <input type="text" value={form.targetTags} onChange={e => setForm({...form, targetTags: e.target.value})} placeholder="e.g. cohort-28, branch-cs" className="w-full text-sm" />
                ) : (
                  <div className="text-xs text-[var(--color-warning)] bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20 rounded-lg px-3 py-2">
                    🔒 Cohort targeting requires admin permission. Your events are invite-only and spread via the invite link, team invitations and friends.
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Duration</label>
                <div className="flex gap-1">
                  <input type="number" min="0" value={form.durationHours} onChange={e => setForm({...form, durationHours: Number(e.target.value)})} className="w-1/2 text-sm text-center px-1" placeholder="Hrs" title="Hours" />
                  <span className="self-center">:</span>
                  <input type="number" min="0" max="59" value={form.durationMinutes} onChange={e => setForm({...form, durationMinutes: Number(e.target.value)})} className="w-1/2 text-sm text-center px-1" placeholder="Min" title="Minutes" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Task View Mode</label>
                <select value={form.taskViewMode} onChange={e => setForm({...form, taskViewMode: e.target.value})} className="w-full text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg px-2 py-2">
                  <option value="all">All At Once</option>
                  <option value="dynamic">Dynamic Unlocking</option>
                </select>
              </div>
            </div>

            <div className="mb-4">
               <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Description</label>
               <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Event details..." className="w-full text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg px-3 py-2 min-h-[80px]" />
            </div>

            <div className="flex items-center gap-6 mb-6 p-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl">
               <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={form.isTeamEvent} onChange={e => setForm({...form, isTeamEvent: e.target.checked})} className="rounded text-[var(--color-accent)] focus:ring-[var(--color-accent)]" />
                  Is Team Event?
               </label>
               
               {form.isTeamEvent && (
                 <>
                   <div className="flex items-center gap-2">
                     <label className="text-sm text-[var(--color-text-secondary)]">Min Size:</label>
                     <input type="number" min="1" value={form.minTeamSize} onChange={e => setForm({...form, minTeamSize: Number(e.target.value)})} className="w-16 text-sm py-1" />
                   </div>
                   <div className="flex items-center gap-2">
                     <label className="text-sm text-[var(--color-text-secondary)]">Max Size:</label>
                     <input type="number" min="1" value={form.maxTeamSize} onChange={e => setForm({...form, maxTeamSize: Number(e.target.value)})} className="w-16 text-sm py-1" />
                   </div>
                 </>
               )}
            </div>

            <div className="flex items-center gap-6 mb-6 p-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl">
               <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={form.autoStart} onChange={e => setForm({...form, autoStart: e.target.checked})} className="rounded text-[var(--color-accent)] focus:ring-[var(--color-accent)]" />
                  Auto-start event when Start Date arrives
               </label>
               <span className="text-xs text-[var(--color-text-secondary)]">If disabled, you will need to manually click 'Start Event' on the event page.</span>
            </div>

            {/* Participation policy */}
            <div className="mb-6 p-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl space-y-4">
              <h4 className="text-sm font-bold">Participation Policy</h4>
              {mayTargetGroups ? (
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={form.inviteOnly} onChange={e => setForm({...form, inviteOnly: e.target.checked})} className="rounded text-[var(--color-accent)] focus:ring-[var(--color-accent)]" />
                  Invite-only — no self-registration; participants join via invite link or team invitations
                </label>
              ) : (
                <p className="text-xs text-[var(--color-warning)] bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20 rounded-lg px-3 py-2">
                  🔒 This event will be invite-only — no self-registration, no cohort targeting. Participants join via your invite link or team/friend invitations.
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {mayTargetGroups && (
                  <>
                    <div>
                      <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Allowed Cohorts (whitelist)</label>
                      <input type="text" value={form.allowedCohorts} onChange={e => setForm({...form, allowedCohorts: e.target.value})} placeholder="e.g. cohort-28, branch-cs" className="w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Blocked Cohorts (blacklist)</label>
                      <input type="text" value={form.blockedCohorts} onChange={e => setForm({...form, blockedCohorts: e.target.value})} placeholder="e.g. cohort-26" className="w-full text-sm" />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Allowed User IDs (whitelist)</label>
                  <input type="text" value={form.allowedUserIds} onChange={e => setForm({...form, allowedUserIds: e.target.value})} placeholder="Comma separated user IDs" className="w-full text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Blocked User IDs (blacklist)</label>
                  <input type="text" value={form.blockedUserIds} onChange={e => setForm({...form, blockedUserIds: e.target.value})} placeholder="Comma separated user IDs" className="w-full text-sm" />
                </div>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">Whitelists and blacklists are enforced even when someone has the invite link.</p>
            </div>

            {/* Rewards are configured per event, on the event page */}
            <div className="mb-6 p-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl">
              <h4 className="text-sm font-bold">Rewards</h4>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Reward rules (per correct answer, rank placements, manual grants) are configured inside the event page's <strong>Rewards</strong> panel after creation.
                {!isAdminUser && ' Non-admin creators fund rewards from their own credit balance and badge inventory.'}
              </p>
            </div>

            <button type="submit" disabled={creating || !form.title || !form.startDate || !form.category} className="btn btn-primary w-full md:w-auto">
              {creating ? <span className="spinner" /> : 'Create Event'}
            </button>
          </form>
        )}

        {/* List of Managed Events */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-[var(--color-bg-secondary)] animate-pulse rounded-2xl" />)}
          </div>
        ) : managedEvents.length === 0 ? (
          <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-8 text-center text-[var(--color-text-muted)]">
            You aren't organizing any events right now.
          </div>
        ) : (
          <div className="grid gap-3">
            {managedEvents.map(event => (
              <div key={event.id} className="flex items-center justify-between p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h4 className="font-bold">{event.title}</h4>
                    <span className="text-xs px-2 py-0.5 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-full">{event.category}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ${event.status === 'draft' ? 'bg-[var(--color-bg-primary)] text-[var(--color-text-muted)]' : 'bg-[var(--color-accent)] text-white'}`}>{event.status}</span>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    Starts: {new Date(event.startDate).toLocaleString()} • Targets: {event.targetTags?.length ? event.targetTags.join(', ') : 'Public'}
                    {event.isTeamEvent ? ` • Team (${event.minTeamSize}-${event.maxTeamSize})` : ' • Solo'}
                    {event.inviteMode === 'invite_only' ? ' • Invite-only' : ''}
                    {event.rewardRules?.length > 0 ? ` • ${event.rewardRules.length} reward rule${event.rewardRules.length > 1 ? 's' : ''}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <InviteLinkButton eventId={event.id} />
                  <Link to={`/events/${event.id}`} className="btn btn-secondary text-xs px-3 py-1.5">Manage</Link>
                  <button onClick={() => handleDelete(event.id, event.title)} className="p-1.5 text-[var(--color-danger)] hover:bg-[rgba(239,68,68,0.1)] rounded-lg transition-colors" title="Delete Event">
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
  );
}

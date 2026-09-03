import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, Calendar, Users, Clock, Flame, Shield, Plus, Trash2, Edit2,
  CheckCircle2, XCircle, AlertCircle, ArrowRight, Loader2, Award, Coins,
  Send, ExternalLink, HelpCircle, Check, Eye
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { eventApi } from '../api/eventApi';
import { userApi } from '../api/userApi';
import { storeApi } from '../api/storeApi';
import Avatar from '../components/Avatar';
import resolveAsset from '../utils/resolveAsset';

const toLocalISO = (d) => {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const CountdownClock = ({ targetDate, label, onExpire }) => {
  const [timeLeft, setTimeLeft] = useState(0);
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
    const calc = () => {
      const remaining = Math.max(0, new Date(targetDate).getTime() - new Date().getTime());
      if (remaining === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
      return remaining;
    };
    setTimeLeft(calc());
    const t = setInterval(() => setTimeLeft(calc()), 1000);
    return () => clearInterval(t);
  }, [targetDate, onExpire]);

  const h = Math.floor(timeLeft / 3600000);
  const m = Math.floor((timeLeft % 3600000) / 60000);
  const s = Math.floor((timeLeft % 60000) / 1000);

  if (timeLeft === 0) {
    return (
      <div className="px-4 py-2 rounded-2xl bg-[var(--palette-teal)]/15 border border-[var(--palette-teal)]/30 text-[var(--palette-teal)] font-bold text-xs text-center">
        {label} Reached!
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center p-3 rounded-2xl glass-card border border-[var(--color-border)] text-center min-w-[140px] shadow-sm">
      <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-0.5">{label}</span>
      <div className="text-xl font-mono font-bold text-[var(--color-text-primary)]">
        {h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
      </div>
    </div>
  );
};

export default function EventDetailsPage() {
  const { id } = useParams();
  const { user, refreshProfile } = useAuth();
  const [event, setEvent] = useState(null);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  const [activeSection, setActiveSection] = useState('overview'); // overview, teams, tasks, leaderboard, rewards, organizers
  const [teamName, setTeamName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);

  // Editing and Organizers
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [searchOrgQuery, setSearchOrgQuery] = useState('');
  const [searchOrgResults, setSearchOrgResults] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [orgPerms, setOrgPerms] = useState({
    canEditDetails: false, canChangeTiming: false, canChangeDurationWhileRunning: false, canChangePenalty: false
  });

  // Task & Leaderboard Management
  const [tasks, setTasks] = useState([]);
  const [taskForm, setTaskForm] = useState({ title: '', description: '', order: 1, basePoints: 100, submissionType: 'text', isAutoEvaluated: false, exactText: '', options: '', correctOptions: [], decayPercentage: 0, wrongSubmissionPenalty: 0 });
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskSubmissions, setTaskSubmissions] = useState({});
  const [selectedTaskIdx, setSelectedTaskIdx] = useState(-1);
  const [submissionCodes, setSubmissionCodes] = useState({});
  const [submissionSelections, setSubmissionSelections] = useState({});
  const [submitResults, setSubmitResults] = useState({});
  const [pointAdjustData, setPointAdjustData] = useState({ teamId: '', pointsAdded: 0, reason: '' });
  const [gradingSubId, setGradingSubId] = useState(null);
  const [gradeScore, setGradeScore] = useState(0);
  const [eventBadges, setEventBadges] = useState([]);
  const [rewardData, setRewardData] = useState({ teamId: '', credits: 0, badgeIds: [] });

  // Reward rules & grant ledger
  const [rewardRules, setRewardRules] = useState([]);
  const [rewardGrants, setRewardGrants] = useState([]);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ trigger: 'submission', rank: 1, creditsPerUser: 0, badgeIds: [], maxUses: '' });
  const [ownedBadges, setOwnedBadges] = useState([]);

  const fetchEventData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: eventRes } = await eventApi.getEvent(id);
      const ev = eventRes.data;
      setEvent(ev);
      setEditForm({
        title: ev.title, description: ev.description || '', startDate: toLocalISO(ev.startDate),
        durationHours: ev.durationHours, durationMinutes: ev.durationMinutes,
        taskViewMode: ev.taskViewMode, scoreMode: ev.scoreMode, wrongSubmissionPenalty: ev.wrongSubmissionPenalty,
        targetTags: ev.targetTags?.join(', ') || '',
        isTeamEvent: ev.isTeamEvent || false,
        minTeamSize: ev.minTeamSize || 1, maxTeamSize: ev.maxTeamSize || 1
      });

      const { data: teamsRes } = await eventApi.listTeams(id);
      const fetchedTeams = teamsRes.data || [];
      setTeams(fetchedTeams);

      const isOrg = ev.creatorId === user?.id || ev.organizers?.some(o => o.userId === user?.id);
      const inTeam = fetchedTeams.some(t => t.members.some(m => m.userId === user?.id));

      if (isOrg || inTeam) {
        try {
          const { data: tasksRes } = await eventApi.listTasks(id);
          setTasks(tasksRes.data || []);
        } catch { /* ignore */ }
      }

      try {
        const { data: lbRes } = await eventApi.getLeaderboard(id);
        setLeaderboard(lbRes.data || []);
      } catch { /* ignore */ }

      try {
        const { data: bData } = await storeApi.getAllBadges();
        setEventBadges((bData.data || []).filter(b => b.isEventBadge));
      } catch { /* ignore */ }

      if (isOrg || user?.globalRing === 0) {
        try {
          const [rulesRes, grantsRes] = await Promise.all([
            eventApi.listRewardRules(id),
            eventApi.listRewardGrants(id)
          ]);
          setRewardRules(rulesRes.data || []);
          setRewardGrants(grantsRes.data || []);
        } catch { /* ignore */ }
      }

      try {
        const { data: invRes } = await storeApi.getInventory();
        setOwnedBadges(invRes.data || []);
      } catch { /* ignore */ }
    } catch (err) {
      console.error('Failed to fetch event data', err);
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    fetchEventData();
  }, [fetchEventData]);

  const userTeam = teams.find(t => t.members.some(m => m.userId === user?.id));
  const isCreator = event?.creatorId === user?.id || user?.globalRing === 0;
  const isOrganizer = isCreator || event?.organizers?.some(o => o.userId === user?.id);

  const handleCreateTeam = async (e, isIndividual = false) => {
    e?.preventDefault();
    const nameToUse = isIndividual ? user.displayName : teamName;
    if (!nameToUse.trim()) return;
    setActionLoading(true);
    setMessage('');
    try {
      await eventApi.createTeam(id, nameToUse);
      if (!isIndividual) setTeamName('');
      setMessage(isIndividual ? 'Registered successfully!' : 'Team created!');
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to register team.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegisterTeam = async () => {
    if (!userTeam) return;
    setActionLoading(true);
    setMessage('');
    try {
      await eventApi.registerTeam(id, userTeam.id);
      setMessage('Team enrolled for challenge!');
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to register team.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSearchUsers = async (e) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (q.length > 1) {
      try {
        const { data } = await userApi.searchUsers(q);
        setSearchResults(data.data || []);
      } catch {
        setSearchResults([]);
      }
    } else {
      setSearchResults([]);
    }
  };

  const handleInvite = async (teamId, userId) => {
    setActionLoading(true);
    try {
      await eventApi.inviteToTeam(id, teamId, userId);
      setMessage('Invite sent!');
      setSearchQuery('');
      setSearchResults([]);
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to invite.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleInviteAction = async (inviteId, action) => {
    setActionLoading(true);
    try {
      if (action === 'accept') {
        await eventApi.acceptTeamInvite(id, inviteId);
      } else {
        await eventApi.rejectTeamInvite(id, inviteId);
      }
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || `Failed to ${action} invite.`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitTask = async (taskId, task) => {
    let content;
    if (['mcq', 'true_false', 'checkboxes'].includes(task.submissionType)) {
      const selected = submissionSelections[taskId] || [];
      if (selected.length === 0) return;
      content = { selectedOptions: selected };
    } else {
      const code = submissionCodes[taskId] || '';
      if (!code.trim()) return;
      content = { text: code.trim() };
    }
    setActionLoading(true);
    try {
      const { data } = await eventApi.submitTask(id, taskId, content);
      setSubmitResults(prev => ({ ...prev, [taskId]: data.data }));
      setSubmissionCodes(prev => ({ ...prev, [taskId]: '' }));
      setSubmissionSelections(prev => ({ ...prev, [taskId]: [] }));
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Submission failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleForceState = async (status) => {
    setActionLoading(true);
    try {
      await eventApi.updateEventStatus(id, status);
      setMessage(`Event transitioned to ${status}.`);
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'State change failed.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center flex flex-col items-center justify-center">
        <Loader2 size={32} className="animate-spin text-[var(--color-accent)] mb-3" />
        <p className="text-xs text-[var(--color-text-muted)]">Loading event workspace...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="glass-card p-10 text-center max-w-md mx-auto mt-16 border border-[var(--color-border)]">
        <p className="text-xs text-[var(--color-text-muted)]">Event not found or permissions revoked.</p>
        <Link to="/events" className="btn btn-primary text-xs mt-4">Return to Events</Link>
      </div>
    );
  }

  const sections = [
    { key: 'overview', label: 'Overview' },
    { key: 'tasks', label: `Tasks (${tasks.length})` },
    { key: 'leaderboard', label: 'Leaderboard' },
    { key: 'teams', label: event.isTeamEvent ? `Teams (${teams.length})` : 'Registration' },
    ...(isOrganizer ? [{ key: 'organizers', label: 'Organizers' }, { key: 'rewards', label: 'Rewards' }] : []),
  ];

  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* Event Header Banner */}
      <div className="glass-card p-6 sm:p-8 border border-[var(--color-border)] mb-6 relative overflow-hidden shadow-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] border border-[var(--palette-teal)]/30 uppercase tracking-wider">
                {event.category || 'Challenge'}
              </span>
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                event.status === 'ongoing'
                  ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning)] border border-[var(--color-warning)]/30'
                  : event.status === 'completed'
                  ? 'bg-[var(--color-success)]/15 text-[var(--color-success)] border border-[var(--color-success)]/30'
                  : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]'
              }`}>
                {event.status}
              </span>
              {isOrganizer && (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[var(--palette-plum)]/15 text-[var(--palette-plum)] border border-[var(--palette-plum)]/30">
                  Organizer Access
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold font-display text-[var(--color-text-primary)]">{event.title}</h1>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 flex items-center gap-2">
              <Clock size={13} />
              <span>{new Date(event.startDate).toLocaleString()} • Duration: {event.durationHours}h {event.durationMinutes}m</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {event.status === 'upcoming' && (
              <CountdownClock targetDate={event.startDate} label="Starts In" onExpire={fetchEventData} />
            )}
            {event.status === 'ongoing' && (
              <CountdownClock
                targetDate={new Date(new Date(event.startDate).getTime() + (event.durationHours * 3600000) + (event.durationMinutes * 60000))}
                label="Time Remaining"
                onExpire={fetchEventData}
              />
            )}
          </div>
        </div>

        {/* Quick Organizer Controls */}
        {isOrganizer && (
          <div className="mt-5 pt-4 border-t border-[var(--color-border)]/60 flex items-center justify-between flex-wrap gap-2 text-xs">
            <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">Event Controls:</span>
            <div className="flex gap-2">
              {event.status !== 'ongoing' && (
                <button onClick={() => handleForceState('ongoing')} className="btn btn-secondary text-xs py-1 px-3">
                  Start Event Now
                </button>
              )}
              {event.status === 'ongoing' && (
                <button onClick={() => handleForceState('completed')} className="btn btn-secondary text-xs py-1 px-3 text-[var(--color-danger)]">
                  Conclude Event
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {message && (
        <div className="p-3.5 rounded-2xl bg-[var(--palette-teal)]/15 border border-[var(--palette-teal)]/30 text-[var(--palette-teal)] text-xs font-semibold mb-6 flex items-center justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="p-1 hover:opacity-75">✕</button>
        </div>
      )}

      {/* Navigation Pills */}
      <div className="flex gap-1.5 p-1.5 bg-[var(--color-bg-matte)] rounded-2xl border border-[var(--color-border)] mb-6 overflow-x-auto">
        {sections.map(s => {
          const active = activeSection === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              className={`relative py-2 px-4 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                active ? 'text-white' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="event-section-pill"
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-[var(--color-accent)] to-[#528976] shadow-md"
                />
              )}
              <span className="relative z-10">{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* SECTION: Overview */}
      {activeSection === 'overview' && (
        <div className="glass-card p-6 sm:p-8 border border-[var(--color-border)] space-y-6">
          <div>
            <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] mb-2">About this Event</h3>
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-line">
              {event.description || 'No detailed briefing provided for this challenge.'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-4 border-t border-[var(--color-border)]">
            <div className="p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
              <span className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">Format</span>
              <p className="text-xs font-bold text-[var(--color-text-primary)] mt-0.5">
                {event.isTeamEvent ? `Team Challenge (${event.minTeamSize}–${event.maxTeamSize} members)` : 'Individual Solver'}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
              <span className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">Task Engine</span>
              <p className="text-xs font-bold text-[var(--color-text-primary)] mt-0.5 capitalize">
                {event.taskViewMode === 'all' ? 'All Tasks Visible' : 'Sequential Unlock'}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
              <span className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">Your Status</span>
              <p className="text-xs font-bold text-[var(--palette-teal)] mt-0.5">
                {userTeam ? `Enrolled in "${userTeam.name}"` : 'Not Enrolled'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* SECTION: Tasks */}
      {activeSection === 'tasks' && (
        <div className="space-y-4">
          {tasks.length === 0 ? (
            <div className="glass-card p-10 text-center border border-[var(--color-border)]">
              <p className="text-xs text-[var(--color-text-muted)]">No challenge tasks have been unlocked for this event yet.</p>
            </div>
          ) : (
            tasks.map((task, idx) => (
              <div key={task.id} className="glass-card p-5 sm:p-6 border border-[var(--color-border)]">
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div>
                    <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase">Task #{idx + 1}</span>
                    <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">{task.title}</h3>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--palette-teal)]/15 text-[var(--palette-teal)]">
                    {task.basePoints} Pts
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-4">{task.description}</p>

                {/* Submission Form */}
                <div className="pt-3 border-t border-[var(--color-border)] flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Enter answer / flag / solution..."
                    value={submissionCodes[task.id] || ''}
                    onChange={(e) => setSubmissionCodes({ ...submissionCodes, [task.id]: e.target.value })}
                    className="matte-input text-xs flex-1 py-1.5"
                  />
                  <button
                    onClick={() => handleSubmitTask(task.id, task)}
                    disabled={actionLoading || !submissionCodes[task.id]}
                    className="btn btn-primary text-xs py-1.5 px-4 shadow-xs"
                  >
                    Submit
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* SECTION: Leaderboard */}
      {activeSection === 'leaderboard' && (
        <div className="glass-card p-0 overflow-hidden border border-[var(--color-border)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
              <tr>
                <th className="p-3.5 font-bold border-b border-[var(--color-border)]">Rank</th>
                <th className="p-3.5 font-bold border-b border-[var(--color-border)]">Participant / Team</th>
                <th className="p-3.5 font-bold border-b border-[var(--color-border)]">Total Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]/50">
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan="3" className="p-8 text-center text-xs text-[var(--color-text-muted)]">
                    No submissions recorded on the leaderboard yet.
                  </td>
                </tr>
              ) : (
                leaderboard.map((item, idx) => (
                  <tr key={item.teamId || idx} className="hover:bg-[var(--color-bg-secondary)]/50">
                    <td className="p-3.5 font-bold text-[var(--color-text-primary)]">
                      {idx === 0 ? '🥇 #1' : idx === 1 ? '🥈 #2' : idx === 2 ? '🥉 #3' : `#${idx + 1}`}
                    </td>
                    <td className="p-3.5 font-semibold text-[var(--color-text-primary)]">{item.teamName || item.displayName}</td>
                    <td className="p-3.5 font-bold text-[var(--palette-teal)]">{item.score || 0} Pts</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SECTION: Teams & Registration */}
      {activeSection === 'teams' && (
        <div className="space-y-6">
          {!userTeam ? (
            <div className="glass-card p-6 border border-[var(--color-border)]">
              <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] mb-2">Enroll in this Challenge</h3>
              <p className="text-xs text-[var(--color-text-secondary)] mb-4">
                {event.isTeamEvent ? 'Create a squad or accept an invite from an existing team.' : 'Register individually to participate.'}
              </p>
              {event.isTeamEvent ? (
                <form onSubmit={(e) => handleCreateTeam(e, false)} className="flex gap-2 max-w-sm">
                  <input
                    type="text"
                    placeholder="Squad Name"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    className="matte-input text-xs flex-1"
                    required
                  />
                  <button type="submit" disabled={actionLoading || !teamName.trim()} className="btn btn-primary text-xs px-4">
                    Create Squad
                  </button>
                </form>
              ) : (
                <button onClick={(e) => handleCreateTeam(e, true)} disabled={actionLoading} className="btn btn-primary text-xs py-2.5 px-6 shadow-md">
                  Register as Participant
                </button>
              )}
            </div>
          ) : (
            <div className="glass-card p-6 border border-[var(--color-border)]">
              <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] mb-2">Your Team: {userTeam.name}</h3>
              <p className="text-xs text-[var(--color-text-secondary)] mb-4">Members registered in squad:</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {userTeam.members?.map(m => (
                  <span key={m.userId} className="px-3 py-1 rounded-full text-xs font-semibold bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                    {m.displayName || m.user?.displayName}
                  </span>
                ))}
              </div>

              {event.isTeamEvent && (
                <div className="pt-4 border-t border-[var(--color-border)]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">Invite Teammates</h4>
                  <div className="relative max-w-sm">
                    <input
                      type="text"
                      placeholder="Search users to invite..."
                      value={searchQuery}
                      onChange={handleSearchUsers}
                      className="matte-input text-xs"
                    />
                    {searchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 glass-card p-2 border border-[var(--color-border)] shadow-xl z-20 space-y-1">
                        {searchResults.map(u => (
                          <div key={u.id} className="flex items-center justify-between p-1.5 rounded-xl hover:bg-[var(--color-bg-secondary)] text-xs">
                            <span className="font-semibold">{u.displayName}</span>
                            <button
                              onClick={() => handleInvite(userTeam.id, u.id)}
                              disabled={actionLoading}
                              className="btn btn-primary text-[10px] py-1 px-2.5 shadow-xs"
                            >
                              Invite
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

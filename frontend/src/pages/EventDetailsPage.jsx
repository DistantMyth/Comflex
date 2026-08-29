import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { eventApi } from '../api/eventApi';
import { userApi } from '../api/userApi';
import { storeApi } from '../api/storeApi';
import Avatar from '../components/Avatar';

const toLocalISO = (d) => {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const CountdownClock = ({ targetDate, label, onExpire }) => {
  const [timeLeft, setTimeLeft] = useState(0);
  const expiredRef = React.useRef(false);

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

  if (timeLeft === 0) return <div className="text-[var(--color-accent)] font-bold text-center">{label} Reached!</div>;

  return (
    <div className="flex flex-col items-center p-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl w-48 text-center shrink-0">
      <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-1">{label}</span>
      <div className="text-2xl font-mono font-bold font-variant-numeric text-[var(--color-text-primary)]">
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

  // Forms and actions
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
  const [pointAdjustData, setPointAdjustData] = useState({ teamId: '', pointsAdded: 0, reason: '' });
  const [leaderboardHistoryOpen, setLeaderboardHistoryOpen] = useState(null);
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

  // Participant answers
  const [submissionSelections, setSubmissionSelections] = useState({});
  const [submitResults, setSubmitResults] = useState({});

  const fetchEventData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: eventRes } = await eventApi.getEvent(id);
      const ev = eventRes.data;
      setEvent(ev);
      // init edit form
      setEditForm({
        title: ev.title, description: ev.description || '', startDate: toLocalISO(ev.startDate),
        durationHours: ev.durationHours, durationMinutes: ev.durationMinutes,
        taskViewMode: ev.taskViewMode, scoreMode: ev.scoreMode, wrongSubmissionPenalty: ev.wrongSubmissionPenalty,
        targetTags: ev.targetTags?.join(', ') || '',
        isTeamEvent: ev.isTeamEvent || false,
        minTeamSize: ev.minTeamSize || 1, maxTeamSize: ev.maxTeamSize || 1
      });

      const { data: teamsRes } = await eventApi.listTeams(id);
      const fetchedTeams = teamsRes.data;
      setTeams(fetchedTeams);

      const isOrg = ev.creatorId === user?.id || ev.organizers?.some(o => o.userId === user?.id);
      const inTeam = fetchedTeams.some(t => t.members.some(m => m.userId === user?.id));

      if (isOrg || inTeam) {
          try {
             const { data: tasksRes } = await eventApi.listTasks(id);
             setTasks(tasksRes.data);
          } catch(err) { console.error('Failed to fetch tasks', err); }
      }

      try {
         const { data: lbRes } = await eventApi.getLeaderboard(id);
         setLeaderboard(lbRes.data);
      } catch(err) { console.error('Failed to fetch leaderboard', err); }

      try {
         const { data: bData } = await storeApi.getAllBadges();
         setEventBadges(bData.data.filter(b => b.isEventBadge));
      } catch(err) { console.error('Failed to fetch badges', err); }

      if (ev.creatorId === user?.id || ev.organizers?.some(o => o.userId === user?.id) || user?.globalRing === 0) {
        try {
          const [rulesRes, grantsRes] = await Promise.all([
            eventApi.listRewardRules(id),
            eventApi.listRewardGrants(id)
          ]);
          setRewardRules(rulesRes.data);
          setRewardGrants(grantsRes.data);
        } catch(err) { console.error('Failed to fetch reward data', err); }
      }

      try {
         const { data: invRes } = await storeApi.getInventory();
         setOwnedBadges(invRes.data || []);
      } catch(err) { console.error('Failed to fetch inventory', err); }
    } catch {
      console.error('Failed to fetch event data');
    } finally {
      setLoading(false);
    }
  }, [id, user?.id, user?.globalRing]);

  useEffect(() => {
    fetchEventData();
  }, [fetchEventData]);

  const handleCreateTeam = async (e, isIndividual = false) => {
    e?.preventDefault();
    const nameToUse = isIndividual ? user.displayName : teamName;
    if (!nameToUse.trim()) return;
    setActionLoading(true);
    setMessage('');
    try {
      await eventApi.createTeam(id, nameToUse);
      if (!isIndividual) setTeamName('');
      setMessage(isIndividual ? 'Registered successfully!' : 'Team created successfully!');
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to register.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegisterTeam = async () => {
    setActionLoading(true);
    setMessage('');
    try {
      await eventApi.registerTeam(id, userTeam.id);
      setMessage('Team registered for the event successfully!');
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
        setSearchResults(data.data);
      } catch {
        setSearchResults([]);
      }
    } else {
      setSearchResults([]);
    }
  };

  const handleInvite = async (teamId, userId) => {
    setActionLoading(true);
    setMessage('');
    try {
      await eventApi.inviteToTeam(id, teamId, userId);
      setMessage('Invitation sent.');
      setSearchQuery('');
      setSearchResults([]);
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to send invite.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleInviteAction = async (inviteId, action) => {
    setActionLoading(true);
    setMessage('');
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

  const handleUpdateEvent = async (e) => {
    e.preventDefault();
    if (editForm.isTeamEvent && Number(editForm.minTeamSize) > Number(editForm.maxTeamSize)) {
      setMessage('Minimum team size cannot be greater than maximum team size.');
      return;
    }
    setActionLoading(true);
    try {
      const payload = {
        ...editForm,
        startDate: new Date(editForm.startDate).toISOString(),
        targetTags: editForm.targetTags ? editForm.targetTags.split(',').map(t => t.trim()).filter(Boolean) : []
      };
      await eventApi.updateEvent(id, payload);
      setMessage('Event updated successfully!');
      setIsEditing(false);
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to update event.');
    } finally { setActionLoading(false); }
  };

  const handleSearchOrgs = async (e) => {
    const q = e.target.value;
    setSearchOrgQuery(q);
    if (q.length > 1) {
      try {
        const { data } = await userApi.searchUsers(q);
        setSearchOrgResults(data.data);
      } catch { setSearchOrgResults([]); }
    } else { setSearchOrgResults([]); }
  };

  const handleAddOrganizer = async (e) => {
    e.preventDefault();
    if (!selectedOrgId) return;
    setActionLoading(true);
    try {
      await eventApi.addOrganizer(id, { userId: selectedOrgId, permissions: orgPerms });
      setMessage('Organizer added/updated.');
      setSelectedOrgId('');
      setSearchOrgQuery('');
      setSearchOrgResults([]);
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to add organizer.');
    } finally { setActionLoading(false); }
  };

  const buildTaskConfig = (tf) => {
    if (!tf.isAutoEvaluated) return null;
    if (tf.submissionType === 'text' || tf.submissionType === 'url') {
      return { exactText: tf.exactText };
    }
    const options = String(tf.options || '').split('\n').map(s => s.trim()).filter(Boolean);
    return { options, correctOptions: tf.correctOptions || [] };
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    setMessage('');
    setActionLoading(true);
    try {
       const payload = {
         title: taskForm.title,
         description: taskForm.description,
         order: taskForm.order,
         basePoints: taskForm.basePoints,
         submissionType: taskForm.submissionType,
         isAutoEvaluated: taskForm.isAutoEvaluated,
         isDynamicScore: Number(taskForm.decayPercentage) > 0,
         decayPercentage: taskForm.decayPercentage,
         wrongSubmissionPenalty: taskForm.wrongSubmissionPenalty,
         submissionConfig: buildTaskConfig(taskForm)
       };
       await eventApi.createTask(id, payload);
       setMessage('');
       setShowTaskForm(false);
       setTaskForm({ title: '', description: '', order: tasks.length + 2, basePoints: 100, submissionType: 'text', isAutoEvaluated: false, exactText: '', options: '', correctOptions: [], decayPercentage: 0, wrongSubmissionPenalty: 0 });
       fetchEventData();
    } catch(err) {
       setMessage(err.response?.data?.error?.message || 'Failed to create task.');
    } finally { setActionLoading(false); }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    setActionLoading(true);
    try {
      await eventApi.deleteTask(id, taskId);
      fetchEventData();
    } catch(err) {
      alert(err.response?.data?.error?.message || 'Failed to delete task.');
    } finally { setActionLoading(false); }
  };

  const loadSubmissionsForTask = async (taskId) => {
    try {
      const { data } = await eventApi.listSubmissions(id, taskId);
      setTaskSubmissions(prev => ({ ...prev, [taskId]: data.data }));
    } catch(err) { console.error('Failed to load subs', err); }
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
    } catch(err) {
      setMessage(err.response?.data?.error?.message || 'Submission failed.');
    } finally { setActionLoading(false); }
  };

  const handleEvaluateTask = async (subId, status) => {
    setActionLoading(true);
    try {
      await eventApi.evaluateSubmission(id, subId, { status, scoreAwarded: gradeScore });
      setMessage('Evaluated successfully.');
      setGradingSubId(null);
      // reload subs
      if (tasks[selectedTaskIdx]) loadSubmissionsForTask(tasks[selectedTaskIdx].id);
      fetchEventData();
    } catch(err) {
      setMessage(err.response?.data?.error?.message || 'Failed to evaluate.');
    } finally { setActionLoading(false); }
  };

  const handleAdjustPoints = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      await eventApi.adjustTeamPoints(id, pointAdjustData.teamId, { pointsAdded: pointAdjustData.pointsAdded, reason: pointAdjustData.reason });
      setMessage('Points adjusted.');
      setPointAdjustData({ teamId: '', pointsAdded: 0, reason: '' });
      fetchEventData();
    } catch(err) {
      setMessage(err.response?.data?.error?.message || 'Failed to adjust points.');
    } finally { setActionLoading(false); }
  };

  const handleAwardTeam = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const credits = parseInt(rewardData.credits, 10) || 0;
      const badgeIds = rewardData.badgeIds || [];
      if (!credits && badgeIds.length === 0) {
        throw new Error('Must award either credits or a badge.');
      }
      await eventApi.awardTeamRewards(id, rewardData.teamId, { credits, badgeIds });
      setMessage('Rewards awarded to team members!');
      setRewardData({ teamId: '', credits: 0, badgeIds: [] });
      if (user?.globalRing !== 0) refreshProfile(); // pocket-funded — balance changed
      fetchEventData();
    } catch(err) {
      setMessage(err.response?.data?.error?.message || 'Failed to award rewards.');
    } finally { setActionLoading(false); }
  };

  const toggleRewardBadge = (badgeId) => {
    setRewardData(prev => {
      const ids = prev.badgeIds || [];
      return { ...prev, badgeIds: ids.includes(badgeId) ? ids.filter(x => x !== badgeId) : [...ids, badgeId] };
    });
  };

  const resetRuleForm = () => setRuleForm({ trigger: 'submission', rank: 1, creditsPerUser: 0, badgeIds: [], maxUses: '' });

  const toggleRuleBadge = (badgeId) => {
    setRuleForm(prev => {
      const has = prev.badgeIds.includes(badgeId);
      return { ...prev, badgeIds: has ? prev.badgeIds.filter(b => b !== badgeId) : [...prev.badgeIds, badgeId] };
    });
  };

  const handleCreateRule = async (e) => {
    e.preventDefault();
    setMessage('');
    setActionLoading(true);
    try {
      const maxUses = ruleForm.maxUses === '' || ruleForm.maxUses === null ? null : parseInt(ruleForm.maxUses, 10);
      await eventApi.createRewardRule(id, {
        trigger: ruleForm.trigger,
        rank: ruleForm.trigger === 'rank' ? ruleForm.rank : undefined,
        creditsPerUser: parseInt(ruleForm.creditsPerUser, 10) || 0,
        badgeIds: ruleForm.badgeIds,
        maxUses
      });
      setMessage('Reward rule created.');
      setShowRuleForm(false);
      resetRuleForm();
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to create reward rule.');
    } finally { setActionLoading(false); }
  };

  const handleToggleRule = async (rule) => {
    try {
      await eventApi.updateRewardRule(id, rule.id, { enabled: !rule.enabled });
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to update rule.');
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!window.confirm('Delete this reward rule? Past payouts stay in the grant ledger.')) return;
    try {
      await eventApi.deleteRewardRule(id, ruleId);
      fetchEventData();
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to delete rule.');
    }
  };

  const handleDistributeRewards = async () => {
    if (!window.confirm('Distribute rewards to ranked teams now? Each rank rule fires once (admins may re-run).')) return;
    setActionLoading(true);
    setMessage('');
    try {
      const res = await eventApi.distributeRewards(id);
      const list = res.data?.data?.distributed || [];
      const granted = list.filter(r => !r.skipped).length;
      const skipped = list.filter(r => r.skipped);
      setMessage(granted > 0
        ? `Rewards distributed — ${granted} rule(s) paid${skipped.length ? `, ${skipped.length} skipped.` : '.'}`
        : (skipped.length ? `No rewards distributed: ${skipped.map(r => r.skipped).join('; ')}.` : 'No rules matched any team.'));
      fetchEventData();
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to distribute automated rewards.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleForceState = async (status) => {
    setActionLoading(true);
    try {
      await eventApi.updateEvent(id, { status });
      fetchEventData();
    } catch(err) {
      console.error(err);
      setMessage('Failed to change event state.');
    } finally { setActionLoading(false); }
  };

  if (loading) {
    return <div className="p-8">Loading event...</div>;
  }

  if (!event) {
    return <div className="p-8">Event not found.</div>;
  }

  const userTeam = teams.find(t => t.members.some(m => m.userId === user.id));
  const pendingInvites = teams.flatMap(t => t.invites || []).filter(i => i.invitedUserId === user.id && i.status === 'pending');

  const isCreator = event.creatorId === user.id;
  const isOrganizer = isCreator || event.organizers?.some(o => o.userId === user.id);
  const isAdminUser = user?.globalRing === 0;
  const mayTargetGroups = isAdminUser || user?.canCreateEvents === true;
  const submissionRules = rewardRules.filter(r => r.trigger === 'submission');
  const rankRules = rewardRules.filter(r => r.trigger === 'rank');
  const badgeMap = Object.fromEntries(eventBadges.map(b => [b.id, b]));
  const selectableBadges = isAdminUser ? eventBadges : eventBadges.filter(b => ownedBadges.some(o => o.badgeId === b.id));

  const renderSubmitWidget = (task) => {
    if (task.submissionType === 'mcq') {
      const opts = task.submissionConfig?.options || [];
      const sel = submissionSelections[task.id] || [];
      return (
        <div className="space-y-2">
          {opts.map(opt => (
            <label key={opt} className="flex items-center gap-2 text-sm bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 cursor-pointer">
              <input type="radio" name={`q-${task.id}`} checked={sel[0] === opt} onChange={() => setSubmissionSelections({ ...submissionSelections, [task.id]: [opt] })} className="accent-[var(--color-accent)]" />
              {opt}
            </label>
          ))}
          <button onClick={() => handleSubmitTask(task.id, task)} disabled={actionLoading || sel.length === 0} className="btn btn-primary text-sm px-4">Submit</button>
        </div>
      );
    }
    if (task.submissionType === 'true_false') {
      const sel = submissionSelections[task.id] || [];
      return (
        <div className="space-y-2">
          {['True', 'False'].map(opt => (
            <label key={opt} className="flex items-center gap-2 text-sm bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 cursor-pointer">
              <input type="radio" name={`q-${task.id}`} checked={sel[0] === opt} onChange={() => setSubmissionSelections({ ...submissionSelections, [task.id]: [opt] })} className="accent-[var(--color-accent)]" />
              {opt}
            </label>
          ))}
          <button onClick={() => handleSubmitTask(task.id, task)} disabled={actionLoading || sel.length === 0} className="btn btn-primary text-sm px-4">Submit</button>
        </div>
      );
    }
    if (task.submissionType === 'checkboxes') {
      const opts = task.submissionConfig?.options || [];
      const sel = submissionSelections[task.id] || [];
      return (
        <div className="space-y-2">
          {opts.map(opt => (
            <label key={opt} className="flex items-center gap-2 text-sm bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 cursor-pointer">
              <input type="checkbox" checked={sel.includes(opt)} onChange={() => setSubmissionSelections({ ...submissionSelections, [task.id]: sel.includes(opt) ? sel.filter(x => x !== opt) : [...sel, opt] })} className="accent-[var(--color-accent)]" />
              {opt}
            </label>
          ))}
          <button onClick={() => handleSubmitTask(task.id, task)} disabled={actionLoading || sel.length === 0} className="btn btn-primary text-sm px-4">Submit</button>
        </div>
      );
    }
    return (
      <div className="flex gap-2">
        <input
          type="text"
          value={submissionCodes[task.id] || ''}
          onChange={e => setSubmissionCodes({ ...submissionCodes, [task.id]: e.target.value })}
          placeholder={task.submissionType === 'file' ? 'Upload to Drive, then paste the shareable link...' : 'Type/paste your answer...'}
          className="flex-1 text-sm bg-[var(--color-bg-primary)]"
        />
        <button onClick={() => handleSubmitTask(task.id, task)} disabled={actionLoading || !(submissionCodes[task.id] || '').trim()} className="btn btn-primary text-sm shrink-0 px-4">Submit</button>
      </div>
    );
  };

  const now = new Date();
  const start = new Date(event.startDate);
  const end = new Date(start.getTime() + (event.durationHours * 3600000) + (event.durationMinutes * 60000));

  const isOngoing = event.status === 'ongoing' || (event.status !== 'completed' && event.autoStart && now >= start && now < end);
  const isCompleted = event.status === 'completed' || (event.status !== 'ongoing' && event.autoStart && now >= end);
  const isUpcoming = !isOngoing && !isCompleted;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-8 shadow-sm relative">
           <div className="flex justify-between items-start mb-2">
             <h2 className="text-3xl font-bold gradient-text">{event.title}</h2>
             {isOrganizer && (
               <button onClick={() => setIsEditing(!isEditing)} className="btn btn-secondary text-sm px-3 py-1.5">
                 {isEditing ? 'Cancel Edit' : 'Edit Details'}
               </button>
             )}
           </div>
           <p className="text-sm text-[var(--color-text-secondary)] mb-6">
             {new Date(event.startDate).toLocaleString()} • {event.category}
           </p>

           <div className="flex flex-col md:flex-row gap-6 mb-8 mt-4 justify-between items-start md:items-center">
             {isUpcoming && <CountdownClock targetDate={start} label="Time until Start" onExpire={fetchEventData} />}
             {isOngoing && <CountdownClock targetDate={end} label="Time Remaining" onExpire={fetchEventData} />}
             {isCompleted && <div className="text-xl font-bold text-[var(--color-text-muted)] py-4">Event has Ended.</div>}

             {isOrganizer && (
               <div className="flex gap-2">
                 {(isUpcoming || isOngoing) && (
                    <button onClick={() => handleForceState(isUpcoming ? 'ongoing' : 'completed')} disabled={actionLoading} className="btn btn-primary">
                      {isUpcoming ? 'Force Start Event' : 'End Event Early'}
                    </button>
                 )}
               </div>
             )}
           </div>

           {isEditing ? (
             <form onSubmit={handleUpdateEvent} className="p-4 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl space-y-4">
                {message && <div className="text-[var(--color-accent)] text-sm font-bold">{message}</div>}
                <div>
                  <label className="block text-sm mb-1">Title</label>
                  <input type="text" value={editForm.title} onChange={e => setEditForm({...editForm, title: e.target.value})} className="w-full text-sm" required />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm mb-1">Start Date</label>
                    <input type="datetime-local" value={editForm.startDate} onChange={e => setEditForm({...editForm, startDate: e.target.value})} className="w-full text-sm" required />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Duration</label>
                    <div className="flex gap-2">
                      <input type="number" min="0" value={editForm.durationHours} onChange={e => setEditForm({...editForm, durationHours: Number(e.target.value)})} className="w-full text-sm" placeholder="Hrs" />
                      <input type="number" min="0" max="59" value={editForm.durationMinutes} onChange={e => setEditForm({...editForm, durationMinutes: Number(e.target.value)})} className="w-full text-sm" placeholder="Mins" />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm mb-1">Target Tags (Comma separated)</label>
                  {mayTargetGroups ? (
                    <input type="text" value={editForm.targetTags} onChange={e => setEditForm({...editForm, targetTags: e.target.value})} className="w-full text-sm" placeholder="e.g. cohort-2029" />
                  ) : (
                    <div className="text-xs text-[var(--color-warning)] bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20 rounded-lg px-3 py-2">
                      🔒 Invite-only event — cohort targeting is restricted to admins. This event spreads via the invite link and team invitations only.
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4 p-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editForm.isTeamEvent} onChange={e => setEditForm({...editForm, isTeamEvent: e.target.checked})} className="rounded text-[var(--color-accent)]" />
                    Is Team Event?
                  </label>
                  {editForm.isTeamEvent && (
                    <>
                      <div className="flex items-center gap-2">
                        <label className="text-sm">Min:</label>
                        <input type="number" min="1" value={editForm.minTeamSize} onChange={e => setEditForm({...editForm, minTeamSize: Number(e.target.value)})} className="w-16 text-sm" />
                       </div>
                       <div className="flex items-center gap-2">
                        <label className="text-sm">Max:</label>
                        <input type="number" min="1" value={editForm.maxTeamSize} onChange={e => setEditForm({...editForm, maxTeamSize: Number(e.target.value)})} className="w-16 text-sm" />
                       </div>
                    </>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm mb-1">Task View Mode</label>
                    <select value={editForm.taskViewMode} onChange={e => setEditForm({...editForm, taskViewMode: e.target.value})} className="w-full text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-2">
                      <option value="all">All At Once</option>
                      <option value="dynamic">Dynamic Unlocking</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm mb-1">Description</label>
                  <textarea value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} className="w-full text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] p-2 rounded-lg" rows="4" />
                </div>

                <button type="submit" disabled={actionLoading} className="btn btn-primary w-full">Save Changes</button>
             </form>
           ) : (
             <div className="p-4 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl">
               <h4 className="font-semibold mb-2">Event Details</h4>
               <p className="text-[var(--color-text-primary)] whitespace-pre-wrap">{event.description || 'No description provided.'}</p>
             </div>
           )}
        </div>

        {isCreator && (
          <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-6 shadow-sm">
             <h3 className="text-xl font-bold mb-4">Manage Organizers</h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="space-y-4">
                 <h4 className="text-sm font-bold text-[var(--color-text-secondary)] uppercase">Add / Edit Organizer</h4>
                 <form onSubmit={handleAddOrganizer} className="bg-[var(--color-bg-primary)] p-4 border border-[var(--color-border)] rounded-xl space-y-4">
                   <div>
                     <label className="block text-sm mb-2">Search User</label>
                     <input type="text" value={searchOrgQuery} onChange={handleSearchOrgs} placeholder="Search by name/email..." className="w-full text-sm" />
                     {searchOrgResults.length > 0 && (
                       <div className="mt-2 text-sm bg-[var(--color-bg-card)] rounded-lg border border-[var(--color-border)] max-h-32 overflow-y-auto">
                         {searchOrgResults.map(u => (
                           <div key={u.id} onClick={() => { setSelectedOrgId(u.id); setSearchOrgQuery(u.displayName); setSearchOrgResults([]); }}
                                className="p-2 hover:bg-[var(--color-bg-secondary)] cursor-pointer break-all">
                             {u.displayName} ({u.email})
                           </div>
                         ))}
                       </div>
                     )}
                   </div>
                   <div className="space-y-2">
                     <label className="block text-sm font-semibold mb-1">Permissions</label>
                     <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={orgPerms.canEditDetails} onChange={e => setOrgPerms({...orgPerms, canEditDetails: e.target.checked})} className="rounded text-[var(--color-accent)]" /> Edit Details</label>
                     <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={orgPerms.canChangeTiming} onChange={e => setOrgPerms({...orgPerms, canChangeTiming: e.target.checked})} className="rounded text-[var(--color-accent)]" /> Change Timing</label>
                     <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={orgPerms.canChangeDurationWhileRunning} onChange={e => setOrgPerms({...orgPerms, canChangeDurationWhileRunning: e.target.checked})} className="rounded text-[var(--color-accent)]" /> Change Duration (Running)</label>
                     <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={orgPerms.canChangePenalty} onChange={e => setOrgPerms({...orgPerms, canChangePenalty: e.target.checked})} className="rounded text-[var(--color-accent)]" /> Change Penalty</label>
                   </div>
                   <button type="submit" disabled={!selectedOrgId || actionLoading} className="btn btn-primary w-full text-sm">Update Permissions</button>
                 </form>
               </div>

               <div>
                  <h4 className="text-sm font-bold text-[var(--color-text-secondary)] uppercase mb-4">Current Organizers</h4>
                  {event.organizers?.length > 0 ? (
                    <div className="space-y-3">
                      {event.organizers.map(org => (
                        <div key={org.id} className="p-3 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Avatar src={org.user.avatarUrl} name={org.user.displayName} className="w-8 h-8 rounded-full" />
                            <div>
                              <div className="font-bold text-sm">{org.user.displayName}</div>
                              <div className="text-xs text-[var(--color-text-secondary)]">
                                {[
                                  org.permissions?.canEditDetails && 'Edit',
                                  org.permissions?.canChangeTiming && 'Timing',
                                  org.permissions?.canChangeDurationWhileRunning && 'Duration',
                                  org.permissions?.canChangePenalty && 'Penalty'
                                ].filter(Boolean).join(', ') || 'No specific rights'}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--color-text-muted)] italic">No organizers appointed yet.</div>
                  )}
               </div>
             </div>
          </div>
        )}

        {event.isTeamEvent ? (
          <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-6 shadow-sm">
            <h3 className="text-xl font-bold mb-4">Team Details</h3>
            {!isUpcoming && <div className="mb-4 text-sm font-semibold text-[var(--color-warning)]">Team formation is closed. The event has started.</div>}

            {message && <div className="text-sm font-semibold mb-4 text-[var(--color-accent)]">{message}</div>}

            {userTeam ? (
              <div className="space-y-4">
                <div className="p-5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl shadow-sm">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="font-bold text-2xl">{userTeam.name}</h4>
                      <p className="text-[var(--color-text-secondary)] text-sm">
                        Leader: <span className="text-[var(--color-text-primary)] font-medium">{userTeam.leader.displayName}</span>
                      </p>
                    </div>
                  </div>

                  <h5 className="font-semibold text-sm mb-3">
                    Members <span className="font-normal text-[var(--color-text-secondary)]">({userTeam.members.length} enrolled — Min {event.minTeamSize} / Max {event.maxTeamSize})</span>:
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    {userTeam.members.map(m => (
                      <div key={m.userId} className="flex items-center gap-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] p-3 rounded-xl">
                        <Avatar src={m.user.avatarUrl} name={m.user.displayName} alt={m.user.displayName} className="w-8 h-8 rounded-full" />
                        <span className="font-medium text-sm">{m.user.displayName}</span>
                      </div>
                    ))}
                  </div>

                  {(userTeam.invites?.filter(i => i.status === 'pending').length > 0) && (
                    <div className="mb-4 pt-4 border-t border-[var(--color-border)]">
                       <h5 className="font-semibold text-xs text-[var(--color-text-secondary)] uppercase mb-2">Pending Invites</h5>
                       <ul className="space-y-2">
                         {userTeam.invites.filter(i => i.status === 'pending').map(inv => (
                           <li key={inv.id} className="flex items-center justify-between text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] px-3 py-2 rounded-lg">
                             <div className="flex items-center gap-2">
                               <Avatar src={inv.invitedUser.avatarUrl} name={inv.invitedUser.displayName} className="w-5 h-5 rounded-full" />
                               <span className="text-[var(--color-text-primary)] font-medium">{inv.invitedUser.displayName}</span>
                             </div>
                             <span className="text-xs text-[var(--color-text-muted)] italic">Waiting...</span>
                           </li>
                         ))}
                       </ul>
                    </div>
                  )}

                  {isUpcoming && userTeam.leaderId === user.id && userTeam.members.length < event.maxTeamSize && (
                    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                      <h5 className="font-semibold text-sm mb-3">Invite New Members</h5>
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={handleSearchUsers}
                        placeholder="Search users to invite by name or email..."
                        className="w-full text-sm mb-3 bg-[var(--color-bg-card)]"
                      />
                      {searchResults.length > 0 ? (
                        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl p-2 max-h-48 overflow-y-auto">
                          {searchResults.filter(u => {
                            const isMember = userTeam.members.some(m => m.userId === u.id);
                            const isInvited = userTeam.invites?.some(i => i.invitedUserId === u.id);
                            const isEligible = !event.targetTags || event.targetTags.length === 0 || event.targetTags.some(tag => (u.cohortTags || []).includes(tag));
                            return !isMember && !isInvited && isEligible;
                          }).map(u => (
                            <div key={u.id} className="flex items-center justify-between p-3 hover:bg-[var(--color-bg-secondary)] rounded-lg transition-colors">
                              <div className="flex items-center gap-3">                                 <Avatar src={u.avatarUrl} name={u.displayName} className="w-8 h-8 rounded-full" />
                                <div>
                                  <div className="font-medium text-sm">{u.displayName}</div>
                                  <div className="text-xs text-[var(--color-text-muted)]">{u.username || u.email}</div>
                                </div>
                              </div>
                              <button
                                onClick={() => handleInvite(userTeam.id, u.id)}
                                disabled={actionLoading}
                                className="text-xs btn btn-secondary px-3 py-1.5"
                              >
                                Invite to Team
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : searchQuery.length > 1 ? (
                        <p className="text-sm text-[var(--color-text-muted)] pl-1">No matching users found capable of being invited.</p>
                      ) : null}
                    </div>
                  )}
                  {userTeam.status === 'pending' && userTeam.leaderId === user.id && (
                    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                      <h5 className="font-semibold text-sm mb-3">Finalize Registration</h5>
                      <p className="text-xs text-[var(--color-text-muted)] mb-3">Your team is currently pending. Once you meet the required minimum size of {event.minTeamSize}, you can register.</p>
                      <button onClick={handleRegisterTeam} disabled={actionLoading || userTeam.members.length < event.minTeamSize} className="btn btn-primary px-4 py-2 text-sm text-center w-full">
                        Register Team for Event
                      </button>
                    </div>
                  )}
                  {userTeam.status === 'pending' && userTeam.leaderId !== user.id && (
                    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                       <p className="text-xs text-[var(--color-text-muted)] italic text-center">Your team leader must finalize the registration once the team has at least {event.minTeamSize} members.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {pendingInvites.length > 0 && (
                  <div className="p-5 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 rounded-xl shadow-sm">
                                        <h5 className="font-bold text-lg mb-4 text-[var(--color-accent)]">You Have Pending Invites!</h5>
                    <div className="space-y-3">
                       {pendingInvites.map(invite => {
                         const targetTeam = teams.find(t => t.id === invite.teamId);
                         return (
                           <div key={invite.id} className="flex flex-col sm:flex-row sm:items-center justify-between bg-[var(--color-bg-primary)] border border-[var(--color-accent)]/20 p-4 rounded-xl gap-4">
                             <div className="text-sm">
                               <div className="font-bold text-base mb-1">{targetTeam?.name}</div>
                               <div className="text-[var(--color-text-secondary)]">Invited by <strong>{targetTeam?.leader?.displayName || 'Team Leader'}</strong></div>
                               {targetTeam?.members?.length > 0 && (
                                 <div className="mt-2 text-xs text-[var(--color-text-secondary)]">
                                   <span className="font-semibold">Current Members:</span> {targetTeam.members.map(m => m.user.displayName).join(', ')}
                                 </div>
                               )}
                             </div>
                             <div className="flex gap-2 shrink-0">
                               <button
                                 onClick={() => handleInviteAction(invite.id, 'accept')}
                                 disabled={actionLoading}
                                 className="btn btn-primary text-sm px-4 py-2"
                               >
                                 Accept Invite
                               </button>
                               <button
                                 onClick={() => handleInviteAction(invite.id, 'reject')}
                                 disabled={actionLoading}
                                 className="btn btn-secondary text-[var(--color-danger)] text-sm px-4 py-2"
                               >
                                 Reject
                               </button>
                             </div>
                           </div>
                         );
                       })}
                    </div>
                  </div>
                )}

                {event.inviteMode === 'invite_only' ? (
                  <div className="p-6 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-primary)] shadow-sm">
                    <h4 className="font-bold text-lg mb-2">🔒 Invite-Only Event</h4>
                    <p className="text-sm text-[var(--color-text-secondary)]">This event accepts participants only via organizer invite links or team invitations. Ask the organizer for an invite link.</p>
                  </div>
                ) : (
                  <div className="p-6 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-primary)] shadow-sm">
                    <h4 className="font-bold text-lg mb-1">Create a New Team</h4>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-4">Start your own team to compete in this event and invite up to {event.maxTeamSize - 1} other members.</p>
                    <form onSubmit={handleCreateTeam} className="flex gap-3">
                      <input
                        type="text"
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        placeholder="Enter a unique team name..."
                        className="flex-1 text-sm bg-[var(--color-bg-card)]"
                        required
                      />
                      <button type="submit" disabled={actionLoading || !teamName.trim()} className="btn btn-primary px-6">
                        Create Team
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-6 shadow-sm mt-6">
            <h3 className="text-xl font-bold mb-4">Event Registration</h3>
            {userTeam ? (
              <div className="text-sm font-semibold text-[var(--color-success)] px-4 py-3 bg-[var(--color-success)]/10 rounded-lg">You are registered for this event.</div>
            ) : event.inviteMode === 'invite_only' ? (
              <div className="text-sm text-[var(--color-text-secondary)] px-4 py-3 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg">
                🔒 This event is invite-only. Join via an organizer invite link.
              </div>
            ) : (
              <button onClick={(e) => handleCreateTeam(e, true)} disabled={actionLoading} className="btn btn-primary px-6">
                Register for Event
              </button>
            )}
          </div>
        )}

        {/* TASKS SECTION */}
        {(isOrganizer || (userTeam && userTeam.status === 'registered' && (isOngoing || isCompleted))) && (
          <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-6 shadow-sm mt-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold gradient-text">Event Tasks</h3>
              {isOrganizer && !isCompleted && (
                <button onClick={() => { setShowTaskForm(!showTaskForm); setMessage(''); }} className="btn btn-secondary text-sm px-3 py-1.5">
                   {showTaskForm ? 'Cancel Task' : 'Create Task'}
                </button>
              )}
            </div>

            {isOrganizer && showTaskForm && (
                <form onSubmit={handleCreateTask} className="mb-6 p-4 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl space-y-4">
                   <div className="flex justify-between items-center">
                     <h4 className="font-bold text-sm text-[var(--color-text-secondary)] uppercase">New Task</h4>
                     <button type="button" onClick={() => setShowTaskForm(false)} className="text-[var(--color-text-muted)] hover:text-white px-2">✕</button>
                   </div>
                   {message && <div className="p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 text-[var(--color-danger)] rounded-lg text-sm font-semibold">{message}</div>}
                   <div>
                     <label className="block text-sm mb-1">Task Title</label>
                     <input type="text" value={taskForm.title} onChange={e => setTaskForm({...taskForm, title: e.target.value})} className="w-full text-sm" required />
                   </div>
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div>
                       <label className="block text-sm mb-1">Base Points</label>
                       <input type="number" min="0" value={taskForm.basePoints} onChange={e => setTaskForm({...taskForm, basePoints: Number(e.target.value)})} className="w-full text-sm" required />
                     </div>
                     <div>
                        <label className="block text-sm mb-1">Format</label>
                        <select
                          value={taskForm.submissionType}
                          onChange={e => setTaskForm({ ...taskForm, submissionType: e.target.value, isAutoEvaluated: e.target.value === 'file' ? false : taskForm.isAutoEvaluated, exactText: '', options: '', correctOptions: [] })}
                          className="w-full text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] p-2 rounded-lg"
                        >
                          <option value="text">Text (exact match)</option>
                          <option value="url">URL / Flag Link</option>
                          <option value="mcq">Multiple Choice</option>
                          <option value="true_false">True / False</option>
                          <option value="checkboxes">Checkboxes (multi-select)</option>
                          <option value="file">File (Drive Link)</option>
                        </select>
                     </div>
                     <div>
                        <label className="block text-sm mb-1">Order</label>
                        <input type="number" min="1" value={taskForm.order} onChange={e => setTaskForm({...taskForm, order: Number(e.target.value)})} className="w-full text-sm" required />
                     </div>
                    </div>
                    <div className="flex items-center gap-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] p-3 rounded-xl">
                       <label className="flex items-center gap-2 text-sm">
                         <input type="checkbox" disabled={taskForm.submissionType === 'file'} checked={taskForm.isAutoEvaluated} onChange={e => setTaskForm({...taskForm, isAutoEvaluated: e.target.checked})} className="rounded text-[var(--color-accent)]" />
                         Auto Evaluate (specific answer key)
                       </label>
                       <span className="text-xs text-[var(--color-text-muted)] italic">
                         {taskForm.isAutoEvaluated
                            ? "Correct answers pay out automatically (and fire your automatic reward rules)."
                            : "Manual grading by an organizer (correct answers can also fire reward rules)."}
                       </span>
                    </div>
                    {taskForm.isAutoEvaluated && taskForm.submissionType === 'text' && (
                      <div>
                        <label className="block text-sm mb-1">Expected Answer (Exact Text)</label>
                        <input type="text" value={taskForm.exactText} onChange={e => setTaskForm({...taskForm, exactText: e.target.value})} className="w-full text-sm font-mono text-[var(--color-accent)]" required />
                      </div>
                    )}
                    {taskForm.isAutoEvaluated && taskForm.submissionType === 'url' && (
                      <div>
                        <label className="block text-sm mb-1">Expected Link / Flag (case-insensitive, protocol ignored)</label>
                        <input type="text" value={taskForm.exactText} onChange={e => setTaskForm({...taskForm, exactText: e.target.value})} className="w-full text-sm font-mono text-[var(--color-accent)]" placeholder="e.g. example.com/flag or myflag123" required />
                      </div>
                    )}
                    {(taskForm.isAutoEvaluated && (taskForm.submissionType === 'mcq' || taskForm.submissionType === 'checkboxes')) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm mb-1">Options (one per line)</label>
                          <textarea value={taskForm.options} onChange={e => setTaskForm({...taskForm, options: e.target.value})} className="w-full text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] p-2 rounded-lg font-mono" rows="5" placeholder={"Option A\nOption B\nOption C"} required />
                        </div>
                        <div>
                          <label className="block text-sm mb-1">{taskForm.submissionType === 'mcq' ? 'Correct Option' : 'Correct Options (select all)'}</label>
                          <div className="space-y-2 max-h-40 overflow-y-auto bg-[var(--color-bg-card)] border border-[var(--color-border)] p-2 rounded-lg">
                            {taskForm.options.split('\n').map(s => s.trim()).filter(Boolean).map(opt => (
                              <label key={opt} className="flex items-center gap-2 text-sm px-2 py-1 hover:bg-[var(--color-bg-primary)] rounded cursor-pointer">
                                <input
                                  type={taskForm.submissionType === 'mcq' ? 'radio' : 'checkbox'}
                                  name="correct-key"
                                  checked={taskForm.submissionType === 'mcq'
                                    ? taskForm.correctOptions[0] === opt
                                    : taskForm.correctOptions.includes(opt)}
                                  onChange={() => setTaskForm(prev => ({
                                    ...prev,
                                    correctOptions: prev.submissionType === 'mcq'
                                      ? [opt]
                                      : prev.correctOptions.includes(opt)
                                        ? prev.correctOptions.filter(x => x !== opt)
                                        : [...prev.correctOptions, opt]
                                  }))}
                                  className="accent-[var(--color-accent)]"
                                />
                                {opt}
                              </label>
                            ))}
                            {!taskForm.options.trim() && <p className="text-xs text-[var(--color-text-muted)] italic px-2">Add options on the left first.</p>}
                          </div>
                        </div>
                      </div>
                    )}
                    {taskForm.isAutoEvaluated && taskForm.submissionType === 'true_false' && (
                      <div>
                        <label className="block text-sm mb-1">Correct Answer</label>
                        <select
                          value={taskForm.correctOptions[0] || ''}
                          onChange={e => setTaskForm({...taskForm, correctOptions: [e.target.value]})}
                          className="w-full text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] p-2 rounded-lg"
                          required
                        >
                          <option value="">Select...</option>
                          <option value="True">True</option>
                          <option value="False">False</option>
                        </select>
                      </div>
                    )}

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div>
                       <label className="block text-sm mb-1">Time Degradation (% / minute)</label>
                       <input type="number" min="0" step="0.1" value={taskForm.decayPercentage} onChange={e => setTaskForm({...taskForm, decayPercentage: Number(e.target.value)})} className="w-full text-sm" />
                       <span className="text-xs text-[var(--color-text-muted)] mt-1 block">e.g., 1 means 1% loss per minute. Points degradation will be automatically calculated after assessment.</span>
                     </div>
                     <div>
                       <label className="block text-sm mb-1">Wrong Penalty (Points deducted)</label>
                       <input type="number" min="0" value={taskForm.wrongSubmissionPenalty} onChange={e => setTaskForm({...taskForm, wrongSubmissionPenalty: Number(e.target.value)})} className="w-full text-sm" />
                     </div>
                   </div>

                   <div>
                     <label className="block text-sm mb-1">Task Description / Instructions</label>
                     <textarea value={taskForm.description} onChange={e => setTaskForm({...taskForm, description: e.target.value})} className="w-full text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] p-2 rounded-lg" rows="4" required />
                   </div>
                   <button type="submit" disabled={actionLoading} className="btn btn-primary w-full text-sm">Create Task</button>
                </form>
            )}

            {tasks.length === 0 ? (
               <div className="text-sm text-[var(--color-text-secondary)] italic">No tasks available yet.</div>
            ) : (
               <div className="space-y-4">
                 {tasks.map((task, idx) => (
                   <div key={task.id} className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] p-4 rounded-xl">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-bold text-lg">{task.order}. {task.title}</h4>
                        <div className="flex items-center gap-3">
                          <div className="text-sm font-mono font-bold text-[var(--color-accent)]">{task.basePoints} pts</div>
                          {isOrganizer && (
                             <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                                className="text-xs px-2 py-1 bg-[var(--color-danger)]/10 text-[var(--color-danger)] rounded hover:bg-[var(--color-danger)] hover:text-white transition-colors"
                             >
                                Delete
                             </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap mb-4">{task.description}</p>

                      {userTeam && !isOrganizer && isOngoing && (
                        <div className="bg-[var(--color-bg-card)] p-3 rounded-lg border border-[var(--color-border)] mt-4">
                           <h5 className="text-xs font-bold uppercase mb-2">Submit Answer ({task.submissionType})</h5>
                           {submitResults[task.id] && (
                             <div className={`mb-3 text-sm font-semibold rounded-lg px-3 py-2 ${
                               submitResults[task.id].status === 'correct' ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                               : submitResults[task.id].status === 'wrong' ? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
                               : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
                             }`}>
                               {submitResults[task.id].status === 'correct' ? '✓ Correct!' : submitResults[task.id].status === 'wrong' ? '✗ Incorrect — you can try again.' : '⏳ Pending manual grading.'}
                               {submitResults[task.id].scoreAwarded > 0 && <span className="ml-2">+{submitResults[task.id].scoreAwarded} pts</span>}
                               {submitResults[task.id].status === 'correct' && submitResults[task.id].rewards?.length > 0 && (
                                 <div className="mt-2 text-xs font-normal flex flex-wrap gap-2">
                                   {submitResults[task.id].rewards.map(r => (
                                     <span key={r.ruleId} className="inline-flex items-center gap-1 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-full px-2 py-0.5">
                                       🎁 {r.name}
                                       {r.status === 'granted' && (
                                         <>
                                           {r.creditsPerUser > 0 && <span>+{r.creditsPerUser} cr</span>}
                                           {r.badgeIds?.length > 0 && <span>+{r.badgeIds.length} badge{r.badgeIds.length > 1 ? 's' : ''}</span>}
                                         </>
                                       )}
                                       {r.status === 'skipped' && <span className="text-[var(--color-warning)]">(reward skipped)</span>}
                                     </span>
                                   ))}
                                 </div>
                               )}
                             </div>
                           )}
                           {renderSubmitWidget(task)}
                        </div>
                      )}

                      {isOrganizer && (
                        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                           <button onClick={() => { setSelectedTaskIdx(idx); loadSubmissionsForTask(task.id); }} className="text-xs font-bold text-[var(--color-accent)] hover:underline uppercase">
                             &darr; View Submissions
                           </button>
                           {selectedTaskIdx === idx && taskSubmissions[task.id] && (
                             <div className="mt-4 space-y-2">
                               {taskSubmissions[task.id].length === 0 ? (
                                 <p className="text-xs text-[var(--color-text-muted)]">No submissions yet.</p>
                               ) : (
                                 taskSubmissions[task.id].map(sub => (
                                   <div key={sub.id} className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-3 rounded-lg text-sm flex flex-col md:flex-row justify-between items-start gap-4">
                                      <div className="flex-1">
                                        <div className="font-bold">{sub.team.name}</div>
                                        <div className="text-[var(--color-text-secondary)] font-mono mt-1 break-all bg-[var(--color-bg-primary)] p-2 rounded">
                                          {sub.content?.text || JSON.stringify(sub.content)}
                                        </div>
                                        <div className="text-xs text-[var(--color-text-muted)] mt-1">Status: <span className="font-bold capitalize">{sub.status}</span></div>
                                      </div>

                                      {!task.isAutoEvaluated && sub.status === 'pending' && (
                                        <div className="flex flex-col gap-2 w-full md:w-32 shrink-0">
                                          {gradingSubId !== sub.id ? (
                                             <button onClick={() => { setGradingSubId(sub.id); setGradeScore(task.basePoints); }} className="btn btn-secondary text-xs w-full">Grade</button>
                                          ) : (
                                             <div className="flex flex-col gap-1 w-full">
                                               <input type="number" min="0" value={gradeScore} onChange={e => setGradeScore(Number(e.target.value))} className="text-xs w-full text-center p-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)]" title="Base points to award" />
                                               <button onClick={() => handleEvaluateTask(sub.id, 'correct')} className="btn btn-primary text-xs w-full bg-[var(--color-success)] border-[var(--color-success)] text-white hover:bg-[var(--color-success)]">Correct</button>
                                               <button onClick={() => handleEvaluateTask(sub.id, 'wrong')} className="btn btn-secondary text-xs w-full text-[var(--color-danger)] border-[var(--color-danger)]">Wrong</button>
                                             </div>
                                          )}
                                        </div>
                                      )}
                                   </div>
                                 ))
                               )}
                             </div>
                           )}
                        </div>
                      )}
                   </div>
                 ))}
               </div>
            )}
          </div>
        )}

        {/* LEADERBOARD SECTION */}
        {(isOngoing || isCompleted || isOrganizer) && (
          <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-6 shadow-sm mt-6">
            <h3 className="text-xl font-bold mb-4 gradient-text">Live Leaderboard</h3>
            {leaderboard.length === 0 ? (
              <p className="text-[var(--color-text-secondary)] italic">No scoreboard data available yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-sm text-[var(--color-text-secondary)]">
                      <th className="p-3">Rank</th>
                      <th className="p-3">Team</th>
                      <th className="p-3 text-right">Score</th>
                      {isOrganizer && <th className="p-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((t, i) => (
                      <React.Fragment key={t.id}>
                        <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-primary)] transition-colors">
                          <td className="p-3 font-bold">#{i + 1}</td>
                          <td className="p-3 cursor-pointer hover:underline text-[var(--color-accent)]" onClick={() => setLeaderboardHistoryOpen(leaderboardHistoryOpen === t.id ? null : t.id)} title="Click to view history">
                            {t.name}
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-[var(--color-text-primary)]">{t.score}</td>
                          {isOrganizer && (
                             <td className="p-3 text-right">
                               {pointAdjustData.teamId === t.id ? (
                                 <form onSubmit={handleAdjustPoints} className="flex flex-col gap-2 items-end min-w-[200px]">
                                    <div className="flex gap-2 items-center w-full justify-end">
                                      <span className="text-xs text-[var(--color-text-secondary)]">Pts (+/-)</span>
                                      <input type="number" value={pointAdjustData.pointsAdded} onChange={e => setPointAdjustData({...pointAdjustData, pointsAdded: parseInt(e.target.value)||0})} className="w-20 text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] p-1.5 rounded-lg text-right text-[var(--color-text-primary)]" placeholder="0" required />
                                    </div>
                                    <input type="text" value={pointAdjustData.reason} onChange={e => setPointAdjustData({...pointAdjustData, reason: e.target.value})} className="w-full text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] p-1.5 rounded-lg text-[var(--color-text-primary)]" placeholder="Reason (optional)" />
                                    <div className="flex gap-2 w-full justify-end mt-1">
                                      <button type="submit" disabled={actionLoading} className="text-xs btn btn-primary px-3 py-1.5 w-full">Save</button>
                                      <button type="button" onClick={() => setPointAdjustData({ teamId: '', pointsAdded: 0, reason: '' })} className="text-xs btn btn-secondary px-3 py-1.5 shrink-0">Cancel</button>
                                    </div>
                                 </form>
                               ) : (
                                 <button onClick={() => setPointAdjustData({ teamId: t.id, pointsAdded: 0, reason: '' })} className="text-xs btn btn-secondary px-3 py-1.5 whitespace-nowrap w-full -mt-2 mb-2">+/- Pts</button>
                               )}

                               {rewardData.teamId === t.id ? (
                                 <form onSubmit={handleAwardTeam} className="flex flex-col gap-2 items-end min-w-[220px] mt-2 border-t border-[var(--color-border)] pt-2">
                                    <div className="flex gap-2 items-center w-full justify-between">
                                      <span className="text-xs font-bold text-[var(--color-primary)]">🪙</span>
                                      <input type="number" min="0" value={rewardData.credits} onChange={e => setRewardData({...rewardData, credits: e.target.value})} className="w-20 text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] p-1.5 rounded-lg text-right text-[var(--color-text-primary)]" placeholder="0" />
                                    </div>
                                    {!isAdminUser && <p className="text-[10px] text-[var(--color-warning)] italic w-full text-right">Debited from your balance</p>}
                                    <div className="w-full">
                                      <span className="text-[10px] text-[var(--color-text-muted)]">🎖️ Badges {!isAdminUser && '(you must own them)'}</span>
                                      <div className="flex flex-wrap gap-1 mt-1 justify-end">
                                        {selectableBadges.map(b => (
                                          <button
                                            type="button"
                                            key={b.id}
                                            onClick={() => toggleRewardBadge(b.id)}
                                            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                                              (rewardData.badgeIds || []).includes(b.id)
                                                ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-accent)]'
                                                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]'
                                            }`}
                                          >
                                            {b.name}
                                          </button>
                                        ))}
                                        {selectableBadges.length === 0 && <span className="text-[10px] text-[var(--color-text-muted)] italic">No badges available.</span>}
                                      </div>
                                    </div>
                                    <div className="flex gap-2 w-full justify-end mt-1">
                                      <button type="submit" disabled={actionLoading} className="text-xs btn btn-primary px-3 py-1.5 w-full bg-[var(--color-success)] border-[var(--color-success)] text-white">Award</button>
                                      <button type="button" onClick={() => setRewardData({ teamId: '', credits: 0, badgeIds: [] })} className="text-xs btn btn-secondary px-3 py-1.5 shrink-0">Cancel</button>
                                    </div>
                                 </form>
                               ) : (
                                 <button onClick={() => setRewardData({ teamId: t.id, credits: 0, badgeIds: [] })} className="text-xs btn btn-secondary px-3 py-1.5 whitespace-nowrap w-full">🏆 Reward</button>
                               )}
                             </td>
                          )}
                        </tr>
                        {leaderboardHistoryOpen === t.id && t.history && (
                          <tr className="bg-[var(--color-bg-primary)]">
                             <td colSpan={isOrganizer ? "4" : "3"} className="p-4 border-b border-[var(--color-border)]">
                                <div className="text-sm font-semibold mb-2">Point History for {t.name}</div>
                                {t.history.length === 0 ? (
                                   <div className="text-xs text-[var(--color-text-muted)] italic">No points history available.</div>
                                ) : (
                                   <ul className="space-y-1">
                                      {t.history.map((h, hIdx) => (
                                         <li key={hIdx} className="text-xs flex justify-between items-center bg-[var(--color-bg-card)] p-2 rounded border border-[var(--color-border)]">
                                            <div>
                                              {h.type === 'submission' ? (
                                                 <span>Task: <strong>{h.taskTitle}</strong> ({h.status})</span>
                                              ) : (
                                                 <span>Admin Adjustment by {h.awardedBy} {h.reason ? `- "${h.reason}"` : ''}</span>
                                              )}
                                              <span className="text-[var(--color-text-muted)] ml-2">{new Date(h.date).toLocaleString()}</span>
                                            </div>
                                            <div className={`font-mono font-bold ${h.scoreChange >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                                               {h.scoreChange > 0 ? '+' : ''}{h.scoreChange}
                                            </div>
                                         </li>
                                      ))}
                                   </ul>
                                )}
                             </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {isOrganizer && (
              <div className="mt-6 pt-4 border-t border-[var(--color-border)] flex justify-end">
                <button
                  onClick={() => { setShowRuleForm(!showRuleForm); setMessage(''); }}
                  className="btn btn-secondary text-sm px-3 py-1.5"
                >
                  {showRuleForm ? 'Cancel' : '+ Configure Rewards'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* REWARDS PANEL */}
        {isOrganizer && (
          <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-6 shadow-sm mt-6">
            <h3 className="text-xl font-bold mb-3 gradient-text">Event Rewards</h3>
            <div className={`text-xs rounded-lg px-3 py-2 mb-4 ${isAdminUser ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'}`}>
              {isAdminUser
                ? 'Admin-minted rewards — unlimited credits, any badge, no caps.'
                : `Rewards are funded from YOUR pocket: credits are debited from your balance (${user?.creditBalance ?? 0} available) and every badge you give must be in your inventory.`}
            </div>

            {showRuleForm && (
              <form onSubmit={handleCreateRule} className="mb-5 p-4 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="font-bold text-sm text-[var(--color-text-secondary)] uppercase">New Reward Rule</h4>
                  <button type="button" onClick={() => { setShowRuleForm(false); resetRuleForm(); }} className="text-[var(--color-text-muted)] hover:text-white px-2">✕</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm mb-1">Fires when</label>
                    <select value={ruleForm.trigger} onChange={e => setRuleForm({...ruleForm, trigger: e.target.value})} className="w-full text-sm bg-[var(--color-bg-card)] border border-[var(--color-border)] p-2 rounded-lg">
                      <option value="submission">Correct submission (auto or manual grade)</option>
                      <option value="rank">Team finishes at rank</option>
                    </select>
                  </div>
                  {ruleForm.trigger === 'rank' && (
                    <div>
                      <label className="block text-sm mb-1">Rank position</label>
                      <input type="number" min="1" value={ruleForm.rank} onChange={e => setRuleForm({...ruleForm, rank: parseInt(e.target.value) || 1})} className="w-full text-sm" />
                    </div>
                  )}
                  <div>
                    <label className="block text-sm mb-1">Credits per member</label>
                    <input type="number" min="0" value={ruleForm.creditsPerUser} onChange={e => setRuleForm({...ruleForm, creditsPerUser: e.target.value})} className="w-full text-sm" placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Max payouts {isAdminUser ? '(blank = unlimited)' : `(max ${100})`}</label>
                    <input type="number" min="1" value={ruleForm.maxUses} onChange={e => setRuleForm({...ruleForm, maxUses: e.target.value})} className="w-full text-sm" placeholder={isAdminUser ? 'Unlimited' : '100'} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm mb-1">Badges per member {!isAdminUser && '(you must own them)'}</label>
                  <div className="flex flex-wrap gap-2">
                    {selectableBadges.map(b => (
                      <button
                        type="button"
                        key={b.id}
                        onClick={() => toggleRuleBadge(b.id)}
                        className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                          ruleForm.badgeIds.includes(b.id)
                            ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-accent)]'
                            : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]'
                        }`}
                      >
                        {b.name}
                      </button>
                    ))}
                    {selectableBadges.length === 0 && <span className="text-xs text-[var(--color-text-muted)] italic">No eligible badges. {isAdminUser ? 'Create one in the Store.' : 'Buy an event badge in the Store first.'}</span>}
                  </div>
                </div>
                <button type="submit" disabled={actionLoading} className="btn btn-primary w-full text-sm">Create Rule</button>
              </form>
            )}

            <h4 className="text-sm font-bold text-[var(--color-text-secondary)] uppercase mb-2">Automatic — per correct submission</h4>
            {submissionRules.length === 0 ? (
              <p className="text-xs italic text-[var(--color-text-muted)] mb-4">No submission rules yet. Add one to hand out rewards automatically on evaluated answers.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {submissionRules.map(rule => (
                  <div key={rule.id} className={`flex items-center justify-between gap-3 text-sm bg-[var(--color-bg-primary)] border border-[var(--color-border)] px-3 py-2 rounded-lg ${!rule.enabled ? 'opacity-50' : ''}`}>
                    <div className="min-w-0">
                      <div className="font-bold truncate">{rule.name}</div>
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        {rule.creditsPerUser > 0 && <span>+{rule.creditsPerUser} cr/member</span>}
                        {rule.badgeIds?.length > 0 && <span> • {rule.badgeIds.map(b => badgeMap[b]?.name || '🎖️').join(', ')}</span>}
                        <span> • {rule.uses}{rule.maxUses !== null ? `/${rule.maxUses}` : '/∞'} payouts</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => handleToggleRule(rule)} className="text-xs px-2 py-1 rounded bg-[var(--color-bg-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)]">{rule.enabled ? 'Disable' : 'Enable'}</button>
                      <button onClick={() => handleDeleteRule(rule.id)} className="text-xs px-2 py-1 rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h4 className="text-sm font-bold text-[var(--color-text-secondary)] uppercase mb-2">Ranked — end of event</h4>
            {rankRules.length === 0 ? (
              <p className="text-xs italic text-[var(--color-text-muted)] mb-4">No rank rules yet.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {rankRules.map(rule => (
                  <div key={rule.id} className={`flex items-center justify-between gap-3 text-sm bg-[var(--color-bg-primary)] border border-[var(--color-border)] px-3 py-2 rounded-lg ${!rule.enabled ? 'opacity-50' : ''}`}>
                    <div className="min-w-0">
                      <div className="font-bold truncate">#{rule.rank} place — {rule.name}</div>
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        {rule.creditsPerUser > 0 && <span>+{rule.creditsPerUser} cr/member</span>}
                        {rule.badgeIds?.length > 0 && <span> • {rule.badgeIds.map(b => badgeMap[b]?.name || '🎖️').join(', ')}</span>}
                        {rule.maxUses !== null && <span> • max {rule.maxUses} run(s)</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => handleToggleRule(rule)} className="text-xs px-2 py-1 rounded bg-[var(--color-bg-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)]">{rule.enabled ? 'Disable' : 'Enable'}</button>
                      <button onClick={() => handleDeleteRule(rule.id)} className="text-xs px-2 py-1 rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rankRules.length > 0 && (
              <div className="flex justify-end mb-6">
                <button onClick={handleDistributeRewards} disabled={actionLoading} className="btn btn-primary">
                  Distribute Ranked Rewards
                </button>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
              <h4 className="text-sm font-bold text-[var(--color-text-secondary)] uppercase mb-2">Grant Ledger ({rewardGrants.length})</h4>
              {rewardGrants.length === 0 ? (
                <p className="text-xs italic text-[var(--color-text-muted)]">No payouts yet.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {rewardGrants.map(g => (
                    <div key={g.id} className="flex items-center justify-between gap-3 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] px-3 py-2 rounded-lg">
                      <div className="min-w-0">
                        <span className="font-bold">{g.user?.displayName || 'User'}</span>
                        {g.team?.name && <span className="text-[var(--color-text-secondary)]"> • {g.team.name}</span>}
                        <span className="text-[var(--color-text-muted)]"> • {g.rule?.name || 'manual grant'}</span>
                        {g.grantedBy && <span className="text-[var(--color-text-muted)]"> by {g.grantedBy.displayName}</span>}
                      </div>
                      <div className="text-right shrink-0">
                        {g.credits > 0 && <span className="font-mono font-bold text-[var(--color-success)]">+{g.credits} cr</span>}
                        {g.badgeIds?.length > 0 && <span className="font-mono font-bold text-[var(--color-accent)] ml-2">+{g.badgeIds.length} 🎖️</span>}
                        <div className="text-[10px] text-[var(--color-text-muted)]">{new Date(g.grantedAt).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
  );
}

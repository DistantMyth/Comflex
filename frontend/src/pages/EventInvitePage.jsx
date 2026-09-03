import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CalendarDays, Trophy, Users, Clock, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { eventApi } from '../api/eventApi';

export default function EventInvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    eventApi.getEventInviteInfo(token)
      .then(res => setInfo(res.data?.data))
      .catch(err => setError(err.response?.data?.error?.message || 'Invalid invite link.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleJoin = async () => {
    setJoining(true);
    setError('');
    try {
      const res = await eventApi.joinEventViaInvite(token);
      const team = res.data?.data?.team;
      navigate(`/events/${team?.eventId || info.id}`);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to join the event.');
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 text-center flex flex-col items-center justify-center">
        <Loader2 size={32} className="animate-spin text-[var(--color-accent)] mb-3" />
        <p className="text-xs text-[var(--color-text-muted)]">Resolving event invitation...</p>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="max-w-md mx-auto mt-16 glass-card p-8 text-center border border-[var(--color-border)] shadow-xl">
        <div className="w-14 h-14 rounded-2xl bg-[var(--color-danger)]/15 border border-[var(--color-danger)]/30 flex items-center justify-center text-[var(--color-danger)] mx-auto mb-4">
          <AlertCircle size={28} />
        </div>
        <h2 className="text-lg font-bold font-display text-[var(--color-text-primary)] mb-1">Invitation Link Expired</h2>
        <p className="text-xs text-[var(--color-text-secondary)] mb-6 leading-relaxed">{error}</p>
        <Link to="/events" className="btn btn-primary w-full py-2.5 text-xs shadow-sm">
          Browse Active Events
        </Link>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md mx-auto mt-16 glass-card p-8 border border-[var(--color-border)] shadow-2xl rounded-3xl relative overflow-hidden"
    >
      <span className="inline-block text-[10px] font-bold px-3 py-1 rounded-full bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] border border-[var(--palette-teal)]/30 mb-3 uppercase tracking-wider">
        {info.category || 'Campus Event'}
      </span>

      <h2 className="text-2xl font-bold font-display text-[var(--color-text-primary)] mb-2">{info.title}</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
        <Clock size={13} />
        <span>{new Date(info.startDate).toLocaleString()}</span>
      </p>

      {info.description && (
        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-4">{info.description}</p>
      )}

      <div className="p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] space-y-1 mb-6 text-xs text-[var(--color-text-secondary)]">
        <p className="flex items-center gap-1.5">
          <Users size={14} className="text-[var(--color-accent)]" />
          <span>{info.isTeamEvent ? `Team Event (${info.minTeamSize}–${info.maxTeamSize} members)` : 'Individual Participation'}</span>
        </p>
        <p className="flex items-center gap-1.5">
          <Trophy size={14} className="text-[var(--color-warning)]" />
          <span>Status: <strong className="capitalize text-[var(--color-text-primary)]">{info.status}</strong></span>
        </p>
      </div>

      {info.alreadyJoined ? (
        <Link to={`/events/${info.id}`} className="btn btn-primary w-full py-3 text-xs shadow-md flex items-center justify-center gap-2">
          <span>You&apos;re Already Enrolled — Open Event</span>
          <ArrowRight size={14} />
        </Link>
      ) : info.eligible ? (
        <button
          onClick={handleJoin}
          disabled={joining}
          className="btn btn-primary w-full py-3 text-xs shadow-md flex items-center justify-center gap-2"
        >
          {joining ? <Loader2 size={16} className="animate-spin" /> : <Trophy size={16} />}
          <span>{joining ? 'Enrolling...' : 'Accept Invitation & Join Event'}</span>
        </button>
      ) : (
        <div className="p-3.5 bg-[var(--color-danger)]/15 border border-[var(--color-danger)]/25 rounded-2xl">
          <p className="text-xs font-semibold text-[var(--color-danger)]">{info.reason || 'You are not eligible for this event cohort.'}</p>
        </div>
      )}

      {error && <p className="text-xs font-semibold text-[var(--color-danger)] mt-3 text-center">{error}</p>}
    </motion.div>
  );
}

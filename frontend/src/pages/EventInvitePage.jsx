/**
 * EventInvitePage — Resolves an event invite link.
 * Shows the event summary, whether the current user is eligible, and a
 * Join button (whitelist/blacklist still enforced server-side).
 */

import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
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
      .then(res => setInfo(res.data.data))
      .catch(err => setError(err.response?.data?.error?.message || 'Invalid invite link.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleJoin = async () => {
    setJoining(true);
    setError('');
    try {
      const res = await eventApi.joinEventViaInvite(token);
      const team = res.data.data.team;
      navigate(`/events/${team?.eventId || info.id}`);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to join the event.');
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto mt-16 p-6 text-center">
        <div className="spinner mx-auto" />
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="max-w-lg mx-auto mt-16 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-8 text-center">
        <h2 className="text-xl font-bold mb-2">Invite Link</h2>
        <p className="text-[var(--color-text-secondary)] mb-4">{error}</p>
        <Link to="/events" className="btn btn-primary">Browse Events</Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto mt-16 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-8 shadow-lg">
      <span className="inline-block text-xs font-semibold px-2 py-1 bg-[var(--color-bg-card)] rounded-full border border-[var(--color-border)] mb-3">
        {info.category}
      </span>
      <h2 className="text-2xl font-bold mb-2">{info.title}</h2>
      <p className="text-sm text-[var(--color-text-secondary)] mb-1">
        {new Date(info.startDate).toLocaleString()}
      </p>
      {info.description && (
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">{info.description}</p>
      )}
      <p className="text-xs text-[var(--color-text-muted)] mb-1">
        {info.isTeamEvent ? `Team event (${info.minTeamSize}-${info.maxTeamSize} members)` : 'Individual event'}
      </p>
      <p className="text-xs text-[var(--color-text-muted)] mb-6">
        Status: <span className="capitalize">{info.status}</span>
      </p>

      {info.alreadyJoined ? (
        <Link to={`/events/${info.id}`} className="btn btn-primary w-full">You're already in this event — Open</Link>
      ) : info.eligible ? (
        <button onClick={handleJoin} disabled={joining} className="btn btn-primary w-full">
          {joining ? <span className="spinner" /> : 'Join Event'}
        </button>
      ) : (
        <div className="p-4 bg-[rgba(239,68,68,0.1)] border border-[var(--color-border)] rounded-xl">
          <p className="text-sm text-[var(--color-danger)]">{info.reason || 'You are not allowed to join this event.'}</p>
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-danger)] mt-3">{error}</p>}
    </div>
  );
}
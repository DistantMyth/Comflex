import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CalendarDays, Trophy, Users, Clock, Flame, ArrowRight, Loader2,
  CheckCircle2, Sparkles, AlertCircle
} from 'lucide-react';
import { eventApi } from '../api/eventApi';

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = () => {
      eventApi.listEvents()
        .then(res => setEvents(res.data?.data || []))
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    };
    fetchEvents();
  }, []);

  const now = new Date();

  const ongoingEvents = events.filter(e => {
    const start = new Date(e.startDate);
    const end = new Date(start.getTime() + (e.durationHours * 3600000) + (e.durationMinutes * 60000));
    if (e.status === 'ongoing') return true;
    if (e.status === 'completed') return false;
    return e.autoStart && now >= start && now < end;
  });

  const pastEvents = events.filter(e => {
    const start = new Date(e.startDate);
    const end = new Date(start.getTime() + (e.durationHours * 3600000) + (e.durationMinutes * 60000));
    if (e.status === 'completed') return true;
    if (e.status === 'ongoing') return false;
    return e.autoStart && now >= end;
  });

  const upcomingEvents = events.filter(e => {
    return !ongoingEvents.includes(e) && !pastEvents.includes(e);
  });

  const EventCard = ({ event, badge = null, badgeColor = '' }) => (
    <Link to={`/events/${event.id}`} className="block group">
      <motion.div
        whileHover={{ y: -3 }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        className="glass-card p-5 sm:p-6 border border-[var(--color-border)] hover:border-[var(--color-accent)] shadow-sm hover:shadow-md transition-all text-left relative overflow-hidden"
      >
        <div className="flex justify-between items-start mb-2.5 flex-wrap gap-2">
          <div className="min-w-0 flex-1 pr-2">
            <h3 className="text-base sm:text-lg font-bold font-display text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors truncate">
              {event.title}
            </h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5 flex items-center gap-1.5">
              <Clock size={13} />
              <span>{new Date(event.startDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {badge && (
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${badgeColor}`}>
                {badge}
              </span>
            )}
            <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
              {event.category || 'General'}
            </span>
          </div>
        </div>

        {event.description && (
          <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2 mb-4 leading-relaxed">
            {event.description}
          </p>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)]/60 text-xs">
          {event.isTeamEvent ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-accent)]">
              <Users size={14} />
              <span>Team Format ({event.minTeamSize}–{event.maxTeamSize} members)</span>
            </span>
          ) : (
            <span className="text-[11px] font-medium text-[var(--color-text-muted)]">Individual Event</span>
          )}

          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-accent)] group-hover:translate-x-0.5 transition-transform">
            <span>View Details</span>
            <ArrowRight size={13} />
          </span>
        </div>
      </motion.div>
    </Link>
  );

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold font-display text-[var(--color-text-primary)] flex items-center gap-2.5">
            <Trophy size={24} className="text-[var(--color-accent)]" />
            <span>Campus Events & Hackathons</span>
          </h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Participate in challenges, submit tasks, and track leaderboards</p>
        </div>

        <Link to="/manage-events" className="btn btn-secondary text-xs py-2 px-3.5 shadow-xs">
          Manage Events
        </Link>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={20} className="animate-spin text-[var(--color-accent)]" />
          <span>Loading campus events...</span>
        </div>
      ) : events.length === 0 ? (
        <div className="glass-card p-12 text-center border border-[var(--color-border)]">
          <CalendarDays size={36} className="mx-auto text-[var(--color-text-muted)] mb-3 opacity-50" />
          <h3 className="text-sm font-bold text-[var(--color-text-primary)]">No events scheduled</h3>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">Check back later for newly announced hackathons and campus competitions.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {ongoingEvents.length > 0 && (
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-warning)] mb-3.5 flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-warning)] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-warning)]" />
                </span>
                <span>Active Right Now ({ongoingEvents.length})</span>
              </h2>
              <div className="grid gap-3.5">
                {ongoingEvents.map(event => (
                  <EventCard
                    key={event.id}
                    event={event}
                    badge="Live Now"
                    badgeColor="bg-[var(--color-warning)]/15 text-[var(--color-warning)] border border-[var(--color-warning)]/30"
                  />
                ))}
              </div>
            </div>
          )}

          {upcomingEvents.length > 0 && (
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--palette-teal)] mb-3.5 flex items-center gap-2">
                <Sparkles size={14} />
                <span>Upcoming Challenges ({upcomingEvents.length})</span>
              </h2>
              <div className="grid gap-3.5">
                {upcomingEvents.map(event => (
                  <EventCard
                    key={event.id}
                    event={event}
                    badge="Upcoming"
                    badgeColor="bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] border border-[var(--palette-teal)]/30"
                  />
                ))}
              </div>
            </div>
          )}

          {pastEvents.length > 0 && (
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-3.5 flex items-center gap-2">
                <CheckCircle2 size={14} />
                <span>Concluded Events ({pastEvents.length})</span>
              </h2>
              <div className="grid gap-3.5 opacity-80">
                {pastEvents.map(event => (
                  <EventCard
                    key={event.id}
                    event={event}
                    badge="Completed"
                    badgeColor="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

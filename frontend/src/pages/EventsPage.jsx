import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { eventApi } from '../api/eventApi';
import { Link } from 'react-router-dom';

export default function EventsPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = () => {
      eventApi.listEvents()
        .then(res => setEvents(res.data.data))
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    };
    fetchEvents();
    // Auto refresh every minute if wanted, but simpler to just fetch once.
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

  const EventCard = ({ event }) => (
    <Link to={`/events/${event.id}`} className="block group">
      <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:border-[var(--color-accent)] rounded-2xl p-6 shadow-sm transition-colors text-left relative">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-lg font-bold group-hover:text-[var(--color-accent)] transition-colors">{event.title}</h3>
          <span className="text-xs font-semibold px-2 py-1 bg-[var(--color-bg-card)] rounded-full border border-[var(--color-border)]">
            {event.category}
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">{new Date(event.startDate).toLocaleString()}</p>
        
        {event.isTeamEvent && (
          <span className="inline-block text-xs font-semibold text-[var(--color-accent)] bg-[var(--color-bg-primary)] border border-[var(--color-border)] px-2 py-1 rounded">
            Team Event ({event.minTeamSize}-{event.maxTeamSize} members)
          </span>
        )}
      </div>
    </Link>
  );

  return (
    <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-6 gradient-text">Events</h2>
        
        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-24 bg-[var(--color-bg-secondary)] animate-pulse rounded-2xl" />)}
          </div>
        ) : events.length === 0 ? (
          <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl p-6 shadow-sm text-center">
            <p className="text-[var(--color-text-secondary)]">No events targeted for you right now!</p>
          </div>
        ) : (
          <div className="space-y-8">
            {ongoingEvents.length > 0 && (
              <div>
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-warning)] animate-pulse"></span>
                  Ongoing
                </h3>
                <div className="grid gap-4">
                  {ongoingEvents.map(event => <EventCard key={event.id} event={event} />)}
                </div>
              </div>
            )}
            
            {upcomingEvents.length > 0 && (
              <div>
                <h3 className="text-xl font-bold mb-4">Upcoming</h3>
                <div className="grid gap-4">
                  {upcomingEvents.map(event => <EventCard key={event.id} event={event} />)}
                </div>
              </div>
            )}
            
            {pastEvents.length > 0 && (
              <div>
                <h3 className="text-xl font-bold mb-4 text-[var(--color-text-secondary)]">Past Events</h3>
                <div className="grid gap-4 opacity-75">
                  {pastEvents.map(event => <EventCard key={event.id} event={event} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
  );
}

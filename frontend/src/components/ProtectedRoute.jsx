import { Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ShieldAlert } from 'lucide-react';

export default function ProtectedRoute({ children, maxRing = 3 }) {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (location.pathname !== '/set-password' && (!user.username || !user.hasPassword)) {
    return <Navigate to="/set-password" replace />;
  }

  const userRing = typeof user.globalRing === 'number' ? user.globalRing : 999;
  if (userRing > maxRing) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--color-bg-primary)]">
        <div className="glass-card p-8 text-center max-w-md w-full">
          <div className="w-14 h-14 rounded-2xl bg-[var(--color-danger)]/15 text-[var(--color-danger)] flex items-center justify-center mx-auto mb-4 border border-[var(--color-danger)]/30">
            <ShieldAlert size={28} />
          </div>
          <h2 className="text-xl font-bold font-display mb-2 text-[var(--color-text-primary)]">Access Restricted</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mb-6 leading-relaxed">
            You require Ring {maxRing} or higher permissions to view this section.
            Your current assigned privilege level: <span className="font-semibold text-[var(--color-text-primary)]">{typeof user.globalRing === 'number' ? `Ring ${user.globalRing}` : 'Unassigned'}</span>.
          </p>
          <Link to="/groups" className="btn btn-secondary px-6 py-2.5 text-sm inline-flex">
            Return to Groups
          </Link>
        </div>
      </div>
    );
  }

  return children;
}

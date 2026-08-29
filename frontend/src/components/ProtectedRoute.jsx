/**
 * ProtectedRoute — Auth-gated route wrapper.
 * Redirects unauthenticated users to /login.
 * Redirects users missing username/password to /set-password.
 * Optionally checks ring level for admin-only routes with fail-closed security.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function ProtectedRoute({ children, maxRing = 3 }) {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  // Show nothing while checking auth state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  // Not logged in → redirect to login
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check if user needs to complete onboarding (username + password)
  // Skip this check if we're already on /set-password to avoid redirect loop
  if (location.pathname !== '/set-password' && (!user.username || !user.hasPassword)) {
    return <Navigate to="/set-password" replace />;
  }

  // Ring check — fail-closed: if user's globalRing is missing or not a number, default to 999 (lowest privilege)
  const userRing = typeof user.globalRing === 'number' ? user.globalRing : 999;
  if (userRing > maxRing) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--color-bg-primary)]">
        <div className="glass-card p-8 text-center max-w-md border border-[var(--color-border)] shadow-xl fade-in">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-bold font-display mb-2 text-[var(--color-text-primary)]">Access Denied</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mb-6">
            You need Ring {maxRing} or higher to access this page.
            Your current ring: {typeof user.globalRing === 'number' ? user.globalRing : 'Unassigned'}.
          </p>
          <a href="/groups" className="btn btn-secondary px-5 py-2 text-sm inline-flex">
            Return to Groups
          </a>
        </div>
      </div>
    );
  }

  return children;
}

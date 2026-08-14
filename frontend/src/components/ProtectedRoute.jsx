/**
 * ProtectedRoute — Auth-gated route wrapper.
 * Redirects unauthenticated users to /login.
 * Redirects users missing username/password to /set-password.
 * Optionally checks ring level for admin-only routes.
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
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Check if user needs to complete onboarding (username + password)
  // Skip this check if we're already on /set-password to avoid redirect loop
  if (location.pathname !== '/set-password' && (!user.username || !user.hasPassword)) {
    return <Navigate to="/set-password" replace />;
  }

  // Ring check — if user's ring is above the required max, block access
  if (user.globalRing > maxRing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card p-8 text-center max-w-md fade-in">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-bold mb-2">Access Denied</h2>
          <p className="text-[var(--color-text-secondary)]">
            You need Ring {maxRing} or higher to access this page.
            Your current ring: {user.globalRing}.
          </p>
        </div>
      </div>
    );
  }

  return children;
}


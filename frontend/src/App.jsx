/**
 * App — Root component with React Router setup + animated page transitions.
 *
 * Routes:
 *   /login          → LoginPage (public)
 *   /register       → RegisterPage (public, gated by system config)
 *   /set-password   → SetPasswordPage (authenticated, post-Google flow)
 *   /setup          → SetupPage (admin only, first boot)
 *   /profile        → ProfilePage (authenticated)
 *   /admin          → AdminDashboard (Ring 0 only)
 *   /groups         → GroupsPage (authenticated)
 *   /friends        → FriendsPage (authenticated)
 *   /messages       → MessagesPage (authenticated)
 *   /               → Homepage (public landing)
 */

import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import PageTransition from './components/PageTransition';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ProfilePage from './pages/ProfilePage';
import SetupPage from './pages/SetupPage';
import AdminDashboard from './pages/AdminDashboard';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import GroupsPage from './pages/GroupsPage';
import ChatPage from './pages/ChatPage';
import SetPasswordPage from './pages/SetPasswordPage';
import FriendsPage from './pages/FriendsPage';
import MessagesPage from './pages/MessagesPage';
import EventsPage from './pages/EventsPage';
import ManageEventsPage from './pages/ManageEventsPage';
import EventDetailsPage from './pages/EventDetailsPage';
import EventInvitePage from './pages/EventInvitePage';
import JoinGroupPage from './pages/JoinGroupPage';
import ResourcesPage from './pages/ResourcesPage';
import StorePage from './pages/StorePage';
import FloatingChatbot from './components/FloatingChatbot';
import Homepage from './pages/Homepage';

// Public pages get a subtle enter animation.
const tr = (el) => <PageTransition>{el}</PageTransition>;

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={tr(<LoginPage />)} />
      <Route path="/register" element={tr(<RegisterPage />)} />
      <Route path="/forgot-password" element={tr(<ForgotPasswordPage />)} />
      <Route path="/reset-password" element={tr(<ResetPasswordPage />)} />
      <Route path="/verify-email" element={tr(<VerifyEmailPage />)} />

      {/* Standalone guarded pages (own full-screen shell, no sidebar) */}
      <Route path="/set-password" element={tr(<ProtectedRoute><SetPasswordPage /></ProtectedRoute>)} />
      <Route path="/setup" element={tr(<ProtectedRoute maxRing={0}><SetupPage /></ProtectedRoute>)} />
      <Route path="/join/:token" element={tr(<ProtectedRoute><JoinGroupPage /></ProtectedRoute>)} />

      {/* Authenticated app shell — Layout persists across all of these routes,
          so the sidebar/nav never remounts when switching between pages. */}
      <Route element={<Layout><Outlet /></Layout>}>
        <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute maxRing={0}><AdminDashboard /></ProtectedRoute>} />
        <Route path="/groups" element={<ProtectedRoute><GroupsPage /></ProtectedRoute>} />
        <Route path="/groups/:id" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
        <Route path="/friends" element={<ProtectedRoute><FriendsPage /></ProtectedRoute>} />
        <Route path="/messages" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
        <Route path="/messages/:userId" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
        <Route path="/events" element={<ProtectedRoute><EventsPage /></ProtectedRoute>} />
        <Route path="/manage-events" element={<ProtectedRoute><ManageEventsPage /></ProtectedRoute>} />
        <Route path="/events/invite/:token" element={<ProtectedRoute><EventInvitePage /></ProtectedRoute>} />
        <Route path="/events/:id" element={<ProtectedRoute><EventDetailsPage /></ProtectedRoute>} />
        <Route path="/resources" element={<ProtectedRoute><ResourcesPage /></ProtectedRoute>} />
        <Route path="/store" element={<ProtectedRoute><StorePage /></ProtectedRoute>} />
      </Route>

      {/* Landing */}
      <Route path="/" element={tr(<Homepage />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <FloatingChatbot />
      </AuthProvider>
    </BrowserRouter>
  );
}

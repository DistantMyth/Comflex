/**
 * Auth API — Centralized auth API calls.
 * Refresh token lives in an httpOnly cookie — it is never sent in bodies.
 */

import client from './client';

export const authApi = {
  login: (email, password) =>
    client.post('/auth/login', { email, password }),

  register: (email, password, displayName) =>
    client.post('/auth/register', { email, password, displayName }),

  googleLogin: (idToken) =>
    client.post('/auth/google', { idToken }),

  // currentPassword required when the account already has a password
  setPassword: (newPassword, currentPassword) =>
    client.post('/auth/set-password', { newPassword, currentPassword }),

  setUsername: (username) =>
    client.post('/auth/set-username', { username }),

  checkUsername: (username) =>
    client.get(`/auth/check-username/${encodeURIComponent(username)}`),

  logout: () =>
    client.post('/auth/logout'),

  // Backend rotates the refresh token; body deliberately omitted (cookie-only)
  refreshToken: () =>
    client.post('/auth/refresh'),

  forgotPassword: (email) =>
    client.post('/auth/forgot-password', { email }),

  resetEmailStatus: (email) =>
    client.get(`/auth/reset-email-status?email=${encodeURIComponent(email)}`),

  resetPassword: (token, newPassword) =>
    client.post('/auth/reset-password', { token, newPassword }),

  verifyPersonalEmail: (token) =>
    client.post('/auth/verify-personal-email', { token }),
};
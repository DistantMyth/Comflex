/**
 * Auth API — Centralized auth API calls.
 */

import client from './client';

export const authApi = {
  login: (email, password) =>
    client.post('/auth/login', { email, password }),

  register: (email, password, displayName) =>
    client.post('/auth/register', { email, password, displayName }),

  googleLogin: (idToken) =>
    client.post('/auth/google', { idToken }),

  setPassword: (newPassword) =>
    client.post('/auth/set-password', { newPassword }),

  setUsername: (username) =>
    client.post('/auth/set-username', { username }),

  checkUsername: (username) =>
    client.get(`/auth/check-username/${encodeURIComponent(username)}`),

  logout: () =>
    client.post('/auth/logout'),

  refreshToken: (refreshToken) =>
    client.post('/auth/refresh', { refreshToken }),

  forgotPassword: (email) =>
    client.post('/auth/forgot-password', { email }),

  resetEmailStatus: (email) =>
    client.get(`/auth/reset-email-status?email=${encodeURIComponent(email)}`),

  resetPassword: (token, newPassword) =>
    client.post('/auth/reset-password', { token, newPassword }),

  verifyPersonalEmail: (token) =>
    client.post('/auth/verify-personal-email', { token }),
};

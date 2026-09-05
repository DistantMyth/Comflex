import client from './client';

export const authApi = {
  login: (email, password) =>
    client.post('/auth/login', { email, password }),

  register: (email, password, displayName) =>
    client.post('/auth/register', { email, password, displayName }),

  googleLogin: (tokenOrPayload) => {
    const payload = typeof tokenOrPayload === 'string'
      ? (tokenOrPayload.startsWith('ya29.') ? { accessToken: tokenOrPayload } : { idToken: tokenOrPayload })
      : tokenOrPayload;
    return client.post('/auth/google', payload);
  },

  setPassword: (newPassword, currentPassword) =>
    client.post('/auth/set-password', { newPassword, currentPassword }),

  setUsername: (username) =>
    client.post('/auth/set-username', { username }),

  checkUsername: (username) =>
    client.get(`/auth/check-username/${encodeURIComponent(username)}`),

  logout: () =>
    client.post('/auth/logout'),

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

export default authApi;

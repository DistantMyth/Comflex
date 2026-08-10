/**
 * User API — Profile and user-related API calls.
 */

import client from './client';

export const userApi = {
  getProfile: () =>
    client.get('/users/me'),

  updateProfile: (data) =>
    client.patch('/users/me', data),

  uploadAvatar: (file) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return client.post('/users/me/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  getTags: () =>
    client.get('/users/me/tags'),

  getPersonalEmailStatus: () =>
    client.get('/users/me/personal-email/status'),

  searchUsers: (query) =>
    client.get(`/users/search?q=${encodeURIComponent(query)}`),

  getUserProfile: (userId) =>
    client.get(`/users/${userId}/profile`),
};

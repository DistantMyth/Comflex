/**
 * Notifications API — notification bell data.
 */

import client from './client';

export const notificationsApi = {
  list: (limit = 30) =>
    client.get(`/notifications?limit=${limit}`),

  unreadCount: () =>
    client.get('/notifications/unread-count'),

  markRead: (id) =>
    client.post(`/notifications/${id}/read`),

  markReadByFilter: (filter = {}) =>
    client.post('/notifications/mark-read', filter),

  markAllRead: () =>
    client.post('/notifications/read-all'),
};

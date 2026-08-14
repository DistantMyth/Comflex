/**
 * DM API — Centralized direct-messaging API calls.
 */

import client from './client';

export const dmApi = {
  listConversations: () =>
    client.get('/dm'),

  getMessages: (userId, page = 1, limit = 50) =>
    client.get(`/dm/${userId}?page=${page}&limit=${limit}`),

  sendMessage: (userId, data) =>
    client.post(`/dm/${userId}`, data),

  uploadAttachment: (file) => {
    const formData = new FormData();
    formData.append('attachment', file);
    return client.post('/dm/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  editMessage: (msgId, content) =>
    client.put(`/dm/messages/${msgId}`, { content }),

  markRead: (userId) =>
    client.patch(`/dm/${userId}/read`),

  deleteMessage: (msgId) =>
    client.delete(`/dm/messages/${msgId}`),
};

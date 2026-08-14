/**
 * Friend API — Centralized friend-related API calls.
 */

import client from './client';

export const friendApi = {
  listFriends: () =>
    client.get('/friends'),

  listRequests: () =>
    client.get('/friends/requests'),

  listSent: () =>
    client.get('/friends/sent'),

  sendRequest: (userId) =>
    client.post('/friends/request', { userId }),

  accept: (friendshipId) =>
    client.post(`/friends/${friendshipId}/accept`),

  reject: (friendshipId) =>
    client.post(`/friends/${friendshipId}/reject`),

  remove: (friendshipId) =>
    client.delete(`/friends/${friendshipId}`),
};

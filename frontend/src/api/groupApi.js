import client, { withAnonIdentity, anonSessionsHeaderValue } from './client';

export const groupApi = {
  // Groups
  listGroups: () => {
    const headers = anonSessionsHeaderValue();
    return client.get('/groups', headers ? { headers: { 'X-Anon-Sessions': headers } } : undefined);
  },
  getGroup: (id) => client.get(`/groups/${id}`, withAnonIdentity({}, id)),
  createGroup: (data) => client.post('/groups', data),
  updateGroup: (id, data) => client.patch(`/groups/${id}`, data, withAnonIdentity({}, id)),

  // Group Avatar
  uploadGroupAvatar: (groupId, file) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return client.post(`/groups/${groupId}/avatar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // Members
  listMembers: (groupId) => client.get(`/groups/${groupId}/members`),
  addMember: (groupId, userId) => client.post(`/groups/${groupId}/members`, { userId }),
  removeMember: (groupId, userId) => client.delete(`/groups/${groupId}/members/${userId}`),

  // Invites
  listGroupInvites: (groupId) => client.get(`/groups/${groupId}/invites`),
  listMyInvites: () => client.get('/groups/invites'),
  createGroupInvite: (groupId, userId) => client.post(`/groups/${groupId}/invites`, { userId }),
  acceptInvite: (groupId, inviteId, alias, avatarUrl) =>
    client.post(`/groups/${groupId}/invites/${inviteId}/accept`, { alias, avatarUrl }),
  rejectInvite: (groupId, inviteId) => client.post(`/groups/${groupId}/invites/${inviteId}/reject`),
  getInviteLink: (groupId) => client.get(`/groups/${groupId}/invite-link`, withAnonIdentity({}, groupId)),

  // User search for invites
  searchUsersForGroup: (groupId, query) =>
    client.get(`/groups/${groupId}/search-users`, { params: { q: query } }),

  // Mute
  muteMember: (groupId, userId, durationMinutes = 60) =>
    client.post(`/groups/${groupId}/members/${userId}/mute`, { durationMinutes }),
  unmuteMember: (groupId, userId) =>
    client.delete(`/groups/${groupId}/members/${userId}/mute`),

  // Ring & Permissions
  getMemberRing: (groupId, userId) => client.get(`/groups/${groupId}/members/${userId}/ring`),
  setMemberRing: (groupId, userId, ring) =>
    client.patch(`/groups/${groupId}/members/${userId}/ring`, { ring }),
  getMemberPermissions: (groupId, userId) =>
    client.get(`/groups/${groupId}/members/${userId}/permissions`),
  setMemberPermissions: (groupId, userId, permissions) =>
    client.patch(`/groups/${groupId}/members/${userId}/permissions`, permissions),

  // Messages
  getMessages: (groupId, page = 1, limit = 50) =>
    client.get(`/groups/${groupId}/messages`, withAnonIdentity({ params: { page, limit } }, groupId)),
  sendMessage: (groupId, data) => {
    const config = withAnonIdentity({}, groupId);
    if (data instanceof FormData) {
      config.headers = { ...(config.headers || {}), 'Content-Type': 'multipart/form-data' };
    }
    return client.post(`/groups/${groupId}/messages`, data, config);
  },
  reactToMessage: (groupId, msgId, emoji) =>
    client.patch(`/groups/${groupId}/messages/${msgId}/react`, { emoji }, withAnonIdentity({}, groupId)),
  editMessage: (groupId, msgId, content) =>
    client.patch(`/groups/${groupId}/messages/${msgId}`, { content }, withAnonIdentity({}, groupId)),
  deleteMessage: (groupId, msgId) =>
    client.delete(`/groups/${groupId}/messages/${msgId}`, withAnonIdentity({}, groupId)),
  pinMessage: (groupId, msgId) =>
    client.post(`/groups/${groupId}/messages/${msgId}/pin`, {}, withAnonIdentity({}, groupId)),
  unpinMessage: (groupId, msgId) =>
    client.delete(`/groups/${groupId}/messages/${msgId}/pin`, withAnonIdentity({}, groupId)),
  getPinnedMessages: (groupId) =>
    client.get(`/groups/${groupId}/messages/pinned`, withAnonIdentity({}, groupId)),

  // Unread tracking
  markMessagesRead: (groupId) =>
    client.post(`/groups/${groupId}/messages/read`, {}, withAnonIdentity({}, groupId)),
  getUnreadCount: (groupId) =>
    client.get(`/groups/${groupId}/unread`, withAnonIdentity({}, groupId)),

  // Leave & Delete & Transfer
  leaveGroup: (groupId) => client.delete(`/groups/${groupId}/leave`, withAnonIdentity({}, groupId)),
  deleteGroup: (groupId) => client.delete(`/groups/${groupId}`, withAnonIdentity({}, groupId)),
  transferOwnership: (groupId, targetUserId) => client.post(`/groups/${groupId}/transfer`, { targetUserId }),

  // Ring Configuration
  updateRingConfig: (groupId, config) =>
    client.patch(`/groups/${groupId}/rings`, config),

  // Anonymous group identities & moderation
  claimAnonIdentity: (groupId, alias, avatarUrl) =>
    client.post(`/groups/${groupId}/anons/claim`, { alias, avatarUrl }),
  getAnonMe: (groupId) =>
    client.get(`/groups/${groupId}/anons/me`, withAnonIdentity({}, groupId)),
  renameAnonIdentity: (groupId, alias, avatarUrl) =>
    client.post(`/groups/${groupId}/anons/rename`, { alias, avatarUrl }, withAnonIdentity({}, groupId)),
  reportAnonIdentity: (groupId, targetIdentityId, reason) =>
    client.post(`/groups/${groupId}/anons/report`, { targetIdentityId, reason }, withAnonIdentity({}, groupId)),
  getAnonReports: (groupId) =>
    client.get(`/groups/${groupId}/anons/reports`, withAnonIdentity({}, groupId)),
  banAnonIdentity: (groupId, identityId) =>
    client.post(`/groups/${groupId}/anons/${identityId}/ban`, {}, withAnonIdentity({}, groupId)),
  unbanAnonIdentity: (groupId, identityId) =>
    client.post(`/groups/${groupId}/anons/${identityId}/unban`, {}, withAnonIdentity({}, groupId)),
  setWordBans: (groupId, words) =>
    client.put(`/groups/${groupId}/wordbans`, { words }, withAnonIdentity({}, groupId)),
  leaveAnonIdentity: (groupId) =>
    client.post(`/groups/${groupId}/anons/leave`, {}, withAnonIdentity({}, groupId)),

  // Key restore & Token Join
  joinGroup: (token, alias, avatarUrl) => client.post(`/groups/join/${token}`, { alias, avatarUrl }),
  anonEnterCheck: (groupId) => client.get(`/groups/${groupId}/anons/enter`),
  restoreAnonIdentity: (groupId, key) =>
    client.post(`/groups/${groupId}/anons/restore`, { key }),
};

export default groupApi;

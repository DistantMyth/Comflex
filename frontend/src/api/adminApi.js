/**
 * Admin API — Institution config, cohort config, auto-join rules,
 * group management, user management, and permissions.
 */

import client from './client';

export const adminApi = {
  // System
  getSystemStatus: () =>
    client.get('/system/status'),

  // Institution
  setupInstitution: (data) =>
    client.post('/admin/institution/setup', data),
  getInstitution: () =>
    client.get('/admin/institution'),
  updateInstitution: (data) =>
    client.patch('/admin/institution', data),

  // Cohort Config
  getCohortConfig: () =>
    client.get('/admin/cohort-config'),
  updateCohortConfig: (data) =>
    client.put('/admin/cohort-config', data),
  previewCohortConfig: (data) =>
    client.post('/admin/cohort-config/preview', data),

  // Auto-Join Rules
  getAutoJoinRules: () =>
    client.get('/admin/auto-join-rules'),
  updateAutoJoinRules: (rules) =>
    client.put('/admin/auto-join-rules', { rules }),
  previewAutoJoinRules: (email) =>
    client.post('/admin/auto-join-rules/preview', { email }),

  // Groups (admin management — all platform groups)
  listAllGroups: () =>
    client.get('/admin/groups'),
  createGroup: (data) =>
    client.post('/groups', data),
  deleteGroup: (id) =>
    client.delete(`/groups/${id}`),

  // Users
  listUsers: (params) =>
    client.get('/admin/users', { params }),
  getUser: (id) =>
    client.get(`/admin/users/${id}`),
  setUserRing: (id, ring) =>
    client.patch(`/admin/users/${id}/ring`, { ring }),
  retagUser: (id) =>
    client.post(`/admin/users/${id}/retag`),
  retagAllUsers: () =>
    client.post('/admin/users/retag-all'),
  setUserPermissions: (id, permissions) =>
    client.patch(`/admin/users/${id}/permissions`, permissions),
  deleteUser: (id) =>
    client.delete(`/admin/users/${id}`),
  createTestUser: (data) =>
    client.post('/admin/users/create-test', data),

  // Database Management
  backupDatabase: () =>
    client.get('/admin/database/backup', { responseType: 'blob' }),
  clearDatabase: () =>
    client.delete('/admin/database/clear'),
};

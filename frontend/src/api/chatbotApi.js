import client from './client';

export const chatbotApi = {
  getNotes: () =>
    client.get('/chatbot'),

  getLimits: () =>
    client.get('/chatbot/limits'),

  uploadLocalNote: (formData) =>
    client.post('/chatbot/upload/local', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  uploadResourceNote: (resourceId, title) =>
    client.post('/chatbot/upload/resource', { resourceId, title }),

  deleteNote: (id) =>
    client.delete(`/chatbot/${id}`),

  chat: (data) =>
    client.post('/chatbot/chat', data),
};

export default chatbotApi;

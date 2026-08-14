import api from './client';

export const resourceApi = {
  getSubjects: (params) => {
    return api.get('/resources/subjects', { params });
  },
  createSubject: (data) => {
    return api.post('/resources/subjects', data);
  },
  deleteSubject: (id) => {
    return api.delete(`/resources/subjects/${id}`);
  },
  getResources: (subjectId) => {
    return api.get('/resources', { params: { subjectId } });
  },
  uploadResource: (formData, onUploadProgress) => {
    return api.post('/resources/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress
    });
  },
  deleteResource: (id) => {
    return api.delete(`/resources/${id}`);
  }
};

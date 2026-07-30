import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth APIs
export const authApi = {
  register: (email: string, password: string) =>
    api.post('/auth/register', { email, password }),
  
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  
  oauth: (provider: string, redirectUrl: string) =>
    api.post(`/auth/oauth/${provider}`, { redirect: redirectUrl }),
};

// Bot APIs
export const botApi = {
  create: (data: { name: string; description?: string; system_prompt?: string }) =>
    api.post('/bots', data),
  
  list: () => api.get('/bots'),
  
  get: (botId: string) => api.get(`/bots/${botId}`),
  
  update: (botId: string, data: any) => api.put(`/bots/${botId}`, data),
  
  delete: (botId: string) => api.delete(`/bots/${botId}`),
  
  getStats: (botId: string) => api.get(`/bots/${botId}/stats`),
};

// Knowledge APIs
export const knowledgeApi = {
  uploadFile: (botId: string, file: File) => {
    const formData = new FormData();
    formData.append('bot_id', botId);
    formData.append('file', file);
    return api.post('/knowledge/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  
  scrapeWebsite: (botId: string, url: string, sitemap: boolean = false) =>
    api.post('/knowledge/scrape', { bot_id: botId, url, sitemap }),
  
  listSources: (botId: string) => api.get(`/knowledge/${botId}`),
  
  deleteSource: (sourceId: string) => api.delete(`/knowledge/${sourceId}`),
};

// Chat APIs
export const chatApi = {
  chat: (botSlug: string, message: string, conversationId?: string, stream: boolean = false) =>
    api.post(`/chat/${botSlug}`, {
      message,
      conversation_id: conversationId,
      stream,
    }),
  
  chatStream: (botSlug: string, message: string, conversationId?: string) => {
    return fetch(`${API_URL}/chat/${botSlug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(typeof window !== 'undefined' && localStorage.getItem('token') 
          ? { Authorization: `Bearer ${localStorage.getItem('token')}` } 
          : {}),
      },
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
        stream: true,
      }),
    });
  },
};

// Conversation APIs
export const conversationApi = {
  list: (botId: string) => api.get(`/conversations/${botId}`),
  
  getMessages: (convId: string) => api.get(`/conversations/${convId}/messages`),
  
  saveFeedback: (convId: string, feedback: { helpful: boolean; rating: number; comment?: string }) =>
    api.post(`/conversations/${convId}/feedback`, feedback),
};

export default api;
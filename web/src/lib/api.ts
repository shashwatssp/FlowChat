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
  create: (data: {
    name: string;
    description?: string;
    avatar_url?: string;
    system_prompt?: string;
    calendar_enabled?: boolean;
    timezone?: string;
  }) =>
    api.post('/bots', data),
  
  list: () => api.get('/bots'),
  
  get: (botId: string) => api.get(`/bots/${botId}`),
  
  update: (botId: string, data: any) => api.put(`/bots/${botId}`, data),
  
  delete: (botId: string) => api.delete(`/bots/${botId}`),
  
  getStats: (botId: string) => api.get(`/bots/${botId}/stats`),

  getPublicBot: (slug: string) => api.get(`/bots/public/${slug}`),

  getWidget: (botId: string) => api.get(`/widget/${botId}`, { responseType: 'text', headers: { 'Content-Type': 'application/javascript' } }),
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

  reindex: (sourceId: string) => api.post(`/knowledge/${sourceId}/reindex`),

  /**
   * Send a raw speech-to-text transcript to the backend LLM which cleans,
   * structures, and tailors it for the given field before returning the
   * refined text. This lets owners just speak naturally and get clean,
   * ready-to-save content in every input field.
   */
  refineVoice: (text: string, field?: string) =>
    api.post('/knowledge/refine', { text, field })
      .then((res) => (res.data as { text: string }).text),

  /**
   * Save arbitrary text (e.g. a voice transcript) as embedded knowledge
   * chunks for a bot. The backend chunks, embeds, and stores the text in
   * Qdrant so it becomes searchable for future answers.
   */
  saveText: (botId: string, text: string) =>
    api.post('/knowledge/save-text', { bot_id: botId, text }),
};

// Chat APIs
export interface Source {
  content: string;
  score: number;
  name: string;
  url?: string;
  chunk_id?: string;
}

export interface StreamEvent {
  content?: string;
  reasoning?: string;
  conversation_id?: string;
  sources?: Source[];
}

export const chatApi = {
  // Non-streaming chat (fallback)
  chat: (botSlug: string, message: string, conversationId?: string, stream: boolean = false) =>
    api.post(`/chat/${botSlug}`, {
      message,
      conversation_id: conversationId,
      stream,
    }),

  // Streaming chat — returns the raw fetch Response so callers can parse SSE
  chatStream: (botSlug: string, message: string, conversationId?: string, signal?: AbortSignal) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    return fetch(`${API_URL}/chat/${botSlug}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
        stream: true,
      }),
      signal,
    });
  },
};

/**
 * Parse an SSE streaming response and yield chunk events.
 * Each SSE event is prefixed with "data:" and contains a JSON payload
 * following the OpenAI/Chat Completions streaming format.
 * Only the "content" field from choices[0].delta is yielded; reasoning-only
 * chunks (empty content) and non-JSON lines are silently skipped.
 */
export async function* parseStream(
  response: Response,
): AsyncGenerator<StreamEvent> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Stream reader not available');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        const result = parseSSELines(buffer);
        if (result) yield result;
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n|\r\n\r\n/);
    buffer = events.pop() || '';

    for (const event of events) {
      const trimmed = event.trim();
      if (!trimmed) continue;
      const result = parseSSELines(trimmed);
      if (result) yield result;
    }
  }
}

function parseSSELines(text: string): StreamEvent | null {
  const lines = text.split(/\n|\r\n/);
  let dataParts: string[] = [];

  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataParts.push(line.slice(5).trim());
    } else if (line.trim() && !line.startsWith(':')) {
      dataParts.push(line.trim());
    }
  }

  if (dataParts.length === 0) return null;

  const dataStr = dataParts.join('\n');
  if (dataStr === '[DONE]' || dataStr === '') return null;

  let jsonStr = dataStr;
  if (jsonStr.startsWith('data:')) {
    jsonStr = jsonStr.slice(5).trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.choices && Array.isArray(parsed.choices)) {
      const delta = parsed.choices[0]?.delta;
      const content = delta?.content;
      const reasoning = delta?.reasoning;
      // Return content chunk (reasoning models may have empty content during thinking)
      if (content) {
        return { content };
      }
      // Return reasoning chunks so the UI can optionally display them
      if (reasoning) {
        return { reasoning };
      }
      // Reasoning-only or finish_reason chunks (empty content) — skip
      return null;
    }
    if (parsed.conversation_id || parsed.sources) {
      return {
        conversation_id: parsed.conversation_id,
        sources: parsed.sources,
      };
    }
    if (typeof parsed.content === 'string') {
      return { content: parsed.content };
    }
    return null;
  } catch {
    // Non-JSON data might be raw text content emitted by some models
    // outside of the standard JSON structure (e.g. certain reasoning
    // models that stream content as plain text after JSON).
    const trimmed = jsonStr.trim();
    if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return { content: trimmed };
    }
    return null;
  }
}

// Calendar / Appointments APIs

// Google Calendar OAuth connect — redirects the browser to Google's OAuth
// consent screen via the backend's /auth/google/calendar/connect endpoint.
export const googleCalendarApi = {
  connectCalendar: (botId: string) => {
    window.location.href = `${API_URL.replace('/api/v1', '')}/auth/google/calendar/connect?bot_id=${encodeURIComponent(botId)}`;
    return Promise.resolve();
  },
};

export interface CalendarSettingsPayload {
  calendar_enabled: boolean;
  timezone: string;
  appointment_duration_minutes?: number;
  availability_rules?: Array<{ day_of_week: number; start_time: string; end_time: string; timezone: string }>;
  availability_exceptions?: Array<{ exception_date: string; is_open: boolean; start_time?: string; end_time?: string; timezone?: string; note?: string }>;
}

export interface BookAppointmentPayload {
  customer_name: string;
  customer_email?: string;
  customer_phone: string;
  start_time: string;
  end_time: string;
  notes?: string;
}

export const calendarApi = {
  // Get calendar settings for a bot
  getSettings: (botId: string) => api.get(`/bots/${botId}/settings`),

  // Update calendar settings (enabled, timezone, availability rules, exceptions)
  updateSettings: (botId: string, data: CalendarSettingsPayload) =>
    api.put(`/bots/${botId}/settings`, data),

  // Check slot availability
  checkAvailability: (botId: string, startTime: string, endTime: string) =>
    api.post(`/bots/${botId}/availability/check`, { start_time: startTime, end_time: endTime }),

  // Book an appointment
  bookAppointment: (botId: string, data: BookAppointmentPayload) =>
    api.post(`/bots/${botId}/appointments`, data),

  // List appointments (owner)
  listAppointments: (botId: string, params?: { date_from?: string; date_to?: string; status?: string }) =>
    api.get(`/bots/${botId}/appointments`, { params }),

  // Cancel an appointment
  cancelAppointment: (botId: string, appointmentId: string) =>
    api.delete(`/bots/${botId}/appointments/${appointmentId}`),

  // Get available slots for a date range (start_date & end_date required, duration optional in minutes)
  getAvailableSlots: (botId: string, startDate: string, endDate: string, duration?: number) =>
    api.get(`/bots/${botId}/availability`, { params: { start_date: startDate, end_date: endDate, ...(duration ? { duration: String(duration) } : {}) } }),
};

// Conversation APIs
export const conversationApi = {
  list: (botId: string) => api.get(`/conversations/${botId}`),
  
  getMessages: (convId: string) => api.get(`/conversations/${convId}/messages`),
  
  saveFeedback: (convId: string, feedback: { helpful: boolean; rating: number; comment?: string }) =>
    api.post(`/conversations/${convId}/feedback`, feedback),
};

export default api;
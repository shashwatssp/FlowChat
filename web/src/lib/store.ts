import { create } from 'zustand';
import { authApi, botApi } from '@/lib/api';

interface User {
  id: string;
  email: string;
  created_at: string;
}

interface Bot {
  id: string;
  name: string;
  description: string;
  slug: string;
  avatar_url: string;
  system_prompt: string; // Bot instructions (shown as "Bot Instructions" in UI)
  api_key: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  setToken: (token: string) => void;
  setUser: (user: User) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => void;
}

interface BotState {
  bots: Bot[];
  loading: boolean;
  fetchBots: () => Promise<void>;
  addBot: (bot: Bot) => void;
  updateBot: (bot: Bot) => void;
  removeBot: (botId: string) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
  isAuthenticated: typeof window !== 'undefined' ? !!localStorage.getItem('token') : false,
  loading: false,

  setToken: (token: string) => {
    localStorage.setItem('token', token);
    set({ token, isAuthenticated: true });
  },

  setUser: (user: User) => set({ user }),

  login: async (email: string, password: string) => {
    set({ loading: true });
    try {
      const response = await authApi.login(email, password);
      const token = response.data.access_token;
      localStorage.setItem('token', token);
      set({ token, isAuthenticated: true, loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  register: async (email: string, password: string) => {
    set({ loading: true });
    try {
      await authApi.register(email, password);
      set({ loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null, isAuthenticated: false });
  },

  checkAuth: () => {
    const token = localStorage.getItem('token');
    set({ token, isAuthenticated: !!token });
  },
}));

export const useBotStore = create<BotState>((set, get) => ({
  bots: [],
  loading: false,

  fetchBots: async () => {
    set({ loading: true });
    try {
      const response = await botApi.list();
      set({ bots: response.data, loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  addBot: (bot: Bot) => {
    set((state) => ({ bots: [bot, ...state.bots] }));
  },

  updateBot: (bot: Bot) => {
    set((state) => ({
      bots: state.bots.map((b) => (b.id === bot.id ? bot : b)),
    }));
  },

  removeBot: (botId: string) => {
    set((state) => ({
      bots: state.bots.filter((b) => b.id !== botId),
    }));
  },
}));

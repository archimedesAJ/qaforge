import { create } from 'zustand';
import { api } from '../lib/api';

interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: false,

  hydrate: () => {
    const token = localStorage.getItem('qaforge_token');
    const user = localStorage.getItem('qaforge_user');
    if (token && user) {
      set({ token, user: JSON.parse(user) });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const res = await api.post<{ token: string; user: AuthUser }>('auth/login', { email, password });
      localStorage.setItem('qaforge_token', res.token);
      localStorage.setItem('qaforge_user', JSON.stringify(res.user));
      set({ token: res.token, user: res.user });
    } finally {
      set({ isLoading: false });
    }
  },

  register: async (email, password, name) => {
    set({ isLoading: true });
    try {
      const res = await api.post<{ token: string; user: AuthUser }>('auth/register', { email, password, name });
      localStorage.setItem('qaforge_token', res.token);
      localStorage.setItem('qaforge_user', JSON.stringify(res.user));
      set({ token: res.token, user: res.user });
    } finally {
      set({ isLoading: false });
    }
  },

  logout: () => {
    localStorage.removeItem('qaforge_token');
    localStorage.removeItem('qaforge_user');
    set({ token: null, user: null });
    window.location.href = '/login';
  },
}));

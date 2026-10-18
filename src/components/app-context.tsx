'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { Client, SessionUser } from '@/lib/types';

export interface Toast { id: number; tone: 'info' | 'success' | 'danger'; text: string }

export interface AiInfo { provider: 'openrouter' | 'template'; label: string; languages: string[] }

interface AppState {
  user: SessionUser | null;
  ai: AiInfo | null;
  signOut: () => Promise<void>;
  /** True when the signed-in role may change data (editor and above). */
  canEdit: boolean;
  clients: Client[];
  client: Client | null;
  setClientId: (id: string) => void;
  reloadClients: () => Promise<Client[]>;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  /** "Empty" toggle from the design: previews empty states without touching data. */
  emptyPreview: boolean;
  setEmptyPreview: (v: boolean) => void;
  /** Bump to make pages refetch after a mutation elsewhere. */
  version: number;
  bump: () => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  wizardOpen: boolean;
  openWizard: () => void;
  closeWizard: () => void;
}

const Ctx = createContext<AppState | null>(null);

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* storage unavailable */ }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ai, setAi] = useState<AiInfo | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientIdState] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [emptyPreview, setEmptyPreview] = useState(false);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);

  const reloadClients = useCallback(async () => {
    const { clients } = await api<{ clients: Client[] }>('/api/clients');
    setClients(clients);
    return clients;
  }, []);

  useEffect(() => {
    const t = read('sb.theme');
    if (t === 'dark' || t === 'light') setTheme(t);
    void api<{ user: SessionUser | null; ai: AiInfo }>('/api/auth/me').then((me) => {
      if (!me.user) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      setUser(me.user);
      setAi(me.ai);
    });
    void reloadClients().then((list) => {
      const saved = read('sb.client');
      setClientIdState(list.find((c) => c.id === saved)?.id ?? list[0]?.id ?? null);
    });
  }, [reloadClients]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setClientId = useCallback((id: string) => {
    setClientIdState(id);
    write('sb.client', id);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const n = t === 'dark' ? 'light' : 'dark';
      write('sb.theme', n);
      return n;
    });
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { id, tone, text }]);
    if (tone !== 'danger') setTimeout(() => dismissToast(id), 5000);
  }, [dismissToast]);

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }, []);

  const value = useMemo<AppState>(() => ({
    user,
    ai,
    signOut,
    canEdit: !!user && user.role !== 'viewer',
    clients,
    client: clients.find((c) => c.id === clientId) ?? null,
    setClientId,
    reloadClients,
    theme,
    toggleTheme,
    emptyPreview,
    setEmptyPreview,
    version,
    bump: () => setVersion((v) => v + 1),
    toast,
    toasts,
    dismissToast,
    wizardOpen,
    openWizard: () => setWizardOpen(true),
    closeWizard: () => setWizardOpen(false),
  }), [user, ai, signOut, clients, clientId, setClientId, reloadClients, theme, toggleTheme, emptyPreview, version, toast, toasts, dismissToast, wizardOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

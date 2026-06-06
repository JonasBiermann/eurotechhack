import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setAuthToken, getAuthToken, type Resident } from '../api/client';

interface Auth {
  resident: Resident | null;
  loading: boolean;
  login: (hkid: string) => Promise<void>;
  register: (hkid: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [resident, setResident] = useState<Resident | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore a session from a stored token on first load.
  useEffect(() => {
    if (!getAuthToken()) { setLoading(false); return; }
    api.me()
      .then((r) => setResident(r))
      .catch(() => setAuthToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (hkid: string) => {
    const { token, resident } = await api.login(hkid);
    setAuthToken(token);
    setResident(resident);
  };
  const register = async (hkid: string, name: string) => {
    const { token, resident } = await api.register(hkid, name);
    setAuthToken(token);
    setResident(resident);
  };
  const logout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setAuthToken(null);
    setResident(null);
  };

  return <Ctx.Provider value={{ resident, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

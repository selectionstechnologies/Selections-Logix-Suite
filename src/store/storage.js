import { createJSONStorage } from 'zustand/middleware';

// Private windows and full quotas make localStorage throw. The app must keep working regardless.
export const safeStorage = createJSONStorage(() => ({
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* run in memory only */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
}));

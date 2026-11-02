// Dummy auth. A "session" is simply the role plus the matching seeded demo user.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from './storage.js';
import { users } from '../data/people.js';

export const DEMO_PASSWORD = 'demo123';

export const demoUserFor = (role) => users.find((u) => u.role === role);

export const useAuth = create(
  persist(
    (set) => ({
      user: null,
      loginAs: (role) => set({ user: demoUserFor(role) }),
      /** Returns the user, or null when the credentials do not match a demo account. */
      login: (email, password) => {
        const found = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
        if (!found || password !== DEMO_PASSWORD) return null;
        set({ user: found });
        return found;
      },
      logout: () => set({ user: null }),
    }),
    { name: 'slx-auth', storage: safeStorage },
  ),
);

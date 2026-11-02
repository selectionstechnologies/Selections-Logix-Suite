// UI preferences (language, currency, branch, sidebar), toasts and the confirm dialog.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from './storage.js';
import { uid } from '../utils/format.js';

export const useUI = create(
  persist(
    (set) => ({
      lang: 'en',
      currency: 'PKR',
      branchId: 'ALL',
      collapsed: false,
      setLang: (lang) => set({ lang }),
      setCurrency: (currency) => set({ currency }),
      setBranch: (branchId) => set({ branchId }),
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
    }),
    { name: 'slx-ui', storage: safeStorage },
  ),
);

export const useToasts = create((set) => ({
  toasts: [],
  push: (type, message) => {
    const id = uid('T');
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, type, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (m) => useToasts.getState().push('success', m),
  error: (m) => useToasts.getState().push('error', m),
  info: (m) => useToasts.getState().push('info', m),
};

export const useConfirmStore = create((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

/** Promise-based confirm: `if (await confirm({ title, message, danger })) ...` */
export const confirm = (opts) => new Promise((resolve) => {
  useConfirmStore.getState().open({ confirmLabel: 'Confirm', danger: true, ...opts, resolve });
});

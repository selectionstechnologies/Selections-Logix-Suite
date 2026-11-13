// Operational store. Shipments, COD, deposits and payouts come from the database (via the api
// function); settings and the audit log stay in this browser. Branches, customers, riders and users are loaded from the database (hooks/useDbSync.js).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { seed } from '../data/index.js';
import { safeStorage } from './storage.js';
import { useAuth } from './authStore.js';
import { uid } from '../utils/format.js';
import {
  apiAddNote, apiAssignRider, apiChangeStatus, apiCreatePayout, apiCreateShipment, apiMarkPayoutPaid, apiReconcileDeposit, apiRecordDeposit,
  apiSetPayoutStatus, apiUpdateShipment,
} from '../lib/api.js';
import { ROLE_LABELS } from '../data/config.js';

const nowISO = () => new Date().toISOString();
// Loaded from the database on sign-in and kept fresh; never saved in the browser.
const DB_KEYS = ['branches', 'merchants', 'riders', 'users', 'rateCard', 'shipments', 'codTransactions', 'riderDeposits', 'payouts'];

const actor = () => {
  const u = useAuth.getState().user;
  return { name: u?.name || 'System', role: u ? ROLE_LABELS[u.role] : 'System' };
};

const audit = (entity, action, detail) => {
  const a = actor();
  return { id: uid('AU'), at: nowISO(), user: a.name, role: a.role, entity, action, detail, ip: '10.20.0.1' };
};

const withAudit = (state, entity, action, detail) => [audit(entity, action, detail), ...state.auditLog];

export const useData = create(
  persist(
    (set, get) => ({
      ...seed(),

      // ---- generic CRUD ----
      addItem: (col, item, entity, detail) => set((s) => ({
        [col]: [item, ...s[col]],
        auditLog: withAudit(s, entity || col, 'Created', detail || item.id),
      })),
      updateItem: (col, id, patch, entity, detail) => set((s) => ({
        [col]: s[col].map((x) => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)),
        auditLog: withAudit(s, entity || col, 'Updated', detail || id),
      })),
      removeItem: (col, id, entity) => set((s) => ({
        [col]: s[col].filter((x) => x.id !== id),
        auditLog: withAudit(s, entity || col, 'Deleted', id),
      })),
      setValue: (key, value, entity, detail) => set((s) => ({
        [key]: value,
        auditLog: withAudit(s, entity || key, 'Updated', detail || key),
      })),
      resetDemo: () => set((s) => ({ ...seed(), branches: s.branches, merchants: s.merchants, riders: s.riders, users: s.users })),
      logPrint: (kind, refs, size) => set((s) => ({
        printHistory: [{ id: uid('PR'), kind, refs, size, at: nowISO(), by: actor().name }, ...s.printHistory].slice(0, 100),
      })),

      // ---- shipments and the COD chain ----
      // The api function does the work (pricing, AWB numbers, permissions) and returns the rows it
      // changed; they are merged in here so the screen updates without waiting for the next sync.
      mergeRows: (changes = {}) => set((st) => {
        const out = {};
        for (const [key, rows] of Object.entries({
          shipments: changes.shipments || (changes.shipment ? [changes.shipment] : []),
          codTransactions: changes.codTransactions || [],
          riderDeposits: changes.deposit ? [changes.deposit] : [],
          payouts: changes.payout ? [changes.payout] : [],
        })) {
          if (!rows.length) continue;
          const byId = new Map(rows.map((r) => [r.id, r]));
          const kept = st[key].map((x) => byId.get(x.id) || x);
          const fresh = rows.filter((r) => !st[key].some((x) => x.id === r.id));
          out[key] = [...fresh, ...kept];
        }
        return out;
      }),

      /** Books a shipment. The server prices it and assigns the AWB. Returns the saved shipment. */
      createShipment: async (form) => {
        const res = await apiCreateShipment(form);
        get().mergeRows(res);
        set((st) => ({ auditLog: withAudit(st, 'Shipment', 'Created', `${res.shipment.awb} booked`) }));
        return res.shipment;
      },

      /** Applies a status change where the flow and the caller's role allow it. Returns { ok, skipped }. */
      changeStatus: async (ids, status, opts = {}) => {
        const res = await apiChangeStatus(Array.isArray(ids) ? ids : [ids], status, opts);
        get().mergeRows(res);
        if (res.ok) set((st) => ({ auditLog: withAudit(st, 'Shipment', 'Status changed', `${res.ok} shipment(s) -> ${status}`) }));
        return { ok: res.ok, skipped: res.skipped };
      },

      assignRider: async (ids, riderId) => {
        const res = await apiAssignRider(Array.isArray(ids) ? ids : [ids], riderId);
        get().mergeRows(res);
        return res.shipments?.length || 0;
      },

      addShipmentNote: async (id, text) => { get().mergeRows(await apiAddNote(id, text)); },

      /** patch: { eta } and/or { receiver: {...} } */
      updateShipment: async (id, patch) => { get().mergeRows(await apiUpdateShipment(id, patch)); },

      /** Rider hands in today's cash. Collected COD moves to Deposited pending reconciliation. Returns the deposit or null. */
      recordDeposit: async (riderId, deposited, note = '') => {
        const res = await apiRecordDeposit(riderId, deposited, note);
        get().mergeRows(res);
        return res.deposit;
      },

      reconcileDeposit: async (depositId) => { get().mergeRows(await apiReconcileDeposit(depositId)); },

      /** Reconciled COD not in an open payout, for one merchant or all. */
      payableTxns: (merchantId) => get().codTransactions.filter((t) => t.status === 'Reconciled' && !t.payoutId && (!merchantId || t.merchantId === merchantId)),

      /** Builds a payout for a merchant's unbatched reconciled COD. Returns null if nothing is due. */
      createPayout: async (merchantId, returns = 0) => {
        const res = await apiCreatePayout(merchantId, returns);
        get().mergeRows(res);
        return res.payout;
      },

      setPayoutStatus: async (id, status) => { get().mergeRows(await apiSetPayoutStatus(id, status)); },

      markPayoutPaid: async (id, reference) => { get().mergeRows(await apiMarkPayoutPaid(id, reference)); },
    }),
    {
      name: 'slx-data',
      // Version 2 dropped the sample data. Anything saved by version 1 was sample-based, so start clean.
      version: 4,
      // v1 held sample data (dropped). v3 made A5 the default label size. v4 moved shipments,
      // COD, deposits and payouts to the database, so old browser copies are dropped.
      migrate: (state, version) => {
        if (version < 2 || !state) return {};
        const next = { ...state };
        if (version < 3) next.settings = { ...(state.settings || {}), labelFormat: 'a5' };
        DB_KEYS.forEach((k) => { delete next[k]; });
        return next;
      },
      // Database-backed lists are reloaded on every sign-in, so they are not kept in the browser.
      partialize: (s) => Object.fromEntries(Object.entries(s).filter(([k, v]) => typeof v !== 'function' && !DB_KEYS.includes(k))),
      storage: safeStorage,
      // Functions are not serialised; merge keeps fresh actions over persisted data.
      merge: (persisted, current) => ({ ...current, ...(persisted || {}) }),
    },
  ),
);

export const useCollection = (key) => useData((s) => s[key]);

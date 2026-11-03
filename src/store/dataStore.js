// The mock backend: every collection lives here and every write records an audit entry.
// State persists to localStorage so a booking survives refresh and is visible on the
// public tracking page in another tab. Settings > Reset demo data restores the seed.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { seed } from '../data/index.js';
import { CITY_MAP } from '../data/geo.js';
import { safeStorage } from './storage.js';
import { useAuth } from './authStore.js';
import { quote } from '../utils/pricing.js';
import { STATUS, NEXT_STATUS } from '../utils/status.js';
import { uid, sum, toPKR } from '../utils/format.js';
import { ROLE_LABELS } from '../data/people.js';

const nowISO = () => new Date().toISOString();

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
      resetDemo: () => set({ ...seed() }),
      logPrint: (kind, refs, size) => set((s) => ({
        printHistory: [{ id: uid('PR'), kind, refs, size, at: nowISO(), by: actor().name }, ...s.printHistory].slice(0, 100),
      })),

      // ---- shipments ----
      createShipment: (form) => {
        const s = get();
        const nextNo = Math.max(...s.shipments.map((x) => Number(x.awb.replace('SLX', '')))) + 1;
        const awb = `SLX${nextNo}`;
        const origin = CITY_MAP[form.sender.city];
        const dest = CITY_MAP[form.receiver.city];
        const international = origin.country !== dest.country;
        const service = international ? 'international' : form.service === 'international' ? 'economy' : form.service;
        const currency = dest.currency;
        const merchant = s.merchants.find((m) => m.id === form.merchantId);
        const override = s.merchantOverrides.find((o) => o.merchantId === form.merchantId) || { discountPct: merchant?.discountPct };
        const q = quote({
          originCity: form.sender.city, destCity: form.receiver.city, service,
          weight: form.weight, length: form.length, width: form.width, height: form.height,
          cod: form.cod, declaredValue: form.declaredValue, insurance: form.insurance, packaging: form.packaging, currency,
        }, s.rateCard, override);
        const days = { 'same-day': 1, 'next-day': 2, economy: 4, international: 7 }[service];
        const created = nowISO();
        const a = actor();
        // Bulk import sends no payment type: COD if an amount is set, otherwise prepaid.
        const paymentType = form.paymentType || (Number(form.cod) > 0 ? 'cod' : 'prepaid');
        const PAYMENT_STATUS = { cash: 'Paid in cash', online: 'Paid online', credit: 'Billed to account', 'cod-deduct': 'Deduct from COD' };
        const payment = paymentType === 'topay'
          ? { method: 'topay', status: 'Due on delivery', amount: q.total }
          : form.payment?.method ? { ...form.payment, amount: q.total, status: PAYMENT_STATUS[form.payment.method] || 'Paid' } : null;
        const shipment = {
          id: awb, awb,
          merchantId: form.merchantId,
          originBranchId: origin.branchId,
          destBranchId: dest.branchId,
          originCity: form.sender.city,
          destCity: form.receiver.city,
          courier: form.courier || 'Selections Express',
          service, status: STATUS.BOOKED, currency,
          sender: form.sender,
          receiver: { ...form.receiver, region: dest.region },
          productType: form.productType || 'parcel',
          parcel: {
            weight: Number(form.weight), length: Number(form.length) || 0, width: Number(form.width) || 0, height: Number(form.height) || 0,
            declaredValue: Number(form.declaredValue) || 0,
            items: (form.items || []).map((i) => ({ ...i, qty: Number(i.qty) || 1, value: Number(i.value) || 0 })),
            packaging: form.packaging || 'none',
            pieces: Number(form.pieces) || form.items?.length || 1, insurance: !!form.insurance,
          },
          notes: form.notes || '',
          paymentType,
          payment,
          toPay: paymentType === 'topay' ? q.total : 0,
          cod: Number(form.cod) || 0,
          codStatus: Number(form.cod) > 0 ? 'Pending' : 'None',
          createdAt: created,
          eta: new Date(Date.now() + days * 86400000).toISOString(),
          riderId: null, pickupRiderId: null, ndr: null, pod: null, manifestId: null,
          charges: { base: q.base, weight: q.weight, fuel: q.fuel, remote: q.remote, codFee: q.codFee, insurance: q.insurance, packaging: q.packaging, tax: q.tax, total: q.total },
          cost: q.cost, chargeableWeight: q.chargeableWeight, zone: q.zone,
          events: [{ status: STATUS.BOOKED, at: created, location: form.sender.city, by: a.name, note: `Booked by ${a.name}` }],
          activity: [{ at: created, by: a.name, text: `Shipment ${awb} created${payment ? ` (${payment.status})` : ''}` }],
        };
        set((st) => ({ shipments: [shipment, ...st.shipments], auditLog: withAudit(st, 'Shipment', 'Created', `${awb} booked`) }));
        return shipment;
      },

      /** Applies a status change where the flow allows it. Returns { ok, skipped } counts. */
      changeStatus: (ids, status, opts = {}) => {
        const list = Array.isArray(ids) ? ids : [ids];
        const a = actor();
        const at = nowISO();
        let ok = 0;
        let skipped = 0;
        const newTxns = [];
        set((st) => {
          const shipments = st.shipments.map((sh) => {
            if (!list.includes(sh.id)) return sh;
            if (!NEXT_STATUS[sh.status]?.includes(status)) { skipped += 1; return sh; }
            ok += 1;
            const location = [STATUS.BOOKED, STATUS.PICKED, STATUS.ORIGIN, STATUS.RETURNED, STATUS.CANCELLED].includes(status) ? sh.originCity : sh.destCity;
            const next = {
              ...sh,
              status,
              events: [...sh.events, { status, at, location: opts.location || location, by: a.name, note: opts.note || status }],
              activity: [...sh.activity, { at, by: a.name, text: `Status changed to ${status}${opts.note ? `: ${opts.note}` : ''}` }],
            };
            if (status === STATUS.CANCELLED) { next.riderId = null; next.pickupRiderId = null; if (next.cod) next.codStatus = 'None'; }
            if (status === STATUS.FAILED) {
              next.ndr = { reason: opts.reason || 'Customer not available', attempts: (sh.ndr?.attempts || 0) + 1, nextAttempt: null };
            }
            if (status === STATUS.REATTEMPT) {
              next.ndr = { ...(sh.ndr || { reason: 'Rescheduled', attempts: 1 }), nextAttempt: opts.nextAttempt || null };
            }
            if ((status === STATUS.RTO) && next.cod) next.codStatus = 'None';
            if (status === STATUS.DELIVERED) {
              next.pod = { receivedBy: opts.receivedBy || sh.receiver.name, method: opts.method || 'Signature', at };
              if (next.cod > 0) {
                // Delivery creates the cash trail: rider now holds this COD.
                next.codStatus = 'Collected';
                newTxns.push({
                  id: uid('COD'), awb: sh.awb, shipmentId: sh.id, riderId: sh.riderId, merchantId: sh.merchantId,
                  branchId: sh.destBranchId, amount: sh.cod, currency: sh.currency, status: 'Collected', collectedAt: at, depositId: null,
                });
              }
            }
            return next;
          });
          // Log RTO rows so they appear on the Returns screen.
          const returnsAdded = status === STATUS.RTO ? shipments.filter((sh) => list.includes(sh.id) && sh.status === STATUS.RTO && !st.returnsList.some((r) => r.shipmentId === sh.id)).map((sh) => ({
            id: uid('RT'), awb: sh.awb, shipmentId: sh.id, merchantId: sh.merchantId, branchId: sh.originBranchId,
            reason: sh.ndr?.reason || 'Return requested', charge: Math.round(sh.charges.base * 0.6) || 100, currency: sh.currency,
            status: 'In Return', decision: '', date: at,
          })) : [];
          return {
            shipments,
            codTransactions: [...newTxns, ...st.codTransactions],
            returnsList: [...returnsAdded, ...st.returnsList],
            auditLog: ok ? withAudit(st, 'Shipment', 'Status changed', `${ok} shipment(s) -> ${status}`) : st.auditLog,
          };
        });
        return { ok, skipped };
      },

      assignRider: (ids, riderId) => {
        const a = actor();
        const at = nowISO();
        const list = Array.isArray(ids) ? ids : [ids];
        set((st) => {
          const rider = st.riders.find((r) => r.id === riderId);
          return {
            shipments: st.shipments.map((sh) => {
              if (!list.includes(sh.id)) return sh;
              const pickup = sh.status === STATUS.BOOKED;
              return {
                ...sh,
                ...(pickup ? { pickupRiderId: riderId } : { riderId }),
                activity: [...sh.activity, { at, by: a.name, text: `${pickup ? 'Pickup' : 'Delivery'} assigned to ${rider?.name || riderId}` }],
              };
            }),
            auditLog: withAudit(st, 'Shipment', 'Rider assigned', `${list.length} shipment(s) -> ${rider?.name}`),
          };
        });
      },

      addShipmentNote: (id, text) => {
        const a = actor();
        set((st) => ({ shipments: st.shipments.map((sh) => (sh.id === id ? { ...sh, activity: [...sh.activity, { at: nowISO(), by: a.name, text }] } : sh)) }));
      },

      /** Rider hands in today's cash. Collected COD moves to Deposited pending accountant reconciliation. */
      recordDeposit: (riderId, deposited, note = '') => {
        const st = get();
        const txns = st.codTransactions.filter((t) => t.riderId === riderId && t.status === 'Collected');
        if (!txns.length) return null;
        const rider = st.riders.find((r) => r.id === riderId);
        const dep = {
          id: uid('DEP'), riderId, branchId: rider.branchId, currency: txns[0].currency,
          expected: sum(txns, (t) => t.amount), deposited: Number(deposited),
          status: 'Pending', txnIds: txns.map((t) => t.id), at: nowISO(), note,
        };
        const ids = new Set(dep.txnIds);
        const shipIds = new Set(txns.map((t) => t.shipmentId));
        set((s) => ({
          riderDeposits: [dep, ...s.riderDeposits],
          codTransactions: s.codTransactions.map((t) => (ids.has(t.id) ? { ...t, status: 'Deposited', depositId: dep.id } : t)),
          shipments: s.shipments.map((sh) => (shipIds.has(sh.id) ? { ...sh, codStatus: 'Deposited' } : sh)),
          auditLog: withAudit(s, 'Finance', 'Cash deposit recorded', `${rider.name}: ${dep.deposited} of ${dep.expected} ${dep.currency}`),
        }));
        return dep;
      },

      reconcileDeposit: (depositId) => {
        const dep = get().riderDeposits.find((d) => d.id === depositId);
        if (!dep) return;
        const ids = new Set(dep.txnIds);
        const shipIds = new Set(get().codTransactions.filter((t) => ids.has(t.id)).map((t) => t.shipmentId));
        set((s) => ({
          riderDeposits: s.riderDeposits.map((d) => (d.id === depositId ? { ...d, status: 'Reconciled' } : d)),
          codTransactions: s.codTransactions.map((t) => (ids.has(t.id) ? { ...t, status: 'Reconciled' } : t)),
          shipments: s.shipments.map((sh) => (shipIds.has(sh.id) ? { ...sh, codStatus: 'Reconciled' } : sh)),
          auditLog: withAudit(s, 'Finance', 'Deposit reconciled', `${depositId} (${dep.deposited} / ${dep.expected} ${dep.currency})`),
        }));
      },

      /** Reconciled COD not in any open payout, for one merchant or all. */
      payableTxns: (merchantId) => {
        const s = get();
        const locked = new Set(s.payouts.filter((p) => p.status !== 'Rejected').flatMap((p) => p.txnIds));
        return s.codTransactions.filter((t) => t.status === 'Reconciled' && !locked.has(t.id) && (!merchantId || t.merchantId === merchantId));
      },

      /** Build a payout for a merchant's unbatched reconciled COD. Returns null if nothing is due. */
      createPayout: (merchantId, returns = 0) => {
        const st = get();
        const txns = st.payableTxns(merchantId);
        if (!txns.length) return null;
        const ship = (t) => st.shipments.find((x) => x.id === t.shipmentId);
        const gross = Math.round(sum(txns, (t) => toPKR(t.amount, t.currency)));
        const shipping = Math.round(sum(txns, (t) => { const x = ship(t); return x ? toPKR(x.charges.total - x.charges.codFee, x.currency) : 0; }));
        const codFee = Math.round(sum(txns, (t) => { const x = ship(t); return x ? toPKR(x.charges.codFee, x.currency) : 0; }));
        const po = {
          id: uid('PO'), batch: `BATCH-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`, merchantId,
          txnIds: txns.map((t) => t.id), shipments: txns.length, gross, shipping, codFee, returns: Number(returns) || 0,
          net: gross - shipping - codFee - (Number(returns) || 0), status: 'Pending', createdAt: nowISO(), paidAt: null, reference: '',
        };
        set((s) => ({ payouts: [po, ...s.payouts], auditLog: withAudit(s, 'Finance', 'Payout created', `${po.id}: Rs ${po.net}`) }));
        return po;
      },

      markPayoutPaid: (id, reference) => {
        const po = get().payouts.find((p) => p.id === id);
        if (!po) return;
        const ids = new Set(po.txnIds);
        const shipIds = new Set(get().codTransactions.filter((t) => ids.has(t.id)).map((t) => t.shipmentId));
        set((s) => ({
          payouts: s.payouts.map((p) => (p.id === id ? { ...p, status: 'Paid', paidAt: nowISO(), reference } : p)),
          codTransactions: s.codTransactions.map((t) => (ids.has(t.id) ? { ...t, status: 'Paid' } : t)),
          shipments: s.shipments.map((sh) => (shipIds.has(sh.id) ? { ...sh, codStatus: 'Paid' } : sh)),
          auditLog: withAudit(s, 'Finance', 'Payout paid', `${id} ref ${reference}`),
        }));
      },

      /** Stock change with a matching movement row. Refuses to go below zero. */
      moveStock: (skuId, delta, type, note = '') => {
        const item = get().inventory.find((i) => i.id === skuId);
        if (!item || item.stock + delta < 0) return false;
        const a = actor();
        set((s) => ({
          inventory: s.inventory.map((i) => (i.id === skuId ? { ...i, stock: i.stock + delta } : i)),
          stockMoves: [{ id: uid('MV'), skuId, type, qty: Math.abs(delta), date: nowISO(), by: a.name, note }, ...s.stockMoves],
          auditLog: withAudit(s, 'Warehouse', type, `${item.sku} ${delta > 0 ? '+' : ''}${delta}`),
        }));
        return true;
      },
    }),
    {
      name: 'slx-data',
      version: 1,
      storage: safeStorage,
      // Functions are not serialised; merge keeps fresh actions over persisted data.
      merge: (persisted, current) => ({ ...current, ...(persisted || {}) }),
    },
  ),
);

export const useCollection = (key) => useData((s) => s[key]);

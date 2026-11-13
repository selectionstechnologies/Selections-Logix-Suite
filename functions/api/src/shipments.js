// Shipments and the COD chain: booking, status changes, rider assignment, notes, COD collection,
// rider deposits, reconciliation and merchant payouts. Ported from the app's local store so the
// rules are the same, but now the server prices bookings, numbers AWBs and decides who may act.
//
// Who sees a row (read permissions): Super Admin and accountants everything; branch managers and
// warehouse staff of the origin or destination branch; the merchant who owns it; the assigned riders.
import {
  ApiError, ID, LABEL, Query, Role, T, createRow, getRowOrNull, isActive, isSuper, listAll, nextCode, read, updateRow,
} from './context.js';
import { assert, checkPhone, nz } from './validate.js';
import { CITY_MAP } from './shared/geo.js';
import { DEFAULT_RATE_CARD, quote } from './shared/pricing.js';
import { NEXT_STATUS, STATUS } from './shared/status.js';
import { toPKR } from './shared/fx.js';

const nowISO = () => new Date().toISOString();
const sum = (arr, fn) => arr.reduce((n, x) => n + (Number(fn(x)) || 0), 0);
const SERVICES = ['same-day', 'next-day', 'economy', 'international'];
const PAYMENT_STATUS = { cash: 'Paid in cash', online: 'Paid online', credit: 'Billed to account', 'cod-deduct': 'Deduct from COD' };
const TERM_RULES = { cod: { paymentType: 'cod' }, topay: { paymentType: 'topay' }, credit: { paymentType: 'prepaid', method: 'credit' }, debit: { paymentType: 'prepaid' } };

// ---------------------------------------------------------------- row <-> shipment
// Columns hold what is filtered or secured on; `data` (JSON) holds the rest of the shipment.
const COLS = {
  awb: 'awb', merchantId: 'merchant_id', originBranchId: 'origin_branch_id', destBranchId: 'dest_branch_id', originCity: 'origin_city',
  destCity: 'dest_city', status: 'status', service: 'service', paymentType: 'payment_type', payTerm: 'pay_term', plan: 'plan', cod: 'cod',
  codStatus: 'cod_status', currency: 'currency', riderId: 'rider_id', pickupRiderId: 'pickup_rider_id', createdBy: 'created_by', eta: 'eta',
};

function toRow(sh) {
  const row = {};
  const data = { ...sh };
  for (const [k, col] of Object.entries(COLS)) { row[col] = sh[k] ?? null; delete data[k]; }
  delete data.id;
  row.total = Number(sh.charges?.total) || 0;
  row.cod = Number(sh.cod) || 0;
  row.data = JSON.stringify(data);
  return row;
}

export function toShipment(row) {
  let data = {};
  try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
  const sh = { ...data, id: row.$id };
  for (const [k, col] of Object.entries(COLS)) sh[k] = row[col] ?? null;
  sh.cod = Number(row.cod) || 0;
  return sh;
}

const toTxn = (r) => ({
  id: r.$id, shipmentId: r.shipment_id, awb: r.awb, riderId: r.rider_id, merchantId: r.merchant_id, branchId: r.branch_id,
  amount: Number(r.amount) || 0, currency: r.currency, status: r.status, collectedAt: r.collected_at, depositId: r.deposit_id, payoutId: r.payout_id,
});
const parseIds = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
const toDeposit = (r) => ({
  id: r.$id, riderId: r.rider_id, branchId: r.branch_id, currency: r.currency, expected: Number(r.expected) || 0, deposited: Number(r.deposited) || 0,
  status: r.status, txnIds: parseIds(r.txn_ids), at: r.at, note: r.note || '',
});
const toPayout = (r) => ({
  id: r.$id, batch: r.batch, merchantId: r.merchant_id, txnIds: parseIds(r.txn_ids), shipments: r.shipments, gross: r.gross, shipping: r.shipping,
  codFee: r.cod_fee, returns: r.returns, net: r.net, status: r.status, createdAt: r.$createdAt, paidAt: r.paid_at, reference: r.reference || '',
});

// ---------------------------------------------------------------- who may see / act
async function myRiderId(db, me) {
  if (me.role !== 'rider') return null;
  const [r] = await listAll(db, T.riders, [Query.equal('profile_id', me.id)]);
  return r?.$id || null;
}

async function shipmentPerms(db, sh) {
  const cust = sh.merchantId ? await getRowOrNull(db, T.customers, sh.merchantId) : null;
  const riders = await Promise.all([sh.riderId, sh.pickupRiderId].filter(Boolean).map((id) => getRowOrNull(db, T.riders, id)));
  return read([
    Role.label(LABEL.super_admin), Role.label('accountant'),
    ...[sh.originBranchId, sh.destBranchId].filter(Boolean).flatMap((b) => [Role.team(b, 'manager'), Role.team(b, 'warehouse')]),
    cust?.profile_id ? Role.user(cust.profile_id) : null,
    ...riders.map((r) => (r?.profile_id ? Role.user(r.profile_id) : null)),
  ]);
}

async function moneyPerms(db, { merchantId, riderId, branchId }) {
  const cust = merchantId ? await getRowOrNull(db, T.customers, merchantId) : null;
  const rider = riderId ? await getRowOrNull(db, T.riders, riderId) : null;
  return read([
    Role.label(LABEL.super_admin), Role.label('accountant'),
    branchId ? Role.team(branchId, 'manager') : null,
    cust?.branch_id && cust.branch_id !== branchId ? Role.team(cust.branch_id, 'manager') : null,
    cust?.profile_id ? Role.user(cust.profile_id) : null,
    rider?.profile_id ? Role.user(rider.profile_id) : null,
  ]);
}

const inBranch = (me, sh) => [sh.originBranchId, sh.destBranchId].includes(me.branch_id);
const isFinance = (me) => isActive(me) && ['super_admin', 'accountant'].includes(me.role);

async function loadShipment(ctx, id) {
  const row = await getRowOrNull(ctx.db, T.shipments, String(id || ''));
  assert(row, `Shipment ${id} not found`, 404);
  return toShipment(row);
}

async function saveShipment(ctx, sh, permsChanged = false) {
  const perms = permsChanged ? await shipmentPerms(ctx.db, sh) : undefined;
  const row = await updateRow(ctx.db, T.shipments, sh.id, toRow(sh), perms);
  return toShipment(row);
}

// ---------------------------------------------------------------- booking
async function rateCard(db) {
  const row = await getRowOrNull(db, T.pricing, 'default');
  if (!row?.card) return DEFAULT_RATE_CARD;
  try { return { ...DEFAULT_RATE_CARD, ...JSON.parse(row.card) }; } catch { return DEFAULT_RATE_CARD; }
}

/** form: the Create Shipment form values. The server prices it and assigns the AWB. */
export async function createShipment(ctx, me, { form = {} }) {
  const { db } = ctx;
  const cust = form.merchantId ? await getRowOrNull(db, T.customers, form.merchantId) : null;
  assert(cust, 'Choose the customer account');
  assert(cust.status === 'Active', 'This customer account is not active');
  const allowed = isSuper(me) || (me.role === 'merchant' && cust.profile_id === me.id) || (me.role === 'branch_manager' && cust.branch_id === me.branch_id);
  if (!allowed) throw new ApiError('You cannot book for this customer account.', 403);

  const sender = form.sender || {};
  const receiver = form.receiver || {};
  const origin = CITY_MAP[sender.city];
  const dest = CITY_MAP[receiver.city];
  assert(origin && dest, 'Choose the sender and receiver cities');
  assert(nz(sender.name) && nz(sender.address) && nz(receiver.name) && nz(receiver.address), 'Sender and receiver need a name and an address');
  checkPhone(nz(sender.phone));
  checkPhone(nz(receiver.phone));
  assert(nz(receiver.phone), 'Receiver phone is required');
  const weight = Number(form.weight);
  assert(weight > 0 && weight <= 40000, 'Enter a valid weight');

  const international = origin.country !== dest.country;
  const service = international ? 'international' : form.service === 'international' ? 'economy' : form.service;
  assert(SERVICES.includes(service), 'Choose a service');
  const currency = dest.currency;

  // Payment must match a payment type on the account (when the account has them).
  const terms = Array.isArray(cust.payment_types) ? cust.payment_types : [];
  const payTerm = nz(form.payTerm);
  if (terms.length) {
    assert(payTerm && terms.includes(payTerm), 'Choose a payment type that is enabled on this customer account');
    const rule = TERM_RULES[payTerm];
    assert(form.paymentType === rule.paymentType, 'Payment type does not match the account');
    if (rule.method) assert(form.payment?.method === rule.method, 'Payment method does not match the account');
  }
  const paymentType = form.paymentType || (Number(form.cod) > 0 ? 'cod' : 'prepaid');
  assert(['prepaid', 'cod', 'topay'].includes(paymentType), 'Choose a payment type');
  const cod = paymentType === 'cod' ? Number(form.cod) || 0 : 0;
  assert(paymentType !== 'cod' || cod > 0, 'Enter the COD amount');

  const q = quote({
    originCity: sender.city, destCity: receiver.city, service, weight, length: form.length, width: form.width, height: form.height,
    cod, declaredValue: form.declaredValue, insurance: form.insurance, packaging: form.packaging, currency,
  }, await rateCard(db), { discountPct: Number(cust.discount_pct) || 0 });

  const days = { 'same-day': 1, 'next-day': 2, economy: 4, international: 7 }[service];
  const created = nowISO();
  const by = me.full_name || 'User';
  const payment = paymentType === 'topay'
    ? { method: 'topay', status: 'Due on delivery', amount: q.total }
    : form.payment?.method ? { ...form.payment, amount: q.total, status: PAYMENT_STATUS[form.payment.method] || 'Paid' } : null;
  const awb = `SLX${await nextCode(db, 'awb', 100000)}`;

  const sh = {
    id: awb, awb, merchantId: cust.$id, originBranchId: origin.branchId, destBranchId: dest.branchId,
    originCity: sender.city, destCity: receiver.city, courier: nz(form.courier) || 'Selections Express',
    service, status: STATUS.BOOKED, currency,
    sender: { name: nz(sender.name), phone: nz(sender.phone), address: nz(sender.address), city: sender.city },
    receiver: { ...receiver, region: dest.region },
    productType: nz(form.productType) || 'parcel', plan: nz(form.plan), payTerm,
    parcel: {
      weight, length: Number(form.length) || 0, width: Number(form.width) || 0, height: Number(form.height) || 0,
      declaredValue: Number(form.declaredValue) || 0,
      items: (form.items || []).slice(0, 100).map((i) => ({ ...i, qty: Number(i.qty) || 1, value: Number(i.value) || 0 })),
      packaging: nz(form.packaging) || 'none', pieces: Number(form.pieces) || 1, insurance: !!form.insurance,
    },
    notes: String(form.notes || '').slice(0, 300), paymentType, payment, toPay: paymentType === 'topay' ? q.total : 0,
    cod, codStatus: cod > 0 ? 'Pending' : 'None', createdAt: created, createdBy: me.id,
    eta: new Date(Date.now() + days * 86400000).toISOString(),
    riderId: null, pickupRiderId: null, ndr: null, pod: null, manifestId: null,
    charges: { base: q.base, weight: q.weight, fuel: q.fuel, remote: q.remote, codFee: q.codFee, insurance: q.insurance, packaging: q.packaging, tax: q.tax, total: q.total },
    cost: q.cost, chargeableWeight: q.chargeableWeight, zone: q.zone,
    events: [{ status: STATUS.BOOKED, at: created, location: sender.city, by, note: `Booked by ${by}` }],
    activity: [{ at: created, by, text: `Shipment ${awb} created${payment ? ` (${payment.status})` : ''}` }],
  };
  const row = await createRow(db, T.shipments, toRow(sh), await shipmentPerms(db, sh), awb);
  return { shipment: toShipment(row) };
}

// ---------------------------------------------------------------- status
function mayChangeStatus(me, sh, status, riderId) {
  if (isSuper(me)) return true;
  if (['branch_manager', 'warehouse'].includes(me.role)) return inBranch(me, sh);
  if (me.role === 'merchant') return status === STATUS.CANCELLED && sh.status === STATUS.BOOKED; // ownership checked by caller
  if (me.role === 'rider' && riderId) {
    if (status === STATUS.PICKED) return sh.pickupRiderId === riderId;
    return sh.riderId === riderId && [STATUS.OFD, STATUS.DELIVERED, STATUS.FAILED].includes(status);
  }
  return false;
}

export async function changeStatus(ctx, me, { ids, status, opts = {} }) {
  const { db } = ctx;
  const list = (Array.isArray(ids) ? ids : [ids]).slice(0, 200);
  assert(Object.values(STATUS).includes(status), 'Unknown status');
  const riderId = await myRiderId(db, me);
  const by = me.full_name || 'User';
  const at = nowISO();
  let ok = 0;
  let skipped = 0;
  const shipments = [];
  const codTransactions = [];
  for (const id of list) {
    const sh = await loadShipment(ctx, id);
    const ownMerchant = me.role === 'merchant' ? (await getRowOrNull(db, T.customers, sh.merchantId))?.profile_id === me.id : true;
    if (!ownMerchant || !mayChangeStatus(me, sh, status, riderId) || !NEXT_STATUS[sh.status]?.includes(status)) { skipped += 1; continue; }
    ok += 1;
    const location = [STATUS.BOOKED, STATUS.PICKED, STATUS.ORIGIN, STATUS.RETURNED, STATUS.CANCELLED].includes(status) ? sh.originCity : sh.destCity;
    const note = String(opts.note || status).slice(0, 300);
    sh.status = status;
    sh.events = [...(sh.events || []), { status, at, location: nz(opts.location) || location, by, note }];
    sh.activity = [...(sh.activity || []), { at, by, text: `Status changed to ${status}${opts.note ? `: ${note}` : ''}` }];
    let permsChanged = false;
    if (status === STATUS.CANCELLED) { sh.riderId = null; sh.pickupRiderId = null; permsChanged = true; if (sh.cod) sh.codStatus = 'None'; }
    if (status === STATUS.FAILED) sh.ndr = { reason: nz(opts.reason) || 'Customer not available', attempts: (sh.ndr?.attempts || 0) + 1, nextAttempt: null };
    if (status === STATUS.REATTEMPT) sh.ndr = { ...(sh.ndr || { reason: 'Rescheduled', attempts: 1 }), nextAttempt: nz(opts.nextAttempt) };
    if (status === STATUS.RTO && sh.cod) sh.codStatus = 'None';
    if (status === STATUS.DELIVERED) {
      sh.pod = { receivedBy: nz(opts.receivedBy) || sh.receiver?.name, method: nz(opts.method) || 'Signature', at };
      if (sh.cod > 0) {
        // Delivery creates the cash trail: the rider now holds this COD.
        sh.codStatus = 'Collected';
        const txn = {
          shipment_id: sh.id, awb: sh.awb, rider_id: sh.riderId, merchant_id: sh.merchantId, branch_id: sh.destBranchId,
          amount: sh.cod, currency: sh.currency, status: 'Collected', collected_at: at, deposit_id: null, payout_id: null,
        };
        const row = await createRow(db, T.codTxns, txn, await moneyPerms(db, { merchantId: sh.merchantId, riderId: sh.riderId, branchId: sh.destBranchId }));
        codTransactions.push(toTxn(row));
      }
    }
    shipments.push(await saveShipment(ctx, sh, permsChanged));
  }
  return { ok, skipped, shipments, codTransactions };
}

// ---------------------------------------------------------------- rider, notes, edits
export async function assignRider(ctx, me, { ids, riderId }) {
  const { db } = ctx;
  const rider = await getRowOrNull(db, T.riders, String(riderId || ''));
  assert(rider && rider.status !== 'Inactive', 'Choose an active rider');
  const by = me.full_name || 'User';
  const at = nowISO();
  const shipments = [];
  for (const id of (Array.isArray(ids) ? ids : [ids]).slice(0, 200)) {
    const sh = await loadShipment(ctx, id);
    if (!(isSuper(me) || (me.role === 'branch_manager' && inBranch(me, sh)))) throw new ApiError('You cannot assign riders to this shipment.', 403);
    const pickup = sh.status === STATUS.BOOKED;
    if (pickup) sh.pickupRiderId = rider.$id; else sh.riderId = rider.$id;
    sh.activity = [...(sh.activity || []), { at, by, text: `${pickup ? 'Pickup' : 'Delivery'} assigned to ${rider.full_name}` }];
    shipments.push(await saveShipment(ctx, sh, true));
  }
  return { shipments };
}

async function canSee(ctx, me, sh) {
  if (isFinance(me)) return true;
  if (['branch_manager', 'warehouse'].includes(me.role)) return inBranch(me, sh);
  if (me.role === 'merchant') return (await getRowOrNull(ctx.db, T.customers, sh.merchantId))?.profile_id === me.id;
  if (me.role === 'rider') { const r = await myRiderId(ctx.db, me); return Boolean(r) && [sh.riderId, sh.pickupRiderId].includes(r); }
  return false;
}

export async function addNote(ctx, me, { id, text }) {
  const sh = await loadShipment(ctx, id);
  if (!(await canSee(ctx, me, sh))) throw new ApiError('You cannot see this shipment.', 403);
  const t = String(text || '').trim().slice(0, 500);
  assert(t, 'Write a note');
  sh.activity = [...(sh.activity || []), { at: nowISO(), by: me.full_name || 'User', text: t }];
  return { shipment: await saveShipment(ctx, sh) };
}

/** patch: { eta } and/or { receiver: { name, phone, address, landmark } } */
export async function updateShipment(ctx, me, { id, patch = {} }) {
  const sh = await loadShipment(ctx, id);
  if (!(isSuper(me) || (me.role === 'branch_manager' && inBranch(me, sh)))) throw new ApiError('You cannot edit this shipment.', 403);
  const notes = [];
  if (patch.eta) { assert(!Number.isNaN(new Date(patch.eta).getTime()), 'Enter a valid date'); sh.eta = new Date(patch.eta).toISOString(); notes.push(`Rescheduled to ${sh.eta.slice(0, 10)}`); }
  if (patch.receiver) {
    const r = patch.receiver;
    for (const k of ['name', 'phone', 'address', 'landmark', 'altPhone']) if (r[k] !== undefined) sh.receiver[k] = nz(r[k]);
    checkPhone(sh.receiver.phone);
    notes.push('Receiver details edited');
  }
  sh.activity = [...(sh.activity || []), ...notes.map((text) => ({ at: nowISO(), by: me.full_name || 'User', text }))];
  return { shipment: await saveShipment(ctx, sh) };
}

/** Public tracking: only what a receiver may see. */
export async function track(ctx, { awb }) {
  const row = await getRowOrNull(ctx.db, T.shipments, String(awb || '').trim().toUpperCase());
  if (!row) return { shipment: null };
  const sh = toShipment(row);
  return {
    shipment: {
      awb: sh.awb, status: sh.status, originCity: sh.originCity, destCity: sh.destCity, service: sh.service, eta: sh.eta,
      events: (sh.events || []).map((e) => ({ status: e.status, at: e.at, location: e.location })),
    },
  };
}

// ---------------------------------------------------------------- COD: deposits and reconciliation
async function setCodStatus(ctx, shipmentIds, codStatus) {
  const out = [];
  for (const id of new Set(shipmentIds)) {
    const sh = await loadShipment(ctx, id).catch(() => null);
    if (sh) { sh.codStatus = codStatus; out.push(await saveShipment(ctx, sh)); }
  }
  return out;
}

/** Rider hands in today's cash. Collected COD moves to Deposited until an accountant reconciles it. */
export async function recordDeposit(ctx, me, { riderId, deposited, note = '' }) {
  const { db } = ctx;
  const rider = await getRowOrNull(db, T.riders, String(riderId || ''));
  assert(rider, 'Rider not found');
  const self = me.role === 'rider' && rider.profile_id === me.id;
  if (!(self || isFinance(me) || (me.role === 'branch_manager' && rider.branch_id === me.branch_id))) throw new ApiError('You cannot record this deposit.', 403);
  const amount = Number(deposited);
  assert(Number.isFinite(amount) && amount >= 0, 'Enter the amount handed in');
  const txns = await listAll(db, T.codTxns, [Query.equal('rider_id', rider.$id), Query.equal('status', 'Collected')]);
  if (!txns.length) return { deposit: null };
  const dep = {
    rider_id: rider.$id, branch_id: rider.branch_id, currency: txns[0].currency, expected: sum(txns, (t) => t.amount), deposited: amount,
    status: 'Pending', txn_ids: JSON.stringify(txns.map((t) => t.$id)), at: nowISO(), note: String(note || '').slice(0, 300),
  };
  const depRow = await createRow(db, T.deposits, dep, await moneyPerms(db, { riderId: rider.$id, branchId: rider.branch_id }));
  const codTransactions = [];
  for (const t of txns) codTransactions.push(toTxn(await updateRow(db, T.codTxns, t.$id, { status: 'Deposited', deposit_id: depRow.$id })));
  const shipments = await setCodStatus(ctx, txns.map((t) => t.shipment_id), 'Deposited');
  return { deposit: toDeposit(depRow), codTransactions, shipments };
}

export async function reconcileDeposit(ctx, me, { depositId }) {
  if (!isFinance(me)) throw new ApiError('Only an accountant or the Super Admin can reconcile.', 403);
  const { db } = ctx;
  const dep = await getRowOrNull(db, T.deposits, String(depositId || ''));
  assert(dep, 'Deposit not found');
  assert(dep.status === 'Pending', 'This deposit is already reconciled');
  const ids = parseIds(dep.txn_ids);
  const codTransactions = [];
  const shipIds = [];
  for (const id of ids) {
    const t = await getRowOrNull(db, T.codTxns, id);
    if (!t) continue;
    shipIds.push(t.shipment_id);
    codTransactions.push(toTxn(await updateRow(db, T.codTxns, id, { status: 'Reconciled' })));
  }
  const depRow = await updateRow(db, T.deposits, dep.$id, { status: 'Reconciled' });
  return { deposit: toDeposit(depRow), codTransactions, shipments: await setCodStatus(ctx, shipIds, 'Reconciled') };
}

// ---------------------------------------------------------------- payouts
export async function createPayout(ctx, me, { merchantId, returns = 0 }) {
  const { db } = ctx;
  const cust = await getRowOrNull(db, T.customers, String(merchantId || ''));
  assert(cust, 'Customer account not found');
  if (!(isFinance(me) || (me.role === 'merchant' && cust.profile_id === me.id))) throw new ApiError('You cannot create this payout.', 403);
  // Reconciled COD that is not already in an open payout.
  const txns = (await listAll(db, T.codTxns, [Query.equal('merchant_id', cust.$id), Query.equal('status', 'Reconciled')])).filter((t) => !t.payout_id);
  if (!txns.length) return { payout: null };
  const ships = {};
  for (const t of txns) ships[t.shipment_id] = await loadShipment(ctx, t.shipment_id).catch(() => null);
  const gross = Math.round(sum(txns, (t) => toPKR(t.amount, t.currency)));
  const shipping = Math.round(sum(txns, (t) => { const x = ships[t.shipment_id]; return x ? toPKR(x.charges.total - x.charges.codFee, x.currency) : 0; }));
  const codFee = Math.round(sum(txns, (t) => { const x = ships[t.shipment_id]; return x ? toPKR(x.charges.codFee, x.currency) : 0; }));
  const ret = Math.max(Number(returns) || 0, 0);
  const po = {
    batch: `BATCH-${nowISO().slice(2, 10).replace(/-/g, '')}`, merchant_id: cust.$id, txn_ids: JSON.stringify(txns.map((t) => t.$id)), shipments: txns.length,
    gross, shipping, cod_fee: codFee, returns: ret, net: gross - shipping - codFee - ret, status: 'Pending', paid_at: null, reference: null,
  };
  const row = await createRow(db, T.payouts, po, await moneyPerms(db, { merchantId: cust.$id, branchId: cust.branch_id }), ID.unique());
  const codTransactions = [];
  for (const t of txns) codTransactions.push(toTxn(await updateRow(db, T.codTxns, t.$id, { payout_id: row.$id })));
  return { payout: toPayout(row), codTransactions };
}

/** Approve or reject. A rejected payout frees its COD for the next batch. */
export async function setPayoutStatus(ctx, me, { id, status }) {
  if (!isFinance(me)) throw new ApiError('Only an accountant or the Super Admin can do this.', 403);
  assert(['Approved', 'Rejected'].includes(status), 'Choose approve or reject');
  const { db } = ctx;
  const po = await getRowOrNull(db, T.payouts, String(id || ''));
  assert(po, 'Payout not found');
  assert(!['Paid', 'Rejected'].includes(po.status), `This payout is already ${po.status.toLowerCase()}`);
  const codTransactions = [];
  if (status === 'Rejected') {
    for (const tid of parseIds(po.txn_ids)) codTransactions.push(toTxn(await updateRow(db, T.codTxns, tid, { payout_id: null })));
  }
  return { payout: toPayout(await updateRow(db, T.payouts, po.$id, { status })), codTransactions };
}

export async function markPayoutPaid(ctx, me, { id, reference }) {
  if (!isFinance(me)) throw new ApiError('Only an accountant or the Super Admin can do this.', 403);
  const { db } = ctx;
  const po = await getRowOrNull(db, T.payouts, String(id || ''));
  assert(po, 'Payout not found');
  assert(po.status !== 'Paid', 'This payout is already paid');
  assert(po.status !== 'Rejected', 'A rejected payout cannot be paid');
  const ref = String(reference || '').trim().slice(0, 100);
  assert(ref, 'Enter the payment reference');
  const codTransactions = [];
  const shipIds = [];
  for (const tid of parseIds(po.txn_ids)) {
    const t = await getRowOrNull(db, T.codTxns, tid);
    if (!t) continue;
    shipIds.push(t.shipment_id);
    codTransactions.push(toTxn(await updateRow(db, T.codTxns, tid, { status: 'Paid' })));
  }
  const row = await updateRow(db, T.payouts, po.$id, { status: 'Paid', paid_at: nowISO(), reference: ref });
  return { payout: toPayout(row), codTransactions, shipments: await setCodStatus(ctx, shipIds, 'Paid') };
}

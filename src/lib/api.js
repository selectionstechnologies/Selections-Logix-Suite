// Database calls, one function per operation. Pages use these instead of talking to Appwrite
// directly, so table names live in one place. Reads go to the tables (row permissions decide
// what each role sees); writes go through the `api` function (functions/api).
import { BUCKET, ID, Query, T, callApi, friendlyError, getRow, listAll, storage } from './appwrite.js';

export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export const DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
// Company Docs: CNIC, NTN, cheque, registration etc. together in one PDF.
export const DOC_TYPES = ['Company Docs', 'Agreement', 'Other'];
export const RATE_CARDS = ['Standard', 'Merchant Plus', 'Corporate Contract'];
export const VEHICLE_TYPES = ['Motorcycle', 'Bicycle', 'Car', 'Van', 'Truck'];
export const SHIFTS = ['Morning', 'Evening', 'Night', 'General'];

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
const groupBy = (rows, key) => rows.reduce((acc, r) => { (acc[r[key]] ||= []).push(r); return acc; }, {});
const nameOf = (branches, id) => (id && branches[id] ? { name: branches[id].name } : null);

// ---------------------------------------------------------------- auth / profile
export async function fetchMyProfile(userId) {
  const profile = await getRow(T.profiles, userId);
  if (!profile) return null;
  const [customer, rider] = await Promise.all([
    profile.role === 'merchant' ? listAll(T.customers, [Query.equal('profile_id', userId)]).then((r) => r[0]) : null,
    profile.role === 'rider' ? listAll(T.riders, [Query.equal('profile_id', userId)]).then((r) => r[0]) : null,
  ]);
  return { ...profile, customer_id: customer?.id || null, rider_id: rider?.id || null };
}

/** Basic profile rows (for the operations store). */
export const listProfiles = () => listAll(T.profiles, [Query.orderAsc('full_name')]);

// ---------------------------------------------------------------- users (Super Admin)
export async function listUsers() {
  const [profiles, branches, staff, riders, customers] = await Promise.all([
    listAll(T.profiles, [Query.orderDesc('$createdAt')]), listBranches(), listAll(T.staff), listAll(T.riders), listAll(T.customers),
  ]);
  const b = byId(branches);
  const staffById = byId(staff);
  const riderByProfile = Object.fromEntries(riders.filter((r) => r.profile_id).map((r) => [r.profile_id, r]));
  const customerByProfile = Object.fromEntries(customers.filter((c) => c.profile_id).map((c) => [c.profile_id, c]));
  return profiles.map((p) => ({
    ...p,
    branch: nameOf(b, p.branch_id),
    staff: staffById[p.id] || null,
    rider: riderByProfile[p.id] || null,
    customer: customerByProfile[p.id] ? { id: customerByProfile[p.id].id, account_no: customerByProfile[p.id].account_no, business_name: customerByProfile[p.id].business_name } : null,
  }));
}

export const createUser = (payload) => callApi('users.create', payload);
export const updateUser = (id, payload) => callApi('users.update', { id, ...payload });
export const setUserPassword = (id, password) => callApi('users.set_password', { id, password });

// ---------------------------------------------------------------- branches
export const listBranches = () => listAll(T.branches, [Query.orderAsc('$id')]);
export const saveBranch = (row, isNew) => callApi('branches.save', { row, isNew });
export const deleteBranch = (id) => callApi('branches.delete', { id });

// ---------------------------------------------------------------- banks
export async function listBanks() {
  const rows = await listAll(T.banks, [Query.equal('active', true), Query.orderAsc('name')]);
  return rows.map(({ name, country }) => ({ name, country }));
}

// ---------------------------------------------------------------- customers
/** Customers with branch name, pickup addresses, document count and portal login. */
export async function listCustomers() {
  const [customers, branches, pickups, docs, profiles] = await Promise.all([
    listAll(T.customers, [Query.orderDesc('$createdAt')]), listBranches(),
    listAll(T.pickups, [Query.orderAsc('sort_order')]), listAll(T.documents, [Query.select(['$id', 'customer_id'])]), listAll(T.profiles, [Query.equal('role', 'merchant')]),
  ]);
  const b = byId(branches);
  const pk = groupBy(pickups, 'customer_id');
  const dc = groupBy(docs, 'customer_id');
  const pr = byId(profiles);
  return customers.map((c) => ({
    ...c,
    branch: nameOf(b, c.branch_id),
    pickups: pk[c.id] || [],
    docs: (dc[c.id] || []).length,
    login: c.profile_id && pr[c.profile_id] ? { id: c.profile_id, email: pr[c.profile_id].email, status: pr[c.profile_id].status } : null,
  }));
}

const mapDoc = (d) => ({ ...d, uploaded_at: d.created_at });

export async function getCustomer(id) {
  const c = await getRow(T.customers, id);
  if (!c) return null;
  const [branch, login, pickups, contacts, documents, bankAccounts] = await Promise.all([
    getRow(T.branches, c.branch_id),
    getRow(T.profiles, c.profile_id),
    listAll(T.pickups, [Query.equal('customer_id', id), Query.orderAsc('sort_order')]),
    listAll(T.contacts, [Query.equal('customer_id', id), Query.orderAsc('sort_order')]),
    listAll(T.documents, [Query.equal('customer_id', id), Query.orderDesc('$createdAt')]),
    listAll(T.bankAccounts, [Query.equal('customer_id', id), Query.orderAsc('sort_order')]).catch(() => []),
  ]);
  return {
    ...c,
    branch: branch ? { name: branch.name } : null,
    login: login ? { id: login.id, email: login.email, status: login.status } : null,
    pickups, contacts, documents: documents.map(mapDoc),
    // Older customers have only the single bank detail on the customer row.
    bank_accounts: bankAccounts.length ? bankAccounts
      : c.iban ? [{ bank_name: c.bank_name, account_title: c.account_title, iban: c.iban, is_primary: true }] : [],
  };
}

/** Customers with no portal login yet (for linking a merchant user). */
export const listCustomersWithoutLogin = () => listAll(T.customers, [Query.isNull('profile_id'), Query.orderAsc('business_name')]);

/** payload: { id?, customer: {...}, pickups: [...], contacts: [...], banks: [...] } -> customer id */
export const saveCustomer = (payload) => callApi('customers.save', payload).then((r) => r.id);
export const setCustomerStatus = (id, patch) => callApi('customers.set_status', { id, patch });
export const deleteCustomer = (id) => callApi('customers.delete', { id });

// ---------------------------------------------------------------- customer documents
export function validateDoc(file) {
  if (file.size > MAX_DOC_BYTES) return `${file.name} is larger than 10 MB`;
  if (!DOC_MIME.includes(file.type)) return `${file.name}: only PDF, JPG, PNG or WEBP files are allowed`;
  return null;
}

/** Uploads to the private bucket, then the api function records it and sets who may read it. */
export async function uploadCustomerDoc(customerId, docType, file) {
  const problem = validateDoc(file);
  if (problem) throw new Error(problem);
  let uploaded;
  try {
    uploaded = await storage.createFile({ bucketId: BUCKET, fileId: ID.unique(), file });
  } catch (e) {
    throw new Error(friendlyError(e.message));
  }
  try {
    return mapDoc(await callApi('documents.register', { customer_id: customerId, doc_type: docType, file_id: uploaded.$id, file_name: file.name }));
  } catch (e) {
    await storage.deleteFile({ bucketId: BUCKET, fileId: uploaded.$id }).catch(() => {});
    throw e;
  }
}

export const deleteCustomerDoc = (doc) => callApi('documents.delete', { id: doc.id });

/** Short-lived link that opens the file, or downloads it under its original name. */
export async function docDownloadUrl(doc, download = true) {
  const { token, file_id: fileId } = await callApi('documents.link', { id: doc.id });
  const params = { bucketId: BUCKET, fileId, token };
  return download ? storage.getFileDownload(params) : storage.getFileView(params);
}

// ---------------------------------------------------------------- riders
export async function listRiders() {
  const [riders, branches] = await Promise.all([listAll(T.riders, [Query.orderAsc('code')]), listBranches()]);
  const b = byId(branches);
  return riders.map((r) => ({ ...r, branch: nameOf(b, r.branch_id) }));
}

// ---------------------------------------------------------------- receivers (per customer account)
const last10 = (phone = '') => String(phone).replace(/\D/g, '').slice(-10);

/** The saved receiver for this phone number under this customer, or null. */
export async function findReceiver(customerId, phone) {
  const key = last10(phone);
  if (!customerId || key.length < 10) return null;
  const rows = await listAll(T.receivers, [Query.equal('customer_id', customerId), Query.equal('phone_key', key), Query.limit(1)]);
  return rows[0] || null;
}

/** Another saved receiver (different number) already using this CNIC, or null. */
export async function findReceiverByCnic(customerId, cnic, exceptPhone) {
  if (!customerId || !cnic) return null;
  const q = [Query.equal('customer_id', customerId), Query.equal('cnic', cnic), Query.limit(1)];
  if (exceptPhone) q.push(Query.notEqual('phone_key', last10(exceptPhone)));
  const rows = await listAll(T.receivers, q);
  return rows[0] || null;
}

/** Save after a booking: new number creates a receiver, a known number updates it. */
export const saveReceiver = (customerId, r) => callApi('receivers.save', {
  customer_id: customerId, phone: r.phone, alt_phone: r.altPhone || '', name: r.name, cnic: r.cnic || '',
  address: r.address, landmark: r.landmark || '', city: r.city, zone: r.zone || '',
}).then((x) => x.id);

// ---------------------------------------------------------------- pricing (rate card)
/** The saved rate card, or null when none has been saved yet (the app then uses its defaults). */
export async function getPricing() {
  // A list query returns nothing (instead of a 404 in the console) when no rate card is saved yet.
  const [row] = await listAll(T.pricing, [Query.equal('$id', 'default')]);
  if (!row?.card) return null;
  try { return JSON.parse(row.card); } catch { return null; }
}

/** Super Admin only (enforced by the api function). */
export const savePricing = (card) => callApi('pricing.save', { card });

// ---------------------------------------------------------------- shipments and the COD chain
// Rows are read straight from the tables (each row's permissions decide who sees it);
// every change goes through the api function, which prices bookings and checks the caller.
const SHIP_COLS = {
  awb: 'awb', merchantId: 'merchant_id', originBranchId: 'origin_branch_id', destBranchId: 'dest_branch_id', originCity: 'origin_city',
  destCity: 'dest_city', status: 'status', service: 'service', paymentType: 'payment_type', payTerm: 'pay_term', plan: 'plan', cod: 'cod',
  codStatus: 'cod_status', currency: 'currency', riderId: 'rider_id', pickupRiderId: 'pickup_rider_id', createdBy: 'created_by', eta: 'eta',
};
export function mapShipmentRow(row) {
  let data = {};
  try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
  const sh = { ...data, id: row.id || row.$id };
  for (const [k, col] of Object.entries(SHIP_COLS)) sh[k] = row[col] ?? null;
  sh.cod = Number(row.cod) || 0;
  sh.events = sh.events || [];
  sh.activity = sh.activity || [];
  return sh;
}
const parseIds = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
const mapTxn = (r) => ({
  id: r.id, shipmentId: r.shipment_id, awb: r.awb, riderId: r.rider_id, merchantId: r.merchant_id, branchId: r.branch_id,
  amount: Number(r.amount) || 0, currency: r.currency, status: r.status, collectedAt: r.collected_at, depositId: r.deposit_id, payoutId: r.payout_id,
});
const mapDeposit = (r) => ({
  id: r.id, riderId: r.rider_id, branchId: r.branch_id, currency: r.currency, expected: Number(r.expected) || 0, deposited: Number(r.deposited) || 0,
  status: r.status, txnIds: parseIds(r.txn_ids), at: r.at, note: r.note || '',
});
const mapPayout = (r) => ({
  id: r.id, batch: r.batch, merchantId: r.merchant_id, txnIds: parseIds(r.txn_ids), shipments: r.shipments, gross: r.gross, shipping: r.shipping,
  codFee: r.cod_fee, returns: r.returns, net: r.net, status: r.status, createdAt: r.created_at, paidAt: r.paid_at, reference: r.reference || '',
});

export const listShipments = () => listAll(T.shipments, [Query.orderDesc('$createdAt')]).then((rows) => rows.map(mapShipmentRow));
export const listCodTxns = () => listAll(T.codTxns, [Query.orderDesc('$createdAt')]).then((rows) => rows.map(mapTxn));
export const listDeposits = () => listAll(T.deposits, [Query.orderDesc('$createdAt')]).then((rows) => rows.map(mapDeposit));
export const listPayouts = () => listAll(T.payouts, [Query.orderDesc('$createdAt')]).then((rows) => rows.map(mapPayout));

// Each call returns the rows it changed, already in the app's shape.
export const apiCreateShipment = (form) => callApi('shipments.create', { form });
export const apiChangeStatus = (ids, status, opts) => callApi('shipments.status', { ids, status, opts });
export const apiAssignRider = (ids, riderId) => callApi('shipments.assign', { ids, riderId });
export const apiAddNote = (id, text) => callApi('shipments.note', { id, text });
export const apiUpdateShipment = (id, patch) => callApi('shipments.update', { id, patch });
export const apiRecordDeposit = (riderId, deposited, note) => callApi('cod.deposit', { riderId, deposited, note });
export const apiReconcileDeposit = (depositId) => callApi('cod.reconcile', { depositId });
export const apiCreatePayout = (merchantId, returns) => callApi('payouts.create', { merchantId, returns });
export const apiSetPayoutStatus = (id, status) => callApi('payouts.set_status', { id, status });
export const apiMarkPayoutPaid = (id, reference) => callApi('payouts.paid', { id, reference });
/** Public tracking (no login): status, cities, ETA and history only. */
export const trackShipment = (awb) => callApi('track', { awb }).then((r) => r?.shipment || null);

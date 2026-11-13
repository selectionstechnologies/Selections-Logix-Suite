// Database calls, one function per operation. Pages use these instead of talking to Appwrite
// directly, so table names live in one place. Reads go to the tables (row permissions decide
// what each role sees); writes go through the `api` function (functions/api).
import { BUCKET, ID, Query, T, callApi, friendlyError, getRow, listAll, storage } from './appwrite.js';

export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export const DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const DOC_TYPES = ['CNIC Front', 'CNIC Back', 'Cheque', 'NTN Certificate', 'Business Registration', 'Agreement', 'Other'];
export const CUSTOMER_TYPES = ['E-commerce Merchant', 'Corporate', 'SME / Retail', 'Individual', 'Marketplace Seller'];
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
  const [branch, login, pickups, contacts, documents] = await Promise.all([
    getRow(T.branches, c.branch_id),
    getRow(T.profiles, c.profile_id),
    listAll(T.pickups, [Query.equal('customer_id', id), Query.orderAsc('sort_order')]),
    listAll(T.contacts, [Query.equal('customer_id', id), Query.orderAsc('sort_order')]),
    listAll(T.documents, [Query.equal('customer_id', id), Query.orderDesc('$createdAt')]),
  ]);
  return {
    ...c,
    branch: branch ? { name: branch.name } : null,
    login: login ? { id: login.id, email: login.email, status: login.status } : null,
    pickups, contacts, documents: documents.map(mapDoc),
  };
}

/** Customers with no portal login yet (for linking a merchant user). */
export const listCustomersWithoutLogin = () => listAll(T.customers, [Query.isNull('profile_id'), Query.orderAsc('business_name')]);

/** payload: { id?, customer: {...}, pickups: [...], contacts: [...] } -> customer id */
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
  const row = await getRow(T.pricing, 'default');
  if (!row?.card) return null;
  try { return JSON.parse(row.card); } catch { return null; }
}

/** Super Admin only (enforced by the api function). */
export const savePricing = (card) => callApi('pricing.save', { card });

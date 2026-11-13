// Customer accounts with their pickup addresses, contacts, documents and saved receivers.
import {
  ApiError, BUCKET, Query, T, canEditCustomer, canViewCustomer, createRow, customerPerms, deleteRow, getRowOrNull, isManagerOf, isSuper, listAll,
  nextCode, norm, requireSuper, updateRow,
} from './context.js';
import { MSG, assert, checkCnic, checkEmail, checkPhone, isBusinessName, isIban, isNtn, isPersonName, last10, normalizeIban, num, nz } from './validate.js';

const CUSTOMER_TYPES = ['E-commerce Merchant', 'Corporate', 'SME / Retail', 'Individual', 'Marketplace Seller'];
const PLANS = ['cod', 'shipment', 'corporate', 'cargo'];
const DOC_TYPES = ['CNIC Front', 'CNIC Back', 'Cheque', 'NTN Certificate', 'Business Registration', 'Agreement', 'Other'];
const DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_DOC_BYTES = 10 * 1024 * 1024;

async function loadCustomer(db, id) {
  const c = id ? await getRowOrNull(db, T.customers, id) : null;
  assert(c, 'Customer not found or not permitted', 404);
  return c;
}

function customerData(c) {
  const data = {
    business_name: nz(c.business_name), customer_type: nz(c.customer_type), owner_name: nz(c.owner_name), cnic: nz(c.cnic), ntn: nz(c.ntn),
    phone: nz(c.phone), email: nz(c.email)?.toLowerCase() || null, office_address: nz(c.office_address), city: nz(c.city), branch_id: nz(c.branch_id),
    bank_name: nz(c.bank_name), account_title: nz(c.account_title), iban: nz(normalizeIban(c.iban || '')),
    rate_card: nz(c.rate_card) || 'Standard', discount_pct: num(c.discount_pct), credit_limit: num(c.credit_limit),
    status: nz(c.status) || 'Active', kyc_status: nz(c.kyc_status) || 'Pending', notes: nz(c.notes),
    shipping_plans: Array.isArray(c.shipping_plans) ? c.shipping_plans.map(String) : [],
  };
  assert(data.business_name && isBusinessName(data.business_name), 'Business name: use letters, numbers and & . , - ( ) only (2-120 characters)');
  assert(CUSTOMER_TYPES.includes(data.customer_type), 'Choose a valid customer type');
  assert(data.owner_name && isPersonName(data.owner_name), 'Owner name: use letters only (2-80 characters)');
  assert(data.phone, 'Phone is required');
  checkPhone(data.phone);
  checkEmail(data.email);
  checkCnic(data.cnic);
  assert(data.ntn === null || isNtn(data.ntn), MSG.ntn);
  assert(data.iban === null || isIban(data.iban), MSG.iban);
  assert(data.shipping_plans.every((p) => PLANS.includes(p)), MSG.plans);
  assert(data.discount_pct >= 0 && data.discount_pct <= 100, 'Discount must be between 0 and 100');
  assert(data.credit_limit >= 0, 'Credit limit cannot be negative');
  assert(['Active', 'Inactive', 'Suspended'].includes(data.status), 'Choose a valid status');
  assert(['Pending', 'Verified', 'Rejected'].includes(data.kyc_status), 'Choose a valid KYC status');
  return data;
}

function pickupData(p, i, customerId) {
  const same = p.return_same_as_pickup !== false && p.return_same_as_pickup !== 'false';
  const row = {
    customer_id: customerId, label: nz(p.label) || `Pickup ${i + 1}`, address: nz(p.address), city: nz(p.city), contact_name: nz(p.contact_name), phone: nz(p.phone),
    return_same_as_pickup: same, return_address: same ? null : nz(p.return_address), return_city: same ? null : nz(p.return_city), return_phone: same ? null : nz(p.return_phone),
    is_default: i === 0, sort_order: i,
  };
  assert(row.address && row.city, 'Each pickup needs an address and a city');
  assert(same || (row.return_address && row.return_city), MSG.returnAddress);
  checkPhone(row.phone);
  checkPhone(row.return_phone);
  return row;
}

function contactData(p, i, customerId) {
  const row = { customer_id: customerId, name: nz(p.name), designation: nz(p.designation), phone: nz(p.phone), email: nz(p.email), is_primary: i === 0, sort_order: i };
  assert(row.name && row.phone, 'Each contact needs a name and a phone number');
  checkPhone(row.phone);
  checkEmail(row.email);
  return row;
}

async function replaceChildren(db, table, customerId, rows, perms) {
  for (const old of await listAll(db, table, [Query.equal('customer_id', customerId)])) await deleteRow(db, table, old.$id);
  for (const row of rows) await createRow(db, table, row, perms);
}

/** payload: { id?, customer: {...}, pickups: [...], contacts: [...] } -> { id } */
export async function saveCustomer(ctx, me, payload) {
  const { db } = ctx;
  const data = customerData(payload.customer || {});
  const existing = payload.id ? await loadCustomer(db, payload.id) : null;
  // Create by super admin or a branch manager (own branch only). The merchant reads only.
  const allowed = isSuper(me) || (isManagerOf(me, data.branch_id) && (!existing || isManagerOf(me, existing.branch_id)));
  if (!allowed) throw new ApiError('You do not have permission to make this change.', 403);
  if (data.branch_id) assert(await getRowOrNull(db, T.branches, data.branch_id), 'Branch not found');
  if (data.bank_name) assert(await listAll(db, T.banks, [Query.equal('name', data.bank_name), Query.limit(1)]).then((r) => r.length), 'Choose a bank from the list');

  const pickups = Array.isArray(payload.pickups) ? payload.pickups : null;
  const contacts = Array.isArray(payload.contacts) ? payload.contacts : null;
  if (pickups) assert(pickups.length >= 1, 'Add at least one pickup address');

  let customer;
  if (existing) {
    customer = await updateRow(db, T.customers, existing.$id, data, customerPerms({ ...existing, ...data }));
  } else {
    const account_no = `SLX-C${await nextCode(db, 'customer_code', 1000)}`;
    customer = await createRow(db, T.customers, { ...data, account_no, created_by: me.id }, customerPerms(data));
  }
  const perms = customerPerms(customer);
  const branchChanged = existing && existing.branch_id !== customer.branch_id;
  if (pickups) await replaceChildren(db, T.pickups, customer.$id, pickups.map((p, i) => pickupData(p, i, customer.$id)), perms);
  else if (branchChanged) for (const r of await listAll(db, T.pickups, [Query.equal('customer_id', customer.$id)])) await updateRow(db, T.pickups, r.$id, {}, perms);
  if (contacts) await replaceChildren(db, T.contacts, customer.$id, contacts.map((p, i) => contactData(p, i, customer.$id)), perms);
  else if (branchChanged) for (const r of await listAll(db, T.contacts, [Query.equal('customer_id', customer.$id)])) await updateRow(db, T.contacts, r.$id, {}, perms);
  if (branchChanged) {
    for (const table of [T.documents, T.receivers]) {
      for (const r of await listAll(db, table, [Query.equal('customer_id', customer.$id)])) {
        await updateRow(db, table, r.$id, {}, perms);
        if (table === T.documents) await ctx.storage.updateFile({ bucketId: BUCKET, fileId: r.file_id, permissions: perms }).catch(() => {});
      }
    }
  }
  return { id: customer.$id };
}

/** patch: { status } and/or { kyc_status } */
export async function setCustomerStatus(ctx, me, { id, patch = {} }) {
  const c = await loadCustomer(ctx.db, id);
  if (!(isSuper(me) || isManagerOf(me, c.branch_id))) throw new ApiError('You do not have permission to make this change.', 403);
  const data = {};
  if (patch.status !== undefined) { assert(['Active', 'Inactive', 'Suspended'].includes(patch.status), 'Choose a valid status'); data.status = patch.status; }
  if (patch.kyc_status !== undefined) { assert(['Pending', 'Verified', 'Rejected'].includes(patch.kyc_status), 'Choose a valid KYC status'); data.kyc_status = patch.kyc_status; }
  await updateRow(ctx.db, T.customers, id, data);
  return { ok: true };
}

export async function deleteCustomer(ctx, me, { id }) {
  requireSuper(me);
  const { db, storage } = ctx;
  const c = await loadCustomer(db, id);
  for (const doc of await listAll(db, T.documents, [Query.equal('customer_id', id)])) {
    await storage.deleteFile({ bucketId: BUCKET, fileId: doc.file_id }).catch(() => {});
    await deleteRow(db, T.documents, doc.$id);
  }
  for (const table of [T.pickups, T.contacts, T.receivers]) {
    for (const r of await listAll(db, table, [Query.equal('customer_id', id)])) await deleteRow(db, table, r.$id);
  }
  await deleteRow(db, T.customers, c.$id);
  return { ok: true };
}

// ---------------------------------------------------------------- documents
/** The browser uploads the file first; this records it and sets who may read it. */
export async function registerDocument(ctx, me, b) {
  const { db, storage } = ctx;
  const c = await loadCustomer(db, b.customer_id);
  if (!canEditCustomer(me, c)) throw new ApiError('You do not have permission to make this change.', 403);
  assert(DOC_TYPES.includes(b.doc_type), 'Choose a valid document type');
  let file;
  try { file = await storage.getFile({ bucketId: BUCKET, fileId: String(b.file_id || '') }); } catch { throw new ApiError('The uploaded file was not found'); }
  assert(file.sizeOriginal > 0 && file.sizeOriginal <= MAX_DOC_BYTES, `${file.name} is larger than 10 MB`);
  assert(DOC_MIME.includes(file.mimeType), `${file.name}: only PDF, JPG, PNG or WEBP files are allowed`);
  const perms = customerPerms(c);
  await storage.updateFile({ bucketId: BUCKET, fileId: file.$id, permissions: perms });
  const row = await createRow(db, T.documents, {
    customer_id: c.$id, doc_type: b.doc_type, file_name: nz(b.file_name) || file.name, file_id: file.$id, mime_type: file.mimeType, size_bytes: file.sizeOriginal, uploaded_by: me.id,
  }, perms);
  return { ...norm(row), uploaded_at: row.$createdAt };
}

export async function deleteDocument(ctx, me, { id }) {
  const { db, storage } = ctx;
  const doc = await getRowOrNull(db, T.documents, id);
  assert(doc, 'Document not found', 404);
  const c = await loadCustomer(db, doc.customer_id);
  if (!canEditCustomer(me, c)) throw new ApiError('You do not have permission to make this change.', 403);
  await storage.deleteFile({ bucketId: BUCKET, fileId: doc.file_id }).catch((e) => { if (e.code !== 404) throw e; });
  await deleteRow(db, T.documents, doc.$id);
  return { ok: true };
}

/** Short-lived token for viewing / downloading one document. */
export async function documentLink(ctx, me, { id }) {
  const doc = await getRowOrNull(ctx.db, T.documents, id);
  assert(doc, 'Document not found', 404);
  const c = await loadCustomer(ctx.db, doc.customer_id);
  if (!canViewCustomer(me, c)) throw new ApiError('You do not have permission to open this document.', 403);
  const token = await ctx.tokens.createFileToken({ bucketId: BUCKET, fileId: doc.file_id, expire: new Date(Date.now() + 2 * 60 * 1000).toISOString() });
  return { token: token.secret, file_id: doc.file_id, bucket: BUCKET };
}

// ---------------------------------------------------------------- receivers
/** Save after a booking: a new number creates a receiver, a known number updates it and counts the shipment. */
export async function saveReceiver(ctx, me, p) {
  const { db } = ctx;
  const c = await loadCustomer(db, p.customer_id);
  if (!canEditCustomer(me, c)) throw new ApiError('You do not have permission to make this change.', 403);
  const phone = nz(p.phone);
  assert(phone, 'Receiver phone is required');
  checkPhone(phone);
  const key = last10(phone);
  assert(key.length === 10, MSG.phone);
  const name = nz(p.name);
  const address = nz(p.address);
  assert(name && name.length >= 2 && name.length <= 80, 'Receiver name must be 2-80 characters');
  assert(address && address.length >= 5 && address.length <= 250, 'Receiver address must be 5-250 characters');
  const city = nz(p.city);
  assert(city, 'Receiver city is required');
  const altPhone = nz(p.alt_phone);
  checkPhone(altPhone);
  const cnic = nz(p.cnic);
  checkCnic(cnic);
  const data = { customer_id: c.$id, phone, phone_key: key, alt_phone: altPhone, name, address, landmark: nz(p.landmark), city, zone: nz(p.zone), last_used_at: new Date().toISOString() };

  const existing = (await listAll(db, T.receivers, [Query.equal('customer_id', c.$id), Query.equal('phone_key', key), Query.limit(1)]))[0];
  if (existing) {
    const row = await updateRow(db, T.receivers, existing.$id, { ...data, cnic: cnic || existing.cnic || null, shipments_count: (existing.shipments_count || 0) + 1 }, customerPerms(c));
    return { id: row.$id };
  }
  const row = await createRow(db, T.receivers, { ...data, cnic, shipments_count: 1, created_by: me.id }, customerPerms(c));
  return { id: row.$id };
}

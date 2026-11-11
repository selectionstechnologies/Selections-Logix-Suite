// Database calls, one function per operation. Pages use these instead of talking to Supabase directly,
// so table and column names live in one place.
import { friendlyDbError, supabase, unwrap } from './supabase.js';

export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export const DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const DOC_TYPES = ['CNIC Front', 'CNIC Back', 'Cheque', 'NTN Certificate', 'Business Registration', 'Agreement', 'Other'];
export const CUSTOMER_TYPES = ['E-commerce Merchant', 'Corporate', 'SME / Retail', 'Individual', 'Marketplace Seller'];
export const RATE_CARDS = ['Standard', 'Merchant Plus', 'Corporate Contract'];
export const VEHICLE_TYPES = ['Motorcycle', 'Bicycle', 'Car', 'Van', 'Truck'];
export const SHIFTS = ['Morning', 'Evening', 'Night', 'General'];

// ---------------------------------------------------------------- auth / profile
export async function fetchMyProfile(userId) {
  const profile = unwrap(await supabase.from('profiles').select('*').eq('id', userId).maybeSingle());
  if (!profile) return null;
  const [customer, rider] = await Promise.all([
    profile.role === 'merchant' ? supabase.from('customers').select('id').eq('profile_id', userId).maybeSingle().then(unwrap) : null,
    profile.role === 'rider' ? supabase.from('riders').select('id').eq('profile_id', userId).maybeSingle().then(unwrap) : null,
  ]);
  return { ...profile, customer_id: customer?.id || null, rider_id: rider?.id || null };
}

// ---------------------------------------------------------------- users (Super Admin)
export async function listUsers() {
  return unwrap(await supabase
    .from('profiles')
    .select('*, branch:branches(name), staff:staff_details(*), rider:riders(*), customer:customers!customers_profile_id_fkey(id, account_no, business_name)')
    .order('created_at', { ascending: false }));
}

// Name (slug) of the deployed user-management Edge Function. Override with VITE_ADMIN_USERS_FUNCTION in .env.
const ADMIN_FUNCTION = import.meta.env.VITE_ADMIN_USERS_FUNCTION || 'admin-users';

async function callAdmin(body) {
  // The database accepts any correctly signed token, but the Auth server also needs the session
  // behind it to still exist. Check that first; a dead session goes back to the login page.
  const { error: sessionError } = await supabase.auth.getUser();
  if (sessionError) {
    await supabase.auth.signOut().catch(() => {});
    throw new Error('Your session has expired. Please sign in again.');
  }
  const { data, error } = await supabase.functions.invoke(ADMIN_FUNCTION, { body });
  if (error) {
    // The function returns { error } with a 4xx; surface that message instead of the generic one.
    let message = error.message;
    try { message = (await error.context?.json())?.error || message; } catch { /* keep generic */ }
    if (/Failed to send|FunctionsFetchError/i.test(message)) message = `The "${ADMIN_FUNCTION}" Edge Function could not be reached. Check it is deployed under that name (README > Database setup).`;
    if (/Invalid JWT|JWT/i.test(message) && !/Super Admin/.test(message)) message = `The "${ADMIN_FUNCTION}" function refused the sign-in token. Turn OFF "Verify JWT with legacy secret" in its Supabase settings.`;
    throw new Error(friendlyDbError(message));
  }
  if (data?.error) throw new Error(friendlyDbError(data.error));
  return data;
}

export const createUser = (payload) => callAdmin({ action: 'create', ...payload });
export const updateUser = (id, payload) => callAdmin({ action: 'update', id, ...payload });
export const setUserPassword = (id, password) => callAdmin({ action: 'set_password', id, password });

// ---------------------------------------------------------------- branches
export async function listBranches() {
  return unwrap(await supabase.from('branches').select('*').order('id'));
}
export async function saveBranch(row, isNew) {
  const q = isNew ? supabase.from('branches').insert(row) : supabase.from('branches').update(row).eq('id', row.id);
  return unwrap(await q.select().single());
}
export async function deleteBranch(id) {
  return unwrap(await supabase.from('branches').delete().eq('id', id));
}

// ---------------------------------------------------------------- banks
export async function listBanks() {
  return unwrap(await supabase.from('banks').select('name, country').eq('active', true).order('name'));
}

// ---------------------------------------------------------------- customers
export async function listCustomers() {
  return unwrap(await supabase
    .from('customers')
    .select('*, branch:branches(name), pickups:customer_pickup_addresses(count), docs:customer_documents(count), login:profiles!customers_profile_id_fkey(email, status)')
    .order('created_at', { ascending: false }));
}

export async function getCustomer(id) {
  return unwrap(await supabase
    .from('customers')
    .select('*, branch:branches(name), login:profiles!customers_profile_id_fkey(id, email, status), pickups:customer_pickup_addresses(*), contacts:customer_contacts(*), documents:customer_documents(*)')
    .eq('id', id)
    .order('sort_order', { referencedTable: 'customer_pickup_addresses' })
    .order('sort_order', { referencedTable: 'customer_contacts' })
    .order('uploaded_at', { referencedTable: 'customer_documents', ascending: false })
    .maybeSingle());
}

/** Customers with no portal login yet (for linking a merchant user). */
export async function listCustomersWithoutLogin() {
  return unwrap(await supabase.from('customers').select('id, account_no, business_name, email, owner_name, phone, cnic, office_address, city, branch_id').is('profile_id', null).order('business_name'));
}

/** payload: { id?, customer: {...}, pickups: [...], contacts: [...] } -> customer id */
export async function saveCustomer(payload) {
  return unwrap(await supabase.rpc('save_customer', { payload }));
}

export async function setCustomerStatus(id, patch) {
  return unwrap(await supabase.from('customers').update(patch).eq('id', id));
}

export async function deleteCustomer(id) {
  const docs = unwrap(await supabase.from('customer_documents').select('storage_path').eq('customer_id', id));
  if (docs.length) await supabase.storage.from('customer-docs').remove(docs.map((d) => d.storage_path));
  return unwrap(await supabase.from('customers').delete().eq('id', id));
}

// ---------------------------------------------------------------- customer documents
export function validateDoc(file) {
  if (file.size > MAX_DOC_BYTES) return `${file.name} is larger than 10 MB`;
  if (!DOC_MIME.includes(file.type)) return `${file.name}: only PDF, JPG, PNG or WEBP files are allowed`;
  return null;
}

export async function uploadCustomerDoc(customerId, docType, file, userId) {
  const problem = validateDoc(file);
  if (problem) throw new Error(problem);
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${customerId}/${crypto.randomUUID()}-${safeName}`;
  unwrap(await supabase.storage.from('customer-docs').upload(path, file, { contentType: file.type, upsert: false }));
  try {
    return unwrap(await supabase.from('customer_documents').insert({
      customer_id: customerId, doc_type: docType, file_name: file.name, storage_path: path, mime_type: file.type, size_bytes: file.size, uploaded_by: userId,
    }).select().single());
  } catch (e) {
    await supabase.storage.from('customer-docs').remove([path]);
    throw e;
  }
}

export async function deleteCustomerDoc(doc) {
  unwrap(await supabase.storage.from('customer-docs').remove([doc.storage_path]));
  return unwrap(await supabase.from('customer_documents').delete().eq('id', doc.id));
}

/** Short-lived signed link that downloads the file under its original name. */
export async function docDownloadUrl(doc, download = true) {
  const { signedUrl } = unwrap(await supabase.storage.from('customer-docs').createSignedUrl(doc.storage_path, 120, download ? { download: doc.file_name } : undefined));
  return signedUrl;
}

// ---------------------------------------------------------------- riders
export async function listRiders() {
  return unwrap(await supabase.from('riders').select('*, branch:branches(name)').order('code'));
}

// ---------------------------------------------------------------- receivers (per customer account)
const last10 = (phone = '') => String(phone).replace(/\D/g, '').slice(-10);

/** The saved receiver for this phone number under this customer, or null. */
export async function findReceiver(customerId, phone) {
  const key = last10(phone);
  if (!customerId || key.length < 10) return null;
  return unwrap(await supabase.from('receivers').select('*').eq('customer_id', customerId).eq('phone_key', key).maybeSingle());
}

/** Another saved receiver (different number) already using this CNIC, or null. */
export async function findReceiverByCnic(customerId, cnic, exceptPhone) {
  if (!customerId || !cnic) return null;
  let q = supabase.from('receivers').select('id, name, phone, phone_key').eq('customer_id', customerId).eq('cnic', cnic);
  if (exceptPhone) q = q.neq('phone_key', last10(exceptPhone));
  const rows = unwrap(await q.limit(1));
  return rows[0] || null;
}

/** Save after a booking: new number creates a receiver, a known number updates it. */
export async function saveReceiver(customerId, r) {
  return unwrap(await supabase.rpc('save_receiver', {
    payload: {
      customer_id: customerId, phone: r.phone, alt_phone: r.altPhone || '', name: r.name, cnic: r.cnic || '',
      address: r.address, landmark: r.landmark || '', city: r.city, zone: r.zone || '',
    },
  }));
}

// ---------------------------------------------------------------- pricing (rate card)
/** The saved rate card, or null when none has been saved yet (the app then uses its defaults). */
export async function getPricing() {
  const row = unwrap(await supabase.from('pricing').select('card, updated_at').eq('id', 'default').maybeSingle());
  return row?.card || null;
}

/** Super Admin only (enforced by the database). */
export async function savePricing(card) {
  const { data: { user } } = await supabase.auth.getUser();
  return unwrap(await supabase.from('pricing').upsert({ id: 'default', card, updated_by: user?.id || null }).select('updated_at').single());
}

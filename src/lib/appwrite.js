// Single Appwrite client for the app. The project id is safe in the browser: every write goes
// through the `api` function (functions/api), which checks the caller's role, and reads only
// return rows whose permissions include the signed-in user.
import { Account, Client, ExecutionMethod, Functions, ID, Query, Storage, TablesDB } from 'appwrite';

export { ID, Query };

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT;
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID;
export const appwriteConfigured = Boolean(endpoint && projectId);

export const DB = 'logix';
export const BUCKET = 'customer-docs';
export const API_FUNCTION = import.meta.env.VITE_APPWRITE_API_FUNCTION || 'api';
export const T = {
  branches: 'branches',
  banks: 'banks',
  profiles: 'profiles',
  staff: 'staff_details',
  riders: 'riders',
  customers: 'customers',
  pickups: 'customer_pickup_addresses',
  contacts: 'customer_contacts',
  bankAccounts: 'customer_bank_accounts',
  documents: 'customer_documents',
  receivers: 'receivers',
  pricing: 'pricing',
  shipments: 'shipments',
  codTxns: 'cod_transactions',
  deposits: 'rider_deposits',
  payouts: 'payouts',
};

export const client = appwriteConfigured ? new Client().setEndpoint(endpoint).setProject(projectId) : null;
export const account = client && new Account(client);
export const tablesDB = client && new TablesDB(client);
export const storage = client && new Storage(client);
export const functions = client && new Functions(client);

// ---------------------------------------------------------------- "Remember me"
// The SDK keeps the session in localStorage (key cookieFallback), so it would survive closing the
// browser. With "Remember me" off, a marker in sessionStorage says this browser session signed
// in; a fresh browser session without the marker drops the stored session instead of using it.
const REMEMBER_KEY = 'slx-remember';
const SESSION_MARK = 'slx-session';
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
export const getRemember = () => safe(() => localStorage.getItem(REMEMBER_KEY) !== '0', true);
export const setRemember = (on) => safe(() => localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'));
export const markSession = () => safe(() => sessionStorage.setItem(SESSION_MARK, '1'));
export const clearStoredSession = () => safe(() => { localStorage.removeItem('cookieFallback'); sessionStorage.removeItem(SESSION_MARK); });
/** False when a session from a previous browser session must not be reused. */
export const storedSessionAllowed = () => getRemember() || safe(() => sessionStorage.getItem(SESSION_MARK) === '1', false);

// ---------------------------------------------------------------- errors
// Rule names from the api function -> what to tell the user (most messages already read well).
export function friendlyError(message = '') {
  if (/user_blocked|blocked/i.test(message)) return 'Your account is inactive. Contact the Super Admin.';
  if (/Invalid credentials/i.test(message)) return 'Email or password is incorrect.';
  if (/Rate limit/i.test(message)) return 'Too many attempts. Wait a minute and try again.';
  if (/missing scope|not authorized|unauthorized/i.test(message)) return 'You do not have permission to make this change.';
  if (/Failed to fetch|NetworkError|Network request failed/i.test(message)) return 'Could not reach the server. Check your connection and the Appwrite platform (hostname) settings.';
  return message || 'Request failed';
}

// ---------------------------------------------------------------- rows
/** Appwrite row -> the shape the screens use (id, created_at, updated_at). */
export const norm = (row) => (row ? { ...row, id: row.$id, created_at: row.$createdAt, updated_at: row.$updatedAt } : row);

/** Every row the user may read that matches, 100 at a time. */
export async function listAll(tableId, queries = []) {
  const out = [];
  let cursor = null;
  for (;;) {
    const q = [...queries, Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])];
    const { rows } = await tablesDB.listRows({ databaseId: DB, tableId, queries: q });
    out.push(...rows.map(norm));
    if (rows.length < 100) return out;
    cursor = rows[rows.length - 1].$id;
  }
}

export async function getRow(tableId, rowId) {
  if (!rowId) return null;
  try { return norm(await tablesDB.getRow({ databaseId: DB, tableId, rowId })); } catch (e) {
    if (e.code === 404) return null;
    throw new Error(friendlyError(e.message));
  }
}

// ---------------------------------------------------------------- the api function
/** Calls functions/api with { action, ...payload }. Throws with a readable message. */
export async function callApi(action, payload = {}) {
  let exec;
  try {
    exec = await functions.createExecution({ functionId: API_FUNCTION, body: JSON.stringify({ action, ...payload }), method: ExecutionMethod.POST });
  } catch (e) {
    if (e.code === 404) throw new Error(`The "${API_FUNCTION}" function is not deployed. Run: npx appwrite push functions (README > Backend setup).`);
    if (e.code === 401) throw new Error('Your session has expired. Please sign in again.');
    throw new Error(friendlyError(e.message));
  }
  let data = null;
  try { data = exec.responseBody ? JSON.parse(exec.responseBody) : null; } catch { data = null; }
  if (exec.status === 'failed' || (exec.status !== 'completed' && !data)) {
    throw new Error(`The "${API_FUNCTION}" function failed${exec.errors ? `: ${String(exec.errors).slice(0, 200)}` : ''}. Check its logs in the Appwrite console.`);
  }
  if (exec.responseStatusCode >= 400 || data?.error) throw new Error(friendlyError(data?.error || `Request failed (${exec.responseStatusCode})`));
  return data;
}

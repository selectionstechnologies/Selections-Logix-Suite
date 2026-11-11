// Single Supabase client for the app. The publishable (anon) key is safe in the browser:
// row level security in supabase/migrations decides what each signed-in role can read or write.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && key);

// "Remember me" on the login page: when on, the session lives in localStorage and survives
// closing the browser; when off, it lives in sessionStorage and ends with the browser session.
const REMEMBER_KEY = 'slx-remember';
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
export const getRemember = () => safe(() => localStorage.getItem(REMEMBER_KEY) !== '0', true);
export const setRemember = (on) => safe(() => localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'));
const store = () => (getRemember() ? localStorage : sessionStorage);
const authStorage = {
  getItem: (k) => safe(() => store().getItem(k)),
  setItem: (k, v) => safe(() => {
    store().setItem(k, v);
    (getRemember() ? sessionStorage : localStorage).removeItem(k); // keep only one copy
  }),
  removeItem: (k) => safe(() => { localStorage.removeItem(k); sessionStorage.removeItem(k); }),
};

export const supabase = supabaseConfigured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'slx-auth-session', storage: authStorage } })
  : null;

// Database rule names (supabase/migrations) -> what to tell the user.
const RULE_MESSAGES = {
  phone_valid: 'A phone number is not valid. Use 0300 1234567, +92 300 1234567 or +971 50 123 4567.',
  email_valid: 'An email address is not valid.',
  cnic_valid: 'CNIC must be 13 digits: 35202-1234567-1.',
  customers_cnic_check: 'CNIC must be 13 digits: 35202-1234567-1.',
  ntn_valid: 'NTN must be 1234567-8 or a 13-digit CNIC.',
  customers_iban_check: 'The IBAN is not valid.',
  return_address_required: 'Each pickup needs a return address, or tick "same as pickup".',
  customers_shipping_plans_check: 'Choose a valid shipping plan.',
  receivers_phone_unique: 'This phone number is already saved for another receiver.',
};
export function friendlyDbError(message = '') {
  const rule = Object.keys(RULE_MESSAGES).find((k) => message.includes(k));
  if (rule) return RULE_MESSAGES[rule];
  if (/duplicate key/.test(message)) return 'This record already exists (a value that must be unique is already used).';
  if (/row-level security/.test(message)) return 'You do not have permission to make this change.';
  return message || 'Request failed';
}

/** Throws the Supabase error (with a readable message) or returns data. */
export function unwrap({ data, error }) {
  if (error) throw new Error(friendlyDbError(error.message));
  return data;
}

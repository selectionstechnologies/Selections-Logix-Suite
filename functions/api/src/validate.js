// Server-side field rules. Same rules as src/utils/validation.js in the app, so bad data is
// refused even when it does not come through the app's forms.
import { ApiError } from './context.js';

const compact = (v = '') => String(v).replace(/[\s()-]/g, '');

// Pakistan or UAE number: PK mobile 03XX, PK landline, UAE mobile 05X, UAE landline.
const PHONE_RULES = [/^(\+92|0092|0)3\d{9}$/, /^(\+92|0092|0)[124-9]\d{8,9}$/, /^(\+971|00971|0)5\d{8}$/, /^(\+971|00971|0)[1-9]\d{7}$/];
export const isPhone = (v) => PHONE_RULES.some((r) => r.test(compact(v)));
export const isEmail = (v) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(String(v || '').trim()) && String(v).length <= 254;
export const isCnic = (v) => /^\d{5}-\d{7}-\d$/.test(String(v || ''));
export const isNtn = (v) => /^(\d{7}-?\d|\d{13}|\d{5}-\d{7}-\d)$/.test(String(v || '').trim());
export const isPersonName = (v) => /^[\p{L}][\p{L} .'-]{1,79}$/u.test(String(v || '').trim());
export const isBusinessName = (v) => /^[\p{L}\p{N}][\p{L}\p{N} .,&'()/+-]{1,119}$/u.test(String(v || '').trim());
export const strongPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);
export const PASSWORD_RULE = 'Password must be at least 8 characters with a letter and a number';

const IBAN_LENGTH = { PK: 24, AE: 23, SA: 24, GB: 22, QA: 29, OM: 23, BH: 22, KW: 30 };
export const normalizeIban = (v = '') => String(v).replace(/\s+/g, '').toUpperCase();
export function isIban(v) {
  const iban = normalizeIban(v);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const want = IBAN_LENGTH[iban.slice(0, 2)];
  if (want && iban.length !== want) return false;
  if (iban.startsWith('PK') && !/^PK\d{2}[A-Z]{4}[A-Z0-9]{16}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const n = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of n) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** Trimmed string, or null when empty / missing. */
export const nz = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
export const num = (v, fallback = 0) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? fallback : Number(v));
export const last10 = (phone = '') => String(phone).replace(/\D/g, '').slice(-10);

export function assert(cond, message, status = 400) {
  if (!cond) throw new ApiError(message, status);
}

// Messages match what the app showed for the old database rules.
export const MSG = {
  phone: 'A phone number is not valid. Use 0300 1234567, +92 300 1234567 or +971 50 123 4567.',
  email: 'An email address is not valid.',
  cnic: 'CNIC must be 13 digits: 35202-1234567-1.',
  ntn: 'NTN must be 1234567-8 or a 13-digit CNIC.',
  iban: 'The IBAN is not valid.',
  returnAddress: 'Each pickup needs a return address, or tick "same as pickup".',
  plans: 'Choose a valid shipping plan.',
};

export const checkPhone = (v) => assert(v === null || isPhone(v), MSG.phone);
export const checkEmail = (v) => assert(v === null || isEmail(v), MSG.email);
export const checkCnic = (v) => assert(v === null || isCnic(v), MSG.cnic);

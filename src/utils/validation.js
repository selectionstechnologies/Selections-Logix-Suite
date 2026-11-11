// One set of field rules for every form, so a phone or IBAN is judged the same way everywhere.
// Each rule has a test, a message, and (where useful) a function that cleans the typed value.
import { z } from 'zod';

const compact = (v = '') => String(v).replace(/[\s()-]/g, '');

// ---- Phone: Pakistan and UAE -------------------------------------------------------------
// Accepted: 0300 1234567, +92 300 1234567, 0092 300 1234567, 042 35771100 (landline),
//           +971 50 123 4567, 050 123 4567, 04 338 9000 (UAE landline).
const PHONE_RULES = [
  /^(\+92|0092|0)3\d{9}$/, // PK mobile: 03XX XXXXXXX
  /^(\+92|0092|0)[124-9]\d{8,9}$/, // PK landline (area codes never start with 3; 3 is mobile)
  /^(\+971|00971|0)5\d{8}$/, // UAE mobile: 05X XXX XXXX
  /^(\+971|00971|0)[1-9]\d{7}$/, // UAE landline: 0X XXX XXXX
];
export const PHONE_MAX = 17; // "+92 300 123 4567" with spaces, plus a little room
export const PHONE_MESSAGE = 'Enter a valid number, e.g. 0300 1234567, +92 300 1234567 or +971 50 123 4567';
export const isPhone = (v) => PHONE_RULES.some((r) => r.test(compact(v)));
/** While typing: keeps digits, spaces and dashes, a + only at the start, and caps the length. */
export const cleanPhoneInput = (v = '') => {
  const s = String(v).replace(/[^\d+\s-]/g, '');
  return (s.startsWith('+') ? `+${s.slice(1).replace(/\+/g, '')}` : s.replace(/\+/g, '')).slice(0, PHONE_MAX);
};
/** Props for a phone <input>: right keyboard on mobile, length cap. */
export const phoneInputProps = { type: 'tel', inputMode: 'tel', maxLength: PHONE_MAX, placeholder: '0300 1234567', autoComplete: 'tel' };

// ---- Email -----------------------------------------------------------------------------
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
export const EMAIL_MESSAGE = 'Enter a valid email address, e.g. name@company.com';
export const isEmail = (v) => EMAIL_RE.test(String(v || '').trim()) && String(v).length <= 254;

// ---- Pakistan CNIC and NTN ---------------------------------------------------------------
export const CNIC_RE = /^\d{5}-\d{7}-\d$/;
export const CNIC_MESSAGE = 'CNIC must be 13 digits: 35202-1234567-1';
// NTN: 7 digits + check digit (1234567-8), or the 13-digit CNIC that individuals use as NTN.
export const isNtn = (v) => /^(\d{7}-?\d|\d{13}|\d{5}-\d{7}-\d)$/.test(String(v || '').trim());
export const NTN_MESSAGE = 'NTN must be 1234567-8 (8 digits) or a 13-digit CNIC';
export const cleanNtnInput = (v = '') => String(v).replace(/[^\d-]/g, '').slice(0, 15);

// ---- IBAN: country length + ISO 7064 mod-97 checksum ----------------------------------
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
export const IBAN_MESSAGE = 'Enter a valid IBAN (Pakistan: 24 characters, e.g. PK36SCBL0000001123456702)';

// ---- Names -----------------------------------------------------------------------------
// People: letters, spaces, dot, apostrophe, hyphen. Businesses also allow digits and & , ( ) /.
export const isPersonName = (v) => /^[\p{L}][\p{L} .'-]{1,79}$/u.test(String(v || '').trim());
export const PERSON_NAME_MESSAGE = 'Use letters only (2-80 characters)';
export const isBusinessName = (v) => /^[\p{L}\p{N}][\p{L}\p{N} .,&'()/+-]{1,119}$/u.test(String(v || '').trim());
export const BUSINESS_NAME_MESSAGE = 'Use letters, numbers and & . , - ( ) only (2-120 characters)';

// ---- Passwords -------------------------------------------------------------------------
export const PASSWORD_MESSAGE = 'At least 8 characters with a letter and a number';
export const isStrongPassword = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 72 && /[A-Za-z]/.test(v) && /\d/.test(v);

// ---- Vehicle ---------------------------------------------------------------------------
export const isPlate = (v) => /^[A-Z0-9][A-Z0-9 -]{1,11}$/.test(String(v || '').trim().toUpperCase());
export const isLicence = (v) => /^[A-Z0-9][A-Z0-9/-]{3,19}$/.test(String(v || '').trim().toUpperCase());

// ---- Dates (yyyy-mm-dd from <input type="date">) ---------------------------------------
const today = () => new Date().toISOString().slice(0, 10);
export const notFuture = (v) => !v || v <= today();
export const isFuture = (v) => !v || v > today();

// ---- zod helpers ------------------------------------------------------------------------
export const zPhone = (label = 'Phone') => z.string().trim().min(1, `${label} is required`).refine(isPhone, PHONE_MESSAGE);
export const zPhoneOptional = () => z.string().trim().refine((v) => !v || isPhone(v), PHONE_MESSAGE);
export const zEmailOptional = () => z.string().trim().max(254).refine((v) => !v || isEmail(v), EMAIL_MESSAGE);
export const zEmail = (label = 'Email') => z.string().trim().min(1, `${label} is required`).refine(isEmail, EMAIL_MESSAGE);
export const zCnicOptional = () => z.string().trim().refine((v) => !v || CNIC_RE.test(v), CNIC_MESSAGE);
export const zPersonName = (label) => z.string().trim().min(1, `${label} is required`).refine(isPersonName, PERSON_NAME_MESSAGE);
export const zPersonNameOptional = () => z.string().trim().refine((v) => !v || isPersonName(v), PERSON_NAME_MESSAGE);
export const zPassword = () => z.string().refine(isStrongPassword, PASSWORD_MESSAGE);

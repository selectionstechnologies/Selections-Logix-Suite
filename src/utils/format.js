import { format, formatDistanceToNowStrict, isValid } from 'date-fns';

/** Dummy FX: value of 1 unit of each currency in PKR (the system base currency). */
export const FX = { PKR: 1, AED: 76, USD: 280 };
export const CURRENCIES = Object.keys(FX);

export const toPKR = (amount, from = 'PKR') => (Number(amount) || 0) * (FX[from] || 1);
export const convert = (amount, from = 'PKR', to = 'PKR') => toPKR(amount, from) / (FX[to] || 1);

const SYMBOL = { PKR: 'Rs', AED: 'AED', USD: '$' };

/** Format an amount in the given currency without converting it. */
export function fmtCurrency(amount, currency = 'PKR') {
  const n = Number(amount) || 0;
  const digits = currency === 'PKR' ? 0 : 2;
  const text = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? '-' : ''}${SYMBOL[currency] || currency}${currency === 'USD' ? '' : ' '}${text}`;
}

/** Short money for charts and stat cards, e.g. Rs 1.2M. */
export function fmtCompact(amount, currency = 'PKR') {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  let text;
  if (abs >= 1e6) text = `${(abs / 1e6).toFixed(2)}M`;
  else if (abs >= 1e3) text = `${(abs / 1e3).toFixed(1)}K`;
  else text = abs.toFixed(currency === 'PKR' ? 0 : 2);
  return `${n < 0 ? '-' : ''}${SYMBOL[currency] || currency}${currency === 'USD' ? '' : ' '}${text}`;
}

export const fmtNumber = (n) => (Number(n) || 0).toLocaleString('en-US');
export const fmtPct = (n, digits = 1) => `${(Number.isFinite(n) ? n : 0).toFixed(digits)}%`;

const safe = (d) => {
  const date = d instanceof Date ? d : new Date(d);
  return isValid(date) ? date : null;
};
export const fmtDate = (d) => (safe(d) ? format(safe(d), 'dd MMM yyyy') : '-');
export const fmtDateTime = (d) => (safe(d) ? format(safe(d), 'dd MMM yyyy, HH:mm') : '-');
export const fmtTimeAgo = (d) => (safe(d) ? `${formatDistanceToNowStrict(safe(d))} ago` : '-');
export const isoDay = (d) => (safe(d) ? format(safe(d), 'yyyy-MM-dd') : '');

export const titleCase = (s = '') => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const sum = (arr, fn = (x) => x) => arr.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0);

export function groupBy(arr, fn) {
  return arr.reduce((acc, x) => {
    const k = fn(x);
    (acc[k] = acc[k] || []).push(x);
    return acc;
  }, {});
}

export const uid = (prefix = 'ID') => `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`;

/** Fill {variable} placeholders in a notification template. */
export const fillTemplate = (body, vars) => body.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));

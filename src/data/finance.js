// Invoices (30), expenses and branch transfers, all derived from shipments where it matters.
import { format, addDays, subDays } from 'date-fns';
import { makeRng } from './rng.js';
import { shipments } from './shipments.js';
import { merchants } from './people.js';
import { branches } from './geo.js';
import { toPKR, sum, groupBy } from '../utils/format.js';

const rng = makeRng(311);
export const TAX_PCT = 16;

/** Lines for one merchant and period, in PKR. Tax already in shipment totals is shown separately. */
export function buildInvoice(merchantId, from, to, id, number) {
  const list = shipments.filter((s) => {
    const d = new Date(s.createdAt);
    return s.merchantId === merchantId && d >= from && d <= to && s.status !== 'Cancelled';
  });
  const pre = sum(list, (s) => toPKR(s.charges.total - s.charges.tax, s.currency));
  const tax = sum(list, (s) => toPKR(s.charges.tax, s.currency));
  const freight = sum(list, (s) => toPKR(s.charges.base + s.charges.weight + s.charges.fuel + s.charges.remote, s.currency));
  const fees = pre - freight;
  const lines = [
    { desc: `Freight & delivery charges (${list.length} shipments)`, qty: list.length, rate: list.length ? Math.round(freight / list.length) : 0, amount: Math.round(freight) },
    { desc: 'COD, insurance & packaging fees', qty: 1, rate: Math.round(fees), amount: Math.round(fees) },
  ];
  const subtotal = lines[0].amount + lines[1].amount;
  return { id, number, merchantId, from: from.toISOString(), to: to.toISOString(), lines, subtotal, taxPct: TAX_PCT, tax: Math.round(tax), total: subtotal + Math.round(tax), shipments: list.length };
}

const now = new Date();
// Rolling 30-day billing periods, so demo invoices are never empty early in a calendar month.
const periods = [1, 0].map((n) => ({ from: subDays(now, 30 * (n + 1)), to: subDays(now, 30 * n), n }));

/** The 15 merchants with the most billable shipments in a period. */
const topMerchantsIn = ({ from, to }) => Object.entries(groupBy(
  shipments.filter((s) => s.status !== 'Cancelled' && new Date(s.createdAt) >= from && new Date(s.createdAt) <= to),
  (s) => s.merchantId,
)).sort((a, b) => b[1].length - a[1].length).map(([id]) => id);
const periodMerchants = periods.map(topMerchantsIn);

export const invoices = Array.from({ length: 30 }, (_, i) => {
  const period = periods[i < 15 ? 0 : 1];
  const pool = periodMerchants[i < 15 ? 0 : 1];
  const merchantId = pool[i % 15 % pool.length];
  const inv = buildInvoice(merchantId, period.from, period.to, `INV-${i + 1}`, `SLX-INV-${String(1001 + i)}`);
  const issueDate = period.n === 1 ? addDays(period.to, 1) : addDays(now, -rng.int(0, 2));
  const dueDate = addDays(issueDate, period.n === 1 ? rng.pick([7, 15, 30]) : 15);
  let status;
  if (period.n === 1) status = rng.weighted([['Paid', 6], ['Sent', 2], ['Partial', 1]]);
  else status = rng.weighted([['Draft', 3], ['Sent', 4]]);
  if (['Sent', 'Partial'].includes(status) && dueDate < now) status = 'Overdue';
  const payments = status === 'Paid'
    ? [{ id: `PAY-${i}`, at: addDays(issueDate, rng.int(1, 6)).toISOString(), amount: inv.total, method: rng.pick(['Bank Transfer', 'Cheque', 'COD Adjustment']), reference: `RCPT${rng.int(1000, 9999)}` }]
    : status === 'Partial' || (status === 'Overdue' && i % 3 === 0)
      ? [{ id: `PAY-${i}`, at: addDays(issueDate, 2).toISOString(), amount: Math.round(inv.total * 0.4), method: 'Bank Transfer', reference: `RCPT${rng.int(1000, 9999)}` }]
      : [];
  return { ...inv, issueDate: issueDate.toISOString(), dueDate: dueDate.toISOString(), status, payments, creditNotes: [], notes: `Period ${format(period.from, 'dd MMM')} - ${format(period.to, 'dd MMM yyyy')}` };
});

export const EXPENSE_CATEGORIES = ['Fuel', 'Salaries', 'Rent', 'Utilities', 'Vehicle Maintenance', 'Packaging', 'Marketing', 'Office Supplies'];

export const expenses = Array.from({ length: 28 }, (_, i) => {
  const category = EXPENSE_CATEGORIES[i % EXPENSE_CATEGORIES.length];
  const base = { Fuel: 18000, Salaries: 95000, Rent: 60000, Utilities: 14000, 'Vehicle Maintenance': 12000, Packaging: 9000, Marketing: 22000, 'Office Supplies': 4000 }[category];
  return {
    id: `EXP-${String(i + 1).padStart(3, '0')}`,
    date: rng.daysAgo(55, 0).toISOString(),
    category,
    branchId: rng.pick(branches).id,
    amount: Math.round(base * (0.7 + rng.next() * 0.6)),
    description: `${category} - ${format(rng.daysAgo(55, 0), 'MMM')}`,
    paidTo: rng.pick(['Local vendor', 'PSO Fuel', 'Landlord', 'WAPDA', 'Staff payroll', 'Packaging Co.']),
  };
});

export const otherIncome = [
  { id: 'INC-001', date: rng.daysAgo(30, 2).toISOString(), source: 'Warehouse storage fees', branchId: 'DXB', amount: 185000 },
  { id: 'INC-002', date: rng.daysAgo(30, 2).toISOString(), source: 'Packaging material sales', branchId: 'LHE', amount: 42000 },
  { id: 'INC-003', date: rng.daysAgo(30, 2).toISOString(), source: 'Customs brokerage fees', branchId: 'KHI', amount: 96000 },
];

export const transfers = Array.from({ length: 8 }, (_, i) => {
  const from = branches[i % 6];
  const to = branches[(i + 2) % 6];
  return {
    id: `TR-${String(301 + i)}`,
    fromBranchId: from.id,
    toBranchId: to.id,
    type: i % 3 === 0 ? 'Cash' : i % 3 === 1 ? 'Parcels' : 'Stock',
    quantity: i % 3 === 0 ? rng.int(50000, 300000) : rng.int(10, 90),
    status: ['Received', 'Dispatched', 'Created'][i % 3],
    date: rng.daysAgo(14, 0).toISOString(),
    note: i % 3 === 0 ? 'Cash transfer to head office account' : 'Scheduled line-haul',
  };
});

export const merchantOverrides = merchants.filter((m) => m.discountPct > 0).slice(0, 8).map((m, i) => ({
  id: `OV-${i + 1}`,
  merchantId: m.id,
  discountPct: m.discountPct,
  codFeePct: m.type === 'Corporate' ? 1 : 1.25,
}));

export const partnerRates = [
  { id: 'PR-1', carrierId: 'CR-1', lane: 'Pakistan domestic', perKg: 95, minCharge: 180 },
  { id: 'PR-2', carrierId: 'CR-2', lane: 'Pakistan domestic', perKg: 88, minCharge: 170 },
  { id: 'PR-3', carrierId: 'CR-3', lane: 'PK - UAE express', perKg: 720, minCharge: 2400 },
  { id: 'PR-4', carrierId: 'CR-4', lane: 'KHI - JEA sea LCL (per CBM)', perKg: 18500, minCharge: 18500 },
  { id: 'PR-5', carrierId: 'CR-5', lane: 'LHE - DXB air freight', perKg: 610, minCharge: 15000 },
  { id: 'PR-6', carrierId: 'CR-6', lane: 'Cross-border road via Taftan', perKg: 140, minCharge: 9000 },
];

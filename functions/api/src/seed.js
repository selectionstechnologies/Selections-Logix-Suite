// Reference data: the bank list for the customer form and the six network branches.
// Written only when missing, so edits made later in the app are kept.
import { T, createRow, ensureTeam, getRowOrNull } from './context.js';

export const BANKS = [
  ['Allied Bank', 'PK'], ['Askari Bank', 'PK'], ['Bank Alfalah', 'PK'], ['Bank AL Habib', 'PK'], ['BankIslami', 'PK'],
  ['Dubai Islamic Bank Pakistan', 'PK'], ['Faysal Bank', 'PK'], ['Habib Bank Limited (HBL)', 'PK'], ['Habib Metropolitan Bank', 'PK'],
  ['JS Bank', 'PK'], ['MCB Bank', 'PK'], ['Meezan Bank', 'PK'], ['National Bank of Pakistan', 'PK'], ['Soneri Bank', 'PK'],
  ['Standard Chartered Pakistan', 'PK'], ['United Bank Limited (UBL)', 'PK'], ['Bank of Punjab', 'PK'], ['Silkbank', 'PK'],
  ['JazzCash (Mobilink Bank)', 'PK'], ['Easypaisa (Telenor Bank)', 'PK'],
  ['Emirates NBD', 'AE'], ['ADCB', 'AE'], ['First Abu Dhabi Bank', 'AE'], ['Mashreq', 'AE'], ['Dubai Islamic Bank', 'AE'],
];

export const BRANCHES = [
  ['LHE', 'LHE-01', 'Lahore Main Hub', 'Hub', 'Lahore', '42 Ferozepur Road, Gulberg III, Lahore', '+92 42 3577 1100', '08:00 - 22:00', 90, 95000, 0],
  ['KHI', 'KHI-01', 'Karachi Port Hub', 'Hub', 'Karachi', 'Plot 18, SITE Area, Karachi', '+92 21 3255 8800', '08:00 - 22:00', 80, 85000, 0],
  ['ISB', 'ISB-01', 'Islamabad Office', 'Office', 'Islamabad', 'Office 7, I-9 Markaz, Islamabad', '+92 51 444 2200', '09:00 - 20:00', 50, 55000, 4],
  ['PEW', 'PEW-01', 'Peshawar Franchise', 'Franchise', 'Peshawar', 'Ring Road, Hayatabad Phase 3, Peshawar', '+92 91 581 3300', '09:00 - 19:00', 30, 30000, 12],
  ['DXB', 'DXB-01', 'Dubai Warehouse', 'Warehouse', 'Dubai', 'Unit 12, Al Quoz Industrial 3, Dubai', '+971 4 338 9000', '08:00 - 20:00', 35, 90000, 0],
  ['SHJ', 'SHJ-01', 'Sharjah Office', 'Office', 'Sharjah', 'Shop 4, Industrial Area 6, Sharjah', '+971 6 533 1200', '09:00 - 18:00', 20, 45000, 6],
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);

export async function seed(ctx) {
  const { db, teams } = ctx;
  let added = 0;
  for (const [name, country] of BANKS) {
    const id = slug(name);
    if (await getRowOrNull(db, T.banks, id)) continue;
    await createRow(db, T.banks, { name, country, active: true }, [], id);
    added += 1;
  }
  for (const [id, code, name, type, city, address, phone, hours, target_shipments, target_revenue, commission_pct] of BRANCHES) {
    await ensureTeam(teams, id, name);
    if (await getRowOrNull(db, T.branches, id)) continue;
    await createRow(db, T.branches, { code, name, type, city, address, phone, hours, status: 'Active', target_shipments, target_revenue, commission_pct }, [], id);
    added += 1;
  }
  for (const [key, start] of [['customer_code', 1000], ['rider_code', 0]]) {
    if (!(await getRowOrNull(db, T.counters, key))) { await createRow(db, T.counters, { value: start }, [], key); }
  }
  return added;
}

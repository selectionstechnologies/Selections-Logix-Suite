// Loads the database-backed lists (branches, customer accounts, riders, users) into the
// operations store after sign-in, so every screen works from the real records.
import { useCallback, useEffect } from 'react';
import { getPricing, listBranches, listCustomers, listProfiles, listRiders } from '../lib/api.js';
import { useAuth } from '../store/authStore.js';
import { useData } from '../store/dataStore.js';
import { CITY_MAP } from '../data/geo.js';
import { DEFAULT_RATE_CARD } from '../utils/pricing.js';

const mapBranch = (b) => ({
  id: b.id, code: b.code, name: b.name, type: b.type, city: b.city, address: b.address || '', phone: b.phone || '', hours: b.hours || '',
  status: b.status, manager: '', targetShipments: b.target_shipments, targetRevenue: Number(b.target_revenue), commissionPct: Number(b.commission_pct), cash: 0,
});

const mapCustomer = (c) => ({
  id: c.id,
  accountNo: c.account_no,
  name: c.business_name,
  type: c.customer_type,
  shippingPlans: c.shipping_plans || [],
  contact: c.owner_name,
  email: c.email || '',
  phone: c.phone,
  city: c.city || c.pickups?.[0]?.city || 'Lahore',
  address: c.office_address || '',
  branchId: c.branch_id,
  status: c.status,
  kyc: c.kyc_status,
  kycDocs: [],
  bank: c.bank_name || '',
  accountTitle: c.account_title || '',
  iban: c.iban || '',
  creditLimit: Number(c.credit_limit) || 0,
  rateCard: c.rate_card,
  discountPct: Number(c.discount_pct) || 0,
  joinedAt: c.created_at,
  pickups: (c.pickups || []).map((p) => ({ id: p.id, label: p.label, address: p.address, city: p.city, phone: p.phone || '' })),
  receivers: [],
  apiKey: '',
});

const mapRider = (r) => ({
  id: r.id, code: r.code, name: r.full_name, phone: r.phone, branchId: r.branch_id, city: r.city || '', zone: r.zone || '',
  vehicle: r.vehicle_type, plate: r.vehicle_plate || '', license: r.license_no || '', status: r.status, rating: 5,
  joinedAt: r.joined_at, currency: CITY_MAP[r.city]?.currency || 'PKR',
});

const mapUser = (p) => ({
  id: p.id, name: p.full_name, email: p.email, role: p.role, branchId: p.branch_id, status: p.status, phone: p.phone || '', lastLogin: p.last_login,
});

// A failed request keeps the previous list rather than blanking the screen.
const settle = (p) => p.then((data) => ({ data })).catch((error) => ({ error }));

export async function syncFromDb() {
  const [branches, customers, riders, users, pricing] = await Promise.all([
    settle(listBranches()), settle(listCustomers()), settle(listRiders()), settle(listProfiles()), settle(getPricing()),
  ]);
  useData.setState((s) => ({
    branches: branches.data ? branches.data.map(mapBranch) : s.branches,
    merchants: customers.data ? customers.data.map(mapCustomer) : s.merchants,
    riders: riders.data ? riders.data.map(mapRider) : s.riders,
    users: users.data ? users.data.map(mapUser) : s.users,
    // The saved rate card wins; until the admin saves one, the built-in defaults apply.
    rateCard: pricing.data ? { ...DEFAULT_RATE_CARD, ...pricing.data } : pricing.error ? s.rateCard : DEFAULT_RATE_CARD,
  }));
}

/** Mount once inside the signed-in layout. Returns a function to re-sync after edits. */
export function useDbSync() {
  const userId = useAuth((s) => s.user?.id);
  const resync = useCallback(() => syncFromDb().catch(() => { /* screens keep the local data */ }), []);
  useEffect(() => { if (userId) resync(); }, [userId, resync]);
  return resync;
}

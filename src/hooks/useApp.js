// App-wide hooks: money display, data scoping and permissions.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUI } from '../store/uiStore.js';
import { useAuth } from '../store/authStore.js';
import { useData } from '../store/dataStore.js';
import { convert, fmtCompact, fmtCurrency } from '../utils/format.js';

/** money(amount, sourceCurrency) converts to the selected display currency and formats. */
export function useMoney() {
  const currency = useUI((s) => s.currency);
  const money = useCallback((amount, from = 'PKR') => fmtCurrency(convert(amount, from, currency), currency), [currency]);
  const compact = useCallback((amount, from = 'PKR') => fmtCompact(convert(amount, from, currency), currency), [currency]);
  const value = useCallback((amount, from = 'PKR') => convert(amount, from, currency), [currency]);
  return { money, compact, value, currency };
}

/** The branch the current view is limited to: a manager's own branch, else the switcher value. */
export function useActiveBranch() {
  const user = useAuth((s) => s.user);
  const selected = useUI((s) => s.branchId);
  if (user?.role === 'branch_manager' && user.branchId) return user.branchId;
  return selected;
}

/** Shipments visible to this user: own parcels for merchants/riders, branch filter for the rest. */
export function useScopedShipments() {
  const shipments = useData((s) => s.shipments);
  const user = useAuth((s) => s.user);
  const branch = useActiveBranch();
  return useMemo(() => {
    if (user?.role === 'merchant') return shipments.filter((s) => s.merchantId === user.merchantId);
    if (user?.role === 'rider') return shipments.filter((s) => s.riderId === user.riderId || s.pickupRiderId === user.riderId);
    if (branch === 'ALL') return shipments;
    return shipments.filter((s) => s.originBranchId === branch || s.destBranchId === branch);
  }, [shipments, user, branch]);
}

/** Generic filter for records carrying a branchId. */
export function useBranchFilter(list, key = 'branchId') {
  const branch = useActiveBranch();
  return useMemo(() => (branch === 'ALL' ? list : list.filter((x) => x[key] === branch)), [list, branch, key]);
}

export function useCan() {
  const user = useAuth((s) => s.user);
  const permissions = useData((s) => s.permissions);
  return useCallback((module, action = 'view') => {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    return !!permissions[user.role]?.[module]?.[action];
  }, [user, permissions]);
}

/** Short simulated latency so skeletons appear the way they would against a real API. */
export function useFakeLoad(ms = 250) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return loading;
}

export function useLookups() {
  const merchants = useData((s) => s.merchants);
  const riders = useData((s) => s.riders);
  const branches = useData((s) => s.branches);
  return useMemo(() => {
    const m = Object.fromEntries(merchants.map((x) => [x.id, x]));
    const r = Object.fromEntries(riders.map((x) => [x.id, x]));
    const b = Object.fromEntries(branches.map((x) => [x.id, x]));
    return {
      merchant: (id) => m[id], rider: (id) => r[id], branch: (id) => b[id],
      merchantName: (id) => m[id]?.name || '-', riderName: (id) => r[id]?.name || 'Unassigned', branchName: (id) => b[id]?.name || '-',
      merchantOptions: merchants.map((x) => ({ value: x.id, label: x.name })),
      riderOptions: riders.map((x) => ({ value: x.id, label: `${x.name} (${x.city})` })),
      branchOptions: branches.map((x) => ({ value: x.id, label: x.name })),
    };
  }, [merchants, riders, branches]);
}

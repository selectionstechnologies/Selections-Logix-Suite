// Pure selectors shared by dashboards, lists and reports so their numbers agree.
import { toPKR, sum } from '../utils/format.js';
import { STATUS, RTO_GROUP, isDelayed } from '../utils/status.js';

export const byId = (list, id) => list.find((x) => x.id === id);

export function shipmentKpis(list) {
  const total = list.length;
  const delivered = list.filter((s) => s.status === STATUS.DELIVERED).length;
  const rto = list.filter((s) => RTO_GROUP.includes(s.status)).length;
  const billable = list.filter((s) => s.status !== STATUS.CANCELLED);
  const revenue = sum(billable, (s) => toPKR(s.charges.total - s.charges.tax, s.currency));
  const cost = sum(billable, (s) => toPKR(s.cost, s.currency));
  const codAmount = (st) => sum(list.filter((s) => st.includes(s.codStatus)), (s) => toPKR(s.cod, s.currency));
  return {
    total,
    delivered,
    deliveredPct: total ? (delivered / total) * 100 : 0,
    rto,
    rtoPct: total ? (rto / total) * 100 : 0,
    revenue,
    cost,
    profit: revenue - cost,
    codCollected: codAmount(['Collected', 'Deposited', 'Reconciled', 'Paid']),
    // COD still expected on parcels not yet delivered, plus cash not yet banked.
    codPending: codAmount(['Pending', 'Collected']),
    codWithRiders: codAmount(['Collected']),
    codDeposited: codAmount(['Deposited']),
    codReconciled: codAmount(['Reconciled']),
    codPaid: codAmount(['Paid']),
    delayed: list.filter((s) => isDelayed(s)).length,
    failed: list.filter((s) => s.status === STATUS.FAILED).length,
  };
}

/** Last n days of shipments, counts and money per day. */
export function dailySeries(list, days = 14) {
  const map = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { key, label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), shipments: 0, revenue: 0, cost: 0 });
  }
  list.forEach((s) => {
    const row = map.get(new Date(s.createdAt).toISOString().slice(0, 10));
    if (!row) return;
    row.shipments += 1;
    if (s.status !== STATUS.CANCELLED) {
      row.revenue += toPKR(s.charges.total - s.charges.tax, s.currency);
      row.cost += toPKR(s.cost, s.currency);
    }
  });
  return [...map.values()];
}

/** Status mix folded into four readable groups for a donut. */
export function statusMix(list) {
  const group = (s) => {
    if (s.status === STATUS.DELIVERED) return 'Delivered';
    if (RTO_GROUP.includes(s.status) || s.status === STATUS.CANCELLED || s.status === STATUS.FAILED) return 'Failed / RTO / Cancelled';
    if (s.status === STATUS.BOOKED) return 'Booked (pending)';
    return 'In network';
  };
  const counts = {};
  list.forEach((s) => { const g = group(s); counts[g] = (counts[g] || 0) + 1; });
  return ['Delivered', 'In network', 'Failed / RTO / Cancelled', 'Booked (pending)']
    .filter((k) => counts[k]).map((name) => ({ name, value: counts[name] }));
}

export function topBy(list, keyFn, nameFn, n = 5) {
  const counts = {};
  list.forEach((s) => {
    const k = keyFn(s);
    if (!k) return;
    counts[k] = (counts[k] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([k, v]) => ({ key: k, name: nameFn(k), value: v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

export function riderStats(rider, shipments, codTransactions) {
  const assigned = shipments.filter((s) => s.riderId === rider.id);
  const delivered = assigned.filter((s) => s.status === STATUS.DELIVERED).length;
  const attempted = assigned.filter((s) => s.status === STATUS.DELIVERED || s.ndr).length;
  const cash = sum(codTransactions.filter((t) => t.riderId === rider.id && t.status === 'Collected'), (t) => t.amount);
  return {
    assigned: assigned.length,
    delivered,
    active: assigned.filter((s) => [STATUS.OFD, STATUS.REATTEMPT].includes(s.status)).length,
    successPct: attempted ? (delivered / attempted) * 100 : 0,
    cash,
  };
}

export function branchStats(branchId, shipments, codTransactions) {
  const list = shipments.filter((s) => s.originBranchId === branchId || s.destBranchId === branchId);
  const k = shipmentKpis(list);
  const cash = sum(codTransactions.filter((t) => t.branchId === branchId && ['Collected', 'Deposited'].includes(t.status)), (t) => toPKR(t.amount, t.currency));
  return { ...k, cash, list };
}

export function merchantStats(merchantId, shipments, codTransactions, payouts) {
  const list = shipments.filter((s) => s.merchantId === merchantId);
  const txns = codTransactions.filter((t) => t.merchantId === merchantId);
  const paid = sum(payouts.filter((p) => p.merchantId === merchantId && p.status === 'Paid'), (p) => p.net);
  const payable = sum(txns.filter((t) => t.status === 'Reconciled'), (t) => toPKR(t.amount, t.currency));
  const inTransit = sum(txns.filter((t) => ['Collected', 'Deposited'].includes(t.status)), (t) => toPKR(t.amount, t.currency));
  return { list, kpis: shipmentKpis(list), txns, paid, payable, inTransit };
}


/** Aging buckets over any list of { amount (PKR), date }. */
export function agingBuckets(rows) {
  const buckets = [
    { name: '0-7 days', min: 0, max: 7, value: 0, count: 0 },
    { name: '8-15 days', min: 8, max: 15, value: 0, count: 0 },
    { name: '16-30 days', min: 16, max: 30, value: 0, count: 0 },
    { name: '31+ days', min: 31, max: Infinity, value: 0, count: 0 },
  ];
  rows.forEach((r) => {
    const days = Math.max(Math.floor((Date.now() - new Date(r.date).getTime()) / 86400000), 0);
    const b = buckets.find((x) => days >= x.min && days <= x.max);
    b.value += r.amount;
    b.count += 1;
  });
  return buckets;
}

// Sanity checks for the mock data: counts from the brief and cross-module integrity.
// Run with: npm run check:data
import { seed } from '../src/data/index.js';
import { shipmentKpis } from '../src/data/helpers.js';

const d = seed();
const problems = [];
const expectCount = (name, list, n) => { if (list.length !== n) problems.push(`${name}: expected ${n}, got ${list.length}`); };

expectCount('branches', d.branches, 6);
expectCount('merchants', d.merchants, 40);
expectCount('riders', d.riders, 25);
expectCount('users', d.users, 12);
expectCount('shipments', d.shipments, 300);
expectCount('invoices', d.invoices, 30);
expectCount('payouts', d.payouts, 20);
expectCount('codTransactions', d.codTransactions, 60);
expectCount('cargoBookings', d.cargoBookings, 15);
expectCount('customsFiles', d.customsFiles, 10);
expectCount('tickets', d.tickets, 25);
expectCount('returns+claims', [...d.returnsList, ...d.claims], 20);
expectCount('inventory', d.inventory, 50);

const ids = {
  merchant: new Set(d.merchants.map((x) => x.id)),
  rider: new Set(d.riders.map((x) => x.id)),
  branch: new Set(d.branches.map((x) => x.id)),
  shipment: new Set(d.shipments.map((x) => x.id)),
  txn: new Set(d.codTransactions.map((x) => x.id)),
};
const now = Date.now();
d.shipments.forEach((s) => {
  if (!ids.merchant.has(s.merchantId)) problems.push(`${s.id}: bad merchant`);
  if (s.riderId && !ids.rider.has(s.riderId)) problems.push(`${s.id}: bad rider`);
  if (!ids.branch.has(s.originBranchId) || !ids.branch.has(s.destBranchId)) problems.push(`${s.id}: bad branch`);
  if (s.events[s.events.length - 1].status !== s.status) problems.push(`${s.id}: last event != status`);
  if (new Date(s.events[s.events.length - 1].at).getTime() > now) problems.push(`${s.id}: event in the future`);
  if (s.status === 'Delivered' && !s.riderId) problems.push(`${s.id}: delivered without rider`);
  const parts = ['base', 'weight', 'fuel', 'remote', 'codFee', 'insurance', 'packaging', 'tax'].reduce((a, k) => a + s.charges[k], 0);
  if (Math.abs(parts - s.charges.total) > 0.011) problems.push(`${s.id}: charges do not add up (${parts} vs ${s.charges.total})`);
  if (s.codStatus === 'None' && s.cod && !['Return to Origin', 'Returned', 'Cancelled'].includes(s.status)) problems.push(`${s.id}: cod without status`);
  if (s.status === 'Cancelled' && s.riderId) problems.push(`${s.id}: cancelled has rider`);
});
d.codTransactions.forEach((t) => {
  const s = d.shipments.find((x) => x.id === t.shipmentId);
  if (!s) return problems.push(`${t.id}: bad shipment`);
  if (s.status !== 'Delivered') problems.push(`${t.id}: shipment not delivered`);
  if (s.codStatus !== t.status) problems.push(`${t.id}: status mismatch ${t.status} vs ${s.codStatus}`);
  if (t.amount !== s.cod) problems.push(`${t.id}: amount mismatch`);
  if (t.riderId !== s.riderId) problems.push(`${t.id}: rider mismatch`);
  return null;
});
d.shipments.filter((s) => s.status === 'Delivered' && s.cod).forEach((s) => {
  if (!d.codTransactions.find((t) => t.shipmentId === s.id)) problems.push(`${s.id}: delivered COD with no txn`);
});
const seenTxn = new Set();
d.payouts.forEach((p) => {
  if (!ids.merchant.has(p.merchantId)) problems.push(`${p.id}: bad merchant`);
  p.txnIds.forEach((id) => {
    if (seenTxn.has(id)) problems.push(`${p.id}: txn ${id} in two payouts`);
    seenTxn.add(id);
    const t = d.codTransactions.find((x) => x.id === id);
    if (t.merchantId !== p.merchantId) problems.push(`${p.id}: txn from other merchant`);
    if (p.status === 'Paid' && t.status !== 'Paid') problems.push(`${p.id}: paid payout has ${t.status} txn`);
  });
});
d.codTransactions.filter((t) => t.status === 'Paid').forEach((t) => {
  if (!seenTxn.has(t.id)) problems.push(`${t.id}: Paid but in no payout`);
});
d.riderDeposits.forEach((dep) => {
  const riderCurrencies = new Set(dep.txnIds.map((id) => d.codTransactions.find((t) => t.id === id).currency));
  if (riderCurrencies.size > 1) problems.push(`${dep.id}: mixed currency deposit`);
});
const seenAwb = new Set();
d.manifests.forEach((m) => m.awbs.forEach((a) => {
  if (seenAwb.has(a)) problems.push(`${m.id}: awb ${a} in two manifests`);
  seenAwb.add(a);
}));

const k = shipmentKpis(d.shipments);
const statusCount = {};
d.shipments.forEach((s) => { statusCount[s.status] = (statusCount[s.status] || 0) + 1; });
const demoRider = d.riders[0].id;
const cod = {};
d.codTransactions.forEach((t) => { cod[t.status] = (cod[t.status] || 0) + 1; });
console.log('statuses', statusCount);
console.log('cod txn stages', cod, 'payouts', d.payouts.map((p) => p.status).join(','));
console.log('demo rider: OFD', d.shipments.filter((s) => s.riderId === demoRider && s.status === 'Out for Delivery').length,
  'pickups', d.shipments.filter((s) => s.pickupRiderId === demoRider && s.status === 'Booked').length,
  'cash txns', d.codTransactions.filter((t) => t.riderId === demoRider && t.status === 'Collected').length);
console.log('demo merchant shipments', d.shipments.filter((s) => s.merchantId === 'M001').length);
console.log('invoice statuses', d.invoices.reduce((a, i) => ({ ...a, [i.status]: (a[i.status] || 0) + 1 }), {}), 'zero-value', d.invoices.filter((i) => !i.total).length);
console.log('deposits', d.riderDeposits.length, 'shortage/excess', d.riderDeposits.filter((x) => x.expected !== x.deposited).length);
console.log('kpis', { delivered: k.deliveredPct.toFixed(1), rto: k.rtoPct.toFixed(1), revenue: Math.round(k.revenue), profit: Math.round(k.profit), collected: Math.round(k.codCollected), pending: Math.round(k.codPending), delayed: k.delayed });

if (problems.length) {
  console.error(`\n${problems.length} PROBLEMS:\n${problems.slice(0, 30).join('\n')}`);
  process.exit(1);
}
console.log('\nAll data checks passed.');

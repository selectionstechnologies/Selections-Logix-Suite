// 300 shipments, plus the COD chain derived from them so totals always reconcile:
// delivered COD shipment -> exactly one COD transaction -> rider deposit -> merchant payout.
import { makeRng } from './rng.js';
import { CITY_MAP, CITY_NAMES, branches } from './geo.js';
import { merchants, riders } from './people.js';
import { DEFAULT_RATE_CARD, quote } from '../utils/pricing.js';
import { STATUS, HAPPY_PATH } from '../utils/status.js';
import { toPKR, sum, groupBy } from '../utils/format.js';

const rng = makeRng(77);
const HOUR = 3600000;

const RECEIVER_FIRST = ['Sara', 'Ahmed', 'Mariam', 'Hassan', 'Zara', 'Abdullah', 'Amna', 'Fahad', 'Nida', 'Talha', 'Iqra', 'Mustafa', 'Rabia', 'Shoaib', 'Khadija', 'Taimoor'];
const RECEIVER_LAST = ['Ali', 'Khan', 'Siddiqui', 'Baig', 'Rana', 'Chaudhry', 'Hashmi', 'Lodhi', 'Awan', 'Gill'];
const AREAS = ['Model Town', 'DHA Phase 5', 'Gulshan Block 7', 'F-10 Markaz', 'Satellite Town', 'Cantt', 'Johar Town', 'Clifton Block 2', 'Al Barsha', 'Al Nahda', 'University Road', 'Saddar'];
const ITEMS = [['Lawn suit', 3500], ['Skincare set', 2400], ['Bluetooth earbuds', 4200], ['Running shoes', 6200], ['Perfume 100ml', 5400], ['Phone case', 950], ['Kitchen set', 7800], ['Kids toy set', 2100], ['Prayer mat', 1800], ['Leather wallet', 2600], ['Smart watch', 8900], ['Book bundle', 1700]];
export const COURIERS = ['Selections Express', 'Selections Express', 'Selections Express', 'TCS Partner Line', 'Leopards Partner Line', 'Aramex Partner Line'];
export const COURIER_NAMES = [...new Set(COURIERS)];

const STATUS_WEIGHTS = [
  [STATUS.DELIVERED, 50], [STATUS.BOOKED, 5], [STATUS.PICKED, 3], [STATUS.ORIGIN, 3], [STATUS.TRANSIT, 6], [STATUS.DEST, 5],
  [STATUS.OFD, 6], [STATUS.FAILED, 5], [STATUS.REATTEMPT, 2], [STATUS.RTO, 6], [STATUS.RETURNED, 6], [STATUS.CANCELLED, 3],
];

const pathFor = (status) => {
  const toOfd = HAPPY_PATH.slice(0, 6);
  switch (status) {
    case STATUS.DELIVERED: return HAPPY_PATH;
    case STATUS.FAILED: return [...toOfd, STATUS.FAILED];
    case STATUS.REATTEMPT: return [...toOfd, STATUS.FAILED, STATUS.REATTEMPT];
    case STATUS.RTO: return [...toOfd, STATUS.FAILED, STATUS.RTO];
    case STATUS.RETURNED: return [...toOfd, STATUS.FAILED, STATUS.RTO, STATUS.RETURNED];
    case STATUS.CANCELLED: return [STATUS.BOOKED, STATUS.CANCELLED];
    default: return HAPPY_PATH.slice(0, HAPPY_PATH.indexOf(status) + 1);
  }
};

const eventNote = (st, s) => ({
  [STATUS.BOOKED]: `Booked by ${s.sender.name}`,
  [STATUS.PICKED]: 'Parcel collected from sender',
  [STATUS.ORIGIN]: `Scanned in at ${s.originCity} hub`,
  [STATUS.TRANSIT]: `Departed ${s.originCity} for ${s.destCity}`,
  [STATUS.DEST]: `Received at ${s.destCity} hub`,
  [STATUS.OFD]: 'Out with rider for delivery',
  [STATUS.DELIVERED]: `Delivered to ${s.receiver.name}`,
  [STATUS.FAILED]: s.ndr?.reason || 'Delivery attempt failed',
  [STATUS.REATTEMPT]: 'Re-attempt scheduled',
  [STATUS.RTO]: 'Returning to origin',
  [STATUS.RETURNED]: 'Returned to sender',
  [STATUS.CANCELLED]: 'Cancelled before pickup',
}[st]);

const eventLocation = (st, s) => ([STATUS.BOOKED, STATUS.PICKED, STATUS.ORIGIN, STATUS.RETURNED, STATUS.CANCELLED].includes(st) ? s.originCity : s.destCity);

function buildEvents(s) {
  const path = pathFor(s.status);
  let at = new Date(s.createdAt).getTime();
  const events = path.map((status) => {
    const event = { status, at: new Date(at).toISOString(), location: eventLocation(status, s), by: 'System', note: eventNote(status, s) };
    at += rng.int(3, 11) * HOUR;
    return event;
  });
  return events;
}

const riderIdsByBranch = groupBy(riders, (r) => r.branchId);
const pickRider = (branchId) => {
  const pool = riderIdsByBranch[branchId] || riders;
  // The demo rider gets a healthy share of Lahore work.
  if (branchId === 'LHE' && rng.chance(0.35)) return riders[0].id;
  return rng.pick(pool).id;
};

const NOW = Date.now();

function makeShipment(index) {
  const merchant = rng.chance(0.14) ? merchants[0] : rng.pick(merchants.slice(0, 36));
  const status = rng.weighted(STATUS_WEIGHTS);
  const originCity = merchant.city;
  const origin = CITY_MAP[originCity];
  const crossBorder = rng.chance(0.08);
  const sameCountry = CITY_NAMES.filter((c) => CITY_MAP[c].country === origin.country);
  const other = CITY_NAMES.filter((c) => CITY_MAP[c].country !== origin.country);
  let destCity = crossBorder ? rng.pick(other) : rng.pick(sameCountry);
  // Keep the demo rider supplied with live deliveries.
  if (status === STATUS.OFD && index % 2 === 0) destCity = 'Lahore';
  const dest = CITY_MAP[destCity];
  const international = origin.country !== dest.country;
  const currency = dest.currency;
  const service = international ? 'international' : rng.weighted([['next-day', 55], ['economy', 30], ['same-day', 15]]);

  const itemCount = rng.int(1, 3);
  const items = Array.from({ length: itemCount }, () => {
    const [name, value] = rng.pick(ITEMS);
    return { name, qty: rng.int(1, 2), value: currency === 'AED' ? Math.round(value / 76) : value };
  });
  const declaredValue = sum(items, (i) => i.qty * i.value);
  const weight = Math.round((0.3 + rng.next() * rng.pick([1.5, 3, 8])) * 10) / 10;
  const length = rng.int(10, 40); const width = rng.int(10, 30); const height = rng.int(5, 25);
  const insurance = rng.chance(0.2);
  const packaging = rng.pick(['none', 'flyer', 'flyer', 'box-s', 'box-l']);
  // COD is finalised below; delivered shipments are trimmed to exactly 60 with COD.
  const cod = rng.chance(0.65) ? declaredValue : 0;

  const receiver = {
    name: `${rng.pick(RECEIVER_FIRST)} ${rng.pick(RECEIVER_LAST)}`,
    phone: dest.country === 'AE' ? `+971 5${rng.int(0, 8)} ${rng.int(100, 999)} ${rng.int(1000, 9999)}` : `+92 3${rng.int(0, 4)}${rng.int(0, 9)} ${rng.int(1000000, 9999999)}`,
    address: `House ${rng.int(1, 300)}, ${rng.pick(AREAS)}`,
    city: destCity,
  };

  // Live statuses are recent; terminal ones spread over the last 60 days.
  const isLive = ![STATUS.DELIVERED, STATUS.RETURNED, STATUS.CANCELLED, STATUS.RTO].includes(status);
  const path = pathFor(status);
  const minAge = (path.length * 11 + 2) / 24; // leaves room for the events so none land in the future
  const created = new Date(NOW - (minAge + (isLive ? rng.next() * 3 : rng.next() * 58)) * 86400000);

  const svcDays = { 'same-day': 1, 'next-day': 2, economy: 4, international: 7 }[service];
  const s = {
    id: `SLX${100001 + index}`,
    awb: `SLX${100001 + index}`,
    merchantId: merchant.id,
    originBranchId: origin.branchId,
    destBranchId: dest.branchId,
    originCity, destCity,
    courier: international ? 'Aramex Partner Line' : rng.pick(COURIERS),
    service, status, currency,
    sender: { name: merchant.name, phone: merchant.phone, address: merchant.address, city: originCity },
    receiver,
    parcel: { weight, length, width, height, declaredValue, items, packaging, pieces: itemCount, insurance },
    notes: rng.chance(0.15) ? rng.pick(['Handle with care', 'Call before delivery', 'Deliver after 5pm', 'Leave with guard if absent']) : '',
    cod,
    codStatus: cod ? 'Pending' : 'None',
    createdAt: created.toISOString(),
    // Live parcels are mostly on schedule; about one in seven has slipped past its ETA.
    eta: (isLive
      ? new Date(NOW + (rng.chance(0.15) ? -rng.next() * 2 - 0.1 : rng.next() * 3 + 0.2) * 86400000)
      : new Date(created.getTime() + svcDays * 86400000)).toISOString(),
    riderId: null,
    pickupRiderId: null,
    ndr: null,
    activity: [],
    pod: null,
    manifestId: null,
  };
  if ([STATUS.FAILED, STATUS.REATTEMPT, STATUS.RTO, STATUS.RETURNED].includes(status)) {
    s.ndr = {
      reason: rng.pick(['Customer not available', 'Wrong address', 'Phone unreachable', 'Refused to accept', 'COD amount not ready']),
      attempts: status === STATUS.FAILED ? 1 : 2,
      nextAttempt: status === STATUS.REATTEMPT ? new Date(NOW + rng.int(1, 3) * 86400000).toISOString() : null,
    };
  }
  if ([STATUS.RTO, STATUS.RETURNED, STATUS.CANCELLED].includes(status)) s.codStatus = 'None';
  if (path.includes(STATUS.OFD)) s.riderId = pickRider(dest.branchId);
  if (status === STATUS.BOOKED) s.pickupRiderId = rng.chance(0.5) ? pickRider(origin.branchId) : null;
  if (path.includes(STATUS.PICKED)) s.pickupRiderId = s.pickupRiderId || pickRider(origin.branchId);
  s.events = buildEvents(s);
  return s;
}

const priceShipment = (s) => {
  const q = quote({
    originCity: s.originCity, destCity: s.destCity, service: s.service,
    weight: s.parcel.weight, length: s.parcel.length, width: s.parcel.width, height: s.parcel.height,
    cod: s.cod, declaredValue: s.parcel.declaredValue, insurance: s.parcel.insurance, packaging: s.parcel.packaging,
    currency: s.currency,
  }, DEFAULT_RATE_CARD, { discountPct: merchants.find((m) => m.id === s.merchantId)?.discountPct });
  s.charges = {
    base: q.base, weight: q.weight, fuel: q.fuel, remote: q.remote, codFee: q.codFee,
    insurance: q.insurance, packaging: q.packaging, tax: q.tax, total: q.total,
  };
  s.cost = q.cost;
  s.chargeableWeight = q.chargeableWeight;
  s.zone = q.zone;
};

export const shipments = Array.from({ length: 300 }, (_, i) => makeShipment(i));

// ---- COD chain ------------------------------------------------------------

const delivered = shipments
  .filter((s) => s.status === STATUS.DELIVERED)
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

// Exactly 60 delivered parcels carry COD. Demo-rider parcels go first so they land in "Collected".
const ordered = [...delivered].sort((a, b) => (b.riderId === riders[0].id && b.destCity === 'Lahore' ? 1 : 0) - (a.riderId === riders[0].id && a.destCity === 'Lahore' ? 1 : 0));
const demoFirst = ordered.slice(0, 3);
const rest = delivered.filter((s) => !demoFirst.includes(s));
const codDelivered = [...demoFirst, ...rest.slice(0, 57)];
delivered.forEach((s) => {
  if (!codDelivered.includes(s)) { s.cod = 0; s.codStatus = 'None'; }
  else if (!s.cod) { s.cod = s.parcel.declaredValue; s.codStatus = 'Pending'; }
});

// Newest cash is still with riders; oldest has been settled.
const STAGES = [['Collected', 10], ['Deposited', 8], ['Reconciled', 12], ['Paid', 30]];
let cursor = 0;
STAGES.forEach(([stage, n]) => {
  codDelivered.slice(cursor, cursor + n).forEach((s) => { s.codStatus = stage; });
  cursor += n;
});

shipments.forEach((s) => {
  priceShipment(s);
  if (s.status === STATUS.DELIVERED) {
    const last = s.events[s.events.length - 1];
    s.pod = { receivedBy: s.receiver.name, method: rng.pick(['OTP', 'Signature', 'Photo']), at: last.at };
  }
  s.activity = [{ at: s.createdAt, by: s.sender.name, text: `Shipment ${s.awb} created` }];
  if (s.notes) s.activity.push({ at: s.createdAt, by: 'Operations', text: `Note added: ${s.notes}` });
});

const deliveredAt = (s) => s.events[s.events.length - 1].at;

export const codTransactions = codDelivered.map((s, i) => ({
  id: `COD-${String(i + 1).padStart(4, '0')}`,
  awb: s.awb,
  shipmentId: s.id,
  riderId: s.riderId,
  merchantId: s.merchantId,
  branchId: s.destBranchId,
  amount: s.cod,
  currency: s.currency,
  status: s.codStatus,
  collectedAt: deliveredAt(s),
  depositId: null,
}));

// Rider deposits for everything past "Collected". A few carry a shortage or excess.
const toDeposit = codTransactions.filter((t) => t.status !== 'Collected');
const byRider = groupBy(toDeposit, (t) => `${t.riderId}|${t.status === 'Deposited' ? 'pending' : 'done'}`);
export const riderDeposits = Object.entries(byRider).map(([key, txns], i) => {
  const [riderId, state] = key.split('|');
  const currency = txns[0].currency;
  const expected = sum(txns, (t) => t.amount);
  const pending = state === 'pending';
  let deposited = expected;
  if (pending) {
    if (i % 3 === 0) deposited = Math.round(expected * 0.94);
    else if (i % 7 === 0) deposited = Math.round(expected * 1.02);
  }
  const id = `DEP-${String(i + 1).padStart(4, '0')}`;
  txns.forEach((t) => { t.depositId = id; });
  return {
    id, riderId, currency, expected, deposited,
    branchId: riders.find((r) => r.id === riderId).branchId,
    status: pending ? 'Pending' : 'Reconciled',
    txnIds: txns.map((t) => t.id),
    at: new Date(Math.max(...txns.map((t) => new Date(t.collectedAt).getTime())) + 6 * HOUR).toISOString(),
    note: '',
  };
});

// ---- Payouts (20): 14 settled batches from Paid COD, 6 open from Reconciled COD ---------

const paidTxns = codTransactions.filter((t) => t.status === 'Paid');
const paidGroups = Object.entries(groupBy(paidTxns, (t) => t.merchantId)).sort((a, b) => b[1].length - a[1].length);
// Merchants beyond the top 14 have not been paid yet: their COD is payable, not settled.
paidGroups.slice(14).forEach(([, txns]) => txns.forEach((t) => {
  t.status = 'Reconciled';
  shipments.find((s) => s.id === t.shipmentId).codStatus = 'Reconciled';
}));
const reconciledTxns = codTransactions.filter((t) => t.status === 'Reconciled');
const reconciledGroups = Object.entries(groupBy(reconciledTxns, (t) => t.merchantId)).sort((a, b) => b[1].length - a[1].length);

const SHIP_MAP = Object.fromEntries(shipments.map((s) => [s.id, s]));

/** Payable breakdown for a merchant: gross COD less shipping, COD fee and return charges, all in PKR. */
export function buildPayoutFigures(txns) {
  const gross = sum(txns, (t) => toPKR(t.amount, t.currency));
  const shipping = sum(txns, (t) => {
    const s = SHIP_MAP[t.shipmentId];
    return s ? toPKR(s.charges.total - s.charges.codFee, s.currency) : 0;
  });
  const codFee = sum(txns, (t) => {
    const s = SHIP_MAP[t.shipmentId];
    return s ? toPKR(s.charges.codFee, s.currency) : 0;
  });
  return { gross: Math.round(gross), shipping: Math.round(shipping), codFee: Math.round(codFee) };
}

const makePayout = ([merchantId, txns], status, i) => {
  const f = buildPayoutFigures(txns);
  const returns = i % 4 === 0 ? 150 * (1 + (i % 3)) : 0;
  const at = rng.daysAgo(status === 'Paid' ? 45 : 5, status === 'Paid' ? 6 : 0);
  return {
    id: `PO-${String(i + 1).padStart(4, '0')}`,
    batch: `BATCH-${String(Math.floor(i / 4) + 1).padStart(3, '0')}`,
    merchantId,
    txnIds: txns.map((t) => t.id),
    shipments: txns.length,
    ...f,
    returns,
    net: f.gross - f.shipping - f.codFee - returns,
    status,
    createdAt: at.toISOString(),
    paidAt: status === 'Paid' ? new Date(at.getTime() + 2 * 86400000).toISOString() : null,
    reference: status === 'Paid' ? `TRX${rng.int(100000, 999999)}` : '',
  };
};

const settled = paidGroups.slice(0, 14);
export const payouts = [
  ...settled.map((g, i) => makePayout(g, 'Paid', i)),
  ...reconciledGroups.slice(0, 20 - settled.length).map((g, i) => makePayout(g, ['Pending', 'Pending', 'Approved', 'Pending', 'Rejected', 'Approved'][i % 6], settled.length + i)),
];
// Open payouts lock their COD lines so they cannot be batched twice.
export const payoutedTxnIds = new Set(payouts.filter((p) => p.status !== 'Rejected').flatMap((p) => p.txnIds));

// ---- Manifests (8) ----------------------------------------------------------

const MANIFEST_STATUS = ['Received', 'Received', 'Received', 'Dispatched', 'Dispatched', 'Dispatched', 'Created', 'Created'];
const lanes = Object.values(groupBy(
  shipments.filter((s) => [STATUS.TRANSIT, STATUS.DEST, STATUS.ORIGIN].includes(s.status) && s.originBranchId !== s.destBranchId),
  (s) => `${s.originBranchId}-${s.destBranchId}`,
));
export const manifests = MANIFEST_STATUS.map((status, i) => {
  const lane = lanes[i % Math.max(lanes.length, 1)] || [];
  // A parcel can only ride one bag, so skip any already taken by an earlier manifest.
  const parcels = lane.filter((s) => !s.manifestId).slice(0, 6);
  const from = parcels[0]?.originBranchId || branches[i % 6].id;
  const to = parcels[0]?.destBranchId || branches[(i + 1) % 6].id;
  const id = `MF-${String(2001 + i)}`;
  parcels.forEach((s) => { s.manifestId = id; });
  return {
    id,
    bag: `BAG-${rng.int(1000, 9999)}`,
    fromBranchId: from,
    toBranchId: to,
    awbs: parcels.map((s) => s.awb),
    status,
    vehicle: rng.pick(['LEA-4471 (Truck)', 'KHI-8820 (Van)', 'Air Cargo PK-305', 'D 44871 (Van)']),
    createdAt: rng.daysAgo(10, 1).toISOString(),
    by: 'Hub Operations',
  };
});

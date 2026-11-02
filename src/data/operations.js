// Warehouse, cargo, customs, returns, support, comms and admin mock records.
import { makeRng } from './rng.js';
import { shipments } from './shipments.js';
import { merchants, users, ROLE_LABELS } from './people.js';
import { branches } from './geo.js';
import { STATUS } from '../utils/status.js';

const rng = makeRng(909);
const HOUR = 3600000;

// ---- Warehouse --------------------------------------------------------------

const SKU_NAMES = ['Lawn Suit 3pc', 'Kurta Cotton', 'Moisturiser 50ml', 'Serum 30ml', 'Bluetooth Earbuds', 'USB-C Charger', 'Running Shoes', 'Leather Sandals', 'Oud Perfume', 'Attar 12ml', 'Phone Case', 'Screen Guard', 'Kitchen Knife Set', 'Non-stick Pan', 'Toy Blocks', 'Story Book Set', 'Organic Honey', 'Green Tea 100g', 'Yoga Mat', 'Dumbbell 5kg'];
const whMerchants = merchants.slice(0, 10);
export const inventory = Array.from({ length: 50 }, (_, i) => {
  const m = whMerchants[i % whMerchants.length];
  const reorder = rng.pick([10, 15, 20, 30]);
  const stock = i % 9 === 0 ? rng.int(0, reorder - 1) : rng.int(reorder + 5, 420);
  return {
    id: `SKU-${String(i + 1).padStart(4, '0')}`,
    sku: `${m.name.slice(0, 3).toUpperCase()}-${String(1000 + i)}`,
    name: `${SKU_NAMES[i % SKU_NAMES.length]}${i >= SKU_NAMES.length ? ` V${Math.floor(i / SKU_NAMES.length) + 1}` : ''}`,
    merchantId: m.id,
    branchId: i % 4 === 3 ? 'DXB' : i % 4 === 2 ? 'KHI' : 'LHE',
    stock,
    reorder,
    bin: `${rng.pick(['A', 'B', 'C', 'D'])}${rng.int(1, 12)}-R${rng.int(1, 6)}`,
    unitCost: rng.int(150, 4500),
    weight: Math.round((0.1 + rng.next() * 2) * 10) / 10,
  };
});
export const stockStatus = (item) => (item.stock <= 0 ? 'Out of Stock' : item.stock <= item.reorder ? 'Low Stock' : 'In Stock');

export const stockMoves = Array.from({ length: 24 }, (_, i) => {
  const item = rng.pick(inventory);
  return {
    id: `MV-${String(i + 1).padStart(4, '0')}`,
    skuId: item.id,
    type: rng.pick(['Stock In', 'Stock Out', 'Adjustment', 'Transfer']),
    qty: rng.int(1, 60),
    date: rng.daysAgo(20, 0).toISOString(),
    by: 'Nadeem Akhtar',
    note: rng.pick(['Supplier GRN', 'Order fulfilment', 'Cycle count', 'Damaged in rack', 'Rebalance']),
  };
});

export const inbounds = Array.from({ length: 7 }, (_, i) => {
  const lines = rng.shuffle(inventory).slice(0, rng.int(2, 4)).map((it) => ({ skuId: it.id, expected: rng.int(20, 120), received: 0 }));
  const status = ['Received', 'Received', 'Receiving', 'Expected', 'Expected', 'Expected', 'Received'][i];
  if (status !== 'Expected') lines.forEach((l) => { l.received = status === 'Received' ? l.expected : Math.floor(l.expected / 2); });
  return {
    id: `GRN-${String(501 + i)}`,
    merchantId: whMerchants[i % whMerchants.length].id,
    branchId: i % 3 === 2 ? 'DXB' : 'LHE',
    eta: rng.daysAgo(6, -4).toISOString(),
    status,
    lines,
  };
});

const PICK_STAGES = ['New', 'New', 'New', 'Picking', 'Picking', 'Packing', 'Packing', 'Ready to Ship', 'Ready to Ship', 'New', 'Picking', 'Ready to Ship'];
export const pickOrders = PICK_STAGES.map((status, i) => {
  const merchantId = whMerchants[i % whMerchants.length].id;
  const pool = inventory.filter((it) => it.merchantId === merchantId && it.stock > 2);
  const lines = rng.shuffle(pool.length ? pool : inventory).slice(0, rng.int(1, 3)).map((it) => ({ skuId: it.id, qty: rng.int(1, 2), bin: it.bin, picked: status !== 'New' }));
  return {
    id: `ORD-${String(7001 + i)}`,
    merchantId,
    customer: `${rng.pick(['Sara', 'Ahmed', 'Mariam', 'Hassan', 'Zara'])} ${rng.pick(['Ali', 'Khan', 'Baig', 'Rana'])}`,
    city: rng.pick(['Lahore', 'Karachi', 'Islamabad', 'Multan']),
    status,
    lines,
    createdAt: rng.daysAgo(3, 0).toISOString(),
    packaging: status === 'Packing' || status === 'Ready to Ship' ? 'Small box' : '',
  };
});

export const materials = [
  { id: 'PM-1', name: 'Flyer - Small', unit: 'pcs', stock: 2400, reorder: 500, cost: 12 },
  { id: 'PM-2', name: 'Flyer - Large', unit: 'pcs', stock: 340, reorder: 400, cost: 18 },
  { id: 'PM-3', name: 'Carton 12x10x8', unit: 'pcs', stock: 820, reorder: 200, cost: 55 },
  { id: 'PM-4', name: 'Carton 24x18x12', unit: 'pcs', stock: 95, reorder: 150, cost: 140 },
  { id: 'PM-5', name: 'Bubble wrap roll', unit: 'rolls', stock: 42, reorder: 15, cost: 1200 },
  { id: 'PM-6', name: 'Thermal label roll', unit: 'rolls', stock: 120, reorder: 40, cost: 650 },
];

// ---- Cargo and customs ------------------------------------------------------

const CARGO_LANES = [['Karachi', 'Jebel Ali', 'Sea'], ['Lahore', 'Dubai', 'Air'], ['Islamabad', 'Sharjah', 'Air'], ['Karachi', 'Dubai', 'Sea'], ['Peshawar', 'Karachi', 'Road'], ['Lahore', 'Karachi', 'Road'], ['Dubai', 'Lahore', 'Air']];
const COMMODITIES = ['Garments', 'Surgical instruments', 'Sports goods', 'Rice', 'Leather goods', 'Electronics', 'Auto parts', 'Handicrafts'];
const CARGO_STATUS = ['Quoted', 'Confirmed', 'Loaded', 'Departed', 'Arrived', 'Completed'];
export const cargoBookings = Array.from({ length: 15 }, (_, i) => {
  const [origin, destination, mode] = CARGO_LANES[i % CARGO_LANES.length];
  const weight = rng.int(120, 8500);
  return {
    id: `CG-${String(4001 + i)}`,
    mode, origin, destination,
    consignee: rng.pick(['Creek Trading LLC', 'Gulf Imports FZE', 'Al Noor Perfumes', 'Unity Foods Group', 'Crescent Motors', 'Global Pharma Ltd']),
    commodity: COMMODITIES[i % COMMODITIES.length],
    weight,
    cbm: Math.round((weight / 280) * 10) / 10,
    reference: mode === 'Sea' ? `MSKU${rng.int(1000000, 9999999)}` : mode === 'Air' ? `${rng.pick(['PK', 'EK', 'FZ'])}-${rng.int(100, 999)}` : `TRK-${rng.int(1000, 9999)}`,
    freightCost: Math.round(weight * (mode === 'Air' ? 610 : mode === 'Sea' ? 90 : 42)),
    status: CARGO_STATUS[i % CARGO_STATUS.length],
    date: rng.daysAgo(40, 0).toISOString(),
    merchantId: merchants[35 + (i % 5)].id,
  };
});

export const carriers = [
  { id: 'CR-1', name: 'TCS Partner Line', type: 'Courier', contact: 'partners@tcs.example.com', lanes: 'Pakistan domestic', status: 'Active' },
  { id: 'CR-2', name: 'Leopards Partner Line', type: 'Courier', contact: 'ops@leopards.example.com', lanes: 'Pakistan domestic', status: 'Active' },
  { id: 'CR-3', name: 'Aramex Partner Line', type: 'Courier', contact: 'gcc@aramex.example.com', lanes: 'PK - UAE', status: 'Active' },
  { id: 'CR-4', name: 'Gulf Sea Lines', type: 'Sea', contact: 'bookings@gulfsea.example.com', lanes: 'KHI - JEA', status: 'Active' },
  { id: 'CR-5', name: 'SkyBridge Air Cargo', type: 'Air', contact: 'cargo@skybridge.example.com', lanes: 'LHE/ISB - DXB/SHJ', status: 'Active' },
  { id: 'CR-6', name: 'Indus Road Haulage', type: 'Road', contact: 'dispatch@indusroad.example.com', lanes: 'PK national', status: 'Inactive' },
];

export const consolidations = [
  { id: 'MS-801', masterNo: 'MAWB-214-77120035', mode: 'Air', origin: 'Lahore', destination: 'Dubai', cost: 186000, awbs: shipments.filter((s) => s.service === 'international' && s.status === STATUS.TRANSIT).slice(0, 4).map((s) => s.awb), status: 'Departed', createdAt: rng.daysAgo(5, 1).toISOString() },
  { id: 'MS-802', masterNo: 'BL-KHIJEA-55103', mode: 'Sea', origin: 'Karachi', destination: 'Jebel Ali', cost: 92000, awbs: shipments.filter((s) => s.service === 'international' && s.status === STATUS.DELIVERED).slice(0, 5).map((s) => s.awb), status: 'Completed', createdAt: rng.daysAgo(30, 15).toISOString() },
];

export const HS_CODES = [
  { code: '6109.10', description: 'T-shirts, cotton, knitted', duty: 20, tax: 17 },
  { code: '6204.42', description: "Women's dresses of cotton", duty: 20, tax: 17 },
  { code: '9018.90', description: 'Surgical and medical instruments', duty: 3, tax: 5 },
  { code: '9506.62', description: 'Inflatable balls (footballs)', duty: 11, tax: 17 },
  { code: '1006.30', description: 'Semi-milled or wholly milled rice', duty: 5, tax: 0 },
  { code: '4203.10', description: 'Articles of apparel of leather', duty: 16, tax: 17 },
  { code: '8518.30', description: 'Headphones and earphones', duty: 11, tax: 17 },
  { code: '8517.13', description: 'Smartphones', duty: 16, tax: 18 },
  { code: '3303.00', description: 'Perfumes and toilet waters', duty: 20, tax: 25 },
  { code: '8708.99', description: 'Parts and accessories for motor vehicles', duty: 35, tax: 17 },
  { code: '6403.99', description: 'Footwear with leather uppers', duty: 20, tax: 17 },
  { code: '3304.99', description: 'Beauty and skincare preparations', duty: 20, tax: 25 },
  { code: '6802.91', description: 'Worked marble and handicraft stone', duty: 11, tax: 17 },
  { code: '4901.99', description: 'Printed books and brochures', duty: 0, tax: 0 },
];

export const CUSTOMS_STAGES = ['Documents', 'Filed', 'Assessment', 'Duty Paid', 'Cleared'];
const DOC_CHECKLIST = ['Commercial Invoice', 'Packing List', 'Bill of Lading / AWB', 'Certificate of Origin', 'Import Permit'];
export const customsFiles = Array.from({ length: 10 }, (_, i) => {
  const cargo = cargoBookings[i];
  const hs = HS_CODES[i % HS_CODES.length];
  const status = i === 7 ? 'Held' : CUSTOMS_STAGES[i % CUSTOMS_STAGES.length];
  const value = rng.int(150000, 2800000);
  const stageIdx = CUSTOMS_STAGES.indexOf(status);
  return {
    id: `CF-${String(601 + i)}`,
    cargoId: cargo.id,
    gdNumber: `GD-${rng.pick(['KPPI', 'LPAF', 'DXBA'])}-${rng.int(10000, 99999)}`,
    hsCode: hs.code,
    description: cargo.commodity,
    importer: cargo.consignee,
    origin: cargo.origin,
    destination: cargo.destination,
    value,
    status,
    documents: DOC_CHECKLIST.map((name, d) => ({ name, uploaded: status === 'Held' ? d < 3 : stageIdx > 0 || d < 2 })),
    invoiceItems: [{ description: cargo.commodity, qty: rng.int(10, 400), unitValue: 0, hs: hs.code }],
    packing: { cartons: rng.int(4, 90), gross: cargo.weight, net: Math.round(cargo.weight * 0.94) },
    updatedAt: rng.daysAgo(8, 0).toISOString(),
  };
});
customsFiles.forEach((f) => { f.invoiceItems[0].unitValue = Math.round(f.value / f.invoiceItems[0].qty); });

// ---- Returns and claims (14 + 6 = 20) ---------------------------------------

const rtoShipments = shipments.filter((s) => [STATUS.RTO, STATUS.RETURNED].includes(s.status));
export const returnsList = rtoShipments.slice(0, 14).map((s, i) => ({
  id: `RT-${String(i + 1).padStart(3, '0')}`,
  awb: s.awb,
  shipmentId: s.id,
  merchantId: s.merchantId,
  branchId: s.originBranchId,
  reason: s.ndr?.reason || 'Refused to accept',
  charge: Math.round(s.charges.base * 0.6) || 100,
  currency: s.currency,
  status: s.status === STATUS.RETURNED ? (i % 3 === 0 ? 'Restocked' : 'Returned to Merchant') : 'In Return',
  decision: s.status === STATUS.RETURNED ? (i % 3 === 0 ? 'Restock' : 'Return to Merchant') : '',
  date: s.events[s.events.length - 1].at,
}));

const claimShipments = shipments.filter((s) => s.status === STATUS.DELIVERED || s.status === STATUS.TRANSIT).slice(0, 6);
export const claims = claimShipments.map((s, i) => ({
  id: `CL-${String(i + 1).padStart(3, '0')}`,
  awb: s.awb,
  shipmentId: s.id,
  merchantId: s.merchantId,
  type: i % 2 ? 'Damaged' : 'Lost',
  description: i % 2 ? 'Box crushed on arrival, contents broken' : 'Parcel not found after hub transfer',
  claimAmount: s.parcel.declaredValue,
  compensation: ['Approved', 'Settled'].includes(['Filed', 'Under Review', 'Approved', 'Rejected', 'Settled', 'Filed'][i]) ? Math.round(s.parcel.declaredValue * 0.8) : 0,
  currency: s.currency,
  status: ['New', 'Under Review', 'Approved', 'Rejected', 'Settled', 'New'][i],
  evidence: i % 2 ? [{ name: 'damage-photo-1.jpg', size: '1.2 MB' }] : [],
  date: rng.daysAgo(25, 1).toISOString(),
}));

// ---- Support (25 tickets) ---------------------------------------------------

const SUBJECTS = ['Parcel delayed beyond ETA', 'COD amount not received', 'Rider was rude at the door', 'Wrong item delivered', 'Change delivery address', 'Update receiver phone number', 'Payout statement mismatch', 'Parcel marked delivered but not received', 'Need re-attempt tomorrow', 'Invoice correction request'];
const AGENTS = ['Ayesha Nawaz', 'Maria Yousaf', 'Bilal Ahmed', 'Hina Siddiqui'];
export const SLA_HOURS = { Urgent: 4, High: 8, Medium: 24, Low: 48 };
export const tickets = Array.from({ length: 25 }, (_, i) => {
  const merchantPool = i % 4 === 0 ? shipments.filter((s) => s.merchantId === 'M001') : shipments;
  const s = rng.pick(merchantPool);
  const priority = rng.weighted([['Urgent', 2], ['High', 5], ['Medium', 10], ['Low', 6]]);
  const status = rng.weighted([['Open', 8], ['In Progress', 7], ['Resolved', 6], ['Closed', 4]]);
  const createdAt = new Date(Date.now() - rng.int(1, 120) * HOUR);
  const merchant = merchants.find((m) => m.id === s.merchantId);
  const subject = SUBJECTS[i % SUBJECTS.length];
  return {
    id: `TK-${String(9001 + i)}`,
    subject,
    awb: s.awb,
    shipmentId: s.id,
    merchantId: s.merchantId,
    requester: merchant.contact,
    priority, status,
    assignee: rng.pick(AGENTS),
    createdAt: createdAt.toISOString(),
    resolvedAt: ['Resolved', 'Closed'].includes(status) ? new Date(createdAt.getTime() + rng.int(1, 20) * HOUR).toISOString() : null,
    replies: [
      { id: 1, author: merchant.contact, internal: false, at: createdAt.toISOString(), text: `${subject}. AWB ${s.awb}. Please look into this.` },
      ...(status !== 'Open' ? [{ id: 2, author: 'Support Desk', internal: false, at: new Date(createdAt.getTime() + HOUR).toISOString(), text: 'Thanks for reaching out. We are checking with the branch and will update you shortly.' }] : []),
    ],
  };
});

export const cannedResponses = [
  { id: 'C1', title: 'Acknowledge', text: 'Thanks for contacting Selections Logix. We have logged your request and will update you shortly.' },
  { id: 'C2', title: 'Delay apology', text: 'We apologise for the delay. Your parcel is on its way and a new delivery date will be shared today.' },
  { id: 'C3', title: 'COD timeline', text: 'COD is released within 3 working days of reconciliation. You can see the status in your COD ledger.' },
  { id: 'C4', title: 'Re-attempt booked', text: 'A re-attempt has been booked for the next working day. The rider will call before arrival.' },
  { id: 'C5', title: 'Resolved', text: 'This issue is now resolved. Please reply if you need anything else.' },
];

export const feedback = Array.from({ length: 12 }, (_, i) => {
  const s = rng.pick(shipments);
  const isComplaint = i % 3 === 0;
  return {
    id: `FB-${String(i + 1).padStart(3, '0')}`,
    type: isComplaint ? 'Complaint' : 'Feedback',
    awb: s.awb,
    customer: s.receiver.name,
    rating: isComplaint ? rng.int(1, 2) : rng.int(3, 5),
    comment: isComplaint ? rng.pick(['Rider did not call before coming', 'Parcel arrived with a torn packet', 'Delivery was two days late']) : rng.pick(['Quick delivery, thank you', 'Rider was polite and helpful', 'Easy tracking, good service', 'On time as promised']),
    status: isComplaint ? rng.pick(['Open', 'In Progress', 'Resolved']) : 'Closed',
    date: rng.daysAgo(30, 0).toISOString(),
  };
});

// ---- Notifications ----------------------------------------------------------

const TEMPLATE_STATUSES = [STATUS.BOOKED, STATUS.PICKED, STATUS.TRANSIT, STATUS.OFD, STATUS.DELIVERED, STATUS.FAILED, STATUS.RTO];
const TEMPLATE_BODY = {
  [STATUS.BOOKED]: 'Hi {name}, your shipment {awb} from {merchant} is booked. Track it at {link}.',
  [STATUS.PICKED]: 'Hi {name}, shipment {awb} has been picked up and is on its way.',
  [STATUS.TRANSIT]: 'Shipment {awb} is in transit to {city}. Expected by {eta}.',
  [STATUS.OFD]: 'Hi {name}, shipment {awb} is out for delivery today. Please keep {cod} ready.',
  [STATUS.DELIVERED]: 'Shipment {awb} has been delivered. Thank you for choosing Selections Logix.',
  [STATUS.FAILED]: 'We could not deliver {awb} today. Reply or call to reschedule.',
  [STATUS.RTO]: 'Shipment {awb} is being returned to the sender.',
};
export const TEMPLATE_VARS = ['{name}', '{awb}', '{merchant}', '{city}', '{eta}', '{cod}', '{link}'];
export const CHANNELS = ['WhatsApp', 'SMS', 'Email'];
export const templates = TEMPLATE_STATUSES.flatMap((status) => CHANNELS.map((channel) => ({
  id: `TP-${status.replace(/\s+/g, '')}-${channel}`,
  status, channel,
  subject: channel === 'Email' ? `Shipment update: ${status}` : '',
  body: TEMPLATE_BODY[status],
  enabled: channel !== 'Email' || status === STATUS.DELIVERED,
})));

export const sendLog = Array.from({ length: 30 }, (_, i) => {
  const s = rng.pick(shipments);
  const channel = rng.pick(CHANNELS);
  return {
    id: `MSG-${String(i + 1).padStart(4, '0')}`,
    awb: s.awb,
    to: channel === 'Email' ? `${s.receiver.name.split(' ')[0].toLowerCase()}@mail.example.com` : s.receiver.phone,
    channel,
    event: s.status,
    status: rng.weighted([['Delivered', 8], ['Sent', 3], ['Failed', 1], ['Queued', 1]]),
    at: rng.daysAgo(7, 0).toISOString(),
  };
});

export const notifications = [
  ...shipments.filter((s) => s.status === STATUS.FAILED).slice(0, 6).map((s) => ({ type: 'alert', title: `Delivery failed: ${s.awb}`, body: `${s.ndr.reason} - ${s.destCity}`, link: `/shipments/${s.id}` })),
  { type: 'alert', title: 'Rider cash shortage', body: 'A rider deposit is below the expected amount', link: '/finance/reconciliation' },
  { type: 'info', title: 'Payout batch awaiting approval', body: 'New merchant payouts are ready to review', link: '/finance/payouts' },
  { type: 'alert', title: 'Low stock alert', body: 'Several SKUs are below their reorder level', link: '/warehouse/inventory' },
  { type: 'info', title: 'New ticket assigned', body: 'A support ticket was assigned to your team', link: '/support' },
  ...shipments.filter((s) => s.status === STATUS.DELIVERED).slice(0, 6).map((s) => ({ type: 'info', title: `Delivered: ${s.awb}`, body: `Delivered to ${s.receiver.name}, ${s.destCity}`, link: `/shipments/${s.id}` })),
].map((n, i) => ({ id: `NT-${i + 1}`, read: i > 7, at: rng.daysAgo(3, 0).toISOString(), ...n }));

// ---- Admin ------------------------------------------------------------------

export const MODULES = [
  ['dashboard', 'Dashboard'], ['shipments', 'Shipments'], ['bulk', 'Bulk Import/Export'], ['documents', 'Labels & Documents'],
  ['branches', 'Branches'], ['customers', 'Customers'], ['riders', 'Riders & Dispatch'], ['finance', 'COD & Finance'],
  ['warehouse', 'Warehouse'], ['cargo', 'Cargo & Customs'], ['returns', 'Returns & Claims'], ['support', 'Support'],
  ['notifications', 'Notifications'], ['reports', 'Reports'], ['admin', 'Administration'], ['portal', 'Merchant Portal'], ['riderapp', 'Rider App'],
];
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export'];

const ACCESS = {
  super_admin: MODULES.map(([k]) => k),
  branch_manager: ['dashboard', 'shipments', 'bulk', 'documents', 'branches', 'customers', 'riders', 'returns', 'support', 'notifications', 'reports'],
  accountant: ['dashboard', 'finance', 'customers', 'documents', 'reports', 'notifications'],
  warehouse: ['dashboard', 'shipments', 'documents', 'warehouse', 'returns', 'notifications'],
  rider: ['dashboard', 'riderapp', 'notifications'],
  merchant: ['dashboard', 'shipments', 'bulk', 'documents', 'portal', 'notifications'],
};

/** role -> module -> { view, create, edit, delete, export } */
export const defaultPermissions = Object.fromEntries(Object.keys(ROLE_LABELS).map((role) => [
  role,
  Object.fromEntries(MODULES.map(([mod]) => {
    const has = ACCESS[role].includes(mod);
    return [mod, {
      view: has,
      create: has && role !== 'rider',
      edit: has && role !== 'rider',
      delete: has && ['super_admin', 'branch_manager'].includes(role),
      export: has && role !== 'rider',
    }];
  })),
]));

const AUDIT_ACTIONS = [
  ['Shipment', 'Status changed', () => `${rng.pick(shipments).awb}: In Transit -> At Destination Hub`],
  ['Finance', 'Cash deposit recorded', () => `Rider deposit Rs ${rng.int(5, 90)},000 recorded`],
  ['Finance', 'Payout approved', () => `PO-00${rng.int(10, 20)} approved`],
  ['User', 'Login', () => 'Signed in from web'],
  ['Rate Card', 'Fuel surcharge updated', () => 'Fuel surcharge 7% -> 8%'],
  ['Customer', 'KYC verified', () => `${rng.pick(merchants).name} marked Verified`],
  ['Invoice', 'Invoice sent', () => `SLX-INV-${rng.int(1001, 1030)} emailed`],
  ['Warehouse', 'Stock adjusted', () => `${rng.pick(inventory).sku} qty changed by -${rng.int(1, 9)}`],
];
export const auditLog = Array.from({ length: 40 }, (_, i) => {
  const [entity, action, detail] = rng.pick(AUDIT_ACTIONS);
  const user = rng.pick(users.slice(0, 4));
  return { id: `AU-${String(i + 1).padStart(4, '0')}`, at: rng.daysAgo(14, 0).toISOString(), user: user.name, role: ROLE_LABELS[user.role], entity, action, detail: detail(), ip: `10.20.${rng.int(0, 9)}.${rng.int(2, 250)}` };
}).sort((a, b) => new Date(b.at) - new Date(a.at));

export const integrations = [
  { id: 'I1', group: 'Courier APIs', name: 'TCS', desc: 'Book and track partner-line parcels', status: 'Connected' },
  { id: 'I2', group: 'Courier APIs', name: 'Leopards', desc: 'Book and track partner-line parcels', status: 'Connected' },
  { id: 'I3', group: 'Courier APIs', name: 'Aramex', desc: 'Cross-border lanes and rates', status: 'Disconnected' },
  { id: 'I4', group: 'Payment gateway', name: 'JazzCash', desc: 'Collect invoice payments', status: 'Connected' },
  { id: 'I5', group: 'Payment gateway', name: 'Stripe', desc: 'Card payments for UAE customers', status: 'Disconnected' },
  { id: 'I6', group: 'SMS / WhatsApp', name: 'WhatsApp Business', desc: 'Status updates and NDR follow-ups', status: 'Connected' },
  { id: 'I7', group: 'SMS / WhatsApp', name: 'Twilio SMS', desc: 'OTP and delivery SMS', status: 'Disconnected' },
  { id: 'I8', group: 'Maps', name: 'Google Maps', desc: 'Geocoding and rider routes', status: 'Disconnected' },
];

export const storeIntegrations = [
  { id: 'S1', name: 'Shopify', desc: 'Sync orders and push tracking numbers', status: 'Disconnected' },
  { id: 'S2', name: 'WooCommerce', desc: 'WordPress store plugin', status: 'Disconnected' },
  { id: 'S3', name: 'Magento', desc: 'Adobe Commerce extension', status: 'Disconnected' },
];

export const scheduledReports = [
  { id: 'SR-1', report: 'COD Aging', frequency: 'Weekly', recipients: 'accounts@selections.demo', format: 'Excel', status: 'Scheduled' },
  { id: 'SR-2', report: 'Delivery Performance', frequency: 'Daily', recipients: 'ops@selections.demo', format: 'PDF', status: 'Scheduled' },
];

export const defaultSettings = {
  company: 'Selections Technologies',
  product: 'Selections Logix Suite',
  tagline: 'Ship. Collect. Control.',
  email: 'hello@selections.demo',
  phone: '+92 42 3577 1100',
  address: '42 Ferozepur Road, Gulberg III, Lahore',
  ntn: 'NTN-1234567-8',
  logo: '',
  invoicePrefix: 'SLX-INV-',
  invoiceNext: 1031,
  taxName: 'GST',
  taxPct: 16,
  labelFormat: '4x6',
  statusNames: {},
  notify: { whatsapp: true, sms: true, email: false, codAlerts: true, slaAlerts: true },
};

export { branches };

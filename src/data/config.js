// Configuration and reference lists the app needs to work. No sample business records live here:
// branches, customers, riders and users come from the database, and the operational
// collections start empty.
import { STATUS } from '../utils/status.js';

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  branch_manager: 'Branch Manager',
  accountant: 'Accountant',
  warehouse: 'Warehouse Staff',
  rider: 'Rider',
  merchant: 'Merchant / Customer',
};

// ---- Shipments --------------------------------------------------------------
export const COURIER_NAMES = ['Selections Express', 'TCS Partner Line', 'Leopards Partner Line', 'Aramex Partner Line'];

// ---- Warehouse --------------------------------------------------------------
export const stockStatus = (item) => (item.stock <= 0 ? 'Out of Stock' : item.stock <= item.reorder ? 'Low Stock' : 'In Stock');

// ---- Customs ----------------------------------------------------------------
// Reference values for the duty calculator. Check current rates before relying on them.
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

// ---- Support ----------------------------------------------------------------
export const SLA_HOURS = { Urgent: 4, High: 8, Medium: 24, Low: 48 };
export const cannedResponses = [
  { id: 'C1', title: 'Acknowledge', text: 'Thanks for contacting Selections Logix. We have logged your request and will update you shortly.' },
  { id: 'C2', title: 'Delay apology', text: 'We apologise for the delay. Your parcel is on its way and a new delivery date will be shared today.' },
  { id: 'C3', title: 'COD timeline', text: 'COD is released within 3 working days of reconciliation. You can see the status in your COD ledger.' },
  { id: 'C4', title: 'Re-attempt booked', text: 'A re-attempt has been booked for the next working day. The rider will call before arrival.' },
  { id: 'C5', title: 'Resolved', text: 'This issue is now resolved. Please reply if you need anything else.' },
];

// ---- Finance ----------------------------------------------------------------
export const EXPENSE_CATEGORIES = ['Fuel', 'Salaries', 'Rent', 'Utilities', 'Vehicle Maintenance', 'Packaging', 'Marketing', 'Office Supplies'];

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

// Integrations the platform supports. None is connected until it is set up.
export const integrations = [
  { id: 'I1', group: 'Courier APIs', name: 'TCS', desc: 'Book and track partner-line parcels', status: 'Disconnected' },
  { id: 'I2', group: 'Courier APIs', name: 'Leopards', desc: 'Book and track partner-line parcels', status: 'Disconnected' },
  { id: 'I3', group: 'Courier APIs', name: 'Aramex', desc: 'Cross-border lanes and rates', status: 'Disconnected' },
  { id: 'I4', group: 'Payment gateway', name: 'JazzCash', desc: 'Collect invoice payments', status: 'Disconnected' },
  { id: 'I5', group: 'Payment gateway', name: 'Stripe', desc: 'Card payments for UAE customers', status: 'Disconnected' },
  { id: 'I6', group: 'SMS / WhatsApp', name: 'WhatsApp Business', desc: 'Status updates and NDR follow-ups', status: 'Disconnected' },
  { id: 'I7', group: 'SMS / WhatsApp', name: 'Twilio SMS', desc: 'OTP and delivery SMS', status: 'Disconnected' },
  { id: 'I8', group: 'Maps', name: 'Google Maps', desc: 'Geocoding and rider routes', status: 'Disconnected' },
];

export const storeIntegrations = [
  { id: 'S1', name: 'Shopify', desc: 'Sync orders and push tracking numbers', status: 'Disconnected' },
  { id: 'S2', name: 'WooCommerce', desc: 'WordPress store plugin', status: 'Disconnected' },
  { id: 'S3', name: 'Magento', desc: 'Adobe Commerce extension', status: 'Disconnected' },
];

// Company details shown on invoices and labels. Edit them under Administration > Settings.
export const defaultSettings = {
  company: 'Selections Technologies',
  product: 'Selections Logix Suite',
  tagline: 'Ship. Collect. Control.',
  email: '',
  phone: '',
  address: '',
  ntn: '',
  logo: '',
  invoicePrefix: 'SLX-INV-',
  invoiceNext: 1001,
  taxName: 'GST',
  taxPct: 16,
  labelFormat: 'a5',
  statusNames: {},
  notify: { whatsapp: true, sms: true, email: false, codAlerts: true, slaAlerts: true },
};

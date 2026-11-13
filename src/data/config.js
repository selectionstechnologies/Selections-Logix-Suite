// Configuration and reference lists the app needs to work. No sample business records live here:
// branches, customers, riders and users come from the database, and the operational
// collections start empty.

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

// ---- Admin ------------------------------------------------------------------
export const MODULES = [
  ['dashboard', 'Dashboard'], ['shipments', 'Shipments'], ['documents', 'Labels & Documents'],
  ['branches', 'Branches'], ['customers', 'Customers'], ['riders', 'Riders & Dispatch'], ['finance', 'COD & Finance'],
  ['notifications', 'Notifications'], ['admin', 'Administration'], ['portal', 'Merchant Portal'], ['riderapp', 'Rider App'],
];
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export'];

const ACCESS = {
  super_admin: MODULES.map(([k]) => k),
  branch_manager: ['dashboard', 'shipments', 'documents', 'branches', 'customers', 'riders', 'notifications'],
  accountant: ['dashboard', 'finance', 'customers', 'documents', 'notifications'],
  warehouse: ['dashboard', 'shipments', 'documents', 'notifications'],
  rider: ['dashboard', 'riderapp', 'notifications'],
  merchant: ['dashboard', 'shipments', 'documents', 'portal', 'notifications'],
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
  labelFormat: 'a5',
  statusNames: {},
  notify: { whatsapp: true, sms: true, email: false, codAlerts: true, slaAlerts: true },
};

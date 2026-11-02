// One table drives routes, guards, the sidebar and breadcrumbs, so they cannot disagree.
// `module` ties a screen to the permission matrix; `roles` narrows it further where a screen
// does not make sense for a role that otherwise has that module (e.g. merchants and hub scan).
import { lazy } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  AlertTriangle, BarChart3, Bell, Bike, BookUser, Boxes, Building2, ClipboardCheck, ClipboardList, FileCog, FileSpreadsheet, FileText, FolderCheck, History, Inbox, LayoutDashboard, Layers,
  LifeBuoy, MessageSquare, PackageOpen, PackagePlus, PackageSearch, Plane, Plug, Printer, Receipt, RotateCcw, ScanLine, Scale, Send, Settings, ShieldAlert, Ship, Tags, Truck, Users, Waypoints, Wallet, ArrowLeftRight, BookOpen, Banknote, HandCoins, Warehouse,
} from 'lucide-react';
import { useAuth } from '../store/authStore.js';
import { useCan } from '../hooks/useApp.js';
import { Forbidden } from '../components/layout/Fallbacks.jsx';

const named = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));

const dash = () => import('../pages/dashboard/index.jsx');
const ship = () => import('../pages/shipments/ShipmentList.jsx');
const shipOps = () => import('../pages/shipments/ShipmentOps.jsx');
const branch = () => import('../pages/branches/index.jsx');
const cust = () => import('../pages/customers/index.jsx');
const portal = () => import('../pages/customers/Portal.jsx');
const rider = () => import('../pages/riders/index.jsx');
const riderApp = () => import('../pages/riders/RiderApp.jsx');
const cod = () => import('../pages/finance/Cod.jsx');
const inv = () => import('../pages/finance/Invoices.jsx');
const ledger = () => import('../pages/finance/Ledgers.jsx');
const rates = () => import('../pages/finance/RateCards.jsx');
const wh = () => import('../pages/warehouse/index.jsx');
const cargo = () => import('../pages/cargo/index.jsx');
const customs = () => import('../pages/cargo/Customs.jsx');
const ret = () => import('../pages/returns/index.jsx');
const sup = () => import('../pages/support/index.jsx');
const notif = () => import('../pages/notifications/index.jsx');
const adm = () => import('../pages/admin/index.jsx');

export const LoginPage = lazy(() => import('../pages/auth/Login.jsx'));
export const TrackPage = lazy(() => import('../pages/shipments/Track.jsx'));

const NOT_MERCHANT = ['super_admin', 'branch_manager', 'warehouse'];
const BOOKERS = ['super_admin', 'branch_manager', 'merchant'];

/** path, element, module, roles?, plus nav fields when it appears in the sidebar. */
export const routeTable = [
  { path: '/', element: named(dash, 'Dashboard'), module: 'dashboard', nav: { group: 'Overview', label: 'Dashboard', icon: LayoutDashboard } },

  { path: '/shipments/new', element: named(() => import('../pages/shipments/CreateShipment.jsx'), 'CreateShipment'), module: 'shipments', roles: BOOKERS, nav: { group: 'Operations', label: 'Create Shipment', icon: PackagePlus }, title: 'Create Shipment' },
  { path: '/shipments', element: named(ship, 'ShipmentList'), module: 'shipments', nav: { group: 'Operations', label: 'Shipments', icon: PackageSearch } },
  { path: '/shipments/scan', element: named(shipOps, 'ParcelScan'), module: 'shipments', roles: NOT_MERCHANT, nav: { group: 'Operations', label: 'Parcel Scan', icon: ScanLine }, title: 'Parcel Scan' },
  { path: '/shipments/manifests', element: named(shipOps, 'Manifests'), module: 'shipments', roles: NOT_MERCHANT, nav: { group: 'Operations', label: 'Manifests', icon: ClipboardList }, title: 'Manifests' },
  { path: '/shipments/:id', element: named(() => import('../pages/shipments/ShipmentDetail.jsx'), 'ShipmentDetail'), module: 'shipments' },
  { path: '/bulk', element: named(() => import('../pages/bulk/index.jsx'), 'BulkCenter'), module: 'bulk', nav: { group: 'Operations', label: 'Bulk Import / Export', icon: FileSpreadsheet } },
  { path: '/documents', element: named(() => import('../pages/documents/index.jsx'), 'DocumentCenter'), module: 'documents', nav: { group: 'Operations', label: 'Labels & Documents', icon: Printer } },

  { path: '/branches', element: named(branch, 'BranchList'), module: 'branches', nav: { group: 'Network', label: 'Branches', icon: Building2 } },
  { path: '/branches/transfers', element: named(branch, 'BranchOps'), module: 'branches', nav: { group: 'Network', label: 'Transfers', icon: ArrowLeftRight }, title: 'Transfers' },
  { path: '/branches/:id', element: named(branch, 'BranchDetail'), module: 'branches' },
  { path: '/customers', element: named(cust, 'CustomerList'), module: 'customers', nav: { group: 'Network', label: 'Customers', icon: Users } },
  { path: '/customers/address-book', element: named(cust, 'AddressBook'), module: 'customers', nav: { group: 'Network', label: 'Address Book', icon: BookUser }, title: 'Address Book' },
  { path: '/customers/:id', element: named(cust, 'CustomerDetail'), module: 'customers' },
  { path: '/riders', element: named(rider, 'RiderList'), module: 'riders', nav: { group: 'Network', label: 'Riders', icon: Bike } },
  { path: '/riders/dispatch', element: named(rider, 'DispatchBoard'), module: 'riders', nav: { group: 'Network', label: 'Dispatch Board', icon: Waypoints }, title: 'Dispatch Board' },
  { path: '/riders/ndr', element: named(rider, 'NdrManagement'), module: 'riders', nav: { group: 'Network', label: 'NDR Management', icon: AlertTriangle }, title: 'NDR Management' },
  { path: '/riders/:id', element: named(rider, 'RiderDetail'), module: 'riders' },

  { path: '/rider-app', element: named(riderApp, 'RiderApp'), module: 'riderapp', nav: { group: 'Rider App', label: "Today's Run", icon: Truck } },

  { path: '/portal/cod', element: named(portal, 'PortalCod'), module: 'portal', nav: { group: 'Merchant Portal', label: 'COD Ledger', icon: Wallet }, title: 'COD Ledger' },
  { path: '/portal/payouts', element: named(portal, 'PortalPayouts'), module: 'portal', nav: { group: 'Merchant Portal', label: 'Payouts', icon: HandCoins }, title: 'Payouts' },
  { path: '/portal/invoices', element: named(portal, 'PortalInvoices'), module: 'portal', nav: { group: 'Merchant Portal', label: 'My Invoices', icon: Receipt }, title: 'My Invoices' },
  { path: '/portal/tickets', element: named(portal, 'PortalTickets'), module: 'portal', nav: { group: 'Merchant Portal', label: 'My Tickets', icon: LifeBuoy }, title: 'My Tickets' },
  { path: '/portal/tickets/:id', element: named(sup, 'TicketDetail'), module: 'portal' },
  { path: '/portal/integrations', element: named(portal, 'PortalIntegrations'), module: 'portal', nav: { group: 'Merchant Portal', label: 'API & Integrations', icon: Plug }, title: 'API & Integrations' },

  { path: '/finance', element: named(cod, 'CodDashboard'), module: 'finance', nav: { group: 'Finance', label: 'COD Dashboard', icon: Banknote } },
  { path: '/finance/reconciliation', element: named(cod, 'Reconciliation'), module: 'finance', nav: { group: 'Finance', label: 'Rider Reconciliation', icon: Scale }, title: 'Rider Reconciliation' },
  { path: '/finance/payouts', element: named(cod, 'PayoutManagement'), module: 'finance', nav: { group: 'Finance', label: 'Merchant Payouts', icon: HandCoins }, title: 'Merchant Payouts' },
  { path: '/finance/invoices', element: named(inv, 'InvoiceList'), module: 'finance', nav: { group: 'Finance', label: 'Invoices', icon: Receipt }, title: 'Invoices' },
  { path: '/finance/invoices/:id', element: named(inv, 'InvoiceDetail'), module: 'finance' },
  { path: '/portal/invoices/:id', element: named(inv, 'InvoiceDetail'), module: 'portal' },
  { path: '/finance/ledgers', element: named(ledger, 'Ledgers'), module: 'finance', nav: { group: 'Finance', label: 'Ledgers & P&L', icon: BookOpen }, title: 'Ledgers & P&L' },
  { path: '/finance/rates', element: named(rates, 'RateCards'), module: 'finance', nav: { group: 'Finance', label: 'Rate Cards', icon: Tags }, title: 'Rate Cards' },

  { path: '/warehouse/inventory', element: named(wh, 'Inventory'), module: 'warehouse', nav: { group: 'Fulfillment', label: 'Inventory', icon: Boxes }, title: 'Inventory' },
  { path: '/warehouse/inbound', element: named(wh, 'Inbound'), module: 'warehouse', nav: { group: 'Fulfillment', label: 'Inbound Receiving', icon: Inbox }, title: 'Inbound Receiving' },
  { path: '/warehouse/pick-pack', element: named(wh, 'PickPack'), module: 'warehouse', nav: { group: 'Fulfillment', label: 'Pick & Pack', icon: PackageOpen }, title: 'Pick & Pack' },
  { path: '/warehouse/stock', element: named(wh, 'StockControl'), module: 'warehouse', nav: { group: 'Fulfillment', label: 'Stock Control', icon: Warehouse }, title: 'Stock Control' },

  { path: '/cargo', element: named(cargo, 'CargoBookings'), module: 'cargo', nav: { group: 'Freight', label: 'Cargo Bookings', icon: Ship } },
  { path: '/cargo/consolidation', element: named(cargo, 'Consolidation'), module: 'cargo', nav: { group: 'Freight', label: 'Consolidation', icon: Layers }, title: 'Consolidation' },
  { path: '/cargo/customs', element: named(customs, 'CustomsFiles'), module: 'cargo', nav: { group: 'Freight', label: 'Customs', icon: FolderCheck }, title: 'Customs' },
  { path: '/cargo/carriers', element: named(cargo, 'Carriers'), module: 'cargo', nav: { group: 'Freight', label: 'Carriers', icon: Plane }, title: 'Carriers' },

  { path: '/returns', element: named(ret, 'ReturnsList'), module: 'returns', nav: { group: 'After Sales', label: 'Returns', icon: RotateCcw } },
  { path: '/returns/claims', element: named(ret, 'Claims'), module: 'returns', nav: { group: 'After Sales', label: 'Claims', icon: ClipboardCheck }, title: 'Claims' },
  { path: '/support', element: named(sup, 'TicketList'), module: 'support', nav: { group: 'After Sales', label: 'Tickets', icon: LifeBuoy } },
  { path: '/support/feedback', element: named(sup, 'FeedbackList'), module: 'support', nav: { group: 'After Sales', label: 'Feedback', icon: MessageSquare }, title: 'Feedback' },
  { path: '/support/:id', element: named(sup, 'TicketDetail'), module: 'support' },

  { path: '/reports', element: named(() => import('../pages/reports/index.jsx'), 'Reports'), module: 'reports', nav: { group: 'Insights', label: 'Reports', icon: BarChart3 } },
  { path: '/notifications', element: named(notif, 'NotificationCenter'), module: 'notifications', nav: { group: 'Insights', label: 'Notifications', icon: Bell } },
  { path: '/notifications/templates', element: named(notif, 'Templates'), module: 'notifications', roles: ['super_admin', 'branch_manager'], nav: { group: 'Insights', label: 'Templates', icon: FileText }, title: 'Templates' },
  { path: '/notifications/log', element: named(notif, 'SendLog'), module: 'notifications', roles: ['super_admin', 'branch_manager', 'accountant'], nav: { group: 'Insights', label: 'Send Log', icon: Send }, title: 'Send Log' },

  { path: '/admin/users', element: named(adm, 'UsersRoles'), module: 'admin', nav: { group: 'Administration', label: 'Users & Roles', icon: ShieldAlert }, title: 'Users & Roles' },
  { path: '/admin/audit', element: named(adm, 'AuditLog'), module: 'admin', nav: { group: 'Administration', label: 'Audit Log', icon: History }, title: 'Audit Log' },
  { path: '/admin/settings', element: named(adm, 'SystemSettings'), module: 'admin', nav: { group: 'Administration', label: 'Settings', icon: Settings }, title: 'Settings' },
  { path: '/admin/integrations', element: named(adm, 'Integrations'), module: 'admin', nav: { group: 'Administration', label: 'Integrations', icon: Plug }, title: 'Integrations' },
];

const GROUP_ORDER = ['Overview', 'Operations', 'Rider App', 'Merchant Portal', 'Network', 'Finance', 'Fulfillment', 'Freight', 'After Sales', 'Insights', 'Administration'];
const GROUP_ICONS = { 'Merchant Portal': FileCog };

const allowed = (entry, role, can) => can(entry.module, 'view') && (!entry.roles || entry.roles.includes(role));

export function navFor(role, can) {
  const entries = routeTable.filter((r) => r.nav && allowed(r, role, can));
  return GROUP_ORDER.map((group) => ({ group, icon: GROUP_ICONS[group], items: entries.filter((r) => r.nav.group === group) })).filter((g) => g.items.length);
}

/** Label for a path, used by breadcrumbs. Longest static match wins. */
export function labelForPath(path) {
  const exact = routeTable.find((r) => r.path === path);
  return exact?.nav?.label || exact?.title || null;
}

export function RequireAuth({ children }) {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function Guard({ module, roles, children }) {
  const can = useCan();
  const role = useAuth((s) => s.user?.role);
  if (!can(module, 'view') || (roles && !roles.includes(role))) return <Forbidden />;
  return children;
}

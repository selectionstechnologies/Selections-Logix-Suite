// One table drives routes, guards, the sidebar and breadcrumbs, so they cannot disagree.
// `module` ties a screen to the permission matrix; `roles` narrows it further where a screen
// does not make sense for a role that otherwise has that module (e.g. merchants and hub scan).
import { lazy } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  Banknote, Bell, Bike, Building2, FileCog, HandCoins, History, LayoutDashboard, PackagePlus, PackageSearch, Plug, Printer, Scale, ScanLine, Settings, ShieldAlert, Store, Tags, Truck, Users, Wallet, Waypoints,
} from 'lucide-react';
import { useAuth } from '../store/authStore.js';
import { useCan } from '../hooks/useApp.js';
import { Forbidden } from '../components/layout/Fallbacks.jsx';
import { PageSkeleton } from '../components/ui/index.jsx';

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
const rates = () => import('../pages/finance/RateCards.jsx');
const notif = () => import('../pages/notifications/index.jsx');
const adm = () => import('../pages/admin/index.jsx');
const acctCust = () => import('../pages/accounts/Customers.jsx');

export const LoginPage = lazy(() => import('../pages/auth/Login.jsx'));
export const TrackPage = lazy(() => import('../pages/shipments/Track.jsx'));

const NOT_MERCHANT = ['super_admin', 'branch_manager', 'warehouse'];
const BOOKERS = ['super_admin', 'branch_manager', 'merchant'];
const CUSTOMER_EDITORS = ['super_admin', 'branch_manager'];

/** path, element, module, roles?, plus nav fields when it appears in the sidebar. */
export const routeTable = [
  { path: '/', element: named(dash, 'Dashboard'), module: 'dashboard', nav: { group: 'Overview', label: 'Dashboard', icon: LayoutDashboard } },

  { path: '/shipments/new', element: named(() => import('../pages/shipments/CreateShipment.jsx'), 'CreateShipment'), module: 'shipments', roles: BOOKERS, nav: { group: 'Operations', label: 'Create Shipment', icon: PackagePlus }, title: 'Create Shipment' },
  { path: '/shipments', element: named(ship, 'ShipmentList'), module: 'shipments', nav: { group: 'Operations', label: 'Shipments', icon: PackageSearch } },
  { path: '/shipments/scan', element: named(shipOps, 'ParcelScan'), module: 'shipments', roles: NOT_MERCHANT, nav: { group: 'Operations', label: 'Parcel Scan', icon: ScanLine }, title: 'Parcel Scan' },
  { path: '/shipments/:id', element: named(() => import('../pages/shipments/ShipmentDetail.jsx'), 'ShipmentDetail'), module: 'shipments' },
  { path: '/documents', element: named(() => import('../pages/documents/index.jsx'), 'DocumentCenter'), module: 'documents', nav: { group: 'Operations', label: 'Labels & Documents', icon: Printer } },

  { path: '/branches', element: named(branch, 'BranchList'), module: 'branches', nav: { group: 'Network', label: 'Branches', icon: Building2 } },
  { path: '/branches/:id', element: named(branch, 'BranchDetail'), module: 'branches' },
  // Customer accounts live in the database. The older /customers screens stay reachable from shipment links.
  { path: '/accounts/customers', element: named(acctCust, 'CustomerAccounts'), module: 'customers', nav: { group: 'Network', label: 'Customer Accounts', icon: Users }, title: 'Customer Accounts' },
  { path: '/accounts/customers/new', element: named(() => import('../pages/accounts/CustomerForm.jsx'), 'CustomerForm'), module: 'customers', roles: CUSTOMER_EDITORS, title: 'New Customer' },
  { path: '/accounts/customers/:id', element: named(acctCust, 'CustomerAccountView'), module: 'customers' },
  { path: '/accounts/customers/:id/edit', element: named(() => import('../pages/accounts/CustomerForm.jsx'), 'CustomerForm'), module: 'customers', roles: CUSTOMER_EDITORS },
  { path: '/customers', element: named(cust, 'CustomerList'), module: 'customers', title: 'Customers' },
  { path: '/customers/:id', element: named(cust, 'CustomerDetail'), module: 'customers' },
  { path: '/riders', element: named(rider, 'RiderList'), module: 'riders', nav: { group: 'Network', label: 'Riders', icon: Bike } },
  { path: '/riders/dispatch', element: named(rider, 'DispatchBoard'), module: 'riders', nav: { group: 'Network', label: 'Dispatch Board', icon: Waypoints }, title: 'Dispatch Board' },
  { path: '/riders/:id', element: named(rider, 'RiderDetail'), module: 'riders' },

  { path: '/rider-app', element: named(riderApp, 'RiderApp'), module: 'riderapp', nav: { group: 'Rider App', label: "Today's Run", icon: Truck } },

  { path: '/portal/account', element: named(acctCust, 'MyAccount'), module: 'portal', roles: ['merchant'], nav: { group: 'Merchant Portal', label: 'My Account', icon: Store }, title: 'My Account' },
  { path: '/portal/cod', element: named(portal, 'PortalCod'), module: 'portal', nav: { group: 'Merchant Portal', label: 'COD Ledger', icon: Wallet }, title: 'COD Ledger' },
  { path: '/portal/payouts', element: named(portal, 'PortalPayouts'), module: 'portal', nav: { group: 'Merchant Portal', label: 'Payouts', icon: HandCoins }, title: 'Payouts' },

  { path: '/finance', element: named(cod, 'CodDashboard'), module: 'finance', nav: { group: 'Finance', label: 'COD Dashboard', icon: Banknote } },
  { path: '/finance/reconciliation', element: named(cod, 'Reconciliation'), module: 'finance', nav: { group: 'Finance', label: 'Rider Reconciliation', icon: Scale }, title: 'Rider Reconciliation' },
  { path: '/finance/payouts', element: named(cod, 'PayoutManagement'), module: 'finance', nav: { group: 'Finance', label: 'Merchant Payouts', icon: HandCoins }, title: 'Merchant Payouts' },
  { path: '/finance/rates', element: named(rates, 'RateCards'), module: 'finance', nav: { group: 'Finance', label: 'Rate Cards', icon: Tags }, title: 'Rate Cards' },




  { path: '/notifications', element: named(notif, 'NotificationCenter'), module: 'notifications', nav: { group: 'Insights', label: 'Notifications', icon: Bell } },

  { path: '/admin/users', element: named(() => import('../pages/accounts/Users.jsx'), 'UsersAdmin'), module: 'admin', roles: ['super_admin'], nav: { group: 'Administration', label: 'Users & Roles', icon: ShieldAlert }, title: 'Users & Roles' },
  { path: '/admin/branches', element: named(() => import('../pages/accounts/Branches.jsx'), 'BranchSetup'), module: 'admin', roles: ['super_admin'], nav: { group: 'Administration', label: 'Branch Setup', icon: Building2 }, title: 'Branch Setup' },
  { path: '/admin/audit', element: named(adm, 'AuditLog'), module: 'admin', nav: { group: 'Administration', label: 'Audit Log', icon: History }, title: 'Audit Log' },
  { path: '/admin/settings', element: named(adm, 'SystemSettings'), module: 'admin', nav: { group: 'Administration', label: 'Settings', icon: Settings }, title: 'Settings' },
  { path: '/admin/integrations', element: named(adm, 'Integrations'), module: 'admin', nav: { group: 'Administration', label: 'Integrations', icon: Plug }, title: 'Integrations' },
];

const GROUP_ORDER = ['Overview', 'Operations', 'Rider App', 'Merchant Portal', 'Network', 'Finance', 'Insights', 'Administration'];
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
  const ready = useAuth((s) => s.ready);
  const location = useLocation();
  if (!ready) return <div className="p-6"><PageSkeleton /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function Guard({ module, roles, children }) {
  const can = useCan();
  const role = useAuth((s) => s.user?.role);
  if (!can(module, 'view') || (roles && !roles.includes(role))) return <Forbidden />;
  return children;
}

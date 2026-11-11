import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeftRight, Building2, Clock, Pencil, Phone, Plus, Trash2, User, Wallet } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, KV, PageHeader, StatCard, StatusBadge, Tabs } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { RecordNotFound } from '../../components/layout/Fallbacks.jsx';
import { BarsChart, AreaTrend } from '../../components/charts/index.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useLookups, useMoney } from '../../hooks/useApp.js';
import { BRANCH_TYPES, CITY_NAMES } from '../../data/geo.js';
import { branchStats, dailySeries, riderStats } from '../../data/helpers.js';
import { stockStatus } from '../../data/config.js';
import { fmtDate, fmtNumber, fmtPct } from '../../utils/format.js';
import { shipmentColumns } from '../shipments/columns.jsx';

const BRANCH_FIELDS = [
  { name: 'name', label: 'Branch name', required: true, full: true },
  { name: 'code', label: 'Code', required: true },
  { name: 'type', label: 'Type', type: 'select', options: BRANCH_TYPES, required: true },
  { name: 'city', label: 'City', type: 'select', options: CITY_NAMES, required: true },
  { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], required: true, default: 'Active' },
  { name: 'address', label: 'Address', required: true, full: true },
  { name: 'manager', label: 'Manager', required: true },
  { name: 'phone', label: 'Phone', required: true, phone: true },
  { name: 'hours', label: 'Working hours', required: true, placeholder: '09:00 - 18:00' },
  { name: 'targetShipments', label: 'Target shipments', type: 'number', min: 0 },
];

export function BranchList() {
  const navigate = useNavigate();
  const { compact } = useMoney();
  const user = useAuth((s) => s.user);
  const { branches, shipments, codTransactions, riders, addItem } = useData();
  const [adding, setAdding] = useState(false);
  const stats = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, branchStats(b.id, shipments, codTransactions)])), [branches, shipments, codTransactions]);
  const visible = user.role === 'branch_manager' ? branches.filter((b) => b.id === user.branchId) : branches;
  return (
    <div>
      <PageHeader title="Branches" subtitle={`${visible.length} locations across the network`} actions={user.role === 'super_admin' && <button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> Add branch</button>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((b) => (
          <button key={b.id} type="button" onClick={() => navigate(`/branches/${b.id}`)} className="card p-4 text-start transition hover:border-primary-hover">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{b.name}</p>
                <p className="text-xs text-ink-muted">{b.code} - {b.type}</p>
              </div>
              <StatusBadge status={b.status} />
            </div>
            <p className="mb-3 line-clamp-1 text-xs text-ink-muted">{b.address}</p>
            <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
              <div><p className="text-lg font-bold">{stats[b.id]?.total || 0}</p><p className="text-[11px] text-ink-muted">Shipments</p></div>
              <div><p className="text-lg font-bold">{riders.filter((r) => r.branchId === b.id).length}</p><p className="text-[11px] text-ink-muted">Riders</p></div>
              <div><p className="text-lg font-bold">{compact(stats[b.id]?.cash || 0)}</p><p className="text-[11px] text-ink-muted">Cash</p></div>
            </div>
          </button>
        ))}
      </div>
      <FormModal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add branch"
        fields={BRANCH_FIELDS}
        onSubmit={(v) => {
          const id = v.code.split('-')[0].toUpperCase() + (branches.some((b) => b.id === v.code.split('-')[0].toUpperCase()) ? branches.length : '');
          addItem('branches', { ...v, id, targetRevenue: 50000, commissionPct: 0, cash: 0, targetShipments: v.targetShipments || 0 }, 'Branch', `${v.name} added`);
          setAdding(false);
          toast.success(`${v.name} added`);
        }}
      />
    </div>
  );
}

export function BranchDetail() {
  const { id } = useParams();
  const { money, compact } = useMoney();
  const lookups = useLookups();
  const user = useAuth((s) => s.user);
  const { branches, shipments, codTransactions, riders, users, inventory, updateItem, removeItem } = useData();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const branch = branches.find((b) => b.id === id);
  const stats = useMemo(() => branchStats(id, shipments, codTransactions), [id, shipments, codTransactions]);
  const daily = useMemo(() => dailySeries(stats.list, 14), [stats.list]);
  const columns = useMemo(() => shipmentColumns({ money, lookups, compact: true }), [money, lookups]);
  if (!branch || (user.role === 'branch_manager' && user.branchId !== id)) return <RecordNotFound what="Branch" backTo="/branches" backLabel="Back to branches" />;

  const branchRiders = riders.filter((r) => r.branchId === id);
  const staff = users.filter((u) => u.branchId === id);
  const stock = inventory.filter((i) => i.branchId === id);
  const last30 = stats.list.filter((s) => Date.now() - new Date(s.createdAt) < 30 * 86400000).length;
  const targetPct = branch.targetShipments ? Math.min((last30 / branch.targetShipments) * 100, 100) : 0;
  const del = async () => {
    if (stats.total > 0 || branchRiders.length > 0) { toast.error(`Cannot delete: ${stats.total} shipments and ${branchRiders.length} riders are linked. Set it to Inactive instead.`); return; }
    if (await confirm({ title: 'Delete branch?', message: `${branch.name} will be removed.`, confirmLabel: 'Delete' })) {
      removeItem('branches', id, 'Branch');
      toast.success('Branch deleted');
      navigate('/branches');
    }
  };

  return (
    <div>
      <PageHeader
        title={branch.name}
        subtitle={`${branch.code} - ${branch.type} - ${branch.city}`}
        actions={(
          <>
            <button type="button" className="btn-outline" onClick={() => setEditing(true)}><Pencil size={15} aria-hidden /> Edit</button>
            {user.role === 'super_admin' && <button type="button" className="btn-danger" onClick={del}><Trash2 size={15} aria-hidden /> Delete</button>}
          </>
        )}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Shipments" value={fmtNumber(stats.total)} icon={Building2} />
        <StatCard label="Delivered %" value={fmtPct(stats.deliveredPct)} icon={Clock} />
        <StatCard label="Cash in hand" value={compact(stats.cash)} hint="Not yet reconciled" icon={Wallet} tone={stats.cash > 0 ? 'danger' : 'default'} />
        <StatCard label="Revenue" value={compact(stats.revenue)} icon={ArrowLeftRight} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'staff', label: 'Staff', count: staff.length },
          { value: 'riders', label: 'Riders', count: branchRiders.length },
          { value: 'shipments', label: 'Shipments', count: stats.total },
          { value: 'inventory', label: 'Inventory', count: stock.length },
        ]}
      />
      {tab === 'overview' && (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <Card title="Details">
            <dl className="grid gap-3">
              <KV label="Address">{branch.address}</KV>
              <KV label="Manager"><span className="inline-flex items-center gap-1"><User size={13} aria-hidden /> {branch.manager}</span></KV>
              <KV label="Phone"><span className="inline-flex items-center gap-1"><Phone size={13} aria-hidden /> {branch.phone}</span></KV>
              <KV label="Working hours">{branch.hours}</KV>
              <KV label="Status"><StatusBadge status={branch.status} /></KV>
            </dl>
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1 flex justify-between text-xs"><span className="font-medium">30-day target</span><span>{last30} / {branch.targetShipments}</span></p>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={Math.round(targetPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Target progress"><div className="h-full bg-primary-hover" style={{ width: `${targetPct}%` }} /></div>
            </div>
          </Card>
          <Card title="Daily shipments" className="lg:col-span-2"><AreaTrend data={daily} dataKey="shipments" name="Shipments" /></Card>
        </div>
      )}
      {tab === 'staff' && (
        <DataTable data={staff} exportName={`staff-${id}`} columns={[{ key: 'name', header: 'Name' }, { key: 'email', header: 'Email' }, { key: 'role', header: 'Role', value: (u) => u.role.replace('_', ' ') }, { key: 'status', header: 'Status', render: (u) => <StatusBadge status={u.status} />, value: (u) => u.status }]} />
      )}
      {tab === 'riders' && (
        <DataTable
          data={branchRiders}
          exportName={`riders-${id}`}
          onRowClick={(r) => navigate(`/riders/${r.id}`)}
          columns={[
            { key: 'name', header: 'Rider' },
            { key: 'zone', header: 'Zone' },
            { key: 'vehicle', header: 'Vehicle' },
            { key: 'delivered', header: 'Delivered', align: 'right', value: (r) => riderStats(r, shipments, codTransactions).delivered },
            { key: 'cash', header: 'Cash in hand', align: 'right', value: (r) => riderStats(r, shipments, codTransactions).cash, render: (r) => money(riderStats(r, shipments, codTransactions).cash, r.currency) },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
          ]}
        />
      )}
      {tab === 'shipments' && <DataTable columns={columns} data={stats.list} exportName={`shipments-${id}`} onRowClick={(s) => navigate(`/shipments/${s.id}`)} />}
      {tab === 'inventory' && (
        <DataTable
          data={stock}
          exportName={`inventory-${id}`}
          columns={[
            { key: 'sku', header: 'SKU' },
            { key: 'name', header: 'Name' },
            { key: 'merchant', header: 'Merchant', value: (i) => lookups.merchantName(i.merchantId) },
            { key: 'bin', header: 'Bin' },
            { key: 'stock', header: 'Stock', align: 'right' },
            { key: 'state', header: 'Status', value: (i) => stockStatus(i), render: (i) => <StatusBadge status={stockStatus(i)} /> },
          ]}
        />
      )}
      <FormModal
        open={editing}
        onClose={() => setEditing(false)}
        title={`Edit ${branch.name}`}
        fields={BRANCH_FIELDS}
        defaultValues={branch}
        onSubmit={(v) => { updateItem('branches', id, v, 'Branch', `${v.name} edited`); setEditing(false); toast.success('Branch updated'); }}
      />
    </div>
  );
}

export function BranchOps() {
  const { money, compact } = useMoney();
  const lookups = useLookups();
  const { transfers, branches, shipments, codTransactions, addItem, updateItem } = useData();
  const [tab, setTab] = useState('transfers');
  const [adding, setAdding] = useState(false);
  const [editRate, setEditRate] = useState(null);
  const reports = useMemo(() => branches.map((b) => ({ ...b, stats: branchStats(b.id, shipments, codTransactions) })), [branches, shipments, codTransactions]);

  const advance = (t) => {
    const next = { Created: 'Dispatched', Dispatched: 'Received' }[t.status];
    updateItem('transfers', t.id, { status: next }, 'Transfer', `${t.id} ${next}`);
    toast.success(`${t.id} marked ${next}`);
  };

  return (
    <div>
      <PageHeader title="Transfers" subtitle="Inter-branch movements, branch commission, and branch-wise reporting." actions={tab === 'transfers' && <button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> New transfer</button>} />
      <Tabs tabs={[{ value: 'transfers', label: 'Inter-branch transfers', count: transfers.length }, { value: 'rates', label: 'Rates & commission' }, { value: 'reports', label: 'Branch reports' }]} value={tab} onChange={setTab} />
      {tab === 'transfers' && (
        <DataTable
          data={transfers}
          exportName="transfers"
          dateKey="date"
          filters={[{ key: 'type', label: 'Type', options: ['Cash', 'Parcels', 'Stock'] }, { key: 'status', label: 'Status', options: ['Created', 'Dispatched', 'Received'] }]}
          columns={[
            { key: 'id', header: 'Transfer' },
            { key: 'from', header: 'From', value: (t) => lookups.branchName(t.fromBranchId) },
            { key: 'to', header: 'To', value: (t) => lookups.branchName(t.toBranchId) },
            { key: 'type', header: 'Type' },
            { key: 'quantity', header: 'Quantity', align: 'right', render: (t) => (t.type === 'Cash' ? money(t.quantity) : t.quantity) },
            { key: 'date', header: 'Date', render: (t) => fmtDate(t.date), exportValue: (t) => fmtDate(t.date) },
            { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} />, value: (t) => t.status },
            { key: 'act', header: '', sortable: false, export: false, render: (t) => t.status !== 'Received' && <button type="button" className="btn-outline btn-sm" onClick={() => advance(t)}>{t.status === 'Created' ? 'Dispatch' : 'Receive'}</button> },
          ]}
        />
      )}
      {tab === 'rates' && (
        <DataTable
          data={branches}
          exportName="branch-commission"
          columns={[
            { key: 'name', header: 'Branch' },
            { key: 'type', header: 'Type' },
            { key: 'commissionPct', header: 'Commission %', align: 'right', render: (b) => `${b.commissionPct}%` },
            { key: 'earned', header: 'Commission earned', align: 'right', value: (b) => (reports.find((r) => r.id === b.id)?.stats.revenue || 0) * (b.commissionPct / 100), render: (b) => money((reports.find((r) => r.id === b.id)?.stats.revenue || 0) * (b.commissionPct / 100)) },
            { key: 'act', header: '', sortable: false, export: false, render: (b) => <button type="button" className="btn-outline btn-sm" onClick={() => setEditRate(b)}><Pencil size={13} aria-hidden /> Edit</button> },
          ]}
        />
      )}
      {tab === 'reports' && (
        <div className="space-y-4">
          <Card title="Shipments by branch"><BarsChart data={reports.map((r) => ({ name: r.code, value: r.stats.total }))} series={[{ key: 'value', name: 'Shipments' }]} /></Card>
          <DataTable
            data={reports}
            exportName="branch-report"
            columns={[
              { key: 'name', header: 'Branch', render: (r) => <Link className="link" to={`/branches/${r.id}`}>{r.name}</Link>, value: (r) => r.name },
              { key: 'total', header: 'Shipments', align: 'right', value: (r) => r.stats.total },
              { key: 'del', header: 'Delivered %', align: 'right', value: (r) => r.stats.deliveredPct, render: (r) => fmtPct(r.stats.deliveredPct), exportValue: (r) => fmtPct(r.stats.deliveredPct) },
              { key: 'rto', header: 'RTO %', align: 'right', value: (r) => r.stats.rtoPct, render: (r) => <span className={clsx(r.stats.rtoPct > 15 && 'font-semibold text-danger')}>{fmtPct(r.stats.rtoPct)}</span>, exportValue: (r) => fmtPct(r.stats.rtoPct) },
              { key: 'rev', header: 'Revenue', align: 'right', value: (r) => r.stats.revenue, render: (r) => compact(r.stats.revenue) },
              { key: 'prof', header: 'Profit', align: 'right', value: (r) => r.stats.profit, render: (r) => compact(r.stats.profit) },
              { key: 'cash', header: 'Cash', align: 'right', value: (r) => r.stats.cash, render: (r) => compact(r.stats.cash) },
            ]}
          />
        </div>
      )}
      <FormModal
        open={adding}
        onClose={() => setAdding(false)}
        title="New transfer"
        fields={[
          { name: 'fromBranchId', label: 'From', type: 'select', options: lookups.branchOptions, required: true },
          { name: 'toBranchId', label: 'To', type: 'select', options: lookups.branchOptions, required: true },
          { name: 'type', label: 'Type', type: 'select', options: ['Cash', 'Parcels', 'Stock'], required: true },
          { name: 'quantity', label: 'Quantity / amount', type: 'number', required: true, min: 1 },
          { name: 'note', label: 'Note', full: true },
        ]}
        onSubmit={(v) => {
          if (v.fromBranchId === v.toBranchId) { toast.error('From and To must be different branches'); return; }
          const id = `TR-${Math.floor(1000 + Math.random() * 9000)}`;
          addItem('transfers', { id, ...v, status: 'Created', date: new Date().toISOString() }, 'Transfer', `${id} created`);
          setAdding(false);
          toast.success(`${id} created`);
        }}
      />
      <FormModal
        open={!!editRate}
        onClose={() => setEditRate(null)}
        title={`Commission: ${editRate?.name}`}
        size="sm"
        fields={[{ name: 'commissionPct', label: 'Commission %', type: 'number', required: true, min: 0, max: 100, full: true }]}
        defaultValues={editRate}
        onSubmit={(v) => { updateItem('branches', editRate.id, v, 'Branch', `${editRate.name} commission ${v.commissionPct}%`); setEditRate(null); toast.success('Commission updated'); }}
      />
    </div>
  );
}

// Role-wise dashboards. All figures come from the shared selectors in data/helpers.js,
// so they match the lists they link to.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Banknote, CheckCircle2, Clock, CreditCard, HandCoins, Hourglass, PackageCheck, PackageOpen, PackagePlus, RotateCcw, ScanLine, TrendingUp, Truck, Wallet,
} from 'lucide-react';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { useActiveBranch, useBranchFilter, useLookups, useMoney, useScopedShipments } from '../../hooks/useApp.js';
import { Card, PageHeader, StatCard, StatusBadge } from '../../components/ui/index.jsx';
import { AreaTrend, BarsChart, CHART, DonutChart, LinesChart } from '../../components/charts/index.jsx';
import { dailySeries, merchantStats, riderStats, shipmentKpis, statusMix, topBy } from '../../data/helpers.js';
import { fmtCompact, fmtCurrency, fmtDate, fmtNumber, fmtPct, sum, toPKR } from '../../utils/format.js';
import { NDR_GROUP, STATUS } from '../../utils/status.js';

function RecentShipments({ list, limit = 6 }) {
  const { money } = useMoney();
  const rows = useMemo(() => [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit), [list, limit]);
  return (
    <Card title="Recent Shipments" bodyClass="" actions={<Link to="/shipments" className="link text-xs">View all</Link>}>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-xs text-ink-muted">
            <tr>{['AWB', 'Receiver', 'Route', 'COD', 'Status'].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2 text-start font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className="whitespace-nowrap px-4 py-2"><Link className="link" to={`/shipments/${s.id}`}>{s.awb}</Link></td>
                <td className="whitespace-nowrap px-4 py-2">{s.receiver.name}</td>
                <td className="whitespace-nowrap px-4 py-2 text-ink-muted">{s.originCity} - {s.destCity}</td>
                <td className="whitespace-nowrap px-4 py-2">{s.cod > 0 ? money(s.cod, s.currency) : '-'}</td>
                <td className="whitespace-nowrap px-4 py-2"><StatusBadge status={s.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AlertsPanel({ items }) {
  return (
    <section className="card overflow-hidden border-danger/30">
      <header className="flex items-center gap-2 bg-danger px-4 py-2.5 text-white">
        <AlertTriangle size={16} aria-hidden />
        <h2 className="text-sm font-semibold">Alerts</h2>
      </header>
      <ul className="divide-y divide-line">
        {items.map((a) => (
          <li key={a.label}>
            <Link to={a.to} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-danger-light/40">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-danger-dark">{a.value} {a.label}</span>
                {a.hint && <span className="block truncate text-xs text-ink-muted">{a.hint}</span>}
              </span>
              <ArrowRight size={15} className="shrink-0 text-ink-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AdminDashboard() {
  const { money, compact, value, currency } = useMoney();
  const navigate = useNavigate();
  const list = useScopedShipments();
  const { merchantName, branchName, riderName } = useLookups();
  const { riderDeposits } = useData();
  const deposits = useBranchFilter(riderDeposits);
  const k = useMemo(() => shipmentKpis(list), [list]);
  const daily = useMemo(() => dailySeries(list, 21).map((d) => ({ ...d, revenue: Math.round(value(d.revenue)), cost: Math.round(value(d.cost)) })), [list, value]);
  const mix = useMemo(() => statusMix(list), [list]);
  const topBranches = useMemo(() => topBy(list, (s) => s.originBranchId, branchName), [list, branchName]);
  const topMerchants = useMemo(() => topBy(list, (s) => s.merchantId, merchantName), [list, merchantName]);
  const riderPerf = useMemo(() => topBy(list.filter((s) => s.status === STATUS.DELIVERED), (s) => s.riderId, riderName), [list, riderName]);
  const unreconciled = deposits.filter((d) => d.status === 'Pending');
  const unreconciledAmt = sum(unreconciled, (d) => toPKR(d.deposited, d.currency));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
        <StatCard label="Total Shipments" value={fmtNumber(k.total)} icon={PackageCheck} onClick={() => navigate('/shipments')} />
        <StatCard label="Delivered %" value={fmtPct(k.deliveredPct)} hint={`${k.delivered} delivered`} icon={CheckCircle2} />
        <StatCard label="RTO %" value={fmtPct(k.rtoPct)} hint={`${k.rto} returned`} icon={RotateCcw} tone="danger" onClick={() => navigate('/shipments')} />
        <StatCard label="COD Collected" value={compact(k.codCollected)} icon={Banknote} onClick={() => navigate('/finance')} />
        <StatCard label="COD Pending" value={compact(k.codPending)} hint="Undelivered + with riders" icon={Hourglass} tone="danger" />
        <StatCard label="Revenue" value={compact(k.revenue)} hint="Excl. tax" icon={CreditCard} />
        <StatCard label="Profit" value={compact(k.profit)} hint={`Margin ${fmtPct(k.revenue ? (k.profit / k.revenue) * 100 : 0)}`} icon={TrendingUp} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Daily Shipments" className="xl:col-span-2"><AreaTrend data={daily} dataKey="shipments" name="Shipments" /></Card>
        <AlertsPanel
          items={[
            { label: 'delayed shipments', value: k.delayed, hint: 'Past ETA and still moving', to: '/shipments' },
            { label: 'failed deliveries', value: k.failed, hint: 'Need a re-attempt decision', to: '/shipments' },
            { label: 'unreconciled deposits', value: unreconciled.length, hint: `${money(unreconciledAmt)} awaiting accountant`, to: '/finance/reconciliation' },
            { label: 'COD with riders', value: money(k.codWithRiders), hint: 'Collected, not deposited', to: '/finance/reconciliation' },
          ]}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Revenue vs Cost" className="xl:col-span-2">
          <LinesChart data={daily} format={(v) => fmtCompact(v, currency)} series={[{ key: 'revenue', name: 'Revenue', color: CHART.yellow }, { key: 'cost', name: 'Cost', color: CHART.red }]} />
        </Card>
        <Card title="Status Mix">
          <DonutChart data={mix.map((m) => ({ ...m, color: { Delivered: CHART.yellow, 'In network': CHART.slate, 'Failed / RTO / Cancelled': CHART.red, 'Booked (pending)': CHART.brown }[m.name] }))} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Top Branches"><BarsChart data={topBranches} horizontal height={220} series={[{ key: 'value', name: 'Shipments' }]} /></Card>
        <Card title="Top Merchants"><BarsChart data={topMerchants} horizontal height={220} series={[{ key: 'value', name: 'Shipments' }]} /></Card>
        <Card title="Rider Performance"><BarsChart data={riderPerf} horizontal height={220} series={[{ key: 'value', name: 'Delivered' }]} /></Card>
      </div>

      <div className="mt-4"><RecentShipments list={list} /></div>
    </>
  );
}

function BranchDashboard() {
  const { money, compact } = useMoney();
  const branchId = useActiveBranch();
  const list = useScopedShipments();
  const { branchName, riderName } = useLookups();
  const { riders, codTransactions, riderDeposits } = useData();
  const k = useMemo(() => shipmentKpis(list), [list]);
  const daily = useMemo(() => dailySeries(list, 14), [list]);
  const branchRiders = branchId === 'ALL' ? riders : riders.filter((r) => r.branchId === branchId);
  const txns = branchId === 'ALL' ? codTransactions : codTransactions.filter((x) => x.branchId === branchId);
  const cash = sum(txns.filter((x) => ['Collected', 'Deposited'].includes(x.status)), (x) => toPKR(x.amount, x.currency));
  const atHub = list.filter((s) => s.status === STATUS.DEST && !s.riderId).length;
  const ndr = list.filter((s) => NDR_GROUP.includes(s.status)).length;
  const pending = (branchId === 'ALL' ? riderDeposits : riderDeposits.filter((d) => d.branchId === branchId)).filter((d) => d.status === 'Pending').length;
  const perf = useMemo(() => topBy(list.filter((s) => s.status === STATUS.DELIVERED), (s) => s.riderId, riderName), [list, riderName]);
  return (
    <>
      <p className="mb-3 text-sm font-medium text-ink-muted">{branchId === 'ALL' ? 'All Branches' : branchName(branchId)}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Shipments" value={fmtNumber(k.total)} icon={PackageCheck} />
        <StatCard label="Delivered %" value={fmtPct(k.deliveredPct)} icon={CheckCircle2} />
        <StatCard label="Cash in hand" value={compact(cash)} hint="Collected and deposited, not yet reconciled" icon={Wallet} />
        <StatCard label="Active riders" value={`${branchRiders.filter((r) => r.status !== 'On Leave').length} / ${branchRiders.length}`} icon={Truck} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Daily Shipments" className="xl:col-span-2"><AreaTrend data={daily} dataKey="shipments" name="Shipments" /></Card>
        <AlertsPanel items={[
          { label: 'parcels awaiting a rider', value: atHub, to: '/riders/dispatch' },
          { label: 'failed or re-attempt', value: ndr, to: '/shipments' },
          { label: 'delayed shipments', value: k.delayed, to: '/shipments' },
          { label: 'deposits pending', value: pending, hint: `${money(cash)} in hand`, to: '/branches' },
        ]}
        />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Rider Performance"><BarsChart data={perf} horizontal height={240} series={[{ key: 'value', name: 'Delivered' }]} /></Card>
        <div className="xl:col-span-2"><RecentShipments list={list} /></div>
      </div>
    </>
  );
}

function AccountantDashboard() {
  const { money, compact } = useMoney();
  const navigate = useNavigate();
  const { shipments, riderDeposits, payouts } = useData();
  const { merchantName } = useLookups();
  const k = useMemo(() => shipmentKpis(shipments), [shipments]);
  const pendingDeposits = riderDeposits.filter((d) => d.status === 'Pending');
  const diffs = pendingDeposits.filter((d) => d.deposited !== d.expected);
  const pendingPayouts = payouts.filter((p) => ['Pending', 'Approved'].includes(p.status));
  const flow = [
    { name: 'With riders', value: k.codWithRiders, color: CHART.red },
    { name: 'Deposited', value: k.codDeposited, color: CHART.slate },
    { name: 'Reconciled', value: k.codReconciled, color: CHART.brown },
    { name: 'Paid out', value: k.codPaid, color: CHART.yellow },
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="COD Collected" value={compact(k.codCollected)} icon={Banknote} onClick={() => navigate('/finance')} />
        <StatCard label="With riders" value={compact(k.codWithRiders)} hint="Collected, not deposited" icon={Wallet} tone={k.codWithRiders > 0 ? 'danger' : 'default'} onClick={() => navigate('/finance/reconciliation')} />
        <StatCard label="Payable to merchants" value={compact(k.codReconciled)} hint="Reconciled COD" icon={HandCoins} onClick={() => navigate('/finance/payouts')} />
        <StatCard label="Paid out" value={compact(k.codPaid)} icon={CheckCircle2} onClick={() => navigate('/finance/payouts')} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="COD pipeline" className="xl:col-span-2"><DonutChart data={flow} format={(v) => money(v)} /></Card>
        <AlertsPanel items={[
          { label: 'deposits to reconcile', value: pendingDeposits.length, hint: `${diffs.length} with a shortage or excess`, to: '/finance/reconciliation' },
          { label: 'payouts awaiting action', value: pendingPayouts.length, hint: money(sum(pendingPayouts, (p) => p.net)), to: '/finance/payouts' },
        ]}
        />
      </div>
      <div className="mt-4">
        <Card title="Payouts awaiting action" bodyClass="">
          <ul className="divide-y divide-line">
            {pendingPayouts.slice(0, 6).map((po) => (
              <li key={po.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="font-medium">{merchantName(po.merchantId)}</span>
                <span className="text-xs text-ink-muted">{po.status} - {fmtDate(po.createdAt)}</span>
                <span className="font-semibold">{money(po.net)}</span>
              </li>
            ))}
            {!pendingPayouts.length && <li className="px-4 py-8 text-center text-sm text-ink-muted">Nothing waiting</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}

function MerchantDashboard() {
  const navigate = useNavigate();
  const { money, compact } = useMoney();
  const user = useAuth((s) => s.user);
  const { shipments, codTransactions, payouts } = useData();
  const stats = useMemo(() => merchantStats(user.merchantId, shipments, codTransactions, payouts), [user, shipments, codTransactions, payouts]);
  const k = stats.kpis;
  const daily = useMemo(() => dailySeries(stats.list, 14), [stats.list]);
  const mix = useMemo(() => statusMix(stats.list), [stats.list]);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link to="/shipments/new" className="btn-primary"><PackagePlus size={16} aria-hidden /> Create Shipment</Link>
        <Link to="/portal/payouts" className="btn-outline"><HandCoins size={16} aria-hidden /> Request payout</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Shipments" value={fmtNumber(k.total)} icon={PackageCheck} onClick={() => navigate('/shipments')} />
        <StatCard label="Delivered %" value={fmtPct(k.deliveredPct)} hint={`RTO ${fmtPct(k.rtoPct)}`} icon={CheckCircle2} />
        <StatCard label="Payable COD" value={compact(stats.payable)} hint={`${compact(stats.inTransit)} in collection`} icon={Wallet} onClick={() => navigate('/portal/cod')} />
        <StatCard label="Paid out" value={compact(stats.paid)} hint="COD paid to you so far" icon={HandCoins} onClick={() => navigate('/portal/payouts')} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Daily Shipments" className="xl:col-span-2"><AreaTrend data={daily} dataKey="shipments" name="Shipments" /></Card>
        <Card title="Status Mix"><DonutChart data={mix} /></Card>
      </div>
      <div className="mt-4"><RecentShipments list={stats.list} /></div>
    </>
  );
}

// The rider record arrives from the database just after sign-in; wait for it instead of crashing.
function RiderDashboard() {
  const user = useAuth((s) => s.user);
  const rider = useData((s) => s.riders.find((r) => r.id === user.riderId));
  if (!rider) return <Card><p className="text-sm text-ink-muted">{user.riderId ? 'Loading your rider profile...' : 'This login is not linked to a rider record. Ask the Super Admin to check your account.'}</p></Card>;
  return <RiderDashboardFor rider={rider} />;
}

function RiderDashboardFor({ rider }) {
  const navigate = useNavigate();
  const { shipments, codTransactions } = useData();
  const stats = riderStats(rider, shipments, codTransactions);
  const mine = shipments.filter((s) => s.riderId === rider.id);
  const pickups = shipments.filter((s) => s.pickupRiderId === rider.id && s.status === STATUS.BOOKED);
  const daily = useMemo(() => dailySeries(mine, 14), [mine]);
  return (
    <>
      <Link to="/rider-app" className="btn-primary mb-4 w-full sm:w-auto"><Truck size={16} aria-hidden /> Start Today's Run</Link>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Deliveries" value={stats.active} hint="Assigned today" icon={Truck} onClick={() => navigate('/rider-app')} />
        <StatCard label="Pickups" value={pickups.length} icon={PackageOpen} onClick={() => navigate('/rider-app')} />
        <StatCard label="Cash in hand" value={fmtCurrency(stats.cash, rider.currency)} icon={Wallet} tone={stats.cash > 0 ? 'danger' : 'default'} onClick={() => navigate('/rider-app')} />
        <StatCard label="Success rate" value={fmtPct(stats.successPct)} hint={`${stats.delivered} delivered`} icon={CheckCircle2} />
      </div>
      <div className="mt-4"><Card title="Daily Shipments"><AreaTrend data={daily} dataKey="shipments" name="Parcels" height={220} /></Card></div>
    </>
  );
}

function WarehouseDashboard() {
  const navigate = useNavigate();
  const list = useScopedShipments();
  const count = (st) => list.filter((x) => x.status === st).length;
  const toPick = count(STATUS.BOOKED);
  const atOrigin = count(STATUS.ORIGIN);
  const atDest = count(STATUS.DEST);
  const transit = count(STATUS.TRANSIT);
  const stages = [
    { name: 'Picked up', value: count(STATUS.PICKED) },
    { name: 'At origin hub', value: count(STATUS.ORIGIN) },
    { name: 'In transit', value: transit },
    { name: 'At destination hub', value: atDest },
    { name: 'Out for delivery', value: count(STATUS.OFD) },
  ];
  return (
    <>
      <Link to="/shipments/scan" className="btn-primary mb-4 w-full sm:w-auto"><ScanLine size={16} aria-hidden /> Open Parcel Scan</Link>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Awaiting pickup" value={toPick} icon={Clock} onClick={() => navigate('/shipments')} />
        <StatCard label="At origin hub" value={atOrigin} hint="To sort and send out" icon={PackageCheck} onClick={() => navigate('/shipments/scan')} />
        <StatCard label="In transit" value={transit} icon={Truck} />
        <StatCard label="At destination hub" value={atDest} hint="To hand to riders" icon={PackageOpen} onClick={() => navigate('/shipments/scan')} />
      </div>
      <div className="mt-4"><Card title="Parcels by stage"><BarsChart data={stages} height={240} series={[{ key: 'value', name: 'Parcels' }]} /></Card></div>
      <div className="mt-4"><RecentShipments list={list} /></div>
    </>
  );
}

const VIEWS = {
  super_admin: AdminDashboard,
  branch_manager: BranchDashboard,
  accountant: AccountantDashboard,
  merchant: MerchantDashboard,
  rider: RiderDashboard,
  warehouse: WarehouseDashboard,
};

export function Dashboard() {
  const user = useAuth((s) => s.user);
  const View = VIEWS[user.role];
  return (
    <div>
      <PageHeader title={`Welcome back, ${user.name.split(' ')[0]}`} subtitle={fmtDate(new Date())} />
      <View />
    </div>
  );
}


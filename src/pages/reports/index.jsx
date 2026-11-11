// One report engine: pick a report and date range; each definition groups shipments into rows.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { subDays } from 'date-fns';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, DateRangePicker, PageHeader, StatCard, StatusBadge, Tabs, inRange } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { BarsChart, CHART, DonutChart, LinesChart } from '../../components/charts/index.jsx';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useLookups, useMoney, useScopedShipments } from '../../hooks/useApp.js';
import { agingBuckets, dailySeries, shipmentKpis } from '../../data/helpers.js';
import { fmtCompact, fmtNumber, fmtPct, groupBy, isoDay, toPKR, uid } from '../../utils/format.js';
import { RTO_GROUP, STATUS } from '../../utils/status.js';

const groupRows = (list, keyFn, nameFn) => Object.entries(groupBy(list.filter(keyFn), keyFn)).map(([key, items]) => {
  const k = shipmentKpis(items);
  return { id: key, name: nameFn(key), shipments: k.total, delivered: k.delivered, deliveredPct: k.deliveredPct, rtoPct: k.rtoPct, revenue: k.revenue, cost: k.cost, profit: k.profit, cod: k.codCollected };
}).sort((a, b) => b.shipments - a.shipments);

const REPORTS = [
  ['shipments', 'Shipments'], ['delivery', 'Delivery performance'], ['rto', 'RTO analysis'], ['codAging', 'COD aging'], ['profit', 'Revenue / profit per shipment'],
  ['branch', 'Branch-wise'], ['rider', 'Rider-wise'], ['merchant', 'Merchant-wise'], ['city', 'City-wise'], ['courier', 'Courier-wise'],
];

export function Reports() {
  const { money, compact, value, currency } = useMoney();
  const lookups = useLookups();
  const all = useScopedShipments();
  const { codTransactions, scheduledReports, addItem, updateItem, removeItem } = useData();
  const [report, setReport] = useState('shipments');
  const [range, setRange] = useState({ from: isoDay(subDays(new Date(), 60)), to: isoDay(new Date()) });
  const [tab, setTab] = useState('reports');
  const [scheduling, setScheduling] = useState(false);
  const list = useMemo(() => all.filter((s) => inRange(s.createdAt, range)), [all, range]);
  const k = useMemo(() => shipmentKpis(list), [list]);
  const days = useMemo(() => {
    if (!range.from) return 60;
    const end = range.to ? new Date(range.to) : new Date();
    return Math.min(Math.max(Math.round((end - new Date(range.from)) / 86400000) + 1, 1), 90);
  }, [range]);
  const daily = useMemo(() => dailySeries(list, days), [list, days]);
  const fmtC = (v) => fmtCompact(v, currency);

  const groupCols = [
    { key: 'name', header: 'Name' },
    { key: 'shipments', header: 'Shipments', align: 'right' },
    { key: 'delivered', header: 'Delivered', align: 'right' },
    { key: 'deliveredPct', header: 'Delivered %', align: 'right', render: (r) => fmtPct(r.deliveredPct), exportValue: (r) => fmtPct(r.deliveredPct) },
    { key: 'rtoPct', header: 'RTO %', align: 'right', render: (r) => <span className={r.rtoPct > 15 ? 'font-semibold text-danger' : ''}>{fmtPct(r.rtoPct)}</span>, exportValue: (r) => fmtPct(r.rtoPct) },
    { key: 'revenue', header: 'Revenue', align: 'right', render: (r) => money(r.revenue), exportValue: (r) => Math.round(value(r.revenue)) },
    { key: 'profit', header: 'Profit', align: 'right', render: (r) => money(r.profit), exportValue: (r) => Math.round(value(r.profit)) },
    { key: 'cod', header: 'COD collected', align: 'right', render: (r) => money(r.cod), exportValue: (r) => Math.round(value(r.cod)) },
  ];
  const groupedChart = (rows, metric = 'shipments', name = 'Shipments') => <BarsChart data={rows.slice(0, 10).map((r) => ({ name: r.name, value: r[metric] }))} horizontal height={Math.max(220, Math.min(rows.length, 10) * 34)} series={[{ key: 'value', name }]} />;

  const statusCols = [
    { key: 'name', header: 'Status' },
    { key: 'count', header: 'Shipments', align: 'right' },
    { key: 'share', header: 'Share', align: 'right', value: (r) => (list.length ? (r.count / list.length) * 100 : 0), render: (r) => fmtPct(list.length ? (r.count / list.length) * 100 : 0), exportValue: (r) => fmtPct(list.length ? (r.count / list.length) * 100 : 0) },
  ];

  const view = useMemo(() => {
    switch (report) {
      case 'shipments': {
        const rows = Object.entries(groupBy(list, (s) => s.status)).map(([name, items]) => ({ id: name, name, count: items.length })).sort((a, b) => b.count - a.count);
        return { chart: <BarsChart data={daily} xKey="label" series={[{ key: 'shipments', name: 'Shipments' }]} />, rows, cols: statusCols };
      }
      case 'delivery': {
        const done = list.filter((s) => s.status === STATUS.DELIVERED);
        const late = done.filter((s) => new Date(s.events[s.events.length - 1].at) > new Date(s.eta));
        const rows = groupRows(list, (s) => s.service, (x) => x);
        return { chart: <DonutChart data={[{ name: 'On time', value: done.length - late.length, color: CHART.yellow }, { name: 'Late', value: late.length, color: CHART.red }]} />, rows, cols: groupCols };
      }
      case 'rto': {
        const rto = list.filter((s) => RTO_GROUP.includes(s.status));
        const rows = Object.entries(groupBy(rto, (s) => s.ndr?.reason || 'Other')).map(([name, items]) => ({ id: name, name, count: items.length })).sort((a, b) => b.count - a.count);
        return { chart: <BarsChart data={rows.map((r) => ({ name: r.name, value: r.count }))} horizontal series={[{ key: 'value', name: 'Returns', color: CHART.red }]} />, rows, cols: [{ key: 'name', header: 'Reason' }, { key: 'count', header: 'Returns', align: 'right' }, { key: 'share', header: 'Share', align: 'right', value: (r) => (rto.length ? (r.count / rto.length) * 100 : 0), render: (r) => fmtPct(rto.length ? (r.count / rto.length) * 100 : 0) }] };
      }
      case 'codAging': {
        const ids = new Set(list.map((s) => s.id));
        const txns = codTransactions.filter((t) => ids.has(t.shipmentId) && t.status !== 'Paid');
        const buckets = agingBuckets(txns.map((t) => ({ amount: toPKR(t.amount, t.currency), date: t.collectedAt })));
        return { chart: <BarsChart data={buckets.map((b) => ({ name: b.name, value: Math.round(value(b.value)) }))} format={fmtC} series={[{ key: 'value', name: 'Unsettled COD', color: CHART.red }]} />, rows: buckets.map((b) => ({ ...b, id: b.name })), cols: [{ key: 'name', header: 'Age' }, { key: 'count', header: 'Parcels', align: 'right' }, { key: 'value', header: 'Amount', align: 'right', render: (r) => money(r.value), exportValue: (r) => Math.round(value(r.value)) }] };
      }
      case 'profit': {
        const rows = list.filter((s) => s.status !== STATUS.CANCELLED).map((s) => {
          const revenue = toPKR(s.charges.total - s.charges.tax, s.currency);
          const cost = toPKR(s.cost, s.currency);
          return { id: s.id, awb: s.awb, name: lookups.merchantName(s.merchantId), revenue, cost, profit: revenue - cost };
        });
        return {
          chart: <LinesChart data={daily.map((d) => ({ ...d, revenue: Math.round(value(d.revenue)), cost: Math.round(value(d.cost)) }))} format={fmtC} series={[{ key: 'revenue', name: 'Revenue', color: CHART.yellow }, { key: 'cost', name: 'Cost', color: CHART.red }]} />,
          rows,
          cols: [
            { key: 'awb', header: 'AWB', render: (r) => <Link className="link" to={`/shipments/${r.id}`}>{r.awb}</Link>, value: (r) => r.awb },
            { key: 'name', header: 'Merchant' },
            { key: 'revenue', header: 'Revenue', align: 'right', render: (r) => money(r.revenue), exportValue: (r) => Math.round(value(r.revenue)) },
            { key: 'cost', header: 'Cost', align: 'right', render: (r) => money(r.cost), exportValue: (r) => Math.round(value(r.cost)) },
            { key: 'profit', header: 'Profit', align: 'right', render: (r) => <span className={r.profit < 0 ? 'font-semibold text-danger' : ''}>{money(r.profit)}</span>, exportValue: (r) => Math.round(value(r.profit)) },
          ],
        };
      }
      default: {
        const defs = {
          branch: [(s) => s.originBranchId, lookups.branchName],
          rider: [(s) => s.riderId, lookups.riderName],
          merchant: [(s) => s.merchantId, lookups.merchantName],
          city: [(s) => s.destCity, (x) => x],
          courier: [(s) => s.courier, (x) => x],
        };
        const [key, name] = defs[report];
        const rows = groupRows(list, key, name);
        return { chart: groupedChart(rows), rows, cols: groupCols };
      }
    }
    // eslint-disable-next-line
  }, [report, list, daily, money, value, currency, lookups, codTransactions]);

  return (
    <div>
      <PageHeader title="Reports" subtitle={`${fmtNumber(list.length)} shipments in range`} actions={tab === 'scheduled' && <button type="button" className="btn-primary" onClick={() => setScheduling(true)}><Plus size={16} aria-hidden /> Schedule report</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'reports', label: 'Reports' }, { value: 'scheduled', label: 'Scheduled', count: scheduledReports.length }]} />
      {tab === 'reports' && (
        <>
          <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
            <select aria-label="Report" className="input !w-auto" value={report} onChange={(e) => setReport(e.target.value)}>{REPORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <DateRangePicker value={range} onChange={setRange} />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Shipments" value={fmtNumber(k.total)} />
            <StatCard label="Delivered" value={fmtPct(k.deliveredPct)} />
            <StatCard label="RTO" value={fmtPct(k.rtoPct)} tone="danger" />
            <StatCard label="Profit" value={compact(k.profit)} hint={`Revenue ${compact(k.revenue)}`} />
          </div>
          <Card title={REPORTS.find(([v]) => v === report)[1]} className="mb-4">{view.chart}</Card>
          <DataTable key={report} columns={view.cols} data={view.rows} exportName={`report-${report}`} exportModule="reports" title="Data" emptyTitle="No data in this date range" />
        </>
      )}
      {tab === 'scheduled' && (
        <DataTable
          data={scheduledReports}
          exportName="scheduled-reports"
          emptyTitle="No scheduled reports"
          columns={[
            { key: 'report', header: 'Report' },
            { key: 'frequency', header: 'Frequency' },
            { key: 'format', header: 'Format' },
            { key: 'recipients', header: 'Recipients' },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
            { key: 'act', header: '', sortable: false, export: false, render: (r) => (
              <span className="flex gap-1">
                <button type="button" className="btn-outline btn-sm" onClick={() => { const status = r.status === 'Scheduled' ? 'Paused' : 'Scheduled'; updateItem('scheduledReports', r.id, { status }, 'Report', `${r.report} ${status}`); toast.info(`${r.report} ${status.toLowerCase()}`); }}><CalendarClock size={13} aria-hidden /> {r.status === 'Scheduled' ? 'Pause' : 'Resume'}</button>
                <button type="button" className="btn-ghost btn-sm hover:!text-danger" aria-label={`Delete ${r.report}`} onClick={async () => { if (await confirm({ title: 'Delete schedule?', message: `${r.report} will stop being sent.`, confirmLabel: 'Delete' })) { removeItem('scheduledReports', r.id, 'Report'); toast.success('Schedule deleted'); } }}><Trash2 size={14} /></button>
              </span>
            ) },
          ]}
        />
      )}
      <FormModal
        open={scheduling}
        onClose={() => setScheduling(false)}
        title="Schedule a report"
        fields={[
          { name: 'report', label: 'Report', type: 'select', options: REPORTS.map(([, l]) => l), required: true, full: true },
          { name: 'frequency', label: 'Frequency', type: 'select', options: ['Daily', 'Weekly', 'Monthly'], required: true },
          { name: 'format', label: 'Format', type: 'select', options: ['Excel', 'PDF'], required: true },
          { name: 'recipients', label: 'Recipient email', required: true, email: true, full: true },
        ]}
        onSubmit={(v) => { addItem('scheduledReports', { id: uid('SR'), ...v, status: 'Scheduled' }, 'Report', `${v.report} scheduled`); setScheduling(false); toast.success('Report scheduled (email delivery is not set up yet)'); }}
      />
    </div>
  );
}

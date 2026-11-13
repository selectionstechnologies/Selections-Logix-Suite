import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { GripVertical, Pencil, Phone, Plus, Printer, Trash2, Truck } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, KV, Modal, PageHeader, StatCard, StatusBadge, Tabs } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { RecordNotFound } from '../../components/layout/Fallbacks.jsx';
import { PrintPreview, RunSheetDoc } from '../../components/print/index.jsx';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useActiveBranch, useBranchFilter, useLookups, useMoney } from '../../hooks/useApp.js';
import { riderStats } from '../../data/helpers.js';
import { CITY_MAP } from '../../data/geo.js';
import { STATUS } from '../../utils/status.js';
import { fmtDateTime, fmtPct, sum, uid } from '../../utils/format.js';
import { shipmentColumns } from '../shipments/columns.jsx';

const riderFields = (branchOptions) => [
  { name: 'name', label: 'Full name', required: true },
  { name: 'phone', label: 'Phone', required: true, phone: true },
  { name: 'branchId', label: 'Branch', type: 'select', options: branchOptions, required: true },
  { name: 'zone', label: 'Zone', required: true },
  { name: 'vehicle', label: 'Vehicle', type: 'select', options: ['Motorcycle', 'Van', 'Bicycle'], required: true },
  { name: 'plate', label: 'Plate number', required: true },
  { name: 'license', label: 'License' },
  { name: 'status', label: 'Status', type: 'select', options: ['Available', 'On Route', 'On Leave'], required: true, default: 'Available' },
];

export function RiderList() {
  const navigate = useNavigate();
  const { money } = useMoney();
  const lookups = useLookups();
  const { riders, shipments, codTransactions, branches, addItem } = useData();
  const scoped = useBranchFilter(riders);
  const [adding, setAdding] = useState(false);
  const statsMap = useMemo(() => Object.fromEntries(riders.map((r) => [r.id, riderStats(r, shipments, codTransactions)])), [riders, shipments, codTransactions]);
  const columns = [
    { key: 'name', header: 'Rider', render: (r) => <Link className="link" onClick={(e) => e.stopPropagation()} to={`/riders/${r.id}`}>{r.name}</Link>, value: (r) => r.name },
    { key: 'phone', header: 'Phone' },
    { key: 'branch', header: 'Branch', value: (r) => lookups.branchName(r.branchId) },
    { key: 'zone', header: 'Zone' },
    { key: 'vehicle', header: 'Vehicle', value: (r) => `${r.vehicle} (${r.plate})` },
    { key: 'active', header: 'Active', align: 'right', value: (r) => statsMap[r.id]?.active || 0 },
    { key: 'delivered', header: 'Delivered', align: 'right', value: (r) => statsMap[r.id]?.delivered || 0 },
    { key: 'success', header: 'Success', align: 'right', value: (r) => statsMap[r.id]?.successPct || 0, render: (r) => fmtPct(statsMap[r.id]?.successPct), exportValue: (r) => fmtPct(statsMap[r.id]?.successPct) },
    { key: 'cash', header: 'Cash in hand', align: 'right', value: (r) => statsMap[r.id]?.cash || 0, render: (r) => { const c = statsMap[r.id]?.cash || 0; return <span className={clsx(c > 0 && 'font-semibold text-danger')}>{money(c, r.currency)}</span>; } },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
  ];
  return (
    <div>
      <PageHeader title="Riders" subtitle={`${scoped.length} riders in view`} actions={<><Link to="/riders/dispatch" className="btn-outline"><Truck size={16} aria-hidden /> Dispatch board</Link><button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> Add rider</button></>} />
      <DataTable columns={columns} data={scoped} exportName="riders" onRowClick={(r) => navigate(`/riders/${r.id}`)} filters={[{ key: 'status', label: 'Status', options: ['Available', 'On Route', 'On Leave'] }, { key: 'vehicle', label: 'Vehicle', options: ['Motorcycle', 'Van', 'Bicycle'] }, { key: 'branchId', label: 'Branch', options: lookups.branchOptions }]} />
      <FormModal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add rider"
        fields={riderFields(lookups.branchOptions)}
        onSubmit={(v) => {
          const branch = branches.find((b) => b.id === v.branchId);
          addItem('riders', { ...v, id: uid('R'), city: branch.city, currency: CITY_MAP[branch.city].currency, rating: 5, joinedAt: new Date().toISOString() }, 'Rider', `${v.name} added`);
          setAdding(false);
          toast.success(`${v.name} added`);
        }}
      />
    </div>
  );
}

export function RiderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { money } = useMoney();
  const lookups = useLookups();
  const { riders, shipments, codTransactions, riderDeposits, updateItem, removeItem, logPrint } = useData();
  const [tab, setTab] = useState('parcels');
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const rider = riders.find((r) => r.id === id);
  const columns = useMemo(() => shipmentColumns({ money, lookups, compact: true }), [money, lookups]);
  if (!rider) return <RecordNotFound what="Rider" backTo="/riders" backLabel="Back to riders" />;
  const stats = riderStats(rider, shipments, codTransactions);
  const parcels = shipments.filter((s) => s.riderId === id);
  const run = parcels.filter((s) => [STATUS.OFD, STATUS.REATTEMPT].includes(s.status));
  const deposits = riderDeposits.filter((d) => d.riderId === id);
  const del = async () => {
    if (parcels.length) { toast.error(`Cannot delete: ${parcels.length} shipments are linked. Set the rider to On Leave instead.`); return; }
    if (await confirm({ title: 'Delete rider?', message: `${rider.name} will be removed.`, confirmLabel: 'Delete' })) {
      removeItem('riders', id, 'Rider');
      toast.success('Rider deleted');
      navigate('/riders');
    }
  };
  return (
    <div>
      <PageHeader
        title={rider.name}
        subtitle={`${rider.zone} - ${lookups.branchName(rider.branchId)}`}
        actions={(
          <>
            <StatusBadge status={rider.status} />
            <button type="button" className="btn-outline" onClick={() => setSheet(true)} disabled={!run.length}><Printer size={15} aria-hidden /> Run sheet</button>
            <button type="button" className="btn-outline" onClick={() => setEditing(true)}><Pencil size={15} aria-hidden /> Edit</button>
            <button type="button" className="btn-danger" onClick={del}><Trash2 size={15} aria-hidden /> Delete</button>
          </>
        )}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="On run now" value={stats.active} />
        <StatCard label="Delivered" value={stats.delivered} hint={`${fmtPct(stats.successPct)} success`} />
        <StatCard label="Cash in hand" value={money(stats.cash, rider.currency)} tone={stats.cash > 0 ? 'danger' : 'default'} />
        <StatCard label="Rating" value={`${rider.rating} / 5`} />
      </div>
      <Card title="Vehicle and contact" className="mb-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KV label="Phone">{rider.phone}</KV>
          <KV label="Vehicle">{rider.vehicle}</KV>
          <KV label="Plate">{rider.plate}</KV>
          <KV label="License">{rider.license}</KV>
        </dl>
      </Card>
      <Tabs tabs={[{ value: 'parcels', label: 'Parcels', count: parcels.length }, { value: 'deposits', label: 'Cash deposits', count: deposits.length }]} value={tab} onChange={setTab} />
      {tab === 'parcels' && <DataTable columns={columns} data={parcels} exportName={`rider-${id}-parcels`} onRowClick={(s) => navigate(`/shipments/${s.id}`)} filters={[{ key: 'status', label: 'Status', options: [STATUS.OFD, STATUS.DELIVERED, STATUS.FAILED, STATUS.REATTEMPT, STATUS.RTO, STATUS.RETURNED] }]} />}
      {tab === 'deposits' && (
        <DataTable
          data={deposits}
          exportName={`rider-${id}-deposits`}
          columns={[
            { key: 'id', header: 'Deposit' },
            { key: 'at', header: 'Date', render: (d) => fmtDateTime(d.at), exportValue: (d) => fmtDateTime(d.at) },
            { key: 'expected', header: 'Expected', align: 'right', render: (d) => money(d.expected, d.currency) },
            { key: 'deposited', header: 'Deposited', align: 'right', render: (d) => money(d.deposited, d.currency) },
            { key: 'diff', header: 'Difference', align: 'right', value: (d) => d.deposited - d.expected, render: (d) => <span className={clsx(d.deposited !== d.expected && 'font-semibold text-danger')}>{money(d.deposited - d.expected, d.currency)}</span> },
            { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.status} />, value: (d) => d.status },
          ]}
        />
      )}
      <FormModal open={editing} onClose={() => setEditing(false)} title={`Edit ${rider.name}`} fields={riderFields(lookups.branchOptions)} defaultValues={rider} onSubmit={(v) => { updateItem('riders', id, v, 'Rider', `${v.name} edited`); setEditing(false); toast.success('Rider updated'); }} />
      <PrintPreview open={sheet} onClose={() => setSheet(false)} title={`Run sheet: ${rider.name}`} filename={`runsheet-${id}`} onPrint={() => logPrint('Run Sheet', [rider.name], 'a4')}>
        <RunSheetDoc rider={rider} shipments={run} />
      </PrintPreview>
    </div>
  );
}

/** Parcels at destination hubs (and unassigned pickups) dragged onto rider cards, or bulk-assigned. */
export function DispatchBoard() {
  const { riders, shipments, assignRider, changeStatus, logPrint } = useData();
  const branch = useActiveBranch();
  const [localBranch, setLocalBranch] = useState(branch === 'ALL' ? 'LHE' : branch);
  const currentBranch = branch === 'ALL' ? localBranch : branch;
  const { branchOptions } = useLookups();
  const [selected, setSelected] = useState(new Set());
  const [dragOver, setDragOver] = useState(null);
  const [routeRider, setRouteRider] = useState(null);
  const [sheetRider, setSheetRider] = useState(null);

  const unassigned = useMemo(() => shipments.filter((s) => (
    (s.status === STATUS.DEST && s.destBranchId === currentBranch && !s.riderId)
    || (s.status === STATUS.BOOKED && s.originBranchId === currentBranch && !s.pickupRiderId)
    || (s.status === STATUS.REATTEMPT && s.destBranchId === currentBranch && !s.riderId)
  )), [shipments, currentBranch]);
  const pool = riders.filter((r) => r.branchId === currentBranch);
  const runOf = (riderId) => shipments.filter((s) => (s.riderId === riderId && [STATUS.DEST, STATUS.OFD, STATUS.REATTEMPT].includes(s.status)) || (s.pickupRiderId === riderId && s.status === STATUS.BOOKED));

  const assign = async (ids, rider) => {
    if (rider.status === 'On Leave') { toast.error(`${rider.name} is on leave`); return; }
    try {
      await assignRider(ids, rider.id);
      setSelected(new Set());
      toast.success(`${ids.length} parcel(s) assigned to ${rider.name}`);
    } catch (e) { toast.error(e.message); }
  };
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const dropIds = (e) => {
    const id = e.dataTransfer.getData('text/plain');
    return selected.has(id) ? [...selected] : [id];
  };
  const startRun = async (rider) => {
    const ready = shipments.filter((s) => s.riderId === rider.id && s.status === STATUS.DEST);
    if (!ready.length) { toast.info('No hub parcels waiting to go out for this rider'); return; }
    try {
      const { ok } = await changeStatus(ready.map((s) => s.id), STATUS.OFD, { note: `Out with ${rider.name}` });
      toast.success(`${ok} parcel(s) now Out for Delivery`);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader
        title="Dispatch Board"
        subtitle="Drag parcels onto a rider, or tick several and choose a rider's Assign button."
        actions={branch === 'ALL' && (
          <select aria-label="Branch" className="input !w-auto" value={localBranch} onChange={(e) => { setLocalBranch(e.target.value); setSelected(new Set()); }}>
            {branchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card title={`Unassigned (${unassigned.length})`} bodyClass="" actions={selected.size > 0 && <span className="chip">{selected.size} selected</span>}>
          <ul className="scroll-thin max-h-[640px] divide-y divide-line overflow-y-auto">
            {unassigned.map((s) => (
              <li
                key={s.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; }}
                className={clsx('flex cursor-grab items-center gap-2 px-3 py-2.5 text-sm active:cursor-grabbing', selected.has(s.id) && 'bg-primary-light/60')}
              >
                <GripVertical size={14} className="shrink-0 text-gray-400" aria-hidden />
                <input type="checkbox" className="accent-primary-hover" aria-label={`Select ${s.awb}`} checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5"><Link to={`/shipments/${s.id}`} className="link font-mono text-xs">{s.awb}</Link><span className="chip !py-0 !text-[10px]">{s.status === STATUS.BOOKED ? 'Pickup' : 'Delivery'}</span></span>
                  <span className="block truncate text-xs text-ink-muted">{s.status === STATUS.BOOKED ? s.sender.address : `${s.receiver.name}, ${s.receiver.address}`}</span>
                </span>
              </li>
            ))}
            {!unassigned.length && <li className="px-4 py-10 text-center text-sm text-ink-muted">Everything at this branch has a rider.</li>}
          </ul>
        </Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
          {pool.map((r) => {
            const run = runOf(r.id);
            const onLeave = r.status === 'On Leave';
            return (
              <div
                key={r.id}
                onDragOver={(e) => { e.preventDefault(); setDragOver(r.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => { e.preventDefault(); setDragOver(null); assign(dropIds(e), r); }}
                className={clsx('card p-3 transition', dragOver === r.id && !onLeave && 'border-primary-hover bg-primary-light', dragOver === r.id && onLeave && 'border-danger bg-danger-light', onLeave && 'opacity-60')}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/riders/${r.id}`} className="block truncate font-semibold hover:underline">{r.name}</Link>
                    <p className="truncate text-xs text-ink-muted">{r.zone} - {r.vehicle}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mb-2 text-xs text-ink-muted">{run.length} on route list - COD {sum(run, (s) => s.cod).toLocaleString('en-US')} {r.currency}</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="btn-primary btn-sm" disabled={!selected.size || onLeave} onClick={() => assign([...selected], r)}>Assign {selected.size > 0 ? selected.size : ''}</button>
                  <button type="button" className="btn-outline btn-sm" onClick={() => setRouteRider(r)}>Route ({run.length})</button>
                  <button type="button" className="btn-outline btn-sm" onClick={() => startRun(r)}>Start run</button>
                  <button type="button" className="btn-outline btn-sm" onClick={() => setSheetRider(r)} disabled={!run.length} aria-label={`Print run sheet for ${r.name}`}><Printer size={13} aria-hidden /></button>
                </div>
              </div>
            );
          })}
          {!pool.length && <p className="text-sm text-ink-muted">This branch has no riders.</p>}
        </div>
      </div>
      <Modal open={!!routeRider} onClose={() => setRouteRider(null)} title={`Route list: ${routeRider?.name}`} footer={<button type="button" className="btn-outline" onClick={() => setRouteRider(null)}>Close</button>}>
        {routeRider && (
          <ol className="space-y-2">
            {runOf(routeRider.id).map((s, i) => (
              <li key={s.id} className="flex gap-3 rounded-lg border border-line p-2.5 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{s.receiver.name} <span className="font-mono text-xs text-ink-muted">{s.awb}</span></span>
                  <span className="block truncate text-xs text-ink-muted">{s.receiver.address}, {s.receiver.city}</span>
                </span>
                <StatusBadge status={s.status} />
              </li>
            ))}
            {!runOf(routeRider.id).length && <p className="py-6 text-center text-sm text-ink-muted">Nothing on this route yet.</p>}
          </ol>
        )}
      </Modal>
      {sheetRider && (
        <PrintPreview open onClose={() => setSheetRider(null)} title={`Run sheet: ${sheetRider.name}`} filename={`runsheet-${sheetRider.id}`} onPrint={() => logPrint('Run Sheet', [sheetRider.name], 'a4')}>
          <RunSheetDoc rider={sheetRider} shipments={runOf(sheetRider.id)} />
        </PrintPreview>
      )}
    </div>
  );
}

const waLink = (phone, awb) => `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hello, we tried delivering your parcel ${awb}. Please confirm a good time for another attempt.`)}`;


// Hub operations: barcode scan simulation and manifest (bag) management.
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2, ClipboardList, PackagePlus, Plus, Printer, ScanLine, Send, Trash2, Truck, XCircle } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, Drawer, KV, PageHeader, StatusBadge, Tabs } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { ManifestDoc, PrintPreview } from '../../components/print/index.jsx';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useActiveBranch, useLookups } from '../../hooks/useApp.js';
import { NEXT_STATUS, STATUS } from '../../utils/status.js';
import { fmtDateTime, uid } from '../../utils/format.js';

// What a hub-in or hub-out scan means for a parcel in each state.
const HUB_IN = { [STATUS.PICKED]: STATUS.ORIGIN, [STATUS.TRANSIT]: STATUS.DEST };
const HUB_OUT = { [STATUS.ORIGIN]: STATUS.TRANSIT, [STATUS.DEST]: STATUS.OFD };

export function ParcelScan() {
  const { shipments, changeStatus } = useData();
  const [mode, setMode] = useState('in');
  const [code, setCode] = useState('');
  const [log, setLog] = useState([]);
  const input = useRef(null);

  const samples = useMemo(() => {
    const map = mode === 'in' ? HUB_IN : HUB_OUT;
    return shipments.filter((s) => map[s.status]).slice(0, 4).map((s) => s.awb);
  }, [shipments, mode]);

  const scan = (raw) => {
    const awb = raw.trim().toUpperCase();
    if (!awb) return;
    const s = shipments.find((x) => x.awb === awb);
    const at = new Date().toISOString();
    const entry = { id: uid('SC'), awb, at, mode };
    if (!s) {
      setLog((l) => [{ ...entry, ok: false, message: 'Not found in the system' }, ...l]);
      toast.error(`${awb} not found`);
    } else {
      const target = (mode === 'in' ? HUB_IN : HUB_OUT)[s.status];
      // Dispatching for delivery needs a rider, otherwise the parcel has no owner.
      if (target === STATUS.OFD && !s.riderId) {
        setLog((l) => [{ ...entry, ok: false, message: 'Assign a rider before scanning out' }, ...l]);
        toast.error(`${awb}: assign a rider first`);
      } else if (!target) {
        setLog((l) => [{ ...entry, ok: false, message: `Wrong scan: parcel is "${s.status}"` }, ...l]);
        toast.error(`${awb}: cannot scan ${mode} while ${s.status}`);
      } else {
        changeStatus(s.id, target, { note: `Scanned ${mode === 'in' ? 'in at' : 'out of'} hub` });
        setLog((l) => [{ ...entry, ok: true, message: `${s.status} -> ${target}`, id2: s.id }, ...l]);
        toast.success(`${awb}: ${target}`);
      }
    }
    setCode('');
    input.current?.focus();
  };

  const okCount = log.filter((l) => l.ok).length;
  return (
    <div>
      <PageHeader title="Parcel Scan" subtitle="Scan or type an AWB and press Enter. A USB barcode scanner works the same way." />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card title="Scanner">
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
            {[['in', 'Hub In'], ['out', 'Hub Out']].map(([m, label]) => (
              <button key={m} type="button" aria-pressed={mode === m} className={clsx('rounded-md py-2 text-sm font-semibold', mode === m ? 'bg-primary' : 'text-ink-muted')} onClick={() => { setMode(m); input.current?.focus(); }}>{label}</button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); scan(code); }}>
            <div className="relative">
              <ScanLine size={18} className="absolute start-3 top-3 text-ink-muted" aria-hidden />
              <input ref={input} autoFocus aria-label="AWB barcode" value={code} onChange={(e) => setCode(e.target.value)} placeholder="SLX100001" className="input !py-2.5 !ps-10 font-mono text-base" />
            </div>
            <button type="submit" className="btn-primary mt-2 w-full" disabled={!code.trim()}>Scan</button>
          </form>
          <p className="mb-1 mt-4 text-xs font-medium text-ink-muted">Try a parcel ready for {mode === 'in' ? 'Hub In' : 'Hub Out'}:</p>
          <div className="flex flex-wrap gap-1.5">
            {samples.map((a) => <button key={a} type="button" className="chip hover:bg-primary-light" onClick={() => scan(a)}>{a}</button>)}
            {!samples.length && <span className="text-xs text-ink-muted">None right now</span>}
          </div>
        </Card>
        <Card title={`Session log (${okCount} ok, ${log.length - okCount} errors)`} className="lg:col-span-2" bodyClass="" actions={log.length > 0 && <button type="button" className="btn-ghost btn-sm" onClick={() => setLog([])}>Clear</button>}>
          {!log.length && <p className="px-4 py-12 text-center text-sm text-ink-muted">Scans from this session appear here.</p>}
          <ul className="scroll-thin max-h-[420px] divide-y divide-line overflow-y-auto">
            {log.map((l) => (
              <li key={l.id} className={clsx('flex items-center gap-3 px-4 py-2.5 text-sm', !l.ok && 'bg-danger-light/50')}>
                {l.ok ? <CheckCircle2 size={17} className="shrink-0 text-primary-dark" aria-hidden /> : <XCircle size={17} className="shrink-0 text-danger" aria-hidden />}
                <span className="font-mono font-semibold">{l.awb}</span>
                <span className={clsx('min-w-0 flex-1 truncate', !l.ok && 'text-danger-dark')}>{l.message}</span>
                <span className="text-xs text-ink-muted">{new Date(l.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function ManifestDrawer({ manifest: m, onClose, onPrint }) {
  const { shipments, updateItem, changeStatus } = useData();
  const { branchName } = useLookups();
  const [awb, setAwb] = useState('');
  const parcels = m.awbs.map((a) => shipments.find((s) => s.awb === a)).filter(Boolean);
  const editable = m.status === 'Created';
  // Eligible = sitting at the origin hub of this lane and not already in a bag.
  const eligible = shipments.filter((s) => s.status === STATUS.ORIGIN && s.originBranchId === m.fromBranchId && !s.manifestId);

  const add = (raw) => {
    const code = raw.trim().toUpperCase();
    const s = shipments.find((x) => x.awb === code);
    if (!s) { toast.error(`${code} not found`); return; }
    if (s.manifestId) { toast.error(`${code} is already on ${s.manifestId}`); return; }
    if (s.status !== STATUS.ORIGIN) { toast.error(`${code} must be At Origin Hub (it is ${s.status})`); return; }
    if (s.originBranchId !== m.fromBranchId) { toast.error(`${code} is not at ${branchName(m.fromBranchId)}`); return; }
    updateItem('manifests', m.id, (x) => ({ awbs: [...x.awbs, code] }), 'Manifest', `${code} added to ${m.id}`);
    updateItem('shipments', s.id, { manifestId: m.id }, 'Shipment', `${code} bagged on ${m.id}`);
    setAwb('');
    toast.success(`${code} added`);
  };
  const removeParcel = (s) => {
    updateItem('manifests', m.id, (x) => ({ awbs: x.awbs.filter((a) => a !== s.awb) }), 'Manifest', `${s.awb} removed from ${m.id}`);
    updateItem('shipments', s.id, { manifestId: null }, 'Shipment', `${s.awb} unbagged`);
  };
  const dispatch = () => {
    if (!parcels.length) { toast.error('Add at least one parcel before dispatching'); return; }
    const { ok } = changeStatus(parcels.map((s) => s.id), STATUS.TRANSIT, { note: `Dispatched on manifest ${m.id}` });
    updateItem('manifests', m.id, { status: 'Dispatched' }, 'Manifest', `${m.id} dispatched`);
    toast.success(`${m.id} dispatched with ${ok} parcel(s) now In Transit`);
    onClose();
  };
  const receive = () => {
    const { ok } = changeStatus(parcels.map((s) => s.id), STATUS.DEST, { note: `Received on manifest ${m.id}` });
    updateItem('manifests', m.id, { status: 'Received' }, 'Manifest', `${m.id} received`);
    toast.success(`${m.id} received, ${ok} parcel(s) at destination hub`);
    onClose();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Manifest ${m.id}`}
      width="max-w-lg"
      footer={(
        <>
          <button type="button" className="btn-outline" onClick={onPrint}><Printer size={15} aria-hidden /> Print</button>
          {m.status === 'Created' && <button type="button" className="btn-primary" onClick={dispatch}><Send size={15} aria-hidden /> Dispatch</button>}
          {m.status === 'Dispatched' && <button type="button" className="btn-primary" onClick={receive}><Truck size={15} aria-hidden /> Receive</button>}
        </>
      )}
    >
      <dl className="mb-4 grid grid-cols-2 gap-3">
        <KV label="Status"><StatusBadge status={m.status} /></KV>
        <KV label="Bag">{m.bag}</KV>
        <KV label="From">{branchName(m.fromBranchId)}</KV>
        <KV label="To">{branchName(m.toBranchId)}</KV>
        <KV label="Vehicle">{m.vehicle}</KV>
        <KV label="Created">{fmtDateTime(m.createdAt)}</KV>
      </dl>
      {editable && (
        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(awb); }}>
          <input aria-label="AWB to add" className="input font-mono" placeholder="Scan AWB to add" value={awb} onChange={(e) => setAwb(e.target.value)} />
          <button type="submit" className="btn-primary" disabled={!awb.trim()}><Plus size={15} aria-hidden /> Add</button>
        </form>
      )}
      {editable && eligible.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <span className="text-xs text-ink-muted">Ready at this hub:</span>
          {eligible.slice(0, 6).map((s) => <button key={s.id} type="button" className="chip hover:bg-primary-light" onClick={() => add(s.awb)}>{s.awb}</button>)}
        </div>
      )}
      <p className="label">Parcels ({parcels.length})</p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {parcels.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <Link to={`/shipments/${s.id}`} className="link font-mono">{s.awb}</Link>
            <span className="min-w-0 flex-1 truncate text-ink-muted">{s.receiver.name} - {s.destCity}</span>
            {editable && <button type="button" className="text-ink-muted hover:text-danger" onClick={() => removeParcel(s)} aria-label={`Remove ${s.awb}`}><Trash2 size={14} /></button>}
          </li>
        ))}
        {!parcels.length && <li className="px-3 py-6 text-center text-sm text-ink-muted">No parcels yet</li>}
      </ul>
    </Drawer>
  );
}

export function Manifests() {
  const { manifests, addItem, removeItem, shipments, updateItem, logPrint } = useData();
  const { branchName, branchOptions } = useLookups();
  const active = useActiveBranch();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [tab, setTab] = useState('all');
  const scoped = active === 'ALL' ? manifests : manifests.filter((m) => m.fromBranchId === active || m.toBranchId === active);
  const data = tab === 'all' ? scoped : scoped.filter((m) => m.status === tab);
  const open = manifests.find((m) => m.id === openId);

  const del = async (m) => {
    if (m.status !== 'Created') { toast.error('Only a manifest that has not left can be deleted'); return; }
    if (await confirm({ title: 'Delete manifest?', message: `${m.id} will be deleted and its ${m.awbs.length} parcel(s) unbagged.`, confirmLabel: 'Delete' })) {
      shipments.filter((s) => s.manifestId === m.id).forEach((s) => updateItem('shipments', s.id, { manifestId: null }, 'Shipment'));
      removeItem('manifests', m.id, 'Manifest');
      toast.success(`${m.id} deleted`);
    }
  };

  const columns = [
    { key: 'id', header: 'Manifest', render: (m) => <button type="button" className="link" onClick={(e) => { e.stopPropagation(); setOpenId(m.id); }}>{m.id}</button>, value: (m) => m.id },
    { key: 'bag', header: 'Bag' },
    { key: 'from', header: 'From', value: (m) => branchName(m.fromBranchId) },
    { key: 'to', header: 'To', value: (m) => branchName(m.toBranchId) },
    { key: 'parcels', header: 'Parcels', align: 'right', value: (m) => m.awbs.length },
    { key: 'vehicle', header: 'Vehicle' },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} />, value: (m) => m.status },
    { key: 'createdAt', header: 'Created', render: (m) => fmtDateTime(m.createdAt), exportValue: (m) => fmtDateTime(m.createdAt) },
    { key: 'actions', header: '', sortable: false, export: false, render: (m) => (
      <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setPrinting(m)} aria-label={`Print ${m.id}`}><Printer size={14} /></button>
        <button type="button" className="btn-ghost btn-sm hover:!text-danger" onClick={() => del(m)} aria-label={`Delete ${m.id}`}><Trash2 size={14} /></button>
      </span>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Manifests" subtitle="Bag parcels at the origin hub, dispatch the bag, then receive it at the destination." actions={<button type="button" className="btn-primary" onClick={() => setCreating(true)}><PackagePlus size={16} aria-hidden /> New manifest</button>} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'All', count: scoped.length },
          ...['Created', 'Dispatched', 'Received'].map((s) => ({ value: s, label: s, count: scoped.filter((m) => m.status === s).length })),
        ]}
      />
      <DataTable columns={columns} data={data} exportName="manifests" onRowClick={(m) => setOpenId(m.id)} emptyAction={<button type="button" className="btn-primary" onClick={() => setCreating(true)}><ClipboardList size={15} aria-hidden /> Create a manifest</button>} />
      <FormModal
        open={creating}
        onClose={() => setCreating(false)}
        title="New manifest"
        submitLabel="Create"
        fields={[
          { name: 'fromBranchId', label: 'From branch', type: 'select', options: branchOptions, required: true },
          { name: 'toBranchId', label: 'To branch', type: 'select', options: branchOptions, required: true },
          { name: 'bag', label: 'Bag number', required: true },
          { name: 'vehicle', label: 'Vehicle / flight', required: true },
        ]}
        defaultValues={{ bag: `BAG-${Math.floor(1000 + Math.random() * 9000)}`, fromBranchId: active === 'ALL' ? '' : active }}
        onSubmit={(v) => {
          if (v.fromBranchId === v.toBranchId) { toast.error('From and To branches must be different'); return; }
          const id = `MF-${Math.floor(3000 + Math.random() * 6000)}`;
          addItem('manifests', { id, ...v, awbs: [], status: 'Created', createdAt: new Date().toISOString(), by: 'Hub Operations' }, 'Manifest', `${id} created`);
          setCreating(false);
          setOpenId(id);
          toast.success(`${id} created. Add parcels next.`);
        }}
      />
      {open && <ManifestDrawer manifest={open} onClose={() => setOpenId(null)} onPrint={() => setPrinting(open)} />}
      {printing && (
        <PrintPreview open onClose={() => setPrinting(null)} title={`Manifest ${printing.id}`} filename={`manifest-${printing.id}`} onPrint={() => logPrint('Manifest', [printing.id], 'a4')}>
          <ManifestDoc manifest={printing} shipments={shipments} branchName={branchName} />
        </PrintPreview>
      )}
    </div>
  );
}

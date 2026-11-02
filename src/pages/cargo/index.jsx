import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plane, Plus, Ship, Trash2, Truck } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Drawer, KV, PageHeader, StatCard, StatusBadge, Tabs } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useMoney } from '../../hooks/useApp.js';
import { fmtDate, fmtNumber, sum, uid } from '../../utils/format.js';
import { STATUS } from '../../utils/status.js';

const CARGO_STATUS = ['Quoted', 'Confirmed', 'Loaded', 'Departed', 'Arrived', 'Completed'];
const MODE_ICON = { Air: Plane, Sea: Ship, Road: Truck };
const CARGO_FIELDS = [
  { name: 'mode', label: 'Mode', type: 'select', options: ['Air', 'Sea', 'Road'], required: true },
  { name: 'status', label: 'Status', type: 'select', options: CARGO_STATUS, required: true, default: 'Quoted' },
  { name: 'origin', label: 'Origin', required: true },
  { name: 'destination', label: 'Destination', required: true },
  { name: 'consignee', label: 'Consignee', required: true },
  { name: 'commodity', label: 'Commodity', required: true },
  { name: 'weight', label: 'Weight (kg)', type: 'number', required: true, min: 1 },
  { name: 'cbm', label: 'Volume (CBM)', type: 'number', required: true, min: 0 },
  { name: 'reference', label: 'Container / flight / truck no.', required: true },
  { name: 'freightCost', label: 'Freight cost (PKR)', type: 'number', required: true, min: 0 },
];

export function CargoBookings() {
  const { money, compact } = useMoney();
  const { cargoBookings, addItem, updateItem, removeItem } = useData();
  const [edit, setEdit] = useState(null);
  const del = async (c) => {
    if (await confirm({ title: 'Delete booking?', message: `${c.id} will be removed.`, confirmLabel: 'Delete' })) { removeItem('cargoBookings', c.id, 'Cargo'); toast.success('Booking deleted'); }
  };
  const count = (m) => cargoBookings.filter((c) => c.mode === m).length;
  return (
    <div>
      <PageHeader title="Cargo Bookings" subtitle="Air, sea and road freight." actions={<button type="button" className="btn-primary" onClick={() => setEdit({})}><Plus size={16} aria-hidden /> New booking</button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Air" value={count('Air')} icon={Plane} />
        <StatCard label="Sea" value={count('Sea')} icon={Ship} />
        <StatCard label="Road" value={count('Road')} icon={Truck} />
        <StatCard label="Total freight" value={compact(sum(cargoBookings, (c) => c.freightCost))} />
      </div>
      <DataTable
        data={cargoBookings}
        exportName="cargo-bookings"
        dateKey="date"
        filters={[{ key: 'mode', label: 'Mode', options: ['Air', 'Sea', 'Road'] }, { key: 'status', label: 'Status', options: CARGO_STATUS }]}
        columns={[
          { key: 'id', header: 'Booking' },
          { key: 'mode', header: 'Mode', render: (c) => { const I = MODE_ICON[c.mode]; return <span className="inline-flex items-center gap-1.5"><I size={14} aria-hidden /> {c.mode}</span>; } },
          { key: 'route', header: 'Route', value: (c) => `${c.origin} - ${c.destination}` },
          { key: 'consignee', header: 'Consignee' },
          { key: 'commodity', header: 'Commodity' },
          { key: 'weight', header: 'Weight', align: 'right', render: (c) => `${fmtNumber(c.weight)} kg` },
          { key: 'cbm', header: 'CBM', align: 'right' },
          { key: 'reference', header: 'Container / flight' },
          { key: 'freightCost', header: 'Freight', align: 'right', render: (c) => money(c.freightCost) },
          { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} />, value: (c) => c.status },
          { key: 'act', header: '', sortable: false, export: false, render: (c) => (
            <span className="flex gap-1">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(c)} aria-label={`Edit ${c.id}`}><Pencil size={14} /></button>
              <button type="button" className="btn-ghost btn-sm hover:!text-danger" onClick={() => del(c)} aria-label={`Delete ${c.id}`}><Trash2 size={14} /></button>
            </span>
          ) },
        ]}
      />
      <FormModal
        open={!!edit}
        size="lg"
        onClose={() => setEdit(null)}
        title={edit?.id ? `Edit ${edit.id}` : 'New cargo booking'}
        fields={CARGO_FIELDS}
        defaultValues={edit}
        onSubmit={(v) => {
          if (edit.id) updateItem('cargoBookings', edit.id, v, 'Cargo', `${edit.id} edited`);
          else { const id = `CG-${Math.floor(5000 + Math.random() * 4000)}`; addItem('cargoBookings', { id, ...v, date: new Date().toISOString() }, 'Cargo', `${id} booked`); }
          setEdit(null);
          toast.success('Cargo booking saved');
        }}
      />
    </div>
  );
}

export function Consolidation() {
  const { money } = useMoney();
  const { consolidations, shipments, addItem, updateItem } = useData();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const current = consolidations.find((c) => c.id === open);
  const taken = new Set(consolidations.flatMap((c) => c.awbs));
  const eligible = shipments.filter((s) => s.service === 'international' && [STATUS.ORIGIN, STATUS.TRANSIT, STATUS.PICKED, STATUS.BOOKED].includes(s.status) && !taken.has(s.awb));
  const parcels = current ? current.awbs.map((a) => shipments.find((s) => s.awb === a)).filter(Boolean) : [];
  // Cost is allocated by chargeable weight, so a heavy parcel carries its share.
  const totalWeight = sum(parcels, (s) => s.chargeableWeight);
  const share = (s) => (totalWeight ? (current.cost * s.chargeableWeight) / totalWeight : 0);
  return (
    <div>
      <PageHeader title="Consolidation" subtitle="Group cross-border parcels under one master AWB or bill of lading." actions={<button type="button" className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden /> New master shipment</button>} />
      <DataTable
        data={consolidations}
        exportName="consolidations"
        onRowClick={(c) => setOpen(c.id)}
        columns={[
          { key: 'id', header: 'ID' },
          { key: 'masterNo', header: 'Master AWB / BL' },
          { key: 'mode', header: 'Mode' },
          { key: 'route', header: 'Route', value: (c) => `${c.origin} - ${c.destination}` },
          { key: 'parcels', header: 'Parcels', align: 'right', value: (c) => c.awbs.length },
          { key: 'cost', header: 'Cost', align: 'right', render: (c) => money(c.cost) },
          { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} />, value: (c) => c.status },
        ]}
      />
      {current && (
        <Drawer open onClose={() => setOpen(null)} title={current.masterNo} width="max-w-lg">
          <dl className="mb-4 grid grid-cols-2 gap-3">
            <KV label="Route">{current.origin} - {current.destination}</KV>
            <KV label="Mode">{current.mode}</KV>
            <KV label="Master cost">{money(current.cost)}</KV>
            <KV label="Status"><StatusBadge status={current.status} /></KV>
          </dl>
          {eligible.length > 0 && current.status !== 'Completed' && (
            <div className="mb-3">
              <p className="label">Add a parcel</p>
              <div className="flex flex-wrap gap-1.5">
                {eligible.slice(0, 8).map((s) => <button key={s.id} type="button" className="chip hover:bg-primary-light" onClick={() => { updateItem('consolidations', current.id, (c) => ({ awbs: [...c.awbs, s.awb] }), 'Cargo', `${s.awb} added to ${current.masterNo}`); toast.success(`${s.awb} added`); }}><Plus size={11} aria-hidden /> {s.awb}</button>)}
              </div>
            </div>
          )}
          <p className="label">Cost allocation by chargeable weight</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {parcels.map((s) => <li key={s.id} className="flex justify-between gap-2 px-3 py-2 text-sm"><Link className="link font-mono" to={`/shipments/${s.id}`}>{s.awb}</Link><span className="text-ink-muted">{s.chargeableWeight} kg</span><b>{money(share(s))}</b></li>)}
            {!parcels.length && <li className="px-3 py-6 text-center text-sm text-ink-muted">No parcels yet</li>}
          </ul>
        </Drawer>
      )}
      <FormModal
        open={creating}
        onClose={() => setCreating(false)}
        title="New master shipment"
        fields={[
          { name: 'masterNo', label: 'Master AWB / BL number', required: true, full: true },
          { name: 'mode', label: 'Mode', type: 'select', options: ['Air', 'Sea', 'Road'], required: true },
          { name: 'cost', label: 'Total cost (PKR)', type: 'number', required: true, min: 0 },
          { name: 'origin', label: 'Origin', required: true },
          { name: 'destination', label: 'Destination', required: true },
        ]}
        onSubmit={(v) => {
          const id = uid('MS');
          addItem('consolidations', { id, ...v, awbs: [], status: 'Confirmed', createdAt: new Date().toISOString() }, 'Cargo', `${v.masterNo} created`);
          setCreating(false);
          setOpen(id);
          toast.success('Master shipment created. Add parcels next.');
        }}
      />
    </div>
  );
}

export function Carriers() {
  const { money } = useMoney();
  const { carriers, partnerRates, addItem, updateItem, removeItem } = useData();
  const [tab, setTab] = useState('carriers');
  const [edit, setEdit] = useState(null);
  const [rate, setRate] = useState(null);
  const name = (id) => carriers.find((c) => c.id === id)?.name || '-';
  const del = async (c) => {
    if (await confirm({ title: 'Remove carrier?', message: `${c.name} and its rates will be removed.`, confirmLabel: 'Remove' })) {
      removeItem('carriers', c.id, 'Carrier');
      partnerRates.filter((r) => r.carrierId === c.id).forEach((r) => removeItem('partnerRates', r.id, 'Carrier'));
      toast.success('Carrier removed');
    }
  };
  return (
    <div>
      <PageHeader title="Carriers" subtitle="Partners and what they charge." actions={<button type="button" className="btn-primary" onClick={() => (tab === 'carriers' ? setEdit({}) : setRate({}))}><Plus size={16} aria-hidden /> {tab === 'carriers' ? 'Add carrier' : 'Add rate'}</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'carriers', label: 'Carriers', count: carriers.length }, { value: 'rates', label: 'Partner rates', count: partnerRates.length }]} />
      {tab === 'carriers' && (
        <DataTable
          data={carriers}
          exportName="carriers"
          columns={[
            { key: 'name', header: 'Carrier' },
            { key: 'type', header: 'Type' },
            { key: 'lanes', header: 'Lanes' },
            { key: 'contact', header: 'Contact' },
            { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} />, value: (c) => c.status },
            { key: 'act', header: '', sortable: false, export: false, render: (c) => <span className="flex gap-1"><button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(c)} aria-label={`Edit ${c.name}`}><Pencil size={14} /></button><button type="button" className="btn-ghost btn-sm hover:!text-danger" onClick={() => del(c)} aria-label={`Remove ${c.name}`}><Trash2 size={14} /></button></span> },
          ]}
        />
      )}
      {tab === 'rates' && (
        <DataTable
          data={partnerRates}
          exportName="partner-rates"
          columns={[
            { key: 'carrier', header: 'Carrier', value: (r) => name(r.carrierId) },
            { key: 'lane', header: 'Lane' },
            { key: 'perKg', header: 'Rate per unit', align: 'right', render: (r) => money(r.perKg) },
            { key: 'minCharge', header: 'Minimum', align: 'right', render: (r) => money(r.minCharge) },
            { key: 'act', header: '', sortable: false, export: false, render: (r) => <button type="button" className="btn-ghost btn-sm" onClick={() => setRate(r)} aria-label={`Edit rate ${r.lane}`}><Pencil size={14} /></button> },
          ]}
        />
      )}
      <FormModal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? `Edit ${edit.name}` : 'Add carrier'}
        fields={[
          { name: 'name', label: 'Name', required: true },
          { name: 'type', label: 'Type', type: 'select', options: ['Courier', 'Air', 'Sea', 'Road'], required: true },
          { name: 'contact', label: 'Contact email', required: true, email: true },
          { name: 'lanes', label: 'Lanes', required: true },
          { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], required: true, default: 'Active' },
        ]}
        defaultValues={edit}
        onSubmit={(v) => {
          if (edit.id) updateItem('carriers', edit.id, v, 'Carrier', `${v.name} edited`);
          else addItem('carriers', { id: uid('CR'), ...v }, 'Carrier', `${v.name} added`);
          setEdit(null);
          toast.success('Carrier saved');
        }}
      />
      <FormModal
        open={!!rate}
        onClose={() => setRate(null)}
        title={rate?.id ? 'Edit rate' : 'Add rate'}
        fields={[
          { name: 'carrierId', label: 'Carrier', type: 'select', options: carriers.map((c) => ({ value: c.id, label: c.name })), required: true },
          { name: 'lane', label: 'Lane', required: true },
          { name: 'perKg', label: 'Rate per unit (PKR)', type: 'number', required: true, min: 0 },
          { name: 'minCharge', label: 'Minimum charge (PKR)', type: 'number', required: true, min: 0 },
        ]}
        defaultValues={rate}
        onSubmit={(v) => {
          if (rate.id) updateItem('partnerRates', rate.id, v, 'Carrier', `${v.lane} rate edited`);
          else addItem('partnerRates', { id: uid('PR'), ...v }, 'Carrier', `${v.lane} rate added`);
          setRate(null);
          toast.success('Rate saved');
        }}
      />
    </div>
  );
}


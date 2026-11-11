import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, Package, PackageCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, Modal, PageHeader, StatCard, StatusBadge, Tabs } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useBranchFilter, useLookups, useMoney } from '../../hooks/useApp.js';
import { stockStatus } from '../../data/config.js';
import { fmtDate, fmtNumber, sum, uid } from '../../utils/format.js';

const SKU_FIELDS = (lookups) => [
  { name: 'sku', label: 'SKU code', required: true },
  { name: 'name', label: 'Name', required: true },
  { name: 'merchantId', label: 'Merchant', type: 'select', options: lookups.merchantOptions, required: true },
  { name: 'branchId', label: 'Warehouse', type: 'select', options: lookups.branchOptions, required: true },
  { name: 'bin', label: 'Bin / rack', required: true, placeholder: 'A1-R2' },
  { name: 'reorder', label: 'Reorder level', type: 'number', required: true, min: 0 },
  { name: 'unitCost', label: 'Unit cost (PKR)', type: 'number', min: 0 },
  { name: 'weight', label: 'Weight (kg)', type: 'number', min: 0 },
];

function MoveModal({ item, type, onClose }) {
  const moveStock = useData((s) => s.moveStock);
  const out = type === 'Stock Out';
  return (
    <FormModal
      open
      onClose={onClose}
      title={`${type}: ${item.name}`}
      size="sm"
      fields={[
        { name: 'qty', label: `Quantity (on hand: ${item.stock})`, type: 'number', required: true, min: 1, ...(out ? { max: item.stock } : {}), full: true },
        { name: 'note', label: 'Note', full: true },
      ]}
      onSubmit={({ qty, note }) => {
        if (moveStock(item.id, out ? -qty : qty, type, note)) toast.success(`${type} of ${qty} recorded`);
        else toast.error('Stock cannot go below zero');
        onClose();
      }}
    />
  );
}

export function Inventory() {
  const { money } = useMoney();
  const lookups = useLookups();
  const { inventory, addItem, updateItem, removeItem } = useData();
  const scoped = useBranchFilter(inventory);
  const [edit, setEdit] = useState(null); // {} = new
  const [move, setMove] = useState(null);
  const low = scoped.filter((i) => stockStatus(i) !== 'In Stock');

  const del = async (i) => {
    if (i.stock > 0) { toast.error(`${i.sku} still has ${i.stock} units. Move them out first.`); return; }
    if (await confirm({ title: 'Delete SKU?', message: `${i.sku} will be removed.`, confirmLabel: 'Delete' })) { removeItem('inventory', i.id, 'Warehouse'); toast.success('SKU deleted'); }
  };
  return (
    <div>
      <PageHeader title="Inventory" subtitle="Stock held per merchant, with bin locations." actions={<button type="button" className="btn-primary" onClick={() => setEdit({})}><Plus size={16} aria-hidden /> Add SKU</button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="SKUs" value={scoped.length} icon={Boxes} />
        <StatCard label="Units" value={fmtNumber(sum(scoped, (i) => i.stock))} icon={Package} />
        <StatCard label="Stock value" value={money(sum(scoped, (i) => i.stock * i.unitCost))} icon={PackageCheck} />
        <StatCard label="Low-stock alerts" value={low.length} tone={low.length ? 'danger' : 'default'} icon={ClipboardCheck} />
      </div>
      {low.length > 0 && <p role="alert" className="mb-4 rounded-lg bg-danger-light px-3 py-2 text-sm font-medium text-danger-dark">{low.length} SKU(s) at or below reorder level: {low.slice(0, 4).map((i) => i.sku).join(', ')}{low.length > 4 ? '...' : ''}</p>}
      <DataTable
        data={scoped}
        exportName="inventory"
        rowClass={(i) => (stockStatus(i) !== 'In Stock' ? 'bg-danger-light/40' : '')}
        filters={[
          { key: 'merchantId', label: 'Merchant', options: lookups.merchantOptions.slice(0, 10) },
          { key: 'branchId', label: 'Warehouse', options: lookups.branchOptions },
          { key: 'state', label: 'Stock', options: ['In Stock', 'Low Stock', 'Out of Stock'], match: (i, v) => stockStatus(i) === v },
        ]}
        columns={[
          { key: 'sku', header: 'SKU' },
          { key: 'name', header: 'Name' },
          { key: 'merchant', header: 'Merchant', value: (i) => lookups.merchantName(i.merchantId) },
          { key: 'branch', header: 'Warehouse', value: (i) => lookups.branchName(i.branchId) },
          { key: 'bin', header: 'Bin' },
          { key: 'stock', header: 'On hand', align: 'right' },
          { key: 'reorder', header: 'Reorder', align: 'right' },
          { key: 'state', header: 'Status', value: stockStatus, render: (i) => <StatusBadge status={stockStatus(i)} /> },
          { key: 'act', header: '', sortable: false, export: false, render: (i) => (
            <span className="flex gap-1">
              <button type="button" className="btn-outline btn-sm" onClick={() => setMove({ item: i, type: 'Stock In' })}><ArrowDownToLine size={13} aria-hidden /> In</button>
              <button type="button" className="btn-outline btn-sm" onClick={() => setMove({ item: i, type: 'Stock Out' })} disabled={!i.stock}><ArrowUpFromLine size={13} aria-hidden /> Out</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(i)} aria-label={`Edit ${i.sku}`}><Pencil size={14} /></button>
              <button type="button" className="btn-ghost btn-sm hover:!text-danger" onClick={() => del(i)} aria-label={`Delete ${i.sku}`}><Trash2 size={14} /></button>
            </span>
          ) },
        ]}
      />
      <FormModal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? `Edit ${edit.sku}` : 'Add SKU'}
        fields={SKU_FIELDS(lookups)}
        defaultValues={edit}
        onSubmit={(v) => {
          if (edit.id) updateItem('inventory', edit.id, v, 'Warehouse', `${v.sku} edited`);
          else addItem('inventory', { id: uid('SKU'), stock: 0, unitCost: 0, weight: 0, ...v }, 'Warehouse', `${v.sku} added`);
          setEdit(null);
          toast.success('SKU saved');
        }}
      />
      {move && <MoveModal item={move.item} type={move.type} onClose={() => setMove(null)} />}
    </div>
  );
}

export function Inbound() {
  const lookups = useLookups();
  const { inbounds, inventory, addItem, updateItem, moveStock } = useData();
  const scoped = useBranchFilter(inbounds);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [qty, setQty] = useState({});
  const current = inbounds.find((i) => i.id === open);
  const sku = (id) => inventory.find((i) => i.id === id);

  const receive = () => {
    let moved = 0;
    const lines = current.lines.map((l) => {
      const add = Math.min(Number(qty[l.skuId]) || 0, l.expected - l.received);
      if (add > 0 && moveStock(l.skuId, add, 'Stock In', `Received on ${current.id}`)) { moved += add; return { ...l, received: l.received + add }; }
      return l;
    });
    if (!moved) { toast.error('Enter a received quantity first'); return; }
    const complete = lines.every((l) => l.received >= l.expected);
    updateItem('inbounds', current.id, { lines, status: complete ? 'Received' : 'Receiving' }, 'Warehouse', `${current.id}: ${moved} units received`);
    setOpen(null); setQty({});
    toast.success(`${moved} unit(s) received into stock`);
  };

  return (
    <div>
      <PageHeader title="Inbound Receiving" subtitle="Receiving a delivery adds its units to stock." actions={<button type="button" className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden /> Expect delivery</button>} />
      <DataTable
        data={scoped}
        exportName="inbound"
        onRowClick={(g) => setOpen(g.id)}
        filters={[{ key: 'status', label: 'Status', options: ['Expected', 'Receiving', 'Received'] }]}
        columns={[
          { key: 'id', header: 'GRN' },
          { key: 'merchant', header: 'Merchant', value: (g) => lookups.merchantName(g.merchantId) },
          { key: 'branch', header: 'Warehouse', value: (g) => lookups.branchName(g.branchId) },
          { key: 'eta', header: 'ETA', render: (g) => fmtDate(g.eta), exportValue: (g) => fmtDate(g.eta) },
          { key: 'units', header: 'Received / expected', align: 'right', value: (g) => `${sum(g.lines, (l) => l.received)} / ${sum(g.lines, (l) => l.expected)}` },
          { key: 'status', header: 'Status', render: (g) => <StatusBadge status={g.status} />, value: (g) => g.status },
        ]}
      />
      <Modal
        open={!!current}
        onClose={() => { setOpen(null); setQty({}); }}
        title={`Receive ${current?.id}`}
        footer={<><button type="button" className="btn-outline" onClick={() => { setOpen(null); setQty({}); }}>Close</button>{current?.status !== 'Received' && <button type="button" className="btn-primary" onClick={receive}>Receive</button>}</>}
      >
        <ul className="space-y-2">
          {current?.lines.map((l) => (
            <li key={l.skuId} className="flex items-center gap-3 rounded-lg border border-line p-2.5 text-sm">
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{sku(l.skuId)?.name}</span><span className="text-xs text-ink-muted">{sku(l.skuId)?.sku} - bin {sku(l.skuId)?.bin} - {l.received} of {l.expected} received</span></span>
              {l.received < l.expected && <input type="number" min="0" max={l.expected - l.received} aria-label={`Quantity for ${sku(l.skuId)?.name}`} className="input !w-20" value={qty[l.skuId] ?? ''} placeholder={String(l.expected - l.received)} onChange={(e) => setQty((q) => ({ ...q, [l.skuId]: e.target.value }))} />}
            </li>
          ))}
        </ul>
      </Modal>
      <FormModal
        open={creating}
        onClose={() => setCreating(false)}
        title="Expect a delivery"
        fields={[
          { name: 'skuId', label: 'SKU', type: 'select', options: inventory.map((i) => ({ value: i.id, label: `${i.sku} - ${i.name}` })), required: true, full: true },
          { name: 'expected', label: 'Expected units', type: 'number', required: true, min: 1 },
          { name: 'eta', label: 'ETA', type: 'date', required: true },
        ]}
        onSubmit={(v) => {
          const it = sku(v.skuId);
          const id = `GRN-${Math.floor(1000 + Math.random() * 9000)}`;
          addItem('inbounds', { id, merchantId: it.merchantId, branchId: it.branchId, eta: new Date(v.eta).toISOString(), status: 'Expected', lines: [{ skuId: v.skuId, expected: v.expected, received: 0 }] }, 'Warehouse', `${id} expected`);
          setCreating(false);
          toast.success(`${id} created`);
        }}
      />
    </div>
  );
}

const STAGES = ['New', 'Picking', 'Packing', 'Ready to Ship'];

export function PickPack() {
  const lookups = useLookups();
  const { pickOrders, inventory, updateItem, moveStock } = useData();
  const [open, setOpen] = useState(null);
  const order = pickOrders.find((o) => o.id === open);
  const sku = (id) => inventory.find((i) => i.id === id);

  const advance = (o) => {
    const idx = STAGES.indexOf(o.status);
    if (o.status === 'Picking' && !o.lines.every((l) => l.picked)) { toast.error('Tick every line as picked first'); return; }
    if (o.status === 'Packing' && !o.packaging) { toast.error('Choose a packaging material first'); return; }
    if (o.status === 'Picking') {
      // Picked units leave stock at this point; refuse the step if a line is short.
      const short = o.lines.find((l) => (sku(l.skuId)?.stock || 0) < l.qty);
      if (short) { toast.error(`Not enough stock for ${sku(short.skuId)?.sku}`); return; }
      o.lines.forEach((l) => moveStock(l.skuId, -l.qty, 'Stock Out', `Picked for ${o.id}`));
    }
    updateItem('pickOrders', o.id, { status: STAGES[idx + 1] }, 'Warehouse', `${o.id} -> ${STAGES[idx + 1]}`);
    toast.success(`${o.id} moved to ${STAGES[idx + 1]}`);
    if (STAGES[idx + 1] === 'Ready to Ship') setOpen(null);
  };
  const togglePick = (o, skuId) => updateItem('pickOrders', o.id, (x) => ({ lines: x.lines.map((l) => (l.skuId === skuId ? { ...l, picked: !l.picked } : l)) }), 'Warehouse');

  return (
    <div>
      <PageHeader title="Pick & Pack" subtitle="Order list, then pick, then pack, then ready to ship." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((stage) => {
          const orders = pickOrders.filter((o) => o.status === stage);
          return (
            <section key={stage} className="rounded-xl bg-gray-100 p-3">
              <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">{stage} <span className="chip bg-white">{orders.length}</span></h2>
              <ul className="space-y-2">
                {orders.map((o) => (
                  <li key={o.id} className="card p-3">
                    <button type="button" className="w-full text-start" onClick={() => setOpen(o.id)}>
                      <p className="font-mono text-xs font-semibold">{o.id}</p>
                      <p className="truncate text-sm">{o.customer} - {o.city}</p>
                      <p className="truncate text-xs text-ink-muted">{lookups.merchantName(o.merchantId)} - {sum(o.lines, (l) => l.qty)} unit(s)</p>
                    </button>
                    {stage !== 'Ready to Ship' && <button type="button" className="btn-outline btn-sm mt-2 w-full" onClick={() => setOpen(o.id)}>Open</button>}
                  </li>
                ))}
                {!orders.length && <li className="py-6 text-center text-xs text-ink-muted">Empty</li>}
              </ul>
            </section>
          );
        })}
      </div>
      <Modal
        open={!!order}
        onClose={() => setOpen(null)}
        title={`Order ${order?.id}`}
        footer={<><button type="button" className="btn-outline" onClick={() => setOpen(null)}>Close</button>{order && order.status !== 'Ready to Ship' && <button type="button" className="btn-primary" onClick={() => advance(order)}>{{ New: 'Start picking', Picking: 'Finish picking', Packing: 'Mark ready to ship' }[order.status]}</button>}</>}
      >
        {order && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm"><StatusBadge status={order.status} /> {order.customer}, {order.city}</p>
            <ul className="space-y-1.5">
              {order.lines.map((l) => (
                <li key={l.skuId} className={clsx('flex items-center gap-2 rounded-lg border p-2.5 text-sm', l.picked ? 'border-primary bg-primary-light/50' : 'border-line')}>
                  {order.status === 'Picking' && <input type="checkbox" className="h-4 w-4 accent-primary-hover" aria-label={`Picked ${sku(l.skuId)?.name}`} checked={l.picked} onChange={() => togglePick(order, l.skuId)} />}
                  <span className="min-w-0 flex-1 truncate">{l.qty} x {sku(l.skuId)?.name}</span>
                  <span className="chip">Bin {l.bin}</span>
                </li>
              ))}
            </ul>
            {order.status === 'Packing' && (
              <div>
                <label htmlFor="pk" className="label">Packaging material</label>
                <select id="pk" className="input" value={order.packaging} onChange={(e) => updateItem('pickOrders', order.id, { packaging: e.target.value }, 'Warehouse')}>
                  <option value="">Select...</option>
                  {['Flyer - Small', 'Flyer - Large', 'Small box', 'Large box'].map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function StockControl() {
  const { money } = useMoney();
  const lookups = useLookups();
  const { stockMoves, inventory, materials, updateItem, moveStock } = useData();
  const [tab, setTab] = useState('moves');
  const [adjust, setAdjust] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [restock, setRestock] = useState(null);
  const skuOptions = useMemo(() => inventory.map((i) => ({ value: i.id, label: `${i.sku} - ${i.name} (${i.stock})` })), [inventory]);
  const sku = (id) => inventory.find((i) => i.id === id);
  return (
    <div>
      <PageHeader
        title="Stock Control"
        subtitle="Adjustments, warehouse transfers, and packaging materials."
        actions={<><button type="button" className="btn-outline" onClick={() => setTransfer(true)}>Warehouse transfer</button><button type="button" className="btn-primary" onClick={() => setAdjust(true)}>Stock adjustment</button></>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'moves', label: 'Movements', count: stockMoves.length }, { value: 'materials', label: 'Packaging materials', count: materials.length }]} />
      {tab === 'moves' && (
        <DataTable
          data={stockMoves}
          exportName="stock-movements"
          dateKey="date"
          filters={[{ key: 'type', label: 'Type', options: ['Stock In', 'Stock Out', 'Adjustment', 'Transfer'] }]}
          columns={[
            { key: 'id', header: 'ID' },
            { key: 'date', header: 'Date', render: (m) => fmtDate(m.date), exportValue: (m) => fmtDate(m.date) },
            { key: 'sku', header: 'SKU', value: (m) => sku(m.skuId)?.sku || m.skuId },
            { key: 'name', header: 'Item', value: (m) => sku(m.skuId)?.name || '-' },
            { key: 'type', header: 'Type' },
            { key: 'qty', header: 'Qty', align: 'right' },
            { key: 'by', header: 'By' },
            { key: 'note', header: 'Note' },
          ]}
        />
      )}
      {tab === 'materials' && (
        <DataTable
          data={materials}
          exportName="packaging-materials"
          rowClass={(m) => (m.stock <= m.reorder ? 'bg-danger-light/40' : '')}
          columns={[
            { key: 'name', header: 'Material' },
            { key: 'stock', header: 'On hand', align: 'right', render: (m) => <span className={m.stock <= m.reorder ? 'font-bold text-danger' : ''}>{m.stock} {m.unit}</span> },
            { key: 'reorder', header: 'Reorder at', align: 'right' },
            { key: 'cost', header: 'Unit cost', align: 'right', render: (m) => money(m.cost) },
            { key: 'act', header: '', sortable: false, export: false, render: (m) => <button type="button" className="btn-outline btn-sm" onClick={() => setRestock(m)}>Restock</button> },
          ]}
        />
      )}
      <FormModal
        open={adjust}
        onClose={() => setAdjust(false)}
        title="Stock adjustment"
        fields={[
          { name: 'skuId', label: 'SKU', type: 'select', options: skuOptions, required: true, full: true },
          { name: 'delta', label: 'Change (+ or -)', type: 'number', required: true },
          { name: 'note', label: 'Reason', required: true },
        ]}
        onSubmit={({ skuId, delta, note }) => {
          if (!delta) { toast.error('Enter a change other than 0'); return; }
          if (moveStock(skuId, delta, 'Adjustment', note)) { setAdjust(false); toast.success('Stock adjusted'); } else toast.error('That would take stock below zero');
        }}
      />
      <FormModal
        open={transfer}
        onClose={() => setTransfer(false)}
        title="Warehouse transfer"
        fields={[
          { name: 'skuId', label: 'SKU', type: 'select', options: skuOptions, required: true, full: true },
          { name: 'toBranchId', label: 'To warehouse', type: 'select', options: lookups.branchOptions, required: true },
          { name: 'qty', label: 'Quantity', type: 'number', required: true, min: 1 },
        ]}
        onSubmit={({ skuId, toBranchId, qty }) => {
          const it = sku(skuId);
          if (it.branchId === toBranchId) { toast.error('That SKU is already at this warehouse'); return; }
          if (!moveStock(skuId, -qty, 'Transfer', `To ${lookups.branchName(toBranchId)}`)) { toast.error('Not enough stock to transfer'); return; }
          setTransfer(false);
          toast.success(`${qty} unit(s) sent to ${lookups.branchName(toBranchId)}`);
        }}
      />
      <FormModal
        open={!!restock}
        onClose={() => setRestock(null)}
        title={`Restock ${restock?.name}`}
        size="sm"
        fields={[{ name: 'qty', label: 'Quantity', type: 'number', required: true, min: 1, full: true }]}
        onSubmit={({ qty }) => { updateItem('materials', restock.id, (m) => ({ stock: m.stock + qty }), 'Warehouse', `${restock.name} +${qty}`); setRestock(null); toast.success('Material restocked'); }}
      />
    </div>
  );
}

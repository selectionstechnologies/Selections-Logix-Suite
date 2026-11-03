// Document centre: label designer with live preview, other documents, reprint history.
import { useState } from 'react';
import { Printer } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, PageHeader, Tabs } from '../../components/ui/index.jsx';
import { AirwayBill, DeliveryReceipt, InvoiceDoc, ManifestDoc, PAGE_SIZES, PickupReceipt, PrintPreview, ReturnSlip, RunSheetDoc, ShippingLabel } from '../../components/print/index.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';
import { useLookups, useScopedShipments } from '../../hooks/useApp.js';
import { fmtDateTime } from '../../utils/format.js';
import { STATUS } from '../../utils/status.js';
import { LabelPrintModal } from '../shipments/ShipmentList.jsx';

const SHIP_DOCS = {
  'Airway Bill': [AirwayBill, 'a4'],
  'Delivery Receipt / POD': [DeliveryReceipt, 'a5'],
  'Pickup Receipt': [PickupReceipt, 'a5'],
  'Return Slip': [ReturnSlip, 'a5'],
};

function LabelDesigner() {
  const shipments = useScopedShipments();
  const defaultSize = useData((s) => s.settings.labelFormat);
  const [awb, setAwb] = useState('');
  const [size, setSize] = useState(defaultSize);
  const [print, setPrint] = useState(false);
  const s = shipments.find((x) => x.awb === awb.trim().toUpperCase()) || shipments[0];
  if (!s) return <p className="text-sm text-ink-muted">No shipments available.</p>;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <Card title="Options">
        <div className="space-y-3">
          <div>
            <label htmlFor="lb" className="label">AWB</label>
            <input id="lb" className="input font-mono" list="awb-list" placeholder={s.awb} value={awb} onChange={(e) => setAwb(e.target.value)} />
            <datalist id="awb-list">{shipments.slice(0, 40).map((x) => <option key={x.id} value={x.awb} />)}</datalist>
            {awb && s.awb !== awb.trim().toUpperCase() && <p className="mt-1 text-xs font-medium text-danger">Not found, showing {s.awb}</p>}
          </div>
          <fieldset>
            <legend className="label">Size</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.entries(PAGE_SIZES).map(([k, v]) => (
                <button key={k} type="button" aria-pressed={size === k} className={size === k ? 'btn-primary btn-sm' : 'btn-outline btn-sm'} onClick={() => setSize(k)}>{v.label.replace(' Thermal', '')}</button>
              ))}
            </div>
          </fieldset>
          <button type="button" className="btn-primary w-full" onClick={() => setPrint(true)}><Printer size={15} aria-hidden /> Preview and print</button>
          <p className="text-xs text-ink-muted">Includes logo, sender and receiver, AWB barcode, QR code, red bold COD, weight, service, origin and destination codes, and date. Bulk printing lives in Bulk Import / Export and on the Shipments list.</p>
        </div>
      </Card>
      <Card title={`Live preview: ${PAGE_SIZES[size].label}`} className="lg:col-span-2" bodyClass="overflow-auto bg-gray-100 p-4 rounded-b-xl">
        <div className="mx-auto w-fit"><ShippingLabel shipment={s} size={size} /></div>
      </Card>
      <LabelPrintModal open={print} rows={[s]} onClose={() => setPrint(false)} />
    </div>
  );
}

function OtherDocuments() {
  const user = useAuth((s) => s.user);
  const shipments = useScopedShipments();
  const { manifests, riders, invoices, shipments: all, logPrint } = useData();
  const { branchName, merchant } = useLookups();
  const [open, setOpen] = useState(null); // { title, size, node, filename, ref }
  const [awb, setAwb] = useState('');
  const isMerchant = user.role === 'merchant';
  const s = shipments.find((x) => x.awb === awb.trim().toUpperCase());

  const openShip = (name) => {
    if (!s) { toast.error('Enter a valid AWB first'); return; }
    const [Doc, size] = SHIP_DOCS[name];
    setOpen({ title: `${name}: ${s.awb}`, size, filename: `${name.split(' ')[0].toLowerCase()}-${s.awb}`, node: <Doc shipment={s} />, kind: name, ref: s.awb });
  };

  const ownInvoices = invoices.filter((i) => !isMerchant || i.merchantId === user.merchantId);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card title="Shipment documents">
        <label htmlFor="docawb" className="label">AWB</label>
        <input id="docawb" className="input mb-3 font-mono" list="awb-list2" placeholder="SLX100001" value={awb} onChange={(e) => setAwb(e.target.value)} />
        <datalist id="awb-list2">{shipments.slice(0, 40).map((x) => <option key={x.id} value={x.awb} />)}</datalist>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.keys(SHIP_DOCS).map((name) => <button key={name} type="button" className="btn-outline justify-start" onClick={() => openShip(name)}><Printer size={15} aria-hidden /> {name}</button>)}
        </div>
      </Card>
      {!isMerchant && (
        <Card title="Latest manifests" bodyClass="">
          <ul className="divide-y divide-line">
            {manifests.slice(0, 5).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="font-medium">{m.id} <span className="font-normal text-ink-muted">{m.awbs.length} parcels</span></span>
                <button type="button" className="btn-outline btn-sm" onClick={() => setOpen({ title: `Manifest ${m.id}`, size: 'a4', filename: `manifest-${m.id}`, kind: 'Manifest', ref: m.id, node: <ManifestDoc manifest={m} shipments={all} branchName={branchName} /> })}><Printer size={13} aria-hidden /> Print</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!isMerchant && (
        <Card title="Run sheets" bodyClass="">
          <ul className="divide-y divide-line">
            {riders.map((r) => ({ r, list: all.filter((x) => x.riderId === r.id && [STATUS.OFD, STATUS.REATTEMPT].includes(x.status)) })).filter((x) => x.list.length).slice(0, 5).map(({ r, list }) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="font-medium">{r.name} <span className="font-normal text-ink-muted">{list.length} stops</span></span>
                <button type="button" className="btn-outline btn-sm" onClick={() => setOpen({ title: `Run sheet: ${r.name}`, size: 'a4', filename: `runsheet-${r.id}`, kind: 'Run Sheet', ref: r.name, node: <RunSheetDoc rider={r} shipments={list} /> })}><Printer size={13} aria-hidden /> Print</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Invoices" bodyClass="">
        <ul className="divide-y divide-line">
          {ownInvoices.slice(0, 5).map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <span className="font-medium">{i.number}</span>
              <button type="button" className="btn-outline btn-sm" onClick={() => setOpen({ title: i.number, size: 'a4', filename: i.number, kind: 'Invoice', ref: i.number, node: <InvoiceDoc invoice={i} merchant={merchant(i.merchantId)} /> })}><Printer size={13} aria-hidden /> Print</button>
            </li>
          ))}
          {!ownInvoices.length && <li className="px-4 py-6 text-center text-sm text-ink-muted">No invoices yet</li>}
        </ul>
      </Card>
      {open && (
        <PrintPreview open onClose={() => setOpen(null)} title={open.title} filename={open.filename} size={open.size} onPrint={() => logPrint(open.kind, [open.ref], open.size)}>
          {open.node}
        </PrintPreview>
      )}
    </div>
  );
}

function ReprintHistory() {
  const { printHistory, shipments } = useData();
  const [reprint, setReprint] = useState([]);
  const columns = [
    { key: 'at', header: 'Printed', value: (r) => r.at, render: (r) => fmtDateTime(r.at), exportValue: (r) => fmtDateTime(r.at) },
    { key: 'kind', header: 'Document' },
    { key: 'refs', header: 'References', value: (r) => r.refs.slice(0, 3).join(', ') + (r.refs.length > 3 ? ` +${r.refs.length - 3}` : '') },
    { key: 'size', header: 'Size', value: (r) => PAGE_SIZES[r.size]?.label || r.size },
    { key: 'by', header: 'By' },
    { key: 'action', header: '', sortable: false, export: false, render: (r) => r.kind === 'Shipping Label' && <button type="button" className="btn-outline btn-sm" onClick={() => setReprint(shipments.filter((s) => r.refs.includes(s.awb)))}><Printer size={13} aria-hidden /> Reprint</button> },
  ];
  return (
    <>
      <DataTable columns={columns} data={printHistory} exportName="print-history" emptyTitle="Nothing printed yet" emptyMessage="Labels and documents you print or download are recorded here." />
      <LabelPrintModal open={reprint.length > 0} rows={reprint} onClose={() => setReprint([])} />
    </>
  );
}

export function DocumentCenter() {
  const [tab, setTab] = useState('labels');
  const count = useData((s) => s.printHistory.length);
  return (
    <div>
      <PageHeader title="Labels & Documents" subtitle="Print-ready labels and paperwork, with PDF download." />
      <Tabs tabs={[{ value: 'labels', label: 'Label designer' }, { value: 'docs', label: 'Documents' }, { value: 'history', label: 'Reprint history', count }]} value={tab} onChange={setTab} />
      {tab === 'labels' && <LabelDesigner />}
      {tab === 'docs' && <OtherDocuments />}
      {tab === 'history' && <ReprintHistory />}
    </div>
  );
}


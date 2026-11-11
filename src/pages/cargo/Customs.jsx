// Customs files: clearance tracker, document checklist, duty calculator, HS lookup and paperwork.
import { useMemo, useState } from 'react';
import { Calculator, CheckCircle2, Circle, FileText, Plus, Search, Upload } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, Drawer, KV, PageHeader, StatusBadge, Stepper, Tabs } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { PrintPreview, Sheet } from '../../components/print/index.jsx';
import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';
import { useMoney } from '../../hooks/useApp.js';
import { CUSTOMS_STAGES, HS_CODES } from '../../data/config.js';
import { fmtCurrency, fmtDate, uid } from '../../utils/format.js';

const DOC_CHECKLIST = ['Commercial Invoice', 'Packing List', 'Bill of Lading / AWB', 'Certificate of Origin', 'Import Permit'];

/** Duty on value; sales tax on value + duty, as customs assesses it. */
export function dutyFor(value, hs) {
  const duty = (value * (hs?.duty || 0)) / 100;
  const tax = ((value + duty) * (hs?.tax || 0)) / 100;
  return { duty: Math.round(duty), tax: Math.round(tax), total: Math.round(duty + tax) };
}

function CustomsDoc({ file: f, kind }) {
  const invoice = kind === 'invoice';
  return (
    <Sheet size="a4" className="p-8 text-sm">
      <div className="mb-5 flex justify-between border-b-2 border-[#FACC15] pb-3">
        <div><p className="text-base font-bold">Selections Logix Suite</p><p className="text-xs text-gray-500">Customs documentation</p></div>
        <div className="text-end"><p className="text-lg font-bold uppercase">{invoice ? 'Commercial Invoice' : 'Packing List'}</p><p className="text-xs">{f.gdNumber}</p></div>
      </div>
      <p>Importer: <b>{f.importer}</b></p>
      <p className="mb-4">Route: {f.origin} to {f.destination} | HS {f.hsCode}</p>
      {invoice ? (
        <table className="w-full border-collapse text-xs">
          <thead><tr className="bg-gray-100">{['Description', 'HS code', 'Qty', 'Unit value', 'Total'].map((h) => <th key={h} className="border border-gray-200 p-2 text-start">{h}</th>)}</tr></thead>
          <tbody>{f.invoiceItems.map((i, idx) => <tr key={idx}><td className="border border-gray-200 p-2">{i.description}</td><td className="border border-gray-200 p-2">{i.hs}</td><td className="border border-gray-200 p-2">{i.qty}</td><td className="border border-gray-200 p-2">{fmtCurrency(i.unitValue)}</td><td className="border border-gray-200 p-2">{fmtCurrency(i.qty * i.unitValue)}</td></tr>)}</tbody>
        </table>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead><tr className="bg-gray-100">{['Description', 'Cartons', 'Gross kg', 'Net kg'].map((h) => <th key={h} className="border border-gray-200 p-2 text-start">{h}</th>)}</tr></thead>
          <tbody><tr><td className="border border-gray-200 p-2">{f.description}</td><td className="border border-gray-200 p-2">{f.packing.cartons}</td><td className="border border-gray-200 p-2">{f.packing.gross}</td><td className="border border-gray-200 p-2">{f.packing.net}</td></tr></tbody>
        </table>
      )}
    </Sheet>
  );
}

function FileDrawer({ file: f, onClose }) {
  const { money } = useMoney();
  const { updateItem, logPrint } = useData();
  const [doc, setDoc] = useState(null);
  const hs = HS_CODES.find((h) => h.code === f.hsCode);
  const d = dutyFor(f.value, hs);
  const idx = CUSTOMS_STAGES.indexOf(f.status);
  const held = f.status === 'Held';
  const missing = f.documents.filter((x) => !x.uploaded);

  const advance = () => {
    const next = CUSTOMS_STAGES[idx + 1];
    // Filing needs the complete document set, as it would at the customs portal.
    if (next === 'Filed' && missing.length) { toast.error(`Upload first: ${missing.map((x) => x.name).join(', ')}`); return; }
    updateItem('customsFiles', f.id, { status: next, updatedAt: new Date().toISOString() }, 'Customs', `${f.id} -> ${next}`);
    toast.success(`${f.id} moved to ${next}`);
  };
  const toggleHold = () => {
    const status = held ? 'Assessment' : 'Held';
    updateItem('customsFiles', f.id, { status, updatedAt: new Date().toISOString() }, 'Customs', `${f.id} -> ${status}`);
    toast.info(`${f.id} ${held ? 'released to Assessment' : 'placed on hold'}`);
  };
  const upload = (name) => {
    updateItem('customsFiles', f.id, (x) => ({ documents: x.documents.map((y) => (y.name === name ? { ...y, uploaded: true } : y)) }), 'Customs', `${f.id}: ${name} uploaded`);
    toast.success(`${name} uploaded`);
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title={`Customs file ${f.id}`}
      width="max-w-xl"
      footer={(
        <>
          <button type="button" className={held ? 'btn-outline' : 'btn-danger'} onClick={toggleHold} disabled={f.status === 'Cleared'}>{held ? 'Release hold' : 'Place on hold'}</button>
          {!held && idx < CUSTOMS_STAGES.length - 1 && <button type="button" className="btn-primary" onClick={advance}>Move to {CUSTOMS_STAGES[idx + 1]}</button>}
        </>
      )}
    >
      <div className="mb-4">{held ? <p className="rounded-lg bg-danger-light px-3 py-2 text-sm font-medium text-danger-dark">Held by customs. Release it to continue.</p> : <Stepper steps={CUSTOMS_STAGES} current={f.status === 'Cleared' ? CUSTOMS_STAGES.length : idx} />}</div>
      <dl className="mb-4 grid grid-cols-2 gap-3">
        <KV label="GD number">{f.gdNumber}</KV>
        <KV label="Importer">{f.importer}</KV>
        <KV label="Route">{f.origin} - {f.destination}</KV>
        <KV label="Linked cargo">{f.cargoId}</KV>
        <KV label="HS code">{f.hsCode} {hs?.description}</KV>
        <KV label="Declared value">{money(f.value)}</KV>
      </dl>
      <div className="mb-4 rounded-lg bg-surface p-3">
        <p className="label">Duty and tax</p>
        <div className="flex justify-between py-0.5 text-sm"><span className="text-ink-muted">Duty ({hs?.duty}%)</span><span>{money(d.duty)}</span></div>
        <div className="flex justify-between py-0.5 text-sm"><span className="text-ink-muted">Sales tax ({hs?.tax}%)</span><span>{money(d.tax)}</span></div>
        <div className="mt-1 flex justify-between border-t border-line pt-1 font-bold"><span>Payable</span><span>{money(d.total)}</span></div>
      </div>
      <p className="label">Document checklist ({f.documents.length - missing.length} of {f.documents.length})</p>
      <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
        {f.documents.map((x) => (
          <li key={x.name} className="flex items-center gap-2 px-3 py-2 text-sm">
            {x.uploaded ? <CheckCircle2 size={16} className="text-primary-dark" aria-label="Uploaded" /> : <Circle size={16} className="text-danger" aria-label="Missing" />}
            <span className="flex-1">{x.name}</span>
            {!x.uploaded && <button type="button" className="btn-outline btn-sm" onClick={() => upload(x.name)}><Upload size={13} aria-hidden /> Upload</button>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-outline" onClick={() => setDoc('invoice')}><FileText size={15} aria-hidden /> Commercial invoice</button>
        <button type="button" className="btn-outline" onClick={() => setDoc('packing')}><FileText size={15} aria-hidden /> Packing list</button>
      </div>
      {doc && (
        <PrintPreview open onClose={() => setDoc(null)} title={doc === 'invoice' ? 'Commercial Invoice' : 'Packing List'} filename={`${doc}-${f.id}`} onPrint={() => logPrint(doc === 'invoice' ? 'Commercial Invoice' : 'Packing List', [f.id], 'a4')}>
          <CustomsDoc file={f} kind={doc} />
        </PrintPreview>
      )}
    </Drawer>
  );
}

function HsLookup() {
  const [q, setQ] = useState('');
  const [hsCode, setHsCode] = useState(HS_CODES[0].code);
  const [value, setValue] = useState(100000);
  const { money } = useMoney();
  const hs = HS_CODES.find((h) => h.code === hsCode);
  const d = dutyFor(Number(value) || 0, hs);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return HS_CODES.filter((h) => !t || h.code.includes(t) || h.description.toLowerCase().includes(t));
  }, [q]);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card title="HS code lookup" bodyClass="">
        <div className="relative border-b border-line p-3">
          <Search size={15} className="absolute start-5 top-5 text-gray-400" aria-hidden />
          <input aria-label="Search HS codes" className="input !ps-8" placeholder="Search by code or description" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="scroll-thin max-h-96 divide-y divide-line overflow-y-auto">
          {rows.map((h) => (
            <li key={h.code}>
              <button type="button" className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-start text-sm hover:bg-surface ${h.code === hsCode ? 'bg-primary-light' : ''}`} onClick={() => setHsCode(h.code)}>
                <span className="min-w-0"><b className="font-mono">{h.code}</b> <span className="text-ink-muted">{h.description}</span></span>
                <span className="shrink-0 text-xs">{h.duty}% / {h.tax}%</span>
              </button>
            </li>
          ))}
          {!rows.length && <li className="px-4 py-8 text-center text-sm text-ink-muted">No matching HS codes</li>}
        </ul>
      </Card>
      <Card title="Duty and tax calculator" actions={<Calculator size={16} className="text-ink-muted" aria-hidden />}>
        <p className="mb-3 text-sm"><b className="font-mono">{hs.code}</b> {hs.description}</p>
        <label htmlFor="dv" className="label">Customs value (PKR)</label>
        <input id="dv" type="number" min="0" className="input mb-3" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="flex justify-between py-1 text-sm"><span className="text-ink-muted">Duty ({hs.duty}%)</span><span>{money(d.duty)}</span></div>
        <div className="flex justify-between py-1 text-sm"><span className="text-ink-muted">Sales tax ({hs.tax}%, on value + duty)</span><span>{money(d.tax)}</span></div>
        <div className="mt-1 flex justify-between border-t border-line pt-2 font-bold"><span>Total payable</span><span>{money(d.total)}</span></div>
        <p className="mt-3 text-xs text-ink-muted">Reference rates only. Check current tariffs before quoting.</p>
      </Card>
    </div>
  );
}

export function CustomsFiles() {
  const { money } = useMoney();
  const { customsFiles, cargoBookings, addItem } = useData();
  const [tab, setTab] = useState('files');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const current = customsFiles.find((f) => f.id === open);
  return (
    <div>
      <PageHeader title="Customs" subtitle="Clearance tracking, documents, HS codes and duty." actions={<button type="button" className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden /> New file</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'files', label: 'Customs files', count: customsFiles.length }, { value: 'tools', label: 'HS lookup & duty calculator' }]} />
      {tab === 'files' && (
        <DataTable
          data={customsFiles}
          exportName="customs-files"
          onRowClick={(f) => setOpen(f.id)}
          rowClass={(f) => (f.status === 'Held' ? 'bg-danger-light/40' : '')}
          filters={[{ key: 'status', label: 'Status', options: [...CUSTOMS_STAGES, 'Held'] }]}
          columns={[
            { key: 'id', header: 'File' },
            { key: 'gdNumber', header: 'GD number' },
            { key: 'importer', header: 'Importer' },
            { key: 'route', header: 'Route', value: (f) => `${f.origin} - ${f.destination}` },
            { key: 'hsCode', header: 'HS code' },
            { key: 'value', header: 'Value', align: 'right', render: (f) => money(f.value) },
            { key: 'docs', header: 'Docs', value: (f) => `${f.documents.filter((x) => x.uploaded).length}/${f.documents.length}` },
            { key: 'updatedAt', header: 'Updated', render: (f) => fmtDate(f.updatedAt), exportValue: (f) => fmtDate(f.updatedAt) },
            { key: 'status', header: 'Status', render: (f) => <StatusBadge status={f.status} />, value: (f) => f.status },
          ]}
        />
      )}
      {tab === 'tools' && <HsLookup />}
      {current && <FileDrawer file={current} onClose={() => setOpen(null)} />}
      <FormModal
        open={creating}
        onClose={() => setCreating(false)}
        title="New customs file"
        fields={[
          { name: 'cargoId', label: 'Cargo booking', type: 'select', options: cargoBookings.map((c) => ({ value: c.id, label: `${c.id} - ${c.commodity}` })), required: true, full: true },
          { name: 'hsCode', label: 'HS code', type: 'select', options: HS_CODES.map((h) => ({ value: h.code, label: `${h.code} ${h.description}` })), required: true },
          { name: 'value', label: 'Declared value (PKR)', type: 'number', required: true, min: 1 },
        ]}
        onSubmit={(v) => {
          const c = cargoBookings.find((x) => x.id === v.cargoId);
          const id = uid('CF');
          addItem('customsFiles', {
            id, cargoId: c.id, gdNumber: `GD-NEW-${Math.floor(10000 + Math.random() * 89999)}`, hsCode: v.hsCode, description: c.commodity, importer: c.consignee, origin: c.origin, destination: c.destination,
            value: v.value, status: 'Documents', documents: DOC_CHECKLIST.map((name) => ({ name, uploaded: false })),
            invoiceItems: [{ description: c.commodity, qty: 1, unitValue: v.value, hs: v.hsCode }], packing: { cartons: 1, gross: c.weight, net: Math.round(c.weight * 0.94) }, updatedAt: new Date().toISOString(),
          }, 'Customs', `${id} opened`);
          setCreating(false);
          setOpen(id);
          toast.success('Customs file opened. Upload the documents next.');
        }}
      />
    </div>
  );
}

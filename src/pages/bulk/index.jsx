// Bulk centre: every import follows upload -> validated preview (inline fixes) -> import ->
// summary with a downloadable error report. Each kind only supplies columns and validators.
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Printer, RotateCcw, Upload, XCircle } from 'lucide-react';
import { Card, FileDropzone, PageHeader, Tabs } from '../../components/ui/index.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';
import { useScopedShipments, useLookups } from '../../hooks/useApp.js';
import { CITY_MAP, CITY_NAMES } from '../../data/geo.js';
import { SERVICES } from '../../utils/pricing.js';
import { NEXT_STATUS, SHIPMENT_STATUSES } from '../../utils/status.js';
import { downloadText, exportCSV, exportPDF, exportXLSX, parseSpreadsheet } from '../../utils/export.js';
import { uid } from '../../utils/format.js';
import { LabelPrintModal } from '../shipments/ShipmentList.jsx';
import Papa from 'papaparse';

const PHONE = /^\+?[0-9][0-9\s-]{8,16}$/;
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const SERVICE_VALUES = SERVICES.map((s) => s.value);

// A validator returns { error } | { warning } | null for one cell.
const required = (label) => (v) => (String(v ?? '').trim() ? null : { error: `${label} is required` });
const oneOf = (label, list) => (v) => (list.includes(String(v ?? '').trim()) ? null : { error: `${label} must be one of: ${list.slice(0, 6).join(', ')}${list.length > 6 ? '...' : ''}` });

const KINDS = {
  booking: {
    label: 'Bulk booking',
    template: 'bulk-booking-template',
    columns: [
      { key: 'receiver_name', label: 'Receiver', validate: required('Receiver') },
      { key: 'receiver_phone', label: 'Phone', validate: (v) => (PHONE.test(String(v ?? '').trim()) ? null : { error: 'Invalid phone number' }) },
      { key: 'receiver_address', label: 'Address', validate: (v) => (String(v ?? '').trim().length >= 5 ? null : { error: 'Address is too short' }) },
      { key: 'receiver_city', label: 'City', validate: oneOf('City', CITY_NAMES) },
      { key: 'weight_kg', label: 'Weight', validate: (v) => { const n = num(v); if (!(n > 0)) return { error: 'Weight must be above 0' }; return n > 30 ? { warning: 'Over 30 kg: check the weight' } : null; } },
      { key: 'service', label: 'Service', validate: oneOf('Service', SERVICE_VALUES) },
      { key: 'cod_amount', label: 'COD', validate: (v) => { const n = num(v || 0); if (!(n >= 0)) return { error: 'COD must be 0 or more' }; return n > 100000 ? { warning: 'High COD amount' } : null; } },
      { key: 'item', label: 'Item', validate: (v) => (String(v ?? '').trim() ? null : { warning: 'No item description' }) },
    ],
    sample: [
      { receiver_name: 'Sara Ali', receiver_phone: '+92 300 1234567', receiver_address: 'House 12, Model Town', receiver_city: 'Lahore', weight_kg: 1.2, service: 'next-day', cod_amount: 3500, item: 'Lawn suit' },
      { receiver_name: 'Ahmed Khan', receiver_phone: '+92 321 7654321', receiver_address: 'Flat 4, Clifton Block 2', receiver_city: 'Karachi', weight_kg: 0.5, service: 'economy', cod_amount: 0, item: 'Skincare set' },
      { receiver_name: 'Bad Row Example', receiver_phone: '12', receiver_address: 'X', receiver_city: 'Atlantis', weight_kg: 0, service: 'teleport', cod_amount: -5, item: '' },
    ],
  },
  status: {
    label: 'Status update',
    template: 'bulk-status-template',
    columns: [
      { key: 'awb', label: 'AWB', validate: required('AWB') },
      { key: 'status', label: 'New status', validate: oneOf('Status', SHIPMENT_STATUSES) },
      { key: 'note', label: 'Note', validate: () => null },
    ],
    sample: [{ awb: 'SLX100001', status: 'Delivered', note: 'Bulk update' }],
    rowCheck: (row, ctx) => {
      const s = ctx.shipments.find((x) => x.awb === String(row.awb).trim());
      if (!s) return { awb: { error: 'AWB not found' } };
      if (row.status && !NEXT_STATUS[s.status]?.includes(row.status)) return { status: { error: `Cannot go from "${s.status}" to "${row.status}"` } };
      return {};
    },
  },
  customers: {
    label: 'Customer import',
    template: 'bulk-customer-template',
    columns: [
      { key: 'name', label: 'Name', validate: required('Name') },
      { key: 'type', label: 'Type', validate: oneOf('Type', ['Merchant', 'Individual', 'Corporate']) },
      { key: 'contact', label: 'Contact', validate: required('Contact') },
      { key: 'email', label: 'Email', validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim()) ? null : { error: 'Invalid email' }) },
      { key: 'phone', label: 'Phone', validate: (v) => (PHONE.test(String(v ?? '').trim()) ? null : { error: 'Invalid phone number' }) },
      { key: 'city', label: 'City', validate: oneOf('City', CITY_NAMES) },
    ],
    sample: [{ name: 'New Store Ltd', type: 'Merchant', contact: 'Ali Raza', email: 'ali@newstore.example.com', phone: '+92 300 5551234', city: 'Lahore' }],
    rowCheck: (row, ctx) => (ctx.merchants.some((m) => m.name.toLowerCase() === String(row.name).trim().toLowerCase()) ? { name: { warning: 'A customer with this name already exists' } } : {}),
  },
  rates: {
    label: 'Rate-card import',
    template: 'bulk-rate-template',
    columns: [
      { key: 'zone', label: 'Zone', validate: oneOf('Zone', ['A', 'B', 'C', 'X']) },
      { key: 'same_day', label: 'Same day', validate: (v) => (num(v) >= 0 ? null : { error: 'Must be 0 or more' }) },
      { key: 'next_day', label: 'Next day', validate: (v) => (num(v) >= 0 ? null : { error: 'Must be 0 or more' }) },
      { key: 'economy', label: 'Economy', validate: (v) => (num(v) >= 0 ? null : { error: 'Must be 0 or more' }) },
      { key: 'international', label: 'International', validate: (v) => (num(v) >= 0 ? null : { error: 'Must be 0 or more' }) },
    ],
    sample: [{ zone: 'A', same_day: 260, next_day: 190, economy: 150, international: 0 }, { zone: 'B', same_day: 430, next_day: 270, economy: 210, international: 0 }],
  },
};

function validateRows(kind, rows, ctx) {
  const def = KINDS[kind];
  return rows.map((row) => {
    const issues = {};
    def.columns.forEach((c) => {
      const r = c.validate(row[c.key]);
      if (r) issues[c.key] = r;
    });
    const extra = def.rowCheck?.(row, ctx) || {};
    Object.entries(extra).forEach(([k, v]) => { if (!issues[k]?.error) issues[k] = v; });
    return issues;
  });
}

function ImportWizard({ kind, onImport }) {
  const def = KINDS[kind];
  const data = useData();
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const ctx = { shipments: data.shipments, merchants: data.merchants };
  const issues = useMemo(() => (rows ? validateRows(kind, rows, ctx) : []), [rows, kind, data.shipments, data.merchants]); // eslint-disable-line
  const hasError = (i) => Object.values(issues[i] || {}).some((x) => x.error);
  const hasWarning = (i) => Object.values(issues[i] || {}).some((x) => x.warning);
  const errorCount = rows ? rows.filter((_, i) => hasError(i)).length : 0;
  const warnCount = rows ? rows.filter((_, i) => !hasError(i) && hasWarning(i)).length : 0;
  const validCount = rows ? rows.length - errorCount : 0;

  const downloadTemplate = () => {
    downloadText(`﻿${Papa.unparse(def.sample, { columns: def.columns.map((c) => c.key) })}`, `${def.template}.csv`, 'text/csv');
    toast.success('Template downloaded');
  };
  const onFile = async ([file]) => {
    try {
      const parsed = await parseSpreadsheet(file);
      if (!parsed.length) { toast.error('That file has no data rows'); return; }
      const missing = def.columns.filter((c) => !(c.key in parsed[0])).map((c) => c.key);
      if (missing.length === def.columns.length) { toast.error(`No expected columns found. Use the template (expected: ${def.columns.map((c) => c.key).join(', ')})`); return; }
      if (parsed.length > 2000) { toast.error('Please import at most 2000 rows at a time'); return; }
      setFileName(file.name);
      setRows(parsed);
      setSummary(null);
      toast.info(`${parsed.length} rows read from ${file.name}`);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const editCell = (i, key, value) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  const removeRow = (i) => setRows((r) => r.filter((_, idx) => idx !== i));

  const run = () => {
    const valid = rows.filter((_, i) => !hasError(i));
    const failed = rows.map((row, i) => ({ row, i })).filter(({ i }) => hasError(i)).map(({ row, i }) => ({
      ...row,
      row_number: i + 2,
      errors: Object.entries(issues[i]).filter(([, v]) => v.error).map(([k, v]) => `${k}: ${v.error}`).join('; '),
    }));
    const imported = onImport(valid);
    setSummary({ imported, failed, warnings: warnCount, refs: valid.length });
    setRows(null);
    toast.success(`${imported} row(s) imported${failed.length ? `, ${failed.length} with errors skipped` : ''}`);
  };
  const reset = () => { setRows(null); setSummary(null); setFileName(''); };

  const shown = rows?.map((row, i) => ({ row, i })).filter(({ i }) => !onlyProblems || hasError(i) || hasWarning(i)) || [];

  if (summary) {
    return (
      <Card title="Import summary">
        <div className="mb-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-primary-light p-3"><p className="text-2xl font-bold">{summary.imported}</p><p className="text-xs text-primary-dark">Imported</p></div>
          <div className="rounded-lg bg-gray-100 p-3"><p className="text-2xl font-bold">{summary.warnings}</p><p className="text-xs text-ink-muted">With warnings</p></div>
          <div className={clsx('rounded-lg p-3', summary.failed.length ? 'bg-danger-light' : 'bg-gray-100')}><p className={clsx('text-2xl font-bold', summary.failed.length && 'text-danger')}>{summary.failed.length}</p><p className="text-xs text-ink-muted">Skipped</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.failed.length > 0 && (
            <button type="button" className="btn-outline" onClick={() => { downloadText(`﻿${Papa.unparse(summary.failed)}`, `${def.template}-errors.csv`, 'text/csv'); toast.success('Error report downloaded'); }}>
              <Download size={15} aria-hidden /> Download error report
            </button>
          )}
          <button type="button" className="btn-primary" onClick={reset}><RotateCcw size={15} aria-hidden /> Import another file</button>
        </div>
      </Card>
    );
  }

  if (!rows) {
    return (
      <Card title={def.label} actions={<button type="button" className="btn-outline btn-sm" onClick={downloadTemplate}><Download size={13} aria-hidden /> Download sample template</button>}>
        <FileDropzone onFiles={onFile} accept=".csv,.xlsx,.xls" hint="Drag and drop your CSV or Excel file, or click to browse" />
        <p className="mt-3 text-xs text-ink-muted">Expected columns: <code className="break-words">{def.columns.map((c) => c.key).join(', ')}</code></p>
      </Card>
    );
  }

  return (
    <Card
      title={`Preview: ${fileName}`}
      bodyClass=""
      actions={(
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1 font-medium"><CheckCircle2 size={14} className="text-primary-dark" aria-hidden /> {validCount} valid</span>
          <span className="flex items-center gap-1 font-medium text-primary-dark"><AlertTriangle size={14} aria-hidden /> {warnCount} warnings</span>
          <span className="flex items-center gap-1 font-medium text-danger"><XCircle size={14} aria-hidden /> {errorCount} errors</span>
          <label className="flex items-center gap-1"><input type="checkbox" className="accent-primary-hover" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Problems only</label>
        </div>
      )}
    >
      <div className="scroll-thin max-h-[480px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-surface text-ink-muted">
            <tr>
              <th className="px-2 py-2 text-start font-medium">#</th>
              {def.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-2 text-start font-medium">{c.label}</th>)}
              <th className="px-2 py-2" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row, i }) => (
              <tr key={i} className={clsx('border-t border-line', hasError(i) ? 'bg-danger-light/60' : hasWarning(i) && 'bg-primary-light/60')}>
                <td className="px-2 py-1.5 text-ink-muted">{i + 2}</td>
                {def.columns.map((c) => {
                  const iss = issues[i]?.[c.key];
                  return (
                    <td key={c.key} className="px-1 py-1 align-top">
                      <input
                        aria-label={`Row ${i + 2} ${c.label}`}
                        aria-invalid={!!iss?.error}
                        value={row[c.key] ?? ''}
                        onChange={(e) => editCell(i, c.key, e.target.value)}
                        className={clsx('w-full min-w-[90px] rounded border bg-white px-1.5 py-1 text-xs', iss?.error ? 'border-danger' : iss?.warning ? 'border-primary-hover' : 'border-line')}
                      />
                      {iss && <p className={clsx('mt-0.5 max-w-[180px] text-[10px] font-medium', iss.error ? 'text-danger' : 'text-primary-dark')}>{iss.error || iss.warning}</p>}
                    </td>
                  );
                })}
                <td className="px-1 py-1"><button type="button" className="text-ink-muted hover:text-danger" onClick={() => removeRow(i)} aria-label={`Remove row ${i + 2}`}><XCircle size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-3">
        <button type="button" className="btn-outline" onClick={reset}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!validCount} onClick={run}><Upload size={15} aria-hidden /> Import {validCount} valid row(s)</button>
      </div>
    </Card>
  );
}

function LabelsAndExport() {
  const shipments = useScopedShipments();
  const [modal, setModal] = useState(false);
  const [text, setText] = useState('');
  const codes = useMemo(() => text.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean), [text]);
  const found = shipments.filter((s) => codes.includes(s.awb));
  const missing = codes.filter((c) => !found.some((s) => s.awb === c));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Bulk label print">
        <label htmlFor="awbs" className="label">AWB numbers (paste one per line, or comma separated)</label>
        <textarea id="awbs" rows={6} className="input font-mono" placeholder={'SLX100001\nSLX100002'} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-muted">{found.length} found{missing.length > 0 && <span className="text-danger">, {missing.length} not found: {missing.slice(0, 3).join(', ')}{missing.length > 3 ? '...' : ''}</span>}</p>
          <div className="flex gap-2">
            <button type="button" className="btn-outline btn-sm" onClick={() => setText(shipments.slice(0, 10).map((s) => s.awb).join('\n'))}>Use latest 10</button>
            <button type="button" className="btn-primary" disabled={!found.length} onClick={() => setModal(true)}><Printer size={15} aria-hidden /> Print {found.length}</button>
          </div>
        </div>
      </Card>
      <Card title="Export lists">
        <ExportList />
      </Card>
      <LabelPrintModal open={modal} rows={found} onClose={() => setModal(false)} />
    </div>
  );
}

function ExportList() {
  const user = useAuth((s) => s.user);
  const data = useData();
  const shipments = useScopedShipments();
  const lookups = useLookups();
  const defs = {
    Shipments: { rows: shipments, cols: [['AWB', (s) => s.awb], ['Status', (s) => s.status], ['Receiver', (s) => s.receiver.name], ['City', (s) => s.destCity], ['COD', (s) => s.cod], ['Currency', (s) => s.currency], ['Charges', (s) => s.charges.total], ['Booked', (s) => s.createdAt.slice(0, 10)]] },
    ...(user.role === 'merchant' ? {} : {
      Customers: { rows: data.merchants, cols: [['ID', (m) => m.id], ['Name', (m) => m.name], ['Type', (m) => m.type], ['City', (m) => m.city], ['Phone', (m) => m.phone], ['Status', (m) => m.status]] },
      Riders: { rows: data.riders, cols: [['ID', (r) => r.id], ['Name', (r) => r.name], ['Branch', (r) => lookups.branchName(r.branchId)], ['Zone', (r) => r.zone], ['Status', (r) => r.status]] },
    }),
  };
  const [list, setList] = useState('Shipments');
  const run = async (fn, label) => {
    const def = defs[list];
    const cols = def.cols.map(([header, value]) => ({ header, value }));
    await fn(def.rows, cols, list.toLowerCase());
    toast.success(`${list} exported to ${label}`);
  };
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="ex" className="label">List</label>
        <select id="ex" className="input" value={list} onChange={(e) => setList(e.target.value)}>{Object.keys(defs).map((k) => <option key={k}>{k}</option>)}</select>
      </div>
      <p className="text-xs text-ink-muted">{defs[list].rows.length} records. Every table in the app also has its own Export button, which respects filters.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-outline" onClick={() => run(exportCSV, 'CSV')}><FileSpreadsheet size={15} aria-hidden /> CSV</button>
        <button type="button" className="btn-outline" onClick={() => run(exportXLSX, 'Excel')}><FileSpreadsheet size={15} aria-hidden /> Excel</button>
        <button type="button" className="btn-outline" onClick={() => run((r, c, n) => exportPDF(r, c, n, list), 'PDF')}><FileSpreadsheet size={15} aria-hidden /> PDF</button>
      </div>
    </div>
  );
}

export function BulkCenter() {
  const user = useAuth((s) => s.user);
  const store = useData();
  const isMerchant = user.role === 'merchant';
  const [tab, setTab] = useState('booking');
  const [merchantId, setMerchantId] = useState(user.merchantId || '');
  const { merchantOptions } = useLookups();

  const importBooking = (rows) => {
    const merchant = store.merchants.find((m) => m.id === merchantId);
    let count = 0;
    rows.forEach((r) => {
      const dest = r.receiver_city.trim();
      const crossBorder = CITY_MAP[merchant.city].country !== CITY_MAP[dest].country;
      store.createShipment({
        merchantId,
        sender: { name: merchant.name, phone: merchant.phone, address: merchant.pickups[0]?.address || merchant.address, city: merchant.city },
        receiver: { name: r.receiver_name.trim(), phone: String(r.receiver_phone).trim(), address: r.receiver_address.trim(), city: dest },
        weight: Number(r.weight_kg), length: 0, width: 0, height: 0, declaredValue: Number(r.cod_amount) || 0,
        items: [{ name: r.item || 'General goods', qty: 1, value: Number(r.cod_amount) || 0 }],
        service: crossBorder ? 'international' : r.service.trim(), cod: Number(r.cod_amount) || 0, insurance: false, packaging: 'none', notes: 'Bulk import',
      });
      count += 1;
    });
    return count;
  };
  const importStatus = (rows) => {
    let count = 0;
    rows.forEach((r) => {
      const s = store.shipments.find((x) => x.awb === String(r.awb).trim());
      if (s) count += store.changeStatus(s.id, r.status, { note: r.note || 'Bulk update' }).ok;
    });
    return count;
  };
  const importCustomers = (rows) => {
    rows.forEach((r) => {
      const id = uid('M');
      const city = r.city.trim();
      store.addItem('merchants', {
        id, name: r.name.trim(), type: r.type.trim(), contact: r.contact.trim(), email: r.email.trim(), phone: String(r.phone).trim(), city,
        address: city, branchId: CITY_MAP[city].branchId, status: 'Active', kyc: 'Pending', kycDocs: [], bank: '', accountTitle: '', iban: '', creditLimit: 100000,
        rateCard: 'Standard', discountPct: 0, joinedAt: new Date().toISOString(), pickups: [], receivers: [], apiKey: `slx_live_${id.toLowerCase()}`,
      }, 'Customer', `${r.name} imported`);
    });
    return rows.length;
  };
  const importRates = (rows) => {
    const zones = store.rateCard.zones.map((z) => {
      const r = rows.find((x) => x.zone === z.id);
      return r ? { ...z, sameDay: Number(r.same_day), nextDay: Number(r.next_day), economy: Number(r.economy), international: Number(r.international) } : z;
    });
    store.setValue('rateCard', { ...store.rateCard, zones }, 'Rate Card', `${rows.length} zones imported`);
    return rows.length;
  };

  const tabs = [
    { value: 'booking', label: 'Bulk booking' },
    ...(isMerchant ? [] : [{ value: 'status', label: 'Status update' }, { value: 'customers', label: 'Customers' }]),
    ...(user.role === 'super_admin' ? [{ value: 'rates', label: 'Rate cards' }] : []),
    { value: 'labels', label: 'Labels & export' },
  ];

  return (
    <div>
      <PageHeader title="Bulk Import / Export" subtitle="Upload a file, fix problems right in the preview, then import the rows that pass." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'booking' && !isMerchant && (
        <div className="card mb-4 p-4">
          <label htmlFor="bm" className="label">Book on behalf of <span className="text-danger">*</span></label>
          <select id="bm" className="input sm:max-w-sm" value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
            <option value="">Select a merchant...</option>
            {merchantOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      {tab === 'booking' && (merchantId
        ? <ImportWizard key="booking" kind="booking" onImport={importBooking} />
        : <div className="card px-4 py-10 text-center text-sm text-ink-muted">Choose a merchant to start a bulk booking.</div>)}
      {tab === 'status' && <ImportWizard key="status" kind="status" onImport={importStatus} />}
      {tab === 'customers' && <ImportWizard key="customers" kind="customers" onImport={importCustomers} />}
      {tab === 'rates' && <ImportWizard key="rates" kind="rates" onImport={importRates} />}
      {tab === 'labels' && <LabelsAndExport />}
    </div>
  );
}

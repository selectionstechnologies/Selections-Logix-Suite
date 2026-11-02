import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, PackageCheck, Plus, RotateCcw, ScanLine, Undo2 } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, Drawer, FileDropzone, KV, Modal, PageHeader, StatCard, StatusBadge } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';
import { useBranchFilter, useLookups, useMoney } from '../../hooks/useApp.js';
import { STATUS } from '../../utils/status.js';
import { fmtCurrency, fmtDate, sum, toPKR, uid } from '../../utils/format.js';

export function ReturnsList() {
  const { money, compact } = useMoney();
  const lookups = useLookups();
  const { returnsList, shipments, updateItem, changeStatus } = useData();
  const rows = useBranchFilter(returnsList);
  const [code, setCode] = useState('');
  const [decide, setDecide] = useState(null);
  const input = useRef(null);
  const pending = rows.filter((r) => r.status === 'In Return');

  const scan = (e) => {
    e.preventDefault();
    const awb = code.trim().toUpperCase();
    const r = returnsList.find((x) => x.awb === awb);
    setCode('');
    input.current?.focus();
    if (!r) { toast.error(`${awb} is not on the returns list`); return; }
    const s = shipments.find((x) => x.id === r.shipmentId);
    if (s?.status === STATUS.RTO) changeStatus(s.id, STATUS.RETURNED, { note: 'Return scanned at origin hub' });
    if (r.decision) { toast.info(`${awb} was already decided: ${r.decision}`); return; }
    toast.success(`${awb} scanned in`);
    setDecide(r);
  };
  const applyDecision = (decision) => {
    const s = shipments.find((x) => x.id === decide.shipmentId);
    if (s?.status === STATUS.RTO) changeStatus(s.id, STATUS.RETURNED, { note: `Return closed: ${decision}` });
    updateItem('returnsList', decide.id, { decision, status: decision === 'Restock' ? 'Restocked' : 'Returned to Merchant' }, 'Return', `${decide.awb}: ${decision}`);
    toast.success(`${decide.awb}: ${decision.toLowerCase()}`);
    setDecide(null);
  };

  return (
    <div>
      <PageHeader title="Returns" subtitle="Scan returning parcels, then restock or send them back to the merchant." />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <StatCard label="Awaiting decision" value={pending.length} icon={RotateCcw} tone={pending.length ? 'danger' : 'default'} />
          <StatCard label="Return charges" value={compact(sum(rows, (r) => toPKR(r.charge, r.currency)))} hint={`${rows.length} returns`} icon={Undo2} />
        </div>
        <Card title="Return scan">
          <form onSubmit={scan} className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine size={16} className="absolute start-2.5 top-2.5 text-ink-muted" aria-hidden />
              <input ref={input} aria-label="AWB" className="input !ps-8 font-mono" placeholder="Scan AWB" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <button type="submit" className="btn-primary" disabled={!code.trim()}>Scan</button>
          </form>
          {pending[0] && <button type="button" className="chip mt-2 hover:bg-primary-light" onClick={() => setCode(pending[0].awb)}>Try {pending[0].awb}</button>}
        </Card>
      </div>
      <DataTable
        data={rows}
        exportName="returns"
        dateKey="date"
        filters={[{ key: 'status', label: 'Status', options: ['In Return', 'Restocked', 'Returned to Merchant'] }, { key: 'merchantId', label: 'Merchant', options: lookups.merchantOptions }]}
        columns={[
          { key: 'id', header: 'Return' },
          { key: 'awb', header: 'AWB', render: (r) => <Link className="link" to={`/shipments/${r.shipmentId}`}>{r.awb}</Link>, value: (r) => r.awb },
          { key: 'merchant', header: 'Merchant', value: (r) => lookups.merchantName(r.merchantId) },
          { key: 'reason', header: 'Reason' },
          { key: 'charge', header: 'Charge', align: 'right', value: (r) => toPKR(r.charge, r.currency), render: (r) => money(r.charge, r.currency) },
          { key: 'date', header: 'Date', render: (r) => fmtDate(r.date), exportValue: (r) => fmtDate(r.date) },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
          { key: 'act', header: '', sortable: false, export: false, render: (r) => !r.decision && <button type="button" className="btn-primary btn-sm" onClick={() => setDecide(r)}>Decide</button> },
        ]}
      />
      <Modal open={!!decide} onClose={() => setDecide(null)} title={`Return ${decide?.awb}`} size="sm" footer={<button type="button" className="btn-outline" onClick={() => setDecide(null)}>Later</button>}>
        <p className="mb-3 text-sm">Reason: <b>{decide?.reason}</b>. Return charge: <b>{decide && fmtCurrency(decide.charge, decide.currency)}</b>.</p>
        <div className="grid gap-2">
          <button type="button" className="btn-primary" onClick={() => applyDecision('Restock')}><PackageCheck size={15} aria-hidden /> Restock to warehouse</button>
          <button type="button" className="btn-outline" onClick={() => applyDecision('Return to Merchant')}><Undo2 size={15} aria-hidden /> Return to merchant</button>
        </div>
      </Modal>
    </div>
  );
}

const CLAIM_STATUS = ['New', 'Under Review', 'Approved', 'Rejected', 'Settled'];

export function Claims() {
  const { money } = useMoney();
  const lookups = useLookups();
  const { claims, shipments, addItem, updateItem } = useData();
  const [filing, setFiling] = useState(false);
  const [open, setOpen] = useState(null);
  const [approving, setApproving] = useState(false);
  const current = claims.find((c) => c.id === open);

  const setStatus = (c, status, patch = {}) => {
    updateItem('claims', c.id, { status, ...patch }, 'Claim', `${c.id} -> ${status}`);
    toast.success(`${c.id} ${status.toLowerCase()}`);
  };
  const addEvidence = (files) => {
    updateItem('claims', current.id, (c) => ({ evidence: [...c.evidence, ...files.map((f) => ({ name: f.name, size: `${Math.max(Math.round(f.size / 1024), 1)} KB` }))] }), 'Claim', `${current.id}: evidence added`);
    toast.success(`${files.length} file(s) attached`);
  };

  return (
    <div>
      <PageHeader title="Claims" subtitle="Lost or damaged parcels, evidence and compensation." actions={<button type="button" className="btn-primary" onClick={() => setFiling(true)}><Plus size={16} aria-hidden /> File claim</button>} />
      <DataTable
        data={claims}
        exportName="claims"
        dateKey="date"
        onRowClick={(c) => setOpen(c.id)}
        filters={[{ key: 'status', label: 'Status', options: CLAIM_STATUS }, { key: 'type', label: 'Type', options: ['Lost', 'Damaged'] }]}
        columns={[
          { key: 'id', header: 'Claim' },
          { key: 'awb', header: 'AWB' },
          { key: 'merchant', header: 'Merchant', value: (c) => lookups.merchantName(c.merchantId) },
          { key: 'type', header: 'Type' },
          { key: 'claimAmount', header: 'Claimed', align: 'right', value: (c) => toPKR(c.claimAmount, c.currency), render: (c) => money(c.claimAmount, c.currency) },
          { key: 'compensation', header: 'Compensation', align: 'right', value: (c) => toPKR(c.compensation, c.currency), render: (c) => (c.compensation ? money(c.compensation, c.currency) : '-') },
          { key: 'date', header: 'Filed', render: (c) => fmtDate(c.date), exportValue: (c) => fmtDate(c.date) },
          { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} />, value: (c) => c.status },
        ]}
      />
      {current && (
        <Drawer
          open
          onClose={() => setOpen(null)}
          title={`Claim ${current.id}`}
          footer={(
            <>
              {current.status === 'New' && <button type="button" className="btn-primary" onClick={() => setStatus(current, 'Under Review')}>Start review</button>}
              {current.status === 'Under Review' && <button type="button" className="btn-danger" onClick={() => setStatus(current, 'Rejected', { compensation: 0 })}>Reject</button>}
              {current.status === 'Under Review' && <button type="button" className="btn-primary" onClick={() => setApproving(true)}>Approve</button>}
              {current.status === 'Approved' && <button type="button" className="btn-primary" onClick={() => setStatus(current, 'Settled')}>Mark settled</button>}
            </>
          )}
        >
          <dl className="mb-4 grid grid-cols-2 gap-3">
            <KV label="Status"><StatusBadge status={current.status} /></KV>
            <KV label="Type">{current.type}</KV>
            <KV label="AWB"><Link className="link" to={`/shipments/${current.shipmentId}`}>{current.awb}</Link></KV>
            <KV label="Merchant">{lookups.merchantName(current.merchantId)}</KV>
            <KV label="Claimed">{fmtCurrency(current.claimAmount, current.currency)}</KV>
            <KV label="Compensation">{current.compensation ? fmtCurrency(current.compensation, current.currency) : '-'}</KV>
          </dl>
          <p className="mb-4 text-sm">{current.description}</p>
          <p className="label">Evidence</p>
          <ul className="mb-2 space-y-1">
            {current.evidence.map((e, i) => <li key={i} className="flex items-center gap-2 text-sm"><FileText size={14} className="text-ink-muted" aria-hidden /> <span className="flex-1 truncate">{e.name}</span> <span className="text-xs text-ink-muted">{e.size}</span></li>)}
            {!current.evidence.length && <li className="text-sm text-ink-muted">No evidence attached yet</li>}
          </ul>
          {!['Rejected', 'Settled'].includes(current.status) && <FileDropzone compact multiple onFiles={addEvidence} accept=".pdf,.jpg,.jpeg,.png" hint="Attach evidence" />}
        </Drawer>
      )}
      <FormModal
        open={approving}
        size="sm"
        onClose={() => setApproving(false)}
        title="Approve claim"
        submitLabel="Approve"
        fields={[{ name: 'compensation', label: `Compensation (${current?.currency})`, type: 'number', required: true, min: 0, max: current?.claimAmount, full: true, help: 'Cannot exceed the claimed amount.' }]}
        defaultValues={{ compensation: current?.claimAmount }}
        onSubmit={({ compensation }) => { setStatus(current, 'Approved', { compensation }); setApproving(false); }}
      />
      <FormModal
        open={filing}
        onClose={() => setFiling(false)}
        title="File a claim"
        fields={[
          { name: 'awb', label: 'AWB', required: true },
          { name: 'type', label: 'Type', type: 'select', options: ['Lost', 'Damaged'], required: true },
          { name: 'claimAmount', label: 'Claim amount', type: 'number', required: true, min: 1, help: "In the shipment's currency." },
          { name: 'description', label: 'What happened?', type: 'textarea', required: true, full: true },
        ]}
        onSubmit={(v) => {
          const awb = v.awb.trim().toUpperCase();
          const s = shipments.find((x) => x.awb === awb);
          if (!s) { toast.error(`${awb} was not found`); return; }
          const id = uid('CL');
          addItem('claims', { id, awb, shipmentId: s.id, merchantId: s.merchantId, type: v.type, description: v.description, claimAmount: v.claimAmount, compensation: 0, currency: s.currency, status: 'New', evidence: [], date: new Date().toISOString() }, 'Claim', `${id} filed for ${awb}`);
          setFiling(false);
          setOpen(id);
          toast.success(`${id} filed. Attach evidence next.`);
        }}
      />
    </div>
  );
}

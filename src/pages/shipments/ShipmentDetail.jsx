import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, CalendarClock, ExternalLink, FileText, MessageSquarePlus, Pencil, Printer, RotateCcw, Truck, RefreshCw } from 'lucide-react';
import { Card, KV, Modal, PageHeader, Stepper, StatusBadge, Timeline } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { RecordNotFound } from '../../components/layout/Fallbacks.jsx';
import { AirwayBill, DeliveryReceipt, PickupReceipt, PrintPreview, ReturnSlip } from '../../components/print/index.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useLookups, useMoney, useScopedShipments } from '../../hooks/useApp.js';
import { HAPPY_PATH, NEXT_STATUS, STATUS, isDelayed } from '../../utils/status.js';
import { serviceLabel, PACKAGING, paymentMethodLabel, paymentTypeLabel, productTypeLabel } from '../../utils/pricing.js';
import { fmtCurrency, fmtDate, fmtDateTime, maskNationalId } from '../../utils/format.js';
import { AssignRiderModal, LabelPrintModal } from './ShipmentList.jsx';

const DOCS = [
  ['awb', 'Airway Bill', AirwayBill, 'a4'],
  ['pickup', 'Pickup Receipt', PickupReceipt, 'a5'],
  ['pod', 'Delivery Receipt / POD', DeliveryReceipt, 'a5'],
  ['return', 'Return Slip', ReturnSlip, 'a5'],
];

const CHARGE_LINES = [['base', 'Base freight'], ['weight', 'Extra weight'], ['fuel', 'Fuel surcharge'], ['remote', 'Remote area'], ['codFee', 'COD fee'], ['insurance', 'Insurance'], ['packaging', 'Packaging'], ['tax', 'Tax']];

function StatusModal({ shipment: s, open, onClose }) {
  const changeStatus = useData((st) => st.changeStatus);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const options = NEXT_STATUS[s.status] || [];
  const save = () => {
    const { ok } = changeStatus(s.id, status, { note: note || status });
    toast[ok ? 'success' : 'error'](ok ? `Status updated to ${status}` : 'That status change is not allowed');
    setStatus(''); setNote('');
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Update status" size="sm" footer={<><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={!status} onClick={save}>Update</button></>}>
      <label htmlFor="st" className="label">Next status</label>
      <select id="st" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Select...</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
      <label htmlFor="stn" className="label mt-3">Note</label>
      <input id="stn" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

export function ShipmentDetail() {
  const { id } = useParams();
  const { money } = useMoney();
  const user = useAuth((st) => st.user);
  const scoped = useScopedShipments();
  const allShipments = useData((st) => st.shipments);
  const { changeStatus, updateItem, addShipmentNote, codTransactions, returnsList } = useData();
  const lookups = useLookups();
  // Internal users may follow a link to any shipment, even outside the current branch filter.
  const s = user.role === 'merchant' ? scoped.find((x) => x.id === id) : allShipments.find((x) => x.id === id);
  const [modal, setModal] = useState(null);
  const [doc, setDoc] = useState(null);
  const [note, setNote] = useState('');
  const txn = useMemo(() => codTransactions.find((t) => t.shipmentId === id), [codTransactions, id]);

  if (!s) return <RecordNotFound what="Shipment" backTo="/shipments" backLabel="Back to shipments" />;

  const isMerchant = user.role === 'merchant';
  const staff = ['super_admin', 'branch_manager'].includes(user.role);
  const options = NEXT_STATUS[s.status] || [];
  const canCancel = options.includes(STATUS.CANCELLED) && !['warehouse'].includes(user.role);
  const canReturn = options.includes(STATUS.RTO);
  const stepIdx = HAPPY_PATH.indexOf(s.status);
  const lastHappy = stepIdx >= 0 ? stepIdx : [...s.events].reverse().map((e) => HAPPY_PATH.indexOf(e.status)).find((i) => i >= 0) ?? 0;
  const off = stepIdx < 0;
  const editable = s.status === STATUS.BOOKED || (staff && options.length > 0);
  const merchant = lookups.merchant(s.merchantId);
  const rtoRecord = returnsList.find((r) => r.shipmentId === s.id);

  const cancel = async () => {
    if (await confirm({ title: 'Cancel this shipment?', message: `${s.awb} will be cancelled and its COD removed. This cannot be undone.`, confirmLabel: 'Cancel shipment' })) {
      changeStatus(s.id, STATUS.CANCELLED, { note: 'Cancelled by user' });
      toast.success(`${s.awb} cancelled`);
    }
  };
  const startReturn = async () => {
    if (await confirm({ title: 'Return to origin?', message: `${s.awb} will stop delivery attempts and go back to ${s.originCity}. Return charges may apply.`, confirmLabel: 'Start return' })) {
      changeStatus(s.id, STATUS.RTO, { note: 'Return initiated' });
      toast.success(`${s.awb} is returning to origin`);
    }
  };
  const addNote = () => {
    if (!note.trim()) return;
    addShipmentNote(s.id, note.trim());
    setNote('');
    toast.success('Note added');
  };

  const docEntry = doc && DOCS.find((d) => d[0] === doc);
  const DocView = docEntry?.[2];

  return (
    <div>
      <PageHeader
        title={s.awb}
        subtitle={`${s.originCity} to ${s.destCity} - ${serviceLabel(s.service)} - booked ${fmtDateTime(s.createdAt)}`}
        actions={(
          <>
            <button type="button" className="btn-outline" onClick={() => setModal('label')}><Printer size={15} aria-hidden /> Label</button>
            {editable && <button type="button" className="btn-outline" onClick={() => setModal('edit')}><Pencil size={15} aria-hidden /> Edit</button>}
            {staff && options.length > 0 && <button type="button" className="btn-outline" onClick={() => setModal('rider')}><Truck size={15} aria-hidden /> Reassign</button>}
            {staff && options.length > 0 && <button type="button" className="btn-outline" onClick={() => setModal('reschedule')}><CalendarClock size={15} aria-hidden /> Reschedule</button>}
            {staff && options.length > 0 && <button type="button" className="btn-primary" onClick={() => setModal('status')}><RefreshCw size={15} aria-hidden /> Update status</button>}
            {staff && canReturn && <button type="button" className="btn-danger" onClick={startReturn}><RotateCcw size={15} aria-hidden /> Return</button>}
            {canCancel && <button type="button" className="btn-danger" onClick={cancel}><Ban size={15} aria-hidden /> Cancel</button>}
          </>
        )}
      />

      <div className="card mb-4 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={s.status} />
          {isDelayed(s) && <span className="rounded bg-danger px-2 py-0.5 text-xs font-bold text-white">Delayed: ETA was {fmtDate(s.eta)}</span>}
          {!isDelayed(s) && <span className="text-xs text-ink-muted">ETA {fmtDate(s.eta)}</span>}
        </div>
        <Stepper steps={HAPPY_PATH} current={s.status === STATUS.DELIVERED ? HAPPY_PATH.length : off ? lastHappy + 1 : lastHappy} failed={off} />
        {off && s.ndr && <p className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm text-danger-dark">Exception: {s.ndr.reason} (attempts: {s.ndr.attempts}{s.ndr.nextAttempt ? `, next ${fmtDate(s.ndr.nextAttempt)}` : ''})</p>}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Summary">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <KV label="Sender"><span className="block">{s.sender.name}</span><span className="block text-xs font-normal text-ink-muted">{s.sender.address}<br />{s.sender.phone}</span></KV>
              <KV label="Receiver">
                <span className="block">{s.receiver.name}</span>
                <span className="block text-xs font-normal text-ink-muted">
                  {s.receiver.address}{s.receiver.landmark ? ` (near ${s.receiver.landmark})` : ''}, {s.receiver.city}<br />
                  {s.receiver.zone && <>{s.receiver.zone}{s.receiver.region ? `, ${s.receiver.region}` : ''}<br /></>}
                  {s.receiver.phone}{s.receiver.altPhone ? ` / ${s.receiver.altPhone}` : ''}
                  {s.receiver.cnic && <><br />ID {maskNationalId(s.receiver.cnic)}</>}
                </span>
              </KV>
              <KV label="Merchant">{isMerchant ? merchant?.name : <Link className="link" to={`/customers/${s.merchantId}`}>{merchant?.name}</Link>}</KV>
              <KV label="Courier">{s.courier}</KV>
              <KV label="Service">{serviceLabel(s.service)}</KV>
              <KV label="Zone">{s.zone}</KV>
              <KV label="Payment">
                <span className="block">{paymentTypeLabel(s.paymentType || (s.cod > 0 ? 'cod' : 'prepaid'))}</span>
                {s.payment && s.payment.method !== 'topay' && <span className="block text-xs font-normal text-ink-muted">{paymentMethodLabel(s.payment.method)}{s.payment.reference ? ` - ${s.payment.channel} ${s.payment.reference}` : ''}</span>}
                {s.toPay > 0 && <span className="block text-xs font-semibold text-danger">Collect {fmtCurrency(s.toPay, s.currency)} at delivery</span>}
              </KV>
            </dl>
            {s.notes && <p className="mt-3 rounded-lg bg-primary-light px-3 py-2 text-sm">Note: {s.notes}</p>}
          </Card>

          <Card title="Parcel and items">
            <dl className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <KV label="Product type">{productTypeLabel(s.productType)}</KV>
              <KV label="Pieces">{s.parcel.pieces}</KV>
              <KV label="Weight">{s.parcel.weight} kg</KV>
              <KV label="Chargeable">{s.chargeableWeight} kg</KV>
              <KV label="Dimensions">{s.parcel.length} x {s.parcel.width} x {s.parcel.height} cm</KV>
              <KV label="Packaging">{PACKAGING.find((p) => p.value === s.parcel.packaging)?.label}</KV>
              <KV label="Declared value">{fmtCurrency(s.parcel.declaredValue, s.currency)}</KV>
              <KV label="Insurance">{s.parcel.insurance ? 'Insured' : 'Not insured'}</KV>
            </dl>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-xs text-ink-muted"><tr><th className="px-3 py-2 text-start font-medium">Product</th><th className="px-3 py-2 text-end font-medium">Qty</th><th className="px-3 py-2 text-end font-medium">Unit price</th><th className="px-3 py-2 text-end font-medium">Total</th></tr></thead>
                <tbody>
                  {s.parcel.items.map((i, idx) => (
                    <tr key={idx} className="border-t border-line">
                      <td className="px-3 py-2">{i.name}{(i.sku || i.hsCode) && <span className="block text-xs text-ink-muted">{[i.sku && `SKU ${i.sku}`, i.hsCode && `HS ${i.hsCode}`].filter(Boolean).join(' - ')}</span>}</td>
                      <td className="px-3 py-2 text-end">{i.qty} {i.unit || ''}</td>
                      <td className="px-3 py-2 text-end">{fmtCurrency(i.value, s.currency)}</td>
                      <td className="px-3 py-2 text-end">{fmtCurrency(i.qty * i.value, s.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Activity log">
            <div className="mb-3 flex gap-2">
              <input aria-label="Add note" className="input" placeholder="Add a note..." value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }} />
              <button type="button" className="btn-primary" onClick={addNote} disabled={!note.trim()}><MessageSquarePlus size={15} aria-hidden /> Add</button>
            </div>
            <ul className="space-y-2">
              {[...s.activity].reverse().map((a, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-line pb-2 text-sm last:border-0">
                  <span>{a.text}</span>
                  <span className="text-xs text-ink-muted">{a.by} - {fmtDateTime(a.at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Tracking timeline" actions={<a href={`/track/${s.awb}`} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-xs">Public page <ExternalLink size={12} aria-hidden /></a>}>
            <Timeline events={s.events} />
          </Card>

          <Card title="Charges">
            {CHARGE_LINES.filter(([k]) => s.charges[k]).map(([k, label]) => (
              <div key={k} className="flex justify-between py-1 text-sm"><span className="text-ink-muted">{label}</span><span className="tabular-nums">{money(s.charges[k], s.currency)}</span></div>
            ))}
            <div className="mt-1 flex justify-between border-t border-line pt-2 font-bold"><span>Total</span><span className="tabular-nums">{money(s.charges.total, s.currency)}</span></div>
          </Card>

          <Card title="COD status">
            {s.cod > 0 ? (
              <dl className="grid grid-cols-2 gap-3">
                <KV label="Amount"><span className="text-danger">{fmtCurrency(s.cod, s.currency)}</span></KV>
                <KV label="Status"><StatusBadge status={s.codStatus} /></KV>
                {txn && <KV label="Transaction">{txn.id}</KV>}
                {txn && <KV label="Collected">{fmtDate(txn.collectedAt)}</KV>}
              </dl>
            ) : <p className="text-sm text-ink-muted">No COD on this shipment.</p>}
          </Card>

          <Card title="Rider and branch">
            <dl className="grid grid-cols-2 gap-3">
              <KV label="Delivery rider">{s.riderId ? (isMerchant ? lookups.riderName(s.riderId) : <Link className="link" to={`/riders/${s.riderId}`}>{lookups.riderName(s.riderId)}</Link>) : 'Unassigned'}</KV>
              <KV label="Pickup rider">{s.pickupRiderId ? lookups.riderName(s.pickupRiderId) : 'Unassigned'}</KV>
              <KV label="Origin branch">{lookups.branchName(s.originBranchId)}</KV>
              <KV label="Destination branch">{lookups.branchName(s.destBranchId)}</KV>
              {s.manifestId && <KV label="Manifest">{s.manifestId}</KV>}
              {rtoRecord && <KV label="Return record">{rtoRecord.id}</KV>}
            </dl>
          </Card>

          <Card title="Documents">
            <div className="flex flex-col gap-1.5">
              <button type="button" className="btn-outline justify-start" onClick={() => setModal('label')}><FileText size={15} aria-hidden /> Shipping Label</button>
              {DOCS.map(([key, label]) => <button key={key} type="button" className="btn-outline justify-start" onClick={() => setDoc(key)}><FileText size={15} aria-hidden /> {label}</button>)}
            </div>
          </Card>
        </div>
      </div>

      <LabelPrintModal open={modal === 'label'} rows={[s]} onClose={() => setModal(null)} />
      <AssignRiderModal open={modal === 'rider'} rows={[s]} onClose={() => setModal(null)} />
      <StatusModal shipment={s} open={modal === 'status'} onClose={() => setModal(null)} />
      <FormModal
        open={modal === 'reschedule'}
        onClose={() => setModal(null)}
        title="Reschedule delivery"
        submitLabel="Reschedule"
        fields={[{ name: 'date', label: 'New date', type: 'date', required: true, full: true }]}
        defaultValues={{ date: '' }}
        onSubmit={({ date }) => {
          updateItem('shipments', s.id, { eta: new Date(date).toISOString() }, 'Shipment', `${s.awb} rescheduled to ${date}`);
          addShipmentNote(s.id, `Rescheduled to ${date}`);
          toast.success(`Rescheduled to ${fmtDate(date)}`);
          setModal(null);
        }}
      />
      <FormModal
        open={modal === 'edit'}
        onClose={() => setModal(null)}
        title={`Edit ${s.awb}`}
        fields={[
          { name: 'name', label: 'Receiver name', required: true },
          { name: 'phone', label: 'Receiver phone', required: true, pattern: /^\+?[0-9][0-9\s-]{8,16}$/, patternMessage: 'Enter a valid phone number' },
          { name: 'address', label: 'Address', required: true, full: true },
          { name: 'notes', label: 'Notes', type: 'textarea', full: true },
        ]}
        defaultValues={{ ...s.receiver, notes: s.notes }}
        onSubmit={({ notes, name, phone, address }) => {
          updateItem('shipments', s.id, (x) => ({ receiver: { ...x.receiver, name, phone, address }, notes }), 'Shipment', `${s.awb} details edited`);
          addShipmentNote(s.id, 'Receiver details edited');
          toast.success('Shipment updated');
          setModal(null);
        }}
      />
      {docEntry && (
        <PrintPreview open onClose={() => setDoc(null)} title={docEntry[1]} filename={`${docEntry[0]}-${s.awb}`} size={docEntry[3]} onPrint={() => useData.getState().logPrint(docEntry[1], [s.awb], docEntry[3])}>
          <DocView shipment={s} />
        </PrintPreview>
      )}
    </div>
  );
}

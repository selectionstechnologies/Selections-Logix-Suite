import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PackagePlus, Printer, Truck, XCircle, RefreshCw } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Modal, PageHeader } from '../../components/ui/index.jsx';
import { PrintPreview, ShippingLabel } from '../../components/print/index.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useLookups, useMoney, useScopedShipments } from '../../hooks/useApp.js';
import { CITY_NAMES } from '../../data/geo.js';
import { COURIER_NAMES } from '../../data/config.js';
import { NEXT_STATUS, SHIPMENT_STATUSES, STATUS } from '../../utils/status.js';
import { SERVICES } from '../../utils/pricing.js';
import { shipmentColumns } from './columns.jsx';

/** Bulk status dialog: offers only statuses at least one selected parcel can legally move to. */
export function BulkStatusModal({ open, onClose, rows, onDone }) {
  const changeStatus = useData((s) => s.changeStatus);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const options = useMemo(() => [...new Set(rows.flatMap((s) => NEXT_STATUS[s.status] || []))], [rows]);
  const eligible = rows.filter((s) => NEXT_STATUS[s.status]?.includes(status)).length;
  const apply = async () => {
    try {
      const { ok, skipped } = await changeStatus(rows.map((s) => s.id), status, { note: note || status });
      toast[ok ? 'success' : 'error'](`${ok} updated to ${status}${skipped ? `, ${skipped} skipped (not a valid next step or not allowed)` : ''}`);
      setStatus(''); setNote('');
      onDone?.();
      onClose();
    } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Change status (${rows.length} selected)`}
      size="sm"
      footer={<><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={!status} onClick={apply}>Apply</button></>}
    >
      {options.length === 0 ? <p className="text-sm text-ink-muted">These parcels are in a final state, so no further status is possible.</p> : (
        <div className="space-y-3">
          <div>
            <label htmlFor="bs" className="label">New status</label>
            <select id="bs" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Select...</option>
              {options.map((o) => <option key={o}>{o}</option>)}
            </select>
            {status && <p className="mt-1 text-xs text-ink-muted">{eligible} of {rows.length} can move to this status. The rest will be skipped.</p>}
          </div>
          <div><label htmlFor="bn" className="label">Note (optional)</label><input id="bn" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
      )}
    </Modal>
  );
}

export function AssignRiderModal({ open, onClose, rows, onDone }) {
  const riders = useData((s) => s.riders);
  const assignRider = useData((s) => s.assignRider);
  const [riderId, setRiderId] = useState('');
  // Offer riders from the branch handling the parcels, falling back to everyone on mixed selections.
  const branches = [...new Set(rows.map((s) => (s.status === STATUS.BOOKED ? s.originBranchId : s.destBranchId)))];
  const pool = riders.filter((r) => r.status !== 'On Leave' && (branches.length !== 1 || r.branchId === branches[0]));
  const apply = async () => {
    try {
      await assignRider(rows.map((s) => s.id), riderId);
      toast.success(`${rows.length} parcel(s) assigned to ${riders.find((r) => r.id === riderId)?.name}`);
      setRiderId('');
      onDone?.();
      onClose();
    } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assign rider (${rows.length} selected)`}
      size="sm"
      footer={<><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={!riderId} onClick={apply}>Assign</button></>}
    >
      <label htmlFor="ar" className="label">Rider</label>
      <select id="ar" className="input" value={riderId} onChange={(e) => setRiderId(e.target.value)}>
        <option value="">Select...</option>
        {pool.map((r) => <option key={r.id} value={r.id}>{r.name} - {r.zone}</option>)}
      </select>
    </Modal>
  );
}

export function LabelPrintModal({ open, onClose, rows }) {
  const logPrint = useData((s) => s.logPrint);
  const defaultSize = useData((s) => s.settings.labelFormat);
  const [size, setSize] = useState(defaultSize);
  return (
    <PrintPreview
      open={open}
      onClose={onClose}
      title={`Print ${rows.length} label(s)`}
      filename={rows.length === 1 ? `label-${rows[0].awb}` : `labels-${rows.length}`}
      size={size}
      onPrint={() => logPrint('Shipping Label', [...new Set(rows.map((r) => r.awb))], size)}
      extraActions={(
        <select aria-label="Label size" className="input me-auto !w-auto" value={size} onChange={(e) => setSize(e.target.value)}>
          <option value="4x6">4x6 Thermal</option><option value="a5">A5</option><option value="a4">A4</option>
        </select>
      )}
    >
      {rows.map((s) => <ShippingLabel key={`${s.id}-${s.pieceNo || 1}`} shipment={s} size={size} />)}
    </PrintPreview>
  );
}

export function ShipmentList() {
  const navigate = useNavigate();
  const { money } = useMoney();
  const lookups = useLookups();
  const user = useAuth((s) => s.user);
  const shipments = useScopedShipments();
  const changeStatus = useData((s) => s.changeStatus);
  const [modal, setModal] = useState(null); // { type, rows, clear }
  const isMerchant = user.role === 'merchant';
  const canManage = ['super_admin', 'branch_manager'].includes(user.role);

  const columns = useMemo(() => shipmentColumns({ money, lookups }).filter((c) => !(isMerchant && ['merchant', 'rider'].includes(c.key))), [money, lookups, isMerchant]);
  const filters = useMemo(() => [
    { key: 'status', label: 'Status', options: SHIPMENT_STATUSES },
    { key: 'service', label: 'Service', options: SERVICES.map((s) => ({ value: s.value, label: s.label })) },
    ...(isMerchant ? [] : [
      { key: 'branch', label: 'Branch', options: lookups.branchOptions, match: (s, v) => s.originBranchId === v || s.destBranchId === v },
      { key: 'merchantId', label: 'Merchant', options: lookups.merchantOptions },
    ]),
    { key: 'courier', label: 'Courier', options: COURIER_NAMES },
    { key: 'city', label: 'City', options: CITY_NAMES, match: (s, v) => s.destCity === v || s.originCity === v },
    { key: 'codType', label: 'COD', options: [{ value: 'cod', label: 'COD only' }, { value: 'noncod', label: 'Non-COD' }], match: (s, v) => (v === 'cod' ? s.cod > 0 : !s.cod) },
    { key: 'codStatus', label: 'Payment', options: ['Pending', 'Collected', 'Deposited', 'Reconciled', 'Paid', 'None'] },
  ], [isMerchant, lookups]);

  const cancel = async (rows, clear) => {
    const cancellable = rows.filter((s) => NEXT_STATUS[s.status]?.includes(STATUS.CANCELLED));
    if (!cancellable.length) { toast.error('None of the selected parcels can be cancelled. Only Booked or Picked Up parcels can.'); return; }
    const ok = await confirm({ title: 'Cancel shipments?', message: `Cancel ${cancellable.length} shipment(s)? ${rows.length - cancellable.length} further selected parcel(s) are past pickup and will be skipped. This cannot be undone.`, confirmLabel: 'Cancel shipments' });
    if (!ok) return;
    try {
      const res = await changeStatus(cancellable.map((s) => s.id), STATUS.CANCELLED, { note: 'Cancelled from shipment list' });
      toast.success(`${res.ok} shipment(s) cancelled`);
      clear();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader
        title="Shipments"
        subtitle={`${shipments.length} shipments in your view`}
        actions={user.role !== 'warehouse' && <Link to="/shipments/new" className="btn-primary"><PackagePlus size={16} aria-hidden /> Create Shipment</Link>}
      />
      <DataTable
        columns={columns}
        data={shipments}
        title={null}
        exportName="shipments"
        exportModule="shipments"
        searchPlaceholder="Search AWB, receiver, route..."
        filters={filters}
        dateKey="createdAt"
        selectable
        onRowClick={(s) => navigate(`/shipments/${s.id}`)}
        bulkActions={(rows, clear) => (
          <>
            <button type="button" className="btn-outline btn-sm" onClick={() => setModal({ type: 'labels', rows, clear })}><Printer size={13} aria-hidden /> Print labels</button>
            {canManage && <button type="button" className="btn-outline btn-sm" onClick={() => setModal({ type: 'rider', rows, clear })}><Truck size={13} aria-hidden /> Assign rider</button>}
            {canManage && <button type="button" className="btn-outline btn-sm" onClick={() => setModal({ type: 'status', rows, clear })}><RefreshCw size={13} aria-hidden /> Change status</button>}
            {user.role !== 'warehouse' && <button type="button" className="btn-danger btn-sm" onClick={() => cancel(rows, clear)}><XCircle size={13} aria-hidden /> Cancel</button>}
          </>
        )}
      />
      <LabelPrintModal open={modal?.type === 'labels'} rows={modal?.rows || []} onClose={() => setModal(null)} />
      <AssignRiderModal open={modal?.type === 'rider'} rows={modal?.rows || []} onDone={modal?.clear} onClose={() => setModal(null)} />
      <BulkStatusModal open={modal?.type === 'status'} rows={modal?.rows || []} onDone={modal?.clear} onClose={() => setModal(null)} />
    </div>
  );
}

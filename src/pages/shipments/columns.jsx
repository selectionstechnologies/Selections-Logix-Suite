import { Link } from 'react-router-dom';
import { StatusBadge } from '../../components/ui/index.jsx';
import { fmtDate } from '../../utils/format.js';
import { serviceLabel } from '../../utils/pricing.js';
import { isDelayed } from '../../utils/status.js';

/** Shared shipment columns so every embedded shipment table reads the same. */
export function shipmentColumns({ money, lookups, compact = false }) {
  const cols = [
    { key: 'awb', header: 'AWB', render: (s) => <Link className="link" onClick={(e) => e.stopPropagation()} to={`/shipments/${s.id}`}>{s.awb}</Link>, value: (s) => s.awb },
    { key: 'receiver', header: 'Receiver', value: (s) => s.receiver.name },
    { key: 'merchant', header: 'Merchant', value: (s) => lookups.merchantName(s.merchantId) },
    { key: 'route', header: 'Route', value: (s) => `${s.originCity} - ${s.destCity}` },
    { key: 'service', header: 'Service', value: (s) => serviceLabel(s.service), hidden: compact },
    { key: 'cod', header: 'COD', align: 'right', value: (s) => s.cod, render: (s) => (s.cod > 0 ? <span className="font-semibold text-danger-dark">{money(s.cod, s.currency)}</span> : '-'), exportValue: (s) => (s.cod > 0 ? `${s.currency} ${s.cod}` : '') },
    { key: 'charges', header: 'Charges', align: 'right', value: (s) => s.charges.total, render: (s) => money(s.charges.total, s.currency), hidden: compact },
    { key: 'status', header: 'Status', value: (s) => s.status, render: (s) => (
      <span className="flex items-center gap-1.5">
        <StatusBadge status={s.status} />
        {isDelayed(s) && <span className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">LATE</span>}
      </span>
    ) },
    { key: 'rider', header: 'Rider', value: (s) => (s.riderId ? lookups.riderName(s.riderId) : 'Unassigned'), hidden: compact },
    { key: 'created', header: 'Booked', value: (s) => s.createdAt, render: (s) => fmtDate(s.createdAt), exportValue: (s) => fmtDate(s.createdAt) },
  ];
  return cols;
}

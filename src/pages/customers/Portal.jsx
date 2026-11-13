// Merchant self-service. Staff opening these screens preview the first customer account.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Eye, HandCoins } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { PageHeader, StatCard, StatusBadge } from '../../components/ui/index.jsx';

import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useMoney } from '../../hooks/useApp.js';
import { merchantStats } from '../../data/helpers.js';
import { fmtDate, toPKR, sum } from '../../utils/format.js';

// A merchant sees their own account; staff previewing the portal see the first customer.
function useMerchantId() {
  const user = useAuth((s) => s.user);
  const firstId = useData((s) => s.merchants[0]?.id);
  return user.role === 'merchant' ? user.merchantId : firstId;
}

function PreviewNote() {
  const user = useAuth((s) => s.user);
  const merchants = useData((s) => s.merchants);
  if (user.role === 'merchant') return null;
  return (
    <p className="mb-4 flex items-center gap-2 rounded-lg bg-primary-light px-3 py-2 text-sm">
      <Eye size={15} aria-hidden /> Previewing the merchant portal as {merchants[0]?.name}.
    </p>
  );
}

export function PortalCod() {
  const merchantId = useMerchantId();
  const { money, compact } = useMoney();
  const { shipments, codTransactions, payouts } = useData();
  const stats = useMemo(() => merchantStats(merchantId, shipments, codTransactions, payouts), [merchantId, shipments, codTransactions, payouts]);
  const upcoming = sum(shipments.filter((s) => s.merchantId === merchantId && s.codStatus === 'Pending'), (s) => toPKR(s.cod, s.currency));
  return (
    <div>
      <PreviewNote />
      <PageHeader title="COD Ledger" subtitle="Every cash-on-delivery parcel, from collection to payout." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Awaiting delivery" value={compact(upcoming)} />
        <StatCard label="In collection" value={compact(stats.inTransit)} hint="With riders or being deposited" />
        <StatCard label="Payable" value={compact(stats.payable)} hint="Reconciled, ready for payout" />
        <StatCard label="Paid out" value={compact(stats.paid)} />
      </div>
      <DataTable
        data={stats.txns}
        exportName="cod-ledger"
        filters={[{ key: 'status', label: 'Status', options: ['Collected', 'Deposited', 'Reconciled', 'Paid'] }]}
        dateKey="collectedAt"
        columns={[
          { key: 'id', header: 'Txn' },
          { key: 'awb', header: 'AWB', render: (t) => <Link className="link" to={`/shipments/${t.shipmentId}`}>{t.awb}</Link>, value: (t) => t.awb },
          { key: 'amount', header: 'Amount', align: 'right', render: (t) => money(t.amount, t.currency) },
          { key: 'collectedAt', header: 'Collected', render: (t) => fmtDate(t.collectedAt), exportValue: (t) => fmtDate(t.collectedAt) },
          { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} />, value: (t) => t.status },
        ]}
      />
    </div>
  );
}

export function PortalPayouts() {
  const merchantId = useMerchantId();
  const { money } = useMoney();
  const { payouts, createPayout, payableTxns } = useData();
  const mine = payouts.filter((p) => p.merchantId === merchantId);
  const due = payableTxns(merchantId);
  const dueAmount = sum(due, (t) => toPKR(t.amount, t.currency));
  const request = async () => {
    if (await confirm({ title: 'Request payout?', danger: false, confirmLabel: 'Request payout', message: `Request a payout for ${due.length} reconciled parcel(s), ${money(dueAmount)} before shipping and COD fee deductions.` })) {
      try {
        const po = await createPayout(merchantId);
        toast[po ? 'success' : 'error'](po ? `Payout requested for ${money(po.net)} net` : 'Nothing is payable right now');
      } catch (e) { toast.error(e.message); }
    }
  };
  return (
    <div>
      <PreviewNote />
      <PageHeader
        title="Payouts"
        subtitle="Payouts are net of shipping, COD fees and return charges."
        actions={<button type="button" className="btn-primary" onClick={request} disabled={!due.length}><HandCoins size={16} aria-hidden /> Request payout {due.length > 0 && `(${money(dueAmount)})`}</button>}
      />
      {!due.length && <p className="mb-4 text-sm text-ink-muted">Nothing is payable right now. COD becomes payable once rider cash has been reconciled and it is not already in a payout.</p>}
      <DataTable
        data={mine}
        exportName="payouts"
        emptyTitle="No payouts yet"
        columns={[
          { key: 'id', header: 'Payout' },
          { key: 'shipments', header: 'Parcels', align: 'right' },
          { key: 'gross', header: 'Gross COD', align: 'right', render: (p) => money(p.gross) },
          { key: 'shipping', header: 'Shipping', align: 'right', render: (p) => money(p.shipping) },
          { key: 'codFee', header: 'COD fee', align: 'right', render: (p) => money(p.codFee) },
          { key: 'returns', header: 'Returns', align: 'right', render: (p) => money(p.returns) },
          { key: 'net', header: 'Net', align: 'right', render: (p) => <b className={p.net < 0 ? 'text-danger' : ''}>{money(p.net)}</b> },
          { key: 'createdAt', header: 'Created', render: (p) => fmtDate(p.createdAt), exportValue: (p) => fmtDate(p.createdAt) },
          { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} />, value: (p) => p.status },
        ]}
      />
    </div>
  );
}


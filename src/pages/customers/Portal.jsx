// Merchant self-service. Admins opening these screens preview the first demo merchant.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Eye, HandCoins, KeyRound, Plug, Plus, RefreshCw, Store } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, PageHeader, StatCard, StatusBadge } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useMoney } from '../../hooks/useApp.js';
import { invoiceBalance, merchantStats } from '../../data/helpers.js';
import { fmtDate, fmtDateTime, toPKR, sum, uid } from '../../utils/format.js';
import { AddressBook } from './index.jsx';

function useMerchantId() {
  const user = useAuth((s) => s.user);
  return user.merchantId || 'M001';
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
  const { shipments, codTransactions, payouts, invoices } = useData();
  const stats = useMemo(() => merchantStats(merchantId, shipments, codTransactions, payouts, invoices), [merchantId, shipments, codTransactions, payouts, invoices]);
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
      const po = createPayout(merchantId);
      toast[po ? 'success' : 'error'](po ? `${po.id} requested for ${money(po.net)} net` : 'Nothing is payable right now');
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

export function PortalInvoices() {
  const merchantId = useMerchantId();
  const navigate = useNavigate();
  const { money } = useMoney();
  const invoices = useData((s) => s.invoices);
  // A merchant never sees an invoice still being drafted.
  const mine = invoices.filter((i) => i.merchantId === merchantId && i.status !== 'Draft');
  return (
    <div>
      <PreviewNote />
      <PageHeader title="My Invoices" subtitle="Open an invoice to view, print or download it." />
      <DataTable
        data={mine}
        exportName="invoices"
        onRowClick={(i) => navigate(`/portal/invoices/${i.id}`)}
        emptyTitle="No invoices yet"
        rowClass={(i) => (i.status === 'Overdue' ? 'bg-danger-light/40' : '')}
        columns={[
          { key: 'number', header: 'Invoice' },
          { key: 'issueDate', header: 'Issued', render: (i) => fmtDate(i.issueDate), exportValue: (i) => fmtDate(i.issueDate) },
          { key: 'dueDate', header: 'Due', render: (i) => fmtDate(i.dueDate), exportValue: (i) => fmtDate(i.dueDate) },
          { key: 'total', header: 'Total', align: 'right', render: (i) => money(i.total) },
          { key: 'bal', header: 'Balance', align: 'right', value: invoiceBalance, render: (i) => money(invoiceBalance(i)) },
          { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} />, value: (i) => i.status },
        ]}
      />
    </div>
  );
}

export function PortalTickets() {
  const merchantId = useMerchantId();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const { tickets, shipments, merchants, addItem } = useData();
  const [adding, setAdding] = useState(false);
  const mine = tickets.filter((t) => t.merchantId === merchantId);
  const merchant = merchants.find((m) => m.id === merchantId);
  return (
    <div>
      <PreviewNote />
      <PageHeader title="My Tickets" subtitle="Questions or problems about a shipment, COD or an invoice." actions={<button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> Raise ticket</button>} />
      <DataTable
        data={mine}
        exportName="tickets"
        onRowClick={(t) => navigate(`/portal/tickets/${t.id}`)}
        emptyTitle="No tickets yet"
        columns={[
          { key: 'id', header: 'Ticket' },
          { key: 'subject', header: 'Subject' },
          { key: 'awb', header: 'AWB' },
          { key: 'priority', header: 'Priority', render: (t) => <StatusBadge status={t.priority} />, value: (t) => t.priority },
          { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} />, value: (t) => t.status },
          { key: 'createdAt', header: 'Opened', render: (t) => fmtDateTime(t.createdAt), exportValue: (t) => fmtDateTime(t.createdAt) },
        ]}
      />
      <FormModal
        open={adding}
        onClose={() => setAdding(false)}
        title="Raise a ticket"
        submitLabel="Submit ticket"
        fields={[
          { name: 'subject', label: 'Subject', required: true, full: true },
          { name: 'awb', label: 'AWB (optional)', placeholder: 'SLX100001' },
          { name: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Urgent'], required: true, default: 'Medium' },
          { name: 'message', label: 'Message', type: 'textarea', required: true, full: true },
        ]}
        onSubmit={(v) => {
          const code = v.awb.trim().toUpperCase();
          const s = shipments.find((x) => x.awb === code && x.merchantId === merchantId);
          if (code && !s) { toast.error(`${code} was not found on your account`); return; }
          const at = new Date().toISOString();
          const id = `TK-${Math.floor(10000 + Math.random() * 89999)}`;
          addItem('tickets', {
            id, subject: v.subject, awb: code, shipmentId: s?.id || null, merchantId, requester: user.role === 'merchant' ? user.name : merchant.contact,
            priority: v.priority, status: 'Open', assignee: 'Unassigned', createdAt: at, resolvedAt: null,
            replies: [{ id: 1, author: user.name, internal: false, at, text: v.message }],
          }, 'Ticket', `${id} raised`);
          setAdding(false);
          toast.success(`${id} submitted`);
        }}
      />
    </div>
  );
}

export function PortalIntegrations() {
  const merchantId = useMerchantId();
  const { merchants, updateItem, storeIntegrations } = useData();
  const m = merchants.find((x) => x.id === merchantId);
  const [revealed, setRevealed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.apiKey);
      toast.success('API key copied');
    } catch {
      toast.error('Could not copy. Reveal the key and copy it by hand.');
    }
  };
  const rotate = async () => {
    if (await confirm({ title: 'Regenerate API key?', message: 'The current key stops working immediately. Anything using it will need the new key.', confirmLabel: 'Regenerate' })) {
      updateItem('merchants', m.id, { apiKey: `slx_live_${uid('').replace('-', '').toLowerCase()}${Math.random().toString(36).slice(2, 10)}` }, 'Customer', `${m.name}: API key regenerated`);
      setRevealed(true);
      toast.success('New API key created');
    }
  };
  const toggle = (i) => {
    const status = i.status === 'Connected' ? 'Disconnected' : 'Connected';
    updateItem('storeIntegrations', i.id, { status }, 'Integration', `${i.name} ${status}`);
    toast.success(`${i.name} ${status.toLowerCase()} (placeholder, no live store)`);
  };
  return (
    <div>
      <PreviewNote />
      <PageHeader title="API & Integrations" subtitle="Connect your store or call the booking API." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="API key">
          <p className="mb-2 flex items-center gap-2 text-sm text-ink-muted"><KeyRound size={15} aria-hidden /> Keep this private. It is a demo value and calls no real service.</p>
          <code className="mb-3 block break-all rounded-lg bg-gray-100 px-3 py-2 text-sm">{revealed ? m.apiKey : `${m.apiKey.slice(0, 12)}${'•'.repeat(16)}`}</code>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline btn-sm" onClick={() => setRevealed((r) => !r)}><Eye size={13} aria-hidden /> {revealed ? 'Hide' : 'Reveal'}</button>
            <button type="button" className="btn-outline btn-sm" onClick={copy}><Copy size={13} aria-hidden /> Copy</button>
            <button type="button" className="btn-danger btn-sm" onClick={rotate}><RefreshCw size={13} aria-hidden /> Regenerate</button>
          </div>
        </Card>
        <Card title="Store integrations" bodyClass="">
          <ul className="divide-y divide-line">
            {storeIntegrations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <span className="rounded-lg bg-primary-light p-2 text-primary-dark"><Store size={17} aria-hidden /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{i.name}</span><span className="block truncate text-xs text-ink-muted">{i.desc}</span></span>
                <StatusBadge status={i.status} />
                <button type="button" className={i.status === 'Connected' ? 'btn-outline btn-sm' : 'btn-primary btn-sm'} onClick={() => toggle(i)}><Plug size={13} aria-hidden /> {i.status === 'Connected' ? 'Disconnect' : 'Connect'}</button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="mt-6"><AddressBook merchantId={merchantId} /></div>
    </div>
  );
}

import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CreditCard, FileMinus2, Plus, Printer, Send, Trash2, Wand2 } from 'lucide-react';
import { subDays, addDays } from 'date-fns';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, KV, PageHeader, StatCard, StatusBadge } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { RecordNotFound } from '../../components/layout/Fallbacks.jsx';
import { InvoiceDoc, PrintPreview } from '../../components/print/index.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useLookups, useMoney } from '../../hooks/useApp.js';
import { invoiceBalance } from '../../data/helpers.js';
import { fmtDate, fmtDateTime, isoDay, sum, toPKR, uid } from '../../utils/format.js';

/** Totals for a merchant and date range, from the live shipment list. */
function computeLines(shipments, merchantId, from, to) {
  const list = shipments.filter((s) => {
    const day = isoDay(s.createdAt);
    return s.merchantId === merchantId && s.status !== 'Cancelled' && day >= from && day <= to;
  });
  const freight = Math.round(sum(list, (s) => toPKR(s.charges.base + s.charges.weight + s.charges.fuel + s.charges.remote, s.currency)));
  const fees = Math.round(sum(list, (s) => toPKR(s.charges.codFee + s.charges.insurance + s.charges.packaging, s.currency)));
  const tax = Math.round(sum(list, (s) => toPKR(s.charges.tax, s.currency)));
  return {
    count: list.length,
    tax,
    lines: [
      { desc: `Freight & delivery charges (${list.length} shipments)`, qty: list.length, rate: list.length ? Math.round(freight / list.length) : 0, amount: freight },
      { desc: 'COD, insurance & packaging fees', qty: 1, rate: fees, amount: fees },
    ],
  };
}

export function InvoiceList() {
  const navigate = useNavigate();
  const { money, compact } = useMoney();
  const lookups = useLookups();
  const { invoices, shipments, settings, addItem, setValue, merchants } = useData();
  const [creating, setCreating] = useState(false);
  const [auto, setAuto] = useState(false);
  const open = invoices.filter((i) => !['Draft', 'Paid'].includes(i.status));
  const overdue = invoices.filter((i) => i.status === 'Overdue');

  const issue = (merchantId, from, to, dueDays, notes) => {
    const { lines, tax, count } = computeLines(shipments, merchantId, from, to);
    if (!count) return null;
    const store = useData.getState();
    const seq = store.settings.invoiceNext;
    const number = `${store.settings.invoicePrefix}${seq}`;
    const subtotal = lines[0].amount + lines[1].amount;
    const inv = {
      id: uid('INV'), number, merchantId, from: new Date(from).toISOString(), to: new Date(to).toISOString(), lines, subtotal, taxPct: store.settings.taxPct, tax, total: subtotal + tax,
      shipments: count, issueDate: new Date().toISOString(), dueDate: addDays(new Date(), Number(dueDays) || 15).toISOString(), status: 'Draft', payments: [], creditNotes: [], notes: notes || `Period ${from} to ${to}`,
    };
    addItem('invoices', inv, 'Invoice', `${number} created`);
    setValue('settings', { ...store.settings, invoiceNext: seq + 1 }, 'Settings', 'Invoice number advanced');
    return inv;
  };

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle={`Numbering continues from ${settings.invoicePrefix}${settings.invoiceNext}`}
        actions={<><button type="button" className="btn-outline" onClick={() => setAuto(true)}><Wand2 size={16} aria-hidden /> Auto-generate</button><button type="button" className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden /> New invoice</button></>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total invoiced" value={compact(sum(invoices.filter((i) => i.status !== 'Draft'), (i) => i.total))} />
        <StatCard label="Outstanding" value={compact(sum(open, invoiceBalance))} hint={`${open.length} open`} />
        <StatCard label="Overdue" value={compact(sum(overdue, invoiceBalance))} hint={`${overdue.length} invoices`} tone="danger" />
        <StatCard label="Drafts" value={invoices.filter((i) => i.status === 'Draft').length} />
      </div>
      <DataTable
        data={invoices}
        exportName="invoices"
        dateKey="issueDate"
        onRowClick={(i) => navigate(`/finance/invoices/${i.id}`)}
        rowClass={(i) => (i.status === 'Overdue' ? 'bg-danger-light/40' : '')}
        filters={[{ key: 'status', label: 'Status', options: ['Draft', 'Sent', 'Partial', 'Paid', 'Overdue'] }, { key: 'merchantId', label: 'Merchant', options: lookups.merchantOptions }]}
        columns={[
          { key: 'number', header: 'Invoice', render: (i) => <Link className="link" onClick={(e) => e.stopPropagation()} to={`/finance/invoices/${i.id}`}>{i.number}</Link>, value: (i) => i.number },
          { key: 'merchant', header: 'Merchant', value: (i) => lookups.merchantName(i.merchantId) },
          { key: 'shipments', header: 'Shipments', align: 'right' },
          { key: 'issueDate', header: 'Issued', render: (i) => fmtDate(i.issueDate), exportValue: (i) => fmtDate(i.issueDate) },
          { key: 'dueDate', header: 'Due', render: (i) => fmtDate(i.dueDate), exportValue: (i) => fmtDate(i.dueDate) },
          { key: 'total', header: 'Total', align: 'right', render: (i) => money(i.total) },
          { key: 'bal', header: 'Balance', align: 'right', value: invoiceBalance, render: (i) => money(invoiceBalance(i)) },
          { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} />, value: (i) => i.status },
        ]}
      />
      <FormModal
        open={creating}
        onClose={() => setCreating(false)}
        title="New invoice"
        submitLabel="Create draft"
        fields={[
          { name: 'merchantId', label: 'Merchant', type: 'select', options: lookups.merchantOptions, required: true, full: true },
          { name: 'from', label: 'From', type: 'date', required: true },
          { name: 'to', label: 'To', type: 'date', required: true },
          { name: 'dueDays', label: 'Payment terms (days)', type: 'number', min: 0, default: 15 },
          { name: 'notes', label: 'Notes' },
        ]}
        defaultValues={{ from: isoDay(subDays(new Date(), 30)), to: isoDay(new Date()), dueDays: 15 }}
        onSubmit={(v) => {
          if (v.from > v.to) { toast.error('The From date must be before the To date'); return; }
          const inv = issue(v.merchantId, v.from, v.to, v.dueDays, v.notes);
          if (!inv) { toast.error('This merchant has no billable shipments in that period'); return; }
          setCreating(false);
          toast.success(`${inv.number} created as a draft`);
          navigate(`/finance/invoices/${inv.id}`);
        }}
      />
      <FormModal
        open={auto}
        onClose={() => setAuto(false)}
        title="Auto-generate invoices"
        submitLabel="Generate"
        fields={[
          { name: 'from', label: 'From', type: 'date', required: true },
          { name: 'to', label: 'To', type: 'date', required: true },
        ]}
        defaultValues={{ from: isoDay(subDays(new Date(), 7)), to: isoDay(new Date()) }}
        onSubmit={(v) => {
          if (v.from > v.to) { toast.error('The From date must be before the To date'); return; }
          const made = merchants.map((m) => issue(m.id, v.from, v.to, 15)).filter(Boolean);
          setAuto(false);
          toast[made.length ? 'success' : 'info'](made.length ? `${made.length} draft invoice(s) generated` : 'No billable shipments in that period');
        }}
      />
    </div>
  );
}

export function InvoiceDetail() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { money } = useMoney();
  const lookups = useLookups();
  const user = useAuth((s) => s.user);
  const { invoices, updateItem, removeItem, logPrint } = useData();
  const [modal, setModal] = useState(null);
  const inPortal = pathname.startsWith('/portal');
  const inv = invoices.find((i) => i.id === id);
  const backTo = inPortal ? '/portal/invoices' : '/finance/invoices';
  // A merchant can only open their own issued invoices.
  const blocked = inv && user.role === 'merchant' && (inv.merchantId !== user.merchantId || inv.status === 'Draft');
  if (!inv || blocked) return <RecordNotFound what="Invoice" backTo={backTo} backLabel="Back to invoices" />;
  const staff = !inPortal && user.role !== 'merchant';
  const merchant = lookups.merchant(inv.merchantId);
  const balance = invoiceBalance(inv);

  const settleStatus = (x, newBalance) => {
    if (newBalance <= 0) return 'Paid';
    return new Date(x.dueDate) < new Date() ? 'Overdue' : 'Partial';
  };
  const send = () => { updateItem('invoices', id, { status: new Date(inv.dueDate) < new Date() ? 'Overdue' : 'Sent' }, 'Invoice', `${inv.number} sent`); toast.success(`${inv.number} sent to ${merchant?.email}`); };
  const del = async () => {
    if (await confirm({ title: 'Delete draft?', message: `${inv.number} will be deleted.`, confirmLabel: 'Delete' })) {
      removeItem('invoices', id, 'Invoice');
      toast.success('Draft deleted');
      navigate(backTo);
    }
  };

  return (
    <div>
      <PageHeader
        title={inv.number}
        subtitle={merchant?.name}
        actions={(
          <>
            <StatusBadge status={inv.status} />
            <button type="button" className="btn-outline" onClick={() => setModal('print')}><Printer size={15} aria-hidden /> Preview / PDF</button>
            {staff && inv.status === 'Draft' && <button type="button" className="btn-primary" onClick={send}><Send size={15} aria-hidden /> Send</button>}
            {staff && inv.status === 'Draft' && <button type="button" className="btn-danger" onClick={del}><Trash2 size={15} aria-hidden /> Delete</button>}
            {staff && inv.status !== 'Draft' && balance > 0 && <button type="button" className="btn-primary" onClick={() => setModal('payment')}><CreditCard size={15} aria-hidden /> Record payment</button>}
            {staff && inv.status !== 'Draft' && balance > 0 && <button type="button" className="btn-outline" onClick={() => setModal('credit')}><FileMinus2 size={15} aria-hidden /> Credit note</button>}
          </>
        )}
      />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card title="Lines" className="lg:col-span-2" bodyClass="">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs text-ink-muted"><tr><th className="px-4 py-2 text-start font-medium">Description</th><th className="px-4 py-2 text-end font-medium">Qty</th><th className="px-4 py-2 text-end font-medium">Rate</th><th className="px-4 py-2 text-end font-medium">Amount</th></tr></thead>
              <tbody>
                {inv.lines.map((l, i) => <tr key={i} className="border-t border-line"><td className="px-4 py-2">{l.desc}</td><td className="px-4 py-2 text-end">{l.qty}</td><td className="px-4 py-2 text-end">{money(l.rate)}</td><td className="px-4 py-2 text-end">{money(l.amount)}</td></tr>)}
                <tr className="border-t border-line"><td colSpan={3} className="px-4 py-1.5 text-end text-ink-muted">Subtotal</td><td className="px-4 py-1.5 text-end">{money(inv.subtotal)}</td></tr>
                <tr><td colSpan={3} className="px-4 py-1.5 text-end text-ink-muted">Tax ({inv.taxPct}%)</td><td className="px-4 py-1.5 text-end">{money(inv.tax)}</td></tr>
                <tr className="font-bold"><td colSpan={3} className="px-4 py-1.5 text-end">Total</td><td className="px-4 py-1.5 text-end">{money(inv.total)}</td></tr>
                <tr className={balance > 0 ? 'font-bold text-danger' : 'font-bold'}><td colSpan={3} className="px-4 py-1.5 text-end">Balance due</td><td className="px-4 py-1.5 text-end">{money(balance)}</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-3">
              <KV label="Issued">{fmtDate(inv.issueDate)}</KV>
              <KV label="Due">{fmtDate(inv.dueDate)}</KV>
              <KV label="Shipments">{inv.shipments}</KV>
              <KV label="Period">{fmtDate(inv.from)} - {fmtDate(inv.to)}</KV>
            </dl>
          </Card>
          <Card title="Payments and credits" bodyClass="">
            <ul className="divide-y divide-line">
              {inv.payments.map((p) => <li key={p.id} className="flex justify-between gap-2 px-4 py-2 text-sm"><span>{p.method} <span className="block text-xs text-ink-muted">{p.reference} - {fmtDateTime(p.at)}</span></span><b>{money(p.amount)}</b></li>)}
              {inv.creditNotes.map((c) => <li key={c.id} className="flex justify-between gap-2 px-4 py-2 text-sm"><span>Credit note {c.id} <span className="block text-xs text-ink-muted">{c.reason}</span></span><b>{money(c.amount)}</b></li>)}
              {!inv.payments.length && !inv.creditNotes.length && <li className="px-4 py-6 text-center text-sm text-ink-muted">Nothing recorded yet</li>}
            </ul>
          </Card>
        </div>
      </div>
      <PrintPreview open={modal === 'print'} onClose={() => setModal(null)} title={inv.number} filename={inv.number} onPrint={() => logPrint('Invoice', [inv.number], 'a4')}>
        <InvoiceDoc invoice={inv} merchant={merchant} />
      </PrintPreview>
      <FormModal
        open={modal === 'payment'}
        onClose={() => setModal(null)}
        title="Record payment"
        fields={[
          { name: 'amount', label: 'Amount (PKR)', type: 'number', required: true, min: 1, max: balance },
          { name: 'method', label: 'Method', type: 'select', options: ['Bank Transfer', 'Cheque', 'Cash', 'COD Adjustment'], required: true },
          { name: 'reference', label: 'Reference', required: true, full: true },
        ]}
        defaultValues={{ amount: balance, method: 'Bank Transfer' }}
        onSubmit={(v) => {
          updateItem('invoices', id, (x) => ({ payments: [...x.payments, { id: uid('PAY'), at: new Date().toISOString(), ...v }], status: settleStatus(x, balance - v.amount) }), 'Invoice', `${inv.number}: payment Rs ${v.amount}`);
          setModal(null);
          toast.success('Payment recorded');
        }}
      />
      <FormModal
        open={modal === 'credit'}
        onClose={() => setModal(null)}
        title="Issue credit note"
        fields={[
          { name: 'amount', label: 'Amount (PKR)', type: 'number', required: true, min: 1, max: balance },
          { name: 'reason', label: 'Reason', required: true },
        ]}
        onSubmit={(v) => {
          updateItem('invoices', id, (x) => ({ creditNotes: [...x.creditNotes, { id: `CN-${Math.floor(1000 + Math.random() * 9000)}`, at: new Date().toISOString(), ...v }], status: settleStatus(x, balance - v.amount) }), 'Invoice', `${inv.number}: credit Rs ${v.amount}`);
          setModal(null);
          toast.success('Credit note issued');
        }}
      />
    </div>
  );
}

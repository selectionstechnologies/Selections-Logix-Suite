import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, PageHeader, StatCard, Tabs } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { BarsChart, CHART } from '../../components/charts/index.jsx';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useLookups, useMoney } from '../../hooks/useApp.js';
import { agingBuckets, invoiceBalance, shipmentKpis } from '../../data/helpers.js';
import { EXPENSE_CATEGORIES } from '../../data/config.js';
import { fmtDate, groupBy, sum, toPKR, uid } from '../../utils/format.js';

function LedgerView({ rows, party, setParty, options, label, money }) {
  // Running balance is computed oldest first, then shown newest first.
  const entries = useMemo(() => {
    let bal = 0;
    return [...rows].sort((a, b) => new Date(a.date) - new Date(b.date)).map((r, i) => {
      bal += r.credit - r.debit;
      return { ...r, id: `${r.ref}-${i}`, balance: bal };
    }).reverse();
  }, [rows]);
  return (
    <div>
      <div className="card mb-4 p-4">
        <label htmlFor="lp" className="label">{label}</label>
        <select id="lp" className="input sm:max-w-sm" value={party} onChange={(e) => setParty(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      </div>
      <DataTable
        data={entries}
        exportName={`ledger-${party}`}
        dateKey="date"
        emptyTitle="No ledger entries"
        columns={[
          { key: 'date', header: 'Date', render: (r) => fmtDate(r.date), exportValue: (r) => fmtDate(r.date) },
          { key: 'ref', header: 'Reference' },
          { key: 'desc', header: 'Description' },
          { key: 'debit', header: 'Debit', align: 'right', render: (r) => (r.debit ? money(r.debit) : '-') },
          { key: 'credit', header: 'Credit', align: 'right', render: (r) => (r.credit ? money(r.credit) : '-') },
          { key: 'balance', header: 'Balance', align: 'right', render: (r) => <b className={r.balance < 0 ? 'text-danger' : ''}>{money(r.balance)}</b> },
        ]}
      />
    </div>
  );
}

export function Ledgers() {
  const { money, compact } = useMoney();
  const lookups = useLookups();
  const store = useData();
  const { shipments, codTransactions, payouts, invoices, riderDeposits, expenses, otherIncome, addItem, removeItem } = store;
  const [tab, setTab] = useState('pnl');
  const [merchantPick, setMerchantId] = useState('');
  const [riderPick, setRiderId] = useState('');
  // Default to the first customer / rider until one is picked.
  const merchantId = merchantPick || lookups.merchantOptions[0]?.value || '';
  const riderId = riderPick || lookups.riderOptions[0]?.value || '';
  const [branchId, setBranchId] = useState('LHE');
  const [adding, setAdding] = useState(false);

  const k = useMemo(() => shipmentKpis(shipments), [shipments]);
  const totalExpense = sum(expenses, (e) => e.amount);
  const totalOther = sum(otherIncome, (e) => e.amount);
  const net = k.revenue + totalOther - k.cost - totalExpense;
  const byCategory = EXPENSE_CATEGORIES.map((name) => ({ name, value: sum(expenses.filter((e) => e.category === name), (e) => e.amount) }));

  const merchantRows = useMemo(() => [
    ...codTransactions.filter((t) => t.merchantId === merchantId).map((t) => ({ date: t.collectedAt, ref: t.id, desc: `COD collected ${t.awb}`, credit: toPKR(t.amount, t.currency), debit: 0 })),
    ...payouts.filter((p) => p.merchantId === merchantId && p.status === 'Paid').map((p) => ({ date: p.paidAt, ref: p.id, desc: 'Payout (shipping, fees and net paid)', credit: 0, debit: p.gross })),
    ...invoices.filter((i) => i.merchantId === merchantId && i.status !== 'Draft').map((i) => ({ date: i.issueDate, ref: i.number, desc: 'Invoice issued', credit: 0, debit: i.total })),
    ...invoices.filter((i) => i.merchantId === merchantId).flatMap((i) => i.payments.map((p) => ({ date: p.at, ref: p.reference || p.id, desc: `Payment on ${i.number}`, credit: p.amount, debit: 0 }))),
  ], [codTransactions, payouts, invoices, merchantId]);
  const riderRows = useMemo(() => [
    ...codTransactions.filter((t) => t.riderId === riderId).map((t) => ({ date: t.collectedAt, ref: t.id, desc: `Collected ${t.awb}`, credit: toPKR(t.amount, t.currency), debit: 0 })),
    ...riderDeposits.filter((d) => d.riderId === riderId).map((d) => ({ date: d.at, ref: d.id, desc: 'Cash deposit', credit: 0, debit: toPKR(d.deposited, d.currency) })),
  ], [codTransactions, riderDeposits, riderId]);
  const branchRows = useMemo(() => [
    ...shipments.filter((s) => s.originBranchId === branchId && s.status !== 'Cancelled').map((s) => ({ date: s.createdAt, ref: s.awb, desc: 'Shipment revenue', credit: toPKR(s.charges.total - s.charges.tax, s.currency), debit: 0 })),
    ...expenses.filter((e) => e.branchId === branchId).map((e) => ({ date: e.date, ref: e.id, desc: e.description, credit: 0, debit: e.amount })),
    ...otherIncome.filter((e) => e.branchId === branchId).map((e) => ({ date: e.date, ref: e.id, desc: e.source, credit: e.amount, debit: 0 })),
  ], [shipments, expenses, otherIncome, branchId]);

  const openInv = invoices.filter((i) => !['Draft', 'Paid'].includes(i.status));
  const aging = useMemo(() => agingBuckets(openInv.map((i) => ({ amount: invoiceBalance(i), date: i.issueDate }))), [openInv]);
  const agingByMerchant = Object.entries(groupBy(openInv, (i) => i.merchantId)).map(([id, list]) => {
    const b = agingBuckets(list.map((i) => ({ amount: invoiceBalance(i), date: i.issueDate })));
    return { id, name: lookups.merchantName(id), b0: b[0].value, b1: b[1].value, b2: b[2].value, b3: b[3].value, total: sum(b, (x) => x.value) };
  });

  const del = async (e) => {
    if (await confirm({ title: 'Delete expense?', message: `${e.description} will be removed.`, confirmLabel: 'Delete' })) { removeItem('expenses', e.id, 'Expense'); toast.success('Expense deleted'); }
  };

  return (
    <div>
      <PageHeader title="Ledgers & P&L" subtitle="All amounts in PKR base, shown in your selected currency." actions={tab === 'expenses' && <button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> Add expense</button>} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'pnl', label: 'Profit & loss' }, { value: 'expenses', label: 'Expenses', count: expenses.length }, { value: 'income', label: 'Income', count: otherIncome.length }, { value: 'merchant', label: 'Merchant ledger' }, { value: 'rider', label: 'Rider ledger' }, { value: 'branch', label: 'Branch ledger' }, { value: 'aging', label: 'Aging' }]}
      />
      {tab === 'pnl' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Revenue + other income" value={compact(k.revenue + totalOther)} />
            <StatCard label="Direct cost" value={compact(k.cost)} />
            <StatCard label="Expenses" value={compact(totalExpense)} />
            <StatCard label={net < 0 ? 'Net loss' : 'Net profit'} value={compact(net)} tone={net < 0 ? 'danger' : 'default'} />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card title="Summary">
              {[['Shipping revenue', k.revenue], ['Other income', totalOther], ['Direct delivery cost', -k.cost], ['Operating expenses', -totalExpense]].map(([l, v]) => <div key={l} className="flex justify-between py-1.5 text-sm"><span className="text-ink-muted">{l}</span><span className="tabular-nums">{money(v)}</span></div>)}
              <div className="mt-1 flex justify-between border-t border-line pt-2 font-bold"><span>Net result</span><span className={net < 0 ? 'text-danger' : ''}>{money(net)}</span></div>
            </Card>
            <Card title="Expenses by category"><BarsChart data={byCategory} horizontal format={(v) => compact(v)} series={[{ key: 'value', name: 'Amount', color: CHART.red }]} /></Card>
          </div>
        </div>
      )}
      {tab === 'expenses' && (
        <DataTable
          data={expenses}
          exportName="expenses"
          dateKey="date"
          filters={[{ key: 'category', label: 'Category', options: EXPENSE_CATEGORIES }, { key: 'branchId', label: 'Branch', options: lookups.branchOptions }]}
          columns={[
            { key: 'id', header: 'ID' },
            { key: 'date', header: 'Date', render: (e) => fmtDate(e.date), exportValue: (e) => fmtDate(e.date) },
            { key: 'category', header: 'Category' },
            { key: 'description', header: 'Description' },
            { key: 'branch', header: 'Branch', value: (e) => lookups.branchName(e.branchId) },
            { key: 'paidTo', header: 'Paid to' },
            { key: 'amount', header: 'Amount', align: 'right', render: (e) => money(e.amount) },
            { key: 'act', header: '', sortable: false, export: false, render: (e) => <button type="button" className="btn-ghost btn-sm hover:!text-danger" onClick={() => del(e)} aria-label={`Delete ${e.id}`}><Trash2 size={14} /></button> },
          ]}
        />
      )}
      {tab === 'income' && (
        <DataTable
          data={otherIncome}
          exportName="other-income"
          columns={[
            { key: 'id', header: 'ID' },
            { key: 'date', header: 'Date', render: (e) => fmtDate(e.date), exportValue: (e) => fmtDate(e.date) },
            { key: 'source', header: 'Source' },
            { key: 'branch', header: 'Branch', value: (e) => lookups.branchName(e.branchId) },
            { key: 'amount', header: 'Amount', align: 'right', render: (e) => money(e.amount) },
          ]}
        />
      )}
      {tab === 'merchant' && <LedgerView rows={merchantRows} party={merchantId} setParty={setMerchantId} options={lookups.merchantOptions} label="Merchant" money={money} />}
      {tab === 'rider' && <LedgerView rows={riderRows} party={riderId} setParty={setRiderId} options={lookups.riderOptions} label="Rider" money={money} />}
      {tab === 'branch' && <LedgerView rows={branchRows} party={branchId} setParty={setBranchId} options={lookups.branchOptions} label="Branch" money={money} />}
      {tab === 'aging' && (
        <div className="space-y-4">
          <Card title="Receivables by age"><BarsChart data={aging} format={(v) => compact(v)} series={[{ key: 'value', name: 'Outstanding' }]} /></Card>
          <DataTable
            data={agingByMerchant}
            exportName="aging-report"
            columns={[
              { key: 'name', header: 'Merchant' },
              { key: 'b0', header: '0-7 days', align: 'right', render: (r) => money(r.b0) },
              { key: 'b1', header: '8-15 days', align: 'right', render: (r) => money(r.b1) },
              { key: 'b2', header: '16-30 days', align: 'right', render: (r) => money(r.b2) },
              { key: 'b3', header: '31+ days', align: 'right', render: (r) => <span className={r.b3 > 0 ? 'font-semibold text-danger' : ''}>{money(r.b3)}</span> },
              { key: 'total', header: 'Total', align: 'right', render: (r) => <b>{money(r.total)}</b> },
            ]}
          />
        </div>
      )}
      <FormModal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add expense"
        fields={[
          { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES, required: true },
          { name: 'branchId', label: 'Branch', type: 'select', options: lookups.branchOptions, required: true },
          { name: 'amount', label: 'Amount (PKR)', type: 'number', required: true, min: 1 },
          { name: 'date', label: 'Date', type: 'date', required: true },
          { name: 'paidTo', label: 'Paid to', required: true },
          { name: 'description', label: 'Description', required: true },
        ]}
        defaultValues={{ date: new Date().toISOString().slice(0, 10) }}
        onSubmit={(v) => { addItem('expenses', { id: uid('EXP'), ...v, date: new Date(v.date).toISOString() }, 'Expense', `${v.description}: Rs ${v.amount}`); setAdding(false); toast.success('Expense added'); }}
      />
    </div>
  );
}

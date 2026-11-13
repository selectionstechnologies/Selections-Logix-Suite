// COD dashboard, rider cash reconciliation and merchant payout management.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Banknote, CheckCircle2, FileText, HandCoins, Hourglass, Landmark, Plus, Scale, ThumbsDown, ThumbsUp, Wallet } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, Drawer, KV, Modal, PageHeader, StatCard, StatusBadge } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { BarsChart, CHART, DonutChart } from '../../components/charts/index.jsx';
import { PrintPreview, Sheet } from '../../components/print/index.jsx';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useBranchFilter, useLookups, useMoney } from '../../hooks/useApp.js';
import { agingBuckets, shipmentKpis } from '../../data/helpers.js';
import { fmtCurrency, fmtDate, fmtDateTime, groupBy, sum, toPKR } from '../../utils/format.js';

export function CodDashboard() {
  const { money, compact } = useMoney();
  const lookups = useLookups();
  const { shipments, codTransactions } = useData();
  const txns = useBranchFilter(codTransactions);
  const k = useMemo(() => shipmentKpis(shipments), [shipments]);
  const byStatus = (st) => sum(txns.filter((t) => t.status === st), (t) => toPKR(t.amount, t.currency));
  const collected = sum(txns, (t) => toPKR(t.amount, t.currency));
  const pipeline = [
    { name: 'With riders', value: byStatus('Collected'), color: CHART.red },
    { name: 'Deposited', value: byStatus('Deposited'), color: CHART.slate },
    { name: 'Reconciled', value: byStatus('Reconciled'), color: CHART.brown },
    { name: 'Paid out', value: byStatus('Paid'), color: CHART.yellow },
  ];
  const aging = useMemo(() => agingBuckets(txns.filter((t) => t.status !== 'Paid').map((t) => ({ amount: toPKR(t.amount, t.currency), date: t.collectedAt }))), [txns]);
  return (
    <div>
      <PageHeader title="COD Dashboard" subtitle="Cash-on-delivery from the doorstep to the merchant's bank account." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Collected" value={compact(collected)} icon={Banknote} />
        <StatCard label="Pending with riders" value={compact(byStatus('Collected'))} icon={Wallet} tone="danger" />
        <StatCard label="Deposited" value={compact(byStatus('Deposited'))} icon={Landmark} />
        <StatCard label="Reconciled" value={compact(byStatus('Reconciled'))} icon={CheckCircle2} />
        <StatCard label="Payable to merchants" value={compact(byStatus('Reconciled'))} hint={`${compact(k.codPaid)} paid to date`} icon={HandCoins} />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="COD pipeline"><DonutChart data={pipeline} format={(v) => money(v)} /></Card>
        <Card title="Unsettled COD by age"><BarsChart data={aging} format={(v) => compact(v)} series={[{ key: 'value', name: 'Amount', color: CHART.red }]} /></Card>
      </div>
      <DataTable
        title="COD transactions"
        data={txns}
        exportName="cod-transactions"
        dateKey="collectedAt"
        filters={[
          { key: 'status', label: 'Status', options: ['Collected', 'Deposited', 'Reconciled', 'Paid'] },
          { key: 'merchantId', label: 'Merchant', options: lookups.merchantOptions },
          { key: 'currency', label: 'Currency', options: ['PKR', 'AED'] },
        ]}
        columns={[
          { key: 'id', header: 'Txn' },
          { key: 'awb', header: 'AWB', render: (t) => <Link className="link" to={`/shipments/${t.shipmentId}`}>{t.awb}</Link>, value: (t) => t.awb },
          { key: 'merchant', header: 'Merchant', value: (t) => lookups.merchantName(t.merchantId) },
          { key: 'rider', header: 'Rider', value: (t) => lookups.riderName(t.riderId) },
          { key: 'branch', header: 'Branch', value: (t) => lookups.branchName(t.branchId) },
          { key: 'amount', header: 'Amount', align: 'right', value: (t) => toPKR(t.amount, t.currency), render: (t) => money(t.amount, t.currency), exportValue: (t) => `${t.currency} ${t.amount}` },
          { key: 'collectedAt', header: 'Collected', render: (t) => fmtDate(t.collectedAt), exportValue: (t) => fmtDate(t.collectedAt) },
          { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} />, value: (t) => t.status },
        ]}
      />
    </div>
  );
}

const depositState = (d) => (d.deposited < d.expected ? 'Shortage' : d.deposited > d.expected ? 'Excess' : 'Matched');

export function Reconciliation() {
  const { money, compact } = useMoney();
  const lookups = useLookups();
  const { riderDeposits, codTransactions, riders, reconcileDeposit, recordDeposit } = useData();
  const deposits = useBranchFilter(riderDeposits);
  const scopedRiders = useBranchFilter(riders);
  const [recording, setRecording] = useState(false);
  const pending = deposits.filter((d) => d.status === 'Pending');
  const expected = sum(pending, (d) => toPKR(d.expected, d.currency));
  const deposited = sum(pending, (d) => toPKR(d.deposited, d.currency));
  const cashByRider = useMemo(() => {
    const groups = groupBy(codTransactions.filter((t) => t.status === 'Collected'), (t) => t.riderId);
    return Object.entries(groups).map(([riderId, list]) => ({ riderId, count: list.length, amount: sum(list, (t) => t.amount), currency: list[0].currency }));
  }, [codTransactions]);
  const riderOptions = scopedRiders.filter((r) => cashByRider.some((c) => c.riderId === r.id)).map((r) => {
    const c = cashByRider.find((x) => x.riderId === r.id);
    return { value: r.id, label: `${r.name} - holding ${fmtCurrency(c.amount, c.currency)}` };
  });

  const reconcile = async (d) => {
    const state = depositState(d);
    if (state !== 'Matched' && !(await confirm({ title: `Reconcile with ${state.toLowerCase()}?`, message: `${lookups.riderName(d.riderId)} deposited ${fmtCurrency(d.deposited, d.currency)} against ${fmtCurrency(d.expected, d.currency)} expected. The ${fmtCurrency(Math.abs(d.deposited - d.expected), d.currency)} difference stays on the rider's ledger.`, confirmLabel: 'Reconcile' }))) return;
    try { await reconcileDeposit(d.id); toast.success('Deposit reconciled'); } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader title="Rider Reconciliation" subtitle="Expected versus deposited cash. Differences are flagged in red." actions={<button type="button" className="btn-primary" onClick={() => setRecording(true)} disabled={!riderOptions.length}><Plus size={16} aria-hidden /> Record deposit</button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Deposits to reconcile" value={pending.length} icon={Hourglass} />
        <StatCard label="Expected" value={compact(expected)} icon={Scale} />
        <StatCard label="Deposited" value={compact(deposited)} icon={Landmark} />
        <StatCard label="Net difference" value={compact(deposited - expected)} icon={Wallet} tone={deposited !== expected ? 'danger' : 'default'} />
      </div>
      <DataTable
        data={deposits}
        exportName="rider-reconciliation"
        dateKey="at"
        rowClass={(d) => (d.status === 'Pending' && depositState(d) !== 'Matched' ? 'bg-danger-light/50' : '')}
        filters={[
          { key: 'status', label: 'Status', options: ['Pending', 'Reconciled'] },
          { key: 'state', label: 'Result', options: ['Matched', 'Shortage', 'Excess'], match: (d, v) => depositState(d) === v },
        ]}
        columns={[
          { key: 'id', header: 'Deposit' },
          { key: 'rider', header: 'Rider', value: (d) => lookups.riderName(d.riderId), render: (d) => <Link className="link" to={`/riders/${d.riderId}`}>{lookups.riderName(d.riderId)}</Link> },
          { key: 'branch', header: 'Branch', value: (d) => lookups.branchName(d.branchId) },
          { key: 'parcels', header: 'Parcels', align: 'right', value: (d) => d.txnIds.length },
          { key: 'expected', header: 'Expected', align: 'right', render: (d) => money(d.expected, d.currency) },
          { key: 'deposited', header: 'Deposited', align: 'right', render: (d) => money(d.deposited, d.currency) },
          { key: 'diff', header: 'Difference', align: 'right', value: (d) => d.deposited - d.expected, render: (d) => <span className={clsx(d.deposited !== d.expected && 'font-bold text-danger')}>{money(d.deposited - d.expected, d.currency)}</span> },
          { key: 'state', header: 'Result', value: depositState, render: (d) => <StatusBadge status={depositState(d)} /> },
          { key: 'at', header: 'Date', render: (d) => fmtDateTime(d.at), exportValue: (d) => fmtDateTime(d.at) },
          { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.status} />, value: (d) => d.status },
          { key: 'act', header: '', sortable: false, export: false, render: (d) => d.status === 'Pending' && <button type="button" className="btn-primary btn-sm" onClick={() => reconcile(d)}>Reconcile</button> },
        ]}
      />
      <FormModal
        open={recording}
        onClose={() => setRecording(false)}
        title="Record rider deposit"
        fields={[
          { name: 'riderId', label: 'Rider', type: 'select', options: riderOptions, required: true, full: true },
          { name: 'amount', label: 'Amount deposited', type: 'number', required: true, min: 0, full: true, help: "In the rider's local currency." },
        ]}
        onSubmit={async ({ riderId, amount }) => {
          try {
            const dep = await recordDeposit(riderId, amount);
            setRecording(false);
            if (dep) toast.success(`Deposit recorded${dep.deposited !== dep.expected ? ` with a ${depositState(dep).toLowerCase()}` : ''}`);
            else toast.info('This rider has no collected COD to deposit');
          } catch (e) { toast.error(e.message); }
        }}
      />
    </div>
  );
}

function PayoutStatement({ payout: p, merchant, txns }) {
  return (
    <Sheet size="a4" autoHeight className="p-8 text-sm">
      <div className="mb-5 flex justify-between border-b-2 border-[#FACC15] pb-3">
        <div><p className="text-base font-bold">Selections Logix Suite</p><p className="text-xs text-gray-500">Payout statement</p></div>
        <div className="text-end"><p className="font-bold">{p.id}</p><p className="text-xs text-gray-500">{fmtDate(p.createdAt)}</p></div>
      </div>
      <p className="font-semibold">{merchant?.name}</p>
      <p className="mb-4 text-xs text-gray-600">{merchant?.bank} - {merchant?.iban}</p>
      <table className="mb-4 w-full border-collapse text-xs">
        <thead><tr className="bg-gray-100">{['Txn', 'AWB', 'Currency', 'COD'].map((h) => <th key={h} className="border border-gray-200 p-1.5 text-start">{h}</th>)}</tr></thead>
        <tbody>{txns.map((t) => <tr key={t.id}><td className="border border-gray-200 p-1.5">{t.id}</td><td className="border border-gray-200 p-1.5">{t.awb}</td><td className="border border-gray-200 p-1.5">{t.currency}</td><td className="border border-gray-200 p-1.5">{t.amount.toLocaleString('en-US')}</td></tr>)}</tbody>
      </table>
      <div className="ms-auto w-64 space-y-1">
        <div className="flex justify-between"><span>Gross COD</span><span>{fmtCurrency(p.gross)}</span></div>
        <div className="flex justify-between"><span>Less shipping</span><span>-{fmtCurrency(p.shipping)}</span></div>
        <div className="flex justify-between"><span>Less COD fee</span><span>-{fmtCurrency(p.codFee)}</span></div>
        <div className="flex justify-between"><span>Less returns</span><span>-{fmtCurrency(p.returns)}</span></div>
        <div className="flex justify-between border-t border-gray-300 pt-1 font-bold"><span>Net payable</span><span>{fmtCurrency(p.net)}</span></div>
      </div>
      {p.reference && <p className="mt-4 text-xs">Payment reference: {p.reference}, paid {fmtDate(p.paidAt)}</p>}
    </Sheet>
  );
}

export function PayoutManagement() {
  const { money, compact } = useMoney();
  const lookups = useLookups();
  const store = useData();
  const { payouts, codTransactions, setPayoutStatus, markPayoutPaid, createPayout, payableTxns, logPrint } = store;
  const [open, setOpen] = useState(null);
  const [paying, setPaying] = useState(null);
  const [statement, setStatement] = useState(null);
  const [creating, setCreating] = useState(false);

  const due = payableTxns();
  const dueByMerchant = Object.entries(groupBy(due, (t) => t.merchantId)).map(([merchantId, list]) => ({ merchantId, count: list.length, amount: sum(list, (t) => toPKR(t.amount, t.currency)) }));
  const count = (s) => payouts.filter((p) => p.status === s).length;
  const statementTxns = (p) => codTransactions.filter((t) => p.txnIds.includes(t.id));
  const openP = payouts.find((p) => p.id === open);

  const approve = async (p) => { try { await setPayoutStatus(p.id, 'Approved'); toast.success(`${p.batch} approved`); } catch (e) { toast.error(e.message); } };
  const reject = async (p) => {
    if (await confirm({ title: 'Reject payout?', message: `${p.id} will be rejected and its ${p.shipments} parcel(s) become available for a new payout.`, confirmLabel: 'Reject' })) {
      try { await setPayoutStatus(p.id, 'Rejected'); toast.info(`${p.batch} rejected`); } catch (e) { toast.error(e.message); }
    }
  };
  const actions = (p) => (
    <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
      {p.status === 'Pending' && <button type="button" className="btn-primary btn-sm" onClick={() => approve(p)}><ThumbsUp size={13} aria-hidden /> Approve</button>}
      {p.status === 'Pending' && <button type="button" className="btn-danger btn-sm" onClick={() => reject(p)}><ThumbsDown size={13} aria-hidden /> Reject</button>}
      {p.status === 'Approved' && <button type="button" className="btn-primary btn-sm" onClick={() => setPaying(p)}>Mark paid</button>}
      <button type="button" className="btn-outline btn-sm" onClick={() => setStatement(p)} aria-label={`Statement for ${p.id}`}><FileText size={13} /></button>
    </span>
  );

  return (
    <div>
      <PageHeader title="Merchant Payouts" subtitle="Net payout = gross COD, less shipping, COD fee and return charges." actions={<button type="button" className="btn-primary" onClick={() => setCreating(true)} disabled={!dueByMerchant.length}><Plus size={16} aria-hidden /> Create payouts ({dueByMerchant.length})</button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ready to batch" value={compact(sum(due, (t) => toPKR(t.amount, t.currency)))} hint={`${dueByMerchant.length} merchants`} icon={Banknote} />
        <StatCard label="Pending approval" value={count('Pending')} icon={Hourglass} />
        <StatCard label="Approved, unpaid" value={count('Approved')} icon={ThumbsUp} />
        <StatCard label="Paid" value={compact(sum(payouts.filter((p) => p.status === 'Paid'), (p) => p.net))} hint={`${count('Paid')} payouts`} icon={HandCoins} />
      </div>
      <DataTable
        data={payouts}
        exportName="payouts"
        dateKey="createdAt"
        onRowClick={(p) => setOpen(p.id)}
        filters={[{ key: 'status', label: 'Status', options: ['Pending', 'Approved', 'Paid', 'Rejected'] }, { key: 'merchantId', label: 'Merchant', options: lookups.merchantOptions }]}
        columns={[
          { key: 'id', header: 'Payout' },
          { key: 'batch', header: 'Batch' },
          { key: 'merchant', header: 'Merchant', value: (p) => lookups.merchantName(p.merchantId) },
          { key: 'shipments', header: 'Parcels', align: 'right' },
          { key: 'gross', header: 'Gross', align: 'right', render: (p) => money(p.gross) },
          { key: 'ded', header: 'Deductions', align: 'right', value: (p) => p.shipping + p.codFee + p.returns, render: (p) => money(p.shipping + p.codFee + p.returns) },
          { key: 'net', header: 'Net', align: 'right', render: (p) => <b>{money(p.net)}</b> },
          { key: 'createdAt', header: 'Created', render: (p) => fmtDate(p.createdAt), exportValue: (p) => fmtDate(p.createdAt) },
          { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} />, value: (p) => p.status },
          { key: 'act', header: '', sortable: false, export: false, render: actions },
        ]}
      />
      {openP && (
        <Drawer open onClose={() => setOpen(null)} title={`Payout ${openP.id}`} footer={actions(openP)}>
          <dl className="mb-4 grid grid-cols-2 gap-3">
            <KV label="Merchant">{lookups.merchantName(openP.merchantId)}</KV>
            <KV label="Status"><StatusBadge status={openP.status} /></KV>
            <KV label="Batch">{openP.batch}</KV>
            <KV label="Reference">{openP.reference}</KV>
          </dl>
          {[['Gross COD', openP.gross], ['Shipping', -openP.shipping], ['COD fee', -openP.codFee], ['Returns', -openP.returns]].map(([l, v]) => <div key={l} className="flex justify-between py-1 text-sm"><span className="text-ink-muted">{l}</span><span className="tabular-nums">{money(v)}</span></div>)}
          <div className="mt-1 flex justify-between border-t border-line pt-2 font-bold"><span>Net</span><span>{money(openP.net)}</span></div>
          <p className="label mt-4">Parcels</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {statementTxns(openP).map((t) => <li key={t.id} className="flex justify-between px-3 py-2 text-sm"><Link className="link" to={`/shipments/${t.shipmentId}`}>{t.awb}</Link><span>{money(t.amount, t.currency)}</span></li>)}
          </ul>
        </Drawer>
      )}
      <FormModal
        open={!!paying}
        onClose={() => setPaying(null)}
        title={`Mark ${paying?.id} paid`}
        submitLabel="Mark paid"
        fields={[{ name: 'reference', label: 'Bank reference', required: true, full: true }]}
        onSubmit={async ({ reference }) => {
          try { await markPayoutPaid(paying.id, reference); toast.success('Payout marked paid'); setPaying(null); } catch (e) { toast.error(e.message); }
        }}
      />
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create payouts"
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={() => setCreating(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={async () => {
              let made = 0;
              for (const d of dueByMerchant) {
                try { if (await createPayout(d.merchantId)) made += 1; } catch (e) { toast.error(e.message); }
              }
              setCreating(false);
              toast.success(`${made} payout(s) created, pending approval`);
            }}>Create {dueByMerchant.length} payout(s)</button>
          </>
        )}
      >
        <p className="mb-2 text-sm text-ink-muted">Reconciled COD not yet in any payout:</p>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {dueByMerchant.map((d) => <li key={d.merchantId} className="flex justify-between px-3 py-2 text-sm"><span>{lookups.merchantName(d.merchantId)} <span className="text-xs text-ink-muted">({d.count})</span></span><b>{money(d.amount)}</b></li>)}
        </ul>
      </Modal>
      {statement && (
        <PrintPreview open onClose={() => setStatement(null)} title={`Statement ${statement.id}`} filename={`statement-${statement.id}`} onPrint={() => logPrint('Payout Statement', [statement.id], 'a4')}>
          <PayoutStatement payout={statement} merchant={lookups.merchant(statement.merchantId)} txns={statementTxns(statement)} />
        </PrintPreview>
      )}
    </div>
  );
}

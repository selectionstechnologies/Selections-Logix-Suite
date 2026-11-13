import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, FileDropzone, KV, PageHeader, StatCard, StatusBadge, Tabs } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { RecordNotFound } from '../../components/layout/Fallbacks.jsx';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useBranchFilter, useLookups, useMoney } from '../../hooks/useApp.js';
import { CITY_MAP, CITY_NAMES } from '../../data/geo.js';
import { merchantStats } from '../../data/helpers.js';
import { fmtDate, fmtNumber, fmtPct, uid } from '../../utils/format.js';
import { shipmentColumns } from '../shipments/columns.jsx';

const FIELDS = [
  { name: 'name', label: 'Business / customer name', required: true, full: true },
  { name: 'type', label: 'Type', type: 'select', options: ['Merchant', 'Individual', 'Corporate'], required: true },
  { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive', 'Suspended'], required: true, default: 'Active' },
  { name: 'contact', label: 'Contact person', required: true },
  { name: 'email', label: 'Email', required: true, email: true },
  { name: 'phone', label: 'Phone', required: true, phone: true },
  { name: 'city', label: 'City', type: 'select', options: CITY_NAMES, required: true },
  { name: 'address', label: 'Address', required: true, full: true },
  { name: 'bank', label: 'Bank' },
  { name: 'iban', label: 'IBAN' },
  { name: 'accountTitle', label: 'Account title' },
  { name: 'creditLimit', label: 'Credit limit (PKR)', type: 'number', min: 0 },
  { name: 'rateCard', label: 'Rate card', type: 'select', options: ['Standard', 'Merchant Plus', 'Corporate Contract'], required: true, default: 'Standard' },
  { name: 'discountPct', label: 'Contract discount %', type: 'number', min: 0, max: 50 },
];

export function CustomerList() {
  const navigate = useNavigate();
  const { money } = useMoney();
  const { merchants, shipments, addItem } = useData();
  const scoped = useBranchFilter(merchants);
  const [adding, setAdding] = useState(false);
  const counts = useMemo(() => {
    const c = {};
    shipments.forEach((s) => { c[s.merchantId] = (c[s.merchantId] || 0) + 1; });
    return c;
  }, [shipments]);
  const columns = [
    { key: 'name', header: 'Customer', render: (m) => <Link className="link" onClick={(e) => e.stopPropagation()} to={`/customers/${m.id}`}>{m.name}</Link>, value: (m) => m.name },
    { key: 'type', header: 'Type' },
    { key: 'contact', header: 'Contact' },
    { key: 'phone', header: 'Phone' },
    { key: 'city', header: 'City' },
    { key: 'shipments', header: 'Shipments', align: 'right', value: (m) => counts[m.id] || 0 },
    { key: 'creditLimit', header: 'Credit limit', align: 'right', render: (m) => money(m.creditLimit) },
    { key: 'kyc', header: 'KYC', render: (m) => <StatusBadge status={m.kyc === 'Verified' ? 'Verified' : 'Pending'} />, value: (m) => m.kyc },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} />, value: (m) => m.status },
  ];
  return (
    <div>
      <PageHeader title="Customers" subtitle="Merchants, individuals and corporate accounts." actions={<button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> Add customer</button>} />
      <DataTable
        columns={columns}
        data={scoped}
        exportName="customers"
        exportModule="customers"
        searchPlaceholder="Search name, contact, phone..."
        onRowClick={(m) => navigate(`/customers/${m.id}`)}
        filters={[
          { key: 'type', label: 'Type', options: ['Merchant', 'Individual', 'Corporate'] },
          { key: 'status', label: 'Status', options: ['Active', 'Inactive', 'Suspended'] },
          { key: 'kyc', label: 'KYC', options: ['Verified', 'Pending'] },
          { key: 'city', label: 'City', options: CITY_NAMES },
        ]}
      />
      <FormModal
        open={adding}
        size="lg"
        onClose={() => setAdding(false)}
        title="Add customer"
        fields={FIELDS}
        onSubmit={(v) => {
          const id = uid('M');
          addItem('merchants', {
            ...v, id, branchId: CITY_MAP[v.city].branchId, kyc: 'Pending', kycDocs: [], joinedAt: new Date().toISOString(),
            creditLimit: v.creditLimit || 0, discountPct: v.discountPct || 0, pickups: [], receivers: [], apiKey: `slx_live_${id.toLowerCase()}`,
          }, 'Customer', `${v.name} added`);
          setAdding(false);
          toast.success(`${v.name} added. KYC is pending.`);
          navigate(`/customers/${id}`);
        }}
      />
    </div>
  );
}

export function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { money, compact } = useMoney();
  const lookups = useLookups();
  const store = useData();
  const { merchants, shipments, codTransactions, payouts, auditLog, updateItem, removeItem } = store;
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const m = merchants.find((x) => x.id === id);
  const stats = useMemo(() => merchantStats(id, shipments, codTransactions, payouts), [id, shipments, codTransactions, payouts]);
  const columns = useMemo(() => shipmentColumns({ money, lookups, compact: true }).filter((c) => c.key !== 'merchant'), [money, lookups]);
  if (!m) return <RecordNotFound what="Customer" backTo="/customers" backLabel="Back to customers" />;

  const myPayouts = payouts.filter((p) => p.merchantId === id);
  const activity = auditLog.filter((a) => a.detail?.includes(m.name)).slice(0, 15);

  const addDocs = (files) => {
    updateItem('merchants', id, (x) => ({ kycDocs: [...x.kycDocs, ...files.map((f) => ({ name: f.name, size: `${Math.max(Math.round(f.size / 1024), 1)} KB` }))] }), 'Customer', `${m.name}: KYC document uploaded`);
    toast.success(`${files.length} document(s) uploaded`);
  };
  const del = async () => {
    if (stats.list.length) { toast.error(`Cannot delete: ${stats.list.length} shipments are linked. Set the customer to Inactive instead.`); return; }
    if (await confirm({ title: 'Delete customer?', message: `${m.name} will be permanently removed.`, confirmLabel: 'Delete' })) {
      removeItem('merchants', id, 'Customer');
      toast.success('Customer deleted');
      navigate('/customers');
    }
  };

  return (
    <div>
      <PageHeader
        title={m.name}
        subtitle={`${m.city} - joined ${fmtDate(m.joinedAt)}`}
        actions={(
          <>
            <StatusBadge status={m.status} />
            <button type="button" className="btn-outline" onClick={() => setEditing(true)}><Pencil size={15} aria-hidden /> Edit</button>
            <button type="button" className="btn-danger" onClick={del}><Trash2 size={15} aria-hidden /> Delete</button>
          </>
        )}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Shipments" value={fmtNumber(stats.list.length)} hint={`${fmtPct(stats.kpis.deliveredPct)} delivered`} />
        <StatCard label="COD payable" value={compact(stats.payable)} hint={`${compact(stats.inTransit)} in collection`} />
        <StatCard label="Paid out" value={compact(stats.paid)} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'shipments', label: 'Shipments', count: stats.list.length },
          { value: 'cod', label: 'COD', count: stats.txns.length },
          { value: 'payouts', label: 'Payouts', count: myPayouts.length },
          { value: 'activity', label: 'Activity' },
        ]}
      />
      {tab === 'overview' && (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <Card title="Profile">
            <dl className="grid gap-3">
              <KV label="Contact">{m.contact}</KV>
              <KV label="Email">{m.email}</KV>
              <KV label="Phone">{m.phone}</KV>
              <KV label="Address">{m.address}</KV>
            </dl>
          </Card>
          <Card title="Bank, contract and credit">
            <dl className="grid gap-3">
              <KV label="Bank">{m.bank}</KV>
              <KV label="IBAN">{m.iban}</KV>
              <KV label="Account title">{m.accountTitle}</KV>
              <KV label="Rate card">{m.rateCard}{m.discountPct ? ` (${m.discountPct}% discount)` : ''}</KV>
              <KV label="Credit limit">{money(m.creditLimit)}</KV>
            </dl>
          </Card>
          <Card
            title="KYC documents"
            actions={m.kyc === 'Pending' && (
              <button type="button" className="btn-primary btn-sm" disabled={!m.kycDocs.length} onClick={() => { updateItem('merchants', id, { kyc: 'Verified' }, 'Customer', `${m.name} marked Verified`); toast.success('KYC verified'); }}>Mark verified</button>
            )}
          >
            <p className="mb-2 flex items-center gap-2 text-sm">Status: <StatusBadge status={m.kyc === 'Verified' ? 'Verified' : 'Pending'} /></p>
            <ul className="mb-3 space-y-1">
              {m.kycDocs.map((d, i) => <li key={i} className="flex items-center gap-2 text-sm"><FileText size={14} className="text-ink-muted" aria-hidden /> <span className="min-w-0 flex-1 truncate">{d.name}</span> <span className="text-xs text-ink-muted">{d.size}</span></li>)}
            </ul>
            <FileDropzone compact multiple onFiles={addDocs} accept=".pdf,.jpg,.jpeg,.png" hint="Upload KYC documents" />
          </Card>
        </div>
      )}
      {tab === 'shipments' && <DataTable columns={columns} data={stats.list} exportName={`shipments-${id}`} onRowClick={(s) => navigate(`/shipments/${s.id}`)} />}
      {tab === 'cod' && (
        <DataTable
          data={stats.txns}
          exportName={`cod-${id}`}
          columns={[
            { key: 'id', header: 'Txn' },
            { key: 'awb', header: 'AWB', render: (t) => <Link className="link" to={`/shipments/${t.shipmentId}`}>{t.awb}</Link>, value: (t) => t.awb },
            { key: 'amount', header: 'Amount', align: 'right', render: (t) => money(t.amount, t.currency) },
            { key: 'collectedAt', header: 'Collected', render: (t) => fmtDate(t.collectedAt) },
            { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} />, value: (t) => t.status },
          ]}
        />
      )}
      {tab === 'payouts' && (
        <DataTable
          data={myPayouts}
          exportName={`payouts-${id}`}
          columns={[
            { key: 'id', header: 'Payout' },
            { key: 'shipments', header: 'Shipments', align: 'right' },
            { key: 'gross', header: 'Gross COD', align: 'right', render: (p) => money(p.gross) },
            { key: 'net', header: 'Net', align: 'right', render: (p) => money(p.net) },
            { key: 'createdAt', header: 'Created', render: (p) => fmtDate(p.createdAt) },
            { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} />, value: (p) => p.status },
          ]}
        />
      )}
    </div>
  );
}

/** Saved receivers and pickup locations. Also used from the merchant portal. */

// Customer accounts from the database: list, detail (with document download) and the
// merchant's own "My Account" page.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, Download, Eye, FileText, KeyRound, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, EmptyState, KV, PageHeader, PageSkeleton, StatusBadge } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { RecordNotFound } from '../../components/layout/Fallbacks.jsx';
import { useAuth } from '../../store/authStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { fmtDate, fmtDateTime } from '../../utils/format.js';
import { syncFromDb } from '../../hooks/useDbSync.js';
import { PAYMENT_TERMS, normalizePlans, paymentTermLabel, paymentTermsFor, shippingPlanLabel, SHIPPING_PLANS } from '../../utils/pricing.js';
import { createUser, deleteCustomer, docDownloadUrl, getCustomer, listCustomers, setCustomerStatus } from '../../lib/api.js';

const count = (x) => (Array.isArray(x) ? x.length : Number(x) || 0);
const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const canManage = (role) => ['super_admin', 'branch_manager'].includes(role);

export function CustomerAccounts() {
  const navigate = useNavigate();
  const role = useAuth((s) => s.user.role);
  const [rows, setRows] = useState(null);

  const load = useCallback(() => listCustomers().then(setRows).catch((e) => { toast.error(e.message); setRows([]); }), []);
  useEffect(() => { load(); }, [load]);

  if (!rows) return <PageSkeleton />;

  const columns = [
    { key: 'account_no', header: 'Account #', render: (r) => <span className="font-mono text-xs">{r.account_no}</span> },
    { key: 'business_name', header: 'Business', render: (r) => <span className="font-medium">{r.business_name}</span> },
    { key: 'shipping_plans', header: 'Plan', value: (r) => (r.shipping_plans || []).map(shippingPlanLabel).join(', ') || '-' },
    { key: 'payment_types', header: 'Payment', value: (r) => paymentTermsFor(r).map(paymentTermLabel).join(', ') },
    { key: 'owner_name', header: 'Owner' },
    { key: 'phone', header: 'Phone' },
    { key: 'city', header: 'City' },
    { key: 'branch', header: 'Branch', value: (r) => r.branch?.name || r.branch_id || '-' },
    { key: 'pickups', header: 'Pickups', value: (r) => count(r.pickups), align: 'end' },
    { key: 'docs', header: 'Docs', value: (r) => count(r.docs), align: 'end', hidden: true },
    { key: 'login', header: 'Portal login', value: (r) => (r.login ? r.login.email : 'None'), hidden: true },
    { key: 'kyc_status', header: 'KYC', render: (r) => <StatusBadge status={r.kyc_status} /> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'created_at', header: 'Created', value: (r) => r.created_at, render: (r) => fmtDate(r.created_at), hidden: true },
  ];

  return (
    <div>
      <PageHeader
        title="Customer Accounts"
        subtitle={`${rows.length} merchant / customer accounts`}
        actions={(
          <>
            <button type="button" className="btn-outline" onClick={load}><RefreshCw size={15} aria-hidden /> Refresh</button>
            {canManage(role) && <button type="button" className="btn-primary" onClick={() => navigate('/accounts/customers/new')}><Plus size={16} aria-hidden /> New customer</button>}
          </>
        )}
      />
      <DataTable
        data={rows}
        columns={columns}
        exportName="customer-accounts"
        dateKey="created_at"
        searchPlaceholder="Search name, account #, phone..."
        filters={[
          { key: 'shipping_plans', label: 'Plan', options: SHIPPING_PLANS.map((x) => ({ value: x.value, label: x.label })), match: (r, v) => normalizePlans(r.shipping_plans).includes(v) },
          { key: 'payment_types', label: 'Payment', options: PAYMENT_TERMS.map((x) => ({ value: x.value, label: x.label })), match: (r, v) => paymentTermsFor(r).includes(v) },
          { key: 'status', label: 'Status', options: ['Active', 'Inactive', 'Suspended'] },
          { key: 'kyc_status', label: 'KYC', options: ['Pending', 'Verified', 'Rejected'] },
        ]}
        onRowClick={(r) => navigate(`/accounts/customers/${r.id}`)}
        emptyTitle="No customer accounts yet"
        emptyMessage="Create the first customer account to start booking parcels for them."
        emptyAction={canManage(role) && <button type="button" className="btn-primary" onClick={() => navigate('/accounts/customers/new')}><Plus size={16} aria-hidden /> New customer</button>}
      />
    </div>
  );
}

function DocList({ docs }) {
  const open = async (doc, download) => {
    try { window.open(await docDownloadUrl(doc, download), '_blank', 'noopener'); } catch (e) { toast.error(e.message); }
  };
  if (!docs.length) return <p className="text-sm text-ink-muted">No documents uploaded.</p>;
  return (
    <ul className="divide-y divide-line">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
          <FileText size={16} className="shrink-0 text-ink-muted" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.file_name}</span><span className="text-xs text-ink-muted">{d.doc_type} · {fmtSize(d.size_bytes)} · {fmtDateTime(d.uploaded_at)}</span></span>
          <button type="button" className="btn-ghost btn-sm !p-2" aria-label={`View ${d.file_name}`} onClick={() => open(d, false)}><Eye size={15} /></button>
          <button type="button" className="btn-ghost btn-sm !p-2" aria-label={`Download ${d.file_name}`} onClick={() => open(d, true)}><Download size={15} /></button>
        </li>
      ))}
    </ul>
  );
}

const LOGIN_FIELDS = [
  { name: 'password', label: 'Temporary password', type: 'password', required: true, password: true, full: true },
];

export function CustomerAccountView({ customerId }) {
  const params = useParams();
  const id = customerId || params.id;
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const [c, setC] = useState(undefined);
  const [loginOpen, setLoginOpen] = useState(false);

  const load = useCallback(() => getCustomer(id).then(setC).catch((e) => { toast.error(e.message); setC(null); }), [id]);
  useEffect(() => { load(); }, [load]);

  if (c === undefined) return <PageSkeleton />;
  if (!c) return <RecordNotFound what="Customer account" backTo="/accounts/customers" backLabel="Back to customers" />;

  const manage = canManage(me.role);
  const isAdmin = me.role === 'super_admin';

  const patch = async (p, msg) => {
    try { await setCustomerStatus(c.id, p); toast.success(msg); load(); syncFromDb().catch(() => {}); } catch (e) { toast.error(e.message); }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete customer account?', message: `${c.business_name}, its addresses, contacts and documents are deleted permanently.`, confirmLabel: 'Delete' }))) return;
    try { await deleteCustomer(c.id); toast.success('Customer deleted'); navigate('/accounts/customers'); } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader
        title={c.business_name}
        subtitle={`${c.account_no} · since ${fmtDate(c.created_at)}`}
        actions={manage && (
          <>
            {c.kyc_status !== 'Verified' && <button type="button" className="btn-outline" onClick={() => patch({ kyc_status: 'Verified' }, 'KYC verified')}><BadgeCheck size={15} aria-hidden /> Verify KYC</button>}
            {c.status === 'Active'
              ? <button type="button" className="btn-outline" onClick={() => patch({ status: 'Suspended' }, 'Account suspended')}>Suspend</button>
              : <button type="button" className="btn-outline" onClick={() => patch({ status: 'Active' }, 'Account activated')}>Activate</button>}
            {isAdmin && !c.login && <button type="button" className="btn-outline" onClick={() => (c.email ? setLoginOpen(true) : toast.error('Add an email to this customer first; it is used as the login.'))}><KeyRound size={15} aria-hidden /> Create login</button>}
            {isAdmin && <button type="button" className="btn-ghost text-danger" onClick={remove}><Trash2 size={15} aria-hidden /> Delete</button>}
            <Link to={`/accounts/customers/${c.id}/edit`} className="btn-primary"><Pencil size={15} aria-hidden /> Edit</Link>
          </>
        )}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Customer account">
            <dl className="grid gap-4 sm:grid-cols-3">
              <KV label="Business name">{c.business_name}</KV>
              <KV label="Shipping plan">{(c.shipping_plans || []).map(shippingPlanLabel).join(', ')}</KV>
              <KV label="Payment type">{paymentTermsFor(c).map(paymentTermLabel).join(', ')}</KV>
              <KV label="Owner name">{c.owner_name}</KV>
              <KV label="CNIC">{c.cnic}</KV>
              <KV label="NTN">{c.ntn}</KV>
              <KV label="Phone #">{c.phone}</KV>
              <KV label="Email">{c.email}</KV>
              <KV label="City">{c.city}</KV>
              <KV label="Branch">{c.branch?.name || c.branch_id}</KV>
              <div className="sm:col-span-3"><KV label="Office address">{c.office_address}</KV></div>
            </dl>
          </Card>

          <Card title={`Pickup & return addresses (${c.pickups.length})`}>
            <div className="grid gap-3 md:grid-cols-2">
              {c.pickups.map((p) => (
                <div key={p.id} className="rounded-xl border border-line p-3 text-sm">
                  <p className="mb-1 flex items-center gap-2 font-semibold">{p.label}{p.is_default && <span className="rounded-full bg-primary-light px-2 py-0.5 text-[10px] text-primary-dark">Default</span>}</p>
                  <p>{p.address}, {p.city}</p>
                  {(p.contact_name || p.phone) && <p className="text-ink-muted">{[p.contact_name, p.phone].filter(Boolean).join(' · ')}</p>}
                  <p className="mt-2 text-xs font-medium text-ink-muted">Return address</p>
                  <p>{p.return_same_as_pickup ? 'Same as pickup' : `${p.return_address}, ${p.return_city}${p.return_phone ? ` · ${p.return_phone}` : ''}`}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card title={`Points of contact (${c.contacts.length})`} bodyClass="">
            {c.contacts.length ? (
              <table className="w-full text-sm">
                <thead className="bg-surface text-xs text-ink-muted"><tr>{['Name', 'Designation', 'Phone #', 'Email'].map((h) => <th key={h} className="px-4 py-2 text-start font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {c.contacts.map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="px-4 py-2 font-medium">{p.name}{p.is_primary && <span className="ms-2 text-xs text-ink-muted">(primary)</span>}</td>
                      <td className="px-4 py-2">{p.designation || '-'}</td>
                      <td className="px-4 py-2">{p.phone}</td>
                      <td className="px-4 py-2">{p.email || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="p-4 text-sm text-ink-muted">No contacts added.</p>}
          </Card>

          <Card title={`Documents (${c.documents.length})`}><DocList docs={c.documents} /></Card>
        </div>

        <div className="space-y-4">
          <Card title="Status">
            <dl className="grid grid-cols-2 gap-4">
              <KV label="Account"><StatusBadge status={c.status} /></KV>
              <KV label="KYC"><StatusBadge status={c.kyc_status} /></KV>
              <KV label="Rate card">{c.rate_card}</KV>
              <KV label="Discount">{Number(c.discount_pct)}%</KV>
              <KV label="Credit limit">Rs {Number(c.credit_limit).toLocaleString()}</KV>
              <KV label="Portal login">{c.login ? c.login.email : 'None'}</KV>
            </dl>
          </Card>
          <Card title={`Bank accounts (${c.bank_accounts?.length || 0})`}>
            {!c.bank_accounts?.length ? <p className="text-sm text-ink-muted">No bank account added.</p> : (
              <ul className="space-y-3">
                {c.bank_accounts.map((b, i) => (
                  <li key={b.id || i} className="rounded-xl border border-line p-3 text-sm">
                    <p className="flex items-center gap-2 font-semibold">{b.bank_name}{i === 0 && <span className="rounded-full bg-primary-light px-2 py-0.5 text-[10px] text-primary-dark">Primary</span>}</p>
                    <p>{b.account_title}</p>
                    <p className="font-mono text-xs">{b.iban}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {c.notes && <Card title="Notes"><p className="whitespace-pre-wrap text-sm">{c.notes}</p></Card>}
        </div>
      </div>

      <FormModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        title={`Portal login for ${c.business_name}`}
        fields={LOGIN_FIELDS}
        defaultValues={{ password: '' }}
        extra={<p className="mt-3 text-xs text-ink-muted">Login email: <b>{c.email || 'none'}</b> (the customer&apos;s email). No confirmation email is sent.</p>}
        submitLabel="Create login"
        onSubmit={async (v) => {
          try {
            await createUser({ role: 'merchant', customer_id: c.id, email: c.email, password: v.password, full_name: c.owner_name, phone: c.phone, cnic: c.cnic || '', address: c.office_address || '', branch_id: c.branch_id });
            toast.success('Login created');
            setLoginOpen(false);
            load();
          } catch (e) { toast.error(e.message); }
        }}
      />
    </div>
  );
}

/** Merchant's own account page. */
export function MyAccount() {
  const merchantId = useAuth((s) => s.user.merchantId);
  if (!merchantId) {
    return <EmptyState icon={Users} title="No customer account linked" message="Your login is not linked to a customer account yet. Contact Selections support." />;
  }
  return <CustomerAccountView customerId={merchantId} />;
}

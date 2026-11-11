// Customer account onboarding form (create and edit). Sections follow the paper form:
// account and owner details, multiple pickup addresses each with its return address,
// points of contact, bank detail (IBAN, title, bank), KYC documents and cheque (10 MB each),
// commercial terms, and an optional portal login for the merchant.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import clsx from 'clsx';
import { Download, FileText, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { Card, FileDropzone, PageHeader, PageSkeleton } from '../../components/ui/index.jsx';
import { FieldError } from '../../components/forms/EntityForm.jsx';
import { RecordNotFound } from '../../components/layout/Fallbacks.jsx';
import { useAuth } from '../../store/authStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { CITY_NAMES, CITY_MAP } from '../../data/geo.js';
import { formatCnic, fmtDate } from '../../utils/format.js';
import { syncFromDb } from '../../hooks/useDbSync.js';
import { SHIPPING_PLANS } from '../../utils/pricing.js';
import {
  BUSINESS_NAME_MESSAGE, IBAN_MESSAGE, NTN_MESSAGE, PASSWORD_MESSAGE, cleanNtnInput, cleanPhoneInput, isBusinessName, isEmail, isIban, isNtn,
  isStrongPassword, normalizeIban, phoneInputProps, zCnicOptional, zEmailOptional, zPersonName, zPersonNameOptional, zPhone, zPhoneOptional,
} from '../../utils/validation.js';
import {
  CUSTOMER_TYPES, DOC_TYPES, RATE_CARDS, createUser, deleteCustomerDoc, docDownloadUrl, getCustomer, listBanks, listBranches,
  saveCustomer, uploadCustomerDoc, validateDoc,
} from '../../lib/api.js';

const req = (label, max = 200) => z.string().trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);
const opt = (label, max = 200) => z.string().trim().max(max, `${label} must be at most ${max} characters`);
const address = (label) => req(label, 250).refine((v) => v.length >= 5, `${label} is too short`);

const pickupSchema = z.object({
  id: z.string().optional(),
  label: opt('Label', 40),
  address: address('Pickup address'),
  city: req('City'),
  contact_name: zPersonNameOptional(),
  phone: zPhoneOptional(),
  return_same_as_pickup: z.boolean(),
  return_address: opt('Return address', 250),
  return_city: z.string().trim(),
  return_phone: zPhoneOptional(),
}).superRefine((p, ctx) => {
  if (p.return_same_as_pickup) return;
  if (p.return_address.length < 5) ctx.addIssue({ code: 'custom', path: ['return_address'], message: 'Return address is required' });
  if (!p.return_city) ctx.addIssue({ code: 'custom', path: ['return_city'], message: 'Return city is required' });
});

// A POC row left completely empty is ignored rather than reported as missing.
const blankRow = (c) => !c || ['name', 'designation', 'phone', 'email'].every((k) => !String(c[k] ?? '').trim());
const filledContact = z.object({
  name: zPersonName('POC name'),
  designation: opt('Designation', 60),
  phone: zPhone('POC phone'),
  email: zEmailOptional(),
});
const contactSchema = z.object({ name: z.string(), designation: z.string(), phone: z.string(), email: z.string() }).superRefine((c, ctx) => {
  if (blankRow(c)) return;
  const res = filledContact.safeParse(c);
  if (!res.success) res.error.issues.forEach((i) => ctx.addIssue(i));
});

const schema = z.object({
  business_name: req('Business name', 120).refine(isBusinessName, BUSINESS_NAME_MESSAGE),
  customer_type: req('Customer type'),
  shipping_plans: z.array(z.string()).min(1, 'Choose at least one shipping plan'),
  owner_name: zPersonName('Owner name'),
  cnic: zCnicOptional(),
  ntn: z.string().trim().refine((v) => !v || isNtn(v), NTN_MESSAGE),
  phone: zPhone('Phone'),
  email: zEmailOptional(),
  office_address: opt('Office address', 250),
  city: z.string().trim(),
  branch_id: req('Branch'),
  bank_name: z.string().trim(),
  account_title: opt('Account title', 100).refine((v) => !v || isBusinessName(v), 'Use letters and numbers only'),
  iban: z.string().transform(normalizeIban).refine((v) => !v || isIban(v), IBAN_MESSAGE),
  rate_card: z.string(),
  discount_pct: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Min 0').max(100, 'Max 100'),
  credit_limit: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative').max(100000000, 'Too large'),
  status: z.string(),
  kyc_status: z.string(),
  notes: opt('Notes', 1000),
  pickups: z.array(pickupSchema).min(1, 'Add at least one pickup address'),
  contacts: z.array(contactSchema),
  create_login: z.boolean(),
  login_password: z.string(),
}).superRefine((v, ctx) => {
  // Bank detail is all-or-nothing: a payout needs all three.
  const bank = [v.bank_name, v.account_title, v.iban];
  if (bank.some(Boolean) && !bank.every(Boolean)) {
    if (!v.bank_name) ctx.addIssue({ code: 'custom', path: ['bank_name'], message: 'Choose the bank' });
    if (!v.account_title) ctx.addIssue({ code: 'custom', path: ['account_title'], message: 'Account title is required' });
    if (!v.iban) ctx.addIssue({ code: 'custom', path: ['iban'], message: 'IBAN is required' });
  }
  if (v.create_login) {
    // The customer's email is the login email, so a login needs one.
    if (!isEmail(v.email)) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Email is required to create a portal login' });
    if (!isStrongPassword(v.login_password)) ctx.addIssue({ code: 'custom', path: ['login_password'], message: PASSWORD_MESSAGE });
  }
});

const blankPickup = (city = '') => ({ label: '', address: '', city, contact_name: '', phone: '', return_same_as_pickup: true, return_address: '', return_city: '', return_phone: '' });
const blankContact = () => ({ name: '', designation: '', phone: '', email: '' });

const EMPTY = {
  business_name: '', customer_type: '', shipping_plans: [], owner_name: '', cnic: '', ntn: '', phone: '', email: '', office_address: '', city: '', branch_id: '',
  bank_name: '', account_title: '', iban: '', rate_card: 'Standard', discount_pct: 0, credit_limit: 0, status: 'Active', kyc_status: 'Pending', notes: '',
  pickups: [blankPickup()], contacts: [blankContact()], create_login: false, login_password: '',
};

const s = (v) => v ?? '';
const fromDb = (c) => ({
  ...EMPTY,
  business_name: c.business_name, customer_type: c.customer_type, shipping_plans: c.shipping_plans || [], owner_name: c.owner_name, cnic: s(c.cnic), ntn: s(c.ntn), phone: c.phone,
  email: s(c.email), office_address: s(c.office_address), city: s(c.city), branch_id: s(c.branch_id), bank_name: s(c.bank_name),
  account_title: s(c.account_title), iban: s(c.iban), rate_card: c.rate_card, discount_pct: Number(c.discount_pct), credit_limit: Number(c.credit_limit),
  status: c.status, kyc_status: c.kyc_status, notes: s(c.notes),
  pickups: c.pickups?.length ? c.pickups.map((p) => ({
    id: p.id, label: s(p.label), address: p.address, city: p.city, contact_name: s(p.contact_name), phone: s(p.phone),
    return_same_as_pickup: p.return_same_as_pickup, return_address: s(p.return_address), return_city: s(p.return_city), return_phone: s(p.return_phone),
  })) : [blankPickup()],
  contacts: (c.contacts || []).map((p) => ({ name: p.name, designation: s(p.designation), phone: p.phone, email: s(p.email) })),
});

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Labelled input bound to react-hook-form. */
function Field({ label, name, register, error, required, className, type = 'text', format, children, ...rest }) {
  const id = `cf-${name.replace(/\./g, '-')}`;
  const reg = register(name);
  // `format` rewrites the typed value (e.g. CNIC dashes) before the form sees it.
  const onChange = format ? (e) => { e.target.value = format(e.target.value); return reg.onChange(e); } : reg.onChange;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}{required && <span className="text-danger"> *</span>}</label>
      {children ? children({ id, className: clsx('input', error && 'input-error'), ...reg }) : (
        <input id={id} type={type} className={clsx('input', error && 'input-error')} aria-invalid={!!error} {...rest} {...reg} onChange={onChange} />
      )}
      <FieldError message={error?.message} />
    </div>
  );
}

const Select = ({ options, placeholder = 'Select...' }) => ({ id, className, ...reg }) => (
  <select id={id} className={className} {...reg}>
    <option value="">{placeholder}</option>
    {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
  </select>
);

export function CustomerForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  // Set when opened from another screen (e.g. Create Shipment). Only in-app paths are allowed.
  const returnTo = /^\/(?!\/)[\w\-/]*$/.test(search.get('return') || '') ? search.get('return') : null;
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const me = useAuth((st) => st.user);
  const isAdmin = me.role === 'super_admin';
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [record, setRecord] = useState(null);
  const [branches, setBranches] = useState([]);
  const [banks, setBanks] = useState([]);
  const [docType, setDocType] = useState('CNIC Front');
  const [pending, setPending] = useState([]); // files chosen but not uploaded yet
  const [existingDocs, setExistingDocs] = useState([]);
  const [saving, setSaving] = useState(false);

  const { register, control, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY, mode: 'onTouched' });
  const pickups = useFieldArray({ control, name: 'pickups' });
  const contacts = useFieldArray({ control, name: 'contacts' });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [b, bk, c] = await Promise.all([listBranches(), listBanks(), isEdit ? getCustomer(id) : null]);
        if (!live) return;
        setBranches(b);
        setBanks(bk);
        if (isEdit) {
          if (!c) { setMissing(true); return; }
          setRecord(c);
          setExistingDocs(c.documents || []);
          reset(fromDb(c));
        } else if (me.role === 'branch_manager') {
          reset({ ...EMPTY, branch_id: me.branchId });
        }
      } catch (e) {
        toast.error(e.message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [id, isEdit, reset, me.role, me.branchId]);

  // Picking the office city suggests its branch and pre-fills the first pickup city.
  const city = watch('city');
  useEffect(() => {
    if (!city || isEdit) return;
    const branch = CITY_MAP[city]?.branchId;
    if (branch && me.role !== 'branch_manager') setValue('branch_id', branch);
    if (!watch('pickups.0.city')) setValue('pickups.0.city', city);
  }, [city]); // eslint-disable-line react-hooks/exhaustive-deps

  const bankOptions = useMemo(() => banks.map((b) => ({ value: b.name, label: b.country === 'AE' ? `${b.name} (UAE)` : b.name })), [banks]);
  const branchOptions = branches.filter((b) => isAdmin || b.id === me.branchId).map((b) => ({ value: b.id, label: `${b.name} (${b.id})` }));
  const createLogin = watch('create_login');

  const addFiles = (files) => {
    const ok = [];
    files.forEach((f) => { const problem = validateDoc(f); if (problem) toast.error(problem); else ok.push({ key: crypto.randomUUID(), docType, file: f }); });
    setPending((p) => [...p, ...ok]);
  };

  const download = async (doc) => {
    try { window.open(await docDownloadUrl(doc), '_blank', 'noopener'); } catch (e) { toast.error(e.message); }
  };

  const removeExisting = async (doc) => {
    if (!(await confirm({ title: 'Delete document?', message: `${doc.file_name} will be removed permanently.`, confirmLabel: 'Delete' }))) return;
    try { await deleteCustomerDoc(doc); setExistingDocs((d) => d.filter((x) => x.id !== doc.id)); toast.success('Document deleted'); } catch (e) { toast.error(e.message); }
  };

  const onSubmit = async (v) => {
    setSaving(true);
    try {
      const { pickups: pk, contacts: ct, create_login: wantLogin, login_password: loginPassword, ...customer } = v;
      const customerId = await saveCustomer({
        id: id || null,
        customer,
        pickups: pk.map((p) => (p.return_same_as_pickup ? { ...p, return_address: '', return_city: '', return_phone: '' } : p)),
        contacts: ct.filter((c) => !blankRow(c)),
      });

      const failed = [];
      for (const p of pending) {
        try { await uploadCustomerDoc(customerId, p.docType, p.file, me.id); } catch (e) { failed.push(`${p.file.name}: ${e.message}`); }
      }
      if (failed.length) toast.error(`Some documents did not upload. ${failed.join('; ')}`);

      if (wantLogin && !isEdit) {
        try {
          await createUser({ role: 'merchant', customer_id: customerId, email: v.email, password: loginPassword, full_name: v.owner_name, phone: v.phone, cnic: v.cnic, address: v.office_address, branch_id: v.branch_id });
          toast.success('Portal login created');
        } catch (e) {
          toast.error(`Customer saved, but the login was not created: ${e.message}`);
        }
      }

      toast.success(isEdit ? 'Customer account updated' : 'Customer account created');
      if (returnTo) {
        // The booking form needs the new customer in its list before it can select it.
        await syncFromDb().catch(() => {});
        navigate(`${returnTo}?customer=${customerId}`);
      } else {
        syncFromDb().catch(() => {});
        navigate(`/accounts/customers/${customerId}`);
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageSkeleton />;
  if (missing) return <RecordNotFound what="Customer account" backTo="/accounts/customers" backLabel="Back to customers" />;

  const err = (path) => path.split('.').reduce((o, k) => o?.[k], errors);

  return (
    <form onSubmit={handleSubmit(onSubmit, () => toast.error('Please fix the highlighted fields'))} noValidate>
      <PageHeader
        title={isEdit ? `Edit ${record.business_name}` : 'New Customer Account'}
        subtitle={isEdit ? `Account ${record.account_no}` : returnTo ? 'After saving you go back to your booking with this customer selected.' : 'Business, pickup and return addresses, contacts, bank and documents'}
        actions={(
          <>
            <button type="button" className="btn-outline" onClick={() => navigate(-1)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />} {isEdit ? 'Save changes' : 'Create account'}
            </button>
          </>
        )}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="1. Customer account">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business name" name="business_name" required register={register} error={errors.business_name} placeholder="e.g. Zaryab Fashion House" maxLength={120} />
              <Field label="Customer type" name="customer_type" required register={register} error={errors.customer_type}>{Select({ options: CUSTOMER_TYPES })}</Field>
              <Field label="Owner name" name="owner_name" required register={register} error={errors.owner_name} maxLength={80} placeholder="Owner's full name, e.g. Ehtisham Malik" />
              <Field label="CNIC" name="cnic" register={register} error={errors.cnic} placeholder="35202-1234567-1" inputMode="numeric" maxLength={15} format={formatCnic} />
              <Field label="NTN" name="ntn" register={register} error={errors.ntn} placeholder="1234567-8" inputMode="numeric" maxLength={15} format={cleanNtnInput} />
              <Field label="Phone #" name="phone" required register={register} error={errors.phone} {...phoneInputProps} format={cleanPhoneInput} />
              <Field label="Email" name="email" register={register} error={errors.email} type="email" maxLength={254} placeholder="name@company.com" />
              <Field label="City" name="city" register={register} error={errors.city}>{Select({ options: CITY_NAMES })}</Field>
              <Field label="Office address" name="office_address" register={register} error={errors.office_address} className="sm:col-span-2" placeholder="Office no., building, street, area, e.g. Office 7, Main Boulevard, Gulberg III" maxLength={250} />
              <Field label="Branch" name="branch_id" required register={register} error={errors.branch_id}>
                {(p) => (isAdmin
                  ? <select {...p}><option value="">Select...</option>{branchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                  // Branch managers always add customers to their own branch.
                  : <><input type="hidden" {...p} /><input className="input" readOnly value={branchOptions[0]?.label || me.branchId || ''} aria-label="Branch" /></>)}
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="label">Shipping plan<span className="text-danger"> *</span> <span className="font-normal text-ink-muted">(choose one or more; bookings use it automatically)</span></legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {SHIPPING_PLANS.map((pl) => {
                    const on = (watch('shipping_plans') || []).includes(pl.value);
                    return (
                      <label key={pl.value} className={clsx('flex cursor-pointer gap-2 rounded-lg border p-3 text-sm', on ? 'border-primary-hover bg-primary-light' : 'border-line hover:bg-surface', errors.shipping_plans && !on && 'border-danger')}>
                        <input type="checkbox" value={pl.value} className="mt-0.5 h-4 w-4 shrink-0 accent-primary-hover" {...register('shipping_plans')} />
                        <span><span className="block font-semibold">{pl.label}</span><span className="text-xs text-ink-muted">{pl.hint}</span></span>
                      </label>
                    );
                  })}
                </div>
                <FieldError message={errors.shipping_plans?.message} />
              </fieldset>
            </div>
          </Card>

          <Card
            title="2. Pickup & return addresses"
            actions={<button type="button" className="btn-outline btn-sm" onClick={() => pickups.append(blankPickup(watch('city')))}><Plus size={14} aria-hidden /> Add pickup address</button>}
          >
            <FieldError message={errors.pickups?.message || errors.pickups?.root?.message} />
            <div className="space-y-4">
              {pickups.fields.map((f, i) => {
                const same = watch(`pickups.${i}.return_same_as_pickup`);
                return (
                  <fieldset key={f.id} className="rounded-xl border border-line p-3">
                    <legend className="flex items-center gap-2 px-1 text-xs font-semibold text-ink-muted">
                      Pickup {i + 1}{i === 0 && <span className="rounded-full bg-primary-light px-2 py-0.5 text-[10px] text-primary-dark">Default</span>}
                    </legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Label" name={`pickups.${i}.label`} register={register} error={err(`pickups.${i}.label`)} placeholder="e.g. Main warehouse" />
                      <Field label="City" name={`pickups.${i}.city`} required register={register} error={err(`pickups.${i}.city`)}>{Select({ options: CITY_NAMES })}</Field>
                      <Field label="Pickup address" name={`pickups.${i}.address`} required register={register} error={err(`pickups.${i}.address`)} className="sm:col-span-2" placeholder="Where the rider collects parcels: shop / warehouse, street, area" maxLength={250} />
                      <Field label="Contact person" name={`pickups.${i}.contact_name`} register={register} error={err(`pickups.${i}.contact_name`)} placeholder="Who hands over parcels (optional)" maxLength={80} />
                      <Field label="Phone #" name={`pickups.${i}.phone`} {...phoneInputProps} format={cleanPhoneInput} register={register} error={err(`pickups.${i}.phone`)} />
                      <label className="flex items-center gap-2 text-sm sm:col-span-2">
                        <input type="checkbox" className="h-4 w-4 accent-primary-hover" {...register(`pickups.${i}.return_same_as_pickup`)} />
                        Return address is the same as this pickup address
                      </label>
                      {!same && (
                        <>
                          <Field label="Return address" name={`pickups.${i}.return_address`} required register={register} error={err(`pickups.${i}.return_address`)} className="sm:col-span-2" placeholder="Where returned (RTO) parcels go back to" maxLength={250} />
                          <Field label="Return city" name={`pickups.${i}.return_city`} required register={register} error={err(`pickups.${i}.return_city`)}>{Select({ options: CITY_NAMES })}</Field>
                          <Field label="Return phone #" name={`pickups.${i}.return_phone`} {...phoneInputProps} format={cleanPhoneInput} register={register} error={err(`pickups.${i}.return_phone`)} />
                        </>
                      )}
                    </div>
                    {pickups.fields.length > 1 && (
                      <button type="button" className="btn-ghost btn-sm mt-2 text-danger" onClick={() => pickups.remove(i)}><Trash2 size={14} aria-hidden /> Remove</button>
                    )}
                  </fieldset>
                );
              })}
            </div>
          </Card>

          <Card
            title="3. Points of contact (POC)"
            actions={<button type="button" className="btn-outline btn-sm" onClick={() => contacts.append(blankContact())}><Plus size={14} aria-hidden /> Add POC</button>}
          >
            {!contacts.fields.length && <p className="text-sm text-ink-muted">No contacts added. The owner is contacted by default.</p>}
            <div className="space-y-3">
              {contacts.fields.map((f, i) => (
                <div key={f.id} className="grid items-start gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                  <Field label={i === 0 ? 'Name (primary)' : 'Name'} name={`contacts.${i}.name`} required register={register} error={err(`contacts.${i}.name`)} placeholder="e.g. Sara Khan" maxLength={80} />
                  <Field label="Designation" name={`contacts.${i}.designation`} register={register} error={err(`contacts.${i}.designation`)} placeholder="e.g. Manager" />
                  <Field label="Phone #" name={`contacts.${i}.phone`} {...phoneInputProps} format={cleanPhoneInput} required register={register} error={err(`contacts.${i}.phone`)} />
                  <Field label="Email" name={`contacts.${i}.email`} type="email" register={register} error={err(`contacts.${i}.email`)} placeholder="Optional" maxLength={254} />
                  <button type="button" className="btn-ghost btn-sm mt-5 !p-2 text-danger" aria-label={`Remove contact ${i + 1}`} onClick={() => contacts.remove(i)}><X size={16} /></button>
                </div>
              ))}
            </div>
          </Card>

          <Card title="4. Bank detail">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Bank name" name="bank_name" register={register} error={errors.bank_name}>{Select({ options: bankOptions, placeholder: 'Select bank...' })}</Field>
              <Field label="Account title" name="account_title" register={register} error={errors.account_title} placeholder="Name on the bank account" maxLength={100} />
              <Field label="IBAN #" name="iban" register={register} error={errors.iban} placeholder="PK36SCBL0000001123456702" className="font-mono" maxLength={34} format={(x) => x.toUpperCase().replace(/[^A-Z0-9 ]/g, '')} />
            </div>
            <p className="mt-2 text-xs text-ink-muted">COD payouts are sent to this account. Leave all three empty if not known yet.</p>
          </Card>

          <Card title="5. Documents (CNIC, cheque, NTN...)">
            <div className="mb-3 grid gap-3 sm:grid-cols-[200px_1fr]">
              <div>
                <label htmlFor="doc-type" className="label">Document type</label>
                <select id="doc-type" className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>{DOC_TYPES.map((d) => <option key={d}>{d}</option>)}</select>
              </div>
              <FileDropzone compact multiple onFiles={addFiles} accept=".pdf,.jpg,.jpeg,.png,.webp" hint="Drop files or click to upload (max 10 MB each)" />
            </div>
            {(existingDocs.length > 0 || pending.length > 0) && (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {existingDocs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <FileText size={16} className="shrink-0 text-ink-muted" aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.file_name}</span><span className="text-xs text-ink-muted">{d.doc_type} · {fmtSize(d.size_bytes)} · {fmtDate(d.uploaded_at)}</span></span>
                    <button type="button" className="btn-ghost btn-sm !p-2" aria-label={`Download ${d.file_name}`} onClick={() => download(d)}><Download size={15} /></button>
                    <button type="button" className="btn-ghost btn-sm !p-2 text-danger" aria-label={`Delete ${d.file_name}`} onClick={() => removeExisting(d)}><Trash2 size={15} /></button>
                  </li>
                ))}
                {pending.map((p) => (
                  <li key={p.key} className="flex items-center gap-3 bg-primary-light/40 px-3 py-2 text-sm">
                    <FileText size={16} className="shrink-0 text-ink-muted" aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.file.name}</span><span className="text-xs text-ink-muted">{p.docType} · {fmtSize(p.file.size)} · uploads on save</span></span>
                    <button type="button" className="btn-ghost btn-sm !p-2" aria-label={`Remove ${p.file.name}`} onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}><X size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Account terms">
            <div className="grid gap-3">
              <Field label="Rate card" name="rate_card" register={register} error={errors.rate_card}>{(p) => <select {...p}>{RATE_CARDS.map((r) => <option key={r}>{r}</option>)}</select>}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Discount %" name="discount_pct" type="number" step="0.5" register={register} error={errors.discount_pct} />
                <Field label="Credit limit (PKR)" name="credit_limit" type="number" register={register} error={errors.credit_limit} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status" name="status" register={register} error={errors.status}>{(p) => <select {...p}>{['Active', 'Inactive', 'Suspended'].map((r) => <option key={r}>{r}</option>)}</select>}</Field>
                <Field label="KYC" name="kyc_status" register={register} error={errors.kyc_status}>{(p) => <select {...p}>{['Pending', 'Verified', 'Rejected'].map((r) => <option key={r}>{r}</option>)}</select>}</Field>
              </div>
              <Field label="Notes" name="notes" register={register} error={errors.notes}>{(p) => <textarea rows={3} {...p} />}</Field>
            </div>
          </Card>

          {!isEdit && isAdmin && (
            <Card title="Portal login">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary-hover" {...register('create_login')} />
                Create a login so this customer can book and track parcels
              </label>
              {createLogin && (
                <div className="mt-3 grid gap-3">
                  <div>
                    <p className="label">Login email</p>
                    <p className={clsx('input bg-surface', !watch('email') && 'text-ink-muted')}>{watch('email') || 'Enter the Email in section 1'}</p>
                    <p className="mt-1 text-xs text-ink-muted">Uses the customer&apos;s Email above. No confirmation email is sent; the login works straight away.</p>
                  </div>
                  <Field label="Password" name="login_password" type="password" required placeholder="8+ characters, a letter and a number" maxLength={72} register={register} error={errors.login_password} autoComplete="new-password" />
                  <p className="text-xs text-ink-muted">Share the email and password with the customer. You can reset the password later from Users & Roles.</p>
                </div>
              )}
            </Card>
          )}
          {isEdit && record.login && (
            <Card title="Portal login"><p className="text-sm">{record.login.email}</p><p className="text-xs text-ink-muted">{record.login.status}</p></Card>
          )}
        </div>
      </div>
    </form>
  );
}

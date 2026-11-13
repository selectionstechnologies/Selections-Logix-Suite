// Multi-step booking: one react-hook-form instance. zod checks each field's shape when moving
// forward; rules that depend on other steps (ID format by country, product restrictions, payment
// amounts) live in crossRules. The summary panel recalculates on every change and an unfinished
// booking is kept as a draft in localStorage.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { findReceiver, findReceiverByCnic, saveReceiver } from '../../lib/api.js';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertTriangle, Banknote, Loader2, CheckCircle2, ChevronLeft, ChevronRight, Copy, CreditCard, Info, Pencil, Plus, Printer, Smartphone, Trash2, UserCheck, Wallet,
} from 'lucide-react';
import clsx from 'clsx';
import { Card, PageHeader, Stepper } from '../../components/ui/index.jsx';
import { FieldError } from '../../components/forms/EntityForm.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';
import { CITY_MAP, CITY_NAMES, ZONES } from '../../data/geo.js';
import { COURIER_NAMES } from '../../data/config.js';
import {
  ONLINE_CHANNELS, PACKAGING, PAYMENT_METHODS, PAYMENT_TYPES, PRODUCT_TYPES, SERVICES, UNITS,
  PAYMENT_TERMS, SHIPPING_PLANS, paymentMethodLabel, paymentTerm, paymentTermLabel, shippingPlan, paymentTypeLabel, productTypeLabel, quote, serviceLabel, volumetricWeight,
} from '../../utils/pricing.js';
import { cleanPhoneInput, isPhone, phoneInputProps, zPhone, zPhoneOptional } from '../../utils/validation.js';
import { CNIC_PATTERN, fmtCurrency, formatCnic, phoneKey, sum, toPKR } from '../../utils/format.js';
import { LabelPrintModal } from './ShipmentList.jsx';

const phone = zPhone('Phone');
const num = (msg = 'Required') => z.coerce.number({ invalid_type_error: msg });

const schema = z.object({
  merchantId: z.string().min(1, 'Choose a merchant'),
  plan: z.string(),
  payTerm: z.string(),
  sender: z.object({
    name: z.string().trim().min(2, 'Name is required'),
    phone,
    address: z.string().trim().min(5, 'Address is required'),
    city: z.string().min(1, 'City is required'),
  }),
  receiver: z.object({
    phone,
    altPhone: zPhoneOptional(),
    name: z.string().trim().min(2, 'Name is required'),
    cnic: z.string().trim().min(1, 'CNIC is required'),
    address: z.string().trim().min(5, 'Complete address is required'),
    landmark: z.string().trim().max(120, 'Keep it under 120 characters'),
    city: z.string().min(1, 'City is required'),
    zone: z.string().min(1, 'Zone is required'),
  }),
  productType: z.string().min(1, 'Choose a product type'),
  items: z.array(z.object({
    name: z.string().trim().min(1, 'Product name is required'),
    sku: z.string().trim().max(40, 'Too long'),
    qty: num().int('Whole number').min(1, 'At least 1'),
    unit: z.string().min(1, 'Choose a unit'),
    value: num().min(0, 'Cannot be negative'),
    hsCode: z.string().trim(),
  })).min(1, 'Add at least one product'),
  pieces: num().int('Whole number').min(1, 'At least 1').max(5000, 'At most 5000 pieces'),
  weight: num('Weight is required').positive('Weight must be above 0').max(40000, 'At most 40,000 kg per booking'),
  length: z.coerce.number().min(0, 'Cannot be negative').optional(),
  width: z.coerce.number().min(0, 'Cannot be negative').optional(),
  height: z.coerce.number().min(0, 'Cannot be negative').optional(),
  declaredValue: z.coerce.number().min(0),
  packaging: z.string(),
  service: z.string().min(1, 'Choose a service'),
  courier: z.string(),
  paymentType: z.enum(['prepaid', 'cod', 'topay']),
  cod: num('Enter an amount').min(0, 'Cannot be negative'),
  insurance: z.boolean(),
  notes: z.string().max(300, 'Keep instructions under 300 characters'),
  payment: z.object({ method: z.string(), channel: z.string(), reference: z.string().trim(), received: z.string() }),
});

const STEPS = [
  { title: 'Sender', desc: 'Who is sending the parcel.', fields: ['merchantId', 'plan', 'payTerm', 'sender.name', 'sender.phone', 'sender.address', 'sender.city'] },
  { title: 'Receiver', desc: 'Who will receive it. Enter the phone first to reuse details of a previous receiver.', fields: ['receiver.phone', 'receiver.altPhone', 'receiver.name', 'receiver.cnic', 'receiver.address', 'receiver.landmark', 'receiver.city', 'receiver.zone'] },
  { title: 'Products', desc: 'What is inside. Add every product so the declared value is correct.', fields: ['productType', 'items'] },
  { title: 'Package', desc: 'Pieces, weight and size decide the chargeable weight.', fields: ['pieces', 'weight', 'length', 'width', 'height', 'packaging'] },
  { title: 'Service', desc: 'Delivery speed and who pays.', fields: ['service', 'paymentType', 'cod', 'insurance', 'courier', 'notes'] },
  { title: 'Payment', desc: 'How the delivery charges are paid.', fields: ['payment.method', 'payment.channel', 'payment.reference', 'payment.received'] },
  { title: 'Review', desc: 'Check everything before confirming. Use Edit to go back to a step.', fields: [] },
];
const LAST = STEPS.length - 1;
const DUPLICATE_WINDOW = 30 * 60000;
const DIMS_ABOVE_KG = 1; // parcels heavier than this need length, width and height

const blankItem = () => ({ name: '', sku: '', qty: 1, unit: 'Pcs', value: 0, hsCode: '' });
const blank = (merchantId = '') => ({
  merchantId,
  plan: '',
  payTerm: '',
  sender: { name: '', phone: '', address: '', city: '' },
  receiver: { phone: '', altPhone: '', name: '', cnic: '', address: '', landmark: '', city: '', zone: '' },
  productType: 'parcel',
  items: [blankItem()],
  pieces: 1, weight: 0.5, length: '', width: '', height: '', declaredValue: 0, packaging: 'none',
  service: 'next-day', courier: COURIER_NAMES[0], paymentType: 'prepaid', cod: 0, insurance: false, notes: '',
  payment: { method: '', channel: '', reference: '', received: '' },
});

const readDraft = (key) => {
  try {
    const d = JSON.parse(localStorage.getItem(key));
    return d?.values ? d : null;
  } catch { return null; }
};
const writeDraft = (key, value) => {
  try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch { /* storage blocked */ }
};

const sameName = (a = '', b = '') => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/** Rules that span steps. Each issue says which step to send the user back to. */
function crossRules(v, { crossBorder, due, duePKR, credit, currency, saved, renameOk }) {
  const out = [];
  const add = (step, path, message) => out.push({ step, path, message });
  if (v.receiver.cnic && !CNIC_PATTERN.test(v.receiver.cnic)) add(1, 'receiver.cnic', 'Enter a Pakistani CNIC as 35202-1234567-1 (13 digits)');
  if (v.receiver.zone && !(ZONES[v.receiver.city] || []).some((z) => z.value === v.receiver.zone)) add(1, 'receiver.zone', 'Choose a zone in this city');
  if (v.receiver.altPhone && phoneKey(v.receiver.altPhone) === phoneKey(v.receiver.phone)) add(1, 'receiver.altPhone', 'Second number must be different from the first');
  if (saved && !renameOk && v.receiver.name && sameName(v.receiver.name, saved.name) === false) {
    add(1, 'receiver.name', `${saved.phone} is already saved for "${saved.name}". Use the saved details, or choose "Update saved name".`);
  }

  const type = PRODUCT_TYPES.find((p) => p.value === v.productType) || {};
  if (type.liquid && crossBorder) add(2, 'productType', 'Liquids cannot be shipped cross-border');
  if (crossBorder) v.items.forEach((it, i) => { if (!it.hsCode?.trim()) add(2, `items.${i}.hsCode`, 'HS code is required for International'); });

  if (type.perishable && !['same-day', 'next-day'].includes(v.service)) add(4, 'service', 'Food and perishables ship Same Day or Next Day only');
  if (type.mustInsure && !v.insurance) add(4, 'insurance', 'Valuables must be insured');
  else if (v.insurance && !(Number(v.declaredValue) > 0)) add(4, 'insurance', 'Insurance needs a declared value. Add product prices first.');
  if (v.paymentType === 'cod' && !(Number(v.cod) > 0)) add(4, 'cod', 'Enter the amount the rider should collect');
  // Parcels stay within courier limits; heavier loads need the Full Truck Load or Cargo plan.
  if (Number(v.weight) > DIMS_ABOVE_KG) {
    [['length', 'Length'], ['width', 'Width'], ['height', 'Height']].forEach(([k, label]) => {
      if (!(Number(v[k]) > 0)) add(3, k, `${label} is required for parcels over ${DIMS_ABOVE_KG} kg`);
    });
  }
  if (!shippingPlan(v.plan)?.heavy) {
    if (Number(v.weight) > 1000) add(3, 'weight', 'Over 1000 kg needs the Full Truck Load or Cargo plan');
    if (Number(v.pieces) > 50) add(3, 'pieces', 'More than 50 pieces needs the Full Truck Load or Cargo plan');
  }

  if (v.paymentType !== 'topay') {
    const { method, channel, reference, received } = v.payment;
    if (!method) add(5, 'payment.method', 'Choose how the charges are paid');
    if (method === 'cash' && !(Number(received) >= due)) add(5, 'payment.received', `Received amount must be at least ${fmtCurrency(due, currency)}`);
    if (method === 'online' && !channel) add(5, 'payment.channel', 'Choose the payment channel');
    if (method === 'online' && reference.length < 4) add(5, 'payment.reference', 'Enter the transaction ID');
    if (method === 'credit' && credit.available < duePKR) add(5, 'payment.method', 'Not enough credit available on this account');
    if (method === 'cod-deduct' && Number(v.cod) < due) add(5, 'payment.method', 'COD amount is less than the charges, so they cannot be deducted');
  }
  return out;
}

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

function Field({ label, name, register, errors, required, children, type = 'text', placeholder, step, className, hint, format, ...rest }) {
  const err = get(errors, name);
  const reg = children ? null : register(name);
  // `format` cleans the typed value (e.g. phone digits) before the form stores it.
  const onChange = reg && format ? (e) => { e.target.value = format(e.target.value); return reg.onChange(e); } : reg?.onChange;
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}{required && <span className="text-danger"> *</span>}</label>
      {children || <input id={name} type={type} step={step} placeholder={placeholder} aria-invalid={!!err} className={clsx('input', err && 'input-error')} {...reg} onChange={onChange} {...rest} />}
      {hint && !err && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      <FieldError message={err?.message} />
    </div>
  );
}

function SenderForm({ register, errors }) {
  const cityErr = errors.sender?.city;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" name="sender.name" register={register} errors={errors} required placeholder="Sender or business name, e.g. Zaryab Fashion" maxLength={80} />
      <Field label="Phone" name="sender.phone" register={register} errors={errors} required {...phoneInputProps} format={cleanPhoneInput} />
      <Field label="Address" name="sender.address" register={register} errors={errors} required placeholder="Pickup address: shop / warehouse, street, area" maxLength={250} className="sm:col-span-2" />
      <Field label="City" name="sender.city" register={register} errors={errors} required>
        <select id="sender.city" className={clsx('input', cityErr && 'input-error')} {...register('sender.city')}>
          <option value="">Select...</option>
          {CITY_NAMES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
    </div>
  );
}

/** A radio button drawn as a selectable card. */
function ChoiceCard({ name, value, register, checked, disabled, title, hint, extra, icon: Icon }) {
  return (
    <label className={clsx(
      'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink',
      checked ? 'border-primary-hover bg-primary-light' : 'border-line hover:border-gray-400',
      disabled && 'cursor-not-allowed opacity-40 hover:border-line',
    )}
    >
      <input type="radio" value={value} disabled={disabled} className="sr-only" {...register(name)} />
      <span className="flex items-center gap-2 font-semibold">
        {Icon && <Icon size={15} aria-hidden />}
        <span className="flex-1">{title}</span>
        {extra && <span className="text-xs font-semibold tabular-nums">{extra}</span>}
      </span>
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

function ReviewBlock({ title, step, onEdit, children }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
        <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink" onClick={() => onEdit(step)}><Pencil size={12} aria-hidden /> Edit</button>
      </div>
      <div className="space-y-0.5 text-sm">{children}</div>
    </div>
  );
}

/** Shows every option; only those on the customer account can be picked, the rest are greyed out. */
function OptionPicker({ legend, all, allowed, value, onPick }) {
  return (
    <fieldset>
      <legend className="label">{legend} <span className="font-normal text-ink-muted">(set on the customer account)</span></legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {all.map((o) => {
          const enabled = allowed.includes(o.value);
          const on = enabled && value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={!enabled}
              onClick={() => onPick(o.value)}
              aria-pressed={on}
              title={enabled ? undefined : 'Not enabled on this customer account'}
              className={clsx(
                'rounded-lg border p-3 text-start text-sm',
                on && 'border-primary-hover bg-primary-light',
                enabled && !on && 'border-line hover:bg-surface',
                !enabled && 'cursor-not-allowed border-dashed border-line bg-surface opacity-60',
              )}
            >
              <span className="flex items-center justify-between gap-2 font-semibold">
                {o.label}
                {!enabled && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-ink-muted">Not on account</span>}
              </span>
              <span className="text-xs text-ink-muted">{o.hint}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Notice({ tone = 'info', children }) {
  const Icon = tone === 'warn' ? AlertTriangle : Info;
  return (
    <p className={clsx('flex gap-2 rounded-lg px-3 py-2 text-sm', tone === 'warn' ? 'bg-danger-light text-danger-dark' : 'bg-primary-light')}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden /><span>{children}</span>
    </p>
  );
}

function PriceLine({ label, value, currency, bold }) {
  if (!bold && !value) return null;
  return (
    <div className={clsx('flex justify-between py-1 text-sm', bold && 'mt-1 border-t border-line pt-2 text-base font-bold')}>
      <span className={bold ? '' : 'text-ink-muted'}>{label}</span>
      <span className="tabular-nums">{fmtCurrency(value, currency)}</span>
    </div>
  );
}

const METHOD_ICONS = { cash: Banknote, online: Smartphone, credit: CreditCard, 'cod-deduct': Wallet };

export function CreateShipment() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const { merchants, shipments, rateCard, merchantOverrides, createShipment } = useData();
  const isMerchant = user.role === 'merchant';
  const canAddCustomer = ['super_admin', 'branch_manager'].includes(user.role);
  const [params, setParams] = useSearchParams();
  // Opens the customer form; saving it comes back here with the new customer selected.
  // The booking draft is saved as you type, so nothing entered so far is lost.
  const addCustomer = () => navigate('/accounts/customers/new?return=/shipments/new');
  const draftKey = `slx-booking-draft-${user.email || user.role}`;
  const [draft] = useState(() => readDraft(draftKey));
  const [restored, setRestored] = useState(!!draft);
  const [step, setStep] = useState(draft?.step ?? 0);
  const [created, setCreated] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [saved, setSaved] = useState(null); // receiver saved in the database for the typed phone
  const [lookingUp, setLookingUp] = useState(false);
  const [renameOk, setRenameOk] = useState(false); // user chose to rename the saved receiver
  const [cnicClash, setCnicClash] = useState(null); // another saved receiver with this CNIC
  const filledFrom = useRef(null); // id of the saved receiver the fields were filled from
  const [hasAlt, setHasAlt] = useState(false);

  const bookable = useMemo(() => merchants.filter((m) => m.status === 'Active' || m.id === user.merchantId), [merchants, user]);

  const {
    register, handleSubmit, watch, setValue, getValues, trigger, setError, control, reset, formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(schema), defaultValues: draft ? { ...blank(), ...draft.values } : blank(), mode: 'onChange' });
  const { fields, append, insert, remove } = useFieldArray({ control, name: 'items' });

  const v = watch();
  // A second number found on a returning receiver also opens the field.
  const showAlt = hasAlt || !!v.receiver?.altPhone;
  const merchantId = v.merchantId;
  const merchant = merchants.find((m) => m.id === merchantId);
  const type = PRODUCT_TYPES.find((p) => p.value === v.productType) || {};
  const plans = (merchant?.shippingPlans || []).map(shippingPlan).filter(Boolean);
  const activePlan = plans.length ? shippingPlan(v.plan) : null;
  const terms = (merchant?.paymentTypes || []).map(paymentTerm).filter(Boolean);
  const activeTerm = terms.length ? paymentTerm(v.payTerm) : null;

  // The customer's shipping plan decides the service (Full Truck Load and Cargo go Economy);
  // the payment type comes from the payment types allowed on the account.
  const applyPlan = (value) => {
    setValue('plan', value || '');
    const pl = shippingPlan(value);
    if (pl?.service) setValue('service', pl.service);
  };
  const applyTerm = (value) => {
    setValue('payTerm', value || '');
    const t = paymentTerm(value);
    if (!t) return;
    setValue('paymentType', t.paymentType, { shouldValidate: true });
    setValue('payment.method', t.method || '');
  };

  // Picking a merchant fills the sender from their default pickup location and applies their plan.
  const applyMerchant = (id) => {
    setValue('merchantId', id, { shouldValidate: true });
    const m = merchants.find((x) => x.id === id);
    if (!m) return;
    setValue('sender.name', m.name, { shouldValidate: true });
    setValue('sender.phone', m.phone, { shouldValidate: true });
    setValue('sender.address', m.pickups[0]?.address || m.address, { shouldValidate: true });
    setValue('sender.city', m.city, { shouldValidate: true });
    applyPlan(m.shippingPlans?.[0]);
    applyTerm(m.paymentTypes?.[0]);
  };
  useEffect(() => { if (isMerchant) applyMerchant(user.merchantId); /* eslint-disable-next-line */ }, [isMerchant]);
  // Back from "Add new customer": select the customer just created once it has loaded.
  const newCustomerId = params.get('customer');
  useEffect(() => {
    if (!newCustomerId || !merchants.some((m) => m.id === newCustomerId)) return;
    applyMerchant(newCustomerId);
    setParams({}, { replace: true });
    toast.success('New customer selected');
    // eslint-disable-next-line
  }, [newCustomerId, merchants]);

  // Customer records load from the database just after sign-in: fill in once the record arrives,
  // and keep the chosen plan valid if the customer's plans change.
  const planKey = `${(merchant?.shippingPlans || []).join()}|${(merchant?.paymentTypes || []).join()}`;
  useEffect(() => {
    if (!merchant) return;
    if (isMerchant && !getValues('sender.name')) applyMerchant(merchant.id);
    else if (merchant.shippingPlans?.length && !merchant.shippingPlans.includes(getValues('plan'))) applyPlan(merchant.shippingPlans[0]);
    else if (!merchant.shippingPlans?.length && getValues('plan')) setValue('plan', '');
    if (!isMerchant || getValues('sender.name')) {
      if (merchant.paymentTypes?.length && !merchant.paymentTypes.includes(getValues('payTerm'))) applyTerm(merchant.paymentTypes[0]);
      else if (!merchant.paymentTypes?.length && getValues('payTerm')) setValue('payTerm', '');
    }
    // eslint-disable-next-line
  }, [merchant?.id, planKey]);

  // Size is only asked above 1 kg; clear hidden values so they cannot change the price.
  const lightParcel = !(Number(v.weight) > DIMS_ABOVE_KG);
  useEffect(() => {
    if (!lightParcel) return;
    ['length', 'width', 'height'].forEach((k) => { if (getValues(k) !== '' && getValues(k) != null) setValue(k, ''); });
    // eslint-disable-next-line
  }, [lightParcel]);

  // Declared value always equals the product lines, so it cannot drift from what was entered.
  const itemsKey = JSON.stringify((v.items || []).map((i) => [i.qty, i.value]));
  useEffect(() => {
    setValue('declaredValue', sum(v.items || [], (i) => (Number(i.qty) || 0) * (Number(i.value) || 0)));
    // eslint-disable-next-line
  }, [itemsKey]);

  const originCity = v.sender?.city;
  const destCity = v.receiver?.city;
  const destInfo = CITY_MAP[destCity];
  const crossBorder = originCity && destCity && CITY_MAP[originCity]?.country !== destInfo?.country;
  const currency = destInfo?.currency || 'PKR';
  const zones = ZONES[destCity] || [];

  // Keep the service valid for the lane: a cross-border lane is always International.
  useEffect(() => {
    if (crossBorder && v.service !== 'international') setValue('service', 'international');
    if (!crossBorder && v.service === 'international') setValue('service', 'next-day');
    // eslint-disable-next-line
  }, [crossBorder]);

  // A zone belongs to a city, so changing the city clears a zone that no longer fits.
  useEffect(() => {
    if (v.receiver.zone && !zones.some((z) => z.value === v.receiver.zone)) setValue('receiver.zone', '');
    // eslint-disable-next-line
  }, [destCity]);

  // COD amount only exists for COD bookings; it starts at the goods value.
  useEffect(() => {
    if (v.paymentType !== 'cod' && Number(v.cod) !== 0) setValue('cod', 0);
    if (v.paymentType === 'cod' && !(Number(v.cod) > 0) && v.declaredValue > 0) setValue('cod', v.declaredValue, { shouldValidate: true });
    // eslint-disable-next-line
  }, [v.paymentType]);

  const override = merchantOverrides.find((o) => o.merchantId === merchantId) || { discountPct: merchant?.discountPct };
  const quoteFor = (service) => quote({
    originCity, destCity, service, weight: v.weight, length: v.length, width: v.width, height: v.height,
    cod: v.cod, declaredValue: v.declaredValue, insurance: v.insurance, packaging: v.packaging, currency,
  }, rateCard, override);
  const quoteKey = JSON.stringify([originCity, destCity, v.service, v.weight, v.length, v.width, v.height, v.cod, v.declaredValue, v.insurance, v.packaging, currency, override?.discountPct]);
  // eslint-disable-next-line
  const q = useMemo(() => (originCity && destCity ? quoteFor(v.service) : null), [quoteKey, rateCard]);
  // eslint-disable-next-line
  const servicePrices = useMemo(() => (originCity && destCity ? Object.fromEntries(SERVICES.map((s) => [s.value, quoteFor(s.value).total])) : {}), [quoteKey, rateCard]);

  const due = q?.total || 0;
  const duePKR = toPKR(due, currency);
  // Credit in use: charges billed to this account that are not cancelled.
  const outstanding = useMemo(() => sum(shipments.filter((x) => x.merchantId === merchantId && x.payment?.method === 'credit' && x.status !== 'Cancelled'), (x) => toPKR(x.charges.total, x.currency)), [shipments, merchantId]);
  const credit = { limit: merchant?.creditLimit || 0, outstanding, available: Math.max((merchant?.creditLimit || 0) - outstanding, 0) };
  const ctx = { crossBorder, due, duePKR, credit, currency, saved, renameOk };

  // Cash is only taken at a counter, and COD deduction only exists on COD bookings.
  // The account's payment type narrows the choice: COD deducts, Credit bills the account, Debit pays now.
  const methods = PAYMENT_METHODS.filter((m) => {
    if (activeTerm?.method) return m.value === activeTerm.method;
    if (activeTerm?.methods && !activeTerm.methods.includes(m.value)) return false;
    return (m.value !== 'cash' || !isMerchant) && (m.value !== 'cod-deduct' || v.paymentType === 'cod');
  });
  useEffect(() => {
    if (v.payment.method && !methods.some((m) => m.value === v.payment.method)) setValue('payment.method', '');
    // eslint-disable-next-line
  }, [v.paymentType, isMerchant, v.payTerm]);

  // Unfinished bookings survive a refresh or an accidental navigation.
  const valuesKey = JSON.stringify(v);
  useEffect(() => {
    if (!created && isDirty) writeDraft(draftKey, { step, values: v });
    // eslint-disable-next-line
  }, [valuesKey, step, isDirty, created]);

  const startFresh = () => {
    writeDraft(draftKey, null);
    reset(blank());
    setHasAlt(false);
    setStep(0);
    setRestored(false);
    setSaved(null);
    setRenameOk(false);
    setCnicClash(null);
    filledFrom.current = null;
    if (isMerchant) applyMerchant(user.merchantId);
  };

  // Returning receiver: look the phone up in this customer's saved receivers as it is typed.
  // A saved number fills in the form; a new number is saved when the shipment is booked.
  const RECEIVER_KEYS = ['name', 'cnic', 'address', 'landmark', 'altPhone', 'city', 'zone'];
  const fillFrom = (rec) => {
    const vals = { name: rec.name, cnic: rec.cnic || '', address: rec.address, landmark: rec.landmark || '', altPhone: rec.alt_phone || '', city: rec.city, zone: rec.zone || '' };
    RECEIVER_KEYS.forEach((k) => setValue(`receiver.${k}`, vals[k], { shouldValidate: true, shouldDirty: true }));
    filledFrom.current = rec.id;
    setRenameOk(false);
  };
  const clearFilled = () => {
    RECEIVER_KEYS.forEach((k) => setValue(`receiver.${k}`, ''));
    filledFrom.current = null;
  };
  const receiverPhone = v.receiver?.phone || '';
  const receiverKey = isPhone(receiverPhone) ? phoneKey(receiverPhone) : '';
  useEffect(() => {
    if (!merchantId || !receiverKey) { setSaved(null); return undefined; }
    let live = true;
    setLookingUp(true);
    findReceiver(merchantId, receiverPhone)
      .then((rec) => {
        if (!live) return;
        setSaved(rec);
        setRenameOk(false);
        if (rec && (!getValues('receiver.name') || filledFrom.current)) {
          fillFrom(rec);
          toast.info(`Saved receiver found: ${rec.name}`);
        } else if (!rec && filledFrom.current) {
          // The number changed from a saved receiver to a new one: do not carry the old person's details.
          clearFilled();
        }
      })
      .catch(() => { if (live) setSaved(null); })
      .finally(() => { if (live) setLookingUp(false); });
    return () => { live = false; };
    // eslint-disable-next-line
  }, [receiverKey, merchantId]);

  // Same CNIC already saved under a different number: warn, do not block (one person can have two numbers).
  const receiverCnic = v.receiver?.cnic || '';
  useEffect(() => {
    if (!merchantId || !CNIC_PATTERN.test(receiverCnic)) { setCnicClash(null); return undefined; }
    let live = true;
    findReceiverByCnic(merchantId, receiverCnic, receiverPhone).then((x) => { if (live) setCnicClash(x); }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line
  }, [receiverCnic, merchantId, receiverKey]);

  const nameClash = saved && !renameOk && v.receiver?.name && !sameName(v.receiver.name, saved.name);

  const applyProductType = (value) => {
    setValue('productType', value, { shouldValidate: true, shouldDirty: true });
    const t = PRODUCT_TYPES.find((p) => p.value === value) || {};
    const items = getValues('items');
    if (t.document && items.length === 1 && !items[0].name) setValue('items.0', { ...items[0], name: 'Documents', unit: 'Envelope' }, { shouldValidate: true });
    if (t.document && getValues('packaging') === 'none') setValue('packaging', 'flyer');
    if (t.fragile && getValues('packaging') === 'none') setValue('packaging', 'fragile');
    if (t.insure) setValue('insurance', true);
  };

  const runRules = (forStep) => {
    const issues = crossRules(getValues(), ctx).filter((i) => forStep == null || i.step === forStep);
    issues.forEach((i) => setError(i.path, { type: 'rule', message: i.message }, { shouldFocus: true }));
    return issues;
  };

  // Every step opens at the top of the form, not where the previous one was scrolled to.
  const formTop = useRef(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    const y = (formTop.current?.getBoundingClientRect().top ?? 0) + window.scrollY - 80;
    window.scrollTo({ top: Math.max(y, 0), behavior: 'smooth' });
  }, [step]);

  const next = async () => {
    const ok = await trigger(STEPS[step].fields, { shouldFocus: true });
    const issues = runRules(step);
    if (ok && !issues.length) setStep((s) => Math.min(s + 1, LAST));
    else toast.error('Please fix the highlighted fields');
  };

  const [booking, setBooking] = useState(false);
  const onSubmit = async (data) => {
    const issues = runRules();
    if (issues.length) {
      setStep(issues[0].step);
      toast.error(`${STEPS[issues[0].step].title}: ${issues[0].message}`);
      return;
    }
    const { method, channel, reference, received } = data.payment;
    const payment = data.paymentType === 'topay' ? null : {
      method,
      channel: method === 'online' ? channel : '',
      reference: method === 'online' ? reference : '',
      received: method === 'cash' ? Number(received) : 0,
      change: method === 'cash' ? Math.max(Number(received) - due, 0) : 0,
    };
    let shipment;
    setBooking(true);
    try {
      // The server prices the booking and assigns the AWB; the draft stays until it succeeds.
      shipment = await createShipment({ ...data, payment });
    } catch (e) {
      toast.error(e.message);
      return;
    } finally {
      setBooking(false);
    }
    // Keep the receiver for next time. The shipment is already booked, so a failure here only warns.
    saveReceiver(data.merchantId, data.receiver)
      .catch((e) => toast.error(`Shipment booked, but the receiver was not saved: ${e.message}`));
    writeDraft(draftKey, null);
    setCreated(shipment);
    toast.success(`Shipment ${shipment.awb} booked`);
  };
  const onInvalid = (errs) => {
    const first = STEPS.findIndex((s) => s.fields.some((f) => get(errs, f)));
    if (first >= 0) setStep(first);
    toast.error('Some steps have errors. Check the highlighted fields.');
  };
  // Enter moves to the next step; only the Review step books the shipment.
  const onFormSubmit = (e) => {
    if (step < LAST) { e.preventDefault(); next(); return; }
    handleSubmit(onSubmit, onInvalid)(e);
  };

  const duplicate = useMemo(() => shipments.find((s) => (
    s.merchantId === merchantId && phoneKey(s.receiver.phone) === phoneKey(v.receiver.phone) && s.status !== 'Cancelled'
    && Date.now() - new Date(s.createdAt).getTime() < DUPLICATE_WINDOW
  )), [shipments, merchantId, v.receiver.phone]);

  if (created) {
    const pay = created.payment;
    const labels = Array.from({ length: created.parcel.pieces }, (_, i) => ({ ...created, pieceNo: i + 1 }));
    return (
      <div className="mx-auto max-w-lg">
        <Card>
          <div className="py-6 text-center">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary"><CheckCircle2 size={28} aria-hidden /></span>
            <h1 className="text-lg font-bold">Shipment booked</h1>
            <p className="mt-1 text-sm text-ink-muted">Tracking number</p>
            <p className="text-2xl font-black tracking-wide">{created.awb}</p>
            <p className="mt-2 text-sm">Delivery charges: <b>{fmtCurrency(created.charges.total, created.currency)}</b> ({created.payTerm ? paymentTermLabel(created.payTerm) : paymentTypeLabel(created.paymentType)})</p>
            {pay?.method === 'cash' && <p className="text-sm">Cash received {fmtCurrency(pay.received, created.currency)}, change <b>{fmtCurrency(pay.change, created.currency)}</b></p>}
            {pay && pay.method !== 'cash' && <p className="text-sm">{pay.status}{pay.reference ? ` (${pay.channel} ${pay.reference})` : ''}</p>}
            {created.toPay > 0 && <p className="text-sm font-semibold text-danger">Rider collects {fmtCurrency(created.toPay, created.currency)} from the receiver</p>}
            {created.cod > 0 && <p className="text-sm font-semibold text-danger">COD: {fmtCurrency(created.cod, created.currency)}</p>}
            <p className="mt-2 text-xs text-ink-muted">The receiver gets the tracking link by SMS on {created.receiver.phone}.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" className="btn-primary" onClick={() => setPrinting(true)}><Printer size={15} aria-hidden /> Print {labels.length > 1 ? `${labels.length} labels` : 'label'}</button>
              <Link className="btn-outline" to={`/shipments/${created.id}`}>View shipment</Link>
              <a className="btn-outline" href={`/track/${created.awb}`} target="_blank" rel="noreferrer">Public tracking</a>
              <button type="button" className="btn-ghost" onClick={() => { setCreated(null); startFresh(); }}>Book another</button>
            </div>
          </div>
        </Card>
        <LabelPrintModal open={printing} rows={labels} onClose={() => setPrinting(false)} />
      </div>
    );
  }

  const totalQty = sum(v.items, (i) => i.qty);
  const vol = volumetricWeight(v.length, v.width, v.height);
  const method = v.payment.method;
  const change = method === 'cash' && Number(v.payment.received) >= due ? Number(v.payment.received) - due : 0;
  const collectNow = v.paymentType !== 'topay' && ['cash', 'online'].includes(method);

  return (
    <div>
      <PageHeader title="Create Shipment" subtitle="The tracking number is generated when you confirm the booking." />
      {restored && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
          <span>Your unfinished booking was restored.</span>
          <button type="button" className="btn-outline btn-sm" onClick={startFresh}>Start fresh</button>
        </div>
      )}
      {/* Full width so all seven steps fit on one line on desktop. */}
      <div ref={formTop} className="card mb-4 px-4 py-3"><Stepper steps={STEPS.map((s) => s.title)} current={step} onStepClick={setStep} /></div>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <form onSubmit={onFormSubmit} noValidate className="card min-w-0 lg:col-span-2">
          <div className="border-b border-line px-4 py-3">
            <p className="text-xs font-medium text-ink-muted">Step {step + 1} of {STEPS.length}</p>
            <h2 className="text-base font-semibold">{STEPS[step].title}</h2>
            <p className="text-sm text-ink-muted">{STEPS[step].desc}</p>
          </div>
          <div className="p-4">
            {step === 0 && (
              <div className="space-y-3">
                {!isMerchant && (
                  <div>
                    <Field label="Merchant / customer" name="merchantId" register={register} errors={errors} required>
                      <select id="merchantId" className={clsx('input', errors.merchantId && 'input-error')} value={merchantId} onChange={(e) => (e.target.value === '__new__' ? addCustomer() : applyMerchant(e.target.value))}>
                        <option value="">{bookable.length ? 'Select...' : 'No customers yet'}</option>
                        {bookable.map((m) => <option key={m.id} value={m.id}>{m.name}{m.accountNo ? ` - ${m.accountNo}` : ''} ({m.city})</option>)}
                        {canAddCustomer && <option value="__new__">+ Add new customer...</option>}
                      </select>
                    </Field>
                    {canAddCustomer && (
                      <button type="button" className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-ink hover:underline" onClick={addCustomer}>
                        <Plus size={14} aria-hidden /> Add new customer
                      </button>
                    )}
                  </div>
                )}
                {plans.length > 0 && (
                  <OptionPicker
                    legend="Shipping plan"
                    all={SHIPPING_PLANS}
                    allowed={plans.map((x) => x.value)}
                    value={v.plan}
                    onPick={applyPlan}
                  />
                )}
                {terms.length > 0 && (
                  <OptionPicker
                    legend="Payment type"
                    all={PAYMENT_TERMS}
                    allowed={terms.map((x) => x.value)}
                    value={v.payTerm}
                    onPick={applyTerm}
                  />
                )}
                {merchant?.pickups?.length > 0 && (
                  <div>
                    <label htmlFor="pickup" className="label">Pickup location</label>
                    <select
                      id="pickup"
                      className="input"
                      onChange={(e) => {
                        const p = merchant.pickups.find((x) => x.id === e.target.value);
                        if (p) { setValue('sender.address', p.address, { shouldValidate: true }); setValue('sender.city', p.city, { shouldValidate: true }); }
                      }}
                    >
                      {merchant.pickups.map((p) => <option key={p.id} value={p.id}>{p.label} - {p.address}</option>)}
                    </select>
                  </div>
                )}
                <SenderForm register={register} errors={errors} />
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                {merchant?.receivers?.length > 0 && (
                  <div>
                    <label htmlFor="saved" className="label">Saved receiver</label>
                    <select
                      id="saved"
                      className="input"
                      defaultValue=""
                      onChange={(e) => {
                        const r = merchant.receivers.find((x) => x.id === e.target.value);
                        if (r) ['name', 'phone', 'address', 'city', 'cnic', 'zone'].forEach((k) => r[k] && setValue(`receiver.${k}`, r[k], { shouldValidate: true }));
                      }}
                    >
                      <option value="">Choose from address book...</option>
                      {merchant.receivers.map((r) => <option key={r.id} value={r.id}>{r.name} - {r.city}</option>)}
                    </select>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Phone"
                    name="receiver.phone"
                    register={register}
                    errors={errors}
                    required
                    {...phoneInputProps}
                    format={cleanPhoneInput}
                    hint={lookingUp ? 'Checking saved receivers...' : saved ? `Saved receiver: ${saved.name} (${saved.shipments_count} earlier shipment${saved.shipments_count === 1 ? '' : 's'})` : receiverKey ? 'New receiver: saved when you book' : 'Saved receivers are found by phone'}
                  />
                  {showAlt ? (
                    <Field label="Second phone" name="receiver.altPhone" register={register} errors={errors} {...phoneInputProps} placeholder="Receiver's other number, e.g. 0321 7654321" format={cleanPhoneInput} />
                  ) : <div className="hidden sm:block" />}
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary-hover"
                      checked={showAlt}
                      onChange={(e) => {
                        setHasAlt(e.target.checked);
                        if (!e.target.checked) setValue('receiver.altPhone', '', { shouldValidate: true, shouldDirty: true });
                      }}
                    />
                    Receiver has a second phone number
                  </label>
                </div>
                {nameClash && (
                  <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/40 bg-danger-light px-3 py-2 text-sm text-danger-dark">
                    <span className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden /> This number is already saved for <b>{saved.name}</b>{saved.city ? `, ${saved.city}` : ''}.</span>
                    <span className="flex gap-2">
                      <button type="button" className="btn-primary btn-sm" onClick={() => { fillFrom(saved); toast.success('Saved details filled in'); }}>Use saved details</button>
                      <button type="button" className="btn-outline btn-sm" onClick={() => { setRenameOk(true); trigger('receiver.name'); toast.info(`The saved name will change to "${getValues('receiver.name')}" when you book`); }}>Update saved name</button>
                    </span>
                  </div>
                )}
                {saved && !nameClash && filledFrom.current === saved.id && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary-light px-3 py-2 text-sm">
                    <span className="flex items-center gap-2"><UserCheck size={16} aria-hidden /> Saved receiver <b>{saved.name}</b> filled in. Check the address before continuing.</span>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => { clearFilled(); toast.info('Fields cleared'); }}>Clear</button>
                  </div>
                )}
                {cnicClash && (
                  <Notice tone="warn">CNIC {receiverCnic} is already saved for <b>{cnicClash.name}</b> ({cnicClash.phone}). Make sure this is the same person.</Notice>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Full name" name="receiver.name" register={register} errors={errors} required placeholder="Receiver's full name, e.g. Sara Ahmed" maxLength={80} />
                  <Field
                    label="CNIC"
                    name="receiver.cnic"
                    register={() => register('receiver.cnic', { onChange: (e) => setValue('receiver.cnic', formatCnic(e.target.value)) })}
                    errors={errors}
                    required
                    inputMode="numeric"
                    placeholder="35202-1234567-1"
                    hint="Pakistani CNIC, 13 digits. Dashes are added as you type"
                  />
                  <Field label="Complete address" name="receiver.address" register={register} errors={errors} required placeholder="House / flat no., street, block, area, e.g. House 12, Street 4, Block B, Gulberg" maxLength={250} className="sm:col-span-2" />
                  <Field label="Nearest landmark" name="receiver.landmark" register={register} errors={errors} placeholder="Optional, e.g. near Jamia Masjid / opposite Bank Alfalah" maxLength={120} className="sm:col-span-2" />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="City" name="receiver.city" register={register} errors={errors} required>
                    <select id="receiver.city" className={clsx('input', errors.receiver?.city && 'input-error')} {...register('receiver.city')}>
                      <option value="">Select...</option>
                      {CITY_NAMES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Zone" name="receiver.zone" register={register} errors={errors} required>
                    {/* Controlled so a zone filled together with its city still shows once the options render. */}
                    <select id="receiver.zone" disabled={!destCity} className={clsx('input', errors.receiver?.zone && 'input-error')} {...register('receiver.zone')} value={v.receiver.zone}>
                      <option value="">{destCity ? 'Select...' : 'Choose a city first'}</option>
                      {zones.map((z) => <option key={z.value} value={z.value}>{z.side} - {z.areas}</option>)}
                    </select>
                  </Field>
                  <div>
                    <label htmlFor="region" className="label">Region</label>
                    <input id="region" className="input bg-surface" readOnly tabIndex={-1} value={destInfo ? `${destInfo.region}${destInfo.remote ? ' (remote area)' : ''}` : ''} placeholder="Set from city" />
                  </div>
                </div>
                {crossBorder && <Notice>Cross-border lane: this ships as International and charges and COD are in {currency}.</Notice>}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <Field label="Product type" name="productType" register={register} errors={errors} required hint={type.hint}>
                  <select id="productType" className={clsx('input', errors.productType && 'input-error')} value={v.productType} onChange={(e) => applyProductType(e.target.value)}>
                    {PRODUCT_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </Field>
                {type.liquid && <Notice tone="warn">Liquids must be in sealed, leak-proof containers.</Notice>}
                {type.mustInsure && <Notice>Valuables are insured automatically. Enter the real price so the cover is correct.</Notice>}

                <div className="space-y-3">
                  {fields.map((f, i) => {
                    const e = errors.items?.[i] || {};
                    const it = v.items[i] || {};
                    return (
                      <fieldset key={f.id} className="rounded-lg border border-line p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <legend className="text-sm font-semibold">Product {i + 1}</legend>
                          <span className="flex gap-1">
                            <button type="button" className="btn-ghost btn-sm" onClick={() => insert(i + 1, { ...getValues(`items.${i}`) })} title="Add a copy of this product"><Copy size={13} aria-hidden /> Add similar</button>
                            <button type="button" className="btn-ghost btn-sm !px-2" disabled={fields.length === 1} onClick={() => remove(i)} aria-label={`Remove product ${i + 1}`}><Trash2 size={14} /></button>
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                          <div className="col-span-2 sm:col-span-6">
                            <label htmlFor={`items.${i}.name`} className="label">Product name<span className="text-danger"> *</span></label>
                            <input id={`items.${i}.name`} placeholder="e.g. Cotton kurta, size M" className={clsx('input', e.name && 'input-error')} {...register(`items.${i}.name`)} />
                            <FieldError message={e.name?.message} />
                          </div>
                          <div className={crossBorder ? 'sm:col-span-3' : 'col-span-2 sm:col-span-6'}>
                            <label htmlFor={`items.${i}.sku`} className="label">SKU / order no.</label>
                            <input id={`items.${i}.sku`} placeholder="Optional, e.g. KRT-M-01" className={clsx('input', e.sku && 'input-error')} {...register(`items.${i}.sku`)} />
                            <FieldError message={e.sku?.message} />
                          </div>
                          {crossBorder && (
                            <div className="sm:col-span-3">
                              <label htmlFor={`items.${i}.hsCode`} className="label">HS code<span className="text-danger"> *</span></label>
                              <input id={`items.${i}.hsCode`} placeholder="e.g. 6204.42" className={clsx('input', e.hsCode && 'input-error')} {...register(`items.${i}.hsCode`)} />
                              <FieldError message={e.hsCode?.message} />
                            </div>
                          )}
                          <div className="sm:col-span-2">
                            <label htmlFor={`items.${i}.qty`} className="label">Qty<span className="text-danger"> *</span></label>
                            <input id={`items.${i}.qty`} type="number" min={1} placeholder="1" className={clsx('input', e.qty && 'input-error')} {...register(`items.${i}.qty`)} />
                            <FieldError message={e.qty?.message} />
                          </div>
                          <div className="sm:col-span-3">
                            <label htmlFor={`items.${i}.unit`} className="label">Unit<span className="text-danger"> *</span></label>
                            <select id={`items.${i}.unit`} className={clsx('input', e.unit && 'input-error')} {...register(`items.${i}.unit`)}>
                              {UNITS.map((u) => <option key={u}>{u}</option>)}
                            </select>
                            <FieldError message={e.unit?.message} />
                          </div>
                          <div className="sm:col-span-3">
                            <label htmlFor={`items.${i}.value`} className="label">Unit price ({currency})<span className="text-danger"> *</span></label>
                            <input id={`items.${i}.value`} type="number" min={0} placeholder="Price of one unit" className={clsx('input', e.value && 'input-error')} {...register(`items.${i}.value`)} />
                            <FieldError message={e.value?.message} />
                          </div>
                          <div className="sm:col-span-4">
                            <p className="label">Line total</p>
                            <p className="input bg-surface tabular-nums">{fmtCurrency((Number(it.qty) || 0) * (Number(it.value) || 0), currency)}</p>
                          </div>
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
                <FieldError message={errors.items?.message || errors.items?.root?.message} />
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
                  <button type="button" className="btn-outline btn-sm" onClick={() => append(blankItem())}><Plus size={13} aria-hidden /> Add product</button>
                  <p className="text-sm">{fields.length} product(s), {totalQty} unit(s). Declared value <b className="tabular-nums">{fmtCurrency(v.declaredValue, currency)}</b></p>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Pieces (boxes)" name="pieces" type="number" register={register} errors={errors} required placeholder="e.g. 1" hint="One label per piece" />
                  <Field label="Total weight (kg)" name="weight" type="number" step="0.1" register={register} errors={errors} required placeholder="e.g. 0.5" />
                  <Field label="Packaging" name="packaging" register={register} errors={errors} className="col-span-2">
                    <select id="packaging" className="input" {...register('packaging')}>
                      {PACKAGING.map((p) => <option key={p.value} value={p.value}>{p.label}{p.fee ? ` (Rs ${p.fee})` : ''}</option>)}
                    </select>
                  </Field>
                </div>
                {Number(v.weight) > DIMS_ABOVE_KG ? (
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Length (cm)" name="length" type="number" register={register} errors={errors} required placeholder="e.g. 30" min="1" />
                    <Field label="Width (cm)" name="width" type="number" register={register} errors={errors} required placeholder="e.g. 20" min="1" />
                    <Field label="Height (cm)" name="height" type="number" register={register} errors={errors} required placeholder="e.g. 15" min="1" />
                  </div>
                ) : (
                  <p className="text-xs text-ink-muted">Up to {DIMS_ABOVE_KG} kg the size is not needed. Above {DIMS_ABOVE_KG} kg, length, width and height are required.</p>
                )}
                <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface p-3 text-center text-sm">
                  <div><p className="text-xs text-ink-muted">Actual</p><p className="font-semibold">{Number(v.weight) || 0} kg</p></div>
                  <div><p className="text-xs text-ink-muted">Volumetric (LxWxH / 5000)</p><p className="font-semibold">{Math.round(vol * 100) / 100} kg</p></div>
                  <div><p className="text-xs text-ink-muted">Chargeable</p><p className="font-bold">{q ? q.chargeableWeight : '-'} kg</p></div>
                </div>
                {type.fragile && v.packaging !== 'fragile' && <Notice tone="warn">Fragile goods without Fragile wrap are not covered for breakage.</Notice>}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5">
                <fieldset>
                  <legend className="label">Service type<span className="text-danger"> *</span></legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {SERVICES.map((s) => {
                      const planLocked = !crossBorder && activePlan?.service && s.value !== activePlan.service;
                      const disabled = crossBorder ? s.value !== 'international' : s.value === 'international' || planLocked;
                      return (
                        <ChoiceCard
                          key={s.value}
                          name="service"
                          value={s.value}
                          register={register}
                          checked={v.service === s.value}
                          disabled={disabled}
                          title={s.label}
                          hint={`${s.days} day${s.days > 1 ? 's' : ''}${servicePrices[s.value] && !disabled ? ` - ${fmtCurrency(servicePrices[s.value], currency)}` : ''}`}
                        />
                      );
                    })}
                  </div>
                  <FieldError message={errors.service?.message} />
                </fieldset>

                {activeTerm ? (
                  <Notice><b>Payment: {activeTerm.label}</b>. {activeTerm.hint} Set on the customer account.</Notice>
                ) : (
                  <fieldset>
                    <legend className="label">Payment type<span className="text-danger"> *</span></legend>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {PAYMENT_TYPES.map((p) => <ChoiceCard key={p.value} name="paymentType" value={p.value} register={register} checked={v.paymentType === p.value} title={p.label} hint={p.hint} />)}
                    </div>
                  </fieldset>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  {v.paymentType === 'cod' && (
                    <Field
                      label={`COD amount (${currency})`}
                      name="cod"
                      type="number"
                      register={register}
                      errors={errors}
                      required
                      placeholder="Amount the rider collects, e.g. 3500"
                      hint={v.declaredValue > 0 ? `Goods value is ${fmtCurrency(v.declaredValue, currency)}` : undefined}
                    />
                  )}
                  {!isMerchant && (
                    <Field label="Courier" name="courier" register={register} errors={errors}>
                      <select id="courier" className="input" {...register('courier')}>
                        {COURIER_NAMES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </Field>
                  )}
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-primary-hover" disabled={type.mustInsure} {...register('insurance')} />
                    Insure parcel ({rateCard.insurancePct}% of declared value{v.declaredValue > 0 ? `, ${fmtCurrency((v.declaredValue * rateCard.insurancePct) / 100, currency)}` : ''})
                  </label>
                  <FieldError message={errors.insurance?.message} />
                </div>
                <Field label="Delivery instructions" name="notes" register={register} errors={errors}>
                  <textarea id="notes" rows={2} className={clsx('input', errors.notes && 'input-error')} placeholder="Call before delivery, office hours only, handle with care..." {...register('notes')} />
                </Field>
              </div>
            )}

            {step === 5 && (v.paymentType === 'topay' ? (
              <div className="space-y-3">
                <Notice>To Pay booking: nothing is collected now. The rider collects the delivery charges from the receiver at the door.</Notice>
                <div className="flex items-baseline justify-between rounded-lg bg-surface p-3">
                  <span className="text-sm">Rider collects at delivery</span>
                  <span className="text-2xl font-black tabular-nums">{fmtCurrency(due, currency)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-baseline justify-between rounded-lg bg-surface p-3">
                  <span className="text-sm">Delivery charges due</span>
                  <span className="text-2xl font-black tabular-nums">{fmtCurrency(due, currency)}</span>
                </div>
                <fieldset>
                  <legend className="label">Payment method<span className="text-danger"> *</span></legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {methods.map((m) => {
                      const noCredit = m.value === 'credit' && (!merchant || credit.available < duePKR);
                      const hint = m.value === 'credit' && merchant ? `Available ${fmtCurrency(credit.available)} of ${fmtCurrency(credit.limit)}` : m.hint;
                      return <ChoiceCard key={m.value} name="payment.method" value={m.value} register={register} checked={method === m.value} disabled={noCredit} title={m.label} hint={hint} icon={METHOD_ICONS[m.value]} />;
                    })}
                  </div>
                  <FieldError message={errors.payment?.method?.message} />
                </fieldset>

                {method === 'cash' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="payment.received" className="label">Cash received ({currency})<span className="text-danger"> *</span></label>
                      <div className="flex gap-2">
                        <input id="payment.received" type="number" min={0} placeholder="Cash given by the sender" className={clsx('input', errors.payment?.received && 'input-error')} {...register('payment.received')} />
                        <button type="button" className="btn-outline whitespace-nowrap" onClick={() => setValue('payment.received', String(due), { shouldValidate: true })}>Exact</button>
                      </div>
                      <FieldError message={errors.payment?.received?.message} />
                    </div>
                    <div>
                      <p className="label">Change to return</p>
                      <p className="input bg-surface font-bold tabular-nums">{fmtCurrency(change, currency)}</p>
                    </div>
                  </div>
                )}
                {method === 'online' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Channel" name="payment.channel" register={register} errors={errors} required>
                      <select id="payment.channel" className={clsx('input', errors.payment?.channel && 'input-error')} {...register('payment.channel')}>
                        <option value="">Select...</option>
                        {ONLINE_CHANNELS.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </Field>
                    <Field label="Transaction ID" name="payment.reference" register={register} errors={errors} required placeholder="e.g. TRX88213409" />
                  </div>
                )}
                {method === 'credit' && merchant && (
                  <dl className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-ink-muted">Credit limit</dt><dd className="font-semibold">{fmtCurrency(credit.limit)}</dd></div>
                    <div><dt className="text-xs text-ink-muted">Outstanding</dt><dd className="font-semibold">{fmtCurrency(credit.outstanding)}</dd></div>
                    <div><dt className="text-xs text-ink-muted">Available</dt><dd className="font-semibold">{fmtCurrency(credit.available)}</dd></div>
                    <div><dt className="text-xs text-ink-muted">After booking</dt><dd className="font-semibold">{fmtCurrency(credit.available - duePKR)}</dd></div>
                  </dl>
                )}
                {method === 'cod-deduct' && (
                  <Notice>{fmtCurrency(due, currency)} is deducted from the COD of {fmtCurrency(v.cod, currency)}. The sender receives {fmtCurrency(Math.max(Number(v.cod) - due, 0), currency)} at settlement.</Notice>
                )}
              </div>
            ))}

            {step === 6 && (
              <div className="space-y-3">
                {duplicate && (
                  <Notice tone="warn">
                    <Link className="font-semibold underline" to={`/shipments/${duplicate.id}`}>{duplicate.awb}</Link> was booked for this receiver in the last 30 minutes. Make sure this is not a duplicate.
                  </Notice>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <ReviewBlock title="Sender" step={0} onEdit={setStep}>
                    <p className="font-medium">{v.sender.name}</p><p>{v.sender.address}, {v.sender.city}</p><p>{v.sender.phone}</p>
                  </ReviewBlock>
                  <ReviewBlock title="Receiver" step={1} onEdit={setStep}>
                    <p className="font-medium">{v.receiver.name}</p>
                    <p>{v.receiver.address}{v.receiver.landmark ? ` (near ${v.receiver.landmark})` : ''}</p>
                    <p>{v.receiver.zone}, {destInfo?.region}</p>
                    <p>{v.receiver.phone}{v.receiver.altPhone ? ` / ${v.receiver.altPhone}` : ''}</p>
                    <p className="text-ink-muted">CNIC: {v.receiver.cnic}</p>
                  </ReviewBlock>
                  <ReviewBlock title={`Products (${productTypeLabel(v.productType)})`} step={2} onEdit={setStep}>
                    <ul>{v.items.map((i, idx) => <li key={idx} className="flex justify-between gap-2"><span className="truncate">{i.qty} {i.unit} x {i.name}</span><span className="tabular-nums">{fmtCurrency(i.qty * i.value, currency)}</span></li>)}</ul>
                    <p className="border-t border-line pt-1 font-medium">Declared {fmtCurrency(v.declaredValue, currency)}</p>
                  </ReviewBlock>
                  <ReviewBlock title="Package" step={3} onEdit={setStep}>
                    <p>{v.pieces} piece(s), {v.weight} kg{q ? ` (chargeable ${q.chargeableWeight} kg)` : ''}</p>
                    {(Number(v.length) > 0) && <p>{v.length} x {v.width} x {v.height} cm</p>}
                    <p>{PACKAGING.find((p) => p.value === v.packaging)?.label}</p>
                  </ReviewBlock>
                  <ReviewBlock title="Service" step={4} onEdit={setStep}>
                    <p>{serviceLabel(v.service)}, {activeTerm ? activeTerm.label : paymentTypeLabel(v.paymentType)}</p>
                    {v.paymentType === 'cod' && <p className="font-bold text-danger">COD {fmtCurrency(v.cod, currency)}</p>}
                    {v.insurance && <p>Insured</p>}
                    {v.notes && <p className="text-ink-muted">{v.notes}</p>}
                  </ReviewBlock>
                  <ReviewBlock title="Payment" step={5} onEdit={setStep}>
                    {v.paymentType === 'topay' && <p>Receiver pays {fmtCurrency(due, currency)} at delivery</p>}
                    {v.paymentType !== 'topay' && <p>{paymentMethodLabel(method)}: {fmtCurrency(due, currency)}</p>}
                    {method === 'cash' && v.paymentType !== 'topay' && <p>Received {fmtCurrency(v.payment.received, currency)}, change {fmtCurrency(change, currency)}</p>}
                    {method === 'online' && v.paymentType !== 'topay' && <p>{v.payment.channel} - {v.payment.reference}</p>}
                  </ReviewBlock>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-between border-t border-line p-4">
            <button type="button" className="btn-outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}><ChevronLeft size={15} aria-hidden /> Back</button>
            {step < LAST
              ? <button key="next" type="submit" className="btn-primary">Next: {STEPS[step + 1].title} <ChevronRight size={15} aria-hidden /></button>
              : <button key="submit" type="submit" className="btn-primary" disabled={booking}>{booking ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CheckCircle2 size={15} aria-hidden />} {booking ? 'Booking...' : 'Confirm booking'}</button>}
          </div>
          <div className="px-4 pb-3 text-end"><button type="button" className="text-xs text-ink-muted hover:text-ink" onClick={() => { writeDraft(draftKey, null); navigate('/shipments'); }}>Discard and exit</button></div>
        </form>

        <Card title="Booking summary" className="lg:sticky lg:top-20">
          <dl className="mb-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-ink-muted">Receiver</dt><dd className="truncate text-end font-medium">{v.receiver.name || '-'}{destCity ? `, ${destCity}` : ''}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-ink-muted">Products</dt><dd className="text-end">{fields.length} ({totalQty} units)</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-ink-muted">Package</dt><dd className="text-end">{v.pieces || 0} pc, {v.weight || 0} kg</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-ink-muted">Service</dt><dd className="text-end">{serviceLabel(v.service)}, {activeTerm ? activeTerm.label : paymentTypeLabel(v.paymentType)}</dd></div>
          </dl>
          {!q && <p className="border-t border-line py-6 text-center text-sm text-ink-muted">Choose the sender and receiver cities to see the price.</p>}
          {q && (
            <div className="border-t border-line pt-2">
              <p className="mb-2 text-xs text-ink-muted">{originCity} to {destCity} - Zone {q.zone} - {q.chargeableWeight} kg chargeable{q.areaRule ? ` - ${q.areaRule.value} rate` : ''}</p>
              <PriceLine label="Base freight" value={q.base} currency={currency} />
              <PriceLine label="Extra weight" value={q.weight} currency={currency} />
              <PriceLine label={`Fuel surcharge (${q.fuelPct}%)`} value={q.fuel} currency={currency} />
              <PriceLine label="Remote area" value={q.remote} currency={currency} />
              <PriceLine label="COD fee" value={q.codFee} currency={currency} />
              <PriceLine label="Insurance" value={q.insurance} currency={currency} />
              <PriceLine label="Packaging" value={q.packaging} currency={currency} />
              <PriceLine label={`Tax (${q.taxPct}%)`} value={q.tax} currency={currency} />
              <PriceLine label="Total" value={q.total} currency={currency} bold />
              {override?.discountPct > 0 && <p className="mt-2 rounded bg-primary-light px-2 py-1 text-xs">Contract discount of {override.discountPct}% applied to freight.</p>}
              <div className="mt-3 space-y-1 rounded-lg bg-surface p-2 text-xs">
                {collectNow && <p className="flex justify-between"><span>Collect now</span><b>{fmtCurrency(due, currency)}</b></p>}
                {v.paymentType !== 'topay' && method === 'credit' && <p>Billed to the account on the monthly invoice</p>}
                {v.paymentType !== 'topay' && method === 'cod-deduct' && <p>Deducted from the COD remittance</p>}
                {v.paymentType === 'topay' && <p className="flex justify-between"><span>Rider collects (To Pay)</span><b>{fmtCurrency(due, currency)}</b></p>}
                {v.paymentType === 'cod' && <p className="flex justify-between"><span>Rider collects (COD)</span><b>{fmtCurrency(v.cod, currency)}</b></p>}
                {v.paymentType !== 'topay' && !method && <p className="text-ink-muted">Payment method is chosen in the Payment step</p>}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

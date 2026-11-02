// Multi-step booking: one react-hook-form instance, zod validates only the current step's
// fields when moving forward, and the price panel recalculates on every change.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, ChevronLeft, ChevronRight, Plus, Printer, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Card, PageHeader, Stepper } from '../../components/ui/index.jsx';
import { FieldError } from '../../components/forms/EntityForm.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';
import { CITY_MAP, CITY_NAMES } from '../../data/geo.js';
import { COURIER_NAMES } from '../../data/shipments.js';
import { PACKAGING, SERVICES, quote, serviceLabel } from '../../utils/pricing.js';
import { fmtCurrency } from '../../utils/format.js';
import { LabelPrintModal } from './ShipmentList.jsx';

const PHONE = /^\+?[0-9][0-9\s-]{8,16}$/;
const party = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  phone: z.string().trim().regex(PHONE, 'Enter a valid phone number, e.g. +92 300 1234567'),
  address: z.string().trim().min(5, 'Address is required'),
  city: z.string().min(1, 'City is required'),
});

const schema = z.object({
  merchantId: z.string().min(1, 'Choose a merchant'),
  sender: party,
  receiver: party,
  weight: z.coerce.number({ invalid_type_error: 'Weight is required' }).positive('Weight must be above 0').max(1000, 'Use Cargo booking above 1000 kg'),
  length: z.coerce.number().min(0, 'Cannot be negative').optional(),
  width: z.coerce.number().min(0, 'Cannot be negative').optional(),
  height: z.coerce.number().min(0, 'Cannot be negative').optional(),
  declaredValue: z.coerce.number({ invalid_type_error: 'Enter a value' }).min(0, 'Cannot be negative'),
  items: z.array(z.object({
    name: z.string().trim().min(1, 'Item name is required'),
    qty: z.coerce.number({ invalid_type_error: 'Required' }).int('Whole number').min(1, 'At least 1'),
    value: z.coerce.number({ invalid_type_error: 'Required' }).min(0, 'Cannot be negative'),
  })).min(1, 'Add at least one item'),
  service: z.string().min(1, 'Choose a service'),
  courier: z.string(),
  cod: z.coerce.number({ invalid_type_error: 'Enter an amount' }).min(0, 'Cannot be negative'),
  insurance: z.boolean(),
  packaging: z.string(),
  notes: z.string().max(300, 'Keep notes under 300 characters').optional(),
}).refine((v) => !v.insurance || v.declaredValue > 0, { message: 'Insurance needs a declared value', path: ['declaredValue'] });

const STEPS = ['Sender', 'Receiver', 'Parcel', 'Service & COD', 'Review'];
const STEP_FIELDS = [
  ['merchantId', 'sender.name', 'sender.phone', 'sender.address', 'sender.city'],
  ['receiver.name', 'receiver.phone', 'receiver.address', 'receiver.city'],
  ['weight', 'length', 'width', 'height', 'declaredValue', 'items'],
  ['service', 'cod', 'packaging', 'notes'],
];

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

function Field({ label, name, register, errors, required, children, type = 'text', placeholder, step, className }) {
  const err = get(errors, name);
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}{required && <span className="text-danger"> *</span>}</label>
      {children || <input id={name} type={type} step={step} placeholder={placeholder} aria-invalid={!!err} className={clsx('input', err && 'input-error')} {...register(name)} />}
      <FieldError message={err?.message} />
    </div>
  );
}

function PartyForm({ prefix, register, errors }) {
  const cityErr = get(errors, `${prefix}.city`);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" name={`${prefix}.name`} register={register} errors={errors} required />
      <Field label="Phone" name={`${prefix}.phone`} register={register} errors={errors} required placeholder="+92 300 1234567" />
      <Field label="Address" name={`${prefix}.address`} register={register} errors={errors} required className="sm:col-span-2" />
      <Field label="City" name={`${prefix}.city`} register={register} errors={errors} required>
        <select id={`${prefix}.city`} className={clsx('input', cityErr && 'input-error')} {...register(`${prefix}.city`)}>
          <option value="">Select...</option>
          {CITY_NAMES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
    </div>
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

export function CreateShipment() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const { merchants, rateCard, merchantOverrides, createShipment } = useData();
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState(null);
  const [printing, setPrinting] = useState(false);
  const isMerchant = user.role === 'merchant';

  const bookable = useMemo(() => merchants.filter((m) => m.status === 'Active' || m.id === user.merchantId), [merchants, user]);
  const blank = (merchantId = '') => ({
    merchantId,
    sender: { name: '', phone: '', address: '', city: '' },
    receiver: { name: '', phone: '', address: '', city: '' },
    weight: 0.5, length: '', width: '', height: '', declaredValue: 0,
    items: [{ name: '', qty: 1, value: 0 }],
    service: 'next-day', courier: COURIER_NAMES[0], cod: 0, insurance: false, packaging: 'none', notes: '',
  });

  const {
    register, handleSubmit, watch, setValue, trigger, control, reset, formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: blank(), mode: 'onChange' });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const v = watch();
  const merchantId = v.merchantId;
  const merchant = merchants.find((m) => m.id === merchantId);

  // Picking a merchant fills the sender from their default pickup location.
  const applyMerchant = (id) => {
    setValue('merchantId', id, { shouldValidate: true });
    const m = merchants.find((x) => x.id === id);
    if (!m) return;
    setValue('sender.name', m.name, { shouldValidate: true });
    setValue('sender.phone', m.phone, { shouldValidate: true });
    setValue('sender.address', m.pickups[0]?.address || m.address, { shouldValidate: true });
    setValue('sender.city', m.city, { shouldValidate: true });
  };
  useEffect(() => { if (isMerchant) applyMerchant(user.merchantId); /* eslint-disable-next-line */ }, [isMerchant]);

  // Declared value follows the item list as it is edited.
  const itemsKey = JSON.stringify((v.items || []).map((i) => [i.qty, i.value]));
  useEffect(() => {
    const total = (v.items || []).reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.value) || 0), 0);
    setValue('declaredValue', total);
    // eslint-disable-next-line
  }, [itemsKey]);

  const originCity = v.sender?.city;
  const destCity = v.receiver?.city;
  const crossBorder = originCity && destCity && CITY_MAP[originCity]?.country !== CITY_MAP[destCity]?.country;
  const currency = CITY_MAP[destCity]?.currency || 'PKR';

  // Keep the service valid for the lane: a cross-border lane is always International.
  useEffect(() => {
    if (crossBorder && v.service !== 'international') setValue('service', 'international');
    if (!crossBorder && v.service === 'international') setValue('service', 'next-day');
    // eslint-disable-next-line
  }, [crossBorder]);

  const override = merchantOverrides.find((o) => o.merchantId === merchantId) || { discountPct: merchant?.discountPct };
  const q = useMemo(() => {
    if (!originCity || !destCity) return null;
    return quote({
      originCity, destCity, service: v.service, weight: v.weight, length: v.length, width: v.width, height: v.height,
      cod: v.cod, declaredValue: v.declaredValue, insurance: v.insurance, packaging: v.packaging, currency,
    }, rateCard, override);
  }, [originCity, destCity, v.service, v.weight, v.length, v.width, v.height, v.cod, v.declaredValue, v.insurance, v.packaging, currency, rateCard, override]);

  const next = async () => {
    const ok = await trigger(STEP_FIELDS[step], { shouldFocus: true });
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
    else toast.error('Please fix the highlighted fields');
  };

  const onSubmit = (data) => {
    const shipment = createShipment(data);
    setCreated(shipment);
    toast.success(`Shipment ${shipment.awb} booked`);
  };
  const onInvalid = () => toast.error('Some steps have errors. Go back and check the highlighted fields.');

  if (created) {
    return (
      <div className="mx-auto max-w-lg">
        <Card>
          <div className="py-6 text-center">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary"><CheckCircle2 size={28} aria-hidden /></span>
            <h1 className="text-lg font-bold">Shipment booked</h1>
            <p className="mt-1 text-sm text-ink-muted">Tracking number</p>
            <p className="text-2xl font-black tracking-wide">{created.awb}</p>
            <p className="mt-2 text-sm">Total charges: <b>{fmtCurrency(created.charges.total, created.currency)}</b></p>
            {created.cod > 0 && <p className="text-sm font-semibold text-danger">COD: {fmtCurrency(created.cod, created.currency)}</p>}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" className="btn-primary" onClick={() => setPrinting(true)}><Printer size={15} aria-hidden /> Print label</button>
              <Link className="btn-outline" to={`/shipments/${created.id}`}>View shipment</Link>
              <a className="btn-outline" href={`/track/${created.awb}`} target="_blank" rel="noreferrer">Public tracking</a>
              <button type="button" className="btn-ghost" onClick={() => { setCreated(null); setStep(0); reset(blank()); if (isMerchant) applyMerchant(user.merchantId); }}>Book another</button>
            </div>
          </div>
        </Card>
        <LabelPrintModal open={printing} rows={[created]} onClose={() => setPrinting(false)} />
      </div>
    );
  }

  const merchantErr = errors.merchantId;

  return (
    <div>
      <PageHeader title="Create Shipment" subtitle="The tracking number is generated when you confirm the booking." />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="card min-w-0 lg:col-span-2">
          <div className="border-b border-line p-4"><Stepper steps={STEPS} current={step} onStepClick={setStep} /></div>
          <div className="p-4">
            {step === 0 && (
              <div className="space-y-3">
                {!isMerchant && (
                  <Field label="Merchant / customer" name="merchantId" register={register} errors={errors} required>
                    <select id="merchantId" className={clsx('input', merchantErr && 'input-error')} value={merchantId} onChange={(e) => applyMerchant(e.target.value)}>
                      <option value="">Select...</option>
                      {bookable.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.city})</option>)}
                    </select>
                  </Field>
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
                <PartyForm prefix="sender" register={register} errors={errors} />
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
                        if (r) ['name', 'phone', 'address', 'city'].forEach((k) => setValue(`receiver.${k}`, r[k], { shouldValidate: true }));
                      }}
                    >
                      <option value="">Choose from address book...</option>
                      {merchant.receivers.map((r) => <option key={r.id} value={r.id}>{r.name} - {r.city}</option>)}
                    </select>
                  </div>
                )}
                <PartyForm prefix="receiver" register={register} errors={errors} />
                {crossBorder && <p className="rounded-lg bg-primary-light px-3 py-2 text-sm">Cross-border lane: this ships as International and charges and COD are in {currency}.</p>}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Weight (kg)" name="weight" type="number" step="0.1" register={register} errors={errors} required />
                  <Field label="Length (cm)" name="length" type="number" register={register} errors={errors} />
                  <Field label="Width (cm)" name="width" type="number" register={register} errors={errors} />
                  <Field label="Height (cm)" name="height" type="number" register={register} errors={errors} />
                </div>
                <div>
                  <p className="label">Items</p>
                  <div className="space-y-2">
                    {fields.map((f, i) => (
                      <div key={f.id} className="grid grid-cols-[1fr_72px_96px_36px] items-start gap-2">
                        <div>
                          <input aria-label={`Item ${i + 1} name`} placeholder="Item name" className={clsx('input', errors.items?.[i]?.name && 'input-error')} {...register(`items.${i}.name`)} />
                          <FieldError message={errors.items?.[i]?.name?.message} />
                        </div>
                        <div>
                          <input aria-label={`Item ${i + 1} quantity`} type="number" placeholder="Qty" className={clsx('input', errors.items?.[i]?.qty && 'input-error')} {...register(`items.${i}.qty`)} />
                          <FieldError message={errors.items?.[i]?.qty?.message} />
                        </div>
                        <div>
                          <input aria-label={`Item ${i + 1} value`} type="number" placeholder="Value" className={clsx('input', errors.items?.[i]?.value && 'input-error')} {...register(`items.${i}.value`)} />
                          <FieldError message={errors.items?.[i]?.value?.message} />
                        </div>
                        <button type="button" className="btn-ghost !p-2" disabled={fields.length === 1} onClick={() => remove(i)} aria-label={`Remove item ${i + 1}`}><Trash2 size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn-outline btn-sm mt-2" onClick={() => append({ name: '', qty: 1, value: 0 })}><Plus size={13} aria-hidden /> Add item</button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Declared value (${currency})`} name="declaredValue" type="number" register={register} errors={errors} required />
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <fieldset>
                  <legend className="label">Service type</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {SERVICES.map((s) => {
                      const disabled = crossBorder ? s.value !== 'international' : s.value === 'international';
                      return (
                        <label key={s.value} className={clsx('cursor-pointer rounded-lg border p-3 text-center text-sm font-medium', v.service === s.value ? 'border-primary-hover bg-primary-light' : 'border-line', disabled && 'cursor-not-allowed opacity-40')}>
                          <input type="radio" value={s.value} disabled={disabled} className="sr-only" {...register('service')} />
                          {s.label}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`COD amount (${currency})`} name="cod" type="number" register={register} errors={errors} />
                  <Field label="Packaging" name="packaging" register={register} errors={errors}>
                    <select id="packaging" className="input" {...register('packaging')}>
                      {PACKAGING.map((p) => <option key={p.value} value={p.value}>{p.label}{p.fee ? ` (Rs ${p.fee})` : ''}</option>)}
                    </select>
                  </Field>
                  {!isMerchant && (
                    <Field label="Courier" name="courier" register={register} errors={errors}>
                      <select id="courier" className="input" {...register('courier')}>
                        {COURIER_NAMES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </Field>
                  )}
                  <label className="flex items-center gap-2 pt-5 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-primary-hover" {...register('insurance')} />
                    Insure parcel ({rateCard.insurancePct}% of declared value)
                  </label>
                </div>
                <FieldError message={errors.declaredValue?.message} />
                <Field label="Notes" name="notes" register={register} errors={errors}>
                  <textarea id="notes" rows={2} className={clsx('input', errors.notes && 'input-error')} placeholder="Call before delivery, handle with care..." {...register('notes')} />
                </Field>
              </div>
            )}

            {step === 4 && (
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <div><p className="label">Sender</p><p className="font-medium">{v.sender.name}</p><p>{v.sender.address}, {v.sender.city}</p><p>{v.sender.phone}</p></div>
                <div><p className="label">Receiver</p><p className="font-medium">{v.receiver.name}</p><p>{v.receiver.address}, {v.receiver.city}</p><p>{v.receiver.phone}</p></div>
                <div>
                  <p className="label">Parcel</p>
                  <p>{v.weight} kg{q ? ` (chargeable ${q.chargeableWeight} kg)` : ''}</p>
                  <ul>{v.items.map((i, idx) => <li key={idx}>{i.qty} x {i.name}</li>)}</ul>
                  <p>Declared: {fmtCurrency(v.declaredValue, currency)}</p>
                </div>
                <div>
                  <p className="label">Service</p>
                  <p>{serviceLabel(v.service)}</p>
                  <p>{Number(v.cod) > 0 ? <b className="text-danger">COD {fmtCurrency(v.cod, currency)}</b> : 'No COD'}</p>
                  {v.insurance && <p>Insured</p>}
                  {v.notes && <p className="text-ink-muted">{v.notes}</p>}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-between border-t border-line p-4">
            <button type="button" className="btn-outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}><ChevronLeft size={15} className="rtl-flip" aria-hidden /> Back</button>
            {step < STEPS.length - 1
              ? <button key="next" type="button" className="btn-primary" onClick={next}>Next <ChevronRight size={15} className="rtl-flip" aria-hidden /></button>
              : <button key="submit" type="submit" className="btn-primary"><CheckCircle2 size={15} aria-hidden /> Confirm booking</button>}
          </div>
          <div className="px-4 pb-3 text-end"><button type="button" className="text-xs text-ink-muted hover:text-ink" onClick={() => navigate('/shipments')}>Discard and exit</button></div>
        </form>

        <Card title="Live price" className="lg:sticky lg:top-20">
          {!q && <p className="py-6 text-center text-sm text-ink-muted">Choose the sender and receiver cities to see the price.</p>}
          {q && (
            <>
              <p className="mb-2 text-xs text-ink-muted">{originCity} to {destCity} - Zone {q.zone} - {q.chargeableWeight} kg chargeable</p>
              <PriceLine label="Base freight" value={q.base} currency={currency} />
              <PriceLine label="Extra weight" value={q.weight} currency={currency} />
              <PriceLine label={`Fuel surcharge (${rateCard.fuelPct}%)`} value={q.fuel} currency={currency} />
              <PriceLine label="Remote area" value={q.remote} currency={currency} />
              <PriceLine label="COD fee" value={q.codFee} currency={currency} />
              <PriceLine label="Insurance" value={q.insurance} currency={currency} />
              <PriceLine label="Packaging" value={q.packaging} currency={currency} />
              <PriceLine label={`Tax (${rateCard.taxPct}%)`} value={q.tax} currency={currency} />
              <PriceLine label="Total" value={q.total} currency={currency} bold />
              {override?.discountPct > 0 && <p className="mt-2 rounded bg-primary-light px-2 py-1 text-xs">Contract discount of {override.discountPct}% applied to freight.</p>}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

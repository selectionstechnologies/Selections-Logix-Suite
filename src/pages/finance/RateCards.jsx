import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import clsx from 'clsx';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Card, PageHeader, Tabs } from '../../components/ui/index.jsx';
import { FieldError, FormModal } from '../../components/forms/EntityForm.jsx';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useLookups } from '../../hooks/useApp.js';
import { CITIES, CITY_NAMES } from '../../data/geo.js';
import { useAuth } from '../../store/authStore.js';
import { savePricing } from '../../lib/api.js';
import { quote, serviceLabel, SERVICES } from '../../utils/pricing.js';
import { fmtCurrency, uid } from '../../utils/format.js';

const pct = z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative').max(100, 'At most 100');
const rulesSchema = z.object({
  codFeeType: z.enum(['percent', 'flat']),
  codFeeValue: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative'),
  codFeeMin: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative'),
  fuelPct: pct,
  remoteCharge: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative'),
  insurancePct: pct,
  taxPct: pct,
  markupPct: pct,
});

const REGIONS = [...new Set(CITIES.map((c) => c.region))];
const AREA_OPTIONS = [
  ...CITY_NAMES.map((c) => ({ value: `city:${c}`, label: `City: ${c}` })),
  ...REGIONS.map((rg) => ({ value: `region:${rg}`, label: `Province / state: ${rg}` })),
];
const areaLabel = (a) => `${a.scope === 'city' ? 'City' : 'Province / state'}: ${a.value}`;
const blankIsCard = (v) => (v === '' || v == null ? 'card rate' : v);

/** Updates the screen at once, saves to the database, and puts the old card back if that fails. */
function usePersistCard() {
  const { rateCard, setValue } = useData();
  return async (card, detail, okMessage) => {
    const prev = rateCard;
    setValue('rateCard', card, 'Rate Card', detail);
    try {
      await savePricing(card);
      if (okMessage) toast.success(okMessage);
      return true;
    } catch (e) {
      setValue('rateCard', prev, 'Rate Card', 'Change not saved');
      toast.error(`Not saved: ${e.message}`);
      return false;
    }
  };
}

function RuleField({ name, label, register, errors, disabled }) {
  return (
    <div>
      <label htmlFor={name} className="label">{label}</label>
      <input id={name} type="number" step="any" disabled={disabled} className={clsx('input', errors[name] && 'input-error')} {...register(name)} />
      <FieldError message={errors[name]?.message} />
    </div>
  );
}

function RulesForm({ canEdit }) {
  const { rateCard } = useData();
  const persist = usePersistCard();
  const { register, handleSubmit, formState: { errors, isDirty }, reset } = useForm({ resolver: zodResolver(rulesSchema), defaultValues: rateCard });
  const save = async (v) => {
    if (await persist({ ...rateCard, ...v }, `Pricing rules updated (fuel ${v.fuelPct}%, COD ${v.codFeeValue})`, 'Pricing rules saved. New bookings use them immediately.')) reset(v);
  };
  return (
    <form onSubmit={handleSubmit(save)} noValidate>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="codFeeType" className="label">COD fee type</label>
          <select id="codFeeType" className="input" disabled={!canEdit} {...register('codFeeType')}><option value="percent">Percent of COD</option><option value="flat">Flat (PKR)</option></select>
        </div>
        <RuleField disabled={!canEdit} name="codFeeValue" label="COD fee value" register={register} errors={errors} />
        <RuleField disabled={!canEdit} name="codFeeMin" label="COD fee minimum (PKR)" register={register} errors={errors} />
        <RuleField disabled={!canEdit} name="fuelPct" label="Fuel surcharge %" register={register} errors={errors} />
        <RuleField disabled={!canEdit} name="remoteCharge" label="Remote-area charge (PKR)" register={register} errors={errors} />
        <RuleField disabled={!canEdit} name="insurancePct" label="Insurance %" register={register} errors={errors} />
        <RuleField disabled={!canEdit} name="taxPct" label="Tax %" register={register} errors={errors} />
        <RuleField disabled={!canEdit} name="markupPct" label="Markup %" register={register} errors={errors} />
      </div>
      {canEdit && <button type="submit" className="btn-primary mt-4" disabled={!isDirty}>Save rules</button>}
    </form>
  );
}

function Calculator() {
  const { rateCard, merchantOverrides } = useData();
  const { merchantOptions } = useLookups();
  const [f, setF] = useState({ originCity: 'Lahore', destCity: 'Karachi', service: 'next-day', weight: 1, cod: 3000, merchantId: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const q = useMemo(() => quote({ ...f, currency: 'PKR' }, rateCard, merchantOverrides.find((o) => o.merchantId === f.merchantId)), [f, rateCard, merchantOverrides]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="co" className="label">From</label><select id="co" className="input" value={f.originCity} onChange={set('originCity')}>{CITY_NAMES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label htmlFor="cd" className="label">To</label><select id="cd" className="input" value={f.destCity} onChange={set('destCity')}>{CITY_NAMES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label htmlFor="cs" className="label">Service</label><select id="cs" className="input" value={f.service} onChange={set('service')}>{SERVICES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        <div><label htmlFor="cw" className="label">Weight (kg)</label><input id="cw" type="number" min="0" step="0.1" className="input" value={f.weight} onChange={set('weight')} /></div>
        <div><label htmlFor="cc" className="label">COD (PKR)</label><input id="cc" type="number" min="0" className="input" value={f.cod} onChange={set('cod')} /></div>
        <div><label htmlFor="cm" className="label">Merchant</label><select id="cm" className="input" value={f.merchantId} onChange={set('merchantId')}><option value="">Standard rate</option>{merchantOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
      </div>
      <div className="rounded-lg bg-surface p-3">
        <p className="mb-1 text-xs text-ink-muted">Zone {q.zone} - {serviceLabel(q.effectiveService)} - {q.chargeableWeight} kg</p>
        {[['Base', q.base], ['Weight', q.weight], ['Fuel', q.fuel], ['Remote', q.remote], ['COD fee', q.codFee], ['Tax', q.tax]].map(([l, v]) => <div key={l} className="flex justify-between py-0.5 text-sm"><span className="text-ink-muted">{l}</span><span>{fmtCurrency(v)}</span></div>)}
        <div className="mt-1 flex justify-between border-t border-line pt-1.5 font-bold"><span>Total</span><span>{fmtCurrency(q.total)}</span></div>
      </div>
    </div>
  );
}

export function RateCards() {
  const lookups = useLookups();
  const { rateCard, merchantOverrides, addItem, updateItem, removeItem } = useData();
  const persist = usePersistCard();
  const canEdit = useAuth((st) => st.user.role) === 'super_admin';
  const areaRates = rateCard.areaRates || [];
  const [editArea, setEditArea] = useState(null); // {} = new
  const [tab, setTab] = useState('zones');
  const [editZone, setEditZone] = useState(null);
  const [editSlab, setEditSlab] = useState(null);
  const [override, setOverride] = useState(null); // {} = new

  const saveSlab = async (v) => {
    const slabs = editSlab.id ? rateCard.slabs.map((s) => (s.id === editSlab.id ? { ...s, ...v } : s)) : [...rateCard.slabs, { id: uid('S'), ...v }];
    if (await persist({ ...rateCard, slabs }, 'Weight slabs updated', 'Weight slab saved')) setEditSlab(null);
  };
  const delSlab = async (s) => {
    if (rateCard.slabs.length === 1) { toast.error('Keep at least one weight slab'); return; }
    if (await confirm({ title: 'Delete slab?', message: `The up-to-${s.upTo} kg slab will be removed.`, confirmLabel: 'Delete' })) {
      await persist({ ...rateCard, slabs: rateCard.slabs.filter((x) => x.id !== s.id) }, 'Weight slab deleted', 'Slab deleted');
    }
  };

  const saveArea = async (v) => {
    const [scope, ...rest] = v.area.split(':');
    const value = rest.join(':');
    const dup = areaRates.find((a) => a.scope === scope && a.value === value && a.id !== editArea.id);
    if (dup) { toast.error(`${areaLabel(dup)} already has a rule. Edit that one.`); return; }
    const row = {
      id: editArea.id || uid('AR'), scope, value, active: !!v.active,
      sameDay: v.sameDay ?? '', nextDay: v.nextDay ?? '', economy: v.economy ?? '', international: v.international ?? '',
      fuelPct: v.fuelPct ?? '', taxPct: v.taxPct ?? '', remoteCharge: v.remoteCharge ?? '',
    };
    const next = editArea.id ? areaRates.map((a) => (a.id === editArea.id ? row : a)) : [...areaRates, row];
    if (await persist({ ...rateCard, areaRates: next }, `${areaLabel(row)} rate ${editArea.id ? 'updated' : 'added'}`, 'Area rate saved. New bookings use it immediately.')) setEditArea(null);
  };
  const delArea = async (a) => {
    if (await confirm({ title: 'Remove this rate?', message: `${areaLabel(a)} goes back to the standard rate card.`, confirmLabel: 'Remove' })) {
      await persist({ ...rateCard, areaRates: areaRates.filter((x) => x.id !== a.id) }, `${areaLabel(a)} rate removed`, 'Area rate removed');
    }
  };

  return (
    <div>
      <PageHeader title="Rate Cards" subtitle="Saved in the database and used live by the booking form and bulk import. Existing shipments keep their booked price." />
      {!canEdit && <p className="mb-3 rounded-lg bg-primary-light px-3 py-2 text-sm">View only. Prices are changed by the Super Admin.</p>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'zones', label: 'Zones & services' }, { value: 'areas', label: 'City / province rates', count: areaRates.length }, { value: 'slabs', label: 'Weight slabs' }, { value: 'rules', label: 'Fees & surcharges' }, { value: 'overrides', label: 'Merchant overrides', count: merchantOverrides.length }, { value: 'calc', label: 'Calculator' }]} />
      {tab === 'zones' && (
        <Card title="First 0.5 kg, in PKR" bodyClass="">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs text-ink-muted"><tr>{['Zone', 'Same day', 'Next day', 'Economy', 'International', ''].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2 text-start font-medium">{h}</th>)}</tr></thead>
              <tbody>{rateCard.zones.map((z) => <tr key={z.id} className="border-t border-line"><td className="whitespace-nowrap px-4 py-2 font-medium">{z.name}</td><td className="px-4 py-2">{z.sameDay}</td><td className="px-4 py-2">{z.nextDay}</td><td className="px-4 py-2">{z.economy}</td><td className="px-4 py-2">{z.international}</td><td className="px-4 py-2">{canEdit && <button type="button" className="btn-outline btn-sm" onClick={() => setEditZone(z)}><Pencil size={13} aria-hidden /> Edit</button>}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
      )}
      {tab === 'slabs' && (
        <Card title="Charge per kg above the first 0.5 kg" bodyClass="" actions={canEdit && <button type="button" className="btn-outline btn-sm" onClick={() => setEditSlab({})}><Plus size={13} aria-hidden /> Add slab</button>}>
          <ul className="divide-y divide-line">
            {[...rateCard.slabs].sort((a, b) => a.upTo - b.upTo).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>Up to <b>{s.upTo >= 9999 ? 'any weight' : `${s.upTo} kg`}</b></span>
                <span>Rs {s.perKg} / kg</span>
                <span className={clsx('flex gap-1', !canEdit && 'hidden')}>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEditSlab(s)} aria-label="Edit slab"><Pencil size={14} /></button>
                  <button type="button" className="btn-ghost btn-sm hover:!text-danger" onClick={() => delSlab(s)} aria-label="Delete slab"><Trash2 size={14} /></button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tab === 'areas' && (
        <Card
          title="Rates for a destination city or province / state"
          bodyClass=""
          actions={canEdit && <button type="button" className="btn-outline btn-sm" onClick={() => setEditArea({ active: true })}><Plus size={13} aria-hidden /> Add rate</button>}
        >
          <p className="border-b border-line bg-surface px-4 py-2 text-xs text-ink-muted">
            For each value, a city rule is used first, then its province / state rule, then the normal rate card. Leave a field blank to fall back. Cross-border shipments always use the International rate.
          </p>
          {!areaRates.length ? <p className="p-4 text-sm text-ink-muted">No city or province rates yet. Every destination uses the normal rate card.</p> : (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-xs text-ink-muted"><tr>{['Applies to', 'Same day', 'Next day', 'Economy', 'Fuel %', 'Tax %', 'Remote', 'Status', ''].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2 text-start font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {[...areaRates].sort((a, b) => a.scope.localeCompare(b.scope) || a.value.localeCompare(b.value)).map((a) => (
                    <tr key={a.id} className="border-t border-line">
                      <td className="whitespace-nowrap px-4 py-2 font-medium">{areaLabel(a)}</td>
                      {['sameDay', 'nextDay', 'economy', 'fuelPct', 'taxPct', 'remoteCharge'].map((k) => <td key={k} className={clsx('px-4 py-2', (a[k] === '' || a[k] == null) && 'text-ink-muted')}>{blankIsCard(a[k])}</td>)}
                      <td className="px-4 py-2">{a.active === false ? 'Off' : 'On'}</td>
                      <td className="px-4 py-2">
                        {canEdit && (
                          <span className="flex gap-1">
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditArea(a)} aria-label={`Edit ${areaLabel(a)}`}><Pencil size={14} /></button>
                            <button type="button" className="btn-ghost btn-sm hover:!text-danger" onClick={() => delArea(a)} aria-label={`Remove ${areaLabel(a)}`}><Trash2 size={14} /></button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === 'rules' && <Card title="Fees, surcharges and markup"><RulesForm canEdit={canEdit} /></Card>}
      {tab === 'overrides' && (
        <Card title="Per-merchant pricing" bodyClass="" actions={<button type="button" className="btn-outline btn-sm" onClick={() => setOverride({})}><Plus size={13} aria-hidden /> Add override</button>}>
          <ul className="divide-y divide-line">
            {merchantOverrides.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium">{lookups.merchantName(o.merchantId)}</span>
                <span className="text-ink-muted">{o.discountPct}% discount, COD fee {o.codFeePct}%</span>
                <span className="flex gap-1">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setOverride(o)} aria-label="Edit override"><Pencil size={14} /></button>
                  <button type="button" className="btn-ghost btn-sm hover:!text-danger" aria-label="Delete override" onClick={async () => { if (await confirm({ title: 'Remove override?', message: `${lookups.merchantName(o.merchantId)} returns to standard pricing.`, confirmLabel: 'Remove' })) { removeItem('merchantOverrides', o.id, 'Rate Card'); toast.success('Override removed'); } }}><Trash2 size={14} /></button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tab === 'calc' && <Card title="Price calculator"><Calculator /></Card>}
      <FormModal
        open={!!editZone}
        onClose={() => setEditZone(null)}
        title={`Edit ${editZone?.name}`}
        fields={[['sameDay', 'Same day'], ['nextDay', 'Next day'], ['economy', 'Economy'], ['international', 'International']].map(([name, label]) => ({ name, label, type: 'number', required: true, min: 0 }))}
        defaultValues={editZone}
        onSubmit={async (v) => { if (await persist({ ...rateCard, zones: rateCard.zones.map((z) => (z.id === editZone.id ? { ...z, ...v } : z)) }, `${editZone.name} rates updated`, 'Zone rates saved')) setEditZone(null); }}
      />
      <FormModal
        open={!!editArea}
        onClose={() => setEditArea(null)}
        title={editArea?.id ? `Edit ${areaLabel(editArea)}` : 'Add city / province rate'}
        size="lg"
        fields={[
          { name: 'area', label: 'Applies to (destination)', type: 'select', required: true, options: AREA_OPTIONS, full: true },
          { name: 'sameDay', label: 'Same day: first 0.5 kg (PKR)', type: 'number', min: 0, placeholder: 'Blank = card rate' },
          { name: 'nextDay', label: 'Next day: first 0.5 kg (PKR)', type: 'number', min: 0, placeholder: 'Blank = card rate' },
          { name: 'economy', label: 'Economy: first 0.5 kg (PKR)', type: 'number', min: 0, placeholder: 'Blank = card rate' },
          { name: 'remoteCharge', label: 'Remote-area charge (PKR)', type: 'number', min: 0, placeholder: 'Blank = card rule' },
          { name: 'fuelPct', label: 'Fuel surcharge %', type: 'number', min: 0, max: 100, placeholder: `Blank = ${rateCard.fuelPct}%` },
          { name: 'taxPct', label: 'Tax % (e.g. provincial sales tax)', type: 'number', min: 0, max: 100, placeholder: `Blank = ${rateCard.taxPct}%` },
          { name: 'active', label: 'Rule is active', type: 'checkbox' },
        ]}
        defaultValues={editArea?.id ? { ...editArea, area: `${editArea.scope}:${editArea.value}` } : editArea}
        onSubmit={saveArea}
      />
      <FormModal
        open={!!editSlab}
        onClose={() => setEditSlab(null)}
        title={editSlab?.id ? 'Edit slab' : 'Add slab'}
        fields={[{ name: 'upTo', label: 'Up to (kg)', type: 'number', required: true, min: 0.5 }, { name: 'perKg', label: 'Rs per kg', type: 'number', required: true, min: 0 }]}
        defaultValues={editSlab}
        onSubmit={saveSlab}
      />
      <FormModal
        open={!!override}
        onClose={() => setOverride(null)}
        title={override?.id ? 'Edit override' : 'Add override'}
        fields={[
          { name: 'merchantId', label: 'Merchant', type: 'select', options: lookups.merchantOptions, required: true, full: true },
          { name: 'discountPct', label: 'Freight discount %', type: 'number', required: true, min: 0, max: 100 },
          { name: 'codFeePct', label: 'COD fee %', type: 'number', required: true, min: 0, max: 100 },
        ]}
        defaultValues={override}
        onSubmit={(v) => {
          if (override.id) updateItem('merchantOverrides', override.id, v, 'Rate Card', 'Override edited');
          else if (merchantOverrides.some((o) => o.merchantId === v.merchantId)) { toast.error('This merchant already has an override. Edit that one.'); return; }
          else addItem('merchantOverrides', { id: uid('OV'), ...v }, 'Rate Card', 'Override added');
          setOverride(null);
          toast.success('Override saved');
        }}
      />
    </div>
  );
}

// Pricing engine shared by the booking form, bulk import and seed data.
// Everything is computed in PKR and converted to the shipment currency at the end.
import { CITY_MAP } from '../data/geo.js';
import { FX } from './format.js';

export const SERVICES = [
  { value: 'same-day', label: 'Same Day', days: 1 },
  { value: 'next-day', label: 'Next Day', days: 2 },
  { value: 'economy', label: 'Economy', days: 4 },
  { value: 'international', label: 'International', days: 7 },
];
export const serviceLabel = (v) => SERVICES.find((s) => s.value === v)?.label || v;

export const PACKAGING = [
  { value: 'none', label: 'Own packaging', fee: 0 },
  { value: 'flyer', label: 'Flyer', fee: 40 },
  { value: 'box-s', label: 'Small box', fee: 120 },
  { value: 'box-l', label: 'Large box', fee: 280 },
  { value: 'fragile', label: 'Fragile wrap', fee: 350 },
];

// What is inside the parcel. Rules in the booking form read these flags.
export const PRODUCT_TYPES = [
  { value: 'parcel', label: 'General Parcel', hint: 'Everyday goods with no special handling' },
  { value: 'document', label: 'Documents', hint: 'Papers, cheques, certificates in an envelope', document: true },
  { value: 'clothing', label: 'Clothing & Textile', hint: 'Garments, fabric, shoes' },
  { value: 'electronics', label: 'Electronics', hint: 'Phones, laptops, accessories. Insurance recommended', insure: true },
  { value: 'fragile', label: 'Fragile', hint: 'Glass, ceramics, decor. Fragile wrap recommended', fragile: true },
  { value: 'cosmetics', label: 'Cosmetics & Beauty', hint: 'Creams, perfumes, makeup' },
  { value: 'food', label: 'Food / Perishable', hint: 'Same Day or Next Day only', perishable: true },
  { value: 'liquid', label: 'Liquids', hint: 'Sealed containers only. Not allowed cross-border', liquid: true },
  { value: 'valuables', label: 'Valuables', hint: 'Jewellery, watches. Insurance is mandatory', insure: true, mustInsure: true },
  { value: 'other', label: 'Other', hint: 'Describe the goods in the product name' },
];
export const productTypeLabel = (v) => PRODUCT_TYPES.find((p) => p.value === v)?.label || v || '-';

export const UNITS = ['Pcs', 'Box', 'Pack', 'Pair', 'Set', 'Dozen', 'Kg', 'Litre', 'Envelope'];

// Who pays and when. COD collects the goods amount from the receiver; To Pay collects the delivery charges.
export const PAYMENT_TYPES = [
  { value: 'prepaid', label: 'Prepaid', hint: 'Sender pays the delivery charges now. Nothing is collected at the door.' },
  { value: 'cod', label: 'Cash on Delivery', hint: 'Rider collects the goods amount from the receiver and it is remitted to the sender.' },
  { value: 'topay', label: 'To Pay', hint: 'Receiver pays the delivery charges to the rider at the door.' },
];
export const paymentTypeLabel = (v) => PAYMENT_TYPES.find((p) => p.value === v)?.label || 'Prepaid';

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', hint: 'Paid at the counter' },
  { value: 'online', label: 'Online', hint: 'JazzCash, Easypaisa, bank or card' },
  { value: 'credit', label: 'Credit (Account)', hint: 'Added to the merchant monthly invoice' },
  { value: 'cod-deduct', label: 'Deduct from COD', hint: 'Charges are taken out of the COD remittance' },
];
export const paymentMethodLabel = (v) => PAYMENT_METHODS.find((p) => p.value === v)?.label || v;
export const ONLINE_CHANNELS = ['JazzCash', 'Easypaisa', 'Bank Transfer', 'Card / POS'];

export const DEFAULT_RATE_CARD = {
  // first 0.5 kg per zone, per service
  zones: [
    { id: 'A', name: 'Zone A - Same city', sameDay: 250, nextDay: 180, economy: 140, international: 0 },
    { id: 'B', name: 'Zone B - Same region', sameDay: 420, nextDay: 260, economy: 200, international: 0 },
    { id: 'C', name: 'Zone C - Nationwide', sameDay: 650, nextDay: 340, economy: 260, international: 0 },
    { id: 'X', name: 'Zone X - Cross-border', sameDay: 0, nextDay: 0, economy: 0, international: 3200 },
  ],
  slabs: [
    { id: 'S1', upTo: 1, perKg: 110 },
    { id: 'S2', upTo: 5, perKg: 90 },
    { id: 'S3', upTo: 20, perKg: 70 },
    { id: 'S4', upTo: 9999, perKg: 55 },
  ],
  codFeeType: 'percent', // percent | flat
  codFeeValue: 1.5,
  codFeeMin: 30,
  fuelPct: 8,
  remoteCharge: 150,
  insurancePct: 1,
  taxPct: 16,
  markupPct: 0,
  costPct: 68, // internal cost as a share of freight, used for profit reporting
};

const ZONE_KEY = { 'same-day': 'sameDay', 'next-day': 'nextDay', economy: 'economy', international: 'international' };

export function resolveZone(originCity, destCity) {
  const a = CITY_MAP[originCity];
  const b = CITY_MAP[destCity];
  if (!a || !b) return 'C';
  if (a.country !== b.country) return 'X';
  if (a.name === b.name) return 'A';
  return a.region === b.region ? 'B' : 'C';
}

export const volumetricWeight = (l, w, h) => ((Number(l) || 0) * (Number(w) || 0) * (Number(h) || 0)) / 5000;

export const chargeableWeight = ({ weight, length, width, height }) =>
  Math.max(Number(weight) || 0, volumetricWeight(length, width, height), 0.5);

/** Cost of weight above the first 0.5 kg, walked slab by slab. */
function slabCharge(weight, slabs) {
  let remaining = weight - 0.5;
  let from = 0.5;
  let total = 0;
  for (const slab of [...slabs].sort((a, b) => a.upTo - b.upTo)) {
    if (remaining <= 0) break;
    const span = Math.min(remaining, slab.upTo - from);
    if (span > 0) {
      total += span * slab.perKg;
      remaining -= span;
      from = slab.upTo;
    }
  }
  return total;
}

/**
 * Live quote. `input` amounts for cod/declaredValue are in `currency`.
 * Returns the breakdown in `currency`, rounded to 2 dp (whole rupees for PKR).
 */
export function quote(input, card = DEFAULT_RATE_CARD, override = null) {
  const {
    originCity, destCity, service = 'next-day', weight = 0.5, length, width, height,
    cod = 0, declaredValue = 0, insurance = false, packaging = 'none', currency = 'PKR',
  } = input;
  const fx = FX[currency] || 1;
  const zoneId = resolveZone(originCity, destCity);
  const zone = card.zones.find((z) => z.id === zoneId) || card.zones[2];
  // A cross-border lane always prices at the international rate, whatever service was picked.
  const effectiveService = zoneId === 'X' ? 'international' : service === 'international' ? 'economy' : service;
  const chargeable = chargeableWeight({ weight, length, width, height });

  const discount = 1 - (Number(override?.discountPct) || 0) / 100;
  const markup = 1 + (Number(card.markupPct) || 0) / 100;
  const base = (Number(zone[ZONE_KEY[effectiveService]]) || 0) * discount * markup;
  const weightCharge = slabCharge(chargeable, card.slabs) * discount * markup;
  const fuel = ((base + weightCharge) * (Number(card.fuelPct) || 0)) / 100;
  const remote = CITY_MAP[destCity]?.remote ? Number(card.remoteCharge) || 0 : 0;

  const codPKR = (Number(cod) || 0) * fx;
  const codFeeValue = override?.codFeePct != null && override?.codFeePct !== '' ? Number(override.codFeePct) : Number(card.codFeeValue);
  let codFee = 0;
  if (codPKR > 0) {
    codFee = card.codFeeType === 'flat' ? codFeeValue : Math.max((codPKR * codFeeValue) / 100, Number(card.codFeeMin) || 0);
  }

  const insuranceFee = insurance ? ((Number(declaredValue) || 0) * fx * (Number(card.insurancePct) || 0)) / 100 : 0;
  const packagingFee = PACKAGING.find((p) => p.value === packaging)?.fee || 0;
  const subtotal = base + weightCharge + fuel + remote + codFee + insuranceFee + packagingFee;
  const tax = (subtotal * (Number(card.taxPct) || 0)) / 100;
  const total = subtotal + tax;
  const cost = ((base + weightCharge + fuel + remote) * (Number(card.costPct) || 68)) / 100;

  const out = (n) => (currency === 'PKR' ? Math.round(n) : Math.round((n / fx) * 100) / 100);
  const parts = {
    base: out(base), weight: out(weightCharge), fuel: out(fuel), remote: out(remote),
    codFee: out(codFee), insurance: out(insuranceFee), packaging: out(packagingFee), tax: out(tax),
  };
  // Total is the sum of the rounded parts so the breakdown always adds up on screen.
  const totalRounded = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    ...parts,
    total: currency === 'PKR' ? totalRounded : Math.round(totalRounded * 100) / 100,
    cost: out(cost),
    zone: zoneId,
    chargeableWeight: Math.round(chargeable * 100) / 100,
    effectiveService,
    rawTotal: total,
  };
}

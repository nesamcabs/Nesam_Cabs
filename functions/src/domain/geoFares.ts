// Location-scoped Local Pickup & Drop and Hourly Rental rates (collection geo_fares). Pure functions, no database.
//
// One document per brand ('common' = all brands), service and scope key (see geoScope.ts):  `${brand}__${service}__${scopeKey}`.
// Every value is saved per vehicle class and per field; a field that is not saved is inherited from the wider scope:
//     brand area → brand zone → brand district → common area → common zone → common district → (Rental only) the existing package.
// A brand's own value beats a shared one, exactly like the rest of the fare settings. A saved 0 is a value; a missing field is
// unconfigured and is never read as 0. Removing a field (null in a save) restores inheritance.
import type { RentalPackage, TariffClass } from './tariff';

export type GeoService = 'local' | 'rental';
export const GEO_SERVICES: GeoService[] = ['local', 'rental'];

/** Local Pickup & Drop fields, the same for the customer fare and the partner payout. */
export const LOCAL_FIELDS = ['baseFare', 'includedKm', 'extraKmRate', 'minimumFare', 'freeWaitingMin', 'waitingPerMin'] as const;
export type LocalField = (typeof LOCAL_FIELDS)[number];
export type LocalParty = Partial<Record<LocalField, number>>;
export interface LocalGeoClass { customer?: LocalParty; partner?: LocalParty }

/** Hourly Rental package fields (1–15 hours). */
export const RENTAL_FIELDS = ['customerFare', 'partnerPayout', 'includedKm', 'extraKmRate', 'extraHourRate'] as const;
export type RentalField = (typeof RENTAL_FIELDS)[number];
export type RentalGeoPackage = Partial<Record<RentalField, number>>;
export interface RentalGeoClass { gstMode?: 'included' | 'excluded'; packages?: Record<string, RentalGeoPackage> }

/** Airport entry fee saved on an Airport location's own (area) Local document. */
export interface AirportEntry { customerFee: number; partnerFee: number; appliesTo: 'pickup' | 'drop' | 'both' }

export interface GeoFareDoc {
  brand: string;
  service: GeoService;
  scopeKey: string;
  version: number;
  classes: Partial<Record<TariffClass, LocalGeoClass & RentalGeoClass>>;
  airportEntry?: AirportEntry;
}

export const geoDocId = (brand: string, service: GeoService, key: string) => `${brand || 'common'}__${service}__${key}`;

/** The documents to read for a pickup, in resolution order (brand first, then common; most specific scope first). */
export function geoChain(brand: string, service: GeoService, keys: string[]): string[] {
  const brands = brand && brand !== 'common' ? [brand, 'common'] : ['common'];
  return brands.flatMap((b) => keys.map((k) => geoDocId(b, service, k)));
}

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const MAX: Record<string, number> = { includedKm: 2000, freeWaitingMin: 600 };

/** Validates one saved value; null = remove the override. Throws a readable message for anything else. */
export function parseValue(field: string, v: unknown, label: string): number | null {
  if (v === null) return null;
  if (!isAmount(v)) throw new Error(`${label}: enter zero or more.`);
  const cap = MAX[field] ?? 100000;
  if (v > cap) throw new Error(`${label} must not exceed ${cap}.`);
  return Math.round(v * 100) / 100;
}

export interface Resolved<T> { value: T; source: string }
/** Where a resolved value came from: the doc id that supplied it, or 'package' for the existing rental package. */
export type SourceMap<F extends string> = Partial<Record<F, Resolved<number>>>;

/** Each field from the first document in the chain that saves it. */
function pick<F extends string>(fields: readonly F[], layers: { id: string; values?: Partial<Record<F, number>> }[]): SourceMap<F> {
  const out: SourceMap<F> = {};
  for (const f of fields) {
    for (const layer of layers) {
      const v = layer.values?.[f];
      if (isAmount(v)) { out[f] = { value: v, source: layer.id }; break; }
    }
  }
  return out;
}

export interface LocalResolved {
  customer: SourceMap<LocalField>;
  partner: SourceMap<LocalField>;
  /** Something is saved for this class somewhere in the chain. */
  any: boolean;
  /** Every field of both parties resolved and the fare is not free. */
  complete: boolean;
  missing: string[];
  /** The docs (and their versions) that supplied any value: stored with the booking. */
  versions: Record<string, number>;
}

const LOCAL_LABEL: Record<LocalField, string> = {
  baseFare: 'base fare', includedKm: 'included km', extraKmRate: 'extra-km rate', minimumFare: 'minimum fare', freeWaitingMin: 'free waiting minutes', waitingPerMin: 'waiting charge per minute',
};

export function resolveLocal(docs: Map<string, GeoFareDoc>, chain: string[], cls: TariffClass): LocalResolved {
  const layers = chain.map((id) => ({ id, cls: docs.get(id)?.classes?.[cls] }));
  const customer = pick(LOCAL_FIELDS, layers.map((l) => ({ id: l.id, values: l.cls?.customer })));
  const partner = pick(LOCAL_FIELDS, layers.map((l) => ({ id: l.id, values: l.cls?.partner })));
  const missing: string[] = [];
  for (const f of LOCAL_FIELDS) {
    if (!customer[f]) missing.push(`customer ${LOCAL_LABEL[f]}`);
    if (!partner[f]) missing.push(`partner ${LOCAL_LABEL[f]}`);
  }
  const free = (p: SourceMap<LocalField>) => (p.baseFare?.value ?? 0) <= 0 && (p.minimumFare?.value ?? 0) <= 0 && (p.extraKmRate?.value ?? 0) <= 0;
  if (!missing.length && free(customer)) missing.push('a customer base fare, minimum fare or extra-km rate above zero');
  const versions: Record<string, number> = {};
  for (const s of [...Object.values(customer), ...Object.values(partner)]) if (s) versions[s.source] = docs.get(s.source)?.version ?? 0;
  return { customer, partner, any: Object.keys(customer).length + Object.keys(partner).length > 0, complete: missing.length === 0, missing, versions };
}

const v = (m: SourceMap<LocalField>, f: LocalField) => m[f]!.value;

/**
 * The approved Local ride fare, in paise:
 *   extraKm       = max(0, billableKm − includedKm)
 *   waitingCharge = max(0, eligibleWaitingMinutes − freeWaitingMinutes) × waitingRate
 *   rideFare      = max(minimumFare, baseFare + extraKm × extraKmRate + waitingCharge)
 * An upfront quote has no waiting minutes (they are never invented); waiting is billed at actuals when the trip ends.
 */
export function localRideFarePaise(p: SourceMap<LocalField>, billableKm: number, waitingMinutes = 0) {
  const km = Math.round(billableKm * 10) / 10;
  const extraKm = Math.max(0, Math.round((km - v(p, 'includedKm')) * 10) / 10);
  const basePaise = Math.round(v(p, 'baseFare') * 100);
  const extraPaise = Math.round(extraKm * v(p, 'extraKmRate') * 100);
  const waitMin = Math.max(0, Math.floor(waitingMinutes) - v(p, 'freeWaitingMin'));
  const waitingPaise = Math.round(waitMin * v(p, 'waitingPerMin') * 100);
  const metered = basePaise + extraPaise + waitingPaise;
  const minimumPaise = Math.round(v(p, 'minimumFare') * 100);
  const totalPaise = Math.max(minimumPaise, metered);
  return { km, extraKm, basePaise, extraPaise, waitingPaise, minimumTopUpPaise: totalPaise - metered, totalPaise };
}

export interface RentalResolved {
  values: SourceMap<RentalField>;
  gstMode: Resolved<'included' | 'excluded'> | null;
  /** Some location-scoped value is saved for this class and hours (otherwise the existing package applies unchanged). */
  scoped: boolean;
  complete: boolean;
  missing: string[];
  versions: Record<string, number>;
  /** The package to quote, when complete. */
  pkg: RentalPackage | null;
}

const RENTAL_LABEL: Record<RentalField, string> = { customerFare: 'customer fare', partnerPayout: 'partner payout', includedKm: 'included km', extraKmRate: 'extra-km rate', extraHourRate: 'extra-hour rate' };

/**
 * The rental package of a class and hours: location-scoped values first, then the existing (brand-scoped) package as the broadest
 * default. A disabled or incomplete existing package supplies nothing. Only a complete package may be quoted; another package is
 * never substituted.
 */
export function resolveRental(docs: Map<string, GeoFareDoc>, chain: string[], cls: TariffClass, hours: number, existing?: Partial<RentalPackage> | null): RentalResolved {
  const h = String(hours);
  const base = existing && existing.enabled ? existing : null;
  const layers = [
    ...chain.map((id) => ({ id, values: docs.get(id)?.classes?.[cls]?.packages?.[h] })),
    { id: 'package', values: base ? (Object.fromEntries(RENTAL_FIELDS.map((f) => [f, base[f]])) as RentalGeoPackage) : undefined },
  ];
  const values = pick(RENTAL_FIELDS, layers);
  let gstMode: RentalResolved['gstMode'] = null;
  for (const id of chain) {
    const m = docs.get(id)?.classes?.[cls]?.gstMode;
    if (m === 'included' || m === 'excluded') { gstMode = { value: m, source: id }; break; }
  }
  if (!gstMode && (base?.gstMode === 'included' || base?.gstMode === 'excluded')) gstMode = { value: base.gstMode, source: 'package' };
  const missing = RENTAL_FIELDS.filter((f) => !values[f]).map((f) => RENTAL_LABEL[f]);
  if (!gstMode) missing.push('GST included / added');
  if (values.customerFare && values.customerFare.value <= 0) missing.push('a customer fare above zero');
  const scoped = Object.values(values).some((s) => s && s.source !== 'package') || (!!gstMode && gstMode.source !== 'package');
  const versions: Record<string, number> = {};
  for (const s of [...Object.values(values), gstMode]) if (s && s.source !== 'package') versions[s.source] = docs.get(s.source)?.version ?? 0;
  const complete = missing.length === 0;
  const pkg: RentalPackage | null = complete ? {
    customerFare: values.customerFare!.value, partnerPayout: values.partnerPayout!.value, includedKm: values.includedKm!.value,
    extraKmRate: values.extraKmRate!.value, extraHourRate: values.extraHourRate!.value, gstMode: gstMode!.value, enabled: true,
  } : null;
  return { values, gstMode, scoped, complete, missing, versions, pkg };
}

/** The airport entry of the first Airport record (pickup or drop chain) whose own document saves one. Charged once per trip. */
export function airportEntryFor(docs: Map<string, GeoFareDoc>, brand: string, pickupIds: string[], dropIds: string[]): (AirportEntry & { locationId: string; side: 'pickup' | 'drop'; docId: string; version: number }) | null {
  const brands = brand && brand !== 'common' ? [brand, 'common'] : ['common'];
  for (const [side, ids] of [['pickup', pickupIds], ['drop', dropIds]] as const) {
    for (const id of ids) {
      for (const b of brands) {
        const docId = geoDocId(b, 'local', `a_${id}`);
        const e = docs.get(docId)?.airportEntry;
        if (e && (e.appliesTo === 'both' || e.appliesTo === side)) return { ...e, locationId: id, side, docId, version: docs.get(docId)?.version ?? 0 };
      }
    }
  }
  return null;
}

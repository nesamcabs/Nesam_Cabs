// Admin edits to business_config/tariff_v2, one section at a time: base rates (with outstation extra
// usage and the airport fare), a city's Local Pickup & Drop fare, a class's minimum rental hours and a
// rental package. Each save is validated here (the editors' checks are only a convenience), refuses a stale
// edit, bumps the tariff version and writes the audit entry in the same transaction. A saved tariff only
// changes NEW quotes: a booking keeps the pricing snapshot it was quoted with.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import {
  BrandFareOverride, RENTAL_HOURS, RentalPackage, TARIFF_CLASSES, TariffClass, TariffConfig, parseRentalPackage, parseTariffConfig, rentalMinHours,
} from './domain/tariff';
import { EXTRA_CATEGORY_ID, ExtraChargeRow, ExtraChargeSide, ExtraChargesConfig, MAX_FREE_WAITING_MINUTES, MAX_WAITING_ROUNDING_MINUTES, ROUNDING_SCOPES, RoundingScope, TAX_TREATMENTS, TaxTreatment } from './domain/extraCharges';
import { TARIFF_DOC } from './quote';
import { requirePermission, text, requireAction } from './shared';
import { BRAND_SUPPORTED_SERVICES, BrandId, SUPPORTED_BRANDS } from './brandContext';
import { gstState, validGstRule, type FareGstRule } from './domain/gst';

const MAX_AMOUNT = 1_000_000;
const bad = (m: string) => new HttpsError('invalid-argument', m);

/** A finite rupee amount at paise precision. `positive` forbids zero (allowances and waiting may be zero). */
function amount(v: unknown, label: string, positive: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${label} must be a number.`);
  if (positive ? v <= 0 : v < 0) throw bad(`${label} must be ${positive ? 'greater than zero' : 'zero or more'}.`);
  if (v > MAX_AMOUNT) throw bad(`${label} is too large.`);
  return Math.round(v * 100) / 100;
}

const obj = (v: unknown, label: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(`${label} is missing.`);
  return v as Record<string, unknown>;
};

function classOf(v: unknown): TariffClass {
  if (typeof v !== 'string' || !(TARIFF_CLASSES as readonly string[]).includes(v)) throw bad('Choose a supported vehicle category.');
  return v as TariffClass;
}

function hoursOf(v: unknown): number {
  if (typeof v !== 'number' || !(RENTAL_HOURS as readonly number[]).includes(v)) throw bad(`Rental packages are 4, 6, 8, 10 or 12 hours.`);
  return v;
}

// ── Section: base rates, outstation extra usage, airport ────────────────────

function applyBaseRates(base: TariffConfig, d: Record<string, unknown>): TariffConfig {
  const next: TariffConfig = {
    ...base,
    oneWay: { ...base.oneWay, classes: { ...base.oneWay.classes } },
    roundTrip: { ...base.roundTrip, classes: { ...base.roundTrip.classes } },
    outstationExtras: { ...(base.outstationExtras ?? {}) },
    oneWayExtras: { ...(base.oneWayExtras ?? {}) },
    roundTripExtras: { ...(base.roundTripExtras ?? {}) },
  };
  next.oneWay.minKm = amount(d.oneWayMinKm, 'One Way minimum kilometres', true);
  if (d.airport != null) {
    const a = obj(d.airport, 'The airport fare');
    next.airport = { customerBase: amount(a.customerBase, 'Airport customer base fare', true), partnerBase: amount(a.partnerBase, 'Airport partner base payout', true) };
  }
  const classes = obj(d.classes, 'The category rates');
  for (const [key, raw] of Object.entries(classes)) {
    const cls = classOf(key);
    // Innova and SUV 7+1 may be cleared (null): they then use the SUV rates again. Every other class must stay configured.
    if (raw === null) {
      if (cls !== 'innova' && cls !== 'suv7') throw bad('Only the Innova and SUV 7+1 rates can be cleared.');
      delete next.oneWay.classes[cls]; delete next.roundTrip.classes[cls]; delete next.outstationExtras![cls];
      delete next.oneWayExtras![cls]; delete next.roundTripExtras![cls];
      continue;
    }
    const c = obj(raw, `The ${cls} rates`);
    const one = obj(c.oneWay, `The ${cls} One Way rates`), round = obj(c.roundTrip, `The ${cls} Round Trip rates`);
    next.oneWay.classes[cls] = {
      customerRate: amount(one.customerRate, `${cls} Customer One Way rate`, true), partnerRate: amount(one.partnerRate, `${cls} Partner One Way rate`, true),
      customerBata: amount(one.customerBata, `${cls} Customer allowance`, false), partnerBata: amount(one.partnerBata, `${cls} Partner allowance`, false),
    };
    const minKmPerDay = amount(round.minKmPerDay, `${cls} Round Trip minimum kilometres per day`, true);
    next.roundTrip.classes[cls] = {
      customerRate: amount(round.customerRate, `${cls} Customer Round Trip rate`, true), partnerRate: amount(round.partnerRate, `${cls} Partner Round Trip rate`, true),
      // One Way and Round Trip keep separate allowances (the confirmed Crysta values differ), so each has its own pair.
      customerBata: amount(round.customerBata, `${cls} Round Trip customer allowance`, false), partnerBata: amount(round.partnerBata, `${cls} Round Trip partner allowance`, false),
      minKmPerDay,
    };
    // Old clients can still update the shared fallback, but cannot overwrite separately saved journey rates.
    for (const [field, target, label] of [
      ['outstationExtra', next.outstationExtras!, 'Outstation'],
      ['oneWayExtra', next.oneWayExtras!, 'One Way'],
      ['roundTripExtra', next.roundTripExtras!, 'Round Trip'],
    ] as const) {
      if (c[field] === undefined) continue;
      const extra = obj(c[field], `The ${cls} ${label} extra usage`);
      target[cls] = {
        extraKmRate: amount(extra.extraKmRate, `${cls} ${label} customer extra charge per kilometre`, true),
        waitingPerHour: amount(extra.waitingPerHour, `${cls} ${label} customer extra charge per waiting hour`, false),
      };
    }
  }
  return next;
}

// ── Section: Local Pickup & Drop ────────────────────────────────────────────

async function cityOf(id: unknown): Promise<{ id: string; name: string }> {
  if (typeof id !== 'string' || !id || id.includes('/')) throw bad('Choose a city.');
  const snap = await db.doc(`locations/${id}`).get();
  const l = snap.data();
  if (!snap.exists || !l || l.type !== 'City') throw bad('That is not a city in the location master.');
  if (l.status !== 'Active') throw bad('That city is not active in the location master.');
  return { id: snap.id, name: text(l.name, 80) || text(l.city, 80) || snap.id };
}

function applyLocal(base: TariffConfig, city: { id: string; name: string }, cls: TariffClass, f: Record<string, unknown>): TariffConfig {
  if (typeof f.enabled !== 'boolean') throw bad('Choose whether this fare is enabled.');
  const existing = base.localPickupDrop?.[city.id];
  const fare = {
    minKm: amount(f.minKm, 'Minimum billable kilometres', true),
    customerRate: amount(f.customerRate, 'Customer rate per kilometre', true),
    partnerRate: amount(f.partnerRate, 'Partner rate per kilometre', true),
    extraKmRate: amount(f.extraKmRate, 'Extra kilometre rate', true),
    waitingPerHour: amount(f.waitingPerHour, 'Waiting charge', false),
    enabled: f.enabled,
  };
  return { ...base, localPickupDrop: { ...(base.localPickupDrop ?? {}), [city.id]: { cityName: city.name, classes: { ...(existing?.classes ?? {}), [cls]: fare } } } };
}

// ── Section: extra charges (waiting, hill, roof carrier) ────────────────────

/** One rate of one side: null / missing = not configured (the value is removed); a number ≥ 0 is stored — 0 is an explicit "no charge". */
function optionalAmount(v: unknown, label: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  return amount(v, label, false);
}

function extraSide(v: unknown, who: 'Customer' | 'Partner', cat: string): ExtraChargeSide {
  const s = v === undefined || v === null ? {} : obj(v, `${cat} ${who.toLowerCase()} charges`);
  const out: ExtraChargeSide = {};
  const waiting = optionalAmount(s.waitingPerHour, `${cat}: ${who} waiting per hour`);
  const hill = optionalAmount(s.hill, `${cat}: ${who} hill charge per trip`);
  const carrier = optionalAmount(s.carrier, `${cat}: ${who} carrier charge per trip`);
  if (waiting !== undefined) out.waitingPerHour = waiting;
  if (hill !== undefined) out.hill = hill;
  if (carrier !== undefined) out.carrier = carrier;
  return out;
}

function wholeMinutes(v: unknown, label: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw bad(`${label} must be a whole number of minutes.`);
  if (v < min || v > max) throw bad(`${label} must be from ${min} to ${max} minutes.`);
  return v;
}

/** The categories a payload refers to, checked against the real vehicle_categories (before the transaction, like cityOf). */
async function extraCategoryNames(data: Record<string, unknown>): Promise<Map<string, string>> {
  const rows = obj(data.categories, 'The category charges');
  const ids = Object.keys(rows);
  if (ids.length > 50) throw bad('Too many categories in one save.');
  const names = new Map<string, string>();
  for (const id of ids) {
    if (!EXTRA_CATEGORY_ID.test(id)) throw bad('Choose a valid vehicle category.');
    const snap = await db.doc(`vehicle_categories/${id}`).get();
    if (!snap.exists) throw bad(`Vehicle category "${id}" does not exist.`);
    names.set(id, text(snap.data()?.name, 80) || id);
  }
  return names;
}

/**
 * Replaces the submitted categories' rows and the waiting rules; categories that are not in the payload — including inactive
 * or renamed ones — keep their saved rows untouched. The section's own version is bumped here, never taken from the client.
 */
function applyExtraCharges(base: TariffConfig, d: Record<string, unknown>, names: Map<string, string>): { next: TariffConfig; changed: string[] } {
  const freeWaitingMinutes = wholeMinutes(d.freeWaitingMinutes, 'Free waiting per stop', 0, MAX_FREE_WAITING_MINUTES);
  const waitingRoundingMinutes = wholeMinutes(d.waitingRoundingMinutes, 'The waiting rounding interval', 1, MAX_WAITING_ROUNDING_MINUTES);
  const rows = obj(d.categories, 'The category charges');
  const categories: Record<string, ExtraChargeRow> = { ...(base.extraCharges?.categories ?? {}) };
  const changed: string[] = [];
  for (const [id, raw] of Object.entries(rows)) {
    const name = names.get(id) ?? id;
    const r = obj(raw, `The ${name} charges`);
    const row: ExtraChargeRow = { customer: extraSide(r.customer, 'Customer', name), partner: extraSide(r.partner, 'Partner', name) };
    const empty = !Object.keys(row.customer).length && !Object.keys(row.partner).length;
    if (empty) { if (categories[id]) { delete categories[id]; changed.push(id); } continue; }
    if (JSON.stringify(categories[id] ?? null) !== JSON.stringify(row)) changed.push(id);
    categories[id] = row;
  }
  // Two business decisions are explicit settings, never assumed: how rounding is scoped and how the customer's extra charges are taxed.
  // "Not decided" (null) is allowed and keeps monetary posting of approved usage blocked.
  const scope = d.waitingRoundingScope ?? null, tax = d.taxTreatment ?? null;
  if (scope !== null && !(ROUNDING_SCOPES as readonly unknown[]).includes(scope)) throw bad('Choose how waiting is rounded: per stop or combined.');
  if (tax !== null && !(TAX_TREATMENTS as readonly unknown[]).includes(tax)) throw bad('Choose how extra charges are taxed.');
  const extraCharges: ExtraChargesConfig = {
    version: (base.extraCharges?.version ?? 0) + 1, freeWaitingMinutes, waitingRoundingMinutes, categories,
    ...(scope ? { waitingRoundingScope: scope as RoundingScope } : {}), ...(tax ? { taxTreatment: tax as TaxTreatment } : {}),
  };
  return { next: { ...base, extraCharges }, changed };
}

// ── Sections: rental minimum and packages ───────────────────────────────────

function applyRentalMinimum(base: TariffConfig, cls: TariffClass, hours: unknown): TariffConfig {
  if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 12) throw bad('The minimum rental must be a whole number of hours from 1 to 12.');
  const current = base.rentalPackages?.[cls];
  // Packages already saved are kept untouched; the ones below the new minimum simply stop being quotable.
  return { ...base, rentalPackages: { ...(base.rentalPackages ?? {}), [cls]: { packages: current?.packages ?? {}, minHours: hours } } };
}

function applyRentalPackage(base: TariffConfig, cls: TariffClass, hours: number, p: Record<string, unknown>): TariffConfig {
  const min = rentalMinHours(base, cls);
  if (hours < min) throw bad(`A ${hours}-hour package is shorter than this category's ${min}-hour minimum.`);
  if (typeof p.enabled !== 'boolean') throw bad('Choose whether this package is available.');
  if (p.gstMode !== 'included' && p.gstMode !== 'excluded') throw bad('Choose whether the fare includes GST or GST is added.');
  const pkg: RentalPackage | null = parseRentalPackage({
    customerFare: amount(p.customerFare, 'Customer fare', true), partnerPayout: amount(p.partnerPayout, 'Partner payout', true),
    includedKm: amount(p.includedKm, 'Covered kilometres', true), extraKmRate: amount(p.extraKmRate, 'Extra kilometre charge', true),
    extraHourRate: amount(p.extraHourRate, 'Extra hour charge', true), gstMode: p.gstMode, enabled: p.enabled,
  });
  if (!pkg) throw bad('The rental package is incomplete.');
  const current = base.rentalPackages?.[cls];
  return { ...base, rentalPackages: { ...(base.rentalPackages ?? {}), [cls]: { ...(current?.minHours ? { minHours: current.minHours } : {}), packages: { ...(current?.packages ?? {}), [String(hours)]: pkg } } } };
}

function applyBrandOverride(
  base: TariffConfig,
  brand: string,
  service: string,
  cls: TariffClass,
  data: Record<string, unknown>,
  clearOverride?: boolean
): { next: TariffConfig; meta: Record<string, unknown> } {
  if (brand !== 'common' && !SUPPORTED_BRANDS.includes(brand as BrandId)) {
    throw bad(`Unsupported brand: "${brand}".`);
  }
  const supportedServices = BRAND_SUPPORTED_SERVICES[brand === 'common' ? 'nesam' : brand as BrandId];
  if (!supportedServices.includes(service)) {
    throw bad(`Service "${service}" is not supported by brand "${brand}".`);
  }

  const existingOverrides = { ...(base.brandOverrides ?? {}) };
  const brandData = { ...(existingOverrides[brand] ?? {}) };
  const serviceData = { ...(brandData[service] ?? {}) };

  if (clearOverride) {
    delete serviceData[cls];
    if (Object.keys(serviceData).length === 0) {
      delete brandData[service];
    } else {
      brandData[service] = serviceData;
    }
    if (Object.keys(brandData).length === 0) {
      delete existingOverrides[brand];
    } else {
      existingOverrides[brand] = brandData;
    }
    return {
      next: { ...base, brandOverrides: existingOverrides },
      meta: { section: 'brandOverride', brand, service, class: cls, action: 'cleared' },
    };
  }

  const override: BrandFareOverride = { ...(serviceData[cls] ?? {}) };

  if (data.customerRate !== undefined && data.customerRate !== null) {
    override.customerRate = amount(data.customerRate, 'Customer rate', true);
  } else if (data.customerRate === null) {
    delete override.customerRate;
  }

  if (data.partnerRate !== undefined && data.partnerRate !== null) {
    override.partnerRate = amount(data.partnerRate, 'Partner rate', true);
  } else if (data.partnerRate === null) {
    delete override.partnerRate;
  }

  if (data.customerBase !== undefined && data.customerBase !== null) {
    override.customerBase = amount(data.customerBase, 'Customer base fare', true);
  } else if (data.customerBase === null) {
    delete override.customerBase;
  }

  if (data.partnerBase !== undefined && data.partnerBase !== null) {
    override.partnerBase = amount(data.partnerBase, 'Partner base payout', true);
  } else if (data.partnerBase === null) {
    delete override.partnerBase;
  }

  if (data.minKm !== undefined && data.minKm !== null) {
    override.minKm = amount(data.minKm, 'Minimum kilometres', true);
  } else if (data.minKm === null) {
    delete override.minKm;
  }

  if (data.minKmPerDay !== undefined && data.minKmPerDay !== null) {
    override.minKmPerDay = amount(data.minKmPerDay, 'Daily minimum kilometres', true);
  } else if (data.minKmPerDay === null) {
    delete override.minKmPerDay;
  }

  if (data.customerBata !== undefined && data.customerBata !== null) {
    override.customerBata = amount(data.customerBata, 'Customer allowance', false);
  } else if (data.customerBata === null) {
    delete override.customerBata;
  }

  if (data.partnerBata !== undefined && data.partnerBata !== null) {
    override.partnerBata = amount(data.partnerBata, 'Partner allowance', false);
  } else if (data.partnerBata === null) {
    delete override.partnerBata;
  }

  // CNG rate card (One Way and Round Trip): each field saved on its own; null removes it.
  for (const [key, label, positive] of [
    ['cngCustomerRate', 'CNG customer rate', true], ['cngPartnerRate', 'CNG partner rate', true],
    ['cngCustomerBata', 'CNG customer allowance', false], ['cngPartnerBata', 'CNG partner allowance', false],
    ['cngExtraKmRate', 'CNG extra kilometre rate', true], ['cngMinKmPerDay', 'CNG minimum kilometres per day', true],
  ] as const) {
    if (data[key] !== undefined && data[key] !== null) override[key] = amount(data[key], label, positive);
    else if (data[key] === null) delete override[key];
  }

  if (data.extraKmRate !== undefined && data.extraKmRate !== null) {
    override.extraKmRate = amount(data.extraKmRate, 'Extra kilometre rate', true);
  } else if (data.extraKmRate === null) {
    delete override.extraKmRate;
  }

  if (data.waitingPerHour !== undefined && data.waitingPerHour !== null) {
    override.waitingPerHour = amount(data.waitingPerHour, 'Waiting charge per hour', false);
  } else if (data.waitingPerHour === null) {
    delete override.waitingPerHour;
  }

  if (data.hillCharge !== undefined && data.hillCharge !== null) {
    override.hillCharge = amount(data.hillCharge, 'Hill charge', false);
  } else if (data.hillCharge === null) {
    delete override.hillCharge;
  }

  if (data.carrierCharge !== undefined && data.carrierCharge !== null) {
    override.carrierCharge = amount(data.carrierCharge, 'Luggage carrier charge', false);
  } else if (data.carrierCharge === null) {
    delete override.carrierCharge;
  }

  if (typeof data.enabled === 'boolean') {
    override.enabled = data.enabled;
  }

  for (const key of ['partnerWaitingPerHour','partnerHillCharge','partnerCarrierCharge'] as const) {
    if (data[key] === null) delete override[key];
    else if (data[key] !== undefined) override[key] = amount(data[key], key, false);
  }
  for (const key of ['freeWaitingMinutes','waitingRoundingMinutes'] as const) {
    if (data[key] === null) delete override[key];
    else if (data[key] !== undefined) {
      const value = data[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < (key === 'freeWaitingMinutes' ? 0 : 1) || value > 1440) throw bad('Enter valid waiting minutes.');
      override[key] = value;
    }
  }
  if (data.waitingRoundingScope === null) delete override.waitingRoundingScope;
  else if (data.waitingRoundingScope !== undefined) {
    if (data.waitingRoundingScope !== 'per_stop' && data.waitingRoundingScope !== 'combined') throw bad('Choose per-stop or combined waiting rounding.');
    override.waitingRoundingScope = data.waitingRoundingScope;
  }
  if (data.taxTreatment === null) delete override.taxTreatment;
  else if (data.taxTreatment !== undefined) {
    if (data.taxTreatment !== 'no_gst' && data.taxTreatment !== 'tariff_gst') throw bad('Choose an extra-charge tax treatment.');
    override.taxTreatment = data.taxTreatment;
  }

  if (data.minRentalHours === null) delete override.minRentalHours;
  else if (data.minRentalHours !== undefined) {
    if (typeof data.minRentalHours !== 'number' || !Number.isInteger(data.minRentalHours) || data.minRentalHours < 1 || data.minRentalHours > 12) throw bad('Minimum rental hours must be between 1 and 12.');
    override.minRentalHours = data.minRentalHours;
  }
  if (data.rentalPackages !== undefined) {
    if (service !== 'Local Rental') throw bad('Rental packages require Local Rental scope.');
    const packages = obj(data.rentalPackages, 'Rental package overrides');
    const nextPackages: NonNullable<BrandFareOverride['rentalPackages']> = {};
    for (const [key, value] of Object.entries(packages)) {
      hoursOf(Number(key));
      const raw = obj(value, 'Rental package');
      const row: NonNullable<BrandFareOverride['rentalPackages']>[string] = {};
      for (const field of ['customerFare', 'partnerPayout', 'includedKm', 'extraKmRate', 'extraHourRate'] as const) {
        if (raw[field] !== undefined && raw[field] !== null) row[field] = amount(raw[field], field, true);
      }
      if (Object.keys(row).length) nextPackages[key] = row;
    }
    if (Object.keys(nextPackages).length) override.rentalPackages = nextPackages;
    else delete override.rentalPackages;
  }

  if (!Object.keys(override).length) return applyBrandOverride(base, brand, service, cls, {}, true);
  serviceData[cls] = override;
  brandData[service] = serviceData;
  existingOverrides[brand] = brandData;

  return {
    next: { ...base, brandOverrides: existingOverrides },
    meta: { section: 'brandOverride', brand, service, class: cls, override },
  };
}

/**
 * Saves one section of the tariff. `expectedVersion` is required: the editor saves against the version it
 * loaded, and a newer tariff is refused rather than overwritten. A brand-new tariff starts switched off —
 * nothing here turns the confirmed tariff on.
 */
export const saveTariffSection = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const reason = text(input.reason, 300);
  if (reason.length < 5) throw bad('Give a short reason for the change.');
  if (typeof input.expectedVersion !== 'number' || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw bad('Reload the tariff before saving.');
  const section = input.section;
  const city = section === 'localPickupDrop' ? await cityOf(input.cityId) : null;
  const extraNames = section === 'extraCharges' ? await extraCategoryNames(obj(input.data, 'The extra charges')) : null;

  const ref = db.doc(TARIFF_DOC);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists ? parseTariffConfig(snap.data()) : null;
    if (input.expectedVersion !== (before?.version ?? 0)) {
      throw new HttpsError('failed-precondition', 'The tariff was changed by someone else. Reload and review it before saving.');
    }
    const base = before ?? parseTariffConfig({ enabled: false, version: 0 })!;
    let next: TariffConfig;
    let meta: Record<string, unknown>;
    if (section === 'baseRates') {
      const d = obj(input.data, 'The rates');
      next = applyBaseRates(base, d);
      meta = { section, classes: Object.keys(obj(d.classes, 'The category rates')) };
    } else if (section === 'fareGst') {
      const brand = text(input.brand, 50), service = text(input.service, 50);
      if (!['common', ...SUPPORTED_BRANDS].includes(brand) || !['One Way', 'Round Trip', 'Airport Taxi', 'Local Rental', 'Multicity'].includes(service)) throw bad('Choose a GST brand and service.');
      const d = obj(input.data, 'GST settings');
      const state = d.state === '' ? '' : gstState(d.state);
      if (d.state !== '' && !state) throw bad('Choose a valid pickup state for the GST override.');
      const fareGst = { ...base.fareGst };
      const services = { ...fareGst[brand] };
      const policy = { ...services[service], states: { ...services[service]?.states } };
      if (input.clearOverride === true) {
        if (state) delete policy.states[state]; else delete policy.default;
      } else {
        if (!validGstRule(d.rule)) throw bad('Choose the supplier state, included/excluded mode, classification, a GST rate from 0 to 40%, and an approval reference.');
        const raw = d.rule;
        const rule: FareGstRule = { supplierState: gstState(raw.supplierState), rate: Math.round(raw.rate * 10000) / 10000, mode: raw.mode, classification: raw.classification, reference: text(raw.reference, 300) };
        if (state) policy.states[state] = rule; else policy.default = rule;
      }
      if (!Object.keys(policy.states).length) delete (policy as { states?: unknown }).states;
      if (!policy.default && !policy.states) delete services[service]; else services[service] = policy;
      if (!Object.keys(services).length) delete fareGst[brand]; else fareGst[brand] = services;
      next = { ...base, fareGst };
      meta = { section, brand, service, state: state || 'all', clear: input.clearOverride === true };
    } else if (section === 'brandOverride') {
      const cls = classOf(input.class);
      const brand = text(input.brand, 50);
      const service = text(input.service, 50);
      const r = applyBrandOverride(base, brand, service, cls, obj(input.data, 'The override data'), input.clearOverride === true);
      next = r.next;
      meta = r.meta;
    } else if (section === 'localPickupDrop' && city) {
      const cls = classOf(input.class);
      next = applyLocal(base, city, cls, obj(input.data, 'The fare'));
      meta = { section, cityId: city.id, cityName: city.name, class: cls };
    } else if (section === 'extraCharges' && extraNames) {
      const r = applyExtraCharges(base, obj(input.data, 'The extra charges'), extraNames);
      next = r.next;
      meta = { section, extraChargesVersion: next.extraCharges?.version ?? 0, was: base.extraCharges?.version ?? 0, categories: r.changed };
    } else if (section === 'displayMarkup') {
      // Display only: the % shown as a higher struck-out price above a fare. No fare, tax or payout is changed by it.
      const brand = text(input.brand, 50), service = text(input.service, 50);
      if (!['common', ...SUPPORTED_BRANDS].includes(brand) || !['One Way', 'Round Trip', 'Airport Taxi', 'Local Rental', 'Multicity'].includes(service)) throw bad('Choose a brand and service.');
      const d = obj(input.data, 'The setting');
      const pct = d.percent;
      const all = { ...(base.displayMarkup ?? {}) };
      const row = { ...(all[brand] ?? {}) };
      if (pct === null || pct === 0) delete row[service];
      else {
        if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > 300) throw bad('The percentage must be more than 0 and at most 300.');
        row[service] = Math.round(pct * 100) / 100;
      }
      if (Object.keys(row).length) all[brand] = row; else delete all[brand];
      next = { ...base };
      if (Object.keys(all).length) next.displayMarkup = all; else delete next.displayMarkup;
      meta = { section, brand, service, percent: pct };
    } else if (section === 'rentalMinimum') {
      const cls = classOf(input.class);
      next = applyRentalMinimum(base, cls, input.minHours);
      meta = { section, class: cls, minHours: input.minHours, was: rentalMinHours(base, cls) };
    } else if (section === 'rentalPackage') {
      const cls = classOf(input.class), hours = hoursOf(input.hours);
      next = applyRentalPackage(base, cls, hours, obj(input.data, 'The package'));
      meta = { section, class: cls, hours };
    } else {
      throw bad('Unknown tariff section.');
    }
    const version = (before?.version ?? 0) + 1;
    tx.set(ref, { ...next, enabled: base.enabled, version, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, {
      action: 'tariff_section_saved', entity: 'tariff', entityId: 'v2', performedBy: actor.uid, performedByName: actor.name, role: 'admin',
      previous: before ? { version: before.version } : null, next: { version }, meta, reason,
    });
    return { version, ...(section === 'extraCharges' ? { extraChargesVersion: next.extraCharges?.version ?? 0 } : {}) };
  });
});

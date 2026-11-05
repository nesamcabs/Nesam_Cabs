// Extra charges: waiting, hill travel and roof carrier, per vehicle category (business_config/tariff_v2 → extraCharges).
//
// One authoritative record inside the tariff document, so it shares the tariff's version check, audit trail and
// "a saved tariff only changes NEW quotes" rule. Customer and Partner amounts are separate. Money is stored in rupees at
// paise precision (like every other tariff field) and snapshotted in paise. An ABSENT amount is "not configured"; a
// stored 0 is an explicit "no charge" — the two are never mixed up.
//
// A quote copies the category's rates into its pricing snapshot, so editing the configuration never reprices an existing
// booking. The CUSTOMER side lives in the booking's own (customer-readable) pricing snapshot; the PARTNER side is payout
// data and is kept only in booking_pricing_private (see domain/pricingPrivacy.ts).
//
// Usage is recorded per stop and approved by the office; `computeExtraCharges` is the one calculation of what the saved
// rates charge for it, and it refuses (returns `blocked` reasons) whenever a rule the business has not decided is missing.

/** One side's rates, in rupees. Absent = not configured. */
export interface ExtraChargeSide {
  /** Per hour of chargeable waiting. */
  waitingPerHour?: number;
  /** Per trip, when hill travel applies. */
  hill?: number;
  /** Per trip, when a roof carrier is used. */
  carrier?: number;
}
export interface ExtraChargeRow { customer: ExtraChargeSide; partner: ExtraChargeSide }

/**
 * Whether the rounding interval applies to each stop's chargeable waiting or to the stops' combined chargeable waiting.
 * The business has not fixed this, so it is an explicit setting; until it is chosen no waiting amount can be billed.
 */
export type RoundingScope = 'per_stop' | 'combined';
/**
 * How the customer's extra charges are taxed. Also an explicit business decision, never assumed:
 *   no_gst      billed as a separate line outside the fare, no GST added;
 *   tariff_gst  the GST rate saved on the booking's own pricing snapshot is added to the extra charges.
 */
export type TaxTreatment = 'no_gst' | 'tariff_gst';

export interface ExtraChargesConfig {
  /** Counts saves of this section only (the tariff version counts every tariff save). */
  version: number;
  /** Waiting that is free at each stop, minutes. Absent = not configured; 0 = nothing is free. */
  freeWaitingMinutes?: number;
  /** Chargeable waiting is rounded UP to a multiple of this many minutes. Absent = not configured. */
  waitingRoundingMinutes?: number;
  waitingRoundingScope?: RoundingScope;
  taxTreatment?: TaxTreatment;
  /** Keyed by the real vehicle category id. */
  categories: Record<string, ExtraChargeRow>;
}

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isWholeMinutes = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
export const EXTRA_CATEGORY_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const MAX_FREE_WAITING_MINUTES = 1440;
export const MAX_WAITING_ROUNDING_MINUTES = 1440;
export const ROUNDING_SCOPES: readonly RoundingScope[] = ['per_stop', 'combined'];
export const TAX_TREATMENTS: readonly TaxTreatment[] = ['no_gst', 'tariff_gst'];

function parseSide(v: unknown): ExtraChargeSide {
  const s = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out: ExtraChargeSide = {};
  if (isAmount(s.waitingPerHour)) out.waitingPerHour = s.waitingPerHour;
  if (isAmount(s.hill)) out.hill = s.hill;
  if (isAmount(s.carrier)) out.carrier = s.carrier;
  return out;
}
const hasAny = (s: ExtraChargeSide) => s.waitingPerHour !== undefined || s.hill !== undefined || s.carrier !== undefined;

/** Parses the stored section. Anything malformed is dropped (treated as not configured). */
export function parseExtraCharges(d: unknown): ExtraChargesConfig | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const raw = d as Record<string, unknown>;
  const categories: Record<string, ExtraChargeRow> = {};
  if (raw.categories && typeof raw.categories === 'object') {
    for (const [id, row] of Object.entries(raw.categories as Record<string, unknown>)) {
      if (!EXTRA_CATEGORY_ID.test(id) || !row || typeof row !== 'object') continue;
      const customer = parseSide((row as Record<string, unknown>).customer);
      const partner = parseSide((row as Record<string, unknown>).partner);
      if (hasAny(customer) || hasAny(partner)) categories[id] = { customer, partner };
    }
  }
  const out: ExtraChargesConfig = { version: typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version >= 0 ? raw.version : 0, categories };
  if (isWholeMinutes(raw.freeWaitingMinutes, 0, MAX_FREE_WAITING_MINUTES)) out.freeWaitingMinutes = raw.freeWaitingMinutes;
  if (isWholeMinutes(raw.waitingRoundingMinutes, 1, MAX_WAITING_ROUNDING_MINUTES)) out.waitingRoundingMinutes = raw.waitingRoundingMinutes;
  if ((ROUNDING_SCOPES as readonly unknown[]).includes(raw.waitingRoundingScope)) out.waitingRoundingScope = raw.waitingRoundingScope as RoundingScope;
  if ((TAX_TREATMENTS as readonly unknown[]).includes(raw.taxTreatment)) out.taxTreatment = raw.taxTreatment as TaxTreatment;
  return out;
}

const paiseOf = (rupees: number) => Math.round(rupees * 100);
export interface ExtraChargeSidePaise { waitingPerHourPaise?: number; hillPaise?: number; carrierPaise?: number }
const sidePaise = (s: ExtraChargeSide): ExtraChargeSidePaise => ({
  ...(s.waitingPerHour !== undefined ? { waitingPerHourPaise: paiseOf(s.waitingPerHour) } : {}),
  ...(s.hill !== undefined ? { hillPaise: paiseOf(s.hill) } : {}),
  ...(s.carrier !== undefined ? { carrierPaise: paiseOf(s.carrier) } : {}),
});

/**
 * What a quote stores about the extra charges of ITS category, so the booking keeps them whatever is saved later.
 * `partner` is payout data: it exists on the in-memory snapshot while a booking is being priced, then is split off into
 * booking_pricing_private — the copy stored on the (customer-readable) booking never has it.
 */
export interface ExtraChargesSnapshot {
  schema: 1;
  /** extraCharges.version and tariff version in force when quoted. */
  version: number;
  tariffVersion: number;
  categoryId: string;
  freeWaitingMinutes: number | null;
  waitingRoundingMinutes: number | null;
  roundingScope: RoundingScope | null;
  taxTreatment: TaxTreatment | null;
  customer: ExtraChargeSidePaise;
  partner?: ExtraChargeSidePaise;
}

/** The snapshot for one category, or undefined when nothing is configured for it (nothing is invented). */
export function extraChargesSnapshot(cfg: ExtraChargesConfig | undefined, tariffVersion: number, categoryId: string): ExtraChargesSnapshot | undefined {
  const row = cfg?.categories[categoryId];
  if (!cfg || !row) return undefined;
  return {
    schema: 1, version: cfg.version, tariffVersion, categoryId,
    freeWaitingMinutes: cfg.freeWaitingMinutes ?? null, waitingRoundingMinutes: cfg.waitingRoundingMinutes ?? null,
    roundingScope: cfg.waitingRoundingScope ?? null, taxTreatment: cfg.taxTreatment ?? null,
    customer: sidePaise(row.customer), partner: sidePaise(row.partner),
  };
}

// ── Usage: recorded per stop ────────────────────────────────────────────────

export interface StopUsage { stopId: string; waitedMinutes: number }
/**
 * What happened on the trip. `null` means NOT RECORDED — it is never read as zero: `stops: []` / `hill: false` /
 * `carrier: false` are explicit "none". Legacy records that only hold a total waiting time have no `stops` and must be
 * reviewed by hand: individual stop durations are never inferred from a total and a stop count.
 */
export interface ExtraUsage { stops: StopUsage[] | null; hill: boolean | null; carrier: boolean | null }

export class ExtraUsageError extends Error {}
export const STOP_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_STOPS = 20;

/** Validates untrusted usage input. Throws ExtraUsageError with a message that is safe to show. */
export function parseExtraUsage(v: unknown): ExtraUsage {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ExtraUsageError('Usage is missing.');
  const raw = v as Record<string, unknown>;
  let stops: StopUsage[] | null = null;
  if (raw.stops !== undefined && raw.stops !== null) {
    if (!Array.isArray(raw.stops)) throw new ExtraUsageError('Waiting must be a list of stops.');
    if (raw.stops.length > MAX_STOPS) throw new ExtraUsageError(`At most ${MAX_STOPS} stops can be recorded.`);
    const seen = new Set<string>();
    stops = raw.stops.map((s, i) => {
      if (!s || typeof s !== 'object') throw new ExtraUsageError(`Stop ${i + 1} is invalid.`);
      const { stopId, waitedMinutes } = s as Record<string, unknown>;
      if (typeof stopId !== 'string' || !STOP_ID.test(stopId)) throw new ExtraUsageError(`Stop ${i + 1} needs an identifier (letters, digits, - or _).`);
      if (seen.has(stopId)) throw new ExtraUsageError(`Stop "${stopId}" is listed twice.`);
      seen.add(stopId);
      if (typeof waitedMinutes !== 'number' || !Number.isInteger(waitedMinutes) || waitedMinutes < 0 || waitedMinutes > 1440) {
        throw new ExtraUsageError(`Waiting at stop "${stopId}" must be whole minutes from 0 to 1440. Enter 0 if there was none.`);
      }
      return { stopId, waitedMinutes };
    });
  }
  const flag = (x: unknown, label: string): boolean | null => {
    if (x === undefined || x === null) return null;
    if (typeof x !== 'boolean') throw new ExtraUsageError(`${label} must be yes or no.`);
    return x;
  };
  const usage: ExtraUsage = { stops, hill: flag(raw.hill, 'Hill travel'), carrier: flag(raw.carrier, 'Roof carrier') };
  if (usage.stops === null && usage.hill === null && usage.carrier === null) throw new ExtraUsageError('Record waiting, hill travel or roof carrier.');
  return usage;
}

// ── Calculation ─────────────────────────────────────────────────────────────

export interface WaitingResult {
  perStop: { stopId: string; waitedMinutes: number; chargeableMinutes: number }[];
  /** Σ max(0, waited − free) over the stops, before rounding. */
  chargeableMinutes: number;
  /** After the configured rounding; null while the rounding rule is not fully configured. */
  billedMinutes: number | null;
}

/**
 * Free waiting applies to EACH stop on its own, the remainders are added, and the rounding interval is then applied
 * according to the configured scope. Returns null when free waiting was never configured.
 */
export function waitingMinutes(
  s: Pick<ExtraChargesSnapshot, 'freeWaitingMinutes' | 'waitingRoundingMinutes' | 'roundingScope'>, stops: StopUsage[],
): WaitingResult | null {
  if (s.freeWaitingMinutes === null) return null;
  const free = s.freeWaitingMinutes;
  const perStop = stops.map((x) => ({ stopId: x.stopId, waitedMinutes: x.waitedMinutes, chargeableMinutes: Math.max(0, x.waitedMinutes - free) }));
  const chargeableMinutes = perStop.reduce((sum, x) => sum + x.chargeableMinutes, 0);
  const step = s.waitingRoundingMinutes;
  let billedMinutes: number | null = null;
  if (step !== null && s.roundingScope !== null) {
    const up = (m: number) => Math.ceil(m / step) * step;
    billedMinutes = s.roundingScope === 'per_stop' ? perStop.reduce((sum, x) => sum + up(x.chargeableMinutes), 0) : up(chargeableMinutes);
  }
  return { perStop, chargeableMinutes, billedMinutes };
}

export interface SideAmounts { waitingPaise: number; hillPaise: number; carrierPaise: number; subtotalPaise: number }
export interface ExtraComputation {
  /** Reasons the amounts cannot be posted to billing and settlement. Empty = every needed rule and rate exists. */
  blocked: string[];
  waiting: WaitingResult | null;
  customer: SideAmounts | null;
  customerGstPaise: number | null;
  customerTotalPaise: number | null;
  partner: SideAmounts | null;
}

/** GST on a taxable amount in paise, half-up — the same integer arithmetic as gstOn in the tariff module. */
const gstPaiseOn = (taxablePaise: number, rate: number) => Math.floor((taxablePaise * Math.round(rate * 10000) + 5000) / 10000);
const perHour = (minutes: number, ratePaise: number) => Math.round((minutes * ratePaise) / 60);

/**
 * What the booking's saved rates charge for the usage: Customer and Partner separately, in paise.
 *   `snapshot`  the booking's customer-side snapshot; `partner` its private partner side (undefined = not available);
 *   `gstRate`   the GST rate saved on the booking's own pricing snapshot;
 *   `legacyCustomerWaitingPerHourPaise` the class-level waiting rate the booking was quoted with: used for the CUSTOMER
 *   waiting rate only when this category has no waiting rate of its own (the category rate always wins).
 * A component that was not used costs 0 whatever its rate; a used component with no rate, or any missing business
 * rule, is reported in `blocked` instead of being guessed.
 */
export function computeExtraCharges(
  snapshot: ExtraChargesSnapshot, partner: ExtraChargeSidePaise | undefined, usage: ExtraUsage, gstRate: number, legacyCustomerWaitingPerHourPaise?: number,
): ExtraComputation {
  const blocked: string[] = [];
  const need = (cond: boolean, reason: string) => { if (!cond && !blocked.includes(reason)) blocked.push(reason); };
  need(usage.stops !== null, 'Waiting usage has not been recorded (record the stops, or none).');
  need(usage.hill !== null, 'Hill travel has not been recorded (yes or no).');
  need(usage.carrier !== null, 'Roof carrier use has not been recorded (yes or no).');

  const waiting = usage.stops === null ? null : waitingMinutes(snapshot, usage.stops);
  if (usage.stops !== null) {
    need(snapshot.freeWaitingMinutes !== null, 'Free waiting per stop is not configured.');
    if (waiting && waiting.chargeableMinutes > 0) {
      need(snapshot.waitingRoundingMinutes !== null, 'The waiting rounding interval is not configured.');
      need(snapshot.roundingScope !== null, 'The waiting rounding scope (per stop or combined) has not been decided.');
    }
  }
  need(snapshot.taxTreatment !== null, 'The tax treatment of extra charges has not been decided.');

  const side = (who: 'customer' | 'partner', rates: ExtraChargeSidePaise | undefined): SideAmounts | null => {
    if (!rates) { need(who === 'customer', 'The partner rates for this booking are not available.'); return null; }
    let waitingPaise = 0;
    const waitRate = who === 'customer' ? rates.waitingPerHourPaise ?? legacyCustomerWaitingPerHourPaise : rates.waitingPerHourPaise;
    if (waiting && waiting.chargeableMinutes > 0) {
      need(waitRate !== undefined, `The ${who} waiting rate is not configured for this booking.`);
      if (waitRate !== undefined && waiting.billedMinutes !== null) waitingPaise = perHour(waiting.billedMinutes, waitRate);
    }
    const perTrip = (used: boolean | null, rate: number | undefined, label: string) => {
      if (!used) return 0;
      need(rate !== undefined, `The ${who} ${label} rate is not configured for this booking.`);
      return rate ?? 0;
    };
    const hillPaise = perTrip(usage.hill, rates.hillPaise, 'hill charge');
    const carrierPaise = perTrip(usage.carrier, rates.carrierPaise, 'roof carrier charge');
    return { waitingPaise, hillPaise, carrierPaise, subtotalPaise: waitingPaise + hillPaise + carrierPaise };
  };
  const customer = side('customer', snapshot.customer);
  const partnerAmounts = side('partner', partner);
  const customerGstPaise = customer && snapshot.taxTreatment ? (snapshot.taxTreatment === 'tariff_gst' ? gstPaiseOn(customer.subtotalPaise, gstRate) : 0) : null;
  return {
    blocked, waiting, customer, customerGstPaise,
    customerTotalPaise: customer && customerGstPaise !== null ? customer.subtotalPaise + customerGstPaise : null,
    partner: partnerAmounts,
  };
}

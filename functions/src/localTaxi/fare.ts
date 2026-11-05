// Local Taxi fare engine. Pure functions only: no database, no clock, no network. The server calls these to price a
// quote and to settle a completed ride; the admin simulator calls the very same code.
//
// All money is INTEGER PAISE (1 INR = 100 paise). Rates are paise per kilometre / per minute, multipliers and
// percentages are basis points (10000 = 100 %). Distance is metres and time is seconds, so nothing is ever a float
// until the single rounding step of each line (Math.round, half away from zero for positive amounts).
//
// ── Calculation order (documented policy) ──────────────────────────────────────────────────────────────────────────
//   distanceFare   = round( max(0, distanceMeters - includedMeters) × perKmPaise / 1000 )
//   billableSecs   = max(0, rideSeconds - waitingSeconds)            // waiting is billed on its own, never twice
//   timeFare       = round( billableSecs × perMinutePaise / 60 )
//   meteredFare    = max(minimumFare, baseFare + distanceFare + timeFare)     // the base fare covers includedMeters
//   nightSurcharge = round( meteredFare × night.bps / 10000 )          // only if the ride START is in the night window
//   adjustedFare   = (meteredFare + nightSurcharge) × surge.multiplierBps / 10000   // surge only inside its dates
//   waitingCharge  = round( max(0, waitingSeconds - freeWaitingSeconds) × waitingPerMinutePaise / 60 )
//   pickupCharge   = flat, if the zone charges one
//   taxableBase    = adjustedFare + pickupCharge + waitingCharge          // the platform fee is NOT taxed
//   tax            = round( taxableBase × tax.bps / 10000 )               // 0 unless tax is enabled
//   total          = roundPolicy( taxableBase + platformFee + tax )
//
// Night and surge touch only the metered fare, never pickup, waiting, platform fee or tax.
// Driver earnings (platform commission) are kept apart from what the customer pays:
//   commissionBase = adjustedFare + pickupCharge + waitingCharge        // never the platform fee, tax or rounding
//   commission     = round( commissionBase × commissionBps / 10000 )
//   driverEarnings = commissionBase - commission

export type RoundingPolicy = 'none' | 'nearest_rupee' | 'nearest_five' | 'ceil_rupee';
export const ROUNDING_POLICIES: readonly RoundingPolicy[] = ['none', 'nearest_rupee', 'nearest_five', 'ceil_rupee'];

export interface FareConfig {
  currency: 'INR';
  baseFarePaise: number;
  includedMeters: number;
  perKmPaise: number;
  perMinutePaise: number;
  minimumFarePaise: number;
  freeWaitingSeconds: number;
  waitingPerMinutePaise: number;
  pickupChargePaise: number;
  night: { enabled: boolean; startMinute: number; endMinute: number; bps: number };
  surge: { enabled: boolean; multiplierBps: number; maxBps: number; effectiveFromMs: number | null; effectiveToMs: number | null };
  cancellation: { feePaise: number; graceSeconds: number };
  tax: { enabled: boolean; bps: number };
  platformFeePaise: number;
  rounding: RoundingPolicy;
  /** Platform commission taken from the driver's share (basis points). */
  commissionBps: number;
  /** A completed ride may not bill more than this share of the quoted distance (basis points). */
  maxDistanceOverQuoteBps: number;
}

export interface FareMetrics {
  distanceMeters: number;
  /** Total time the trip ran, waiting included. */
  rideSeconds: number;
  waitingSeconds: number;
  /** Charge the pickup fee (true for a normal ride, false for e.g. a re-priced trip that already paid it). */
  includePickup?: boolean;
}

export interface FareLine { code: string; label: string; amountPaise: number }
export interface FareBreakdown {
  currency: 'INR';
  lines: FareLine[];
  meteredFarePaise: number;
  nightSurchargePaise: number;
  surgePaise: number;
  adjustedFarePaise: number;
  waitingChargePaise: number;
  pickupChargePaise: number;
  platformFeePaise: number;
  taxPaise: number;
  roundingPaise: number;
  totalPaise: number;
  commissionPaise: number;
  driverEarningsPaise: number;
  nightApplied: boolean;
  surgeApplied: boolean;
  minimumApplied: boolean;
  inputs: { distanceMeters: number; rideSeconds: number; waitingSeconds: number; billableSeconds: number; atMs: number; timeZone: string };
}

export class FareConfigError extends Error {
  constructor(public problems: string[]) { super(problems.join(' ')); }
}

const MAX_PAISE = 10_000_000; // ₹1,00,000 per component: a typing slip is rejected, not saved
const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);

/** Validates an untrusted fare configuration; throws FareConfigError listing every problem, or returns a clean copy. */
export function validateFareConfig(input: unknown): FareConfig {
  const problems: string[] = [];
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const money = (key: string, label: string, opts: { min?: number; max?: number } = {}): number => {
    const v = o[key];
    if (!int(v) || v < (opts.min ?? 0) || v > (opts.max ?? MAX_PAISE)) { problems.push(`${label} must be a whole number of paise between ${opts.min ?? 0} and ${opts.max ?? MAX_PAISE}.`); return 0; }
    return v;
  };
  const bps = (v: unknown, label: string, min = 0, max = 10000): number => {
    if (!int(v) || (v as number) < min || (v as number) > max) { problems.push(`${label} must be a whole number of basis points between ${min} and ${max}.`); return min; }
    return v as number;
  };
  if (o.currency !== 'INR') problems.push('Currency must be INR.');
  const baseFarePaise = money('baseFarePaise', 'Base fare');
  const includedMeters = money('includedMeters', 'Included distance', { max: 100_000 });
  const perKmPaise = money('perKmPaise', 'Rate per kilometre');
  const perMinutePaise = money('perMinutePaise', 'Rate per minute');
  const minimumFarePaise = money('minimumFarePaise', 'Minimum fare');
  const freeWaitingSeconds = money('freeWaitingSeconds', 'Free waiting time', { max: 3600 });
  const waitingPerMinutePaise = money('waitingPerMinutePaise', 'Waiting charge per minute');
  const pickupChargePaise = money('pickupChargePaise', 'Pickup charge');
  const platformFeePaise = money('platformFeePaise', 'Platform fee');
  if (minimumFarePaise < baseFarePaise) problems.push('The minimum fare cannot be below the base fare.');
  if (perKmPaise === 0 && perMinutePaise === 0 && baseFarePaise === 0 && minimumFarePaise === 0) problems.push('Set at least a base fare, a minimum fare or a rate.');

  const n = (o.night ?? {}) as Record<string, any>;
  const night = {
    enabled: n.enabled === true,
    startMinute: int(n.startMinute) && n.startMinute >= 0 && n.startMinute <= 1439 ? n.startMinute : 0,
    endMinute: int(n.endMinute) && n.endMinute >= 0 && n.endMinute <= 1439 ? n.endMinute : 0,
    bps: 0,
  };
  if (n.enabled === true) {
    if (!(int(n.startMinute) && n.startMinute >= 0 && n.startMinute <= 1439)) problems.push('Night surcharge start must be a minute of the day (0–1439).');
    if (!(int(n.endMinute) && n.endMinute >= 0 && n.endMinute <= 1439)) problems.push('Night surcharge end must be a minute of the day (0–1439).');
    if (night.startMinute === night.endMinute) problems.push('Night surcharge start and end cannot be the same time.');
    night.bps = bps(n.bps, 'Night surcharge', 1, 10000);
  } else night.bps = int(n.bps) && n.bps >= 0 && n.bps <= 10000 ? n.bps : 0;

  const s = (o.surge ?? {}) as Record<string, any>;
  const surge = { enabled: s.enabled === true, multiplierBps: 10000, maxBps: int(s.maxBps) ? s.maxBps : 15000, effectiveFromMs: null as number | null, effectiveToMs: null as number | null };
  if (!int(s.maxBps) || s.maxBps < 10000 || s.maxBps > 30000) { if (s.enabled === true || s.maxBps !== undefined) problems.push('Surge limit must be between 10000 (1.0×) and 30000 (3.0×) basis points.'); surge.maxBps = 15000; }
  if (s.enabled === true) {
    surge.multiplierBps = bps(s.multiplierBps, 'Surge multiplier', 10000, 30000);
    if (surge.multiplierBps > surge.maxBps) problems.push('The surge multiplier is above the surge limit.');
  } else surge.multiplierBps = 10000;
  for (const [key, label] of [['effectiveFromMs', 'Surge start'], ['effectiveToMs', 'Surge end']] as const) {
    if (s[key] === null || s[key] === undefined) continue;
    if (!int(s[key]) || s[key] < 0) problems.push(`${label} must be a valid date.`);
    else surge[key] = s[key];
  }
  if (surge.effectiveFromMs !== null && surge.effectiveToMs !== null && surge.effectiveToMs <= surge.effectiveFromMs) problems.push('Surge end must be after its start.');
  if (surge.enabled && surge.effectiveToMs === null) problems.push('Surge needs an end date, so it cannot stay on by accident.');

  const c = (o.cancellation ?? {}) as Record<string, any>;
  const cancellation = { feePaise: int(c.feePaise) && c.feePaise >= 0 && c.feePaise <= MAX_PAISE ? c.feePaise : 0, graceSeconds: int(c.graceSeconds) && c.graceSeconds >= 0 && c.graceSeconds <= 3600 ? c.graceSeconds : 0 };
  if (c.feePaise !== undefined && !(int(c.feePaise) && c.feePaise >= 0 && c.feePaise <= MAX_PAISE)) problems.push('Cancellation fee must be a whole number of paise.');
  if (c.graceSeconds !== undefined && !(int(c.graceSeconds) && c.graceSeconds >= 0 && c.graceSeconds <= 3600)) problems.push('Cancellation grace period must be between 0 and 3600 seconds.');

  const t = (o.tax ?? {}) as Record<string, any>;
  const tax = { enabled: t.enabled === true, bps: 0 };
  if (t.enabled === true) tax.bps = bps(t.bps, 'Tax rate', 1, 5000);
  else tax.bps = int(t.bps) && t.bps >= 0 && t.bps <= 5000 ? t.bps : 0;

  const rounding = ROUNDING_POLICIES.includes(o.rounding) ? (o.rounding as RoundingPolicy) : 'none';
  if (o.rounding !== undefined && !ROUNDING_POLICIES.includes(o.rounding)) problems.push('Rounding policy is not recognised.');
  const commissionBps = bps(o.commissionBps ?? 0, 'Platform commission', 0, 5000);
  const maxDistanceOverQuoteBps = bps(o.maxDistanceOverQuoteBps ?? 15000, 'Distance cap over the quote', 10000, 50000);

  if (problems.length) throw new FareConfigError(problems);
  return {
    currency: 'INR', baseFarePaise, includedMeters, perKmPaise, perMinutePaise, minimumFarePaise, freeWaitingSeconds, waitingPerMinutePaise,
    pickupChargePaise, night, surge, cancellation, tax, platformFeePaise, rounding, commissionBps, maxDistanceOverQuoteBps,
  };
}

/** Minutes since local midnight for an instant in an IANA time zone. */
export function localMinuteOfDay(atMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(atMs));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

/** Window [start, end) in minutes of the day; a window whose start is later than its end crosses midnight. */
export function inNightWindow(minute: number, startMinute: number, endMinute: number): boolean {
  if (startMinute === endMinute) return false;
  return startMinute < endMinute ? minute >= startMinute && minute < endMinute : minute >= startMinute || minute < endMinute;
}

export const surgeActive = (cfg: FareConfig, atMs: number): boolean =>
  cfg.surge.enabled && (cfg.surge.effectiveFromMs === null || atMs >= cfg.surge.effectiveFromMs) && (cfg.surge.effectiveToMs === null || atMs < cfg.surge.effectiveToMs);

export function applyRounding(totalPaise: number, policy: RoundingPolicy): number {
  switch (policy) {
    case 'nearest_rupee': return Math.round(totalPaise / 100) * 100;
    case 'nearest_five': return Math.round(totalPaise / 500) * 500;
    case 'ceil_rupee': return Math.ceil(totalPaise / 100) * 100;
    default: return totalPaise;
  }
}

const bpsOf = (amount: number, basisPoints: number) => Math.round((amount * basisPoints) / 10000);

/** The authoritative fare for the given metrics. `atMs` is the instant the ride starts (or is quoted for). */
export function calculateFare(cfg: FareConfig, m: FareMetrics, atMs: number, timeZone: string): FareBreakdown {
  const distanceMeters = Math.max(0, Math.round(m.distanceMeters));
  const waitingSeconds = Math.max(0, Math.round(m.waitingSeconds));
  const rideSeconds = Math.max(0, Math.round(m.rideSeconds));
  const billableSeconds = Math.max(0, rideSeconds - waitingSeconds);

  const distanceFare = Math.round((Math.max(0, distanceMeters - cfg.includedMeters) * cfg.perKmPaise) / 1000);
  const timeFare = Math.round((billableSeconds * cfg.perMinutePaise) / 60);
  const raw = cfg.baseFarePaise + distanceFare + timeFare;
  const meteredFarePaise = Math.max(cfg.minimumFarePaise, raw);
  const minimumApplied = cfg.minimumFarePaise > raw;

  const nightApplied = cfg.night.enabled && inNightWindow(localMinuteOfDay(atMs, timeZone), cfg.night.startMinute, cfg.night.endMinute);
  const nightSurchargePaise = nightApplied ? bpsOf(meteredFarePaise, cfg.night.bps) : 0;
  const preSurge = meteredFarePaise + nightSurchargePaise;
  const surgeApplied = surgeActive(cfg, atMs) && cfg.surge.multiplierBps > 10000;
  const multiplier = surgeApplied ? Math.min(cfg.surge.multiplierBps, cfg.surge.maxBps) : 10000;
  const adjustedFarePaise = bpsOf(preSurge, multiplier);
  const surgePaise = adjustedFarePaise - preSurge;

  const waitingChargePaise = Math.round((Math.max(0, waitingSeconds - cfg.freeWaitingSeconds) * cfg.waitingPerMinutePaise) / 60);
  const pickupChargePaise = m.includePickup === false ? 0 : cfg.pickupChargePaise;
  const platformFeePaise = cfg.platformFeePaise;
  const taxableBase = adjustedFarePaise + pickupChargePaise + waitingChargePaise;
  const taxPaise = cfg.tax.enabled ? bpsOf(taxableBase, cfg.tax.bps) : 0;
  const beforeRounding = taxableBase + platformFeePaise + taxPaise;
  const totalPaise = applyRounding(beforeRounding, cfg.rounding);
  const roundingPaise = totalPaise - beforeRounding;

  const commissionPaise = bpsOf(taxableBase, cfg.commissionBps);
  const driverEarningsPaise = taxableBase - commissionPaise;

  const lines: FareLine[] = [
    { code: 'base', label: 'Base fare', amountPaise: cfg.baseFarePaise },
    ...(distanceFare ? [{ code: 'distance', label: `Distance beyond ${(cfg.includedMeters / 1000).toFixed(1)} km`, amountPaise: distanceFare }] : []),
    ...(timeFare ? [{ code: 'time', label: 'Ride time', amountPaise: timeFare }] : []),
    ...(minimumApplied ? [{ code: 'minimum', label: 'Minimum fare adjustment', amountPaise: meteredFarePaise - raw }] : []),
    ...(nightSurchargePaise ? [{ code: 'night', label: 'Night surcharge', amountPaise: nightSurchargePaise }] : []),
    ...(surgePaise ? [{ code: 'surge', label: 'High demand', amountPaise: surgePaise }] : []),
    ...(pickupChargePaise ? [{ code: 'pickup', label: 'Pickup charge', amountPaise: pickupChargePaise }] : []),
    ...(waitingChargePaise ? [{ code: 'waiting', label: 'Waiting charge', amountPaise: waitingChargePaise }] : []),
    ...(platformFeePaise ? [{ code: 'platform', label: 'Platform fee', amountPaise: platformFeePaise }] : []),
    ...(taxPaise ? [{ code: 'tax', label: 'Taxes', amountPaise: taxPaise }] : []),
    ...(roundingPaise ? [{ code: 'rounding', label: 'Rounding', amountPaise: roundingPaise }] : []),
  ];

  return {
    currency: 'INR', lines, meteredFarePaise, nightSurchargePaise, surgePaise, adjustedFarePaise, waitingChargePaise, pickupChargePaise, platformFeePaise,
    taxPaise, roundingPaise, totalPaise, commissionPaise, driverEarningsPaise, nightApplied, surgeApplied, minimumApplied,
    inputs: { distanceMeters, rideSeconds, waitingSeconds, billableSeconds, atMs, timeZone },
  };
}

/**
 * Final distance for settlement. The routing quote is the reference; the tracked GPS distance is accepted only inside
 * a sane band so a noisy or missing track can neither inflate nor erase the fare:
 *   tracked below 90 % of the quote (or no usable track)  → the quoted distance
 *   tracked above the cap (maxDistanceOverQuoteBps)        → the capped distance
 * The cap is disclosed to the customer before booking.
 */
export function resolveFinalDistance(cfg: FareConfig, quotedMeters: number, trackedMeters: number | null): { meters: number; basis: 'quoted' | 'tracked' | 'capped' } {
  if (trackedMeters === null || !Number.isFinite(trackedMeters) || trackedMeters < quotedMeters * 0.9) return { meters: quotedMeters, basis: 'quoted' };
  const cap = Math.round((quotedMeters * cfg.maxDistanceOverQuoteBps) / 10000);
  if (trackedMeters > cap) return { meters: cap, basis: 'capped' };
  return { meters: Math.round(trackedMeters), basis: 'tracked' };
}

/** What cancelling costs the customer right now. `assignedAtMs` is null while no driver is assigned. */
export function cancellationFeePaise(cfg: FareConfig, state: { status: string; assignedAtMs: number | null }, nowMs: number): number {
  if (state.assignedAtMs === null || ['requested', 'searching'].includes(state.status)) return 0;
  if (state.status === 'in_progress') return 0; // an ongoing ride is ended by completion, not cancellation
  if (nowMs - state.assignedAtMs <= cfg.cancellation.graceSeconds * 1000) return 0;
  return cfg.cancellation.feePaise;
}

export const formatPaise = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

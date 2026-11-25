// Location-scoped service rules from the Master Admin "Service & Fare Settings" page
// (service_rules collection): booking availability, which cab types are offered, customer
// fare / partner payout adjustments and fare limits for a state, city or area, by pickup schedule.
//
// Every booking source (customer quote, customer booking, admin booking) evaluates the same
// rules. With no enabled rule for a trip, pricing and availability are exactly as before.
// Rules are written only by saveServiceRule / setServiceRuleStatus below, which validate the
// rule on the server, keep its change history and write the shared audit trail.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { FareAdjustmentInput, serviceName } from './domain/pricing';
import { GeoPlace, TripType } from './domain/types';
import { requirePermission, text, requireAction } from './shared';
import { parseFareScope } from './fareScope';
import { childNames, isInside, parentOf } from './domain/placeZones';
import { STATE_NAMES, pinsOfCity } from './domain/pincodeLookup';
import { placePincode } from './domain/hillStations';

type Adjustment = { mode: 'Normal' | 'Increase' | 'Decrease'; percent: number };
type Side = 'Pickup or drop' | 'Pickup only' | 'Drop only';
type RuleKind = 'availability' | 'categories' | 'pricing' | 'limit';
type RuleLimit = { target: 'Customer fare' | 'Partner payout'; category: string; min: number; max: number; reference: string };

export interface ServiceRule {
  brand?: string;
  fareService?: string;
  id: string;
  kind: RuleKind;
  status: string;
  priority: number;
  scope: { state?: string; city?: string; area?: string; side?: Side };
  service?: string;
  schedule?: { mode?: 'Always' | 'Range'; from?: string; to?: string };
  availability?: 'Available' | 'Limited' | 'Paused';
  categories?: string[];
  customer?: Adjustment;
  partner?: Adjustment;
  /**
   * Pricing rules for a Round Trip only: the time-based packages the change applies to ('same:five', 'same:h6', 'same:full', 'next',
   * 'morning'). Absent / empty = every package. A package-specific rule beats an all-packages rule at the same place.
   */
  packages?: string[];
  limit?: RuleLimit;
  name?: string;
  reason?: string;
  version?: number;
}

/** A time-based Round Trip package id: 'same:five' | 'same:eight' | 'same:full' | 'same:h6' (extra hour slab) | 'next' | 'morning'. */
export const PACKAGE_ID = /^(same:(five|eight|full|h([1-9]|1\d|2[0-3]))|next|morning)$/;

export interface RuleOutcome {
  availability: 'Available' | 'Limited' | 'Paused';
  availabilityRule: ServiceRule | null;
  categories: string[] | null;
  customer: FareAdjustmentInput | null;
  partner: { direction: 'increase' | 'decrease'; percent: number } | null;
  /** Every applicable fare limit; all of them must hold. */
  limits: ServiceRule[];
}

export async function loadServiceRules(tx?: Transaction): Promise<ServiceRule[]> {
  const q = db.collection('service_rules').where('status', '==', 'Enabled');
  const snap = tx ? await tx.get(q) : await q.get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<ServiceRule, 'id'>), id: d.id }));
}

const norm = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

const stateText = (s: unknown) => { const v = typeof s === 'string' ? s.trim() : ''; return norm(STATE_NAMES[v] ?? v); };

type PlaceExtras = { address?: string; city?: string; area?: string; state?: string };

/** A rule's area that is a pincode (six digits) rather than an area name. */
const PIN_AREA = /^[1-9]\d{5}$/;

function placeMatches(rule: ServiceRule, p: GeoPlace): boolean {
  const x = p as GeoPlace & PlaceExtras;
  const hay = `${norm(p.name)} ${norm(x.address)} ${norm(x.city)} ${norm(x.area)} ${norm(x.state)}`;
  const { city, area, state } = rule.scope ?? {};
  const pin = placePincode({ name: p.name, address: x.address, pincode: p.pincode });
  if (PIN_AREA.test(norm(area))) {
    // A pincode is unique across the country, so it needs no city or state in the address: the place just has to carry it.
    const wanted = norm(area);
    if (pin !== wanted && ![...`${hay} ${p.pincode ?? ''}`.matchAll(/(?<![\d-])([1-9]\d{5})(?![\d-])/g)].some((m) => m[1] === wanted)) return false;
    return true;
  }
  if (norm(area) && !hay.includes(norm(area))) return false;
  if (norm(city)) {
    // A city / district rule covers every area listed inside it (Erode covers Gobichettipalayam), and an area that is
    // known to sit inside the rule's city needs no mention of the city in the address. A pincode that belongs to the
    // city / district covers an address that does not name it ("Periyakulam, Tamil Nadu 625601" is in Theni).
    const inside = norm(area) ? isInside(city, area) : childNames(city).some((z) => hay.includes(z)) || (!!pin && !!pinsOfCity(city, state)?.has(pin));
    if (!hay.includes(norm(city)) && !inside) return false;
  }
  const ruleState = stateText(state);
  if (ruleState) {
    const placeState = stateText(x.state);
    // A place with a recorded state must match it; a map pin only carries free text, which names
    // the state rarely, so a city / area rule is trusted on its own.
    if (placeState) { if (placeState !== ruleState) return false; }
    else if (!norm(city) && !norm(area) && !hay.includes(ruleState)) return false;
  }
  return true;
}

/** Schedule window on the pickup instant: the start is included, the end is not. */
function inWindow(rule: ServiceRule, at: Date): boolean {
  if (rule.schedule?.mode !== 'Range') return true;
  const from = rule.schedule.from ? Date.parse(rule.schedule.from) : NaN;
  const to = rule.schedule.to ? Date.parse(rule.schedule.to) : NaN;
  if (Number.isFinite(from) && at.getTime() < from) return false;
  if (Number.isFinite(to) && at.getTime() >= to) return false;
  return true;
}

function applies(rule: ServiceRule, pickup: GeoPlace, drop: GeoPlace, at: Date, service: string): boolean {
  const side = rule.scope?.side ?? 'Pickup or drop';
  const where = side === 'Pickup only' ? placeMatches(rule, pickup) : side === 'Drop only' ? placeMatches(rule, drop) : placeMatches(rule, pickup) || placeMatches(rule, drop);
  if (!where) return false;
  const svc = norm(rule.service);
  if (svc && svc !== 'all' && !norm(service).includes(svc)) return false;
  return inWindow(rule, at);
}

/** The text a rule's Service is matched against: the same for quotes, customer and admin bookings. */
export function ruleServiceText(pickup: GeoPlace, drop: GeoPlace, distanceKm: number, tripType: TripType, label = ''): string {
  const base = serviceName(pickup, drop, distanceKm, tripType);
  const alias = tripType === 'One Way' ? (base === 'Outstation' ? 'multicity' : base === 'Local' ? 'local pickup & drop' : '') : '';
  return `${label} ${base} ${tripType} ${alias}`.trim();
}

/** Most specific location wins (area, city, state, everywhere), then a service-specific rule, then the higher priority. */
// A "city" that is really an area inside a district (Hosur inside Krishnagiri) ranks between the two, so its own rule beats the district's.
const specificity = (r: ServiceRule) => (norm(r.scope?.area) ? 3 : norm(r.scope?.city) ? (parentOf(r.scope?.city) ? 2.5 : 2) : norm(r.scope?.state) ? 1 : 0);
const serviceSpecific = (r: ServiceRule) => (norm(r.service) && norm(r.service) !== 'all' ? 1 : 0);
/** A rule written for one fare service beats one written for every service, at the same place. */
const fareServiceSpecific = (r: ServiceRule) => (r.fareService ? 1 : 0);
/** A rule for named packages beats one for every package. */
const packageSpecific = (r: ServiceRule) => (r.packages?.length ? 1 : 0);
const top = (rules: ServiceRule[]) =>
  [...rules].sort((a, b) => Number(!!b.brand) - Number(!!a.brand) || specificity(b) - specificity(a) || fareServiceSpecific(b) - fareServiceSpecific(a) || packageSpecific(b) - packageSpecific(a) || serviceSpecific(b) - serviceSpecific(a) || (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id))[0] ?? null;
const adj = (a: ServiceRule['customer']) => (a && a.mode !== 'Normal' && a.percent > 0 && a.percent < 100 ? { direction: (a.mode === 'Increase' ? 'increase' : 'decrease') as 'increase' | 'decrease', percent: a.percent } : null);

/**
 * `packageId` is the time-based Round Trip package being priced. A pricing rule that names packages applies only to those; without a
 * package id (a trip that is not a time-based Round Trip, or the first look before a package is chosen) only all-packages rules apply.
 */
export function evaluateRules(rules: ServiceRule[], pickup: GeoPlace, drop: GeoPlace, at: Date, service: string, brand?: string, fareService?: string, itinerary?: GeoPlace[], packageId?: string): RuleOutcome {
  const legs = itinerary && itinerary.length > 1 ? itinerary.slice(1).map((p, n) => [itinerary[n], p]) : [[pickup, drop]];
  const hit = rules.filter((r) => (!r.brand || r.brand === brand) && (!r.fareService || r.fareService === fareService) && r.status === 'Enabled' && legs.some(([a, b]) => applies(r, a, b, at, service)));
  const av = top(hit.filter((r) => r.kind === 'availability'));
  const cats = top(hit.filter((r) => r.kind === 'categories'));
  const price = top(hit.filter((r) => r.kind === 'pricing' && (!r.packages?.length || (!!packageId && r.packages.includes(packageId)))));
  const customer = adj(price?.customer);
  return {
    availability: av?.availability ?? 'Available',
    availabilityRule: av,
    categories: cats?.categories?.length ? cats.categories.map(norm) : null,
    customer: customer ? { id: `rule_${price!.id}`, name: price!.name || 'Location fare rule', direction: customer.direction, percent: customer.percent } : null,
    partner: adj(price?.partner),
    limits: [], // Retired: historical fare-limit records never restrict quotes or bookings.
  };
}

/** Throws when the location is paused or the cab type is hidden for this trip. */
export function assertBookable(o: RuleOutcome, categoryName: string): void {
  if (o.availability === 'Paused') {
    throw new HttpsError('failed-precondition', `New bookings are paused for this location${o.availabilityRule?.reason ? `: ${o.availabilityRule.reason}` : '.'}`);
  }
  if (o.categories && !o.categories.includes(norm(categoryName))) {
    throw new HttpsError('failed-precondition', `${categoryName} is not offered for this location. Choose another cab type.`);
  }
}

/** Booking fields recorded when the location is on Limited service (the office must confirm the booking). */
export function availabilityFields(o: RuleOutcome): Record<string, unknown> {
  return o.availability === 'Limited'
    ? { locationAvailability: 'Limited', locationAvailabilityRuleId: o.availabilityRule?.id ?? '', officeConfirmationRequired: true }
    : {};
}

/** A partner payout rule scales the fixed partner rate the booking was priced with. */
export function adjustPartner<T extends { partner: { ratePaise: number; bataPaise: number; basePaise: number } | null }>(pricing: T, o: RuleOutcome): T {
  if (!o.partner || !pricing.partner) return pricing;
  const f = o.partner.direction === 'increase' ? 1 + o.partner.percent / 100 : 1 - o.partner.percent / 100;
  return { ...pricing, partner: { ...pricing.partner, ratePaise: Math.round(pricing.partner.ratePaise * f), basePaise: Math.round(pricing.partner.basePaise * f) } } as T;
}

/** Partner payout in rupees from a pricing snapshot, or null when the snapshot carries no fixed partner rate. */
export const partnerPayoutRupees = (pricing: { partner: { basePaise: number } | null } | null | undefined): number | null =>
  pricing?.partner ? Math.round(pricing.partner.basePaise) / 100 : null;

/** Stops a quote or booking whose customer fare or partner payout breaks an applicable limit. */
export function assertWithinLimits(o: RuleOutcome, i: { categoryName: string; customerFare: number; partnerPayout: number | null }): void {
  for (const r of o.limits) {
    const l = r.limit!;
    const cat = norm(l.category);
    if (cat && cat !== 'all' && cat !== norm(i.categoryName)) continue;
    const amount = l.target === 'Partner payout' ? i.partnerPayout : i.customerFare;
    if (amount === null || !Number.isFinite(amount)) continue;
    const what = l.target === 'Partner payout' ? 'partner payout' : 'fare';
    if (l.min > 0 && amount < l.min) {
      throw new HttpsError('failed-precondition', `The ${what} ₹${amount} is below the approved minimum ₹${l.min} for this trip${r.name ? ` (${r.name})` : ''}. A rate review is needed before it can be quoted or booked.`);
    }
    if (l.max > 0 && amount > l.max) {
      throw new HttpsError('failed-precondition', `The ${what} ₹${amount} is above the approved maximum ₹${l.max} for this trip${r.name ? ` (${r.name})` : ''}. A rate review is needed before it can be quoted or booked.`);
    }
  }
}

// ── Admin: create, edit and change the status of a rule ─────────────────────

const KINDS: readonly RuleKind[] = ['availability', 'categories', 'pricing'];
const SIDES: readonly Side[] = ['Pickup or drop', 'Pickup only', 'Drop only'];
const MODES = ['Normal', 'Increase', 'Decrease'] as const;
const MAX_RUPEES = 10_000_000;

type StoredRule = Omit<ServiceRule, 'id' | 'status' | 'version'> & { name: string; reason: string; service: string; schedule: { mode: 'Always' | 'Range'; from?: string; to?: string }; scope: { state: string; city: string; area: string; side: Side } };

const adjText = (a?: Adjustment) => (!a || a.mode === 'Normal' ? 'normal' : `${a.mode === 'Increase' ? '+' : '−'}${a.percent}%`);
function summarize(r: Partial<StoredRule> | undefined | null): string {
  if (!r) return '';
  if (r.kind === 'availability') return r.availability ?? 'Available';
  if (r.kind === 'categories') return (r.categories ?? []).join(' · ');
  if (r.kind === 'pricing') return `Customer ${adjText(r.customer)} · Partner ${adjText(r.partner)}${r.fareService ? ` · ${r.fareService}` : ' · all services'}${r.packages?.length ? ` · ${r.packages.join(', ')}` : ''}`;
  return r.limit ? `${r.limit.target} ₹${r.limit.min}–₹${r.limit.max}` : '';
}
const whereText = (s: Partial<StoredRule['scope']> | undefined) => [s?.area, s?.city, s?.state && (STATE_NAMES[s.state] ?? s.state)].filter(Boolean).join(', ') || 'All locations';

function adjustmentOf(v: any, label: string): Adjustment {
  const mode = MODES.find((m) => m === v?.mode) ?? 'Normal';
  if (mode === 'Normal') return { mode, percent: 0 };
  const percent = v?.percent;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || !(percent > 0 && percent < 100)) {
    throw new HttpsError('invalid-argument', `Enter a ${label} percentage between 1 and 99.`);
  }
  return { mode, percent };
}

function isoOf(v: unknown, label: string): string | undefined {
  if (v == null || v === '') return undefined;
  const ms = typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms)) throw new HttpsError('invalid-argument', `The ${label} date and time is not valid.`);
  return new Date(ms).toISOString();
}

export function parseRule(v: any, categoryNames: Set<string>): StoredRule {
  if (!v || typeof v !== 'object') throw new HttpsError('invalid-argument', 'The rule is missing.');
  const kind = KINDS.find((k) => k === v.kind);
  if (!kind) throw new HttpsError('invalid-argument', 'Choose the type of setting.');
  const scope = {
    state: text(v.scope?.state, 40), city: text(v.scope?.city, 80), area: text(v.scope?.area, 80),
    side: SIDES.find((s) => s === v.scope?.side) ?? 'Pickup or drop',
  };
  if (scope.area && !scope.city) throw new HttpsError('invalid-argument', 'Choose the city for an area-specific setting.');
  const priority = v.priority;
  if (!Number.isInteger(priority) || priority < 1 || priority > 100) throw new HttpsError('invalid-argument', 'Priority must be a whole number from 1 to 100.');
  const name = text(v.name, 120);
  if (!name) throw new HttpsError('invalid-argument', 'Give the setting a name.');
  const service = text(v.service, 60);
  const mode = v.schedule?.mode === 'Range' ? 'Range' : 'Always';
  const schedule: StoredRule['schedule'] = { mode };
  if (mode === 'Range') {
    const from = isoOf(v.schedule?.from, 'start'), to = isoOf(v.schedule?.to, 'end');
    if (!from && !to) throw new HttpsError('invalid-argument', 'Set the pickup date range or choose Always.');
    if (from && to && Date.parse(to) <= Date.parse(from)) throw new HttpsError('invalid-argument', 'The end must be after the start.');
    if (from) schedule.from = from;
    if (to) schedule.to = to;
  }
  const rule: StoredRule = { ...parseFareScope(v), kind, name, priority, scope, service: service.toLowerCase() === 'all' ? '' : service, schedule, reason: '' };

  if (kind === 'availability') {
    const a = (['Available', 'Limited', 'Paused'] as const).find((x) => x === v.availability);
    if (!a) throw new HttpsError('invalid-argument', 'Choose Available, Limited or Paused.');
    rule.availability = a;
  } else if (kind === 'categories') {
    const names = Array.isArray(v.categories) ? Array.from(new Set(v.categories.map((c: unknown) => text(c, 80)).filter(Boolean))) as string[] : [];
    if (!names.length) throw new HttpsError('invalid-argument', 'Choose at least one cab type.');
    const unknown = names.find((n) => !categoryNames.has(norm(n)));
    if (unknown) throw new HttpsError('invalid-argument', `${unknown} is not an active cab type.`);
    rule.categories = names;
  } else if (kind === 'pricing') {
    rule.customer = adjustmentOf(v.customer, 'customer fare');
    rule.partner = adjustmentOf(v.partner, 'partner payout');
    if (rule.customer.mode === 'Normal' && rule.partner.mode === 'Normal') throw new HttpsError('invalid-argument', 'Choose an increase or decrease for the customer fare or the partner payout.');
    // Packages: only a Round Trip price change can name them.
    if (v.packages !== undefined && v.packages !== null) {
      if (!Array.isArray(v.packages)) throw new HttpsError('invalid-argument', 'The packages must be a list.');
      const ids = Array.from(new Set(v.packages.map((p: unknown) => (typeof p === 'string' ? p.trim() : '')))).filter(Boolean) as string[];
      if (ids.length) {
        if (rule.fareService !== 'Round Trip') throw new HttpsError('invalid-argument', 'Packages can only be chosen for a Round Trip price change.');
        const badId = ids.find((p) => !PACKAGE_ID.test(p));
        if (badId) throw new HttpsError('invalid-argument', `"${badId}" is not a Round Trip package.`);
        if (ids.length > 16) throw new HttpsError('invalid-argument', 'Choose up to 16 packages.');
        rule.packages = ids.sort();
      }
    }
  } else {
    const l = v.limit ?? {};
    const target = (['Customer fare', 'Partner payout'] as const).find((t) => t === l.target);
    if (!target) throw new HttpsError('invalid-argument', 'Choose whether the limit applies to the customer fare or the partner payout.');
    const category = text(l.category, 80) || 'All';
    if (norm(category) !== 'all' && !categoryNames.has(norm(category))) throw new HttpsError('invalid-argument', `${category} is not an active cab type.`);
    const min = l.min, max = l.max;
    if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || !(max > 0) || max < min || max > MAX_RUPEES) {
      throw new HttpsError('invalid-argument', 'Enter a valid minimum and maximum.');
    }
    rule.limit = { target, category: norm(category) === 'all' ? 'All' : category, min, max, reference: text(l.reference, 200) };
  }
  return rule;
}

const windowOf = (r: { schedule?: StoredRule['schedule'] }) => {
  if (r.schedule?.mode !== 'Range') return [-Infinity, Infinity] as const;
  const from = r.schedule.from ? Date.parse(r.schedule.from) : -Infinity;
  const to = r.schedule.to ? Date.parse(r.schedule.to) : Infinity;
  return [from, to] as const;
};

/** Two enabled settings of the same type, place, service and priority must not overlap in time. */
const packagesKey = (p?: string[]) => (p?.length ? [...p].sort().join(',') : '');
async function assertNoConflict(tx: Transaction, id: string, next: Pick<StoredRule, 'kind' | 'priority' | 'scope' | 'service' | 'schedule' | 'brand' | 'fareService' | 'packages'>): Promise<void> {
  const snap = await tx.get(db.collection('service_rules').where('status', '==', 'Enabled'));
  const [f1, t1] = windowOf(next);
  const clash = snap.docs.find((d) => {
    if (d.id === id) return false;
    const r = d.data() as Partial<StoredRule>;
    if ((r.brand ?? '') !== (next.brand ?? '') || (r.fareService ?? '') !== (next.fareService ?? '')) return false;
    if (r.kind !== next.kind || r.priority !== next.priority) return false;
    if (norm(r.scope?.state) !== norm(next.scope.state) || norm(r.scope?.city) !== norm(next.scope.city) || norm(r.scope?.area) !== norm(next.scope.area)) return false;
    if (norm(r.service) !== norm(next.service)) return false;
    // Price changes for different packages of the same place do not overlap.
    if (packagesKey(r.packages) !== packagesKey(next.packages)) return false;
    const [f2, t2] = windowOf(r);
    return f1 < t2 && f2 < t1;
  });
  if (clash) throw new HttpsError('failed-precondition', `This overlaps "${(clash.data() as StoredRule).name}", which has the same place, service and priority. Change the location, dates, service or priority.`);
}

const HISTORY_LIMIT = 200;

export const saveServiceRule = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const reason = text(input.reason, 300);
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Record the reason for this change.');
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const categories = await db.collection('vehicle_categories').where('status', '==', 'Active').get();
  const next = parseRule(input.rule, new Set(categories.docs.map((d) => norm(d.data().name))));
  next.reason = reason;

  return db.runTransaction(async (tx) => {
    const ref = id ? db.doc(`service_rules/${id}`) : db.collection('service_rules').doc();
    const current = id ? await tx.get(ref) : null;
    if (id && !current?.exists) throw new HttpsError('not-found', 'This setting no longer exists.');
    const before = current?.data() as (Partial<StoredRule> & { status?: string; version?: number; history?: unknown[]; createdAt?: unknown; createdBy?: string }) | undefined;
    if (before?.status === 'Removed') throw new HttpsError('failed-precondition', 'A removed setting cannot be edited.');
    if (before && before.kind !== next.kind) throw new HttpsError('failed-precondition', 'The type of a setting cannot be changed.');
    if (typeof input.expectedVersion === 'number' && input.expectedVersion !== (before?.version ?? 0)) {
      throw new HttpsError('failed-precondition', 'This setting was changed by someone else. Reload and review it before saving.');
    }
    const status = before?.status === 'Disabled' ? 'Disabled' : 'Enabled';
    if (status === 'Enabled') await assertNoConflict(tx, ref.id, next);
    const entry = {
      action: before ? 'Edited' : 'Created', reason, byUid: actor.uid, byName: actor.name, at: Timestamp.now(),
      rule: next.name, location: whereText(next.scope), ...(before ? { before: summarize(before) } : {}), after: summarize(next),
    };
    tx.set(ref, {
      ...next, status, version: (before?.version ?? 0) + 1,
      history: [...(before?.history ?? []).slice(-(HISTORY_LIMIT - 1)), entry],
      createdAt: before?.createdAt ?? FieldValue.serverTimestamp(), createdBy: before?.createdBy ?? actor.uid,
      updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp(),
    });
    auditInTx(tx, {
      action: before ? 'service_rule_edited' : 'service_rule_created', entity: 'service_rule', entityId: ref.id,
      performedBy: actor.uid, performedByName: actor.name, role: 'admin',
      previous: before ? { name: before.name, value: summarize(before), location: whereText(before.scope), status: before.status } : null,
      next: { name: next.name, value: summarize(next), location: whereText(next.scope), kind: next.kind, status }, reason,
    });
    return { id: ref.id, version: (before?.version ?? 0) + 1 };
  });
});

const NEXT_STATUS: Record<string, readonly string[]> = { Enabled: ['Disabled', 'Removed'], Disabled: ['Enabled', 'Removed'], Removed: [] };

export const setServiceRuleStatus = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const reason = text(input.reason, 300);
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Record the reason for the status change.');
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const to = ['Enabled', 'Disabled', 'Removed'].find((s) => s === input.status);
  if (!id || !to) throw new HttpsError('invalid-argument', 'Choose a setting and a status.');

  return db.runTransaction(async (tx) => {
    const ref = db.doc(`service_rules/${id}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'This setting no longer exists.');
    const r = snap.data() as Partial<StoredRule> & { status?: string; version?: number; history?: unknown[] };
    if (typeof input.expectedVersion === 'number' && input.expectedVersion !== (r.version ?? 0)) {
      throw new HttpsError('failed-precondition', 'This setting was changed by someone else. Reload and review it before changing its status.');
    }
    if (!(NEXT_STATUS[r.status ?? ''] ?? []).includes(to)) throw new HttpsError('failed-precondition', `A ${String(r.status ?? '').toLowerCase()} setting cannot be ${to.toLowerCase()}.`);
    if (to === 'Enabled') await assertNoConflict(tx, id, r as StoredRule);
    const entry = {
      action: to === 'Enabled' ? 'Enabled' : to === 'Disabled' ? 'Disabled' : 'Removed', reason, byUid: actor.uid, byName: actor.name, at: Timestamp.now(),
      rule: r.name ?? '', location: whereText(r.scope), before: r.status, after: to,
    };
    tx.update(ref, {
      status: to, version: (r.version ?? 0) + 1, history: [...(r.history ?? []).slice(-(HISTORY_LIMIT - 1)), entry],
      updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp(),
    });
    auditInTx(tx, {
      action: `service_rule_${to.toLowerCase()}`, entity: 'service_rule', entityId: id, performedBy: actor.uid, performedByName: actor.name, role: 'admin',
      previous: { name: r.name, status: r.status, location: whereText(r.scope) }, next: { status: to }, reason,
    });
    return { id, status: to };
  });
});

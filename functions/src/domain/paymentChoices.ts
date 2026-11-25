// The payment choices a customer sees when booking: "Book now, pay later", "Pay 25% now" and "Pay 100% now".
// The office decides, in Service & Fare Settings › Payment options, which of them are offered, for which pickup districts and between
// which dates. This file is pure (no database), so the same rules answer the checkout screen (getPaymentOptions) and are checked again by
// the booking server (createBooking) — a hidden option can never be booked by calling the server directly.
import { childNames } from './placeZones';
import { placePincode } from './hillStations';
import { pinsOfCity } from './pincodeLookup';

export type PayOptionId = 'later' | 'part' | 'full';
export const PAY_OPTION_IDS: readonly PayOptionId[] = ['later', 'part', 'full'];

export interface OptionRule {
  /** The master switch: off hides the option everywhere, whatever the dates and districts say. */
  visible: boolean;
  /** Dates (India time, both days included). `Always` ignores them. */
  schedule: { mode: 'Always' | 'Range'; from: string; to: string };
  /** Which day the dates are compared with: the day the customer books, or the day of the trip. */
  basis: 'booking' | 'pickup';
  /** Pickup districts / cities. All = everywhere; Only = just these; Except = everywhere but these. */
  districts: { mode: 'All' | 'Only' | 'Except'; list: string[] };
}

export interface PaymentChoices {
  version: number;
  options: Record<PayOptionId, OptionRule>;
  /** The share paid now by "Pay x% now" (1–99). */
  partPercent: number;
  /** The option highlighted with a "Recommended" badge ('' = none). */
  recommended: PayOptionId | '';
}

export const DEFAULT_PART_PERCENT = 25;
export const MIN_PART_PERCENT = 1;
export const MAX_PART_PERCENT = 99;
export const MAX_DISTRICTS = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const norm = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase().replace(/\s+/g, ' ') : '');

export const defaultRule = (): OptionRule => ({ visible: true, schedule: { mode: 'Always', from: '', to: '' }, basis: 'booking', districts: { mode: 'All', list: [] } });

export const defaultChoices = (): PaymentChoices => ({
  version: 0,
  options: { later: defaultRule(), part: defaultRule(), full: defaultRule() },
  partPercent: DEFAULT_PART_PERCENT,
  recommended: 'part',
});

/** Reads a stored document; anything missing or malformed falls back to "visible everywhere, always". */
export function parseChoices(raw: unknown): PaymentChoices {
  const d = defaultChoices();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  const out: PaymentChoices = { ...d, version: Number.isInteger(r.version) && r.version >= 0 ? r.version : 0 };
  for (const id of PAY_OPTION_IDS) {
    const o = r.options?.[id];
    if (!o || typeof o !== 'object') continue;
    const list = Array.isArray(o.districts?.list) ? [...new Set<string>(o.districts.list.filter((x: unknown): x is string => typeof x === 'string').map((x: string) => x.trim()).filter(Boolean))].slice(0, MAX_DISTRICTS) : [];
    const mode = o.districts?.mode === 'Only' || o.districts?.mode === 'Except' ? o.districts.mode : 'All';
    out.options[id] = {
      visible: o.visible !== false,
      schedule: {
        mode: o.schedule?.mode === 'Range' ? 'Range' : 'Always',
        from: typeof o.schedule?.from === 'string' && DATE_RE.test(o.schedule.from) ? o.schedule.from : '',
        to: typeof o.schedule?.to === 'string' && DATE_RE.test(o.schedule.to) ? o.schedule.to : '',
      },
      basis: o.basis === 'pickup' ? 'pickup' : 'booking',
      districts: { mode, list },
    };
  }
  const pct = Number(r.partPercent);
  if (Number.isInteger(pct) && pct >= MIN_PART_PERCENT && pct <= MAX_PART_PERCENT) out.partPercent = pct;
  if (r.recommended === '' || PAY_OPTION_IDS.includes(r.recommended)) out.recommended = r.recommended;
  return out;
}

/** The calendar day (YYYY-MM-DD) of an instant in India time. */
export const istDay = (at: Date): string => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export interface PlaceLike { name?: string; address?: string; city?: string; area?: string; district?: string; state?: string }

/** Does this pickup lie in the district / city? Matches by name in the address, and by the towns listed inside the district. */
export function placeInDistrict(place: PlaceLike, district: string): boolean {
  const d = norm(district);
  if (!d) return false;
  const hay = norm(`${place.name ?? ''} ${place.address ?? ''} ${place.city ?? ''} ${place.area ?? ''} ${place.district ?? ''}`);
  if (hay.includes(d) || childNames(d).some((town) => hay.includes(town))) return true;
  // The pickup's pincode inside the district (India Post), as booking rules match: "Periyakulam 625601" is in Theni.
  const pin = placePincode({ name: place.name, address: place.address });
  return !!pin && !!pinsOfCity(district, place.state || undefined)?.has(pin);
}

export interface ChoiceContext {
  now: Date;
  /** The trip's pickup time; only used by options whose dates follow the trip. */
  pickupAt?: Date | null;
  /** The pickup place. Without it a district limit cannot be checked and is not applied (older apps). */
  pickup?: PlaceLike | null;
  /** Whether online payment can be offered at all (keys set and the office switch on). */
  onlineOn: boolean;
}

export type ChoiceStatus = { id: PayOptionId; available: true } | { id: PayOptionId; available: false; reason: 'hidden' | 'dates' | 'district' | 'offline' };

/** Why an option is, or is not, offered for this booking. */
export function optionStatus(cfg: PaymentChoices, id: PayOptionId, ctx: ChoiceContext): ChoiceStatus {
  const rule = cfg.options[id];
  if (!rule.visible) return { id, available: false, reason: 'hidden' };
  if (id !== 'later' && !ctx.onlineOn) return { id, available: false, reason: 'offline' };
  if (rule.schedule.mode === 'Range' && (rule.schedule.from || rule.schedule.to)) {
    const day = istDay(rule.basis === 'pickup' && ctx.pickupAt ? ctx.pickupAt : ctx.now);
    if ((rule.schedule.from && day < rule.schedule.from) || (rule.schedule.to && day > rule.schedule.to)) return { id, available: false, reason: 'dates' };
  }
  if (rule.districts.mode !== 'All' && rule.districts.list.length && ctx.pickup) {
    const inside = rule.districts.list.some((d) => placeInDistrict(ctx.pickup!, d));
    if (rule.districts.mode === 'Only' ? !inside : inside) return { id, available: false, reason: 'district' };
  }
  return { id, available: true };
}

export interface ResolvedChoice { id: PayOptionId; percent: number; recommended: boolean }

/**
 * The options to show, in order. If the office's settings would leave nothing to choose (for example everything hidden for a district),
 * "pay later" is offered anyway: a customer is never stopped from booking by a payment setting.
 */
export function resolveChoices(cfg: PaymentChoices, ctx: ChoiceContext): { choices: ResolvedChoice[]; fallback: boolean } {
  const open = PAY_OPTION_IDS.filter((id) => optionStatus(cfg, id, ctx).available);
  const ids: PayOptionId[] = open.length ? open : ['later'];
  const percentOf = (id: PayOptionId) => (id === 'later' ? 0 : id === 'part' ? cfg.partPercent : 100);
  return { choices: ids.map((id) => ({ id, percent: percentOf(id), recommended: cfg.recommended === id })), fallback: open.length === 0 };
}

/** Whether a booking may use this option right now (the server's check at booking time). */
export function isChoiceOffered(cfg: PaymentChoices, id: PayOptionId, ctx: ChoiceContext): boolean {
  return resolveChoices(cfg, ctx).choices.some((c) => c.id === id);
}

/** The amount paid now, in whole rupees, rounded up ("25% of ₹6,082 = ₹1,520.50" is ₹1,521). Never more than the total. */
export function advanceAmount(total: number, percent: number): number {
  if (!(total > 0)) return 0;
  return Math.min(Math.round(total), Math.max(1, Math.ceil(total * percent / 100 - 1e-9)));
}

export interface PaymentPlan { option: 'part' | 'full'; percent: number; advanceAmount: number }

/** What a booking records for the option the customer chose. "Pay later" has no plan. */
export function planFor(cfg: PaymentChoices, id: PayOptionId, total: number): PaymentPlan | null {
  if (id === 'later') return null;
  const percent = id === 'part' ? cfg.partPercent : 100;
  return { option: id, percent, advanceAmount: advanceAmount(total, percent) };
}

/** A save request from the admin screen, checked field by field; throws a plain sentence on the first problem. */
export function validateChoices(input: unknown): Omit<PaymentChoices, 'version'> {
  const bad = (m: string) => { throw new Error(m); };
  if (!input || typeof input !== 'object') return bad('Send the payment options.');
  const r = input as Record<string, any>;
  const labels: Record<PayOptionId, string> = { later: 'Book now, pay later', part: 'Pay part now', full: 'Pay 100% now' };
  const options = {} as Record<PayOptionId, OptionRule>;
  for (const id of PAY_OPTION_IDS) {
    const o = r.options?.[id];
    const label = labels[id];
    if (!o || typeof o !== 'object') return bad(`${label}: settings are missing.`);
    const mode = o.schedule?.mode === 'Range' ? 'Range' : 'Always';
    const from = typeof o.schedule?.from === 'string' ? o.schedule.from : '';
    const to = typeof o.schedule?.to === 'string' ? o.schedule.to : '';
    if (mode === 'Range') {
      if (!from && !to) return bad(`${label}: choose a start date, an end date, or both — or switch dates off.`);
      if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return bad(`${label}: enter valid dates.`);
      if (from && to && to < from) return bad(`${label}: the end date is before the start date.`);
    }
    const dMode = o.districts?.mode === 'Only' || o.districts?.mode === 'Except' ? o.districts.mode : 'All';
    const rawList: unknown[] = Array.isArray(o.districts?.list) ? o.districts.list : [];
    const seen = new Set<string>();
    const list = rawList.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 60)).filter((x) => x && !seen.has(norm(x)) && !!seen.add(norm(x)));
    if (list.length > MAX_DISTRICTS) return bad(`${label}: choose at most ${MAX_DISTRICTS} districts.`);
    if (dMode !== 'All' && !list.length) return bad(`${label}: choose at least one district, or show it in every district.`);
    options[id] = { visible: o.visible !== false, schedule: { mode, from: mode === 'Range' ? from : '', to: mode === 'Range' ? to : '' }, basis: o.basis === 'pickup' ? 'pickup' : 'booking', districts: { mode: dMode, list: dMode === 'All' ? [] : list } };
  }
  const partPercent = r.partPercent;
  if (typeof partPercent !== 'number' || !Number.isInteger(partPercent) || partPercent < MIN_PART_PERCENT || partPercent > MAX_PART_PERCENT) return bad(`The part payment must be a whole number from ${MIN_PART_PERCENT} to ${MAX_PART_PERCENT} percent.`);
  const recommended = r.recommended === '' || PAY_OPTION_IDS.includes(r.recommended) ? r.recommended : '';
  if (!PAY_OPTION_IDS.some((id) => options[id].visible)) return bad('At least one payment option must stay visible, or customers could not book.');
  return { options, partPercent, recommended };
}

import { gstComponents } from './gst';
import { taxableFromInclusivePaise } from './tariff';
// Authoritative fare policy. Client calculations are previews only.
import { AppliedCoupon, Coupon, DiscountDetail, FareBreakdown, GeoPlace, RideCategory, RouteInfo, TripType } from './types';
const GST_RATE = 0.05, NIGHT_END_HOUR = 6, NIGHT_START_HOUR = 22, OUTSTATION_THRESHOLD_KM = 40;
/** The GST rate of the vehicle-category engine, for fixed prices quoted while no tariff is saved. */
export const CATEGORY_GST_RATE = GST_RATE;
const str = (v: unknown): string => typeof v === 'string' ? v : '';
const num = (v: unknown, fallback = 0): number => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
function vehicleTypeAliases(...labels: string[]): string[] {
  const out = new Set<string>();
  for (const raw of labels) {
    const l = raw.trim().toLowerCase();
    if (!l) continue;
    out.add(l);
    if (l === 'mini' || l === 'hatchback') {
      out.add('mini');
      out.add('hatchback');
    }
    if (l === 'auto' || l === 'auto rickshaw') {
      out.add('auto');
      out.add('auto rickshaw');
    }
  }
  return [...out];
}

export function mapCategory(id: string, d: Record<string, any>): RideCategory | null {
  const f = d.fare && typeof d.fare === 'object' ? d.fare : {};
  const perKmRate = num(f.perKmRate);
  if (!str(d.name) || perKmRate <= 0) return null; // unpriceable — skip
  const waitingPerHour = num(f.waitingChargePerHour);
  return {
    id,
    name: str(d.name),
    description: str(d.description),
    seats: num(d.seatingCapacity) || num(d.recommendedPassengers) || 4,
    imageUrl: str(d.imageUrl) || undefined,
    matchVehicleTypes: vehicleTypeAliases(str(d.name), str(d.code)),
    fare: {
      baseFare: num(f.baseFare),
      baseKm: num(f.baseKm),
      perKmRate,
      perMinuteRate: f.perMinuteRate != null ? num(f.perMinuteRate) : waitingPerHour > 0 ? waitingPerHour / 60 : 0,
      minimumFare: num(f.minimumFare),
      nightCharge: num(f.nightAllowance),
      driverAllowance: num(f.outstationDriverBattaPerDay) || num(f.driverAllowance),
      outstationPerKmRate: num(f.outstationPerKmRate) || undefined,
      extras: {
        waitingPerHour: waitingPerHour,
        extraKmRate: num(f.extraKmCharge) || perKmRate,
        // Absent flags mean "not included": the customer pays at actuals.
        tollIncluded: f.tollIncluded === true,
        parkingIncluded: f.parkingIncluded === true,
        permitCharge: num(f.permitCharge),
        carrierCharge: num(f.carrierCharge),
      },
    },
    displayOrder: num(d.displayOrder, 99),
    cngEnabled: d.cngEnabled === true,
  };
}

/**
 * Live list of bookable categories. Emits the built-in defaults while
 * loading, if the collection is empty, or if it can't be read.
 */
export function categoryServesVehicle(cat: RideCategory, vehicleType: string): boolean {
  return cat.matchVehicleTypes.includes(vehicleType.trim().toLowerCase());
}

// ── Service classification ──────────────────────────────────────────────────

export function isOutstation(oneWayKm: number): boolean {
  return oneWayKm > OUTSTATION_THRESHOLD_KM;
}

export function serviceName(pickup: GeoPlace, drop: GeoPlace, oneWayKm: number, tripType?: TripType): string {
  if (tripType === 'Airport Taxi' || pickup.type === 'airport' || drop.type === 'airport') return 'Airport';
  if (tripType === 'Local Rental') return 'Rental';
  return isOutstation(oneWayKm) ? 'Outstation' : 'Local';
}

export function isNightTime(d: Date): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(d));
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
}

// ── Fare engine ─────────────────────────────────────────────────────────────

/** business_config/fare_adjustment, as the engine consumes it. */
export interface FareAdjustmentInput {
  id: string;
  name: string;
  direction: 'increase' | 'decrease';
  /** 0–100. */
  percent: number;
}

/** A discount an admin gives on a booking: one mode at a time, never stacked with a coupon. */
export interface AdminDiscountInput {
  type: 'percentage' | 'fixed';
  value: number;
  reason?: string;
}

export interface FareInput {
  category: RideCategory;
  route: RouteInfo;
  tripType: TripType;
  pickupTime: Date;
  /** Coupon discount in rupees (customer bookings). */
  discount?: number;
  /** Global percentage adjustment, applied once to the package total. */
  adjustment?: FareAdjustmentInput | null;
  /** Admin percentage / fixed discount (admin bookings). */
  adminDiscount?: AdminDiscountInput | null;
}

export function calculateFare({ category, route, tripType, pickupTime, discount = 0, adjustment = null, adminDiscount = null }: FareInput): FareBreakdown {
  if (adminDiscount && discount > 0) throw new Error('A booking takes either a coupon or an admin discount, not both.');
  const f = category.fare;
  const legs = tripType === 'Round Trip' ? 2 : 1;
  const km = route.distanceKm * legs;
  const minutes = route.durationMin * legs;
  const outstation = isOutstation(route.distanceKm);

  const perKmRate = outstation && f.outstationPerKmRate ? f.outstationPerKmRate : f.perKmRate;
  // Outstation trips are priced per km plus driver allowance; time isn't billed.
  const perMinuteRate = outstation ? 0 : f.perMinuteRate;

  const baseFare = Math.round(f.baseFare);
  const distanceFare = Math.round(Math.max(0, km - f.baseKm) * perKmRate);
  const timeFare = Math.round(minutes * perMinuteRate);
  const nightCharge = isNightTime(pickupTime) ? Math.round(f.nightCharge) : 0;
  // One allowance per 12 hours of driving (covers the return leg on round trips).
  const driverAllowance = outstation ? Math.round(f.driverAllowance * Math.max(1, Math.ceil(minutes / 720))) : 0;

  const raw = baseFare + distanceFare + timeFare + nightCharge + driverAllowance;
  const minimumFareAdjustment = Math.max(0, Math.round(f.minimumFare) - raw);
  const subtotalBeforeAdjustment = raw + minimumFareAdjustment;
  // One percentage of the pre-adjustment total. Never applied to an already
  // adjusted figure, so a later change cannot compound.
  const percent = adjustment ? Math.min(100, Math.max(0, adjustment.percent)) : 0;
  const adjustmentAmount = adjustment && percent > 0
    ? (adjustment.direction === 'decrease' ? -1 : 1) * Math.round((subtotalBeforeAdjustment * percent) / 100)
    : 0;
  const subtotal = Math.max(0, subtotalBeforeAdjustment + adjustmentAmount);
  const globalAdjustment = adjustment && percent > 0
    ? { id: adjustment.id, name: adjustment.name, direction: adjustment.direction, percent, amount: adjustmentAmount }
    : null;

  let requested = Math.max(0, Math.round(discount));
  let discountDetail: DiscountDetail | null = requested > 0 ? { type: 'coupon', value: requested, amount: 0, source: 'coupon', reason: '' } : null;
  if (adminDiscount) {
    const v = Math.max(0, adminDiscount.value);
    requested = adminDiscount.type === 'percentage' ? Math.round((subtotal * Math.min(100, v)) / 100) : Math.round(v);
    discountDetail = requested > 0 ? { type: adminDiscount.type, value: v, amount: 0, source: 'admin', reason: adminDiscount.reason ?? '' } : null;
  }
  // The payable amount can never go below zero.
  const appliedDiscount = Math.min(requested, subtotal);
  if (discountDetail) discountDetail.amount = appliedDiscount;
  const taxableAmount = subtotal - appliedDiscount;
  const gst = Math.round(taxableAmount * GST_RATE);

  return {
    subtotalBeforeAdjustment,
    globalAdjustment,
    discountDetail,
    baseFare,
    distanceFare,
    timeFare,
    nightCharge,
    driverAllowance,
    minimumFareAdjustment,
    subtotal,
    discount: appliedDiscount,
    taxableAmount,
    gstRate: GST_RATE,
    gst,
    total: taxableAmount + gst,
    distanceKm: Math.round(km * 10) / 10,
    durationMin: Math.round(minutes),
    perKmRate,
    perMinuteRate,
  };
}

/** Splits a GST-inclusive total the way calculateFare rounds GST. */
export function splitGstInclusive(total: number): { taxableAmount: number; gst: number } {
  let taxable = Math.floor(total / (1 + GST_RATE));
  while (taxable + 1 + Math.round((taxable + 1) * GST_RATE) <= total) taxable++;
  while (taxable > 0 && taxable + Math.round(taxable * GST_RATE) > total) taxable--;
  return { taxableAmount: taxable, gst: total - taxable };
}

/**
 * An admin-authorised fare: the calculated components are kept and the
 * difference is recorded as `adminAdjustment` (pre-GST), so the breakdown
 * still adds up to the charged total.
 */
export function applyFareOverride(calculated: FareBreakdown, total: number): FareBreakdown {
  const rate = calculated.gstRate;
  const taxableAmount = calculated.gstDetails ? taxableFromInclusivePaise(Math.round(total * 100), rate) / 100 : splitGstInclusive(total).taxableAmount;
  const gst = Math.round((total - taxableAmount) * 100) / 100;
  const subtotal = taxableAmount + calculated.discount;
  const computedSubtotal = calculated.subtotal - (calculated.adminAdjustment ?? 0);
  return { ...calculated, ...(calculated.gstDetails ? { gstDetails: { ...calculated.gstDetails, ...gstComponents(gst, calculated.gstDetails.split) } } : {}), adminAdjustment: subtotal - computedSubtotal, subtotal, taxableAmount, gst, total };
}

// ── Coupons ─────────────────────────────────────────────────────────────────

export function mapCoupon(id: string, d: Record<string, any>): Coupon {
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  return {
    id,
    code: str(d.code),
    name: str(d.name),
    description: str(d.description),
    discountType: d.discountType === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED_AMOUNT',
    discountValue: num(d.discountValue),
    maximumDiscount: num(d.maximumDiscount),
    minimumBookingAmount: num(d.minimumBookingAmount),
    validFrom: str(d.validFrom),
    validUntil: str(d.validUntil),
    firstBookingOnly: Boolean(d.firstBookingOnly),
    vehicleCategoryIds: arr(d.vehicleCategoryIds),
    serviceNames: arr(d.serviceNames),
    totalUsageLimit: num(d.totalUsageLimit),
    usedCount: num(d.usedCount),
    perCustomerLimit: num(d.perCustomerLimit),
    status: str(d.status),
    adminBookingOnly: Boolean(d.adminBookingOnly),
    ...(['All', 'New', 'Returning', 'Regular'].includes(d.audience) ? {
      audience: d.audience,
      bookFrom: str(d.bookFrom), bookUntil: str(d.bookUntil), pickupFrom: str(d.pickupFrom), pickupUntil: str(d.pickupUntil),
      scope: ['Pickup city', 'Exact route'].includes(d.scope) ? d.scope : 'Any', city: str(d.city), dropCity: str(d.dropCity),
      allowFixed: d.allowFixed === true, allowBusiness: d.allowBusiness === true, allowPeak: d.allowPeak === true,
    } : {}),
  };
}

export function normalizeCode(code: string): string {
  return (code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function todayIso(now: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }

export function isCouponLive(c: Coupon, now = new Date()): boolean {
  if (c.adminBookingOnly) return false;
  if (!['Active', 'Scheduled', ''].includes(c.status)) return false;
  const today = todayIso(now);
  if (c.validFrom && today < c.validFrom) return false;
  if (c.validUntil && today > c.validUntil) return false;
  if (c.totalUsageLimit > 0 && c.usedCount >= c.totalUsageLimit) return false;
  return true;
}

export interface CouponContext {
  subtotal: number;
  categoryId: string;
  service: string;
  isFirstBooking: boolean;
  /** How many of this customer's non-cancelled bookings already used the code. */
  customerUses: number;
  /** For Master Admin coupons (audience set): pickup instant, completed trips, places and fare kind. */
  pickupAt?: Date;
  completedTrips?: number;
  pickupText?: string;
  dropText?: string;
  fixedRoute?: boolean;
  business?: boolean;
  peakAdjusted?: boolean;
  /** An office (admin) booking: coupons marked adminBookingOnly are accepted too. */
  adminBooking?: boolean;
}

/** New: no completed trips · Returning: 1–2 · Regular: 3 or more (same rule as the admin lists). */
export function customerGroupOf(completedTrips: number): 'New' | 'Returning' | 'Regular' {
  return completedTrips >= 3 ? 'Regular' : completedTrips >= 1 ? 'Returning' : 'New';
}

/** Reference-form coupon checks: windows (end exclusive), audience, area and fare kind. */
function masterCouponFailure(c: Coupon, ctx: CouponContext, now: Date): string | null {
  if (!c.audience) return null;
  const at = (v?: string) => (v ? Date.parse(v) : NaN);
  const t = now.getTime();
  if ((Number.isFinite(at(c.bookFrom)) && t < at(c.bookFrom)) || (Number.isFinite(at(c.bookUntil)) && t >= at(c.bookUntil)))
    return `${c.code}: booking date is outside the coupon validity.`;
  if (ctx.pickupAt) {
    const p = ctx.pickupAt.getTime();
    if ((Number.isFinite(at(c.pickupFrom)) && p < at(c.pickupFrom)) || (Number.isFinite(at(c.pickupUntil)) && p >= at(c.pickupUntil)))
      return `${c.code}: pickup date is outside the travel window.`;
  }
  if (ctx.fixedRoute && !c.allowFixed) return `${c.code}: fixed route fares are excluded.`;
  if (ctx.business && !c.allowBusiness) return `${c.code}: B2B bookings are excluded.`;
  if (ctx.peakAdjusted && !c.allowPeak) return `${c.code}: peak-adjusted fares are excluded.`;
  const has = (place: string | undefined, city: string | undefined) => !city || (place ?? '').toLowerCase().includes(city.toLowerCase());
  if (c.scope && c.scope !== 'Any' && !has(ctx.pickupText, c.city)) return `${c.code}: pickup city is not eligible.`;
  if (c.scope === 'Exact route' && !has(ctx.dropText, c.dropCity)) return `${c.code}: this directional route is not eligible.`;
  if (c.audience !== 'All') {
    const group = customerGroupOf(ctx.completedTrips ?? (ctx.isFirstBooking ? 0 : 1));
    if (group !== c.audience) return `${c.code} is for ${c.audience.toLowerCase()} customers.`;
  }
  return null;
}

export type CouponResult = { ok: true; coupon: AppliedCoupon } | { ok: false; message: string };

export function validateCoupon(coupons: Coupon[], input: string, ctx: CouponContext): CouponResult {
  const code = normalizeCode(input);
  if (!code) return { ok: false, message: 'Enter a promo code.' };
  const c = coupons.find((x) => normalizeCode(x.code) === code);
  if (!c || (c.adminBookingOnly && !ctx.adminBooking)) return { ok: false, message: `“${input.trim()}” is not a valid promo code.` };

  const today = todayIso(new Date());
  if (!['Active', 'Scheduled', ''].includes(c.status)) return { ok: false, message: `${c.code} is no longer active.` };
  if (c.validFrom && today < c.validFrom) return { ok: false, message: `${c.code} starts on ${c.validFrom}.` };
  if (c.validUntil && today > c.validUntil) return { ok: false, message: `${c.code} expired on ${c.validUntil}.` };
  if (c.totalUsageLimit > 0 && c.usedCount >= c.totalUsageLimit)
    return { ok: false, message: `${c.code} has been fully redeemed.` };
  if (c.perCustomerLimit > 0 && ctx.customerUses >= c.perCustomerLimit)
    return { ok: false, message: `You have already used ${c.code} the maximum number of times.` };
  if (c.minimumBookingAmount > 0 && ctx.subtotal < c.minimumBookingAmount)
    return { ok: false, message: `${c.code} needs a minimum fare of ₹${c.minimumBookingAmount}.` };
  if (c.firstBookingOnly && !ctx.isFirstBooking) return { ok: false, message: `${c.code} is for your first ride only.` };
  const master = masterCouponFailure(c, ctx, new Date());
  if (master) return { ok: false, message: master };
  if (c.vehicleCategoryIds.length && !c.vehicleCategoryIds.includes(ctx.categoryId))
    return { ok: false, message: `${c.code} isn't valid for this ride type.` };
  if (c.serviceNames.length) {
    const s = ctx.service.toLowerCase();
    const match = c.serviceNames.some((n) => {
      const x = n.toLowerCase();
      return x.includes(s) || s.includes(x);
    });
    if (!match) return { ok: false, message: `${c.code} is only valid for: ${c.serviceNames.join(', ')}.` };
  }

  let discount =
    c.discountType === 'PERCENTAGE'
      ? (ctx.subtotal * Math.min(100, Math.max(0, c.discountValue))) / 100
      : c.discountValue;
  if (c.maximumDiscount > 0) discount = Math.min(discount, c.maximumDiscount);
  discount = Math.round(Math.min(Math.max(0, discount), ctx.subtotal));
  if (discount <= 0) return { ok: false, message: `${c.code} gives no discount on this ride.` };
  return { ok: true, coupon: { code: c.code, discount, message: `${c.code} applied — you save ₹${discount}` } };
}


// Ride categories, fare calculation and coupon validation.
//
// Categories and coupons are admin-managed (`vehicle_categories`, `coupons`).
// The fare shown here is the upfront price written to the booking; tolls the
// driver pays en route are added to the final receipt.

import { collection, doc, onSnapshot, query, where, type DocumentData } from 'firebase/firestore';
import { db } from '../config/firebase';
import { GST_RATE, NIGHT_END_HOUR, NIGHT_START_HOUR, OUTSTATION_THRESHOLD_KM } from '../config/constants';
import type { AppliedCoupon, Coupon, DiscountDetail, FareBreakdown, GeoPlace, RideCategory, RouteInfo, TripType } from '../types';

// Same coercion as the booking server (functions/src/domain/pricing.ts): a
// value stored with the wrong type counts as missing and is never parsed, so
// the app never offers a category or coupon the server would refuse.
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// ── Categories ──────────────────────────────────────────────────────────────

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

/** Exported for the server-parity test. */
export function mapCategory(id: string, d: DocumentData): RideCategory | null {
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
        waitingPerHour,
        extraKmRate: num(f.extraKmCharge) || perKmRate,
        // Absent flags mean "not included": the customer pays at actuals.
        tollIncluded: f.tollIncluded === true,
        parkingIncluded: f.parkingIncluded === true,
        permitCharge: num(f.permitCharge),
        carrierCharge: num(f.carrierCharge),
      },
    },
    displayOrder: num(d.displayOrder, 99),
  };
}

export const SPEC_DEFAULT_CATEGORIES: RideCategory[] = [
  {
    id: 'cat-sedan',
    name: 'Sedan',
    description: 'Dzire, Etios, Aura (4+1 Passengers)',
    seats: 4,
    displayOrder: 1,
    matchVehicleTypes: ['sedan', 'dzire', 'etios', 'aura'],
    fare: {
      baseFare: 0,
      baseKm: 0,
      perKmRate: 15,
      perMinuteRate: 0,
      minimumFare: 1950,
      nightCharge: 0,
      driverAllowance: 400,
      outstationPerKmRate: 15,
      extras: { waitingPerHour: 0, extraKmRate: 15, tollIncluded: false, parkingIncluded: false, permitCharge: 0, carrierCharge: 0 },
    },
  },
  {
    id: 'cat-suv-6',
    name: 'SUV (6+1)',
    description: 'Maruti Ertiga, Kia Carens (6 Passengers)',
    seats: 6,
    displayOrder: 2,
    matchVehicleTypes: ['suv', 'ertiga', 'carens', 'mpv'],
    fare: {
      baseFare: 0,
      baseKm: 0,
      perKmRate: 20,
      perMinuteRate: 0,
      minimumFare: 2600,
      nightCharge: 0,
      driverAllowance: 400,
      outstationPerKmRate: 20,
      extras: { waitingPerHour: 0, extraKmRate: 20, tollIncluded: false, parkingIncluded: false, permitCharge: 0, carrierCharge: 300 },
    },
  },
  {
    id: 'cat-suv-7',
    name: 'SUV (7+1)',
    description: 'Mahindra Scorpio, Bolero Neo (7 Passengers)',
    seats: 7,
    displayOrder: 3,
    matchVehicleTypes: ['suv', 'scorpio', 'bolero', 'xuv'],
    fare: {
      baseFare: 0,
      baseKm: 0,
      perKmRate: 20,
      perMinuteRate: 0,
      minimumFare: 2600,
      nightCharge: 0,
      driverAllowance: 400,
      outstationPerKmRate: 20,
      extras: { waitingPerHour: 0, extraKmRate: 20, tollIncluded: false, parkingIncluded: false, permitCharge: 0, carrierCharge: 400 },
    },
  },
  {
    id: 'cat-innova',
    name: 'Innova',
    description: 'Toyota Innova (Spacious highway comfort, 7 Seater)',
    seats: 7,
    displayOrder: 4,
    matchVehicleTypes: ['innova'],
    fare: {
      baseFare: 0,
      baseKm: 0,
      perKmRate: 20,
      perMinuteRate: 0,
      minimumFare: 2600,
      nightCharge: 0,
      driverAllowance: 400,
      outstationPerKmRate: 20,
      extras: { waitingPerHour: 0, extraKmRate: 20, tollIncluded: false, parkingIncluded: false, permitCharge: 0, carrierCharge: 400 },
    },
  },
  {
    id: 'cat-crysta',
    name: 'Innova Crysta',
    description: 'Executive Luxury MPV, Premium Highway Driver',
    seats: 7,
    displayOrder: 5,
    matchVehicleTypes: ['crysta', 'innova crysta'],
    fare: {
      baseFare: 0,
      baseKm: 0,
      perKmRate: 26,
      perMinuteRate: 0,
      minimumFare: 3380,
      nightCharge: 0,
      driverAllowance: 600,
      outstationPerKmRate: 26,
      extras: { waitingPerHour: 0, extraKmRate: 26, tollIncluded: false, parkingIncluded: false, permitCharge: 0, carrierCharge: 400 },
    },
  },
];

export type RideCategoryStatus = 'loading' | 'ready' | 'unavailable' | 'error';

/**
 * Live list of bookable categories — falls back to standard NTT/DEV-SPEC 2.0
 * fleet so online booking is ALWAYS available without waiting for Firestore config.
 */
export function subscribeToRideCategories(cb: (cats: RideCategory[], status: RideCategoryStatus) => void, configuredOnly = false): () => void {
  if (configuredOnly) {
    cb([], 'loading');
    return onSnapshot(query(collection(db, 'vehicle_categories'), where('status', '==', 'Active')), snap => {
      const cats = snap.docs.map(d => mapCategory(d.id, d.data())).filter((category): category is RideCategory => !!category)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
      cb(cats, 'ready');
    }, () => cb([], 'error'));
  }
  cb(SPEC_DEFAULT_CATEGORIES, 'ready');
  return onSnapshot(
    query(collection(db, 'vehicle_categories'), where('status', '==', 'Active')),
    (snap) => {
      const cats = snap.docs
        .map((d) => mapCategory(d.id, d.data()))
        .filter((c): c is RideCategory => !!c)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
      cb(cats.length ? cats : SPEC_DEFAULT_CATEGORIES, 'ready');
    },
    () => cb(SPEC_DEFAULT_CATEGORIES, 'ready'),
  );
}

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

export const POPULAR_AIRPORTS: GeoPlace[] = [
  { id: 'airport-maa', name: 'Chennai International Airport (MAA)', address: 'GST Road, Meenambakkam, Chennai, Tamil Nadu 600027', lat: 12.9941, lng: 80.1709, type: 'airport' },
  { id: 'airport-ixm', name: 'Madurai International Airport (IXM)', address: 'Airport Road, Madurai, Tamil Nadu 625022', lat: 9.8345, lng: 78.0934, type: 'airport' },
  { id: 'airport-cjb', name: 'Coimbatore International Airport (CJB)', address: 'Avinashi Road, Peelamedu, Coimbatore, Tamil Nadu 641014', lat: 11.0300, lng: 77.0434, type: 'airport' },
  { id: 'airport-trz', name: 'Tiruchirappalli International Airport (TRZ)', address: 'Trichy Airport, Tiruchirappalli, Tamil Nadu 620007', lat: 10.7654, lng: 78.7107, type: 'airport' },
  { id: 'airport-blr', name: 'Kempegowda International Airport Bengaluru (BLR)', address: 'KIAL Rd, Devanahalli, Bengaluru, Karnataka 560300', lat: 13.1986, lng: 77.7066, type: 'airport' },
  { id: 'airport-sxv', name: 'Salem Airport (SXV)', address: 'Kamalapuram, Salem, Tamil Nadu 636309', lat: 11.7833, lng: 78.0667, type: 'airport' },
  { id: 'airport-tcr', name: 'Tuticorin Airport (TCR)', address: 'Vagaikulam, Thoothukudi, Tamil Nadu 628103', lat: 8.7239, lng: 78.0267, type: 'airport' },
];

export const makeLocalDisposalPlace = (near?: GeoPlace | null): GeoPlace => ({
  id: 'place-local-disposal',
  name: 'Local City Disposal',
  address: near ? `${near.name} & City Limits (Within city disposal)` : 'City limits disposal package',
  lat: near ? near.lat + 0.04 : 13.0827,
  lng: near ? near.lng + 0.04 : 80.2707,
  type: 'other',
});

/** Night pickup in India time — the server's rule, whatever the browser's time zone. */
export function isNightTime(d: Date): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(d));
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
}

// ── Fare engine ─────────────────────────────────────────────────────────────

/** The global percentage adjustment currently in force (festival pricing, a promotion…). */
export interface FareAdjustment {
  id: string;
  name: string;
  direction: 'increase' | 'decrease';
  percent: number;
}

export interface FareInput {
  category: RideCategory;
  route: RouteInfo;
  tripType: TripType;
  pickupTime: Date;
  discount?: number;
  adjustment?: FareAdjustment | null;
}

export function calculateFare({ category, route, tripType, pickupTime, discount = 0, adjustment = null }: FareInput): FareBreakdown {
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
  // One percentage of the pre-adjustment total — never applied on top of itself.
  const percent = adjustment ? Math.min(100, Math.max(0, adjustment.percent)) : 0;
  const adjustmentAmount = adjustment && percent > 0 ? (adjustment.direction === 'decrease' ? -1 : 1) * Math.round((subtotalBeforeAdjustment * percent) / 100) : 0;
  const subtotal = Math.max(0, subtotalBeforeAdjustment + adjustmentAmount);
  const globalAdjustment = adjustment && percent > 0
    ? { id: adjustment.id, name: adjustment.name, direction: adjustment.direction, percent, amount: adjustmentAmount }
    : null;
  const requested = Math.max(0, Math.round(discount));
  const discountDetail: DiscountDetail | null = requested > 0 ? { type: 'coupon', value: requested, amount: 0, source: 'coupon', reason: '' } : null;
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

/** Effective today on the India calendar, like the server decides it. */
function adjustmentInForce(d: DocumentData | undefined, now = new Date()): FareAdjustment | null {
  if (!d || d.enabled !== true) return null;
  const percent = typeof d.percent === 'number' && Number.isFinite(d.percent) ? d.percent : 0;
  if (!(percent > 0) || (d.direction !== 'increase' && d.direction !== 'decrease')) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (typeof d.startDate === 'string' && d.startDate && today < d.startDate) return null;
  if (typeof d.endDate === 'string' && d.endDate && today > d.endDate) return null;
  return { id: `global_v${typeof d.version === 'number' ? d.version : 0}`, name: typeof d.name === 'string' && d.name ? d.name : 'Fare adjustment', direction: d.direction, percent };
}

/** Live global fare adjustment (public_config/fare_adjustment); null when none applies. */
export function subscribeToFareAdjustment(cb: (a: FareAdjustment | null) => void): () => void {
  return onSnapshot(
    doc(db, 'public_config', 'fare_adjustment'),
    (snap) => cb(adjustmentInForce(snap.exists() ? snap.data() : undefined)),
    () => cb(null),
  );
}

// ── Coupons ─────────────────────────────────────────────────────────────────

function mapCoupon(id: string, d: DocumentData): Coupon {
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
  };
}

export function normalizeCode(code: string): string {
  return (code || '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Today's date in India (coupon validity dates are Indian calendar dates, as on the server). */
function todayIso(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function isCouponLive(c: Coupon, now = new Date()): boolean {
  if (c.adminBookingOnly) return false;
  if (!['Active', 'Scheduled', ''].includes(c.status)) return false;
  const today = todayIso(now);
  if (c.validFrom && today < c.validFrom) return false;
  if (c.validUntil && today > c.validUntil) return false;
  if (c.totalUsageLimit > 0 && c.usedCount >= c.totalUsageLimit) return false;
  return true;
}

export function subscribeToCoupons(cb: (coupons: Coupon[]) => void): () => void {
  return onSnapshot(
    collection(db, 'coupons'),
    (snap) => cb(snap.docs.map((d) => mapCoupon(d.id, d.data()))),
    () => cb([]),
  );
}

export interface CouponContext {
  subtotal: number;
  categoryId: string;
  service: string;
  isFirstBooking: boolean;
  /** How many of this customer's non-cancelled bookings already used the code. */
  customerUses: number;
}

export type CouponResult = { ok: true; coupon: AppliedCoupon } | { ok: false; message: string };

export function validateCoupon(coupons: Coupon[], input: string, ctx: CouponContext): CouponResult {
  const code = normalizeCode(input);
  if (!code) return { ok: false, message: 'Enter a promo code.' };
  const c = coupons.find((x) => normalizeCode(x.code) === code);
  if (!c || c.adminBookingOnly) return { ok: false, message: `“${input.trim()}” is not a valid promo code.` };

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

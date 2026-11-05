import { calculateFare, isCouponLive, isNightTime, serviceName, validateCoupon, type CouponContext } from '../src/services/pricingService';
import { DEFAULT_RIDE_CATEGORIES, GST_RATE, OUTSTATION_THRESHOLD_KM } from '../src/config/constants';
import type { Coupon, GeoPlace, RouteInfo } from '../src/types';

const sedan = DEFAULT_RIDE_CATEGORIES.find((c) => c.id === 'sedan')!;
const route = (distanceKm: number, durationMin: number): RouteInfo => ({ distanceKm, durationMin, path: [], estimated: false });
const noon = new Date(2026, 8, 28, 12, 0);
const night = new Date(2026, 8, 28, 23, 0);

describe('calculateFare', () => {
  it('prices a local daytime ride exactly like the Web engine', () => {
    const f = calculateFare({ category: sedan, route: route(10, 30), tripType: 'One Way', pickupTime: noon });
    // base 70 + (10-2)*16 + 30*1.75 → 70 + 128 + 53 = 251
    expect(f.baseFare).toBe(70);
    expect(f.distanceFare).toBe(128);
    expect(f.timeFare).toBe(53);
    expect(f.nightCharge).toBe(0);
    expect(f.driverAllowance).toBe(0);
    expect(f.subtotal).toBe(251);
    expect(f.gst).toBe(Math.round(251 * GST_RATE));
    expect(f.total).toBe(251 + f.gst);
  });

  it('applies the minimum fare', () => {
    const f = calculateFare({ category: sedan, route: route(0.5, 3), tripType: 'One Way', pickupTime: noon });
    expect(f.subtotal).toBe(sedan.fare.minimumFare);
    expect(f.minimumFareAdjustment).toBeGreaterThan(0);
  });

  it('adds night charge between 22:00 and 06:00', () => {
    expect(isNightTime(night)).toBe(true);
    expect(isNightTime(noon)).toBe(false);
    const f = calculateFare({ category: sedan, route: route(10, 30), tripType: 'One Way', pickupTime: night });
    expect(f.nightCharge).toBe(sedan.fare.nightCharge);
  });

  it('prices outstation per km with driver allowance and no time billing', () => {
    const f = calculateFare({ category: sedan, route: route(OUTSTATION_THRESHOLD_KM + 60, 120), tripType: 'One Way', pickupTime: noon });
    expect(f.timeFare).toBe(0);
    expect(f.driverAllowance).toBe(sedan.fare.driverAllowance);
  });

  it('doubles distance for round trips', () => {
    const one = calculateFare({ category: sedan, route: route(20, 40), tripType: 'One Way', pickupTime: noon });
    const two = calculateFare({ category: sedan, route: route(20, 40), tripType: 'Round Trip', pickupTime: noon });
    expect(two.distanceKm).toBe(40);
    expect(two.total).toBeGreaterThan(one.total);
  });

  it('never discounts below zero and taxes the discounted amount', () => {
    const f = calculateFare({ category: sedan, route: route(10, 30), tripType: 'One Way', pickupTime: noon, discount: 100000 });
    expect(f.discount).toBe(f.subtotal);
    expect(f.taxableAmount).toBe(0);
    expect(f.total).toBe(0);
  });
});

describe('serviceName', () => {
  const p = (type: GeoPlace['type']): GeoPlace => ({ id: 'x', name: 'x', address: 'x', type, lat: 10, lng: 77 });
  it('detects airport, outstation and local', () => {
    expect(serviceName(p('airport'), p('other'), 5)).toBe('Airport');
    expect(serviceName(p('other'), p('other'), 100)).toBe('Outstation');
    expect(serviceName(p('other'), p('other'), 10)).toBe('Local');
    expect(serviceName(p('other'), p('other'), 10, 'Local Rental')).toBe('Rental');
    expect(serviceName(p('other'), p('other'), 10, 'Airport Taxi')).toBe('Airport');
  });
});

describe('coupons', () => {
  const base: Coupon = {
    id: 'c1',
    code: 'SAVE50',
    name: 'Save 50',
    description: '',
    discountType: 'FIXED_AMOUNT',
    discountValue: 50,
    maximumDiscount: 0,
    minimumBookingAmount: 0,
    validFrom: '',
    validUntil: '',
    firstBookingOnly: false,
    vehicleCategoryIds: [],
    serviceNames: [],
    totalUsageLimit: 0,
    usedCount: 0,
    perCustomerLimit: 0,
    status: 'Active',
    adminBookingOnly: false,
  };
  const ctx: CouponContext = { subtotal: 400, categoryId: 'sedan', service: 'Local', isFirstBooking: false, customerUses: 0 };

  it('applies a valid code case-insensitively', () => {
    const r = validateCoupon([base], ' save50 ', ctx);
    expect(r.ok && r.coupon.discount).toBe(50);
  });
  it('caps percentage discounts', () => {
    const r = validateCoupon([{ ...base, discountType: 'PERCENTAGE', discountValue: 50, maximumDiscount: 100 }], 'SAVE50', ctx);
    expect(r.ok && r.coupon.discount).toBe(100);
  });
  it('rejects expired, exhausted, first-ride-only and admin-only codes', () => {
    expect(validateCoupon([{ ...base, validUntil: '2000-01-01' }], 'SAVE50', ctx).ok).toBe(false);
    expect(validateCoupon([{ ...base, totalUsageLimit: 5, usedCount: 5 }], 'SAVE50', ctx).ok).toBe(false);
    expect(validateCoupon([{ ...base, firstBookingOnly: true }], 'SAVE50', ctx).ok).toBe(false);
    expect(validateCoupon([{ ...base, adminBookingOnly: true }], 'SAVE50', ctx).ok).toBe(false);
    expect(validateCoupon([{ ...base, perCustomerLimit: 1 }], 'SAVE50', { ...ctx, customerUses: 1 }).ok).toBe(false);
    expect(validateCoupon([{ ...base, minimumBookingAmount: 500 }], 'SAVE50', ctx).ok).toBe(false);
    expect(validateCoupon([{ ...base, vehicleCategoryIds: ['suv'] }], 'SAVE50', ctx).ok).toBe(false);
  });
  it('rejects unknown codes and blank input', () => {
    expect(validateCoupon([base], 'NOPE', ctx).ok).toBe(false);
    expect(validateCoupon([base], '   ', ctx).ok).toBe(false);
  });
  it('lists only live coupons as offers', () => {
    expect(isCouponLive(base)).toBe(true);
    expect(isCouponLive({ ...base, status: 'Inactive' })).toBe(false);
    expect(isCouponLive({ ...base, adminBookingOnly: true })).toBe(false);
  });
});

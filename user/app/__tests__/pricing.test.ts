import { isCouponLive, isNightTime, serviceName, validateCoupon, type CouponContext } from '../src/services/pricingService';
import type { Coupon, GeoPlace } from '../src/types';

const noon = new Date(2026, 8, 28, 12, 0);
const night = new Date(2026, 8, 28, 23, 0);

describe('isNightTime', () => {
  it('is the 22:00 to 06:00 window', () => {
    expect(isNightTime(night)).toBe(true);
    expect(isNightTime(noon)).toBe(false);
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

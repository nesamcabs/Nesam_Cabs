import { escapeHtml, formatINR, formatPhone, isValidEmail, isValidIndianMobile, isValidName, localMobile, num, toDate } from '../src/utils/format';
import { haversineKm, isValidLatLng } from '../src/utils/geo';
import { payableAmount, receiptHtml, upiLink } from '../src/components/TripReceipt';
import { mapBooking } from '../src/services/rideService';

jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));

describe('validators', () => {
  it('accepts Indian mobiles only', () => {
    expect(isValidIndianMobile('9876543210')).toBe(true);
    expect(isValidIndianMobile('5876543210')).toBe(false);
    expect(isValidIndianMobile('98765')).toBe(false);
    expect(localMobile('+91 98765 43210')).toBe('9876543210');
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
  });
  it('validates names including Tamil and Hindi script', () => {
    expect(isValidName('Priya Raman')).toBe(true);
    expect(isValidName('பிரியா')).toBe(true);
    expect(isValidName('प्रिया')).toBe(true);
    expect(isValidName('A')).toBe(false);
    expect(isValidName('Robert<script>')).toBe(false);
    expect(isValidName('   ')).toBe(false);
  });
  it('validates emails', () => {
    expect(isValidEmail('a@b.in')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail(' a@b.com ')).toBe(true);
  });
  it('parses numbers and dates defensively', () => {
    expect(num('₹1,250')).toBe(1250);
    expect(num(undefined, 7)).toBe(7);
    expect(toDate('not a date')).toBeNull();
    expect(toDate({ toDate: () => new Date(0) })?.getTime()).toBe(0);
  });
  it('formats rupees', () => {
    expect(formatINR(125000.4)).toBe('₹1,25,000');
  });
});

describe('geo', () => {
  it('computes haversine distance', () => {
    expect(haversineKm({ lat: 10, lng: 77 }, { lat: 10, lng: 78 })).toBeCloseTo(109.5, 0);
  });
  it('rejects null-island and out-of-range coordinates', () => {
    expect(isValidLatLng({ lat: 0, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: NaN, lng: 77 })).toBe(false);
    expect(isValidLatLng({ lat: 10, lng: 77 })).toBe(true);
  });
});

describe('receipt', () => {
  const t = mapBooking('b1', {
    bookingId: 'NT260928-AAAAA',
    fare: 500,
    tollCharges: 120,
    pickup: '<b>x</b>',
    drop: 'Madurai',
    status: 'Completed',
    paymentMethod: 'UPI',
  });
  it('adds tolls to the payable amount', () => {
    expect(payableAmount(t)).toBe(620);
  });
  it('escapes every interpolated value', () => {
    expect(escapeHtml('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
    expect(receiptHtml(t, 'Evil <img src=x>')).not.toContain('<img src=x>');
    expect(receiptHtml(t, 'x')).not.toContain('<b>x</b>');
  });
  it('builds a UPI deep link with the amount', () => {
    expect(upiLink(t)).toContain('am=620.00');
  });
});

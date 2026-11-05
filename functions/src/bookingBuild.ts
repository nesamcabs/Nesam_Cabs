// Shared pieces of booking creation (customer and admin): contact validation,
// pickup/drop resolution from a map pin, and the marketplace offer document.
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { GeoPlace, RideCategory } from './domain/types';
import { AdminDiscountInput } from './domain/pricing';
import { inIndia, text } from './shared';

export interface WhatsappContact {
  countryCode: string;
  number: string;
  e164: string;
  sameAsMobile: boolean;
}

/** E.164 for an Indian mobile number given as 9876543210, 919876543210 or +919876543210. */
export function indianPhone(v: unknown): string {
  const digits = String(v ?? '').replace(/[\s()-]/g, '').replace(/^\+?91(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(digits)) throw new HttpsError('invalid-argument', 'Enter a valid 10-digit Indian mobile number.');
  return `+91${digits}`;
}

/**
 * The customer's WhatsApp number: either "same as mobile" or a country code
 * plus national number. Indian numbers get the strict mobile check; other
 * countries accept 6–14 digits (E.164 allows 15 in total).
 */
export function whatsappContact(input: unknown, mobileE164: string): WhatsappContact {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (v.sameAsMobile === true || (!v.number && !v.countryCode)) {
    const national = mobileE164.replace(/^\+91/, '');
    return { countryCode: '+91', number: national, e164: mobileE164, sameAsMobile: true };
  }
  const cc = String(v.countryCode ?? '').trim();
  if (!/^\+[1-9]\d{0,2}$/.test(cc)) throw new HttpsError('invalid-argument', 'Enter the WhatsApp country code, for example +91.');
  const number = String(v.number ?? '').replace(/[\s()-]/g, '');
  if (!/^\d+$/.test(number)) throw new HttpsError('invalid-argument', 'The WhatsApp number can contain digits only.');
  if (cc === '+91') {
    if (!/^[6-9]\d{9}$/.test(number)) throw new HttpsError('invalid-argument', 'Enter a valid 10-digit WhatsApp number.');
  } else if (number.length < 6 || number.length > 14 || cc.length - 1 + number.length > 15) {
    throw new HttpsError('invalid-argument', 'Enter a valid WhatsApp number for that country code.');
  }
  return { countryCode: cc, number, e164: `${cc}${number}`, sameAsMobile: false };
}

/** Email is optional; the format is checked only when something is entered. */
export function optionalEmail(v: unknown): string {
  const e = text(v, 120).toLowerCase();
  if (!e) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new HttpsError('invalid-argument', 'Enter a valid email address or leave it blank.');
  return e;
}

/** An admin discount: percentage or fixed amount, one at a time. */
export function adminDiscountOf(v: unknown): AdminDiscountInput | null {
  if (v == null) return null;
  const d = v as Record<string, unknown>;
  if (d.type !== 'percentage' && d.type !== 'fixed') throw new HttpsError('invalid-argument', 'Choose a percentage or a fixed-amount discount.');
  const value = d.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new HttpsError('invalid-argument', 'Enter a discount greater than zero.');
  if (d.type === 'percentage' && value > 100) throw new HttpsError('invalid-argument', 'A percentage discount cannot exceed 100%.');
  if (d.type === 'fixed' && (!Number.isSafeInteger(value) || value > 1000000)) throw new HttpsError('invalid-argument', 'Enter the fixed discount in whole rupees.');
  return { type: d.type, value, reason: text(d.reason, 200) };
}

/** A pin dropped on the map: coordinates and the address reverse-geocoded by the admin's browser. */
export function pinPlace(v: unknown, role: 'pickup' | 'drop'): GeoPlace | null {
  if (v == null) return null;
  const p = v as Record<string, unknown>;
  const label = role === 'pickup' ? 'Pickup' : 'Drop';
  if (!inIndia(p.lat, p.lng)) throw new HttpsError('invalid-argument', `${label} location must be a point in India.`);
  const address = text(p.address, 300);
  if (address.length < 3) throw new HttpsError('invalid-argument', `Add the ${role} address for the selected map point.`);
  // Short name: the part of the address before the first comma.
  const name = text(p.name, 120) || address.split(',')[0].trim().slice(0, 120);
  return { id: 'pin', name, address, lat: p.lat as number, lng: p.lng as number, type: p.type === 'airport' ? 'airport' : 'other' };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What a driver or vendor may see before a trip is theirs: the area, the
 * time, the vehicle type, the distance and the payout — not the exact
 * address or coordinates, and never the customer's contact details.
 */
export function marketplaceOffer(args: {
  id: string; bookingCode: string; pickup: GeoPlace; drop: GeoPlace; time: string; date: string; service: string; tripType: string;
  category: RideCategory; distanceKm: number; offeredPayout: number; pickupAt: Date; status: string;
}) {
  const { pickup, drop } = args;
  return {
    id: args.id, bookingId: args.bookingCode, route: `${pickup.name} → ${drop.name}`,
    pickup: { address: pickup.name, city: pickup.name, lat: round2(pickup.lat), lng: round2(pickup.lng), time: args.time },
    drop: { address: drop.name, city: drop.name, lat: round2(drop.lat), lng: round2(drop.lng) },
    travelDate: args.date, pickupAt: args.pickupAt, service: args.service, tripType: args.tripType,
    vehicleCategory: args.category.name, vehicleCategoryId: args.category.id,
    // Lower-case aliases the claim rules compare a driver's vehicle type against.
    eligibleVehicleTypes: args.category.matchVehicleTypes,
    distanceKm: args.distanceKm, offeredPayout: args.offeredPayout,
    // Hidden from partners until an admin approves the booking.
    status: args.status, createdAt: FieldValue.serverTimestamp(),
  };
}

export const AWAITING_APPROVAL = 'Awaiting Approval';

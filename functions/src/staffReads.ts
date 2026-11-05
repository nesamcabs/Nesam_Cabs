// Bookings for staff who may not see partner payouts or company margin.
//
// A booking document carries the partner payout, the commission and the finance snapshot, and
// Firestore rules cannot hide single fields of a readable document. So the rules refuse direct
// booking (and marketplace) reads to staff without the "Vendor payout / company margin" right
// (staffFlag('sensitive', 'vendorPayout')), and this function serves them the same bookings with
// those fields removed. Partners, customers and staff holding the right keep their direct reads.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { DocumentData, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { AdminAccess, StaffModule, matrixAllows, matrixFlag } from './permissions';
import { requireAdmin, text } from './shared';

/** Top-level booking fields that carry a partner payout or let the company margin be derived. */
export const PAYOUT_FIELDS = [
  'finance', 'commission', 'commissionAmount', 'vendorPayout', 'driverPayout', 'offeredPayout', 'payout', 'payoutSource',
  'partnerPayout', 'payoutSummary', 'missingPayout', 'platformRevenue', 'agreedPayout',
] as const;
/** Raw contact fields older bookings may still hold (newer ones keep them in booking_contacts). */
const CONTACT_FIELDS = ['phone', 'customerPhone', 'customerEmail', 'customerWhatsapp'] as const;
/** Pages that list or join bookings; a View on any of them is enough to receive them. */
const READ_MODULES: StaffModule[] = [
  'Bookings', 'Customers', 'Support', 'Reports & GST', 'Invoices', 'Partners & Fleet', 'Driver Partners', 'Vendors',
  'Vendor Drivers', 'Vehicles', 'Business accounts', 'Penalties',
];
/** Newest bookings returned per call (the admin lists poll this). */
const LIST_LIMIT = 1000;

export const canSeePayouts = (a: AdminAccess) => a.isSuper || matrixFlag(a.matrix, 'sensitive', 'vendorPayout');

export function redactBooking(d: DocumentData, admin: AdminAccess): DocumentData {
  const out: DocumentData = { ...d };
  if (!canSeePayouts(admin)) {
    for (const k of PAYOUT_FIELDS) delete out[k];
    // The pricing snapshot keeps the customer side; the partner rate block goes.
    if (out.pricing && typeof out.pricing === 'object') {
      out.pricing = { ...out.pricing, partner: null };
      // The partner side of the extra-charge rates is payout data too.
      const x = out.pricing.extraCharges;
      if (x && typeof x === 'object') out.pricing = { ...out.pricing, extraCharges: { ...x, partner: {} } };
    }
  }
  // A Staff ID never receives raw customer contacts (getCustomerContact reveals them one at a time).
  if (admin.kind === 'staff') for (const k of CONTACT_FIELDS) delete out[k];
  return out;
}

/** Timestamps travel as { __ts: millis } so the admin can rebuild them; everything else as JSON. */
function encode(v: unknown, depth = 0): unknown {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (v === null || typeof v !== 'object' || depth > 8) return v;
  if (Array.isArray(v)) return v.map((x) => encode(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, encode(x, depth + 1)]));
}

export const getStaffBookings = onCall({ timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
  const admin = await requireAdmin(request.auth);
  if (!admin.isSuper && !READ_MODULES.some((m) => matrixAllows(admin.matrix, m, 'view'))) {
    throw new HttpsError('permission-denied', 'Your access does not include bookings.');
  }
  const redacted = !canSeePayouts(admin);
  const bookingId = text(request.data?.bookingId, 128);
  if (bookingId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(bookingId)) throw new HttpsError('invalid-argument', 'Invalid booking.');
    const snap = await db.doc(`bookings/${bookingId}`).get();
    return { booking: snap.exists ? encode({ ...redactBooking(snap.data()!, admin), id: snap.id }) : null, redacted };
  }
  const snap = await db.collection('bookings').orderBy('createdAt', 'desc').limit(LIST_LIMIT).get();
  return {
    bookings: snap.docs.map((d) => encode({ ...redactBooking(d.data(), admin), id: d.id })),
    truncated: snap.size === LIST_LIMIT,
    redacted,
  };
});

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomInt } from 'crypto';
import { db } from './admin';
import { approved, requireAction, requirePermission, text } from './shared';
import { indianPhone } from './bookingBuild';
import { multicityFingerprint } from './domain/multicitySnapshot';
import { DEFAULT_ADMIN_MAX_ADVANCE_DAYS, bookingWindowFrom, pickupWindowProblem } from './domain/advanceBooking';
import { nextBookingCode } from './bookingSequence';
import { createContactInTx, maskPhone } from './contacts';
import { storePricingInTx } from './pricingPrivate';
import { auditInTx } from './audit';
import { summarizePayments } from './domain/bookingFlow';
import { assertCashAllowed } from './channelPolicy';
import { formatDate, formatTime12 } from './domain/time';
import { dutyClassOf } from './domain/eligibility';
import { assertBookable, assertWithinLimits, availabilityFields, evaluateRules, loadServiceRules } from './serviceRules';
import { mailNewBooking } from './commerce';
import type { PricingSnapshot } from './domain/tariff';
import { notifyInTx, pushAfterCommit, type NotifyInput } from './notify';
import { tariffClassOf } from './quote';

/** Only a server-created, unexpired quote can be converted. One enquiry -> one booking atomically. */
export const convertMulticityEnquiry = onCall(async request => {
  const actor = await requirePermission(request.auth, 'operations');
  requireAction(actor, 'Bookings', 'create');
  const input = request.data ?? {};
  const enquiryId = text(input.enquiryId, 40), revision = text(input.expectedRevision, 100);
  if (!/^NSM-QT-\d{6}$/.test(enquiryId) || !/^[A-Za-z0-9_-]{1,100}$/.test(revision)) throw new HttpsError('invalid-argument', 'Refresh the enquiry and choose its saved quote.');
  const name = text(input.customerName, 80), phone = indianPhone(input.phone);
  const reference = text(input.acceptanceReference, 300);
  if (name.length < 2 || input.customerAccepted !== true || reference.length < 5) throw new HttpsError('invalid-argument', 'Record the customer name and their agreement to this quote and booking terms, with a reference.');
  const paymentMethod = input.paymentMethod;
  if (paymentMethod !== 'Cash' && paymentMethod !== 'UPI') throw new HttpsError('invalid-argument', 'Choose Cash or UPI paid to the driver.');
  await assertCashAllowed(paymentMethod);
  const rules = await loadServiceRules();
  const pushes: { id: string; input: NotifyInput }[] = [];
  const enquiryRef = db.doc(`enquiries/${enquiryId}`), bookingRef = db.doc(`bookings/multicity_${enquiryId}`);
  const result = await db.runTransaction(async tx => {
    pushes.length = 0;
    const [enquiry, previous, saved] = await Promise.all([tx.get(enquiryRef), tx.get(bookingRef), tx.get(db.doc(`multicity_quote_snapshots/${revision}`))]);
    const e = enquiry.data(), quote = saved.data();
    if (!e) throw new HttpsError('not-found', 'The enquiry no longer exists.');
    if (previous.exists && e.status === 'Converted' && e.convertedBookingId === bookingRef.id) return { id: bookingRef.id, bookingId: previous.data()!.bookingId, created: false };
    if (previous.exists || ['Converted', 'Closed', 'Expired'].includes(e.status)) throw new HttpsError('failed-precondition', 'This enquiry is closed or already converted.');
    if (!quote || quote.enquiryId !== enquiryId || e.quoteRevision !== revision || quote.fingerprint !== multicityFingerprint(e) || e.categoryId !== quote.categoryId || e.estimate !== quote.estimate) throw new HttpsError('failed-precondition', 'The quote or itinerary changed. Reprice it and review the new quote.');
    if (quote.validUntil.toMillis() <= Date.now()) throw new HttpsError('failed-precondition', 'This quote expired. Save a fresh quote before conversion.');
    const [category, customer, config] = await Promise.all([
      tx.get(db.doc(`vehicle_categories/${quote.categoryId}`)),
      quote.customerId ? tx.get(db.doc(`customers/${quote.customerId}`)) : Promise.resolve(null),
      tx.get(db.doc('settings/operations')),
    ]);
    const cat = category.data();
    if (!cat || cat.status !== 'Active' || cat.adminBookingEnabled === false) throw new HttpsError('failed-precondition', 'The quoted vehicle category is no longer bookable.');
    const seats = cat.seats ?? cat.seatingCapacity;
    if (!Number.isInteger(seats) || seats < 1) throw new HttpsError('failed-precondition', 'Set the quoted vehicle category’s passenger seating capacity before conversion.');
    if (customer && (!customer.exists || !approved(customer.data()!.status))) throw new HttpsError('failed-precondition', 'The customer account is not active.');
    const when = quote.pickupAt.toDate();
    const configuredWindow = bookingWindowFrom(config.data());
    const problem = pickupWindowProblem(when, new Date(), { ...configuredWindow, maxAdvanceDays: Math.max(configuredWindow.maxAdvanceDays, DEFAULT_ADMIN_MAX_ADVANCE_DAYS) });
    if (problem) throw new HttpsError('failed-precondition', problem);
    const pricing = quote.pricing as PricingSnapshot;
    if (tariffClassOf(cat) !== pricing.tariffClass) throw new HttpsError('failed-precondition', 'The category mapping changed. Save a fresh quote before conversion.');
    const points = quote.points as Array<{ id: string; name: string; address: string; lat: number; lng: number; type?: string }>;
    const availability: Record<string, unknown> = {};
    for (let i = 1; i < points.length; i++) {
      const outcome = evaluateRules(rules, points[i - 1] as any, points[i] as any, when, 'Multicity', quote.brand, 'Multicity');
      assertBookable(outcome, cat.name);
      Object.assign(availability, availabilityFields(outcome));
      assertWithinLimits(outcome, { categoryName: cat.name, customerFare: quote.fare.total, partnerPayout: pricing.partner ? pricing.partner.basePaise / 100 : null });
    }
    // Last read: the booking sequence is advanced together with the booking and enquiry.
    const bookingCode = await nextBookingCode(tx, new Date());
    const customerId = quote.customerId || '', pickup = points[0], drop = points[points.length - 1];
    const stamp = FieldValue.serverTimestamp(), paymentSummary = summarizePayments(quote.fare.total, []);
    const publicPricing = storePricingInTx(tx, bookingRef.id, customerId, pricing);
    tx.create(bookingRef, {
      id: bookingRef.id, bookingId: bookingCode, customerId, customer: name, phoneMasked: maskPhone(phone),
      pickup: pickup.name, pickupAddress: pickup.address, pickupLat: pickup.lat, pickupLng: pickup.lng, pickupLatitude: pickup.lat, pickupLongitude: pickup.lng, pickupType: pickup.type || 'other', pickupSource: 'enquiry_quote',
      drop: drop.name, dropAddress: drop.address, dropLat: drop.lat, dropLng: drop.lng, dropType: drop.type || 'other', dropSource: 'enquiry_quote',
      // Calendar-tour lifecycle/billing remains compatible with existing Round Trip dispatch and settlement.
      tripType: 'Round Trip', tourType: 'Multicity', service: 'Multicity', serviceId: 'multicity', itinerary: points, stops: quote.stops,
      vehicle: cat.name, vehicleCategory: cat.name, vehicleCategoryId: quote.categoryId, passengerSeatsRequired: seats,
      dutyClass: dutyClassOf(cat) || '', tariffClass: pricing.tariffClass || '',
      fare: quote.fare.total, fareBreakdown: quote.fare, fareBreakup: quote.breakup, pricing: publicPricing, fareVerified: true,
      distanceKm: quote.fare.distanceKm, durationMin: quote.fare.durationMin, billableDays: pricing.days,
      scheduledAt: quote.pickupAt, pickupAt: quote.pickupAt, tripEndAt: quote.tripEndAt, endDate: pricing.endDate,
      date: formatDate(when), time: formatTime12(when), rideTiming: 'scheduled', bookingType: 'advance', status: 'Pending', tripSubStatus: 'Not Started',
      source: quote.brand === 'nesam' ? 'admin' : quote.brand, brand: quote.brand, bookingSource: quote.brand, ...availability,
      paymentMethod, payment: 'Pending', paymentStatus: paymentSummary.status, paymentSummary: { ...paymentSummary, updatedAt: Timestamp.now() },
      enquiryId, quoteRevision: revision, notes: ['Multicity itinerary: ' + points.map(p => p.name + (p.address !== p.name ? ` (${p.address})` : '')).join(' → '), text(e.note, 1000)].filter(Boolean).join('\n'),
      termsAcceptance: { acceptedBy: 'customer', recordedBy: actor.uid, recordedByName: actor.name, reference, quoteRevision: revision, at: Timestamp.now() },
      createdBy: actor.uid, createdByName: actor.name, createdAt: stamp, updatedAt: stamp,
    });
    tx.create(db.doc(`booking_secrets/${bookingRef.id}`), { customerId, otp: String(randomInt(1000, 10000)), createdAt: stamp });
    createContactInTx(tx, bookingRef.id, { customerId, name, phone, email: text(customer?.data()?.email) });
    tx.create(bookingRef.collection('events').doc(), { type: 'created', actorId: actor.uid, actorRole: 'admin', at: stamp });
    tx.update(enquiryRef, { status: 'Converted', convertedBookingId: bookingRef.id, convertedBookingCode: bookingCode, convertedAt: stamp,
      history: FieldValue.arrayUnion({ status: 'Converted', note: bookingCode, byName: actor.name, at: Timestamp.now() }) });
    auditInTx(tx, { action: 'multicity_quote_converted', entity: 'booking', entityId: bookingRef.id, performedBy: actor.uid, performedByName: actor.name, role: 'admin', bookingId: bookingRef.id, next: { enquiryId, quoteRevision: revision, fare: quote.fare.total, bookingCode } });
    const notice: NotifyInput = { recipientType: 'admin', recipientId: 'admin', category: 'bookings', severity: 'info', sound: 'new_booking', title: 'Multicity booking to review', message: `${bookingCode} · ${name} · ${pickup.name} → ${drop.name}`, bookingId: bookingRef.id, bookingCode, push: true, sentBy: actor.uid, cta: { label: 'Review booking', page: 'booking-detail', bookingId: bookingRef.id } };
    pushes.push({ id: notifyInTx(tx, notice), input: notice });
    return { id: bookingRef.id, bookingId: bookingCode, created: true };
  });
  await pushAfterCommit(pushes);
  if (result.created) await mailNewBooking(result.id, false);
  return { id: result.id, bookingId: result.bookingId };
});

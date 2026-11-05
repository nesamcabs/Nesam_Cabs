import { fareBoardingState, recipientAddressState, recipientGstState } from './fareGstContext';
import { fareServiceKey } from './fareScope';
// Admin (phone / walk-in) bookings. Priced by the same server fare engine as
// customer bookings. The admin never types the base fare: it is calculated from
// the vehicle category, route, global adjustment and an optional discount. The
// only way to charge a different amount is an explicit, reasoned override that
// needs finance access and is stored with the booking and audited.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomInt } from 'crypto';
import { db } from './admin';
import { auditInTx } from './audit';
import { adminDiscountOf, optionalEmail, pinPlace, indianPhone, whatsappContact } from './bookingBuild';
import { DEFAULT_ADMIN_MAX_ADVANCE_DAYS, bookingWindowFrom, parsePickupInstant, pickupWindowProblem } from './domain/advanceBooking';
import { AWAITING_APPROVAL } from './bookingBuild';
import { MANUAL_PAYMENT_METHODS as PAYMENT_METHODS, summarizePayments } from './domain/bookingFlow';
import { dutyClassOf } from './domain/eligibility';
import { applyFareOverride, isOutstation, mapCategory, mapCoupon, normalizeCode, serviceName, validateCoupon } from './domain/pricing';
import { COMMISSION_NOT_CONFIGURED, buildFinanceSnapshot, partnerPayoutFor, resolveCommission } from './domain/finance';
import { distanceKm } from './domain/verification';
import { formatDate, formatDateTime12, formatTime12 } from './domain/time';
import { FareBreakdown, GeoPlace, TripType } from './domain/types';
import { effectiveAdjustment, loadFareAdjustment } from './fareConfig';
import { adjustPartner, assertBookable, assertWithinLimits, availabilityFields, evaluateRules, loadServiceRules, partnerPayoutRupees, ruleServiceText } from './serviceRules';
import { loadCommissionPolicy } from './commission';
import { createContactInTx, maskPhone } from './contacts';
import { loadFixedRoutes, loadTariffConfig, priceBooking, rentalHoursOf, sharedCityId, tariffClassOf } from './quote';
import { notifyInTx, pushAfterCommit, NotifyInput } from './notify';
import { nextBookingCode } from './bookingSequence';
import { businessContract, availableBusinessCredit } from './domain/business';
import { assertCashAllowed } from './channelPolicy';
import { supportsTrip, serviceAllowsCategory, matchAuthoritativeService, ServiceMasterDoc } from './onlineCatalog';
import { NO_BOOKABLE_CATEGORIES, approved, inIndia, requestIdOf, requirePermission, routeFor, text, requireAction, requireStaffFlag } from './shared';
import { canSeePayouts } from './staffReads';
import { storePricingInTx } from './pricingPrivate';
import { mailNewBooking } from './commerce';
import { assertServiceSupported, resolveAndValidateBrand } from './brandContext';

const MAX_FARE = 1000000;

function overrideOf(v: any, calculatedTotal: number | null): { fare: number; reason: string } | null {
  if (v == null) return null;
  const fare = v.fare;
  const reason = text(v.reason, 300);
  if (!Number.isSafeInteger(fare) || fare < 1 || fare > MAX_FARE) throw new HttpsError('invalid-argument', 'Enter the override fare as a whole rupee amount.');
  if (reason.length < 10) throw new HttpsError('invalid-argument', 'Give a reason of at least 10 characters for the fare override.');
  if (calculatedTotal !== null && fare === calculatedTotal) throw new HttpsError('invalid-argument', 'The override fare is the same as the calculated fare.');
  return { fare, reason };
}

async function locationPlace(id: unknown, role: 'pickup' | 'drop'): Promise<GeoPlace> {
  const label = role === 'pickup' ? 'Pickup' : 'Drop';
  if (typeof id !== 'string' || !id) throw new HttpsError('invalid-argument', `Choose the ${role} location or drop a pin on the map.`);
  const snap = await db.doc(`locations/${id}`).get();
  const l = snap.data();
  if (!snap.exists || !l || l.status !== 'Active') throw new HttpsError('failed-precondition', `${label} location is not active.`);
  if (l.adminBookingEnabled === false || (role === 'pickup' ? l.pickupEnabled === false : l.dropEnabled === false)) {
    throw new HttpsError('failed-precondition', `${text(l.name)} is not enabled for admin ${role}s.`);
  }
  if (!inIndia(l.lat, l.lng)) throw new HttpsError('failed-precondition', `${text(l.name)} has no map coordinates. Add them in Locations to price trips from it.`);
  // city / area / state let the service rules match a master location exactly (they are not stored on the booking).
  return { id, name: text(l.name, 120), address: text(l.address) || text(l.city), lat: l.lat, lng: l.lng, type: l.type === 'Airport' ? 'airport' : 'other', city: text(l.city, 80), area: text(l.area, 80), state: text(l.state, 80) } as GeoPlace;
}

/** A map pin wins; otherwise the chosen master location. */
async function resolvePlace(input: any, role: 'pickup' | 'drop'): Promise<{ place: GeoPlace; source: 'map_pin' | 'master' }> {
  const pin = pinPlace(input[`${role}Point`], role);
  if (pin) return { place: pin, source: 'map_pin' };
  return { place: await locationPlace(input[`${role}LocationId`], role), source: 'master' };
}

export const createAdminBooking = onCall({ timeoutSeconds: 60 }, async (request) => {
  const input = request.data ?? {};
  const admin = await requirePermission(request.auth, 'operations');
  requireAction(admin, 'Bookings', 'create');
  // Charging a different amount than the calculated fare is a finance decision.
  if (input.override != null && !admin.permissions.includes('finance')) {
    throw new HttpsError('permission-denied', 'Your role does not include finance access, which a fare override requires.');
  }
  // A discount changes what the customer pays, so it needs finance access too.
  if (input.discount != null && !admin.permissions.includes('finance') && !admin.permissions.includes('pricing')) {
    throw new HttpsError('permission-denied', 'Giving a discount needs pricing or finance access.');
  }
  // A coupon is validated and priced here, never taken from the office's screen.
  const couponCode = normalizeCode(text(input.couponCode, 50));
  if (couponCode) {
    requireStaffFlag(admin, 'partnerRights', 'applyCoupon', 'Apply coupon to booking');
    if (input.discount != null) throw new HttpsError('invalid-argument', 'A booking takes either a coupon or a manual discount, not both.');
  }
  const requestId = requestIdOf(input.requestId);
  const ref = db.doc(`bookings/${requestId}`);
  const existing = await ref.get();
  if (existing.exists) {
    if (existing.data()!.createdBy !== admin.uid) throw new HttpsError('permission-denied', 'Request already used.');
    return { id: requestId, bookingId: existing.data()!.bookingId, fare: existing.data()!.fare };
  }

  // Quick fare: the office gives the estimate before collecting any customer details, so a
  // quote-only request needs no name, mobile or payment method. Nothing is written for a quote.
  const quoteOnly = input.quoteOnly === true;
  if (input.tripType === 'Multicity' || input.serviceId === 'multicity' || (Array.isArray(input.stops) && input.stops.length)) {
    throw new HttpsError('failed-precondition', 'Multicity itineraries cannot be priced or converted using the standard pickup/drop booking flow.');
  }
  const enquiryCode = text(input.enquiryId, 40);
  if (enquiryCode) {
    if (!/^NSM-QT-\d{6}$/.test(enquiryCode)) throw new HttpsError('invalid-argument', 'Invalid enquiry reference.');
    const enquiry = (await db.doc(`enquiries/${enquiryCode}`).get()).data();
    if (!enquiry) throw new HttpsError('not-found', 'The enquiry no longer exists.');
    if (enquiry.serviceId === 'multicity' || enquiry.service === 'Multicity' || enquiry.tripType === 'Multicity' || enquiry.stops?.length) {
      throw new HttpsError('failed-precondition', 'Keep this Multicity enquiry with the travel desk. Standard conversion would discard its itinerary and reviewed tour fare.');
    }
  }
  const name = text(input.customerName, 80);
  if (!quoteOnly && name.length < 2) throw new HttpsError('invalid-argument', 'Enter the customer name.');
  const phone = quoteOnly && !input.customerPhone ? '' : indianPhone(input.customerPhone);
  const whatsapp = quoteOnly && !phone ? null : whatsappContact(input.customerWhatsapp, phone);
  const email = quoteOnly ? '' : optionalEmail(input.customerEmail);
  const paymentMethod = PAYMENT_METHODS.includes(input.paymentMethod) ? input.paymentMethod : null;
  if (!paymentMethod && !quoteOnly) throw new HttpsError('invalid-argument', `Choose how the customer will pay: ${PAYMENT_METHODS.join(', ')}.`);
  if(!quoteOnly)await assertCashAllowed(paymentMethod);
  const tripType: TripType =
    input.tripType === 'Round Trip'
      ? 'Round Trip'
      : input.tripType === 'Local Rental'
      ? 'Local Rental'
      : input.tripType === 'Airport Taxi'
      ? 'Airport Taxi'
      : 'One Way';
  if (typeof input.categoryId !== 'string' || !input.categoryId) throw new HttpsError('invalid-argument', 'Choose a vehicle category.');
  const discountIn = adminDiscountOf(input.discount);
  // Advance bookings only, for phone and walk-in requests too. The pickup is an
  // unambiguous instant; the horizon is the longer of the customer window and the
  // admin default so call-centre staff can book further ahead.
  const now = new Date();
  const scheduled = parsePickupInstant(input.scheduledAt);
  const customerWindow = bookingWindowFrom((await db.doc('settings/operations').get()).data());
  const adminWindow = { minLeadMinutes: customerWindow.minLeadMinutes, maxAdvanceDays: Math.max(customerWindow.maxAdvanceDays, DEFAULT_ADMIN_MAX_ADVANCE_DAYS) };
  const scheduleProblem = pickupWindowProblem(scheduled, now, adminWindow);
  if (scheduleProblem || !scheduled) throw new HttpsError('invalid-argument', scheduleProblem || 'Choose the pickup date and time.');
  const when = scheduled;
  let tripEndAt: Date | null = null;
  if (tripType === 'Round Trip') {
    tripEndAt = parsePickupInstant(input.tripEndAt);
    if (!tripEndAt) throw new HttpsError('invalid-argument', 'Choose the date and time the round trip ends.');
    if (tripEndAt.getTime() < when.getTime()) throw new HttpsError('invalid-argument', 'The trip cannot end before it starts.');
  }
  const [pickupR, dropR] = await Promise.all([resolvePlace(input, 'pickup'), resolvePlace(input, 'drop')]);
  const pickup = pickupR.place, drop = dropR.place;
  if (distanceKm(pickup, drop) < 0.1) throw new HttpsError('invalid-argument', 'Pickup and drop must be different locations.');
  const pickupDetails = text(input.pickupAddress), dropDetails = text(input.dropAddress);
  pickup.address = pickupR.source === 'map_pin' ? [pickupDetails, pickup.address].filter(Boolean).join(', ') : pickupDetails || pickup.address;
  drop.address = dropR.source === 'map_pin' ? [dropDetails, drop.address].filter(Boolean).join(', ') : dropDetails || drop.address;
  const route = await routeFor(pickup, drop);

  const advanceIn = input.advance && typeof input.advance === 'object' ? input.advance : null;
  if (advanceIn) {
    if (!(PAYMENT_METHODS as readonly string[]).includes(advanceIn.method)) throw new HttpsError('invalid-argument', 'Choose the advance payment method.');
    if (typeof advanceIn.amount !== 'number' || !(advanceIn.amount > 0) || advanceIn.amount > MAX_FARE) throw new HttpsError('invalid-argument', 'Enter the advance amount.');
    if (advanceIn.method !== 'Cash' && text(advanceIn.reference, 120).length < 4) throw new HttpsError('invalid-argument', `Enter the ${advanceIn.method === 'UPI' ? 'UPI transaction' : 'transfer'} reference for the advance.`);
  }
  const pushes: { id: string; input: NotifyInput }[] = [];
  const serviceRules = await loadServiceRules();
  const businessId=text(input.businessAccountId,128);
  if(businessId && !/^[A-Za-z0-9_-]{1,128}$/.test(businessId))throw new HttpsError('invalid-argument','Invalid business account.');
  // Master-location places carry canonical ids, so a local trip inside one city can use that city's Local Pickup & Drop fare.
  const localCityId = tripType === 'One Way' && !isOutstation(route.distanceKm) ? await sharedCityId(pickup, drop) : null;
  const rentalHours = tripType === 'Local Rental' ? rentalHoursOf(input.rentalHours) : null;

  const result = await db.runTransaction(async (tx) => {
    pushes.length = 0; // the callback can retry; only the committed attempt may push
    const customerId = typeof input.customerId === 'string' ? input.customerId : '';
    const [couponDocs, customerHistory] = await Promise.all([
      couponCode ? tx.get(db.collection('coupons')) : Promise.resolve(null),
      couponCode && customerId ? tx.get(db.collection('bookings').where('customerId', '==', customerId)) : Promise.resolve(null),
    ]);
    const [previous, categories, serviceSnap, customer, policy, adjustmentDoc, tariff, fixedRoutes, servicesSnap] = await Promise.all([
      tx.get(ref),
      tx.get(db.collection('vehicle_categories').where('status', '==', 'Active')),
      typeof input.serviceId === 'string' && input.serviceId ? tx.get(db.doc(`services/${input.serviceId}`)) : Promise.resolve(null),
      customerId ? tx.get(db.doc(`customers/${customerId}`)) : Promise.resolve(null),
      loadCommissionPolicy(tx),
      loadFareAdjustment(tx),
      loadTariffConfig(tx),
      // Fixed route fares are matched on canonical master-location ids, so a map-pin trip never needs them.
      tripType === 'One Way' && pickupR.source === 'master' && dropR.source === 'master' ? loadFixedRoutes(tx) : Promise.resolve([]),
      tx.get(db.collection('services')),
    ]);
    if (previous.exists) {
      if (previous.data()!.createdBy !== admin.uid) throw new HttpsError('permission-denied', 'Request already used.');
      return { id: requestId, bookingId: previous.data()!.bookingId, fare: previous.data()!.fare };
    }
    if (customer && (!customer.exists || !approved(customer.data()!.status))) throw new HttpsError('failed-precondition', 'The selected customer account is not active.');
    const business=businessId?await tx.get(db.doc(`business_accounts/${businessId}`)):null;
    if(business && (!business.exists || business.data()!.status!=='Active'))throw new HttpsError('failed-precondition','The selected business account is inactive or on hold.');
    const companyPays=!!business && input.businessBilledTo!=='Passenger pays';
    const businessBookings=companyPays?await tx.get(db.collection('bookings').where('businessAccountId','==',businessId)):null;
    const businessReceipts=companyPays?await tx.get(db.collection(`business_accounts/${businessId}/payments`)):null;
    const configured = categories.docs.map((d) => {
      const c = mapCategory(d.id, d.data());
      return c ? { ...c, tariffClass: d.data().tariffClass, dutyClass: d.data().dutyClass } : null;
    }).filter((c): c is NonNullable<typeof c> => c !== null);
    if (!configured.length) throw new HttpsError('failed-precondition', NO_BOOKABLE_CATEGORIES);
    const category = configured.find((c) => c.id === input.categoryId);
    if (!category) throw new HttpsError('failed-precondition', 'This vehicle category is not bookable (inactive or no per-km rate).');
    let service = serviceName(pickup, drop, route.distanceKm, tripType), serviceId = '';
    const allServices: ServiceMasterDoc[] = servicesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    if (serviceSnap) {
      if (!serviceSnap.exists || serviceSnap.data()!.status !== 'Active') throw new HttpsError('failed-precondition', 'The selected service is not active.');
      if (serviceSnap.data()!.adminBookingEnabled === false) throw new HttpsError('failed-precondition', 'The selected service is not enabled for admin bookings.');
      if(!supportsTrip(serviceSnap.data()!,tripType)||!serviceAllowsCategory(serviceSnap.data()!,category.id))throw new HttpsError('failed-precondition','The selected service does not allow this trip type or vehicle category.');
      service = text(serviceSnap.data()!.name, 120) || service;
      serviceId = serviceSnap.id;
    } else {
      const matched = matchAuthoritativeService(allServices, {
        tripType,
        categoryId: category.id,
        distanceKm: route.distanceKm,
        pickupType: pickup.type,
        dropType: drop.type,
        context: 'admin',
      });
      if (matched) {
        service = matched.name || service;
        serviceId = matched.id;
      }
    }

    const rawChan = text(input.bookingSource || input.source || input.brand || input.channel || '');
    const bookingChannel = resolveAndValidateBrand({ brand: rawChan }, request, true);
    assertServiceSupported(bookingChannel, tripType);

    const rules = evaluateRules(serviceRules, pickup, drop, when, ruleServiceText(pickup, drop, route.distanceKm, tripType, service), bookingChannel, fareServiceKey(tripType));
    assertBookable(rules, category.name);
    const adjustment = rules.customer ?? effectiveAdjustment(adjustmentDoc, now);
    let contract: ReturnType<typeof businessContract> = null;
    try { contract=business?businessContract(business.data()!,{pickup,drop,service,tripType,category:category.name,km:route.distanceKm*(tripType==='Round Trip'?2:1)}):null; }
    catch(e){throw new HttpsError('failed-precondition',(e as Error).message);}


    const boardingState = await fareBoardingState(tariff, pickup);
    const recipientState = recipientGstState(business?.data() ?? customer?.data());
    const priceInput = { boardingState, recipientState, recipientAddressState: recipientAddressState(business?.data() ?? customer?.data()), category, route, tripType, pickup, drop, pickupAt: when, tripEndAt, tariff, adjustment, adminDiscount: discountIn, localCityId, rentalHours, fixedRoutes, serviceId, businessContract:contract, brand: bookingChannel };
    // Coupon: the same server checks as customer checkout (validity, usage limits, minimum fare,
    // category / service, audience) against the fare before discount; then the booking is priced with it.
    let couponDiscount = 0;
    let usedCoupon: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    if (couponCode && couponDocs) {
      const coupons = couponDocs.docs.map((d) => mapCoupon(d.id, d.data()));
      const found = coupons.find((c) => normalizeCode(c.code) === couponCode);
      // Per-customer conditions cannot be checked for a walk-in without an account.
      if (found && !customerId && (found.firstBookingOnly || found.perCustomerLimit > 0 || (found.audience && found.audience !== 'All'))) {
        throw new HttpsError('failed-precondition', `${found.code} has per-customer conditions. Select the customer's account to apply it.`);
      }
      const prior = (customerHistory?.docs ?? []).map((d) => d.data()).filter((b) => b.status !== 'Cancelled' && b.status !== 'Rejected');
      const before = priceBooking(priceInput);
      const checked = validateCoupon(coupons, couponCode, {
        subtotal: before.fare.subtotal, categoryId: category.id, service, adminBooking: true,
        isFirstBooking: prior.length === 0, customerUses: prior.filter((b) => normalizeCode(b.couponCode || '') === couponCode).length,
        pickupAt: when, completedTrips: prior.filter((b) => b.status === 'Completed').length,
        pickupText: `${pickup.name} ${pickup.address ?? ''}`, dropText: `${drop.name} ${drop.address ?? ''}`,
        fixedRoute: before.pricing.model === 'city_drop_package' || before.pricing.model === 'fixed_route', peakAdjusted: adjustment?.direction === 'increase',
      });
      if (!checked.ok) throw new HttpsError('failed-precondition', checked.message);
      couponDiscount = checked.coupon.discount;
      usedCoupon = couponDocs.docs.find((d) => normalizeCode(d.data().code || '') === couponCode);
    }
    const pricedRaw = priceBooking({ ...priceInput, ...(couponDiscount ? { discount: couponDiscount } : {}) });
    const priced = { ...pricedRaw, pricing: adjustPartner(pricedRaw.pricing, rules) };
    assertWithinLimits(rules, { categoryName: category.name, customerFare: priced.fare.total, partnerPayout: partnerPayoutRupees(priced.pricing) });
    const calculated = priced.fare;
    const breakup = priced.breakup;
    const commission = priced.usesCommissionPolicy ? resolveCommission(policy, { serviceId: serviceId || undefined, categoryId: category.id }) : null;
    if (priced.usesCommissionPolicy && !commission) throw new HttpsError('failed-precondition', COMMISSION_NOT_CONFIGURED);
    // The admin form asks for this quote first and books against it; nothing is written.
    if (input.quoteOnly === true) {
      // The partner rate block is payout data: only for staff holding the payout right.
      const quotePricing = canSeePayouts(admin) ? priced.pricing : { ...priced.pricing, partner: null, ...(priced.pricing.extraCharges ? { extraCharges: { ...priced.pricing.extraCharges, partner: {} } } : {}) };
      return { quote: calculated, breakup, service, categoryName: category.name, commissionConfigured: true, adjustmentApplied: calculated.globalAdjustment, pricing: quotePricing, ...(couponCode ? { couponCode, couponDiscount } : {}) };
    }
    if (!Number.isFinite(input.expectedFare) || input.expectedFare !== calculated.total) {
      throw new HttpsError('failed-precondition', `The calculated fare is ₹${calculated.total}. Review it and submit again.`, { fare: calculated });
    }
    const override = overrideOf(input.override, calculated.total);
    const fare = override ? applyFareOverride(calculated, override.fare) : calculated;
    // An override is carried into the final fare as a fixed pre-GST adjustment.
    const pricing = override ? { ...priced.pricing, adminAdjustment: fare.adminAdjustment ?? 0, discount: fare.discount } : priced.pricing;
    if(companyPays) {
      const available=availableBusinessCredit(business!.data()!,businessBookings!.docs.map(d=>d.data()),businessReceipts!.docs.map(d=>d.data()));
      if(fare.total>available+0.005)throw new HttpsError('failed-precondition',`Business credit is insufficient. Available: ₹${Math.max(0,available).toFixed(2)}.`);
    }
    if (advanceIn && advanceIn.amount > fare.total) throw new HttpsError('invalid-argument', `The advance cannot be more than the fare (₹${fare.total}).`);

    const date = formatDate(when);
    const time = formatTime12(when);
    const bookingCode = await nextBookingCode(tx, now);
    // Serialize concurrent reservations against the same account, even if their query snapshots were identical.
    if(companyPays)tx.update(business!.ref,{reservationVersion:FieldValue.increment(1)});
    const stamp = FieldValue.serverTimestamp();
    const fareOverride = override
      ? { calculatedFare: calculated.total, overriddenFare: override.fare, reason: override.reason, byUid: admin.uid, byName: admin.name, at: Timestamp.now() }
      : null;
    const advanceTxn = advanceIn ? {
      id: `adv_${requestId.slice(0, 20)}`, bookingId: requestId, bookingCode, amount: advanceIn.amount, method: advanceIn.method, kind: 'advance', status: 'Success',
      collectorType: 'admin', collectorId: admin.uid, collectorName: admin.name, paymentDate: Timestamp.fromDate(now), reference: text(advanceIn.reference, 120),
      notes: text(advanceIn.notes, 300), enteredBy: admin.uid, enteredByRole: 'admin', enteredByName: admin.name, createdAt: stamp,
    } : null;
    const summary = summarizePayments(fare.total, advanceTxn ? [{ amount: advanceTxn.amount, method: advanceTxn.method, kind: 'advance', collectorType: 'admin', status: 'Success' }] : []);
    // The booking keeps the customer side of the pricing snapshot; the partner side goes to booking_pricing_private in this same transaction.
    const storedPricing = storePricingInTx(tx, requestId, customerId, pricing);
    tx.create(ref, {
      id: requestId, bookingId: bookingCode, customerId, customer: name, phoneMasked: maskPhone(phone),
      pickup: pickup.name, pickupAddress: pickup.address, pickupLat: pickup.lat, pickupLng: pickup.lng, pickupLatitude: pickup.lat, pickupLongitude: pickup.lng,
      pickupType: pickup.type, pickupLocationId: pickupR.source === 'master' ? pickup.id : '', pickupSource: pickupR.source,
      drop: drop.name, dropAddress: drop.address, dropLat: drop.lat, dropLng: drop.lng, dropType: drop.type, dropLocationId: dropR.source === 'master' ? drop.id : '', dropSource: dropR.source,
      service, serviceId, tripType, vehicle: category.name, vehicleCategory: category.name, vehicleCategoryId: category.id,
      passengerSeatsRequired: category.seats, dutyClass: dutyClassOf({ dutyClass: category.dutyClass, name: category.name, seats: category.seats }) ?? '', tariffClass: tariffClassOf(category) ?? '',
      fare: fare.total, fareBreakdown: fare, fareBreakup: breakup, pricing: storedPricing, fareVerified: true, fareOverride, ...(commission ? { commission } : {}), distanceKm: fare.distanceKm, durationMin: fare.durationMin,
      ...(tripEndAt ? { tripEndAt: Timestamp.fromDate(tripEndAt), endDate: pricing.endDate, billableDays: pricing.days } : {}),
      discountDetails: fare.discountDetail ? { ...fare.discountDetail, byUid: admin.uid, byName: admin.name } : null,
      globalAdjustmentApplied: fare.globalAdjustment ?? null,
      ...officeBookingExtras(input, admin),
      routeEstimated: false, couponCode: couponDiscount ? couponCode : '', discount: fare.discount, notes: text(input.notes), payment: summary.status === 'Paid' ? 'Paid' : 'Pending', paymentStatus: summary.status,
      paymentSummary: { ...summary, updatedAt: Timestamp.now() }, paymentMethod,
      rideTiming: 'scheduled', bookingType: 'advance', scheduledAt: Timestamp.fromDate(when), pickupAt: Timestamp.fromDate(when),
      date, time, status: 'Pending', tripSubStatus: 'Not Started', source: bookingChannel === 'nesam' ? 'admin' : bookingChannel, bookingSource: bookingChannel, brand: bookingChannel, ...availabilityFields(rules), createdBy: admin.uid, createdByName: admin.name, createdAt: stamp, updatedAt: stamp,
    });
    const otp = String(randomInt(1000, 10000));
    tx.create(db.doc(`booking_secrets/${requestId}`), { customerId, otp, createdAt: stamp });
    createContactInTx(tx, requestId, { customerId, name, phone, whatsapp: whatsapp!, email: email || (customer ? text(customer.data()!.email) : '') });
    // No marketplace record: partners see a booking only after an admin approves and publishes it.
    if (advanceTxn) {
      tx.create(db.doc(`bookings/${requestId}/payment_transactions/${advanceTxn.id}`), advanceTxn);
      tx.set(db.doc(`payments/${requestId}_${advanceTxn.id}`), {
        id: `${requestId}_${advanceTxn.id}`, bookingId: bookingCode, bookingDocumentId: requestId, customerId, customer: name, amount: advanceTxn.amount,
        method: advanceTxn.method, status: 'Success', gateway: 'Received by NESAM', reference: advanceTxn.reference, date: now.toISOString(), verifiedBy: admin.uid,
        collectorType: 'admin', collectorId: admin.uid, collectorName: admin.name, kind: 'advance', createdAt: stamp,
      });
    }
    tx.create(ref.collection('events').doc(), { type: 'created', actorId: admin.uid, actorRole: 'admin', at: stamp });
    if (override) {
      tx.create(ref.collection('events').doc(), {
        type: 'fare_override', actorId: admin.uid, actorRole: 'admin', calculatedFare: calculated.total, fare: override.fare, reason: override.reason, at: stamp,
      });
    }
    auditInTx(tx, {
      action: 'booking_created', entity: 'booking', entityId: requestId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId: requestId,
      next: { bookingCode, fare: fare.total, calculatedFare: calculated.total, discount: fare.discountDetail, adjustment: fare.globalAdjustment, advance: advanceTxn?.amount ?? 0, pickupSource: pickupR.source },
    });
    if (override) {
      auditInTx(tx, { action: 'fare_override', entity: 'booking', entityId: requestId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId: requestId, previous: { fare: calculated.total }, next: { fare: override.fare }, reason: override.reason });
    }
    if (usedCoupon) {
      tx.update(usedCoupon.ref, { usedCount: FieldValue.increment(1) });
      auditInTx(tx, { action: 'coupon_applied', entity: 'booking', entityId: requestId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId: requestId, next: { code: couponCode, discount: couponDiscount } });
    }
    if (fare.discountDetail) {
      auditInTx(tx, { action: 'discount_applied', entity: 'booking', entityId: requestId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId: requestId, next: fare.discountDetail, reason: fare.discountDetail.reason });
    }
    const n: NotifyInput = {
      recipientType: 'admin', recipientId: 'admin', category: 'bookings', severity: 'info', sound: 'new_booking',
      title: 'New booking request to review',
      message: `${bookingCode} · ${name} · ${pickup.name} → ${drop.name} · ${formatDateTime12(when)} · ₹${fare.total.toLocaleString('en-IN')}`,
      bookingId: requestId, bookingCode, cta: { label: 'Review booking', page: 'booking-detail', bookingId: requestId }, push: true, sentBy: admin.uid,
    };
    pushes.push({ id: notifyInTx(tx, n), input: n });
    return { id: requestId, bookingId: bookingCode, fare: fare.total, calculatedFare: calculated.total, otp };
  });
  await pushAfterCommit(pushes);
  // An office booking that was actually written (not a quote preview or a repeated request): confirm it to the customer by email.
  if (result && typeof result === 'object' && 'id' in result && 'otp' in result) await mailNewBooking(String(result.id), false);
  return result;
});

/**
 * Office booking details from the Master Admin New booking flow: who travels when it is booked for
 * someone else, how the enquiry came in, the business account it is booked for, the extras the
 * customer asked for and the customer's acceptance of the fare and terms. All optional.
 */
function officeBookingExtras(input: any, admin: { uid: string; name: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const p = input?.passenger && typeof input.passenger === 'object' ? input.passenger : null;
  if (p && text(p.name, 80).length >= 2) {
    const phone = String(p.phone ?? '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) throw new HttpsError('invalid-argument', 'Enter a valid 10-digit passenger mobile.');
    out.passenger = { name: text(p.name, 80), phone: `+91${phone}`, whatsapp: text(p.whatsapp, 20) };
  }
  const src = text(input?.enquirySource, 20);
  if (['Phone', 'WhatsApp', 'Office', 'App'].includes(src)) out.enquirySource = src;
  const biz = text(input?.businessAccountId, 128);
  if (biz && /^[A-Za-z0-9_-]+$/.test(biz)) {
    out.businessAccountId = biz;
    out.businessBilledTo = input?.businessBilledTo === 'Passenger pays' ? 'Passenger pays' : 'Company pays';
  }
  const ex = input?.tripExtras && typeof input.tripExtras === 'object' ? input.tripExtras : null;
  if (ex) {
    const waiting = Number(ex.waitingMinutes);
    out.tripExtras = { hillTravel: ex.hillTravel === true, roofCarrier: ex.roofCarrier === true, waitingMinutes: Number.isFinite(waiting) && waiting >= 0 && waiting <= 1440 ? Math.round(waiting) : 0 };
  }
  const enquiry = text(input?.enquiryId, 40);
  if (enquiry && /^NSM-QT-\d{6}$/.test(enquiry)) out.enquiryId = enquiry;
  if (input?.termsAccepted === true) out.termsAcceptance = { acceptedBy: 'customer', recordedBy: admin.uid, recordedByName: admin.name, at: Timestamp.now() };
  return out;
}

/** Legacy bookings (no server breakdown) get a breakdown whose only component is the admin fare. */
function baseBreakdown(b: FirebaseFirestore.DocumentData): FareBreakdown {
  const fb = b.fareBreakdown;
  if (fb && typeof fb === 'object' && Number.isFinite(fb.total) && Number.isFinite(fb.subtotal)) return fb as FareBreakdown;
  const km = Number(b.distanceKm);
  return {
    baseFare: 0, distanceFare: 0, timeFare: 0, nightCharge: 0, driverAllowance: 0, minimumFareAdjustment: 0, adminAdjustment: 0,
    subtotal: 0, discount: 0, taxableAmount: 0, gstRate: 0.05, gst: 0, total: 0,
    distanceKm: Number.isFinite(km) ? km : 0, durationMin: 0, perKmRate: 0, perMinuteRate: 0,
  };
}

export const overrideBookingFare = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'finance');
  requireAction(admin, 'Accounts', 'approve');
  requireAction(admin, 'Bookings', 'edit');
  const input = request.data ?? {};
  if (typeof input.bookingId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.bookingId)) throw new HttpsError('invalid-argument', 'Invalid booking.');
  const ref = db.doc(`bookings/${input.bookingId}`);
  const market = db.doc(`marketplace_trips/${input.bookingId}`);
  const tripEntryRef = db.doc(`wallet_ledger/trip_${input.bookingId}`);
  return db.runTransaction(async (tx) => {
    const [snap, trip, tripEntry] = await Promise.all([tx.get(ref), tx.get(market), tx.get(tripEntryRef)]);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const b = snap.data()!;
    if (b.status === 'Cancelled' || b.status === 'Rejected') throw new HttpsError('failed-precondition', 'Cancelled or rejected bookings cannot be repriced.');
    if (b.payment === 'Paid' || b.paymentStatus === 'Paid') throw new HttpsError('failed-precondition', 'This booking is already paid. Refund or adjust the payment instead.');
    if (b.invoiceId) throw new HttpsError('failed-precondition', `Invoice ${text(b.invoiceNumber) || b.invoiceId} exists for this trip. Void it before changing the fare.`);
    const base = baseBreakdown(b);
    const calculatedFare = b.fareOverride?.calculatedFare ?? (base.total > 0 ? base.total : null);
    const override = overrideOf(input, null)!;
    // Legacy fares may be stored as text such as "₹1,500".
    const previousFare = Number(String(b.fare ?? '').replace(/[^\d.]/g, '')) || 0;
    // Confirming the same amount is allowed only to verify an unverified legacy fare.
    if (override.fare === previousFare && b.fareVerified === true) throw new HttpsError('invalid-argument', 'The new fare is the same as the current fare.');
    const payout = Math.max(Number(b.driverPayout) || 0, Number(b.vendorPayout) || 0);
    if (override.fare < payout) throw new HttpsError('failed-precondition', `The fare cannot be below the ₹${payout} already agreed with the partner.`);
    const fare = applyFareOverride(base, override.fare);
    const stamp = FieldValue.serverTimestamp();
    // A completed but unpaid trip's finance snapshot follows the audited fare
    // change; the agreed partner payout never changes.
    const revised = b.finance && b.finance.schema === 1 ? buildFinanceSnapshot({ ...b, fare: fare.total, fareBreakdown: fare }) : null;
    tx.update(ref, {
      fare: fare.total, fareBreakdown: fare, fareVerified: true,
      ...(b.pricing && typeof b.pricing === 'object' ? { pricing: { ...b.pricing, adminAdjustment: fare.adminAdjustment ?? 0, discount: fare.discount } } : {}),
      fareOverride: { calculatedFare, overriddenFare: override.fare, previousFare, reason: override.reason, byUid: admin.uid, byName: admin.name, at: Timestamp.now() },
      ...(revised ? { finance: { ...revised, finalizedAt: b.finance.finalizedAt ?? stamp, revisedAt: stamp } } : {}),
      updatedAt: stamp,
    });
    if (revised && tripEntry.exists && tripEntry.data()!.schema === 2 && tripEntry.data()!.status === 'pending') {
      tx.update(tripEntryRef, { grossAmount: revised.fareTotal, commissionAmount: revised.platformRevenue ?? 0 });
    }
    // An unclaimed marketplace offer follows the new fare at the commission the
    // booking was published under; bookings from before the policy keep their offer.
    const c = b.commission;
    if (trip.exists && ['Open', 'Bidding', AWAITING_APPROVAL, 'Unpublished'].includes(trip.data()!.status) && c && typeof c.rate === 'number' && (c.base === 'taxable' || c.base === 'total')) {
      tx.update(market, { offeredPayout: partnerPayoutFor(fare, c), updatedAt: stamp });
    }
    tx.create(ref.collection('events').doc(), {
      type: 'fare_override', actorId: admin.uid, actorRole: 'admin', previousFare, calculatedFare, fare: fare.total, reason: override.reason, at: stamp,
    });
    auditInTx(tx, { action: 'fare_override', entity: 'booking', entityId: input.bookingId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId: input.bookingId, previous: { fare: previousFare }, next: { fare: fare.total }, reason: override.reason });
    return { fare: fare.total };
  });
});

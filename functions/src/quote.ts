import { fareBoardingState, recipientAddressState, recipientGstState } from './fareGstContext';
import { applyFareGst, fareGstFor, fareGstForScope, gstPricingInput } from './fareGstPricing';
import { fareServiceKey } from './fareScope';
// One pricing path for every booking source: customer app/web, Admin manual booking, the
// quote preview and the final invoice all go through priceBooking(). The confirmed tariff
// (domain/tariff.ts) is used when finance has enabled it in business_config/tariff_v2;
// otherwise, and for duties the confirmed tariff does not cover yet (local / airport trips
// outside a configured city zone), the admin vehicle-category fares remain in force and
// the snapshot records which source priced the booking.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { PUBLIC_CALLABLE_ORIGINS } from './corsOrigins';
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { DutyClass, dutyClassOf } from './domain/eligibility';
import { buildFareBreakup, buildTariffFareBreakup, FareBreakup, withExtraChargeLines } from './domain/fareBreakup';
import { scopedExtraChargesSnapshot } from './domain/scopedExtraCharges';
import { CATEGORY_GST_RATE, FareAdjustmentInput, calculateFare, isOutstation, serviceName } from './domain/pricing';
import {
  CONFIRMED_TARIFF_V2, FixedRouteFare, completeAirportRates, defaultRentalHours, quoteAirport, PricingSnapshot, QuoteResult, TARIFF_CLASSES, TariffClass, TariffConfig, TariffError, cityDropFare, classRates, istDate, localFareFor, matchFixedRoute, paise,
  parseFixedRouteFare, parseTariffConfig, gstOn, quoteFixedRoute, quoteLocalPickupDrop, quoteOneWay, quoteRentalPackage, quoteRoundTrip, r2, withinCityZone, scopedTariffForBrand,
  calendarDays, finalizeFare, multicityRatesFor, quoteMulticity, displayMarkupPercent,
} from './domain/tariff';
import { gstComponents } from './domain/gst';
import { multicityBookingAmounts } from './domain/multicitySnapshot';
import { FareBreakdown, GeoPlace, RideCategory, RouteInfo, TripType } from './domain/types';
import { requirePermission, text, requireAction } from './shared';
import { assertCatalogAvailable, matchAuthoritativeService, ServiceMasterDoc } from './onlineCatalog';
import { loadCommissionPolicy } from './commission';
import { COMMISSION_NOT_CONFIGURED, resolveCommission } from './domain/finance';
import { assertServiceSupported, resolveAndValidateBrand } from './brandContext';

export const TARIFF_DOC = 'business_config/tariff_v2';

export async function loadTariffConfig(tx?: Transaction): Promise<TariffConfig | null> {
  const ref = db.doc(TARIFF_DOC);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return snap.exists ? parseTariffConfig(snap.data()) : null;
}

/** Every enabled, valid fixed route fare (see parseFixedRouteFare); older route rules are not included. */
export async function loadFixedRoutes(tx?: Transaction): Promise<FixedRouteFare[]> {
  const q = db.collection('fare_rules').where('pricingType', '==', 'FIXED_ROUTE').where('status', '==', 'Active');
  const snap = tx ? await tx.get(q) : await q.get();
  return snap.docs.map((d) => parseFixedRouteFare(d.id, d.data())).filter((r): r is FixedRouteFare => r !== null);
}

/** tariff class of a category: an explicit `tariffClass` on the category record, else its duty class. */
export function tariffClassOf(category: { tariffClass?: unknown; dutyClass?: unknown; name?: unknown; seats?: unknown }): TariffClass | null {
  const explicit = typeof category.tariffClass === 'string' ? category.tariffClass.trim().toLowerCase() : '';
  if ((TARIFF_CLASSES as readonly string[]).includes(explicit)) return explicit as TariffClass;
  const duty: DutyClass | null = dutyClassOf(category);
  if (!duty) return null;
  // Innova has its own class; until an Innova rate is saved it is priced at the SUV rate (see classRates).
  return duty === 'sedan' ? 'sedan' : duty === 'crysta' ? 'crysta' : duty === 'innova' ? 'innova' : duty === 'suv7' ? 'suv7' : 'suv';
}

/**
 * The canonical City record (`locations` id) a master-location place belongs to: the place itself when it
 * is a City, else the City found by walking `parentLocationId`, else the one active City with the same
 * state and city name. null for a map pin or anything that cannot be resolved to exactly one City.
 */
async function cityIdOf(place: GeoPlace): Promise<string | null> {
  if (!place.id || place.id === 'pin') return null;
  let id = place.id;
  for (let hop = 0; hop < 4; hop++) {
    const snap = await db.doc(`locations/${id}`).get();
    const l = snap.data();
    if (!snap.exists || !l) return null;
    if (l.type === 'City') return snap.id;
    if (typeof l.parentLocationId !== 'string' || !l.parentLocationId) break;
    id = l.parentLocationId;
  }
  const { city, state } = place as GeoPlace & { city?: string; state?: string };
  if (!city) return null;
  const cities = await db.collection('locations').where('type', '==', 'City').where('status', '==', 'Active').where('city', '==', city).get();
  const same = cities.docs.filter((d) => !state || !d.data().state || d.data().state === state);
  return same.length === 1 ? same[0].id : null;
}

/** The City both places belong to, for Local Pickup & Drop pricing; null when they differ or cannot be resolved. */
export async function sharedCityId(pickup: GeoPlace, drop: GeoPlace): Promise<string | null> {
  const [a, b] = await Promise.all([cityIdOf(pickup), cityIdOf(drop)]);
  return a && a === b ? a : null;
}

/** Whole rental hours from a request, or null when none were asked for. */
export function rentalHoursOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

export interface PriceInput {
  boardingState?: string;
  recipientState?: string;
  recipientAddressState?: string;
  category: RideCategory & { tariffClass?: unknown; dutyClass?: unknown };
  route: RouteInfo;
  tripType: TripType;
  pickup: GeoPlace;
  drop: GeoPlace;
  pickupAt: Date;
  /** Round trips: when the trip ends (unambiguous instant). */
  tripEndAt: Date | null;
  tariff: TariffConfig | null;
  adjustment: FareAdjustmentInput | null;
  /** Coupon or admin discount in rupees. */
  discount?: number;
  adminDiscount?: Parameters<typeof calculateFare>[0]['adminDiscount'];
  /** Canonical City both places belong to (see sharedCityId). Enables Local Pickup & Drop pricing. */
  localCityId?: string | null;
  /** Local Rental only: the package the customer chose, in hours. */
  rentalHours?: number | null;
  /** Enabled fixed route fares and the booked service. Only places with canonical location ids (never a map pin) can match one. */
  fixedRoutes?: FixedRouteFare[];
  serviceId?: string;
  businessContract?: import('./domain/business').BusinessContract | null;
  /** 'cng' prices a One Way / Round Trip on the class's CNG rate card. Ignored where no CNG card applies. */
  fuel?: 'cng';
  /** Brand scope applied to price this booking. */
  brand?: string;
  /** A customer Multicity tour (a Round Trip through several cities): priced from the saved Multicity rates for the whole itinerary. */
  multicity?: boolean;
}

export interface PriceResult {
  fare: FareBreakdown;
  breakup: FareBreakup;
  pricing: PricingSnapshot;
  service: string;
  outstation: boolean;
  /** true when a percentage commission would apply (older category pricing). */
  usesCommissionPolicy: boolean;
}

/**
 * Throws HttpsError for anything the confirmed tariff cannot price (never invents a number). Whatever path prices the trip, the
 * quote also records the category's extra-charge rates (waiting, hill, roof carrier — customer and partner) in its snapshot and
 * discloses them in the breakup. The fare itself is unchanged: these are billed only for the extras actually used.
 */
export function priceBooking(i: PriceInput): PriceResult {
  if (i.multicity) {
    const tour = priceMulticityTour(i);
    const extras = scopedExtraChargesSnapshot(i.tariff, i.brand, 'Multicity', tariffClassOf(i.category), i.category.id);
    return extras ? { ...tour, pricing: { ...tour.pricing, extraCharges: extras }, breakup: withExtraChargeLines(tour.breakup, extras) } : tour;
  }
  const tax = fareGstFor(i);
  const raw = priceBookingCore(tax ? gstPricingInput(i, tax, tariffClassOf(i.category)) : i);
  const explicitMode = i.businessContract?.rule.gstMode ?? i.fixedRoutes?.find(rule => rule.id === raw.pricing.fixedRouteId)?.gstMode;
  const r = tax ? applyFareGst(raw, explicitMode ? { ...tax, mode: explicitMode } : tax) : raw;
  if (tax) r.pricing.brandScoped = !!(i.brand && i.tariff?.brandOverrides?.[i.brand]);
  if (tax) {
    const outstation = ['rental_package', 'local_pickup_drop', 'airport_transfer'].includes(r.pricing.model) ? false : r.outstation;
    r.breakup = r.pricing.source === 'tariff_v2' ? buildTariffFareBreakup(i.category, r.fare, outstation, r.pricing) : buildFareBreakup(i.category, r.fare, outstation);
  }
  const extra = scopedExtraChargesSnapshot(i.tariff, i.brand, i.tripType, tariffClassOf(i.category), i.category.id);
  return extra ? { ...r, pricing: { ...r.pricing, extraCharges: extra }, breakup: withExtraChargeLines(r.breakup, extra) } : r;
}

/**
 * A Multicity tour = max(itinerary KM, daily minimum × calendar days) × rate + daily bata × days, from the saved Multicity
 * rates of the brand and the vehicle class (the Round Trip rates they inherit). The same numbers the travel desk quotes, so a
 * customer who books directly pays exactly what an office quote would have been. Coupons and the global adjustment apply once.
 */
function priceMulticityTour(i: PriceInput): PriceResult {
  const tariff = i.tariff;
  const cls = tariffClassOf(i.category);
  if (!tariff) throw new HttpsError('failed-precondition', 'Multicity fares are not available yet.');
  if (!cls) throw new HttpsError('failed-precondition', `${i.category.name} is not mapped to a tariff class yet. An admin must set its vehicle class.`);
  const brand = i.brand || 'nesam';
  const rates = multicityRatesFor(tariff, brand, cls);
  if (!rates) throw new HttpsError('failed-precondition', 'Multicity fares are not available for this vehicle yet.');
  const pickupMs = i.pickupAt.getTime();
  const endMs = i.tripEndAt ? i.tripEndAt.getTime() : pickupMs;
  const days = calendarDays(pickupMs, endMs);
  if (days === null) throw new HttpsError('failed-precondition', 'The tour end must be on or after pickup and within the supported tour duration.');
  const tax = fareGstForScope({ tariff, brand, service: 'Multicity', boardingState: i.boardingState, recipientState: i.recipientState, recipientAddressState: i.recipientAddressState });
  const q = quoteMulticity({ rates, totalKm: i.route.distanceKm, days, gstRate: tax ? tax.rate : tariff.gstRate, gstIncluded: tax?.mode === 'included' });
  const amounts = multicityBookingAmounts(q, { tariffVersion: tariff.version, tariffClass: cls, brand, pickupMs, endMs, durationMin: Math.round(i.route.durationMin), gst: tax });
  const discount = Math.max(0, i.discount ?? 0);
  let fare = amounts.fare;
  if (i.adjustment || discount > 0) {
    if (i.adjustment) {
      amounts.pricing.adjustmentPercent = i.adjustment.percent;
      amounts.pricing.adjustmentDirection = i.adjustment.direction;
    }
    amounts.pricing.discount = discount;
    fare = { ...finalizeFare({ pricing: amounts.pricing, totalKm: i.route.distanceKm, endMs }).fare, durationMin: Math.round(i.route.durationMin) };
    if (fare.globalAdjustment && i.adjustment) fare.globalAdjustment = { ...fare.globalAdjustment, id: i.adjustment.id, name: i.adjustment.name };
    if (tax) fare = { ...fare, gstDetails: { ...tax, ...gstComponents(fare.gst, tax.split) } };
  }
  const pricing: PricingSnapshot = { ...amounts.pricing, brandScoped: !!tariff.brandOverrides?.[brand] };
  return { fare, pricing, service: 'Multicity', outstation: true, breakup: buildTariffFareBreakup(i.category, fare, true, pricing), usesCommissionPolicy: false };
}

function priceBookingCore(i: PriceInput): PriceResult {
  const effectiveTariff = i.tariff ? scopedTariffForBrand(i.tariff, i.brand, i.tripType, tariffClassOf(i.category)) : null;
  const outstation = isOutstation(i.route.distanceKm);
  const service = serviceName(i.pickup, i.drop, i.route.distanceKm, i.tripType);
  const klass = tariffClassOf(i.category);
  const cfg = effectiveTariff && effectiveTariff.enabled ? effectiveTariff : null;
  const useTariff = !!cfg && !!klass && (i.tripType === 'Round Trip' || (i.tripType === 'One Way' && outstation));

  // A coupon or an admin discount, applied the same way on every confirmed-tariff path.
  const withDiscounts = (run: (discount: number) => QuoteResult): QuoteResult => {
    let q = run(i.discount ?? 0);
    if (i.adminDiscount) {
      const v = Math.max(0, i.adminDiscount.value);
      const requested = i.adminDiscount.type === 'percentage' ? Math.round((q.fare.subtotal * Math.min(100, v)) / 100) : Math.round(v);
      q = run(requested);
      if (q.fare.discount > 0) q.fare.discountDetail = { type: i.adminDiscount.type, value: v, amount: q.fare.discount, source: 'admin', reason: i.adminDiscount.reason ?? '' };
    }
    return q;
  };
  const adjust = { adjustmentPercent: i.adjustment?.percent ?? 0, adjustmentDirection: i.adjustment?.direction };
  const timing = { routeKm: i.route.distanceKm, durationMin: i.route.durationMin, pickupMs: i.pickupAt.getTime(), endMs: null };

  // An enabled fixed route fare replaces the distance-based base fare for exactly its route, direction, service,
  // category and dates. Anything that does not match keeps its normal pricing; a map pin never matches.
  const hasId = (id: string) => !!id && id !== 'pin';
  const fixed = i.businessContract ? { rule: i.businessContract.rule, reversed: false } : i.tripType === 'One Way' && i.fixedRoutes?.length && hasId(i.pickup.id) && hasId(i.drop.id)
    ? matchFixedRoute(i.fixedRoutes, { originId: i.pickup.id, destinationId: i.drop.id, categoryId: i.category.id, serviceId: i.serviceId ?? '', brand: i.brand, fareService: fareServiceKey(i.tripType), date: istDate(i.pickupAt.getTime()) })
    : null;
  if (fixed) {
    const tariff = effectiveTariff;
    const q = withDiscounts((discount) => quoteFixedRoute({
      rule: fixed.rule, reversed: fixed.reversed, gstRate: tariff?.gstRate ?? CATEGORY_GST_RATE, tariffVersion: tariff?.version ?? 0, tariffClass: klass,
      routeKm: i.route.distanceKm*(i.businessContract&&i.tripType==='Round Trip'?2:1), durationMin: i.route.durationMin, pickupMs: i.pickupAt.getTime(), discount, adjustmentPercent: i.adjustment?.percent ?? 0, adjustmentDirection: i.adjustment?.direction,
    }));
    if (i.businessContract?.perKm) {
      const c=i.businessContract;
      q.pricing={...q.pricing,model:'business_contract_per_km',businessCustomerRatePaise:paise(c.customerRate),businessGstMode:c.rule.gstMode,extraKmRatePaise:paise(c.customerRate/(c.rule.gstMode==='included'?1+q.pricing.gstRate:1)),partner:{...q.pricing.partner!,minKm:q.pricing.quotedKm,ratePaise:paise(c.partnerRate)},brand:i.brand,brandScoped:!!(i.brand&&i.tariff?.brandOverrides?.[i.brand])};
    }
    return { fare: q.fare, pricing: { ...q.pricing, brand: i.brand, brandScoped: !!(i.brand && i.tariff?.brandOverrides?.[i.brand]) }, service, outstation, breakup: buildTariffFareBreakup(i.category, q.fare, outstation, q.pricing), usesCommissionPolicy: false };
  }

  // Fixed rental packages and per-city Local Pickup & Drop fares switch on one by one (each has its own
  // enabled flag), so they do not wait for the confirmed-tariff switch. Anything not explicitly enabled
  // and valid is never priced here: a rental with no usable package is refused, a local trip falls through.
  // With no package chosen, the shortest package this vehicle may book is quoted (and shown) so the saved packages always apply.
  const rentalHours = i.tripType === 'Local Rental' ? i.rentalHours ?? (effectiveTariff && klass ? defaultRentalHours(effectiveTariff, klass) : null) : null;
  if (i.tripType === 'Local Rental' && rentalHours != null) {
    const tariff = effectiveTariff, hours = rentalHours;
    if (!tariff || !klass) throw new HttpsError('failed-precondition', 'Rental packages are not configured for this vehicle.');
    try {
      const q = withDiscounts((discount) => quoteRentalPackage({ config: tariff, tariffClass: klass, tripType: 'One Way', hours, discount, ...timing, ...adjust }));
      return { fare: q.fare, pricing: { ...q.pricing, brand: i.brand, brandScoped: !!(i.brand && i.tariff?.brandOverrides?.[i.brand]) }, service, outstation, breakup: buildTariffFareBreakup(i.category, q.fare, false, q.pricing), usesCommissionPolicy: false };
    } catch (e) {
      if (e instanceof TariffError) throw new HttpsError('failed-precondition', e.message, { code: e.code });
      throw e;
    }
  }
  if (effectiveTariff && klass && i.localCityId && i.tripType === 'One Way' && service === 'Local' && localFareFor(effectiveTariff, i.localCityId, klass)) {
    const tariff = effectiveTariff, cityId = i.localCityId;
    const q = withDiscounts((discount) => quoteLocalPickupDrop({ config: tariff, tariffClass: klass, tripType: 'One Way', cityId, discount, ...timing, ...adjust }));
    return { fare: q.fare, pricing: { ...q.pricing, brand: i.brand, brandScoped: !!(i.brand && i.tariff?.brandOverrides?.[i.brand]) }, service, outstation, breakup: buildTariffFareBreakup(i.category, q.fare, false, q.pricing), usesCommissionPolicy: false };
  }

  // Airport transfer: base fare for the included KM plus the extra-KM rate, once every Airport Taxi rate is saved for this
  // class (Common or brand). Until then the trip keeps the vehicle-category fare below.
  const airportRates = cfg && klass && i.tripType === 'Airport Taxi' ? completeAirportRates(cfg, klass) : null;
  if (cfg && klass && airportRates) {
    const q = withDiscounts((discount) => quoteAirport({ config: cfg, tariffClass: klass, tripType: 'One Way', rates: airportRates, discount, ...timing, ...adjust }));
    return { fare: q.fare, pricing: { ...q.pricing, brand: i.brand, brandScoped: !!(i.brand && i.tariff?.brandOverrides?.[i.brand]) }, service, outstation, breakup: buildTariffFareBreakup(i.category, q.fare, false, q.pricing), usesCommissionPolicy: false };
  }

  if (cfg && !klass) {
    throw new HttpsError('failed-precondition', `${i.category.name} is not mapped to a tariff class yet. An admin must set its vehicle class.`);
  }
  if (useTariff && cfg && klass) {
    try {
      const run = (discount: number) => (i.tripType === 'Round Trip'
        ? quoteRoundTrip({
            config: cfg, tariffClass: klass, tripType: 'Round Trip', routeKm: i.route.distanceKm, durationMin: i.route.durationMin,
            pickupMs: i.pickupAt.getTime(), endMs: i.tripEndAt ? i.tripEndAt.getTime() : null, discount,
            adjustmentPercent: i.adjustment?.percent ?? 0, adjustmentDirection: i.adjustment?.direction, fuel: i.fuel,
          })
        : quoteOneWay({
            config: cfg, tariffClass: klass, tripType: 'One Way', routeKm: i.route.distanceKm, durationMin: i.route.durationMin,
            pickupMs: i.pickupAt.getTime(), endMs: null, discount,
            adjustmentPercent: i.adjustment?.percent ?? 0, adjustmentDirection: i.adjustment?.direction, fuel: i.fuel,
          }));
      const q = withDiscounts(run);
      return {
        fare: q.fare, pricing: { ...q.pricing, brand: i.brand, brandScoped: !!(i.brand && i.tariff?.brandOverrides?.[i.brand]) }, service, outstation,
        breakup: buildTariffFareBreakup(i.category, q.fare, outstation || i.tripType === 'Round Trip', q.pricing),
        usesCommissionPolicy: false,
      };
    } catch (e) {
      if (e instanceof TariffError) throw new HttpsError('failed-precondition', e.message, { code: e.code });
      throw e;
    }
  }

  // City drop package: only inside a configured city zone (boundaries are an open decision).
  const dropRates = cfg && klass ? classRates(cfg.cityDrop.classes, klass) : undefined;
  if (cfg && klass && i.tripType === 'One Way' && !outstation && dropRates) {
    const zone = withinCityZone(cfg, i.pickup, i.drop);
    if (zone) {
      const pack = cityDropFare(cfg, klass, i.route.distanceKm);
      const pre = r2(pack.customerPaise / 100);
      const discount = Math.min(Math.max(0, r2(i.discount ?? 0)), pre);
      const taxable = r2(pre - discount);
      const gst = gstOn(taxable, cfg.gstRate);
      const fare: FareBreakdown = {
        subtotalBeforeAdjustment: pre, globalAdjustment: null, discountDetail: discount > 0 ? { type: 'coupon', value: discount, amount: discount, source: 'coupon', reason: '' } : null,
        baseFare: dropRates.customerBase, distanceFare: r2(pre - dropRates.customerBase),
        timeFare: 0, nightCharge: 0, driverAllowance: 0, minimumFareAdjustment: 0, subtotal: pre, discount, taxableAmount: taxable, gstRate: cfg.gstRate, gst, total: r2(taxable + gst),
        distanceKm: Math.round(i.route.distanceKm * 10) / 10, durationMin: Math.round(i.route.durationMin), perKmRate: dropRates.customerExtraKm, perMinuteRate: 0,
      };
      const pricing: PricingSnapshot = {
        schema: 2, source: 'tariff_v2', model: 'city_drop_package', tariffVersion: cfg.version, tariffClass: klass, gstRate: cfg.gstRate,
        quotedKm: Math.max(cfg.cityDrop.baseKm, fare.distanceKm), includedKm: cfg.cityDrop.baseKm, extraKmRatePaise: paise(dropRates.customerExtraKm),
        customerRatePaise: paise(dropRates.customerExtraKm), customerBataPaise: 0, days: 1, minKmPerDay: cfg.cityDrop.baseKm,
        packagePaise: pack.customerPaise, discount, adminAdjustment: 0, adjustmentPercent: 0, adjustmentDirection: 'increase',
        partner: { mode: 'NORMAL_RATE', ratePaise: paise(dropRates.partnerExtraKm), bataPaise: 0, minKm: cfg.cityDrop.baseKm, days: 1, basePaise: pack.partnerPaise },
        brand: i.brand, brandScoped: !!(i.brand && i.tariff?.brandOverrides?.[i.brand]),
        pickupDate: '', endDate: null, gates: [`D15: city boundary "${zone.name}" is a configured zone awaiting business confirmation`, 'D05: add-on units and partner share are pending'],
      };
      return { fare, pricing, service: 'City drop', outstation: false, breakup: buildTariffFareBreakup(i.category, fare, false, pricing), usesCommissionPolicy: false };
    }
  }

  // Older admin-category engine: local / airport trips and anything while the tariff is off.
  const fare = calculateFare({
    category: i.category, route: i.route, tripType: i.tripType, pickupTime: i.pickupAt, discount: i.discount ?? 0, adjustment: i.adjustment, adminDiscount: i.adminDiscount ?? null,
  });
  const legs = i.tripType === 'Round Trip' ? 2 : 1;
  const extraRate = i.category.fare.extras?.extraKmRate ?? i.category.fare.perKmRate;
  const pricing: PricingSnapshot = {
    schema: 2, source: 'legacy_category', model: 'legacy_category', tariffVersion: 0, tariffClass: klass, gstRate: fare.gstRate,
    quotedKm: Math.round(i.route.distanceKm * legs * 10) / 10, includedKm: Math.round(i.route.distanceKm * legs * 10) / 10,
    extraKmRatePaise: paise(extraRate), customerRatePaise: paise(fare.perKmRate), customerBataPaise: 0, days: 1, minKmPerDay: 0,
    packagePaise: paise(fare.subtotal), discount: fare.discount, adminAdjustment: 0, adjustmentPercent: 0, adjustmentDirection: 'increase', partner: null, pickupDate: '', endDate: null,
    brand: i.brand, brandScoped: false,
    gates: cfg ? ['Local / airport duty outside a configured city zone is priced by the vehicle category (confirmed tariff does not cover it yet)'] : ['Confirmed tariff is not enabled; vehicle category fares apply'],
  };
  return { fare, pricing, service, outstation, breakup: buildFareBreakup(i.category, fare, outstation), usesCommissionPolicy: true };
}

// ── Admin: save the tariff configuration ────────────────────────────────────

/**
 * Saves business_config/tariff_v2. Passing `useConfirmedDefaults: true` writes the values the
 * owner confirmed on 09 Oct 2026; `enabled` switches the confirmed tariff on for NEW bookings
 * only — a confirmed booking keeps the pricing snapshot it was quoted with.
 */
export const saveTariffConfig = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  // `keepSavedRates` only flips the on/off switch: every saved rate, zone and local fare stays as it is.
  const keepSaved = input.keepSavedRates === true;
  const raw = input.useConfirmedDefaults === true ? { ...CONFIRMED_TARIFF_V2, cityDrop: { ...CONFIRMED_TARIFF_V2.cityDrop, zones: input.cityDrop?.zones ?? [] } } : input;
  const submitted = parseTariffConfig({ ...raw, enabled: input.enabled === true, version: 0 });
  if (!submitted) throw new HttpsError('invalid-argument', 'The tariff configuration is invalid.');
  const reason = text(input.reason, 300);
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Give a short reason for the change.');
  const ref = db.doc(TARIFF_DOC);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const before = current.exists ? parseTariffConfig(current.data()) : null;
    if (typeof input.expectedVersion === 'number' && input.expectedVersion !== (before?.version ?? 0)) {
      throw new HttpsError('failed-precondition', 'The tariff was changed by someone else. Reload and review it before saving.');
    }
    if (keepSaved && !before) throw new HttpsError('failed-precondition', 'No tariff is saved yet. Save base rates first.');
    // Loading the confirmed values replaces the one-way / round-trip / rental / city-drop rates only; the
    // outstation extras, airport fare, Local Pickup & Drop fares and rental packages keep their saved values.
    const parsed: TariffConfig = keepSaved && before ? {
      ...before,
      enabled: input.enabled === true,
      // City-drop zones may be replaced on their own; every rate stays as saved.
      ...(Array.isArray(input.cityDrop?.zones) ? { cityDrop: { ...before.cityDrop, zones: submitted.cityDrop.zones } } : {}),
    } : {
      ...submitted,
      ...(submitted.outstationExtras ?? before?.outstationExtras ? { outstationExtras: submitted.outstationExtras ?? before?.outstationExtras } : {}),
      ...(submitted.oneWayExtras ?? before?.oneWayExtras ? { oneWayExtras: submitted.oneWayExtras ?? before?.oneWayExtras } : {}),
      ...(submitted.roundTripExtras ?? before?.roundTripExtras ? { roundTripExtras: submitted.roundTripExtras ?? before?.roundTripExtras } : {}),
      ...(submitted.airport ?? before?.airport ? { airport: submitted.airport ?? before?.airport } : {}),
      ...(submitted.localPickupDrop ?? before?.localPickupDrop ? { localPickupDrop: submitted.localPickupDrop ?? before?.localPickupDrop } : {}),
      ...(submitted.rentalPackages ?? before?.rentalPackages ? { rentalPackages: submitted.rentalPackages ?? before?.rentalPackages } : {}),
      // The extra-charge rates are edited only by their own section: a full tariff save never drops them.
      ...(before?.extraCharges ? { extraCharges: before.extraCharges } : {}),
      ...(before?.displayMarkup ? { displayMarkup: before.displayMarkup } : {}),
    };
    if (parsed.enabled && !Object.keys(parsed.oneWay.classes).length && !Object.keys(parsed.roundTrip.classes).length) {
      throw new HttpsError('failed-precondition', 'Configure at least one one-way or round-trip rate card before enabling the tariff.');
    }
    const version = (before?.version ?? 0) + 1;
    tx.set(ref, { ...parsed, version, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, { action: 'tariff_saved', entity: 'tariff', entityId: 'v2', performedBy: actor.uid, performedByName: actor.name, role: 'admin', previous: before ? { version: before.version, enabled: before.enabled } : null, next: { version, enabled: parsed.enabled }, reason });
    return { version, enabled: parsed.enabled };
  });
});

// ── Customer: authoritative quotes for every bookable category ──────────────

import { mapCategory, mapCoupon, normalizeCode, validateCoupon } from './domain/pricing';
import { bookingWindowFrom, parsePickupInstant, pickupWindowProblem } from './domain/advanceBooking';
import { effectiveAdjustment, loadFareAdjustment } from './fareConfig';
import { adjustPartner, assertBookable, assertWithinLimits, evaluateRules, loadServiceRules, partnerPayoutRupees, ruleServiceText } from './serviceRules';
import { approved, inIndia, roundTripPricingRoute, routeThrough } from './shared';
import { requestIp } from './security';
import { rateLimited } from './http/util';

function placeOf(v: any, role: string): GeoPlace {
  if (!v || !inIndia(v.lat, v.lng)) throw new HttpsError('invalid-argument', `Choose a valid ${role} location in India.`);
  return { id: 'pin', name: text(v.name, 120), address: text(v.address), lat: v.lat, lng: v.lng, type: v.type === 'airport' ? 'airport' : 'other' };
}

/**
 * A customer place keeps its master-location id only when that Active location sits at the same coordinates, so the
 * customer apps price Fixed route and Local Pickup & Drop fares exactly as the office does. Anything else stays a map pin.
 */
export async function trustedCustomerPlace(place: GeoPlace, requestedId: unknown): Promise<GeoPlace> {
  const id = typeof requestedId === 'string' ? requestedId : '';
  if (!id || id === 'pin' || id.includes('/') || id.length > 150) return place;
  const l = (await db.doc(`locations/${id}`).get()).data();
  if (!l || l.status !== 'Active' || !Number.isFinite(l.lat) || !Number.isFinite(l.lng)) return place;
  if (Math.abs(l.lat - place.lat) > 0.0001 || Math.abs(l.lng - place.lng) > 0.0001) return place;
  return { ...place, id, type: l.type === 'Airport' ? 'airport' : place.type, city: text(l.city, 80), area: text(l.area, 80), state: text(l.state, 80) } as GeoPlace;
}

/** Fixed route fares and the shared City a customer trip may use (the same inputs the office booking passes). */
export async function customerFareContext(tripType: TripType, pickup: GeoPlace, drop: GeoPlace, distanceKm: number): Promise<{ fixedRoutes: FixedRouteFare[]; localCityId: string | null }> {
  const masters = pickup.id !== 'pin' && drop.id !== 'pin';
  const [fixedRoutes, localCityId] = await Promise.all([
    tripType === 'One Way' && masters ? loadFixedRoutes() : Promise.resolve([]),
    tripType === 'One Way' && !isOutstation(distanceKm) && masters ? sharedCityId(pickup, drop) : Promise.resolve(null),
  ]);
  return { fixedRoutes, localCityId };
}

/**
 * The fare the customer will be charged, for each active vehicle category, computed by the same
 * priceBooking() createBooking uses — so what the customer reviews is what is booked. Nothing is
 * written. The pickup time matters (night charge, calendar days), so it is validated like a booking.
 */
export const quoteBooking = onCall({ timeoutSeconds: 60, cors: PUBLIC_CALLABLE_ORIGINS }, async (request) => {
  // Signed-out visitors may see fares too (nothing is written or returned about any account);
  // they are rate-limited per IP and get no coupon, which depends on the customer's history.
  const uid = request.auth?.uid;
  if (!uid && rateLimited(`quote:${requestIp(request)}`, 30)) throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a moment.');
  const input = request.data ?? {};
  const brand = resolveAndValidateBrand(input, request);
  // A Multicity tour is booked as a Round Trip through its cities, priced from the Multicity rates.
  const multicity = input.tripType === 'Multicity';
  const tripType: TripType =
    input.tripType === 'Round Trip' || multicity
      ? 'Round Trip'
      : input.tripType === 'Local Rental'
      ? 'Local Rental'
      : input.tripType === 'Airport Taxi'
      ? 'Airport Taxi'
      : 'One Way';
  assertServiceSupported(brand, multicity ? 'Multicity' : tripType);
  const rawStops = Array.isArray(input.stops) ? input.stops : [];
  if (rawStops.length > 8) throw new HttpsError('invalid-argument', 'Add no more than 8 intermediate stops.');
  if (rawStops.length && tripType !== 'Round Trip') throw new HttpsError('invalid-argument', 'Intermediate stops are available for round trips only.');
  if (multicity && !rawStops.length) throw new HttpsError('invalid-argument', 'Add at least one city between your pickup and your final drop.');
  const [pickup, drop, ...stops] = await Promise.all([
    trustedCustomerPlace(placeOf(input.pickup, 'pickup'), input.pickup?.id),
    trustedCustomerPlace(placeOf(input.drop, 'drop'), input.drop?.id),
    ...rawStops.map((stop: any) => trustedCustomerPlace(placeOf(stop, 'stop'), stop?.id)),
  ]);
  const itinerary = [pickup, ...stops, drop];
  for (let n = 1; n < itinerary.length; n += 1) {
    if (Math.abs(itinerary[n]!.lat - itinerary[n - 1]!.lat) < 0.0001 && Math.abs(itinerary[n]!.lng - itinerary[n - 1]!.lng) < 0.0001) throw new HttpsError('invalid-argument', 'Two consecutive itinerary locations cannot be the same.');
  }
  const now = new Date();
  const when = parsePickupInstant(input.scheduledAt);
  // Everything below that does not depend on the route starts now, so the reads overlap with the
  // route lookup instead of waiting for each other. Prices themselves are never cached: every quote
  // reads the current tariff, categories, adjustment and rules.
  const settled = <T,>(p: Promise<T>): Promise<T> => {
    p.catch(() => undefined); // a failure is reported where the result is awaited, never as an unhandled rejection
    return p;
  };
  const operationsRead = settled(db.doc('settings/operations').get());
  const routeLookup = settled(routeThrough(itinerary));
  const customerRead = settled(uid ? db.doc(`customers/${uid}`).get() : Promise.resolve(null));
  const catalogue = settled(
    Promise.all([
      db.collection('vehicle_categories').where('status', '==', 'Active').get(),
      loadTariffConfig(),
      loadFareAdjustment(),
      input.couponCode && uid ? db.collection('coupons').get() : Promise.resolve(null),
      input.couponCode && uid ? db.collection('bookings').where('customerId', '==', uid).get() : Promise.resolve(null),
      loadServiceRules(),
      loadCommissionPolicy(),
      db.collection('services').get(),
    ]),
  );
  const window = bookingWindowFrom((await operationsRead).data());
  const problem = pickupWindowProblem(when, now, window);
  if (problem || !when) throw new HttpsError('invalid-argument', problem || 'Choose the pickup date and time.');
  const tripEndAt = tripType === 'Round Trip' ? parsePickupInstant(input.tripEndAt) : null;
  const route = await routeLookup;
  // A Multicity tour is billed on the whole itinerary, even when it ends where it began.
  const pricingRoute = multicity ? route : await roundTripPricingRoute(route, tripType, pickup, drop, stops.length);
  const [{ fixedRoutes, localCityId }, customer] = await Promise.all([customerFareContext(tripType, pickup, drop, route.distanceKm), customerRead]);
  if (customer?.exists && !approved(customer.data()!.status)) throw new HttpsError('permission-denied', 'Your account is not active.');
  // A coupon is only checked for an existing customer account.
  const customerId = customer?.exists ? uid : null;
  const [categories, tariff, adjustmentDoc, couponsRead, historyRead, serviceRules, policy, servicesSnap] = await catalogue;
  // A coupon is only checked for an existing customer account.
  const coupons = customerId ? couponsRead : null;
  const history = customerId ? historyRead : null;
  const boardingState = await fareBoardingState(tariff, pickup, input.pickup?.id);
  const recipientState = recipientGstState(customer?.data());
  // Display only: the % shown as a higher struck-out price above each fare. The fare itself is never changed by it.
  const strikePercent = displayMarkupPercent(tariff, brand, multicity ? 'Multicity' : fareServiceKey(tripType));
  const struck = (total: number) => (strikePercent > 0 ? { strikeTotal: Math.round(total * (1 + strikePercent / 100)) } : {});
  const rules = evaluateRules(serviceRules, pickup, drop, when, multicity ? 'Multicity' : ruleServiceText(pickup, drop, route.distanceKm, tripType), brand, multicity ? 'Multicity' : fareServiceKey(tripType), itinerary);
  const adjustment = rules.customer ?? effectiveAdjustment(adjustmentDoc, now);
  const code = normalizeCode(text(input.couponCode, 50));
  const prior = history ? history.docs.map((d) => d.data()).filter((b) => b.status !== 'Cancelled' && b.status !== 'Rejected') : [];
  const onlineMasters: ServiceMasterDoc[] = servicesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const quotes = categories.docs
    .map((d) => ({ d, c: mapCategory(d.id, d.data()) }))
    .filter((x): x is { d: FirebaseFirestore.QueryDocumentSnapshot; c: NonNullable<ReturnType<typeof mapCategory>> } => x.c !== null)
    .sort((a, b) => a.c.displayOrder - b.c.displayOrder)
    .map(({ d, c }) => {
      const category = { ...c, tariffClass: d.data().tariffClass, dutyClass: d.data().dutyClass };
      const matched = matchAuthoritativeService(onlineMasters, { tripType, categoryId: c.id, distanceKm: route.distanceKm, pickupType: pickup.type, dropType: drop.type, context: 'customer' });
      const base = { boardingState, recipientState, recipientAddressState: recipientAddressState(customer?.data()), category, route: pricingRoute, tripType, pickup, drop, pickupAt: when, tripEndAt, tariff, adjustment, rentalHours: tripType === 'Local Rental' ? rentalHoursOf(input.rentalHours) : null, brand, fixedRoutes, localCityId, serviceId: matched?.id ?? '', multicity };
      try {
        assertCatalogAvailable(onlineMasters,tripType,category.id);
        assertBookable(rules, category.name);
        const before = priceBooking(base);
        if (before.usesCommissionPolicy) {
          const commission = resolveCommission(policy, { serviceId: matched?.id, categoryId: c.id });
          if (!commission) throw new HttpsError('failed-precondition', COMMISSION_NOT_CONFIGURED);
        }
        let couponMessage = '', discount = 0;
        if (code && coupons) {
          const r = validateCoupon(coupons.docs.map((x) => mapCoupon(x.id, x.data())), code, {
            subtotal: before.fare.subtotal, categoryId: c.id, service: before.service, isFirstBooking: prior.length === 0,
            customerUses: prior.filter((b) => normalizeCode(b.couponCode || '') === code).length,
            pickupAt: when, completedTrips: prior.filter((b) => b.status === 'Completed').length,
            pickupText: `${pickup.name} ${pickup.address ?? ''}`, dropText: `${drop.name} ${drop.address ?? ''}`,
            fixedRoute: before.pricing.model === 'city_drop_package' || before.pricing.model === 'fixed_route', peakAdjusted: adjustment?.direction === 'increase',
          });
          if (r.ok) { discount = r.coupon.discount; couponMessage = r.coupon.message; } else couponMessage = r.message;
        } else if (code) couponMessage = 'Sign in to apply this code.';
        const priced = discount > 0 ? priceBooking({ ...base, discount }) : before;
        // The same limit check a booking makes, so a quote the customer sees can always be booked.
        assertWithinLimits(rules, { categoryName: category.name, customerFare: priced.fare.total, partnerPayout: partnerPayoutRupees(adjustPartner(priced.pricing, rules)) });
        // The same trip on the CNG rate card, when this class has one and the fare came from the per-km tariff.
        let cng: { fare: typeof priced.fare; breakup: typeof priced.breakup; extraKmRate: number; strikeTotal?: number } | null = null;
        if (c.cngEnabled === true && (priced.pricing.model === 'one_way_standard' || priced.pricing.model === 'round_trip_calendar') && !input.fuelType) {
          try {
            const alt = priceBooking({ ...base, discount, fuel: 'cng' });
            cng = { fare: alt.fare, breakup: alt.breakup, extraKmRate: (alt.pricing.gstInclusiveBase?.extraKmRatePaise ?? alt.pricing.extraKmRatePaise) / 100, ...struck(alt.fare.total) };
          } catch { cng = null; }
        }
        return {
          cng,
          categoryId: c.id, ok: true as const, fare: priced.fare, breakup: priced.breakup, service: priced.service, ...struck(priced.fare.total),
          model: priced.pricing.model, days: priced.pricing.days, includedKm: priced.pricing.includedKm, rentalHours: priced.pricing.rentalHours ?? null,
          // The customer-facing extra-KM rate (as entered when the fare includes GST).
          extraKmRate: (priced.pricing.gstInclusiveBase?.extraKmRatePaise ?? priced.pricing.extraKmRatePaise) / 100, gstIncluded: priced.pricing.gstInFare === true, couponMessage, couponApplied: discount > 0,
        };
      } catch (e) {
        return { categoryId: c.id, ok: false as const, error: e instanceof HttpsError ? e.message : 'This category cannot be priced right now.' };
      }
    });
  return {
    route: { distanceKm: Math.round(route.distanceKm * 10) / 10, durationMin: Math.round(route.durationMin) },
    service: quotes.find((q) => q.ok)?.service ?? '',
    /** Limited service here: the office confirms the booking before it is accepted. */
    limitedAvailability: rules.availability === 'Limited',
    quotes,
  };
});


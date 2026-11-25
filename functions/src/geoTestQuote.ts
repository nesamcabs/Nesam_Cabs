// Test quote for Service & Fare Settings → Local & Rental Pricing. Prices a sample trip at a chosen place with the SAME function a booking
// uses (priceBooking): the location-scoped rates with inheritance, the scheduled peak rule for the pickup time (IST), the shared night
// allowance and platform fee, the saved GST policy, the global fare adjustment and the booking-rule price changes for that place.
// Nothing is saved and no booking is created. Inputs the admin cannot know in advance stay out: tolls are at actuals, and an airport
// entry fee applies only when the booked pickup or drop is the Airport record itself.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from './admin';
import { requireAction, requirePermission, text } from './shared';
import { scopeOf } from './geoFareAdmin';
import { STATE_NAMES } from './domain/pincodeLookup';
import { fareKeysOf, peakKeysOf, type PlaceScope } from './domain/geoScope';
import { geoChain, resolveLocal, type GeoService } from './domain/geoFares';
import { mapCategory } from './domain/pricing';
import type { GeoPlace } from './domain/types';
import { loadGeoDocs, loadPeakRules, resolvePlace, type GeoContext, type ResolvedPlace } from './geoPricing';
import { loadTariffConfig, priceBooking, tariffClassOf } from './quote';
import { evaluateRules, loadServiceRules, ruleServiceText } from './serviceRules';
import { effectiveAdjustment, loadFareAdjustment } from './fareConfig';
import { loadNightAllowance } from './nightAllowanceConfig';
import { loadPlatformFee } from './platformFeeConfig';
import { fareServiceKey } from './fareScope';
import { SUPPORTED_BRANDS } from './brandContext';

const bad = (m: string) => new HttpsError('invalid-argument', m);

export const testLocalQuote = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'view');
  const input = request.data ?? {};
  const brandKey = text(input.brand, 40) || 'common';
  if (brandKey !== 'common' && !(SUPPORTED_BRANDS as readonly string[]).includes(brandKey)) throw bad('Choose a brand.');
  const brand = brandKey === 'common' ? '' : brandKey;
  const service: GeoService = input.service === 'rental' ? 'rental' : input.service === 'local' ? 'local' : (() => { throw bad('Choose Local Pickup & Drop or Hourly Rental.'); })();
  const scope = await scopeOf(input.scope, ['district', 'zone', 'area']);
  const categoryId = text(input.categoryId, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(categoryId)) throw bad('Choose a vehicle.');
  const pickupMs = Date.parse(text(input.pickupAt, 40));
  if (!Number.isFinite(pickupMs)) throw bad('Enter the pickup date and time.');
  const km = Number(input.km), hours = Number(input.hours);
  if (service === 'local' && !(km > 0 && km <= 60)) throw bad('Enter a trip distance from 1 to 60 km.');
  if (service === 'rental' && !(Number.isInteger(hours) && hours >= 1 && hours <= 15)) throw bad('Choose a package from 1 to 15 hours.');

  // The place: the chosen record (and the records above it), or the zone / district itself.
  let resolved: ResolvedPlace;
  let pickupPlace: GeoPlace;
  if (scope.level === 'area') {
    resolved = await resolvePlace({ id: scope.locationId!, name: scope.label ?? '', address: '', lat: 0, lng: 0 } as GeoPlace);
    const l = (await db.doc(`locations/${scope.locationId}`).get()).data() ?? {};
    pickupPlace = {
      id: scope.locationId!, name: String(l.name ?? scope.label ?? ''), address: [l.name, resolved.district || scope.district, STATE_NAMES[scope.state], resolved.pincode].filter(Boolean).join(', '),
      type: l.type === 'Airport' ? 'airport' : 'other', lat: typeof l.lat === 'number' ? l.lat : 0, lng: typeof l.lng === 'number' ? l.lng : 0, pincode: resolved.pincode || undefined, state: STATE_NAMES[scope.state],
    } as GeoPlace;
  } else {
    const zone = scope.level === 'zone' ? (await db.doc(`locations/${scope.zoneId}`).get()).data() ?? {} : {};
    const pins = [...(Array.isArray(zone.pincodes) ? zone.pincodes : []), zone.pincode].filter((p): p is string => typeof p === 'string' && /^[1-9]\d{5}$/.test(p));
    resolved = { state: scope.state, district: scope.district, zoneId: scope.level === 'zone' ? scope.zoneId! : null, areaIds: [], airportIds: [], pincode: pins[0] ?? '' };
    pickupPlace = { id: 'pin', name: scope.label ?? scope.district, address: [scope.label, scope.district, STATE_NAMES[scope.state], pins[0]].filter(Boolean).join(', '), type: 'other', lat: 0, lng: 0, pincode: pins[0], state: STATE_NAMES[scope.state] } as GeoPlace;
  }
  const place: PlaceScope = { state: resolved.state || scope.state, district: resolved.district || scope.district, zoneId: resolved.zoneId, areaIds: resolved.areaIds };
  const keys = fareKeysOf(place);
  const chain = geoChain(brandKey, service, keys);
  const [docs, peakRules, tariff, catSnap, adjustmentDoc, serviceRules, nightAllowance, platformFee] = await Promise.all([
    loadGeoDocs(chain), loadPeakRules(), loadTariffConfig(), db.doc(`vehicle_categories/${categoryId}`).get(), loadFareAdjustment(), loadServiceRules(), loadNightAllowance(), loadPlatformFee(),
  ]);
  if (!tariff) throw new HttpsError('failed-precondition', 'The tariff has not been set up yet.');
  const mapped = catSnap.exists ? mapCategory(catSnap.id, catSnap.data()!) : null;
  if (!mapped) throw bad('That vehicle category no longer exists.');
  const category = { ...mapped, tariffClass: catSnap.data()!.tariffClass, dutyClass: catSnap.data()!.dutyClass };
  const cls = tariffClassOf(category);
  if (!cls) throw new HttpsError('failed-precondition', `${mapped.name} is not mapped to a vehicle class yet.`);

  const pickupResolved: ResolvedPlace = { ...resolved, ...place };
  const geo: GeoContext = { service, brand: brandKey, pickup: pickupResolved, drop: pickupResolved, keys, peakKeys: peakKeysOf(place), chain, docs, localEligible: true, peakRules };
  const tripType = service === 'rental' ? 'Local Rental' as const : 'One Way' as const;
  const route = { distanceKm: service === 'local' ? km : 1, durationMin: service === 'local' ? Math.round(km * 3) : hours * 60, path: [] as [number, number][], estimated: false };
  const when = new Date(pickupMs);
  const rules = evaluateRules(serviceRules, pickupPlace, pickupPlace, when, ruleServiceText(pickupPlace, pickupPlace, route.distanceKm, tripType), brand, fareServiceKey(tripType));
  const adjustment = rules.customer ?? effectiveAdjustment(adjustmentDoc, new Date());

  // Local: when the location rates are incomplete a real trip would use the older city fare or the One Way card; say what is missing.
  if (service === 'local') {
    const hit = resolveLocal(docs, chain, cls);
    if (!hit.complete) return { ok: false, availability: rules.availability, missing: hit.missing };
  }
  try {
    const priced = priceBooking({
      category, route, tripType, pickup: pickupPlace, drop: pickupPlace, pickupAt: when, tripEndAt: null, tariff, adjustment, brand, geo,
      rentalHours: service === 'rental' ? hours : null, platformFee, nightAllowance,
    });
    return {
      ok: true, availability: rules.availability, model: priced.pricing.model, total: priced.fare.total,
      lines: priced.breakup.lines.map((l) => ({ key: l.key, label: l.label, amount: l.amount, treatment: l.treatment, detail: l.detail ?? '' })),
      partnerPayout: priced.pricing.partner ? Math.round(priced.pricing.partner.basePaise) / 100 : null,
      peak: priced.pricing.peakCharge ? { name: priced.pricing.peakCharge.name, amount: priced.pricing.peakCharge.amount } : null,
      sources: priced.pricing.geoFare?.sources ?? null, keys,
    };
  } catch (e) {
    if (e instanceof HttpsError && e.code === 'failed-precondition') return { ok: false, availability: rules.availability, missing: [e.message] };
    throw e;
  }
});

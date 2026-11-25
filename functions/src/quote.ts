import { bookingAddOnsOf, withBookingAddOns, type BookingAddOns } from './domain/bookingAddOns';
import { withNightAllowance, type NightAllowanceConfig } from './domain/nightAllowance';
import { withHillCharge } from './domain/hillCharge';
import { detectHillStations, distinctHillStations, hillChargeForRates, placePincode, validPincode, type HillMatch } from './domain/hillStations';
import { withTripPincodes } from './placePincode';
import { cityByPincode, zoneByPincode, type PinCity } from './domain/pincodeLookup';
import { loadNightAllowance } from './nightAllowanceConfig';
import { withPlatformFee, type PlatformFeeConfig } from './domain/platformFee';
import { loadPlatformFee } from './platformFeeConfig';
import { fareBoardingState, recipientAddressState, recipientGstState } from './fareGstContext';
import { applyFareGst, fareGstFor, fareGstForScope, gstPricingInput, isDefaultFareGst } from './fareGstPricing';
import { fareServiceKey } from './fareScope';
// One pricing path for every booking source: customer app/web, Admin manual booking, the
// quote preview and the final invoice all go through priceBooking(). Every price comes from the
// admin panel (Service & Fare Settings, saved in business_config/tariff_v2, fixed route fares and
// rental packages). A trip the admin has not set a fare for is refused, never priced from a built-in number.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { PUBLIC_CALLABLE_ORIGINS } from './corsOrigins';
import { FieldValue, Timestamp, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { DutyClass, dutyClassOf } from './domain/eligibility';
import { buildTariffFareBreakup, FareBreakup, withExtraChargeLines } from './domain/fareBreakup';
import { hillRatesConfigured, scopedAddOnRates, scopedExtraChargesSnapshot, scopedHillRates } from './domain/scopedExtraCharges';
import { AdminDiscountInput, CATEGORY_GST_RATE, FareAdjustmentInput, isOutstation, serviceName } from './domain/pricing';
import {
  FixedRouteFare, completeAirportCngRates, completeAirportRates, defaultRentalHours, quoteAirport, PricingSnapshot, QuoteResult, TARIFF_CLASSES, TariffClass, TariffConfig, TariffError, cityDropFare, classRates, istDate, localFareIdFor, matchFixedRoute, paise,
  parseFixedRouteFare, parseTariffConfig, gstOn, quoteFixedRoute, quoteLocalPickupDrop, quoteOneWay, quoteRentalPackage, quoteRoundTrip, quoteRoundTripMini, quoteRoundTripOvernightCombo, r2, withinCityZone, scopedTariffForBrand,
  calendarDays, finalizeFare, multicityRatesFor, quoteMulticity, displayMarkupPercent, quoteRoundTripTimeBased, timeBasedContext,
} from './domain/tariff';
import { gstComponents } from './domain/gst';
import { multicityBookingAmounts } from './domain/multicitySnapshot';
import { FareBreakdown, GeoPlace, RideCategory, RouteInfo, TripType } from './domain/types';
import { requirePermission, text, requireAction } from './shared';
import { distanceKm as straightKm } from './domain/verification';
import { assertCatalogAvailable, matchAuthoritativeService, ServiceMasterDoc } from './onlineCatalog';
import { loadCommissionPolicy } from './commission';
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
  // Every vehicle category is priced from its own rates, found from its name and seats. A `tariffClass` saved on the category record (an
  // older "Priced as" setting) is ignored: it used to force SUV 7+1 and Innova onto the SUV 6+1 rates.
  const duty: DutyClass | null = dutyClassOf(category);
  if (!duty) return null;
  // A hatchback has its own rates (it used to share the Sedan's): recognised by the category's name.
  if (duty === 'sedan' && /(hatch|wagon\s?r|alto|i10|celerio|kwid|tiago|micro)/i.test(String(category.name ?? ''))) return 'hatchback';
  // Innova has its own class; until an Innova rate is saved it is priced at the SUV rate (see classRates).
  return duty === 'sedan' ? 'sedan' : duty === 'crysta' ? 'crysta' : duty === 'innova' ? 'innova' : duty === 'suv7' ? 'suv7' : 'suv';
}

/** An active City record from the location master, with its centre point (when saved). */
interface CityRecord { id: string; names: string[]; state: string; lat: number | null; lng: number | null; /** name / city / state as saved (any case), and pincodes saved on the record: see cityByPincode */ raw: PinCity }

// The active Cities change rarely; one read serves every quote on this instance for a few minutes.
const CITY_TTL_MS = 5 * 60 * 1000;
let cityCache: { at: number; cities: CityRecord[] } | null = null;
const norm = (v: unknown) => (typeof v === 'string' ? v : '').toLowerCase().replace(/[0-9]/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** The six-digit pincodes saved on a location record: its `pincodes` list, and the single `pincode` the Locations form has. */
function pincodesOfRecord(l: Record<string, unknown>): string[] {
  const list = Array.isArray(l.pincodes) ? l.pincodes : [];
  return [...new Set([...list, l.pincode].map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => /^[1-9]\d{5}$/.test(x)))];
}

async function activeCities(): Promise<CityRecord[]> {
  if (cityCache && Date.now() - cityCache.at < CITY_TTL_MS) return cityCache.cities;
  const snap = await db.collection('locations').where('type', '==', 'City').where('status', '==', 'Active').get();
  const cities = snap.docs.map((d) => {
    const l = d.data();
    const names = [...new Set([norm(l.name), norm(l.city), norm(l.normalizedName)].filter(Boolean))];
    return {
      id: d.id, names, state: norm(l.state), lat: Number.isFinite(l.lat) ? l.lat as number : null, lng: Number.isFinite(l.lng) ? l.lng as number : null,
      raw: { id: d.id, names: [...new Set([l.name, l.city].filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))], state: typeof l.state === 'string' ? l.state : '', pincodes: pincodesOfRecord(l) },
    };
  });
  cityCache = { at: Date.now(), cities };
  return cities;
}

/** How far a place may be from a City's centre and still count as that City when its address names the City. */
const NAMED_CITY_MAX_KM = 60;
/** How far a place may be from the nearest City's centre when its address names no City. */
const NEAREST_CITY_MAX_KM = 30;

/**
 * The City of a place that is not in the location master (a Google search result or a map pin): the active City
 * named in its address (", Chennai, Tamil Nadu 600017") and within NAMED_CITY_MAX_KM of that City's centre, else
 * the nearest City centre within NEAREST_CITY_MAX_KM. null when neither applies.
 */
async function cityByPlace(place: GeoPlace): Promise<string | null> {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return null;
  const cities = await activeCities();
  if (!cities.length) return null;
  const away = (c: CityRecord) => (c.lat === null || c.lng === null ? null : straightKm(place, { lat: c.lat, lng: c.lng }));
  const parts = new Set(String(place.address ?? '').split(',').map(norm).filter(Boolean));
  const stateHint = [...parts].find((x) => cities.some((c) => c.state && c.state === x)) ?? '';
  const named = cities
    .filter((c) => c.names.some((n) => parts.has(n)) && (!stateHint || !c.state || c.state === stateHint))
    .map((c) => ({ c, km: away(c) }))
    .filter((x) => x.km === null || x.km <= NAMED_CITY_MAX_KM)
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  if (named.length) return named[0]!.c.id;
  const nearest = cities
    .map((c) => ({ c, km: away(c) }))
    .filter((x): x is { c: CityRecord; km: number } => x.km !== null && x.km <= NEAREST_CITY_MAX_KM)
    .sort((a, b) => a.km - b.km);
  return nearest.length ? nearest[0]!.c.id : null;
}

/**
 * The canonical City record (`locations` id) a place belongs to: for a master location, the place itself when it is
 * a City, else the City found by walking `parentLocationId`, else the one active City with the same state and city
 * name. A Google place or a map pin (or a master location that cannot be resolved) is matched by cityByPlace.
 */
async function cityIdOf(place: GeoPlace): Promise<string | null> {
  if (place.id && place.id !== 'pin' && !place.id.startsWith('google-')) {
    let id = place.id;
    for (let hop = 0; hop < 4; hop++) {
      const snap = await db.doc(`locations/${id}`).get();
      const l = snap.data();
      if (!snap.exists || !l) break;
      if (l.type === 'City') return snap.id;
      if (typeof l.parentLocationId !== 'string' || !l.parentLocationId) break;
      id = l.parentLocationId;
    }
    const { city, state } = place as GeoPlace & { city?: string; state?: string };
    if (city) {
      const cities = await db.collection('locations').where('type', '==', 'City').where('status', '==', 'Active').where('city', '==', city).get();
      const same = cities.docs.filter((d) => !state || !d.data().state || d.data().state === state);
      if (same.length === 1) return same[0]!.id;
    }
  }
  return (await cityByPlacePincode(place)) ?? cityByPlace(place);
}

/**
 * The City a place's pincode belongs to (pincode saved on a City record, else India Post's district / town list), or null.
 * A pincode is the one thing every address carries, so it is tried before the name-in-address and distance guesses.
 */
async function cityByPlacePincode(place: GeoPlace): Promise<string | null> {
  const pin = placePincode(place as GeoPlace & { name?: string; address?: string });
  if (!pin) return null;
  return cityByPincode(pin, (await activeCities()).map((c) => c.raw));
}

/** An active zone ("Area / Locality") of the location master and the City it belongs to. */
interface ZoneRecord { id: string; names: string[]; parentId: string; cityNames: string[]; state: string; pincodes: string[] }
let zoneCache: { at: number; zones: ZoneRecord[] } | null = null;

async function activeZones(): Promise<ZoneRecord[]> {
  if (zoneCache && Date.now() - zoneCache.at < CITY_TTL_MS) return zoneCache.zones;
  const snap = await db.collection('locations').where('type', '==', 'Area / Locality').where('status', '==', 'Active').get();
  const zones = snap.docs.map((d) => {
    const l = d.data();
    return {
      id: d.id, names: [...new Set([norm(l.name), norm(l.area), norm(l.normalizedName)].filter(Boolean))],
      parentId: typeof l.parentLocationId === 'string' ? l.parentLocationId : '', cityNames: [norm(l.city)].filter(Boolean), state: norm(l.state), pincodes: pincodesOfRecord(l),
    };
  });
  zoneCache = { at: Date.now(), zones };
  return zones;
}

/**
 * The zone of the pickup inside its City, for zone Local Pickup & Drop rates: the master location the rider chose (or the
 * record above it) when it is one of the City's zones, else the one zone of that City named in the address. null when none.
 */
export async function zoneIdOf(place: GeoPlace, cityId: string): Promise<string | null> {
  const [zones, cities] = await Promise.all([activeZones(), activeCities()]);
  const city = cities.find((c) => c.id === cityId);
  if (!city) return null;
  const mine = zones.filter((z) => z.parentId === cityId || (!z.parentId && z.cityNames.some((n) => city.names.includes(n)) && (!z.state || !city.state || z.state === city.state)));
  if (!mine.length) return null;
  if (place.id && place.id !== 'pin' && !place.id.startsWith('google-')) {
    let id = place.id;
    for (let hop = 0; hop < 4; hop++) {
      if (mine.some((z) => z.id === id)) return id;
      const snap = await db.doc(`locations/${id}`).get();
      const l = snap.data();
      if (!snap.exists || !l || l.type === 'City' || typeof l.parentLocationId !== 'string' || !l.parentLocationId) break;
      id = l.parentLocationId;
    }
  }
  // A zone that lists the pickup's pincode wins over a zone found by name.
  const pin = placePincode(place as GeoPlace & { name?: string; address?: string });
  const byPin = pin ? zoneByPincode(pin, mine) : null;
  if (byPin) return byPin;
  const parts = new Set([String((place as GeoPlace & { name?: string }).name ?? ''), ...String(place.address ?? '').split(',')].map(norm).filter(Boolean));
  const named = mine.filter((z) => z.names.some((n) => parts.has(n)));
  return named.length === 1 ? named[0]!.id : null;
}

/** The City both places belong to, for Local Pickup & Drop pricing; null when they differ or cannot be resolved. */
export async function sharedCityId(pickup: GeoPlace, drop: GeoPlace): Promise<string | null> {
  const [a, b] = await Promise.all([cityIdOf(pickup), cityIdOf(drop)]);
  return a && a === b ? a : null;
}

/**
 * The booking-document fields of a time-based round trip: the return time the package implies, and a small public summary
 * (package, hour limit, coverage end, Morning Return 9 AM cutoff) the apps and the Morning Return reminders read.
 */
export function timePackageFields(tb: NonNullable<PricingSnapshot['timeBased']>, endDate: string | null, days: number): Record<string, unknown> {
  return {
    tripEndAt: Timestamp.fromMillis(tb.coverageEndMs), endDate, billableDays: days,
    timePackage: {
      id: tb.packageId, kind: tb.kind, label: tb.label, hours: tb.hours, includedKm: tb.base.includedKm, days: tb.days ?? days, ...(tb.dayKm ? { dayKm: tb.dayKm } : {}), autoDays: tb.autoDays === true,
      coverageEndAt: Timestamp.fromMillis(tb.coverageEndMs),
      ...(tb.morningCutoffMs ? { morningCutoffAt: Timestamp.fromMillis(tb.morningCutoffMs), upgradeLabel: tb.upgrade?.label ?? 'Next-Day Return', upgradeIncludedKm: tb.upgrade?.includedKm ?? 0, upgraded: false } : {}),
    },
  };
}

/** A full tariff save (older clients) replaces the round-trip rates; the separately edited time-based packages carry over unchanged. */
function keepTimeBased(next: TariffConfig['roundTrip'], before: TariffConfig['roundTrip'] | undefined): TariffConfig['roundTrip'] {
  if (!before) return next;
  const classes = { ...next.classes };
  for (const cls of TARIFF_CLASSES) {
    const keep = before.classes[cls]?.timeBased;
    if (classes[cls] && keep && !classes[cls]!.timeBased) classes[cls] = { ...classes[cls]!, timeBased: keep };
  }
  return { ...next, classes, ...(next.timeBased ?? before.timeBased ? { timeBased: next.timeBased ?? before.timeBased } : {}) };
}

/** Trip days of a request (1, 2, 3 …), or null when none were asked for. */
export function tripDaysOf(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 60) throw new HttpsError('invalid-argument', 'Choose the number of trip days (1 to 60).');
  return v;
}

/** Whole rental hours from a request, or null when none were asked for. */
export function rentalHoursOf(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 15) throw new HttpsError('invalid-argument', 'Choose rental hours from 1 to 15.');
  return v;
}

export interface PriceInput {
  addOns?: BookingAddOns;
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
  adminDiscount?: AdminDiscountInput | null;
  /** Canonical City both places belong to (see sharedCityId). Enables Local Pickup & Drop pricing. */
  localCityId?: string | null;
  /** The pickup's zone in that City (see zoneIdOf): its own Pickup & Drop rates win for a class that has them enabled. */
  localZoneId?: string | null;
  /** Local Rental only: the package the customer chose, in hours. */
  rentalHours?: number | null;
  /** Enabled fixed route fares and the booked service. Only places with canonical location ids (never a map pin) can match one. */
  fixedRoutes?: FixedRouteFare[];
  serviceId?: string;
  businessContract?: import('./domain/business').BusinessContract | null;
  /** 'cng' prices a One Way, Round Trip, Airport Taxi or Multicity trip on the class's CNG rate card. A result that is not
   * marked pricing.fuelType 'cng' was not priced on it. */
  fuel?: 'cng';
  /** Brand scope applied to price this booking. */
  brand?: string;
  /** A customer Multicity tour (a Round Trip through several cities): priced from the saved Multicity rates for the whole itinerary. */
  multicity?: boolean;
  /** The common platform fee settings (Pricing → Platform fee). Absent = no platform fee. */
  platformFee?: PlatformFeeConfig | null;
  /** The common night allowance setting (Pricing → Night allowance). Absent = none. */
  nightAllowance?: NightAllowanceConfig | null;
  /** Time-based Round Trip (Customer UX v7): the trip days the customer chose (the return time is never asked) and the package picked. */
  tripDays?: number | null;
  timePackage?: string;
  /** A customer booking (web / app): with the time-based round trip on, the return time follows the days and the package. Office bookings keep exact dates unless a package is named. */
  customerChannel?: boolean;
  /** The round trip's intermediate stops (hill stations are detected on the pickup, the stops and the drop). */
  stops?: GeoPlace[];
  /** Set by priceBooking: a hill station is on the trip (the 5-hour / 8-hour packages and the mini fares are not offered). */
  hillTrip?: boolean;
}

/**
 * The hill stations a One Way / Round Trip / Multicity pickup, stops and drop are in. Empty when it is another service, or when the fare
 * table has no hill station charge for this vehicle on this brand and service (hill stations are always on: the amounts decide).
 */
export function hillStationsOfTrip(i: Pick<PriceInput, 'tariff' | 'brand' | 'category' | 'tripType' | 'multicity' | 'pickup' | 'drop' | 'stops'>): HillMatch[] {
  if (!i.multicity && i.tripType !== 'One Way' && i.tripType !== 'Round Trip') return [];
  if (!scopedHillRates(i.tariff, i.brand || 'nesam', i.multicity ? 'Multicity' : i.tripType, tariffClassOf(i.category), i.category.id)) return [];
  // Hill stations are found by pincode: the place's own, or the one written in its address (placePincode.ts fills a bare pin in).
  const at = (p: GeoPlace, role: 'pickup' | 'stop' | 'drop') => ({ role, name: p.name, address: p.address, pincode: p.pincode });
  return detectHillStations([at(i.pickup, 'pickup'), ...(i.stops ?? []).map((p) => at(p, 'stop')), at(i.drop, 'drop')], i.tariff?.hillStation);
}

export interface PriceResult {
  fare: FareBreakdown;
  breakup: FareBreakup;
  pricing: PricingSnapshot;
  service: string;
  outstation: boolean;
  /** true when a percentage commission would apply (older category pricing). */
  usesCommissionPolicy: boolean;
  /** Hill stations found on the trip, and whether a Hill Station Allowance / Charge was added for them. */
  hill?: { stations: { id: string; name: string; tamil: string }[]; matches: HillMatch[]; charged: boolean };
}

/**
 * Throws HttpsError for anything the confirmed tariff cannot price (never invents a number). Whatever path prices the trip, the
 * quote also records the category's extra-charge rates (waiting, hill, roof carrier — customer and partner) in its snapshot and
 * discloses them in the breakup. The fare itself is unchanged: these are billed only for the extras actually used.
 */
/** The roof carrier and pet rates a customer sees and is billed for this trip (see scopedAddOnRates). */
export function addOnRatesOf(i: Pick<PriceInput, 'tariff' | 'brand' | 'tripType' | 'multicity' | 'category'>): { carrier: number; pet: number; partnerPet: number } {
  return scopedAddOnRates(i.tariff ?? null, i.brand, i.multicity ? 'Multicity' : i.tripType, tariffClassOf(i.category));
}

export function priceBooking(i: PriceInput): PriceResult {
  const matches = hillStationsOfTrip(i);
  const night = withNightAllowance(priceBookingWithoutAddOns(matches.length ? { ...i, hillTrip: true } : i), i.pickupAt, i.nightAllowance, tariffClassOf(i.category));
  // Hill Station Allowance / Charge: its own line, from the "Hill station" rows of the fare table for this brand, service and vehicle
  // (see domain/hillStations.ts).
  const slab = i.multicity ? 'multicity' : i.tripType === 'Round Trip' ? 'roundTrip' : 'oneWay';
  const charge = !matches.length ? null
    : hillChargeForRates(i.tariff?.hillStation, scopedHillRates(i.tariff, i.brand || 'nesam', i.multicity ? 'Multicity' : i.tripType, tariffClassOf(i.category), i.category.id), matches, slab);
  const priced = withHillCharge(night, charge);
  const add = addOnRatesOf(i);
  const withAddOns = withBookingAddOns(priced, i.addOns, { carrierCharge: add.carrier }, add.pet, add.partnerPet);
  const result = withPlatformFee(withAddOns, i.platformFee, i.multicity);
  return matches.length ? { ...result, hill: { stations: distinctHillStations(matches), matches, charged: !!charge } } : result;
}

function priceBookingWithoutAddOns(i: PriceInput): PriceResult {
  if (i.multicity) {
    const tour = priceMulticityTour(i);
    const extras = scopedExtraChargesSnapshot(i.tariff, i.brand, 'Multicity', tariffClassOf(i.category), i.category.id);
    return extras ? { ...tour, pricing: { ...tour.pricing, extraCharges: extras }, breakup: withExtraChargeLines(tour.breakup, extras) } : tour;
  }
  const tax = fareGstFor(i);
  const raw = priceBookingCore(tax ? gstPricingInput(i, tax, tariffClassOf(i.category)) : i);
  // A rental package keeps its own "GST included / GST added" setting (shown on the admin's Local fares) unless a Fare
  // GST rule is saved for the service, which always wins. Without this a package entered as ₹1,500 + GST was charged ₹1,500.
  const rentalMode = (() => {
    if (!tax || !isDefaultFareGst(tax) || raw.pricing.model !== 'rental_package' || !i.tariff) return undefined;
    const klass = tariffClassOf(i.category), hours = raw.pricing.rentalHours;
    if (!klass || hours == null) return undefined;
    return scopedTariffForBrand(i.tariff, i.brand, i.tripType, klass).rentalPackages?.[klass]?.packages?.[String(hours)]?.gstMode;
  })();
  const explicitMode = i.businessContract?.rule.gstMode ?? i.fixedRoutes?.find(rule => rule.id === raw.pricing.fixedRouteId)?.gstMode ?? rentalMode;
  const r = tax ? applyFareGst(raw, explicitMode ? { ...tax, mode: explicitMode } : tax) : raw;
  if (tax) r.pricing.brandScoped = !!(i.brand && i.tariff?.brandOverrides?.[i.brand]);
  if (tax) {
    const outstation = ['rental_package', 'local_pickup_drop', 'airport_transfer'].includes(r.pricing.model) ? false : r.outstation;
    r.breakup = buildTariffFareBreakup(r.fare, outstation, r.pricing);
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
  const rates = multicityRatesFor(tariff, brand, cls, i.fuel);
  if (!rates && i.fuel === 'cng') throw new HttpsError('failed-precondition', 'CNG is not available for this vehicle.', { code: 'cng-unavailable' });
  if (!rates) throw new HttpsError('failed-precondition', 'Multicity fares are not available for this vehicle yet.');
  const pickupMs = i.pickupAt.getTime();
  const endMs = i.tripEndAt ? i.tripEndAt.getTime() : pickupMs;
  const days = calendarDays(pickupMs, endMs);
  if (days === null) throw new HttpsError('failed-precondition', 'The tour end must be on or after pickup and within the supported tour duration.');
  const tax = fareGstForScope({ tariff, brand, service: 'Multicity', boardingState: i.boardingState, recipientState: i.recipientState, recipientAddressState: i.recipientAddressState });
  const q = quoteMulticity({ rates, totalKm: i.route.distanceKm, days, gstRate: tax ? tax.rate : tariff.gstRate, gstIncluded: tax?.mode === 'included' });
  const amounts = multicityBookingAmounts(q, { tariffVersion: tariff.version, tariffClass: cls, brand, pickupMs, endMs, durationMin: Math.round(i.route.durationMin), gst: tax, fuel: i.fuel });
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
  return { fare, pricing, service: 'Multicity', outstation: true, breakup: buildTariffFareBreakup(fare, true, pricing), usesCommissionPolicy: false };
}

function priceBookingCore(i: PriceInput): PriceResult {
  const effectiveTariff = i.tariff ? scopedTariffForBrand(i.tariff, i.brand, i.tripType, tariffClassOf(i.category)) : null;
  const outstation = isOutstation(i.route.distanceKm);
  const service = serviceName(i.pickup, i.drop, i.route.distanceKm, i.tripType);
  const klass = tariffClassOf(i.category);
  const cfg = effectiveTariff;
  // Round Trip, One Way and Airport Taxi trips that no more specific admin fare priced above (an enabled fixed route, Local Pickup & Drop
  // city or zone fare, city-drop zone, or complete Airport Taxi fares) use the admin One Way / Round Trip rate card.
  const useTariff = !!cfg && !!klass && (i.tripType === 'Round Trip' || i.tripType === 'One Way' || i.tripType === 'Airport Taxi');

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
    return { fare: q.fare, pricing: { ...q.pricing, brand: i.brand, brandScoped: !!(i.brand && i.tariff?.brandOverrides?.[i.brand]) }, service, outstation, breakup: buildTariffFareBreakup(q.fare, outstation, q.pricing), usesCommissionPolicy: false };
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
      return { fare: q.fare, pricing: { ...q.pricing, brand: i.brand, brandScoped: !!(i.brand && i.tariff?.brandOverrides?.[i.brand]) }, service, outstation, breakup: buildTariffFareBreakup(q.fare, false, q.pricing), usesCommissionPolicy: false };
    } catch (e) {
      if (e instanceof TariffError) throw new HttpsError('failed-precondition', e.message, { code: e.code });
      throw e;
    }
  }
  // A One Way trip inside one City (within the outstation threshold) takes that City's fare, even when one end is the
  // city's airport: the rider chose Pickup & Drop, and Airport Taxi is priced as its own service (tripType 'Airport Taxi').
  // The pickup zone's own rates for this class when enabled, else the City's.
  const localId = effectiveTariff && klass ? localFareIdFor(effectiveTariff, i.localCityId, i.localZoneId, klass) : null;
  if (effectiveTariff && klass && localId && i.tripType === 'One Way' && !outstation) {
    const tariff = effectiveTariff, cityId = localId;
    const q = withDiscounts((discount) => quoteLocalPickupDrop({ config: tariff, tariffClass: klass, tripType: 'One Way', cityId, discount, ...timing, ...adjust }));
    return { fare: q.fare, pricing: { ...q.pricing, brand: i.brand, brandScoped: !!(i.brand && i.tariff?.brandOverrides?.[i.brand]) }, service, outstation, breakup: buildTariffFareBreakup(q.fare, false, q.pricing), usesCommissionPolicy: false };
  }

  // Airport transfer: base fare for the included KM plus the extra-KM rate, once every Airport Taxi rate is saved for this
  // class (Common or brand). Until then the trip keeps the vehicle-category fare below.
  const airportRates = cfg && klass && i.tripType === 'Airport Taxi' ? completeAirportRates(cfg, klass) : null;
  if (cfg && klass && airportRates) {
    const rates = i.fuel === 'cng' ? completeAirportCngRates(cfg, klass) : airportRates;
    if (!rates) throw new HttpsError('failed-precondition', 'CNG is not available for this vehicle.', { code: 'cng-unavailable' });
    const q = withDiscounts((discount) => quoteAirport({ config: cfg, tariffClass: klass, tripType: 'One Way', rates, discount, fuel: i.fuel, ...timing, ...adjust }));
    return { fare: q.fare, pricing: { ...q.pricing, brand: i.brand, brandScoped: !!(i.brand && i.tariff?.brandOverrides?.[i.brand]) }, service, outstation, breakup: buildTariffFareBreakup(q.fare, false, q.pricing), usesCommissionPolicy: false };
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
      return { fare, pricing, service: 'City drop', outstation: false, breakup: buildTariffFareBreakup(fare, false, pricing), usesCommissionPolicy: false };
    }
  }

  if (cfg && !klass) {
    throw new HttpsError('failed-precondition', `${i.category.name} is not mapped to a tariff class yet. An admin must set its vehicle class.`);
  }
  if (useTariff && cfg && klass) {
    try {
      const run = (discount: number) => {
        if (i.tripType !== 'Round Trip') {
          return quoteOneWay({
            config: cfg, tariffClass: klass, tripType: 'One Way', routeKm: i.route.distanceKm, durationMin: i.route.durationMin,
            pickupMs: i.pickupAt.getTime(), endMs: null, discount,
            adjustmentPercent: i.adjustment?.percent ?? 0, adjustmentDirection: i.adjustment?.direction, fuel: i.fuel,
          });
        }
        const roundTripInput = {
          config: cfg, tariffClass: klass, tripType: 'Round Trip' as const, routeKm: i.route.distanceKm, durationMin: i.route.durationMin,
          pickupMs: i.pickupAt.getTime(), endMs: i.tripEndAt ? i.tripEndAt.getTime() : null, discount,
          adjustmentPercent: i.adjustment?.percent ?? 0, adjustmentDirection: i.adjustment?.direction, fuel: i.fuel,
        };
        // Time-based round trip (Customer UX v7): customers choose days, never a return time; an office booking uses it when a package is named.
        if (klass && timeBasedContext(cfg, klass) && (i.customerChannel || i.timePackage)) {
          const days = i.tripDays ?? (i.tripEndAt ? calendarDays(i.pickupAt.getTime(), i.tripEndAt.getTime()) : null) ?? 1;
          return quoteRoundTripTimeBased({ ...roundTripInput, fuel: undefined, tripDays: days, timePackage: i.timePackage, hill: i.hillTrip === true });
        }
        // Hill stations never use the short same-day / evening mini fares: straight to the standard package.
        if (i.hillTrip) return quoteRoundTrip(roundTripInput);
        // A short same-day trip or an evening-to-morning combo auto-upgrades to the standard calendar
        // package the moment it runs past the mini slab's hour/km limits (both return null then).
        return quoteRoundTripMini(roundTripInput) ?? quoteRoundTripOvernightCombo(roundTripInput) ?? quoteRoundTrip(roundTripInput);
      };
      const q = withDiscounts(run);
      return {
        fare: q.fare, pricing: { ...q.pricing, brand: i.brand, brandScoped: !!(i.brand && i.tariff?.brandOverrides?.[i.brand]) }, service, outstation,
        breakup: buildTariffFareBreakup(q.fare, outstation || i.tripType === 'Round Trip', q.pricing),
        usesCommissionPolicy: false,
      };
    } catch (e) {
      if (e instanceof TariffError) throw new HttpsError('failed-precondition', e.message, { code: e.code });
      throw e;
    }
  }

  // Nothing the admin panel has set prices this trip: it is refused, never priced from a built-in number.
  throw new HttpsError('failed-precondition', `${i.category.name} is not available for this trip yet.`, { code: 'rate-missing' });
}

// ── Admin: save the tariff configuration ────────────────────────────────────

/**
 * Saves business_config/tariff_v2 (the whole rate card) from the admin panel. A change applies to NEW bookings
 * only — a confirmed booking keeps the pricing snapshot it was quoted with.
 */
export const saveTariffConfig = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const submitted = parseTariffConfig({ ...input, version: 0 });
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
    // A full save replaces the one-way / round-trip / rental / city-drop rates only; the
    // outstation extras, airport fare, Local Pickup & Drop fares and rental packages keep their saved values.
    const parsed: TariffConfig = {
      ...submitted,
      ...(submitted.outstationExtras ?? before?.outstationExtras ? { outstationExtras: submitted.outstationExtras ?? before?.outstationExtras } : {}),
      ...(submitted.oneWayExtras ?? before?.oneWayExtras ? { oneWayExtras: submitted.oneWayExtras ?? before?.oneWayExtras } : {}),
      ...(submitted.roundTripExtras ?? before?.roundTripExtras ? { roundTripExtras: submitted.roundTripExtras ?? before?.roundTripExtras } : {}),
      ...(submitted.airport ?? before?.airport ? { airport: submitted.airport ?? before?.airport } : {}),
      ...(submitted.localPickupDrop ?? before?.localPickupDrop ? { localPickupDrop: submitted.localPickupDrop ?? before?.localPickupDrop } : {}),
      ...(submitted.rentalPackages ?? before?.rentalPackages ? { rentalPackages: submitted.rentalPackages ?? before?.rentalPackages } : {}),
      // The time-based round trip packages are edited only by their own section: a full tariff save never drops them.
      roundTrip: keepTimeBased(submitted.roundTrip, before?.roundTrip),
      // The extra-charge rates are edited only by their own section: a full tariff save never drops them.
      ...(before?.extraCharges ? { extraCharges: before.extraCharges } : {}),
      // The hill station slabs are edited only by their own section too.
      ...(before?.hillStation ? { hillStation: before.hillStation } : {}),
      ...(before?.displayMarkup ? { displayMarkup: before.displayMarkup } : {}),
    };
    const version = (before?.version ?? 0) + 1;
    tx.set(ref, { ...parsed, version, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, { action: 'tariff_saved', entity: 'tariff', entityId: 'v2', performedBy: actor.uid, performedByName: actor.name, role: 'admin', previous: before ? { version: before.version } : null, next: { version }, reason });
    return { version };
  });
});

// ── Customer: authoritative quotes for every bookable category ──────────────

import { mapCategory, mapCoupon, normalizeCode, validateCoupon } from './domain/pricing';
import { FAST, WARM } from './hotOptions';
import { bookingWindowFrom, parsePickupInstant, pickupWindowProblem } from './domain/advanceBooking';
import { effectiveAdjustment, loadFareAdjustment } from './fareConfig';
import { adjustPartner, assertBookable, assertWithinLimits, evaluateRules, loadServiceRules, partnerPayoutRupees, ruleServiceText } from './serviceRules';
import { approved, inIndia, roundTripPricingRoute, routeThrough } from './shared';
import { requestIp } from './security';
import { rateLimited } from './http/util';

function placeOf(v: any, role: string): GeoPlace {
  if (!v || !inIndia(v.lat, v.lng)) throw new HttpsError('invalid-argument', `Choose a valid ${role} location in India.`);
  const pincode = validPincode(v.pincode);
  return { id: 'pin', name: text(v.name, 120), address: text(v.address), lat: v.lat, lng: v.lng, type: v.type === 'airport' ? 'airport' : 'other', ...(pincode ? { pincode } : {}) };
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
export async function customerFareContext(tripType: TripType, pickup: GeoPlace, drop: GeoPlace, distanceKm: number): Promise<{ fixedRoutes: FixedRouteFare[]; localCityId: string | null; localZoneId: string | null }> {
  const masters = pickup.id !== 'pin' && drop.id !== 'pin';
  const [fixedRoutes, localCityId] = await Promise.all([
    tripType === 'One Way' && masters ? loadFixedRoutes() : Promise.resolve([]),
    // Any place can be in a City (a master location, a Google search result or a map pin): see cityIdOf.
    tripType === 'One Way' && !isOutstation(distanceKm) ? sharedCityId(pickup, drop) : Promise.resolve(null),
  ]);
  const localZoneId = localCityId ? await zoneIdOf(pickup, localCityId) : null;
  return { fixedRoutes, localCityId, localZoneId };
}

/**
 * The fare the customer will be charged, for each active vehicle category, computed by the same
 * priceBooking() createBooking uses — so what the customer reviews is what is booked. Nothing is
 * written. The pickup time matters (night charge, calendar days), so it is validated like a booking.
 */
export const quoteBooking = onCall({ timeoutSeconds: 60, cors: PUBLIC_CALLABLE_ORIGINS, ...WARM }, async (request) => {
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
  let [pickup, drop, ...stops] = await Promise.all([
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
      loadPlatformFee(),
      loadNightAllowance(),
    ]),
  );
  const window = bookingWindowFrom((await operationsRead).data());
  const problem = pickupWindowProblem(when, now, window);
  if (problem || !when) throw new HttpsError('invalid-argument', problem || 'Choose the pickup date and time.');
  const tripEndAt = tripType === 'Round Trip' ? parsePickupInstant(input.tripEndAt) : null;
  const tripDays = tripType === 'Round Trip' && !multicity ? tripDaysOf(input.tripDays) : null;
  const route = await routeLookup;
  // A Multicity tour is billed on the whole itinerary, even when it ends where it began.
  const pricingRoute = multicity ? route : await roundTripPricingRoute(route, tripType, pickup, drop, stops.length);
  const [{ fixedRoutes, localCityId, localZoneId }, customer] = await Promise.all([customerFareContext(tripType, pickup, drop, route.distanceKm), customerRead]);
  if (customer?.exists && !approved(customer.data()!.status)) throw new HttpsError('permission-denied', 'Your account is not active.');
  // A coupon is only checked for an existing customer account.
  const customerId = customer?.exists ? uid : null;
  const [categories, tariff, adjustmentDoc, couponsRead, historyRead, serviceRules, policy, servicesSnap, platformFee, nightAllowance] = await catalogue;
  // Hill stations are detected from each place's pincode; a pin with none in its address is looked up (only when hill stations are on).
  ({ pickup, drop, stops } = await withTripPincodes({ hillEnabled: hillRatesConfigured(tariff), tripType, multicity, pickup, drop, stops }));
  // A coupon is only checked for an existing customer account.
  const coupons = customerId ? couponsRead : null;
  const history = customerId ? historyRead : null;
  const boardingState = await fareBoardingState(tariff, pickup, input.pickup?.id);
  const recipientState = recipientGstState(customer?.data());
  // Display only: the % shown as a higher struck-out price above each fare. The fare itself is never changed by it.
  const strikePercent = displayMarkupPercent(tariff, brand, multicity ? 'Multicity' : fareServiceKey(tripType));
  const struck = (total: number) => (strikePercent > 0 ? { strikeTotal: Math.round(total * (1 + strikePercent / 100)) } : {});
  const evalRules = (pkg?: string) => evaluateRules(serviceRules, pickup, drop, when, multicity ? 'Multicity' : ruleServiceText(pickup, drop, route.distanceKm, tripType), brand, multicity ? 'Multicity' : fareServiceKey(tripType), itinerary, pkg);
  const rules = evalRules();
  const packageRules = serviceRules.some((r) => r.packages?.length);
  const defaultAdjustment = effectiveAdjustment(adjustmentDoc, now);
  const adjustment = rules.customer ?? defaultAdjustment;
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
      const base = { addOns: bookingAddOnsOf(input.addOns), boardingState, recipientState, recipientAddressState: recipientAddressState(customer?.data()), category, route: pricingRoute, tripType, pickup, drop, pickupAt: when, tripEndAt, tariff, adjustment, rentalHours: tripType === 'Local Rental' ? rentalHoursOf(input.rentalHours) : null, brand, fixedRoutes, localCityId, localZoneId, serviceId: matched?.id ?? '', multicity, platformFee, nightAllowance, tripDays, customerChannel: true, stops, timePackage: typeof input.timePackage === 'string' ? input.timePackage : undefined };
      try {
        assertCatalogAvailable(onlineMasters,tripType,category.id);
        assertBookable(rules, category.name);
        // Prices one package of this category (coupon and limits included): the same path createBooking takes.
        const priceOne = (timePackage?: string) => {
          // A price change may be limited to some packages: each package is priced with exactly its own rules.
          const pr = packageRules && timePackage ? evalRules(timePackage) : rules;
          const b = timePackage ? { ...base, timePackage, adjustment: pr.customer ?? defaultAdjustment } : base;
          const before = priceBooking(b);
          let couponMessage = '', discount = 0;
          if (code && coupons) {
            const r = validateCoupon(coupons.docs.map((x) => mapCoupon(x.id, x.data())), code, {
              subtotal: before.fare.subtotal, categoryId: c.id, service: before.service, isFirstBooking: prior.length === 0,
              customerUses: prior.filter((bk) => normalizeCode(bk.couponCode || '') === code).length,
              pickupAt: when, completedTrips: prior.filter((bk) => bk.status === 'Completed').length,
              pickupText: `${pickup.name} ${pickup.address ?? ''}`, dropText: `${drop.name} ${drop.address ?? ''}`,
              fixedRoute: before.pricing.model === 'city_drop_package' || before.pricing.model === 'fixed_route', peakAdjusted: b.adjustment?.direction === 'increase',
            });
            if (r.ok) { discount = r.coupon.discount; couponMessage = r.coupon.message; } else couponMessage = r.message;
          } else if (code) couponMessage = 'Sign in to apply this code.';
          const priced = discount > 0 ? priceBooking({ ...b, discount }) : before;
          assertWithinLimits(pr, { categoryName: category.name, customerFare: priced.fare.total, partnerPayout: partnerPayoutRupees(adjustPartner(priced.pricing, pr)) });
          return { before, priced, discount, couponMessage };
        };
        let first = priceOne(base.timePackage);
        // No package chosen yet: the cheapest was priced with the all-packages rules; price it again with its own.
        if (packageRules && !base.timePackage && first.priced.pricing.timeBased) first = priceOne(first.priced.pricing.timeBased.packageId);
        const before = first.before;
        let couponMessage = first.couponMessage, discount = first.discount;
        const priced = first.priced;
        // The same trip on the CNG rate card, when this class has one and the fare came from the per-km tariff.
        let cng: { fare: typeof priced.fare; breakup: typeof priced.breakup; extraKmRate: number; strikeTotal?: number } | null = null;
        if (c.cngEnabled === true && (priced.pricing.model === 'one_way_standard' || priced.pricing.model === 'round_trip_calendar' || priced.pricing.model === 'airport_transfer') && !input.fuelType) {
          try {
            const alt = priceBooking({ ...base, discount, fuel: 'cng' });
            cng = { fare: alt.fare, breakup: alt.breakup, extraKmRate: (alt.pricing.gstInclusiveBase?.extraKmRatePaise ?? alt.pricing.extraKmRatePaise) / 100, ...struck(alt.fare.total) };
          } catch { cng = null; }
        }
        // Time-based round trip: every package this pickup time and route allows, priced the same way (the customer picks one).
        let packages: Array<Record<string, unknown>> | undefined;
        if (priced.pricing.timeBased) {
          packages = [];
          const lim = priced.pricing.timeBased.limits;
          const shortIds = [
            { id: 'same:eight', h: lim.eightHours }, { id: 'same:five', h: lim.fiveHours },
            ...(lim.extra ?? []).map((x) => ({ id: `same:h${x.hours}`, h: x.hours })),
          ].sort((a, b) => b.h - a.h).map((x) => x.id);
          for (const id of [...shortIds, 'same:full', 'morning', 'next']) {
            try {
              const one = id === priced.pricing.timeBased.packageId ? first : priceOne(id);
              const tb = one.priced.pricing.timeBased!;
              const up = tb.upgrade;
              packages.push({
                id, kind: tb.kind, label: tb.label, hours: tb.hours, includedKm: tb.base.includedKm, days: one.priced.pricing.days, ...(tb.dayKm ? { dayKm: tb.dayKm } : {}),
                fare: one.priced.fare, breakup: one.priced.breakup, couponMessage: one.couponMessage, couponApplied: one.discount > 0,
                endAt: new Date(tb.coverageEndMs).toISOString(), extraKmRate: one.priced.pricing.extraKmRatePaise / 100, ...struck(one.priced.fare.total),
                ...(tb.morningCutoffMs ? { morningCutoffAt: new Date(tb.morningCutoffMs).toISOString() } : {}),
                ...(up ? { upgrade: { label: up.label, includedKm: up.includedKm, packageFare: up.farePaise / 100, increase: (up.farePaise - tb.base.farePaise) / 100 } } : {}),
              });
            } catch { /* this package is not offered for this pickup time, route or category */ }
          }
        }
        return {
          cng,
          ...(packages ? { packages, autoDays: priced.pricing.timeBased?.autoDays === true, selectedPackage: priced.pricing.timeBased?.packageId } : {}),
          ...(priced.hill ? { hill: { stations: priced.hill.stations, charged: priced.hill.charged, amount: priced.pricing.hillStation ? (priced.pricing.hillStation.grossAmount ?? priced.pricing.hillStation.amount) : 0 } } : {}),
          categoryId: c.id, addOnRates: (() => { const r = addOnRatesOf({ tariff, brand, tripType, multicity, category }); return { carrierCharge: r.carrier, petCharge: r.pet }; })(), ok: true as const, fare: priced.fare, breakup: priced.breakup, service: priced.service, ...struck(priced.fare.total),
          model: priced.pricing.model, days: priced.pricing.days, includedKm: priced.pricing.includedKm, rentalHours: priced.pricing.rentalHours ?? null,
          // The customer-facing extra-KM rate (as entered when the fare includes GST).
          extraKmRate: (priced.pricing.gstInclusiveBase?.extraKmRatePaise ?? priced.pricing.extraKmRatePaise) / 100, gstIncluded: priced.pricing.gstInFare === true, couponMessage, couponApplied: discount > 0,
        };
      } catch (e) {
        const detail = e instanceof HttpsError ? (e.details as { code?: string } | undefined)?.code : undefined;
        return { categoryId: c.id, ok: false as const, error: e instanceof HttpsError ? e.message : 'This category cannot be priced right now.', ...(detail ? { code: detail } : {}) };
      }
    });
  // The whole journey the fare is based on: a round trip drives out through its stops and back (pricing doubles
  // pricingRoute); a one-way or Multicity trip is the itinerary itself. Customer screens show this distance.
  const tripFactor = !multicity && tripType === 'Round Trip' ? 2 : 1;
  const tripRoute = !multicity && tripType === 'Round Trip' ? pricingRoute : route;
  return {
    route: { distanceKm: Math.round(route.distanceKm * 10) / 10, durationMin: Math.round(route.durationMin) },
    trip: { distanceKm: Math.round(tripRoute.distanceKm * tripFactor * 10) / 10, durationMin: Math.round(tripRoute.durationMin * tripFactor) },
    service: quotes.find((q) => q.ok)?.service ?? '',
    /** Hill stations found on the pickup, stops and drop (the 5-hour / 8-hour packages are not offered for them). */
    hillStations: (quotes.find((q) => q.ok && 'hill' in q && q.hill) as { hill?: { stations: unknown } } | undefined)?.hill?.stations ?? [],
    /** Limited service here: the office confirms the booking before it is accepted. */
    limitedAvailability: rules.availability === 'Limited',
    quotes,
  };
});


// The booking being put together across the three steps (plan → choose → review),
// plus the live data every step prices with: bookable categories, the global fare
// adjustment and coupons. Subscribed once for the session so moving between steps
// (or editing an earlier one) never re-reads them or loses the draft; the draft
// survives a page reload for the length of the tab.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppliedCoupon, Coupon, FareBreakdown, GeoPlace, RideCategory, RouteInfo } from '@core/types';
import {
  calculateFare,
  hasEstimate,
  isOutstation,
  serviceName,
  subscribeToCoupons,
  subscribeToFareAdjustment,
  subscribeToRideCategories,
  validateCoupon,
  type CouponResult,
  type FareAdjustment,
  type RideCategoryStatus,
} from '@core/services/pricingService';
import { getRoute } from '@core/services/geoService';
import { loadDraft, saveDraft, type BookingDraft } from '@/lib/draft';
import { BookingCtx } from './bookingContext';
import { useServerQuotes, type ServerQuoteState } from '@core/hooks/useServerQuotes';
import type { HillStationInfo, ServerCategoryQuote, ServerTimePackage } from '@core/services/quoteService';
import { scheduleProblem } from '@core/utils/bookingRules';
import { requestedTripDays } from '@core/utils/timePackages';
import { useCustomerData } from '@core/context/CustomerData';
import { useAuth } from '@/state/Auth';

export type { BookingDraft };

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface BookingValue {
  draft: BookingDraft;
  update: (patch: Partial<BookingDraft> | ((d: BookingDraft) => Partial<BookingDraft>)) => void;
  /** After a booking: clears the destination, schedule and notes (pickup and preferences stay). */
  reset: () => void;
  /** Starts a fresh draft from a previous trip's places. */
  startFrom: (pickup: GeoPlace, drop: GeoPlace) => void;
  route: RouteInfo | null;
  routeStatus: RouteStatus;
  retryRoute: () => void;
  categories: RideCategory[];
  categoryStatus: RideCategoryStatus;
  adjustment: FareAdjustment | null;
  coupons: Coupon[];
  /** The booking server's own quotes for this trip (the only fare that can be booked). */
  serverQuote: ServerQuoteState;
}

const Ctx = BookingCtx;

export function useBooking(): BookingValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('BookingProvider is missing');
  return v;
}

export const routeKeyOf = (pickup: GeoPlace | null, drop: GeoPlace | null, stops: GeoPlace[] = []) => pickup && drop ? [pickup, ...stops, drop].map((p) => `${p.lat},${p.lng}`).join('>') : '';

export function BookingProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<BookingDraft>(loadDraft);
  const [routeState, setRouteState] = useState<{ key: string; info: RouteInfo | null; error: boolean }>({ key: '', info: null, error: false });
  const [routeTry, setRouteTry] = useState(0);
  const [categories, setCategories] = useState<RideCategory[]>([]);
  const [categoryStatus, setCategoryStatus] = useState<RideCategoryStatus>('loading');
  const [adjustment, setAdjustment] = useState<FareAdjustment | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  useEffect(() => saveDraft(draft), [draft]);

  useEffect(
    () =>
      subscribeToRideCategories((cats, status) => {
        setCategories(cats);
        setCategoryStatus(status);
        // Keep the rider's choice while it is still bookable; otherwise pre-select one.
        setDraft((d) => (cats.some((c) => c.id === d.categoryId) ? d : { ...d, categoryId: cats[Math.min(1, cats.length - 1)]?.id ?? '' }));
      }),
    [],
  );
  useEffect(() => subscribeToFareAdjustment(setAdjustment), []);
  useEffect(() => subscribeToCoupons(setCoupons), []);

  const update = useCallback<BookingValue['update']>(
    (patch) => setDraft((d) => ({ ...d, ...(typeof patch === 'function' ? patch(d) : patch) })),
    [],
  );
  const reset = useCallback(() => setDraft((d) => ({ ...d, drop: null, stops: [], scheduledAt: null, tripEndAt: null, tripDays: 1, daysAuto: false, timePackage: '', tripType: 'One Way', multicity: false, roofCarrier: false, pets: false, promoCode: '', notes: '' })), []);
  // A repeat booking always needs a fresh future pickup: the old schedule is never carried over.
  const startFrom = useCallback<BookingValue['startFrom']>((pickup, drop) => setDraft((d) => ({ ...d, pickup, drop, stops: [], scheduledAt: null, tripEndAt: null, tripDays: 1, daysAuto: false, timePackage: '', multicity: false, roofCarrier: false, pets: false, promoCode: '' })), []);

  const routeStops = draft.tripType === 'Round Trip' ? draft.stops : [];
  // Only a real Round Trip comes back to the pickup. A Multicity tour (stored as a Round Trip with a flag) ends at its own final drop.
  const isRoundTrip = draft.tripType === 'Round Trip' && !draft.multicity;
  const baseRouteKey = routeKeyOf(draft.pickup, draft.drop, routeStops);
  // The key also tells a Round Trip apart, so switching trip type measures the way back too.
  const routeKey = baseRouteKey && isRoundTrip ? `${baseRouteKey}|rt` : baseRouteKey && draft.multicity ? `${baseRouteKey}|mc` : baseRouteKey;
  const pickupRef = useRef(draft.pickup);
  const dropRef = useRef(draft.drop);
  pickupRef.current = draft.pickup;
  dropRef.current = draft.drop;

  // Route for the current endpoints. A result is tagged with the key it was computed
  // for, so a stale one is never used after the rider edits the trip.
  useEffect(() => {
    const pickup = pickupRef.current;
    const drop = dropRef.current;
    if (!routeKey || !pickup || !drop) return undefined;
    const controller = new AbortController();
    const points = [pickup, ...routeStops, drop];
    Promise.all(points.slice(1).map((point, index) => getRoute(points[index]!, point, controller.signal)))
      .then(async (legs) => {
        const info: RouteInfo = {
          distanceKm: legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
          durationMin: legs.reduce((sum, leg) => sum + leg.durationMin, 0),
          path: legs.flatMap((leg) => leg.path),
          estimated: legs.some((leg) => leg.estimated),
        };
        // A Round Trip always ends back at the pickup: the running distance is the way out through every stop to the
        // drop plus the way back from the drop to the pickup (a drop that is the pickup already closes the circuit).
        if (isRoundTrip) {
          const closed = Math.abs(pickup.lat - drop.lat) < 0.0001 && Math.abs(pickup.lng - drop.lng) < 0.0001;
          const back = !closed && routeStops.length ? await getRoute(drop, pickup, controller.signal) : null;
          const factor = !closed && !routeStops.length ? 2 : 1;
          info.totalDistanceKm = (info.distanceKm + (back?.distanceKm ?? 0)) * factor;
          info.totalDurationMin = (info.durationMin + (back?.durationMin ?? 0)) * factor;
          if (back?.estimated) info.estimated = true;
        }
        if (!controller.signal.aborted) setRouteState({ key: routeKey, info, error: false });
      })
      .catch(() => !controller.signal.aborted && setRouteState({ key: routeKey, info: null, error: true }));
    return () => controller.abort();
  }, [routeKey, routeTry]);

  const current = routeKey && routeState.key === routeKey ? routeState : null;
  const route = current?.info ?? null;
  const routeStatus: RouteStatus = !routeKey ? 'idle' : current ? (current.error ? 'error' : 'ready') : 'loading';
  const retryRoute = useCallback(() => {
    setRouteState({ key: '', info: null, error: false });
    setRouteTry((n) => n + 1);
  }, []);

  // The authoritative fare. Requested once the trip has a valid pickup (and an end date for a
  // round trip); the same answer is shared by the Choose and Review steps.
  const quoteRequest = useMemo(() => {
    const { pickup, drop, scheduledAt, tripEndAt, tripType, promoCode } = draft;
    if (!pickup || !drop || !scheduledAt || scheduleProblem(scheduledAt)) return null;
    if (tripType === 'Round Trip' && (!tripEndAt || tripEndAt.getTime() < scheduledAt.getTime())) return null;
    return {
      pickup: { id: pickup.id, name: pickup.name, address: pickup.address, lat: pickup.lat, lng: pickup.lng, type: pickup.type },
      drop: { id: drop.id, name: drop.name, address: drop.address, lat: drop.lat, lng: drop.lng, type: drop.type },
      stops: tripType === 'Round Trip' ? draft.stops.map((p) => ({ id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, type: p.type })) : [],
      tripType: draft.multicity && tripType === 'Round Trip' ? ('Multicity' as const) : tripType,
      scheduledAt: scheduledAt.toISOString(),
      tripEndAt: tripType === 'Round Trip' && tripEndAt ? tripEndAt.toISOString() : null,
      // Time-based round trip: the server works out the return time and the packages from the days chosen (the package pick is made on screen).
      tripDays: tripType === 'Round Trip' && !draft.multicity ? requestedTripDays(draft) : null,
      rentalHours: tripType === 'Local Rental' ? draft.rentalHours : null,
      addOns: { roofCarrier: draft.roofCarrier, pets: draft.pets },
      couponCode: promoCode || '',
      brand: 'nesam',
    };
  }, [draft]);
  // The booking server only quotes for a signed-in, active rider. Until the account is ready no
  // request is made (and no earlier answer is kept); becoming ready starts a fresh quote for the
  // current draft even when the trip itself has not changed.
  const { state: auth } = useAuth();
  // Anything the admin changes that prices a trip (vehicle fares, the price adjustment, coupons) arrives
  // live; its fingerprint makes the quote ask the server again, so new prices show within seconds.
  const pricingStamp = useMemo(
    () => JSON.stringify([categories.map((c) => [c.id, c.displayOrder, c.fare]), adjustment, coupons.map((c) => [c.code, c.discountValue, c.validUntil])]),
    [categories, adjustment, coupons],
  );
  const serverQuote = useServerQuotes(quoteRequest, auth.status === 'ready', pricingStamp);

  const value = useMemo<BookingValue>(
    () => ({ draft, update, reset, startFrom, route, routeStatus, retryRoute, categories, categoryStatus, adjustment, coupons, serverQuote }),
    [draft, update, reset, startFrom, route, routeStatus, retryRoute, categories, categoryStatus, adjustment, coupons, serverQuote],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ── Pricing view of the draft ─────────────────────────────────────────────

export interface BookingQuote {
  category: RideCategory | null;
  /** Fare for every bookable category on this route (empty until the route is known). */
  quotes: Map<string, FareBreakdown>;
  /** The selected category's fare with any applied promo. */
  quote: FareBreakdown | null;
  coupon: AppliedCoupon | null;
  couponCheck: CouponResult | null;
  outstation: boolean;
  service: string;
  pickupTime: Date;
  checkCoupon: (code: string) => CouponResult;
  /** True only when `quote` is the booking server's own fare for exactly this trip. */
  authoritative: boolean;
  quoteLoading: boolean;
  quoteError: string;
  /** Server breakup lines for the selected category (null until the server answers). */
  breakup: ServerCategoryQuote['breakup'] | null;
  /** The server's answer for each category (included KM, extra-KM rate, package hours), by category id. */
  entries: Map<string, ServerCategoryQuote>;
  /** Why a category cannot be priced for this trip, by category id. */
  unavailable: Map<string, string>;
  /** Cab types the office has turned off for this location: they are not shown at all. */
  hidden: Set<string>;
  /** The journey distance and time the server priced (null until it answers). */
  trip: { distanceKm: number; durationMin: number } | null;
  /** Chargeable calendar days of a round trip. */
  days: number | null;
  /** Time-based round trip: the packages the server offers for the chosen vehicle, the one in force, and whether 1 day became 2. */
  packages: ServerTimePackage[];
  selectedPackage: ServerTimePackage | null;
  autoDays: boolean;
  /** The server refuses this trip as a custom quote (more days than the configured maximum). */
  customQuote: boolean;
  /** Hill stations found on the pickup, stops and drop: the Hill Station Allowance / Charge is its own fare line and there is no 5-hour / 8-hour package. */
  hillStations: HillStationInfo[];
  retryQuote: () => void;
}

/** The server's reason when the office has turned a cab type off for this location (Admin → Booking rules). */
export const isTurnedOff = (reason?: string): boolean => /is not offered for this location/i.test(reason ?? '');

/** Prices the draft the way the booking server will (same engine, adjustment and coupon rules). */
export function useBookingQuote(): BookingQuote {
  const { draft, route, categories, adjustment, coupons, serverQuote, update } = useBooking();
  const { trips } = useCustomerData();
  const { pickup, drop, tripType, scheduledAt, categoryId, promoCode } = draft;

  // "Now" for night-charge purposes is fixed per draft change so a quote never flickers mid-minute.
  const pickupTime = useMemo(() => scheduledAt ?? new Date(), [scheduledAt, pickup, drop, tripType, categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = useMemo<BookingQuote>(() => {
    const category = categories.find((c) => c.id === categoryId) ?? null;
    const quotes = new Map<string, FareBreakdown>();
    if (route) for (const c of categories) if (hasEstimate(c)) quotes.set(c.id, calculateFare({ category: c, route, tripType, pickupTime, adjustment }));
    const outstation = route ? isOutstation(route.distanceKm) : false;
    const service = pickup && drop && route ? serviceName(pickup, drop, route.distanceKm) : 'Local';
    const history = trips.filter((t) => t.status !== 'Cancelled' && t.status !== 'Rejected');

    const checkCoupon = (code: string): CouponResult => {
      if (!category || !route) return { ok: false, message: 'Choose a ride first.' };
      const base = quotes.get(category.id) ?? calculateFare({ category, route, tripType, pickupTime, adjustment });
      return validateCoupon(coupons, code, {
        subtotal: base.subtotal,
        categoryId: category.id,
        service,
        isFirstBooking: history.length === 0,
        customerUses: history.filter((t) => t.couponCode.toUpperCase() === code.trim().toUpperCase()).length,
      });
    };

    // Re-validated on every change so a discount never outlives the fare it was granted on.
    const couponCheck = promoCode && category && route ? checkCoupon(promoCode) : null;
    const coupon = couponCheck?.ok ? couponCheck.coupon : null;
    // Only the server's quotes are customer-visible. Local calculations remain available for coupon
    // validation, but showing them while this request is pending makes stale/config-default prices flash.
    const server = serverQuote.status === 'ready' ? serverQuote.data : null;
    // Time-based round trip: a vehicle carries one fare per package; the package the rider picked (else the server's pick) is the one in force.
    const withPackage = (x: ServerCategoryQuote): ServerCategoryQuote => {
      const pkg = x.packages?.find((p) => p.id === draft.timePackage) ?? x.packages?.find((p) => p.id === x.selectedPackage) ?? x.packages?.[0];
      return x.ok && pkg ? { ...x, fare: pkg.fare, breakup: pkg.breakup, strikeTotal: pkg.strikeTotal, couponMessage: pkg.couponMessage, couponApplied: pkg.couponApplied, includedKm: pkg.includedKm, days: pkg.days, extraKmRate: pkg.extraKmRate, selectedPackage: pkg.id } : x;
    };
    const byId = new Map<string, ServerCategoryQuote>((server?.quotes ?? []).map((x) => [x.categoryId, withPackage(x)]));
    const unavailable = new Map<string, string>();
    const hidden = new Set<string>();
    for (const x of server?.quotes ?? []) if (!x.ok) { unavailable.set(x.categoryId, x.error ?? 'Not available for this trip.'); if (isTurnedOff(x.error)) hidden.add(x.categoryId); }
    const finalQuotes = new Map<string, FareBreakdown>();
    if (server) for (const x of byId.values()) if (x.ok && x.fare) finalQuotes.set(x.categoryId, x.fare);
    const chosen = category ? byId.get(category.id) : undefined;
    // The CNG rate card applies when the rider picked CNG and this vehicle offers it.
    const cngChoice = draft.fuelType === 'cng' && chosen?.ok && chosen.cng ? chosen.cng : null;
    const serverFare = cngChoice ? cngChoice.fare : chosen?.ok && chosen.fare ? chosen.fare : null;
    const authoritative = !!serverFare;
    const days = chosen?.ok && typeof chosen.days === 'number' && (chosen.model === 'round_trip_calendar' || chosen.model === 'round_trip_time_based') ? chosen.days : null;
    // The packages shown are the chosen vehicle's; before a vehicle is chosen, the first vehicle that has any.
    const source = (chosen?.ok && chosen.packages?.length ? chosen : (server?.quotes ?? []).find((x) => x.ok && x.packages?.length)) ?? null;
    const packages = source?.packages ?? [];
    const selectedPackage = packages.find((p) => p.id === (draft.timePackage || '')) ?? packages.find((p) => p.id === source?.selectedPackage) ?? packages[0] ?? null;
    const customQuote = !!server && server.quotes.length > 0 && server.quotes.every((x) => !x.ok && x.code === 'custom-quote');
    return {
      category,
      quotes: server ? finalQuotes : new Map<string, FareBreakdown>(),
      quote: server ? serverFare : null,
      coupon: server && chosen?.couponApplied && serverFare ? { code: promoCode.trim().toUpperCase(), discount: serverFare.discount, message: chosen.couponMessage ?? '' } : server ? null : coupon,
      couponCheck: server && promoCode ? (chosen?.couponApplied ? couponCheck : { ok: false, message: chosen?.couponMessage || 'This code does not apply to this trip.' } as CouponResult) : couponCheck,
      outstation: server ? (route ? isOutstation(route.distanceKm) : outstation) : outstation,
      service: server?.service || service,
      pickupTime, checkCoupon, authoritative,
      quoteLoading: serverQuote.status === 'loading',
      quoteError: serverQuote.status === 'error' ? serverQuote.error : '',
      breakup: (cngChoice ? cngChoice.breakup : chosen?.breakup) ?? null,
      entries: byId, unavailable, hidden, days, packages, selectedPackage, autoDays: source?.autoDays === true, customQuote, retryQuote: serverQuote.retry,
      hillStations: server?.hillStations ?? [],
      trip: server?.trip ?? null,
    };
  }, [categories, categoryId, route, tripType, pickupTime, adjustment, coupons, trips, promoCode, pickup, drop, serverQuote, draft.fuelType, draft.timePackage]);

  // Auto-Days sync (Customer UX v8): choosing an overnight package (Morning Return, Next-Day Return) when 1 day was asked for makes the
  // trip 2 days — the form's Days and the summary change together. Those auto days follow the package both ways (the server is still asked
  // for the rider's own 1 day, so the same-day packages stay on the list and an earlier pickup returns the trip to 1 day). Days the rider
  // chose themselves are never cut back: a trip of 3 or more days is never reduced to 2 when the pickup time or the package changes.
  const picked = result.selectedPackage;
  useEffect(() => {
    if (draft.tripType !== 'Round Trip' || draft.multicity || !draft.scheduledAt || !picked) return;
    const start = draft.scheduledAt;
    const endFor = (days: number) => new Date(start.getTime() + (days - 1) * 86_400_000);
    if (draft.daysAuto) {
      if (picked.days <= 1) update({ tripDays: 1, daysAuto: false, tripEndAt: endFor(1) });
      else if (picked.days !== draft.tripDays) update({ tripDays: picked.days, tripEndAt: endFor(picked.days) });
      return;
    }
    if (picked.days > draft.tripDays) update({ tripDays: picked.days, daysAuto: draft.tripDays === 1, timePackage: picked.id, tripEndAt: endFor(picked.days) });
  }, [picked?.id, picked?.days, draft.tripDays, draft.daysAuto, draft.tripType, draft.multicity, draft.scheduledAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return result;
}

// The booking being put together across the three steps (plan → choose → review),
// plus the live data every step prices with: bookable categories, the global fare
// adjustment and coupons. Subscribed once for the session so moving between steps
// (or editing an earlier one) never re-reads them or loses the draft; the draft
// survives a page reload for the length of the tab.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppliedCoupon, Coupon, FareBreakdown, GeoPlace, RideCategory, RouteInfo } from '@core/types';
import {
  calculateFare,
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
import { useServerQuotes, type ServerQuoteState } from '@core/hooks/useServerQuotes';
import type { ServerCategoryQuote } from '@core/services/quoteService';
import { scheduleProblem } from '@core/utils/bookingRules';
import { useCustomerData } from '@/state/CustomerData';

export type { BookingDraft };

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';

interface BookingValue {
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

const Ctx = createContext<BookingValue | null>(null);

export function useBooking(): BookingValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('BookingProvider is missing');
  return v;
}

export const routeKeyOf = (pickup: GeoPlace | null, drop: GeoPlace | null, stops: GeoPlace[] = []) =>
  pickup && drop ? [pickup, ...stops, drop].map((p) => `${p.lat},${p.lng}`).join('>') : '';

export function BookingProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<BookingDraft>(loadDraft);
  const [routeState, setRouteState] = useState<{ key: string; info: RouteInfo | null; error: boolean }>({ key: '', info: null, error: false });
  const [routeTry, setRouteTry] = useState(0);
  const [categories, setCategories] = useState<RideCategory[]>([]);
  const [categoryStatus, setCategoryStatus] = useState<RideCategoryStatus>('loading');
  const [adjustment, setAdjustment] = useState<FareAdjustment | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  useEffect(() => saveDraft(draft), [draft]);

  const categoriesRef = useRef<RideCategory[]>([]);
  // Categories, adjustment and coupons are readable only when signed in, so they are subscribed
  // again when the rider signs in or out (a guest sees the published default categories).
  const { profile } = useCustomerData();
  const uid = profile?.uid ?? '';
  useEffect(
    () =>
      subscribeToRideCategories((cats, status) => {
        const previous = categoriesRef.current;
        categoriesRef.current = cats;
        setCategories(cats);
        setCategoryStatus(status);
        // Keep the rider's choice while it is still bookable. When the list is replaced (a guest sees the
        // default list until signing in) the same category is found again by name; otherwise pre-select one.
        setDraft((d) => {
          if (cats.some((c) => c.id === d.categoryId)) return d;
          const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
          const name = previous.find((c) => c.id === d.categoryId)?.name;
          const same = name ? cats.find((c) => key(c.name) === key(name)) : undefined;
          return { ...d, categoryId: same?.id ?? cats[Math.min(1, cats.length - 1)]?.id ?? '' };
        });
      }),
    [uid],
  );
  useEffect(() => subscribeToFareAdjustment(setAdjustment), [uid]);
  useEffect(() => subscribeToCoupons(setCoupons), [uid]);

  const update = useCallback<BookingValue['update']>(
    (patch) => setDraft((d) => ({ ...d, ...(typeof patch === 'function' ? patch(d) : patch) })),
    [],
  );
  const reset = useCallback(() => setDraft((d) => ({ ...d, drop: null, stops: [], scheduledAt: null, tripEndAt: null, tripType: 'One Way', multicity: false, promoCode: '', notes: '', forOther: false, passengerName: '', passengerMobile: '', flight: '' })), []);
  // A repeat booking always needs a fresh future pickup: the old schedule is never carried over.
  const startFrom = useCallback<BookingValue['startFrom']>((pickup, drop) => setDraft((d) => ({ ...d, pickup, drop, stops: [], scheduledAt: null, tripEndAt: null, multicity: false, promoCode: '' })), []);

  const routeStops = draft.tripType === 'Round Trip' ? draft.stops : [];
  const isRoundTrip = draft.tripType === 'Round Trip';
  const baseRouteKey = routeKeyOf(draft.pickup, draft.drop, routeStops);
  // The key also tells a Round Trip apart, so switching trip type measures the way back too.
  const routeKey = baseRouteKey && isRoundTrip ? `${baseRouteKey}|rt` : baseRouteKey;
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
      rentalHours: tripType === 'Local Rental' ? draft.rentalHours : null,
      couponCode: promoCode || '',
      brand: 'nesam',
    };
  }, [draft]);
  // Anything the admin changes that prices a trip (vehicle fares, the price adjustment, coupons) arrives
  // live; its fingerprint makes the quote ask the server again, so new prices show within seconds.
  const pricingStamp = useMemo(
    () => JSON.stringify([categories.map((c) => [c.id, c.displayOrder, c.fare]), adjustment, coupons.map((c) => [c.code, c.discountValue, c.validUntil])]),
    [categories, adjustment, coupons],
  );
  const serverQuote = useServerQuotes(quoteRequest, true, pricingStamp);

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
  /** Chargeable calendar days of a round trip. */
  days: number | null;
  retryQuote: () => void;
}

/** Prices the draft the way the booking server will (same engine, adjustment and coupon rules). */
export function useBookingQuote(): BookingQuote {
  const { draft, route, categories, adjustment, coupons, serverQuote } = useBooking();
  const { trips } = useCustomerData();
  const { pickup, drop, tripType, scheduledAt, categoryId, promoCode } = draft;

  // "Now" for night-charge purposes is fixed per draft change so a quote never flickers mid-minute.
  const pickupTime = useMemo(() => scheduledAt ?? new Date(), [scheduledAt, pickup, drop, tripType, categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo<BookingQuote>(() => {
    const category = categories.find((c) => c.id === categoryId) ?? null;
    const quotes = new Map<string, FareBreakdown>();
    if (route) for (const c of categories) quotes.set(c.id, calculateFare({ category: c, route, tripType, pickupTime, adjustment }));
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
    const localQuote = category && route ? calculateFare({ category, route, tripType, pickupTime, adjustment, discount: coupon?.discount ?? 0 }) : null;

    // The server's quotes win whenever they exist for this exact trip. The local numbers above are
    // an estimate used only while waiting or offline, and are never submittable (authoritative=false).
    const server = serverQuote.status === 'ready' ? serverQuote.data : null;
    const byId = new Map<string, ServerCategoryQuote>((server?.quotes ?? []).map((x) => [x.categoryId, x]));
    const unavailable = new Map<string, string>();
    for (const x of server?.quotes ?? []) if (!x.ok) unavailable.set(x.categoryId, x.error ?? 'Not available for this trip.');
    const finalQuotes = new Map<string, FareBreakdown>();
    if (server) for (const x of server.quotes) if (x.ok && x.fare) finalQuotes.set(x.categoryId, x.fare);
    const chosen = category ? byId.get(category.id) : undefined;
    // The CNG rate card applies when the rider picked CNG and this vehicle offers it.
    const cngChoice = draft.fuelType === 'cng' && chosen?.ok && chosen.cng ? chosen.cng : null;
    const serverFare = cngChoice ? cngChoice.fare : chosen?.ok && chosen.fare ? chosen.fare : null;
    const authoritative = !!serverFare;
    const days = chosen?.ok && typeof chosen.days === 'number' && chosen.model === 'round_trip_calendar' ? chosen.days : null;
    return {
      category,
      quotes: server ? finalQuotes : quotes,
      quote: server ? serverFare : localQuote,
      coupon: server && chosen?.couponApplied && serverFare ? { code: promoCode.trim().toUpperCase(), discount: serverFare.discount, message: chosen.couponMessage ?? '' } : server ? null : coupon,
      couponCheck: server && promoCode ? (chosen?.couponApplied ? couponCheck : { ok: false, message: chosen?.couponMessage || 'This code does not apply to this trip.' } as CouponResult) : couponCheck,
      outstation: server ? (route ? isOutstation(route.distanceKm) : outstation) : outstation,
      service: server?.service || service,
      pickupTime, checkCoupon, authoritative,
      quoteLoading: serverQuote.status === 'loading',
      quoteError: serverQuote.status === 'error' ? serverQuote.error : '',
      breakup: (cngChoice ? cngChoice.breakup : chosen?.breakup) ?? null,
      entries: byId, unavailable, days, retryQuote: serverQuote.retry,
    };
  }, [categories, categoryId, route, tripType, pickupTime, adjustment, coupons, trips, promoCode, pickup, drop, serverQuote, draft.fuelType]);
}

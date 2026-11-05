// The booking being put together across the three booking steps
// (Plan journey → Choose your ride → Review & book), plus the live data every
// step prices with: bookable categories, the global fare adjustment and coupons.
// Subscribed once for the session so moving between steps never re-reads them.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Coupon, GeoPlace, RideCategory, RouteInfo, TripType } from '../types';
import { useServerQuotes, type ServerQuoteState } from '../hooks/useServerQuotes';
import { scheduleProblem } from '../utils/bookingRules';
import {
  subscribeToCoupons,
  subscribeToFareAdjustment,
  subscribeToRideCategories,
  type FareAdjustment,
  type RideCategoryStatus,
} from '../services/pricingService';

export interface BookingDraft {
  pickup: GeoPlace | null;
  drop: GeoPlace | null;
  /** Ordered intermediate places for an outstation round trip. */
  stops: GeoPlace[];
  tripType: TripType;
  /** Pickup instant; required — every booking is an advance booking. */
  scheduledAt: Date | null;
  /** Round trips: when the trip ends (billing counts Indian calendar dates from pickup to here). */
  tripEndAt: Date | null;
  categoryId: string;
  /** Airport transfers: which way the customer travels (UI only; the airport place carries type 'airport'). */
  airportDirection: 'to' | 'from';
  /** Airport transfers: optional flight number, sent in the booking notes. */
  flightNumber: string;
  /** A promo code the rider applied. The booking server checks it with every quote, so the fare shown is the fare booked. */
  promoCode: string;
  /** Local Rental package hours; null = the shortest package each car offers. */
  rentalHours: number | null;
  /** 'cng' when the rider chose CNG vehicles (priced on a vehicle's CNG rate card where one is saved). */
  fuelType: '' | 'cng';
}

/** The services in the bottom navigation. Multicity has no booking contract on the server yet. */
export type HomeService = 'airport' | 'multicity' | 'outstation' | 'rental';

export const SERVICE_TRIP_TYPE: Record<Exclude<HomeService, 'multicity' | 'outstation'>, TripType> = {
  airport: 'Airport Taxi',
  rental: 'Local Rental',
};

export function serviceOfTripType(t: TripType): HomeService {
  return t === 'Airport Taxi' ? 'airport' : t === 'Local Rental' ? 'rental' : 'outstation';
}

interface BookingDraftValue {
  draft: BookingDraft;
  /** The service selected in the bottom navigation. */
  service: HomeService;
  /** Switch service; outstation restores the last One Way / Round Trip choice. */
  setService: (s: HomeService) => void;
  /** Merge a change; pass a function to decide from the current draft. */
  update: (patch: Partial<BookingDraft> | ((d: BookingDraft) => Partial<BookingDraft>)) => void;
  /** Clears the destination, schedule and ride choice after a booking (pickup is kept). */
  reset: () => void;
  /** The route for the current pickup → drop, once computed. */
  route: RouteInfo | null;
  setRoute: (key: string, route: RouteInfo) => void;
  routeKey: string;
  categories: RideCategory[];
  categoryStatus: RideCategoryStatus;
  adjustment: FareAdjustment | null;
  coupons: Coupon[];
  /** The booking server's own quotes for this trip — the only fare that can be booked. */
  serverQuote: ServerQuoteState;
}

const Ctx = createContext<BookingDraftValue | null>(null);

export function useBookingDraft(): BookingDraftValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('BookingDraftProvider is missing');
  return v;
}

export const routeKeyOf = (pickup: GeoPlace | null, drop: GeoPlace | null) => (pickup && drop ? `${pickup.lat},${pickup.lng}>${drop.lat},${drop.lng}` : '');

export function BookingDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<BookingDraft>({
    pickup: null,
    drop: null,
    stops: [],
    tripType: 'One Way',
    scheduledAt: null,
    tripEndAt: null,
    categoryId: '',
    airportDirection: 'to',
    flightNumber: '',
    promoCode: '',
    rentalHours: null,
    fuelType: '',
  });
  const [service, setServiceState] = useState<HomeService>('outstation');
  const lastOutstation = useRef<TripType>('One Way');
  // A route is tagged with the endpoints it was computed for; any other is stale.
  const [routeState, setRouteState] = useState<{ key: string; info: RouteInfo } | null>(null);
  const [categories, setCategories] = useState<RideCategory[]>([]);
  const [categoryStatus, setCategoryStatus] = useState<RideCategoryStatus>('loading');
  const [adjustment, setAdjustment] = useState<FareAdjustment | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);

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

  const update = useCallback(
    (patch: Partial<BookingDraft> | ((d: BookingDraft) => Partial<BookingDraft>)) =>
      setDraft((d) => {
        const next = { ...d, ...(typeof patch === 'function' ? patch(d) : patch) };
        if (next.tripType === 'One Way' || next.tripType === 'Round Trip') lastOutstation.current = next.tripType;
        return next;
      }),
    [],
  );
  const setService = useCallback((s: HomeService) => {
    setServiceState(s);
    if (s === 'multicity') return;
    const tripType = s === 'outstation' ? lastOutstation.current : SERVICE_TRIP_TYPE[s];
    setDraft((d) => (d.tripType === tripType ? d : { ...d, tripType }));
  }, []);
  const reset = useCallback(() => {
    lastOutstation.current = 'One Way';
    setServiceState('outstation');
    setDraft((d) => ({ ...d, drop: null, stops: [], scheduledAt: null, tripEndAt: null, tripType: 'One Way', flightNumber: '', airportDirection: 'to', promoCode: '', rentalHours: null, fuelType: '' }));
  }, []);
  const setRoute = useCallback((key: string, info: RouteInfo) => setRouteState({ key, info }), []);

  const routeKey = routeKeyOf(draft.pickup, draft.drop);
  const route = routeKey && routeState?.key === routeKey ? routeState.info : null;

  const quoteRequest = useMemo(() => {
    const { pickup, drop, scheduledAt, tripEndAt, tripType, promoCode } = draft;
    if (!pickup || !drop || !scheduledAt || scheduleProblem(scheduledAt)) return null;
    if (tripType === 'Round Trip' && (!tripEndAt || tripEndAt.getTime() < scheduledAt.getTime())) return null;
    return {
      pickup: { id: pickup.id, name: pickup.name, address: pickup.address, lat: pickup.lat, lng: pickup.lng, type: pickup.type },
      drop: { id: drop.id, name: drop.name, address: drop.address, lat: drop.lat, lng: drop.lng, type: drop.type },
      tripType,
      scheduledAt: scheduledAt.toISOString(),
      tripEndAt: tripType === 'Round Trip' && tripEndAt ? tripEndAt.toISOString() : null,
      couponCode: promoCode || '',
      rentalHours: tripType === 'Local Rental' ? draft.rentalHours : null,
    };
  }, [draft]);
  const serverQuote = useServerQuotes(quoteRequest);

  const value = useMemo<BookingDraftValue>(
    () => ({ draft, service, setService, update, reset, route, setRoute, routeKey, categories, categoryStatus, adjustment, coupons, serverQuote }),
    [draft, service, setService, update, reset, route, setRoute, routeKey, categories, categoryStatus, adjustment, coupons, serverQuote],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

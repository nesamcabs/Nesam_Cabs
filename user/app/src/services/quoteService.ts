// The authoritative fare. The booking server prices every category with the same engine that
// creates the booking (confirmed tariff, calendar-day round trips, coupons), so the amount a
// customer reviews is the amount charged. The local calculator in pricingService.ts remains only
// as a labelled estimate while a quote is loading or unreachable — it can never be submitted.
import type { FareBreakdown, TripType } from '../types';
import type { FareBreakup } from '../utils/fareBreakup';
import { callFunction } from './callables';

/** One package of the time-based round trip (5-hour, 8-hour, Full-Day, Next-Day or Morning Return), priced by the server. */
export interface ServerTimePackage {
  /** 'same:five' | 'same:eight' | 'same:full' | 'next' | 'morning' — send this back as `timePackage` when booking. */
  id: string;
  kind: 'same_day' | 'next_day' | 'morning';
  label: string;
  hours: number | null;
  includedKm: number;
  days: number;
  fare: FareBreakdown;
  breakup: FareBreakup;
  couponMessage?: string;
  couponApplied?: boolean;
  /** When the package's coverage ends (ISO): the return time is never asked, it follows from the package. */
  endAt: string;
  extraKmRate: number;
  strikeTotal?: number;
  /** Morning Return only: the strict cutoff, and what it becomes when still running after it. */
  morningCutoffAt?: string;
  upgrade?: { label: string; includedKm: number; packageFare: number; increase: number };
  /** Included km of each calendar day, in order (e.g. [150, 250]: an 8-hour first day + a Full Day). */
  dayKm?: number[];
}

export interface ServerCategoryQuote {
  /** Time-based round trip: every package this pickup time and route allows (the customer picks one). */
  packages?: ServerTimePackage[];
  /** The customer asked for 1 day, but no same-day package fits the pickup time, so only longer (2-day) packages are quoted. */
  autoDays?: boolean;
  selectedPackage?: string;
  /** Set on a refused quote, e.g. 'custom-quote' for a trip longer than the configured maximum days. */
  code?: string;
  addOnRates?: { carrierCharge: number; petCharge: number };
  categoryId: string;
  ok: boolean;
  fare?: FareBreakdown;
  breakup?: FareBreakup;
  service?: string;
  model?: string;
  /** Chargeable calendar days (round trips). */
  days?: number;
  includedKm?: number;
  /** Local Rental: the package hours this fare is for. */
  rentalHours?: number | null;
  /** Rate for each KM beyond the included KM, as the customer is charged it. */
  extraKmRate?: number;
  /** True when the configured fare already contained GST (it was not added on top). */
  gstIncluded?: boolean;
  /** Display only: a higher price to show struck out above `fare.total`. The fare is what is charged. */
  strikeTotal?: number;
  couponMessage?: string;
  couponApplied?: boolean;
  /** A hill station is on the trip: whether the Hill Station Allowance / Charge was added, and its amount (as entered, GST included when the fare includes GST). */
  hill?: { stations: HillStationInfo[]; charged: boolean; amount: number };
  /** The same trip priced on the vehicle's CNG rate card; absent when this vehicle has no CNG option. */
  cng?: { fare: FareBreakdown; breakup: FareBreakup; extraKmRate: number; strikeTotal?: number } | null;
  error?: string;
}

export interface HillStationInfo { id: string; name: string; tamil: string }

export interface ServerQuoteResponse {
  /** Hill stations found on the pickup, stops and drop (the 5-hour / 8-hour packages are not offered for them). */
  hillStations?: HillStationInfo[];
  route: { distanceKm: number; durationMin: number };
  /** The whole journey the fare is based on (a round trip: out through its stops and back). */
  trip?: { distanceKm: number; durationMin: number };
  service: string;
  quotes: ServerCategoryQuote[];
}

export interface QuoteRequest {
  addOns?: { roofCarrier: boolean; pets: boolean };
  /** `id` is the master location id when the place came from the location list; the server trusts it only at the same coordinates. */
  pickup: { id?: string; name: string; address: string; lat: number; lng: number; type?: string };
  drop: { id?: string; name: string; address: string; lat: number; lng: number; type?: string };
  /** Ordered intermediate places; supported for Round Trip only. */
  stops?: { id?: string; name: string; address: string; lat: number; lng: number; type?: string }[];
  /** 'Multicity' is a tour through several cities (stops required), priced from the Multicity rates and booked as a Round Trip. */
  tripType: TripType | 'Multicity';
  /** ISO-8601 with an offset. */
  scheduledAt: string;
  tripEndAt?: string | null;
  /** Round Trip: the trip days the customer chose. The return time is never asked; it follows from the days and the package. */
  tripDays?: number | null;
  /** Round Trip (time-based): the package picked, e.g. 'same:eight' | 'next' | 'morning'. Absent = the cheapest that fits. */
  timePackage?: string | null;
  couponCode?: string;
  /** Local Rental: the package hours chosen (absent = the shortest package each car offers). */
  rentalHours?: number | null;
  /** Brand scope requesting the quote. */
  brand?: string;
}

/** Requests still waiting for the server, by trip: asking again for the same trip meanwhile shares the one answer. */
const pending = new Map<string, Promise<ServerQuoteResponse>>();

export function fetchQuotes(req: QuoteRequest): Promise<ServerQuoteResponse> {
  const key = quoteKeyOf(req);
  const running = pending.get(key);
  if (running) return running;
  const call = callFunction<QuoteRequest, ServerQuoteResponse>('quoteBooking', req, 30000);
  pending.set(key, call);
  const done = () => { if (pending.get(key) === call) pending.delete(key); };
  call.then(done, done);
  return call;
}

/** Identity of a request, so a stale answer is never used for a changed trip. */
export const quoteKeyOf = (r: QuoteRequest | null): string => (r ? JSON.stringify([r.pickup.id ?? '', r.pickup.lat, r.pickup.lng, ...(r.stops ?? []).flatMap((p) => [p.id ?? '', p.lat, p.lng]), r.drop.id ?? '', r.drop.lat, r.drop.lng, r.tripType, r.scheduledAt, r.tripEndAt ?? '', r.tripDays ?? '', r.timePackage ?? '', r.couponCode ?? '', r.brand ?? '', r.rentalHours ?? '', r.addOns?.roofCarrier === true, r.addOns?.pets === true]) : '');

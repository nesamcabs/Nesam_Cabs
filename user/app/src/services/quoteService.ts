// The authoritative fare. The booking server prices every category with the same engine that
// creates the booking (confirmed tariff, calendar-day round trips, coupons), so the amount a
// customer reviews is the amount charged. The local calculator in pricingService.ts remains only
// as a labelled estimate while a quote is loading or unreachable — it can never be submitted.
import type { FareBreakdown } from '../types';
import type { FareBreakup } from '../utils/fareBreakup';
import { callFunction } from './callables';

export interface ServerCategoryQuote {
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
  /** The same trip priced on the vehicle's CNG rate card; absent when this vehicle has no CNG option. */
  cng?: { fare: FareBreakdown; breakup: FareBreakup; extraKmRate: number; strikeTotal?: number } | null;
  error?: string;
}

export interface ServerQuoteResponse {
  route: { distanceKm: number; durationMin: number };
  service: string;
  quotes: ServerCategoryQuote[];
}

import type { TripType } from '../types';

export interface QuoteRequest {
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
  couponCode?: string;
  /** Local Rental: the package hours chosen (absent = the shortest package each car offers). */
  rentalHours?: number | null;
  /** Brand scope requesting the quote. */
  brand?: string;
}

export const fetchQuotes = (req: QuoteRequest): Promise<ServerQuoteResponse> => callFunction<QuoteRequest, ServerQuoteResponse>('quoteBooking', req, 30000);

/** Identity of a request, so a stale answer is never used for a changed trip. */
export const quoteKeyOf = (r: QuoteRequest | null): string => (r ? JSON.stringify([r.pickup.id ?? '', r.pickup.lat, r.pickup.lng, ...(r.stops ?? []).flatMap((p) => [p.id ?? '', p.lat, p.lng]), r.drop.id ?? '', r.drop.lat, r.drop.lng, r.tripType, r.scheduledAt, r.tripEndAt ?? '', r.couponCode ?? '', r.brand ?? '', r.rentalHours ?? '']) : '');

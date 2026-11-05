// The booking draft and its tab-lifetime persistence (kept free of React and Firebase so it can be tested).
import type { GeoPlace, PaymentMethod, TripType } from '@core/types';
import { isValidLatLng } from '@core/utils/geo';

export interface BookingDraft {
  pickup: GeoPlace | null;
  drop: GeoPlace | null;
  /** Ordered intermediate places for an outstation round trip. */
  stops: GeoPlace[];
  tripType: TripType;
  /** Pickup instant. Required to continue: every booking is an advance booking. */
  scheduledAt: Date | null;
  /** Round trips only: when the trip ends (billing counts Indian calendar dates from pickup to here). */
  tripEndAt: Date | null;
  categoryId: string;
  /** The booking server records Cash or UPI. */
  payment: PaymentMethod;
  /** 'cng' when the rider picked the CNG option of the chosen vehicle. */
  fuelType: '' | 'cng';
  /** A code the rider has applied (re-validated against every fare). */
  promoCode: string;
  notes: string;
  waSame: boolean;
  waCode: string;
  waNumber: string;
  email: string;
  /** Booking for someone else: who travels (sent to the server inside the notes). */
  forOther: boolean;
  passengerName: string;
  passengerMobile: string;
  /** Airport transfers: optional flight number (sent inside the notes). */
  flight: string;
  /** Local Rental package hours; null = the shortest package each car offers. */
  rentalHours: number | null;
  /** A Multicity tour: a Round Trip through several cities (the stops), priced from the Multicity rates. */
  multicity: boolean;
}

/** Local Rental packages the booking server offers (each car shows which it can book). */
export const RENTAL_PACKAGE_HOURS: readonly number[] = [4, 6, 8, 10, 12];

export const EMPTY_DRAFT: BookingDraft = {
  pickup: null,
  drop: null,
  stops: [],
  tripType: 'One Way',
  scheduledAt: null,
  tripEndAt: null,
  categoryId: '',
  payment: 'Cash',
  fuelType: '',
  promoCode: '',
  notes: '',
  waSame: true,
  waCode: '+91',
  waNumber: '',
  email: '',
  forOther: false,
  passengerName: '',
  passengerMobile: '',
  flight: '',
  rentalHours: null,
  multicity: false,
};

const STORAGE_KEY = 'nesam.booking.v1';

function validPlace(p: unknown): GeoPlace | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  if (!isValidLatLng(o as { lat?: number; lng?: number }) || typeof o.name !== 'string') return null;
  return {
    id: String(o.id ?? 'draft'),
    name: o.name,
    address: String(o.address ?? o.name),
    type: (o.type as GeoPlace['type']) ?? 'other',
    lat: o.lat as number,
    lng: o.lng as number,
  };
}

export function loadDraft(): BookingDraft {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DRAFT;
    const d = JSON.parse(raw) as Record<string, unknown>;
    const at = typeof d.scheduledAt === 'string' ? new Date(d.scheduledAt) : null;
    const endAt = typeof d.tripEndAt === 'string' ? new Date(d.tripEndAt) : null;
    const scheduled = at && !Number.isNaN(at.getTime()) && at.getTime() > Date.now() ? at : null;
    return {
      ...EMPTY_DRAFT,
      pickup: validPlace(d.pickup),
      drop: validPlace(d.drop),
      stops: Array.isArray(d.stops) ? d.stops.map(validPlace).filter((p): p is GeoPlace => p !== null).slice(0, 8) : [],
      tripType: (['One Way', 'Round Trip', 'Local Rental', 'Airport Taxi'] as const).includes(d.tripType as TripType)
        ? (d.tripType as TripType)
        : 'One Way',
      // A schedule that has already passed is dropped rather than kept as a blocker.
      scheduledAt: scheduled,
      // The end only makes sense after a still-valid pickup.
      tripEndAt: scheduled && endAt && !Number.isNaN(endAt.getTime()) && endAt.getTime() >= scheduled.getTime() ? endAt : null,
      categoryId: typeof d.categoryId === 'string' ? d.categoryId : '',
      payment: d.payment === 'UPI' ? 'UPI' : 'Cash',
      fuelType: d.fuelType === 'cng' ? 'cng' : '',
      promoCode: typeof d.promoCode === 'string' ? d.promoCode : '',
      notes: typeof d.notes === 'string' ? d.notes.slice(0, 300) : '',
      waSame: d.waSame !== false,
      waCode: typeof d.waCode === 'string' ? d.waCode : '+91',
      waNumber: typeof d.waNumber === 'string' ? d.waNumber : '',
      email: typeof d.email === 'string' ? d.email : '',
      forOther: d.forOther === true,
      passengerName: typeof d.passengerName === 'string' ? d.passengerName.slice(0, 60) : '',
      passengerMobile: typeof d.passengerMobile === 'string' ? d.passengerMobile.slice(0, 16) : '',
      flight: typeof d.flight === 'string' ? d.flight.slice(0, 12) : '',
      rentalHours: typeof d.rentalHours === 'number' && RENTAL_PACKAGE_HOURS.includes(d.rentalHours) ? d.rentalHours : null,
      multicity: d.multicity === true && d.tripType === 'Round Trip',
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(d: BookingDraft): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...d, scheduledAt: d.scheduledAt?.toISOString() ?? null, tripEndAt: d.tripEndAt?.toISOString() ?? null }));
  } catch {
    /* storage unavailable (private mode): the draft just lives in memory */
  }
}


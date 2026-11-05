import { db } from './admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { isOutstation } from './domain/pricing';

export interface ServiceMasterDoc {
  id: string;
  name?: string;
  serviceType?: string;
  status?: string;
  onlineBookingEnabled?: boolean;
  adminBookingEnabled?: boolean;
  allowedVehicleCategoryIds?: string[];
  airportOptions?: { airportPickup?: boolean; airportDrop?: boolean };
  outstationOptions?: { oneWayAllowed?: boolean; roundTripAllowed?: boolean };
  displayOrder?: number;
  [key: string]: any;
}

export function supportsTrip(service: Record<string, any>, tripType: string): boolean {
  const known: Record<string, string[]> = {
    'One Way Taxi': ['One Way'],
    'Outstation Cab': ['One Way', 'Round Trip'],
    'Airport Taxi': ['Airport Taxi'],
    'Local Rental': ['Local Rental'],
    // The Multicity service is booked as a tour (a Round Trip through its cities); it never serves an ordinary trip.
    Multicity: ['Multicity'],
  };
  return known[service.serviceType]?.includes(tripType) ?? true;
}

export function serviceAllowsCategory(service: Record<string, any>, id: string): boolean {
  return !Array.isArray(service.allowedVehicleCategoryIds) || !service.allowedVehicleCategoryIds.length || service.allowedVehicleCategoryIds.includes(id);
}

/** An absent master retains legacy service availability; configured masters are authoritative. */
export async function assertOnlineCatalog(tripType: string, categoryId?: string): Promise<void> {
  const docs = await db.collection('services').get();
  assertCatalogAvailable(docs.docs.map((d) => d.data()), tripType, categoryId);
}

export function assertCatalogAvailable(masters: Record<string, any>[], tripType: string, categoryId?: string): void {
  const known = ['One Way Taxi', 'Outstation Cab', 'Airport Taxi', 'Local Rental'];
  const matching = masters.filter((s) => known.includes(s.serviceType) && supportsTrip(s, tripType));
  if (!matching.length) return;
  const available = matching.some(
    (s) =>
      s.status === 'Active' &&
      s.onlineBookingEnabled === true &&
      (!categoryId || serviceAllowsCategory(s, categoryId)) &&
      !(s.serviceType === 'Outstation Cab' && s.outstationOptions?.[tripType === 'Round Trip' ? 'roundTripAllowed' : 'oneWayAllowed'] === false),
  );
  if (!available) throw new HttpsError('failed-precondition', 'This service or vehicle is not currently available for online booking. Contact NESAM for assistance.');
}

export function matchAuthoritativeService(
  masters: ServiceMasterDoc[],
  params: {
    tripType: string;
    categoryId?: string;
    distanceKm?: number;
    pickupType?: string;
    dropType?: string;
    context: 'customer' | 'admin';
    requestedServiceId?: string;
  },
): ServiceMasterDoc | null {
  const { tripType, categoryId, distanceKm = 0, pickupType, dropType, context, requestedServiceId } = params;

  // Staff with admin booking privileges can explicitly choose a service in the admin console.
  // For customer bookings, an arbitrary client-supplied service ID is never trusted to bypass duty resolution.
  if (context === 'admin' && requestedServiceId) {
    const s = masters.find((x) => x.id === requestedServiceId);
    if (!s) return null;
    if (s.status !== 'Active') return null;
    if (s.adminBookingEnabled === false) return null;
    if (!supportsTrip(s, tripType)) return null;
    if (categoryId && !serviceAllowsCategory(s, categoryId)) return null;
    return s;
  }

  const isAirport = tripType === 'Airport Taxi' || pickupType === 'airport' || dropType === 'airport';
  const isRental = tripType === 'Local Rental';
  const isRoundTrip = tripType === 'Round Trip';
  const isOutst = distanceKm > 0 ? isOutstation(distanceKm) : isRoundTrip;

  const valid = masters.filter((s) => {
    if (s.status !== 'Active') return false;
    if (context === 'customer' && s.onlineBookingEnabled !== true) return false;
    if (context === 'admin' && s.adminBookingEnabled === false) return false;
    if (categoryId && !serviceAllowsCategory(s, categoryId)) return false;
    if (!supportsTrip(s, tripType)) return false;
    if (s.serviceType === 'Outstation Cab' && s.outstationOptions) {
      if (tripType === 'Round Trip' && s.outstationOptions.roundTripAllowed === false) return false;
      if (tripType === 'One Way' && s.outstationOptions.oneWayAllowed === false) return false;
    }
    return true;
  });

  if (!valid.length) return null;

  const ranked = [...valid].sort((a, b) => {
    const score = (s: ServiceMasterDoc) => {
      if (isAirport && s.serviceType === 'Airport Taxi') return 100;
      if (isRental && s.serviceType === 'Local Rental') return 100;
      if (isRoundTrip && s.serviceType === 'Outstation Cab') return 100;
      if (!isRoundTrip && !isAirport && !isRental) {
        if (isOutst && s.serviceType === 'Outstation Cab') return 100;
        if (!isOutst && s.serviceType === 'One Way Taxi') return 100;
        if (s.serviceType === 'One Way Taxi') return 80;
        if (s.serviceType === 'Outstation Cab') return 70;
      }
      return 10;
    };
    const sDiff = score(b) - score(a);
    if (sDiff !== 0) return sDiff;
    return (a.displayOrder ?? 999) - (b.displayOrder ?? 999);
  });

  return ranked[0] ?? null;
}

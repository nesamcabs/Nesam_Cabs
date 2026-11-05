import { HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { text } from './shared';

export type BrandId = 'nesam' | 'people_taxi' | 'onewaycarrentals';
export const SUPPORTED_BRANDS: readonly BrandId[] = ['nesam', 'people_taxi', 'onewaycarrentals'];

export const BRAND_LABELS: Record<BrandId, string> = {
  nesam: 'NESAM',
  people_taxi: 'People Taxi',
  onewaycarrentals: 'One Way Car Rentals',
};

/** Services supported by each brand as documented and implemented in the repository. */
export const BRAND_SUPPORTED_SERVICES: Record<BrandId, readonly string[]> = {
  nesam: ['One Way', 'Round Trip', 'Airport Taxi', 'Local Rental', 'Multicity'],
  people_taxi: ['One Way', 'Round Trip', 'Airport Taxi', 'Local Rental', 'Multicity'],
  onewaycarrentals: ['One Way', 'Round Trip', 'Airport Taxi', 'Local Rental', 'Multicity'],
};

/**
 * Resolves and validates the brand identifier for any quote or booking request.
 * Server-authoritatively verifies request application context (origin, referer, auth role)
 * and rejects unknown or mismatched brand scopes.
 */
export function resolveAndValidateBrand(input: any, request?: CallableRequest<any>, trustedStaff = false): BrandId {
  const origin = text(request?.rawRequest?.headers?.origin || request?.rawRequest?.headers?.referer || '').toLowerCase();
  const rawBrand = text(input?.brand || input?.bookingSource || input?.source || input?.channel || '').toLowerCase().trim();

  let candidate: BrandId | null = null;

  if (rawBrand.includes('people')) {
    candidate = 'people_taxi';
  } else if (rawBrand.includes('oneway') || rawBrand.includes('one_way') || rawBrand.includes('one-way')) {
    candidate = 'onewaycarrentals';
  } else if (rawBrand.includes('nesam') || rawBrand === 'customer' || rawBrand === 'admin') {
    candidate = 'nesam';
  } else if (rawBrand) {
    throw new HttpsError('invalid-argument', `Unknown or unsupported brand scope: "${rawBrand}".`);
  }

  // Cross-check application context against known origins if available
  let originExpectedBrand: BrandId | null = null;
  if (origin.includes('peopletaxi') || origin.includes('people-taxi') || origin.includes(':5174')) {
    originExpectedBrand = 'people_taxi';
  } else if (origin.includes('onewaycarrentals') || origin.includes('one-way-car-rentals') || origin.includes(':5175')) {
    originExpectedBrand = 'onewaycarrentals';
  } else if (origin.includes('nesam') || origin.includes(':5173') || origin.includes(':8443')) {
    originExpectedBrand = 'nesam';
  }

  // If origin clearly indicates a brand and the client specified an incompatible brand, reject
  if (originExpectedBrand && candidate && originExpectedBrand !== candidate) {
    // Only staff/admin role is allowed to cross-book from an admin origin (e.g. admin panel creating People Taxi booking)
    // Internal callers may set trustedStaff only after requirePermission has verified the admin record.
    const isStaff = trustedStaff || request?.auth?.token?.role === 'admin' || request?.auth?.token?.role === 'staff';
    if (!isStaff) {
      throw new HttpsError('permission-denied', `Origin "${origin}" cannot make requests on behalf of "${BRAND_LABELS[candidate]}".`);
    }
  }

  const effectiveBrand: BrandId = candidate ?? originExpectedBrand ?? 'nesam';

  if (!SUPPORTED_BRANDS.includes(effectiveBrand)) {
    throw new HttpsError('invalid-argument', `Invalid brand scope.`);
  }

  return effectiveBrand;
}

/**
 * Asserts that the requested service is supported by the resolved brand.
 * Rejects unknown or unsupported services.
 */
export function assertServiceSupported(brand: BrandId, serviceName: string): void {
  const normalized = serviceName.trim();
  const supported = BRAND_SUPPORTED_SERVICES[brand];
  if (!supported) {
    throw new HttpsError('invalid-argument', `Unsupported brand scope: "${brand}".`);
  }

  // Map common service aliases
  const standardService =
    normalized === 'Outstation' || normalized === 'One Way'
      ? 'One Way'
      : normalized === 'Airport' || normalized === 'Airport Taxi'
      ? 'Airport Taxi'
      : normalized === 'Rental' || normalized === 'Local Rental'
      ? 'Local Rental'
      : normalized === 'Multicity'
      ? 'Multicity'
      : normalized === 'Round Trip'
      ? 'Round Trip'
      : normalized;

  if (!supported.includes(standardService)) {
    throw new HttpsError('invalid-argument', `Service "${serviceName}" is not supported by ${BRAND_LABELS[brand]}.`);
  }
}

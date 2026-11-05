import { HttpsError } from 'firebase-functions/v2/https';

export const FARE_BRANDS = ['nesam', 'people_taxi', 'onewaycarrentals'] as const;
export const FARE_SERVICES = ['One Way', 'Round Trip', 'Airport Taxi', 'Local Rental', 'Multicity'] as const;
export const fareServiceKey = (service: string): string => service === 'Airport' ? 'Airport Taxi' : service === 'Rental' ? 'Local Rental' : service;

/** Missing scope preserves historical shared records. New scoped writes require an exact service. */
export function parseFareScope(data: { brand?: unknown; fareService?: unknown }): { brand: string; fareService: string } {
  const brand = data.brand === 'common' || data.brand == null ? '' : data.brand;
  const fareService = data.fareService ?? '';
  if (typeof brand !== 'string' || (brand !== '' && !FARE_BRANDS.includes(brand as typeof FARE_BRANDS[number]))) throw new HttpsError('invalid-argument', 'Choose a valid fare brand.');
  if (typeof fareService !== 'string' || (fareService !== '' && !FARE_SERVICES.includes(fareService as typeof FARE_SERVICES[number]))) throw new HttpsError('invalid-argument', 'Choose a supported fare service.');
  if (brand && !fareService) throw new HttpsError('invalid-argument', 'A brand-specific fare requires an exact service.');
  return { brand, fareService };
}

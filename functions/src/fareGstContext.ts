import { db } from './admin';
import { gstState } from './domain/gst';
import type { GeoPlace } from './domain/types';
import type { TariffConfig } from './domain/tariff';

/** Only trusted master locations determine GST geography; no external location requests. */
export async function fareBoardingState(tariff: TariffConfig | null, pickup: GeoPlace, requestedId?: unknown): Promise<string> {
  if (!tariff?.fareGst || !Object.keys(tariff.fareGst).length) return '';
  const id = pickup.id !== 'pin' ? pickup.id : typeof requestedId === 'string' ? requestedId : '';
  if (!id || id === 'pin' || id.includes('/') || id.length > 150) return '';
  const location = (await db.doc(`locations/${id}`).get()).data();
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return '';
  // A caller cannot select a cheaper state's master while supplying another map position.
  if (Math.abs(location.lat - pickup.lat) > 0.0001 || Math.abs(location.lng - pickup.lng) > 0.0001) return '';
  let current = location;
  const seen = new Set([id]);
  for (let hop = 0; hop < 5; hop++) {
    const state = gstState(current.state);
    if (state) return state;
    const parent = current.parentLocationId;
    if (typeof parent !== 'string' || !parent || parent.includes('/') || seen.has(parent)) return '';
    seen.add(parent);
    const row = (await db.doc(`locations/${parent}`).get()).data();
    if (!row) return '';
    current = row;
  }
  return '';
}
export function recipientGstState(record: Record<string, unknown> | undefined): string {
  const value = record?.gstin || record?.gstNumber || record?.gst;
  return typeof value === 'string' && /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value.toUpperCase()) ? gstState(value.slice(0,2)) : '';
}
export function recipientAddressState(record: Record<string, unknown> | undefined): string {
  return gstState(record?.billingState || record?.state);
}

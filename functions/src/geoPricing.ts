// Database side of location-scoped Local / Rental pricing: where a pickup is (state, district, Service Zone, Locations records),
// the geo_fares documents that cover it, and the scheduled peak rules. The rules themselves are pure (domain/geoScope.ts,
// domain/geoFares.ts, domain/peakRules.ts). Every booking source (customer quote, customer booking, admin quote / booking) loads
// the same context, so the admin configuration drives every quote the same way.
import { db } from './admin';
import type { GeoPlace, TripType } from './domain/types';
import { districtName, districtOfPin, fareKeysOf, peakKeysOf, type PlaceScope } from './domain/geoScope';
import { geoChain, geoDocId, type GeoFareDoc, type GeoService } from './domain/geoFares';
import type { PeakRule } from './domain/peakRules';
import { stateCodeOf } from './domain/pincodeLookup';
import { placePincode } from './domain/hillStations';
import { isOutstation } from './domain/pricing';

const PIN = /^[1-9]\d{5}$/;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const pinsOf = (l: Record<string, unknown>) => [...new Set([...(Array.isArray(l.pincodes) ? l.pincodes : []), l.pincode].map(str).filter((x) => PIN.test(x)))];

/** A Locations record is a Service Zone: the new type, or an older Pickup & Drop zone (an Area / Locality listing its pincodes). */
export const isZoneRecord = (l: Record<string, unknown>) => l.type === 'Service Zone' || (l.type === 'Area / Locality' && Array.isArray(l.pincodes) && l.pincodes.length > 0);

interface ZoneRow { id: string; state: string; district: string; pincodes: string[] }
// Read fresh for every quote (no cache): a zone's PINs or a peak rule saved by an admin applies to the very next quote.
async function zones(): Promise<ZoneRow[]> {
  const snap = await db.collection('locations').where('status', '==', 'Active').where('type', 'in', ['Service Zone', 'Area / Locality']).get();
  const rows = snap.docs.filter((d) => isZoneRecord(d.data())).map((d) => {
    const l = d.data();
    const state = stateCodeOf(l.state);
    return { id: d.id, state, district: districtName(state, l.district) || str(l.district), pincodes: pinsOf(l) };
  });
  return rows;
}

export interface ResolvedPlace extends PlaceScope { airportIds: string[]; pincode: string }

/**
 * Where a place is. The Locations record the rider / office chose (and the records above it) gives the area, zone, state and
 * district; otherwise the pincode of the address does (India Post: one district per pincode). A pincode listed by two zones is
 * ambiguous and resolves to no zone rather than guessing.
 */
export async function resolvePlace(place: GeoPlace): Promise<ResolvedPlace> {
  const areaIds: string[] = [], airportIds: string[] = [];
  let zoneId: string | null = null, state = stateCodeOf((place as GeoPlace & { state?: string }).state), district = '', pincode = placePincode(place as GeoPlace & { name?: string; address?: string });
  let id = place.id && place.id !== 'pin' && !place.id.startsWith('google-') ? place.id : '';
  for (let hop = 0; id && hop < 5; hop++) {
    const snap = await db.doc(`locations/${id}`).get();
    const l = snap.data();
    if (!snap.exists || !l) break;
    if (isZoneRecord(l)) { zoneId ??= snap.id; }
    else { areaIds.push(snap.id); if (l.type === 'Airport') airportIds.push(snap.id); }
    state ||= stateCodeOf(l.state);
    district ||= districtName(state, l.district) || (l.type === 'City' ? districtName(state, l.name) || districtName(state, l.city) : '');
    if (!pincode) pincode = pinsOf(l)[0] ?? '';
    id = str(l.parentLocationId);
  }
  if (pincode && (!state || !district)) {
    const hit = districtOfPin(pincode, state || undefined);
    if (hit) { state ||= hit.state; district ||= hit.district; }
  }
  if (!zoneId && pincode) {
    const claim = (await zones()).filter((z) => z.pincodes.includes(pincode) && (!z.state || !state || z.state === state));
    if (claim.length === 1) zoneId = claim[0]!.id;
  }
  return { state, district, zoneId, areaIds, airportIds, pincode };
}

export async function loadPeakRules(): Promise<PeakRule[]> {
  const snap = await db.collection('peak_rules').where('enabled', '==', true).get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<PeakRule, 'id'>), id: d.id })).filter((r) => (r as { status?: string }).status !== 'Removed');
}

export async function loadGeoDocs(ids: string[]): Promise<Map<string, GeoFareDoc>> {
  const out = new Map<string, GeoFareDoc>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const snaps = await db.getAll(...unique.map((id) => db.doc(`geo_fares/${id}`)));
  for (const s of snaps) if (s.exists) out.set(s.id, s.data() as GeoFareDoc);
  return out;
}

export interface GeoContext {
  service: GeoService;
  brand: string;
  pickup: ResolvedPlace;
  drop: ResolvedPlace | null;
  /** Fare scope keys of the pickup, most specific first. */
  keys: string[];
  peakKeys: string[];
  /** geo_fares doc ids in resolution order (brand, then common). */
  chain: string[];
  docs: Map<string, GeoFareDoc>;
  /** Local only: both ends are in the same district and the trip is within the local distance. */
  localEligible: boolean;
  peakRules: PeakRule[];
}

/** The context of a Local Pickup & Drop (One Way inside one district) or Hourly Rental trip; null for any other trip. */
export async function geoContextFor(tripType: TripType, pickup: GeoPlace, drop: GeoPlace, distanceKm: number, brand: string): Promise<GeoContext | null> {
  const service: GeoService | null = tripType === 'Local Rental' ? 'rental' : tripType === 'One Way' && !isOutstation(distanceKm) ? 'local' : null;
  if (!service) return null;
  const [p, d] = await Promise.all([resolvePlace(pickup), service === 'local' ? resolvePlace(drop) : Promise.resolve(null)]);
  const keys = fareKeysOf(p);
  const chain = geoChain(brand || 'common', service, keys);
  const localEligible = service === 'local' && !!p.state && !!p.district && !!d && d.state === p.state && d.district === p.district;
  // Airport entry is saved on the Airport record's own Local document: read those too (brand and common).
  const airportDocs = service === 'local' ? [...p.airportIds, ...(d?.airportIds ?? [])].flatMap((id) => [brand ? geoDocId(brand, 'local', `a_${id}`) : '', geoDocId('common', 'local', `a_${id}`)]).filter(Boolean) : [];
  const [docs, peakRules] = await Promise.all([loadGeoDocs([...(service === 'local' && !localEligible ? [] : chain), ...airportDocs]), loadPeakRules()]);
  return { service, brand: brand || 'common', pickup: p, drop: d, keys, peakKeys: peakKeysOf(p), chain, docs, localEligible, peakRules };
}

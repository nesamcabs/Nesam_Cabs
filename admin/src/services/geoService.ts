import { matchMainCities } from "./mainCities";
import { callBackend } from "./backend";

/**
 * Place search (autocomplete) and reverse geocoding for the admin map picker.
 * Uses the same open Photon / OpenStreetMap services as the customer app, so no
 * API key is needed. Endpoints are overridable per environment for production
 * volume (VITE_GEOCODER_URL, VITE_MAP_TILE_URL).
 */
export const GEOCODER_URL = ((import.meta.env.VITE_GEOCODER_URL as string | undefined) || "https://photon.komoot.io").replace(/\/$/, "");
export const MAP_TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_ATTRIBUTION =
  (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
/** Search results are limited to India (lon/lat bounding box). */
export const INDIA_BBOX = "68.1,6.5,97.4,35.7";
/** Map centre until a point is chosen (head office, Theni). */
export const DEFAULT_CENTER = { lat: 10.0104, lng: 77.4768 };

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlaceResult extends LatLng {
  id: string;
  name: string;
  address: string;
  type: "airport" | "other";
  city?: string;
  state?: string;
  kind?: "city" | "landmark" | "address";
}

/** Concise labels only; the original address remains on the selected point. */
export const placeLabel = (place: PlaceResult): string =>
  place.kind === "city" ? [place.name, place.state].filter(Boolean).join(", ") : place.name;

/** Keep the secondary line useful instead of repeating the full place title. */
export function placeDetail(place: PlaceResult): string {
  if (place.kind === "city") return "";
  if (place.city || place.state) return [...new Set([place.city, place.state].filter(Boolean))].join(", ");
  const key = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const address = place.address.trim();
  const name = place.name.trim();
  const remainder = address.toLocaleLowerCase().startsWith(name.toLocaleLowerCase() + ",") ? address.slice(name.length + 1) : address;
  const parts = remainder.split(",").map(part => part.trim()).filter(part => part && key(part) !== key(name));
  return [...new Set(parts)].join(", ") || `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`;
}

export const inIndia = (p: LatLng) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= 6.5 && p.lat <= 35.7 && p.lng >= 68.1 && p.lng <= 97.4;

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | number | undefined>;
}

function featureToPlace(f: PhotonFeature): PlaceResult | null {
  const [lng, lat] = f.geometry?.coordinates ?? [];
  if (typeof lat !== "number" || typeof lng !== "number" || !inIndia({ lat, lng })) return null;
  const p = f.properties ?? {};
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const street = [s("housenumber"), s("street")].filter(Boolean).join(" ");
  const name = s("name") || street || s("locality") || s("district") || s("city") || "Pinned location";
  const parts = [s("name") && street ? street : "", s("locality"), s("district"), s("city"), s("state"), s("postcode")].filter(
    (x, i, arr) => !!x && x !== name && arr.indexOf(x) === i,
  );
  return {
    id: `osm-${p.osm_type ?? "x"}${p.osm_id ?? `${lat.toFixed(5)},${lng.toFixed(5)}`}`,
    name,
    address: [name, ...parts].join(", "),
    type: s("osm_value") === "aerodrome" || /airport/i.test(name) ? "airport" : "other",
    city: s("city") || s("locality") || s("district"),
    state: s("state"),
    kind: s("osm_key") === "place" && ["city", "town", "village"].includes(s("osm_value")) ? "city"
      : ["tourism", "historic", "amenity", "railway", "aeroway", "leisure"].includes(s("osm_key")) ? "landmark" : "address",
    lat,
    lng,
  };
}

async function getJson<T>(url: string, signal?: AbortSignal, timeoutMs = 8000): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!res.ok) throw new Error(`Geocoder returned ${res.status}`);
  return (await res.json()) as T;
}

/** Existing curated city coordinates can be shown immediately, before map search finishes. */
export function mainCityPlaces(query: string): PlaceResult[] {
  return matchMainCities(query).map(city => ({
    id: city.id, name: city.name, address: city.address, lat: city.lat!, lng: city.lng!, type: "other", kind: "city",
    state: city.address.includes(",") ? city.address.split(",").pop()!.trim() : city.address,
  }));
}

/** City first, then at most two distinct local place suggestions. */
export async function searchPlaces(query: string, near?: LatLng | null, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const cities = mainCityPlaces(q);
  const center = cities[0] || near;
  const bias = center ? `&lat=${center.lat.toFixed(3)}&lon=${center.lng.toFixed(3)}` : "";
  const search = cities[0]?.address || q;
  try {
    const google = await callBackend<{ query: string; near?: LatLng }, { places: PlaceResult[] }>("searchGooglePlaces", { query: search, ...(center ? { near: center } : {}) }, 15000);
    if (signal?.aborted) throw signal.reason;
    const seen = new Set(cities.map((p) => `${p.name}|${p.address}`.toLowerCase()));
    const places = (google.places ?? []).filter((p) => inIndia(p) && !seen.has(`${p.name}|${p.address}`.toLowerCase())).map((p) => ({ ...p, kind: "address" as const }));
    if (places.length) return [...cities, ...places].slice(0, 8);
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  let data: { features?: PhotonFeature[] };
  try {
    data = await getJson<{ features?: PhotonFeature[] }>(`${GEOCODER_URL}/api/?q=${encodeURIComponent(search)}&limit=12&lang=en&bbox=${INDIA_BBOX}${bias}`, signal);
  } catch (error) {
    if (signal?.aborted || !cities.length) throw error;
    return cities;
  }
  const seen = new Set<string>();
  const results = (data.features ?? [])
    .map(featureToPlace)
    .filter((p): p is PlaceResult => {
      if (!p) return false;
      // The provider can return the same named feature more than once. Preserve
      // similarly named places at different coordinates rather than merging cities.
      const k = `${p.name}|${p.address}|${p.lat.toFixed(3)},${p.lng.toFixed(3)}`.toLocaleLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const norm = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const distance = (place: PlaceResult, city: PlaceResult) => Math.hypot((place.lat - city.lat) * 111, (place.lng - city.lng) * 111 * Math.cos(city.lat * Math.PI / 180));
  const suggestions = results.filter(place => {
    if (!cities.length) return true;
    if (place.kind === "city" && cities.some(city => distance(place, city) < 10)) return false;
    // A city search suggests distinct local places, not repeated highway segments.
    return place.kind === "landmark" && cities.some(city => distance(place, city) < 35);
  }).sort((a, b) => Number(b.kind === "city") - Number(a.kind === "city") || Number(b.kind === "landmark") - Number(a.kind === "landmark"));
  const unique = new Set(cities.map(city => norm(placeLabel(city))));
  return [...cities, ...suggestions.filter(place => {
    const key = norm(placeLabel(place) + " " + placeDetail(place));
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  })].slice(0, 3);
}

/** Address for a point. Never throws: when the geocoder is unreachable the coordinates are the label. */
export async function reverseGeocode(p: LatLng, signal?: AbortSignal): Promise<{ name: string; address: string; resolved: boolean }> {
  const coords = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  try {
    try {
      const google = await callBackend<LatLng, { place: PlaceResult }>("reverseGoogleGeocode", p, 15000);
      if (signal?.aborted) throw signal.reason;
      if (google.place && inIndia(google.place)) return { name: google.place.name, address: google.place.address, resolved: true };
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    const data = await getJson<{ features?: PhotonFeature[] }>(`${GEOCODER_URL}/reverse?lat=${p.lat}&lon=${p.lng}&lang=en&limit=1`, signal, 6000);
    const place = data.features?.[0] ? featureToPlace(data.features[0]) : null;
    if (place) return { name: place.name, address: place.address, resolved: true };
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  return { name: "Pinned location", address: coords, resolved: false };
}

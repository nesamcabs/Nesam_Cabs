// Local Taxi set-up helpers for the admin: start a zone from a map boundary, and start fares from the CURRENT fare
// settings (Pricing → Local fares, i.e. tariff_v2.localPickupDrop) so Local Taxi and the existing tariff agree.
// Nothing here saves anything by itself: the admin reviews the result and the server validates every save.
import type { VehicleCategory } from "../types";
import { CLASS_LABEL, TARIFF_CLASSES, type LocalFare, type Tariff, type TariffClass, validLocalFare } from "./tariffService";
import type { FareConfig, Position } from "./localTaxiService";

// ── Boundary from OpenStreetMap ───────────────────────────────────────────────────────────────────────────────────
export interface OsmBoundary { points: Position[]; title: string; source: string; widthKm: number; heightKm: number; parts: number }

const area = (r: Position[]) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i]!, b = r[(i + 1) % r.length]!; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };

/** Douglas–Peucker simplification (degrees). Keeps the shape, drops points that lie within `tol` of a straight line. */
function simplify(pts: Position[], tol: number): Position[] {
  if (pts.length <= 3) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const dist = (p: Position, a: Position, b: Position) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) { const d = dist(pts[i]!, pts[s]!, pts[e]!); if (d > max) { max = d; idx = i; } }
    if (idx >= 0 && max > tol) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * The outline OpenStreetMap holds for a place (for example "Erode"). It is community-maintained, NOT an official survey
 * record: the admin must look at it on the map and confirm it before the zone goes live.
 */
export async function osmBoundary(name: string, maxPoints = 300): Promise<OsmBoundary> {
  const q = new URLSearchParams({ format: "jsonv2", polygon_geojson: "1", polygon_threshold: "0.0002", limit: "10", countrycodes: "in", q: name });
  let rows: any[];
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${q.toString()}`, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    rows = await r.json();
  } catch { throw new Error("Could not reach OpenStreetMap. Check your connection, or draw the boundary on the map by hand."); }
  // Several outlines can match a name (district, taluk, city). Take the SMALLEST real area: a city zone must not be a whole district.
  const size = (x: any) => { const b = (x.boundingbox as string[]).map(Number); return { h: (b[1]! - b[0]!) * 111, w: (b[3]! - b[2]!) * 111 * Math.cos((b[0]! * Math.PI) / 180) }; };
  const hit = rows
    .filter((x) => x.geojson && (x.geojson.type === "Polygon" || x.geojson.type === "MultiPolygon") && x.category === "boundary" && Math.min(size(x).w, size(x).h) >= 3)
    .sort((a, b) => size(a).w * size(a).h - size(b).w * size(b).h)[0];
  if (!hit) throw new Error(`OpenStreetMap has no outline for “${name}”. Draw the boundary on the map by hand.`);
  const polys: Position[][] = hit.geojson.type === "Polygon" ? [hit.geojson.coordinates[0]] : hit.geojson.coordinates.map((p: Position[][]) => p[0]);
  let ring = polys.reduce((a, b) => (area(b) > area(a) ? b : a)).map(([x, y]: number[]) => [Number(x!.toFixed(6)), Number(y!.toFixed(6))] as Position);
  if (ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]) ring = ring.slice(0, -1);
  let tol = 0.00005;
  let out = ring;
  while (out.length > maxPoints && tol < 0.01) { tol *= 1.6; out = simplify(ring, tol); }
  const sz = size(hit);
  return { points: out, title: String(hit.display_name ?? name), source: "OpenStreetMap", widthKm: Math.round(sz.w * 10) / 10, heightKm: Math.round(sz.h * 10) / 10, parts: polys.length };
}

// ── Current fare settings → Local Taxi ────────────────────────────────────────────────────────────────────────────
/** The tariff class a vehicle category is priced as (same rule as the Pricing page). */
export function tariffClassOf(c: VehicleCategory): TariffClass {
  const saved = String((c as unknown as { tariffClass?: unknown }).tariffClass ?? "").toLowerCase() as TariffClass;
  if (TARIFF_CLASSES.includes(saved)) return saved;
  const name = (c.name || "").toLowerCase();
  if (/crysta/.test(name)) return "crysta";
  if (/innova/.test(name)) return "innova";
  const seats = c.seatingCapacity || 0;
  if (/(suv|xuv|ertiga|marazzo|carens|xl6|scorpio|fortuner|muv|mpv)/.test(name)) return seats >= 7 || /7\s*\+\s*1/.test(name) ? "suv7" : "suv";
  if (/(sedan|dzire|etios|aura|verna|mini|hatch|micro|swift|wagon|alto|auto)/.test(name)) return "sedan";
  return seats >= 7 ? "suv7" : seats >= 6 ? "suv" : "sedan";
}

export interface LocalCity { id: string; name: string }
export const localCities = (t: Tariff | null | undefined): LocalCity[] => Object.entries(t?.localPickupDrop ?? {}).map(([id, v]) => ({ id, name: v.cityName || id }));

/** The saved Local Pickup & Drop fare for a city and class. An Innova / SUV 7+1 with no rates of its own uses the SUV rates, as the server does. */
export function currentLocalFare(t: Tariff | null | undefined, cityId: string, cls: TariffClass): LocalFare | null {
  const classes = t?.localPickupDrop?.[cityId]?.classes;
  const own = classes?.[cls];
  if (validLocalFare(own)) return own;
  const fallback = cls === "innova" || cls === "suv7" ? classes?.suv : undefined;
  return validLocalFare(fallback) ? fallback : null;
}

/** What the current tariff charges for a trip of `km` (before GST): the package covers the minimum km, more is charged per km. */
export const currentFareRupees = (f: LocalFare, km: number): number => Math.round(Math.max(f.minKm, Math.round(km * 10) / 10) * f.customerRate * 100) / 100;

export const LT_DEFAULTS = { surgeMax: 20000, cancelFeePaise: 3000, cancelGraceSeconds: 120, distCapBps: 15000 } as const;

/**
 * Local Taxi fare settings that reproduce the current Local Pickup & Drop fare for distance, and carry over its waiting
 * rate and the partner/customer margin. Time-based charges, night, surge and tax start OFF: they are new settings the
 * business must choose, so they are never guessed.
 *   base fare = minimum km × rate · included distance = minimum km · per extra km = rate · minimum fare = base fare
 *   commission = (customer rate − partner rate) ÷ customer rate
 */
export function fareFromLocalFare(f: LocalFare, freeWaitingMinutes = 0): FareConfig {
  const base = Math.round(f.minKm * f.customerRate * 100);
  return {
    currency: "INR", baseFarePaise: base, includedMeters: Math.round(f.minKm * 1000), perKmPaise: Math.round(f.customerRate * 100), perMinutePaise: 0, minimumFarePaise: base,
    freeWaitingSeconds: Math.max(0, Math.round(freeWaitingMinutes * 60)), waitingPerMinutePaise: Math.round((f.waitingPerHour * 100) / 60), pickupChargePaise: 0,
    night: { enabled: false, startMinute: 1320, endMinute: 360, bps: 2000 },
    surge: { enabled: false, multiplierBps: 10000, maxBps: LT_DEFAULTS.surgeMax, effectiveFromMs: null, effectiveToMs: null },
    cancellation: { feePaise: LT_DEFAULTS.cancelFeePaise, graceSeconds: LT_DEFAULTS.cancelGraceSeconds }, tax: { enabled: false, bps: 0 }, platformFeePaise: 0, rounding: "nearest_rupee",
    commissionBps: f.customerRate > 0 ? Math.max(0, Math.min(5000, Math.round(((f.customerRate - f.partnerRate) / f.customerRate) * 10000))) : 0, maxDistanceOverQuoteBps: LT_DEFAULTS.distCapBps,
  };
}

export const classLabel = (c: TariffClass) => CLASS_LABEL[c];

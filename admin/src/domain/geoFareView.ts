/**
 * Display helpers for location-scoped Local / Rental rates: which saved value a cell shows, what it inherits and from where.
 * The order is the booking server's (functions/src/domain/geoFares.ts):
 *   brand area → brand zone → brand district → shared area → shared zone → shared district → (Rental) the standard package.
 * Nothing here prices a trip: the server resolves the actual quote from the booking's own pickup location.
 */
import type { GeoFareDoc, GeoService } from "../services/geoFareService";
import { geoDocId } from "../services/geoFareService";

export type EditLevel = "district" | "zone" | "area";
export const LEVEL_LABEL: Record<EditLevel, string> = { district: "District default", zone: "Zone override", area: "Area override" };

/** Fare keys from a level up: the key at that level, then the broader ones (zone → district). */
export function keysFrom(level: EditLevel, k: { area?: string; zone?: string; district?: string }): string[] {
  const order: [EditLevel, string | undefined][] = [["area", k.area], ["zone", k.zone], ["district", k.district]];
  const start = order.findIndex(([l]) => l === level);
  return order.slice(start).map(([, v]) => v).filter((v): v is string => !!v);
}

/** Documents a target inherits from, in resolution order, without the target itself. */
export function inheritChain(brand: string, service: GeoService, keys: string[], targetId: string): string[] {
  const brands = brand && brand !== "common" ? [brand, "common"] : ["common"];
  return brands.flatMap((b) => keys.map((k) => geoDocId(b, service, k))).filter((id) => id !== targetId);
}

export interface CellView {
  /** Value saved on the target itself (all targets agree), or undefined. */
  own?: number;
  /** Bulk edit: the targets hold different values (or some hold none). */
  mixed: boolean;
  /** What applies when the target has no value of its own. */
  inherited?: { value: number; docId: string };
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One field across one or more targets (bulk), and its inherited value from the first target's chain. */
export function cellView(docs: Map<string, GeoFareDoc>, targetIds: string[], chain: string[], read: (d: GeoFareDoc | undefined) => unknown, fallback?: { value: number; docId: string }): CellView {
  const owns = targetIds.map((id) => read(docs.get(id)));
  const first = owns[0];
  const mixed = owns.some((v) => (num(v) ? v : undefined) !== (num(first) ? first : undefined));
  let inherited: CellView["inherited"];
  for (const id of chain) { const v = read(docs.get(id)); if (num(v)) { inherited = { value: v, docId: id }; break; } }
  if (!inherited && fallback) inherited = fallback;
  return { own: !mixed && num(first) ? first : undefined, mixed, inherited };
}

/** "Zone override", "District default · shared", "Standard package" for a doc id. */
export function sourceLabel(docId: string, viewingBrand: string): string {
  if (docId === "package") return "Standard package";
  const [brand, , key = ""] = docId.split("__");
  const level: EditLevel = key.startsWith("a_") ? "area" : key.startsWith("z_") ? "zone" : "district";
  return `${LEVEL_LABEL[level]}${brand === "common" && viewingBrand !== "common" ? " · shared" : ""}`;
}

/**
 * What a row's status badge says: every field set here, some inherited, or something still missing (the trip is then not priced
 * on these rates). A configured zero counts as set.
 */
export function rowStatus(cells: CellView[], level: EditLevel): { tone: "ok" | "info" | "warn" | "mixed"; text: string } {
  if (cells.some((c) => c.mixed)) return { tone: "mixed", text: "Mixed" };
  if (cells.some((c) => c.own === undefined && !c.inherited)) return { tone: "warn", text: cells.every((c) => c.own === undefined && !c.inherited) ? "Not configured" : "Incomplete" };
  if (cells.every((c) => c.own !== undefined)) return { tone: "ok", text: LEVEL_LABEL[level] };
  return { tone: "info", text: "Inherited" };
}

/** Parses a typed cell: '' = remove the value here (inherit again); otherwise a number ≥ 0, or null when invalid. */
export function parseCell(text: string): { remove: true } | { value: number } | null {
  const t = text.trim();
  if (t === "") return { remove: true };
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? { value: Math.round(n * 100) / 100 } : null;
}

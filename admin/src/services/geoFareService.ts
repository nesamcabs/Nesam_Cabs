// Location-scoped Local Pickup & Drop / Hourly Rental rates (geo_fares) and scheduled peak rules (peak_rules).
// Read live from Firestore (admins may read; nobody writes directly) and saved only through the audited server functions
// saveGeoFares / savePeakRule, which validate every value and scope and refuse a save against an older version.
import { collection, onSnapshot, query, where, type Timestamp } from "firebase/firestore";
import { db } from "./firebase";
import { callFunction } from "./callables";
import type { TariffClass } from "./tariffService";

export type GeoService = "local" | "rental";
export const LOCAL_FIELDS = ["minimumFare", "baseFare", "includedKm", "extraKmRate", "freeWaitingMin", "waitingPerMin"] as const;
export type LocalField = (typeof LOCAL_FIELDS)[number];
export const RENTAL_FIELDS = ["customerFare", "partnerPayout", "includedKm", "extraKmRate", "extraHourRate"] as const;
export type RentalField = (typeof RENTAL_FIELDS)[number];
export type Party = "customer" | "partner";

export interface GeoClassRates {
  customer?: Partial<Record<LocalField, number>>;
  partner?: Partial<Record<LocalField, number>>;
  gstMode?: "included" | "excluded";
  packages?: Record<string, Partial<Record<RentalField, number>>>;
}
export interface AirportEntry { customerFee: number; partnerFee: number; appliesTo: "pickup" | "drop" | "both" }
export interface GeoFareDoc {
  id: string;
  brand: string;
  service: GeoService;
  scopeKey: string;
  scope?: { level: string; state: string; district: string; zoneId?: string; locationId?: string; label?: string };
  classes?: Partial<Record<TariffClass, GeoClassRates>>;
  airportEntry?: AirportEntry;
  version?: number;
  updatedAt?: Timestamp;
  updatedByName?: string;
}

export const geoDocId = (brand: string, service: GeoService, key: string) => `${brand || "common"}__${service}__${key}`;

/** The brand's own documents and the shared (all brands) ones of one service, live. */
/** Firestore error code of a failed read ('permission-denied', 'unavailable', …), for telling a refusal apart from other failures. */
export type ReadFailure = { code: string; message: string };
const failureOf = (e: { code?: string; message?: string }): ReadFailure => ({ code: e.code ?? "unknown", message: e.message ?? "The read failed." });

/**
 * The brand's own documents and the shared (all brands) ones of one service, live. The shared documents are read together with the
 * brand's because a brand inherits them; both are covered by the same admin read rule (firestore.rules → geo_fares).
 */
export function subscribeGeoFares(brand: string, service: GeoService, cb: (rows: Map<string, GeoFareDoc>) => void, onError: (f: ReadFailure) => void) {
  const brands = brand && brand !== "common" ? [brand, "common"] : ["common"];
  return onSnapshot(query(collection(db, "geo_fares"), where("service", "==", service), where("brand", "in", brands)),
    (s) => cb(new Map(s.docs.map((d) => [d.id, { ...(d.data() as Omit<GeoFareDoc, "id">), id: d.id }]))), (e) => onError(failureOf(e)));
}

export interface GeoScopeInput { level: string; state: string; district: string; zoneId?: string; locationId?: string }
export type FieldPatch = Record<string, number | null>;
export interface SaveGeoFaresInput {
  brand: string;
  service: GeoService;
  targets: GeoScopeInput[];
  data: { classes?: Record<string, { customer?: FieldPatch; partner?: FieldPatch; gstMode?: "included" | "excluded" | null; packages?: Record<string, FieldPatch> }>; airportEntry?: { customerFee: number; appliesTo: AirportEntry["appliesTo"] } | null };
  expected: Record<string, number>;
  reason: string;
}
export const saveGeoFares = (input: SaveGeoFaresInput) => callFunction<SaveGeoFaresInput, { saved: { id: string; version: number }[] }>("saveGeoFares", input);

export interface PeakRule {
  id: string;
  brand: string;
  service: GeoService;
  scopeKey: string;
  scope?: GeoScopeInput & { label?: string };
  name: string;
  enabled: boolean;
  days: number[];
  slots: { start: string; end: string }[];
  from?: string;
  until?: string;
  type: "percent" | "fixed";
  value: number;
  cap?: number;
  priority: number;
  status?: "Active" | "Removed";
  version?: number;
  updatedByName?: string;
}
export function subscribePeakRules(service: GeoService, cb: (rows: PeakRule[]) => void, onError: (f: ReadFailure) => void) {
  return onSnapshot(query(collection(db, "peak_rules"), where("service", "==", service)),
    (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<PeakRule, "id">), id: d.id })).filter((r) => r.status !== "Removed")), (e) => onError(failureOf(e)));
}
export interface SavePeakRuleInput {
  id?: string; expectedVersion?: number; remove?: boolean; brand: string; service: GeoService; scope?: GeoScopeInput; name?: string; enabled?: boolean;
  days?: number[]; slots?: { start: string; end: string }[]; from?: string; until?: string; type?: "percent" | "fixed"; value?: number; cap?: number | null; priority?: number; reason: string;
}
export const savePeakRule = (input: SavePeakRuleInput) => callFunction<SavePeakRuleInput, { id: string; version: number }>("savePeakRule", input);

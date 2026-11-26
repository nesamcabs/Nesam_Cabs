// District local fares (Service & Fare Settings → Hourly Rental / Pickup & Drop): live reads of the saved documents and the
// one callable that saves them. The pricing rules are in domain/localPricing.ts (the same file the booking server uses).
import { useEffect, useState } from "react";
import { subscribeToDocument } from "./adminFirestoreService";
import { callFunction } from "./callables";
import type { BrandFares, DistrictGeo, LocalBrand, LocalSettings } from "../domain/localPricing";

export interface SavedDoc<T> {
  loaded: boolean;
  exists: boolean;
  /** 0 until first saved. Sent back on save so a newer edit is never overwritten. */
  version: number;
  value: T;
  error: string | null;
}

/** One saved document, parsed. `parse` must be a module-level function (it is applied to every snapshot). */
export function useSavedDoc<T>(path: string, parse: (raw: unknown) => T): SavedDoc<T> {
  const [state, setState] = useState<SavedDoc<T> & { path: string }>(() => ({ path: "", loaded: false, exists: false, version: 0, value: parse(null), error: null }));
  useEffect(() => subscribeToDocument<Record<string, unknown>>(
    path,
    (raw) => setState({ path, loaded: true, exists: !!raw, version: Number(raw?.version) || 0, value: parse(raw), error: null }),
    (error) => setState({ path, loaded: true, exists: false, version: 0, value: parse(null), error }),
  ), [path, parse]);
  // While the path is changing, the previous document is never shown as this one.
  return state.path === path ? state : { loaded: false, exists: false, version: 0, value: parse(null), error: null };
}

export interface SaveLocalFaresInput {
  brand: LocalBrand;
  state: string;
  district: string;
  reason: string;
  fares?: { data: BrandFares; expectedVersion: number };
  geo?: { data: DistrictGeo; expectedVersion: number };
  /** `data: null` hands a brand back to the shared settings. */
  settings?: { data: LocalSettings | null; expectedVersion: number };
}
export const saveLocalFares = (input: SaveLocalFaresInput) =>
  callFunction<SaveLocalFaresInput, { faresVersion?: number; geoVersion?: number; settingsVersion?: number }>("saveLocalFares", input);

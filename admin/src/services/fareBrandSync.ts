// A price saved under "All brands (shared)" applies to every brand: a brand that had its own price in a changed box
// gives it up and takes the shared one. A price saved under one brand never touches the others.
import { NUM_KEYS, PKG_FIELDS, type Form } from "../components/fareForm";
import { BRANDS, RENTAL_HOURS, type BrandId, type Tariff, type TariffClass, type WorkspaceService } from "./tariffService";

export interface BrandSync {
  brand: BrandId;
  name: string;
  /** How many of this brand's own prices are replaced. */
  count: number;
  /** The brandOverride save that removes them (null removes one value; rentalPackages replaces the brand's package set). */
  data: Record<string, unknown>;
}

/** A box counts as changed only when it now holds a different price. Emptying a shared box leaves the brands alone. */
const changedTo = (before: string | undefined, after: string | undefined) => {
  const a = (after ?? "").trim(), b = (before ?? "").trim();
  return a !== "" && (b === "" || Number(a) !== Number(b));
};

export function brandSyncFor(t: Tariff | null | undefined, service: WorkspaceService, cls: TariffClass, before: Form, after: Form): BrandSync[] {
  const numbers = NUM_KEYS.filter((k) => changedTo(before.v[k], after.v[k]));
  return BRANDS.flatMap(({ id, name }) => {
    const own = t?.brandOverrides?.[id]?.[service]?.[cls];
    if (!own) return [];
    const data: Record<string, unknown> = {};
    let count = 0;
    for (const k of numbers) if (typeof own[k] === "number") { data[k] = null; count++; }
    let packagesChanged = false;
    const packages: Record<string, Record<string, number>> = {};
    for (const h of RENTAL_HOURS) {
      const key = String(h);
      const row = { ...(own.rentalPackages?.[key] ?? {}) } as Record<string, number>;
      for (const { key: field } of PKG_FIELDS) {
        if (typeof row[field] === "number" && changedTo(before.pkg[key]?.[field], after.pkg[key]?.[field])) { delete row[field]; count++; packagesChanged = true; }
      }
      if (Object.keys(row).length) packages[key] = row;
    }
    if (packagesChanged) data.rentalPackages = packages;
    return count ? [{ brand: id, name, count, data }] : [];
  });
}

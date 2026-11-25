import type { RentalPackageRule } from "../services/rentalPackageRule";
import { RENTAL_HOURS, type BrandFareOverride, type FareWorkspaceScope, type Tariff, type TariffClass, type WorkspaceService } from "../services/tariffService";

// One form per Brand → Service → Vehicle class, saved as business_config/tariff_v2.brandOverrides[brand][service][class].
// "common" is the shared level every brand inherits; a blank box inherits, a typed value is this scope's own price.
// What each box feeds on the server: functions/src/domain/tariff.ts (scopedTariffForBrand, multicityRatesFor) and
// functions/src/domain/scopedExtraCharges.ts (waiting / hill / roof carrier, customer and partner).

export const NUM_KEYS = [
  "customerRate", "partnerRate", "customerBase", "partnerBase", "minKm", "minKmPerDay", "customerBata", "partnerBata",
  "cngCustomerBase", "cngPartnerBase", "cngMinKm", "cngCustomerRate", "cngPartnerRate", "cngCustomerBata", "cngPartnerBata", "cngExtraKmRate", "cngMinKmPerDay",
  "extraKmRate", "waitingPerHour", "hillCharge", "carrierCharge", "partnerWaitingPerHour", "partnerHillCharge", "partnerCarrierCharge", "petCharge", "partnerPetCharge",
] as const satisfies readonly (keyof BrandFareOverride)[];
export type NumKey = (typeof NUM_KEYS)[number];
/** Older per-vehicle waiting / tax rules. They now live once in "Rules for extra charges"; saving a scope removes its old copy. */
export const OLD_RULE_KEYS = ["freeWaitingMinutes", "waitingRoundingMinutes", "waitingRoundingScope", "taxTreatment"] as const;

export const PKG_FIELDS = [
  { key: "customerFare", label: "Customer fare", unit: "₹" },
  { key: "partnerPayout", label: "Partner payout", unit: "₹" },
  { key: "includedKm", label: "Km included", unit: "km" },
  { key: "extraKmRate", label: "Extra km", unit: "₹/km" },
  { key: "extraHourRate", label: "Extra hour", unit: "₹/hr" },
] as const;
export type PkgField = (typeof PKG_FIELDS)[number]["key"];

export interface Form { rentalRule?: RentalPackageRule; v: Record<NumKey, string>; pkg: Record<string, Record<PkgField, string>> }

export const str = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const emptyPkg = (): Record<PkgField, string> => ({ customerFare: "", partnerPayout: "", includedKm: "", extraKmRate: "", extraHourRate: "" });
export const emptyForm = (): Form => ({
  v: Object.fromEntries(NUM_KEYS.map((k) => [k, ""])) as Record<NumKey, string>,
  pkg: Object.fromEntries(RENTAL_HOURS.map((h) => [String(h), emptyPkg()])),
});

export function formOf(t: Tariff | null | undefined, brand: FareWorkspaceScope["brand"], service: WorkspaceService, cls: TariffClass): Form {
  const f = emptyForm();
  const ov = t?.brandOverrides?.[brand]?.[service]?.[cls];
  if (!ov) return f;
  f.rentalRule = ov.rentalPackageRule;
  for (const k of NUM_KEYS) f.v[k] = str(ov[k]);
  for (const h of RENTAL_HOURS) {
    const p = ov.rentalPackages?.[String(h)];
    for (const { key } of PKG_FIELDS) f.pkg[String(h)]![key] = str(p?.[key]);
  }
  return f;
}


/** A vehicle category as admin lists show it: the customer display text first, then the category name ("Dzire / Etios or similar · Sedan"). */
export const categoryTitle = (c: { name: string; description?: string }): string => {
  const shown = (c.description ?? "").trim();
  return shown && shown.length <= 48 && shown !== c.name ? `${shown} · ${c.name}` : c.name;
};

// ── Cab names shown to customers (Quick Fare desk rows, copied quotes, follow-ups, booking confirmations) ──

/**
 * Presentation names of the six standard categories. Used only when such a category has no Display Text of its own
 * (Vehicle categories › Display Text) and its name is just the generic category ("SEDAN"). Nothing is renamed or saved.
 */
export const STANDARD_CAB_NAMES = {
  HATCHBACK: "Wagon R Or Similar",
  SEDAN: "Dzire / Etios Or Similar",
  SUV: "Ertiga Or Similar",
  MUV: "Kia Carens Or Similar",
  INNOVA: "Innova",
  CRYSTA: "Innova Crysta",
} as const;
export type StandardCategory = keyof typeof STANDARD_CAB_NAMES;

/** The category fields the cab name is read from (VehicleCategory has them all). */
export interface CabCategoryLike {
  id?: string;
  name: string;
  /** Stable category code ("SEDAN"). */
  code?: string;
  /** Vehicle categories › Display Text: the car name customers see ("Dzire / Etios or similar"). */
  description?: string;
}

/** The Display Text field holds at most this many characters; anything longer is an old free-text description, not a name. */
const DISPLAY_TEXT_MAX = 48;
const keyOf = (v?: string) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const standardOf = (v?: string): StandardCategory | null => {
  const k = keyOf(v);
  return k in STANDARD_CAB_NAMES ? (k as StandardCategory) : null;
};

/** Which of the six standard categories this is, by its stable code, its id slug ("sedan") or a generic name; null for any other. */
export function standardCategoryOf(c: CabCategoryLike): StandardCategory | null {
  return standardOf(c.code) ?? standardOf(c.id) ?? standardOf(c.name);
}

/**
 * The cab name customers see, as the main heading of a vehicle:
 *  1. the category's own Display Text, unless it only repeats the category ("SEDAN");
 *  2. for one of the six standard categories whose name is only the generic category, its standard name
 *     (SEDAN → "Dzire / Etios Or Similar");
 *  3. otherwise the configured category name, so custom categories keep their own names.
 */
export function cabDisplayName(c: CabCategoryLike): string {
  const name = (c.name ?? "").trim();
  const code = (c.code ?? "").trim();
  const text = (c.description ?? "").trim();
  const repeatsCategory = (v: string) => !!standardOf(v) || keyOf(v) === keyOf(name) || (!!code && keyOf(v) === keyOf(code));
  if (text && text.length <= DISPLAY_TEXT_MAX && !repeatsCategory(text)) return text;
  const standard = standardCategoryOf(c);
  const nameIsGeneric = !name || !!standardOf(name) || (!!code && keyOf(name) === keyOf(code));
  if (standard && nameIsGeneric) return STANDARD_CAB_NAMES[standard];
  return name || code || "Vehicle";
}

/**
 * The small category badge beside the cab name: the category's code ("SEDAN"), or its name when it has no code and the
 * heading shows another name. Empty when it would only repeat the heading word for word.
 */
export function cabCategoryBadge(c: CabCategoryLike, shownName: string = cabDisplayName(c)): string {
  const name = (c.name ?? "").trim();
  const badge = (c.code ?? "").trim().toUpperCase() || (name && keyOf(name) !== keyOf(shownName) ? name.toUpperCase() : "");
  return badge && badge !== shownName.trim() ? badge : "";
}

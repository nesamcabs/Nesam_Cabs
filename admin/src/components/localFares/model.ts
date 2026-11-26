// How the page reads and edits district rates: which saved level each tab writes to, what a cell shows when several zones or
// areas are selected, and what is cleared or refused on save. Pure functions (tested in scripts/admin-local-fares.test.mjs).
import {
  LOCAL_CLASSES, LOCAL_HOURS, RULE_FIELDS, ROW_FIELDS, emptyRow, emptyRule, emptyFares, levelIsEmpty, resolveRow, resolveRule, rowIsEmpty,
  rowIsSet, rowProblem, ruleIsEmpty, ruleIsSet, ruleProblem, zoneOfPin, areaSlug, pinOfArea, slugOfArea,
  type BrandFares, type DistrictGeo, type FaresByBrand, type LevelRates, type LocalClass, type LocalRule, type Party, type RentalRow, type Scope, type ServiceZone, type Target,
} from "../../domain/localPricing";

/** One place a rate is saved at: the district, a zone (by id) or an area (a village key, or a pincode for all its villages). */
export type Level = { scope: "district" } | { scope: "zone"; id: string } | { scope: "area"; id: string };

export const levelOf = (fares: BrandFares, level: Level): LevelRates | undefined =>
  level.scope === "district" ? fares.district : level.scope === "zone" ? fares.zones[level.id] : fares.areas[level.id];

export function targetOf(geo: DistrictGeo, level: Level): Target {
  if (level.scope === "district") return {};
  if (level.scope === "zone") return { zoneId: level.id };
  const pin = pinOfArea(level.id), village = slugOfArea(level.id);
  return { pin, zoneId: zoneOfPin(geo, pin)?.id, ...(village ? { areaNames: [village] } : {}) };
}

/** The levels the open tab edits: the district, the chosen zone (or every zone), or the one chosen area / pincode. */
export function editedLevels(tab: Scope, geo: DistrictGeo, zoneId: string, areaId: string): Level[] {
  if (tab === "district") return [{ scope: "district" }];
  if (tab === "zone") return geo.zones.filter((z) => !zoneId || z.id === zoneId).map((z) => ({ scope: "zone", id: z.id }));
  return areaId ? [{ scope: "area", id: areaId }] : [];
}

/** The zones offered for a district that has none saved yet; saved only when one is given a rate or edited. */
export const suggestedZones = (list: readonly [string, string[]][] | undefined): ServiceZone[] =>
  (list ?? []).map(([town, pins]) => ({ id: `s_${areaSlug(town).slice(0, 36)}`, name: `${town} Zone`, pins: [...pins].sort() }));

function writeLevel(fares: BrandFares, level: Level, next: LevelRates): BrandFares {
  if (level.scope === "district") return { ...fares, district: next };
  const key = level.scope === "zone" ? "zones" : "areas";
  const map = { ...fares[key] };
  if (levelIsEmpty(next)) delete map[level.id]; else map[level.id] = next;
  return { ...fares, [key]: map };
}

/** Sets or removes (value undefined) one entry of a map, dropping the map when it empties. */
function withEntry<T>(map: Partial<Record<string, T>> | undefined, key: string, value: T | undefined): Partial<Record<string, T>> | undefined {
  const next = { ...(map ?? {}) };
  if (value === undefined) delete next[key]; else next[key] = value;
  return Object.keys(next).length ? next : undefined;
}
const clean = (level: LevelRates): LevelRates => Object.fromEntries(Object.entries(level).filter(([, v]) => v !== undefined)) as LevelRates;

export interface Cell<T> {
  /** The values shown; for several places that differ, the fields in `mixed` are blank. */
  value: T;
  mixed: (keyof T)[];
  /** Typed at the open tab's level (for every selected place / for some of them). */
  own: "all" | "some" | "none";
  /** Where the shown rate comes from; "mixed" when the places differ, null when nothing is set. */
  source: { scope: Scope; brand: string } | "mixed" | null;
  /** A rate typed here that is not complete yet. */
  incomplete: boolean;
}

interface Kind<T> {
  fields: readonly (keyof T)[];
  empty: () => T;
  own: (level: LevelRates | undefined) => T | undefined;
  resolve: (target: Target) => { value: T; scope: Scope; brand: string } | null;
  isSet: (v: T) => boolean;
  isEmpty: (v: T) => boolean;
  write: (level: LevelRates, value: T | undefined) => LevelRates;
}

export interface EditContext { all: FaresByBrand; mine: BrandFares; brand: string; geo: DistrictGeo }

const ruleKind = (c: EditContext, party: Party, cls: LocalClass): Kind<LocalRule> => ({
  fields: RULE_FIELDS, empty: emptyRule, isSet: ruleIsSet, isEmpty: ruleIsEmpty,
  own: (l) => l?.[party]?.[cls],
  resolve: (t) => resolveRule(c.all, c.brand, party, cls, t),
  write: (l, v) => clean({ ...l, [party]: withEntry(l[party], cls, v) }),
});
const rowKind = (c: EditContext, cls: LocalClass, hours: number): Kind<RentalRow> => ({
  fields: ROW_FIELDS, empty: emptyRow, isSet: rowIsSet, isEmpty: rowIsEmpty,
  own: (l) => l?.rental?.[cls]?.[String(hours)],
  resolve: (t) => resolveRow(c.all, c.brand, cls, hours, t),
  write: (l, v) => clean({ ...l, rental: withEntry(l.rental, cls, withEntry(l.rental?.[cls], String(hours), v)) }),
});

function readCell<T extends object>(c: EditContext, kind: Kind<T>, levels: Level[]): Cell<T> {
  const rows = levels.map((level) => {
    const own = kind.own(levelOf(c.mine, level));
    if (own) return { value: own, own: true, source: { scope: level.scope, brand: c.brand }, incomplete: !kind.isSet(own) && !kind.isEmpty(own) };
    const found = kind.resolve(targetOf(c.geo, level));
    return { value: found?.value ?? kind.empty(), own: false, source: found ? { scope: found.scope, brand: found.brand } : null, incomplete: false };
  });
  const first = rows[0];
  if (!first) return { value: kind.empty(), mixed: [], own: "none", source: null, incomplete: false };
  const mixed = kind.fields.filter((f) => rows.some((r) => r.value[f] !== first.value[f]));
  const value = { ...first.value };
  for (const f of mixed) value[f] = 0 as T[keyof T];
  const owned = rows.filter((r) => r.own).length;
  const key = (s: (typeof rows)[number]["source"]) => (s ? `${s.scope}|${s.brand}` : "");
  return {
    value, mixed, own: owned === rows.length ? "all" : owned ? "some" : "none",
    source: rows.every((r) => key(r.source) === key(first.source)) ? first.source : "mixed",
    incomplete: rows.some((r) => r.incomplete),
  };
}

/** Types one field: each selected place keeps its other values (its own, else the inherited ones). */
function editCell<T extends object>(c: EditContext, kind: Kind<T>, levels: Level[], field: keyof T, value: number): BrandFares {
  let next = c.mine;
  for (const level of levels) {
    const current = kind.own(levelOf(next, level)) ?? kind.resolve(targetOf(c.geo, level))?.value ?? kind.empty();
    const updated = { ...current, [field]: value };
    next = writeLevel(next, level, kind.write(levelOf(next, level) ?? {}, kind.isEmpty(updated) ? undefined : updated));
  }
  return next;
}
function clearCell<T extends object>(c: EditContext, kind: Kind<T>, levels: Level[]): BrandFares {
  let next = c.mine;
  for (const level of levels) {
    const existing = levelOf(next, level);
    if (existing && kind.own(existing)) next = writeLevel(next, level, kind.write(existing, undefined));
  }
  return next;
}

export const readRule = (c: EditContext, party: Party, cls: LocalClass, levels: Level[]) => readCell(c, ruleKind(c, party, cls), levels);
export const editRule = (c: EditContext, party: Party, cls: LocalClass, levels: Level[], field: keyof LocalRule, value: number) => editCell(c, ruleKind(c, party, cls), levels, field, value);
/** Removes what was typed at these levels for the vehicle (customer and partner), so the inherited rate applies again. */
export function clearRules(c: EditContext, cls: LocalClass, levels: Level[]): BrandFares {
  const customer = clearCell(c, ruleKind(c, "customer", cls), levels);
  return clearCell({ ...c, mine: customer }, ruleKind(c, "partner", cls), levels);
}
export const readRow = (c: EditContext, cls: LocalClass, hours: number, levels: Level[]) => readCell(c, rowKind(c, cls, hours), levels);
export const editRow = (c: EditContext, cls: LocalClass, hours: number, levels: Level[], field: keyof RentalRow, value: number) => editCell(c, rowKind(c, cls, hours), levels, field, value);
export const clearRow = (c: EditContext, cls: LocalClass, hours: number, levels: Level[]) => clearCell(c, rowKind(c, cls, hours), levels);

const SCOPE_LABEL: Record<Scope, string> = { district: "District default", zone: "Zone override", area: "Area override" };
/** The "Rate source" badge. */
export function sourceLabel(cell: Pick<Cell<unknown>, "source" | "incomplete">, brand: string): string {
  if (cell.incomplete) return "Incomplete";
  if (cell.source === null) return "Not set";
  if (cell.source === "mixed") return "Mixed";
  return `${SCOPE_LABEL[cell.source.scope]}${brand !== "common" && cell.source.brand === "common" ? " · shared" : ""}`;
}

/** The first half-filled rate, named for the message ('' = everything can be saved). */
export function faresProblem(fares: BrandFares, names: { district: string; zone: (id: string) => string; vehicle: (cls: LocalClass) => string; area?: (key: string) => string }): string {
  const levels: [string, LevelRates][] = [
    [`${names.district} district`, fares.district],
    ...Object.entries(fares.zones).map(([id, l]): [string, LevelRates] => [names.zone(id), l]),
    ...Object.entries(fares.areas).map(([key, l]): [string, LevelRates] => [names.area?.(key) ?? `Area ${key}`, l]),
  ];
  for (const [where, level] of levels) {
    for (const cls of LOCAL_CLASSES) {
      for (const party of ["customer", "partner"] as const) {
        const rule = level[party]?.[cls];
        const problem = rule ? ruleProblem(rule) : "";
        if (problem) return `${where} · ${names.vehicle(cls)} · ${party === "customer" ? "Customer fare" : "Partner payout"}: ${problem}.`;
      }
      for (const h of LOCAL_HOURS) {
        const row = level.rental?.[cls]?.[String(h)];
        const problem = row ? rowProblem(row) : "";
        if (problem) return `${where} · ${names.vehicle(cls)} · ${h}-hour package: ${problem}.`;
      }
    }
  }
  return "";
}

/** Vehicles whose Pickup & Drop customer fare is typed here without a partner payout (or the reverse): the pair is needed to price. */
export function unpairedRules(c: EditContext, levels: Level[], classes: readonly LocalClass[]): LocalClass[] {
  return classes.filter((cls) => levels.some((level) => {
    const t = targetOf(c.geo, level);
    return !!resolveRule(c.all, c.brand, "customer", cls, t) !== !!resolveRule(c.all, c.brand, "partner", cls, t);
  }));
}

export const sameData = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));

export const blankFares = emptyFares;

/** Tamil names of well-known areas, shown until the office types its own for a pincode. */
const TAMIL: Record<string, string> = {
  theni: "தேனி", veerapandi: "வீரபாண்டி", aundipatti: "ஆண்டிபட்டி", andipatti: "ஆண்டிபட்டி", bodinayakanur: "போடிநாயக்கனூர்",
  periyakulam: "பெரியகுளம்", devadanapatti: "தேவதானப்பட்டி", chinnamanur: "சின்னமனூர்", uthamapalayam: "உத்தமபாளையம்",
  cumbum: "கம்பம்", kadamalaikundu: "கடமலைக்குண்டு", koduvilarpatti: "கொடுவிலார்பட்டி", allinagaram: "அல்லிநகரம்",
  palanichettipatti: "பழனிசெட்டிபட்டி", surulipatti: "சுருளிப்பட்டி", bodimettu: "போடிமெட்டு",
};
/** An area's Tamil name: one saved with the district, else the directory's, else a well-known one; '' when unknown. */
export const tamilNameOf = (geo: DistrictGeo, area: { key: string; name: string; tamil: string }): string =>
  geo.tamil[area.key] ?? (area.tamil || TAMIL[areaSlug(area.name)] || "");

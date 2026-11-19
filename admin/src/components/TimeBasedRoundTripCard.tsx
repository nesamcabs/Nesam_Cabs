import { useEffect, useMemo, useState, type ReactNode } from "react";
import { saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { CLASS_LABEL, TARIFF_CLASSES, inr, useTariff, type TariffClass, type TimeBasedClassRates, type TimeBasedSettings } from "../services/tariffService";
import { useCan, useCanDo } from "./AccessContext";
import { Button } from "./ui";
import { CardBody, Problems, RateTable, SaveBar, SettingCard, vehicleColumns, type RateGroup, type RateRow, type VehicleCol } from "./RateTable";

/**
 * Time-based Round Trip (Customer UX v8, 16 Nov 2026). Customers choose trip DAYS, never a return time:
 *   1 day  → before 3 PM: 5-Hour / 8-Hour / Full-Day Return by round-trip distance and driving time (5h ≤ 100 km, 8h ≤ 150 km);
 *            from 3 PM: 5-Hour (until 6:45 PM) / 8-Hour (until 3:45 PM) while they fit, plus the overnight options;
 *   2 days → Next-Day Return (day-1 slab by ORIGINAL pickup time + one Full Day) or Morning Return (3 PM to 12:59 AM pickups, ≤ 250 km, back by 9 AM);
 *   3+     → day-1 slab + one Full Day per further day.
 * Hill stations never use the 5-Hour / 8-Hour packages (see the Hill station card).
 * The Full-Day package is the category's own Round Trip day (daily minimum km × rate + allowance) set in the rate card above.
 * Driver allowance is included in every package here. Applies to every brand, like the Round Trip rate card it sits on.
 */
const DEFAULTS: Required<TimeBasedSettings> = { enabled: false, cutoffMinutes: 1425, morningCutoffMinutes: 540, nextDayEightFromMinutes: 900, nextDayFiveFromMinutes: 1320, shortKmLimit: 150, fiveKmLimit: 100, lateNightEndMinutes: 60, fiveHours: 5, eightHours: 8, extraSlabs: [], names: {} };
/** Extra hour slabs the office adds (3-hour, 6-hour, 10-hour …): hours + round-trip km limit, shared by every vehicle; amounts are per vehicle. */
const MAX_EXTRA_SLABS = 8;
type SlabDraft = { key: string; hours: string; km: string; name: string };
/** The packages a customer sees whose names the office can change; the placeholder is the standard name. */
const NAME_FIELDS = [["five", "5-hour package", "5-Hour Return"], ["eight", "8-hour package", "8-Hour Return"], ["full", "Full-day package", "Full-Day Return"], ["morning", "Morning return", "Morning Return"], ["next", "Overnight (2-day) package", "Next-Day Return"]] as const;
type NameKey = (typeof NAME_FIELDS)[number][0];
const MAX_NAME = 40;
/** The name boxes show the name customers see: the saved one, else the standard one. */
const namesOf = (n?: Partial<Record<NameKey, string>>): Record<NameKey, string> => Object.fromEntries(NAME_FIELDS.map(([k, , std]) => [k, (n?.[k] ?? "").trim() || std])) as Record<NameKey, string>;
/** Only a name that differs from the standard one is stored; the standard name keeps following the default. */
const stored = (v: string, std: string) => (v.trim() === std ? "" : v.trim());
const STD: Record<NameKey, string> = Object.fromEntries(NAME_FIELDS.map(([k, , std]) => [k, std])) as Record<NameKey, string>;
const slabStd = (hours: string | number) => `${hours}-Hour Return`;
type ExtraAmounts = { fare: string; km: string; partner: string };
const EMPTY_EXTRA: ExtraAmounts = { fare: "", km: "", partner: "" };
let slabSeq = 0;
const newSlabKey = () => `new${Date.now().toString(36)}${slabSeq++}`;
const FIELDS = ["fiveFare", "fiveKm", "fivePartner", "eightFare", "eightKm", "eightPartner", "morningFare", "morningKm", "morningPartner"] as const;
type Field = (typeof FIELDS)[number];
type Draft = Record<Field, string>;
const EMPTY: Draft = { fiveFare: "", fiveKm: "", fivePartner: "", eightFare: "", eightKm: "", eightPartner: "", morningFare: "", morningKm: "", morningPartner: "" };

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const minutesOf = (v: string): number | null => (/^\d{2}:\d{2}$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null);
const pretty = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${m >= 720 ? "PM" : "AM"}`;
const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const toDraft = (t?: Partial<TimeBasedClassRates>): Draft => Object.fromEntries(FIELDS.map((f) => [f, t?.[f] !== undefined ? String(t[f]) : ""])) as Draft;


export default function TimeBasedRoundTripCard({ vehicles }: { vehicles?: VehicleCol[] } = {}) {
  const { tariff } = useTariff();
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const saved = tariff?.roundTrip?.timeBased;
  const [times, setTimes] = useState({ cutoff: "23:45", morning: "09:00", eight: "15:00", five: "22:00", late: "01:00" });
  const [limits, setLimits] = useState({ km: "150", fiveKm: "100", five: "5", eight: "8" });
  const [rows, setRows] = useState<Partial<Record<TariffClass, Draft>>>({});
  const [slabs, setSlabs] = useState<SlabDraft[]>([]);
  const [names, setNames] = useState<Record<NameKey, string>>(() => namesOf());
  // Per vehicle, per slab key: the extra slab's fare, included km and partner payout.
  const [extra, setExtra] = useState<Partial<Record<TariffClass, Record<string, ExtraAmounts>>>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Every rate class a vehicle category uses is a column, so no vehicle is missing; one without a saved Round Trip rate card (the server
  // needs it first) is shown read-only with a note. Without the vehicle list, only the classes that have a rate card are shown.
  const hasBase = (c: TariffClass) => !!tariff?.roundTrip?.classes?.[c];
  const cards = useMemo(() => TARIFF_CLASSES.filter((c) => (vehicles?.length ? vehicles.some((v) => v.cls === c) : !!tariff?.roundTrip?.classes?.[c])), [tariff, vehicles]);
  const noBase = "Set this vehicle's Round Trip rates in the table above first; its packages sit on top of them.";

  useEffect(() => {
    const s = { ...DEFAULTS, ...(saved ?? {}) };
    setTimes({ cutoff: clock(s.cutoffMinutes), morning: clock(s.morningCutoffMinutes), eight: clock(s.nextDayEightFromMinutes), five: clock(s.nextDayFiveFromMinutes), late: clock(s.lateNightEndMinutes) });
    setLimits({ km: String(s.shortKmLimit), fiveKm: String(s.fiveKmLimit), five: String(s.fiveHours), eight: String(s.eightHours) });
    setRows(Object.fromEntries(TARIFF_CLASSES.map((c) => [c, toDraft(tariff?.roundTrip?.classes?.[c]?.timeBased)])) as Partial<Record<TariffClass, Draft>>);
    setSlabs((s.extraSlabs ?? []).map((x) => ({ key: `h${x.hours}`, hours: String(x.hours), km: String(x.kmLimit), name: x.name || slabStd(x.hours) })));
    setNames(namesOf(s.names));
    setExtra(Object.fromEntries(TARIFF_CLASSES.map((c) => {
      const ex = tariff?.roundTrip?.classes?.[c]?.timeBased?.extra ?? {};
      return [c, Object.fromEntries(Object.entries(ex).map(([id, v]) => [id, { fare: String(v.fare), km: String(v.km), partner: String(v.partner) }]))];
    })) as Partial<Record<TariffClass, Record<string, ExtraAmounts>>>);
    setReason("");
    setMessage(null);
  }, [tariff?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const cutoff = minutesOf(times.cutoff), morning = minutesOf(times.morning), eightFrom = minutesOf(times.eight), fiveFrom = minutesOf(times.five), lateEnd = minutesOf(times.late);
  const five = Number(limits.five), eight = Number(limits.eight), kmLimit = Number(limits.km), fiveKmLimit = Number(limits.fiveKm);
  const settingsError =
    cutoff === null || morning === null || eightFrom === null || fiveFrom === null || lateEnd === null ? "Enter every time as hours and minutes."
    : !(five > 0 && eight > five) ? "The 5-hour package must be shorter than the 8-hour package."
    : !(kmLimit > 0) || !(fiveKmLimit > 0) ? "Enter the short-package kilometre limits."
    : fiveKmLimit > kmLimit ? "The 5-hour kilometre limit cannot be above the 8-hour limit."
    : lateEnd >= eightFrom ? "The late-night group must end before the 8-hour first-day start."
    : cutoff <= eight * 60 ? "The booked cutoff must be later than the 8-hour package."
    : eightFrom >= fiveFrom ? "The 8-hour first-day start must be earlier than the 5-hour first-day start."
    : morning >= 720 ? "The Morning Return cutoff must be before noon."
    : slabError();

  function slabError(): string {
    const seen = new Set<number>();
    for (const sl of slabs) {
      const h = Number(sl.hours), km = Number(sl.km);
      if (!Number.isInteger(h) || h < 1 || h > 23) return "Extra slab hours must be a whole number from 1 to 23.";
      if (h === five || h === eight) return `A ${h}-hour package already exists. Give the extra slab other hours.`;
      if (seen.has(h)) return `There are two ${h}-hour slabs. Each slab needs its own hours.`;
      if (cutoff !== null && h * 60 >= cutoff) return `A ${h}-hour slab cannot end before the booked cutoff.`;
      if (!(km > 0)) return `Enter the ${h}-hour slab's kilometre limit.`;
      seen.add(h);
    }
    return "";
  }

  const classError = (c: TariffClass): string => {
    const d = rows[c];
    if (!d) return "";
    const filled = FIELDS.filter((f) => d[f].trim() !== "");
    if (!filled.length) return Object.keys(draftExtraOf(c)).length ? "Enter the 5-hour and 8-hour packages before its extra hour slabs." : "";
    const core = ["fiveFare", "fiveKm", "fivePartner", "eightFare", "eightKm", "eightPartner"] as const;
    if (core.some((f) => !(num(d[f]) !== null && (num(d[f]) as number) > 0))) return "Enter all six 5-hour and 8-hour amounts (above zero), or clear them all.";
    const mor = ["morningFare", "morningKm", "morningPartner"] as const;
    const morFilled = mor.filter((f) => d[f].trim() !== "").length;
    if (morFilled !== 0 && (morFilled !== 3 || mor.some((f) => !((num(d[f]) as number) > 0)))) return "Morning Return needs its fare, kilometres and partner payout together, or none.";
    if ((num(d.fiveFare) as number) >= (num(d.eightFare) as number)) return "The 5-hour fare must be lower than the 8-hour fare.";
    if ((num(d.fiveKm) as number) >= (num(d.eightKm) as number)) return "The 5-hour kilometres must be fewer than the 8-hour kilometres.";
    for (const sl of slabs) {
      const a = extra[c]?.[sl.key];
      if (!a) continue;
      const vals = [a.fare, a.km, a.partner].map((v) => v.trim());
      const n = vals.filter((v) => v !== "").length;
      if (n === 0) continue;
      if (n !== 3 || vals.some((v) => !(Number(v) > 0))) return `The ${sl.hours || "?"}-hour slab needs its fare, kilometres and partner payout together (above zero), or none.`;
      if (Number(a.partner) > Number(a.fare)) return `The ${sl.hours}-hour partner payout cannot be above the customer fare.`;
    }
    return "";
  };
  const anyClassError = cards.map(classError).find(Boolean) ?? "";
  const anyData = cards.some((c) => FIELDS.some((f) => (rows[c]?.[f] ?? "").trim() !== ""));
  // Always on: Round Trip is time-based whenever a vehicle has its packages; with none it stays calendar-day pricing.
  const enabled = anyData;

  const currentSnapshot = JSON.stringify([saved?.enabled === true, saved ? [saved.cutoffMinutes, saved.morningCutoffMinutes, saved.nextDayEightFromMinutes, saved.nextDayFiveFromMinutes, saved.shortKmLimit, saved.fiveKmLimit ?? DEFAULTS.fiveKmLimit, saved.lateNightEndMinutes ?? DEFAULTS.lateNightEndMinutes, saved.fiveHours, saved.eightHours, (saved.extraSlabs ?? []).map((x) => [x.hours, x.kmLimit, stored(x.name ?? "", slabStd(x.hours))]), NAME_FIELDS.map(([k]) => stored(namesOf(saved.names)[k], STD[k]))] : null, cards.map((c) => toDraft(tariff?.roundTrip?.classes?.[c]?.timeBased)), cards.map((c) => extraPayload(tariff?.roundTrip?.classes?.[c]?.timeBased?.extra))]);
  const draftSnapshot = JSON.stringify([enabled, saved || enabled || anyData ? [cutoff, morning, eightFrom, fiveFrom, kmLimit, fiveKmLimit, lateEnd, five, eight, slabs.map((sl) => [Number(sl.hours), Number(sl.km), stored(sl.name, slabStd(sl.hours))]), NAME_FIELDS.map(([k]) => stored(names[k], STD[k]))] : null, cards.map((c) => rows[c] ?? EMPTY), cards.map((c) => extraPayload(draftExtraOf(c)))]);
  const changed = currentSnapshot !== draftSnapshot;

  const setField = (c: TariffClass, f: Field, v: string) => setRows((r) => ({ ...r, [c]: { ...(r[c] ?? EMPTY), [f]: v } }));
  const setExtraField = (c: TariffClass, key: string, f: keyof ExtraAmounts, v: string) =>
    setExtra((x) => ({ ...x, [c]: { ...(x[c] ?? {}), [key]: { ...(x[c]?.[key] ?? EMPTY_EXTRA), [f]: v } } }));
  /** A vehicle's extra-slab amounts as saved: by slab id ('h6'), complete entries only. */
  function draftExtraOf(c: TariffClass): Record<string, { fare: number; km: number; partner: number }> {
    const out: Record<string, { fare: number; km: number; partner: number }> = {};
    for (const sl of slabs) {
      const a = extra[c]?.[sl.key];
      if (!a || a.fare.trim() === "" || !(Number(sl.hours) > 0)) continue;
      out[`h${Number(sl.hours)}`] = { fare: Number(a.fare), km: Number(a.km), partner: Number(a.partner) };
    }
    return out;
  }
  function extraPayload(x?: Record<string, { fare: number; km: number; partner: number }>) {
    return Object.keys(x ?? {}).sort().map((k) => [k, x![k]!.fare, x![k]!.km, x![k]!.partner]);
  }
  const addSlab = () => {
    const used = new Set([five, eight, ...slabs.map((s) => Number(s.hours))]);
    const suggestion = [3, 4, 6, 10, 12, 2, 7, 9, 11].find((h) => !used.has(h)) ?? 1;
    setSlabs((s) => (s.length >= MAX_EXTRA_SLABS ? s : [...s, { key: newSlabKey(), hours: String(suggestion), km: String(Math.max(20, suggestion * 20)), name: slabStd(suggestion) }]));
  };
  const removeSlab = (key: string) => {
    setSlabs((s) => s.filter((x) => x.key !== key));
    setExtra((x) => Object.fromEntries(Object.entries(x).map(([c, m]) => [c, Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => k !== key))])) as typeof x);
  };

  const save = async () => {
    if (!canEdit || busy || !changed || settingsError || anyClassError) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Add a short reason." });
    setBusy(true);
    setMessage(null);
    try {
      const classes: Record<string, unknown> = {};
      for (const c of cards) {
        if (!hasBase(c)) continue;
        const d = rows[c] ?? EMPTY;
        const has = FIELDS.some((f) => d[f].trim() !== "");
        const had = !!tariff?.roundTrip?.classes?.[c]?.timeBased;
        if (!has) { if (had) classes[c] = null; continue; }
        const mor = d.morningFare.trim() !== "";
        classes[c] = {
          fiveFare: num(d.fiveFare), fiveKm: num(d.fiveKm), fivePartner: num(d.fivePartner), eightFare: num(d.eightFare), eightKm: num(d.eightKm), eightPartner: num(d.eightPartner),
          ...(mor ? { morningFare: num(d.morningFare), morningKm: num(d.morningKm), morningPartner: num(d.morningPartner) } : {}),
          ...(Object.keys(draftExtraOf(c)).length ? { extra: draftExtraOf(c) } : {}),
        };
      }
      await saveTariffSection({
        section: "roundTripTimeBased", expectedVersion: tariff?.version ?? 0, reason: reason.trim(),
        data: { enabled, settings: { cutoffMinutes: cutoff, morningCutoffMinutes: morning, nextDayEightFromMinutes: eightFrom, nextDayFiveFromMinutes: fiveFrom, shortKmLimit: kmLimit, fiveKmLimit, lateNightEndMinutes: lateEnd, fiveHours: five, eightHours: eight, extraSlabs: slabs.map((sl) => ({ hours: Number(sl.hours), kmLimit: Number(sl.km), ...(stored(sl.name, slabStd(sl.hours)) ? { name: stored(sl.name, slabStd(sl.hours)) } : {}) })), names: Object.fromEntries(NAME_FIELDS.map(([k]) => [k, stored(names[k], STD[k])]).filter(([, v]) => v)) }, classes },
      });
      setReason("");
      setMessage({ ok: true, text: enabled ? "Saved. New Round Trip quotes are now time-based; bookings already made keep the package they were sold." : "Saved. Round Trip quotes use calendar-day pricing." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ActionError ? err.message : "It was not saved. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const rule = settingsError ? null : [
    `Pickup ${pretty(lateEnd as number)} to ${pretty((eightFrom as number) - 1)}: ${eight}-hour, ${five}-hour and Full-Day Return by distance and driving time (${five}-hour up to ${fiveKmLimit} km, ${eight}-hour up to ${kmLimit} km, Full Day above; beyond 250 km the Full Day plus extra km).`,
    `Pickup ${pretty(eightFrom as number)} to ${pretty((cutoff as number) - eight * 60)}: ${eight}-hour and ${five}-hour while they fit, plus Morning Return and the Next-Day Return. No stand-alone Full-Day card from ${pretty(eightFrom as number)}.`,
    `Pickup ${pretty((cutoff as number) - eight * 60 + 1)} to ${pretty((cutoff as number) - five * 60)}: ${five}-hour while it fits, plus Morning Return and the Next-Day Return.`,
    `Pickup ${pretty((cutoff as number) - five * 60 + 1)} to ${pretty((lateEnd as number) - 1)}: overnight only — Morning Return (back by ${pretty(morning as number)}, round trip up to the package km) or the Next-Day Return; the trip becomes 2 days.`,
    `Next-Day / multi-day by ORIGINAL pickup time: before ${pretty(eightFrom as number)} = Full Day + Full Days; ${pretty(eightFrom as number)}–${pretty((fiveFrom as number) - 1)} = ${eight}-hour + Full Days; ${pretty(fiveFrom as number)}–${pretty((lateEnd as number) - 1)} = ${five}-hour + Full Days. Ends the last calendar date at ${pretty(cutoff as number)}.`,
    `Past ${eight} hours or ${kmLimit} km a booked short package moves up to the next slab (never down). Hill stations skip the ${five}-hour / ${eight}-hour packages.`,
    ...(slabs.length ? [`Extra hour slabs (${slabs.map((sl) => `${sl.hours} h up to ${sl.km} km`).join(", ")}) are offered the same way, for each vehicle that has their amounts: while the pickup plus the slab's hours ends by ${pretty(cutoff as number)}, the round trip is within the slab's km and the drive fits in its hours. Hill stations skip them too. A trip that outgrows its slab moves to the next bigger one by hours.`] : []),
  ];

  const nameOf = (c: TariffClass) => vehicles?.find((v) => v.cls === c && v.owner)?.name ?? CLASS_LABEL[c];
  const statusOf = (c: TariffClass) => {
    if (!hasBase(c)) return { tone: "off" as const, text: "Needs Round Trip rates", title: noBase };
    const err = classError(c); return err ? { tone: "warn" as const, text: "Check", title: err } : undefined;
  };
  const columns = vehicles?.length ? vehicleColumns(vehicles, (c) => cards.includes(c), statusOf) : cards.map((c) => ({ key: c, name: nameOf(c), status: statusOf(c) }));
  const pkgRows = (key: "five" | "eight" | "morning") => ([["Fare", "Customer fare", "₹"], ["Km", "Included km", "km"], ["Partner", "Partner payout", "₹"]] as const).map(([suffix, label, unit]) => {
    const f = `${key}${suffix}` as Field;
    return { key: f, label, unit, cell: (c: string) => { if (!hasBase(c as TariffClass)) return { display: "—", title: noBase }; const v = rows[c as TariffClass]?.[f] ?? ""; return { value: v, own: v !== "", onChange: (next: string) => setField(c as TariffClass, f, next) }; } };
  });
  const extraRowsOf = (sl: SlabDraft) => ([["fare", "Customer fare", "₹"], ["km", "Included km", "km"], ["partner", "Partner payout", "₹"]] as const).map(([f, label, unit]) => ({
    key: `${sl.key}-${f}`, label, unit,
    cell: (c: string) => { if (!hasBase(c as TariffClass)) return { display: "—", title: noBase }; const v = extra[c as TariffClass]?.[sl.key]?.[f] ?? ""; return { value: v, own: v !== "", onChange: (next: string) => setExtraField(c as TariffClass, sl.key, f, next) }; },
  }));
  const fullDayRow = {
    key: "fullDay", label: names.full.trim() || STD.full, unit: "₹",
    cell: (c: string) => {
      const rt = tariff?.roundTrip?.classes?.[c as TariffClass];
      const full = rt?.customerRate !== undefined && rt.minKmPerDay !== undefined ? rt.customerRate * rt.minKmPerDay + (rt.customerBata ?? 0) : null;
      return { display: full !== null ? inr(full) : "—", title: full !== null ? `${rt?.minKmPerDay} km × ${inr(rt?.customerRate)} + ${inr(rt?.customerBata)} allowance` : "Set the Round Trip rate card first" };
    },
  };
  const problems = [
    ...cards.map((c) => classError(c) ? `${nameOf(c)}: ${classError(c)}` : "").filter(Boolean),
    ...(settingsError ? [settingsError] : []),
  ];
  const timeField = (label: string, k: keyof typeof times) => <label className="fm-mini"><span>{label}</span><input className="ds-input" type="time" value={times[k]} onChange={(e) => setTimes({ ...times, [k]: e.target.value })} /></label>;
  const setSlab = (key: string, patch: Partial<SlabDraft>) => setSlabs((s) => s.map((x) => {
    if (x.key !== key) return x;
    const next = { ...x, ...patch };
    // A name still on the standard follows the hours ("3-Hour Return" -> "4-Hour Return").
    if (patch.hours !== undefined && patch.name === undefined && Number(patch.hours) > 0 && (!x.name.trim() || x.name.trim() === slabStd(x.hours))) next.name = slabStd(patch.hours);
    return next;
  }));
  const setName = (k: NameKey, v: string) => setNames((n) => ({ ...n, [k]: v }));

  // Settings that are the same for every vehicle sit in the package's own table, as one box across the vehicle columns.
  const sharedRow = (key: string, label: string, node: ReactNode, unit?: string): RateRow => ({ key, label, unit, cell: () => ({}), shared: node });
  const nameRow = (key: string, value: string, standard: string, onChange: (v: string) => void) => sharedRow(`name-${key}`, "Name shown to customers",
    <div className="fm-shared">
      <input type="text" className="fm-input fm-input--text" maxLength={MAX_NAME} value={value} placeholder={standard} aria-label={`Name of ${standard}`} onChange={(e) => onChange(e.target.value)} />
      <span className="fm-shared__hint">{!value.trim() || value.trim() === standard ? "Standard name. Type to rename it." : "Customers see this name"}</span>
    </div>);
  const numRow = (key: string, label: string, unit: string, value: string, onChange: (v: string) => void, o: { min?: number; max?: number; step?: string } = {}) => sharedRow(key, label,
    <div className="fm-shared">
      <input type="number" className="fm-input" min={o.min ?? 1} max={o.max} step={o.step ?? "1"} inputMode="decimal" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} />
    </div>, unit);
  const timeRow = (key: string, label: string, k: keyof typeof times) => sharedRow(key, label,
    <div className="fm-shared"><input type="time" className="fm-input fm-input--text" style={{ width: 140 }} value={times[k]} aria-label={label} onChange={(e) => setTimes({ ...times, [k]: e.target.value })} /></div>);
  const titled = (name: string, std: string, label: string) => (name.trim() && name.trim() !== std ? `${name.trim()} (${label})` : label);
  const hoursKm = (key: string, hours: string, onHours: (v: string) => void, km: string, onKm: (v: string) => void, opts: { hoursStep?: string } = {}) => [
    numRow(`${key}-hours`, "Hours allowed", "hours", hours, onHours, { min: opts.hoursStep ? 0.5 : 1, max: opts.hoursStep ? undefined : 23, step: opts.hoursStep ?? "1" }),
    numRow(`${key}-km`, "Round-trip km limit", "km", km, onKm),
  ];

  const sortedSlabs = [...slabs].sort((a, b) => Number(a.hours) - Number(b.hours));
  const groups: RateGroup[] = [
    { id: "full", title: titled(names.full, STD.full, "Full-day package"), rows: [nameRow("full", names.full, STD.full, (v) => setName("full", v)), fullDayRow] },
    { id: "five", title: titled(names.five, STD.five, `${limits.five || 5}-hour package`), rows: [
      nameRow("five", names.five, STD.five, (v) => setName("five", v)),
      ...hoursKm("five", limits.five, (v) => setLimits({ ...limits, five: v }), limits.fiveKm, (v) => setLimits({ ...limits, fiveKm: v }), { hoursStep: "0.5" }),
      ...pkgRows("five"),
    ] },
    { id: "eight", title: titled(names.eight, STD.eight, `${limits.eight || 8}-hour package`), rows: [
      nameRow("eight", names.eight, STD.eight, (v) => setName("eight", v)),
      ...hoursKm("eight", limits.eight, (v) => setLimits({ ...limits, eight: v }), limits.km, (v) => setLimits({ ...limits, km: v }), { hoursStep: "0.5" }),
      ...pkgRows("eight"),
    ] },
    ...sortedSlabs.map((sl) => ({
      id: `slab-${sl.key}`,
      title: titled(sl.name, slabStd(sl.hours), `${sl.hours || "?"}-hour slab (extra)`),
      rows: [
        nameRow(sl.key, sl.name, Number(sl.hours) > 0 ? slabStd(sl.hours) : "Name", (v) => setSlab(sl.key, { name: v })),
        ...hoursKm(sl.key, sl.hours, (v) => setSlab(sl.key, { hours: v }), sl.km, (v) => setSlab(sl.key, { km: v })),
        ...extraRowsOf(sl),
        sharedRow(`${sl.key}-remove`, "Remove this slab", <div className="fm-shared"><button type="button" className="fm-shared__remove" onClick={() => removeSlab(sl.key)}>Remove {sl.hours || "?"}-hour slab</button><span className="fm-shared__hint">Its amounts for every vehicle are removed too</span></div>),
      ],
    })),
    { id: "morning", title: `${titled(names.morning, STD.morning, "Morning return")} (optional)`, rows: [
      nameRow("morning", names.morning, STD.morning, (v) => setName("morning", v)),
      timeRow("morning-by", "Must be back by", "morning"),
      ...pkgRows("morning"),
    ] },
    { id: "next", title: titled(names.next, STD.next, "Overnight (2-day) package"), rows: [
      nameRow("next", names.next, STD.next, (v) => setName("next", v)),
      timeRow("next-eight", `${limits.eight || 8}-hour first day from`, "eight"),
      timeRow("next-five", `${limits.five || 5}-hour first day from`, "five"),
    ] },
  ];

  return (
    <SettingCard title="Time-based round trip"
      description="Customers choose days, not a return time. Package fares include driver allowance. Full-Day Return comes from the Round Trip rates above."
      footer={<SaveBar reason={reason} onReason={setReason} onSave={save} busy={busy} disabled={!changed || !!settingsError || !!anyClassError || !canEdit} message={message} note="Morning Return is optional: fill all three boxes or none." />}>
      <fieldset disabled={!canEdit || busy} className="min-w-0">
        <CardBody>
          <div className="fm-mini-grid">
            {timeField("Booked cutoff", "cutoff")}
            {timeField("Late-night group ends", "late")}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="fm-sub">Each package below has its own name, hours, km limit and amounts. Add packages like 3, 6 or 10 hours with the button; a vehicle left empty is not offered that slab.</p>
            <Button size="sm" variant="secondary" onClick={addSlab} disabled={slabs.length >= MAX_EXTRA_SLABS}>+ Add hour slab</Button>
          </div>
          {rule ? (
            <details className="fm-details">
              <summary>How packages are offered</summary>
              <ul>{rule.map((line) => <li key={line}>{line}</li>)}</ul>
            </details>
          ) : null}
        </CardBody>
      </fieldset>
      {cards.length === 0
        ? <CardBody><p className="fm-sub">Save the Round Trip rate card for a vehicle first; these packages sit on top of it.</p></CardBody>
        : <RateTable label="Time-based round trip packages by vehicle" disabled={!canEdit || busy} columns={columns} groups={groups} />}
      <Problems items={problems} />
    </SettingCard>
  );
}

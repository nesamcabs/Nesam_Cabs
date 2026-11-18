import { useEffect, useMemo, useState } from "react";
import { saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { CLASS_LABEL, TARIFF_CLASSES, inr, useTariff, type TariffClass, type TimeBasedClassRates, type TimeBasedSettings } from "../services/tariffService";
import { useCan, useCanDo } from "./AccessContext";
import { Button } from "./ui";
import { CardBody, Problems, RateTable, SaveBar, SettingCard, vehicleColumns, type VehicleCol } from "./RateTable";

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
const DEFAULTS: Required<TimeBasedSettings> = { enabled: false, cutoffMinutes: 1425, morningCutoffMinutes: 540, nextDayEightFromMinutes: 900, nextDayFiveFromMinutes: 1320, shortKmLimit: 150, fiveKmLimit: 100, lateNightEndMinutes: 60, fiveHours: 5, eightHours: 8 };
const FIELDS = ["fiveFare", "fiveKm", "fivePartner", "eightFare", "eightKm", "eightPartner", "morningFare", "morningKm", "morningPartner"] as const;
type Field = (typeof FIELDS)[number];
type Draft = Record<Field, string>;
const EMPTY: Draft = { fiveFare: "", fiveKm: "", fivePartner: "", eightFare: "", eightKm: "", eightPartner: "", morningFare: "", morningKm: "", morningPartner: "" };

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const minutesOf = (v: string): number | null => (/^\d{2}:\d{2}$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null);
const pretty = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${m >= 720 ? "PM" : "AM"}`;
const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const toDraft = (t?: Partial<TimeBasedClassRates>): Draft => Object.fromEntries(FIELDS.map((f) => [f, t?.[f] !== undefined ? String(t[f]) : ""])) as Draft;

/** The values worked out in "Customer UX v8" for the Sedan; partner payouts are suggested at the same share as the Sedan's Round Trip rate. */
const UX_V7_SEDAN = { fiveFare: 2080, fiveKm: 100, eightFare: 2780, eightKm: 150, morningFare: 4500, morningKm: 250 };

export default function TimeBasedRoundTripCard({ vehicles }: { vehicles?: VehicleCol[] } = {}) {
  const { tariff } = useTariff();
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const saved = tariff?.roundTrip?.timeBased;
  const [times, setTimes] = useState({ cutoff: "23:45", morning: "09:00", eight: "15:00", five: "22:00", late: "01:00" });
  const [limits, setLimits] = useState({ km: "150", fiveKm: "100", five: "5", eight: "8" });
  const [rows, setRows] = useState<Partial<Record<TariffClass, Draft>>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Only the rate classes a vehicle category uses (the server keeps every other class's saved packages as they are).
  const cards = useMemo(() => TARIFF_CLASSES.filter((c) => tariff?.roundTrip?.classes?.[c] && (!vehicles?.length || vehicles.some((v) => v.cls === c))), [tariff, vehicles]);

  useEffect(() => {
    const s = { ...DEFAULTS, ...(saved ?? {}) };
    setTimes({ cutoff: clock(s.cutoffMinutes), morning: clock(s.morningCutoffMinutes), eight: clock(s.nextDayEightFromMinutes), five: clock(s.nextDayFiveFromMinutes), late: clock(s.lateNightEndMinutes) });
    setLimits({ km: String(s.shortKmLimit), fiveKm: String(s.fiveKmLimit), five: String(s.fiveHours), eight: String(s.eightHours) });
    setRows(Object.fromEntries(TARIFF_CLASSES.map((c) => [c, toDraft(tariff?.roundTrip?.classes?.[c]?.timeBased)])) as Partial<Record<TariffClass, Draft>>);
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
    : "";

  const classError = (c: TariffClass): string => {
    const d = rows[c];
    if (!d) return "";
    const filled = FIELDS.filter((f) => d[f].trim() !== "");
    if (!filled.length) return "";
    const core = ["fiveFare", "fiveKm", "fivePartner", "eightFare", "eightKm", "eightPartner"] as const;
    if (core.some((f) => !(num(d[f]) !== null && (num(d[f]) as number) > 0))) return "Enter all six 5-hour and 8-hour amounts (above zero), or clear them all.";
    const mor = ["morningFare", "morningKm", "morningPartner"] as const;
    const morFilled = mor.filter((f) => d[f].trim() !== "").length;
    if (morFilled !== 0 && (morFilled !== 3 || mor.some((f) => !((num(d[f]) as number) > 0)))) return "Morning Return needs its fare, kilometres and partner payout together, or none.";
    if ((num(d.fiveFare) as number) >= (num(d.eightFare) as number)) return "The 5-hour fare must be lower than the 8-hour fare.";
    if ((num(d.fiveKm) as number) >= (num(d.eightKm) as number)) return "The 5-hour kilometres must be fewer than the 8-hour kilometres.";
    return "";
  };
  const anyClassError = cards.map(classError).find(Boolean) ?? "";
  const anyData = cards.some((c) => FIELDS.some((f) => (rows[c]?.[f] ?? "").trim() !== ""));
  // Always on: Round Trip is time-based whenever a vehicle has its packages; with none it stays calendar-day pricing.
  const enabled = anyData;

  const currentSnapshot = JSON.stringify([saved?.enabled === true, saved ? [saved.cutoffMinutes, saved.morningCutoffMinutes, saved.nextDayEightFromMinutes, saved.nextDayFiveFromMinutes, saved.shortKmLimit, saved.fiveKmLimit ?? DEFAULTS.fiveKmLimit, saved.lateNightEndMinutes ?? DEFAULTS.lateNightEndMinutes, saved.fiveHours, saved.eightHours] : null, cards.map((c) => toDraft(tariff?.roundTrip?.classes?.[c]?.timeBased))]);
  const draftSnapshot = JSON.stringify([enabled, saved || enabled || anyData ? [cutoff, morning, eightFrom, fiveFrom, kmLimit, fiveKmLimit, lateEnd, five, eight] : null, cards.map((c) => rows[c] ?? EMPTY)]);
  const changed = currentSnapshot !== draftSnapshot;

  const setField = (c: TariffClass, f: Field, v: string) => setRows((r) => ({ ...r, [c]: { ...(r[c] ?? EMPTY), [f]: v } }));

  // One click for a demo: the Sedan exactly as in the guide; every other vehicle scaled by how its own Full-Day Return (km per day × rate + allowance)
  // compares with the Sedan's, rounded to ₹10, with the guide's included km (Morning Return uses the vehicle's own daily km). Partner payouts keep
  // each vehicle's partner/customer rate share. These are DEMO amounts — replace them with the real ones before going live.
  const fillAllDemo = () => {
    const full = (c: TariffClass) => { const r = tariff?.roundTrip?.classes?.[c]; return r?.customerRate !== undefined && r.minKmPerDay !== undefined ? r.customerRate * r.minKmPerDay + (r.customerBata ?? 0) : null; };
    const sedanFull = full("sedan") ?? 4000;
    const to10 = (n: number) => String(Math.round(n / 10) * 10);
    const next: Partial<Record<TariffClass, Draft>> = {};
    for (const c of cards) {
      const rt = tariff?.roundTrip?.classes?.[c];
      const f = full(c);
      const k = c === "sedan" || f === null ? 1 : f / sedanFull;
      const share = rt?.customerRate && rt.partnerRate ? rt.partnerRate / rt.customerRate : 0.9;
      const morningKm = c === "sedan" ? UX_V7_SEDAN.morningKm : Math.max(UX_V7_SEDAN.morningKm, rt?.minKmPerDay ?? 0);
      const fare = (base: number) => (c === "sedan" ? String(base) : to10(base * k));
      const pay = (base: number) => to10((c === "sedan" ? base : base * k) * share);
      next[c] = {
        fiveFare: fare(UX_V7_SEDAN.fiveFare), fiveKm: String(UX_V7_SEDAN.fiveKm), fivePartner: pay(UX_V7_SEDAN.fiveFare),
        eightFare: fare(UX_V7_SEDAN.eightFare), eightKm: String(UX_V7_SEDAN.eightKm), eightPartner: pay(UX_V7_SEDAN.eightFare),
        morningFare: fare(UX_V7_SEDAN.morningFare), morningKm: String(morningKm), morningPartner: pay(UX_V7_SEDAN.morningFare),
      };
    }
    setRows((r) => ({ ...r, ...next }));
    // The guide's shared settings (11:45 PM / 9:00 AM cutoffs, 3 PM / 10 PM / 1 AM boundaries, 5 h / 8 h, 100 / 150 km), and the switch on.
    setTimes({ cutoff: clock(DEFAULTS.cutoffMinutes), morning: clock(DEFAULTS.morningCutoffMinutes), eight: clock(DEFAULTS.nextDayEightFromMinutes), five: clock(DEFAULTS.nextDayFiveFromMinutes), late: clock(DEFAULTS.lateNightEndMinutes) });
    setLimits({ km: String(DEFAULTS.shortKmLimit), fiveKm: String(DEFAULTS.fiveKmLimit), five: String(DEFAULTS.fiveHours), eight: String(DEFAULTS.eightHours) });
    const sedan = tariff?.roundTrip?.classes?.sedan;
    const check = sedan && full("sedan") !== 4000 ? ` Note: the Sedan Full-Day Return in the rate card above is ${inr(full("sedan"))}, not the guide's ₹4,000 (250 km × ₹14 + ₹500 allowance) — change the rate card if that is not intended.` : "";
    setMessage({ ok: true, text: `Filled ${cards.length} vehicle${cards.length === 1 ? "" : "s"}: the Sedan exactly as in Customer UX v8, the others as DEMO amounts scaled from their Round Trip rate card, and they are live once saved. Review, add a reason and press Save.${check}` });
  };

  const save = async () => {
    if (!canEdit || busy || !changed || settingsError || anyClassError) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Add a short reason." });
    setBusy(true);
    setMessage(null);
    try {
      const classes: Record<string, unknown> = {};
      for (const c of cards) {
        const d = rows[c] ?? EMPTY;
        const has = FIELDS.some((f) => d[f].trim() !== "");
        const had = !!tariff?.roundTrip?.classes?.[c]?.timeBased;
        if (!has) { if (had) classes[c] = null; continue; }
        const mor = d.morningFare.trim() !== "";
        classes[c] = {
          fiveFare: num(d.fiveFare), fiveKm: num(d.fiveKm), fivePartner: num(d.fivePartner), eightFare: num(d.eightFare), eightKm: num(d.eightKm), eightPartner: num(d.eightPartner),
          ...(mor ? { morningFare: num(d.morningFare), morningKm: num(d.morningKm), morningPartner: num(d.morningPartner) } : {}),
        };
      }
      await saveTariffSection({
        section: "roundTripTimeBased", expectedVersion: tariff?.version ?? 0, reason: reason.trim(),
        data: { enabled, settings: { cutoffMinutes: cutoff, morningCutoffMinutes: morning, nextDayEightFromMinutes: eightFrom, nextDayFiveFromMinutes: fiveFrom, shortKmLimit: kmLimit, fiveKmLimit, lateNightEndMinutes: lateEnd, fiveHours: five, eightHours: eight }, classes },
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
  ];

  const nameOf = (c: TariffClass) => vehicles?.find((v) => v.cls === c && v.owner)?.name ?? CLASS_LABEL[c];
  const statusOf = (c: TariffClass) => { const err = classError(c); return err ? { tone: "warn" as const, text: "Check", title: err } : undefined; };
  const columns = vehicles?.length ? vehicleColumns(vehicles, (c) => cards.includes(c), statusOf) : cards.map((c) => ({ key: c, name: nameOf(c), status: statusOf(c) }));
  const pkgRows = (key: "five" | "eight" | "morning") => ([["Fare", "Customer fare", "₹"], ["Km", "Included km", "km"], ["Partner", "Partner payout", "₹"]] as const).map(([suffix, label, unit]) => {
    const f = `${key}${suffix}` as Field;
    return { key: f, label, unit, cell: (c: string) => { const v = rows[c as TariffClass]?.[f] ?? ""; return { value: v, own: v !== "", onChange: (next: string) => setField(c as TariffClass, f, next) }; } };
  });
  const fullDayRow = {
    key: "fullDay", label: "Full-Day Return", unit: "₹",
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
  const numField = (label: string, k: keyof typeof limits, step = "1") => <label className="fm-mini"><span>{label}</span><input className="ds-input text-right" type="number" min={1} step={step} value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} /></label>;
  return (
    <SettingCard title="Time-based round trip"
      description="Customers choose days, not a return time. Package fares include driver allowance. Full-Day Return comes from the Round Trip rates above."
      aside={<div className="flex flex-wrap items-center gap-2">{canEdit && cards.length > 0 ? <Button size="sm" variant="secondary" onClick={fillAllDemo}>Fill demo values</Button> : null}</div>}
      footer={<SaveBar reason={reason} onReason={setReason} onSave={save} busy={busy} disabled={!changed || !!settingsError || !!anyClassError || !canEdit} message={message} note="Morning Return is optional: fill all three boxes or none." />}>
      <fieldset disabled={!canEdit || busy} className="min-w-0">
        <CardBody>
          <div className="fm-mini-grid">
            {timeField("Booked cutoff", "cutoff")}
            {timeField("Morning Return by", "morning")}
            {timeField("Next-day 8-hour from", "eight")}
            {timeField("Next-day 5-hour from", "five")}
            {timeField("Late-night group ends", "late")}
            {numField("Short package (hours)", "five", "0.5")}
            {numField("Medium package (hours)", "eight", "0.5")}
            {numField("5-hour km limit", "fiveKm")}
            {numField("8-hour km limit", "km")}
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
        : <RateTable label="Time-based round trip packages by vehicle" disabled={!canEdit || busy} columns={columns}
            groups={[
              { title: "Full day", rows: [fullDayRow] },
              { title: `${limits.five || 5}-hour package`, rows: pkgRows("five") },
              { title: `${limits.eight || 8}-hour package`, rows: pkgRows("eight") },
              { title: "Morning Return (optional)", rows: pkgRows("morning") },
            ]} />}
      <Problems items={problems} />
    </SettingCard>
  );
}

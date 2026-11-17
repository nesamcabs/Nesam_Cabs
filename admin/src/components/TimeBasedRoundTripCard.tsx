import { useEffect, useMemo, useState } from "react";
import { saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { CLASS_LABEL, TARIFF_CLASSES, inr, useTariff, type TariffClass, type TimeBasedClassRates, type TimeBasedSettings } from "../services/tariffService";
import { useCan, useCanDo } from "./AccessContext";
import { Button } from "./ui";

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

export default function TimeBasedRoundTripCard() {
  const { tariff } = useTariff();
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const saved = tariff?.roundTrip?.timeBased;
  const [enabled, setEnabled] = useState(false);
  const [times, setTimes] = useState({ cutoff: "23:45", morning: "09:00", eight: "15:00", five: "22:00", late: "01:00" });
  const [limits, setLimits] = useState({ km: "150", fiveKm: "100", five: "5", eight: "8" });
  const [rows, setRows] = useState<Partial<Record<TariffClass, Draft>>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const cards = useMemo(() => TARIFF_CLASSES.filter((c) => tariff?.roundTrip?.classes?.[c]), [tariff]);

  useEffect(() => {
    const s = { ...DEFAULTS, ...(saved ?? {}) };
    setEnabled(s.enabled === true);
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
  const needsData = enabled && !anyData;

  const currentSnapshot = JSON.stringify([saved?.enabled === true, saved ? [saved.cutoffMinutes, saved.morningCutoffMinutes, saved.nextDayEightFromMinutes, saved.nextDayFiveFromMinutes, saved.shortKmLimit, saved.fiveKmLimit ?? DEFAULTS.fiveKmLimit, saved.lateNightEndMinutes ?? DEFAULTS.lateNightEndMinutes, saved.fiveHours, saved.eightHours] : null, cards.map((c) => toDraft(tariff?.roundTrip?.classes?.[c]?.timeBased))]);
  const draftSnapshot = JSON.stringify([enabled, saved || enabled || anyData ? [cutoff, morning, eightFrom, fiveFrom, kmLimit, fiveKmLimit, lateEnd, five, eight] : null, cards.map((c) => rows[c] ?? EMPTY)]);
  const changed = currentSnapshot !== draftSnapshot;

  const setField = (c: TariffClass, f: Field, v: string) => setRows((r) => ({ ...r, [c]: { ...(r[c] ?? EMPTY), [f]: v } }));

  const fillSedan = () => {
    const sedan = tariff?.roundTrip?.classes?.sedan;
    const share = sedan?.customerRate && sedan.partnerRate ? sedan.partnerRate / sedan.customerRate : 0.9;
    const partner = (fare: number) => String(Math.round(fare * share));
    setRows((r) => ({ ...r, sedan: { fiveFare: String(UX_V7_SEDAN.fiveFare), fiveKm: String(UX_V7_SEDAN.fiveKm), fivePartner: partner(UX_V7_SEDAN.fiveFare), eightFare: String(UX_V7_SEDAN.eightFare), eightKm: String(UX_V7_SEDAN.eightKm), eightPartner: partner(UX_V7_SEDAN.eightFare), morningFare: String(UX_V7_SEDAN.morningFare), morningKm: String(UX_V7_SEDAN.morningKm), morningPartner: partner(UX_V7_SEDAN.morningFare) } }));
    setMessage({ ok: true, text: "Sedan filled from Customer UX v8. Partner payouts are suggestions at the Sedan's partner/customer rate share — confirm them before saving." });
  };

  const save = async () => {
    if (!canEdit || busy || !changed || settingsError || anyClassError || needsData) return;
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

  const input = "ds-input text-right";
  return (
    <section className="ds-panel ds-panel-pad" aria-label="Time-based round trip">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <h3 className="text-[15px] font-bold text-ink mb-1">Time-based round trip</h3>
          <p className="text-[12px] text-muted">Customers choose days, not a return time. Fares below include driver allowance. Full-Day Return is the Round Trip day set in the rate card above.</p>
        </div>
        <label className="inline-flex items-center gap-2 text-[13px] font-semibold">
          <input type="checkbox" checked={enabled} disabled={!canEdit || busy} onChange={(e) => setEnabled(e.target.checked)} />
          Switch on for customers
        </label>
      </div>

      <fieldset disabled={!canEdit || busy} className="min-w-0">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <label className="ds-field"><span>Booked cutoff</span><input className="ds-input" type="time" value={times.cutoff} onChange={(e) => setTimes({ ...times, cutoff: e.target.value })} /></label>
          <label className="ds-field"><span>Morning Return cutoff</span><input className="ds-input" type="time" value={times.morning} onChange={(e) => setTimes({ ...times, morning: e.target.value })} /></label>
          <label className="ds-field"><span>Next-day 8-hour from</span><input className="ds-input" type="time" value={times.eight} onChange={(e) => setTimes({ ...times, eight: e.target.value })} /></label>
          <label className="ds-field"><span>Next-day 5-hour from</span><input className="ds-input" type="time" value={times.five} onChange={(e) => setTimes({ ...times, five: e.target.value })} /></label>
          <label className="ds-field"><span>Short package hours</span><input className={input} type="number" min={1} step="0.5" value={limits.five} onChange={(e) => setLimits({ ...limits, five: e.target.value })} /></label>
          <label className="ds-field"><span>Medium package hours</span><input className={input} type="number" min={1} step="0.5" value={limits.eight} onChange={(e) => setLimits({ ...limits, eight: e.target.value })} /></label>
          <label className="ds-field"><span>Late-night group ends</span><input className="ds-input" type="time" value={times.late} onChange={(e) => setTimes({ ...times, late: e.target.value })} /></label>
          <label className="ds-field"><span>5-hour km limit</span><input className={input} type="number" min={1} value={limits.fiveKm} onChange={(e) => setLimits({ ...limits, fiveKm: e.target.value })} /></label>
          <label className="ds-field"><span>8-hour km limit</span><input className={input} type="number" min={1} value={limits.km} onChange={(e) => setLimits({ ...limits, km: e.target.value })} /></label>
        </div>
        {settingsError ? <p className="ds-error mt-2" role="alert">{settingsError}</p> : null}

        {rule ? (
          <ul className="mt-3 space-y-1 text-[12px] text-muted" aria-label="How packages are offered">
            {rule.map((line) => <li key={line}>• {line}</li>)}
          </ul>
        ) : null}

        <div className="mt-4 space-y-3">
          {cards.length === 0 ? <p className="text-[12px] text-muted">Save the Round Trip rate card for a category first; the time-based packages sit on top of it.</p> : null}
          {cards.map((c) => {
            const rt = tariff?.roundTrip?.classes?.[c];
            const d = rows[c] ?? EMPTY;
            const fullFare = rt?.customerRate !== undefined && rt.minKmPerDay !== undefined ? rt.customerRate * rt.minKmPerDay + (rt.customerBata ?? 0) : null;
            const err = classError(c);
            return (
              <div key={c} className="rounded-lg border border-line p-3" style={{ minWidth: 0 }}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <strong className="text-[13px]">{CLASS_LABEL[c]}</strong>
                  <span className="text-[12px] text-muted">Full-Day Return: {fullFare !== null ? `${inr(fullFare)} (${rt?.minKmPerDay} km × ${inr(rt?.customerRate)} + ${inr(rt?.customerBata)} allowance)` : "—"}</span>
                  {c === "sedan" ? <Button variant="secondary" onClick={fillSedan} disabled={!canEdit}>Fill from UX v8</Button> : null}
                </div>
                {([["five", "5-hour"], ["eight", "8-hour"], ["morning", "Morning Return (optional)"]] as const).map(([key, label]) => (
                  <div key={key} className="mb-2">
                    <span className="text-[12px] font-semibold text-ink">{label}</span>
                    <div className="grid gap-2 mt-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
                      <label className="ds-field"><span>Customer fare (₹)</span><input className={input} type="number" min={0} step="0.01" inputMode="decimal" value={d[`${key}Fare` as Field]} onChange={(e) => setField(c, `${key}Fare` as Field, e.target.value)} /></label>
                      <label className="ds-field"><span>Included km</span><input className={input} type="number" min={0} step="1" inputMode="decimal" value={d[`${key}Km` as Field]} onChange={(e) => setField(c, `${key}Km` as Field, e.target.value)} /></label>
                      <label className="ds-field"><span>Partner payout (₹)</span><input className={input} type="number" min={0} step="0.01" inputMode="decimal" value={d[`${key}Partner` as Field]} onChange={(e) => setField(c, `${key}Partner` as Field, e.target.value)} /></label>
                    </div>
                  </div>
                ))}
                {err ? <p className="ds-error" role="alert">{err}</p> : null}
              </div>
            );
          })}
        </div>
        {needsData ? <p className="ds-error mt-2" role="alert">Enter the 5-hour and 8-hour amounts for at least one category before switching this on.</p> : null}

        <div className="flex flex-wrap items-end gap-3 mt-3">
          <label className="ds-field" style={{ flex: "1 1 220px" }}>
            <span>Reason for change</span>
            <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <Button variant="primary" onClick={save} loading={busy} disabled={!changed || !!settingsError || !!anyClassError || needsData || !canEdit}>Save</Button>
        </div>
      </fieldset>
      {message ? <p className={message.ok ? "text-[12px] text-ok mt-2" : "ds-error mt-2"} role="status">{message.text}</p> : null}
    </section>
  );
}

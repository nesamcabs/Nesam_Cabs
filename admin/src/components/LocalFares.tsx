import { useState } from "react";
import type { MasterLocation } from "../types";
import { saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { CLASS_LABEL, TARIFF_CLASSES, useTariff, validLocalFare, type LocalFare, type TariffClass } from "../services/tariffService";
import { Problems, RateTable, SaveBar, SettingCard, vehicleColumns, type VehicleCol } from "./RateTable";

// Earlier Local Pickup & Drop fares (tariff localPickupDrop): the per-km fare of one City or one Pickup & Drop zone. They are shown
// inside Service & Fare Settings → Local & Rental Pricing for the City / zone chosen in the shared location selector, and the booking
// server still uses them where no complete location-scoped Local rates apply.

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const text = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");

type PdKey = "minKm" | "rate" | "exKm" | "wait" | "partner";
type PdDraft = Record<PdKey, string> & { enabled: boolean };
const PD_FIELDS: { key: PdKey; label: string; unit: string; zeroOk?: boolean }[] = [
  { key: "minKm", label: "Minimum billable km", unit: "km" },
  { key: "rate", label: "Price per km", unit: "₹/km" },
  { key: "exKm", label: "Extra km price", unit: "₹/km" },
  { key: "wait", label: "Waiting", unit: "₹/hour", zeroOk: true },
  { key: "partner", label: "Partner pay per km", unit: "₹/km" },
];
const pdOf = (f?: Partial<LocalFare>): PdDraft => ({ minKm: text(f?.minKm), rate: text(f?.customerRate), exKm: text(f?.extraKmRate), wait: text(f?.waitingPerHour), partner: text(f?.partnerRate), enabled: f?.enabled ?? false });

/**
 * One city's (or one zone's) Pickup & Drop fares: the rates down the side, the vehicles across the top, one Save for every changed
 * vehicle. For a zone, `cityFares` are the city's rates: a vehicle whose zone rates are off uses them (shown in grey).
 */
export function PickupDropMatrix({ place, cityName, cityFares, vehicles, canEdit, onToast }: {
  place: MasterLocation; cityName: string; cityFares?: Partial<Record<TariffClass, Partial<LocalFare>>>; vehicles?: VehicleCol[]; canEdit: boolean; onToast: (t: string) => void;
}) {
  const city = place;
  const isZone = place.type !== "City";
  // Only the rate classes an active vehicle category is priced as.
  const classes = TARIFF_CLASSES.filter((c) => !vehicles?.length || vehicles.some((v) => v.cls === c));
  const { tariff } = useTariff();
  const savedOf = (c: TariffClass) => pdOf(tariff?.localPickupDrop?.[city.id]?.classes?.[c]);
  const [drafts, setDrafts] = useState<Partial<Record<TariffClass, PdDraft>>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const draftOf = (c: TariffClass) => drafts[c] ?? savedOf(c);
  const dirtyOf = (c: TariffClass) => !!drafts[c] && JSON.stringify(drafts[c]) !== JSON.stringify(savedOf(c));
  const changed = classes.filter(dirtyOf);
  const set = (c: TariffClass, patch: Partial<PdDraft>) => { setMessage(null); setDrafts((d) => ({ ...d, [c]: { ...(d[c] ?? savedOf(c)), ...patch } })); };
  const nameOf = (c: TariffClass) => vehicles?.find((v) => v.cls === c && v.owner)?.name ?? CLASS_LABEL[c];
  const errorOf = (c: TariffClass): string => {
    if (!dirtyOf(c)) return "";
    const d = draftOf(c);
    for (const f of PD_FIELDS) {
      const v = num(d[f.key]);
      if (!Number.isFinite(v)) return `enter ${f.label.toLowerCase()}.`;
      if (f.zeroOk ? v < 0 : v <= 0) return `${f.label.toLowerCase()} must be ${f.zeroOk ? "zero or more" : "more than zero"}.`;
    }
    return "";
  };
  const problems = classes.map((c) => (errorOf(c) ? `${nameOf(c)}: ${errorOf(c)}` : "")).filter(Boolean);
  const name = isZone ? `${place.name || place.area} (${cityName})` : place.name || place.city;
  // A zone's empty box shows the city's rate in grey.
  const cityText = (c: TariffClass, k: PdKey) => {
    const f = cityFares?.[c];
    if (!f || !validLocalFare(f) || !f.enabled) return "";
    return text(k === "minKm" ? f.minKm : k === "rate" ? f.customerRate : k === "exKm" ? f.extraKmRate : k === "wait" ? f.waitingPerHour : f.partnerRate);
  };

  const save = async () => {
    if (!canEdit || busy || !changed.length || problems.length) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Add a short reason." });
    setBusy(true);
    setMessage(null);
    let version = tariff?.version ?? 0;
    const done: string[] = [];
    try {
      for (const c of changed) {
        const d = draftOf(c);
        const r = await saveTariffSection({
          section: "localPickupDrop", cityId: city.id, class: c, expectedVersion: version, reason: reason.trim(),
          data: { minKm: num(d.minKm), customerRate: num(d.rate), partnerRate: num(d.partner), extraKmRate: num(d.exKm), waitingPerHour: num(d.wait), enabled: d.enabled },
        });
        version = r.version;
        done.push(nameOf(c));
      }
      setDrafts({});
      setReason("");
      onToast(`Pickup & Drop fares saved for ${name}: ${done.join(", ")}.`);
    } catch (err) {
      const why = err instanceof ActionError ? err.message : "Not saved. Please try again.";
      setMessage({ ok: false, text: done.length ? `Saved for ${done.join(", ")}. ${why}` : why });
    } finally {
      setBusy(false);
    }
  };

  const configured = (c: TariffClass) => validLocalFare(tariff?.localPickupDrop?.[city.id]?.classes?.[c]);
  return (
    <SettingCard title={`Pickup & Drop · ${name}`}
      description={isZone
        ? `Rates for trips that start in this zone and stay in ${cityName}. Grey numbers are the city rates, used by any vehicle whose zone rates are off.`
        : "Fare = the greater of the road distance and the minimum billable km, times the price per km. The 130 km Outstation minimum does not apply."}
      footer={canEdit ? <SaveBar reason={reason} onReason={setReason} onSave={save} busy={busy} disabled={!changed.length || problems.length > 0} message={message}
        note={isZone ? "Fill every box of a vehicle and switch on Use zone rates to price it here." : "Fill every box of a vehicle to save it. Switch it on to quote it."} /> : null}>
      <RateTable label={`Pickup and Drop fares in ${name}`} disabled={!canEdit || busy}
        columns={(() => {
          const statusOf = (c: TariffClass) => errorOf(c) ? { tone: "warn" as const, text: "Check", title: errorOf(c) }
            : !configured(c) && !dirtyOf(c) ? { tone: "off" as const, text: isZone ? "City rates" : "Not set" } : undefined;
          return vehicles?.length ? vehicleColumns(vehicles, (c) => classes.includes(c), statusOf) : classes.map((c) => ({ key: c, name: nameOf(c), status: statusOf(c) }));
        })()}
        groups={[
          { title: "Customer pays", rows: PD_FIELDS.filter((f) => f.key !== "partner").map((f) => ({ key: f.key, label: f.label, unit: f.unit, required: true, cell: (c: string) => { const v = draftOf(c as TariffClass)[f.key]; return { value: v, own: v !== "", placeholder: isZone ? cityText(c as TariffClass, f.key) || "—" : undefined, onChange: (next: string) => set(c as TariffClass, { [f.key]: next } as Partial<PdDraft>) }; } })) },
          { title: "Partner gets", rows: PD_FIELDS.filter((f) => f.key === "partner").map((f) => ({ key: f.key, label: f.label, unit: f.unit, required: true, cell: (c: string) => { const v = draftOf(c as TariffClass)[f.key]; return { value: v, own: v !== "", placeholder: isZone ? cityText(c as TariffClass, f.key) || "—" : undefined, onChange: (next: string) => set(c as TariffClass, { [f.key]: next } as Partial<PdDraft>) }; } })) },
          { title: "Availability", rows: [{ key: "enabled", label: isZone ? "Use zone rates" : "Quote to customers", cell: (c: string) => ({ checked: draftOf(c as TariffClass).enabled, onToggle: (on: boolean) => set(c as TariffClass, { enabled: on }), title: draftOf(c as TariffClass).enabled ? "On" : "Off" }) }] },
        ]} />
      <Problems items={problems} />
    </SettingCard>
  );
}

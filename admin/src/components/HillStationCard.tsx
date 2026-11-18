import { useEffect, useMemo, useState } from "react";
import { saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { CLASS_LABEL, TARIFF_CLASSES, useTariff, type TariffClass } from "../services/tariffService";
import { useCan, useCanDo } from "./AccessContext";
import { CardBody, Problems, RateTable, SaveBar, SettingCard, vehicleColumns, type VehicleCol } from "./RateTable";

/**
 * Hill Station Allowance / Charge (Customer UX v8, 16 Nov 2026, section 08). A One Way or Round Trip whose pickup, stop or destination is
 * in a hill station of Tamil Nadu, Karnataka or Kerala is detected automatically from the postal pincode of each place (no radius), and the vehicle's slab is added to the fare
 * as its own line — "Hill Station Allowance / Charge" — never mixed into the base or package fare:
 *   One Way    : base fare + driver bata + extra km + hill charge (One-Way slab) + toll / permit
 *   Round Trip : package fare + extra km + hill charge (Round-Trip slab) + toll / permit
 * Hill stations never use the 5-Hour / 8-Hour packages. Amounts follow the fare's GST setting (entered with GST included or added on top).
 * Applies to every brand, like the rate cards it sits on.
 */
// The built-in hill stations, by state (functions/src/domain/hillStations.ts holds the pincodes of each).
const STATIONS: { state: string; names: string[] }[] = [
  { state: "Tamil Nadu", names: ["Ooty", "Coonoor", "Kotagiri", "Kodaikanal", "Yercaud", "Valparai", "Topslip", "Megamalai", "Kolli Hills", "Yelagiri", "Jawadhu Hills", "Kalvarayan Hills", "Manjolai", "Kolukkumalai"] },
  { state: "Kerala", names: ["Munnar", "Thekkady", "Vagamon", "Peermade", "Ponmudi", "Wayanad", "Nelliyampathy"] },
  { state: "Karnataka", names: ["Madikeri (Coorg)", "Bhagamandala · Talacauvery", "Chikmagalur · Mullayanagiri", "Kemmangundi", "Sakleshpur", "Agumbe", "Kudremukh", "Nandi Hills · Skandagiri"] },
];
const STATION_COUNT = STATIONS.reduce((n, g) => n + g.names.length, 0);
const FIELDS = ["owCustomer", "owPartner", "rtCustomer", "rtPartner"] as const;
type Field = (typeof FIELDS)[number];
type Draft = Record<Field, string>;
const EMPTY: Draft = { owCustomer: "", owPartner: "", rtCustomer: "", rtPartner: "" };
const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const text = (n: number | undefined) => (n === undefined ? "" : String(n));

/** `service` is the Service chosen in "Applies to": One Way shows only the one-way slab, Round Trip only the round-trip slab (both are still saved together). */
export default function HillStationCard({ vehicles, service }: { vehicles?: VehicleCol[]; service?: "One Way" | "Round Trip" } = {}) {
  const { tariff } = useTariff();
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const saved = tariff?.hillStation;
  const [chargePer, setChargePer] = useState<"trip" | "station">("trip");
  const [rows, setRows] = useState<Partial<Record<TariffClass, Draft>>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Only the rate classes a vehicle category uses (the server keeps every other class's saved slabs as they are).
  const cards = useMemo(() => TARIFF_CLASSES.filter((c) => (tariff?.roundTrip?.classes?.[c] || tariff?.oneWay?.classes?.[c]) && (!vehicles?.length || vehicles.some((v) => v.cls === c))), [tariff, vehicles]);
  const toDraft = (c: TariffClass): Draft => {
    const row = saved?.classes?.[c];
    return { owCustomer: text(row?.oneWay?.customer), owPartner: text(row?.oneWay?.partner), rtCustomer: text(row?.roundTrip?.customer), rtPartner: text(row?.roundTrip?.partner) };
  };

  useEffect(() => {
    setChargePer(saved?.chargePer === "station" ? "station" : "trip");
    setRows(Object.fromEntries(TARIFF_CLASSES.map((c) => [c, toDraft(c)])) as Partial<Record<TariffClass, Draft>>);
    setReason("");
    setMessage(null);
  }, [tariff?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const slabError = (c: TariffClass): string => {
    const d = rows[c];
    if (!d) return "";
    for (const [cust, part, label] of [["owCustomer", "owPartner", "One-way"], ["rtCustomer", "rtPartner", "Round-trip"]] as const) {
      const a = d[cust].trim(), b = d[part].trim();
      if (!a && !b) continue;
      if (!a || !(Number(a) > 0)) return `${label}: enter the customer charge (above zero), or clear both amounts.`;
      if (!b || !(Number(b) >= 0)) return `${label}: enter the partner payout (zero or more), or clear both amounts.`;
    }
    return "";
  };
  const anyError = cards.map(slabError).find(Boolean) ?? "";
  const hasAny = cards.some((c) => FIELDS.some((f) => (rows[c]?.[f] ?? "").trim() !== ""));
  // Always on: the charge applies whenever a vehicle has an amount; with no amounts there is nothing to charge.
  const enabled = hasAny;

  const snapshot = (en: boolean, per: string, r: Array<Draft | undefined>) => JSON.stringify([en, per, r.map((d) => FIELDS.map((f) => (d?.[f] ?? "").trim()))]);
  const changed = snapshot(saved?.enabled === true, saved?.chargePer === "station" ? "station" : "trip", cards.map((c) => toDraft(c))) !== snapshot(enabled, chargePer, cards.map((c) => rows[c]));

  const setField = (c: TariffClass, f: Field, v: string) => setRows((r) => ({ ...r, [c]: { ...(r[c] ?? EMPTY), [f]: v } }));

  const save = async () => {
    if (!canEdit || busy || !changed || anyError) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Add a short reason." });
    setBusy(true);
    setMessage(null);
    try {
      const classes: Record<string, unknown> = {};
      for (const c of cards) {
        const d = rows[c] ?? EMPTY;
        const ow = d.owCustomer.trim() !== "" ? { customer: num(d.owCustomer), partner: num(d.owPartner) } : undefined;
        const rt = d.rtCustomer.trim() !== "" ? { customer: num(d.rtCustomer), partner: num(d.rtPartner) } : undefined;
        if (!ow && !rt) { if (saved?.classes?.[c]) classes[c] = null; continue; }
        classes[c] = { ...(ow ? { oneWay: ow } : {}), ...(rt ? { roundTrip: rt } : {}) };
      }
      await saveTariffSection({ section: "hillStation", expectedVersion: tariff?.version ?? 0, reason: reason.trim(), data: { enabled, chargePer, classes } });
      setReason("");
      setMessage({ ok: true, text: enabled ? "Saved. New One Way and Round Trip quotes to hill stations carry this charge as a separate line; bookings already made keep what they were sold." : "Saved. No vehicle has a hill station charge." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ActionError ? err.message : "It was not saved. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (c: TariffClass) => vehicles?.find((v) => v.cls === c && v.owner)?.name ?? CLASS_LABEL[c];
  const statusOf = (c: TariffClass) => { const err = slabError(c); return err ? { tone: "warn" as const, text: "Check", title: err } : undefined; };
  const columns = vehicles?.length ? vehicleColumns(vehicles, (c) => cards.includes(c), statusOf) : cards.map((c) => ({ key: c, name: nameOf(c), status: statusOf(c) }));
  const slabRows = (k: "ow" | "rt") => [
    { key: `${k}Customer`, label: "Customer charge", unit: "₹", cell: (c: string) => ({ value: rows[c as TariffClass]?.[`${k}Customer` as Field] ?? "", onChange: (v: string) => setField(c as TariffClass, `${k}Customer` as Field, v), own: (rows[c as TariffClass]?.[`${k}Customer` as Field] ?? "") !== "" }) },
    { key: `${k}Partner`, label: "Partner payout", unit: "₹", cell: (c: string) => ({ value: rows[c as TariffClass]?.[`${k}Partner` as Field] ?? "", onChange: (v: string) => setField(c as TariffClass, `${k}Partner` as Field, v), own: (rows[c as TariffClass]?.[`${k}Partner` as Field] ?? "") !== "" }) },
  ];
  const problems = [
    ...cards.map((c) => slabError(c) ? `${nameOf(c)}: ${slabError(c)}` : "").filter(Boolean),
  ];
  return (
    <SettingCard title="Hill station charge"
      description="Added as its own fare line when the pickup, a stop or the drop is in a hill station (found by the place's postal pincode). Hill stations never use the 5-hour / 8-hour packages. Amounts follow the fare's GST setting."
      footer={<SaveBar reason={reason} onReason={setReason} onSave={save} busy={busy} disabled={!changed || !!anyError || !canEdit} message={message} note="Always on. Leave both boxes of a trip type empty for no charge." />}>
      <CardBody className="fm-body--inline">
        <label className="fm-inline-field">
          <span>Charge</span>
          <select className="ds-select" value={chargePer} disabled={!canEdit || busy} onChange={(e) => setChargePer(e.target.value as "trip" | "station")}>
            <option value="trip">Once per trip</option>
            <option value="station">Once for every hill station visited</option>
          </select>
        </label>
        <details className="fm-details">
          <summary>{STATION_COUNT} hill stations detected by pincode</summary>
          {STATIONS.map((g) => <p key={g.state}><strong>{g.state}:</strong> {g.names.join(", ")}.</p>)}
          <p>A place counts when its address pincode is one of the post-office pincodes covering the hill and about 10 km around it. A place with no pincode is not treated as a hill station.</p>
        </details>
      </CardBody>
      {cards.length === 0
        ? <CardBody><p className="fm-sub">Save the One Way or Round Trip rate card for a vehicle first.</p></CardBody>
        : <RateTable label="Hill station charge by vehicle" disabled={!canEdit || busy} columns={columns}
            groups={[...(service !== "Round Trip" ? [{ title: "One-way trip", rows: slabRows("ow") }] : []), ...(service !== "One Way" ? [{ title: "Round trip", rows: slabRows("rt") }] : [])]} />}
      <Problems items={problems} />
    </SettingCard>
  );
}

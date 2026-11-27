import { useEffect, useRef, useState } from "react";
import {
  BRAND_LABELS,
  FALLBACK_CLASS,
  RENTAL_HOURS,
  getInheritingBrands,
  inr,
  outstationExtraFor,
  resolveRate,
  serviceLabel,
  useTariff,
  type FareWorkspaceScope,
  type Tariff,
  type TariffClass,
} from "../services/tariffService";
import { saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { useCan, useCanDo } from "./AccessContext";
import { Badge, Button, Icon } from "./ui";
import { Modal, Toast, useToast } from "./Feedback";
import { CardBody, Problems, RateTable, SaveBar, SettingCard, SharedLegend, vehicleColumns, type VehicleCol } from "./RateTable";
import { NUM_KEYS, OLD_RULE_KEYS, PKG_FIELDS, emptyForm, formOf, type Form, type NumKey, type PkgField } from "./fareForm";
import RentalPackageBuilder from "./RentalPackageBuilder";
import { brandSyncFor } from "../services/fareBrandSync";

// One table for a Brand → Service: the fields run down the side, the vehicles run across the top. Each vehicle is still saved as its own
// business_config/tariff_v2.brandOverrides[brand][service][class]; a blank box inherits, a typed value is this scope's own price.

type Need = "positive" | "any";
interface Def { key: NumKey; label: string; unit: string; base: number | undefined; need?: Need }
type Group = "customer" | "partner" | "extras";
interface Row { group: Group; label: string; sub?: string; def: Def }
export interface MatrixCard { cls: TariffClass; name: string; categoryId?: string; cng: boolean }

const GROUP_TITLE: Record<Group, string> = { customer: "Customer pays", partner: "Partner gets", extras: "Extra charges" };

/** The rows of one vehicle, exactly as the server layers them (same values the single-vehicle form used). */
function rowsOf(t: Tariff | null | undefined, scope: FareWorkspaceScope, card: MatrixCard, showCng: boolean): Row[] {
  const cls = card.cls;
  const service = scope.service;
  const perDay = service === "Round Trip" || service === "Multicity";
  const oneWay = t?.oneWay?.classes?.[cls] ?? (FALLBACK_CLASS(cls) ? t?.oneWay?.classes?.[FALLBACK_CLASS(cls)!] : undefined);
  const roundTrip = t?.roundTrip?.classes?.[cls] ?? (FALLBACK_CLASS(cls) ? t?.roundTrip?.classes?.[FALLBACK_CLASS(cls)!] : undefined);
  const base = service === "One Way" ? oneWay : roundTrip; // Multicity inherits the Round Trip card
  const outstation = service === "One Way" ? outstationExtraFor(t, cls, "One Way") : perDay ? outstationExtraFor(t, cls, "Round Trip") : undefined;
  const oldExtras = t?.extraCharges?.categories?.[card.categoryId ?? ""] ?? t?.extraCharges?.categories?.[`cat-${cls}`] ?? t?.extraCharges?.categories?.[cls];
  const allowance = perDay ? "₹/day" : "₹/trip";
  const d = (key: NumKey, label: string, unit: string, baseValue: number | undefined, need?: Need): Def => ({ key, label, unit, base: baseValue, need });

  let customer: Def[] = [], partner: Def[] = [];
  if (showCng && service === "Airport Taxi") {
    // The km included in the base fare is the standard one unless CNG sets its own.
    const includedKm = resolveRate(t, scope.brand, service, cls, "minKm", undefined).value;
    customer = [
      d("cngCustomerBase", "CNG base fare", "₹", undefined, "positive"),
      d("cngMinKm", "CNG km included in base fare", "km", includedKm),
      d("cngExtraKmRate", "CNG extra km price", "₹/km", undefined, "positive"),
    ];
    partner = [
      d("cngPartnerBase", "CNG partner base payout", "₹", undefined, "positive"),
      d("cngPartnerRate", "CNG partner pay per extra km", "₹/km", undefined, "any"),
    ];
  } else if (showCng) {
    customer = [
      d("cngCustomerRate", "CNG price per km", "₹/km", base?.cng?.customerRate, "positive"),
      d("cngCustomerBata", "CNG driver allowance", allowance, base?.cng?.customerBata, "any"),
      d("cngExtraKmRate", "CNG extra km price", "₹/km", base?.cng?.extraKmRate),
      ...(perDay ? [d("cngMinKmPerDay", "CNG minimum km per day", "km/day", base?.cng?.minKmPerDay)] : []),
    ];
    partner = [
      d("cngPartnerRate", "CNG partner pay per km", "₹/km", base?.cng?.partnerRate, "positive"),
      d("cngPartnerBata", "CNG partner driver allowance", allowance, base?.cng?.partnerBata, "any"),
    ];
  } else if (service === "One Way" || perDay) {
    customer = [
      d("customerRate", "Price per km", "₹/km", base?.customerRate, "positive"),
      d("customerBata", "Driver allowance", allowance, base?.customerBata, "any"),
      service === "One Way" ? d("minKm", "Minimum km charged", "km", t?.oneWay?.minKm ?? 130) : d("minKmPerDay", "Minimum km per day", "km/day", roundTrip?.minKmPerDay, "positive"),
      d("extraKmRate", "Extra km price", "₹/km", outstation?.extraKmRate ?? base?.customerRate),
    ];
    partner = [
      d("partnerRate", "Partner pay per km", "₹/km", base?.partnerRate, "positive"),
      d("partnerBata", "Partner driver allowance", allowance, base?.partnerBata, "any"),
    ];
  } else if (service === "Airport Taxi") {
    customer = [
      d("customerBase", "Base fare", "₹", t?.airport?.customerBase, "positive"),
      d("minKm", "Km included in base fare", "km", undefined, "positive"),
      d("extraKmRate", "Extra km price", "₹/km", undefined, "positive"),
    ];
    partner = [
      d("partnerBase", "Partner base payout", "₹", t?.airport?.partnerBase, "positive"),
      d("partnerRate", "Partner pay per extra km", "₹/km", undefined, "any"),
    ];
  }
  // Roof carrier and pet travel: what the customer pays (added to the total when the customer ticks it) and what the partner gets.
  customer = [...customer, d("carrierCharge", "Roof carrier charge", "₹/trip", undefined), d("petCharge", "Pet travel charge", "₹/trip", t?.petCharge)];
  partner = [...partner, d("partnerCarrierCharge", "Roof carrier charge", "₹/trip", oldExtras?.partner?.carrier), d("partnerPetCharge", "Pet travel charge", "₹/trip", undefined)];

  const rows: Row[] = [
    ...customer.map((def): Row => ({ group: "customer", label: def.label, sub: def.unit, def })),
    ...partner.map((def): Row => ({ group: "partner", label: def.label, sub: def.unit, def })),
  ];
  if (!showCng) {
    if (service !== "Local Rental") {
      rows.push({ group: "extras", label: "Waiting · customer pays", sub: "₹/hour", def: d("waitingPerHour", "Waiting", "₹/hour", oldExtras?.customer?.waitingPerHour ?? (Number.isFinite(outstation?.waitingPerHour) ? outstation?.waitingPerHour : undefined)) });
      rows.push({ group: "extras", label: "Waiting · partner gets", sub: "₹/hour", def: d("partnerWaitingPerHour", "Partner waiting", "₹/hour", oldExtras?.partner?.waitingPerHour) });
    }
    rows.push({ group: "extras", label: "Hill station · customer pays", sub: "₹/trip", def: d("hillCharge", "Hill station", "₹/trip", oldExtras?.customer?.hill) });
    rows.push({ group: "extras", label: "Hill station · partner gets", sub: "₹/trip", def: d("partnerHillCharge", "Partner hill", "₹/trip", oldExtras?.partner?.hill) });
  }
  return rows;
}

/** The CNG table's columns: categories with CNG on. A class whose editing category has CNG off is edited under one that has it on. */
export function cngColumns(vehicles: VehicleCol[]): VehicleCol[] {
  const on = vehicles.filter((v) => v.cng);
  const owners = new Map<TariffClass, VehicleCol>();
  for (const v of on) if (v.owner || !owners.has(v.cls)) owners.set(v.cls, v);
  return on.map((v) => { const o = owners.get(v.cls)!; return { ...v, owner: o.id === v.id, ownerName: o.name }; });
}

export default function FareMatrix({ scope, cards, vehicles, fuel = "petrol", onDirtyChange, onBusyChange }: {
  scope: FareWorkspaceScope;
  /** Every active vehicle category, one column each (categories sharing a rate class mirror the one that edits it). */
  vehicles?: VehicleCol[];
  /** One column per rate class (categories that share a class share a column). */
  cards: MatrixCard[];
  fuel?: "petrol" | "cng";
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const { tariff: t, error: loadError } = useTariff();
  const { toast, show: showToast } = useToast(6000);

  const brand = scope.brand;
  const service = scope.service;
  const showCng = fuel === "cng" && service !== "Local Rental";

  const [forms, setForms] = useState<Record<string, Form>>({});
  const baseline = useRef<Record<string, string>>({});
  const loadedKey = useRef<Record<string, string>>({});
  const openedVersion = useRef(0);
  const formsRef = useRef(forms);
  formsRef.current = forms;
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  // A shared (All brands) price replaces the brands' own price in the same box, unless this is unticked.
  const [allBrands, setAllBrands] = useState(true);
  // Hourly rental: which package value the table shows (fare, payout, km, …), and the vehicle whose packages are being generated.
  const [pkgField, setPkgField] = useState<PkgField>("customerFare");
  const [builderFor, setBuilderFor] = useState<TariffClass | null>(null);
  const isRental = service === "Local Rental";

  const formFor = (cls: string): Form => forms[cls] ?? emptyForm();
  const dirtyOf = (cls: string) => !!forms[cls] && JSON.stringify(forms[cls]) !== baseline.current[cls];

  // Load each vehicle's saved values; a newer tariff only replaces a vehicle's form while nothing is being edited in it.
  const cardsKey = cards.map((c) => c.cls).join(",");
  useEffect(() => {
    if (t === undefined) return;
    if ((t?.version ?? 0) < openedVersion.current) return;
    const next: Record<string, Form> = {};
    for (const c of cards) {
      const key = `${brand}:${service}:${c.cls}`;
      // Already open: the effect below refreshes it when a newer tariff arrives and it has no unsaved edits.
      if (loadedKey.current[c.cls] === key && formsRef.current[c.cls]) continue;
      loadedKey.current[c.cls] = key;
      const loaded = formOf(t, brand, service, c.cls);
      baseline.current[c.cls] = JSON.stringify(loaded);
      next[c.cls] = loaded;
    }
    if (Object.keys(next).length) { openedVersion.current = t?.version ?? 0; setForms((p) => ({ ...p, ...next })); }
  }, [t, brand, service, cardsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // A newer saved tariff refreshes vehicles that have no unsaved edits.
  useEffect(() => {
    if (t === undefined || busy) return;
    const next: Record<string, Form> = {};
    for (const c of cards) {
      const cur = formsRef.current[c.cls];
      if (!cur || JSON.stringify(cur) !== baseline.current[c.cls]) continue;
      const loaded = formOf(t, brand, service, c.cls);
      const json = JSON.stringify(loaded);
      if (json === baseline.current[c.cls]) continue;
      baseline.current[c.cls] = json;
      next[c.cls] = loaded;
    }
    if (Object.keys(next).length) setForms((p) => ({ ...p, ...next }));
  }, [t?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = cards.filter((c) => dirtyOf(c.cls));
  const isDirty = changed.length > 0;
  const dirtyRef = useRef(false);
  dirtyRef.current = isDirty;
  useEffect(() => { onDirtyChange(isDirty); onBusyChange(busy); }, [isDirty, busy, onDirtyChange, onBusyChange]);
  const leaving = useRef({ onDirtyChange, onBusyChange });
  leaving.current = { onDirtyChange, onBusyChange };
  useEffect(() => () => { leaving.current.onDirtyChange(false); leaving.current.onBusyChange(false); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const setValue = (cls: string, key: NumKey, value: string) => setForms((p) => {
    const f = p[cls] ?? emptyForm();
    return { ...p, [cls]: { ...f, v: { ...f.v, [key]: value } } };
  });

  const setPkg = (cls: string, hours: number, key: PkgField, value: string) => setForms((p) => {
    const f = p[cls] ?? emptyForm();
    return { ...p, [cls]: { ...f, pkg: { ...f.pkg, [String(hours)]: { ...f.pkg[String(hours)]!, [key]: value } } } };
  });
  // A package value: this scope's own, else the shared (All brands) value, else the base package — as the server layers them.
  const pkgValue = (cls: TariffClass, hours: number, key: PkgField): { own: string; inherited: number | undefined } => {
    const own = formFor(cls).pkg[String(hours)]?.[key]?.trim() ?? "";
    const shared = brand !== "common" ? t?.brandOverrides?.common?.["Local Rental"]?.[cls]?.rentalPackages?.[String(hours)]?.[key] : undefined;
    return { own, inherited: shared ?? t?.rentalPackages?.[cls]?.packages?.[String(hours)]?.[key] };
  };
  const pkgOffered = (cls: TariffClass, hours: number) => {
    if (t?.rentalPackages?.[cls]?.packages?.[String(hours)]?.enabled === false) return false;
    return PKG_FIELDS.every(({ key }) => {
      const { own, inherited } = pkgValue(cls, hours, key);
      const n = own !== "" ? Number(own) : inherited;
      return n !== undefined && Number.isFinite(n) && n > 0;
    });
  };
  const offeredHours = (cls: TariffClass) => RENTAL_HOURS.filter((h) => pkgOffered(cls, h));

  // ── The table ───────────────────────────────────────────────────────────────────────────────────────────────────
  const cngOnly = showCng && cards.some((c) => c.categoryId);
  const cngVehicles = cngOnly ? cngColumns(vehicles ?? []) : vehicles;
  const shownCards = !cngOnly ? cards : cards.filter((c) => c.cng).map((c) => ({ ...c, name: cngVehicles?.find((v) => v.cls === c.cls && v.owner)?.name ?? c.name }));
  const noCngVehicle = cngOnly && shownCards.length === 0;
  const rowsByCard = new Map(cards.map((c) => [c.cls, rowsOf(t, scope, c, showCng)]));
  const baseRows = rowsByCard.get(cards[0]?.cls as TariffClass) ?? [];
  const resolved = (cls: TariffClass, def: Def) => resolveRate(t, brand, service, cls, def.key, def.base);
  const effective = (cls: TariffClass, def: Def): number | undefined => {
    const own = formFor(cls).v[def.key].trim();
    if (own !== "") return Number.isFinite(Number(own)) ? Number(own) : undefined;
    return resolved(cls, def).value;
  };
  const meets = (cls: TariffClass, def: Def) => {
    const n = effective(cls, def);
    return n !== undefined && Number.isFinite(n) && (def.need === "positive" ? n > 0 : n >= 0);
  };

  // What customers are offered for each vehicle with these values.
  const statusOf = (c: MatrixCard): { tone: "ok" | "warn" | "off"; short: string; text: string } => {
    if (isRental) {
      const hours = offeredHours(c.cls);
      return hours.length
        ? { tone: "ok", short: "Ready", text: `Offers the ${hours.join(", ")} hour package${hours.length > 1 ? "s" : ""}.` }
        : { tone: "warn", short: "No package", text: "No package is offered yet. Fill every value of a package (fare, payout, km, extra km, extra hour)." };
    }
    const rows = rowsByCard.get(c.cls) ?? [];
    const money = rows.filter((r) => r.group !== "extras").map((r) => r.def);
    const missing = money.filter((def) => def.need && !meets(c.cls, def)).map((def) => def.label);
    if (showCng) {
      const started = money.some((def) => def.need && def.key.startsWith("cng") && effective(c.cls, def) !== undefined);
      if (!started) return { tone: "off", short: "Not offered", text: "CNG is not offered. Fill the CNG rates to offer it, or leave them blank." };
      if (missing.length) return { tone: "warn", short: "Incomplete", text: `CNG is not offered until these are filled: ${missing.join(", ")}.` };
      return { tone: "ok", short: "Ready", text: "Customers can choose CNG or Diesel / Petrol." };
    }
    if (missing.length) return { tone: "warn", short: "Incomplete", text: `Customers are not quoted these fares until these are filled: ${missing.join(", ")}.` };
    return { tone: "ok", short: "Ready", text: "Ready." };
  };
  const statuses = new Map(cards.map((c) => [c.cls, statusOf(c)]));
  const problems = shownCards.flatMap((c) => {
    const s = statuses.get(c.cls)!;
    const out = s.tone === "ok" ? [] : [`${c.name}: ${s.text}`];
    const rows = rowsByCard.get(c.cls) ?? [];
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i]!, b = rows[i + 1]!;
      if (a.group === "extras" && a.label.endsWith("customer pays") && effective(c.cls, a.def) !== undefined && effective(c.cls, b.def) === undefined) out.push(`${c.name}: add the partner amount for ${a.label.split(" · ")[0]!.toLowerCase()}. Without it the charge waits for office review.`);
    }
    return out;
  });
  const badNumber = (v: string) => v.trim() !== "" && !(Number.isFinite(Number(v)) && Number(v) >= 0);
  const invalid = cards.some((c) => NUM_KEYS.some((k) => badNumber(formFor(c.cls).v[k]))
    || (isRental && RENTAL_HOURS.some((h) => PKG_FIELDS.some(({ key }) => badNumber(formFor(c.cls).pkg[String(h)]?.[key] ?? "")))));

  // ── Save: one reason, one click; every changed vehicle is saved in turn ───────────────────────────────────────────
  const executeSave = async () => {
    if (!canEdit || busy || !!loadError || t === undefined) return;
    if (reason.trim().length < 5) return setSaveError("Add a short reason (at least 5 characters).");
    setBusy(true);
    setSaveError(null);
    let version = t?.version ?? 0;
    const done: string[] = [];
    try {
      for (const c of changed) {
        const form = forms[c.cls]!;
        const data: Record<string, unknown> = {};
        for (const k of NUM_KEYS) data[k] = form.v[k].trim() ? Number(form.v[k]) : null; // null removes this scope's own value
        for (const k of OLD_RULE_KEYS) data[k] = null; // waiting / tax rules are now one shared setting
        let packages = 0;
        if (isRental) {
          const rentalPackages: Record<string, Partial<Record<PkgField, number>>> = {};
          for (const h of RENTAL_HOURS) {
            const row: Partial<Record<PkgField, number>> = {};
            for (const { key } of PKG_FIELDS) { const v = form.pkg[String(h)]![key].trim(); if (v) row[key] = Number(v); }
            if (Object.keys(row).length) { rentalPackages[String(h)] = row; packages++; }
          }
          data.rentalPackages = rentalPackages;
          if (form.rentalRule) data.rentalPackageRule = form.rentalRule;
        }
        const clearOverride = NUM_KEYS.every((k) => data[k] === null) && packages === 0;
        const saved = await saveTariffSection({ section: "brandOverride", brand, service, class: c.cls, expectedVersion: version, reason: reason.trim(), clearOverride, data });
        version = saved.version;
        // Before the baseline moves: if a brand save fails the vehicle stays unsaved here, and saving again finishes the brands.
        if (brand === "common" && allBrands) {
          for (const sync of brandSyncFor(t, service, c.cls, JSON.parse(baseline.current[c.cls]!) as Form, form)) {
            const next = await saveTariffSection({ section: "brandOverride", brand: sync.brand, service, class: c.cls, expectedVersion: version, reason: reason.trim(), data: sync.data });
            version = next.version;
          }
        }
        openedVersion.current = version;
        baseline.current[c.cls] = JSON.stringify(form);
        done.push(c.name);
      }
      setConfirmOpen(false);
      setReason("");
      setAllBrands(true);
      showToast(`Saved for ${where}${brand === "common" && allBrands ? " and applied to every brand" : ""}. Bookings already made keep their price.`);
    } catch (err) {
      const raw = err instanceof ActionError ? err.message.replace(/\s*\[\d{3}\]\s*$/, "") : "";
      const why = /changed by someone else/i.test(raw) ? "Someone else saved this fare. Reload the page, check the prices and save again." : raw || "Not saved. Please try again.";
      setSaveError(done.length ? `Saved for ${done.join(", ")}. ${why}` : why);
    } finally {
      setBusy(false);
      setForms((p) => ({ ...p })); // show which vehicles are now saved
    }
  };

  // The brands whose own prices the pending shared change would replace (shown before saving).
  const replaced = brand !== "common" ? [] : changed.flatMap((c) =>
    brandSyncFor(t, service, c.cls, JSON.parse(baseline.current[c.cls]!) as Form, forms[c.cls]!).map((x) => ({ ...x, vehicle: c.name })));
  const brandName = brand === "common" ? "All brands (shared)" : BRAND_LABELS[brand];
  const where = `${brandName} → ${serviceLabel(service)}${showCng ? " (CNG)" : ""}`;

  const groups: Group[] = ["customer", "partner", "extras"];
  // Hourly rental: one row per package (1–15 hours) for the value picked above the table.
  const field = PKG_FIELDS.find((f) => f.key === pkgField)!;
  const pkgGroup = {
    title: `Hourly packages · ${field.label}`,
    rows: RENTAL_HOURS.map((h) => ({
      key: `h${h}`, label: `${h} hour${h === 1 ? "" : "s"}`, unit: field.unit,
      cell: (cls: string) => {
        const k = cls as TariffClass;
        const { own, inherited } = pkgValue(k, h, pkgField);
        return {
          value: own, onChange: (v: string) => setPkg(k, h, pkgField, v),
          placeholder: inherited !== undefined ? String(inherited) : "—", own: own !== "", bad: badNumber(own),
          title: pkgOffered(k, h) ? `${h}-hour package is offered` : `${h}-hour package is not offered until all five values are set`,
        };
      },
    })),
  };
  const builderCard = cards.find((c) => c.cls === builderFor);
  return (
    <div className="ds-fare-workspace space-y-3">
      <Toast toast={toast} />
      {loadError && <div className="ds-error" role="alert"><Icon name="circle-alert" /> Fares could not be loaded: {loadError}</div>}


      <SettingCard label={`Fares for ${where}`}
        title={<span className="flex flex-wrap items-center gap-2">{where}{isDirty ? <Badge tone="amber">Unsaved: {changed.map((c) => c.name).join(", ")}</Badge> : null}</span>}
        description={isRental
          ? "Each hour is one package. A package is offered once all five values are set (fare, payout, km, extra km, extra hour). Leave a box empty to use the shared price shown in grey."
          : brand === "common"
            ? "A price you change here is applied to every brand. To give one brand a different price, choose that brand above."
            : "A price you type here is for this brand only. Leave a box empty to use the shared price shown in grey."}
        footer={canEdit ? <SaveBar note={<SharedLegend />} onSave={() => { setSaveError(null); setConfirmOpen(true); }} busy={busy} disabled={!isDirty || busy || !!loadError || invalid} /> : <div className="fm-foot"><SharedLegend /></div>}>
        {isRental && (
          <CardBody className="fm-body--inline">
            <div className="fm-seg" role="tablist" aria-label="Package value shown in the table">
              {PKG_FIELDS.map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={pkgField === f.key} className={pkgField === f.key ? "is-on" : ""} onClick={() => setPkgField(f.key)}>{f.label}</button>
              ))}
            </div>
            {canEdit && (
              <label className="fm-inline-field">
                <span>Fill from hourly rates</span>
                <select className="ds-select" value="" disabled={busy || !!loadError} onChange={(e) => setBuilderFor((e.target.value || null) as TariffClass | null)}>
                  <option value="">Choose a vehicle…</option>
                  {cards.map((c) => <option key={c.cls} value={c.cls}>{c.name}</option>)}
                </select>
              </label>
            )}
          </CardBody>
        )}
        {noCngVehicle ? <p className="fm-note" role="status">No vehicle has CNG turned on, so there are no CNG rates to set. Turn on CNG for a vehicle in Vehicle categories and it appears here.</p> : <RateTable label={`Fares for ${where}`} disabled={!canEdit || busy || !!loadError}
          columns={(() => {
            const statusOf = (cls: TariffClass) => { const s = statuses.get(cls); return s ? { tone: s.tone, text: s.short, title: s.text } : undefined; };
            return cngVehicles?.length
              ? vehicleColumns(cngVehicles, (cls) => shownCards.some((c) => c.cls === cls), statusOf)
              : shownCards.map((c) => ({ key: c.cls, name: c.name, status: statusOf(c.cls) }));
          })()}
          groups={[...(isRental ? [pkgGroup] : []), ...groups.map((g) => ({
            title: showCng && g !== "extras" ? `CNG · ${GROUP_TITLE[g]}` : GROUP_TITLE[g],
            rows: baseRows.map((r, i) => ({ r, i })).filter(({ r }) => r.group === g).map(({ r, i }) => ({
              key: r.def.key, label: r.label, unit: r.sub, required: !!r.def.need,
              cell: (cls: string) => {
                const k = cls as TariffClass;
                const def = (rowsByCard.get(k) ?? [])[i]?.def ?? r.def;
                const own = formFor(k).v[def.key];
                const inherited = resolved(k, def).value;
                const others = brand === "common" ? getInheritingBrands(t, service, k, def.key).overridden.length : 0;
                const othersText = others > 0 ? `${others} brand${others === 1 ? " has" : "s have"} its own price` : "";
                return {
                  value: own, onChange: (v: string) => setValue(k, def.key, v),
                  placeholder: inherited !== undefined ? String(inherited) : "—",
                  own: own.trim() !== "", bad: own.trim() !== "" && !(Number.isFinite(Number(own)) && Number(own) >= 0),
                  title: brand === "common" ? othersText : own.trim() !== "" ? `Own price: ${inr(Number(own))}` : inherited !== undefined ? `Shared price: ${inr(inherited)}` : "Not set",
                  dot: othersText || undefined,
                };
              },
            })),
          }))]} />}
        {invalid && <p className="ds-error m-3" role="alert">Enter numbers of 0 or more only.</p>}
        <Problems items={problems} />
        {showCng && !noCngVehicle && <p className="fm-note">Extra charges are the same for CNG and Diesel / Petrol. Set them with Fuel → Diesel / Petrol.</p>}
      </SettingCard>



      {builderFor && builderCard && (
        <Modal title={`Fill packages · ${builderCard.name}`} onClose={() => setBuilderFor(null)} footer={<Button onClick={() => setBuilderFor(null)}>Close</Button>}>
          <RentalPackageBuilder key={builderFor} disabled={!canEdit || busy}
            initialRule={formFor(builderFor).rentalRule ?? (brand !== "common" ? t?.brandOverrides?.common?.["Local Rental"]?.[builderFor]?.rentalPackageRule : undefined)}
            hourly={t?.rental?.classes?.[builderFor] ?? (FALLBACK_CLASS(builderFor) ? t?.rental?.classes?.[FALLBACK_CLASS(builderFor)!] : undefined)}
            onGenerate={(rentalRule, generated) => {
              const cls = builderFor;
              setForms((p) => {
                const f = p[cls] ?? emptyForm();
                const pkg = { ...f.pkg, ...Object.fromEntries(Object.entries(generated).map(([h, row]) => [h, Object.fromEntries(PKG_FIELDS.map(({ key }) => [key, String(row[key])])) as Record<PkgField, string>])) };
                return { ...p, [cls]: { ...f, rentalRule, pkg } };
              });
              setBuilderFor(null);
              showToast(`${builderCard.name}: 15 packages filled in. Review them and press Save changes.`);
            }} />
        </Modal>
      )}

      {confirmOpen && (
        <Modal title="Save fares" onClose={() => !busy && setConfirmOpen(false)} busy={busy}
          footer={<><Button onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={reason.trim().length < 5} onClick={executeSave}>Save</Button></>}>
          <p className="text-[13px] text-ink mb-1"><strong>{where}</strong></p>
          <p className="text-[12px] text-muted mb-2">Changed vehicles: {changed.map((c) => c.name).join(", ")}</p>
          {brand === "common" && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <label className="ds-check"><input type="checkbox" checked={allBrands} disabled={busy} onChange={(e) => setAllBrands(e.target.checked)} />Apply the changed prices to all brands</label>
              <p className="mt-1 text-[12px] text-muted">{replaced.length === 0
                ? "No brand has its own price in the boxes you changed, so every brand uses the new shared price."
                : allBrands
                  ? `These brand prices are replaced by the shared price: ${replaced.map((x) => `${x.name} · ${x.vehicle} (${x.count})`).join(", ")}.`
                  : `These brands keep their own price: ${[...new Set(replaced.map((x) => x.name))].join(", ")}.`}</p>
            </div>
          )}
          <label className="ds-field"><span>Reason for change</span><input className="ds-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          {saveError && <div className="ds-error mt-2" role="alert"><Icon name="circle-alert" /> {saveError}</div>}
        </Modal>
      )}
    </div>
  );
}

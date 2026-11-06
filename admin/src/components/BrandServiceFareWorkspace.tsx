import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BRAND_LABELS,
  CLASS_LABEL,
  FALLS_BACK_TO_SUV,
  DEFAULT_RENTAL_MIN_HOURS,
  RENTAL_HOURS,
  getInheritingBrands,
  inr,
  outstationExtraFor,
  resolveRate,
  serviceLabel,
  useTariff,
  type BrandFareOverride,
  type FareWorkspaceScope,
  type Tariff,
  type TariffClass,
  type WorkspaceService,
} from "../services/tariffService";
import { saveTariffConfig, saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { useCan, useCanDo } from "./AccessContext";
import { Badge, Button, Icon } from "./ui";
import { Modal, Toast, useToast } from "./Feedback";

// One form per Brand → Service → Vehicle class, saved as business_config/tariff_v2.brandOverrides[brand][service][class].
// "common" is the shared level every brand inherits; a blank box inherits, a typed value is this scope's own price.
// What each box feeds on the server: functions/src/domain/tariff.ts (scopedTariffForBrand, multicityRatesFor) and
// functions/src/domain/scopedExtraCharges.ts (waiting / hill / roof carrier, customer and partner).

const NUM_KEYS = [
  "customerRate", "partnerRate", "customerBase", "partnerBase", "minKm", "minKmPerDay", "customerBata", "partnerBata",
  "cngCustomerRate", "cngPartnerRate", "cngCustomerBata", "cngPartnerBata", "cngExtraKmRate", "cngMinKmPerDay",
  "extraKmRate", "waitingPerHour", "hillCharge", "carrierCharge", "partnerWaitingPerHour", "partnerHillCharge", "partnerCarrierCharge",
  "minRentalHours",
] as const satisfies readonly (keyof BrandFareOverride)[];
type NumKey = (typeof NUM_KEYS)[number];
/** Older per-vehicle waiting / tax rules. They now live once in "Rules for extra charges"; saving a scope removes its old copy. */
const OLD_RULE_KEYS = ["freeWaitingMinutes", "waitingRoundingMinutes", "waitingRoundingScope", "taxTreatment"] as const;

const PKG_FIELDS = [
  { key: "customerFare", label: "Customer fare", unit: "₹" },
  { key: "partnerPayout", label: "Partner payout", unit: "₹" },
  { key: "includedKm", label: "Km included", unit: "km" },
  { key: "extraKmRate", label: "Extra km", unit: "₹/km" },
  { key: "extraHourRate", label: "Extra hour", unit: "₹/hr" },
] as const;
type PkgField = (typeof PKG_FIELDS)[number]["key"];

interface Form { v: Record<NumKey, string>; pkg: Record<string, Record<PkgField, string>> }

const str = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const emptyPkg = (): Record<PkgField, string> => ({ customerFare: "", partnerPayout: "", includedKm: "", extraKmRate: "", extraHourRate: "" });
const emptyForm = (): Form => ({
  v: Object.fromEntries(NUM_KEYS.map((k) => [k, ""])) as Record<NumKey, string>,
  pkg: Object.fromEntries(RENTAL_HOURS.map((h) => [String(h), emptyPkg()])),
});

function formOf(t: Tariff | null | undefined, brand: FareWorkspaceScope["brand"], service: WorkspaceService, cls: TariffClass): Form {
  const f = emptyForm();
  const ov = t?.brandOverrides?.[brand]?.[service]?.[cls];
  if (!ov) return f;
  for (const k of NUM_KEYS) f.v[k] = str(ov[k]);
  for (const h of RENTAL_HOURS) {
    const p = ov.rentalPackages?.[String(h)];
    for (const { key } of PKG_FIELDS) f.pkg[String(h)]![key] = str(p?.[key]);
  }
  return f;
}

/** What a box needs before customers are quoted: a positive amount, or any amount including 0. Optional boxes have no need. */
type Need = "positive" | "any";
interface FieldDef { key: NumKey; label: string; unit: string; base: number | undefined; need?: Need; hint?: string }
interface ExtraRow { label: string; unit: string; customer: FieldDef; partner: FieldDef }

export default function BrandServiceFareWorkspace({ scope, vehicleClass, vehicleName, categoryId, cngEnabled, fuel = "petrol", onDirtyChange, onBusyChange }: {
  scope: FareWorkspaceScope;
  vehicleClass: TariffClass;
  /** The vehicle chosen in the side menu (several vehicles can share one rate class). */
  vehicleName?: string;
  /** Its vehicle category id: older extra-charge rates are keyed by it. */
  categoryId?: string;
  /** Whether that vehicle offers CNG to customers (Vehicle categories → CNG available). */
  cngEnabled?: boolean;
  /** Diesel / Petrol (the normal rates) or CNG (its own rate card, One Way and Round Trip). */
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
  const cls = vehicleClass;
  const showCng = fuel === "cng" && (service === "One Way" || service === "Round Trip");
  const perDay = service === "Round Trip" || service === "Multicity";

  const [form, setForm] = useState<Form>(emptyForm);
  const baseline = useRef("");
  const openedVersion = useRef(0);
  const loadedScope = useRef("");
  const dirtyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the scope's saved values; a newer tariff only replaces the form while nothing is being edited.
  useEffect(() => {
    if (t === undefined) return;
    const key = `${brand}:${service}:${cls}`;
    if (loadedScope.current === key && (t?.version ?? 0) < openedVersion.current) return;
    if (loadedScope.current === key && (dirtyRef.current || busy)) return;
    loadedScope.current = key;
    openedVersion.current = t?.version ?? 0;
    const loaded = formOf(t, brand, service, cls);
    setForm(loaded);
    baseline.current = JSON.stringify(loaded);
  }, [t, brand, service, cls, busy]);

  const isDirty = JSON.stringify(form) !== baseline.current;
  dirtyRef.current = isDirty;
  useEffect(() => { onDirtyChange(isDirty); onBusyChange(busy); }, [isDirty, busy, onDirtyChange, onBusyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const setValue = (key: NumKey, value: string) => setForm((f) => ({ ...f, v: { ...f.v, [key]: value } }));
  const setPkg = (hours: number, key: PkgField, value: string) => setForm((f) => ({ ...f, pkg: { ...f.pkg, [String(hours)]: { ...f.pkg[String(hours)]!, [key]: value } } }));

  // ── The values a blank box inherits (exactly as the server layers them) ─────────────────────────────────────────
  const oneWay = t?.oneWay?.classes?.[cls] ?? (FALLS_BACK_TO_SUV(cls) ? t?.oneWay?.classes?.suv : undefined);
  const roundTrip = t?.roundTrip?.classes?.[cls] ?? (FALLS_BACK_TO_SUV(cls) ? t?.roundTrip?.classes?.suv : undefined);
  const card = service === "One Way" ? oneWay : roundTrip; // Multicity inherits the Round Trip card
  const outstation = service === "One Way" ? outstationExtraFor(t, cls, "One Way") : perDay ? outstationExtraFor(t, cls, "Round Trip") : undefined;
  const oldExtras = t?.extraCharges?.categories?.[categoryId ?? ""] ?? t?.extraCharges?.categories?.[`cat-${cls}`] ?? t?.extraCharges?.categories?.[cls];
  const rentalMin = t?.rentalPackages?.[cls]?.minHours ?? DEFAULT_RENTAL_MIN_HOURS[cls];

  const resolved = (def: FieldDef) => resolveRate(t, brand, service, cls, def.key, def.base);
  const effective = (def: FieldDef): number | undefined => {
    const own = form.v[def.key].trim();
    if (own !== "") return Number.isFinite(Number(own)) ? Number(own) : undefined;
    return resolved(def).value;
  };
  const meets = (def: FieldDef) => {
    const n = effective(def);
    return n !== undefined && Number.isFinite(n) && (def.need === "positive" ? n > 0 : n >= 0);
  };

  const allowance = perDay ? "₹/day" : "₹/trip";
  const f = (key: NumKey, label: string, unit: string, base: number | undefined, need?: Need, hint?: string): FieldDef => ({ key, label, unit, base, need, hint });

  // ── Rate boxes for the service on screen ──────────────────────────────────────────────────────────────────────
  let customer: FieldDef[] = [], partner: FieldDef[] = [];
  const minHoursDef = f("minRentalHours", "Minimum hours", "hours", rentalMin, undefined, "Shorter packages are not offered");
  if (showCng) {
    customer = [
      f("cngCustomerRate", "CNG price per km", "₹/km", card?.cng?.customerRate, "positive"),
      f("cngCustomerBata", "CNG driver allowance", allowance, card?.cng?.customerBata, "any"),
      f("cngExtraKmRate", "CNG extra km price", "₹/km", card?.cng?.extraKmRate, undefined, "Blank = CNG price per km"),
      ...(service === "Round Trip" ? [f("cngMinKmPerDay", "CNG minimum km per day", "km/day", card?.cng?.minKmPerDay, undefined, "Blank = normal minimum")] : []),
    ];
    partner = [
      f("cngPartnerRate", "CNG partner pay per km", "₹/km", card?.cng?.partnerRate, "positive"),
      f("cngPartnerBata", "CNG partner driver allowance", allowance, card?.cng?.partnerBata, "any"),
    ];
  } else if (service === "One Way" || perDay) {
    customer = [
      f("customerRate", "Price per km", "₹/km", card?.customerRate, "positive"),
      f("customerBata", "Driver allowance", allowance, card?.customerBata, "any"),
      service === "One Way"
        ? f("minKm", "Minimum km charged", "km", t?.oneWay?.minKm ?? 130)
        : f("minKmPerDay", "Minimum km per day", "km/day", roundTrip?.minKmPerDay, "positive"),
      f("extraKmRate", "Extra km price", "₹/km", outstation?.extraKmRate ?? card?.customerRate, undefined, "Blank = price per km"),
    ];
    partner = [
      f("partnerRate", "Partner pay per km", "₹/km", card?.partnerRate, "positive"),
      f("partnerBata", "Partner driver allowance", allowance, card?.partnerBata, "any"),
    ];
  } else if (service === "Airport Taxi") {
    customer = [
      f("customerBase", "Base fare", "₹", t?.airport?.customerBase, "positive"),
      f("minKm", "Km included in base fare", "km", undefined, "positive"),
      f("extraKmRate", "Extra km price", "₹/km", undefined, "positive"),
    ];
    partner = [
      f("partnerBase", "Partner base payout", "₹", t?.airport?.partnerBase, "positive"),
      f("partnerRate", "Partner pay per extra km", "₹/km", undefined, "any"),
    ];
  } else if (service === "Local Rental") {
    customer = [minHoursDef];
  }

  // ── Extra charges: customer and partner side by side (a charge with no partner amount cannot be billed automatically) ──
  const extras: ExtraRow[] = [
    ...(service !== "Local Rental" ? [{
      label: "Waiting", unit: "₹/hour",
      customer: f("waitingPerHour", "Waiting", "₹/hour", oldExtras?.customer?.waitingPerHour ?? (Number.isFinite(outstation?.waitingPerHour) ? outstation?.waitingPerHour : undefined)),
      partner: f("partnerWaitingPerHour", "Partner waiting", "₹/hour", oldExtras?.partner?.waitingPerHour),
    }] : []),
    { label: "Hill station", unit: "₹/trip", customer: f("hillCharge", "Hill station", "₹/trip", oldExtras?.customer?.hill), partner: f("partnerHillCharge", "Partner hill", "₹/trip", oldExtras?.partner?.hill) },
    { label: "Roof carrier", unit: "₹/trip", customer: f("carrierCharge", "Roof carrier", "₹/trip", oldExtras?.customer?.carrier), partner: f("partnerCarrierCharge", "Partner roof carrier", "₹/trip", oldExtras?.partner?.carrier) },
  ];

  // ── Rental packages: own value → shared (All brands) value → base package ─────────────────────────────────────
  const minHours = effective(minHoursDef) ?? rentalMin;
  const pkgValue = (hours: number, key: PkgField): { own: string; inherited: number | undefined } => {
    const own = form.pkg[String(hours)]?.[key]?.trim() ?? "";
    const shared = brand !== "common" ? t?.brandOverrides?.common?.[service]?.[cls]?.rentalPackages?.[String(hours)]?.[key] : undefined;
    return { own, inherited: shared ?? t?.rentalPackages?.[cls]?.packages?.[String(hours)]?.[key] };
  };
  const pkgOffered = (hours: number) => {
    if (hours < minHours) return false;
    if (t?.rentalPackages?.[cls]?.packages?.[String(hours)]?.enabled === false) return false;
    return PKG_FIELDS.every(({ key }) => {
      const { own, inherited } = pkgValue(hours, key);
      const n = own !== "" ? Number(own) : inherited;
      return n !== undefined && Number.isFinite(n) && n > 0;
    });
  };

  // ── Readiness: what customers are actually offered with these values ──────────────────────────────────────────
  const missing = [...customer, ...partner].filter((d) => d.need && !meets(d)).map((d) => d.label);
  const offeredPackages = service === "Local Rental" ? RENTAL_HOURS.filter(pkgOffered) : [];
  const engineOff = !!t && !t.enabled && (service === "One Way" || service === "Round Trip" || service === "Airport Taxi");
  const cngStarted = showCng && [...customer, ...partner].some((d) => effective(d) !== undefined);
  const extraProblems = extras.filter((r) => effective(r.customer) !== undefined && effective(r.partner) === undefined).map((r) => r.label);
  const oldRules = OLD_RULE_KEYS.filter((k) => t?.brandOverrides?.[brand]?.[service]?.[cls]?.[k] !== undefined);
  const sharedOldRules = brand !== "common" ? OLD_RULE_KEYS.filter((k) => t?.brandOverrides?.common?.[service]?.[cls]?.[k] !== undefined) : [];

  let status: { tone: "ok" | "warn" | "off"; text: ReactNode };
  if (service === "Local Rental") {
    status = offeredPackages.length
      ? { tone: "ok", text: <>Customers are offered the {offeredPackages.join(", ")} hour package{offeredPackages.length > 1 ? "s" : ""}.</> }
      : { tone: "warn", text: <>No package is offered yet. Fill every box of a package (at or above {minHours} hours).</> };
  } else if (showCng) {
    status = !cngStarted ? { tone: "off", text: <>CNG is not offered for this vehicle. Fill the CNG rates to offer it, or leave them blank.</> }
      : missing.length ? { tone: "warn", text: <>CNG is not offered until these are filled: {missing.join(", ")}.</> }
      : !cngEnabled ? { tone: "warn", text: <>CNG rates are ready, but this vehicle does not offer CNG. Turn on <strong>CNG available</strong> for it in Vehicle categories.</> }
      : { tone: "ok", text: <>Customers can choose CNG or Diesel / Petrol for this vehicle.</> };
  } else if (missing.length) {
    status = { tone: "warn", text: <>Customers are not quoted these fares until these are filled: {missing.join(", ")}.{service === "Airport Taxi" ? " Until then airport trips use the vehicle category fare." : ""}</> };
  } else {
    status = { tone: "ok", text: <>Ready.</> };
  }

  // ── Save ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const invalid = NUM_KEYS.filter((k) => form.v[k].trim() !== "" && !(Number.isFinite(Number(form.v[k])) && Number(form.v[k]) >= 0));
  const executeSave = async () => {
    if (!canEdit || busy || !!loadError || t === undefined) return;
    if (reason.trim().length < 5) return setSaveError("Add a short reason (at least 5 characters).");
    setBusy(true);
    setSaveError(null);
    try {
      const data: Record<string, unknown> = {};
      for (const k of NUM_KEYS) data[k] = form.v[k].trim() ? Number(form.v[k]) : null; // null removes this scope's own value
      for (const k of OLD_RULE_KEYS) data[k] = null; // waiting / tax rules are now one shared setting
      let packages = 0;
      if (service === "Local Rental") {
        const rentalPackages: Record<string, Partial<Record<PkgField, number>>> = {};
        for (const h of RENTAL_HOURS) {
          const row: Partial<Record<PkgField, number>> = {};
          for (const { key } of PKG_FIELDS) { const v = form.pkg[String(h)]![key].trim(); if (v) row[key] = Number(v); }
          if (Object.keys(row).length) { rentalPackages[String(h)] = row; packages++; }
        }
        data.rentalPackages = rentalPackages;
      }
      const clearOverride = NUM_KEYS.every((k) => data[k] === null) && packages === 0;
      const saved = await saveTariffSection({ section: "brandOverride", brand, service, class: cls, expectedVersion: openedVersion.current, reason: reason.trim(), clearOverride, data });
      openedVersion.current = saved.version;
      dirtyRef.current = false;
      baseline.current = JSON.stringify(form);
      setConfirmOpen(false);
      setReason("");
      showToast(`Saved for ${where}. Bookings already made keep their price.`);
    } catch (err) {
      setSaveError(err instanceof ActionError ? err.message : "Not saved. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggleEngine = async () => {
    if (!canEdit || busy || isDirty || !t) return;
    const why = window.prompt(`Reason for turning the pricing engine ${t.enabled ? "off" : "on"} (affects every brand):`);
    if (!why) return;
    if (why.trim().length < 5) return showToast("Enter a reason of at least five characters.", "error");
    setBusy(true);
    try {
      await saveTariffConfig({ keepSavedRates: true, enabled: !t.enabled, reason: why.trim(), expectedVersion: t.version ?? 0 });
      showToast(`Pricing engine turned ${t.enabled ? "off" : "on"}. Every saved rate was kept.`);
    } catch (error) { showToast(error instanceof ActionError ? error.message : "The switch was not saved.", "error"); }
    finally { setBusy(false); }
  };

  const brandName = brand === "common" ? "All brands (shared)" : BRAND_LABELS[brand];
  const vehicle = vehicleName || CLASS_LABEL[cls];
  const where = `${brandName} → ${serviceLabel(service)} → ${vehicle}${showCng ? " (CNG)" : ""}`;

  const box = (def: FieldDef) => {
    const r = resolved(def);
    const others = brand === "common" ? getInheritingBrands(t, service, cls, def.key).overridden.length : 0;
    return (
      <RateField key={def.key} def={def} value={form.v[def.key]} inherited={r.value} common={brand === "common"} othersOwn={others}
        onChange={(v) => setValue(def.key, v)} />
    );
  };

  return (
    <div className="ds-fare-workspace space-y-3">
      <Toast toast={toast} />
      {loadError && <div className="ds-error" role="alert"><Icon name="circle-alert" /> Fares could not be loaded: {loadError}</div>}

      {engineOff && (
        <div className="ds-error flex flex-wrap items-center justify-between gap-2" role="status">
          <span><Icon name="triangle-alert" /> The pricing engine is <strong>off</strong>. Customers are charged the older vehicle category fares for {serviceLabel(service)}, not these.</span>
          {canEdit && brand === "common" ? <Button size="sm" variant="primary" disabled={busy || isDirty} onClick={toggleEngine}>Turn pricing engine on</Button> : <small>Turn it on under Brand → All brands (shared).</small>}
        </div>
      )}

      {/* What is being edited, whether it is ready, and Save */}
      <div className="ds-panel ds-panel-pad flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-[14px] text-ink">{where}</strong>
            {isDirty ? <Badge tone="amber">Unsaved changes</Badge> : null}
          </div>
          <p className={`text-[12px] mt-1 ${status.tone === "ok" ? "text-ok" : status.tone === "warn" ? "text-bad" : "text-muted"}`} role="status">
            {status.text}
          </p>
        </div>
        {canEdit && <Button variant="primary" icon="check" disabled={!isDirty || busy || !!loadError || invalid.length > 0} onClick={() => { setSaveError(null); setConfirmOpen(true); }}>Save changes</Button>}
      </div>
      {invalid.length > 0 && <p className="ds-error" role="alert">Enter numbers of 0 or more only.</p>}

      <fieldset disabled={!canEdit || busy || !!loadError} className="min-w-0 space-y-3">
        {service === "One Way" && !showCng && <p className="ds-note">Trips of 40 km or less use the Pickup &amp; Drop city fares instead.</p>}
        {service === "Multicity" && <p className="ds-note">Multicity is booked on the websites and quoted by the travel desk with these rates. Blank boxes use the Round Trip rates.</p>}

        {customer.length > 0 && service !== "Local Rental" && (
          <FareGroup title={showCng ? "CNG — customer pays" : "Customer pays"}>{customer.map(box)}</FareGroup>
        )}
        {partner.length > 0 && <FareGroup title={showCng ? "CNG — partner gets" : "Partner gets"}>{partner.map(box)}</FareGroup>}

        {service === "Local Rental" && (
          <FareGroup title="Hourly packages">
            {customer.map(box)}
            <div className="overflow-x-auto" style={{ gridColumn: "1 / -1" }}>
              <table className="ds-table w-full text-[13px]">
                <thead><tr><th>PACKAGE</th>{PKG_FIELDS.map((p) => <th key={p.key}>{p.label.toUpperCase()} ({p.unit})</th>)}</tr></thead>
                <tbody>
                  {RENTAL_HOURS.map((h) => {
                    const below = h < minHours;
                    return (
                      <tr key={h} style={below ? { opacity: 0.55 } : undefined}>
                        <td><strong>{h} hours</strong><small className="block text-muted">{below ? "Below minimum — not offered" : pkgOffered(h) ? "Offered" : "Not complete"}</small></td>
                        {PKG_FIELDS.map(({ key, label }) => {
                          const { own, inherited } = pkgValue(h, key);
                          return <td key={key}><input type="number" min={0} className="ds-input text-right w-24" aria-label={`${h} hours ${label}`} placeholder={str(inherited) || "—"} value={own} onChange={(e) => setPkg(h, key, e.target.value)} /></td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </FareGroup>
        )}

        {showCng ? (
          <p className="text-[12px] text-muted">Extra charges are the same for CNG and Diesel / Petrol. Set them with Fuel → Diesel / Petrol.</p>
        ) : (
          <section className="ds-fare-group" aria-label="Extra charges">
            <div className="ds-fare-group__head"><strong>Extra charges</strong><span>Added only when they happen on the trip. Blank = not decided, 0 = free.</span></div>
            <div className="overflow-x-auto px-[14px] pb-[14px]">
              <table className="ds-table w-full text-[13px]">
                <thead><tr><th>CHARGE</th><th>CUSTOMER PAYS</th><th>PARTNER GETS</th></tr></thead>
                <tbody>
                  {extras.map((r) => (
                    <tr key={r.label} data-rate-field={r.customer.key}>
                      <td><strong>{r.label}</strong><small className="block text-muted">{r.unit}</small></td>
                      {[r.customer, r.partner].map((d) => {
                        const own = form.v[d.key];
                        const inherited = resolved(d).value;
                        return <td key={d.key}><input type="number" min={0} className="ds-input text-right w-28" aria-label={`${d.label} ${r.unit}`} placeholder={inherited !== undefined ? String(inherited) : "Not set"} value={own} onChange={(e) => setValue(d.key, e.target.value)} /></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {extraProblems.length > 0 && <p className="text-[12px] text-bad mt-2" role="status"><Icon name="circle-alert" size={13} /> Add the partner amount for {extraProblems.join(", ")}. Without it the charge waits for office review.</p>}
            </div>
          </section>
        )}

        {(oldRules.length > 0 || sharedOldRules.length > 0) && (
          <p className="ds-note" role="status">
            {oldRules.length > 0
              ? <>This selection still has its own older waiting / tax rules. Saving here removes them so the shared <strong>Rules for extra charges</strong> below apply.</>
              : <>All brands (shared) → {serviceLabel(service)} → {CLASS_LABEL[cls]} still has older waiting / tax rules. Open it and save once so the shared <strong>Rules for extra charges</strong> apply.</>}
          </p>
        )}
      </fieldset>

      {brand === "common" && t?.enabled && (service === "One Way" || service === "Round Trip" || service === "Airport Taxi") && canEdit && (
        <p className="text-[12px] text-muted">Pricing engine: on. <button type="button" className="underline" disabled={busy || isDirty} onClick={toggleEngine}>Turn off</button> (customers would be charged the older vehicle category fares).</p>
      )}

      {confirmOpen && (
        <Modal title="Save fares" onClose={() => !busy && setConfirmOpen(false)} busy={busy}
          footer={<><Button onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={reason.trim().length < 5} onClick={executeSave}>Save</Button></>}>
          <p className="text-[13px] text-ink mb-2"><strong>{where}</strong></p>
          <p className="text-[12px] text-muted mb-3">
            {brand === "common" ? "Shared prices: every brand without its own price changes too." : `Only ${BRAND_LABELS[brand]} changes.`} New quotes use the new prices; bookings already made keep theirs.
          </p>
          <label className="ds-field"><span>Reason for change</span><input className="ds-input" value={reason} maxLength={300} placeholder="e.g. Diesel price increase" onChange={(e) => setReason(e.target.value)} /></label>
          {saveError && <div className="ds-error mt-2" role="alert"><Icon name="circle-alert" /> {saveError}</div>}
        </Modal>
      )}
    </div>
  );
}

function FareGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ds-fare-group" aria-label={title}>
      <div className="ds-fare-group__head"><strong>{title}</strong></div>
      <div className="ds-fare-group__body">{children}</div>
    </section>
  );
}

/** One rate box. Grey placeholder = the value it inherits; the line below says where the value comes from. */
function RateField({ def, value, inherited, common, othersOwn, onChange }: {
  def: FieldDef; value: string; inherited: number | undefined; common: boolean; othersOwn: number; onChange: (v: string) => void;
}) {
  const own = value.trim() !== "";
  const note = common
    ? othersOwn > 0 ? `${othersOwn} brand${othersOwn === 1 ? " has" : "s have"} its own price` : def.hint ?? "Used by all brands"
    : own ? `Own price: ${inr(Number(value))}` : inherited !== undefined ? `Shared price: ${inr(inherited)}` : def.hint ?? "Not set";
  return (
    <label data-rate-field={def.key} className="ds-field p-2.5 border border-line rounded-lg bg-white">
      <span className="flex items-center justify-between gap-1">
        <span className="text-[12px] font-bold text-ink">{def.label}{def.need ? <span className="text-bad"> *</span> : null}</span>
        <span className="text-[11px] text-muted">{def.unit}</span>
      </span>
      <span className="flex items-center gap-2">
        <input type="number" min={0} className="ds-input flex-1 font-semibold" placeholder={inherited !== undefined ? String(inherited) : "Not set"} value={value} onChange={(e) => onChange(e.target.value)} />
        {!common && own && <Button size="sm" variant="ghost" title="Use the shared price" aria-label={`Use the shared ${def.label}`} onClick={(e) => { e.preventDefault(); onChange(""); }}><Icon name="rotate-ccw" size={13} /></Button>}
      </span>
      <small className="mt-1 text-[11px] leading-tight text-muted">{note}</small>
    </label>
  );
}

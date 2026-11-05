import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BRAND_LABELS,
  BrandFareOverride,
  BrandId,
  CLASS_LABEL,
  FALLS_BACK_TO_SUV,
  DEFAULT_RENTAL_MIN_HOURS,
  RENTAL_HOURS,
  RateValue,
  Tariff,
  TariffClass,
  WorkspaceService,
  FareWorkspaceScope,
  getInheritingBrands,
  inr,
  outstationExtraFor,
  resolveRate,
  useTariff,
} from "../services/tariffService";
import { saveTariffConfig, saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { useCan, useCanDo } from "./AccessContext";
import { Badge, Button, Icon, PageHeader } from "./ui";
import { Modal, Toast, useToast } from "./Feedback";

type ScopeBrand = "common" | BrandId;

interface FormFields {
  partnerWaitingPerHour: string; partnerHillCharge: string; partnerCarrierCharge: string;
  freeWaitingMinutes: string; waitingRoundingMinutes: string; waitingRoundingScope: string; taxTreatment: string;
  customerRate: string;
  partnerRate: string;
  customerBase: string;
  partnerBase: string;
  minKm: string;
  minKmPerDay: string;
  customerBata: string;
  partnerBata: string;
  cngCustomerRate: string;
  cngPartnerRate: string;
  cngCustomerBata: string;
  cngPartnerBata: string;
  cngExtraKmRate: string;
  cngMinKmPerDay: string;
  extraKmRate: string;
  waitingPerHour: string;
  hillCharge: string;
  carrierCharge: string;
  minRentalHours: string;
  rentalCustomerFare: Record<number, string>;
  rentalPartnerPayout: Record<number, string>;
  rentalIncludedKm: Record<number, string>;
  rentalExtraKm: Record<number, string>;
  rentalExtraHour: Record<number, string>;
}

const emptyForm = (): FormFields => ({
  partnerWaitingPerHour: '', partnerHillCharge: '', partnerCarrierCharge: '', freeWaitingMinutes: '', waitingRoundingMinutes: '', waitingRoundingScope: '', taxTreatment: '',
  customerRate: "",
  partnerRate: "",
  customerBase: "",
  partnerBase: "",
  minKm: "",
  minKmPerDay: "",
  customerBata: "",
  partnerBata: "",
  cngCustomerRate: "",
  cngPartnerRate: "",
  cngCustomerBata: "",
  cngPartnerBata: "",
  cngExtraKmRate: "",
  cngMinKmPerDay: "",
  extraKmRate: "",
  waitingPerHour: "",
  hillCharge: "",
  carrierCharge: "",
  minRentalHours: "",
  rentalCustomerFare: {},
  rentalPartnerPayout: {},
  rentalIncludedKm: {},
  rentalExtraKm: {},
  rentalExtraHour: {},
});

const str = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");

export default function BrandServiceFareWorkspace({ scope, vehicleClass, fuel = "petrol", onDirtyChange, onBusyChange }: {
  scope: FareWorkspaceScope; vehicleClass: TariffClass; /** Which vehicles the rates on screen are for: Diesel / Petrol (the normal rates) or CNG (its own rate card). */ fuel?: "petrol" | "cng"; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
}) {
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const { tariff: t, error: loadError } = useTariff();
  const { toast, show: showToast } = useToast(6000);

  // Scope hierarchy selection (brand, service and vehicle category are all chosen on the page above the tabs)
  const selectedBrand = scope.brand;
  const selectedService = scope.service;
  const selectedClass = vehicleClass;
  const showCng = fuel === "cng" && (selectedService === "One Way" || selectedService === "Round Trip");

  // Form edit state
  const [form, setForm] = useState<FormFields>(emptyForm);
  const scopeBaseline = useRef<string>("");
  const openedVersion = useRef(0);
  const loadedScope = useRef("");
  const dirtyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  // Save Confirmation Modal
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [saveReason, setSaveReason] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Helper to load form values from current tariff for selected scope
  const loadScopeValues = (
    tariff: Tariff | null | undefined,
    brand: ScopeBrand,
    svc: WorkspaceService,
    cls: TariffClass
  ): FormFields => {
    const f = emptyForm();
    if (!tariff) return f;

      const ov = tariff.brandOverrides?.[brand]?.[svc]?.[cls];
      if (ov) {
        for (const key of ['partnerWaitingPerHour','partnerHillCharge','partnerCarrierCharge','freeWaitingMinutes','waitingRoundingMinutes'] as const) f[key] = str(ov[key]);
        f.waitingRoundingScope = ov.waitingRoundingScope ?? '';
        f.taxTreatment = ov.taxTreatment ?? '';
        f.customerRate = str(ov.customerRate);
        f.partnerRate = str(ov.partnerRate);
        f.customerBase = str(ov.customerBase);
        f.partnerBase = str(ov.partnerBase);
        f.minKm = str(ov.minKm);
        f.minKmPerDay = str(ov.minKmPerDay);
        f.customerBata = str(ov.customerBata);
        f.partnerBata = str(ov.partnerBata);
        f.cngCustomerRate = str(ov.cngCustomerRate);
        f.cngPartnerRate = str(ov.cngPartnerRate);
        f.cngCustomerBata = str(ov.cngCustomerBata);
        f.cngPartnerBata = str(ov.cngPartnerBata);
        f.cngExtraKmRate = str(ov.cngExtraKmRate);
        f.cngMinKmPerDay = str(ov.cngMinKmPerDay);
        f.extraKmRate = str(ov.extraKmRate);
        f.waitingPerHour = str(ov.waitingPerHour);
        f.hillCharge = str(ov.hillCharge);
        f.carrierCharge = str(ov.carrierCharge);
        f.minRentalHours = str(ov.minRentalHours);
        if (ov.rentalPackages) {
          for (const h of RENTAL_HOURS) {
            const p = ov.rentalPackages[String(h)];
            f.rentalCustomerFare[h] = str(p?.customerFare);
            f.rentalPartnerPayout[h] = str(p?.partnerPayout);
            f.rentalIncludedKm[h] = str(p?.includedKm);
            f.rentalExtraKm[h] = str(p?.extraKmRate);
            f.rentalExtraHour[h] = str(p?.extraHourRate);
          }
        }
      }
    return f;
  };

  const serializeForm = (f: FormFields): string => JSON.stringify(f);

  // Initialize or re-sync form when tariff or scope changes
  useEffect(() => {
    if (t === undefined) return;
    const key = selectedBrand + ':' + selectedService + ':' + selectedClass;
    if (loadedScope.current === key && (t?.version ?? 0) < openedVersion.current) return;
    if (loadedScope.current === key && (dirtyRef.current || busy)) return;
    loadedScope.current = key;
    openedVersion.current = t?.version ?? 0;
    const loaded = loadScopeValues(t, selectedBrand, selectedService, selectedClass);
    setForm(loaded);
    scopeBaseline.current = serializeForm(loaded);
  }, [t, selectedBrand, selectedService, selectedClass, busy]);

  const isDirty = serializeForm(form) !== scopeBaseline.current;

  dirtyRef.current = isDirty;
  useEffect(() => { onDirtyChange(isDirty); onBusyChange(busy); }, [isDirty, busy, onDirtyChange, onBusyChange]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);

  // Field change handler
  const setField = (key: keyof Omit<FormFields, "rentalCustomerFare" | "rentalPartnerPayout" | "rentalIncludedKm" | "rentalExtraKm" | "rentalExtraHour">, val: string) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const setRentalField = (hour: number, field: "customerFare" | "partnerPayout" | "includedKm" | "extraKm" | "extraHour", val: string) => {
    setForm((prev) => {
      const mapKey = field === "customerFare" ? "rentalCustomerFare"
        : field === "partnerPayout" ? "rentalPartnerPayout"
        : field === "includedKm" ? "rentalIncludedKm"
        : field === "extraKm" ? "rentalExtraKm"
        : "rentalExtraHour";
      return {
        ...prev,
        [mapKey]: { ...prev[mapKey], [hour]: val },
      };
    });
  };

  // Revert / Clear override
  const handleClearOverride = (field: keyof Omit<FormFields, "rentalCustomerFare" | "rentalPartnerPayout" | "rentalIncludedKm" | "rentalExtraKm" | "rentalExtraHour">) => {
    setField(field, "");
  };

  // Compute common baseline reference values for comparison
  // Baselines exactly as the server inherits them (Innova uses the SUV card until it has its own). resolveRate then layers
  // the Common service setting and the brand's own on top.
  const commonOW = t?.oneWay?.classes?.[selectedClass] ?? (FALLS_BACK_TO_SUV(selectedClass) ? t?.oneWay?.classes?.suv : undefined);
  // Round Trip uses its own card; Multicity inherits the Round Trip card (a multi-day tour is billed the same way).
  const commonRT: { customerRate?: number; partnerRate?: number; minKmPerDay?: number; customerBata?: number; partnerBata?: number } | undefined =
    t?.roundTrip?.classes?.[selectedClass] ?? (FALLS_BACK_TO_SUV(selectedClass) ? t?.roundTrip?.classes?.suv : undefined);
  const commonExtras = selectedService === "One Way" ? outstationExtraFor(t, selectedClass, "One Way")
    : selectedService === "Round Trip" || selectedService === "Multicity" ? outstationExtraFor(t, selectedClass, "Round Trip")
    : undefined;
  const commonAirport = t?.airport;
  const commonExtraCharges = t?.extraCharges?.categories?.[`cat-${selectedClass}`] || t?.extraCharges?.categories?.[selectedClass];

  // Helper for single field effective evaluation
  const evalField = (field: keyof BrandFareOverride, commonVal: number | undefined): RateValue => {
    return resolveRate(t, selectedBrand, selectedService, selectedClass, field, commonVal);
  };

  // Save execution
  const executeSave = async () => {
    if (!canEdit || busy || !!loadError || t === undefined) return;
    if (saveReason.trim().length < 5) {
      setSaveError("Please provide a short change reason (at least 5 characters) for audit tracking.");
      return;
    }

    setBusy(true);
    setSaveError(null);

    try {
        // Saving a Brand Override for the selected Brand -> Service -> Category
        const overrideData: Record<string, unknown> = {};
        for (const key of ['partnerWaitingPerHour','partnerHillCharge','partnerCarrierCharge','freeWaitingMinutes','waitingRoundingMinutes'] as const) overrideData[key] = form[key].trim() ? Number(form[key]) : null;
        overrideData.waitingRoundingScope = form.waitingRoundingScope || null;
        overrideData.taxTreatment = form.taxTreatment || null;

        if (form.customerRate.trim()) overrideData.customerRate = Number(form.customerRate);
        if (form.partnerRate.trim()) overrideData.partnerRate = Number(form.partnerRate);
        if (form.customerBase.trim()) overrideData.customerBase = Number(form.customerBase);
        if (form.partnerBase.trim()) overrideData.partnerBase = Number(form.partnerBase);
        if (form.minKm.trim()) overrideData.minKm = Number(form.minKm);
        if (form.minKmPerDay.trim()) overrideData.minKmPerDay = Number(form.minKmPerDay);
        if (form.customerBata.trim()) overrideData.customerBata = Number(form.customerBata);
        if (form.partnerBata.trim()) overrideData.partnerBata = Number(form.partnerBata);
        for (const key of ['cngCustomerRate','cngPartnerRate','cngCustomerBata','cngPartnerBata','cngExtraKmRate','cngMinKmPerDay'] as const) if (form[key].trim()) overrideData[key] = Number(form[key]);
        if (form.extraKmRate.trim()) overrideData.extraKmRate = Number(form.extraKmRate);
        if (form.waitingPerHour.trim()) overrideData.waitingPerHour = Number(form.waitingPerHour);
        if (form.hillCharge.trim()) overrideData.hillCharge = Number(form.hillCharge);
        if (form.carrierCharge.trim()) overrideData.carrierCharge = Number(form.carrierCharge);
        if (form.minRentalHours.trim()) overrideData.minRentalHours = Number(form.minRentalHours);

        if (selectedService === "Local Rental") {
          const rentalPkgs: Record<string, unknown> = {};
          for (const h of RENTAL_HOURS) {
            const cFare = form.rentalCustomerFare[h]?.trim();
            const pPayout = form.rentalPartnerPayout[h]?.trim();
            const incKm = form.rentalIncludedKm[h]?.trim();
            const exKm = form.rentalExtraKm[h]?.trim();
            const exHr = form.rentalExtraHour[h]?.trim();

            if (cFare || pPayout || incKm || exKm || exHr) {
              rentalPkgs[String(h)] = {
                ...(cFare ? { customerFare: Number(cFare) } : {}),
                ...(pPayout ? { partnerPayout: Number(pPayout) } : {}),
                ...(incKm ? { includedKm: Number(incKm) } : {}),
                ...(exKm ? { extraKmRate: Number(exKm) } : {}),
                ...(exHr ? { extraHourRate: Number(exHr) } : {}),
              };
            }
          }
          overrideData.rentalPackages = rentalPkgs;
        }

        const isClearingAll = Object.values(overrideData).every(value => value === null);
        // Null explicitly removes an individual override; omission would preserve the previous value.
        for (const key of ['customerRate','partnerRate','customerBase','partnerBase','minKm','minKmPerDay','customerBata','partnerBata','cngCustomerRate','cngPartnerRate','cngCustomerBata','cngPartnerBata','cngExtraKmRate','cngMinKmPerDay','extraKmRate','waitingPerHour','hillCharge','carrierCharge','minRentalHours']) {
          if (!(key in overrideData)) overrideData[key] = null;
        }

        const saved = await saveTariffSection({
          section: "brandOverride",
          brand: selectedBrand,
          service: selectedService,
          class: selectedClass,
          expectedVersion: openedVersion.current,
          reason: saveReason.trim(),
          clearOverride: isClearingAll,
          data: overrideData,
        });
        openedVersion.current = saved.version;

      dirtyRef.current = false;
      scopeBaseline.current = serializeForm(form);
      setConfirmSaveOpen(false);
      setSaveReason("");
      showToast(`Successfully saved fare settings for ${scopeSummary}. Saved for this scope. Existing agreed bookings retain their pricing.`);
    } catch (err) {
      setSaveError(err instanceof ActionError ? err.message : "Failed to save settings. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggleSharedEngine = async () => {
    if (!canEdit || busy || isDirty || !t || selectedBrand !== 'common') return;
    const reason = window.prompt('Reason for changing the shared pricing engine switch (affects every brand):');
    if (!reason) return;
    if (reason.trim().length < 5) return showToast('Enter a change reason of at least five characters.', 'error');
    setBusy(true);
    try {
      await saveTariffConfig({ keepSavedRates: true, enabled: !t.enabled, reason: reason.trim(), expectedVersion: openedVersion.current });
      showToast('Shared engine switch saved. All saved rates were retained.');
    } catch (error) { showToast(error instanceof ActionError ? error.message : 'The engine switch was not saved.', 'error'); }
    finally { setBusy(false); }
  };

  const scopeSummary = `${selectedBrand === "common" ? "Common (Shared Baseline)" : BRAND_LABELS[selectedBrand]} → ${selectedService} → ${CLASS_LABEL[selectedClass]}`;
  const brandOverrideActive = selectedBrand !== "common" && !!t?.brandOverrides?.[selectedBrand]?.[selectedService]?.[selectedClass];

  return (
    <div className="ds-fare-workspace">
      <Toast toast={toast} />

      {selectedService === "Multicity" && <p className="ds-note mb-4">Prepare Multicity quotes in Bookings → Enquiries &amp; quotes → Price Multicity quote. These rates set distance charges, daily minimum kilometres and daily driver bata. Unset fields inherit the shared baseline. Saving a quote does not create a booking.</p>}
      {selectedService === "Airport Taxi" && <p className="ds-note mb-4">Airport fare = base fare for the included KM + extra KM rate for every KM beyond. Customer base, partner base, included KM, extra KM rate and partner extra KM rate must all be set for a vehicle class before quotes use them; until then airport trips use the vehicle-category fare.</p>}

      {loadError && (
        <div className="ds-error mb-4" role="alert">
          <Icon name="circle-alert" /> Tariff configuration could not be loaded: {loadError}
        </div>
      )}

      {t && !t.enabled && <p className="ds-note mb-4">The confirmed tariff engine is switched off. These scoped rates are saved but its booking paths currently use the existing category fallback. The shared engine switch is available under Common.</p>}
      {selectedBrand === 'common' && t && <details className="ds-panel ds-panel-pad mb-4"><summary className="cursor-pointer text-[13px] font-bold">Pricing engine: {t.enabled ? "on" : "off"}</summary><p className="text-[12px] text-muted mb-2">{t.enabled ? 'Enabled' : 'Disabled'} — changing this switch retains all rates.</p>{canEdit && <Button disabled={busy || isDirty} onClick={toggleSharedEngine}>{t.enabled ? 'Disable confirmed tariff' : 'Enable confirmed tariff'}</Button>}</details>}

      {/* Persistent Scope Summary Banner */}
      <div className="ds-panel ds-panel-pad mb-4 bg-slate-50 border-l-4 border-l-brand flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-bold uppercase tracking-wider text-muted">You are editing:</span>
          <span className="text-[14px] font-bold text-ink">{scopeSummary}</span>
          {isDirty && (
            <Badge tone="amber">
              <Icon name="clock" size={14} /> Unsaved changes
            </Badge>
          )}
          {selectedBrand === "common" ? (
            <Badge tone="neutral">Shared by all brands</Badge>
          ) : brandOverrideActive ? (
            <Badge tone="blue">Own prices for this brand</Badge>
          ) : (
            <Badge tone="neutral">Using common prices</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="primary"
              disabled={!isDirty || busy || !!loadError}
              onClick={() => setConfirmSaveOpen(true)}
            >
              <Icon name="check" size={14} /> Save changes
            </Button>
          )}
        </div>
      </div>

      {/* Scope Editor Controls */}
      <section className="ds-panel ds-panel-pad"><fieldset disabled={!canEdit || busy || !!loadError} className="min-w-0">
        <h3 className="text-[16px] font-bold text-ink mb-1">
          {selectedService} Rates for {CLASS_LABEL[selectedClass]}
        </h3>
        <p className="text-[12px] text-muted mb-4">
          {selectedBrand === "common"
            ? "Editing Common rates sets the fallback baseline for all brands."
            : `Set brand-specific overrides for ${BRAND_LABELS[selectedBrand]}. Unset fields cleanly inherit from Common rates.`}
        </p>

        {/* SERVICE-SPECIFIC CONTROLS */}
        {showCng && (
          <p className="text-[12px] text-muted mb-3">Showing the <strong>CNG</strong> rate card. Switch Fuel to Diesel / Petrol above to edit the normal rates.</p>
        )}
        {!showCng && selectedService === "One Way" && (
          <div className="space-y-3">
            <FareGroup title="Customer price" hint="What the customer pays.">
            <RateField
              label="Price per km"
              unit="₹/km"
              value={form.customerRate}
              commonValue={commonOW?.customerRate}
              resolved={evalField("customerRate", commonOW?.customerRate)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("customerRate", v)}
              onClear={() => handleClearOverride("customerRate")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="customerRate"
            />
            <RateField
              label="Driver allowance"
              unit="₹/trip"
              value={form.customerBata}
              commonValue={commonOW?.customerBata}
              resolved={evalField("customerBata", commonOW?.customerBata)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("customerBata", v)}
              onClear={() => handleClearOverride("customerBata")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="customerBata"
              zeroAllowed
            />
            <RateField
              label="Minimum km charged"
              unit="km"
              value={form.minKm}
              commonValue={t?.oneWay?.minKm ?? 130}
              resolved={evalField("minKm", t?.oneWay?.minKm ?? 130)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("minKm", v)}
              onClear={() => handleClearOverride("minKm")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="minKm"
            />
            <RateField
              label="Extra km price"
              unit="₹/km"
              value={form.extraKmRate}
              commonValue={commonExtras?.extraKmRate ?? commonOW?.customerRate}
              resolved={evalField("extraKmRate", commonExtras?.extraKmRate ?? commonOW?.customerRate)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("extraKmRate", v)}
              onClear={() => handleClearOverride("extraKmRate")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="extraKmRate"
            />
            </FareGroup>
            <FareGroup title="Partner pay" hint="What the driver or fleet partner gets.">
            <RateField
              label="Partner pay per km"
              unit="₹/km"
              value={form.partnerRate}
              commonValue={commonOW?.partnerRate}
              resolved={evalField("partnerRate", commonOW?.partnerRate)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("partnerRate", v)}
              onClear={() => handleClearOverride("partnerRate")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="partnerRate"
            />
            <RateField
              label="Partner driver allowance"
              unit="₹/trip"
              value={form.partnerBata}
              commonValue={commonOW?.partnerBata}
              resolved={evalField("partnerBata", commonOW?.partnerBata)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("partnerBata", v)}
              onClear={() => handleClearOverride("partnerBata")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="partnerBata"
              zeroAllowed
            />
            </FareGroup>
            <FareGroup title="Extra charges" hint="Paid on top, only when they happen.">
            <RateField
              label="Waiting price"
              unit="₹/hour"
              value={form.waitingPerHour}
              commonValue={commonExtraCharges?.customer?.waitingPerHour ?? commonExtras?.waitingPerHour}
              resolved={evalField("waitingPerHour", commonExtraCharges?.customer?.waitingPerHour ?? commonExtras?.waitingPerHour)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("waitingPerHour", v)}
              onClear={() => handleClearOverride("waitingPerHour")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="waitingPerHour"
              zeroAllowed
            />
            <RateField
              label="Hill charge"
              unit="₹/trip"
              value={form.hillCharge}
              commonValue={commonExtraCharges?.customer?.hill}
              resolved={evalField("hillCharge", commonExtraCharges?.customer?.hill)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("hillCharge", v)}
              onClear={() => handleClearOverride("hillCharge")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="hillCharge"
              zeroAllowed
            />
            <RateField
              label="Roof carrier charge"
              unit="₹/trip"
              value={form.carrierCharge}
              commonValue={commonExtraCharges?.customer?.carrier}
              resolved={evalField("carrierCharge", commonExtraCharges?.customer?.carrier)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("carrierCharge", v)}
              onClear={() => handleClearOverride("carrierCharge")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="carrierCharge"
              zeroAllowed
            />
            </FareGroup>
          </div>
        )}

        {selectedService === "Airport Taxi" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <RateField
              label="Airport Customer Base Fare"
              unit="₹ base"
              value={form.customerBase}
              commonValue={commonAirport?.customerBase}
              resolved={evalField("customerBase", commonAirport?.customerBase)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("customerBase", v)}
              onClear={() => handleClearOverride("customerBase")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="customerBase"
            />
            <RateField
              label="Airport Partner Base Payout"
              unit="₹ base"
              value={form.partnerBase}
              commonValue={commonAirport?.partnerBase}
              resolved={evalField("partnerBase", commonAirport?.partnerBase)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("partnerBase", v)}
              onClear={() => handleClearOverride("partnerBase")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="partnerBase"
            />
            <RateField
              label="Included KM in Base Fare"
              unit="km"
              value={form.minKm}
              commonValue={undefined}
              resolved={evalField("minKm", undefined)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("minKm", v)}
              onClear={() => handleClearOverride("minKm")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="minKm"
            />
            <RateField
              label="Customer Extra KM Rate"
              unit="₹/km"
              value={form.extraKmRate}
              commonValue={undefined}
              resolved={evalField("extraKmRate", undefined)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("extraKmRate", v)}
              onClear={() => handleClearOverride("extraKmRate")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="extraKmRate"
            />
            <RateField
              label="Partner Extra KM Rate"
              unit="₹/km"
              value={form.partnerRate}
              commonValue={undefined}
              resolved={evalField("partnerRate", undefined)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("partnerRate", v)}
              onClear={() => handleClearOverride("partnerRate")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="partnerRate"
              zeroAllowed
            />
            <RateField
              label="Waiting Charge"
              unit="₹/hour"
              value={form.waitingPerHour}
              commonValue={commonExtraCharges?.customer?.waitingPerHour}
              resolved={evalField("waitingPerHour", commonExtraCharges?.customer?.waitingPerHour)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("waitingPerHour", v)}
              onClear={() => handleClearOverride("waitingPerHour")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="waitingPerHour"
              zeroAllowed
            />
            <RateField
              label="Luggage / Roof Carrier Charge"
              unit="₹/trip"
              value={form.carrierCharge}
              commonValue={commonExtraCharges?.customer?.carrier}
              resolved={evalField("carrierCharge", commonExtraCharges?.customer?.carrier)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("carrierCharge", v)}
              onClear={() => handleClearOverride("carrierCharge")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="carrierCharge"
              zeroAllowed
            />
          </div>
        )}

        {selectedService === "Local Rental" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <RateField
                label="Minimum Rental Duration"
                unit="hours"
                value={form.minRentalHours}
                commonValue={t?.rentalPackages?.[selectedClass]?.minHours ?? DEFAULT_RENTAL_MIN_HOURS[selectedClass]}
                resolved={evalField("minRentalHours", t?.rentalPackages?.[selectedClass]?.minHours ?? DEFAULT_RENTAL_MIN_HOURS[selectedClass])}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("minRentalHours", v)}
                onClear={() => handleClearOverride("minRentalHours")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="minRentalHours"
              />
              <RateField
                label="Hill Station Charge"
                unit="₹/trip"
                value={form.hillCharge}
                commonValue={commonExtraCharges?.customer?.hill}
                resolved={evalField("hillCharge", commonExtraCharges?.customer?.hill)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("hillCharge", v)}
                onClear={() => handleClearOverride("hillCharge")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="hillCharge"
                zeroAllowed
              />
              <RateField
                label="Roof Carrier Charge"
                unit="₹/trip"
                value={form.carrierCharge}
                commonValue={commonExtraCharges?.customer?.carrier}
                resolved={evalField("carrierCharge", commonExtraCharges?.customer?.carrier)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("carrierCharge", v)}
                onClear={() => handleClearOverride("carrierCharge")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="carrierCharge"
                zeroAllowed
              />
            </div>

            <h4 className="text-[14px] font-bold text-ink mt-3">Rental Packages by Duration</h4>
            <div className="overflow-x-auto">
              <table className="ds-table w-full text-[13px]">
                <thead>
                  <tr>
                    <th>PACKAGE</th>
                    <th>CUSTOMER FARE (₹)</th>
                    <th>PARTNER PAYOUT (₹)</th>
                    <th>INCLUDED KM</th>
                    <th>EXTRA KM RATE (₹/km)</th>
                    <th>EXTRA HOUR RATE (₹/hr)</th>
                  </tr>
                </thead>
                <tbody>
                  {RENTAL_HOURS.map((h) => {
                    const commonPkg = { ...t?.rentalPackages?.[selectedClass]?.packages?.[String(h)], ...t?.brandOverrides?.common?.[selectedService]?.[selectedClass]?.rentalPackages?.[String(h)] };
                    return (
                      <tr key={h}>
                        <td>
                          <strong>{h} Hours</strong>
                          <small className="block text-muted">{commonPkg?.includedKm ?? h * 10} km</small>
                        </td>
                        <td>
                          <input
                            type="number"
                            className="ds-input text-right w-24"
                            placeholder={str(commonPkg?.customerFare) || "—"}
                            value={form.rentalCustomerFare[h] ?? ""}
                            onChange={(e) => setRentalField(h, "customerFare", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="ds-input text-right w-24"
                            placeholder={str(commonPkg?.partnerPayout) || "—"}
                            value={form.rentalPartnerPayout[h] ?? ""}
                            onChange={(e) => setRentalField(h, "partnerPayout", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="ds-input text-right w-20"
                            placeholder={str(commonPkg?.includedKm) || String(h * 10)}
                            value={form.rentalIncludedKm[h] ?? ""}
                            onChange={(e) => setRentalField(h, "includedKm", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="ds-input text-right w-20"
                            placeholder={str(commonPkg?.extraKmRate) || "—"}
                            value={form.rentalExtraKm[h] ?? ""}
                            onChange={(e) => setRentalField(h, "extraKm", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="ds-input text-right w-20"
                            placeholder={str(commonPkg?.extraHourRate) || "—"}
                            value={form.rentalExtraHour[h] ?? ""}
                            onChange={(e) => setRentalField(h, "extraHour", e.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!showCng && (selectedService === "Multicity" || selectedService === "Round Trip") && (
          <div className="space-y-3">
            <FareGroup title="Customer price" hint="What the customer pays.">
              <RateField
                label="Price per km"
                unit="₹/km"
                value={form.customerRate}
                commonValue={commonRT?.customerRate}
                resolved={evalField("customerRate", commonRT?.customerRate)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("customerRate", v)}
                onClear={() => handleClearOverride("customerRate")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="customerRate"
              />
              <RateField
                label="Driver allowance"
                unit="₹/trip"
                value={form.customerBata}
                commonValue={commonRT?.customerBata}
                resolved={evalField("customerBata", commonRT?.customerBata)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("customerBata", v)}
                onClear={() => handleClearOverride("customerBata")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="customerBata"
                zeroAllowed
              />
              <RateField
                label="Minimum km per day"
                unit="km/day"
                value={form.minKmPerDay}
                commonValue={commonRT?.minKmPerDay}
                resolved={evalField("minKmPerDay", commonRT?.minKmPerDay)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("minKmPerDay", v)}
                onClear={() => handleClearOverride("minKmPerDay")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="minKmPerDay"
              />
              <RateField
                label="Extra km price"
                unit="₹/km"
                value={form.extraKmRate}
                commonValue={commonExtras?.extraKmRate ?? commonRT?.customerRate}
                resolved={evalField("extraKmRate", commonExtras?.extraKmRate ?? commonRT?.customerRate)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("extraKmRate", v)}
                onClear={() => handleClearOverride("extraKmRate")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="extraKmRate"
              />
            </FareGroup>
            <FareGroup title="Partner pay" hint="What the driver or fleet partner gets.">
              <RateField
                label="Partner pay per km"
                unit="₹/km"
                value={form.partnerRate}
                commonValue={commonRT?.partnerRate}
                resolved={evalField("partnerRate", commonRT?.partnerRate)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("partnerRate", v)}
                onClear={() => handleClearOverride("partnerRate")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="partnerRate"
              />
              <RateField
                label="Partner driver allowance"
                unit="₹/trip"
                value={form.partnerBata}
                commonValue={commonRT?.partnerBata}
                resolved={evalField("partnerBata", commonRT?.partnerBata)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("partnerBata", v)}
                onClear={() => handleClearOverride("partnerBata")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="partnerBata"
                zeroAllowed
              />
            </FareGroup>
            <FareGroup title="Extra charges" hint="Paid on top, only when they happen.">
              <RateField
                label="Waiting price"
                unit="₹/hour"
                value={form.waitingPerHour}
                commonValue={commonExtras?.waitingPerHour}
                resolved={evalField("waitingPerHour", commonExtras?.waitingPerHour)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("waitingPerHour", v)}
                onClear={() => handleClearOverride("waitingPerHour")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="waitingPerHour"
                zeroAllowed
              />
              <RateField
                label="Hill charge"
                unit="₹/trip"
                value={form.hillCharge}
                commonValue={commonExtraCharges?.customer?.hill}
                resolved={evalField("hillCharge", commonExtraCharges?.customer?.hill)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("hillCharge", v)}
                onClear={() => handleClearOverride("hillCharge")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="hillCharge"
                zeroAllowed
              />
              <RateField
                label="Roof carrier charge"
                unit="₹/trip"
                value={form.carrierCharge}
                commonValue={commonExtraCharges?.customer?.carrier}
                resolved={evalField("carrierCharge", commonExtraCharges?.customer?.carrier)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("carrierCharge", v)}
                onClear={() => handleClearOverride("carrierCharge")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="carrierCharge"
                zeroAllowed
              />
            </FareGroup>
          </div>
        )}
        {showCng && (
          <FareGroup title="CNG rate card" hint="Fill the first four rate boxes to offer CNG." defaultOpen>
            <p className="text-[12px] text-muted">
              Customers then choose CNG or Diesel on the vehicle card. Leave all boxes blank for no CNG option. The extra km price falls back to the CNG price per km.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <RateField
              label="CNG price per km"
              unit="₹/km"
              value={form.cngCustomerRate}
              commonValue={undefined}
              resolved={evalField("cngCustomerRate", undefined)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("cngCustomerRate", v)}
              onClear={() => handleClearOverride("cngCustomerRate")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="cngCustomerRate"
            />
            <RateField
              label="CNG driver allowance"
              unit="₹/trip"
              value={form.cngCustomerBata}
              commonValue={undefined}
              resolved={evalField("cngCustomerBata", undefined)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("cngCustomerBata", v)}
              onClear={() => handleClearOverride("cngCustomerBata")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="cngCustomerBata"
              zeroAllowed
            />
            <RateField
              label="CNG partner pay per km"
              unit="₹/km"
              value={form.cngPartnerRate}
              commonValue={undefined}
              resolved={evalField("cngPartnerRate", undefined)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("cngPartnerRate", v)}
              onClear={() => handleClearOverride("cngPartnerRate")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="cngPartnerRate"
            />
            <RateField
              label="CNG partner driver allowance"
              unit="₹/trip"
              value={form.cngPartnerBata}
              commonValue={undefined}
              resolved={evalField("cngPartnerBata", undefined)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("cngPartnerBata", v)}
              onClear={() => handleClearOverride("cngPartnerBata")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="cngPartnerBata"
              zeroAllowed
            />
            <RateField
              label="CNG extra km price"
              unit="₹/km"
              value={form.cngExtraKmRate}
              commonValue={undefined}
              resolved={evalField("cngExtraKmRate", undefined)}
              scopeBrand={selectedBrand}
              onChange={(v) => setField("cngExtraKmRate", v)}
              onClear={() => handleClearOverride("cngExtraKmRate")}
              tariff={t}
              service={selectedService}
              cls={selectedClass}
              fieldKey="cngExtraKmRate"
            />
            {selectedService === "Round Trip" && (
              <RateField
                label="CNG minimum km per day"
                unit="km"
                value={form.cngMinKmPerDay}
                commonValue={undefined}
                resolved={evalField("cngMinKmPerDay", undefined)}
                scopeBrand={selectedBrand}
                onChange={(v) => setField("cngMinKmPerDay", v)}
                onClear={() => handleClearOverride("cngMinKmPerDay")}
                tariff={t}
                service={selectedService}
                cls={selectedClass}
                fieldKey="cngMinKmPerDay"
              />
            )}
            </div>
          </FareGroup>
        )}
        <div id="fare-extra-settings">
          <FareGroup title="Advanced: waiting rules and partner extras" hint="Most people never need this." defaultOpen={false}>
          <p className="text-[12px] text-muted mb-3">Blank fields inherit the common settings. Waiting must have free minutes, a rounding interval, rounding scope and tax treatment configured before automatic approval.</p>
          <div className="ds-form-grid">
            {([
              ['partnerWaitingPerHour','Partner waiting payout','₹/hour',commonExtraCharges?.partner?.waitingPerHour],
              ['partnerHillCharge','Partner hill payout','₹/trip',commonExtraCharges?.partner?.hill],
              ['partnerCarrierCharge','Partner carrier payout','₹/trip',commonExtraCharges?.partner?.carrier],
              ['freeWaitingMinutes','Free waiting at each stop','minutes',t?.extraCharges?.freeWaitingMinutes],
              ['waitingRoundingMinutes','Waiting rounding interval','minutes',t?.extraCharges?.waitingRoundingMinutes],
            ] as const).map(([key,label,unit,baseline]) => <RateField key={key} label={label} unit={unit} value={form[key]} commonValue={baseline} resolved={evalField(key,baseline)} scopeBrand={selectedBrand} onChange={value => setField(key,value)} onClear={() => handleClearOverride(key)} tariff={t} service={selectedService} cls={selectedClass} fieldKey={key} zeroAllowed={key !== 'waitingRoundingMinutes'} />)}
            <label className="ds-field"><span>Waiting rounding scope</span><select className="ds-select" value={form.waitingRoundingScope} onChange={e => setField('waitingRoundingScope',e.target.value)}><option value="">Inherit common ({t?.brandOverrides?.common?.[selectedService]?.[selectedClass]?.waitingRoundingScope ?? t?.extraCharges?.waitingRoundingScope ?? 'not configured'})</option><option value="per_stop">Each stop separately</option><option value="combined">Combined chargeable waiting</option></select></label>
            <label className="ds-field"><span>Tax on extra charges</span><select className="ds-select" value={form.taxTreatment} onChange={e => setField('taxTreatment',e.target.value)}><option value="">Inherit common ({t?.brandOverrides?.common?.[selectedService]?.[selectedClass]?.taxTreatment ?? t?.extraCharges?.taxTreatment ?? 'not configured'})</option><option value="no_gst">No GST</option><option value="tariff_gst">Apply tariff GST</option></select></label>
          </div>
          </FareGroup>
        </div>
      </fieldset></section>

      {/* Save Confirmation Dialog */}
      {confirmSaveOpen && (
        <Modal
          title={`Confirm Changes for ${scopeSummary}`}
          onClose={() => setConfirmSaveOpen(false)}
          busy={busy}
        >
          <div className="space-y-4">
            <p className="text-[13px] text-muted">
              Review the exact scope and changes before updating the authoritative tariff.
            </p>

            <div className="p-3 bg-slate-50 border rounded text-[13px]">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted block text-[11px] font-bold">BRAND</span>
                  <strong>{selectedBrand === "common" ? "Common (Shared Baseline)" : BRAND_LABELS[selectedBrand]}</strong>
                </div>
                <div>
                  <span className="text-muted block text-[11px] font-bold">SERVICE</span>
                  <strong>{selectedService}</strong>
                </div>
                <div>
                  <span className="text-muted block text-[11px] font-bold">VEHICLE CATEGORY</span>
                  <strong>{CLASS_LABEL[selectedClass]}</strong>
                </div>
                <div>
                  <span className="text-muted block text-[11px] font-bold">TARIFF VERSION</span>
                  <strong>v{t?.version ?? 0} → v{(t?.version ?? 0) + 1}</strong>
                </div>
              </div>
            </div>

            {selectedBrand === "common" && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded text-[12px] text-blue-900">
                <Icon name="info" size={14} className="inline mr-1" />
                Updating the <strong>Common Baseline</strong> affects all brands that do not have explicit overrides.
              </div>
            )}

            <label className="ds-field">
              <span>Change Reason (Required for audit history, min 5 chars)</span>
              <input
                type="text"
                className="ds-input"
                placeholder="e.g. Seasonal diesel price adjustment for People Taxi sedan drops"
                value={saveReason}
                onChange={(e) => setSaveReason(e.target.value)}
              />
            </label>

            {saveError && (
              <div className="ds-error" role="alert">
                <Icon name="circle-alert" /> {saveError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setConfirmSaveOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={executeSave}
                disabled={busy || !!loadError || saveReason.trim().length < 5}
              >
                {busy ? "Saving Tariff..." : "Confirm & Save"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** A titled, collapsible group of related fields, so the page reads as a few short sections instead of one long wall of boxes. */
function FareGroup({ title, hint, children, defaultOpen = true }: { title: string; hint: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="ds-fare-group" open={defaultOpen}>
      <summary>
        <strong>{title}</strong>
        <span>{hint}</span>
      </summary>
      <div className="ds-fare-group__body">{children}</div>
    </details>
  );
}

/** Reusable individual rate field with explicit source badges and inheritance tracking */
function RateField({
  label,
  unit,
  value,
  commonValue,
  resolved,
  scopeBrand,
  onChange,
  onClear,
  tariff,
  service,
  cls,
  fieldKey,
  zeroAllowed,
}: {
  label: string;
  unit: string;
  value: string;
  commonValue: number | undefined;
  resolved: RateValue;
  scopeBrand: ScopeBrand;
  onChange: (v: string) => void;
  onClear: () => void;
  tariff: Tariff | null | undefined;
  service: WorkspaceService;
  cls: TariffClass;
  fieldKey: keyof BrandFareOverride;
  zeroAllowed?: boolean;
}) {
  const isOverridden = scopeBrand !== "common" && value.trim() !== "";
  const inherits = getInheritingBrands(tariff, service, cls, fieldKey);

  return (
    <div data-rate-field={fieldKey} className="ds-field p-2.5 border border-line rounded-lg bg-white">
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[12px] font-bold text-ink">{label}</span>
        <span className="text-[11px] text-muted">{unit}</span>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="number"
          className="ds-input flex-1 font-semibold"
          placeholder={resolved.value !== undefined ? String(resolved.value) : "Not configured"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {scopeBrand !== "common" && isOverridden && (
          <Button size="sm" variant="ghost" title="Revert to common baseline" onClick={onClear}>
            <Icon name="rotate-ccw" size={13} />
          </Button>
        )}
      </div>

      <p className="mt-1 text-[11px] leading-tight text-muted">
        {scopeBrand === "common"
          ? inherits.overridden.length > 0
            ? `${inherits.overridden.length} brand${inherits.overridden.length === 1 ? "" : "s"} use their own price`
            : "Used by all brands"
          : isOverridden
            ? `Own price for this brand: ${inr(Number(value))}`
            : `Using the common price: ${resolved.value !== undefined ? inr(resolved.value) : "not set"}`}
      </p>
    </div>
  );
}

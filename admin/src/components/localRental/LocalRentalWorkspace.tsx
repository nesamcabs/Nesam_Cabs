import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MasterLocation } from "../../types";
import { EMPTY_SEL, breadcrumbOf, indexLocations, stateNameOf, type LocSel } from "../../domain/locationHierarchy";
import { districtOfPinLoaded } from "../../domain/pincodes";
import { subscribeGeoFares, subscribePeakRules, type GeoFareDoc, type GeoService, type PeakRule } from "../../services/geoFareService";
import type { ServiceRule } from "../../services/serviceRulesService";
import { BRAND_LABELS, useTariff } from "../../services/tariffService";
import type { VehicleCol } from "../RateTable";
import LocationScopeSelector from "../location/LocationScopeSelector";
import { PickupDropMatrix } from "../LocalFares";
import { Button } from "../ui";
import AreasCoverage from "./AreasCoverage";
import LocalFareRates from "./LocalFareRates";
import LocalRouteCharges from "./LocalRouteCharges";
import PeakHours from "./PeakHours";
import RentalFareRates from "./RentalFareRates";
import { Collapsible, Hint, LoadFailure, Seg } from "./ui";
import type { FeedStatus } from "../../hooks/useLocationsFeed";

type WsTab = "rates" | "coverage" | "peak";

/**
 * Local & Rental Pricing inside Service & Fare Settings. Brand and Service come from the page's existing "Applies to" controls
 * (Pickup & Drop = Local, Hourly Rental = Rental); this workspace adds the shared location selector and three tabs:
 *   Fare rates (district default / zone / area overrides) · Areas & coverage (the Places & cabs records) · Peak hours.
 * Everything shown is read from saved data and saved through the server; nothing here is sample data.
 */
export default function LocalRentalWorkspace({ brand, service, vehicles, locations, locationsStatus, rules, rulesLoaded, rulesError, onRetryRules, canEdit, canEditLocations, onToast, onManageLocations, onDirty, extras, standardPackages }: {
  brand: string; service: GeoService; vehicles: VehicleCol[]; locations: MasterLocation[]; locationsStatus: FeedStatus; rules: ServiceRule[]; rulesLoaded: boolean;
  rulesError: string | null; onRetryRules: () => void;
  canEdit: boolean; canEditLocations: boolean; onToast: (t: string) => void; onManageLocations: () => void; onDirty: (dirty: boolean) => void;
  /** The existing shared settings shown in the collapsible sections (night allowance, GST link, display price, adjustments). */
  extras: { taxes: ReactNode; display: ReactNode };
  /** Rental: the existing standard package table (all locations), the broadest default. */
  standardPackages?: ReactNode;
}) {
  const [tab, setTab] = useState<WsTab>("rates");
  const [sel, setSel] = useState<LocSel>(EMPTY_SEL);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  // Location rates (geo_fares) and peak rules: loading → ready | failed (denied or other), never a failure shown as "nothing saved".
  // A different brand or service is a different read: the old listener is closed, its late answers are ignored (`live`), and
  // nothing from the previous brand / service is shown meanwhile.
  const [docs, setDocs] = useState<Map<string, GeoFareDoc> | null>(null);
  const [docsFail, setDocsFail] = useState<{ denied: boolean; error: string | null } | null>(null);
  const [docsAttempt, setDocsAttempt] = useState(0);
  const [peak, setPeak] = useState<PeakRule[] | null>(null);
  const [peakFail, setPeakFail] = useState<{ denied: boolean; error: string | null } | null>(null);
  const [peakAttempt, setPeakAttempt] = useState(0);
  const { tariff, error: tariffError, retry: retryTariff } = useTariff();
  useEffect(() => {
    let live = true;
    setDocs(null); setDocsFail(null);
    const unsub = subscribeGeoFares(brand, service, (m) => { if (live) { setDocs(m); setDocsFail(null); } }, (f) => { if (live) { setDocs(null); setDocsFail({ denied: f.code === "permission-denied", error: f.message }); } });
    return () => { live = false; unsub(); };
  }, [brand, service, docsAttempt]);
  useEffect(() => {
    let live = true;
    setPeak(null); setPeakFail(null);
    const unsub = subscribePeakRules(service, (r) => { if (live) { setPeak(r); setPeakFail(null); } }, (f) => { if (live) { setPeak(null); setPeakFail({ denied: f.code === "permission-denied", error: f.message }); } });
    return () => { live = false; unsub(); };
  }, [service, peakAttempt]);
  const docsFeed: FeedStatus = { loading: !docs && !docsFail, error: docsFail?.error ?? null, denied: !!docsFail?.denied, onRetry: () => setDocsAttempt((n) => n + 1) };
  useEffect(() => { setBulkIds([]); }, [sel.state, sel.district, brand, service]);

  const index = useMemo(() => indexLocations(locations, districtOfPinLoaded), [locations, sel.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const brandName = brand === "common" ? "All brands" : BRAND_LABELS[brand as keyof typeof BRAND_LABELS] ?? brand;
  const serviceText = service === "local" ? "Pickup & Drop" : "Hourly Rental";
  const scopeText = (target: string) => `${brandName} · ${serviceText} · ${target}`;
  const crumbs = breadcrumbOf(sel, index, { state: "All locations", zone: "All zones", area: "All mapped areas" });
  const placeLabel = sel.state ? crumbs.filter((c) => !c.startsWith("All ")).slice(-1)[0] ?? stateNameOf(sel.state) : "All locations";
  const nameOf = (id: string) => index.find((x) => x.loc.id === id)?.loc.name;
  const labelOfKey = (key: string, saved?: string) => saved || (key === "all" ? "All locations" : key.startsWith("s_") ? stateNameOf(key.slice(2))
    : key.startsWith("z_") ? `${nameOf(key.slice(2)) ?? "Unknown"} zone` : key.startsWith("a_") ? nameOf(key.slice(2)) ?? "Unknown location"
    : key.startsWith("d_") ? `${key.split("_").slice(2).join(" ").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} district` : key);
  const fareService = service === "local" ? "One Way" : "Local Rental";

  // Earlier per-km city / zone fares (tariff localPickupDrop) stay editable for the City or zone chosen above: the server still uses
  // them where no location-scoped Local rates are complete.
  const legacyPlace = service === "local" ? locations.find((l) => l.id === (sel.locationId || sel.zoneId) && (l.type === "City" || (l.type === "Area / Locality" && (l.pincodes?.length ?? 0) > 0))) : undefined;
  const legacyCity = legacyPlace && legacyPlace.type !== "City" ? locations.find((l) => l.id === legacyPlace.parentLocationId && l.type === "City") : undefined;
  const hasLegacy = !!legacyPlace && !!tariff?.localPickupDrop?.[legacyPlace.id];

  const onEditRates = (ids: string[]) => { setBulkIds(ids); setTab("rates"); };
  const common = { brand, scopeText, docs, feed: docsFeed, sel, index, bulkIds, vehicles, canEdit, onToast, onDirty };
  const shared = (
    <>
      {service === "local" && <LocalRouteCharges brand={brand} docs={docs} feed={docsFeed} locationsStatus={locationsStatus} sel={sel} index={index} canEdit={canEdit} onToast={onToast} />}
      {legacyPlace && (
        <Collapsible title={`Earlier per-km fares · ${legacyPlace.name}${hasLegacy ? "" : " (none saved)"}`} icon="route">
          <Hint>Saved before location-based rates. They still price trips inside {legacyPlace.name} until the location rates above are complete for both the customer and the partner.</Hint>
          <PickupDropMatrix key={legacyPlace.id} place={legacyPlace} cityName={legacyCity?.name ?? legacyPlace.name} cityFares={legacyCity ? tariff?.localPickupDrop?.[legacyCity.id]?.classes : undefined} vehicles={vehicles} canEdit={canEdit} onToast={onToast} />
        </Collapsible>
      )}
      {standardPackages && <Collapsible title="Standard packages · all locations" icon="calculator">{standardPackages}</Collapsible>}
      <Collapsible title={service === "local" ? "Existing taxes & night allowance" : "Additional charges & night allowance"} icon="receipt">{extras.taxes}</Collapsible>
      <Collapsible title="Price display & adjustments" icon="sliders-horizontal">{extras.display}</Collapsible>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[24px] font-bold leading-tight text-slate-900">Local &amp; Rental Pricing</h2>
          <p className="text-[14px] text-slate-600">Service &amp; Fare Settings</p>
        </div>
        <Button icon="map-pin" className="!border-[#b91c1c] !text-[#b91c1c]" onClick={onManageLocations}>Manage locations</Button>
      </div>
      <Seg label="Local and rental pricing" value={tab} onChange={setTab} options={[{ id: "rates", label: "Fare rates" }, { id: "coverage", label: "Areas & coverage" }, { id: "peak", label: "Peak hours" }]} />
      <LocationScopeSelector breadcrumb value={sel} onChange={setSel} locations={locations} status={locationsStatus} depth="area" pinSearch="locate" onManageLocations={onManageLocations}
        broad={{ state: "All locations", district: tab === "peak" ? "Whole state" : undefined, zone: tab === "coverage" ? undefined : "All zones", area: "All mapped areas" }} label="Pricing location" />
      {tab === "rates" && service === "rental" && tariffError && <LoadFailure what="Standard rental packages" failure={{ denied: /permission/i.test(tariffError), error: tariffError }} onRetry={retryTariff} />}

      {tab === "rates" && (service === "local"
        ? <LocalFareRates {...common}>{shared}</LocalFareRates>
        : <RentalFareRates {...common}>{shared}</RentalFareRates>)}
      {tab === "coverage" && (
        <AreasCoverage brand={brand} service={service} fareService={fareService} rules={rules} rulesLoaded={rulesLoaded} rulesError={rulesError} onRetryRules={onRetryRules} docs={docs} feed={docsFeed} locationsStatus={locationsStatus} sel={sel} onSel={setSel} index={index} locations={locations}
          vehicles={vehicles} canEdit={canEdit} canEditLocations={canEditLocations} onToast={onToast} onEditRates={onEditRates} onManageLocations={onManageLocations} scopeText={scopeText} />
      )}
      {tab === "peak" && (
        <PeakHours brand={brand} service={service} serviceText={serviceText} sel={sel} rules={peak} rulesFail={peakFail} onRetryRules={() => setPeakAttempt((n) => n + 1)} canEdit={canEdit} onToast={onToast}
          scopeText={scopeText} placeLabel={placeLabel} labelOfKey={labelOfKey} />
      )}
    </div>
  );
}

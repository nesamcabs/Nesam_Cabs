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
import { Collapsible, Hint, Seg } from "./ui";

type WsTab = "rates" | "coverage" | "peak";

/**
 * Local & Rental Pricing inside Service & Fare Settings. Brand and Service come from the page's existing "Applies to" controls
 * (Pickup & Drop = Local, Hourly Rental = Rental); this workspace adds the shared location selector and three tabs:
 *   Fare rates (district default / zone / area overrides) · Areas & coverage (the Places & cabs records) · Peak hours.
 * Everything shown is read from saved data and saved through the server; nothing here is sample data.
 */
export default function LocalRentalWorkspace({ brand, service, vehicles, locations, rules, rulesLoaded, canEdit, canEditLocations, onToast, onManageLocations, onDirty, extras, standardPackages }: {
  brand: string; service: GeoService; vehicles: VehicleCol[]; locations: MasterLocation[]; rules: ServiceRule[]; rulesLoaded: boolean;
  canEdit: boolean; canEditLocations: boolean; onToast: (t: string) => void; onManageLocations: () => void; onDirty: (dirty: boolean) => void;
  /** The existing shared settings shown in the collapsible sections (night allowance, GST link, display price, adjustments). */
  extras: { taxes: ReactNode; display: ReactNode };
  /** Rental: the existing standard package table (all locations), the broadest default. */
  standardPackages?: ReactNode;
}) {
  const [tab, setTab] = useState<WsTab>("rates");
  const [sel, setSel] = useState<LocSel>(EMPTY_SEL);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [docs, setDocs] = useState<Map<string, GeoFareDoc> | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [peak, setPeak] = useState<PeakRule[] | null>(null);
  const [peakError, setPeakError] = useState<string | null>(null);
  const { tariff } = useTariff();
  // A different brand or service is a different set of rates: clear first, so the previous one's values never show under the new one.
  useEffect(() => {
    setDocs(null); setDocsError(null);
    return subscribeGeoFares(brand, service, (m) => { setDocs(m); setDocsError(null); }, setDocsError);
  }, [brand, service]);
  useEffect(() => { setPeak(null); setPeakError(null); return subscribePeakRules(service, (r) => { setPeak(r); setPeakError(null); }, setPeakError); }, [service]);
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
  const common = { brand, scopeText, docs, sel, index, bulkIds, vehicles, canEdit, onToast, onDirty };
  const shared = (
    <>
      {service === "local" && <LocalRouteCharges brand={brand} docs={docs} sel={sel} index={index} canEdit={canEdit} onToast={onToast} />}
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
      <LocationScopeSelector breadcrumb value={sel} onChange={setSel} locations={locations} depth="area" pinSearch="locate" onManageLocations={onManageLocations}
        broad={{ state: "All locations", district: tab === "peak" ? "Whole state" : undefined, zone: tab === "coverage" ? undefined : "All zones", area: "All mapped areas" }} label="Pricing location" />
      {docsError && <p className="ds-error" role="alert">Saved location rates could not be loaded: {docsError}. Check your pricing access and reload.</p>}

      {tab === "rates" && (service === "local"
        ? <LocalFareRates {...common}>{shared}</LocalFareRates>
        : <RentalFareRates {...common}>{shared}</RentalFareRates>)}
      {tab === "coverage" && (
        <AreasCoverage brand={brand} service={service} fareService={fareService} rules={rules} rulesLoaded={rulesLoaded} docs={docs} sel={sel} onSel={setSel} index={index} locations={locations}
          vehicles={vehicles} canEdit={canEdit} canEditLocations={canEditLocations} onToast={onToast} onEditRates={onEditRates} onManageLocations={onManageLocations} scopeText={scopeText} />
      )}
      {tab === "peak" && (
        <PeakHours brand={brand} service={service} serviceText={serviceText} sel={sel} rules={peak} rulesError={peakError} canEdit={canEdit} onToast={onToast}
          scopeText={scopeText} placeLabel={placeLabel} labelOfKey={labelOfKey} />
      )}
    </div>
  );
}

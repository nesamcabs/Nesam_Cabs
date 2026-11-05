import DateTime12Input from "../components/DateTime12Input";
import FareGstSettings from '../components/FareGstSettings';
import FareAdjustmentCard from '../components/FareAdjustmentCard';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { MasterLocation, TravelService, VehicleCategory } from "../types";
import { subscribeLocations, subscribeServices, subscribeVehicleCategories } from "../services/adminFirestoreService";
import {
  adjText, inScope, isoToIstInput, istInputToIso, phaseOf, rankRules, saveRule, setRuleStatus, subscribeServiceRules, summary,
  type Adjustment, type RuleKind, type ServiceRule, type Side,
} from "../services/serviceRulesService";
import { useCan, useCanDo } from "../components/AccessContext";
import { InlineModals, Modal, Toast, useToast } from "../components/Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, PageHeader, toneForStatus } from "../components/ui";
import { StageBar } from "../components/ui/ListKit";
import type { IconName } from "../components/ui/Icon";
import MenuButton from "../components/ui/MenuButton";
import FixedRouteFares from "../components/FixedRouteFares";
import LocalFares from "../components/LocalFares";
import "./pricingReference.css";
import VehicleCategoriesPage from "./VehicleCategories";
import BrandServiceFareWorkspace from "../components/BrandServiceFareWorkspace";
import { registerFareWorkspaceGuard } from "../services/fareWorkspaceGuard";
import { BRANDS, BRAND_LABELS, BRAND_SUPPORTED_SERVICES, CLASS_LABEL, TARIFF_CLASSES, WORKSPACE_SERVICES, type FareWorkspaceScope, type TariffClass } from "../services/tariffService";
import { EstimateList, TripFields, emptyTrip, estimateAll, useQuickData, validateTrip, type CategoryEstimate, type QuickTrip } from "../components/booking/QuickFare";
import { GST_STATES } from "../domain/gstStates";
import { directoryCities, directoryZones } from "../domain/placeDirectory";
import DisplayMarkupCard from "../components/DisplayMarkupCard";
import { refDateTime } from "../domain/officeStage";

type Tab = "Brand & service fares" | "Booking availability" | "Cab types" | "Pricing rules" | "More settings" | "GST calculation" | "Service areas";
const MAIN_TABS = [
  { id: "Booking availability", label: "Booking availability", icon: "toggle-right" },
  { id: "Cab types", label: "Cab types", icon: "car-front" },
  { id: "Pricing rules", label: "Pricing rules", icon: "indian-rupee" },
] as const;
type Sel = { state: string; city: string; area: string };
const locationKey = (value: string) => value.trim().toLocaleLowerCase();
const stateKey = (value: string) => {
  const key = locationKey(value);
  return GST_STATES.find(([code, name]) => code === key || locationKey(name) === key)?.[0] ?? key;
};
const locationOptions = (values: string[]) => [...new Map(values.map(value => value.trim()).filter(Boolean).map(value => [locationKey(value), value])).values()].sort((a, b) => a.localeCompare(b));

/** Admin scope includes inactive places too, so their availability can be configured. */
function pricingLocations(locations: MasterLocation[]) {
  const byId = new Map(locations.map(location => [location.id, location]));
  return locations.map(location => {
    let state = location.state?.trim() || "";
    let city = location.city?.trim() || (location.type === "City" ? location.name.trim() : "");
    const seen = new Set([location.id]);
    let parent = byId.get(location.parentLocationId || "");
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      state ||= parent.state?.trim() || "";
      city ||= parent.city?.trim() || (parent.type === "City" ? parent.name.trim() : "");
      parent = byId.get(parent.parentLocationId || "");
    }
    return { state, city, area: location.area?.trim() || (location.type !== "City" ? location.name.trim() : "") };
  });
}
const STATUS_FILTERS = ["All", "Active", "Scheduled", "Ended", "Disabled", "Removed"] as const;

/** Tamil helper line under an English heading (reference bilingual headings). */
const Ta = ({ children }: { children: ReactNode }) => <span className="block text-[12px] text-muted" lang="ta">{children}</span>;

/** What the page shows, kept by the app while the Pricing & Fare Management page is open so Back can put it back. */
/** Inside Cab types: the customer-visibility rules, or the master Vehicle Categories management. */
export type CabSection = "Customer cab rules" | "Vehicle categories";
export type PricingView = { tab: Tab; sel: Sel; filter: (typeof STATUS_FILTERS)[number]; scrollY: number; fareScope?: FareWorkspaceScope; fareClass?: TariffClass; cabSection?: CabSection };
/** Where the older Vehicle Categories entry points land: Service & Fare Settings → Cab types → Vehicle categories. */
export const CATEGORIES_VIEW: PricingView = { tab: "Cab types", sel: { state: "", city: "", area: "" }, filter: "All", scrollY: 0, cabSection: "Vehicle categories", fareScope: { brand: "common", service: "One Way" } };
/** Where Back lands when there is no earlier context: the main fare settings with no location chosen. */
export const MORE_SETTINGS_VIEW: PricingView = { tab: "Brand & service fares", sel: { state: "", city: "", area: "" }, filter: "All", scrollY: 0 };

/** Master Admin "Service & Fare Settings": location-scoped availability, cab types and pricing. */
export default function Pricing({ onNavigate, restore, onRestored, onOpenFareRules, onOpenExtraCharges }: {
  onNavigate: (page: string, tab?: string) => void;
  restore: PricingView | null;
  onRestored: () => void;
  onOpenFareRules: (view: PricingView) => void;
  onOpenExtraCharges: (view: PricingView) => void;
}) {
  const [fareScope, setFareScope] = useState<FareWorkspaceScope>(restore?.fareScope ?? { brand: "nesam", service: "One Way" });
  // Which vehicles the base rates are for: Diesel / Petrol (the normal rates) or CNG (its own rate card, One Way and Round Trip).
  const [fareFuel, setFareFuel] = useState<"petrol" | "cng">("petrol");
  const fuelApplies = fareScope.service === "One Way" || fareScope.service === "Round Trip";
  const changeFuel = (next: "petrol" | "cng") => {
    // The Diesel / Petrol and CNG boxes share one form, so edits made on one are kept when switching and saved together.
    if (workspaceBusy.current || next === fareFuel) return;
    setFareFuel(next);
  };
  const [fareClass, setFareClass] = useState<TariffClass>(restore?.fareClass ?? "sedan");
  const [focusExtras, setFocusExtras] = useState(false);
  const gstDirty = useRef(false), gstBusy = useRef(false);
  const workspaceDirty = useRef(false);
  const workspaceBusy = useRef(false);
  useEffect(() => registerFareWorkspaceGuard(() => !workspaceBusy.current && !gstBusy.current && (!(workspaceDirty.current || gstDirty.current) || window.confirm("Discard your unsaved fare changes before leaving?"))), []);
  const [tab, setTab] = useState<Tab>(restore?.tab && restore.tab !== "More settings" ? restore.tab : "Brand & service fares");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now);
  const [cabSection, setCabSection] = useState<CabSection>(restore?.cabSection ?? "Customer cab rules");
  const [sel, setSel] = useState<Sel>(restore?.sel ?? { state: "", city: "", area: "" });
  const [rules, setRules] = useState<ServiceRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [services, setServices] = useState<TravelService[]>([]);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>(restore?.filter ?? "All");
  const [sheet, setSheet] = useState<{ kind: "new"; ruleKind: RuleKind } | { kind: "edit" | "preview" | "status"; rule: ServiceRule; to?: "Enabled" | "Disabled" | "Removed" } | { kind: "history" | "test" | "fixed" | "limits" | "all" | "local" } | null>(null);
  // These tool views open in the page itself; only add / edit / preview / status forms slide in as a side panel.
  const inlineKind = sheet && (["local", "fixed", "limits", "all", "history"] as string[]).includes(sheet.kind) ? sheet.kind : null;
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const canTest = useCan("operations");
  const canViewBusiness = useCanDo("Business accounts", "view");
  const contentAccess = useCan("content");
  const settingsView = useCanDo("Settings", "view");
  const canViewLocations = contentAccess && settingsView;
  const { toast, show } = useToast(6000);
  const scopeLabel = (fareScope.brand === "common" ? "Common — all brands" : BRAND_LABELS[fareScope.brand]) + " → " + fareScope.service;
  const scopeBrand = fareScope.brand === "common" ? "" : fareScope.brand;
  const availableServices = fareScope.brand === "common" ? WORKSPACE_SERVICES : BRAND_SUPPORTED_SERVICES[fareScope.brand];
  const changeScope = (next: FareWorkspaceScope) => {
    if (workspaceBusy.current || gstBusy.current || (sheet && !inlineKind) || (next.brand === fareScope.brand && next.service === fareScope.service)) return;
    if ((workspaceDirty.current || gstDirty.current) && !window.confirm("Discard the unsaved rates in " + scopeLabel + "?")) return;
    setFareScope(next);
  };
  const changeClass = (next: TariffClass) => {
    if (workspaceBusy.current || next === fareClass) return;
    if (workspaceDirty.current && !window.confirm("Discard the unsaved rates in " + scopeLabel + " → " + CLASS_LABEL[fareClass] + "?")) return;
    setFareClass(next);
  };
  const changeTab = (target: Tab) => {
    if (inlineKind) setSheet(null); // leaving an in-page tool view goes back to the page the menu item points at
    const next: Tab = target === "More settings" ? "Brand & service fares" : target; // the old "More settings" tab is gone: its tools are on the page itself
    if (next === tab || workspaceBusy.current || gstBusy.current) return;
    if ((workspaceDirty.current || gstDirty.current) && !window.confirm("Discard your unsaved fare changes before switching settings?")) return;
    workspaceDirty.current = false;
    gstDirty.current = false;
    setTab(next);
    setQuery("");
    setFilter("All");
  };
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!focusExtras || tab !== "Brand & service fares") return;
    const frame = window.requestAnimationFrame(() => {
      const field = document.querySelector<HTMLElement>('[data-rate-field="waitingPerHour"], [data-rate-field="hillCharge"], #fare-extra-settings');
      field?.scrollIntoView({ block: "center" });
      field?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      setFocusExtras(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusExtras, tab]);
  const inFareScope = (r: ServiceRule) => (!r.brand || r.brand === scopeBrand) && (!r.fareService || r.fareService === fareScope.service)
    && (r.fareService || !r.service || r.service.toLowerCase() === "all" || fareScope.service.toLowerCase().includes(r.service.toLowerCase())
      || (fareScope.service === "One Way" && ["multicity", "outstation", "local", "local pickup & drop"].includes(r.service.toLowerCase())));
  const ownsRule = (r: ServiceRule) => (r.brand ?? "") === scopeBrand && (r.fareService === fareScope.service || (fareScope.brand === "common" && !r.fareService));
  const canEditRule = (r: ServiceRule) => canEdit && ownsRule(r);
  // Coming back from a tool page: the saved view is used once, then the scroll position is put back.
  useEffect(() => {
    if (!restore) return;
    onRestored();
    window.scrollTo(0, restore.scrollY);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const u = [subscribeServiceRules((r) => { setRules(r); setLoaded(true); setLoadError(null); }, (m) => { setLoadError(m); setLoaded(true); }), subscribeLocations((rows) => { setLocations(rows); setLocationsLoaded(true); setLocationError(null); }, (message) => { setLocationError(message); setLocationsLoaded(true); }), subscribeVehicleCategories(setCategories), subscribeServices(setServices)];
    return () => u.forEach((x) => x());
  }, []);

  const stateName = (code: string) => GST_STATES.find(([c]) => c === code)?.[1] ?? code;
  const locationRows = useMemo(() => pricingLocations(locations), [locations]);
  const inState = (location: { state: string }) => !sel.state || stateKey(location.state) === stateKey(sel.state);
  // The built-in cities and zones, plus whatever is saved under Locations.
  const cities = locationOptions([...directoryCities(stateKey(sel.state)), ...locationRows.filter(inState).map(location => location.city)]);
  const areas = locationOptions([...directoryZones(sel.city), ...locationRows.filter(location => inState(location) && (!sel.city || locationKey(location.city) === locationKey(sel.city))).map(location => location.area)]);
  const otherStates = locationOptions(locationRows.map(location => location.state).filter(state => state && !GST_STATES.some(([code]) => code === stateKey(state))));
  const scoped = rules.filter(inFareScope).filter((r) => r.status !== "Removed" || filter === "Removed").filter((r) => inScope(r, sel));
  const byKind = (k: RuleKind) => scoped.filter((r) => r.kind === k).filter((r) => filter === "All" ? r.status !== "Removed" : phaseOf(r, now) === filter)
    .filter(r => !query.trim() || [r.name, r.service, r.reason, r.scope.state, r.scope.city, r.scope.area, summary(r)].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const activeOf = (k: RuleKind) => rankRules(scoped.filter((r) => r.kind === k && phaseOf(r, now) === "Active"));
  const where = sel.area || sel.city || (sel.state ? stateName(sel.state) : "All locations");
  const catNames = categories.filter((c) => c.status === "Active").map((c) => c.name);
  const savedView = (): PricingView => ({ tab, sel, filter, scrollY: window.scrollY, fareScope, fareClass, cabSection });
  const availabilityValues = [...new Set(activeOf("availability").map(r => r.availability || "Available"))];
  const cabSets = [...new Set(activeOf("categories").map(r => [...(r.categories || [])].sort().join(", ")))];
  const sourceLabel = (r: ServiceRule) => {
    const inheritedPlace = (sel.area && !r.scope.area) || (sel.city && !r.scope.city) || (sel.state && !r.scope.state);
    return !ownsRule(r) ? "Inherited from Common" : inheritedPlace ? `Applies from ${r.scope.area || r.scope.city || (r.scope.state ? stateName(r.scope.state) : "All service areas")}` : "Set for this location";
  };

  const ruleTable = (list: ServiceRule[]) => !loaded ? <p className="text-[12px] text-muted py-4" role="status">Loading saved settings…</p> : list.length === 0 ? null : (
    <DataTable label="Rules" minWidth={980} fixed hasActions>
      <thead><tr><th>SETTING</th><th>APPLIES TO</th><th>VALUE</th><th>PICKUP SCHEDULE</th><th>STATUS</th><th className="ds-actions">ACTIONS</th></tr></thead>
      <tbody>{list.map((r) => (
        <tr key={r.id}>
          <td><strong>{r.name}</strong><small>{r.brand ? BRAND_LABELS[r.brand as keyof typeof BRAND_LABELS] : "Common — all brands"} · {r.fareService || r.service || "All services"} · Priority {r.priority}</small><span className="u28-origin">{sourceLabel(r)}</span></td>
          <td><strong>{r.scope.area ? "Area-specific rule" : r.scope.city ? "City rule" : r.scope.state ? "State rule" : "All locations"}</strong><small>{[r.scope.area, r.scope.city, r.scope.state && stateName(r.scope.state)].filter(Boolean).join(", ") || "Everywhere"} · {r.scope.side}</small></td>
          <td>{summary(r)}</td>
          <td>{r.schedule.mode === "Always" ? "Always" : `${r.schedule.from ? refDateTime(new Date(r.schedule.from)) : "Now"} → ${r.schedule.to ? refDateTime(new Date(r.schedule.to)) : "Open"}`}</td>
          <td>
            <label className="flex items-center gap-2 text-[12px]">
              <button type="button" role="switch" aria-checked={r.status === "Enabled"} aria-label={`${r.status === "Enabled" ? "Disable" : "Enable"} ${r.name}`}
                disabled={!canEditRule(r) || r.status === "Removed"}
                onClick={() => setSheet({ kind: "status", rule: r, to: r.status === "Enabled" ? "Disabled" : "Enabled" })}
                className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50" style={{ background: r.status === "Enabled" ? "var(--color-brand)" : "#cfd6df" }}>
                <span className="inline-block h-5 w-5 rounded-full bg-white shadow transition" style={{ transform: `translateX(${r.status === "Enabled" ? 22 : 2}px)` }} />
              </button>
              {r.status === "Removed" ? "Removed" : r.status === "Enabled" ? "Enabled" : "Disabled"}
            </label>
          </td>
          <td className="ds-actions"><div>
            {canEditRule(r) && r.status !== "Removed" && <Button size="sm" onClick={() => setSheet({ kind: "edit", rule: r })}>Edit</Button>}
            <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "preview", rule: r })}>Preview</Button>
            {canEditRule(r) && r.status !== "Removed" && <MenuButton iconOnly label={`More actions for ${r.name}`} items={[
              r.status === "Enabled" ? { label: "Disable rule", icon: "ban", onSelect: () => setSheet({ kind: "status", rule: r, to: "Disabled" }) } : { label: "Enable rule", icon: "circle-check", onSelect: () => setSheet({ kind: "status", rule: r, to: "Enabled" }) },
              { label: "Remove rule", icon: "trash-2", danger: true, onSelect: () => setSheet({ kind: "status", rule: r, to: "Removed" }) },
            ]} />}
          </div></td>
        </tr>
      ))}</tbody>
    </DataTable>
  );

  const tools: { key: string; name: string; description: string; scope: string; icon: IconName; go: () => void; disabledReason?: string }[] = [
    { key: "base", name: "Base rates", description: "Regular ₹/km, driver bata and partner payout.", scope: scopeLabel, icon: "calculator", go: () => changeTab("Brand & service fares") },
    { key: "local", name: "Local fares", description: "Rental packages and Local Pickup & Drop.", scope: "City-wise · brand rental packages / shared city fares", icon: "map-pin", go: () => setSheet({ kind: "local" }) },
    { key: "extra", name: "Extra charges", description: "Waiting, hills, carrier and other add-ons.", scope: scopeLabel, icon: "receipt-text", go: () => { setFocusExtras(true); changeTab("Brand & service fares"); } },
    { key: "fixed", name: "Fixed route fares", description: "Set an agreed fare for a specific route.", scope: "Route-wise · " + scopeLabel, icon: "route", go: () => setSheet({ kind: "fixed" }), disabledReason: fareScope.service !== "One Way" ? "Fixed route fares are configured for One Way. Select One Way above." : undefined },
    { key: "b2b", name: "Business contracts", description: "Company rates, credit terms and contracts.", scope: "Business account", icon: "building-2", go: () => onNavigate("business"), disabledReason: canViewBusiness ? undefined : "Business accounts view permission is required." },
    { key: "boundaries", name: "Service boundaries", description: "Define verified cities, areas and service zones.", scope: "Service areas", icon: "map-pinned", go: () => onNavigate("locations"), disabledReason: canViewLocations ? undefined : "Locations view permission is required." },
    { key: "limits", name: "Fare limits", description: "Review approved minimum and maximum amounts.", scope: scopeLabel, icon: "shield-check", go: () => setSheet({ kind: "limits" }) },
    { key: "rules", name: "All rules & schedules", description: "Find rules across locations and pickup schedules.", scope: scopeLabel, icon: "calendar-clock", go: () => setSheet({ kind: "all" }) },
    { key: "tax", name: "Tax settings", description: "Review tax classification and invoice settings.", scope: scopeLabel, icon: "files", go: () => changeTab("GST calculation") },
  ];

  // Only rule-based views consume this selection. Route tools and the shared catalog do not.
  const locationFilter = (
    <section className="u27-location-bar">
      <div><span className="dx-eyebrow">LOCATION</span><h2>Which location are you managing?</h2><p lang="ta">எந்த இடத்திற்கான setting?</p></div>
      <div className="ds-filterbar">
        <label className="ds-field"><span>State</span><select className="ds-select" value={sel.state} onChange={(e) => setSel({ state: e.target.value, city: "", area: "" })}><option value="">All states</option>{GST_STATES.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}{otherStates.map(state => <option key={state} value={state}>{state}</option>)}</select></label>
        <label className="ds-field"><span>City</span><select className="ds-select" value={sel.city} disabled={locationsLoaded && !cities.length} onChange={(e) => setSel({ ...sel, city: e.target.value, area: "" })}><option value="">{locationsLoaded && !cities.length ? "No cities listed for this state" : "All cities"}</option>{cities.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="ds-field"><span>Area / Zone</span><select className="ds-select" value={sel.area} disabled={locationsLoaded && !areas.length} onChange={(e) => setSel({ ...sel, area: e.target.value })}><option value="">{locationsLoaded && !areas.length ? (sel.city ? "No zones listed for this city" : "Choose a city first") : "All areas"}</option>{areas.map((a) => <option key={a}>{a}</option>)}</select></label>
      </div>
      {locationError ? <p className="ds-error mt-3" role="alert">Locations could not be loaded: {locationError}. Reload to try again.</p>
        : !locationsLoaded ? <p className="text-[12px] text-muted mt-3" role="status">Loading cities and areas…</p>
        // Built-in places remain available when the saved location master is empty.
        : !locations.length ? (
          <div className="fare-location-note" role="status">
            <span>These are the built-in cities and zones. Add your own in Locations and they show here.</span>
            <Button size="sm" variant="primary" icon="map-pin" disabledReason={canViewLocations ? undefined : "Locations view permission is required."} onClick={() => { setSheet(null); onNavigate("locations"); }}>Open Locations</Button>
          </div>
        )
        : null}
    </section>
  );

  // ── The page: a side menu of tasks, one compact "where does this apply" bar, then the work itself ──────────────────
  const isRuleTab = tab === "Booking availability" || tab === "Cab types" || tab === "Pricing rules";
  type NavItem = { key: string; label: string; hint: string; icon: IconName; on?: boolean; opens?: boolean; go: () => void; disabledReason?: string };
  const navGroups: { title: string; items: NavItem[] }[] = [
    { title: "Prices", items: [
      { key: "base", label: "Base rates", hint: "Price per km, driver allowance, partner pay, CNG and extra charges", icon: "calculator", on: !inlineKind && tab === "Brand & service fares", go: () => changeTab("Brand & service fares") },
      { key: "tax", label: "GST & tax", hint: "How GST is worked out and shown", icon: "files", on: !inlineKind && tab === "GST calculation", go: () => changeTab("GST calculation") },
    ] },
    { title: "Special fares", items: [
      { key: "local", label: "Local fares", hint: "Rental packages and city pickup & drop", icon: "map-pin", on: inlineKind === "local", go: () => setSheet({ kind: "local" }) },
      { key: "fixed", label: "Fixed route fares", hint: "An agreed fare for one route", icon: "route", on: inlineKind === "fixed", go: () => setSheet({ kind: "fixed" }), disabledReason: fareScope.service !== "One Way" ? "Fixed route fares are for One Way. Choose One Way above." : undefined },
    ] },
    { title: "Booking rules", items: [
      { key: "availability", label: "Booking availability", hint: "Where customers can and cannot book", icon: "toggle-right", on: !inlineKind && tab === "Booking availability", go: () => changeTab("Booking availability") },
      { key: "pricing", label: "Pricing rules", hint: "Raise or lower fares by place or date", icon: "indian-rupee", on: !inlineKind && tab === "Pricing rules", go: () => changeTab("Pricing rules") },
      { key: "limits", label: "Fare limits", hint: "Lowest and highest fares allowed", icon: "shield-check", on: inlineKind === "limits", go: () => setSheet({ kind: "limits" }) },
      { key: "rules", label: "All rules & schedules", hint: "Every rule in one list", icon: "calendar-clock", on: inlineKind === "all", go: () => setSheet({ kind: "all" }) },
    ] },
    { title: "Vehicles", items: [
      { key: "cabs", label: "Cab types", hint: "Which cabs customers see, and the vehicle list", icon: "car-front", on: !inlineKind && tab === "Cab types", go: () => changeTab("Cab types") },
    ] },
    { title: "Tools", items: [
      { key: "history", label: "Change history", hint: "Who changed which rule, and when", icon: "history", on: inlineKind === "history", go: () => setSheet({ kind: "history" }) },
      { key: "test", label: "Test fare", hint: "Try a trip and see the fare it gets", icon: "calculator", opens: true, go: () => setSheet({ kind: "test" }),
        disabledReason: !canTest ? "Fare preview needs operations access." : fareScope.brand === "common" ? "Choose a customer brand to preview its effective fare." : fareScope.service === "Multicity" ? "Multicity is quoted through the travel desk enquiry flow." : undefined },
    ] },
  ];
  const pill = (key: string, label: string, on: boolean, onClick: () => void) => (
    <button key={key} type="button" className={`fs-pill ${on ? "is-on" : ""}`} aria-pressed={on} onClick={onClick}>{label}</button>
  );
  // The vehicle row lists the active vehicle categories. Each one has its own rate class (Sedan, SUV 6+1, SUV 7+1, Innova, Innova Crysta);
  // SUV 7+1 and Innova use the SUV 6+1 rates until they are given their own. Before the categories load, the classes are shown.
  const classOfCategory = (c: VehicleCategory): TariffClass => {
    const saved = String((c as unknown as { tariffClass?: unknown }).tariffClass ?? "").toLowerCase() as TariffClass;
    if (TARIFF_CLASSES.includes(saved)) return saved;
    const name = (c.name || "").toLowerCase();
    if (/crysta/.test(name)) return "crysta";
    if (/innova/.test(name)) return "innova";
    const seats = c.seatingCapacity || 0;
    if (/(suv|xuv|ertiga|marazzo|carens|xl6|scorpio|fortuner|muv|mpv)/.test(name)) return seats >= 7 || /7\s*\+\s*1/.test(name) ? "suv7" : "suv";
    if (/(sedan|dzire|etios|aura|verna|mini|hatch|micro|swift|wagon|alto|auto)/.test(name)) return "sedan";
    return seats >= 7 ? "suv7" : seats >= 6 ? "suv" : "sedan";
  };
  const activeCats = categories.filter((c) => c.status === "Active").sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99));
  const vehicleChoices: { key: string; label: string; cls: TariffClass; shared: boolean }[] = activeCats.length
    ? activeCats.map((c) => ({ key: c.id, label: c.name, cls: classOfCategory(c), shared: activeCats.filter((o) => classOfCategory(o) === classOfCategory(c)).length > 1 }))
    : TARIFF_CLASSES.map((cls) => ({ key: cls, label: CLASS_LABEL[cls], cls, shared: false }));
  const showScope = tab !== "Service areas" && inlineKind !== "local" && inlineKind !== "history" && !(tab === "Cab types" && cabSection === "Vehicle categories" && !inlineKind);
  const scopeBar = showScope ? (
    <section className="fs-scope" aria-label="Where these settings apply">
      <div className="fs-scope__row">
        <span className="fs-scope__label">Brand</span>
        <div className="fs-pills" role="group" aria-label="Brand">
          {BRANDS.map((b) => pill(b.id, b.name, fareScope.brand === b.id, () => {
            const supported = BRAND_SUPPORTED_SERVICES[b.id];
            changeScope({ brand: b.id, service: supported.includes(fareScope.service) ? fareScope.service : supported[0] });
          }))}
          {pill("common", "All brands (shared)", fareScope.brand === "common", () => changeScope({ brand: "common", service: WORKSPACE_SERVICES.includes(fareScope.service) ? fareScope.service : WORKSPACE_SERVICES[0] }))}
        </div>
      </div>
      <div className="fs-scope__row">
        <span className="fs-scope__label">Service</span>
        <div className="fs-pills" role="group" aria-label="Service">
          {availableServices.map((service) => pill(service, service, fareScope.service === service, () => changeScope({ ...fareScope, service })))}
        </div>
      </div>
      {tab === "Brand & service fares" && fuelApplies && (
        <div className="fs-scope__row">
          <span className="fs-scope__label">Fuel</span>
          <div className="fs-pills" role="group" aria-label="Fuel">
            {pill("petrol", "Diesel / Petrol", fareFuel === "petrol", () => changeFuel("petrol"))}
            {pill("cng", "CNG", fareFuel === "cng", () => changeFuel("cng"))}
          </div>
        </div>
      )}
      {tab === "Brand & service fares" && (
        <div className="fs-scope__row">
          <span className="fs-scope__label">Vehicle</span>
          <div className="fs-pills" role="group" aria-label="Vehicle">
            {vehicleChoices.map((v) => <button key={v.key} type="button" className={`fs-pill ${fareClass === v.cls ? "is-on" : ""}`} aria-pressed={fareClass === v.cls} title={v.shared ? `Uses the ${CLASS_LABEL[v.cls]} rates, shared with the other ${CLASS_LABEL[v.cls]} categories` : `Uses the ${CLASS_LABEL[v.cls]} rates`} onClick={() => changeClass(v.cls)}>{v.label}</button>)}
          </div>
        </div>
      )}
      <p className="fs-scope__note"><Icon name="info" size={14} />{fareScope.brand === "common"
        ? "Shared prices: every brand starts from these. A brand can set its own on top."
        : `${BRAND_LABELS[fareScope.brand]} uses its own price where one is set, and the shared price everywhere else.`} Bookings already confirmed keep their fare.</p>
    </section>
  ) : null;
  const pageTitle = inlineKind ? null : tab === "Brand & service fares"
    ? { h: "Base rates", p: "What customers pay per km, what partners earn, and the CNG option. Change one section at a time." }
    : tab === "GST calculation" ? { h: "GST & tax", p: "How GST is worked out and shown on fares." } : null;

  return (
    <div className="ds-page-body fare-reference u27-settings-page u11-settings-page">
      <Toast toast={toast} />
      {loadError && <div className="ds-error mb-4" role="alert"><Icon name="circle-alert" />Saved settings could not be loaded: {loadError}. Check your pricing access and reload.</div>}
      <PageHeader title="Service & Fare Settings" subtitle="Pick what you want to change on the left, then choose where it applies." />

      <div className="fs-shell">
        <nav className="fs-nav" aria-label="Fare settings sections">
          {navGroups.map((g) => (
            <div className="fs-nav__group" key={g.title}>
              <span className="fs-nav__title">{g.title}</span>
              {g.items.map((it) => (
                <button key={it.key} type="button" className={`fs-nav__item ${it.on ? "is-on" : ""}`} aria-current={it.on ? "page" : undefined} onClick={it.go} disabled={!!it.disabledReason} title={it.disabledReason ?? it.hint}>
                  <Icon name={it.icon} />
                  <span className="fs-nav__text"><strong>{it.label}</strong></span>
                  {it.opens ? <Icon name="chevron-right" /> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="fs-main">
      {pageTitle && <header className="fs-title"><h2>{pageTitle.h}</h2><p>{pageTitle.p}</p></header>}
      {scopeBar}
      {!inlineKind && tab === "Brand & service fares" && <DisplayMarkupCard scope={fareScope} />}
      {!inlineKind && tab !== "Service areas" && <>
      {tab !== "Brand & service fares" && tab !== "GST calculation" && <>
        {locationFilter}
        <section className="u28-overview" aria-label="Current location settings">
          <header><strong><Icon name="map-pin" />{where}</strong><span>Rules active now · IST</span></header>
          {!loaded ? <p role="status">Loading current settings…</p> : loadError ? <p role="alert">Current settings could not be loaded.</p> : <>
            <div className="u28-overview-values">
              <div><span>Booking controls</span><strong>{availabilityValues.length > 1 ? "Varies by rule" : availabilityValues[0] || "Available by default"}</strong><small>{activeOf("availability").length ? activeOf("availability").length + " active controls" : "No active availability restriction"}</small></div>
              <div><span>Configured cabs</span><strong>{cabSets.length > 1 ? "Varies by zone / service" : cabSets[0] || "All active cab types"}</strong><small>{activeOf("categories").length ? activeOf("categories").length + " active category rules" : "Uses default enabled categories"}</small></div>
              <div><span>Pricing rules</span><strong>{activeOf("pricing").length} active</strong><small>{scoped.filter(r => r.kind === "pricing" && phaseOf(r, now) === "Scheduled").length} scheduled</small></div>
              <Button icon="search" disabledReason={!canTest ? "Fare preview needs operations access." : fareScope.brand === "common" ? "Choose a customer brand to test its fare." : fareScope.service === "Multicity" ? "Multicity is quoted through the travel desk." : undefined} onClick={() => setSheet({ kind: "test" })}>Test fare</Button>
            </div>
            <p>Exact availability and fare depend on the route, cab type and pickup time.</p>
          </>}
        </section>
      </>}
      {tab === "Brand & service fares" && <div>
        <BrandServiceFareWorkspace scope={fareScope} vehicleClass={fareClass} fuel={fuelApplies ? fareFuel : "petrol"} onDirtyChange={dirty => { workspaceDirty.current = dirty; }} onBusyChange={busy => { workspaceBusy.current = busy; }} />
      </div>}
      {tab === "GST calculation" && <div>
        <FareGstSettings key={fareScope.brand + ":" + fareScope.service} scope={fareScope} onDirtyChange={value => { gstDirty.current = value; }} onBusyChange={value => { gstBusy.current = value; }} />
      </div>}
      {isRuleTab && <section className="u27-settings-surface" id="fare-settings-panel">
        <>
          {tab === "Cab types" && <StageBar label="Cab types" tabs={[{ id: "Customer cab rules" as const, label: "Customer cab rules" }, { id: "Vehicle categories" as const, label: "Vehicle categories" }]} value={cabSection} onChange={setCabSection} />}
          {tab === "Cab types" && cabSection === "Vehicle categories" ? <>
            <p className="ds-note my-4">Shared vehicle catalog — location filters do not apply. Brand prices are managed in Base rates.</p>
            {fareScope.brand === "common" ? <VehicleCategoriesPage embedded /> : <Button onClick={() => changeScope({ ...fareScope, brand: "common" })}>Open shared vehicle catalog</Button>}
          </> : <>
            <div className="sc-section-head"><div><h2>{tab === "Booking availability" ? "Can customers book in this area?" : tab === "Cab types" ? "Which cab types should customers see?" : "When should the fare increase or decrease?"}</h2><p className="u27-tamil" lang="ta">{tab === "Booking availability" ? "இந்த இடத்தில் booking எடுக்கலாமா?" : tab === "Cab types" ? "Customer-க்கு எந்த car வகைகளைக் காட்ட வேண்டும்?" : "இந்த இடத்திற்குக் கட்டணத்தை ஏற்ற / குறைக்க"}</p></div>
              {canEdit && <Button variant="primary" icon="plus" disabledReason={!loaded || loadError ? "Wait for saved rules to load before adding a setting." : undefined} onClick={() => setSheet({ kind: "new", ruleKind: tab === "Booking availability" ? "availability" : tab === "Cab types" ? "categories" : "pricing" })}>{tab === "Booking availability" ? "Add booking availability" : tab === "Cab types" ? "Add cab types" : "Add pricing rule"}</Button>}
            </div>
            {tab === "Pricing rules" && <div className="u27-fare-key"><span><strong>Customer fare</strong>Amount the customer pays</span><span><strong>Partner payout</strong>Amount for the Vendor / Driver Partner</span></div>}
            <div className="u27-inline-filters"><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search settings for this location" aria-label="Search location settings" /><select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Setting status">{STATUS_FILTERS.map(status => <option key={status} value={status}>{status}</option>)}</select></div>
            {loadError ? <p className="ds-error" role="alert">Saved settings could not be loaded. Reload to try again.</p> : ruleTable(byKind(tab === "Booking availability" ? "availability" : tab === "Cab types" ? "categories" : "pricing")) ?? <div className="u27-empty-setting"><Icon name={tab === "Pricing rules" ? "badge-indian-rupee" : tab === "Cab types" ? "car-front" : "toggle-right"} /><strong>{query || filter !== "All" ? "No matching settings" : tab === "Pricing rules" ? "Normal applicable fare" : tab === "Cab types" ? "Default cab categories" : "Booking service is available by default"}</strong><p>{query || filter !== "All" ? "Try another search or status filter." : "No additional setting for this selection. Wider matching settings still apply."}</p></div>}
            <div className="u11-settings-foot"><Icon name="calendar-clock" />Set pickup dates and times inside each rule. Use the fare settings above for base rates and local fares.</div>
            {tab === "Pricing rules" && fareScope.brand === "common" && <details className="mt-4"><summary className="font-semibold cursor-pointer">Existing shared adjustment — all brands and all services</summary><p className="ds-note my-3">This older shared percentage adjustment is still applied by the fare engine to every brand and service unless a scoped pricing rule replaces it. Staff with pricing access can see it here and switch it off.</p><FareAdjustmentCard /></details>}
          </>}
        </>
      </section>}
      </>}
      {inlineKind && (
        <InlineModals value={true}>
      {sheet?.kind === "history" && <HistorySheet rules={rules.filter(inFareScope)} onClose={() => setSheet(null)} />}
      {sheet?.kind === "fixed" && <FixedRouteFares scope={fareScope} onClose={() => setSheet(null)} onToast={show} />}
      {sheet?.kind === "local" && <Modal title="Local fares" onClose={() => setSheet(null)} wide><div className="ds-note mb-4">Rental packages use the selected brand. City Pickup &amp; Drop fares are shared across brands.</div><Button className="mb-4" icon="clock" onClick={() => { setSheet(null); setFareScope({ ...fareScope, service: "Local Rental" }); setTab("Brand & service fares"); }}>Manage Local Rental packages</Button><LocalFares only="Pickup & Drop" initialTab="Pickup & Drop" initialCity={sel.city} onToast={show} /></Modal>}
      {sheet?.kind === "limits" && <LimitsSheet locationFilter={<div className="fare-reference u11-settings-page">{locationFilter}</div>} loaded={loaded} loadError={loadError} rules={scoped.filter((r) => r.kind === "limit" && r.status !== "Removed")} canEdit={canEdit} canEditRule={canEditRule} onAdd={() => setSheet({ kind: "new", ruleKind: "limit" })} onEdit={(r) => setSheet({ kind: "edit", rule: r })} onStatus={(r, to) => setSheet({ kind: "status", rule: r, to })} onClose={() => setSheet(null)} />}
      {sheet?.kind === "all" && <Modal title="All rules & schedules" onClose={() => setSheet(null)} wide><div className="fare-reference u11-settings-page">{locationFilter}</div>{loadError ? <p className="ds-error" role="alert">{loadError}</p> : (ruleTable(scoped.filter((r) => r.status !== "Removed")) ?? <EmptyState title="No rules configured" />)}</Modal>}
        </InlineModals>
      )}

        </div>
      </div>

      {sheet?.kind === "new" && <RuleSheet kind={sheet.ruleKind} fareScope={fareScope} sel={sel} locations={locationRows} categories={catNames} services={services} rules={rules.filter(inFareScope)} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); show(t); }} />}
      {sheet?.kind === "edit" && <RuleSheet kind={sheet.rule.kind} rule={sheet.rule} fareScope={fareScope} sel={sel} locations={locationRows} categories={catNames} services={services} rules={rules} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); show(t); }} />}
      {sheet?.kind === "preview" && <PreviewSheet rule={sheet.rule} canTest={canTest} onTest={() => setSheet({ kind: "test" })} onClose={() => setSheet(null)} />}
      {sheet?.kind === "status" && <StatusSheet rule={sheet.rule} to={sheet.to!} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); show(t); }} />}
      {sheet?.kind === "test" && <TestFareSheet fareScope={fareScope} onClose={() => setSheet(null)} />}
    </div>
  );
}

function RuleSheet({ kind, rule, fareScope, sel, locations, categories, services, rules, onClose, onDone }: {
  kind: RuleKind; rule?: ServiceRule; fareScope: FareWorkspaceScope; sel: Sel; locations: Sel[]; categories: string[]; services: TravelService[]; rules: ServiceRule[]; onClose: () => void; onDone: (t: string) => void;
}) {
  const [scope, setScope] = useState(rule?.scope ?? { ...sel, side: "Pickup or drop" as Side });
  const [name, setName] = useState(rule?.name ?? "");
  const [service, setService] = useState(rule?.service ?? fareScope.service);
  const [priority, setPriority] = useState(rule?.priority ?? 10);
  const [mode, setMode] = useState<"Always" | "Range">(rule?.schedule.mode ?? "Always");
  const [from, setFrom] = useState(isoToIstInput(rule?.schedule.from));
  const [to, setTo] = useState(isoToIstInput(rule?.schedule.to));
  const [availability, setAvailability] = useState(rule?.availability ?? "Available");
  const [cats, setCats] = useState<string[]>(rule?.categories ?? []);
  const [customer, setCustomer] = useState<Adjustment>(rule?.customer ?? { mode: "Normal", percent: 0 });
  const [partner, setPartner] = useState<Adjustment>(rule?.partner ?? { mode: "Normal", percent: 0 });
  const [limit, setLimit] = useState(rule?.limit ?? { target: "Customer fare" as const, category: "All", min: 0, max: 0, reference: "" });
  const [reason, setReason] = useState("");
  const [more, setMore] = useState(!!rule);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const initial = useRef(JSON.stringify({ scope, name, service, priority, mode, from, to, availability, cats, customer, partner, limit, reason }));
  const dirty = initial.current !== JSON.stringify({ scope, name, service, priority, mode, from, to, availability, cats, customer, partner, limit, reason });
  const close = () => { if (!busy && (!dirty || window.confirm("Discard your unsaved setting changes?"))) onClose(); };
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const scopeCities = locationOptions([scope.city, ...directoryCities(stateKey(scope.state)), ...locations.filter(l => !scope.state || stateKey(l.state) === stateKey(scope.state)).map(l => l.city)]);
  const scopeAreas = scope.city ? locationOptions([scope.area, ...directoryZones(scope.city), ...locations.filter(l => (!scope.state || stateKey(l.state) === stateKey(scope.state)) && locationKey(l.city) === locationKey(scope.city)).map(l => l.area)]) : [];
  const where = [scope.area, scope.city, scope.state && GST_STATES.find(([c]) => c === scope.state)?.[1]].filter(Boolean).join(", ") || "All locations";
  const title = { availability: "Service Areas", categories: "Vehicles by Area", pricing: "Scheduled Pricing", limit: "Fare limit" }[kind];
  const draft: Omit<ServiceRule, "id"> = {
    brand: rule?.brand ?? (fareScope.brand === "common" ? "" : fareScope.brand), fareService: rule ? rule.fareService ?? "" : fareScope.service,
    kind, name: name.trim() || `${scope.area || scope.city || "All locations"} ${kind === "categories" ? "cab categories" : kind === "availability" ? "availability" : kind === "pricing" ? "fare rule" : "fare limit"}`,
    status: rule?.status === "Disabled" ? "Disabled" : "Enabled", priority, scope, service: service === "All" ? "" : service,
    schedule: mode === "Always" ? { mode } : { mode, ...(from ? { from: istInputToIso(from) } : {}), ...(to ? { to: istInputToIso(to) } : {}) },
    ...(kind === "availability" ? { availability } : {}), ...(kind === "categories" ? { categories: cats } : {}),
    ...(kind === "pricing" ? { customer, partner } : {}), ...(kind === "limit" ? { limit } : {}), reason: reason.trim(),
  };
  // Same kind, same scope and service, overlapping schedule = conflict.
  const conflict = rules.find((r) => r.id !== rule?.id && r.kind === kind && r.status === "Enabled" && r.priority === priority
    && (r.brand ?? "") === draft.brand && (r.fareService ?? "") === draft.fareService
    && r.scope.state === scope.state && r.scope.city === scope.city && r.scope.area === scope.area && (r.service || "") === draft.service
    && (r.schedule.mode === "Always" || mode === "Always" || !((r.schedule.to ? Date.parse(r.schedule.to) : Infinity) <= (from ? Date.parse(istInputToIso(from)) : -Infinity) || (to ? Date.parse(istInputToIso(to)) : Infinity) <= (r.schedule.from ? Date.parse(r.schedule.from) : -Infinity))));
  const check = () => {
    if (!Number.isInteger(priority) || priority < 1 || priority > 100) return "Priority must be a whole number from 1 to 100.";
    if (kind === "categories" && !cats.length) return "Choose at least one cab type.";
    if (kind === "pricing" && customer.mode === "Normal" && partner.mode === "Normal") return "Choose an increase or decrease for the customer fare or the partner payout.";
    if (kind === "pricing" && [customer, partner].some((a) => a.mode !== "Normal" && !(a.percent > 0 && a.percent < 100))) return "Enter a percentage between 1 and 99.";
    if (kind === "limit" && !(limit.max > 0 && limit.max >= limit.min)) return "Enter a valid minimum and maximum.";
    if (mode === "Range" && !from && !to) return "Set the pickup date range or choose Always.";
    if (mode === "Range" && from && to && to <= from) return "The end must be after the start.";
    if (conflict) return `Resolve this overlapping rule before preview: ${conflict.name}.`;
    if (reason.trim().length < 5) return "Record the reason for this change.";
    return null;
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    const why = check();
    if (why) return setError(why);
    if (!preview) { setError(null); return setPreview(true); }
    submitting.current = true;
    setBusy(true);
    try { await saveRule(draft, rule?.id, rule); onDone(`${draft.name} saved.`); }
    catch (err) { setError(err instanceof Error ? err.message : "The setting was not saved. Check your permissions and try again."); setBusy(false); submitting.current = false; }
  };
  const adjEditor = (label: string, sub: string, a: Adjustment, set: (a: Adjustment) => void) => (
    <div className="ds-panel ds-panel-pad">
      <strong className="text-[13px] text-ink">{label}</strong><p className="text-[11px] text-muted mb-2">{sub}</p>
      <div className="ds-seg" style={{ "--ds-seg": 3 } as React.CSSProperties}>{(["Normal", "Increase", "Decrease"] as const).map((m) => <button key={m} type="button" aria-pressed={a.mode === m} onClick={() => set({ ...a, mode: m })}>{m === "Normal" ? "Normal rate" : m}</button>)}</div>
      {a.mode !== "Normal" ? <label className="ds-field mt-2"><span>Percent</span><input className="ds-input" type="number" min={1} max={99} value={a.percent || ""} onChange={(e) => set({ ...a, percent: Number(e.target.value) })} /></label> : <p className="text-[11px] text-faint mt-2">Use the applicable base amount.</p>}
    </div>
  );
  return (
    <Modal title={rule ? "Edit settings" : "Add settings"} onClose={close} busy={busy} size="lg" footNote="Review the location, amounts and pickup schedule before saving." footer={<>{preview && <Button disabled={busy} onClick={() => setPreview(false)}>Back</Button>}<Button variant="primary" type="submit" form="rule-form" loading={busy}>{preview ? "Save settings" : "Preview settings"}</Button></>}>
      <form id="rule-form" onSubmit={save} className="grid gap-4 fare-reference" noValidate>
        <div className="u27-setting-location"><Icon name="map-pin" /><div><strong>{where}</strong><small>{fareScope.brand === "common" ? "Common — all brands" : BRAND_LABELS[fareScope.brand]} → {rule && !rule.fareService ? rule.service || "All services — existing shared rule" : fareScope.service} · {scope.side}</small></div></div>
        {rule && <p className="ds-note">Editing this saved rule affects its entire saved coverage, including other matching locations. Review the scope before saving.</p>}
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        {preview ? (
          <dl className="ds-facts" data-cols={2}>
            {([["Rule", draft.name], ["Location", where], ["Service / categories", `${service} · ${kind === "categories" ? cats.join(" · ") : "All"}`], ["Value", summary(draft)], ["Pickup schedule", mode === "Always" ? "Always" : `${from || "Open start"} → ${to || "Open end"} · IST`], ["Priority", String(priority)], ["Reason", reason]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        ) : (
          <>
            <h3 className="text-[14px] font-bold text-ink">{title}</h3>
            {kind === "availability" && (
              <div className="u27-choice-list">
                {([["Available", "Customers can request bookings."], ["Limited", "Limited service. Office confirmation is required."], ["Paused", "Stop new booking requests for this selection."]] as const).map(([v, d]) => (
                  <label key={v} className={availability === v ? "selected" : ""}><input type="radio" name="avail" checked={availability === v} onChange={() => setAvailability(v)} /><span><strong>{v}</strong><small>{d}</small></span></label>
                ))}
              </div>
            )}
            {kind === "categories" && (
              <>
                <div className="u27-cab-choices">{categories.map((c) => <label key={c}><input type="checkbox" checked={cats.includes(c)} onChange={(e) => setCats(e.target.checked ? [...cats, c] : cats.filter((x) => x !== c))} /><Icon name="car-front" /><strong>{c}</strong></label>)}</div>
                <p className="text-[11px] text-faint">Unchecked categories stay hidden in search. Time-based cab unavailability is managed under Service Areas.</p>
              </>
            )}
            {kind === "pricing" && (
              <div className="u27-price-columns">
                {adjEditor("Customer fare", "Amount the customer pays", customer, setCustomer)}
                {adjEditor("Partner payout", "Amount the partner receives", partner, setPartner)}
                <p className="text-[11px] text-faint md:col-span-2">Customer fare and partner payout change independently. Fixed route / B2B adjustments require opt-in on the corresponding rate.</p>
              </div>
            )}
            {kind === "limit" && (
              <div className="ds-form-grid">
                <label className="ds-field"><span>Applies to</span><select className="ds-select" value={limit.target} onChange={(e) => setLimit({ ...limit, target: e.target.value as typeof limit.target })}><option>Customer fare</option><option>Partner payout</option></select></label>
                <label className="ds-field"><span>Category</span><select className="ds-select" value={limit.category} onChange={(e) => setLimit({ ...limit, category: e.target.value })}><option>All</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
                <label className="ds-field"><span>Minimum · ₹</span><input className="ds-input" type="number" min={0} value={limit.min || ""} onChange={(e) => setLimit({ ...limit, min: Number(e.target.value) })} /></label>
                <label className="ds-field"><span>Maximum · ₹</span><input className="ds-input" type="number" min={0} value={limit.max || ""} onChange={(e) => setLimit({ ...limit, max: Number(e.target.value) })} /></label>
                <label className="ds-field" data-span="2"><span>Office approval / state notification reference</span><input className="ds-input" value={limit.reference} onChange={(e) => setLimit({ ...limit, reference: e.target.value })} /></label>
              </div>
            )}
            <div className="ds-field"><span>Applicable pickup dates</span><Ta>எந்த pickup தேதிகளுக்குப் பொருந்தும்?</Ta>
              <div className="ds-seg mt-1">{(["Always", "Range"] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{m === "Always" ? "Always" : "Specific dates & times"}</button>)}</div>
            </div>
            {mode === "Range" && <div className="ds-form-grid"><label className="ds-field"><span>From · IST</span><DateTime12Input value={from} onChange={setFrom} /></label><label className="ds-field"><span>To · IST</span><DateTime12Input value={to} onChange={setTo} /></label><p className="text-[11px] text-faint" data-span="2">Matched on the pickup time in IST. The start time is included; the end time is not.</p></div>}
            <details className="u27-more-options" open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
              <summary>More options · Location, service, pickup / drop &amp; priority</summary>
              <div className="ds-form-grid">
                <label className="ds-field"><span>Rule name</span><input className="ds-input" value={name} placeholder={draft.name} onChange={(e) => setName(e.target.value)} /></label>
                <label className="ds-field"><span>Service</span><input className="ds-input" readOnly value={rule && !rule.fareService ? rule.service || "All services" : fareScope.service} /></label>
                <label className="ds-field"><span>Applies to</span><select className="ds-select" value={scope.side} onChange={(e) => setScope({ ...scope, side: e.target.value as Side })}><option>Pickup or drop</option><option>Pickup only</option><option>Drop only</option></select></label>
                <label className="ds-field"><span>Priority</span><input className="ds-input" type="number" min={1} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></label>
                <label className="ds-field"><span>State</span><select className="ds-select" value={scope.state} onChange={e => setScope({ ...scope, state: e.target.value, city: "", area: "" })}><option value="">All states</option>{GST_STATES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}{scope.state && !GST_STATES.some(([code]) => code === scope.state) && <option value={scope.state}>{scope.state}</option>}</select></label>
                <label className="ds-field"><span>City</span><select className="ds-select" value={scope.city} onChange={e => setScope({ ...scope, city: e.target.value, area: "" })}><option value="">All cities</option>{scopeCities.map(city => <option key={city}>{city}</option>)}</select></label>
                <label className="ds-field"><span>Area / Zone</span><select className="ds-select" value={scope.area} disabled={!scope.city} onChange={e => setScope({ ...scope, area: e.target.value })}><option value="">All areas</option>{scopeAreas.map(area => <option key={area}>{area}</option>)}</select></label>
              </div>
            </details>
            {conflict && <p className="text-[11px] text-bad">Resolve this overlapping rule before preview · {conflict.name} · Change the location, dates, service or {kind === "categories" ? "cab types" : "priority"}.</p>}
            <label className="ds-field"><span>Reason for this change</span><input className="ds-input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          </>
        )}
      </form>
    </Modal>
  );
}

function PreviewSheet({ rule, canTest, onTest, onClose }: { rule: ServiceRule; canTest: boolean; onTest: () => void; onClose: () => void }) {
  return (
    <Modal title="Rule preview" onClose={onClose} footer={<Button icon="calculator" disabledReason={canTest ? undefined : "Test fare needs operations access."} onClick={onTest}>Test search</Button>}>
      <dl className="ds-facts" data-cols={2}>
        {([["Rule", rule.name], ["Location", [rule.scope.area, rule.scope.city, rule.scope.state].filter(Boolean).join(", ") || "All locations"], ["Service / categories", `${rule.service || "All"} · ${rule.categories?.join(" · ") || "All"}`], ["State", phaseOf(rule)], ["Priority", String(rule.priority)], ["Customer / payout", rule.kind === "pricing" ? `${adjText(rule.customer)} / ${adjText(rule.partner)}` : "Not applicable"], ["Reason", rule.reason]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <p className="text-[11px] text-faint mt-3">Test customer search to see the rule applied to a real route.</p>
    </Modal>
  );
}

function StatusSheet({ rule, to, onClose, onDone }: { rule: ServiceRule; to: "Enabled" | "Disabled" | "Removed"; onClose: () => void; onDone: (t: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verb = to === "Enabled" ? "Enable" : to === "Disabled" ? "Disable" : "Remove";
  return (
    <Modal title={`${verb} ${rule.name}`} onClose={onClose} busy={busy} footer={<><Button onClick={onClose}>Cancel</Button><Button variant={to === "Enabled" ? "primary" : "danger"} loading={busy} onClick={async () => {
      if (reason.trim().length < 5) return setError("Record the reason for the status change.");
      setBusy(true);
      try { await setRuleStatus(rule, to, reason.trim()); onDone(`${rule.name} ${to.toLowerCase()}.`); } catch (err) { setError(err instanceof Error ? err.message : "The status was not changed."); setBusy(false); }
    }}>Confirm {verb.toLowerCase()}</Button></>}>
      <p className="text-[13px] text-ink mb-1">{verb} this rule?</p>
      <p className="text-[12px] text-muted mb-3">{[rule.scope.area, rule.scope.city].filter(Boolean).join(", ") || "All locations"} · {rule.scope.side} · {summary(rule)}</p>
      {error && <div className="ds-error" role="alert">{error}</div>}
      <label className="ds-field"><span>Reason for status change</span><input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </Modal>
  );
}

function HistorySheet({ rules, onClose }: { rules: ServiceRule[]; onClose: () => void }) {
  const rows = rules.flatMap((r) => (r.history ?? []).map((h) => ({ ...h, rule: r }))).sort((a, b) => (b.at?.toMillis?.() ?? 0) - (a.at?.toMillis?.() ?? 0));
  const [open, setOpen] = useState<(typeof rows)[number] | null>(null);
  return (
    <Modal title="Change history" onClose={onClose} wide footNote="Read-only change history">
      <p className="text-[12px] text-muted mb-3">Who changed the setting, when it changed, and the recorded reason. Open View change for the original before / after values.</p>
      {rows.length === 0 ? <EmptyState /> : (
        <DataTable label="Change history" minWidth={820} hideTools hasActions>
          <thead><tr><th>DATE / TIME · IST</th><th>CHANGE / RECORD</th><th>REASON</th><th>STAFF / ID</th><th className="ds-actions">DETAILS</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td>{refDateTime(r.at?.toDate?.() ?? null)}</td><td><strong>{r.action}</strong><small>{r.rule.name} · {r.location || [r.rule.scope.area, r.rule.scope.city].filter(Boolean).join(", ") || "All locations"}</small></td><td>{r.reason}</td><td>{r.byName}{r.byUid && <small>{r.byUid.slice(0, 8)}</small>}</td><td className="ds-actions"><div><Button size="sm" onClick={() => setOpen(r)}>View change</Button></div></td></tr>)}</tbody>
        </DataTable>
      )}
      {open && <Modal title="View change" onClose={() => setOpen(null)}><dl className="ds-facts" data-cols={1}><div><dt>Before</dt><dd>{open.before || "—"}</dd></div><div><dt>After</dt><dd>{open.after || "—"}</dd></div><div><dt>Reason</dt><dd>{open.reason}</dd></div></dl></Modal>}
    </Modal>
  );
}

function LimitsSheet({ locationFilter, loaded, loadError, rules, canEdit, canEditRule, onAdd, onEdit, onStatus, onClose }: { locationFilter: ReactNode; loaded: boolean; loadError: string | null; rules: ServiceRule[]; canEdit: boolean; canEditRule: (rule: ServiceRule) => boolean; onAdd: () => void; onEdit: (r: ServiceRule) => void; onStatus: (r: ServiceRule, to: "Enabled" | "Disabled" | "Removed") => void; onClose: () => void }) {
  return (
    <Modal title="Fare limits" onClose={onClose} wide>
      {locationFilter}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div><strong className="text-[15px] text-ink">Office &amp; authority fare limits</strong><p className="text-[12px] text-muted">Stops a new quote for rate review when a configured limit is breached.</p></div>
        {canEdit && <Button icon="plus" onClick={onAdd}>Add limit</Button>}
      </div>
      {loadError ? <p className="ds-error" role="alert">{loadError}</p> : !loaded ? <p role="status">Loading saved limits…</p> : rules.length === 0 ? <EmptyState title="No limits configured" hint="Add an office-approved limit or a verified state notification reference when applicable." /> : (
        <DataTable label="Fare limits" minWidth={760} hideTools hasActions>
          <thead><tr><th>LIMIT / REFERENCE</th><th>STATE / SERVICE / CATEGORY</th><th>CUSTOMER OR PARTNER</th><th>MINIMUM / MAXIMUM</th><th>STATUS</th>{canEdit && <th className="ds-actions">ACTIONS</th>}</tr></thead>
          <tbody>{rules.map((r) => <tr key={r.id}><td><strong>{r.name}</strong><small>{r.limit?.reference}</small></td><td>{[r.scope.area, r.scope.city, r.scope.state && GST_STATES.find(([c]) => c === r.scope.state)?.[1]].filter(Boolean).join(", ") || "All"} · {r.service || "All"} · {r.limit?.category}</td><td>{r.limit?.target}</td><td>₹{r.limit?.min} – ₹{r.limit?.max}</td><td><Badge tone={toneForStatus(phaseOf(r) === "Active" ? "Enabled" : phaseOf(r))}>{phaseOf(r) === "Active" ? "Enabled" : phaseOf(r)}</Badge></td>{canEdit && <td className="ds-actions">{canEditRule(r) ? <div><Button size="sm" onClick={() => onEdit(r)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => onStatus(r, r.status === "Enabled" ? "Disabled" : "Enabled")}>{r.status === "Enabled" ? "Disable" : "Enable"}</Button><Button size="sm" variant="ghost" onClick={() => onStatus(r, "Removed")}>Remove</Button></div> : <span className="text-muted">Common inherited rule</span>}</td>}</tr>)}</tbody>
        </DataTable>
      )}
    </Modal>
  );
}

function TestFareSheet({ onClose, fareScope }: { onClose: () => void; fareScope: FareWorkspaceScope }) {
  const data = useQuickData();
  const [trip, setTrip] = useState<QuickTrip>(() => ({ ...emptyTrip(), tripType: fareScope.service === "Multicity" ? "One Way" : fareScope.service }));
  const [res, setRes] = useState<CategoryEstimate[] | null>(null);
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (e: FormEvent) => {
    e.preventDefault();
    const why = validateTrip(trip);
    if (why) return setError(why);
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      const list = await estimateAll(trip, data.categories, fareScope.brand === "common" ? undefined : fareScope.brand);
      setRes(list);
      setSel(list.find((x) => x.quote)?.category.id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The fare test failed. Please try again.");
    } finally { setBusy(false); }
  };
  const okCount = useMemo(() => res?.filter((r) => r.quote).length ?? 0, [res]);
  return (
    <Modal title={`Fare preview · ${fareScope.brand === "common" ? "Common" : BRAND_LABELS[fareScope.brand]} → ${fareScope.service}`} onClose={onClose} busy={busy} wide footNote="Uses the same rules as customer and office estimates." footer={<Button variant="primary" type="submit" form="test-fare" loading={busy}>Run test search</Button>}>
      <form id="test-fare" onSubmit={run} noValidate>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <p className="text-[12px] text-muted mb-3">Prices the trip with the same availability, cab type, schedule, fare rule and fare limit checks that customer and office bookings use. No booking or payment is created.</p>
        <TripFields allowedTripTypes={[fareScope.service === "Multicity" ? "One Way" : fareScope.service]} trip={trip} set={(p) => setTrip((t) => ({ ...t, ...p }))} data={{ ...data, services: data.services.filter(service => !/multi/i.test(service.name + " " + service.serviceType)) }} idPrefix="test-fare" />
      </form>
      {res && (
        <div className="mt-4">
          <p className="text-[12px] text-muted mb-2">{okCount} of {res.length} cab types available for this search. Hidden or paused types show the rule message.</p>
          <EstimateList estimates={res} selected={sel} onSelect={setSel} priceEntered="Excluding GST" />
        </div>
      )}
    </Modal>
  );
}

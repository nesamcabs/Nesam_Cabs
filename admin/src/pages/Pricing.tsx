import FareGstSettings from '../components/FareGstSettings';
import FareAdjustmentCard from '../components/FareAdjustmentCard';
import PlatformFeeCard from '../components/PlatformFeeCard';
import PaymentOptionsCard from '../components/PaymentOptionsCard';
import NightAllowanceCard from '../components/NightAllowanceCard';
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MasterLocation, TravelService, VehicleCategory } from "../types";
import { subscribeLocations, subscribeServices, subscribeVehicleCategories } from "../services/adminFirestoreService";
import { subscribeServiceRules, type ServiceRule } from "../services/serviceRulesService";
import { useCan, useCanDo } from "../components/AccessContext";
import { InlineModals, Modal, Toast, useToast } from "../components/Feedback";
import { Button, DataTable, EmptyState, Icon, PageHeader } from "../components/ui";
import type { IconName } from "../components/ui/Icon";
import FixedRouteFares from "../components/FixedRouteFares";
import LocalFares from "../components/LocalFares";
import "./pricingReference.css";
import VehicleCategoriesPage from "./VehicleCategories";
import FareMatrix from "../components/FareMatrix";
import BookingRulesGrid, { specialRules } from "../components/BookingRulesGrid";
import DateRules from "../components/DateRules";
import PriceChangeRules from "../components/PriceChangeRules";
import type { VehicleCol } from "../components/RateTable";
import { ALL_BRAND_KEYS, categoryOffersBrand, categoryStatusForBrand } from "../services/categoryService";
import { registerFareWorkspaceGuard } from "../services/fareWorkspaceGuard";
import { BRANDS, BRAND_LABELS, BRAND_SUPPORTED_SERVICES, CLASS_LABEL, TARIFF_CLASSES, WORKSPACE_SERVICES, PICKUP_DROP, serviceLabel, tariffClassOfCategory, type FareWorkspaceScope, type TariffClass } from "../services/tariffService";
import { GST_STATES } from "../domain/gstStates";
import { directoryCities } from "../domain/placeDirectory";
import DisplayMarkupCard from "../components/DisplayMarkupCard";
import TimeBasedRoundTripCard from "../components/TimeBasedRoundTripCard";
import { refDateTime } from "../domain/officeStage";

type Tab = "Brand & service fares" | "Booking availability" | "Cab types" | "Pricing rules" | "GST calculation" | "Platform fee" | "Payment options";
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

/** What the page shows, kept by the app while the Pricing & Fare Management page is open so Back can put it back. */
/** Inside Cab types: the customer-visibility rules, or the master Vehicle Categories management. */
export type CabSection = "Customer cab rules" | "Vehicle categories";
export type PricingView = { tab: Tab; sel: Sel; filter: (typeof STATUS_FILTERS)[number]; scrollY: number; fareScope?: FareWorkspaceScope; cabSection?: CabSection; pickupDrop?: boolean };
/** Where the older Vehicle Categories entry points land: Service & Fare Settings → Vehicles → Vehicle categories. */
export const CATEGORIES_VIEW: PricingView = { tab: "Cab types", sel: { state: "", city: "", area: "" }, filter: "All", scrollY: 0, cabSection: "Vehicle categories", fareScope: { brand: "common", service: "One Way" } };

/** Master Admin "Service & Fare Settings": fares, GST, booking rules and vehicles for every brand and service. */
export default function Pricing({ onNavigate, restore, onRestored }: {
  onNavigate: (page: string, tab?: string) => void;
  restore: PricingView | null;
  onRestored: () => void;
}) {
  const [fareScope, setFareScope] = useState<FareWorkspaceScope>(restore?.fareScope ?? { brand: "nesam", service: "One Way" });
  // Which vehicles the base rates are for: Diesel / Petrol (the normal rates) or CNG (its own rate card; every service except Hourly Rental).
  const [fareFuel, setFareFuel] = useState<"petrol" | "cng">("petrol");
  const fuelApplies = fareScope.service !== "Local Rental";
  const changeFuel = (next: "petrol" | "cng") => {
    // The Diesel / Petrol and CNG boxes share one form, so edits made on one are kept when switching and saved together.
    if (workspaceBusy.current || next === fareFuel) return;
    setFareFuel(next);
  };
  // The "Pickup & Drop" choice of the Service list shows the city-wise fares. Its rules, GST and display price follow One Way.
  const [pickupDrop, setPickupDrop] = useState(restore?.pickupDrop ?? false);
  const gstDirty = useRef(false), gstBusy = useRef(false);
  const workspaceDirty = useRef(false);
  const workspaceBusy = useRef(false);
  useEffect(() => registerFareWorkspaceGuard(() => !workspaceBusy.current && !gstBusy.current && (!(workspaceDirty.current || gstDirty.current) || window.confirm("Discard your unsaved fare changes before leaving?"))), []);
  const [tab, setTab] = useState<Tab>(restore?.tab ?? "Brand & service fares");
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
  // Change history and Fixed route fares open in the page itself. Nothing on this screen opens a side drawer.
  const [sheet, setSheet] = useState<{ kind: "history" | "fixed" } | null>(null);
  const inlineKind = sheet ? sheet.kind : null;
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const contentAccess = useCan("content");
  const settingsView = useCanDo("Settings", "view");
  const canViewLocations = contentAccess && settingsView;
  const { toast, show } = useToast(6000);
  const scopeLabel = (fareScope.brand === "common" ? "Common — all brands" : BRAND_LABELS[fareScope.brand]) + " → " + serviceLabel(fareScope.service);
  const scopeBrand = fareScope.brand === "common" ? "" : fareScope.brand;
  const availableServices = fareScope.brand === "common" ? WORKSPACE_SERVICES : BRAND_SUPPORTED_SERVICES[fareScope.brand];
  const changeScope = (next: FareWorkspaceScope) => {
    if (workspaceBusy.current || gstBusy.current || (next.brand === fareScope.brand && next.service === fareScope.service)) return;
    if ((workspaceDirty.current || gstDirty.current) && !window.confirm("Discard the unsaved rates in " + scopeLabel + "?")) return;
    setFareScope(next);
  };
  const changeTab = (next: Tab) => {
    if (inlineKind) setSheet(null); // leaving an in-page tool view goes back to the page the menu item points at
    if (next === tab || workspaceBusy.current || gstBusy.current) return;
    if ((workspaceDirty.current || gstDirty.current) && !window.confirm("Discard your unsaved fare changes before switching settings?")) return;
    workspaceDirty.current = false;
    gstDirty.current = false;
    setTab(next);
    setFilter("All");
  };
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
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
  const otherStates = locationOptions(locationRows.map(location => location.state).filter(state => state && !GST_STATES.some(([code]) => code === stateKey(state))));
  // Every rule for this brand & service (including the shared ones it inherits), and the ones that are not table cells.
  const scopedRules = rules.filter(inFareScope);
  const special = specialRules(scopedRules, ownsRule);
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const stateOptions = [...GST_STATES.map(([c, n]) => ({ value: c, label: n })), ...otherStates.map((st) => ({ value: st, label: st }))];
  const citiesOf = (state: string) => locationOptions([...directoryCities(stateKey(state)), ...locationRows.filter((l) => stateKey(l.state) === stateKey(state)).map((l) => l.city)]);
  const savedView = (): PricingView => ({ tab, sel, filter, scrollY: window.scrollY, fareScope, cabSection, pickupDrop });
  const selectPickupDrop = () => {
    if (workspaceBusy.current) return;
    if (!pickupDrop && workspaceDirty.current && !window.confirm("Discard the unsaved rates in " + scopeLabel + "?")) return;
    if (inlineKind) setSheet(null);
    setPickupDrop(true);
    setTab("Brand & service fares");
    if (fareScope.service !== "One Way") setFareScope({ ...fareScope, service: "One Way" });
  };
  // ── The page: a side menu of tasks, one compact "where does this apply" bar, then the work itself ──────────────────
  const isRuleTab = tab === "Booking availability" || tab === "Cab types" || tab === "Pricing rules";
  const isRuleSection = isRuleTab && cabSection !== "Vehicle categories";
  type NavItem = { key: string; label: string; hint: string; icon: IconName; on?: boolean; opens?: boolean; go: () => void; disabledReason?: string };
  const fixedOff = fareScope.service !== "One Way" || pickupDrop ? "Fixed route fares are for One Way. Choose Service → One Way." : undefined;
  const navGroups: { title: string; items: NavItem[] }[] = [
    // These four follow the Brand / Service choice above them, so they sit right under it.
    { title: "For this brand & service", items: [
      { key: "base", label: "Fares", hint: "Customer price, partner pay, CNG and extra charges", icon: "calculator", on: !inlineKind && tab === "Brand & service fares", go: () => changeTab("Brand & service fares") },
      { key: "tax", label: "GST & tax", hint: "How GST is worked out and shown", icon: "files", on: !inlineKind && tab === "GST calculation", go: () => changeTab("GST calculation") },
      { key: "fixed", label: "Fixed route fares", hint: "An agreed fare for one route", icon: "route", on: inlineKind === "fixed", go: () => setSheet({ kind: "fixed" }), disabledReason: fixedOff },
      { key: "rules", label: "Booking rules", hint: "Availability, cabs and pricing rules", icon: "toggle-right", on: !inlineKind && isRuleSection, go: () => {
        setCabSection("Customer cab rules");
        changeTab(tab === "Cab types" || tab === "Pricing rules" ? tab : "Booking availability");
      } },
    ] },
    // Common to every brand and service: the Brand / Service choice is not used for these.
    { title: "All brands & services", items: [
      { key: "platformFee", label: "Platform fee", hint: "A common fee on bookings, by service", icon: "wallet", on: !inlineKind && tab === "Platform fee", go: () => changeTab("Platform fee") },
      { key: "paymentOptions", label: "Payment options", hint: "Pay later, pay part now, pay in full: show, hide, dates and districts", icon: "indian-rupee", on: !inlineKind && tab === "Payment options", go: () => changeTab("Payment options") },
    ] },
    { title: "Vehicles", items: [
      { key: "categories", label: "Vehicle categories", hint: "Names, seats, photos and CNG", icon: "car", on: !inlineKind && tab === "Cab types" && cabSection === "Vehicle categories", go: () => { setCabSection("Vehicle categories"); changeTab("Cab types"); } },
    ] },
    { title: "History", items: [
      { key: "history", label: "Change history", hint: "Who changed which rule, and when", icon: "history", on: inlineKind === "history", go: () => setSheet({ kind: "history" }) },
    ] },
  ];
  // The Vehicle list shows the active vehicle categories. Each is priced as one rate class (Sedan, SUV 6+1, SUV 7+1, Innova,
  // Innova Crysta) worked out exactly as the server does; SUV 7+1 and Innova use the SUV 6+1 rates until given their own.
  // Categories are offered per brand ("Remove" on a brand's Vehicle categories only takes it off that brand), so a brand's fare table lists
  // the categories that brand offers and has switched on; the common view lists those any brand offers.
  const scopeBrands = fareScope.brand === "common" ? ALL_BRAND_KEYS : [fareScope.brand];
  const activeCats = categories.filter((c) => c.status === "Active" && scopeBrands.some((b) => categoryOffersBrand(c, b) && categoryStatusForBrand(c, b) === "Active")).sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99));
  const vehicleChoices: { key: string; label: string; cls: TariffClass; shared: boolean; cng: boolean }[] = activeCats.length
    ? activeCats.map((c) => ({ key: c.id, label: c.name, cls: tariffClassOfCategory(c), cng: c.cngEnabled === true, shared: activeCats.filter((o) => tariffClassOfCategory(o) === tariffClassOfCategory(c)).length > 1 }))
    : TARIFF_CLASSES.map((cls) => ({ key: cls, label: CLASS_LABEL[cls], cls, shared: false, cng: false }));
  // Every active vehicle category (from Firestore, in display order) is one column in every fare table. Prices are saved per
  // rate class, so when several categories are priced as the same class (Hatchback → Sedan rates), one of them edits the rates
  // (the category named like the class, else the first) and the others show those rates read-only, marked "Sedan rates".
  const vehicleCards = vehicleChoices.reduce<{ cls: TariffClass; name: string; categoryId: string; cng: boolean }[]>((cards, v) => {
    const card = cards.find((c) => c.cls === v.cls);
    if (card) card.cng = card.cng || v.cng;
    else cards.push({ cls: v.cls, name: v.label, categoryId: v.key, cng: v.cng });
    return cards;
  }, []);
  for (const card of vehicleCards) {
    const named = vehicleChoices.find((v) => v.cls === card.cls && v.label.trim().toLowerCase() === CLASS_LABEL[card.cls].toLowerCase());
    if (named) { card.name = named.label; card.categoryId = named.key; }
  }
  const vehicles: VehicleCol[] = vehicleChoices.map((v) => {
    const owner = vehicleCards.find((c) => c.cls === v.cls)!;
    return { id: v.key, name: v.label, cls: v.cls, owner: owner.categoryId === v.key, ownerName: owner.name, cng: v.cng };
  });

  // The platform fee and payment options are not set per brand or service, so the brand / service picker is not shown for them.
  const showScope = inlineKind !== "history" && !(tab === "Cab types" && cabSection === "Vehicle categories" && !inlineKind) && !((tab === "Platform fee" || tab === "Payment options") && !inlineKind);
  // Where a setting applies (brand, service, fuel, vehicle) is chosen in the side menu; the page itself only repeats the rule in one line.
  const scopeFields = showScope ? (
    <>
      <div className="fs-scope-heading">
        <span className="fs-scope-heading__icon"><Icon name="sliders-horizontal" /></span>
        <div><strong>Applies to</strong><small>Choose your fare setup</small></div>
      </div>
      <label className="fs-nav__field">
        <span>Brand</span>
        <select className="ds-select" value={fareScope.brand} onChange={(e) => {
          const b = BRANDS.find((x) => x.id === e.target.value);
          if (!b) return changeScope({ brand: "common", service: WORKSPACE_SERVICES.includes(fareScope.service) ? fareScope.service : WORKSPACE_SERVICES[0] });
          const supported = BRAND_SUPPORTED_SERVICES[b.id];
          changeScope({ brand: b.id, service: supported.includes(fareScope.service) ? fareScope.service : supported[0] });
        }}>
          {BRANDS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          <option value="common">All brands (shared)</option>
        </select>
      </label>
      <label className="fs-nav__field">
        <span>Service</span>
        <select className="ds-select" value={pickupDrop ? PICKUP_DROP : fareScope.service} onChange={(e) => {
          if (e.target.value === PICKUP_DROP) return selectPickupDrop();
          const s = availableServices.find((x) => x === e.target.value);
          if (!s) return;
          setPickupDrop(false);
          changeScope({ ...fareScope, service: s });
        }}>
          {availableServices.flatMap((service) => (service === "Local Rental" ? [service, PICKUP_DROP] : [service])).map((service) => <option key={service} value={service}>{serviceLabel(service)}</option>)}
        </select>
      </label>
      {tab === "Brand & service fares" && !pickupDrop && fuelApplies && (
        <label className="fs-nav__field">
          <span>Fuel</span>
          <select className="ds-select" value={fareFuel} onChange={(e) => changeFuel(e.target.value === "cng" ? "cng" : "petrol")}>
            <option value="petrol">Diesel / Petrol</option>
            <option value="cng">CNG</option>
          </select>
        </label>
      )}
    </>
  ) : null;
  const renderNavGroup = (g: { title: string; items: NavItem[] }) => (
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
  );
  // The four pages that follow the Brand / Service choice live in the same box as the choice; everything else is a separate box below.
  const scopedGroup = navGroups[0];
  const otherGroups = navGroups.slice(1);

  return (
    <div className="ds-page-body fare-reference u27-settings-page u11-settings-page">
      <Toast toast={toast} />
      {loadError && <div className="ds-error mb-4" role="alert"><Icon name="circle-alert" />Saved settings could not be loaded: {loadError}. Check your pricing access and reload.</div>}
      <PageHeader title="Service & Fare Settings" />

      <div className="fs-shell">
        <aside className="fs-side">
        <nav className="fs-nav fs-nav__scope" aria-label="Fare settings for this brand and service">
          {scopeFields}
          <div className="fs-nav__group--scoped">{renderNavGroup(scopedGroup)}</div>
        </nav>
        <nav className="fs-nav" aria-label="Other fare settings sections">
          {otherGroups.map(renderNavGroup)}
        </nav>
        </aside>
        <div className="fs-main">
      {!inlineKind && <>
      {tab === "Brand & service fares" && pickupDrop && <LocalFares only="Pickup & Drop" initialTab="Pickup & Drop" initialCity={sel.city} onToast={show} vehicles={vehicles} />}
      {tab === "Brand & service fares" && !pickupDrop && <div className="space-y-4">
        {/* One table for every service: rates down the side, vehicles across the top (Hourly Rental: one row per package). */}
        <FareMatrix scope={fareScope} fuel={fuelApplies ? fareFuel : "petrol"}
          vehicles={vehicles} cards={vehicleCards.map((card) => ({ cls: card.cls, name: card.name, categoryId: activeCats.length ? card.categoryId : undefined, cng: card.cng }))}
          onDirtyChange={dirty => { workspaceDirty.current = dirty; }} onBusyChange={busy => { workspaceBusy.current = busy; }} />
        {/* Then the settings that sit on top of these rates, in the order a fare is built: packages, how extras are billed, pet charge, display price. */}
        {fareScope.service === "Round Trip" ? <TimeBasedRoundTripCard vehicles={vehicles} /> : null}
        <NightAllowanceCard />
        <DisplayMarkupCard scope={fareScope} />
        <FareAdjustmentCard />
      </div>}
      {tab === "Platform fee" && <PlatformFeeCard />}
      {tab === "Payment options" && <PaymentOptionsCard />}
      {tab === "GST calculation" && <div>
        <FareGstSettings key={fareScope.brand + ":" + fareScope.service} scope={fareScope} onDirtyChange={value => { gstDirty.current = value; }} onBusyChange={value => { gstBusy.current = value; }} />
      </div>}
      {isRuleTab && (
        tab === "Cab types" && cabSection === "Vehicle categories" ? (
          <section className="u27-settings-surface" id="fare-settings-panel">
            <VehicleCategoriesPage embedded />
          </section>
        ) : (
          // Booking rules on one page, no side drawer: places and cabs, price changes, then date-based rules. Everything is edited in place.
          <div id="fare-settings-panel" className="fm-rules-page">
            <nav className="fm-jump" aria-label="Sections on this page">
              <div className="fm-seg" role="group" aria-label="Jump to">
                <button type="button" onClick={() => jump("rules-places")}><Icon name="map-pin" size={13} /> Places &amp; cabs</button>
                <button type="button" onClick={() => jump("rules-prices")}><Icon name="indian-rupee" size={13} /> Price changes</button>
                <button type="button" onClick={() => jump("rules-dates")}><Icon name="calendar-clock" size={13} /> Date-based rules <span className="fm-count">{special.length}</span></button>
              </div>
            </nav>
            <details className="fm-how fm-details">
              <summary>How these rules combine</summary>
              <ol>
                <li><b>A rule saved for this brand and service</b> beats one shared by all brands.</li>
                <li><b>The most specific place wins:</b> an area beats its city, a city beats its state, a state beats everywhere.</li>
                <li>Then a rule for this <b>service</b> beats an all-services rule, a rule naming <b>packages</b> beats an all-packages rule, and the <b>higher priority</b> wins.</li>
                <li>A rule with <b>dates</b> only runs while its dates are on. Afterwards the places table applies again.</li>
              </ol>
            </details>
            <div className="space-y-4">
              <BookingRulesGrid rules={scopedRules} isOwn={ownsRule} fareScope={fareScope} vehicles={vehicles}
                canEdit={canEdit} loaded={loaded} loadError={loadError} stateName={stateName}
                stateOptions={stateOptions} citiesOf={citiesOf} onToast={show} />
              <PriceChangeRules rules={rules.filter((r) => r.kind === "pricing" && (!r.brand || r.brand === scopeBrand))} fareScope={fareScope}
                canEdit={canEdit} loaded={loaded} loadError={loadError} stateName={stateName}
                stateOptions={stateOptions} citiesOf={citiesOf} onToast={show} />
              <DateRules rules={special} allRules={scopedRules.filter((r) => r.status !== "Removed")} isOwn={ownsRule} fareScope={fareScope} vehicles={vehicles}
                canEdit={canEdit} loaded={loaded} loadError={loadError} stateName={stateName}
                stateOptions={stateOptions} citiesOf={citiesOf} onToast={show} />
            </div>
          </div>
        )
      )}
      </>}
      {sheet?.kind === "fixed" && <FixedRouteFares key={fareScope.brand + ":" + fareScope.service} scope={fareScope} onToast={show} />}
      {sheet?.kind === "history" && (
        <InlineModals value={true}>
          <HistorySheet rules={rules.filter(inFareScope)} onClose={() => setSheet(null)} />
        </InlineModals>
      )}

        </div>
      </div>

    </div>
  );
}

function HistorySheet({ rules, onClose }: { rules: ServiceRule[]; onClose: () => void }) {
  const rows = rules.flatMap((r) => (r.history ?? []).map((h) => ({ ...h, rule: r }))).sort((a, b) => (b.at?.toMillis?.() ?? 0) - (a.at?.toMillis?.() ?? 0));
  const [open, setOpen] = useState<(typeof rows)[number] | null>(null);
  return (
    <Modal title="Change history" onClose={onClose} wide footNote="Read-only change history">
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

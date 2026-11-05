import { useState, useEffect, useMemo } from "react";
import { MasterLocation, LocationType, TravelService, TourPackage } from "../types";
import { subscribeLocations, subscribeServices, subscribeTourPackages } from "../services/adminFirestoreService";
import {
  LOCATION_TYPES,
  LocationActionError,
  deleteLocation,
  findLocationReferences,
  saveLocation,
  seedBuiltInCities,
  setLocationStatus,
  validateLocation,
  type LocationField,
  type LocationForm,
  type LocationReferences,
} from "../services/locationService";
import { auth } from "../services/firebase";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";

const STATES_LIST = [
  "Tamil Nadu",
  "Puducherry",
  "Karnataka",
  "Kerala",
  "Andhra Pradesh",
  "Telangana",
  "Maharashtra",
  "Goa",
  "Other",
];

const TYPE_BADGES: Record<LocationType, { bg: string; text: string; border: string }> = {
  City: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  "Area / Locality": { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
  Airport: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  "Railway Station": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  "Bus Stand": { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  Landmark: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  "Tourist Place": { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
  Other: { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200" },
};

type FormTab = "basic" | "geo" | "services";
const TAB_FIELDS: Record<FormTab, LocationField[]> = {
  basic: ["name", "code", "type", "parentLocationId"],
  geo: ["state", "city", "pincode", "lat", "lng"],
  services: ["usage", "displayOrder"],
};
const actionError = (e: unknown) => (e instanceof LocationActionError ? e.message : "Something went wrong. Please try again.");

const emptyForm = (serviceIds: string[], displayOrder: number): LocationForm => ({
  name: "",
  code: "",
  type: "City",
  state: "Tamil Nadu",
  district: "",
  city: "",
  area: "",
  pincode: "",
  address: "",
  parentLocationId: "",
  lat: "",
  lng: "",
  placeId: "",
  pickupEnabled: true,
  dropEnabled: true,
  onlineBookingEnabled: true,
  adminBookingEnabled: true,
  serviceIds,
  status: "Active",
  displayOrder,
});

export default function Locations() {
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [services, setServices] = useState<TravelService[]>([]);
  const [packages, setPackages] = useState<TourPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Filters & Controls
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [stateFilter, setStateFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [sortBy, setSortBy] = useState<"name" | "city" | "type" | "displayOrder">("displayOrder");
  const [viewMode, setViewMode] = useState<"table" | "grid">("grid");

  // Modal Form State
  const [showModal, setShowModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<MasterLocation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LocationField, string>>>({});
  const [activeTab, setActiveTab] = useState<FormTab>("basic");
  const [formData, setFormData] = useState<LocationForm>(emptyForm([], 1));

  // Delete dialog
  const [deletingLocation, setDeletingLocation] = useState<MasterLocation | null>(null);
  const [deleteRefs, setDeleteRefs] = useState<LocationReferences | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const { toast, show: showToast } = useToast();
  const [seeding, setSeeding] = useState(false);
  const handleSeedCities = async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      const n = await seedBuiltInCities(locations, auth.currentUser?.uid || "");
      showToast(n ? `${n} cities added and saved to Firebase.` : "All built-in cities are already in Locations.");
    } catch (err) {
      showToast(actionError(err), "error");
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const fail = (m: string) => {
      setLoadError(m);
      setLoading(false);
    };
    const unsubs = [
      subscribeLocations((data) => {
        setLocations(data);
        setLoading(false);
      }, fail),
      subscribeServices(setServices, fail),
      subscribeTourPackages(setPackages, fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  const stats = useMemo(() => {
    const total = locations.length;
    const active = locations.filter((l) => l.status === "Active").length;
    const cities = new Set(locations.map((l) => (l.city || "").trim().toLowerCase()).filter(Boolean)).size;
    const transportHubs = locations.filter((l) => ["Airport", "Railway Station", "Bus Stand"].includes(l.type)).length;
    return { total, active, cities, transportHubs };
  }, [locations]);

  const filteredLocations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return locations
      .filter((loc) => {
        const matchSearch =
          !q ||
          [loc.name, loc.code, loc.city, loc.district, loc.state, loc.area, loc.pincode].some((v) => (v || "").toLowerCase().includes(q));
        const matchType = typeFilter === "All" || loc.type === typeFilter;
        const matchState = stateFilter === "All" || loc.state === stateFilter;
        const matchStatus = statusFilter === "All" || loc.status === statusFilter;
        return matchSearch && matchType && matchState && matchStatus;
      })
      .sort((a, b) => {
        if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
        if (sortBy === "city") return (a.city || "").localeCompare(b.city || "");
        if (sortBy === "type") return (a.type || "").localeCompare(b.type || "");
        return (a.displayOrder || 99) - (b.displayOrder || 99);
      });
  }, [locations, search, typeFilter, stateFilter, statusFilter, sortBy]);

  const tabHasError = (tab: FormTab) => TAB_FIELDS[tab].some((f) => fieldErrors[f]);
  const errNode = (f: LocationField) => (fieldErrors[f] ? <p className="text-[10px] text-red-600 mt-1">{fieldErrors[f]}</p> : null);

  const openForm = (loc: MasterLocation | null) => {
    setEditingLocation(loc);
    setFormData(
      loc
        ? {
            name: loc.name || "",
            code: loc.code || "",
            type: loc.type || "City",
            state: loc.state || "",
            district: loc.district || "",
            city: loc.city || "",
            area: loc.area || "",
            pincode: loc.pincode || "",
            address: loc.address || "",
            parentLocationId: loc.parentLocationId || "",
            lat: typeof loc.lat === "number" ? String(loc.lat) : "",
            lng: typeof loc.lng === "number" ? String(loc.lng) : "",
            placeId: loc.placeId || "",
            pickupEnabled: loc.pickupEnabled !== false,
            dropEnabled: loc.dropEnabled !== false,
            onlineBookingEnabled: loc.onlineBookingEnabled !== false,
            adminBookingEnabled: loc.adminBookingEnabled !== false,
            serviceIds: loc.serviceIds || [],
            status: loc.status || "Active",
            displayOrder: loc.displayOrder || 1,
          }
        : emptyForm(
            services.filter((s) => s.status === "Active").map((s) => s.id),
            locations.reduce((m, l) => Math.max(m, l.displayOrder || 0), 0) + 1,
          ),
    );
    setFormError(null);
    setFieldErrors({});
    setActiveTab("basic");
    setShowModal(true);
  };
  const handleOpenCreate = () => openForm(null);
  const handleOpenEdit = (loc: MasterLocation) => openForm(loc);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setFormError(null);
    const errors = validateLocation(formData, locations, editingLocation?.id ?? null);
    setFieldErrors(errors);
    const keys = Object.keys(errors) as LocationField[];
    if (keys.length) {
      setFormError(`Please fix: ${keys.map((k) => errors[k]).join(" ")}`);
      const tab = (Object.keys(TAB_FIELDS) as FormTab[]).find((t) => TAB_FIELDS[t].includes(keys[0]));
      if (tab) setActiveTab(tab);
      return;
    }
    setIsSubmitting(true);
    try {
      const { renamed } = await saveLocation(formData, editingLocation, locations, auth.currentUser?.uid || "");
      setShowModal(false);
      showToast(
        editingLocation
          ? `Location "${formData.name.trim()}" updated${renamed ? ` (${renamed} linked record${renamed === 1 ? "" : "s"} renamed)` : ""}.`
          : `Location "${formData.name.trim()}" created.`,
      );
    } catch (err) {
      setFormError(actionError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const changeStatus = async (loc: MasterLocation, status: "Active" | "Inactive") => {
    if (statusBusyId) return;
    setStatusBusyId(loc.id);
    try {
      await setLocationStatus(loc, status);
      showToast(`Location "${loc.name}" is now ${status}.`);
    } catch (err) {
      showToast(actionError(err), "error");
    } finally {
      setStatusBusyId(null);
    }
  };
  const handleToggleStatus = (loc: MasterLocation) => changeStatus(loc, loc.status === "Active" ? "Inactive" : "Active");

  const handlePromptDelete = async (loc: MasterLocation) => {
    setDeletingLocation(loc);
    setDeleteRefs(null);
    setDeleteError(null);
    try {
      setDeleteRefs(await findLocationReferences(loc, packages));
    } catch (err) {
      setDeleteError(actionError(err));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingLocation || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteLocation(deletingLocation, packages);
      showToast(`Location "${deletingLocation.name}" removed.`);
      setDeletingLocation(null);
    } catch (err) {
      setDeleteError(actionError(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const blockingRefs = deleteRefs ? deleteRefs.fareRules + deleteRefs.coupons + deleteRefs.children : 0;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink tracking-tight">Locations</h1>
          <p className="text-xs text-muted mt-0.5">
            Manage master cities, airports, railway stations, bus stands, and pickup points across Tamil Nadu & beyond.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSeedCities}
            disabled={seeding}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-line text-ink bg-white hover:bg-gray-50 transition-all disabled:opacity-50"
          >
            {seeding ? "Adding cities…" : "Add built-in cities"}
          </button>
          <button
            onClick={handleOpenCreate}
            className="px-4 py-2 text-xs font-semibold text-white rounded-xl hover:opacity-90 transition-all shadow-md flex items-center gap-2"
            style={{ background: "#c1232c" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Location
          </button>
        </div>
      </div>

      {/* Summary Dashboard Cards (Only when real data exists) */}
      {locations.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white p-4 rounded-2xl border border-line shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 text-brand flex items-center justify-center font-bold">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <div className="text-[11px] font-medium text-muted">Total Locations</div>
              <div className="text-lg font-bold text-ink">{stats.total}</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-line shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <div className="text-[11px] font-medium text-muted">Cities & Towns</div>
              <div className="text-lg font-bold text-ink">{stats.cities}</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-line shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </div>
            <div>
              <div className="text-[11px] font-medium text-muted">Transport Hubs</div>
              <div className="text-lg font-bold text-ink">{stats.transportHubs}</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-line shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="text-[11px] font-medium text-muted">Active Locations</div>
              <div className="text-lg font-bold text-ink">{stats.active}</div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-line p-12 text-center shadow-xs">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs text-muted">Loading Master Locations from Firestore…</p>
        </div>
      ) : locations.length === 0 ? (
        /* Empty State Placeholder (Matches Screenshot & Prompt Instructions) */
        <div className="bg-white rounded-2xl border border-line p-10 sm:p-16 text-center max-w-2xl mx-auto my-8 shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-red-50 text-brand flex items-center justify-center mx-auto mb-4 border border-red-100 shadow-inner">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-ink mb-2">No locations found.</h2>
          <p className="text-xs text-muted mb-6 leading-relaxed max-w-md mx-auto">
            Add the cities, airports, stations and pickup points your services operate from.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={handleOpenCreate}
              className="w-full sm:w-auto px-6 py-2.5 text-xs font-semibold text-white rounded-xl hover:opacity-90 transition-all shadow-md"
              style={{ background: "#c1232c" }}
            >
              Add Location
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-line p-4 sm:p-5 space-y-4 shadow-xs">
          {/* Controls Bar: Search, Filters, Sort, View Toggle */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search locations by name, code, city, district, pincode…"
                className="w-full pl-9 pr-4 py-2 border border-line rounded-xl text-xs focus:outline-none focus:border-brand transition-colors"
              />
            </div>

            {/* Filter Selects */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Type Filter */}
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-2 border border-line rounded-xl text-xs bg-white text-ink focus:outline-none focus:border-brand"
              >
                <option value="All">All Types</option>
                {LOCATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              {/* State Filter */}
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                className="px-3 py-2 border border-line rounded-xl text-xs bg-white text-ink focus:outline-none focus:border-brand"
              >
                <option value="All">All States</option>
                {STATES_LIST.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-line rounded-xl text-xs bg-white text-ink focus:outline-none focus:border-brand"
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>

              {/* Sort By */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-2 border border-line rounded-xl text-xs bg-white text-ink focus:outline-none focus:border-brand"
              >
                <option value="displayOrder">Sort: Order</option>
                <option value="name">Sort: Name</option>
                <option value="city">Sort: City</option>
                <option value="type">Sort: Type</option>
              </select>

              {/* View Switcher */}
              <div className="flex border border-line rounded-xl p-0.5 bg-gray-50">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${
                    viewMode === "grid" ? "bg-white text-ink shadow-xs" : "text-muted hover:text-ink"
                  }`}
                  title="Grid view"
                >
                  Grid
                </button>
                <button
                  onClick={() => setViewMode("table")}
                  className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${
                    viewMode === "table" ? "bg-white text-ink shadow-xs" : "text-muted hover:text-ink"
                  }`}
                  title="Table view"
                >
                  Table
                </button>
              </div>
            </div>
          </div>

          {/* Results Info */}
          <div className="text-[11px] text-muted flex items-center justify-between border-t border-line pt-3">
            <span>
              Showing <strong className="text-ink">{filteredLocations.length}</strong> of {locations.length} location records
            </span>
          </div>

          {/* Locations Directory Display */}
          {filteredLocations.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-line rounded-xl bg-gray-50">
              <p className="text-xs text-muted">No locations match your current search or filters.</p>
              <button
                onClick={() => {
                  setSearch("");
                  setTypeFilter("All");
                  setStateFilter("All");
                  setStatusFilter("All");
                }}
                className="mt-2 text-xs font-semibold text-brand hover:underline"
              >
                Clear all filters
              </button>
            </div>
          ) : viewMode === "grid" ? (
            /* Grid View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
              {filteredLocations.map((loc) => {
                const badge = TYPE_BADGES[loc.type] || TYPE_BADGES.Other;
                return (
                  <div
                    key={loc.id}
                    className="bg-white border border-line rounded-2xl p-4 space-y-3 hover:border-gray-300 transition-all hover:shadow-sm flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      {/* Top Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${badge.bg} ${badge.text} ${badge.border}`}>
                              {loc.type}
                            </span>
                            {loc.code && (
                              <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-gray-100 text-gray-700 rounded border border-gray-200">
                                {loc.code}
                              </span>
                            )}
                          </div>
                          <h3 className="text-sm font-bold text-ink mt-1.5 leading-snug">{loc.name}</h3>
                        </div>

                        <span
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${
                            loc.status === "Active"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-gray-100 text-gray-600 border-gray-200"
                          }`}
                        >
                          {loc.status}
                        </span>
                      </div>

                      {/* City & Geography */}
                      <div className="text-xs text-muted space-y-1">
                        <div className="flex items-center gap-1 text-ink font-medium">
                          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          </svg>
                          <span>
                            {loc.city}
                            {loc.district && `, ${loc.district}`} ({loc.state})
                          </span>
                        </div>

                        {loc.area && (
                          <div className="text-[11px] text-muted pl-4">Locality: {loc.area}</div>
                        )}

                        {loc.address && (
                          <p className="text-[11px] text-muted line-clamp-2 pl-4 italic">
                            "{loc.address}"
                          </p>
                        )}
                      </div>

                      {/* Coordinates badge if available */}
                      {(loc.lat !== undefined || loc.lng !== undefined) && (
                        <div className="text-[10px] font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded border border-gray-200 inline-block">
                          Lat: {loc.lat ?? "N/A"}, Lng: {loc.lng ?? "N/A"}
                        </div>
                      )}

                      {/* Availability Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        {loc.pickupEnabled && (
                          <span className="px-2 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 rounded border border-emerald-100 font-medium">
                            ✓ Pickup
                          </span>
                        )}
                        {loc.dropEnabled && (
                          <span className="px-2 py-0.5 text-[10px] bg-blue-50 text-blue-700 rounded border border-blue-100 font-medium">
                            ✓ Drop
                          </span>
                        )}
                        {loc.onlineBookingEnabled && (
                          <span className="px-2 py-0.5 text-[10px] bg-purple-50 text-purple-700 rounded border border-purple-100 font-medium">
                            ✓ Online Booking
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Card Actions Footer */}
                    <div className="flex items-center justify-between pt-3 border-t border-line">
                      <button
                        onClick={() => handleToggleStatus(loc)}
                        className={`text-[11px] font-semibold ${
                          loc.status === "Active" ? "text-amber-600 hover:text-amber-800" : "text-emerald-600 hover:text-emerald-800"
                        }`}
                      >
                        {loc.status === "Active" ? "Deactivate" : "Activate"}
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenEdit(loc)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-ink bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handlePromptDelete(loc)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Table View */
            <div className="overflow-x-auto border border-line rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-line text-muted font-semibold">
                  <tr>
                    <th className="py-3 px-3">Location</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3">City / State</th>
                    <th className="py-3 px-3">Pincode</th>
                    <th className="py-3 px-3">Pickup / Drop</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredLocations.map((loc) => {
                    const badge = TYPE_BADGES[loc.type] || TYPE_BADGES.Other;
                    return (
                      <tr key={loc.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="py-3 px-3 font-semibold text-ink">
                          <div>{loc.name}</div>
                          {loc.code && <div className="text-[10px] font-mono text-gray-500">{loc.code}</div>}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${badge.bg} ${badge.text} ${badge.border}`}>
                            {loc.type}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-ink">
                          {loc.city}, {loc.state}
                        </td>
                        <td className="py-3 px-3 text-muted font-mono">{loc.pincode || "—"}</td>
                        <td className="py-3 px-3">
                          <div className="flex gap-1">
                            {loc.pickupEnabled && <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">Pickup</span>}
                            {loc.dropEnabled && <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">Drop</span>}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${
                              loc.status === "Active"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-gray-100 text-gray-600 border-gray-200"
                            }`}
                          >
                            {loc.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right space-x-2">
                          <button
                            onClick={() => handleOpenEdit(loc)}
                            className="text-ink hover:underline font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handlePromptDelete(loc)}
                            className="text-red-600 hover:underline font-semibold"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Location Modal Form */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden border border-line max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-line flex items-center justify-between bg-gray-50/50">
              <div>
                <h3 className="text-base font-bold text-ink">
                  {editingLocation ? "Edit Master Location" : "Add Master Location"}
                </h3>
                <p className="text-[11px] text-muted">
                  Configure reusable location data for bookings, services, and tour packages.
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Form Tabs */}
            <div className="flex border-b border-line bg-white px-5 pt-2 gap-4 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab("basic")}
                className={`pb-2.5 border-b-2 transition-all ${
                  activeTab === "basic"
                    ? "border-brand text-brand"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                1. Basic Info & Type
                {tabHasError("basic") && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-red-600 align-middle" aria-label="has errors" />}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("geo")}
                className={`pb-2.5 border-b-2 transition-all ${
                  activeTab === "geo"
                    ? "border-brand text-brand"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                2. Geography & Coordinates
                {tabHasError("geo") && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-red-600 align-middle" aria-label="has errors" />}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("services")}
                className={`pb-2.5 border-b-2 transition-all ${
                  activeTab === "services"
                    ? "border-brand text-brand"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                3. Availability & Services
                {tabHasError("services") && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-red-600 align-middle" aria-label="has errors" />}
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} noValidate className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {formError}
                </div>
              )}

              {/* TAB 1: BASIC INFO */}
              {activeTab === "basic" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Location Name *
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g. Chennai International Airport (MAA), Madurai Jn"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                        required
                      />
                      {errNode("name")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Location Type *
                      </label>
                      <select
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value as LocationType })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none"
                      >
                        {LOCATION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Location Code / IATA
                      </label>
                      <input
                        type="text"
                        value={formData.code}
                        onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                        placeholder="e.g. MAA, CJB, MDU"
                        className="w-full p-2.5 border border-line rounded-xl text-xs uppercase font-mono focus:border-brand focus:outline-none"
                      />
                      {errNode("code")}
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Parent Location (Optional Hierarchy)
                      </label>
                      <select
                        value={formData.parentLocationId}
                        onChange={(e) => setFormData({ ...formData, parentLocationId: e.target.value })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none"
                      >
                        <option value="">No Parent (Top-level)</option>
                        {locations
                          .filter((l) => !editingLocation || l.id !== editingLocation.id)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name} ({l.city}, {l.state})
                            </option>
                          ))}
                      </select>
                      {errNode("parentLocationId")}
                      <span className="text-[10px] text-muted mt-0.5 block">
                        Allows linking an airport or bus stand to a master parent city.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: GEOGRAPHY & COORDINATES */}
              {activeTab === "geo" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        State *
                      </label>
                      <select
                        value={formData.state}
                        onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none"
                      >
                        {STATES_LIST.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      {errNode("state")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        District / Region
                      </label>
                      <input
                        type="text"
                        value={formData.district}
                        onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                        placeholder="e.g. Chengalpattu, Coimbatore, Erode"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        City / Town *
                      </label>
                      <input
                        type="text"
                        value={formData.city}
                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                        placeholder="e.g. Chennai, Coimbatore, Salem"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                        required
                      />
                      {errNode("city")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Area / Locality
                      </label>
                      <input
                        type="text"
                        value={formData.area}
                        onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                        placeholder="e.g. Meenambakkam, Peelamedu, Gandhipuram"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Pincode
                      </label>
                      <input
                        type="text"
                        value={formData.pincode}
                        onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                        placeholder="e.g. 600027, 641014"
                        className="w-full p-2.5 border border-line rounded-xl text-xs font-mono focus:border-brand focus:outline-none"
                      />
                      {errNode("pincode")}
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Full Address Description
                      </label>
                      <textarea
                        rows={2}
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        placeholder="Full street address, landmark description..."
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                    </div>

                    {/* Coordinates */}
                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Latitude (-90 to +90)
                      </label>
                      <input
                        type="text"
                        value={formData.lat}
                        onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
                        placeholder="e.g. 12.9941"
                        className="w-full p-2.5 border border-line rounded-xl text-xs font-mono focus:border-brand focus:outline-none"
                      />
                      {errNode("lat")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Longitude (-180 to +180)
                      </label>
                      <input
                        type="text"
                        value={formData.lng}
                        onChange={(e) => setFormData({ ...formData, lng: e.target.value })}
                        placeholder="e.g. 80.1709"
                        className="w-full p-2.5 border border-line rounded-xl text-xs font-mono focus:border-brand focus:outline-none"
                      />
                      {errNode("lng")}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: AVAILABILITY & SERVICES */}
              {activeTab === "services" && (
                <div className="space-y-4">
                  <div className="p-3 bg-gray-50 border border-line rounded-xl space-y-2">
                    <div className="text-[11px] font-bold text-ink">Booking Availability Config</div>
                    {errNode("usage")}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                      <label className="flex items-center gap-2 cursor-pointer p-2 bg-white rounded-lg border border-line">
                        <input
                          type="checkbox"
                          checked={formData.pickupEnabled}
                          onChange={(e) => setFormData({ ...formData, pickupEnabled: e.target.checked })}
                          className="accent-brand"
                        />
                        <span className="text-ink font-medium">Pickup Allowed</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer p-2 bg-white rounded-lg border border-line">
                        <input
                          type="checkbox"
                          checked={formData.dropEnabled}
                          onChange={(e) => setFormData({ ...formData, dropEnabled: e.target.checked })}
                          className="accent-brand"
                        />
                        <span className="text-ink font-medium">Drop Allowed</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer p-2 bg-white rounded-lg border border-line">
                        <input
                          type="checkbox"
                          checked={formData.onlineBookingEnabled}
                          onChange={(e) => setFormData({ ...formData, onlineBookingEnabled: e.target.checked })}
                          className="accent-brand"
                        />
                        <span className="text-ink font-medium">Online Customer Booking</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer p-2 bg-white rounded-lg border border-line">
                        <input
                          type="checkbox"
                          checked={formData.adminBookingEnabled}
                          onChange={(e) => setFormData({ ...formData, adminBookingEnabled: e.target.checked })}
                          className="accent-brand"
                        />
                        <span className="text-ink font-medium">Admin Booking Only</span>
                      </label>
                    </div>
                  </div>

                  {/* Status & Display Order */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Master Status
                      </label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none"
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Display Order Sequence
                      </label>
                      <input
                        type="number"
                        value={formData.displayOrder}
                        onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value) || 1 })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                      {errNode("displayOrder")}
                    </div>
                  </div>

                  {/* Associated Services */}
                  <div>
                    <label className="block text-[11px] font-semibold text-ink mb-1">
                      Associated Travel Services
                    </label>
                    <div className="border border-line rounded-xl p-3 bg-white space-y-1.5 max-h-36 overflow-y-auto">
                      {services.length === 0 ? (
                        <div className="text-[11px] text-muted">No travel services configured yet.</div>
                      ) : (
                        services.map((srv) => (
                          <label key={srv.id} className="flex items-center gap-2 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={formData.serviceIds.includes(srv.id)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...formData.serviceIds, srv.id]
                                  : formData.serviceIds.filter((id) => id !== srv.id);
                                setFormData({ ...formData, serviceIds: next });
                              }}
                              className="accent-brand"
                            />
                            <span className="text-ink font-medium">{srv.name}</span>
                            <span className="text-[10px] text-muted">({srv.serviceType})</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Modal Footer */}
              <div className="pt-4 border-t border-line flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {activeTab !== "basic" && (
                    <button
                      type="button"
                      onClick={() => setActiveTab(activeTab === "services" ? "geo" : "basic")}
                      className="px-3 py-2 border border-line text-ink rounded-xl font-semibold text-xs"
                    >
                      ← Back
                    </button>
                  )}
                  {activeTab !== "services" && (
                    <button
                      type="button"
                      onClick={() => setActiveTab(activeTab === "basic" ? "geo" : "services")}
                      className="px-3 py-2 bg-gray-100 text-ink rounded-xl font-semibold text-xs hover:bg-gray-200"
                    >
                      Next Step →
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 border border-line text-muted rounded-xl font-semibold text-xs hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 text-white font-semibold rounded-xl text-xs hover:opacity-90 transition-all shadow-md flex items-center gap-1.5"
                    style={{ background: "#c1232c" }}
                  >
                    {isSubmitting && (
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    )}
                    {editingLocation ? "Save Changes" : "Create Location"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletingLocation && (
        <Modal
          title={`Delete "${deletingLocation.name}"?`}
          onClose={() => setDeletingLocation(null)}
          busy={deleteBusy}
          footer={
            <>
              <button onClick={() => setDeletingLocation(null)} disabled={deleteBusy} className="px-4 py-2 border border-line text-ink text-xs font-semibold rounded-xl disabled:opacity-50">
                Cancel
              </button>
              {deletingLocation.status === "Active" && (
                <button
                  onClick={() => {
                    void changeStatus(deletingLocation, "Inactive");
                    setDeletingLocation(null);
                  }}
                  disabled={deleteBusy}
                  className="px-4 py-2 bg-amber-600 text-white text-xs font-semibold rounded-xl hover:bg-amber-700 disabled:opacity-50"
                >
                  Deactivate Instead
                </button>
              )}
              <button
                onClick={() => void handleConfirmDelete()}
                disabled={deleteBusy || !deleteRefs || blockingRefs > 0}
                className="px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50"
              >
                {deleteBusy ? "Deleting…" : "Confirm Delete"}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-xs text-body">
            {!deleteRefs && !deleteError && <p>Checking where this location is used…</p>}
            {deleteRefs && blockingRefs > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl">
                Used by {deleteRefs.fareRules} fare rule(s), {deleteRefs.coupons} coupon(s) and {deleteRefs.children} sub-location(s). Update those records or deactivate this location instead.
              </div>
            )}
            {deleteRefs && blockingRefs === 0 && (
              <p>
                No fare rules, coupons or sub-locations use this location.
                {deleteRefs.packages > 0 ? ` ${deleteRefs.packages} tour package(s) mention it by name and keep their text.` : ""} Past bookings keep their recorded addresses.
              </p>
            )}
            {deleteError && <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl font-semibold">{deleteError}</div>}
          </div>
        </Modal>
      )}    </div>
  );
}

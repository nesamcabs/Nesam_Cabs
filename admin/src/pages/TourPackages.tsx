import { useEffect, useMemo, useState } from "react";
import type { ItineraryDay, MasterLocation, PackageDeparture, TourPackage, Vendor, VehicleCategory } from "../types";
import { subscribeLocations, subscribeTourPackages, subscribeVehicleCategories, subscribeVendors } from "../services/adminFirestoreService";
import {
  DEPARTURE_STATUSES,
  PRICING_MODELS,
  TourPackageActionError,
  deletePackage,
  duplicatePackage,
  savePackage,
  setPackageStatus,
  upcomingDepartures,
  validatePackage,
  type PackageField,
  type PackageForm,
  type PackageStatus,
} from "../services/tourPackageService";
import { normalizeVendorStatus } from "../utils/vendorStatus";
import { auth } from "../services/firebase";
import TimeSelect12 from "../components/TimeSelect12";
import { ConfirmDialog, ErrorBanner, Toast, useToast } from "../components/Feedback";

type FormTab = "basic" | "itinerary" | "pricing" | "availability" | "inclusions";

const TAB_FIELDS: Record<FormTab, PackageField[]> = {
  basic: ["name", "code", "slug", "destinations", "durationDays", "durationNights", "coverImageUrl", "displayOrder"],
  itinerary: ["itinerary"],
  pricing: ["pricingModel", "basePrice", "offerPrice", "adultPrice", "childPrice", "allowedVehicleCategoryIds"],
  availability: ["departures"],
  inclusions: ["seoTitle", "seoDescription"],
};

const formatCurrency = (n: number) => "₹" + (n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const errText = (e: unknown) => (e instanceof TourPackageActionError ? e.message : "Something went wrong. Please try again.");
const vendorLabel = (v: Vendor) => v.companyName || v.name || v.id;

interface FormState extends Omit<PackageForm, "inclusions" | "exclusions"> {
  inclusionsText: string;
  exclusionsText: string;
}

const emptyForm = (displayOrder: number): FormState => ({
  name: "",
  code: "",
  slug: "",
  shortDescription: "",
  fullDescription: "",
  destinations: [],
  durationDays: 1,
  durationNights: 0,
  itinerary: [],
  pricingModel: "",
  basePrice: 0,
  offerPrice: 0,
  adultPrice: 0,
  childPrice: 0,
  allowedVehicleCategoryIds: [],
  preferredVendorId: "",
  departures: [],
  inclusionsText: "",
  exclusionsText: "",
  coverImageUrl: "",
  status: "Draft",
  featured: false,
  displayOrder,
  seoTitle: "",
  seoDescription: "",
});

const formFrom = (p: TourPackage): FormState => {
  const stops = [...(p.destinations || [])];
  if (p.startingLocation && stops[0] !== p.startingLocation) stops.unshift(p.startingLocation);
  if (p.endingLocation && stops[stops.length - 1] !== p.endingLocation) stops.push(p.endingLocation);
  return {
    name: p.name,
    code: p.code || "",
    slug: p.slug || "",
    shortDescription: p.shortDescription || "",
    fullDescription: p.fullDescription || "",
    destinations: stops,
    durationDays: p.durationDays || 1,
    durationNights: p.durationNights ?? Math.max(0, (p.durationDays || 1) - 1),
    itinerary: p.itinerary || [],
    pricingModel: p.pricingModel || "",
    basePrice: p.basePrice || 0,
    offerPrice: p.offerPrice || 0,
    adultPrice: p.adultPrice || 0,
    childPrice: p.childPrice || 0,
    allowedVehicleCategoryIds: p.allowedVehicleCategoryIds || [],
    preferredVendorId: p.preferredVendorId || "",
    departures: p.departures || [],
    inclusionsText: (p.inclusions || []).join("\n"),
    exclusionsText: (p.exclusions || []).join("\n"),
    coverImageUrl: p.coverImageUrl || "",
    status: p.status || "Draft",
    featured: Boolean(p.featured),
    displayOrder: p.displayOrder || 1,
    seoTitle: p.seoTitle || "",
    seoDescription: p.seoDescription || "",
  };
};

const toPackageForm = (f: FormState): PackageForm => {
  const { inclusionsText, exclusionsText, ...rest } = f;
  return { ...rest, inclusions: inclusionsText.split("\n"), exclusions: exclusionsText.split("\n") };
};

const statusBadge: Record<string, string> = {
  Active: "bg-emerald-500 text-white border-emerald-600",
  Draft: "bg-amber-500 text-white border-amber-600",
  Inactive: "bg-gray-600 text-white border-gray-700",
  Archived: "bg-gray-400 text-white border-gray-500",
};

export default function TourPackages() {
  const [tourPackages, setTourPackages] = useState<TourPackage[]>([]);
  const [vehicleCategories, setVehicleCategories] = useState<VehicleCategory[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [durationFilter, setDurationFilter] = useState<string>("All");
  const [sortBy, setSortBy] = useState<"order" | "name" | "price_asc" | "price_desc">("order");

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TourPackage | null>(null);
  const [formData, setFormData] = useState<FormState>(emptyForm(1));
  const [activeTab, setActiveTab] = useState<FormTab>("basic");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PackageField, string>>>({});
  const [newDestInput, setNewDestInput] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<TourPackage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast, show: showToast } = useToast();

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const fail = (m: string) => {
      setLoadError(m);
      setLoading(false);
    };
    const unsubs = [
      subscribeTourPackages((data) => {
        setTourPackages(data);
        setLoading(false);
      }, fail),
      subscribeVehicleCategories(setVehicleCategories, fail),
      subscribeVendors(setVendors, fail),
      subscribeLocations(setLocations, fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  const stats = useMemo(
    () => ({
      totalCount: tourPackages.filter((p) => p.status !== "Archived").length,
      activeCount: tourPackages.filter((p) => p.status === "Active").length,
      draftCount: tourPackages.filter((p) => p.status === "Draft").length,
      departuresCount: tourPackages.filter((p) => p.status === "Active").reduce((s, p) => s + upcomingDepartures(p).length, 0),
    }),
    [tourPackages],
  );

  const filteredPackages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tourPackages
      .filter((pkg) => {
        if (statusFilter === "All" ? pkg.status === "Archived" : pkg.status !== statusFilter) return false;
        if (durationFilter === "Short" && pkg.durationDays > 3) return false;
        if (durationFilter === "Medium" && (pkg.durationDays < 4 || pkg.durationDays > 7)) return false;
        if (durationFilter === "Long" && pkg.durationDays < 8) return false;
        return (
          !q ||
          pkg.name.toLowerCase().includes(q) ||
          (pkg.code || "").toLowerCase().includes(q) ||
          (pkg.destinations || []).some((d) => d.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "price_asc") return (a.basePrice || 0) - (b.basePrice || 0);
        if (sortBy === "price_desc") return (b.basePrice || 0) - (a.basePrice || 0);
        return (a.displayOrder || 99) - (b.displayOrder || 99);
      });
  }, [tourPackages, search, statusFilter, durationFilter, sortBy]);

  const locationNames = useMemo(
    () => [...new Set(locations.filter((l) => l.status === "Active").flatMap((l) => [l.name, l.city]).filter(Boolean))].sort(),
    [locations],
  );
  const approvedVendors = vendors.filter((v) => normalizeVendorStatus(v) === "APPROVED" || v.id === formData.preferredVendorId);

  const tabHasError = (tab: FormTab) => TAB_FIELDS[tab].some((f) => fieldErrors[f]);
  const errNode = (f: PackageField) => (fieldErrors[f] ? <p className="text-[10px] text-red-600 mt-1">{fieldErrors[f]}</p> : null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setFormData((prev) => ({ ...prev, [k]: v }));

  const openForm = (pkg: TourPackage | null) => {
    setEditing(pkg);
    setFormData(pkg ? formFrom(pkg) : emptyForm(tourPackages.reduce((m, p) => Math.max(m, p.displayOrder || 0), 0) + 1));
    setActiveTab("basic");
    setFormError(null);
    setFieldErrors({});
    setNewDestInput("");
    setShowModal(true);
  };

  const addDestination = () => {
    const v = newDestInput.trim();
    if (!v) return;
    // The same stop twice in a row is a typo; returning to a place later is allowed.
    if (formData.destinations[formData.destinations.length - 1]?.toLowerCase() === v.toLowerCase()) return;
    set("destinations", [...formData.destinations, v]);
    setNewDestInput("");
  };
  const moveDestination = (idx: number, dir: -1 | 1) => {
    const list = [...formData.destinations];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    set("destinations", list);
  };

  const updateDay = (index: number, patch: Partial<ItineraryDay>) =>
    set("itinerary", formData.itinerary.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const updateDeparture = (index: number, patch: Partial<PackageDeparture>) =>
    set("departures", formData.departures.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    const form = toPackageForm(formData);
    const errors = validatePackage(form, tourPackages, editing?.id ?? null);
    setFieldErrors(errors);
    const keys = Object.keys(errors) as PackageField[];
    if (keys.length) {
      setFormError(`Please fix: ${keys.map((k) => errors[k]).join(" ")}`);
      const tab = (Object.keys(TAB_FIELDS) as FormTab[]).find((t) => TAB_FIELDS[t].includes(keys[0]));
      if (tab) setActiveTab(tab);
      return;
    }
    setSaving(true);
    try {
      await savePackage(form, editing, vehicleCategories, vendors, auth.currentUser?.uid || "");
      setShowModal(false);
      showToast(editing ? `Tour package "${form.name.trim()}" updated.` : `Tour package "${form.name.trim()}" created.`);
    } catch (err) {
      setFormError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  const runRowAction = async (pkg: TourPackage, work: () => Promise<string>) => {
    if (busyId) return;
    setBusyId(pkg.id);
    try {
      showToast(await work());
    } catch (err) {
      showToast(errText(err), "error");
    } finally {
      setBusyId(null);
    }
  };
  const changeStatus = (pkg: TourPackage, status: PackageStatus) =>
    runRowAction(pkg, async () => {
      await setPackageStatus(pkg, status);
      return `"${pkg.name}" is now ${status}.`;
    });
  const duplicate = (pkg: TourPackage) =>
    runRowAction(pkg, async () => {
      const { name } = await duplicatePackage(pkg, tourPackages, auth.currentUser?.uid || "");
      return `Duplicated as draft "${name}".`;
    });

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deletePackage(deleteTarget);
      showToast(`Tour package "${deleteTarget.name}" removed.`);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(errText(err));
    } finally {
      setDeleting(false);
    }
  };

  const inputCls = "w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand";
  const numberValue = (n: number) => (n ? String(n) : "");
  const toWhole = (v: string) => Number(v.replace(/[^\d]/g, "").slice(0, 8)) || 0;

  return (
    <div className="p-6 space-y-6">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-ink">Tour Packages</h1>
          <p className="text-[13px] text-muted">Create and manage tour packages with itineraries, pricing, departures and vehicle options.</p>
        </div>
        <button onClick={() => openForm(null)} className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-white rounded-lg shadow-sm hover:opacity-90 transition-all" style={{ background: "#c1232c" }}>
          + Add Tour Package
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Packages", value: stats.totalCount, color: "#c1232c", sub: "Excluding archived" },
          { label: "Active Packages", value: stats.activeCount, color: "#10B981", sub: "Visible to customers" },
          { label: "Draft Packages", value: stats.draftCount, color: "#F59E0B", sub: "In preparation" },
          { label: "Upcoming Departures", value: stats.departuresCount, color: "#3B82F6", sub: "On active packages" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
            <div className="text-[24px] font-bold" style={{ color: s.color }}>{loading ? "—" : s.value}</div>
            <div className="text-[12px] font-semibold text-ink mt-0.5">{s.label}</div>
            <div className="text-[10px] text-faint">{s.sub}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-line p-12 text-center text-[13px] text-faint">Loading tour packages…</div>
      ) : tourPackages.length === 0 ? (
        <div className="bg-white rounded-xl border border-line shadow-sm p-16 flex flex-col items-center text-center">
          <h2 className="text-[18px] font-bold text-ink mb-2">No tour packages found.</h2>
          <p className="text-[13px] text-faint max-w-sm mb-6">Create a tour package with its itinerary, pricing and allowed vehicle categories to get started.</p>
          <button onClick={() => openForm(null)} className="px-6 py-2.5 text-[13px] font-semibold text-white rounded-lg hover:opacity-90 shadow-sm" style={{ background: "#c1232c" }}>
            + Add Tour Package
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-white rounded-xl border border-line shadow-sm flex flex-wrap items-center justify-between gap-3">
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search package name, code, destination…" className="flex-1 min-w-[200px] max-w-md px-3 py-2 text-[12px] bg-surface-2 border border-line rounded-lg focus:outline-none focus:border-brand" />
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white">
                <option value="All">All (except archived)</option>
                <option value="Active">Active</option>
                <option value="Draft">Draft</option>
                <option value="Inactive">Inactive</option>
                <option value="Archived">Archived</option>
              </select>
              <select aria-label="Duration" value={durationFilter} onChange={(e) => setDurationFilter(e.target.value)} className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white">
                <option value="All">All durations</option>
                <option value="Short">Short (1–3 days)</option>
                <option value="Medium">Medium (4–7 days)</option>
                <option value="Long">Long (8+ days)</option>
              </select>
              <select aria-label="Sort" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white">
                <option value="order">Display order</option>
                <option value="name">Package name</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredPackages.length === 0 ? (
              <div className="col-span-full bg-white rounded-xl border border-line p-8 text-center text-xs text-faint">No tour packages match your filters.</div>
            ) : (
              filteredPackages.map((pkg) => {
                const next = upcomingDepartures(pkg)[0];
                const busy = busyId === pkg.id;
                return (
                  <div key={pkg.id} className="bg-white rounded-xl border border-line shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col justify-between">
                    <div>
                      <div className="relative h-40 bg-gray-100 overflow-hidden">
                        {pkg.coverImageUrl ? (
                          <img src={pkg.coverImageUrl} alt={pkg.name} className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-brand-soft text-[40px]">🏝️</div>
                        )}
                        <div className="absolute top-3 left-3 flex gap-1.5">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border shadow-xs ${statusBadge[pkg.status] || statusBadge.Inactive}`}>{pkg.status}</span>
                          {pkg.featured && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-gray-900 shadow-xs">★ Featured</span>}
                        </div>
                        <div className="absolute bottom-3 right-3 bg-black/75 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold">
                          {pkg.durationDays} Days / {pkg.durationNights} Nights
                        </div>
                      </div>
                      <div className="p-4 space-y-3">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono text-faint font-bold uppercase truncate">{pkg.code}</span>
                            <span className="text-[14px] font-black text-brand whitespace-nowrap">
                              {pkg.offerPrice ? (
                                <>
                                  <span className="line-through text-faint text-[11px] font-semibold mr-1">{formatCurrency(pkg.basePrice)}</span>
                                  {formatCurrency(pkg.offerPrice)}
                                </>
                              ) : (
                                formatCurrency(pkg.basePrice)
                              )}
                              <span className="text-[10px] font-semibold text-faint ml-1">
                                {pkg.pricingModel === "Per Person" ? "/ adult" : pkg.pricingModel === "Vehicle Based" ? "onwards" : ""}
                              </span>
                            </span>
                          </div>
                          <h3 className="text-[14px] font-bold text-ink line-clamp-1 mt-0.5">{pkg.name}</h3>
                        </div>
                        <div className="text-[11px] text-muted line-clamp-1">📍 {(pkg.destinations || []).join(" → ") || "Route not set"}</div>
                        <p className="text-[11px] text-faint line-clamp-2">{pkg.shortDescription || "No short description provided."}</p>
                        <div className="text-[10px] text-muted">{next ? `Next departure: ${next.date}${next.time ? ` ${next.time}` : ""} (${next.status})` : "No upcoming departures"}</div>
                        <div className="pt-2 border-t border-hover flex items-center justify-between text-[10px] gap-2">
                          <div className="flex flex-wrap gap-1">
                            {(pkg.allowedVehicleCategoryNames || []).slice(0, 3).map((c) => (
                              <span key={c} className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium">{c}</span>
                            ))}
                          </div>
                          {pkg.preferredVendorName && <span className="text-blue-700 font-semibold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 truncate">Partner: {pkg.preferredVendorName}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="p-4 bg-surface-2 border-t border-line flex flex-wrap items-center justify-between gap-2">
                      <button onClick={() => void duplicate(pkg)} disabled={busy} className="text-[11px] font-semibold text-gray-600 hover:text-brand disabled:opacity-50">📋 Duplicate</button>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button onClick={() => openForm(pkg)} className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-line text-gray-700 hover:bg-white">Edit</button>
                        {pkg.status !== "Archived" && (
                          <button
                            onClick={() => void changeStatus(pkg, pkg.status === "Active" ? "Inactive" : "Active")}
                            disabled={busy}
                            className={`px-2 py-1 text-[11px] font-medium rounded-lg border disabled:opacity-50 ${pkg.status === "Active" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
                          >
                            {pkg.status === "Active" ? "Deactivate" : "Activate"}
                          </button>
                        )}
                        {pkg.status === "Archived" ? (
                          <button onClick={() => void changeStatus(pkg, "Draft")} disabled={busy} className="px-2 py-1 text-[11px] font-medium rounded-lg border border-line text-gray-700 disabled:opacity-50">Restore</button>
                        ) : (
                          <button onClick={() => void changeStatus(pkg, "Archived")} disabled={busy} className="px-2 py-1 text-[11px] font-medium rounded-lg border border-line text-gray-700 disabled:opacity-50">Archive</button>
                        )}
                        <button
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(pkg);
                          }}
                          className="px-2 py-1 text-[11px] font-medium rounded-lg border border-red-200 bg-red-50 text-brand hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden my-6" role="dialog" aria-modal="true" aria-label="Tour package editor">
            <div className="px-6 py-4 border-b border-line flex items-center justify-between bg-surface-2">
              <div>
                <h3 className="text-[16px] font-bold text-ink">{editing ? "Edit Tour Package" : "+ Add Tour Package"}</h3>
                <p className="text-[11px] text-muted">Route, itinerary, pricing, departures and inclusions.</p>
              </div>
              <button type="button" onClick={() => setShowModal(false)} disabled={saving} aria-label="Close" className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 font-bold text-sm disabled:opacity-40">✕</button>
            </div>

            <div className="flex border-b border-line bg-hover px-6 pt-2 overflow-x-auto">
              {([
                { id: "basic", label: "Basic Info & Route" },
                { id: "itinerary", label: "Itinerary" },
                { id: "pricing", label: "Pricing & Vehicles" },
                { id: "availability", label: "Departures" },
                { id: "inclusions", label: "Inclusions & SEO" },
              ] as { id: FormTab; label: string }[]).map((tab) => (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 text-[12px] font-semibold border-b-2 whitespace-nowrap flex items-center gap-1.5 ${activeTab === tab.id ? "border-brand text-brand bg-white rounded-t-lg" : "border-transparent text-muted hover:text-ink"}`}
                >
                  {tab.label}
                  {tabHasError(tab.id) && <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-label="has errors" />}
                </button>
              ))}
            </div>

            <form onSubmit={handleSave} noValidate>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                {formError && <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold">⚠️ {formError}</div>}

                {activeTab === "basic" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">Package Name *</label>
                        <input type="text" value={formData.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
                        {errNode("name")}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold text-ink mb-1">Code</label>
                          <input type="text" value={formData.code} placeholder="From name" onChange={(e) => set("code", e.target.value.toUpperCase())} className={`${inputCls} font-mono`} />
                          {errNode("code")}
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-ink mb-1">URL Slug</label>
                          <input type="text" value={formData.slug} placeholder="From name" onChange={(e) => set("slug", e.target.value.toLowerCase())} className={`${inputCls} font-mono`} />
                          {errNode("slug")}
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-gray-50 rounded-xl border border-line space-y-2">
                      <label className="block text-[11px] font-bold text-ink">Route (start → stops → end) *</label>
                      <div className="flex flex-wrap items-center gap-2">
                        {formData.destinations.map((dest, idx) => (
                          <span key={`${dest}-${idx}`} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-gray-300 text-xs font-semibold text-gray-800">
                            <span>{idx === 0 ? "🟢" : idx === formData.destinations.length - 1 ? "🏁" : "📍"} {dest}</span>
                            <button type="button" onClick={() => moveDestination(idx, -1)} disabled={idx === 0} aria-label="Move earlier" className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-0.5">‹</button>
                            <button type="button" onClick={() => moveDestination(idx, 1)} disabled={idx === formData.destinations.length - 1} aria-label="Move later" className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-0.5">›</button>
                            <button type="button" onClick={() => set("destinations", formData.destinations.filter((_, i) => i !== idx))} aria-label={`Remove ${dest}`} className="text-red-500 font-bold hover:text-red-700 ml-1">✕</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <input
                          type="text"
                          list="package-locations"
                          placeholder={formData.destinations.length ? "Add next stop…" : "Starting point…"}
                          value={newDestInput}
                          onChange={(e) => setNewDestInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addDestination();
                            }
                          }}
                          className="flex-1 p-2 border border-line rounded-lg text-[12px] bg-white focus:outline-none focus:border-brand"
                        />
                        <datalist id="package-locations">
                          {locationNames.map((n) => (
                            <option key={n} value={n} />
                          ))}
                        </datalist>
                        <button type="button" onClick={addDestination} className="px-3 py-2 bg-gray-900 text-white rounded-lg text-xs font-semibold hover:bg-gray-800">+ Add Stop</button>
                      </div>
                      {errNode("destinations")}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">Days *</label>
                        <input inputMode="numeric" value={numberValue(formData.durationDays)} onChange={(e) => set("durationDays", toWhole(e.target.value))} className={inputCls} />
                        {errNode("durationDays")}
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">Nights *</label>
                        <input inputMode="numeric" value={String(formData.durationNights)} onChange={(e) => set("durationNights", toWhole(e.target.value))} className={inputCls} />
                        {errNode("durationNights")}
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">Status</label>
                        <select value={formData.status} onChange={(e) => set("status", e.target.value as PackageStatus)} className={`${inputCls} bg-white`}>
                          <option value="Draft">Draft (internal)</option>
                          <option value="Active">Active (shown to customers)</option>
                          <option value="Inactive">Inactive (hidden)</option>
                          <option value="Archived">Archived</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">Display Order</label>
                        <input inputMode="numeric" value={numberValue(formData.displayOrder)} onChange={(e) => set("displayOrder", toWhole(e.target.value))} className={inputCls} />
                        {errNode("displayOrder")}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">Short Description</label>
                      <input type="text" maxLength={160} value={formData.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">Full Description</label>
                      <textarea rows={3} value={formData.fullDescription} onChange={(e) => set("fullDescription", e.target.value)} className={inputCls} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                      <div className="md:col-span-2">
                        <label className="block text-[11px] font-bold text-ink mb-1">Cover Image URL</label>
                        <input type="url" value={formData.coverImageUrl} onChange={(e) => set("coverImageUrl", e.target.value)} placeholder="https://…" className={inputCls} />
                        {errNode("coverImageUrl")}
                      </div>
                      <label className="flex items-center gap-2 text-[12px] font-semibold text-ink pb-2.5">
                        <input type="checkbox" checked={formData.featured} onChange={(e) => set("featured", e.target.checked)} className="accent-brand" />
                        Featured package
                      </label>
                    </div>
                  </div>
                )}

                {activeTab === "itinerary" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-ink">
                        Day-by-Day Itinerary ({formData.itinerary.length} of {formData.durationDays} days)
                      </span>
                      <button
                        type="button"
                        onClick={() => set("itinerary", [...formData.itinerary, { dayNumber: formData.itinerary.length + 1, title: "", description: "", activities: "", meals: "", stay: "" }])}
                        disabled={formData.itinerary.length >= formData.durationDays}
                        className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-40"
                      >
                        + Add Day
                      </button>
                    </div>
                    {errNode("itinerary")}
                    {formData.itinerary.length === 0 && <p className="text-[12px] text-faint">No itinerary days yet.</p>}
                    {formData.itinerary.map((day, idx) => (
                      <div key={idx} className="p-4 bg-gray-50 rounded-xl border border-line space-y-3">
                        <div className="flex items-center justify-between border-b pb-2">
                          <span className="font-bold text-xs text-brand uppercase">Day {idx + 1}</span>
                          <button type="button" onClick={() => set("itinerary", formData.itinerary.filter((_, i) => i !== idx))} className="text-xs font-semibold text-red-600 hover:text-red-800">Remove Day</button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input type="text" aria-label="Day title" value={day.title} onChange={(e) => updateDay(idx, { title: e.target.value })} placeholder="Day title *" className={`${inputCls} bg-white`} />
                          <input type="text" aria-label="Stay" value={day.stay || ""} onChange={(e) => updateDay(idx, { stay: e.target.value })} placeholder="Stay / accommodation" className={`${inputCls} bg-white`} />
                        </div>
                        <textarea rows={2} aria-label="Day schedule" value={day.description} onChange={(e) => updateDay(idx, { description: e.target.value })} placeholder="Schedule for the day" className={`${inputCls} bg-white`} />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input type="text" aria-label="Activities" value={day.activities || ""} onChange={(e) => updateDay(idx, { activities: e.target.value })} placeholder="Activities & visits" className={`${inputCls} bg-white`} />
                          <input type="text" aria-label="Meals" value={day.meals || ""} onChange={(e) => updateDay(idx, { meals: e.target.value })} placeholder="Meals included" className={`${inputCls} bg-white`} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === "pricing" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">Pricing Model *</label>
                      <select value={formData.pricingModel} onChange={(e) => set("pricingModel", e.target.value as PackageForm["pricingModel"])} className={`${inputCls} bg-white`}>
                        <option value="">Choose pricing model</option>
                        {PRICING_MODELS.map((m) => (
                          <option key={m} value={m}>{m === "Per Package" ? "Per Package (flat price for the group)" : m === "Per Person" ? "Per Person (adult / child)" : "Vehicle Based (depends on vehicle chosen)"}</option>
                        ))}
                      </select>
                      {errNode("pricingModel")}
                    </div>
                    {formData.pricingModel === "Per Person" ? (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[11px] font-bold text-ink mb-1">Adult Price (₹) *</label>
                          <input inputMode="numeric" value={numberValue(formData.adultPrice)} onChange={(e) => set("adultPrice", toWhole(e.target.value))} className={inputCls} />
                          {errNode("adultPrice")}
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-ink mb-1">Child Price (₹)</label>
                          <input inputMode="numeric" value={String(formData.childPrice)} onChange={(e) => set("childPrice", toWhole(e.target.value))} className={inputCls} />
                          {errNode("childPrice")}
                        </div>
                      </div>
                    ) : formData.pricingModel ? (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[11px] font-bold text-ink mb-1">{formData.pricingModel === "Vehicle Based" ? "Starting Price (₹) *" : "Package Price (₹) *"}</label>
                          <input inputMode="numeric" value={numberValue(formData.basePrice)} onChange={(e) => set("basePrice", toWhole(e.target.value))} className={inputCls} />
                          {errNode("basePrice")}
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-ink mb-1">Offer Price (₹)</label>
                          <input inputMode="numeric" value={numberValue(formData.offerPrice)} placeholder="No offer" onChange={(e) => set("offerPrice", toWhole(e.target.value))} className={inputCls} />
                          {errNode("offerPrice")}
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">Preferred Fleet Partner</label>
                      <select value={formData.preferredVendorId} onChange={(e) => set("preferredVendorId", e.target.value)} className={`${inputCls} bg-white`}>
                        <option value="">No preferred partner (open assignment)</option>
                        {approvedVendors.map((v) => (
                          <option key={v.id} value={v.id}>{vendorLabel(v)}{v.city ? ` (${v.city})` : ""}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-2">Eligible Vehicle Categories{formData.pricingModel === "Vehicle Based" ? " *" : ""}</label>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 bg-gray-50 rounded-xl border border-line">
                        {vehicleCategories
                          .filter((c) => c.status === "Active" || formData.allowedVehicleCategoryIds.includes(c.id))
                          .map((cat) => {
                            const checked = formData.allowedVehicleCategoryIds.includes(cat.id);
                            return (
                              <label key={cat.id} className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer ${checked ? "bg-red-50 border-red-200 text-brand font-bold" : "bg-white border-gray-200 text-gray-700"}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    set("allowedVehicleCategoryIds", checked ? formData.allowedVehicleCategoryIds.filter((id) => id !== cat.id) : [...formData.allowedVehicleCategoryIds, cat.id])
                                  }
                                  className="accent-brand"
                                />
                                <span>{cat.icon || "🚘"} {cat.name} ({cat.seatingCapacity} seats)</span>
                              </label>
                            );
                          })}
                        {vehicleCategories.length === 0 && <span className="text-[11px] text-faint">No vehicle categories yet.</span>}
                      </div>
                      {errNode("allowedVehicleCategoryIds")}
                    </div>
                  </div>
                )}

                {activeTab === "availability" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-ink">Scheduled Departures ({formData.departures.length})</span>
                      <button
                        type="button"
                        onClick={() => set("departures", [...formData.departures, { id: `dep-${Date.now()}`, date: "", time: "", availableSeats: undefined, status: "Available" }])}
                        className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-semibold hover:opacity-90"
                      >
                        + Add Departure
                      </button>
                    </div>
                    <p className="text-[11px] text-faint">Leave empty for packages booked on any date.</p>
                    {errNode("departures")}
                    {formData.departures.map((d, idx) => (
                      <div key={d.id} className="grid grid-cols-2 md:grid-cols-5 gap-2 items-center p-3 bg-gray-50 rounded-xl border border-line">
                        <input type="date" aria-label="Departure date" value={d.date} onChange={(e) => updateDeparture(idx, { date: e.target.value })} className={`${inputCls} bg-white`} />
                        <TimeSelect12 label="Departure time" value={d.time || ""} onChange={(v) => updateDeparture(idx, { time: v })} />
                        <input inputMode="numeric" aria-label="Seats available" value={d.availableSeats === undefined ? "" : String(d.availableSeats)} placeholder="Seats" onChange={(e) => updateDeparture(idx, { availableSeats: e.target.value === "" ? undefined : toWhole(e.target.value) })} className={`${inputCls} bg-white`} />
                        <select aria-label="Departure status" value={d.status} onChange={(e) => updateDeparture(idx, { status: e.target.value as PackageDeparture["status"] })} className={`${inputCls} bg-white`}>
                          {DEPARTURE_STATUSES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => set("departures", formData.departures.filter((_, i) => i !== idx))} className="text-xs font-semibold text-red-600 hover:text-red-800">Remove</button>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === "inclusions" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">Inclusions (one per line)</label>
                      <textarea rows={4} value={formData.inclusionsText} onChange={(e) => set("inclusionsText", e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">Exclusions (one per line)</label>
                      <textarea rows={4} value={formData.exclusionsText} onChange={(e) => set("exclusionsText", e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">SEO Title</label>
                      <input type="text" value={formData.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} className={inputCls} />
                      {errNode("seoTitle")}
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">SEO Description</label>
                      <textarea rows={2} value={formData.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} className={inputCls} />
                      {errNode("seoDescription")}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-line flex items-center justify-between bg-surface-2">
                <button type="button" onClick={() => setShowModal(false)} disabled={saving} className="px-4 py-2 border border-line rounded-lg text-[12px] font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 text-[13px] font-semibold text-white rounded-lg shadow-sm hover:opacity-90 disabled:opacity-50" style={{ background: "#c1232c" }}>
                  {saving ? "Saving…" : editing ? "Update Tour Package" : "Save Tour Package"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete "${deleteTarget.name}"?`}
          message="The package is removed permanently. Packages referenced by coupons or reviews, or with upcoming departures, must be archived instead."
          confirmLabel="Delete Package"
          danger
          busy={deleting}
          error={deleteError}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

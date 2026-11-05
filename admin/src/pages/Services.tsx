import { useState, useEffect, useMemo } from "react";
import { TravelService, VehicleCategory, Booking } from "../types";
import { subscribeServices, subscribeVehicleCategories, subscribeBookings } from "../services/adminFirestoreService";
import {
  ServiceActionError,
  deleteService,
  saveService,
  seedDefaultServices,
  setServiceStatus,
  validateService,
  type ServiceField,
  type ServiceForm,
} from "../services/serviceMasterService";
import { auth } from "../services/firebase";
import { ConfirmDialog, ErrorBanner, Toast, useToast } from "../components/Feedback";

type FormTab = "basic" | "booking" | "seo";
const TAB_FIELDS: Record<FormTab, ServiceField[]> = {
  basic: ["name", "code", "slug", "serviceType", "imageUrl", "displayOrder", "shortDescription"],
  booking: ["channels"],
  seo: ["seoTitle", "seoDescription"],
};

const defaultFormState = {
  id: "",
  name: "",
  code: "",
  slug: "",
  serviceType: "",
  shortDescription: "",
  fullDescription: "",
  icon: "✈️",
  imageUrl: "",
  status: "Active" as "Active" | "Inactive",
  displayOrder: 1,
  featured: false,
  onlineBookingEnabled: true,
  adminBookingEnabled: true,
  allowedVehicleCategoryIds: [] as string[],
  airportOptions: {
    airportPickup: false,
    airportDrop: false,
  },
  outstationOptions: {
    oneWayAllowed: false,
    roundTripAllowed: false,
  },
  seoTitle: "",
  seoDescription: "",
};

const toForm = (f: typeof defaultFormState): ServiceForm => {
  const { id: _id, ...rest } = f;
  return rest;
};
const actionError = (e: unknown) => (e instanceof ServiceActionError ? e.message : "Something went wrong. Please try again.");

export default function Services() {
  const [services, setServices] = useState<TravelService[]>([]);
  const [vehicleCategories, setVehicleCategories] = useState<VehicleCategory[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Filters & Search
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Inactive">("All");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [sortBy, setSortBy] = useState<"order" | "name" | "type">("order");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingOriginal, setEditingOriginal] = useState<TravelService | null>(null);
  const [formData, setFormData] = useState(defaultFormState);
  const [activeTab, setActiveTab] = useState<FormTab>("basic");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ServiceField, string>>>({});

  // Delete / status State
  const [deleteTarget, setDeleteTarget] = useState<TravelService | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const { toast, show: showToast } = useToast();

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const fail = (m: string) => {
      setLoadError(m);
      setLoading(false);
    };
    const unsubServices = subscribeServices((data) => {
      setServices(data);
      setLoading(false);
    }, fail);
    const unsubCats = subscribeVehicleCategories(setVehicleCategories, fail);
    const unsubBookings = subscribeBookings(setBookings, fail);
    return () => {
      unsubServices();
      unsubCats();
      unsubBookings();
    };
  }, [retryKey]);

  // KPIs
  const stats = useMemo(() => {
    const totalCount = services.length;
    const activeCount = services.filter((s) => s.status === "Active").length;
    const inactiveCount = services.filter((s) => s.status === "Inactive").length;
    const featuredCount = services.filter((s) => s.featured).length;
    return { totalCount, activeCount, inactiveCount, featuredCount };
  }, [services]);

  // Filtered & Sorted Services
  const filteredServices = useMemo(() => {
    return services
      .filter((srv) => {
        const q = search.trim().toLowerCase();
        const matchSearch =
          q === "" ||
          srv.name.toLowerCase().includes(q) ||
          (srv.code && srv.code.toLowerCase().includes(q)) ||
          (srv.shortDescription && srv.shortDescription.toLowerCase().includes(q)) ||
          (srv.serviceType && srv.serviceType.toLowerCase().includes(q));

        const matchStatus = statusFilter === "All" || srv.status === statusFilter;
        const matchType = typeFilter === "All" || srv.serviceType === typeFilter;
        return matchSearch && matchStatus && matchType;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "type") return (a.serviceType || "").localeCompare(b.serviceType || "");
        return (a.displayOrder || 99) - (b.displayOrder || 99);
      });
  }, [services, search, statusFilter, typeFilter, sortBy]);

  const tabHasError = (tab: FormTab) => TAB_FIELDS[tab].some((f) => fieldErrors[f]);
  const errNode = (f: ServiceField) =>
    fieldErrors[f] ? <p className="text-[10px] text-red-600 mt-1">{fieldErrors[f]}</p> : null;

  const openForm = (data: typeof defaultFormState, original: TravelService | null) => {
    setIsEditing(!!original);
    setEditingOriginal(original);
    setFormData(data);
    setActiveTab("basic");
    setFormError(null);
    setFieldErrors({});
    setShowModal(true);
  };

  const [seeding, setSeeding] = useState(false);
  const handleSeedDefaults = async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      const n = await seedDefaultServices(services, auth.currentUser?.uid || "");
      showToast(n ? `${n} default service${n === 1 ? "" : "s"} added and saved to Firebase.` : "All default services are already set up.");
    } catch (err) {
      showToast(actionError(err), "error");
    } finally {
      setSeeding(false);
    }
  };

  const handleOpenAdd = () =>
    openForm({ ...defaultFormState, displayOrder: services.reduce((m, s) => Math.max(m, s.displayOrder || 0), 0) + 1 }, null);

  const handleOpenEdit = (srv: TravelService) =>
    openForm(
      {
        id: srv.id,
        name: srv.name,
        code: srv.code || "",
        slug: srv.slug || "",
        serviceType: srv.serviceType || "",
        shortDescription: srv.shortDescription || "",
        fullDescription: srv.fullDescription || "",
        icon: srv.icon || "✈️",
        imageUrl: srv.imageUrl || "",
        status: srv.status || "Active",
        displayOrder: srv.displayOrder || 1,
        featured: Boolean(srv.featured),
        onlineBookingEnabled: srv.onlineBookingEnabled !== false,
        adminBookingEnabled: srv.adminBookingEnabled !== false,
        allowedVehicleCategoryIds: srv.allowedVehicleCategoryIds || [],
        airportOptions: srv.airportOptions || { airportPickup: false, airportDrop: false },
        outstationOptions: srv.outstationOptions || { oneWayAllowed: false, roundTripAllowed: false },
        seoTitle: srv.seoTitle || "",
        seoDescription: srv.seoDescription || "",
      },
      srv,
    );

  const handleToggleCategory = (catId: string) => {
    setFormData((prev) => {
      const current = prev.allowedVehicleCategoryIds || [];
      const updated = current.includes(catId) ? current.filter((id) => id !== catId) : [...current, catId];
      return { ...prev, allowedVehicleCategoryIds: updated };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    const form = toForm(formData);
    const errors = validateService(form, services, editingOriginal?.id ?? null);
    setFieldErrors(errors);
    const keys = Object.keys(errors) as ServiceField[];
    if (keys.length) {
      setFormError(`Please fix: ${keys.map((k) => errors[k]).join(" ")}`);
      const tab = (Object.keys(TAB_FIELDS) as FormTab[]).find((t) => TAB_FIELDS[t].includes(keys[0]));
      if (tab) setActiveTab(tab);
      return;
    }
    setSaving(true);
    try {
      const { renamed } = await saveService(form, editingOriginal, vehicleCategories, auth.currentUser?.uid || "");
      setShowModal(false);
      showToast(
        editingOriginal
          ? `Service "${form.name.trim()}" updated${renamed ? ` (${renamed} linked record${renamed === 1 ? "" : "s"} renamed)` : ""}.`
          : `Service "${form.name.trim()}" created.`,
      );
    } catch (err) {
      setFormError(actionError(err));
    } finally {
      setSaving(false);
    }
  };

  // Toggle active/inactive status
  const handleToggleStatus = async (srv: TravelService) => {
    if (statusBusyId) return;
    const newStatus = srv.status === "Active" ? "Inactive" : "Active";
    setStatusBusyId(srv.id);
    try {
      await setServiceStatus(srv, newStatus);
      showToast(`Service "${srv.name}" marked as ${newStatus}.`);
    } catch (err) {
      showToast(actionError(err), "error");
    } finally {
      setStatusBusyId(null);
    }
  };

  // Delete handling
  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteService(deleteTarget, bookings);
      showToast(`Service "${deleteTarget.name}" removed.`);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(actionError(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-ink">Services</h1>
          <p className="text-[13px] text-muted">
            Configure Airport Taxi, Outstation Cab, One Way Taxi, Local Rental, Corporate and Recurring services.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSeedDefaults}
            disabled={seeding}
            className="px-4 py-2.5 text-[13px] font-semibold rounded-lg border border-line text-ink bg-white hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            {seeding ? "Setting up…" : "Set up default services"}
          </button>
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-white rounded-lg shadow-sm hover:opacity-90 transition-all cursor-pointer"
            style={{ background: "#c1232c" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            + Add Service
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Total Services",
            value: stats.totalCount.toString(),
            color: "#c1232c",
            sub: "Offered travel services",
          },
          {
            label: "Active Services",
            value: stats.activeCount.toString(),
            color: "#10B981",
            sub: "Available for booking",
          },
          {
            label: "Inactive Services",
            value: stats.inactiveCount.toString(),
            color: "#6B7280",
            sub: "Deactivated / Hidden",
          },
          {
            label: "Featured Services",
            value: stats.featuredCount.toString(),
            color: "#F59E0B",
            sub: "Promoted on web & app",
          },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
            <div className="text-[24px] font-bold" style={{ color: s.color }}>
              {s.value}
            </div>
            <div className="text-[12px] font-semibold text-ink mt-0.5">{s.label}</div>
            <div className="text-[10px] text-faint">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="bg-white rounded-xl border border-line p-12 text-center text-[13px] text-faint">
          Loading services configuration...
        </div>
      ) : services.length === 0 ? (
        /* Empty State Placeholder */
        <div className="bg-white rounded-xl border border-line shadow-sm p-16 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "#FEF2F2" }}>
            <svg
              className="w-8 h-8"
              style={{ color: "#c1232c" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2H10a2 2 0 00-2 2v2m4 6h.01"
              />
            </svg>
          </div>
          <h2 className="text-[18px] font-bold text-ink mb-2">No services found.</h2>
          <p className="text-[13px] text-faint max-w-sm mb-6">
            Services (for example Airport Taxi or Outstation Cab) are what customers can book. Add the first service to get started.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSeedDefaults}
              disabled={seeding}
              className="px-6 py-2.5 text-[13px] font-semibold rounded-lg border border-line text-ink bg-white hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              {seeding ? "Setting up…" : "Set up default services"}
            </button>
            <button
              onClick={handleOpenAdd}
              className="px-6 py-2.5 text-[13px] font-semibold text-white rounded-lg hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
              style={{ background: "#c1232c" }}
            >
              + Add Service
            </button>
          </div>
        </div>
      ) : (
        /* Service Grid & Directory View */
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="p-4 bg-white rounded-xl border border-line shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search service name, type, code..."
                className="w-full pl-9 pr-4 py-2 text-[12px] bg-surface-2 border border-line rounded-lg focus:outline-none focus:border-brand placeholder-faint"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white focus:outline-none focus:border-brand text-body"
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white focus:outline-none focus:border-brand text-body"
              >
                <option value="All">All Service Types</option>
                <option value="Airport Taxi">Airport Taxi</option>
                <option value="Outstation Cab">Outstation Cab</option>
                <option value="One Way Taxi">One Way Taxi</option>
                <option value="Local Rental">Local Rental</option>
                <option value="Corporate Travel">Corporate Travel</option>
                <option value="Recurring Transport">Recurring Transport</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white focus:outline-none focus:border-brand text-body"
              >
                <option value="order">Display Order</option>
                <option value="name">Service Name</option>
                <option value="type">Service Type</option>
              </select>
            </div>
          </div>

          {/* Service Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredServices.length === 0 ? (
              <div className="col-span-full bg-white rounded-xl border border-line p-8 text-center text-xs text-faint">
                No travel services match your search filters.
              </div>
            ) : (
              filteredServices.map((srv) => (
                <div
                  key={srv.id}
                  className="bg-white rounded-xl border border-line shadow-sm hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-brand-soft flex items-center justify-center text-[22px] border border-[#FEE2E2] shrink-0">
                          {srv.imageUrl ? (
                            <img
                              src={srv.imageUrl}
                              alt={srv.name}
                              className="w-full h-full object-cover rounded-xl"
                              onError={(e) => {
                                (e.target as any).style.display = "none";
                              }}
                            />
                          ) : (
                            srv.icon || "🚕"
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-[14px] font-bold text-ink">{srv.name}</h3>
                            {srv.featured && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                ★ Featured
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-faint">
                            {srv.code || srv.slug}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          srv.status === "Active"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-gray-100 text-gray-600 border-gray-200"
                        }`}
                      >
                        {srv.status}
                      </span>
                    </div>

                    {/* Short Description */}
                    <p className="text-[12px] text-muted line-clamp-2 leading-relaxed">
                      {srv.shortDescription || "No short description provided."}
                    </p>

                    {/* Service Badges */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-50 text-brand border border-red-100">
                        {srv.serviceType}
                      </span>
                      {srv.onlineBookingEnabled && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
                          Online Booking
                        </span>
                      )}
                      {srv.adminBookingEnabled && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100">
                          Admin Booking
                        </span>
                      )}
                    </div>

                    {/* Vehicle Category Mappings */}
                    {srv.allowedVehicleCategoryNames && srv.allowedVehicleCategoryNames.length > 0 && (
                      <div className="pt-2 border-t border-hover">
                        <span className="text-[10px] font-semibold text-faint uppercase tracking-wider block mb-1">
                          Vehicle Categories
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {srv.allowedVehicleCategoryNames.map((cName) => (
                            <span
                              key={cName}
                              className="text-[10px] font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-700"
                            >
                              {cName}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions Footer */}
                  <div className="pt-3 border-t border-line flex items-center justify-between">
                    <span className="text-[10px] text-faint font-mono">
                      Order: {srv.displayOrder || 1}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleOpenEdit(srv)}
                        className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-line text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleStatus(srv)}
                        disabled={statusBusyId === srv.id}
                        className={`px-2 py-1 text-[11px] font-medium rounded-lg border transition-colors cursor-pointer disabled:opacity-50 ${
                          srv.status === "Active"
                            ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        }`}
                      >
                        {srv.status === "Active" ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(srv);
                        }}
                        className="px-2 py-1 text-[11px] font-medium rounded-lg border border-red-200 bg-red-50 text-brand hover:bg-red-100 transition-colors cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Add / Edit Service Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden my-8">
            {/* Header */}
            <div className="px-6 py-4 border-b border-line flex items-center justify-between bg-surface-2">
              <div>
                <h3 className="text-[16px] font-bold text-ink">
                  {isEditing ? "Edit Travel Service" : "+ Add Travel Service"}
                </h3>
                <p className="text-[11px] text-muted">
                  Configure service details, vehicle category mappings, and availability.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowModal(false)}
                disabled={saving}
                aria-label="Close"
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 font-bold text-sm disabled:opacity-40"
              >
                ✕
              </button>
            </div>
            {/* Navigation Tabs */}
            <div className="flex border-b border-line bg-hover px-6 pt-2">
              {([
                { id: "basic", label: "Basic Info" },
                { id: "booking", label: "Availability & Categories" },
                { id: "seo", label: "SEO & Content" },
              ] as { id: FormTab; label: string }[]).map((tab) => (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 text-[12px] font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeTab === tab.id
                      ? "border-brand text-brand bg-white rounded-t-lg"
                      : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {tab.label}
                  {tabHasError(tab.id) && <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-label="has errors" />}
                </button>
              ))}
            </div>

            {/* Form Body */}
            <form onSubmit={handleSave} noValidate>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                {formError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold">
                    ⚠️ {formError}
                  </div>
                )}

                {/* TAB 1: BASIC INFO */}
                {activeTab === "basic" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Service Name *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Airport Taxi, Outstation Cab"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("name")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Service Type
                        </label>
                        <select
                          value={formData.serviceType}
                          onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        >
                          <option value="">Choose service type</option>
                          <option value="Airport Taxi">Airport Taxi</option>
                          <option value="Outstation Cab">Outstation Cab</option>
                          <option value="One Way Taxi">One Way Taxi</option>
                          <option value="Local Rental">Local Rental</option>
                          <option value="Corporate Travel">Corporate Travel</option>
                          <option value="Recurring Transport">Recurring Transport</option>
                        </select>
                        {errNode("serviceType")}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Service Code / Unique Identifier
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. AIRPORT_TAXI"
                          value={formData.code}
                          onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] font-mono focus:outline-none focus:border-brand"
                        />
                        {errNode("code")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          URL Slug
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. airport-taxi"
                          value={formData.slug}
                          onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase() })}
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] font-mono focus:outline-none focus:border-brand"
                        />
                        {errNode("slug")}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">
                        Short Description
                      </label>
                      <input
                        type="text"
                        placeholder="Brief 1-sentence tagline for cards and lists..."
                        value={formData.shortDescription}
                        onChange={(e) => setFormData({ ...formData, shortDescription: e.target.value })}
                        className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                      />
                        {errNode("shortDescription")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">
                        Full Overview Description
                      </label>
                      <textarea
                        rows={3}
                        placeholder="Detailed service overview, features, terms..."
                        value={formData.fullDescription}
                        onChange={(e) => setFormData({ ...formData, fullDescription: e.target.value })}
                        className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Icon Emoji
                        </label>
                        <select
                          value={formData.icon}
                          onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        >
                          <option value="✈️">✈️ Airport</option>
                          <option value="🗺️">🗺️ Outstation</option>
                          <option value="🚕">🚕 Taxi Drop</option>
                          <option value="⏱️">⏱️ Rental</option>
                          <option value="💼">💼 Corporate</option>
                          <option value="🔄">🔄 Recurring</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Display Order
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={formData.displayOrder}
                          onChange={(e) =>
                            setFormData({ ...formData, displayOrder: parseInt(e.target.value) || 1 })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("displayOrder")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">Status</label>
                        <select
                          value={formData.status}
                          onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        >
                          <option value="Active">Active (Selectable)</option>
                          <option value="Inactive">Inactive (Hidden)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">Featured</label>
                        <select
                          value={formData.featured ? "Yes" : "No"}
                          onChange={(e) => setFormData({ ...formData, featured: e.target.value === "Yes" })}
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        >
                          <option value="No">No</option>
                          <option value="Yes">Yes (Promoted)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 2: BOOKING & VEHICLE CATEGORIES */}
                {activeTab === "booking" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {errNode("channels")}
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-line">
                        <input
                          type="checkbox"
                          id="onlineBook"
                          checked={formData.onlineBookingEnabled}
                          onChange={(e) =>
                            setFormData({ ...formData, onlineBookingEnabled: e.target.checked })
                          }
                          className="w-4 h-4 accent-brand"
                        />
                        <div>
                          <label htmlFor="onlineBook" className="text-[12px] font-bold text-ink block">
                            Enable Online Customer Booking
                          </label>
                          <span className="text-[10px] text-gray-500">Available on public website & mobile app</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-line">
                        <input
                          type="checkbox"
                          id="adminBook"
                          checked={formData.adminBookingEnabled}
                          onChange={(e) =>
                            setFormData({ ...formData, adminBookingEnabled: e.target.checked })
                          }
                          className="w-4 h-4 accent-brand"
                        />
                        <div>
                          <label htmlFor="adminBook" className="text-[12px] font-bold text-ink block">
                            Enable Admin Booking Panel
                          </label>
                          <span className="text-[10px] text-gray-500">Selectable in + New Booking form</span>
                        </div>
                      </div>
                    </div>

                    {/* Allowed Vehicle Categories */}
                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-2">
                        Allowed Vehicle Categories for this Service
                      </label>
                      {vehicleCategories.length === 0 ? (
                        <div className="p-3 bg-gray-50 rounded-xl text-xs text-gray-500">
                          No vehicle categories configured. Configure categories in Fleet &gt; Vehicle Categories.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 bg-gray-50 rounded-xl border border-line">
                          {vehicleCategories
                            .filter((c) => c.status === "Active")
                            .map((cat) => {
                              const checked = (formData.allowedVehicleCategoryIds || []).includes(cat.id);
                              return (
                                <label
                                  key={cat.id}
                                  className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-all ${
                                    checked
                                      ? "bg-red-50 border-red-200 text-brand font-bold"
                                      : "bg-white border-gray-200 text-gray-700"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => handleToggleCategory(cat.id)}
                                    className="accent-brand"
                                  />
                                  <span>
                                    {cat.icon || "🚘"} {cat.name} ({cat.seatingCapacity} Seats)
                                  </span>
                                </label>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 3: SEO & METADATA */}
                {activeTab === "seo" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">
                        SEO Page Title
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Book Airport Taxi in Tamil Nadu | Nesam Tours"
                        value={formData.seoTitle}
                        onChange={(e) => setFormData({ ...formData, seoTitle: e.target.value })}
                        className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                      />
                        {errNode("seoTitle")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">
                        SEO Meta Description
                      </label>
                      <textarea
                        rows={3}
                        placeholder="Compelling page meta description for Google search results..."
                        value={formData.seoDescription}
                        onChange={(e) => setFormData({ ...formData, seoDescription: e.target.value })}
                        className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                      />
                        {errNode("seoDescription")}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-line flex items-center justify-between bg-surface-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-line rounded-lg text-[12px] font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 text-[13px] font-semibold text-white rounded-lg shadow-sm hover:opacity-90 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  style={{ background: "#c1232c" }}
                >
                  {saving && (
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {saving
                    ? "Saving..."
                    : isEditing
                    ? "Update Travel Service"
                    : "Save Travel Service"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete "${deleteTarget.name}"?`}
          message="The service is removed permanently. It can only be deleted when no booking, fare rule, coupon or location uses it — otherwise deactivate it to hide it from new bookings."
          confirmLabel="Delete Service"
          danger
          busy={deleting}
          error={deleteError}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}    </div>
  );
}

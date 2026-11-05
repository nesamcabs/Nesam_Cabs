import { useEffect, useMemo, useState } from "react";
import { VehicleCategory, Vehicle } from "../types";
import { subscribeVehicleCategories, subscribeVehicles } from "../services/adminFirestoreService";
import {
  CategoryActionError,
  deleteCategory,
  saveCategory,
  setCategoryStatus,
  validateCategory,
  vehiclesInCategory,
  type CategoryField,
  type CategoryForm,
} from "../services/categoryService";
import { mapVehicle } from "../services/vehicleService";
import { ConfirmDialog, ErrorBanner, Toast, useToast } from "../components/Feedback";

type FormTab = "basic" | "specs" | "fare" | "outstation";

const TAB_FIELDS: Record<FormTab, CategoryField[]> = {
  basic: ["name", "code", "imageUrl"],
  specs: ["seatingCapacity", "recommendedPassengers", "displayOrder"],
  fare: ["fare.baseFare", "fare.baseKm", "fare.perKmRate", "fare.minimumFare", "fare.driverAllowance", "fare.nightAllowance"],
  outstation: [
    "fare.outstationPerKmRate",
    "fare.outstationDriverBattaPerDay",
    "fare.outstationMinKmPerDay",
    "fare.waitingChargePerHour",
    "fare.extraHourCharge",
    "fare.extraKmCharge",
    "fare.permitCharge",
    "fare.carrierCharge",
  ],
};

const FIELD_LABELS: Partial<Record<CategoryField, string>> = {
  name: "Category name",
  code: "Category code",
  imageUrl: "Image URL",
  seatingCapacity: "Seating capacity",
  recommendedPassengers: "Recommended passengers",
  displayOrder: "Display order",
  "fare.baseFare": "Base fare",
  "fare.baseKm": "Base km",
  "fare.perKmRate": "Per-km rate",
  "fare.minimumFare": "Minimum fare",
  "fare.driverAllowance": "Driver allowance",
  "fare.nightAllowance": "Night allowance",
  "fare.outstationPerKmRate": "Outstation per-km rate",
  "fare.outstationDriverBattaPerDay": "Outstation driver batta",
  "fare.outstationMinKmPerDay": "Outstation minimum km/day",
  "fare.waitingChargePerHour": "Time charge per hour",
  "fare.extraHourCharge": "Extra hour charge",
  "fare.extraKmCharge": "Extra km charge",
  "fare.permitCharge": "Permit charge",
  "fare.carrierCharge": "Carrier / luggage charge",
};

// A new category starts without prices: every rate must be entered by the admin.
const defaultFormState = {
  id: "",
  name: "",
  code: "",
  description: "",
  imageUrl: "",
  icon: "🚘",
  seatingCapacity: 0,
  luggageCapacity: "" as string | number,
  acSupported: "Both" as "AC" | "Non-AC" | "Both",
  recommendedPassengers: 0,
  displayOrder: 1,
  status: "Active" as "Active" | "Inactive",
  cngEnabled: false,
  fare: {
    baseFare: 0,
    baseKm: 0,
    perKmRate: 0,
    minimumFare: 0,
    driverAllowance: 0,
    nightAllowance: 0,
    waitingChargePerHour: 0,
    extraHourCharge: 0,
    extraKmCharge: 0,
    tollIncluded: false,
    parkingIncluded: false,
    permitCharge: 0,
    carrierCharge: 0,
    outstationPerKmRate: 0,
    outstationDriverBattaPerDay: 0,
    outstationMinKmPerDay: 0,
  },
};

const toForm = (f: typeof defaultFormState): CategoryForm => ({
  name: f.name,
  code: f.code,
  description: f.description,
  imageUrl: f.imageUrl,
  icon: f.icon,
  seatingCapacity: f.seatingCapacity,
  luggageCapacity: f.luggageCapacity,
  acSupported: f.acSupported,
  recommendedPassengers: f.recommendedPassengers,
  displayOrder: f.displayOrder,
  status: f.status,
  cngEnabled: f.cngEnabled,
  fare: { ...f.fare },
});

const actionError = (e: unknown) =>
  e instanceof CategoryActionError ? e.message : "Something went wrong. Please try again.";

export default function VehicleCategories({ embedded = false }: { embedded?: boolean } = {}) {
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Filters & Sorting
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Inactive">("All");
  const [sortBy, setSortBy] = useState<"name" | "order" | "seats">("order");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingOriginal, setEditingOriginal] = useState<VehicleCategory | null>(null);
  const [formData, setFormData] = useState(defaultFormState);
  const [activeTab, setActiveTab] = useState<FormTab>("basic");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CategoryField, string>>>({});

  // Delete / status state
  const [deleteTarget, setDeleteTarget] = useState<VehicleCategory | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const { toast, show: showToast } = useToast();

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const fail = (message: string) => {
      setLoadError(message);
      setLoading(false);
    };
    const unsubCats = subscribeVehicleCategories((data) => {
      setCategories(data);
      setLoading(false);
    }, fail);
    const unsubVehicles = subscribeVehicles(setVehicles, fail);
    return () => {
      unsubCats();
      unsubVehicles();
    };
  }, [retryKey]);

  const fleet = useMemo(() => vehicles.map(mapVehicle), [vehicles]);
  const getVehicleCountForCategory = (cat: VehicleCategory) => vehiclesInCategory(cat, fleet).length;

  // Filtered & Sorted Categories
  const filteredCategories = categories
    .filter((cat) => {
      const q = search.trim().toLowerCase();
      const matchSearch =
        q === "" ||
        cat.name.toLowerCase().includes(q) ||
        (cat.code && cat.code.toLowerCase().includes(q)) ||
        (cat.description && cat.description.toLowerCase().includes(q));
      const matchStatus = statusFilter === "All" || cat.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "seats") return (b.seatingCapacity || 0) - (a.seatingCapacity || 0);
      return (a.displayOrder || 99) - (b.displayOrder || 99);
    });

  const tabHasError = (tab: FormTab) => TAB_FIELDS[tab].some((f) => fieldErrors[f]);
  const errNode = (f: CategoryField) =>
    fieldErrors[f] ? <p className="text-[10px] text-red-600 mt-1">{fieldErrors[f]}</p> : null;

  // Modal actions
  const openForm = (data: typeof defaultFormState, original: VehicleCategory | null) => {
    setIsEditing(!!original);
    setEditingOriginal(original);
    setFormData(data);
    setActiveTab("basic");
    setFormError(null);
    setFieldErrors({});
    setShowModal(true);
  };

  const handleOpenAdd = () =>
    openForm(
      { ...defaultFormState, displayOrder: categories.reduce((m, c) => Math.max(m, c.displayOrder || 0), 0) + 1 },
      null,
    );

  const handleOpenEdit = (cat: VehicleCategory) =>
    openForm(
      {
        id: cat.id,
        name: cat.name,
        code: cat.code || "",
        description: cat.description && cat.description.trim().length <= 48 ? cat.description.trim() : "",
        imageUrl: cat.imageUrl || "",
        icon: cat.icon || "🚘",
        seatingCapacity: cat.seatingCapacity || 0,
        luggageCapacity: cat.luggageCapacity ?? "",
        acSupported: cat.acSupported === "AC" || cat.acSupported === "Non-AC" ? cat.acSupported : "Both",
        recommendedPassengers: cat.recommendedPassengers || 0,
        displayOrder: cat.displayOrder || 1,
        status: cat.status || "Active",
        cngEnabled: cat.cngEnabled === true,
        fare: {
          baseFare: cat.fare?.baseFare ?? 0,
          baseKm: cat.fare?.baseKm ?? 0,
          perKmRate: cat.fare?.perKmRate ?? 0,
          minimumFare: cat.fare?.minimumFare ?? 0,
          driverAllowance: cat.fare?.driverAllowance ?? 0,
          nightAllowance: cat.fare?.nightAllowance ?? 0,
          waitingChargePerHour: cat.fare?.waitingChargePerHour ?? 0,
          extraHourCharge: cat.fare?.extraHourCharge ?? 0,
          extraKmCharge: cat.fare?.extraKmCharge ?? 0,
          tollIncluded: Boolean(cat.fare?.tollIncluded),
          parkingIncluded: Boolean(cat.fare?.parkingIncluded),
          permitCharge: cat.fare?.permitCharge ?? 0,
          carrierCharge: cat.fare?.carrierCharge ?? 0,
          outstationPerKmRate: cat.fare?.outstationPerKmRate ?? 0,
          outstationDriverBattaPerDay: cat.fare?.outstationDriverBattaPerDay ?? 0,
          outstationMinKmPerDay: cat.fare?.outstationMinKmPerDay ?? 0,
        },
      },
      cat,
    );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    const form = toForm(formData);
    const errors = validateCategory(form, categories, editingOriginal?.id ?? null);
    setFieldErrors(errors);
    const keys = Object.keys(errors) as CategoryField[];
    if (keys.length) {
      setFormError(
        `Please fix: ${keys.map((k) => `${FIELD_LABELS[k] || k} — ${errors[k]}`).join(" ")}`,
      );
      const firstTab = (Object.keys(TAB_FIELDS) as FormTab[]).find((t) => TAB_FIELDS[t].includes(keys[0]));
      if (firstTab) setActiveTab(firstTab);
      return;
    }
    setSaving(true);
    try {
      const { renamed } = await saveCategory(form, editingOriginal);
      setShowModal(false);
      showToast(
        editingOriginal
          ? `Vehicle category "${form.name.trim()}" updated${renamed ? ` (${renamed} linked record${renamed === 1 ? "" : "s"} renamed)` : ""}.`
          : `Vehicle category "${form.name.trim()}" created.`,
      );
    } catch (err) {
      setFormError(actionError(err));
    } finally {
      setSaving(false);
    }
  };

  // Toggle status
  const handleToggleStatus = async (cat: VehicleCategory) => {
    if (statusBusyId) return;
    const newStatus = cat.status === "Active" ? "Inactive" : "Active";
    setStatusBusyId(cat.id);
    try {
      await setCategoryStatus(cat, newStatus);
      showToast(
        newStatus === "Inactive"
          ? `"${cat.name}" is hidden from new bookings.`
          : `"${cat.name}" is available for booking again.`,
      );
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
      await deleteCategory(deleteTarget, fleet);
      showToast(`Vehicle category "${deleteTarget.name}" removed.`);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(actionError(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={embedded ? "space-y-6" : "p-6 space-y-6"}>
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      {/* Top Action Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          {embedded ? <h2 className="text-[16px] font-bold text-ink">Vehicle Categories</h2> : <h1 className="text-[20px] font-bold text-ink">Vehicle Categories</h1>}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-white rounded-lg shadow-sm hover:opacity-90 transition-all cursor-pointer"
            style={{ background: "#c1232c" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            + Add Vehicle Category
          </button>
        </div>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Total Categories",
            value: categories.length.toString(),
            color: "#c1232c",
          },
          {
            label: "Active Categories",
            value: categories.filter((c) => c.status === "Active").length.toString(),
            color: "#10B981",
          },
          {
            label: "Inactive Categories",
            value: categories.filter((c) => c.status === "Inactive").length.toString(),
            color: "#6B7280",
          },
          {
            label: "Total Vehicles",
            value: vehicles.length.toString(),
            color: "#3B82F6",
          },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
            <div className="text-[24px] font-bold" style={{ color: s.color }}>
              {s.value}
            </div>
            <div className="text-[12px] font-semibold text-ink mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white rounded-xl border border-line p-12 text-center text-[13px] text-faint">
          Loading vehicle categories...
        </div>
      ) : categories.length === 0 ? (
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
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z"
              />
            </svg>
          </div>
          <h2 className="text-[18px] font-bold text-ink mb-2">No vehicle categories found.</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={handleOpenAdd}
              className="px-6 py-2.5 text-[13px] font-semibold text-white rounded-lg hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
              style={{ background: "#c1232c" }}
            >
              + Add Vehicle Category
            </button>
          </div>
        </div>
      ) : (
        /* Category Directory Table & Controls */
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          {/* Controls Bar */}
          <div className="p-4 border-b border-line flex flex-wrap items-center justify-between gap-3 bg-surface-2">
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
                placeholder="Search category name, code..."
                className="w-full pl-9 pr-4 py-2 text-[12px] bg-white border border-line rounded-lg focus:outline-none focus:border-brand placeholder-faint"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted font-medium">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white focus:outline-none focus:border-brand text-body"
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>

              <span className="text-[11px] text-muted font-medium ml-2">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white focus:outline-none focus:border-brand text-body"
              >
                <option value="order">Display Order</option>
                <option value="name">Category Name</option>
                <option value="seats">Seating Capacity</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px]">
              <thead>
                <tr className="bg-surface-2 border-b border-line">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide">
                    Category
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold text-faint uppercase tracking-wide">
                    Seating & Luggage
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide">
                    Base Fare
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide">
                    Per KM Rate
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide">
                    Driver Batta
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold text-faint uppercase tracking-wide">
                    Vehicles
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold text-faint uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-faint uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredCategories.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-[12px] text-faint">
                      No vehicle categories match your search filters.
                    </td>
                  </tr>
                ) : (
                  filteredCategories.map((cat) => {
                    const vehicleCount = getVehicleCountForCategory(cat);
                    return (
                      <tr key={cat.id} className="border-b border-hover hover:bg-surface-2 transition-colors">
                        {/* Category Name & Code */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-brand-soft flex items-center justify-center text-[20px] shrink-0 border border-[#FEE2E2]">
                              {cat.imageUrl ? (
                                <img
                                  src={cat.imageUrl}
                                  alt={cat.name}
                                  className="w-full h-full object-cover rounded-xl"
                                  onError={(e) => {
                                    (e.target as any).style.display = "none";
                                  }}
                                />
                              ) : (
                                cat.icon || "🚘"
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-bold text-ink">{cat.description?.trim() || cat.name}</span>
                                {cat.code && (
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-bold uppercase">
                                    {cat.code}
                                  </span>
                                )}
                                {cat.cngEnabled && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-bold uppercase">CNG</span>
                                )}
                              </div>
                              {cat.description?.trim() && cat.description.trim() !== cat.name && (
                                <div className="text-[11px] text-faint line-clamp-1 max-w-xs">
                                  {cat.name}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Seating */}
                        <td className="px-4 py-3.5 text-center">
                          <div className="text-[12px] font-bold text-ink">
                            {cat.seatingCapacity} Seats
                          </div>
                          <div className="text-[10px] text-faint">
                            {cat.luggageCapacity || "Standard luggage"}
                          </div>
                        </td>

                        {/* Base Fare */}
                        <td className="px-4 py-3.5">
                          <div className="text-[12px] font-bold text-brand">
                            ₹{cat.fare?.baseFare ?? 0}
                          </div>
                          <div className="text-[10px] text-faint">
                            Min {cat.fare?.baseKm ?? 10} km
                          </div>
                        </td>

                        {/* Per KM */}
                        <td className="px-4 py-3.5">
                          <div className="text-[12px] font-semibold text-ink">
                            ₹{cat.fare?.perKmRate ?? 0} <span className="text-[10px] font-normal text-faint">/ km</span>
                          </div>
                          {cat.fare?.outstationPerKmRate ? (
                            <div className="text-[10px] text-faint">
                              Outstation: ₹{cat.fare.outstationPerKmRate}/km
                            </div>
                          ) : null}
                        </td>

                        {/* Driver Batta */}
                        <td className="px-4 py-3.5">
                          <div className="text-[12px] font-medium text-body">
                            ₹{cat.fare?.driverAllowance ?? 0}
                          </div>
                        </td>

                        {/* Vehicle Count */}
                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            {vehicleCount} {vehicleCount === 1 ? "Vehicle" : "Vehicles"}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3.5 text-center">
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                              cat.status === "Active"
                                ? "bg-green-50 text-green-700 border-green-200"
                                : "bg-gray-100 text-gray-600 border-gray-200"
                            }`}
                          >
                            {cat.status}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(cat)}
                              className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-line text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleToggleStatus(cat)}
                              disabled={statusBusyId === cat.id}
                              className={`px-2 py-1 text-[11px] font-medium rounded-lg border transition-colors cursor-pointer disabled:opacity-50 ${
                                cat.status === "Active"
                                  ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              }`}
                            >
                              {cat.status === "Active" ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteTarget(cat);
                              }}
                              className="px-2 py-1 text-[11px] font-medium rounded-lg border border-red-200 bg-red-50 text-brand hover:bg-red-100 transition-colors cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Category Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden my-8">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-line flex items-center justify-between bg-surface-2">
              <div>
                <h3 className="text-[16px] font-bold text-ink">
                  {isEditing ? "Edit Vehicle Category" : "+ Add Vehicle Category"}
                </h3>
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
            <div className="flex flex-wrap border-b border-line bg-hover px-6 pt-2">
              {([
                { id: "basic", label: "Category Info" },
                { id: "specs", label: "Vehicle Specs" },
                { id: "fare", label: "Local Fare Rules" },
                { id: "outstation", label: "Outstation & Extra Charges" },
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

            {/* Form Form Container */}
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
                          Category Name *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Sedan"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("name")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Category Code
                        </label>
                        <input
                          type="text"
                          placeholder="SEDAN"
                          value={formData.code}
                          onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] font-mono focus:outline-none focus:border-brand"
                        />
                        {errNode("code")}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-ink mb-1">
                        Display Text
                      </label>
                      <input
                        type="text"
                        maxLength={48}
                        placeholder="Dzire / Etios or similar"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                      />
                    </div>

                    <label className="flex items-center gap-3 p-3 rounded-xl border border-line bg-gray-50 max-w-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.cngEnabled === true}
                        onChange={(e) => setFormData({ ...formData, cngEnabled: e.target.checked })}
                        className="w-4 h-4 accent-brand"
                      />
                      <span className="text-[12px] font-semibold text-ink">CNG available</span>
                    </label>

                    <div className="max-w-xs">
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
                  </div>
                )}

                {/* TAB 2: SPECS */}
                {activeTab === "specs" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Seats *
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          required
                          value={formData.seatingCapacity}
                          onChange={(e) =>
                            setFormData({ ...formData, seatingCapacity: parseInt(e.target.value) || 0 })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("seatingCapacity")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Luggage
                        </label>
                        <input
                          type="text"
                          placeholder="2 Large Bags"
                          value={formData.luggageCapacity}
                          onChange={(e) => setFormData({ ...formData, luggageCapacity: e.target.value })}
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
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
                    </div>
                  </div>
                )}

                {/* TAB 3: LOCAL FARE */}
                {activeTab === "fare" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Base Fare (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fare.baseFare}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: { ...formData.fare, baseFare: parseFloat(e.target.value) || 0 },
                            })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("fare.baseFare")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Base KM / Minimum KM
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fare.baseKm}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: { ...formData.fare, baseKm: parseFloat(e.target.value) || 0 },
                            })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("fare.baseKm")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Per KM Rate (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fare.perKmRate}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: { ...formData.fare, perKmRate: parseFloat(e.target.value) || 0 },
                            })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("fare.perKmRate")}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Driver Allowance (Batta) (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fare.driverAllowance}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: { ...formData.fare, driverAllowance: parseFloat(e.target.value) || 0 },
                            })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("fare.driverAllowance")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Night Allowance (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fare.nightAllowance}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: { ...formData.fare, nightAllowance: parseFloat(e.target.value) || 0 },
                            })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("fare.nightAllowance")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Minimum Fare (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fare.minimumFare}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: { ...formData.fare, minimumFare: parseFloat(e.target.value) || 0 },
                            })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("fare.minimumFare")}
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 4: OUTSTATION & EXTRAS */}
                {activeTab === "outstation" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Outstation Per KM Rate (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fare.outstationPerKmRate}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: {
                                ...formData.fare,
                                outstationPerKmRate: parseFloat(e.target.value) || 0,
                              },
                            })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("fare.outstationPerKmRate")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Outstation Driver Batta / Day (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fare.outstationDriverBattaPerDay}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: {
                                ...formData.fare,
                                outstationDriverBattaPerDay: parseFloat(e.target.value) || 0,
                              },
                            })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("fare.outstationDriverBattaPerDay")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Time Charge / Hour (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fare.waitingChargePerHour}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: {
                                ...formData.fare,
                                waitingChargePerHour: parseFloat(e.target.value) || 0,
                              },
                            })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("fare.waitingChargePerHour")}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Extra KM Charge (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fare.extraKmCharge}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: {
                                ...formData.fare,
                                extraKmCharge: parseFloat(e.target.value) || 0,
                              },
                            })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("fare.extraKmCharge")}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-ink mb-1">
                          Permit Charge (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fare.permitCharge}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: { ...formData.fare, permitCharge: parseFloat(e.target.value) || 0 },
                            })
                          }
                          className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
                        />
                        {errNode("fare.permitCharge")}
                      </div>

                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-line">
                        <input
                          type="checkbox"
                          id="tollInc"
                          checked={formData.fare.tollIncluded}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: { ...formData.fare, tollIncluded: e.target.checked },
                            })
                          }
                          className="w-4 h-4 accent-brand"
                        />
                        <label htmlFor="tollInc" className="text-[12px] font-semibold text-ink">
                          Toll Included in Base Fare
                        </label>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-line">
                        <input
                          type="checkbox"
                          id="parkInc"
                          checked={formData.fare.parkingIncluded}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              fare: { ...formData.fare, parkingIncluded: e.target.checked },
                            })
                          }
                          className="w-4 h-4 accent-brand"
                        />
                        <label htmlFor="parkInc" className="text-[12px] font-semibold text-ink">
                          Parking Included in Base Fare
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-line flex items-center justify-between bg-surface-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                  className="px-4 py-2 border border-line rounded-lg text-[12px] font-semibold text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
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
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  )}
                  {saving
                    ? "Saving..."
                    : isEditing
                    ? "Update Vehicle Category"
                    : "Save Vehicle Category"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete "${deleteTarget.name}"?`}
          message="The category is removed permanently. It can only be deleted when no vehicle, fare rule, service, tour package or coupon uses it — otherwise deactivate it to hide it from new bookings."
          confirmLabel="Delete Category"
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

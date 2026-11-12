import CategoryMediaField from '../components/CategoryMediaField';
import BulkCarImages from '../components/BulkCarImages';
import { categoryMediaProblem, compressCategoryImage, uploadCategoryMedia } from '../services/categoryMedia';
import { useEffect, useMemo, useRef, useState } from "react";
import { VehicleCategory, Vehicle } from "../types";
import { subscribeVehicleCategories, subscribeVehicles } from "../services/adminFirestoreService";
import {
  CategoryActionError,
  deleteCategory,
  saveCategory,
  BRAND_IMAGE_BRANDS,
  brandsOfCategory,
  carImageForBrand,
  categoryOffersBrand,
  categoryStatusForBrand,
  setCategoryBrand,
  setCategoryBrandStatus,
  setCategoryImage,
  type BrandImageKey,
  validateCategory,
  vehiclesInCategory,
  type CategoryField,
  type CategoryForm,
} from "../services/categoryService";
import { mapVehicle } from "../services/vehicleService";
import { CLASS_LABEL, tariffClassOfCategory } from "../services/tariffService";
import { ConfirmDialog, ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Button } from "../components/ui";

const BRAND_TAB_KEY = "nesam.admin.vehicleCategories.brand";
const BRAND_ACCENT: Record<BrandImageKey, string> = { nesam: "#c1232c", onewaycarrentals: "#0d8a45", people_taxi: "#1d4ed8" };
const brandLabel = (id: BrandImageKey) => BRAND_IMAGE_BRANDS.find((b) => b.id === id)?.name ?? id;
const initialBrand = (): BrandImageKey => {
  try {
    const saved = window.localStorage.getItem(BRAND_TAB_KEY);
    if (BRAND_IMAGE_BRANDS.some((b) => b.id === saved)) return saved as BrandImageKey;
  } catch { /* storage unavailable: start on the first brand */ }
  return "nesam";
};

type FormTab = "basic" | "specs";

const TAB_FIELDS: Record<FormTab, CategoryField[]> = {
  basic: ["name", "code", "imageUrl", "iconUrl"],
  specs: ["seatingCapacity", "recommendedPassengers", "displayOrder", "fare.carrierCharge"],
};

const FIELD_LABELS: Partial<Record<CategoryField, string>> = {
  name: "Category name",
  code: "Category code",
  imageUrl: "Car image",
  iconUrl: "Category icon",
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
  "fare.carrierCharge": "Roof carrier charge",
};

// A new category starts without prices: every rate must be entered by the admin.
const defaultFormState = {
  id: "",
  name: "",
  code: "",
  description: "",
  imageUrl: "",
  brandImages: {} as Partial<Record<BrandImageKey, string>>,
  brands: [] as BrandImageKey[],
  brandStatus: {} as Partial<Record<BrandImageKey, "Active" | "Inactive">>,
  iconUrl: "",
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
  brandImages: { ...f.brandImages },
  brands: [...f.brands],
  brandStatus: { ...f.brandStatus },
  iconUrl: f.iconUrl,
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

  // Each brand manages its own list: a category is offered on the brands it is added to.
  const [brand, setBrandState] = useState<BrandImageKey>(initialBrand);
  const [showAddExisting, setShowAddExisting] = useState(false);
  const [brandBusyId, setBrandBusyId] = useState<string | null>(null);
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageTarget = useRef<VehicleCategory | null>(null);
  const brandName = brandLabel(brand);
  const accent = BRAND_ACCENT[brand];
  const changeBrand = (next: BrandImageKey) => {
    setBrandState(next);
    setSearch("");
    setStatusFilter("All");
    try { window.localStorage.setItem(BRAND_TAB_KEY, next); } catch { /* remembering the tab is optional */ }
  };

  // Filters & Sorting
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Inactive">("All");
  const [sortBy, setSortBy] = useState<"name" | "order" | "seats">("order");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingOriginal, setEditingOriginal] = useState<VehicleCategory | null>(null);
  const [formData, setFormData] = useState(defaultFormState);
  const [activeTab, setActiveTab] = useState<FormTab>("basic");
  const [saving, setSaving] = useState(false);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [carFile, setCarFile] = useState<File | null>(null);
  const [brandFiles, setBrandFiles] = useState<Partial<Record<BrandImageKey, File | null>>>({});
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

  const brandCategories = useMemo(() => categories.filter((c) => categoryOffersBrand(c, brand)), [categories, brand]);
  const notOffered = useMemo(
    () => categories.filter((c) => !categoryOffersBrand(c, brand)).sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)),
    [categories, brand],
  );

  // Filtered & Sorted Categories
  const filteredCategories = brandCategories
    .filter((cat) => {
      const q = search.trim().toLowerCase();
      const matchSearch =
        q === "" ||
        cat.name.toLowerCase().includes(q) ||
        (cat.code && cat.code.toLowerCase().includes(q)) ||
        (cat.description && cat.description.toLowerCase().includes(q));
      const matchStatus = statusFilter === "All" || categoryStatusForBrand(cat, brand) === statusFilter;
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
    setIconFile(null);
    setCarFile(null);
    setBrandFiles({});
    setActiveTab("basic");
    setFormError(null);
    setFieldErrors({});
    setShowModal(true);
  };

  const handleOpenAdd = () =>
    openForm(
      // A category added from a brand's tab is offered on that brand only; tick more brands in the form to share it.
      { ...defaultFormState, brands: [brand], displayOrder: brandCategories.reduce((m, c) => Math.max(m, c.displayOrder || 0), 0) + 1 },
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
        brandImages: { ...(cat.brandImages ?? {}) },
        brands: brandsOfCategory(cat),
        brandStatus: { ...(cat.brandStatus ?? {}) },
        iconUrl: cat.iconUrl || "",
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
    if (iconFile) form.iconUrl = '';
    if (carFile) form.imageUrl = '';
    const errors = validateCategory(form, categories, editingOriginal?.id ?? null);
    if (errors.name?.includes("already exists") || errors.code?.includes("already used")) {
      const existing = categories.find((c) => c.id !== editingOriginal?.id && (c.name || "").trim().toLowerCase() === form.name.trim().toLowerCase());
      if (existing && !categoryOffersBrand(existing, brand)) {
        errors.name = `${errors.name ?? "This category already exists."} It is not offered on ${brandName} yet: close this form and use “Add existing category”.`;
      }
    }
    if (!form.brands?.length) errors.name = errors.name ?? "Choose at least one brand that offers this category.";
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
      const mediaFolder = editingOriginal?.id || crypto.randomUUID();
      if (iconFile) {
        form.iconUrl = await uploadCategoryMedia(iconFile, 'icon', mediaFolder);
        setFormData(current => ({ ...current, iconUrl: form.iconUrl || '' }));
        setIconFile(null);
      }
      if (carFile) {
        form.imageUrl = await uploadCategoryMedia(carFile, 'car', mediaFolder);
        setFormData(current => ({ ...current, imageUrl: form.imageUrl || '' }));
        setCarFile(null);
      }
      for (const brand of BRAND_IMAGE_BRANDS) {
        const file = brandFiles[brand.id];
        if (!file) continue;
        const url = await uploadCategoryMedia(file, 'car', mediaFolder);
        form.brandImages = { ...(form.brandImages ?? {}), [brand.id]: url };
        setFormData(current => ({ ...current, brandImages: { ...current.brandImages, [brand.id]: url } }));
        setBrandFiles(current => ({ ...current, [brand.id]: null }));
      }
      const { renamed } = await saveCategory(form, editingOriginal);
      setShowModal(false);
      showToast(
        editingOriginal
          ? `Vehicle category "${form.name.trim()}" updated${renamed ? ` (${renamed} linked record${renamed === 1 ? "" : "s"} renamed)` : ""}.`
          : `Vehicle category "${form.name.trim()}" created.`,
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : actionError(err));
    } finally {
      setSaving(false);
    }
  };

  // Hide or show a category on this brand's site only.
  const handleToggleStatus = async (cat: VehicleCategory) => {
    if (statusBusyId) return;
    const newStatus = categoryStatusForBrand(cat, brand) === "Active" ? "Inactive" : "Active";
    setStatusBusyId(cat.id);
    try {
      await setCategoryBrandStatus(cat, brand, newStatus);
      showToast(
        newStatus === "Inactive"
          ? `"${cat.name}" is hidden from new ${brandName} bookings.`
          : `"${cat.name}" is available on ${brandName} again.`,
      );
    } catch (err) {
      showToast(actionError(err), "error");
    } finally {
      setStatusBusyId(null);
    }
  };

  // A category offered by other brands is only taken off this brand; one used by this brand alone is deleted.
  const deleteRemovesOnlyFromBrand = (cat: VehicleCategory) => brandsOfCategory(cat).some((b) => b !== brand);

  // Delete handling
  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (deleteRemovesOnlyFromBrand(deleteTarget)) {
        await setCategoryBrand(deleteTarget, brand, false);
        showToast(`"${deleteTarget.name}" removed from ${brandName}. Other brands still offer it.`);
      } else {
        await deleteCategory(deleteTarget, fleet);
        showToast(`Vehicle category "${deleteTarget.name}" removed.`);
      }
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(actionError(err));
    } finally {
      setDeleting(false);
    }
  };

  // Upload one car picture for this brand straight from its row.
  const pickRowImage = (cat: VehicleCategory) => {
    imageTarget.current = cat;
    imageInput.current?.click();
  };
  const handleRowImage = async (file: File | undefined) => {
    const cat = imageTarget.current;
    imageTarget.current = null;
    if (!file || !cat) return;
    const bad = categoryMediaProblem(file);
    if (bad) return showToast(`${file.name}: ${bad}`, "error");
    setImageBusyId(cat.id);
    try {
      const result = await compressCategoryImage(file, "car", cat.name);
      const url = await uploadCategoryMedia(result.file, "car", cat.id);
      await setCategoryImage(cat, url, brand);
      showToast(`${brandName} car image updated for "${cat.name}".`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : actionError(err), "error");
    } finally {
      setImageBusyId(null);
    }
  };

  const handleAddExisting = async (cat: VehicleCategory) => {
    if (brandBusyId) return;
    setBrandBusyId(cat.id);
    try {
      await setCategoryBrand(cat, brand, true);
      showToast(`"${cat.name}" is now offered on ${brandName}.`);
    } catch (err) {
      showToast(actionError(err), "error");
    } finally {
      setBrandBusyId(null);
    }
  };

  return (
    <div className={embedded ? "space-y-6" : "p-6 space-y-6"}>
      <Toast toast={toast} />
      {showBulk ? <BulkCarImages categories={brandCategories} brand={brand} onClose={() => setShowBulk(false)} onDone={(message) => showToast(message)} /> : null}
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => { void handleRowImage(e.target.files?.[0]); e.target.value = ""; }} />

      {/* Brand tabs: each brand manages its own categories and car images */}
      <div role="tablist" aria-label="Brand" className="flex flex-wrap gap-2">
        {BRAND_IMAGE_BRANDS.map((b) => {
          const on = b.id === brand;
          const count = categories.filter((c) => categoryOffersBrand(c, b.id)).length;
          return (
            <button
              key={b.id}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => changeBrand(b.id)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-bold transition-colors cursor-pointer ${on ? "text-white shadow-sm" : "bg-white text-ink border-line hover:bg-hover"}`}
              style={on ? { background: BRAND_ACCENT[b.id], borderColor: BRAND_ACCENT[b.id] } : undefined}
            >
              {b.name}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? "bg-white/25" : "bg-gray-100 text-muted"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Top Action Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          {embedded ? <h2 className="text-[16px] font-bold text-ink">{brandName} — Vehicle Categories</h2> : <h1 className="text-[20px] font-bold text-ink">{brandName} — Vehicle Categories</h1>}
          <p className="text-[12px] text-muted mt-0.5">Categories and car images customers see on the {brandName} site. Changes here do not affect the other brands.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddExisting(true)}
            disabled={!notOffered.length}
            className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-ink bg-white border border-line rounded-lg shadow-sm hover:bg-hover transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add existing category{notOffered.length ? ` (${notOffered.length})` : ""}
          </button>
          <button
            type="button"
            onClick={() => setShowBulk(true)}
            disabled={!brandCategories.length}
            className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-ink bg-white border border-line rounded-lg shadow-sm hover:bg-hover transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Upload car images
          </button>
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-white rounded-lg shadow-sm hover:opacity-90 transition-all cursor-pointer"
            style={{ background: accent }}
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
            value: brandCategories.length.toString(),
            color: accent,
          },
          {
            label: "Active Categories",
            value: brandCategories.filter((c) => categoryStatusForBrand(c, brand) === "Active").length.toString(),
            color: "#10B981",
          },
          {
            label: "Inactive Categories",
            value: brandCategories.filter((c) => categoryStatusForBrand(c, brand) === "Inactive").length.toString(),
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
      ) : brandCategories.length === 0 ? (
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
          <h2 className="text-[18px] font-bold text-ink mb-2">No vehicle categories on {brandName} yet.</h2>
          <div className="flex items-center gap-3">
            {notOffered.length ? (
              <button
                onClick={() => setShowAddExisting(true)}
                className="px-6 py-2.5 text-[13px] font-semibold text-ink bg-white border border-line rounded-lg hover:bg-hover transition-colors cursor-pointer shadow-sm"
              >
                Add existing category
              </button>
            ) : null}
            <button
              onClick={handleOpenAdd}
              className="px-6 py-2.5 text-[13px] font-semibold text-white rounded-lg hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
              style={{ background: accent }}
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
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-surface-2 border-b border-line">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide">
                    Category
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold text-faint uppercase tracking-wide">
                    Seating & Luggage
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide">
                    Priced as
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
                    <td colSpan={6} className="px-4 py-8 text-center text-[12px] text-faint">
                      No vehicle categories match your search filters.
                    </td>
                  </tr>
                ) : (
                  filteredCategories.map((cat) => {
                    const vehicleCount = getVehicleCountForCategory(cat);
                    const status = categoryStatusForBrand(cat, brand);
                    const carImage = carImageForBrand(cat, brand);
                    const otherBrands = brandsOfCategory(cat).filter((b) => b !== brand);
                    return (
                      <tr key={cat.id} className="border-b border-hover hover:bg-surface-2 transition-colors">
                        {/* Category Name & Code */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="flex w-16 shrink-0 flex-col items-center gap-1">
                              <div className="w-10 h-10 rounded-xl bg-brand-soft flex items-center justify-center text-[20px] shrink-0 border border-[#FEE2E2]">
                                {carImage || cat.iconUrl ? (
                                  <img
                                    src={carImage || cat.iconUrl}
                                    alt={cat.name}
                                    className="w-full h-full object-contain p-1 rounded-xl"
                                    onError={(e) => {
                                      (e.target as any).style.display = "none";
                                    }}
                                  />
                                ) : (
                                  cat.icon || "🚘"
                                )}
                              </div>
                              {/* The category name on a small number-plate badge, under the car. */}
                              <span
                                title={cat.name}
                                className="block max-w-full truncate rounded-[3px] border border-ink bg-[#FFD84D] px-1.5 py-px text-center text-[8px] font-extrabold uppercase leading-[12px] tracking-wider text-ink"
                              >
                                {cat.name}
                              </span>
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
                              <div className="text-[10px] text-faint mt-0.5">
                                {cat.brandImages?.[brand] ? `${brandName} image` : carImage ? "Shared image" : "No car image"}
                                {" · "}
                                {otherBrands.length ? `Also on ${otherBrands.map(brandLabel).join(", ")}` : `${brandName} only`}
                              </div>
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

                        {/* Rate class: which rates in Service & Fare Settings → Fares price this vehicle */}
                        <td className="px-4 py-3.5">
                          <div className="text-[12px] font-semibold text-ink">{CLASS_LABEL[tariffClassOfCategory(cat)]} rates</div>
                          <div className="text-[10px] text-faint">Set in Fares</div>
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
                              status === "Active"
                                ? "bg-green-50 text-green-700 border-green-200"
                                : "bg-gray-100 text-gray-600 border-gray-200"
                            }`}
                          >
                            {status}
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
                              onClick={() => pickRowImage(cat)}
                              disabled={imageBusyId === cat.id}
                              title={`Upload the car image shown on ${brandName}`}
                              className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-line text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {imageBusyId === cat.id ? "Uploading…" : "Image"}
                            </button>
                            <button
                              onClick={() => handleToggleStatus(cat)}
                              disabled={statusBusyId === cat.id}
                              className={`px-2 py-1 text-[11px] font-medium rounded-lg border transition-colors cursor-pointer disabled:opacity-50 ${
                                status === "Active"
                                  ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              }`}
                            >
                              {status === "Active" ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteTarget(cat);
                              }}
                              className="px-2 py-1 text-[11px] font-medium rounded-lg border border-red-200 bg-red-50 text-brand hover:bg-red-100 transition-colors cursor-pointer"
                            >
                              {otherBrands.length ? "Remove" : "Delete"}
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
                  {isEditing ? `Edit Vehicle Category — ${brandName}` : `+ Add Vehicle Category — ${brandName}`}
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
              <fieldset disabled={saving} className="p-6 space-y-4 max-h-[60vh] overflow-y-auto min-w-0">
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

                    <section aria-label="Category images" className="space-y-2">
                      <h4 className="text-sm font-bold">{brandName} car image</h4>
                      <p className="text-xs text-muted">Shown on the {brandName} site only. Without one, {brandName} uses the shared car image below.</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <CategoryMediaField
                          label={`${brandName} car image`}
                          kind="car"
                          plateText={formData.name}
                          value={formData.brandImages[brand] || ''}
                          file={brandFiles[brand] ?? null}
                          disabled={saving}
                          onChange={(file, clear) => {
                            setBrandFiles(current => ({ ...current, [brand]: file }));
                            if (clear) setFormData(current => { const next = { ...current.brandImages }; delete next[brand]; return { ...current, brandImages: next }; });
                          }}
                        />
                      </div>
                      <details className="pt-2 rounded-lg border border-line p-3">
                        <summary className="cursor-pointer text-[12px] font-bold text-ink">Shared artwork and other brands' car images</summary>
                        <p className="text-xs text-muted my-2">The icon and shared car image are used by every brand that has no car image of its own.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <CategoryMediaField label="Category icon" kind="icon" value={formData.iconUrl} file={iconFile} disabled={saving} onChange={(file, clear) => { setIconFile(file); if (clear) setFormData(current => ({ ...current, iconUrl: '' })); }} />
                          <CategoryMediaField label="Shared car image" kind="car" plateText={formData.name} value={formData.imageUrl} file={carFile} disabled={saving} onChange={(file, clear) => { setCarFile(file); if (clear) setFormData(current => ({ ...current, imageUrl: '' })); }} />
                          {BRAND_IMAGE_BRANDS.filter((b) => b.id !== brand).map((b) => (
                            <CategoryMediaField
                              key={b.id}
                              label={`${b.name} car image`}
                              kind="car"
                              plateText={formData.name}
                              value={formData.brandImages[b.id] || ''}
                              file={brandFiles[b.id] ?? null}
                              disabled={saving}
                              onChange={(file, clear) => {
                                setBrandFiles(current => ({ ...current, [b.id]: file }));
                                if (clear) setFormData(current => { const next = { ...current.brandImages }; delete next[b.id]; return { ...current, brandImages: next }; });
                              }}
                            />
                          ))}
                        </div>
                      </details>
                      {errNode('iconUrl')}{errNode('imageUrl')}
                    </section>

                    <fieldset className="rounded-lg border border-line p-3">
                      <legend className="px-1 text-[11px] font-bold text-ink">Offered on</legend>
                      <div className="flex flex-wrap gap-4">
                        {BRAND_IMAGE_BRANDS.map((b) => {
                          const checked = formData.brands.includes(b.id);
                          const lastOne = checked && formData.brands.length === 1;
                          return (
                            <label key={b.id} className="flex items-center gap-2 text-[12px] font-semibold text-ink cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={lastOne}
                                title={lastOne ? "A category must be offered on at least one brand." : undefined}
                                onChange={(e) => setFormData(current => ({
                                  ...current,
                                  brands: e.target.checked ? [...new Set([...current.brands, b.id])] : current.brands.filter((x) => x !== b.id),
                                }))}
                                className="w-4 h-4 accent-brand"
                              />
                              {b.name}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>

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
                      <label className="block text-[11px] font-bold text-ink mb-1">Status on {brandName}</label>
                      <select
                        value={formData.status === "Inactive" || formData.brandStatus[brand] === "Inactive" ? "Inactive" : "Active"}
                        onChange={(e) => setFormData(current => {
                          const brandStatus = { ...current.brandStatus };
                          if (e.target.value === "Inactive") brandStatus[brand] = "Inactive"; else delete brandStatus[brand];
                          // Switching a globally inactive category on from here turns it on for this brand only.
                          if (e.target.value === "Active" && current.status === "Inactive") {
                            for (const b of BRAND_IMAGE_BRANDS) if (b.id !== brand) brandStatus[b.id] = "Inactive";
                            return { ...current, status: "Active", brandStatus };
                          }
                          return { ...current, brandStatus };
                        })}
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
                    <section className="rounded-lg border border-line p-4 space-y-3">
                      <h3 className="font-bold text-sm">Roof carrier charge</h3>
                      <p className="text-xs text-muted">Per trip, only when selected. Applies to all vehicles in this category across all brands, using the booking's GST setting. Enter 0 for no extra charge.</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {([['carrierCharge', 'Roof carrier charge']] as const).map(([key, label]) => (
                          <label key={key} className="block text-xs font-semibold">{label} (INR / trip)
                            <input type="number" min="0" max="100000" step="0.01" value={formData.fare[key]}
                              onChange={(e) => setFormData({ ...formData, fare: { ...formData.fare, [key]: Number(e.target.value) } })}
                              className="mt-1 w-full p-2.5 border border-line rounded-lg" />
                            {errNode(`fare.${key}`)}
                          </label>
                        ))}
                      </div>
                    </section>
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
              </fieldset>

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

      {showAddExisting && (
        <Modal
          title={`Add existing category to ${brandName}`}
          subtitle={`Categories other brands already offer. Adding one shows it on the ${brandName} site; its details stay shared.`}
          onClose={() => setShowAddExisting(false)}
          size="md"
          footer={<Button variant="primary" onClick={() => setShowAddExisting(false)}>Done</Button>}
        >
          {notOffered.length === 0 ? (
            <p className="text-[12px] text-muted">Every category is already offered on {brandName}.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {notOffered.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-ink">{c.description?.trim() || c.name}</p>
                    <p className="text-[11px] text-muted">{c.name} · {c.seatingCapacity} seats · on {brandsOfCategory(c).map(brandLabel).join(", ") || "no brand"}</p>
                  </div>
                  <Button onClick={() => handleAddExisting(c)} disabled={brandBusyId === c.id}>{brandBusyId === c.id ? "Adding…" : `Add to ${brandName}`}</Button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={deleteRemovesOnlyFromBrand(deleteTarget) ? `Remove "${deleteTarget.name}" from ${brandName}?` : `Delete "${deleteTarget.name}"?`}
          message={deleteRemovesOnlyFromBrand(deleteTarget)
            ? `The category stops being offered on ${brandName}. ${brandsOfCategory(deleteTarget).filter((b) => b !== brand).map(brandLabel).join(" and ")} keep it, and you can add it back later with “Add existing category”.`
            : "Only this brand offers it, so the category is removed permanently. It can only be deleted when no vehicle, fare rule, service, tour package or coupon uses it — otherwise deactivate it to hide it from new bookings."}
          confirmLabel={deleteRemovesOnlyFromBrand(deleteTarget) ? `Remove from ${brandName}` : "Delete Category"}
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

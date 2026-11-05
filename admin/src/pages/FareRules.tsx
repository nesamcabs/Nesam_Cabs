import { useState, useEffect, useMemo, useRef } from "react";
import { FareRule, PricingModel, TravelService, VehicleCategory, MasterLocation, FareCalculationInput } from "../types";
import { subscribeFareRules, subscribeServices, subscribeVehicleCategories, subscribeLocations } from "../services/adminFirestoreService";
import { calculateCentralFare } from "../services/fareEngine";
import {
  FareRuleActionError,
  deleteFareRule,
  duplicateFareRule,
  emptyFareRuleForm,
  formFromRule,
  saveFareRule,
  setFareRuleStatus,
  validateFareRule,
  type FareRuleField,
  type FareRuleForm,
} from "../services/fareRuleService";
import AppFarePreview from "../components/AppFarePreview";
import { auth } from "../services/firebase";
import { ConfirmDialog, ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Button } from "../components/ui";
import TimeSelect12 from "../components/TimeSelect12";

const PRICING_MODELS: { value: PricingModel; label: string; desc: string }[] = [
  { value: "BASE_PLUS_PER_KM", label: "Base Fare + Per KM", desc: "Initial base fare covering base KM, then per-KM rate for extra distance." },
  { value: "PER_KM", label: "Pure Per KM", desc: "Distance × Per-KM rate with minimum daily billable KM." },
  { value: "FIXED_ROUTE", label: "Fixed Route Fare", desc: "Fixed fare between specific Origin and Destination locations." },
  { value: "HOURLY_RENTAL", label: "Hourly / Rental Package", desc: "Included Hours & Included KM package with extra hour/KM charges." },
  { value: "PER_DAY", label: "Outstation Daily Minimum", desc: "Daily minimum distance rate × trip days + daily driver batta." },
];

const MODEL_BADGES: Record<PricingModel, { bg: string; text: string; border: string }> = {
  BASE_PLUS_PER_KM: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  PER_KM: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  FIXED_ROUTE: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  HOURLY_RENTAL: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  PER_DAY: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
};

type FormTab = "identity" | "pricing" | "allowances" | "overrides";
const TAB_FIELDS: Record<FormTab, FareRuleField[]> = {
  identity: ["name", "code", "vehicleCategoryId", "pricingType", "originLocationId", "destinationLocationId"],
  pricing: ["baseFare", "baseKm", "perKmRate", "minimumKmPerDay", "minimumFare", "includedHours", "extraKmRate", "extraHourRate"],
  allowances: ["driverBatta", "nightStartTime", "nightChargeValue", "freeWaitingMinutes", "waitingChargePerHour"],
  overrides: ["fixedTollAmount", "fixedParkingAmount", "permitCharge", "priority", "effectiveFrom", "effectiveUntil"],
};
const errText = (e: unknown) => (e instanceof FareRuleActionError ? e.message : "Something went wrong. Please try again.");

export default function FareRules({ onBack }: { onBack: () => void }) {
  const [fareRules, setFareRules] = useState<FareRule[]>([]);
  const [services, setServices] = useState<TravelService[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Filters & Controls
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [modelFilter, setModelFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  // Modal Form State
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<FareRule | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FareRuleField, string>>>({});
  const [activeTab, setActiveTab] = useState<FormTab>("identity");
  const [formData, setFormData] = useState<FareRuleForm>(emptyFareRuleForm);
  // The form as it was opened, so leaving the page can tell real edits from an untouched form.
  const formBaseline = useRef("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Rate-card calculator (admin / phone quotations)
  const [calcInput, setCalcInput] = useState<FareCalculationInput>({
    serviceId: "",
    vehicleCategoryId: "",
    distanceKm: 0,
    tripDays: 1,
    tripHours: 0,
    pickupTime: "",
    waitingMinutes: 0,
    tollAmount: 0,
    parkingAmount: 0,
    permitAmount: 0,
    discountAmount: 0,
  });

  // Delete / row actions
  const [deletingRule, setDeletingRule] = useState<FareRule | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const { toast, show: showToast } = useToast();

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const fail = (m: string) => {
      setLoadError(m);
      setLoading(false);
    };
    const unsubs = [
      subscribeFareRules((data) => {
        setFareRules(data);
        setLoading(false);
      }, fail),
      subscribeServices(setServices, fail),
      subscribeVehicleCategories(setCategories, fail),
      subscribeLocations(setLocations, fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  const calcCategoryId = calcInput.vehicleCategoryId || categories.find((c) => c.status === "Active")?.id || "";
  const calcResult = useMemo(() => {
    if (!calcCategoryId || !(Number(calcInput.distanceKm) > 0)) return null;
    const svc = services.find((s) => s.id === calcInput.serviceId);
    return calculateCentralFare({ ...calcInput, vehicleCategoryId: calcCategoryId, serviceName: svc?.name }, fareRules, categories);
  }, [calcInput, calcCategoryId, fareRules, categories, services]);

  const stats = useMemo(() => {
    const total = fareRules.length;
    const active = fareRules.filter((r) => r.status === "Active").length;
    const servicesCount = new Set(fareRules.map((r) => r.serviceName).filter(Boolean)).size;
    const categoriesCount = new Set(fareRules.map((r) => r.vehicleCategoryId).filter(Boolean)).size;
    return { total, active, servicesCount, categoriesCount };
  }, [fareRules]);

  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fareRules.filter((rule) => {
      const matchSearch = !q || [rule.name, rule.serviceName, rule.vehicleCategoryName, rule.code].some((v) => (v || "").toLowerCase().includes(q));
      const matchService = serviceFilter === "All" || rule.serviceName === serviceFilter || rule.serviceId === serviceFilter;
      const matchCategory = categoryFilter === "All" || rule.vehicleCategoryId === categoryFilter;
      const matchModel = modelFilter === "All" || rule.pricingType === modelFilter;
      const matchStatus = statusFilter === "All" || rule.status === statusFilter;
      return matchSearch && matchService && matchCategory && matchModel && matchStatus;
    });
  }, [fareRules, search, serviceFilter, categoryFilter, modelFilter, statusFilter]);

  const tabHasError = (tab: FormTab) => TAB_FIELDS[tab].some((f) => fieldErrors[f]);
  const errNode = (f: FareRuleField) => (fieldErrors[f] ? <p className="text-[10px] text-red-600 mt-1">{fieldErrors[f]}</p> : null);

  const openForm = (rule: FareRule | null) => {
    const initial = rule ? formFromRule(rule) : { ...emptyFareRuleForm(), vehicleCategoryId: categories.find((c) => c.status === "Active")?.id || "" };
    formBaseline.current = JSON.stringify(initial);
    setEditingRule(rule);
    setFormData(initial);
    setFormError(null);
    setFieldErrors({});
    setActiveTab("identity");
    setShowModal(true);
  };
  const handleOpenCreate = () => openForm(null);
  const handleOpenEdit = (rule: FareRule) => openForm(rule);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setFormError(null);
    const errors = validateFareRule(formData, fareRules, editingRule?.id ?? null);
    setFieldErrors(errors);
    const keys = Object.keys(errors) as FareRuleField[];
    if (keys.length) {
      setFormError(`Please fix: ${keys.map((k) => errors[k]).join(" ")}`);
      const tab = (Object.keys(TAB_FIELDS) as FormTab[]).find((t) => TAB_FIELDS[t].includes(keys[0]));
      if (tab) setActiveTab(tab);
      return;
    }
    setIsSubmitting(true);
    try {
      await saveFareRule(formData, editingRule, { services, categories, locations }, auth.currentUser?.uid || "");
      setShowModal(false);
      showToast(editingRule ? `Fare rule "${formData.name.trim()}" updated.` : `Fare rule "${formData.name.trim()}" created.`);
    } catch (err) {
      setFormError(errText(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const rowAction = async (rule: FareRule, work: () => Promise<string>) => {
    if (rowBusyId) return;
    setRowBusyId(rule.id);
    try {
      showToast(await work());
    } catch (err) {
      showToast(errText(err), "error");
    } finally {
      setRowBusyId(null);
    }
  };
  const handleToggleStatus = (rule: FareRule) =>
    rowAction(rule, async () => {
      const next = rule.status === "Active" ? "Inactive" : "Active";
      await setFareRuleStatus(rule, next, fareRules);
      return `Fare rule "${rule.name}" is now ${next}.`;
    });
  const handleDuplicate = (rule: FareRule) =>
    rowAction(rule, async () => `Duplicated as inactive draft "${await duplicateFareRule(rule, fareRules, auth.currentUser?.uid || "")}".`);
  const handlePromptDelete = (rule: FareRule) => {
    setDeleteError(null);
    setDeletingRule(rule);
  };
  const handleConfirmDelete = async () => {
    if (!deletingRule || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteFareRule(deletingRule);
      showToast(`Fare rule "${deletingRule.name}" deleted.`);
      setDeletingRule(null);
    } catch (err) {
      setDeleteError(errText(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  // A save, status change, copy or delete in flight must finish before the page is left.
  const busy = isSubmitting || deleteBusy || rowBusyId !== null;
  const handleBack = () => {
    if (busy) return;
    if (showModal && JSON.stringify(formData) !== formBaseline.current) setConfirmLeave(true);
    else onBack();
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      <div>
        <Button icon="arrow-left" onClick={handleBack} disabled={busy}>Back to Service &amp; Fare Settings</Button>
      </div>

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink tracking-tight">Legacy rate cards</h1>
          <p className="text-xs text-muted mt-0.5">
            Booking fares use the enabled tariff, local packages and vehicle category rates. The older rate cards below are reference records; managed fixed route fares must be changed through Service &amp; Fare Settings → Fixed route fares.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenCreate}
            className="px-4 py-2 text-xs font-semibold text-white rounded-xl hover:opacity-90 transition-all shadow-md flex items-center gap-2"
            style={{ background: "#c1232c" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Fare Rule
          </button>
        </div>
      </div>


      {/* Summary Cards */}
      {fareRules.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white p-4 rounded-2xl border border-line shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 text-brand flex items-center justify-center font-bold">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <div>
              <div className="text-[11px] font-medium text-muted">Total Fare Rules</div>
              <div className="text-lg font-bold text-ink">{stats.total}</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-line shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="text-[11px] font-medium text-muted">Active Rules</div>
              <div className="text-lg font-bold text-ink">{stats.active}</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-line shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01" />
              </svg>
            </div>
            <div>
              <div className="text-[11px] font-medium text-muted">Services Configured</div>
              <div className="text-lg font-bold text-ink">{stats.servicesCount}</div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-line shadow-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" />
              </svg>
            </div>
            <div>
              <div className="text-[11px] font-medium text-muted">Fleet Classes Covered</div>
              <div className="text-lg font-bold text-ink">{stats.categoriesCount}</div>
            </div>
          </div>
        </div>
      )}

      <AppFarePreview categories={categories} />

      {/* Rate-card quotation calculator (admin / phone bookings) */}
      <div className="bg-white rounded-2xl border border-line p-4 sm:p-5 space-y-4 shadow-xs">
        <div className="border-b border-line pb-3">
          <h2 className="text-sm font-bold text-ink">Rate Card Quotation Calculator</h2>
          <p className="text-[11px] text-muted">
            Quotes a trip from the active fare rules below (highest priority, currently effective). Use for admin / phone quotations — app bookings are priced from category fares above.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
          <div>
            <label className="block text-[10px] font-semibold text-muted mb-1">Service Type</label>
            <select
              value={calcInput.serviceId || ""}
              onChange={(e) => setCalcInput({ ...calcInput, serviceId: e.target.value })}
              className="w-full p-2 border border-line rounded-xl bg-white text-xs focus:border-brand focus:outline-none"
            >
              <option value="">Any service</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-muted mb-1">Vehicle Category</label>
            <select
              value={calcCategoryId}
              onChange={(e) => setCalcInput({ ...calcInput, vehicleCategoryId: e.target.value })}
              className="w-full p-2 border border-line rounded-xl bg-white text-xs focus:border-brand focus:outline-none"
            >
              {categories.length === 0 && <option value="">No categories</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-muted mb-1">Distance (KM)</label>
            <input
              type="number"
              value={calcInput.distanceKm}
              onChange={(e) => setCalcInput({ ...calcInput, distanceKm: parseFloat(e.target.value) || 0 })}
              className="w-full p-2 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-muted mb-1">Trip Days</label>
            <input
              type="number"
              value={calcInput.tripDays}
              onChange={(e) => setCalcInput({ ...calcInput, tripDays: parseInt(e.target.value) || 1 })}
              className="w-full p-2 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-muted mb-1">Pickup Time</label>
            <TimeSelect12 label="Pickup time" value={calcInput.pickupTime ?? ""} onChange={(v) => setCalcInput({ ...calcInput, pickupTime: v })} />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-muted mb-1">Waiting (Mins)</label>
            <input
              type="number"
              value={calcInput.waitingMinutes}
              onChange={(e) => setCalcInput({ ...calcInput, waitingMinutes: parseInt(e.target.value) || 0 })}
              className="w-full p-2 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
            />
          </div>
        </div>

        {/* Live Calculation Output Display */}
        {!calcResult && (
          <p className="text-[11px] text-muted bg-gray-50 border border-line rounded-xl p-3">
            {!calcCategoryId
              ? "Add a vehicle category to quote fares."
              : !(Number(calcInput.distanceKm) > 0)
                ? "Enter a distance to calculate a quotation."
                : "No active fare rule or category fare is configured for this service and category."}
          </p>
        )}
        {calcResult && (
          <div className="bg-gray-50 border border-line rounded-xl p-4 text-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-ink">Matched Rule:</span>
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-white border border-gray-200 text-brand">
                  {calcResult.matchedRule ? calcResult.matchedRule.name : "Vehicle category fare"}
                </span>
                {calcResult.fallbackUsed && (
                  <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                    No matching rule — category fare used
                  </span>
                )}
              </div>

              <div className="text-right">
                <span className="text-[11px] text-muted">Estimated Grand Total (incl. 5% GST): </span>
                <span className="text-base font-bold text-brand">₹{calcResult.grandTotal.toLocaleString()}</span>
              </div>
            </div>

            {/* Itemized Breakdown List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {calcResult.breakdown.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center bg-white px-3 py-1.5 rounded-lg border border-gray-200 text-[11px]">
                  <span className="text-gray-700">{item.label}</span>
                  <span className={`font-semibold ${item.amount < 0 ? "text-emerald-600" : "text-ink"}`}>
                    {item.amount < 0 ? `-₹${Math.abs(item.amount)}` : `₹${item.amount}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-line p-12 text-center shadow-xs">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs text-muted">Loading Master Fare Rules from Firestore…</p>
        </div>
      ) : loadError && fareRules.length === 0 ? null : fareRules.length === 0 ? (
        /* Empty State Placeholder (Matches Screenshot & Prompt Instructions) */
        <div className="bg-white rounded-2xl border border-line p-10 sm:p-16 text-center max-w-2xl mx-auto my-8 shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-red-50 text-brand flex items-center justify-center mx-auto mb-4 border border-red-100 shadow-inner">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-ink mb-2">No fare rules found.</h2>
          <p className="text-xs text-muted mb-6 leading-relaxed max-w-md mx-auto">
            Set base fare, per-km rates, driver batta, waiting charges, toll handling and night surcharges for each service and vehicle category.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={handleOpenCreate}
              className="w-full sm:w-auto px-6 py-2.5 text-xs font-semibold text-white rounded-xl hover:opacity-90 transition-all shadow-md"
              style={{ background: "#c1232c" }}
            >
              Add Fare Rule
            </button>
          </div>
        </div>
      ) : (
        /* Fare Rules Directory Table */
        <div className="bg-white rounded-2xl border border-line p-4 sm:p-5 space-y-4 shadow-xs">
          {/* Controls Bar */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <div className="relative flex-1">
              <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search rules by name, service, category, code..."
                className="w-full pl-9 pr-4 py-2 border border-line rounded-xl text-xs focus:outline-none focus:border-brand"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="px-3 py-2 border border-line rounded-xl text-xs bg-white text-ink focus:outline-none focus:border-brand"
              >
                <option value="All">All Services</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 border border-line rounded-xl text-xs bg-white text-ink focus:outline-none focus:border-brand"
              >
                <option value="All">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                className="px-3 py-2 border border-line rounded-xl text-xs bg-white text-ink focus:outline-none focus:border-brand"
              >
                <option value="All">All Pricing Types</option>
                {PRICING_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-line rounded-xl text-xs bg-white text-ink focus:outline-none focus:border-brand"
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto border border-line rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-line text-muted font-semibold">
                <tr>
                  <th className="py-3 px-3">Rule Name</th>
                  <th className="py-3 px-3">Pricing Type</th>
                  <th className="py-3 px-3">Service & Category</th>
                  <th className="py-3 px-3">Base Fare</th>
                  <th className="py-3 px-3">Per KM</th>
                  <th className="py-3 px-3">Driver Batta</th>
                  <th className="py-3 px-3">Night Charge</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredRules.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-muted">
                      No fare rules match the current filters.
                    </td>
                  </tr>
                )}
                {filteredRules.map((rule) => {
                  const badge = MODEL_BADGES[rule.pricingType] || MODEL_BADGES.BASE_PLUS_PER_KM;
                  return (
                    <tr key={rule.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3 px-3 font-semibold text-ink">
                        <div>{rule.name}</div>
                        {rule.code && <div className="text-[10px] font-mono text-gray-500">{rule.code}</div>}
                        <div className="text-[10px] font-normal text-gray-500">
                          Priority {rule.priority ?? 1}
                          {(rule.effectiveFrom || rule.effectiveUntil) && ` • ${rule.effectiveFrom || "…"} to ${rule.effectiveUntil || "…"}`}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${badge.bg} ${badge.text} ${badge.border}`}>
                          {PRICING_MODELS.find((m) => m.value === rule.pricingType)?.label || rule.pricingType}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-ink">
                        <div className="font-semibold">{rule.serviceName || "All Services"}</div>
                        <div className="text-[10px] text-gray-500">
                          {categories.find((c) => c.id === rule.vehicleCategoryId)?.name || rule.vehicleCategoryName || "Unknown category"}
                        </div>
                      </td>

                      <td className="py-3 px-3 font-semibold text-ink">
                        ₹{rule.baseFare}
                        {rule.baseKm > 0 && <span className="text-[10px] font-normal text-gray-500"> ({rule.baseKm}km)</span>}
                      </td>

                      <td className="py-3 px-3 font-semibold text-ink">
                        ₹{rule.perKmRate}/km
                      </td>

                      <td className="py-3 px-3 text-ink">
                        ₹{rule.driverBatta}/day
                      </td>

                      <td className="py-3 px-3">
                        {rule.nightChargeEnabled ? (
                          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 font-medium">
                            ✓ {rule.nightChargeValue}{rule.nightChargeType === "Percentage" ? "%" : "₹"}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-500">—</span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${
                            rule.status === "Active"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-gray-100 text-gray-600 border-gray-200"
                          }`}
                        >
                          {rule.status}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right space-x-2">
                        <button
                          onClick={() => handleToggleStatus(rule)}
                          disabled={rowBusyId !== null}
                          className={`text-[11px] font-semibold disabled:opacity-40 ${
                            rule.status === "Active" ? "text-amber-600 hover:underline" : "text-emerald-600 hover:underline"
                          }`}
                        >
                          {rule.status === "Active" ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => handleDuplicate(rule)}
                          disabled={rowBusyId !== null}
                          className="text-blue-600 hover:underline font-semibold text-[11px] disabled:opacity-40"
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => handleOpenEdit(rule)}
                          className="text-ink hover:underline font-semibold text-[11px]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handlePromptDelete(rule)}
                          className="text-red-600 hover:underline font-semibold text-[11px]"
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
        </div>
      )}

      {confirmLeave && (
        <Modal
          title="You have unsaved changes."
          onClose={() => setConfirmLeave(false)}
          busy={busy}
          centered
          footer={
            <>
              <Button onClick={() => setConfirmLeave(false)}>Stay</Button>
              <Button variant="danger" disabled={busy} onClick={() => { setConfirmLeave(false); onBack(); }}>Discard &amp; go back</Button>
            </>
          }
        >
          <p className="text-[13px] text-body">Your edits on this page have not been saved. Leaving now discards them.</p>
        </Modal>
      )}

      {/* Add / Edit Fare Rule Modal Form */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden border border-line max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-line flex items-center justify-between bg-gray-50/50">
              <div>
                <h3 className="text-base font-bold text-ink">
                  {editingRule ? "Edit Master Fare Rule" : "Add Master Fare Rule"}
                </h3>
                <p className="text-[11px] text-muted">
                  Configure master pricing parameters for central fare calculation.
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                disabled={isSubmitting}
                aria-label="Close"
                className="w-8 h-8 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Form Tabs */}
            <div className="flex border-b border-line bg-white px-5 pt-2 gap-4 text-xs font-semibold">
              <button
                onClick={() => setActiveTab("identity")}
                className={`pb-2.5 border-b-2 transition-all ${
                  activeTab === "identity" ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                1. Rule Identity & Scope{tabHasError("identity") && <span className="text-red-600"> •</span>}
              </button>
              <button
                onClick={() => setActiveTab("pricing")}
                className={`pb-2.5 border-b-2 transition-all ${
                  activeTab === "pricing" ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                2. Base & Distance Rules{tabHasError("pricing") && <span className="text-red-600"> •</span>}
              </button>
              <button
                onClick={() => setActiveTab("allowances")}
                className={`pb-2.5 border-b-2 transition-all ${
                  activeTab === "allowances" ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                3. Allowances & Surcharges{tabHasError("allowances") && <span className="text-red-600"> •</span>}
              </button>
              <button
                onClick={() => setActiveTab("overrides")}
                className={`pb-2.5 border-b-2 transition-all ${
                  activeTab === "overrides" ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                4. Tolls & Settings{tabHasError("overrides") && <span className="text-red-600"> •</span>}
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {formError}
                </div>
              )}

              {/* TAB 1: IDENTITY & SCOPE */}
              {activeTab === "identity" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Rule Name *
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g. Airport Taxi Sedan Standard Rate, Outstation Daily Innova"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                        maxLength={80}
                      />
                      {errNode("name")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Rule Code (optional)
                      </label>
                      <input
                        type="text"
                        value={formData.code}
                        onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                        placeholder="e.g. AIRPORT-SEDAN"
                        className="w-full p-2.5 border border-line rounded-xl text-xs font-mono focus:border-brand focus:outline-none"
                        maxLength={30}
                      />
                      {errNode("code")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Travel Service
                      </label>
                      <select
                        value={formData.serviceId}
                        onChange={(e) => setFormData({ ...formData, serviceId: e.target.value })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none"
                      >
                        <option value="">Any service</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                            {s.status && s.status !== "Active" ? ` (${s.status})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Vehicle Category *
                      </label>
                      <select
                        value={formData.vehicleCategoryId}
                        onChange={(e) => setFormData({ ...formData, vehicleCategoryId: e.target.value })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none"
                      >
                        <option value="">Choose a category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.seatingCapacity} seats){c.status !== "Active" ? ` — ${c.status}` : ""}
                          </option>
                        ))}
                      </select>
                      {errNode("vehicleCategoryId")}
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Pricing Model *
                      </label>
                      <select
                        value={formData.pricingType}
                        onChange={(e) => setFormData({ ...formData, pricingType: e.target.value as PricingModel })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none font-semibold"
                      >
                        {PRICING_MODELS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label} — {m.desc}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Fixed Route Location Selectors */}
                    {formData.pricingType === "FIXED_ROUTE" && (
                      <>
                        <div>
                          <label className="block text-[11px] font-semibold text-ink mb-1">
                            Origin Location *
                          </label>
                          <select
                            value={formData.originLocationId}
                            onChange={(e) => setFormData({ ...formData, originLocationId: e.target.value })}
                            className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none"
                          >
                            <option value="">Select Origin Location</option>
                            {locations.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name} ({l.city})
                              </option>
                            ))}
                          </select>
                        {errNode("originLocationId")}
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-ink mb-1">
                            Destination Location *
                          </label>
                          <select
                            value={formData.destinationLocationId}
                            onChange={(e) => setFormData({ ...formData, destinationLocationId: e.target.value })}
                            className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none"
                          >
                            <option value="">Select Destination Location</option>
                            {locations.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name} ({l.city})
                              </option>
                            ))}
                          </select>
                        {errNode("destinationLocationId")}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: BASE & DISTANCE RULES */}
              {activeTab === "pricing" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Base Fare (₹) *
                      </label>
                      <input
                        type="number"
                        value={formData.baseFare}
                        onChange={(e) => setFormData({ ...formData, baseFare: parseFloat(e.target.value) || 0 })}
                        placeholder="e.g. 350"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                        required
                      />
                    {errNode("baseFare")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Base Included Distance (KM)
                      </label>
                      <input
                        type="number"
                        value={formData.baseKm}
                        onChange={(e) => setFormData({ ...formData, baseKm: parseFloat(e.target.value) || 0 })}
                        placeholder="e.g. 10 (0 if no base km)"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                    {errNode("baseKm")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Per-KM Rate (₹/km) *
                      </label>
                      <input
                        type="number"
                        value={formData.perKmRate}
                        onChange={(e) => setFormData({ ...formData, perKmRate: parseFloat(e.target.value) || 0 })}
                        placeholder="e.g. 13"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                        required
                      />
                    {errNode("perKmRate")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Min Outstation Billable KM / Day
                      </label>
                      <input
                        type="number"
                        value={formData.minimumKmPerDay}
                        onChange={(e) => setFormData({ ...formData, minimumKmPerDay: parseFloat(e.target.value) || 0 })}
                        placeholder="e.g. 250"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                    {errNode("minimumKmPerDay")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Minimum Fare (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={formData.minimumFare}
                        onChange={(e) => setFormData({ ...formData, minimumFare: parseFloat(e.target.value) || 0 })}
                        placeholder="0 if none"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                      {errNode("minimumFare")}
                    </div>

                    {/* Hourly Package fields */}
                    {formData.pricingType === "HOURLY_RENTAL" && (
                      <>
                        <div>
                          <label className="block text-[11px] font-semibold text-ink mb-1">
                            Included Hours
                          </label>
                          <input
                            type="number"
                            value={formData.includedHours}
                            onChange={(e) => setFormData({ ...formData, includedHours: parseInt(e.target.value) || 0 })}
                            className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                          />
                        {errNode("includedHours")}
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-ink mb-1">
                            Extra KM Rate (₹/km)
                          </label>
                          <input
                            type="number"
                            value={formData.extraKmRate}
                            onChange={(e) => setFormData({ ...formData, extraKmRate: parseFloat(e.target.value) || 0 })}
                            className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                          />
                        {errNode("extraKmRate")}
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-ink mb-1">
                            Extra Hour Rate (₹/hr)
                          </label>
                          <input
                            type="number"
                            value={formData.extraHourRate}
                            onChange={(e) => setFormData({ ...formData, extraHourRate: parseFloat(e.target.value) || 0 })}
                            className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                          />
                        {errNode("extraHourRate")}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: ALLOWANCES & SURCHARGES */}
              {activeTab === "allowances" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Driver Batta / Allowance (₹ per day) *
                      </label>
                      <input
                        type="number"
                        value={formData.driverBatta}
                        onChange={(e) => setFormData({ ...formData, driverBatta: parseFloat(e.target.value) || 0 })}
                        placeholder="e.g. 250"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                    {errNode("driverBatta")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Waiting Charge Rate (₹ per hour)
                      </label>
                      <input
                        type="number"
                        value={formData.waitingChargePerHour}
                        onChange={(e) => setFormData({ ...formData, waitingChargePerHour: parseFloat(e.target.value) || 0 })}
                        placeholder="e.g. 80"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                    {errNode("waitingChargePerHour")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Free Waiting (minutes)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={formData.freeWaitingMinutes}
                        onChange={(e) => setFormData({ ...formData, freeWaitingMinutes: parseInt(e.target.value) || 0 })}
                        placeholder="0 if none"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                      {errNode("freeWaitingMinutes")}
                    </div>

                    {/* Night Surcharge Box */}
                    <div className="sm:col-span-2 p-3 bg-gray-50 border border-line rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer font-bold text-ink">
                          <input
                            type="checkbox"
                            checked={formData.nightChargeEnabled}
                            onChange={(e) => setFormData({ ...formData, nightChargeEnabled: e.target.checked })}
                            className="accent-brand"
                          />
                          Night Surcharge Enabled
                        </label>
                        <span className="text-[10px] text-muted">Evaluated across midnight windows</span>
                      </div>

                      {formData.nightChargeEnabled && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                          <div>
                            <label className="block text-[10px] font-semibold text-muted">Night Window Start</label>
                            <TimeSelect12 label="Night window start" value={formData.nightStartTime} onChange={(v) => setFormData({ ...formData, nightStartTime: v })} />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-muted">Night Window End</label>
                            <TimeSelect12 label="Night window end" value={formData.nightEndTime} onChange={(v) => setFormData({ ...formData, nightEndTime: v })} />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-muted">Charge Type</label>
                            <select
                              value={formData.nightChargeType}
                              onChange={(e) => setFormData({ ...formData, nightChargeType: e.target.value as FareRuleForm["nightChargeType"] })}
                              className="w-full p-2 border rounded-lg bg-white text-xs"
                            >
                              <option value="Percentage">Percentage (%)</option>
                              <option value="Fixed">Fixed Amount (₹)</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-muted">
                              {formData.nightChargeType === "Percentage" ? "Value (%)" : "Amount (₹)"}
                            </label>
                            <input
                              type="number"
                              value={formData.nightChargeValue}
                              onChange={(e) => setFormData({ ...formData, nightChargeValue: parseFloat(e.target.value) || 0 })}
                              className="w-full p-2 border rounded-lg bg-white text-xs font-bold text-brand"
                            />
                          {errNode("nightChargeValue")}
                          </div>
                          <div className="col-span-2 sm:col-span-4">
                            {errNode("nightStartTime")}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: TOLLS, PARKING & SETTINGS */}
              {activeTab === "overrides" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Toll Charges Mode
                      </label>
                      <select
                        value={formData.tollMode}
                        onChange={(e) => setFormData({ ...formData, tollMode: e.target.value as FareRuleForm["tollMode"] })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none"
                      >
                        <option value="Excluded">Excluded (Actuals at Toll Gates)</option>
                        <option value="Included">Included in Fare</option>
                        <option value="Fixed">Fixed Amount</option>
                      </select>
                    </div>

                    {formData.tollMode === "Fixed" && (
                      <div>
                        <label className="block text-[11px] font-semibold text-ink mb-1">
                          Fixed Toll Amount (₹)
                        </label>
                        <input
                          type="number"
                          value={formData.fixedTollAmount}
                          onChange={(e) => setFormData({ ...formData, fixedTollAmount: parseFloat(e.target.value) || 0 })}
                          className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                        />
                      {errNode("fixedTollAmount")}
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Interstate Permit Charge (₹)
                      </label>
                      <input
                        type="number"
                        value={formData.permitCharge}
                        onChange={(e) => setFormData({ ...formData, permitCharge: parseFloat(e.target.value) || 0 })}
                        placeholder="0 if none"
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                    {errNode("permitCharge")}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Parking Charges Mode
                      </label>
                      <select
                        value={formData.parkingMode}
                        onChange={(e) => setFormData({ ...formData, parkingMode: e.target.value as FareRuleForm["parkingMode"] })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none"
                      >
                        <option value="Excluded">Excluded (Actuals)</option>
                        <option value="Included">Included in Fare</option>
                        <option value="Fixed">Fixed Amount</option>
                      </select>
                    </div>

                    {formData.parkingMode === "Fixed" && (
                      <div>
                        <label className="block text-[11px] font-semibold text-ink mb-1">
                          Fixed Parking Amount (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={formData.fixedParkingAmount}
                          onChange={(e) => setFormData({ ...formData, fixedParkingAmount: parseFloat(e.target.value) || 0 })}
                          className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                        />
                        {errNode("fixedParkingAmount")}
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Priority (1 = highest)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={formData.priority}
                        onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                      />
                      {errNode("priority")}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-ink mb-1">Effective From</label>
                        <input
                          type="date"
                          value={formData.effectiveFrom}
                          onChange={(e) => setFormData({ ...formData, effectiveFrom: e.target.value })}
                          className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                        />
                        {errNode("effectiveFrom")}
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-ink mb-1">Effective Until</label>
                        <input
                          type="date"
                          value={formData.effectiveUntil}
                          onChange={(e) => setFormData({ ...formData, effectiveUntil: e.target.value })}
                          className="w-full p-2.5 border border-line rounded-xl text-xs focus:border-brand focus:outline-none"
                        />
                        {errNode("effectiveUntil")}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-ink mb-1">
                        Status
                      </label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value as FareRuleForm["status"] })}
                        className="w-full p-2.5 border border-line rounded-xl text-xs bg-white focus:border-brand focus:outline-none font-semibold"
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="pt-4 border-t border-line flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {activeTab !== "identity" && (
                    <button
                      type="button"
                      onClick={() =>
                        setActiveTab(
                          activeTab === "overrides" ? "allowances" : activeTab === "allowances" ? "pricing" : "identity"
                        )
                      }
                      className="px-3 py-2 border border-line text-ink rounded-xl font-semibold text-xs"
                    >
                      ← Back
                    </button>
                  )}
                  {activeTab !== "overrides" && (
                    <button
                      type="button"
                      onClick={() =>
                        setActiveTab(
                          activeTab === "identity" ? "pricing" : activeTab === "pricing" ? "allowances" : "overrides"
                        )
                      }
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
                    disabled={isSubmitting}
                    className="px-4 py-2 border border-line text-muted rounded-xl font-semibold text-xs hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 text-white font-semibold rounded-xl text-xs hover:opacity-90 transition-all shadow-md flex items-center gap-1.5 disabled:opacity-60"
                    style={{ background: "#c1232c" }}
                  >
                    {isSubmitting && (
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    )}
                    {editingRule ? "Save Changes" : "Create Fare Rule"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletingRule && (
        <ConfirmDialog
          title="Delete Fare Rule"
          message={`Delete "${deletingRule.name}"? Existing bookings keep their own stored price; only future quotations are affected. To keep it for later, deactivate it instead.`}
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingRule(null)}
        />
      )}
    </div>
  );
}

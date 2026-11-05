import { useEffect, useMemo, useRef, useState } from "react";
import type { Booking, Driver, Vehicle, VehicleCategory, Vendor } from "../types";
import {
  subscribeBookings,
  subscribeDrivers,
  subscribeVehicleCategories,
  subscribeVehicles,
  subscribeVendors,
} from "../services/adminFirestoreService";
import {
  FUEL_TYPES,
  VEHICLE_STATUSES,
  VehicleActionError,
  activeTripFor,
  approvalBlockers,
  availabilityOf,
  deleteVehicle,
  eligibleDrivers,
  mapVehicle,
  newVehicleId,
  regKey,
  reviewVehicleDocuments,
  saveVehicle,
  uploadVehicleDocument,
  validateVehicleInput,
  vehicleDocuments,
  type Availability,
  type ComplianceState,
  type FleetVehicle,
  type VehicleDocKind,
  type VehicleFieldErrors,
  type VehicleInput,
} from "../services/vehicleService";
import { normalizeVendorStatus } from "../utils/vendorStatus";
import { ConfirmDialog, ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";

const availabilityStyle: Record<Availability, string> = {
  Available: "bg-green-50 text-green-700 border-green-200",
  "On Trip": "bg-orange-50 text-orange-700 border-orange-200",
  "Awaiting Approval": "bg-blue-50 text-blue-700 border-blue-200",
  "Documents Rejected": "bg-red-50 text-red-700 border-red-200",
  Maintenance: "bg-yellow-50 text-yellow-700 border-yellow-200",
  Inactive: "bg-gray-100 text-gray-600 border-gray-200",
};

const complianceStyle: Record<ComplianceState, string> = {
  Valid: "bg-green-50 text-green-700 border-green-200",
  Expiring: "bg-amber-50 text-amber-700 border-amber-200",
  Expired: "bg-red-50 text-red-700 border-red-200",
  Missing: "bg-gray-100 text-gray-500 border-gray-200",
};

const AVAILABILITY_FILTERS: ("All" | Availability)[] = [
  "All",
  "Available",
  "On Trip",
  "Awaiting Approval",
  "Documents Rejected",
  "Maintenance",
  "Inactive",
];

const vendorDisplayName = (v: Vendor & { business?: { businessName?: string } }) =>
  v.companyName || v.business?.businessName || v.name || v.id;

const errorText = (e: unknown) =>
  e instanceof VehicleActionError ? e.message : "Something went wrong. Please try again.";

const blankInput = (): VehicleInput => ({
  vehicleNumber: "",
  vendorId: "",
  vendorName: "",
  categoryId: "",
  category: "",
  make: "",
  model: "",
  year: "",
  seatingCapacity: 0,
  fuelType: "Diesel",
  status: "Active",
  assignedDriverId: "",
  rcNumber: "",
  rcDocUrl: "",
  insuranceExpiry: "",
  insuranceDocUrl: "",
  fitnessExpiry: "",
  fitnessDocUrl: "",
  permitExpiry: "",
  statePermitDocUrl: "",
});

const inputFrom = (v: FleetVehicle, categories: VehicleCategory[]): VehicleInput => {
  // Older vehicles store only the category name; link it to the master record.
  const cat =
    categories.find((c) => c.id === v.categoryId) ||
    categories.find(
      (c) =>
        c.name.trim().toLowerCase() === v.category.toLowerCase() ||
        (c.code || "").toLowerCase() === v.category.toLowerCase(),
    );
  return {
    vehicleNumber: v.vehicleNumber,
    vendorId: v.vendorId,
    vendorName: v.vendorName,
    categoryId: cat?.id || v.categoryId,
    category: cat?.name || v.category,
    make: v.make,
    model: v.model,
    year: v.year,
    seatingCapacity: v.seatingCapacity,
    fuelType: (FUEL_TYPES as readonly string[]).includes(v.fuelType) ? v.fuelType : "",
    status: v.status,
    assignedDriverId: v.assignedDriverId,
    rcNumber: v.rcNumber,
    rcDocUrl: v.rcDocUrl,
    insuranceExpiry: v.insuranceExpiry,
    insuranceDocUrl: v.insuranceDocUrl,
    fitnessExpiry: v.fitnessExpiry,
    fitnessDocUrl: v.fitnessDocUrl,
    permitExpiry: v.permitExpiry,
    statePermitDocUrl: v.statePermitDocUrl,
  };
};

export default function VehicleDesk() {
  const [rawVehicles, setRawVehicles] = useState<Vehicle[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const [search, setSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<"All" | Availability>("All");
  const [ownerFilter, setOwnerFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const [form, setForm] = useState<{ id: string; existing: FleetVehicle | null } | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FleetVehicle | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { toast, show } = useToast();

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const fail = (message: string) => {
      setLoadError(message);
      setLoading(false);
    };
    const unsubs = [
      subscribeVehicles((data) => {
        setRawVehicles(data);
        setLoading(false);
      }, fail),
      subscribeVehicleCategories(setCategories, fail),
      subscribeDrivers(setDrivers, fail),
      subscribeVendors(setVendors, fail),
      subscribeBookings(setBookings, fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  const vehicles = useMemo(
    () =>
      rawVehicles
        .map(mapVehicle)
        .sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber)),
    [rawVehicles],
  );

  const vendorNames = useMemo(() => new Map(vendors.map((v) => [v.id, vendorDisplayName(v)])), [vendors]);
  const driverNames = useMemo(() => new Map(drivers.map((d) => [d.id, d.name || ""])), [drivers]);
  const vendorName = (id: string, fallback: string) => vendorNames.get(id) || fallback || "Vendor";
  const driverName = (v: FleetVehicle) => v.assignedDriverName || driverNames.get(v.assignedDriverId) || "";

  const rows = useMemo(
    () =>
      vehicles.map((v) => ({
        vehicle: v,
        availability: availabilityOf(v, bookings),
        docs: vehicleDocuments(v),
      })),
    [vehicles, bookings],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qKey = regKey(search);
    const owner = (v: FleetVehicle) => (v.vendorId ? vendorNames.get(v.vendorId) || v.vendorName : "NESAM");
    const driver = (v: FleetVehicle) => v.assignedDriverName || driverNames.get(v.assignedDriverId) || "";
    return rows.filter(({ vehicle: v, availability }) => {
      if (availabilityFilter !== "All" && availability !== availabilityFilter) return false;
      if (ownerFilter === "NESAM" && v.vendorId) return false;
      if (ownerFilter !== "All" && ownerFilter !== "NESAM" && v.vendorId !== ownerFilter) return false;
      if (categoryFilter !== "All" && v.categoryId !== categoryFilter && v.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        (qKey && regKey(v.vehicleNumber).includes(qKey)) ||
        `${v.make} ${v.model}`.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q) ||
        v.rcNumber.toLowerCase().includes(q) ||
        driver(v).toLowerCase().includes(q) ||
        owner(v).toLowerCase().includes(q)
      );
    });
  }, [rows, search, availabilityFilter, ownerFilter, categoryFilter, vendorNames, driverNames]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.availability] = (c[r.availability] || 0) + 1;
    return c;
  }, [rows]);

  const ownersInUse = useMemo(() => {
    const ids = new Set(vehicles.map((v) => v.vendorId).filter(Boolean));
    return [...ids]
      .map((id) => ({
        id,
        name: vendorNames.get(id) || vehicles.find((v) => v.vendorId === id)?.vendorName || "Vendor",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [vehicles, vendorNames]);

  const viewing = viewingId ? vehicles.find((v) => v.id === viewingId) ?? null : null;

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteVehicle(deleteTarget, bookings);
      show(`Vehicle ${deleteTarget.vehicleNumber} removed.`);
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(errorText(e));
    } finally {
      setDeleting(false);
    }
  };

  const hasFilters = search.trim() !== "" || availabilityFilter !== "All" || ownerFilter !== "All" || categoryFilter !== "All";

  return (
    <div className="p-6 space-y-5">
      <Toast toast={toast} />

      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Registered Vehicles", value: vehicles.length, color: "#c1232c" },
          { label: "Available for Trips", value: counts["Available"] || 0, color: "#10B981" },
          { label: "Active On Trip", value: counts["On Trip"] || 0, color: "#F59E0B" },
          { label: "Awaiting Document Review", value: counts["Awaiting Approval"] || 0, color: "#3B82F6" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
            <div className="text-[22px] font-bold" style={{ color: s.color }}>
              {loading ? "—" : s.value}
            </div>
            <div className="text-[11px] text-faint mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
        <div className="p-4 border-b border-line flex flex-col md:flex-row md:items-center justify-between gap-3 bg-surface-2">
          <div>
            <h2 className="text-[14px] font-bold text-ink">Fleet Vehicle Directory & Compliance Verification</h2>
            <p className="text-[11px] text-faint">
              Vendor and NESAM-owned vehicles, driver pairing, and RC / insurance / permit review.
            </p>
          </div>
          <button
            onClick={() => setForm({ id: newVehicleId(), existing: null })}
            className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-white rounded-lg shadow-sm hover:opacity-90 cursor-pointer transition-all self-start md:self-auto"
            style={{ background: "#c1232c" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Register Vehicle
          </button>
        </div>

        {/* Search & Filters */}
        <div className="px-4 py-3 border-b border-line space-y-3 bg-white">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="search"
                placeholder="Search number, model, driver, owner, RC…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-[12px] border border-line rounded-lg focus:outline-none focus:border-brand"
              />
            </div>
            <select
              aria-label="Owner"
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white"
            >
              <option value="All">All owners</option>
              <option value="NESAM">NESAM-owned</option>
              {ownersInUse.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <select
              aria-label="Category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white"
            >
              <option value="All">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {hasFilters && (
              <button
                onClick={() => {
                  setSearch("");
                  setAvailabilityFilter("All");
                  setOwnerFilter("All");
                  setCategoryFilter("All");
                }}
                className="text-[11px] font-semibold text-brand hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 overflow-x-auto">
            {AVAILABILITY_FILTERS.map((st) => (
              <button
                key={st}
                onClick={() => setAvailabilityFilter(st)}
                className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  availabilityFilter === st ? "bg-ink text-white" : "bg-hover text-muted hover:bg-line"
                }`}
              >
                {st}
                {st !== "All" && counts[st] ? ` (${counts[st]})` : ""}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="py-14 text-center text-[13px] text-faint">Loading vehicles…</div>
          ) : (
            <>
              <table className="w-full min-w-[1050px]">
                <thead>
                  <tr className="bg-surface-2 border-b border-line">
                    {["Vehicle", "Number", "Category", "Seats", "Owner", "Compliance Documents", "Assigned Driver", "Status", "Actions"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ vehicle: v, availability, docs }) => (
                    <tr key={v.id} className="table-row border-b border-hover hover:bg-gray-50/60 last:border-0 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-[12px] font-bold text-ink">
                          {`${v.make} ${v.model}`.trim() || "—"}
                        </div>
                        <div className="text-[10px] text-faint">
                          {[v.fuelType, v.year].filter(Boolean).join(" • ") || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[12px] font-mono font-bold text-ink whitespace-nowrap">
                        {v.vehicleNumber || "—"}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-body font-medium">{v.category || "—"}</td>
                      <td className="px-4 py-3 text-[12px] font-semibold text-ink text-center">
                        {v.seatingCapacity || "—"}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-body">
                        {v.vendorId ? vendorName(v.vendorId, v.vendorName) : <span className="font-semibold">NESAM</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {docs.map((d) => (
                            <span
                              key={d.key}
                              title={`${d.label}: ${d.state}${d.expiry ? ` (till ${d.expiry})` : ""}`}
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${complianceStyle[d.state]}`}
                            >
                              {d.short}: {d.state}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        {driverName(v) ? (
                          <span className="font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded text-[11px] border border-emerald-200">
                            {driverName(v)}
                          </span>
                        ) : (
                          <span className="text-faint italic">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${availabilityStyle[availability]}`}>
                          {availability}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setViewingId(v.id)}
                            className="text-[11px] px-2.5 py-1 rounded-md border border-line hover:bg-brand-soft text-brand font-semibold transition-colors cursor-pointer"
                          >
                            {v.docStatus === "Pending" ? "Review" : "View"}
                          </button>
                          <button
                            onClick={() => setForm({ id: v.id, existing: v })}
                            className="text-[11px] px-2 py-1 rounded-md border border-line hover:bg-gray-100 text-body font-medium transition-colors cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(v);
                            }}
                            aria-label={`Remove ${v.vehicleNumber}`}
                            className="text-[11px] px-1.5 py-1 rounded-md text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filtered.length === 0 && (
                <div className="py-14 text-center">
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2 text-gray-400">🚗</div>
                  <p className="text-[13px] font-semibold text-gray-800">No vehicles found.</p>
                  <p className="text-[11px] text-gray-500 mb-4">
                    {hasFilters ? "Try adjusting your search or filters." : "Register the first vehicle to get started."}
                  </p>
                  {!hasFilters && (
                    <button
                      onClick={() => setForm({ id: newVehicleId(), existing: null })}
                      className="px-4 py-2 bg-brand text-white text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
                    >
                      Register Vehicle
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {viewing && (
        <VehicleDetailModal
          vehicle={viewing}
          ownerName={viewing.vendorId ? vendorName(viewing.vendorId, viewing.vendorName) : "NESAM"}
          driverName={driverName(viewing)}
          activeTrip={activeTripFor(viewing, bookings)}
          availability={availabilityOf(viewing, bookings)}
          onClose={() => setViewingId(null)}
          onEdit={() => {
            setViewingId(null);
            setForm({ id: viewing.id, existing: viewing });
          }}
          onDone={(msg) => show(msg)}
        />
      )}

      {form && (
        <VehicleFormModal
          vehicleId={form.id}
          existing={form.existing}
          vehicles={vehicles}
          categories={categories}
          drivers={drivers}
          vendors={vendors}
          bookings={bookings}
          onClose={() => setForm(null)}
          onSaved={(msg) => {
            setForm(null);
            show(msg);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Remove ${deleteTarget.vehicleNumber}?`}
          message="The vehicle will be deleted from the fleet. Past bookings keep their recorded vehicle number. To take a vehicle off the road temporarily, set its status to Maintenance or Inactive instead."
          confirmLabel="Remove Vehicle"
          danger
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ── Detail / document review ────────────────────────────────────────────────

function VehicleDetailModal({
  vehicle: v,
  ownerName,
  driverName,
  activeTrip,
  availability,
  onClose,
  onEdit,
  onDone,
}: {
  vehicle: FleetVehicle;
  ownerName: string;
  driverName: string;
  activeTrip: Booking | null;
  availability: Availability;
  onClose: () => void;
  onEdit: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(v.rejectionReason);
  const docs = vehicleDocuments(v);
  const blockers = approvalBlockers(v);

  const decide = async (decision: "Approved" | "Rejected") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await reviewVehicleDocuments(v, decision, reason);
      onDone(decision === "Approved" ? `${v.vehicleNumber} approved for trips.` : `${v.vehicleNumber} sent back to the owner with your reason.`);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const Info = ({ label, value }: { label: string; value: string }) => (
    <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className="text-[12px] font-semibold text-gray-900 break-words">{value || "—"}</div>
    </div>
  );

  return (
    <Modal
      title={`Vehicle ${v.vehicleNumber}`}
      subtitle={`${`${v.make} ${v.model}`.trim()} • ${ownerName}`}
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={
        <>
          <button onClick={onEdit} disabled={busy} className="px-4 py-2 border border-line rounded-lg text-[12px] font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 mr-auto">
            Edit Vehicle
          </button>
          {rejecting ? (
            <>
              <button onClick={() => setRejecting(false)} disabled={busy} className="px-4 py-2 border border-line rounded-lg text-[12px] font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                Back
              </button>
              <button onClick={() => decide("Rejected")} disabled={busy} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-[12px] font-bold rounded-lg disabled:opacity-50">
                {busy ? "Saving…" : "Send Back to Owner"}
              </button>
            </>
          ) : (
            <>
              {v.docStatus !== "Rejected" && (
                <button onClick={() => setRejecting(true)} disabled={busy} className="px-4 py-2 border border-red-200 text-red-700 rounded-lg text-[12px] font-semibold hover:bg-red-50 disabled:opacity-50">
                  Reject Documents
                </button>
              )}
              {v.docStatus !== "Approved" && (
                <button
                  onClick={() => decide("Approved")}
                  disabled={busy || blockers.length > 0}
                  title={blockers.length ? blockers.join("\n") : undefined}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold rounded-lg disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Approve for Trips"}
                </button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="space-y-4 text-xs">
        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl font-semibold">{error}</div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border ${availabilityStyle[availability]}`}>{availability}</span>
          <span className="text-[11px] text-gray-500">
            Documents: <strong className="text-gray-800">{v.docStatus}</strong>
          </span>
          {activeTrip && (
            <span className="text-[11px] text-orange-700">
              On trip {activeTrip.bookingId || activeTrip.id} ({activeTrip.pickup} → {activeTrip.drop})
            </span>
          )}
        </div>
        {v.docStatus === "Rejected" && v.rejectionReason && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800">
            <strong>Rejection reason:</strong> {v.rejectionReason}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Info label="Category" value={v.category} />
          <Info label="Seats" value={v.seatingCapacity ? String(v.seatingCapacity) : ""} />
          <Info label="Fuel / Year" value={[v.fuelType, v.year].filter(Boolean).join(" • ")} />
          <Info label="Owner" value={ownerName} />
          <Info label="Assigned driver" value={driverName || "Unassigned"} />
          <Info label="Operational status" value={v.status} />
        </div>

        <div>
          <h4 className="text-[12px] font-bold text-gray-900 mb-2">Compliance documents</h4>
          <div className="space-y-2">
            {docs.map((d) => (
              <div key={d.key} className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-bold text-gray-900 block">
                    {d.label}
                    {!d.required && <span className="font-normal text-gray-500"> (if applicable)</span>}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {d.number ? `No. ${d.number}` : d.expiry ? `Valid till ${d.expiry}` : d.key === "rc" ? "RC number not recorded" : "No expiry date recorded"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-brand hover:underline">
                      Open file
                    </a>
                  ) : (
                    <span className="text-[11px] text-gray-400">No file</span>
                  )}
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${complianceStyle[d.state]}`}>{d.state}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {v.docStatus !== "Approved" && blockers.length > 0 && !rejecting && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
            <strong>Cannot approve yet:</strong>
            <ul className="list-disc pl-5 mt-1">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        {rejecting && (
          <div>
            <label htmlFor="reject-reason" className="block text-[11px] font-bold text-gray-800 mb-1">
              Reason for the owner *
            </label>
            <textarea
              id="reject-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Insurance copy is unreadable — please upload a clear PDF."
              className="w-full p-2.5 border border-line rounded-lg text-[12px] focus:outline-none focus:border-brand"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Add / edit ──────────────────────────────────────────────────────────────

function VehicleFormModal({
  vehicleId,
  existing,
  vehicles,
  categories,
  drivers,
  vendors,
  bookings,
  onClose,
  onSaved,
}: {
  vehicleId: string;
  existing: FleetVehicle | null;
  vehicles: FleetVehicle[];
  categories: VehicleCategory[];
  drivers: Driver[];
  vendors: Vendor[];
  bookings: Booking[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [input, setInput] = useState<VehicleInput>(() => (existing ? inputFrom(existing, categories) : blankInput()));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const set = <K extends keyof VehicleInput>(key: K, value: VehicleInput[K]) =>
    setInput((prev) => ({ ...prev, [key]: value }));

  const errors: VehicleFieldErrors = useMemo(
    () => validateVehicleInput(input, { vehicles, editingId: existing?.id ?? null }),
    [input, vehicles, existing],
  );
  const err = (k: keyof VehicleInput) => (submitted ? errors[k] : undefined);

  const approvedVendors = vendors.filter((v) => normalizeVendorStatus(v) === "APPROVED" || v.id === existing?.vendorId);
  const categoryOptions = categories
    .filter((c) => c.status === "Active" || c.id === input.categoryId)
    .sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99));
  const driverOptions = eligibleDrivers(input.vendorId, drivers);
  const currentDriver = drivers.find((d) => d.id === input.assignedDriverId);
  const trip = existing ? activeTripFor(existing, bookings) : null;

  const onOwnerChange = (vendorId: string) => {
    const vendor = vendors.find((v) => v.id === vendorId);
    setInput((prev) => ({
      ...prev,
      vendorId,
      vendorName: vendor ? vendorDisplayName(vendor) : "",
      // A driver belongs to one owner; changing the owner drops the pairing.
      assignedDriverId: vendorId === prev.vendorId ? prev.assignedDriverId : "",
    }));
  };

  const onCategoryChange = (categoryId: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    setInput((prev) => ({
      ...prev,
      categoryId,
      category: cat?.name || "",
      seatingCapacity: prev.seatingCapacity || cat?.seatingCapacity || 0,
    }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.keys(errors).length) {
      setError("Please fix the highlighted fields.");
      return;
    }
    if (uploads > 0) {
      setError("Please wait for the document uploads to finish.");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveVehicle({ id: vehicleId, input, existing, vehicles, drivers, bookings });
      onSaved(existing ? `Vehicle ${input.vehicleNumber.toUpperCase()} updated.` : `Vehicle ${input.vehicleNumber.toUpperCase()} registered. Review its documents to approve it for trips.`);
    } catch (ex) {
      setError(errorText(ex));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const field = "w-full p-2.5 border rounded-lg text-[12px] focus:outline-none focus:border-brand";
  const cls = (k: keyof VehicleInput) => `${field} ${err(k) ? "border-red-400" : "border-line"}`;
  const FieldError = ({ k }: { k: keyof VehicleInput }) =>
    err(k) ? <p className="text-[10px] text-red-600 mt-1">{err(k)}</p> : null;
  const busy = saving;

  return (
    <Modal
      title={existing ? `Edit Vehicle: ${existing.vehicleNumber}` : "Register New Fleet Vehicle"}
      subtitle="Vehicles need approved RC, insurance and permit documents before they can take trips."
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 border border-line rounded-lg text-[12px] font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="submit"
            form="vehicle-form"
            disabled={busy || uploads > 0}
            className="px-6 py-2 text-[12px] font-bold text-white rounded-lg shadow-sm hover:opacity-90 disabled:opacity-50"
            style={{ background: "#c1232c" }}
          >
            {saving ? "Saving…" : existing ? "Save Changes" : "Register Vehicle"}
          </button>
        </>
      }
    >
      <form id="vehicle-form" onSubmit={save} noValidate className="space-y-4 text-xs">
        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl font-semibold">{error}</div>
        )}
        {trip && (
          <div className="p-3 bg-orange-50 border border-orange-200 text-orange-800 rounded-xl">
            On trip {trip.bookingId || trip.id}: the number, driver and status are locked until the trip ends.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-number">Registration Number *</label>
            <input
              id="v-number"
              value={input.vehicleNumber}
              onChange={(e) => set("vehicleNumber", e.target.value.toUpperCase())}
              disabled={!!trip}
              placeholder="TN 01 AB 1234"
              className={`${cls("vehicleNumber")} font-mono uppercase disabled:bg-gray-50`}
            />
            <FieldError k="vehicleNumber" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-owner">Owner</label>
            <select id="v-owner" value={input.vendorId} onChange={(e) => onOwnerChange(e.target.value)} disabled={!!trip} className={`${cls("vendorId")} bg-white disabled:bg-gray-50`}>
              <option value="">NESAM (company-owned)</option>
              {approvedVendors.map((v) => (
                <option key={v.id} value={v.id}>{vendorDisplayName(v)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-category">Category *</label>
            <select id="v-category" value={input.categoryId} onChange={(e) => onCategoryChange(e.target.value)} className={`${cls("categoryId")} bg-white`}>
              <option value="">{input.category && !input.categoryId ? `${input.category} (not in master list)` : "Choose category"}</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.seatingCapacity} seats){c.status !== "Active" ? " — inactive" : ""}
                </option>
              ))}
            </select>
            {categories.length === 0 && <p className="text-[10px] text-amber-700 mt-1">Add vehicle categories first (Fleet → Vehicle Categories).</p>}
            <FieldError k="categoryId" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-status">Operational Status</label>
            <select id="v-status" value={input.status} onChange={(e) => set("status", e.target.value as VehicleInput["status"])} disabled={!!trip} className={`${cls("status")} bg-white disabled:bg-gray-50`}>
              {VEHICLE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-make">Make *</label>
            <input id="v-make" value={input.make} onChange={(e) => set("make", e.target.value)} placeholder="Toyota" className={cls("make")} />
            <FieldError k="make" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-model">Model *</label>
            <input id="v-model" value={input.model} onChange={(e) => set("model", e.target.value)} placeholder="Innova Crysta" className={cls("model")} />
            <FieldError k="model" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-year">Year *</label>
            <input id="v-year" inputMode="numeric" value={input.year} onChange={(e) => set("year", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="2022" className={cls("year")} />
            <FieldError k="year" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-seats">Seats *</label>
              <input
                id="v-seats"
                inputMode="numeric"
                value={input.seatingCapacity || ""}
                onChange={(e) => set("seatingCapacity", Number(e.target.value.replace(/\D/g, "").slice(0, 2)) || 0)}
                className={cls("seatingCapacity")}
              />
              <FieldError k="seatingCapacity" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-fuel">Fuel *</label>
              <select id="v-fuel" value={input.fuelType} onChange={(e) => set("fuelType", e.target.value)} className={`${cls("fuelType")} bg-white`}>
                <option value="">Choose</option>
                {FUEL_TYPES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <FieldError k="fuelType" />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-driver">Assigned Driver</label>
            <select id="v-driver" value={input.assignedDriverId} onChange={(e) => set("assignedDriverId", e.target.value)} disabled={!!trip} className={`${cls("assignedDriverId")} bg-white disabled:bg-gray-50`}>
              <option value="">Unassigned</option>
              {currentDriver && !driverOptions.some((d) => d.id === currentDriver.id) && (
                <option value={currentDriver.id}>{currentDriver.name} (current)</option>
              )}
              {driverOptions.map((d) => {
                const other = vehicles.find((x) => x.assignedDriverId === d.id && x.id !== vehicleId);
                return (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.phone}){other ? ` — moves from ${other.vehicleNumber}` : ""}
                  </option>
                );
              })}
            </select>
            <p className="text-[10px] text-gray-500 mt-1">
              {input.vendorId ? "Approved drivers of this vendor's fleet." : "Approved independent drivers (not attached to a vendor)."}
            </p>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-100">
          <h4 className="text-[12px] font-bold text-gray-900 mb-2">Documents</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-rc">RC Number</label>
              <input id="v-rc" value={input.rcNumber} onChange={(e) => set("rcNumber", e.target.value.toUpperCase())} className={`${cls("rcNumber")} font-mono uppercase`} />
            </div>
            <DocumentUpload label="Registration certificate (RC)" kind="rc" vehicleId={vehicleId} vendorId={input.vendorId} url={input.rcDocUrl} onUrl={(u) => set("rcDocUrl", u)} onBusy={(b) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)))} />
            <div>
              <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-ins">Insurance valid till</label>
              <input id="v-ins" type="date" value={input.insuranceExpiry} onChange={(e) => set("insuranceExpiry", e.target.value)} className={cls("insuranceExpiry")} />
              <FieldError k="insuranceExpiry" />
            </div>
            <DocumentUpload label="Insurance policy" kind="insurance" vehicleId={vehicleId} vendorId={input.vendorId} url={input.insuranceDocUrl} onUrl={(u) => set("insuranceDocUrl", u)} onBusy={(b) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)))} />
            <div>
              <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-permit">Permit valid till</label>
              <input id="v-permit" type="date" value={input.permitExpiry} onChange={(e) => set("permitExpiry", e.target.value)} className={cls("permitExpiry")} />
              <FieldError k="permitExpiry" />
            </div>
            <DocumentUpload label="Taxi / tourist permit" kind="permit" vehicleId={vehicleId} vendorId={input.vendorId} url={input.statePermitDocUrl} onUrl={(u) => set("statePermitDocUrl", u)} onBusy={(b) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)))} />
            <div>
              <label className="block text-[11px] font-bold text-ink mb-1" htmlFor="v-fc">Fitness (FC) valid till — if applicable</label>
              <input id="v-fc" type="date" value={input.fitnessExpiry} onChange={(e) => set("fitnessExpiry", e.target.value)} className={cls("fitnessExpiry")} />
              <FieldError k="fitnessExpiry" />
            </div>
            <DocumentUpload label="Fitness certificate (FC)" kind="fitness" vehicleId={vehicleId} vendorId={input.vendorId} url={input.fitnessDocUrl} onUrl={(u) => set("fitnessDocUrl", u)} onBusy={(b) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)))} />
          </div>
        </div>
      </form>
    </Modal>
  );
}

function DocumentUpload({
  label,
  kind,
  vehicleId,
  vendorId,
  url,
  onUrl,
  onBusy,
}: {
  label: string;
  kind: VehicleDocKind;
  vehicleId: string;
  vendorId: string;
  url: string;
  onUrl: (url: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    onBusy(true);
    try {
      onUrl(await uploadVehicleDocument(vehicleId, vendorId, kind, file));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
      onBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <span className="block text-[11px] font-bold text-ink mb-1">{label}</span>
      <div className="flex items-center gap-2 p-2 border border-dashed border-line rounded-lg min-h-[42px]">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-brand hover:underline truncate">
            View uploaded file
          </a>
        ) : (
          <span className="text-[11px] text-gray-400">No file uploaded</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : url ? "Replace" : "Upload"}
          </button>
          {url && !uploading && (
            <button type="button" onClick={() => onUrl("")} className="px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 rounded-md">
              Remove
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      {error && <p className="text-[10px] text-red-600 mt-1">{error}</p>}
    </div>
  );
}

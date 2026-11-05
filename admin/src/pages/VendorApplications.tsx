import { formatDateTime12, formatShortDateTime12, formatHourLabel } from "../utils/time";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { subscribeToCollection, COLLECTIONS } from "../services/adminFirestoreService";
import {
  createVendorInvite,
  issueVendorInvitation,
  describeAdminError,
  getVendorKyc,
  resolveStorageUrl,
  reviewVendor,
  type IssuedInvitation,
  type ReviewAction,
  type VendorKycView,
} from "../services/vendorReviewService";
import { VehicleRegisterCheck } from "../components/VehicleRegisterCheck";
import {
  normalizeVendorStatus,
  SECTION_LABELS,
  VENDOR_STATUS_META,
  type OnboardingSection,
  type VendorStatus,
} from "../utils/vendorStatus";

// ─── Types (vendors/{uid} as written by vendor/web onboarding) ──────────────

interface StoredFile {
  path: string;
  name: string;
  contentType: string;
  size: number;
}

/** One vehicle of the application (vendor onboarding, spec page 13). */
interface FleetVehicleDoc {
  registrationNumber: string;
  source: "vahan" | "manual";
  category: string;
  make: string;
  model: string;
  fuelType: string;
  passengerSeats: number;
  seatClass: string;
  year: string;
  issues: string[];
  insuranceUpto: string;
  fitnessUpto: string;
  permitUpto: string;
  rcFiles: StoredFile[];
  insuranceFiles: StoredFile[];
  fitnessFiles: StoredFile[];
  permitFiles: StoredFile[];
  frontPhotoFiles: StoredFile[];
}

/** vendor_requests/{uid}: a verified mobile asking for an account. */
interface VendorRequest {
  id: string;
  phone?: string;
  status?: "Requested" | "Invited" | "Registered";
  createdAt?: any;
}

interface VendorDoc {
  id: string;
  status: VendorStatus;
  phone?: string;
  name?: string;
  companyName?: string;
  owner?: string;
  contactPerson?: string;
  city?: string;
  email?: string;
  business?: {
    vendorName: string;
    businessName: string;
    email: string;
    altPhone: string;
    address: { line1: string; line2: string; city: string; state: string; pincode: string };
  };
  documents?: {
    businessRegistration: { type: string; number: string; files: StoredFile[] };
    identityProof: { type: string; maskedNumber: string; files: StoredFile[] };
  };
  fleet?: {
    vehicleTypes: string[];
    fleetSize: number;
    rcFiles: StoredFile[];
    vehiclePhotos: StoredFile[];
    insuranceFiles: StoredFile[];
    fcFiles?: StoredFile[];
    permitFiles?: StoredFile[];
    vehicles?: FleetVehicleDoc[];
  };
  payoutSummary?: { accountHolderName: string; bankLast4: string; ifsc: string; upiId: string };
  review?: { action?: string; note?: string; flaggedSections?: OnboardingSection[]; reviewedAt?: any; reviewedByEmail?: string };
  submittedAt?: any;
  createdAt?: any;
}

type TabKey = "PENDING_APPROVAL" | "CHANGES_REQUESTED" | "INCOMPLETE" | "APPROVED" | "REJECTED" | "SUSPENDED" | "ALL";

const TABS: { key: TabKey; label: string }[] = [
  { key: "PENDING_APPROVAL", label: "Unapproved Vendors" },
  { key: "CHANGES_REQUESTED", label: "Changes Requested" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "SUSPENDED", label: "Suspended" },
  { key: "INCOMPLETE", label: "Incomplete" },
  { key: "ALL", label: "All" },
];

const DOC_TYPE_LABEL: Record<string, string> = {
  GST: "GST Certificate",
  BUSINESS_REGISTRATION: "Business Registration",
  TRADE_LICENSE: "Trade License",
  AADHAAR: "Aadhaar",
  PAN: "PAN",
  PASSPORT: "Passport",
};

const toDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000);
  if (typeof ts === "number") return new Date(ts);
  return null;
};
const fmtDate = (ts: any) =>
  formatDateTime12(toDate(ts)) || "—";

const displayName = (v: VendorDoc) => v.business?.businessName || v.companyName || v.name || "Unnamed vendor";
const ownerName = (v: VendorDoc) => v.business?.vendorName || v.contactPerson || v.owner || "—";

// ─── Page ───────────────────────────────────────────────────────────────────

export default function VendorApplications() {
  const [vendors, setVendors] = useState<VendorDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("PENDING_APPROVAL");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState<null | { phone10?: string; requestId?: string }>(null);
  const [requests, setRequests] = useState<VendorRequest[]>([]);

  useEffect(() => {
    return subscribeToCollection<VendorRequest>("vendor_requests", (data) => setRequests(data));
  }, []);

  useEffect(() => {
    return subscribeToCollection<any>(COLLECTIONS.VENDORS, (data) => {
      setVendors(data.map((d) => ({ ...d, status: normalizeVendorStatus(d) })));
      setLoading(false);
    });
  }, []);

  const openRequests = useMemo(
    () => requests.filter((r) => r.status === "Requested" || r.status === "Invited").sort((a, b) => (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0)),
    [requests],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: vendors.length };
    vendors.forEach((v) => (c[v.status] = (c[v.status] ?? 0) + 1));
    return c;
  }, [vendors]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors
      .filter((v) => tab === "ALL" || v.status === tab)
      .filter(
        (v) =>
          !q ||
          displayName(v).toLowerCase().includes(q) ||
          ownerName(v).toLowerCase().includes(q) ||
          (v.phone ?? "").includes(q) ||
          (v.business?.email ?? v.email ?? "").toLowerCase().includes(q),
      )
      // Oldest submission first — first come, first reviewed.
      .sort((a, b) => (toDate(a.submittedAt)?.getTime() ?? Infinity) - (toDate(b.submittedAt)?.getTime() ?? Infinity));
  }, [vendors, tab, search]);

  // Keep the drawer bound to live data (another admin may act concurrently).
  const selected = vendors.find((v) => v.id === selectedId) ?? null;

  return (
    <div className="p-6 space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Vendors", value: counts.ALL ?? 0, color: "#c1232c" },
          { label: "Approved", value: counts.APPROVED ?? 0, color: "#10B981" },
          { label: "Awaiting Approval", value: counts.PENDING_APPROVAL ?? 0, color: "#F59E0B" },
          { label: "Changes Requested", value: counts.CHANGES_REQUESTED ?? 0, color: "#F97316" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
            <div className="text-[22px] font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[11px] text-faint">{s.label}</div>
          </div>
        ))}
      </div>

      {(counts.PENDING_APPROVAL ?? 0) > 0 && tab !== "PENDING_APPROVAL" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-1 text-[13px] font-semibold text-yellow-800">
            {counts.PENDING_APPROVAL} vendor application{counts.PENDING_APPROVAL > 1 ? "s" : ""} awaiting review
          </div>
          <button onClick={() => setTab("PENDING_APPROVAL")} className="text-[12px] font-semibold text-yellow-800 border border-yellow-300 px-3 py-1.5 rounded-lg hover:bg-yellow-100">
            Review now
          </button>
        </div>
      )}


      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-white rounded-xl border border-line p-1 w-fit shadow-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-all ${tab === t.key ? "text-white shadow-sm" : "text-muted hover:text-ink"}`}
            style={tab === t.key ? { background: "#c1232c" } : {}}
          >
            {t.label} ({counts[t.key] ?? 0})
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 bg-white rounded-xl border border-line shadow-sm p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search business, owner, phone, email…"
          className="flex-1 min-w-48 px-4 py-2 text-[13px] bg-hover border border-line rounded-lg focus:outline-none focus:border-brand placeholder-faint"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-surface-2 border-b border-line">
                {["Vendor", "Owner / Phone", "City", "Fleet", "Submitted", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[12px] text-faint">Loading vendors…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[12px] text-faint">No vendors in this view.</td></tr>
              )}
              {rows.map((v) => {
                const meta = VENDOR_STATUS_META[v.status];
                return (
                  <tr key={v.id} className="border-b border-hover last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <div className="text-[12px] font-semibold text-ink">{displayName(v)}</div>
                      <div className="text-[10px] text-faint font-mono">{v.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[12px] text-ink">{ownerName(v)}</div>
                      <div className="text-[10px] text-faint">{v.phone || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted">{v.business?.address.city || v.city || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="text-[12px] font-semibold text-ink">{v.fleet ? `${v.fleet.fleetSize} vehicles` : "—"}</div>
                      <div className="text-[10px] text-faint truncate max-w-[180px]">{v.fleet?.vehicleTypes.join(", ")}</div>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-muted whitespace-nowrap">{v.submittedAt ? fmtDate(v.submittedAt) : "Not submitted"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelectedId(v.id)}
                        className="text-[11px] px-3 py-1.5 rounded-md border border-line hover:bg-brand-soft text-brand font-semibold"
                      >
                        {v.status === "PENDING_APPROVAL" ? "Review" : "View"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <VendorReviewDrawer vendor={selected} onClose={() => setSelectedId(null)} />}
      {selectedId && !selected && !loading && (
        // Deleted while open.
        <div className="fixed bottom-6 right-6 z-50 bg-ink text-white text-[12px] px-4 py-3 rounded-lg" onClick={() => setSelectedId(null)}>
          That vendor no longer exists.
        </div>
      )}
    </div>
  );
}

// ─── Storage file tile ──────────────────────────────────────────────────────

function FileTile({ file }: { file: StoredFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const isImage = file.contentType?.startsWith("image/");

  useEffect(() => {
    let alive = true;
    resolveStorageUrl(file.path).then(
      (u) => alive && setUrl(u),
      () => alive && setError(true),
    );
    return () => {
      alive = false;
    };
  }, [file.path]);

  const body = error ? (
    <div className="h-full flex items-center justify-center text-[10px] text-brand p-2 text-center">Unavailable</div>
  ) : !url ? (
    <div className="h-full animate-pulse bg-line-soft" />
  ) : isImage ? (
    <img src={url} alt={file.name} className="h-full w-full object-cover" loading="lazy" />
  ) : (
    <div className="h-full flex flex-col items-center justify-center gap-1 text-brand">
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="text-[10px] font-bold">PDF</span>
    </div>
  );

  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={`block w-24 ${url ? "cursor-pointer" : "pointer-events-none"}`}
      title={file.name}
    >
      <div className="h-20 rounded-lg border border-line overflow-hidden bg-white hover:border-brand">{body}</div>
      <div className="mt-1 text-[10px] text-muted truncate">{file.name}</div>
    </a>
  );
}

function FileGroup({ label, files }: { label: string; files?: StoredFile[] }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted mb-1.5">
        {label} <span className="text-subtle">({files?.length ?? 0})</span>
      </div>
      {files?.length ? (
        <div className="flex flex-wrap gap-2">{files.map((f) => <FileTile key={f.path} file={f} />)}</div>
      ) : (
        <div className="text-[11px] text-brand">Missing</div>
      )}
    </div>
  );
}

// ─── Review drawer ──────────────────────────────────────────────────────────

const Row = ({ label, value }: { label: string; value?: ReactNode }) => (
  <div className="flex justify-between gap-4 py-1 text-[12px]">
    <span className="text-faint shrink-0">{label}</span>
    <span className="font-semibold text-ink text-right break-all">{value || "—"}</span>
  </div>
);

const Card = ({ title, section, flagged, children }: { title: string; section?: OnboardingSection; flagged?: OnboardingSection[]; children: ReactNode }) => (
  <div className={`rounded-xl border p-4 ${section && flagged?.includes(section) ? "border-orange-300 bg-orange-50/40" : "border-line"}`}>
    <h4 className="text-[12px] font-bold uppercase tracking-wide text-ink mb-2">{title}</h4>
    {children}
  </div>
);

function VendorReviewDrawer({ vendor, onClose }: { vendor: VendorDoc; onClose: () => void }) {
  const [kyc, setKyc] = useState<VendorKycView | null>(null);
  const [kycState, setKycState] = useState<"loading" | "ok" | "error">("loading");
  const [kycKey, setKycKey] = useState(0);
  const [revealBank, setRevealBank] = useState(false);

  const [mode, setMode] = useState<null | "request_changes" | "reject" | "suspend">(null);
  const [note, setNote] = useState("");
  const [sections, setSections] = useState<OnboardingSection[]>([]);
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setKycState("loading");
    getVendorKyc(vendor.id).then(
      (k) => {
        if (!alive) return;
        setKyc(k);
        setKycState("ok");
      },
      (err) => {
        if (!alive) return;
        describeAdminError(err);
        setKycState("error");
      },
    );
    return () => {
      alive = false;
    };
  }, [vendor.id, kycKey]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const s = vendor.status;
  const meta = VENDOR_STATUS_META[s];
  const b = vendor.business;
  const d = vendor.documents;
  const f = vendor.fleet;
  const p = vendor.payoutSummary;
  // Spec page 13: business details, account details and fleet documentation. Applications made
  // before that onboarding also carry `documents`; it is no longer required.
  const incomplete = !b || !f || !p || !(f.vehicles?.length || f.rcFiles?.length);

  const act = async (action: ReviewAction) => {
    if ((action === "request_changes" || action === "reject" || action === "suspend") && note.trim().length < 5) {
      setError("Please write a note for the vendor (at least 5 characters).");
      return;
    }
    if (action === "request_changes" && sections.length === 0) {
      setError("Select at least one section the vendor needs to fix.");
      return;
    }
    if (action === "approve" && incomplete && !window.confirm("This application is missing sections. Approve anyway?")) return;
    setBusy(action);
    setError("");
    try {
      await reviewVendor(vendor.id, action, note, sections);
      setMode(null);
      setNote("");
      setSections([]);
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setBusy(null);
    }
  };

  const Btn = ({ action, label, tone }: { action: ReviewAction; label: string; tone: "green" | "red" | "orange" | "gray" }) => {
    const tones = {
      green: "bg-emerald-600 hover:bg-emerald-700 text-white",
      red: "bg-brand hover:bg-brand-dark text-white",
      orange: "bg-orange-500 hover:bg-orange-600 text-white",
      gray: "bg-ink hover:bg-black text-white",
    };
    return (
      <button
        onClick={() => act(action)}
        disabled={!!busy}
        className={`px-4 py-2 text-[12px] font-bold rounded-lg shadow-sm disabled:opacity-60 ${tones[tone]}`}
      >
        {busy === action ? "Saving…" : label}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={() => !busy && onClose()} />
      <aside className="relative w-full max-w-2xl h-full bg-[#F7F7F7] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-line px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[16px] font-bold text-ink truncate">{displayName(vendor)}</h3>
            <div className="text-[11px] text-faint mt-0.5">
              {vendor.phone} · submitted {fmtDate(vendor.submittedAt)}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} /> {meta.label}
            </span>
            <button onClick={onClose} disabled={!!busy} className="text-faint hover:text-ink text-lg leading-none" aria-label="Close">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {vendor.review?.note && (
            <div className="rounded-xl border border-line bg-white p-3 text-[12px]">
              <div className="font-bold text-ink mb-1">
                Last decision: {vendor.review.action?.replace("_", " ") ?? "—"}
                <span className="font-normal text-faint"> · {fmtDate(vendor.review.reviewedAt)} {vendor.review.reviewedByEmail && `by ${vendor.review.reviewedByEmail}`}</span>
              </div>
              <p className="text-body whitespace-pre-wrap">{vendor.review.note}</p>
            </div>
          )}

          {incomplete && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[12px] text-blue-900">
              This vendor hasn't completed every onboarding section yet.
            </div>
          )}

          <Card title="Business details" section="business" flagged={vendor.review?.flaggedSections}>
            <Row label="Owner name" value={b?.vendorName ?? ownerName(vendor)} />
            <Row label="Business name" value={b?.businessName ?? displayName(vendor)} />
            <Row label="Login phone" value={vendor.phone} />
            {(b?.email || vendor.email) && <Row label="Email" value={b?.email ?? vendor.email} />}
            {b?.altPhone && <Row label="Alternate phone" value={`+91 ${b.altPhone}`} />}
            {(b as any)?.operatingCity && <Row label="Operating City / Base" value={(b as any).operatingCity} />}
            {(b as any)?.estimatedFleetSize && <Row label="Est. Fleet Size" value={`${(b as any).estimatedFleetSize} vehicle(s)`} />}
            {b?.address?.line1 && <Row label="Address" value={[b.address.line1, b.address.line2, b.address.city, b.address.state, b.address.pincode].filter(Boolean).join(", ")} />}
          </Card>

          {d && (
            <Card title="Identity & Business Documents" section="documents" flagged={vendor.review?.flaggedSections}>
              <Row label={DOC_TYPE_LABEL[d.businessRegistration?.type ?? ""] ?? "Business Registration"} value={d.businessRegistration?.number} />
              <Row
                label={`${DOC_TYPE_LABEL[d.identityProof?.type ?? ""] ?? "Owner ID"} number`}
                value={kycState === "ok" && kyc?.identityNumber ? kyc.identityNumber : d.identityProof?.maskedNumber}
              />
              <div className="grid gap-3 mt-3">
                <FileGroup label={DOC_TYPE_LABEL[d.businessRegistration?.type ?? ""] ?? "Business registration"} files={d.businessRegistration?.files} />
                <FileGroup label={DOC_TYPE_LABEL[d.identityProof?.type ?? ""] ?? "Identity proof"} files={d.identityProof?.files} />
              </div>
            </Card>
          )}

          <Card title="Fleet documentation" section="fleet" flagged={vendor.review?.flaggedSections}>
            <Row label="Vehicles" value={f ? `${f.vehicles?.length ?? f.fleetSize}` : ""} />
            {f?.vehicles?.length ? (
              <div className="space-y-3 mt-3">
                {f.vehicles.map((v) => (
                  <div key={v.registrationNumber} className="rounded-lg border border-line bg-white p-3 space-y-2" data-testid="fleet-vehicle">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold font-mono text-ink">{v.registrationNumber}</span>
                      <span className="text-[11px] text-muted">{[v.make, v.model].filter(Boolean).join(" ") || v.category}</span>
                      <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${v.source === "vahan" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {v.source === "vahan" ? "Register verified" : "Manual check"}
                      </span>
                    </div>
                    <VehicleRegisterCheck declared={{ plate: v.registrationNumber, category: v.category, insuranceUpto: v.insuranceUpto, fitnessUpto: v.fitnessUpto, permitUpto: v.permitUpto }} />
                    <Row label="Insurance valid till" value={v.insuranceUpto} />
                    <Row label="FC valid till" value={v.fitnessUpto} />
                    <Row label="Permit valid till" value={v.permitUpto} />
                    <div className="grid gap-3">
                      <FileGroup label="RC" files={v.rcFiles} />
                      <FileGroup label="Insurance" files={v.insuranceFiles} />
                      <FileGroup label="FC" files={v.fitnessFiles} />
                      <FileGroup label="Permit" files={v.permitFiles} />
                      <FileGroup label="Vehicle front" files={v.frontPhotoFiles} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <Row label="Vehicle types" value={f?.vehicleTypes.join(", ")} />
                <div className="grid gap-3 mt-3">
                  <FileGroup label="Registration certificates (RC)" files={f?.rcFiles} />
                  <FileGroup label="Vehicle photos" files={f?.vehiclePhotos} />
                  <FileGroup label="Insurance / fitness" files={f?.insuranceFiles} />
                </div>
              </>
            )}
          </Card>

          <Card title="Account details" section="payout" flagged={vendor.review?.flaggedSections}>
            {kycState === "loading" && <div className="text-[12px] text-faint">Loading private bank details…</div>}
            {kycState === "error" && (
              <div className="text-[12px] text-brand">
                Couldn't load bank details.{" "}
                <button className="underline font-semibold" onClick={() => setKycKey((k) => k + 1)}>Retry</button>
              </div>
            )}
            {kycState === "ok" && (
              <>
                <Row label="Account holder" value={kyc?.payout?.accountHolderName ?? p?.accountHolderName} />
                <Row
                  label="Account number"
                  value={
                    kyc?.payout?.accountNumber ? (
                      <span className="inline-flex items-center gap-2">
                        {revealBank ? kyc.payout.accountNumber : `••••${kyc.payout.accountNumber.slice(-4)}`}
                        <button className="text-[10px] text-brand underline" onClick={() => setRevealBank((r) => !r)}>
                          {revealBank ? "hide" : "show"}
                        </button>
                      </span>
                    ) : p ? `••••${p.bankLast4}` : ""
                  }
                />
                <Row label="IFSC" value={kyc?.payout?.ifsc ?? p?.ifsc} />
                <Row label="UPI ID" value={kyc?.payout?.upiId ?? p?.upiId} />
              </>
            )}
          </Card>
        </div>

        {/* Decision panel */}
        <div className="bg-white border-t border-line px-6 py-4 space-y-3">
          {mode && (
            <div className="space-y-2">
              {(mode === "request_changes" || mode === "reject") && (
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(SECTION_LABELS) as OnboardingSection[]).map((sec) => {
                    const on = sections.includes(sec);
                    return (
                      <button
                        key={sec}
                        onClick={() => setSections((prev) => (on ? prev.filter((x) => x !== sec) : [...prev, sec]))}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${on ? "bg-orange-50 border-orange-400 text-orange-700" : "border-line text-muted"}`}
                      >
                        {on ? "✓ " : ""}{SECTION_LABELS[sec]}
                      </button>
                    );
                  })}
                </div>
              )}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 1000))}
                rows={3}
                autoFocus
                placeholder={
                  mode === "request_changes"
                    ? "What should the vendor fix? e.g. RC for TN09AB1234 is blurry — please re-upload."
                    : mode === "reject"
                      ? "Reason for rejection (shown to the vendor)"
                      : "Reason for suspension (shown to the vendor)"
                }
                className="w-full px-3 py-2 text-[12px] border border-line rounded-lg focus:outline-none focus:border-brand"
              />
            </div>
          )}

          {error && <div className="text-[12px] font-medium text-brand bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex flex-wrap justify-end gap-2">
            {mode ? (
              <>
                <button onClick={() => { setMode(null); setError(""); }} disabled={!!busy} className="px-4 py-2 text-[12px] font-semibold border border-line rounded-lg">
                  Cancel
                </button>
                {mode === "request_changes" && <Btn action="request_changes" label="Send change request" tone="orange" />}
                {mode === "reject" && <Btn action="reject" label="Confirm rejection" tone="red" />}
                {mode === "suspend" && <Btn action="suspend" label="Confirm suspension" tone="gray" />}
              </>
            ) : (
              <>
                {(s === "PENDING_APPROVAL" || s === "CHANGES_REQUESTED" || s === "REJECTED") && (
                  <>
                    <button onClick={() => setMode("reject")} className="px-4 py-2 text-[12px] font-bold border border-red-300 text-brand rounded-lg hover:bg-red-50">
                      Reject
                    </button>
                    <button onClick={() => setMode("request_changes")} className="px-4 py-2 text-[12px] font-bold border border-orange-300 text-orange-700 rounded-lg hover:bg-orange-50">
                      Request changes
                    </button>
                    <Btn action="approve" label="✓ Approve vendor" tone="green" />
                  </>
                )}
                {s === "APPROVED" && (
                  <button onClick={() => setMode("suspend")} className="px-4 py-2 text-[12px] font-bold border border-line text-body rounded-lg hover:bg-hover">
                    Suspend vendor
                  </button>
                )}
                {s === "SUSPENDED" && <Btn action="reinstate" label="Reinstate vendor" tone="green" />}
                {s === "INCOMPLETE" && <span className="text-[12px] text-faint self-center">Waiting for the vendor to submit their application.</span>}
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─── Invite modal ───────────────────────────────────────────────────────────

/**
 * Issues a one-time invitation link (spec page 13). The link is shown once —
 * only its hash is stored — and works for this mobile number, once.
 * "Pre-approve" additionally records the number so the first submission goes
 * live without manual review (the vendor still completes every step).
 */
function InviteVendorModal({ initial, onClose }: { initial: { phone10?: string; requestId?: string }; onClose: () => void }) {
  const [phone10, setPhone10] = useState(initial.phone10 ?? "");
  const [preApproved, setPreApproved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [copied, setCopied] = useState("");

  const submit = async () => {
    if (!/^[6-9]\d{9}$/.test(phone10)) return setError("Enter a valid 10-digit mobile number.");
    setSaving(true);
    setError("");
    try {
      if (preApproved) {
        await createVendorInvite({ phone10, companyName: "", contactPerson: "", email: "", city: "", preApproved: true });
      }
      setIssued(await issueVendorInvitation({ phone10, requestId: initial.requestId }));
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setSaving(false);
    }
  };

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setError("Couldn't copy. Select the text and copy it manually.");
    }
  };

  const share = issued?.link || issued?.token || "";
  const message = issued
    ? `NESAM Tours & Travels fleet partner invitation: ${issued.link || `open the NESAM Vendor app and paste this code: ${issued.token}`}\nThis link works once, for ${issued.phone}, until ${new Date(issued.expiresAtMs).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`
    : "";

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-[15px] font-bold text-ink">Issue vendor invitation</h3>
          <button onClick={onClose} className="text-faint hover:text-ink">✕</button>
        </div>
        {issued ? (
          <div className="space-y-3" data-testid="issued-invitation">
            <p className="text-[13px] text-body">
              Invitation issued for <span className="font-semibold">{issued.phone}</span>. It works <span className="font-semibold">once</span> and expires{" "}
              {new Date(issued.expiresAtMs).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}. Send it to the vendor now — it
              cannot be shown again.
            </p>
            {issued.link ? (
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-muted">Invitation link</div>
                <div className="text-[12px] font-mono break-all bg-hover border border-line rounded-lg p-2">{issued.link}</div>
              </div>
            ) : (
              <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No vendor portal address is configured on the server (VENDOR_PORTAL_URL), so only the code is shown. The vendor pastes it into the Vendor app or portal.
              </div>
            )}
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-muted">Code</div>
              <div className="text-[12px] font-mono break-all bg-hover border border-line rounded-lg p-2">{issued.token}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {issued.link && (
                <button onClick={() => copy("link", share)} className="px-3 py-2 text-[12px] font-semibold border border-line rounded-lg hover:bg-hover">
                  {copied === "link" ? "Copied ✓" : "Copy link"}
                </button>
              )}
              <button onClick={() => copy("code", issued.token)} className="px-3 py-2 text-[12px] font-semibold border border-line rounded-lg hover:bg-hover">
                {copied === "code" ? "Copied ✓" : "Copy code"}
              </button>
              <a
                href={`https://wa.me/${issued.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 text-[12px] font-semibold border border-line rounded-lg hover:bg-hover"
              >
                Send on WhatsApp
              </a>
            </div>
            {error && <div className="text-[12px] text-brand bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <button onClick={onClose} className="w-full py-2.5 text-white text-[12px] font-bold rounded-lg" style={{ background: "#c1232c" }}>Done</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-muted">
              The vendor signs in to the Vendor app or portal with this number and opens the link. They then enter business and account details and
              document each vehicle; you review the application before approval.
            </p>
            <div className="flex items-center border border-line rounded-lg px-3 focus-within:border-brand">
              <span className="text-[12px] font-bold text-brand mr-2">+91</span>
              <input
                placeholder="Vendor mobile number *"
                inputMode="numeric"
                maxLength={10}
                value={phone10}
                onChange={(e) => setPhone10(e.target.value.replace(/\D/g, ""))}
                className="w-full py-2 text-[12px] focus:outline-none"
                readOnly={!!initial.requestId}
              />
            </div>
            <label className="flex items-start gap-2 text-[12px] text-body">
              <input type="checkbox" className="mt-0.5 accent-brand" checked={preApproved} onChange={(e) => setPreApproved(e.target.checked)} />
              <span>
                Pre-approve — skip manual review when this vendor submits.
                <span className="block text-[11px] text-faint">They must still complete every onboarding step.</span>
              </span>
            </label>
            {error && <div className="text-[12px] text-brand bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <button onClick={submit} disabled={saving} className="w-full py-2.5 text-white text-[12px] font-bold rounded-lg disabled:opacity-60" style={{ background: "#c1232c" }}>
              {saving ? "Issuing…" : "Issue invitation link"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

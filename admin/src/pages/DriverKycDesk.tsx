import { VehicleRegisterCheck } from "../components/VehicleRegisterCheck";
import { formatDateTime12, formatShortDateTime12, formatHourLabel } from "../utils/time";
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useEffect, useMemo, useState } from "react";
import type { Booking } from "../types";
import {
  subscribeBookings,
  subscribeToCollection,
  updateFirestoreDocument,
  setFirestoreDocument,
  addFirestoreDocument,
  COLLECTIONS,
} from "../services/adminFirestoreService";

// drivers/{uid} as written by the driver app's signup wizard.
interface DriverDoc {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  photoUrl?: string;
  dob?: string;
  gender?: string;
  address?: string;
  city?: string;
  pincode?: string;
  emergencyContactName?: string;
  emergencyContact?: string;
  status?: string; // Pending | Approved | Rejected | Suspended
  docStatus?: string; // Pending | Approved | Rejected
  presenceStatus?: string; // Offline | Online | On Trip
  rejectionReason?: string;
  vendorName?: string;
  rating?: number;
  vehicleNumber?: string;
  vehicleType?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  createdAt?: any;
  submittedAt?: any;
  identity?: Record<string, string>;
  licenseInfo?: Record<string, string>;
  vehicleInfo?: Record<string, any>;
  bank?: Record<string, string>;
}

type Filter = "review" | "Approved" | "Rejected" | "Suspended" | "all";

const needsReview = (d: DriverDoc) =>
  d.status === "Pending" || (d.status === "Approved" && d.docStatus === "Pending");

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const fmtDate = (v: any) =>
  formatDateTime12(toDate(v)) || "—";

const statusPill: Record<string, string> = {
  Pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  Approved: "bg-green-50 text-green-700 border-green-200",
  Rejected: "bg-red-50 text-brand border-red-200",
  Suspended: "bg-gray-100 text-gray-600 border-gray-300",
};

const isExpired = (date?: string) => !!date && new Date(date).getTime() < Date.now();

function Detail({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-hover last:border-0 text-[12px]">
      <span className="text-faint">{label}</span>
      <span className="font-semibold text-ink text-right break-all">{value || "—"}</span>
    </div>
  );
}

function DocImage({ label, url, expiry }: { label: string; url?: string; expiry?: string }) {
  return (
    <div className="border border-line rounded-xl p-2 bg-surface-2">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title="Open full size">
          <img src={url} alt={label} className="h-28 w-full object-cover rounded-lg hover:opacity-90" />
        </a>
      ) : (
        <div className="h-28 w-full rounded-lg bg-line-soft flex items-center justify-center text-[11px] text-faint">Not uploaded</div>
      )}
      <div className="flex items-center justify-between mt-1.5 gap-1">
        <span className="text-[11px] font-semibold text-body truncate">{label}</span>
        {expiry && (
          <span className={`text-[10px] font-bold ${isExpired(expiry) ? "text-brand" : "text-green-700"}`}>
            {isExpired(expiry) ? "Expired" : `till ${expiry}`}
          </span>
        )}
      </div>
    </div>
  );
}

async function notifyDriver(driverId: string, title: string, message: string) {
  await addFirestoreDocument(COLLECTIONS.NOTIFICATIONS, {
    recipientId: driverId,
    recipientType: "driver",
    type: "driver",
    // Approval / rejection decisions use the approval tab and tone in the driver app.
    category: "approvals",
    severity: /reject|declin|correction/i.test(title) ? "warning" : "success",
    sound: "approval",
    push: true,
    channel: "In-App",
    title,
    message,
    read: false,
  });
}

export default function DriverKycDesk() {
  const [drivers, setDrivers] = useState<DriverDoc[]>([]);
  const [filter, setFilter] = useState<Filter>("review");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DriverDoc | null>(null);
  const [reason, setReason] = useState("");
  // Onboarding no longer asks the driver for a name: the reviewer records it from the licence.
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({ phone: "", preApproved: false });
  const [inviteMsg, setInviteMsg] = useState("");

  useEffect(() => subscribeToCollection<DriverDoc>(COLLECTIONS.DRIVERS, setDrivers), []);
  // Completed trips are counted from bookings, not from a stored counter.
  const [bookings, setBookings] = useState<Booking[]>([]);
  useEffect(() => subscribeBookings(setBookings), []);
  const completedTrips = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bookings) if (b.status === "Completed" && b.assignedDriverId) m.set(b.assignedDriverId, (m.get(b.assignedDriverId) ?? 0) + 1);
    return m;
  }, [bookings]);

  // Keep the open review modal in sync with live data.
  const [privateData, setPrivateData] = useState<{ id: string; fields: Partial<DriverDoc> } | null>(null);
  useEffect(() => {
    if (!selected) return;
    return onSnapshot(doc(db, 'driver_private', selected.id), snap => setPrivateData({ id: selected.id, fields: snap.data() ?? {} }), () => setActionError('Could not load private driver details.'));
  }, [selected?.id]);
  const publicDriver = selected ? drivers.find((d) => d.id === selected.id) ?? selected : null;
  const live = publicDriver ? { ...publicDriver, ...(privateData?.id === publicDriver.id ? privateData.fields : {}) } : null;

  const counts = useMemo(
    () => ({
      review: drivers.filter(needsReview).length,
      Approved: drivers.filter((d) => d.status === "Approved").length,
      Rejected: drivers.filter((d) => d.status === "Rejected").length,
      Suspended: drivers.filter((d) => d.status === "Suspended").length,
      all: drivers.length,
      online: drivers.filter((d) => d.status === "Approved" && d.presenceStatus && d.presenceStatus !== "Offline").length,
    }),
    [drivers],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drivers
      .filter((d) =>
        filter === "all" ? true : filter === "review" ? needsReview(d) : d.status === filter,
      )
      .filter(
        (d) =>
          !q ||
          [d.name, d.phone, d.vehicleNumber, d.licenseNumber, d.city]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
      )
      .sort(
        (a, b) =>
          (toDate(b.submittedAt || b.createdAt)?.getTime() ?? 0) -
          (toDate(a.submittedAt || a.createdAt)?.getTime() ?? 0),
      );
  }, [drivers, filter, search]);

  const openReview = (d: DriverDoc) => {
    setSelected(d);
    setNameDraft(d.name || "");
    setReason(d.rejectionReason || "");
    setActionError("");
  };

  const act = async (fn: () => Promise<boolean>, close = true) => {
    setBusy(true);
    setActionError("");
    const ok = await fn();
    setBusy(false);
    if (!ok) {
      setActionError("Update failed — check your admin permissions and connection.");
      return;
    }
    if (close) setSelected(null);
  };

  const approve = (d: DriverDoc) => {
    const name = nameDraft.trim();
    if (name.length < 3) {
      setActionError("Enter the driver's name as printed on the driving licence before approving.");
      return;
    }
    return act(async () => {
      const ok = await updateFirestoreDocument(COLLECTIONS.DRIVERS, d.id, {
        name,
        status: "Approved",
        docStatus: "Approved",
        verified: true,
        rejectionReason: "",
        approvedAt: new Date().toISOString(),
      });
      if (ok) {
        await notifyDriver(
          d.id,
          d.status === "Approved" ? "Documents verified" : "You're approved! 🎉",
          d.status === "Approved"
            ? "Your updated documents have been verified."
            : "Your NESAM driver account is approved. Go online to start accepting trips.",
        );
      }
      return ok;
    });
  };

  const reject = (d: DriverDoc) => {
    if (!reason.trim()) {
      setActionError("Enter a reason so the driver knows what to fix.");
      return;
    }
    return act(async () => {
      // An already-approved driver keeps working; only their doc update is rejected.
      const alreadyApproved = d.status === "Approved";
      const ok = await updateFirestoreDocument(COLLECTIONS.DRIVERS, d.id, {
        ...(alreadyApproved ? {} : { status: "Rejected", verified: false }),
        docStatus: "Rejected",
        rejectionReason: reason.trim(),
        reviewedAt: new Date().toISOString(),
      });
      if (ok) {
        await notifyDriver(
          d.id,
          alreadyApproved ? "Document update rejected" : "Application needs changes",
          reason.trim(),
        );
      }
      return ok;
    });
  };

  const suspend = (d: DriverDoc) => {
    if (!reason.trim()) {
      setActionError("Enter a reason for the suspension.");
      return;
    }
    return act(async () => {
      const ok = await updateFirestoreDocument(COLLECTIONS.DRIVERS, d.id, {
        status: "Suspended",
        presenceStatus: "Offline",
        rejectionReason: reason.trim(),
      });
      if (ok) await notifyDriver(d.id, "Account suspended", reason.trim());
      return ok;
    });
  };

  const reactivate = (d: DriverDoc) =>
    act(async () => {
      const ok = await updateFirestoreDocument(COLLECTIONS.DRIVERS, d.id, {
        status: "Approved",
        rejectionReason: "",
      });
      if (ok) await notifyDriver(d.id, "Account reactivated", "Your driver account is active again.");
      return ok;
    });

  const createInvite = async () => {
    const digits = invite.phone.replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setInviteMsg("Enter a valid 10-digit mobile number.");
      return;
    }
    const e164 = `+91${digits}`;
    const ok = await setFirestoreDocument("driver_invites", e164, {
      phone: e164,
      preApproved: invite.preApproved,
      invitedBy: "admin",
      createdAt: new Date().toISOString(),
    });
    if (ok) {
      setInviteMsg(`Invite saved. Ask the driver to sign up in the Driver app with ${e164}.`);
      setInvite({ phone: "", preApproved: false });
    } else {
      setInviteMsg("Could not save the invite.");
    }
  };

  const tabs: { id: Filter; label: string }[] = [
    { id: "review", label: "Pending Review" },
    { id: "Approved", label: "Approved" },
    { id: "Rejected", label: "Rejected" },
    { id: "Suspended", label: "Suspended" },
    { id: "all", label: "All" },
  ];

  const d = live;
  const vi = d?.vehicleInfo || {};
  const li = d?.licenseInfo || {};
  const idn = d?.identity || {};
  const bank = d?.bank || {};

  return (
    <div className="p-6 space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Drivers", value: counts.all, color: "#111" },
          { label: "Pending Review", value: counts.review, color: "#D97706" },
          { label: "Approved", value: counts.Approved, color: "#10B981" },
          { label: "Online Now", value: counts.online, color: "#c1232c" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
            <div className="text-[22px] font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[11px] text-faint mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-line">
          <div className="flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold ${
                  filter === t.id ? "bg-brand text-white" : "text-muted hover:bg-hover"
                }`}
              >
                {t.label} ({counts[t.id]})
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, vehicle..."
              className="px-3 py-2 border border-line rounded-lg text-[12px] w-56"
            />
            <button
              onClick={() => { setShowInvite(true); setInviteMsg(""); }}
              className="px-4 py-2 text-[12px] font-semibold text-white rounded-lg bg-brand"
            >
              + Invite Driver
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="bg-surface-2 border-b border-line">
                {["Driver", "Vehicle", "Licence", "Submitted", "Account", "Documents", "Duty", "Trips", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-14 text-center text-[13px] text-faint">
                    {filter === "review" ? "No drivers waiting for review." : "No drivers found."}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-hover last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {r.photoUrl ? (
                        <img src={r.photoUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                      ) : (
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-bold bg-brand">
                          {(r.name || "D").split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </div>
                      )}
                      <div>
                        <div className="text-[12px] font-semibold text-ink">{r.name || "Unnamed"}</div>
                        <div className="text-[11px] text-faint">{r.phone}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[11px]">
                    <div className="font-mono font-semibold text-body">{r.vehicleNumber || "—"}</div>
                    <div className="text-faint">{r.vehicleType}</div>
                  </td>
                  <td className="px-4 py-3 text-[11px]">
                    <div className="font-mono text-body">{r.licenseNumber || "—"}</div>
                    {r.licenseExpiry && (
                      <div className={isExpired(r.licenseExpiry) ? "text-brand font-semibold" : "text-faint"}>
                        {isExpired(r.licenseExpiry) ? "Expired " : "till "}{r.licenseExpiry}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-muted whitespace-nowrap">{fmtDate(r.submittedAt || r.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusPill[r.status || "Pending"] || statusPill.Pending}`}>
                      {r.status || "Pending"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusPill[r.docStatus || "Pending"] || statusPill.Pending}`}>
                      {r.docStatus || "Pending"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-muted">{r.presenceStatus || "Offline"}</td>
                  <td className="px-4 py-3 text-[12px] font-semibold text-center">{completedTrips.get(r.id) ?? 0}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openReview(r)}
                      className="text-[11px] px-3 py-1 rounded-md border border-line bg-brand-soft text-brand font-bold hover:bg-brand hover:text-white"
                    >
                      {needsReview(r) ? "Review" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review modal */}
      {d && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-5xl w-full shadow-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div className="flex items-center gap-3">
                {d.photoUrl && (
                  <a href={d.photoUrl} target="_blank" rel="noreferrer">
                    <img src={d.photoUrl} alt="" className="w-12 h-12 rounded-xl object-cover" />
                  </a>
                )}
                <div>
                  <h3 className="text-base font-bold text-ink">{d.name || "Name not recorded yet"}</h3>
                  <p className="text-[11px] text-faint">
                    {d.phone} • Submitted {fmtDate(d.submittedAt || d.createdAt)}
                  </p>
                </div>
                <span className={`ml-2 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusPill[d.status || "Pending"]}`}>
                  {d.status}
                </span>
                {d.status === "Approved" && d.docStatus === "Pending" && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-yellow-50 text-yellow-700 border-yellow-200">
                    Documents updated
                  </span>
                )}
              </div>
              <button onClick={() => setSelected(null)} className="text-faint hover:text-ink text-lg font-bold">✕</button>
            </div>

            <div className="overflow-y-auto px-6 py-5 space-y-5">
              <div className="grid md:grid-cols-3 gap-5">
                <div>
                  <p className="text-[12px] font-bold text-ink mb-1">Driver</p>
                  <label className="text-[11px] text-faint block mt-1">Name as on licence {d.name ? "" : "(required to approve)"}</label>
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    placeholder="Full name"
                    className="w-full p-2 border border-line rounded-lg text-[12px] mb-1"
                  />
                  <Detail label="Mobile" value={d.phone} />
                  <Detail label="Vendor" value={d.vendorName || "Owner-driver (independent)"} />
                  {d.email && <Detail label="Email" value={d.email} />}
                  {d.dob && <Detail label="DOB" value={d.dob} />}
                  {d.address && <Detail label="Address" value={[d.address, d.city, d.pincode].filter(Boolean).join(", ")} />}
                  {d.emergencyContact && <Detail label="Emergency" value={`${d.emergencyContactName} (${d.emergencyContact})`} />}
                </div>
                <div>
                  <p className="text-[12px] font-bold text-ink mb-1">Driving licence</p>
                  <Detail label="Licence no." value={li.number || d.licenseNumber} />
                  <Detail label="Valid till" value={li.expiryDate || d.licenseExpiry} />
                  {(idn.aadhaarNumber || idn.panNumber) && (
                    <>
                      <p className="text-[12px] font-bold text-ink mt-3 mb-1">Identity (earlier application)</p>
                      <Detail label="Aadhaar" value={idn.aadhaarNumber} />
                      <Detail label="PAN" value={idn.panNumber} />
                    </>
                  )}
                  {bank.accountNumber && (
                    <>
                      <p className="text-[12px] font-bold text-ink mt-3 mb-1">Payout account</p>
                      <Detail label="Holder" value={bank.accountHolder} />
                      <Detail label="Account" value={bank.accountNumber} />
                      <Detail label="IFSC" value={bank.ifsc} />
                      <Detail label="UPI" value={bank.upiId} />
                    </>
                  )}
                </div>
                <div>
                  <p className="text-[12px] font-bold text-ink mb-1">Vehicle</p>
                  {d.vendorName && !(vi.vehicleNumber || d.vehicleNumber) ? (
                    <p className="text-[11px] text-faint">Fleet driver — the vehicle is assigned by {d.vendorName}.</p>
                  ) : (
                    <>
                      <Detail label="Registration" value={vi.vehicleNumber || d.vehicleNumber} />
                      <Detail label="Category" value={vi.vehicleType === "Premium SUV" ? "Innova Crysta" : vi.vehicleType} />
                      <Detail label="Vehicle" value={[vi.make, vi.model, vi.year && `(${vi.year})`].filter(Boolean).join(" ")} />
                      <Detail label="Seats / Fuel" value={vi.capacity ? `${vi.capacity}+1 • ${vi.fuelType || ""}` : ""} />
                      <Detail label="Insurance till" value={vi.insuranceExpiry} />
                      <Detail label="FC till" value={vi.fitnessExpiry} />
                      <Detail label="Permit till" value={vi.permitExpiry} />
                      <div className="mt-2">
                        <VehicleRegisterCheck
                          declared={{ plate: vi.vehicleNumber || d.vehicleNumber || "", category: vi.vehicleType, insuranceUpto: vi.insuranceExpiry, fitnessUpto: vi.fitnessExpiry, permitUpto: vi.permitExpiry }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div>
                <p className="text-[12px] font-bold text-ink mb-2">Documents</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <DocImage label="Selfie" url={d.photoUrl} />
                  <DocImage label="Licence front" url={li.frontPhotoUrl} expiry={li.expiryDate} />
                  <DocImage label="Licence back" url={li.backPhotoUrl} />
                  <DocImage label="RC" url={vi.rcDocUrl} />
                  <DocImage label="Insurance" url={vi.insuranceDocUrl} expiry={vi.insuranceExpiry} />
                  <DocImage label="Fitness (FC)" url={vi.fitnessDocUrl} expiry={vi.fitnessExpiry} />
                  <DocImage label="Permit" url={vi.statePermitDocUrl} expiry={vi.permitExpiry} />
                  <DocImage label="Vehicle front" url={vi.frontPhotoUrl} />
                  {idn.aadhaarFrontUrl && <DocImage label="Aadhaar front" url={idn.aadhaarFrontUrl} />}
                  {idn.aadhaarBackUrl && <DocImage label="Aadhaar back" url={idn.aadhaarBackUrl} />}
                  {idn.panPhotoUrl && <DocImage label="PAN" url={idn.panPhotoUrl} />}
                </div>
              </div>

              <div>
                <label className="text-[12px] font-bold text-ink block mb-1">
                  Reason / note to driver <span className="font-normal text-faint">(required to reject or suspend)</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Insurance photo is blurry — please re-upload a clear copy."
                  className="w-full p-2.5 border border-line rounded-lg text-[12px] h-16"
                />
              </div>
              {actionError && <p className="text-[12px] text-brand font-semibold">{actionError}</p>}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-4">
              {d.status === "Suspended" ? (
                <button disabled={busy} onClick={() => reactivate(d)} className="px-5 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg disabled:opacity-60">
                  Reactivate Account
                </button>
              ) : (
                <>
                  {d.status === "Approved" && (
                    <button disabled={busy} onClick={() => suspend(d)} className="px-4 py-2 border border-gray-300 text-gray-700 text-xs font-bold rounded-lg disabled:opacity-60">
                      Suspend
                    </button>
                  )}
                  {(d.status !== "Rejected" || d.docStatus !== "Rejected") && (
                    <button disabled={busy} onClick={() => reject(d)} className="px-4 py-2 border border-red-300 text-red-700 text-xs font-bold rounded-lg hover:bg-red-50 disabled:opacity-60">
                      {d.status === "Approved" ? "Reject Document Update" : "Reject / Request Changes"}
                    </button>
                  )}
                  {(d.status !== "Approved" || d.docStatus !== "Approved") && (
                    <button disabled={busy} onClick={() => approve(d)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow disabled:opacity-60">
                      {busy ? "Saving..." : d.status === "Approved" ? "✓ Approve Documents" : "✓ Approve Driver"}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-gray-900">Invite a Driver</h3>
              <button onClick={() => setShowInvite(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <p className="text-[12px] text-muted">
              The driver signs up in the Driver app with this mobile number. Their name is pre-filled.
            </p>
            <input value={invite.phone} placeholder="Mobile number (10 digits) *" type="tel" className="w-full p-2 border rounded text-xs" onChange={(e) => setInvite({ ...invite, phone: e.target.value })} />
            <label className="flex items-start gap-2 text-[12px] text-body">
              <input type="checkbox" checked={invite.preApproved} onChange={(e) => setInvite({ ...invite, preApproved: e.target.checked })} className="mt-0.5" />
              Pre-approve — the driver can take trips right after submitting their details (documents still appear here for audit).
            </label>
            {inviteMsg && <p className="text-[12px] font-semibold text-body">{inviteMsg}</p>}
            <button onClick={createInvite} className="w-full p-2.5 bg-brand hover:bg-brand-dark text-white text-xs font-bold rounded-lg">
              Save Invite
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

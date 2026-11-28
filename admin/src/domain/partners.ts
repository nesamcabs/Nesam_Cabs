/**
 * Master Admin partner registry vocabulary for Driver Partners, Vendor Drivers, Vendors and
 * Vehicles: approval (what the office decided about the application) and account status (whether
 * the ID may take new duties) are separate, each change is kept in a history list.
 *
 * Stored records predate these fields, so approval / account are derived from the existing
 * status fields when the new ones are absent. Writes keep the existing fields in step because the
 * server's eligibility checks (approved status, fleetStatus) read those.
 */
import { arrayUnion, doc, serverTimestamp, Timestamp, updateDoc, addDoc, collection, getDocs, writeBatch } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { normalizeVendorStatus } from "../utils/vendorStatus";
import { notifyPartner as sendPartnerNotice } from "../services/partnerNotices";
import { formatRegNumber, regKey } from "../services/vehicleService";

export type PartnerKind = "driver" | "vendor-driver" | "vendor" | "vehicle";
export const APPROVALS = ["Unapproved", "Changes requested", "Approved", "Rejected", "Incomplete"] as const;
export type Approval = (typeof APPROVALS)[number];
export const ACCOUNTS = ["Active", "Suspended", "Reactivation pending", "Inactive", "Dispute hold", "Permanent block", "Closed"] as const;
export type Account = (typeof ACCOUNTS)[number];
export const HOLD_REASONS = ["Driver / cab not assigned", "Duty not fulfilled", "Service / conduct", "Document / verification", "Serious incident", "Other"] as const;
export const DURATIONS = [["1 day", 1], ["1 week", 7], ["1 month", 30], ["Custom", 0]] as const;
export type AccountAction = "Suspend ID" | "Mark inactive" | "Permanent block" | "Open dispute" | "Reactivate ID" | "Resolve dispute";

export interface HistoryEntry {
  action: string;
  from?: string;
  to?: string;
  reason?: string;
  remarks?: string;
  until?: string;
  byName: string;
  at: Timestamp;
}

export type Raw = Record<string, unknown> & { id: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function approvalOf(kind: PartnerKind, r: Raw): Approval {
  const stored = str(r.approvalStatus);
  if ((APPROVALS as readonly string[]).includes(stored)) return stored as Approval;
  if (kind === "vendor") {
    switch (normalizeVendorStatus(r as { status?: unknown; submittedAt?: unknown })) {
      case "APPROVED":
      case "SUSPENDED": return "Approved";
      case "CHANGES_REQUESTED": return "Changes requested";
      case "REJECTED": return "Rejected";
      case "INCOMPLETE": return "Incomplete";
      default: return "Unapproved";
    }
  }
  if (kind === "vehicle") {
    const d = str(r.docStatus);
    if (/approved|verified/i.test(d)) return "Approved";
    if (/reject/i.test(d)) return "Rejected";
    if (!str(r.vehicleNumber) && !str(r.number)) return "Incomplete";
    return "Unapproved";
  }
  const s = str(r.status);
  if (s === "Approved" || s === "Suspended") return "Approved";
  if (s === "Rejected") return "Rejected";
  if (str(r.docStatus) === "Rejected") return "Changes requested";
  if (!str(r.licenseNumber) && !(r.licenseInfo && typeof r.licenseInfo === "object")) return "Incomplete";
  return "Unapproved";
}

export function accountOf(kind: PartnerKind, r: Raw): Account {
  const stored = str(r.accountStatus);
  if ((ACCOUNTS as readonly string[]).includes(stored)) return stored as Account;
  if (kind === "vendor") return normalizeVendorStatus(r as { status?: unknown; submittedAt?: unknown }) === "SUSPENDED" ? "Suspended" : "Active";
  if (kind === "vehicle") {
    const s = str(r.status);
    if (/suspend/i.test(s)) return "Suspended";
    if (/inactive|maintenance/i.test(s)) return "Inactive";
    return "Active";
  }
  if (str(r.status) === "Suspended" || str(r.fleetStatus) === "Suspended") return "Suspended";
  if (str(r.fleetStatus) === "Inactive") return "Inactive";
  return "Active";
}

export const disputeOf = (r: Raw) => str(r.disputeStatus) || "None";
export const isHold = (a: Account) => a !== "Active";

const who = () => auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Staff";
const colOf = (kind: PartnerKind) => (kind === "vendor" ? "vendors" : kind === "vehicle" ? "vehicles" : "drivers");

/** Fields the server and partner apps already read, kept in step with the account status. */
function legacyAccountFields(kind: PartnerKind, approval: Approval, account: Account): Record<string, unknown> {
  const hold = isHold(account);
  if (kind === "vendor") return { status: hold ? "SUSPENDED" : approval === "Approved" ? "APPROVED" : undefined };
  if (kind === "vehicle") return { status: hold ? "Inactive" : "Active" };
  return { fleetStatus: hold ? "Suspended" : "Active", status: hold ? "Suspended" : approval === "Approved" ? "Approved" : undefined, ...(hold ? { presenceStatus: "Offline" } : {}) };
}

function clean(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

async function notifyPartner(kind: PartnerKind, id: string, title: string, message: string) {
  if (kind === "vehicle") return;
  await sendPartnerNotice(kind === "vendor" ? "vendor" : "driver", id, {
    title, message, category: "approvals",
    severity: /reject|suspend|block|hold|change/i.test(title) ? "warning" : "success",
  });
}

/**
 * An already-approved driver sent new documents that the office does not accept: the documents are rejected with the
 * reason, while the account itself keeps working (same as the KYC review desk).
 */
export async function rejectDriverDocuments(kind: "driver" | "vendor-driver", r: Raw, reason: string) {
  const entry: HistoryEntry = { action: "Documents rejected", from: "Approved", to: "Approved", reason, byName: who(), at: Timestamp.now() };
  await updateDoc(doc(db, colOf(kind), r.id), { docStatus: "Rejected", rejectionReason: reason, reviewedAt: new Date().toISOString(), approvalHistory: arrayUnion(entry), updatedAt: serverTimestamp() });
  await notifyPartner(kind, r.id, "Document update rejected", reason);
}

/** The car names the driver app offers at registration, as vehicle categories are named. */
const REGISTERED_CATEGORY: Record<string, string> = { "Premium SUV": "Innova Crysta" };

/**
 * An owner-driver registers with their vehicle, but it is kept on the driver record (vehicleInfo), not as a vehicle record, and
 * a duty needs an approved vehicle record paired with the driver. On approval it is made from the registration and paired, with
 * its documents Pending: the office approves them in Verification, then duties unlock. A free owner-driver vehicle with the same
 * number is paired instead of a duplicate. Never throws: returns a line for the office, or null when there is nothing to do.
 */
async function attachRegisteredVehicle(r: Raw): Promise<string | null> {
  if (str(r.vendorId) || str(r.assignedVehicleId)) return null;
  const info = (r.vehicleInfo && typeof r.vehicleInfo === "object" ? r.vehicleInfo : {}) as Record<string, unknown>;
  const key = regKey(str(info.vehicleNumber) || str(r.vehicleNumber));
  if (!key) return null;
  const number = formatRegNumber(str(info.vehicleNumber) || str(r.vehicleNumber));
  const driverName = str(r.name);
  try {
    const all = await getDocs(collection(db, "vehicles"));
    const same = all.docs.find((d) => regKey(str(d.data().vehicleNumber) || str(d.data().number)) === key);
    const batch = writeBatch(db);
    const stamp = serverTimestamp();
    let id: string;
    if (same) {
      const v = same.data();
      if (str(v.vendorId) || (str(v.assignedDriverId) && str(v.assignedDriverId) !== r.id)) {
        return `Vehicle ${number} is already registered to another partner. Check it in Vehicles before pairing this driver.`;
      }
      id = same.id;
      batch.update(same.ref, { assignedDriverId: r.id, assignedDriverName: driverName, updatedAt: stamp });
    } else {
      const ref = doc(collection(db, "vehicles"));
      id = ref.id;
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
      const type = str(info.vehicleType) || str(r.vehicleType);
      batch.set(ref, {
        id, vehicleNumber: number, vendorId: "", vendorName: "",
        categoryId: "", category: REGISTERED_CATEGORY[type] ?? type,
        make: str(info.make), model: str(info.model), year: str(info.year), seatingCapacity: n(info.capacity), fuelType: str(info.fuelType),
        status: "Active", assignedDriverId: r.id, assignedDriverName: driverName,
        rcNumber: key, rcDocUrl: str(info.rcDocUrl),
        insuranceExpiry: str(info.insuranceExpiry), insuranceDocUrl: str(info.insuranceDocUrl),
        fitnessExpiry: str(info.fitnessExpiry), fitnessDocUrl: str(info.fitnessDocUrl),
        permitExpiry: str(info.permitExpiry), statePermitDocUrl: str(info.statePermitDocUrl),
        photoUrl: str(info.frontPhotoUrl),
        // Reviewed on its own in Verification, like any vehicle the office adds.
        docStatus: "Pending", rejectionReason: "", source: "driver-registration", createdAt: stamp, updatedAt: stamp,
      });
    }
    batch.update(doc(db, "drivers", r.id), { assignedVehicleId: id, assignedVehicleNumber: number, updatedAt: stamp });
    await batch.commit();
    return `Vehicle ${number} ${same ? "paired" : "added"}. Approve its documents in Verification to unlock duties.`;
  } catch {
    return `The vehicle ${number} could not be added automatically. Add it in Vehicles and pair this driver.`;
  }
}

/** Returns a line for the office when approving an owner-driver also added (or could not add) their vehicle. */
export async function decideApproval(kind: PartnerKind, r: Raw, decision: Approval, reason: string): Promise<string | null> {
  const from = approvalOf(kind, r);
  const entry: HistoryEntry = { action: `Approval: ${decision}`, from, to: decision, reason, byName: who(), at: Timestamp.now() };
  const base: Record<string, unknown> = { approvalStatus: decision, approvalHistory: arrayUnion(entry), updatedAt: serverTimestamp() };
  if (kind === "vendor") {
    const status = { Approved: "APPROVED", "Changes requested": "CHANGES_REQUESTED", Rejected: "REJECTED", Incomplete: "INCOMPLETE", Unapproved: "PENDING_APPROVAL" }[decision];
    Object.assign(base, {
      status: isHold(accountOf(kind, r)) && decision === "Approved" ? "SUSPENDED" : status, verified: decision === "Approved",
      review: { action: decision, note: reason, reviewedAt: serverTimestamp(), reviewedBy: auth.currentUser?.uid ?? "", reviewedByEmail: auth.currentUser?.email ?? "", flaggedSections: [] },
      ...(decision === "Approved" ? { approvedAt: serverTimestamp() } : {}),
    });
  } else if (kind === "vehicle") {
    Object.assign(base, { docStatus: decision === "Approved" ? "Approved" : decision === "Rejected" ? "Rejected" : "Pending", rejectionReason: decision === "Approved" ? "" : reason });
  } else {
    const hold = isHold(accountOf(kind, r));
    Object.assign(base, {
      status: hold ? "Suspended" : decision === "Approved" ? "Approved" : decision === "Rejected" ? "Rejected" : "Pending",
      docStatus: decision === "Approved" ? "Approved" : decision === "Changes requested" || decision === "Rejected" ? "Rejected" : "Pending",
      verified: decision === "Approved", rejectionReason: decision === "Approved" ? "" : reason, reviewedAt: new Date().toISOString(),
      ...(decision === "Approved" ? { approvedAt: new Date().toISOString() } : {}),
    });
  }
  await updateDoc(doc(db, colOf(kind), r.id), base);
  const titles: Record<Approval, string> = { Approved: "Account approved", "Changes requested": "Application needs changes", Rejected: "Application rejected", Incomplete: "Application incomplete", Unapproved: "Application under review" };
  await notifyPartner(kind, r.id, titles[decision], reason || (decision === "Approved" ? "Your NESAM partner account is approved." : "Open the app to see what to update."));
  return kind === "driver" && decision === "Approved" ? attachRegisteredVehicle(r) : null;
}

export async function changeAccount(kind: PartnerKind, r: Raw, action: AccountAction, p: { reason: string; remarks: string; until?: Date | null; handler?: string; holdDuties?: boolean }) {
  const approval = approvalOf(kind, r);
  const from = accountOf(kind, r);
  const to: Account =
    action === "Suspend ID" ? "Suspended"
    : action === "Mark inactive" ? "Inactive"
    : action === "Permanent block" ? "Permanent block"
    : action === "Open dispute" ? (p.holdDuties ? "Dispute hold" : from)
    : "Active";
  const dispute = action === "Open dispute" ? "Open" : action === "Resolve dispute" ? "Resolved" : undefined;
  const entry: HistoryEntry = {
    action, from, to, reason: p.reason, remarks: p.remarks, byName: who(), at: Timestamp.now(),
    ...(p.until ? { until: p.until.toISOString() } : {}),
  };
  await updateDoc(doc(db, colOf(kind), r.id), clean({
    accountStatus: to, ...(dispute ? { disputeStatus: dispute, disputeHandler: p.handler ?? who() } : {}),
    holdUntil: p.until ? Timestamp.fromDate(p.until) : null, statusHistory: arrayUnion(entry), updatedAt: serverTimestamp(),
    ...legacyAccountFields(kind, approval, to),
  }));
  if (from !== to) await notifyPartner(kind, r.id, to === "Active" ? "Account reactivated" : `Account ${to.toLowerCase()}`, p.reason);
  if (from !== to) await queueAccountNotice(kind, r, to, p.reason, p.until ?? null);
}

/** Suspension / reactivation email for the Communication › Account notices queue. */
async function queueAccountNotice(kind: PartnerKind, r: Raw, to: Account, reason: string, until: Date | null) {
  const email = str(r.email).trim();
  const name = str(r.companyName) || str(r.name) || str(r.registrationNumber) || r.id;
  const reactivated = to === "Active";
  const subject = reactivated ? "Your NESAM account is active again" : `Your NESAM account is ${to.toLowerCase()}`;
  const body = reactivated
    ? `Hello ${name}, your NESAM account has been reactivated. You can take new duties again.`
    : `Hello ${name}, your NESAM account status is now ${to}${until ? ` until ${until.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : ""}. Reason: ${reason}. Please contact the NESAM office for help.`;
  await addDoc(collection(db, "account_notices"), {
    entity: r.id, entityKind: kind, name, to: email, subject, body, accountStatus: to,
    status: email ? "Queued" : "Email not supplied", createdBy: auth.currentUser?.uid ?? "", createdByName: who(), at: serverTimestamp(),
  }).catch(() => undefined);
}

export async function editPartnerProfile(kind: PartnerKind, id: string, patch: Record<string, unknown>, note: string) {
  await updateDoc(doc(db, colOf(kind), id), { ...patch, statusHistory: arrayUnion({ action: "Profile edited", reason: note, byName: who(), at: Timestamp.now() }), updatedAt: serverTimestamp() });
}

/** Moves a driver or vehicle to another vendor (or out of one). Earlier trips stay with the old partner. */
export async function transferAttachment(kind: "driver" | "vendor-driver" | "vehicle", id: string, toVendor: { id: string; name: string } | null, reason: string, reference: string) {
  const entry = { action: `Transferred to ${toVendor?.name ?? "Driver Partner (own vehicle)"}`, reason, remarks: reference, byName: who(), at: Timestamp.now() };
  await updateDoc(doc(db, colOf(kind), id), {
    vendorId: toVendor?.id ?? "", ...(kind === "vehicle" ? { vendorName: toVendor?.name ?? "" } : { vendor: toVendor?.name ?? null }),
    statusHistory: arrayUnion(entry), transfers: arrayUnion({ to: toVendor?.name ?? "Driver Partner", toId: toVendor?.id ?? "", reason, reference, byName: who(), at: Timestamp.now() }),
    updatedAt: serverTimestamp(),
  });
}

/** Full & Final: closes the ID with the reconciled settlement recorded. History is kept. */
export async function closeFullFinal(kind: PartnerKind, r: Raw, p: { balance: number; deposit: number; reference: string; reason: string; name: string }) {
  await addDoc(collection(db, "ff_records"), {
    partnerKind: kind, partnerId: r.id, partnerName: p.name, balance: p.balance, depositRefund: p.deposit, reference: p.reference, reason: p.reason,
    status: "Closed", closedByName: who(), closedBy: auth.currentUser?.uid ?? "", closedAt: serverTimestamp(),
  });
  await changeAccount(kind, r, "Mark inactive", { reason: `Full & Final: ${p.reason}`, remarks: p.reference });
  await updateDoc(doc(db, colOf(kind), r.id), { accountStatus: "Closed", ffClosedAt: serverTimestamp() });
}

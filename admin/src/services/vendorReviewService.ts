import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { auth, db, storage } from "./firebase";
import { callFunction } from "./callables";
import type { OnboardingSection, VendorStatus } from "../utils/vendorStatus";

export type ReviewAction = "approve" | "request_changes" | "reject" | "suspend" | "reinstate";

const TARGET_STATUS: Record<ReviewAction, VendorStatus> = {
  approve: "APPROVED",
  request_changes: "CHANGES_REQUESTED",
  reject: "REJECTED",
  suspend: "SUSPENDED",
  reinstate: "APPROVED",
};

/**
 * Admin decision on a vendor application. The vendor app listens to this doc
 * in real time, so the vendor is re-routed the moment this write lands.
 */
export async function reviewVendor(
  vendorId: string,
  action: ReviewAction,
  note: string,
  flaggedSections: OnboardingSection[] = [],
): Promise<void> {
  const status = TARGET_STATUS[action];
  const approved = status === "APPROVED";
  await updateDoc(doc(db, "vendors", vendorId), {
    status,
    verified: approved,
    review: {
      action,
      note: note.trim(),
      flaggedSections: action === "request_changes" || action === "reject" ? flaggedSections : [],
      reviewedAt: serverTimestamp(),
      reviewedBy: auth.currentUser?.uid ?? "",
      reviewedByEmail: auth.currentUser?.email ?? "",
    },
    ...(action === "approve" ? { approvedAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  });
}

export interface VendorKycView {
  identityNumber: string;
  payout: { accountHolderName: string; accountNumber: string; ifsc: string; upiId: string } | null;
}

/** Private KYC doc (full ID number + bank details). Admin-readable only. */
export async function getVendorKyc(vendorId: string): Promise<VendorKycView | null> {
  const snap = await getDoc(doc(db, "vendor_kyc", vendorId));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { identityNumber: d.identityProof?.number ?? "", payout: d.payout ?? null };
}

const urlCache = new Map<string, Promise<string>>();
/** Short-lived download URL for a vendor upload, resolved through Storage rules. */
export function resolveStorageUrl(path: string): Promise<string> {
  let p = urlCache.get(path);
  if (!p) {
    p = getDownloadURL(ref(storage, path));
    p.catch(() => urlCache.delete(path));
    urlCache.set(path, p);
  }
  return p;
}

export interface VendorInviteInput {
  phone10: string;
  companyName: string;
  contactPerson: string;
  email: string;
  city: string;
  preApproved: boolean;
}

/**
 * Pre-registers a vendor by phone (doc id = E.164). When that number signs up
 * in the vendor app the wizard is prefilled, and a pre-approved invite lets
 * the first submission go live without manual review.
 */
export async function createVendorInvite(input: VendorInviteInput): Promise<void> {
  const phone = `+91${input.phone10}`;
  await setDoc(doc(db, "vendor_invites", phone), {
    phone,
    companyName: input.companyName.trim(),
    contactPerson: input.contactPerson.trim(),
    email: input.email.trim().toLowerCase(),
    city: input.city.trim(),
    preApproved: input.preApproved,
    invitedBy: auth.currentUser?.uid ?? "",
    createdAt: serverTimestamp(),
  });
}

export function describeAdminError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  console.error("[Vendor review]", code, error);
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You're offline. Reconnect and try again.";
  if (code.includes("permission-denied")) return "Permission denied — this account is not an admin in Firestore (admins/{uid}.role).";
  if (code.includes("not-found")) return "This vendor no longer exists.";
  if (code.includes("unavailable")) return "Firestore is unreachable. Check your connection and retry.";
  return (error as { message?: string })?.message || "Something went wrong. Please try again.";
}

// ── One-time invitation links (spec page 13) ────────────────────────────────

export interface IssuedInvitation {
  /** Shown once: only its hash is stored, so it cannot be read back later. */
  token: string;
  invitationId: string;
  phone: string;
  expiresAtMs: number;
  /** Full link when the deployment knows the vendor portal address (VENDOR_PORTAL_URL); empty otherwise. */
  link: string;
}

/** Issues a link for a verified request (requestId) or a typed mobile number. A new link retires the previous one. */
export async function issueVendorInvitation(input: { phone10?: string; requestId?: string; validHours?: number }): Promise<IssuedInvitation> {
  return callFunction<{ phone?: string; requestId?: string; validHours?: number }, IssuedInvitation>("issueVendorInvitation", {
    ...(input.phone10 ? { phone: `+91${input.phone10}` } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.validHours ? { validHours: input.validHours } : {}),
  });
}

/** What the vehicle register returned for a plate (server-written vehicle_lookups/{plate}; staff read-only). */
export interface VehicleLookupView {
  status: string;
  provider: string;
  fetchedAtMs: number;
  record: {
    make: string;
    model: string;
    variant: string;
    fuelType: string;
    seatingCapacity: number;
    passengerSeats: number;
    seatClass: string;
    manufactureYear: string;
    vehicleClass: string;
    usage: string;
    registrationStatus: string;
    registrationActive: boolean | null;
    ownerNameMasked: string;
    category: string;
    specClass: string;
    validity: { fitnessUpto: string; insuranceUpto: string; permitUpto: string; taxUpto: string; pucUpto: string };
  };
}

const lookupCache = new Map<string, Promise<VehicleLookupView | null>>();
export function getVehicleLookup(plate: string): Promise<VehicleLookupView | null> {
  const id = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!id) return Promise.resolve(null);
  let p = lookupCache.get(id);
  if (!p) {
    p = getDoc(doc(db, "vehicle_lookups", id)).then((snap) => {
      const d = snap.data();
      if (!snap.exists() || !d?.record) return null;
      const ms = typeof d.fetchedAt?.toMillis === "function" ? d.fetchedAt.toMillis() : 0;
      return { status: String(d.status ?? ""), provider: String(d.provider ?? ""), fetchedAtMs: ms, record: d.record } as VehicleLookupView;
    });
    p.catch(() => lookupCache.delete(id));
    lookupCache.set(id, p);
  }
  return p;
}

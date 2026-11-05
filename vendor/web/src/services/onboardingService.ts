import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { VENDOR_INVITES_COLLECTION, VENDOR_KYC_COLLECTION } from '../config/onboarding';
import type {
  AdminReview,
  BusinessInfo,
  FleetDetails,
  OnboardingSection,
  PayoutDetails,
  PayoutSummary,
  VendorProfile,
  VendorRecord,
  VendorStatus,
} from '../types';
import { withRetry, withTimeout } from '../utils/retry';
import { buildFleetDetails, displayPlate, fleetIsComplete, isPlate, normalizePlate, vehicleFromPlate } from '../utils/fleet';
import { callFunction } from './callables';

const VENDORS = 'vendors';

/** Statuses in which the vendor may edit and (re)submit the application. */
export const EDITABLE_STATUSES: VendorStatus[] = ['INCOMPLETE', 'CHANGES_REQUESTED', 'REJECTED'];

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw Object.assign(new Error('Your session has expired. Please sign in again.'), { code: 'unauthenticated' });
  return uid;
}

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'number') return value;
  const ts = value as { toMillis?: () => number };
  return typeof ts.toMillis === 'function' ? ts.toMillis() : null;
}

/**
 * Maps both the canonical statuses and the legacy ones written by earlier
 * versions of the vendor/admin panels ('Pending', 'Approved', 'Active', …).
 */
export function normalizeVendorStatus(data: DocumentData): VendorStatus {
  const raw = String(data.status ?? data.verificationStatus ?? '');
  switch (raw) {
    case 'INCOMPLETE':
    case 'PENDING_APPROVAL':
    case 'CHANGES_REQUESTED':
    case 'APPROVED':
    case 'REJECTED':
    case 'SUSPENDED':
      return raw;
    case 'Approved':
    case 'Active':
      return 'APPROVED';
    case 'Needs Correction':
      return 'CHANGES_REQUESTED';
    case 'Rejected':
      return 'REJECTED';
    case 'Suspended':
    case 'Blacklisted':
      return 'SUSPENDED';
    default:
      // Legacy 'Pending' docs were created by the old one-screen signup and
      // never collected documents — send them through the wizard.
      return data.submittedAt ? 'PENDING_APPROVAL' : 'INCOMPLETE';
  }
}

function mapReview(raw: unknown): AdminReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    note: typeof r.note === 'string' ? r.note : '',
    flaggedSections: Array.isArray(r.flaggedSections) ? (r.flaggedSections as OnboardingSection[]) : [],
    reviewedAt: toMillis(r.reviewedAt) ?? undefined,
  };
}

export function mapVendorRecord(uid: string, data: DocumentData): VendorRecord {
  return {
    uid,
    phone: data.phone || auth.currentUser?.phoneNumber || '',
    status: normalizeVendorStatus(data),
    onboardingStep: typeof data.onboardingStep === 'number' ? data.onboardingStep : 0,
    business: data.business ?? null,
    documents: data.documents ?? null,
    fleet: data.fleet ?? null,
    payoutSummary: data.payoutSummary ?? null,
    review: mapReview(data.review),
    submittedAt: toMillis(data.submittedAt),
  };
}

/** Shape consumed by the post-approval dashboard components. */
export function mapVendorProfile(uid: string, data: DocumentData): VendorProfile {
  const b: Partial<BusinessInfo> = data.business ?? {};
  const status = normalizeVendorStatus(data);
  return {
    id: uid,
    // The registered business name; the contact name only if none was given.
    companyName: b.businessName || data.companyName || b.vendorName || '',
    contactPerson: b.vendorName || data.contactPerson || '',
    phone: data.phone || '',
    email: b.email || data.email || '',
    gstin: data.gstin || '',
    panNumber: data.panNumber || '',
    address: b.address ? [b.address.line1, b.address.line2].filter(Boolean).join(', ') : data.address || '',
    city: b.address?.city || data.city || '',
    totalFleetSize: data.fleet?.fleetSize ?? data.totalFleetSize ?? 0,
    totalDriversCount: typeof data.totalDriversCount === 'number' ? data.totalDriversCount : 0,
    verificationStatus:
      status === 'APPROVED' ? 'Approved'
      : status === 'REJECTED' ? 'Rejected'
      : status === 'CHANGES_REQUESTED' ? 'Needs Correction'
      : 'Pending',
    joinedDate: data.joinedDate || '',
    bankAccountName: data.payoutSummary?.accountHolderName || '',
    bankAccountNumber: data.payoutSummary?.bankLast4 ? `••••${data.payoutSummary.bankLast4}` : '',
    ifscCode: data.payoutSummary?.ifsc || '',
    upiId: data.payoutSummary?.upiId || '',
  };
}

export interface VendorSnapshot {
  record: VendorRecord;
  profile: VendorProfile;
}

/**
 * Real-time listener on vendors/{uid}. Emits null while the doc does not
 * exist (brand-new signup). Drives all routing, so an admin approval flips
 * the vendor to the dashboard without a reload.
 */
export function subscribeToVendor(
  uid: string,
  onData: (snap: VendorSnapshot | null) => void,
  onError: (error: unknown) => void,
): () => void {
  return onSnapshot(
    doc(db, VENDORS, uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      onData({ record: mapVendorRecord(uid, data), profile: mapVendorProfile(uid, data) });
    },
    onError,
  );
}

export interface VendorInvite {
  businessName: string;
  vendorName: string;
  email: string;
  city: string;
  preApproved: boolean;
}

/** Admin pre-registration keyed by E.164 phone. Absent/unreadable → null. */
export async function getVendorInvite(phoneE164: string): Promise<VendorInvite | null> {
  if (!phoneE164) return null;
  try {
    const snap = await withRetry(() => getDoc(doc(db, VENDOR_INVITES_COLLECTION, phoneE164)));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      businessName: d.companyName || d.businessName || '',
      vendorName: d.contactPerson || d.vendorName || '',
      email: d.email || '',
      city: d.city || '',
      preApproved: d.preApproved === true,
    };
  } catch {
    return null;
  }
}

export interface VendorKyc {
  identityNumber: string;
  payout: PayoutDetails | null;
}

/** Private KYC (full ID number + bank details) — owner and admin only. */
export async function getVendorKyc(): Promise<VendorKyc> {
  const uid = requireUid();
  const snap = await withRetry(() => getDoc(doc(db, VENDOR_KYC_COLLECTION, uid)));
  const d = snap.exists() ? snap.data() : {};
  return {
    identityNumber: d.identityProof?.number || '',
    payout: d.payout ?? null,
  };
}

const nextStep = (record: VendorRecord | null, completedIndex: number) =>
  Math.max(record?.onboardingStep ?? 0, completedIndex + 1);

/** Contact fields onboarding no longer asks for; kept as empty values so the profile screens that edit them still work. */
const EMPTY_ADDRESS = { line1: '', line2: '', city: '', state: '', pincode: '' };

/**
 * Step 1 (business/account details). Supports both new self-registered vendors
 * and vendors resuming an existing application. Uses setDoc+merge so it works
 * whether or not the document already has all fields.
 * Full bank details go to vendor_kyc; the vendor document keeps a masked summary.
 */
export async function saveBusinessAccountStep(
  record: VendorRecord | null,
  business: Pick<BusinessInfo, 'vendorName' | 'businessName'> & {
    email?: string;
    altPhone?: string;
    operatingCity?: string;
    operatingAreas?: string[];
    estimatedFleetSize?: number;
  },
  payout: PayoutDetails,
): Promise<void> {
  const uid = requireUid();
  const summary: PayoutSummary = {
    accountHolderName: payout.accountHolderName,
    bankLast4: payout.accountNumber.slice(-4),
    ifsc: payout.ifsc,
    upiId: payout.upiId,
  };
  const prev = record?.business;
  const batch = writeBatch(db);
  batch.set(doc(db, VENDOR_KYC_COLLECTION, uid), { payout, updatedAt: serverTimestamp() }, { merge: true });
  batch.set(
    doc(db, VENDORS, uid),
    {
      business: {
        vendorName: business.vendorName,
        businessName: business.businessName,
        email: business.email ?? prev?.email ?? '',
        altPhone: business.altPhone ?? prev?.altPhone ?? '',
        address: prev?.address ?? EMPTY_ADDRESS,
        operatingCity: business.operatingCity ?? '',
        operatingAreas: business.operatingAreas ?? [],
        estimatedFleetSize: business.estimatedFleetSize ?? 1,
      },
      companyName: business.businessName,
      name: business.businessName,
      contactPerson: business.vendorName,
      owner: business.vendorName,
      payoutSummary: summary,
      onboardingStep: nextStep(record, 0),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await withTimeout(batch.commit());
}

/** Step 2 (identity & business documents). Saves vendor_kyc identity number + public document metadata. */
export async function saveDocumentsStep(
  record: VendorRecord,
  documents: import('../types').VendorDocuments,
  identityNumber: string,
): Promise<void> {
  const uid = requireUid();
  const batch = writeBatch(db);
  batch.set(doc(db, VENDOR_KYC_COLLECTION, uid), { identityProof: { type: documents.identityProof.type, number: identityNumber }, updatedAt: serverTimestamp() }, { merge: true });
  batch.set(
    doc(db, VENDORS, uid),
    {
      documents,
      onboardingStep: nextStep(record, 1),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await withTimeout(batch.commit());
}

/** Step 3 (spec page 13: "fleet documentation"). */
export async function saveFleetStep(record: VendorRecord, fleet: FleetDetails): Promise<void> {
  const uid = requireUid();
  await withTimeout(
    updateDoc(doc(db, VENDORS, uid), {
      fleet,
      fleetSize: fleet.fleetSize,
      totalFleetSize: fleet.fleetSize,
      onboardingStep: nextStep(record, 2),
      updatedAt: serverTimestamp(),
    }),
  );
}

/** Returns the sections that are still missing required data. */
export function missingSections(record: VendorRecord): OnboardingSection[] {
  const missing: OnboardingSection[] = [];
  if (!record.business?.businessName || !record.business?.vendorName) missing.push('business');
  if (!record.payoutSummary?.bankLast4) missing.push('payout');
  if (!fleetIsComplete(record.fleet)) missing.push('fleet');
  return missing;
}

// ── Sign-up with a vehicle number ───────────────────────────────────────────

/**
 * Sign-up needs only a vehicle registration number. The vendors/{uid} document is created already
 * submitted (PENDING_APPROVAL) with that one vehicle: no register lookup, no documents. NESAM
 * verifies the vehicle and the partner during review, then approves the account. Business, bank
 * and document details are not asked for at sign-up; NESAM collects what it needs afterwards.
 */
/** The vendors/{uid} document a new partner signs up with (Firestore rules: vendorSelfCreateOk). */
export function buildVendorSignupRecord(uid: string, phone: string, registration: string) {
  const plate = normalizePlate(registration);
  const label = `Partner ${displayPlate(plate)}`;
  return {
    uid,
    role: 'vendor' as const,
    phone,
    status: 'PENDING_APPROVAL' as VendorStatus,
    onboardingStep: 4,
    business: { vendorName: '', businessName: '', email: '', altPhone: '', address: EMPTY_ADDRESS, operatingCity: '', operatingAreas: [] as string[], estimatedFleetSize: 1 },
    documents: null,
    fleet: buildFleetDetails([vehicleFromPlate(plate)]),
    fleetSize: 1,
    totalFleetSize: 1,
    payoutSummary: null,
    // Lists and headers show this until NESAM records the partner's own name.
    companyName: label,
    name: label,
    contactPerson: '',
    owner: '',
    submittedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function registerVendorWithVehicle(phone: string, registration: string): Promise<void> {
  const uid = requireUid();
  if (!isPlate(registration)) throw new Error('Enter a valid registration number (e.g. TN 01 AB 1234).');
  await withTimeout(setDoc(doc(db, VENDORS, uid), buildVendorSignupRecord(uid, phone, registration)));
}

// ── Registration request → one-time invitation (legacy; kept for back-compat) ─

export type RegistrationState = 'requested' | 'invited' | 'registered';

/** Asks NESAM to open a vendor account for the signed-in, phone-verified user. */
export async function requestVendorRegistration(): Promise<RegistrationState> {
  const r = await callFunction<Record<string, never>, { status: RegistrationState }>('requestVendorRegistration', {});
  return r.status;
}

/** Uses a one-time invitation (link or code) to create this phone's vendor application. */
export async function redeemVendorInvitation(tokenOrLink: string): Promise<void> {
  await callFunction<{ token: string }, { ok: true }>('redeemVendorInvitation', { token: tokenOrLink.trim() });
}

/** The request this user already made, if any (read-only; written by the server). */
export async function getRegistrationRequest(): Promise<{ status: string } | null> {
  const uid = requireUid();
  try {
    const snap = await getDoc(doc(db, 'vendor_requests', uid));
    return snap.exists() ? { status: String(snap.data().status ?? 'Requested') } : null;
  } catch {
    return null;
  }
}

/**
 * Final step. Always flips status to PENDING_APPROVAL — the admin must
 * explicitly approve from the admin panel (no more invite-based pre-approval).
 */
export async function submitForReview(record: VendorRecord): Promise<void> {
  const uid = requireUid();
  const missing = missingSections(record);
  if (missing.length) throw new Error('Please complete every section before submitting.');
  if (!EDITABLE_STATUSES.includes(record.status)) {
    throw new Error('This application has already been submitted.');
  }
  await withTimeout(
    updateDoc(doc(db, VENDORS, uid), {
      status: 'PENDING_APPROVAL' as VendorStatus,
      onboardingStep: 4,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
}

/** Approved vendors may update contact details only — never legal names or bank info. */
export async function updateApprovedContactInfo(
  business: BusinessInfo,
  changes: Pick<BusinessInfo, 'email' | 'altPhone' | 'address'>,
): Promise<void> {
  const uid = requireUid();
  const next: BusinessInfo = { ...business, ...changes };
  await withTimeout(
    updateDoc(doc(db, VENDORS, uid), {
      business: next,
      email: next.email,
      city: next.address.city,
      updatedAt: serverTimestamp(),
    }),
  );
}

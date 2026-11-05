/**
 * Business accounts (Master Admin → People & Fleet → Business accounts): travel agencies, hotels
 * and corporate booking desks. The account holds billing terms and contract rates; bookings made
 * for a business keep their own billing snapshot.
 */
import { addDoc, arrayUnion, collection, doc, onSnapshot, runTransaction, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { describeDataError } from "./adminFirestoreService";

export const BUSINESS_TYPES = ["Travel agency", "Hotel", "Corporate company"] as const;
export const BUSINESS_STATUSES = ["Active", "On hold", "Inactive"] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

export interface ContractRate {
  id: string;
  pickupZone: string;
  dropZone: string;
  service: string;
  category: string;
  contractType: "Fixed fare" | "Per km";
  priceEntered: "Including GST" | "Excluding GST";
  /** Fixed fare in ₹, or ₹ per km for a per-km contract. */
  customerRate: number;
  partnerPayout: number;
  active: boolean;
  peak: boolean;
  reason: string;
  updatedAt?: string;
}

export interface BusinessCredential {
  id: string;
  label: string;
  last4: string;
  hash: string;
  scopes: string[];
  status: "Active" | "Revoked";
  expiresAt: string;
  createdByName: string;
  createdAt?: Timestamp;
}

export interface BusinessPayment {
  id: string;
  amount: number;
  method: string;
  reference: string;
  paidOn?: string;
  byName?: string;
  at?: Timestamp;
}

export interface BusinessAccount {
  id: string;
  code: string;
  name: string;
  type: (typeof BUSINESS_TYPES)[number];
  contactName: string;
  phone: string;
  email: string;
  gstin: string;
  paymentTerms: "Prepaid" | "Credit";
  creditLimit: number;
  billedTo: "Company pays" | "Passenger pays";
  status: BusinessStatus;
  billingAddress: string;
  reason?: string;
  /** Money received from the business not yet used against bookings (prepaid) / settled amounts. */
  balance?: number;
  contractRates?: ContractRate[];
  apiAccess?: { enabled: boolean; keyHint?: string; webhookUrl?: string } | null;
  history?: { action: string; note?: string; byName?: string; at?: Timestamp }[];
  createdAt?: Timestamp;
  createdBy?: string;
}

const COL = "business_accounts";

export function subscribeBusinessAccounts(cb: (rows: BusinessAccount[]) => void, onError?: (m: string) => void) {
  return onSnapshot(
    collection(db, COL),
    (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<BusinessAccount, "id">), id: d.id }))),
    (e) => (onError ? onError(describeDataError(e)) : cb([])),
  );
}

const who = () => auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Staff";

export type BusinessInput = Omit<BusinessAccount, "id" | "code" | "createdAt" | "createdBy" | "history" | "balance" | "contractRates" | "apiAccess">;

export function validateBusiness(b: BusinessInput): string | null {
  if (b.name.trim().length < 2) return "Enter the business name.";
  if (b.contactName.trim().length < 2) return "Enter the authorised contact.";
  if (!/^[6-9]\d{9}$/.test(b.phone.replace(/\D/g, "").slice(-10))) return "Enter a valid 10-digit contact mobile.";
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email.trim())) return "Enter a valid business email.";
  if (b.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(b.gstin.trim().toUpperCase())) return "Enter a valid 15-character GSTIN or leave it blank.";
  if (b.paymentTerms === "Credit" && !(b.creditLimit > 0)) return "Enter the approved credit limit.";
  if (b.billingAddress.trim().length < 5) return "Enter the billing address.";
  if ((b.reason ?? "").trim().length < 3) return "Record the reason / approval reference.";
  return null;
}

export async function createBusiness(b: BusinessInput): Promise<string> {
  // NSM-BIZ-###### codes follow the order accounts are created in.
  const counter = doc(db, "counters", "business_accounts");
  const ref = doc(collection(db, COL));
  await runTransaction(db, async (tx) => {
    const c = await tx.get(counter);
    const next = (c.exists() ? Number(c.data().value) || 0 : 0) + 1;
    tx.set(counter, { value: next }, { merge: true });
    tx.set(ref, {
      ...b, name: b.name.trim(), gstin: b.gstin.trim().toUpperCase(), code: `NSM-BIZ-${String(next).padStart(6, "0")}`,
      balance: 0, contractRates: [], apiAccess: null, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid ?? "",
      history: [{ action: "Created", note: b.reason ?? "", byName: who(), at: Timestamp.now() }],
    });
  });
  return ref.id;
}

export async function updateBusiness(id: string, patch: Partial<BusinessInput>, note: string) {
  await updateDoc(doc(db, COL, id), { ...patch, history: arrayUnion({ action: "Updated", note, byName: who(), at: Timestamp.now() }) });
}

export async function saveContractRates(id: string, rates: ContractRate[], note: string) {
  await updateDoc(doc(db, COL, id), { contractRates: rates, history: arrayUnion({ action: "Contract rates updated", note, byName: who(), at: Timestamp.now() }) });
}

export async function setBusinessApi(id: string, api: BusinessAccount["apiAccess"], note: string) {
  await updateDoc(doc(db, COL, id), { apiAccess: api, history: arrayUnion({ action: api?.enabled ? "API access enabled" : "API access disabled", note, byName: who(), at: Timestamp.now() }) });
}

export function subscribeBusinessPayments(id: string, cb: (rows: BusinessPayment[]) => void) {
  return onSnapshot(collection(db, COL, id, "payments"), (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<BusinessPayment, "id">), id: d.id }))), () => cb([]));
}

export function subscribeCredentials(id: string, cb: (rows: BusinessCredential[]) => void) {
  return onSnapshot(collection(db, COL, id, "api_credentials"), (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<BusinessCredential, "id">), id: d.id }))), () => cb([]));
}

/** Creates a credential and returns the secret once; only its SHA-256 hash and last 4 characters are stored. */
export async function createCredential(id: string, label: string, scopes: string[], days: number): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const secret = `nsm_live_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  await addDoc(collection(db, COL, id, "api_credentials"), {
    label, last4: secret.slice(-4), hash, scopes, status: "Active", expiresAt: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10),
    createdByName: who(), createdBy: auth.currentUser?.uid ?? "", createdAt: serverTimestamp(),
  });
  return secret;
}

export async function revokeCredential(id: string, credId: string) {
  await updateDoc(doc(db, COL, id, "api_credentials", credId), { status: "Revoked", revokedByName: who(), revokedAt: serverTimestamp() });
}

/** A verified company receipt (bank / UPI) raises the account balance. A reference is credited once. */
export async function recordBusinessPayment(id: string, amount: number, method: string, reference: string, paidOn = "") {
  const cents = Math.round(amount * 100);
  const receiptReference = reference.trim();
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(cents) || Math.abs(cents / 100 - amount) > 0.000001) throw new Error("Enter a positive amount with at most two decimal places.");
  if (!['Bank Transfer', 'UPI', 'Cheque'].includes(method) || !receiptReference || receiptReference.length > 100) throw new Error("Choose a payment method and enter its reference.");
  if (!auth.currentUser) throw new Error("Sign in before recording a receipt.");
  // A stable receipt identity makes retries and concurrent submissions idempotent.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${method}|${receiptReference.toUpperCase()}`));
  const paymentId = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const receipt = doc(db, COL, id, 'payments', paymentId);
  await runTransaction(db, async (tx) => {
    const ref = doc(db, COL, id);
    const [s, prior] = await Promise.all([tx.get(ref), tx.get(receipt)]);
    if (!s.exists()) throw new Error("This business account no longer exists.");
    if (prior.exists()) {
      if (prior.data().amount !== amount) throw new Error("This reference was already recorded for a different amount.");
      return;
    }
    tx.set(receipt, { amount, method, reference: receiptReference, paidOn, byName: who(), at: serverTimestamp(), createdBy: auth.currentUser!.uid });
    tx.update(ref, { balance: Math.round(((Number(s.data()?.balance) || 0) + amount) * 100) / 100, history: arrayUnion({ action: "Payment recorded", note: `${method} ${receiptReference}`, byName: who(), at: Timestamp.now() }) });
  });
}

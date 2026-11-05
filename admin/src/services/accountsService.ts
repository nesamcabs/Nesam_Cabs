/**
 * Office accounting registers (Master Admin → Accounts): expenses and supplier bills, bank / cash
 * entries, tax payments, account openings / adjustments, partner settlements, security deposits,
 * reconciliation entries and daily closings. Each record is entered once and kept; corrections
 * are new entries. Recording an entry never moves money.
 */
import { addDoc, collection, doc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, Timestamp, updateDoc, where } from "firebase/firestore";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "./firebase";

export type RegisterKind = "expense" | "supplier_bill" | "bank" | "tax" | "opening" | "adjustment" | "settlement" | "deposit" | "recon" | "closing" | "refund_request" | "filing";

export interface RegisterEntry {
  id: string;
  kind: RegisterKind;
  date: string;
  amount: number;
  /** Expenses & bills */
  category?: string;
  payee?: string;
  reference?: string;
  taxable?: number;
  tax?: number;
  gstin?: string;
  itcStatus?: "Unreviewed" | "Eligible" | "Ineligible";
  remarks?: string;
  fileName?: string;
  filePath?: string;
  /** Bank / cash / reconciliation */
  account?: "Bank" | "Cash" | "Payment gateway";
  direction?: "Money in" | "Money out" | "Debit" | "Credit";
  description?: string;
  matchStatus?: "Unmatched" | "Matched" | "Amount mismatch";
  matchedRef?: string;
  /** Tax payments */
  taxType?: "GST" | "Income Tax / Advance Tax" | "TDS";
  period?: string;
  purpose?: "Cash ledger deposit" | "Liability discharged";
  liabilitySettled?: number;
  /** Statements: the account an opening / adjustment / settlement / deposit belongs to */
  accountType?: "customer" | "vendor" | "driver" | "business";
  accountId?: string;
  accountName?: string;
  /** Closings */
  snapshot?: { register: string; value: string; basis: string }[];
  status?: string;
  verifiedByName?: string;
  verifiedAt?: Timestamp;
  /** Refund requests */
  bookingId?: string;
  bookingCode?: string;
  createdByName?: string;
  createdBy?: string;
  createdAt?: Timestamp;
}

const COL = "accounts_register";
const who = () => ({ uid: auth.currentUser?.uid ?? "", name: auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Staff" });

const validOpeningDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
export const isVerifiedOpening = (entry: RegisterEntry) => entry.kind === 'opening' && entry.status === 'Verified'
  && !!entry.verifiedAt && !!entry.verifiedByName?.trim() && Number.isFinite(entry.amount)
  && validOpeningDate(entry.date) && (entry.reference?.trim().length ?? 0) >= 3;

async function openingEntries(accountType: string, accountId: string) {
  return getDocs(query(collection(db, COL), where('kind', '==', 'opening'), where('accountType', '==', accountType), where('accountId', '==', accountId)));
}

/** Review an existing opening without posting its balance a second time or changing its amount/date. */
export async function verifyOpeningBalance(entry: RegisterEntry): Promise<void> {
  if (!entry.accountType || !entry.accountId) throw new Error('Choose a valid account.');
  const openings = await openingEntries(entry.accountType, entry.accountId);
  if (openings.size !== 1 || openings.docs[0].id !== entry.id) throw new Error('Multiple or missing opening entries require reconciliation. No balance was changed.');
  const me = who();
  await runTransaction(db, async tx => {
    const ref = doc(db, COL, entry.id);
    const snap = await tx.get(ref);
    const current = snap.data() as RegisterEntry | undefined;
    if (!current || current.kind !== 'opening' || current.accountType !== entry.accountType || current.accountId !== entry.accountId
      || current.amount !== entry.amount || current.date !== entry.date || current.reference !== entry.reference) throw new Error('The opening entry changed. Close and reopen the statement.');
    if (!validOpeningDate(current.date) || !Number.isFinite(current.amount) || (current.reference?.trim().length ?? 0) < 3) throw new Error('This opening has incomplete reconciliation details. Ask finance to review the original record.');
    tx.update(ref, { status: 'Verified', verifiedByName: me.name, verifiedAt: serverTimestamp() });
  });
}

export function subscribeRegister(cb: (rows: RegisterEntry[]) => void, onError?: (m: string) => void) {
  return onSnapshot(collection(db, COL), (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<RegisterEntry, "id">), id: d.id }))), (e) => (onError ? onError(e.message) : cb([])));
}

export async function addRegisterEntry(e: Omit<RegisterEntry, "id" | "createdAt" | "createdBy" | "createdByName">, file?: File | null): Promise<string> {
  const me = who();
  if (e.kind === 'opening') {
    if (!e.accountType || !['customer', 'vendor', 'driver', 'business'].includes(e.accountType) || !e.accountId || e.accountId.length > 128
      || !validOpeningDate(e.date) || !Number.isFinite(e.amount) || (e.reference?.trim().length ?? 0) < 3) throw new Error('Enter a valid account, opening date, signed balance and reconciliation reference.');
    if (e.status !== 'Verified') throw new Error('Confirm the opening balance and date before saving.');
    const existing = await openingEntries(e.accountType, e.accountId);
    if (!existing.empty) throw new Error('An opening balance already exists. Review that entry instead of recording the balance again.');
    const ref = doc(db, COL, `opening_${e.accountType}_${encodeURIComponent(e.accountId)}`);
    await runTransaction(db, async tx => {
      if ((await tx.get(ref)).exists()) throw new Error('An opening balance was already recorded. Reopen the statement to review it.');
      const clean = Object.fromEntries(Object.entries(e).filter(([, value]) => value !== undefined && value !== ''));
      tx.set(ref, { ...clean, createdBy: me.uid, createdByName: me.name, createdAt: serverTimestamp(), verifiedByName: me.name, verifiedAt: serverTimestamp() });
    });
    return ref.id;
  }
  let filePath = "";
  if (file) {
    if (file.size > 750 * 1024) throw new Error("Each file must be 750 KB or smaller.");
    filePath = `accounts/${e.kind}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    await uploadBytes(storageRef(storage, filePath), file);
  }
  const clean = Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined && v !== ""));
  const r = await addDoc(collection(db, COL), { ...clean, ...(file ? { fileName: file.name, filePath } : {}), createdBy: me.uid, createdByName: me.name, createdAt: serverTimestamp() });
  return r.id;
}

/** Status-only updates (ITC review, reconciliation match, closing verification). */
export async function markRegister(id: string, patch: Pick<RegisterEntry, "itcStatus" | "matchStatus" | "matchedRef" | "status">) {
  const me = who();
  await updateDoc(doc(db, COL, id), { ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), verifiedByName: me.name, verifiedAt: serverTimestamp() });
}

/** Next NSM-CLOSE-###### reference for a daily closing. */
export async function nextClosingRef(): Promise<string> {
  const counter = doc(db, "counters", "accounts_closing");
  return runTransaction(db, async (tx) => {
    const c = await tx.get(counter);
    const n = (c.exists() ? Number(c.data().value) || 0 : 0) + 1;
    tx.set(counter, { value: n }, { merge: true });
    return `NSM-CLOSE-${String(n).padStart(6, "0")}`;
  });
}

export const EXPENSE_CATEGORIES = ["Office rent", "Internet & phone", "Staff expense", "Marketing", "Software", "Travel / operations", "Other"] as const;
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
export const tsToDate = (t?: Timestamp) => (t?.toDate ? t.toDate() : null);

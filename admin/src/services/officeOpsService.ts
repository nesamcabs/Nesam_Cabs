/**
 * Office follow-up records behind the Master Admin alerts: partner calls and their outcome, driver
 * acknowledgement follow-ups, and which staff member has taken ownership of a booking. Append-only
 * logs (office_followups) plus one ownership document per booking (booking_ownership).
 */
import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, setDoc, Timestamp, where } from "firebase/firestore";
import { auth, db } from "./firebase";

export type FollowupKind = "partner_call" | "driver_ack" | "customer_call" | "trip_issue";
export const ISSUE_TYPES = ["Driver delay", "Vehicle breakdown", "Customer unreachable", "Wrong trip status", "Other"] as const;
export const ISSUE_STATUSES = ["Open", "In progress", "Resolved"] as const;
export const CALL_OUTCOMES = ["Connected", "No answer", "Call back"] as const;
export const ACK_OUTCOMES = ["Driver confirmed", "No answer", "Call back", "Reassignment needed"] as const;

export interface Followup {
  id: string;
  kind: FollowupKind;
  bookingId: string;
  bookingCode: string;
  partnerType?: "vendor" | "driver" | "";
  partnerId?: string;
  partnerName?: string;
  outcome: string;
  note: string;
  dueAt?: Timestamp | null;
  /** Trip issues: every status change is a new record with the same issueId. */
  issueId?: string;
  createdAt?: Timestamp;
  createdBy: string;
  createdByName: string;
}

export interface Ownership {
  id: string;
  handlerUid: string;
  handlerName: string;
  reason: string;
  nextAction?: string;
  due?: Timestamp | null;
  handoverNote?: string;
  at?: Timestamp;
}

const me = () => ({ uid: auth.currentUser?.uid ?? "", name: auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Staff" });

export function subscribeFollowups(cb: (rows: Followup[]) => void) {
  return onSnapshot(collection(db, "office_followups"), (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<Followup, "id">), id: d.id }))), () => cb([]));
}

export function subscribeOwnership(cb: (rows: Map<string, Ownership>) => void) {
  return onSnapshot(collection(db, "booking_ownership"), (s) => cb(new Map(s.docs.map((d) => [d.id, { ...(d.data() as Omit<Ownership, "id">), id: d.id }]))), () => cb(new Map()));
}

export async function addFollowup(f: Omit<Followup, "id" | "createdAt" | "createdBy" | "createdByName">) {
  const who = me();
  await addDoc(collection(db, "office_followups"), { ...f, dueAt: f.dueAt ?? null, createdAt: serverTimestamp(), createdBy: who.uid, createdByName: who.name });
}

export async function takeOwnership(bookingId: string, reason: string, extra: { handler?: { uid: string; name: string }; nextAction?: string; due?: Date | null; handoverNote?: string } = {}) {
  const who = me();
  const handler = extra.handler ?? who;
  await setDoc(doc(db, "booking_ownership", bookingId), {
    handlerUid: handler.uid, handlerName: handler.name, reason, at: serverTimestamp(), assignedByUid: who.uid, assignedByName: who.name,
    nextAction: extra.nextAction ?? "", due: extra.due ? Timestamp.fromDate(extra.due) : null, handoverNote: extra.handoverNote ?? "",
  });
}

export function subscribeBookingFollowups(bookingId: string, cb: (rows: Followup[]) => void) {
  return onSnapshot(query(collection(db, "office_followups"), where("bookingId", "==", bookingId)), (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<Followup, "id">), id: d.id }))), () => cb([]));
}

/** Latest follow-up per booking and kind (logs are append-only; the newest one counts). */
export function latestFollowups(rows: Followup[], kind: FollowupKind): Map<string, Followup> {
  const out = new Map<string, Followup>();
  for (const f of rows) {
    if (f.kind !== kind) continue;
    const prev = out.get(f.bookingId);
    if (!prev || (f.createdAt?.toMillis?.() ?? Date.now()) > (prev.createdAt?.toMillis?.() ?? 0)) out.set(f.bookingId, f);
  }
  return out;
}

export const dueFrom = (local: string) => (local ? Timestamp.fromDate(new Date(local)) : null);

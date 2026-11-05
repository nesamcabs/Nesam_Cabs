/**
 * Customer privacy & access (Master Admin header → Privacy). Staff reveals of protected customer
 * contacts are logged by the server (contact_access_logs); requests for a one-time reveal, the
 * per-staff privacy controls and the office policy live here. Enforcement stays on the server —
 * these records configure and evidence it.
 */
import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, limit } from "firebase/firestore";
import { auth, db } from "./firebase";

export const REQUEST_STATUSES = ["Pending", "Approved", "Used", "Denied", "Expired", "Revoked"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface PrivacyRequest {
  id: string;
  staffUid: string;
  staffName: string;
  bookingId: string;
  bookingCode: string;
  customerId?: string;
  field: string;
  purpose: string;
  status: RequestStatus;
  decidedByName?: string;
  decidedAt?: Timestamp;
  expiresAt?: Timestamp;
  createdAt?: Timestamp;
}

export interface AccessLog {
  id: string;
  bookingId: string;
  actorId: string;
  role: string;
  action: "reveal" | "denied";
  reason: string;
  platform?: string;
  at?: Timestamp;
}

export interface StaffPrivacy {
  uid: string;
  handledReveal: "Approval required" | "Allowed" | "Blocked";
  requestAccess: "Allowed" | "Blocked";
  copyControl: "Copy button hidden" | "Copy allowed";
  sessionsRevokedAt?: Timestamp | null;
}

export interface PrivacyPolicy {
  revealSeconds: number;
  activationMinutes: number;
  anomalyCount: number;
  anomalyWindow: number;
  idleMinutes: number;
  updatedByName?: string;
  updatedAt?: Timestamp;
  reason?: string;
}

export const DEFAULT_POLICY: PrivacyPolicy = { revealSeconds: 60, activationMinutes: 10, anomalyCount: 5, anomalyWindow: 120, idleMinutes: 15 };
export const DEFAULT_STAFF: Omit<StaffPrivacy, "uid"> = { handledReveal: "Approval required", requestAccess: "Allowed", copyControl: "Copy button hidden" };

const who = () => auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Staff";

export const subscribeRequests = (cb: (r: PrivacyRequest[]) => void) =>
  onSnapshot(collection(db, "privacy_requests"), (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<PrivacyRequest, "id">), id: d.id }))), () => cb([]));

export const subscribeAccessLog = (cb: (r: AccessLog[]) => void) =>
  onSnapshot(query(collection(db, "contact_access_logs"), orderBy("at", "desc"), limit(500)), (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<AccessLog, "id">), id: d.id }))), () => cb([]));

export const subscribeStaffPrivacy = (cb: (r: Map<string, StaffPrivacy>) => void) =>
  onSnapshot(collection(db, "privacy_staff"), (s) => cb(new Map(s.docs.map((d) => [d.id, { ...DEFAULT_STAFF, ...(d.data() as Partial<StaffPrivacy>), uid: d.id }]))), () => cb(new Map()));

export const subscribePolicy = (cb: (p: PrivacyPolicy) => void) =>
  onSnapshot(doc(db, "settings", "privacy"), (s) => cb({ ...DEFAULT_POLICY, ...(s.data() as Partial<PrivacyPolicy> | undefined) }), () => cb(DEFAULT_POLICY));

export async function requestReveal(r: { bookingId: string; bookingCode: string; customerId?: string; field: string; purpose: string }) {
  await addDoc(collection(db, "privacy_requests"), { ...r, staffUid: auth.currentUser?.uid ?? "", staffName: who(), status: "Pending", createdAt: serverTimestamp() });
}

export async function decideRequest(id: string, status: "Approved" | "Denied" | "Revoked", activationMinutes: number) {
  await updateDoc(doc(db, "privacy_requests", id), {
    status, decidedByName: who(), decidedAt: serverTimestamp(),
    ...(status === "Approved" ? { expiresAt: Timestamp.fromMillis(Date.now() + activationMinutes * 60000) } : {}),
  });
}

export async function saveStaffPrivacy(uid: string, v: Omit<StaffPrivacy, "uid">) {
  await setDoc(doc(db, "privacy_staff", uid), { ...v, updatedByName: who(), updatedAt: serverTimestamp() }, { merge: true });
}

export async function revokeSessions(uid: string) {
  await setDoc(doc(db, "privacy_staff", uid), { sessionsRevokedAt: serverTimestamp(), updatedByName: who() }, { merge: true });
}

export async function savePolicy(p: PrivacyPolicy, reason: string) {
  await setDoc(doc(db, "settings", "privacy"), { ...p, reason, updatedByName: who(), updatedAt: serverTimestamp() });
}

/** Staff who revealed contacts of many distinct bookings inside the detection window. */
export function riskAlerts(logs: AccessLog[], p: PrivacyPolicy): { actorId: string; at: Date; count: number }[] {
  const by = new Map<string, AccessLog[]>();
  for (const l of logs) if (l.action === "reveal" && l.at) by.set(l.actorId, [...(by.get(l.actorId) ?? []), l]);
  const out: { actorId: string; at: Date; count: number }[] = [];
  for (const [actorId, rows] of by) {
    const sorted = rows.sort((a, b) => a.at!.toMillis() - b.at!.toMillis());
    for (let i = 0; i < sorted.length; i++) {
      const start = sorted[i].at!.toMillis();
      const inWindow = new Set(sorted.filter((r) => r.at!.toMillis() >= start && r.at!.toMillis() <= start + p.anomalyWindow * 1000).map((r) => r.bookingId));
      if (inWindow.size >= p.anomalyCount) {
        out.push({ actorId, at: new Date(start), count: inWindow.size });
        break;
      }
    }
  }
  return out;
}

/**
 * Staff activity: one staff_sessions record per signed-in browser tab (heartbeat while open,
 * explicit logout, expired after inactivity) and the append-only staff_activity log of page
 * views, logins and logouts. A session the Master revokes signs this tab out.
 */
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, db } from "./firebase";
import { callFunction } from "./callables";

const KEY = "nesam.staffSession";
const HEARTBEAT_MS = 2 * 60_000;
/** A session with no heartbeat for this long is shown as Expired. */
export const EXPIRE_MS = 30 * 60_000;

const deviceOf = () => {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows desktop" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "Mac desktop" : /Linux/.test(ua) ? "Linux desktop" : "Other device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return { device: os, browser };
};
const me = () => ({ uid: auth.currentUser?.uid ?? "", name: auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Staff", email: auth.currentUser?.email ?? "" });

export function logActivity(action: string, module: string, record = "", details = "") {
  const u = me();
  if (!u.uid) return;
  addDoc(collection(db, "staff_activity"), { ...u, action, module, record, details: details.slice(0, 300), sessionId: sessionStorage.getItem(KEY) ?? "", at: serverTimestamp() }).catch(() => undefined);
}

/** Starts (or resumes) this tab's session; returns a stop function. */
export function startStaffSession(staffCode: string): () => void {
  const u = me();
  if (!u.uid) return () => undefined;
  let id = sessionStorage.getItem(KEY);
  const fresh = !id || !id.startsWith(u.uid);
  if (fresh) {
    id = `${u.uid}_${Date.now().toString(36)}`;
    sessionStorage.setItem(KEY, id);
    setDoc(doc(db, "staff_sessions", id), { ...u, staffCode, ...deviceOf(), status: "Online", startedAt: serverTimestamp(), lastActiveAt: serverTimestamp() })
      .then(() => logActivity("Login", "Staff activity", id!))
      .catch(() => undefined);
  }
  const ref = doc(db, "staff_sessions", id!);
  const beat = () => updateDoc(ref, { lastActiveAt: serverTimestamp() }).catch(() => undefined);
  if (!fresh) beat();
  const timer = window.setInterval(beat, HEARTBEAT_MS);
  const unsub = onSnapshot(ref, (s) => {
    if (s.data()?.status === "Revoked") {
      sessionStorage.removeItem(KEY);
      signOut(auth).catch(() => undefined);
    }
  }, () => undefined);
  return () => { window.clearInterval(timer); unsub(); };
}

/** Explicit logout: records the logout time, then signs out. */
export async function endStaffSession(): Promise<void> {
  const id = sessionStorage.getItem(KEY);
  if (id) {
    logActivity("Logout", "Staff activity", id);
    await updateDoc(doc(db, "staff_sessions", id), { status: "Logged out", endedAt: serverTimestamp() }).catch(() => undefined);
    sessionStorage.removeItem(KEY);
  }
  await signOut(auth);
}

export const revokeStaffSessions = (uid: string, sessionId?: string) => callFunction<unknown, { ended: number }>("revokeStaffSessions", { uid, sessionId });

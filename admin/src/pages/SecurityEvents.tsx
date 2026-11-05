import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { describeDataError } from "../services/adminFirestoreService";
import { ErrorBanner, Toast, useToast } from "../components/Feedback";
import { inputCls, secondaryBtn } from "../components/FormKit";
import { useCan } from "../components/AccessContext";
import { formatDateTime12, toDate } from "../utils/time";

interface EventRow {
  id: string; type: string; severity: "low" | "medium" | "high"; userId: string; role: string; bookingId?: string; platform?: string;
  source?: string; details?: Record<string, unknown>; resolved?: boolean; at?: unknown; resolutionNote?: string;
}
interface AuditRow {
  id: string; action: string; entity: string; entityId: string; performedBy: string; performedByName?: string; role: string; reason?: string;
  previous?: unknown; next?: unknown; bookingId?: string; at?: unknown;
}

const LABEL: Record<string, string> = {
  developer_options_enabled: "Developer options on", usb_debugging_enabled: "USB debugging on", root_detected: "Rooted / compromised device", emulator_detected: "Emulator detected",
  app_tampered: "App modified or tampered", debuggable_build: "Debuggable build", mock_location_detected: "Mock location", gallery_capture_attempt: "Gallery photo attempt",
  integrity_failed: "Device integrity failed", integrity_nonce_invalid: "Invalid integrity check", invalid_capture_session: "Invalid photo capture", reused_vehicle_photo: "Reused vehicle photo",
  otp_attempts_exceeded: "Too many wrong codes", otp_rate_limited: "Code requests rate-limited", trip_state_violation: "Trip steps out of order", screen_capture_detected: "Screen capture",
};
const SEV: Record<string, string> = { high: "bg-red-50 text-red-800 border-red-300", medium: "bg-amber-50 text-amber-900 border-amber-300", low: "bg-gray-100 text-gray-800 border-gray-300" };

/** Security events (suspicious device / photo / code activity) and the audit trail of important actions. */
export default function SecurityEvents({ onOpenBooking }: { onOpenBooking?: (id: string) => void }) {
  const [tab, setTab] = useState<"security" | "audit">("security");
  const canAudit = useCan("reports") || useCan("compliance") || useCan("system");
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Security & Audit</h1>
        <p className="text-sm text-muted">Reports from devices are signals for review, not proof. The server’s own checks and every important action are recorded here.</p>
      </div>
      <div role="tablist" className="flex gap-1 border-b border-line-strong">
        {([["security", "Security events"], ["audit", "Audit log"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${tab === k ? "border-brand text-brand" : "border-transparent text-muted"}`}>{l}</button>
        ))}
      </div>
      {tab === "security" ? <Events onOpenBooking={onOpenBooking} /> : canAudit ? <Audit onOpenBooking={onOpenBooking} /> : <p className="text-sm text-muted">The audit log needs reports, compliance or system access.</p>}
    </div>
  );
}

function useFeed<T>(path: string, order: string, max: number) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setRows(null);
    setError(null);
    return onSnapshot(query(collection(db, path), orderBy(order, "desc"), limit(max)), (s) => setRows(s.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T)), (e) => { setError(describeDataError(e)); setRows([]); });
  }, [path, order, max, retry]);
  return { rows, error, retry: () => setRetry((n) => n + 1) };
}

function Events({ onOpenBooking }: { onOpenBooking?: (id: string) => void }) {
  const { rows, error, retry } = useFeed<EventRow>("security_events", "at", 300);
  const [sev, setSev] = useState("");
  const [open, setOpen] = useState<"open" | "resolved" | "all">("open");
  const [q, setQ] = useState("");
  const { toast, show } = useToast();
  const canResolve = useCan("system");
  const shown = useMemo(() => (rows ?? []).filter((r) => (!sev || r.severity === sev) && (open === "all" || (open === "resolved") === !!r.resolved) && (!q.trim() || `${r.type} ${LABEL[r.type] ?? ""} ${r.userId} ${r.bookingId ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [rows, sev, open, q]);
  const resolve = async (r: EventRow) => {
    try {
      await updateDoc(doc(db, "security_events", r.id), { resolved: true, resolvedBy: auth.currentUser?.uid ?? "", resolvedAt: serverTimestamp(), resolutionNote: "Reviewed" });
      show("Marked as reviewed.");
    } catch (e) {
      show(describeDataError(e), "error");
    }
  };
  return (
    <div className="space-y-3">
      <Toast toast={toast} />
      {error && <ErrorBanner message={error} onRetry={retry} />}
      <div className="flex flex-wrap gap-2 bg-white rounded-xl border border-line p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search type, user or booking…" aria-label="Search" className={`${inputCls} !w-auto min-w-[14rem]`} />
        <select value={sev} onChange={(e) => setSev(e.target.value)} aria-label="Severity" className={`${inputCls} !w-auto`}><option value="">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        <select value={open} onChange={(e) => setOpen(e.target.value as typeof open)} aria-label="State" className={`${inputCls} !w-auto`}><option value="open">Needs review</option><option value="resolved">Reviewed</option><option value="all">All</option></select>
      </div>
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {rows === null && !error && <div className="py-12 text-center text-sm text-muted" role="status">Loading security events…</div>}
        {rows !== null && shown.length === 0 && <div className="py-12 text-center text-sm text-muted">{rows.length === 0 ? "No security events recorded." : "Nothing matches these filters."}</div>}
        <ul className="divide-y divide-line-soft">
          {shown.map((r) => (
            <li key={r.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded border uppercase ${SEV[r.severity]}`}>{r.severity}</span>
                  <span className="text-sm font-bold text-ink">{LABEL[r.type] ?? r.type.replace(/_/g, " ")}</span>
                  {r.resolved && <span className="text-xs font-semibold text-green-700">✓ reviewed</span>}
                </div>
                <div className="text-xs text-muted">{r.role} {r.userId.slice(0, 10)} · {r.source === "server" ? "detected by the server" : "reported by the device"}{r.platform ? ` · ${r.platform}` : ""} · {formatDateTime12(toDate(r.at as never))}</div>
                {r.details && Object.keys(r.details).length > 0 && <div className="text-xs text-body">{Object.entries(r.details).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join(" · ")}</div>}
                {r.bookingId && onOpenBooking && <button onClick={() => onOpenBooking(r.bookingId!)} className="text-xs font-semibold text-brand hover:underline">Open booking</button>}
              </div>
              {canResolve && !r.resolved && <button onClick={() => resolve(r)} className={secondaryBtn}>Mark reviewed</button>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Audit({ onOpenBooking }: { onOpenBooking?: (id: string) => void }) {
  const { rows, error, retry } = useFeed<AuditRow>("audit_logs", "at", 300);
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("");
  const entities = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.entity))).sort(), [rows]);
  const shown = useMemo(() => (rows ?? []).filter((r) => (!entity || r.entity === entity) && (!q.trim() || `${r.action} ${r.performedByName ?? ""} ${r.entityId} ${r.bookingId ?? ""} ${r.reason ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, entity]);
  const brief = (v: unknown) => (v == null ? "" : JSON.stringify(v).slice(0, 160));
  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} onRetry={retry} />}
      <div className="flex flex-wrap gap-2 bg-white rounded-xl border border-line p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search action, person, booking or reason…" aria-label="Search audit log" className={`${inputCls} !w-auto min-w-[16rem]`} />
        <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Entity" className={`${inputCls} !w-auto`}><option value="">All records</option>{entities.map((e) => <option key={e}>{e}</option>)}</select>
      </div>
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {rows === null && !error && <div className="py-12 text-center text-sm text-muted" role="status">Loading audit log…</div>}
        {rows !== null && shown.length === 0 && <div className="py-12 text-center text-sm text-muted">{rows.length === 0 ? "No actions recorded yet." : "Nothing matches these filters."}</div>}
        <ul className="divide-y divide-line-soft">
          {shown.map((r) => (
            <li key={r.id} className="p-3 space-y-0.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-ink">{r.action.replace(/_/g, " ")} <span className="font-normal text-muted">· {r.entity}</span></span>
                <span className="text-xs text-muted">{formatDateTime12(toDate(r.at as never))}</span>
              </div>
              <div className="text-xs text-body">By {r.performedByName || r.performedBy.slice(0, 10)} ({r.role}){r.bookingId && onOpenBooking ? <> · <button onClick={() => onOpenBooking(r.bookingId!)} className="font-semibold text-brand hover:underline">booking</button></> : null}</div>
              {(r.previous != null || r.next != null) && <div className="text-xs text-muted break-words">{brief(r.previous)}{r.previous != null && r.next != null ? " → " : ""}{brief(r.next)}</div>}
              {r.reason && <div className="text-xs text-body">Reason: {r.reason}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

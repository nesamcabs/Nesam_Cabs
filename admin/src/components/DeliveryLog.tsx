import { useEffect, useMemo, useState } from "react";
import { limit, orderBy, query, collection, onSnapshot } from "firebase/firestore";
import { db } from "../services/firebase";
import { describeDataError } from "../services/adminFirestoreService";
import { formatDateTime12, toDate } from "../utils/time";
import { ErrorBanner } from "./Feedback";
import { inputCls } from "./FormKit";

interface Row {
  id: string;
  recipientId?: string;
  recipientType?: string;
  category?: string;
  title?: string;
  message?: string;
  channel?: string;
  status?: string;
  provider?: string;
  error?: string;
  bookingId?: string;
  sentAt?: unknown;
}

const STATUS_CLS: Record<string, string> = {
  sent: "bg-blue-50 text-blue-900 border-blue-300",
  delivered: "bg-green-50 text-green-900 border-green-300",
  read: "bg-green-50 text-green-900 border-green-300",
  failed: "bg-red-50 text-red-900 border-red-300",
  not_configured: "bg-amber-50 text-amber-900 border-amber-300",
  skipped: "bg-gray-100 text-gray-800 border-gray-300",
  queued: "bg-gray-100 text-gray-800 border-gray-300",
};

/** The last 300 delivery attempts: who, which channel, what status, which booking. */
export default function DeliveryLog({ bookingId }: { bookingId?: string } = {}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    setRows(null);
    setError(null);
    return onSnapshot(
      query(collection(db, "notification_deliveries"), orderBy("sentAt", "desc"), limit(300)),
      (snap) => setRows(snap.docs.map((d) => ({ ...(d.data() as Row), id: d.id }))),
      (e) => { setError(describeDataError(e)); setRows([]); },
    );
  }, [retry]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!bookingId || r.bookingId === bookingId) && (!channel || r.channel === channel) && (!status || r.status === status) && (!needle || [r.title, r.message, r.recipientId, r.bookingId, r.error].some((v) => String(v ?? "").toLowerCase().includes(needle))));
  }, [rows, channel, status, q, bookingId]);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={() => setRetry((n) => n + 1)} />}
      <div className="flex flex-wrap gap-2 bg-white rounded-xl border border-line p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, booking, recipient…" aria-label="Search delivery log" className={`${inputCls} !w-auto min-w-[16rem]`} />
        <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel" className={`${inputCls} !w-auto`}>
          <option value="">All channels</option>
          {["in_app", "push", "whatsapp", "sms", "email"].map((c) => <option key={c} value={c}>{c.replace("_", "-")}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className={`${inputCls} !w-auto`}>
          <option value="">All statuses</option>
          {["sent", "delivered", "read", "failed", "not_configured", "skipped"].map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
        </select>
      </div>
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {rows === null && !error && <div className="py-12 text-center text-sm text-muted" role="status">Loading delivery log…</div>}
        {rows !== null && shown.length === 0 && <div className="py-12 text-center text-sm text-muted">{rows.length === 0 ? "No deliveries recorded yet." : "Nothing matches these filters."}</div>}
        {shown.length > 0 && (
          <ul className="divide-y divide-line-soft">
            {shown.map((r) => (
              <li key={r.id} className="p-3 grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-2 md:gap-4 items-start">
                <div className="flex md:flex-col gap-1.5 items-start">
                  <span className="text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-gray-100 text-body">{(r.channel ?? "").replace("_", "-")}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${STATUS_CLS[r.status ?? ""] ?? STATUS_CLS.queued}`}>{(r.status ?? "").replace("_", " ")}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">{r.title}</div>
                  <div className="text-sm text-body line-clamp-2">{r.message}</div>
                  <div className="text-xs text-muted mt-0.5">To {r.recipientType} {r.recipientId ? `· ${r.recipientId.slice(0, 10)}` : ""}{r.bookingId ? ` · booking ${r.bookingId.slice(0, 10)}` : ""}{r.category ? ` · ${r.category}` : ""}{r.provider ? ` · ${r.provider}` : ""}</div>
                  {r.error && <div className="text-xs font-semibold text-red-700 mt-0.5">{r.error}</div>}
                </div>
                <div className="text-xs text-muted md:text-right whitespace-nowrap">{formatDateTime12(toDate(r.sentAt as never))}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

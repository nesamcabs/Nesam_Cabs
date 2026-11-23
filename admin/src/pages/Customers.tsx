import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Customer, MasterCoupon } from "../types";
import "../styles/customersDirectory.css";
import Icon from "../components/ui/Icon";
import { ExportDialog, type ExportSpec } from "../components/ui/RecordKit";
import { csv, type ExportFormat } from "../utils/exportData";
import { useAccess, useCan, useCanDo } from "../components/AccessContext";
import { CdToast } from "../components/customers/Layer";
import { AuditLedger, BTN_PRIMARY, CARD, KpiCards } from "../components/customers/Parts";
import { CustomerTable, customerCodeOf, emailOf } from "../components/customers/CustomerTable";
import { CustomerDrawer } from "../components/customers/Drawer";
import { CustomerFormDialog, MarkPaidDialog, RevealDialog } from "../components/customers/Dialogs";
import { useBookingsWithoutContacts } from "../hooks/useOfficeData";
import { useCustomerDirectory } from "../hooks/useCustomerDirectory";
import { subscribeCoupons, subscribeVehicleCategories } from "../services/adminFirestoreService";
import { auth } from "../services/firebase";
import { buildCustomerLedger, EMPTY_STATS } from "../services/customerStats";
import {
  copyText, exportCustomerNumbers, findCustomersByMobile, revealCustomerNumber, saveCustomerProfile,
} from "../services/customerDirectoryService";
import {
  BRANDS, brandLabel, checkOfferCoupon, computeKpis, countSegments, filterRows, groupOf, inr, isBlockedStatus,
  loyaltyMessage, offerFor, parseIndianMobile, reminderMessage, SEGMENTS, statementText, statusLabel, STATUS_ACTIVE, STATUS_BLOCKED, type Row, type Segment,
} from "../domain/customerDirectory";
import { paymentOf } from "../domain/bookingFlow";
import { refDateTime } from "../domain/officeStage";

export { customerCodeOf, emailOf };
/** Earlier name of customerCodeOf, still imported by Communication › Messages. */
export const customerCode = customerCodeOf;

const PAGE = 10;

export interface BookCustomerDraft { id: string; name: string; email: string; phoneMasked: string; preferredCab: string; preferredDriver: string }

export default function Customers({ onNavigate, onBookCustomer }: {
  onNavigate?: (page: string, tab?: string) => void;
  /** Opens the real new-booking flow with this customer selected (absent when the signed-in user cannot create bookings). */
  onBookCustomer?: (c: BookCustomerDraft) => void;
}) {
  const access = useAccess();
  const canSettle = useCan("finance") && useCanDo("Accounts", "create");
  const uid = auth.currentUser?.uid ?? "";
  const email = auth.currentUser?.email ?? "";
  // Everything tied to who is signed in and what they may do: a change throws away reveals, selections and open dialogs.
  const scope = useMemo(() => `${uid}|${JSON.stringify([access.permissions, access.matrix, access.duty, access.accessVersion ?? 0])}`, [uid, access]);

  const dir = useCustomerDirectory(scope);
  const bookingsQ = useBookingsWithoutContacts();
  const viewer = dir.viewer;
  const [preview, setPreview] = useState<"master" | "staff">("master");
  const staffPreview = !!viewer?.isSuper && preview === "staff";
  const canExport = !!viewer?.canExport && !staffPreview;
  const canReveal = !!viewer?.canReveal;
  const canEdit = !!viewer?.canEdit;
  const canCreate = !!viewer?.canCreate;

  const customers = dir.customers;
  const bookings = bookingsQ.rows;
  const ledger = useMemo(() => buildCustomerLedger(customers ?? [], bookings ?? []), [customers, bookings]);
  const rows: Row[] = useMemo(() => (customers ?? []).map((c) => ({ c, s: ledger.stats.get(c.id) ?? EMPTY_STATS })), [customers, ledger]);
  const rowOf = useCallback((id: string) => rows.find((r) => r.c.id === id), [rows]);

  const [coupons, setCoupons] = useState<MasterCoupon[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => {
    const a = subscribeCoupons(setCoupons, () => setCoupons(null));
    const b = subscribeVehicleCategories((v) => setCategories(v.map((x) => x.name)));
    return () => { a(); b(); };
  }, []);

  // ── filters ──
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState<Segment>("All");
  const [brand, setBrand] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lookedUp, setLookedUp] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<{ id: string; name: string; reason: string }[]>([]);
  const [busyBulk, setBusyBulk] = useState(false);

  useEffect(() => {
    // Only a complete number in a supported spelling (+91, 0, spaces, dashes…) is looked up; extra digits never match.
    const d = parseIndianMobile(q);
    if (!d) { setLookedUp(new Set()); return; }
    let live = true;
    const t = window.setTimeout(() => { findCustomersByMobile(d).then((r) => live && setLookedUp(new Set(r.ids))).catch(() => live && setLookedUp(new Set())); }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [q]);

  const counts = useMemo(() => countSegments(rows), [rows]);
  const kpis = useMemo(() => computeKpis(rows), [rows]);
  const extraBrands = useMemo(() => [...new Set(rows.flatMap((r) => r.c.brands ?? []))].filter((b) => !BRANDS.some((x) => x.id === b)), [rows]);
  const filtered = useMemo(() => filterRows(rows, { q, segment, brand, lookedUp }), [rows, q, segment, brand, lookedUp]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = filtered.slice((cur - 1) * PAGE, cur * PAGE);
  const filtersOn = q.trim() !== "" || segment !== "All" || brand !== "all";
  const pageAllSelected = shown.length > 0 && shown.every((r) => selected.has(r.c.id));

  // ── toast ──
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const say = useCallback((message: string, tone: "success" | "error" = "success") => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // ── number reveal (one state for the row and the drawer) ──
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const timers = useRef(new Map<string, number>());
  const clearReveals = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current.clear();
    setRevealed({});
  }, []);
  useEffect(() => { clearReveals(); setSelected(new Set()); setFailed([]); setRevealFor(null); setEditing(null); setViewingId(null); setPaying(null); setExporting(null); }, [scope, clearReveals]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (preview === "staff") clearReveals(); }, [preview, clearReveals]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const [revealFor, setRevealFor] = useState<Customer | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const actor = access.isSuper && !staffPreview ? `Master Admin (${email})` : `${viewer?.name || "Staff"} (${access.staffCode ? `@${access.staffCode}` : email})`;

  const doReveal = async (category: string, note: string) => {
    const target = revealFor!;
    const r = await revealCustomerNumber(target.id, category, note);
    setRevealed((m) => ({ ...m, [target.id]: r.phone }));
    window.clearTimeout(timers.current.get(target.id));
    timers.current.set(target.id, window.setTimeout(() => { setRevealed((m) => { const n = { ...m }; delete n[target.id]; return n; }); timers.current.delete(target.id); }, r.revealSeconds * 1000));
    setRevealFor(null);
    say(`Number revealed & logged under ${actor}. It is hidden again after ${r.revealSeconds} seconds.`);
    void dir.refresh("views");
  };

  // ── actions ──
  /** "Copied" is reported only after the browser accepted the text; the message is never described as sent. */
  const copy = async (text: string, ok: string) => { const done = await copyText(text); say(done ? ok : "Could not copy to the clipboard. Allow clipboard access and try again.", done ? "success" : "error"); };

  const remind = (r: Row) => copy(reminderMessage(r.c.name || "Customer", r.s.outstanding), `WhatsApp payment reminder copied for ${r.c.name} (${inr(r.s.outstanding)}). It has not been sent.`);
  const copyStatement = (r: Row) => copy(statementText(r, customerCodeOf(r.c)), "Customer trip statement copied!");
  const sendCoupon = (r: Row) => { const o = offerFor(r); return copy(loyaltyMessage(r.c.name || "Customer", o), `Copied ${o.code} (${inr(o.amount)} OFF) WhatsApp message for ${r.c.name}. It has not been sent.`); };
  const statement = (r: Row) => onNavigate?.("accounts", `Statements:customer:${r.c.id}`);
  const book = (r: Row) => {
    if (!onBookCustomer) return;
    setViewingId(null);
    onBookCustomer({ id: r.c.id, name: r.c.name, email: emailOf(r.c), phoneMasked: r.c.phoneMasked ?? "", preferredCab: r.c.preferredCab ?? "", preferredDriver: r.c.preferredDriver ?? "" });
  };
  const toggleBlock = async (r: Row) => {
    const next = isBlockedStatus(r.c.status) ? STATUS_ACTIVE : STATUS_BLOCKED;
    try {
      await saveCustomerProfile({ customerId: r.c.id, status: next });
      say(`${r.c.name} is now ${next.toLowerCase()}.`);
      void dir.refresh();
    } catch (e) { say((e as Error).message || `Could not change ${r.c.name}'s status.`, "error"); }
  };
  const savePrefs = async (r: Row, p: { preferredCab: string; preferredDriver: string; notes: string }) => {
    try {
      await saveCustomerProfile({ customerId: r.c.id, ...p });
      say(`Saved preferences & note for ${r.c.name}`);
      await dir.refresh();
    } catch (e) { say((e as Error).message || "The preferences were not saved.", "error"); throw e; }
  };

  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = (on: boolean) => setSelected((s) => { const n = new Set(s); shown.forEach((r) => (on ? n.add(r.c.id) : n.delete(r.c.id))); return n; });
  const clearFilters = () => { setQ(""); setSegment("All"); setBrand("all"); setPage(1); setSelected(new Set()); setFailed([]); };

  // Mark as VIP: only the designation changes, so GST details and corporate membership are untouched. Failures stay selected for a retry.
  const markVip = async () => {
    if (busyBulk) return;
    setBusyBulk(true);
    const ids = [...selected];
    const bad: typeof failed = [];
    let ok = 0;
    for (const id of ids) {
      const r = rowOf(id);
      try { await saveCustomerProfile({ customerId: id, isVip: true }); ok++; setSelected((s) => { const n = new Set(s); n.delete(id); return n; }); }
      catch (e) { bad.push({ id, name: r?.c.name ?? id, reason: (e as Error).message }); }
    }
    setFailed(bad);
    setBusyBulk(false);
    if (ok) void dir.refresh();
    say(bad.length ? `${ok} marked VIP; ${bad.length} failed and stay selected for a retry.` : "Selected customers upgraded to VIP!", bad.length ? "error" : "success");
  };

  /** Opens the one authorised, logged export sheet; "Export Selected CSV" opens it on the selection as a CSV download. */
  const openExport = (format: ExportFormat) => { setWithNumbers(false); setExportReason(""); setExporting(format); };

  // ── Export Data (the existing dialog: all / filtered / selected, Excel / CSV / print) ──
  const numbers = useRef<Record<string, string>>({});
  const [withNumbers, setWithNumbers] = useState(false);
  const [exportReason, setExportReason] = useState("");
  const mobileOf = (c: Customer) => numbers.current[c.id] ?? c.phoneMasked ?? "";
  const spec: ExportSpec<Row> = {
    scope: "Customers",
    headers: ["Customer ID", "Name", "Mobile", "Email", "City", "Customer group", "Completed trips", "Last trip", "Status"],
    row: ({ c, s }) => [customerCodeOf(c), c.name, mobileOf(c), emailOf(c), c.city ?? "", groupOf(s.completed), s.completed, refDateTime(s.lastCompletedAt), statusLabel(c.status)],
  };
  const authorizeExport = async (list: Row[]): Promise<string | null> => {
    numbers.current = {};
    if (withNumbers && exportReason.trim().length < 10) return "Enter a reason of at least 10 characters to export full numbers.";
    try {
      const r = await exportCustomerNumbers(list.map((x) => x.c.id), withNumbers, exportReason.trim());
      numbers.current = r.numbers;
      return null;
    } catch (e) { return (e as Error).message || "The export was not authorised."; }
  };

  const viewing = viewingId ? rowOf(viewingId) : undefined;
  useEffect(() => { if (viewingId && customers && !rowOf(viewingId)) setViewingId(null); }, [customers, viewingId, rowOf]);
  const payRow = paying ? rowOf(paying) : undefined;

  const loading = customers === null && !dir.error;
  const bigError = dir.error && customers === null;

  return (
    <div className="cd-root @container space-y-6">
      <header className="flex flex-col @min-[880px]:flex-row @min-[880px]:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-xl leading-7 font-bold text-slate-900">Customers Directory</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] leading-4 font-semibold bg-crimson-50 text-crimson-800 border border-crimson-200/70">CRM &amp; Privacy Guard</span>
          </div>
          <p className="text-xs leading-4 text-slate-500 mt-1">Manage individual, VIP, and corporate accounts • Number reveals require a logged reason • Export restricted to Master Admin.</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {viewer?.isSuper ? (
            <div role="group" aria-label="Preview as" className="inline-flex items-center p-1 rounded-[12px] bg-white border border-slate-200 shadow-xs text-[11px] leading-4">
              <button type="button" aria-pressed={preview === "master"} onClick={() => setPreview("master")} className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-all ${preview === "master" ? "font-bold bg-crimson-800 text-white" : "font-medium text-slate-600 hover:text-slate-900"}`}><Icon name="shield-check" size={12} /><span>Master Admin</span></button>
              <button type="button" aria-pressed={preview === "staff"} onClick={() => setPreview("staff")} title="Preview only: hides what a Staff ID cannot do. Your own permissions still apply." className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-all ${preview === "staff" ? "font-bold bg-crimson-800 text-white" : "font-medium text-slate-600 hover:text-slate-900"}`}><Icon name="user" size={12} /><span>Staff View preview</span></button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-2 rounded-[12px] bg-white border border-slate-200 text-[11px] leading-4 font-semibold text-slate-700 shadow-xs"><Icon name="user" size={12} />{access.roleName || "Staff"}{access.staffCode ? ` (@${access.staffCode})` : ""}</span>
          )}
          {canExport && <button type="button" onClick={() => openExport("xlsx")} className="h-10 px-3.5 rounded-[12px] bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"><Icon name="download" size={14} className="text-slate-500" /><span>Export Data</span></button>}
          {canCreate && <button type="button" onClick={() => setEditing("new")} className={`h-10 px-4 rounded-[12px] text-xs flex items-center gap-2 shadow-sm active:scale-[0.99] transition-all ${BTN_PRIMARY}`}><Icon name="user-plus" size={16} /><span>+ Add Customer</span></button>}
        </div>
      </header>
      {staffPreview && <p role="status" className="text-[11px] leading-4 px-3 py-2 rounded-[12px] bg-amber-50 border border-amber-200 text-amber-900">Staff View preview: this only hides Master-only controls on screen. The server still applies your own Master permissions.</p>}
      {dir.error && customers !== null && <p role="alert" className="text-xs px-3 py-2 rounded-[12px] bg-red-50 border border-red-200 text-red-700">The list could not be refreshed ({dir.error}). Showing the last loaded data. <button type="button" className="font-semibold underline" onClick={() => void dir.refresh()}>Retry</button></p>}
      {dir.truncated && <p role="status" className="text-[11px] px-3 py-2 rounded-[12px] bg-slate-100 text-slate-600">Booking history covers the most recent 1,000 bookings for customers matched by mobile number.</p>}

      <KpiCards k={kpis} views={dir.views} viewsError={dir.viewsError} loading={customers === null} />

      <section className={`${CARD} overflow-hidden`} aria-label="Customers">
        <div className="p-4 border-b border-slate-100 flex flex-col @min-[1100px]:flex-row @min-[1100px]:items-center justify-between gap-3">
          <div role="group" aria-label="Segment" className="flex items-center gap-1.5 flex-wrap">
            {SEGMENTS.map((t) => (
              <button key={t.id} type="button" aria-pressed={segment === t.id} onClick={() => { setSegment(t.id); setPage(1); }}
                className={`px-3 py-1.5 rounded-[12px] text-xs leading-4 ${segment === t.id ? "font-bold bg-slate-900 text-white" : "font-medium bg-slate-100 text-slate-600 hover:bg-slate-200/70"}`}>{t.label} ({counts[t.id]})</button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap @min-[640px]:flex-nowrap">
            <div className="relative w-full @min-[640px]:w-72">
              <Icon name="search" size={14} className="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input type="search" aria-label="Search customers" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, ID (NSM-CU), mobile or city..."
                className="w-full h-9 pl-8 pr-3 text-xs font-medium bg-slate-50 border border-slate-200 rounded-[12px] focus:bg-white focus:border-crimson-800 focus:outline-none" />
            </div>
            <select aria-label="Brand" value={brand} onChange={(e) => { setBrand(e.target.value); setPage(1); }} className="h-9 px-3 rounded-[12px] border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:border-crimson-800">
              <option value="all">All Brands</option>
              {BRANDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              {extraBrands.map((b) => <option key={b} value={b}>{brandLabel(b)}</option>)}
            </select>
            {filtersOn && <button type="button" onClick={clearFilters} className="h-9 px-3 rounded-[12px] text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200/80">Clear</button>}
          </div>
        </div>

        {selected.size > 0 && (
          <div className="px-5 py-2.5 bg-crimson-50/70 border-b border-crimson-100 flex flex-wrap items-center justify-between gap-2 text-xs" role="region" aria-label="Bulk actions">
            <span className="font-bold text-crimson-800" aria-live="polite">{selected.size} customer{selected.size > 1 ? "s" : ""} selected</span>
            <div className="flex items-center gap-2 flex-wrap">
              {pageAllSelected && filtered.length > shown.length && filtered.some((r) => !selected.has(r.c.id)) && (
                <button type="button" onClick={() => setSelected(new Set(filtered.map((r) => r.c.id)))} className="px-2.5 py-1 rounded-lg font-semibold text-crimson-800 hover:underline">Select all {filtered.length} filtered customers</button>
              )}
              <button type="button" onClick={() => { setSelected(new Set()); setFailed([]); }} className="px-2.5 py-1 rounded-lg font-semibold text-slate-600 hover:bg-white">Clear selection</button>
              {canEdit && <button type="button" onClick={() => void markVip()} disabled={busyBulk} className="px-2.5 py-1 rounded-lg font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-60">{busyBulk ? "Working…" : "Mark as VIP"}</button>}
              {canExport && <button type="button" onClick={() => openExport("csv")} disabled={busyBulk} className="px-2.5 py-1 rounded-lg font-semibold bg-crimson-800 text-white hover:bg-crimson-900 disabled:opacity-60">Export Selected CSV</button>}
            </div>
            {failed.length > 0 && (
              <ul className="basis-full text-[11px] text-red-700 list-disc pl-4" role="alert">
                {failed.map((f) => <li key={f.id}>{f.name}: {f.reason}</li>)}
              </ul>
            )}
          </div>
        )}

        {bigError ? (
          <div className="py-10 px-5 text-center text-xs" role="alert">
            <p className="text-red-700 font-medium">The customer list could not be loaded.</p>
            <p className="text-slate-500 mt-1">{dir.error}</p>
            <button type="button" onClick={() => void dir.refresh()} className="mt-3 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200/80 font-semibold text-slate-700">Retry</button>
          </div>
        ) : loading ? (
          <div className="p-5 space-y-3" role="status" aria-label="Loading customers">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400" role="status">{rows.length === 0 ? "No customers yet." : "No customers match the current filter."}</p>
        ) : (
          <CustomerTable rows={shown} selected={selected} onToggle={toggleOne} onTogglePage={togglePage} a={{
            canReveal, canBook: !!onBookCustomer, canEdit,
            revealed: (id) => revealed[id],
            onReveal: (r) => setRevealFor(r.c), onView: (r) => setViewingId(r.c.id), onBook: book, onRemind: remind, onStatement: statement, onEdit: (r) => setEditing(r.c), onToggleBlock: toggleBlock,
          }} />
        )}

        <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] leading-4 text-slate-500">
          <span aria-live="polite">Showing {filtered.length ? `${(cur - 1) * PAGE + 1}–${Math.min(cur * PAGE, filtered.length)}` : "0"} of {filtered.length} customer{filtered.length === 1 ? "" : "s"}{filtered.length !== rows.length ? ` (${rows.length} in total)` : ""}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Previous</button>
            <strong className="font-semibold text-slate-600">{cur} / {pages}</strong>
            <button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Next</button>
          </div>
          <span className="font-medium text-slate-400">All customer number reveals are audited in Master Admin Logs</span>
        </div>
      </section>

      <AuditLedger views={dir.views} error={dir.viewsError} onRetry={() => void dir.refresh("views")} />

      {viewing && (
        <CustomerDrawer
          row={viewing}
          owned={ledger.owned.get(viewing.c.id) ?? []}
          phone={revealed[viewing.c.id]}
          cabs={categories}
          offer={checkOfferCoupon(coupons, offerFor(viewing))}
          canReveal={canReveal} canBook={!!onBookCustomer} canEdit={canEdit} canSettle={canSettle}
          onClose={() => setViewingId(null)}
          onReveal={() => setRevealFor(viewing.c)}
          onBook={() => book(viewing)}
          onStatement={() => { setViewingId(null); statement(viewing); }}
          onCopyStatement={() => void copyStatement(viewing)}
          onToggleBlock={() => void toggleBlock(viewing)}
          onEdit={() => setEditing(viewing.c)}
          onRemind={() => void remind(viewing)}
          onMarkPaid={() => setPaying(viewing.c.id)}
          onCoupon={() => void sendCoupon(viewing)}
          onOffers={() => { setViewingId(null); onNavigate?.("offers"); }}
          onSavePrefs={(p) => savePrefs(viewing, p)}
        />
      )}
      {revealFor && <RevealDialog customer={revealFor} actor={actor} onClose={() => setRevealFor(null)} onReveal={doReveal} />}
      {editing && <CustomerFormDialog customer={editing === "new" ? null : editing} all={customers ?? []} cabs={categories} onClose={() => setEditing(null)} onSaved={(t) => { setEditing(null); say(t); void dir.refresh(); }}
        onShowExisting={(id) => { setEditing(null); setViewingId(id); }} />}
      {payRow && (
        <MarkPaidDialog customer={payRow.c} items={(ledger.owned.get(payRow.c.id) ?? []).filter((b) => b.status === "Completed" && paymentOf(b).balanceDue > 0.004)}
          onClose={() => setPaying(null)} onChanged={(t) => say(t)} />
      )}
      {exporting && (
        <ExportDialog
          spec={spec} all={rows} filtered={filtered} selected={rows.filter((r) => selected.has(r.c.id))}
          filters={{ q, segment, brand }} initialFormat={exporting} onClose={() => { numbers.current = {}; setExporting(null); }}
          prepare={authorizeExport}
          copy={async (list) => ({ text: csv(spec.headers, list.map(spec.row)) })}
          options={
            <fieldset className="grid gap-2 border border-slate-200 rounded-[12px] p-3">
              <legend className="px-1 text-[11px] font-semibold text-slate-600">Mobile numbers</legend>
              <label className="flex items-start gap-2 text-[12px]"><input type="checkbox" className="mt-0.5" checked={withNumbers} onChange={(e) => setWithNumbers(e.target.checked)} /><span>Include full mobile numbers — a separate privileged export, logged with your reason. Off: numbers stay masked.</span></label>
              {withNumbers && <input aria-label="Reason for exporting full numbers" maxLength={200} value={exportReason} onChange={(e) => setExportReason(e.target.value)} placeholder="Reason (min 10 characters)" className="ds-input" />}
            </fieldset>
          }
        />
      )}
      {toast && <CdToast message={toast.message} tone={toast.tone} />}
    </div>
  );
}

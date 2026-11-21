import { useState, type FormEvent, type ReactNode } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../services/firebase";
import { exportRows, type Cell, type ExportFormat } from "../../utils/exportData";
import { Modal } from "../Feedback";
import Button from "./Button";

/** Two-letter initials badge used in record lists (reference "AP"). */
export function Initials({ name }: { name: string }) {
  const parts = name.replace(/[^\p{L}\p{N}\s·]/gu, "").split(/\s+/).filter(Boolean);
  const t = parts.length > 1 ? `${parts[0][0]}${parts[1][0] === "·" ? "·" : parts[1][0]}` : (parts[0] ?? "?").slice(0, 2);
  return <span className="ds-initials" aria-hidden="true">{t.toUpperCase()}</span>;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* use the selection fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export interface ExportSpec<T> {
  scope: string;
  headers: string[];
  row: (r: T) => Cell[];
}

/**
 * "Export <scope>" sheet: selected / filtered / all records as Excel, CSV or a printable page.
 * Every export is logged with the staff member, time, filters and record count.
 */
export function ExportDialog<T>({ spec, all, filtered, selected, filters, onClose, options, prepare, copy }: {
  spec: ExportSpec<T>;
  all: T[];
  filtered: T[];
  selected: T[];
  filters: Record<string, string>;
  onClose: () => void;
  /** Extra controls shown under the format (a page's own export choices). */
  options?: ReactNode;
  /** Runs before a file or copy is produced; resolves an error message to stop (e.g. the server refused the export). */
  prepare?: (rows: T[]) => Promise<string | null>;
  /** Adds "Copy CSV": returns the text to copy (or an error message). */
  copy?: (rows: T[]) => Promise<{ text: string } | { error: string }>;
}) {
  const [which, setWhich] = useState<"selected" | "filtered" | "all">(selected.length ? "selected" : "filtered");
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = which === "selected" ? selected : which === "filtered" ? filtered : all;
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    if (!copy) return;
    if (!rows.length) return setError("There are no records to export in this selection.");
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const refused = await prepare?.(rows);
      if (refused) return setError(refused);
      const r = await copy(rows);
      if ("error" in r) return setError(r.error);
      if (await copyToClipboard(r.text)) setCopied(true);
      else setError("The browser did not allow copying. Use the file download instead.");
    } finally {
      setBusy(false);
    }
  };
  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!rows.length) return setError("There are no records to export in this selection.");
    setBusy(true);
    setError(null);
    try {
      const refused = await prepare?.(rows);
      if (refused) return setError(refused);
      await addDoc(collection(db, "export_logs"), {
        scope: spec.scope, records: which, format, count: rows.length, filters,
        staffUid: auth.currentUser?.uid ?? "", staffName: auth.currentUser?.displayName || auth.currentUser?.email || "", at: serverTimestamp(),
      }).catch(() => undefined);
      exportRows(spec.scope, spec.headers, rows.map(spec.row), format);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Export ${spec.scope}`} onClose={onClose} busy={busy} footNote="Data export" footer={<Button variant="primary" icon="download" type="submit" form="export-form" loading={busy}>Export records</Button>}>
      <form id="export-form" onSubmit={run} className="grid gap-4">
        <p className="text-[12px] text-muted">{all.length} total · {filtered.length} filtered · {selected.length} selected</p>
        {error && <div className="ds-error" role="alert">{error}</div>}
        <label className="ds-field"><span>Records</span>
          <select className="ds-select" value={which} onChange={(e) => setWhich(e.target.value as typeof which)}>
            <option value="selected" disabled={!selected.length}>Selected records</option>
            <option value="filtered">Filtered records</option>
            <option value="all">All records</option>
          </select>
        </label>
        <label className="ds-field"><span>File format</span>
          <select className="ds-select" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <option value="xlsx">Excel workbook (.xlsx)</option>
            <option value="csv">CSV (.csv)</option>
            <option value="print">Print / Save PDF</option>
          </select>
        </label>
        {options}
        {copy && <div className="flex items-center gap-3"><Button type="button" icon="copy" onClick={doCopy} disabled={busy}>Copy CSV</Button>{copied && <span role="status" className="text-[12px] text-ok font-semibold">Copied {rows.length} {rows.length === 1 ? "record" : "records"} to the clipboard.</span>}</div>}
        <p className="text-[11px] text-faint">Only permitted fields are exported. Your Staff ID, time, filters and record count are logged.</p>
      </form>
    </Modal>
  );
}

/** Row selection for record lists. */
export function useSelection() {
  const [ids, setIds] = useState<Set<string>>(new Set());
  return {
    ids,
    has: (id: string) => ids.has(id),
    toggle: (id: string) => setIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    setAll: (list: string[], on: boolean) => setIds((s) => { const n = new Set(s); list.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; }),
    clear: () => setIds(new Set()),
  };
}

/** "Showing 1–3 of 3 · Previous · 1 / 1 · Next" (record lists, fixed 10 per page). */
export function SimplePager({ page, pages, from, to, total, onPage }: { page: number; pages: number; from: number; to: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="ds-table-foot">
      <span>Showing {total ? `${from}–${to}` : "0"} of {total}</span>
      <div className="ds-pager">
        <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>Previous</Button>
        <strong>{page} / {pages}</strong>
        <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>Next</Button>
      </div>
    </div>
  );
}

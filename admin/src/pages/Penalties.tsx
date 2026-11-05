import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { PenaltyRecord } from "../types";
import { subscribePenalties } from "../services/adminFirestoreService";
import {
  ACTIONS, PenaltyActionError, REFERENCE_REASONS, availableActions, createPenalty, mapPenalty, transitionPenalty, type Penalty, type PenaltyAction,
} from "../services/penaltyService";
import { useOfficeData } from "../hooks/useOfficeData";
import { useAccess, useCan } from "../components/AccessContext";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, PageHeader, toneForStatus } from "../components/ui";
import { StageBar } from "../components/ui/ListKit";
import MenuButton from "../components/ui/MenuButton";
import { rupee } from "../domain/officeStage";
import { formatDateTime12 } from "../utils/time";

type Tab = "Pending" | "Applied" | "Reversed" | "All";
const WINDOW_MS = 24 * 3600000;
const tabOf = (p: Penalty): Exclude<Tab, "All"> => (p.status === "Waived" ? "Reversed" : p.status === "Disputed" ? "Pending" : "Applied");
const stamp = (d: Date | null) => (d ? formatDateTime12(d).replace(/(\d{1,2}:\d{2})/, "$1:00") : "Not recorded");
const left = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}h ${m % 60}m remaining`; };

/** Penalty notices, partner acknowledgement and time-limited reversals. */
export default function Penalties({ onOpenBooking, onNavigate }: { onOpenBooking?: (id: string) => void; onNavigate?: (p: string, tab?: string) => void }) {
  const [raw, setRaw] = useState<PenaltyRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Applied");
  const [partner, setPartner] = useState("All");
  const [sheet, setSheet] = useState<{ kind: "new" } | { kind: "view" | "reverse"; p: Penalty } | { kind: "action"; p: Penalty; action: PenaltyAction } | null>(null);
  const data = useOfficeData();
  const access = useAccess();
  const canAct = useCan("compliance");
  const { toast, show } = useToast(7000);
  useEffect(() => subscribePenalties(setRaw, setError), []);
  const all = useMemo(() => (raw ?? []).map((r) => mapPenalty(r as PenaltyRecord & Record<string, unknown>)).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)), [raw]);
  const partners = Array.from(new Map(all.map((p) => [p.partyId, p.partyName])).entries());
  const counts = { Pending: 0, Applied: 0, Reversed: 0, All: all.length } as Record<Tab, number>;
  all.forEach((p) => counts[tabOf(p)]++);
  const rows = all.filter((p) => (tab === "All" || tabOf(p) === tab) && (partner === "All" || p.partyId === partner));
  const canReverse = (p: Penalty) => canAct && p.status !== "Waived" && availableActions(p).includes("Waived") && (access.isSuper || Date.now() - (p.createdAt?.getTime() ?? 0) <= WINDOW_MS);
  const done = (t: string) => { setSheet(null); show(t); };

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      {error && <ErrorBanner message={error} />}
      <PageHeader title="Penalties" subtitle="Separate notices, acknowledgement and time-limited Master reversals." actions={canAct ? <Button variant="primary" icon="plus" onClick={() => setSheet({ kind: "new" })}>Apply penalty</Button> : undefined} />
      <StageBar label="Penalty status" tabs={(["Pending", "Applied", "Reversed", "All"] as const).map((t) => ({ id: t, label: t, count: counts[t] }))} value={tab} onChange={setTab} />
      <div className="ds-filterbar">
        <label className="ds-field" style={{ minWidth: 280 }}><span>Partner</span><select className="ds-select" value={partner} onChange={(e) => setPartner(e.target.value)}><option value="All">All</option>{partners.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
      </div>
      <div className="ds-toolbar-count"><strong>{rows.length} notices</strong></div>
      <p className="ds-note mb-3">24-hour reversal window starts from the applied debit. Original penalty and wallet entries stay in history. Partner action remains Acknowledge only.</p>
      {raw === null ? <p className="text-[12px] text-muted">Loading penalties…</p> : rows.length === 0 ? <div className="ds-panel"><EmptyState /></div> : (
        <DataTable label="Penalties" minWidth={1120} fixed hasActions>
          <colgroup><col style={{ width: 170 }} /><col style={{ width: 190 }} /><col style={{ width: 230 }} /><col style={{ width: 100 }} /><col style={{ width: 140 }} /><col style={{ width: 160 }} /><col style={{ width: 180 }} /></colgroup>
          <thead><tr><th>APPLIED · IST</th><th>DUTY / PARTNER</th><th>REASON</th><th className="ds-num">AMOUNT</th><th>ACKNOWLEDGEMENT</th><th>DEADLINE / STATUS</th><th className="ds-actions">ACTION</th></tr></thead>
          <tbody>{rows.map((p) => {
            const deadline = (p.createdAt?.getTime() ?? 0) + WINDOW_MS;
            const b = data.bookings?.find((x) => x.id === p.bookingId);
            const extra = availableActions(p).filter((a) => a !== "Waived");
            return (
              <tr key={p.id} className="ds-row-stripe" data-tone={p.status === "Waived" ? "green" : p.status === "Disputed" ? "amber" : "red"}>
                <td><strong>{stamp(p.createdAt)}</strong><small>{p.id.slice(0, 12).toUpperCase()}</small></td>
                <td><strong>{p.bookingCode || "No duty"}</strong><small>{p.partyName}</small><small>{p.party === "Vendor" ? "Vendor" : "Driver Partner"}</small></td>
                <td><span className="ds-cell-clip">{p.reason}</span><small>{b ? `${b.pickup} → ${b.drop}` : p.category}</small></td>
                <td className="ds-num"><strong>{rupee(p.amount)}</strong></td>
                <td>{p.acknowledged ? <><Badge tone="green">Acknowledged</Badge><small>{stamp(p.acknowledgedAt)}</small></> : <Badge tone="amber">Not acknowledged</Badge>}</td>
                <td><Badge tone={toneForStatus(p.status === "Waived" ? "Reversed" : p.status === "Disputed" ? "Pending" : "Applied")}>{p.status === "Waived" ? "Reversed" : p.status === "Disputed" ? "Disputed" : "Applied"}</Badge>{tabOf(p) === "Applied" && <small>{deadline > Date.now() ? left(deadline - Date.now()) : `Window closed · ${p.status}`}</small>}</td>
                <td className="ds-actions"><div>
                  <Button size="sm" onClick={() => setSheet({ kind: "view", p })}>View</Button>
                  {canReverse(p) && <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "reverse", p })}>Reverse</Button>}
                  {canAct && extra.length > 0 && <MenuButton iconOnly label={`More actions for ${p.id}`} items={extra.map((a) => ({ label: ACTIONS[a].label, onSelect: () => setSheet({ kind: "action", p, action: a }) }))} />}
                </div></td>
              </tr>
            );
          })}</tbody>
        </DataTable>
      )}
      {sheet?.kind === "new" && <ApplySheet onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "view" && <ViewSheet p={sheet.p} canReverse={canReverse(sheet.p)} onReverse={() => setSheet({ kind: "reverse", p: sheet.p })} onOpenDuty={() => { setSheet(null); if (sheet.p.bookingId) onOpenBooking?.(sheet.p.bookingId); }} onStatement={() => onNavigate?.("accounts", "Partner statements")} onClose={() => setSheet(null)} />}
      {sheet?.kind === "reverse" && <ReverseSheet p={sheet.p} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "action" && <ActionSheet p={sheet.p} action={sheet.action} onClose={() => setSheet(null)} onDone={done} />}
    </div>
  );
}

function ApplySheet({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const data = useOfficeData();
  const partners = [
    ...data.vendors.map((v) => ({ key: `Vendor:${v.id}`, label: `${v.companyName || v.name} · NSM-VN-${v.id.slice(0, 6).toUpperCase()}`, name: v.companyName || v.name })),
    ...data.drivers.filter((d) => !d.vendorId).map((d) => ({ key: `Driver:${d.id}`, label: `${d.name} · ${d.licenseNumber || d.id.slice(0, 10)}`, name: d.name })),
  ];
  const [key, setKey] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [explanation, setExplanation] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [party, partyId] = key.split(":") as ["Vendor" | "Driver", string];
  const duties = (data.bookings ?? []).filter((b) => !partyId || (party === "Vendor" ? b.assignedVendorId === partyId : b.assignedDriverId === partyId));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!key) return setError("Select the Vendor / Driver Partner.");
    if (!reason) return setError("Select the reason.");
    if (explanation.trim().length < 10) return setError("Explain the penalty / policy calculation (at least 10 characters).");
    setBusy(true);
    setError(null);
    try {
      await createPenalty({ party, partyId, partyName: partners.find((p) => p.key === key)?.name ?? "", category: reason, reason: explanation.trim(), description: reference.trim() ? `Reference: ${reference.trim()}` : "", amount, customerCompensation: "", bookingId, incidentDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()) }, data.bookings ?? []);
      onDone("Penalty applied. The partner has been sent the acknowledgement notice.");
    } catch (err) {
      setError(err instanceof PenaltyActionError ? err.message : "The penalty was not applied.");
      setBusy(false);
    }
  };
  return (
    <Modal title="Apply partner penalty" onClose={onClose} busy={busy} footer={<Button variant="danger" type="submit" form="apply-penalty" loading={busy}>Verify &amp; apply penalty</Button>}>
      <form id="apply-penalty" onSubmit={save} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <label className="ds-field"><span>Financial partner</span><select className="ds-select" value={key} onChange={(e) => { setKey(e.target.value); setBookingId(""); }}><option value="">Select Vendor / Driver Partner</option>{partners.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
        <label className="ds-field"><span>Related duty</span><select className="ds-select" value={bookingId} onChange={(e) => setBookingId(e.target.value)}><option value="">Select related duty</option>{duties.map((b) => <option key={b.id} value={b.id}>{b.bookingId || b.id} · {b.pickup} → {b.drop}</option>)}</select></label>
        <label className="ds-field"><span>Penalty amount · ₹</span><input className="ds-input" type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="ds-field"><span>Reason</span><select className="ds-select" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select reason</option>{REFERENCE_REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
        <label className="ds-field"><span>Explanation / policy calculation</span><textarea className="ds-input" rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} /></label>
        <label className="ds-field"><span>Incident / policy reference</span><input className="ds-input" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        <p className="text-[11px] text-faint">Applying this penalty posts the confirmed debit and sends an acknowledgement notice. Security deposit is excluded.</p>
      </form>
    </Modal>
  );
}

function ViewSheet({ p, canReverse, onReverse, onOpenDuty, onStatement, onClose }: { p: Penalty; canReverse: boolean; onReverse: () => void; onOpenDuty: () => void; onStatement: () => void; onClose: () => void }) {
  const deadline = p.createdAt ? new Date(p.createdAt.getTime() + WINDOW_MS) : null;
  return (
    <Modal title="Penalty notice & history" onClose={onClose} size="lg">
      <dl className="ds-facts" data-cols={2}>
        {([
          ["Penalty reference", p.id.slice(0, 12).toUpperCase()], ["Duty ID", p.bookingCode || "—"], ["Original reason", p.category], ["Office explanation", p.reason],
          ["Amount", rupee(p.amount)], ["Applied time", stamp(p.createdAt)], ["Applied by", p.issuedByName || "Earlier office record"], ["Acknowledgement", p.acknowledged ? `Acknowledged · ${stamp(p.acknowledgedAt)}` : "Not acknowledged"],
          ["Reversal deadline", stamp(deadline)], ["Status", p.status === "Waived" ? "Reversed" : p.status], ...(p.disputeNote ? [["Partner dispute", p.disputeNote] as const] : []),
        ] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="flex flex-wrap gap-2 mt-4">
        {canReverse && <Button variant="danger" onClick={onReverse}>Reverse penalty</Button>}
        {p.bookingId && <Button icon="external-link" onClick={onOpenDuty}>Open duty</Button>}
        <Button variant="ghost" icon="file-text" onClick={onStatement}>Monthly statement</Button>
      </div>
      <h3 className="text-[13px] font-bold text-ink mt-5 mb-2">Original debit and reversal history</h3>
      <DataTable label="Penalty history" minWidth={560} hideTools>
        <thead><tr><th>DATE / TIME · IST</th><th>ENTRY</th><th className="ds-num">DEBIT / CREDIT</th><th>REFERENCE</th></tr></thead>
        <tbody>
          <tr><td>{stamp(p.createdAt)}</td><td>Confirmed penalty</td><td className="ds-num" style={{ color: "var(--color-bad)" }}>−{rupee(p.amount)}</td><td>{p.id.slice(0, 10)}</td></tr>
          {p.history.filter((h) => h.status !== "Pending").map((h, i) => <tr key={i}><td>{formatDateTime12(h.at as never)}</td><td>{h.status === "Waived" ? "Reversal credit" : h.status}{h.note ? ` · ${h.note}` : ""}</td><td className="ds-num" style={{ color: h.status === "Waived" ? "var(--color-ok)" : undefined }}>{h.status === "Waived" ? `+${rupee(p.amount)}` : "—"}</td><td>{h.reference || h.byName || ""}</td></tr>)}
        </tbody>
      </DataTable>
    </Modal>
  );
}

function ReverseSheet({ p, onClose, onDone }: { p: Penalty; onClose: () => void; onDone: (t: string) => void }) {
  const [reason, setReason] = useState("");
  const [explain, setExplain] = useState("");
  const [ref, setRef] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return setError("Select the reversal reason.");
    if (explain.trim().length < 5) return setError("Explain the correction.");
    if (!ok) return setError("Confirm you verified the original penalty and authorise this single reversal credit.");
    setBusy(true);
    try { await transitionPenalty(p, "Waived", `${reason}: ${explain.trim()}`, ref.trim()); onDone(`${rupee(p.amount)} reversal credit recorded.`); }
    catch (err) { setError(err instanceof PenaltyActionError ? err.message : "The reversal was not recorded."); setBusy(false); }
  };
  return (
    <Modal title={`${rupee(p.amount)} reversal credit`} onClose={onClose} busy={busy} footNote="The original debit remains; a linked credit is recorded once." footer={<Button variant="primary" type="submit" form="reverse-form" loading={busy}>Confirm reversal credit</Button>}>
      <form id="reverse-form" onSubmit={save} className="grid gap-4" noValidate>
        <div className="ds-sheet-card" style={{ marginBottom: 0 }}><strong style={{ marginTop: 0 }}>{p.bookingCode || "No duty"} · {p.reason}</strong><small>Applied {stamp(p.createdAt)} · Deadline {stamp(p.createdAt ? new Date(p.createdAt.getTime() + WINDOW_MS) : null)}</small></div>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <label className="ds-field"><span>Reversal reason</span><select className="ds-select" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select proper reason</option>{["Wrong charge", "Duplicate penalty", "Office error", "Verified exception"].map((r) => <option key={r}>{r}</option>)}</select></label>
        <label className="ds-field"><span>Explanation of the correction</span><textarea className="ds-input" rows={3} value={explain} onChange={(e) => setExplain(e.target.value)} /></label>
        <label className="ds-field"><span>Supporting reference / evidence reference</span><input className="ds-input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label className="ds-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I verified the original penalty and authorise this single reversal credit.</label>
      </form>
    </Modal>
  );
}

function ActionSheet({ p, action, onClose, onDone }: { p: Penalty; action: PenaltyAction; onClose: () => void; onDone: (t: string) => void }) {
  const spec = ACTIONS[action];
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={spec.label} onClose={onClose} busy={busy} footer={<Button variant="primary" loading={busy} onClick={async () => {
      setBusy(true);
      try { await transitionPenalty(p, action, note, ref); onDone(`Penalty ${action === "Pending" ? "upheld" : action.toLowerCase()}.`); }
      catch (err) { setError(err instanceof PenaltyActionError ? err.message : "The penalty was not updated."); setBusy(false); }
    }}>{spec.label}</Button>}>
      <div className="grid gap-4">
        <p className="ds-note">{spec.help}</p>
        {error && <div className="ds-error" role="alert">{error}</div>}
        <label className="ds-field"><span>{spec.noteLabel}</span><input className="ds-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {spec.needsReference && <label className="ds-field"><span>Payment reference</span><input className="ds-input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>}
      </div>
    </Modal>
  );
}

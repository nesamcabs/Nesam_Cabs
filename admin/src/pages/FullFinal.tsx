import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { useAccess, useCan } from "../components/AccessContext";
import { useOfficeData } from "../hooks/useOfficeData";
import { changeAccount, type PartnerKind, type Raw } from "../domain/partners";
import { refDateTime, rupee } from "../domain/officeStage";
import { paymentOf } from "../domain/bookingFlow";
import { bookingPickupDate } from "../utils/time";
import { Modal, Toast, useToast } from "../components/Feedback";
import { Badge, Button, DataTable, EmptyState, PageHeader } from "../components/ui";
import { StageBar } from "../components/ui/ListKit";
import Statement from "../components/accounts/Statement";

interface FFRecord {
  id: string;
  partnerKind: PartnerKind;
  partnerId: string;
  partnerName: string;
  balance: number;
  depositRefund: number;
  reference: string;
  reason: string;
  status: "Closed" | "Reopened";
  closedByName: string;
  closedAt?: { toDate: () => Date };
  reopenedByName?: string;
  reopenReason?: string;
}

/** Closed account statements, Master-approved reactivation, and completed bills awaiting verification. */
export default function FullFinal({ initialTab, onOpenBooking }: { initialTab?: string; onOpenBooking?: (id: string) => void }) {
  const [tab, setTab] = useState<"F&F records" | "Bill review">(initialTab === "Bill review" ? "Bill review" : "F&F records");
  const [rows, setRows] = useState<FFRecord[] | null>(null);
  const [view, setView] = useState<FFRecord | null>(null);
  const [reopen, setReopen] = useState<FFRecord | null>(null);
  const access = useAccess();
  const data = useOfficeData();
  const canFinance = useCan("finance");
  const { toast, show } = useToast(6000);
  useEffect(() => onSnapshot(collection(db, "ff_records"), (s) => setRows(s.docs.map((d) => ({ ...(d.data() as Omit<FFRecord, "id">), id: d.id }))), () => setRows([])), []);
  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => (b.closedAt?.toDate().getTime() ?? 0) - (a.closedAt?.toDate().getTime() ?? 0)), [rows]);
  const bills = (data.bookings ?? []).filter((b) => b.status === "Completed" && !b.finance).sort((a, b) => (bookingPickupDate(b)?.getTime() ?? 0) - (bookingPickupDate(a)?.getTime() ?? 0));

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      <PageHeader title="Full & Final" subtitle="Closed account statements and Master-approved reactivation cycles." />
      <StageBar label="Full & Final" tabs={[{ id: "F&F records" as const, label: "F&F records", count: sorted.length }, { id: "Bill review" as const, label: "Bill review", count: bills.length }]} value={tab} onChange={setTab} />
      {tab === "F&F records" && (rows === null ? <p className="text-[12px] text-muted">Loading…</p> : sorted.length === 0 ? <div className="ds-panel"><EmptyState /></div> : (
        <DataTable label="Full & Final records" minWidth={1040} fixed hasActions>
          <thead><tr><th>F&amp;F REFERENCE</th><th>ACCOUNT</th><th className="ds-num">WORKING SETTLEMENT</th><th className="ds-num">DEPOSIT REFUND</th><th>PAYMENT REFERENCE</th><th>CLOSED · IST</th><th className="ds-actions">ACTIONS</th></tr></thead>
          <tbody>{sorted.map((r) => (
            <tr key={r.id}>
              <td><strong>NSM-FF-{r.id.slice(0, 6).toUpperCase()}</strong><div><Badge tone={r.status === "Closed" ? "neutral" : "green"}>{r.status}</Badge></div></td>
              <td><strong>{r.partnerName}</strong><small>{r.partnerKind === "vendor" ? "Vendor" : r.partnerKind === "vehicle" ? "Vehicle" : "Driver"} · {r.partnerId.slice(0, 10)}</small></td>
              <td className="ds-num"><strong>{rupee(Math.abs(r.balance))}</strong><small>{r.balance > 0 ? "Paid to account holder" : r.balance < 0 ? "Collected" : "Nil"}</small></td>
              <td className="ds-num">{rupee(r.depositRefund)}</td>
              <td>{r.reference}<small>{r.reason}</small></td>
              <td>{refDateTime(r.closedAt?.toDate() ?? null)}<small>{r.closedByName}</small></td>
              <td className="ds-actions"><div>
                <Button size="sm" onClick={() => setView(r)}>Statement</Button>
                {access.isSuper && r.status === "Closed" && <Button size="sm" variant="ghost" onClick={() => setReopen(r)}>Reopen</Button>}
              </div></td>
            </tr>
          ))}</tbody>
        </DataTable>
      ))}
      {tab === "Bill review" && (bills.length === 0 ? <div className="ds-panel"><EmptyState title="No completed bill is waiting" hint="Completed trips appear here until their final bill is verified and closed." /></div> : (
        <DataTable label="Bill review" minWidth={900} fixed hasActions>
          <thead><tr><th>PICKUP</th><th>BOOKING / ROUTE</th><th>PARTNER</th><th className="ds-num">CUSTOMER FARE</th><th>COLLECTION</th><th className="ds-actions">ACTION</th></tr></thead>
          <tbody>{bills.map((b) => {
            const p = paymentOf(b);
            return (
              <tr key={b.id}>
                <td>{refDateTime(bookingPickupDate(b))}</td>
                <td><strong>{b.bookingId || b.id}</strong><small>{b.pickup} → {b.drop}</small></td>
                <td>{b.assignedVendorName || b.assignedDriverName || "—"}</td>
                <td className="ds-num">{rupee(p.amountDue)}</td>
                <td><Badge tone={p.status === "Paid" ? "green" : "amber"}>{p.status}</Badge><small>Driver collected {rupee(p.partnerCashHeld)}</small></td>
                <td className="ds-actions"><div><Button size="sm" variant="primary" disabled={!canFinance} onClick={() => onOpenBooking?.(b.id)}>Verify bill</Button></div></td>
              </tr>
            );
          })}</tbody>
        </DataTable>
      ))}
      {view && (
        <Modal title={`F&F statement · ${view.partnerName}`} onClose={() => setView(null)} wide>
          <Statement account={{ type: view.partnerKind === "vendor" ? "vendor" : "driver", id: view.partnerId, name: view.partnerName }} code={view.partnerId.slice(0, 10)} />
        </Modal>
      )}
      {reopen && <ReopenSheet r={reopen} onClose={() => setReopen(null)} onDone={(t) => { setReopen(null); show(t); }} />}
    </div>
  );
}

function ReopenSheet({ r, onClose, onDone }: { r: FFRecord; onClose: () => void; onDone: (t: string) => void }) {
  const data = useOfficeData();
  const [reason, setReason] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const raw = (r.partnerKind === "vendor" ? data.vendors : r.partnerKind === "vehicle" ? data.vehicles : data.drivers).find((x) => x.id === r.partnerId) as unknown as Raw | undefined;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError("Record the reason for reopening.");
    if (!ok) return setError("Confirm the new reactivation cycle starts with a fresh statement.");
    if (!raw) return setError("The account record is not available.");
    setBusy(true);
    try {
      await changeAccount(r.partnerKind, raw, "Reactivate ID", { reason: `Reopened after F&F: ${reason.trim()}`, remarks: "" });
      await updateDoc(doc(db, "ff_records", r.id), { status: "Reopened", reopenReason: reason.trim(), reopenedAt: serverTimestamp() });
      onDone(`${r.partnerName} reopened.`);
    } catch { setError("The account was not reopened."); setBusy(false); }
  };
  return (
    <Modal title="Reopen closed account" onClose={onClose} busy={busy} footNote="Master only · history retained" footer={<Button variant="primary" type="submit" form="reopen-form" loading={busy}>Reopen account</Button>}>
      <form id="reopen-form" onSubmit={save} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert">{error}</div>}
        <div className="ds-sheet-card" style={{ marginBottom: 0 }}><strong style={{ marginTop: 0 }}>{r.partnerName}</strong><small>Closed {refDateTime(r.closedAt?.toDate() ?? null)} · {r.reference}</small></div>
        <label className="ds-field"><span>Reason for reopening</span><input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="ds-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />The closed statement stays unchanged; a new reactivation cycle starts with a fresh opening.</label>
      </form>
    </Modal>
  );
}

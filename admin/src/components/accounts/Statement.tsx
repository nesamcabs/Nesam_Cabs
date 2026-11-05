import { useEffect, useMemo, useState } from "react";
import type { Booking } from "../../types";
import { subscribeLedger, type LedgerEntry } from "../../services/earningsService";
import { isVerifiedOpening, subscribeRegister, type RegisterEntry } from "../../services/accountsService";
import { useBookings } from "../../hooks/useOfficeData";
import { useCan } from "../AccessContext";
import { Button, DataTable } from "../ui";
import { exportRows } from "../../utils/exportData";
import { rupee } from "../../domain/officeStage";
import { bookingPickupDate, isoDateIST } from "../../utils/time";
import { paymentOf } from "../../domain/bookingFlow";
import { AdjustmentForm, DepositForm, OpeningForm, SettlementForm, type AccountRef } from "./RegisterForms";
import { ErrorBanner } from "../Feedback";

export interface StatementLine { date: string; entry: string; sub?: string; ref: string; source: string; debit: number; credit: number }

/** Every dated entry of an account. Positive balance = owed to NESAM. */
export function statementLines(account: AccountRef, ledger: LedgerEntry[], register: RegisterEntry[], bookings: Booking[]): { lines: StatementLine[]; deposit: number } {
  const lines: StatementLine[] = [];
  const mine = register.filter((r) => r.accountType === account.type && r.accountId === account.id);
  for (const r of mine) {
    if (r.kind === "opening") lines.push({ date: r.date, entry: "Opening balance", sub: "Recorded opening", ref: r.reference ?? "", source: "Office", debit: r.amount > 0 ? r.amount : 0, credit: r.amount < 0 ? -r.amount : 0 });
    if (r.kind === "adjustment") lines.push({ date: r.date, entry: "Account adjustment", sub: r.description, ref: r.reference ?? "", source: "Office", debit: r.direction === "Debit" ? r.amount : 0, credit: r.direction === "Credit" ? r.amount : 0 });
    if (r.kind === "settlement") lines.push({ date: r.date, entry: r.description || "Settlement", sub: "Verified bank entry", ref: r.reference ?? "", source: "Bank", debit: r.direction === "Debit" ? r.amount : 0, credit: r.direction === "Credit" ? r.amount : 0 });
  }
  if (account.type === "vendor" || account.type === "driver") {
    for (const e of ledger) {
      if (e.actorType !== account.type || e.actorId !== account.id || e.status === "cancelled") continue;
      const label = e.type === "cash_collected" ? "Fare collected by driver" : e.type === "trip_earning" ? "Agreed trip payout" : e.type === "toll_reimbursement" ? "Toll reimbursement" : e.type === "payout" ? "Payout paid" : e.type.replace(/_/g, " ");
      const sub = e.type === "cash_collected" ? "Verified fare collection" : e.type === "trip_earning" ? "Verified closed bill" : e.status;
      lines.push({ date: e.createdAt ? isoDateIST(e.createdAt) : "", entry: label, sub, ref: e.bookingCode || e.payoutRequestId || "", source: "Ledger", debit: e.direction === "debit" ? e.netAmount : 0, credit: e.direction === "credit" ? e.netAmount : 0 });
    }
  } else {
    for (const b of bookings) {
      const owner = account.type === "business" ? (b as Booking & { businessAccountId?: string }).businessAccountId === account.id : b.customerId === account.id;
      if (!owner) continue;
      const day = isoDateIST(bookingPickupDate(b) ?? new Date());
      const pay = paymentOf(b);
      if (b.status === "Completed") lines.push({ date: day, entry: "Trip charge", sub: "Verified final bill", ref: b.bookingId || b.id, source: "Booking", debit: pay.amountDue, credit: 0 });
      if (b.status === "Cancelled" && (b.cancellation?.charge ?? 0) > 0) lines.push({ date: day, entry: "Cancellation charge", ref: b.bookingId || b.id, source: "Booking", debit: b.cancellation!.charge!, credit: 0 });
      if (pay.totalPaid > 0) lines.push({ date: day, entry: "Payment received", sub: Object.keys(pay.paidByMethod).join(", "), ref: b.bookingId || b.id, source: "Receipts", debit: 0, credit: pay.totalPaid });
      if (pay.refunded > 0) lines.push({ date: day, entry: "Refund paid", ref: b.bookingId || b.id, source: "Refunds", debit: pay.refunded, credit: 0 });
    }
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));
  const deposit = mine.filter((r) => r.kind === "deposit" && r.status !== "Refunded").reduce((s, r) => s + r.amount, 0);
  return { lines, deposit };
}

const word = (n: number, partner: boolean) => (n > 0 ? (partner ? "Receivable from partner" : "Receivable") : n < 0 ? (partner ? "Payable to partner" : "Payable") : "Settled");

/** Monthly statement with opening / closing, exports and the recording actions. */
export default function Statement({ account, code }: { account: AccountRef; code: string }) {
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [register, setRegister] = useState<RegisterEntry[]>([]);
  const [registerLoaded, setRegisterLoaded] = useState(false);
  const [ledgerLoaded, setLedgerLoaded] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [month, setMonth] = useState(isoDateIST(new Date()).slice(0, 7));
  const [sheet, setSheet] = useState<"opening" | "adjustment" | "settlement" | "deposit" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const partner = account.type === "vendor" || account.type === "driver";
  const bookingState = useBookings(!partner);
  const bookings = bookingState.rows ?? [];
  const canFinance = useCan("finance");
  useEffect(() => {
    setRegisterLoaded(false); setLedgerLoaded(false); setRegisterError(null); setLedgerError(null);
    const a = partner ? subscribeLedger(rows => { setLedger(rows); setLedgerLoaded(true); setLedgerError(null); }, message => { setLedgerError(message); setLedgerLoaded(true); }) : () => {};
    const b = subscribeRegister(rows => { setRegister(rows); setRegisterLoaded(true); setRegisterError(null); }, message => { setRegisterError(message); setRegisterLoaded(true); });
    return () => { a(); b(); };
  }, [partner]);
  useEffect(() => { setSheet(null); setMsg(null); }, [account.type, account.id]);
  const { lines, deposit } = useMemo(() => statementLines(account, ledger, register, bookings), [account, ledger, register, bookings]);
  const before = lines.filter((l) => l.date < `${month}-01`);
  const opening = before.reduce((s, l) => s + l.debit - l.credit, 0);
  const rows = lines.filter((l) => l.date.startsWith(month));
  const debits = rows.reduce((s, l) => s + l.debit, 0);
  const credits = rows.reduce((s, l) => s + l.credit, 0);
  const closing = opening + debits - credits;
  const openings = register.filter(r => r.kind === 'opening' && r.accountType === account.type && r.accountId === account.id);
  const recordedOpening = openings.length === 1 ? openings[0] : undefined;
  const futureOpening = !!recordedOpening && recordedOpening.date.slice(0, 7) > month;
  const hasOpening = !!recordedOpening && isVerifiedOpening(recordedOpening) && !futureOpening;
  const openingProblem = openings.length > 1 ? 'Multiple opening entries were found. Finance must reconcile them before final settlement; recording another opening would duplicate the balance.'
    : futureOpening ? `The recorded opening starts on ${recordedOpening!.date}, after this statement month. Select that month or a later month to review its verified opening.`
    : recordedOpening ? 'The opening balance is recorded, but its verification is incomplete. Review the existing entry against the reconciliation reference.'
    : 'No opening balance has been recorded for this account. Enter the reconciled opening amount and date; enter 0 only if you have verified that no opening amount is owed.';
  let run = opening;
  const shown = rows.map((l) => ({ ...l, bal: (run += l.debit - l.credit) }));
  const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const exp = (fmt: "xlsx" | "print") => exportRows(`${account.name} statement ${month}`, ["Date", "Entry", "Reference", "Source", "Debit", "Credit", "Running balance"], [
    [`${month}-01`, "Opening balance", "", "", "", "", opening], ...shown.map((l) => [l.date, l.entry, l.ref, l.source, l.debit || "", l.credit || "", l.bal]), [`${month}-${last}`, "Closing balance", "", "", debits, credits, closing],
  ], fmt);
  const loadError = registerError || (partner ? ledgerError : bookingState.error);
  if (loadError) return <ErrorBanner message={`The statement could not be loaded: ${loadError}. Opening verification cannot be determined.`} onRetry={() => window.location.reload()} />;
  if (!registerLoaded || (partner ? !ledgerLoaded : bookingState.rows === null)) return <p role="status">Loading statement and opening verification…</p>;
  return (
    <>
      {partner && <span className="ds-eyebrow">PARTNER ACCOUNT</span>}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div><strong className="text-[15px] text-ink">{partner ? "Monthly statement" : "Full account statement"}</strong><p className="text-[12px] text-muted">{account.name} · {code} · {month}</p></div>
        <div className="flex gap-2"><Button icon="printer" onClick={() => exp("print")}>Save as PDF</Button><Button icon="sheet" onClick={() => exp("xlsx")}>Export Excel</Button></div>
      </div>
      <div className="flex flex-wrap items-end gap-4 mb-3">
        <label className="ds-field"><span>Month</span><input type="month" className="ds-input" value={month} onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }} /></label>
        <span className="text-[11px] text-muted">{partner ? "Debit: partner owes NESAM · Credit: NESAM owes partner" : "Debit increases the amount owed to NESAM; credit reduces it. Deposit stays separate."}</span>
      </div>
      <dl className="ds-facts mb-3" data-cols={4}>
        <div><dt>OPENING BALANCE</dt><dd>{rupee(Math.abs(opening))} · {word(opening, partner)}</dd></div>
        <div><dt>{partner ? "DEBITS" : "Charges / debits"}</dt><dd>{rupee(debits)}</dd></div>
        <div><dt>{partner ? "CREDITS" : "Receipts / credits"}</dt><dd>{rupee(credits)}</dd></div>
        <div><dt>CLOSING BALANCE</dt><dd>{rupee(Math.abs(closing))} · {word(closing, partner)}</dd></div>
      </dl>
      {canFinance && (
        <div className="flex flex-wrap gap-2 mb-3">
          {!hasOpening && <Button size="sm" icon="flag" disabledReason={openings.length > 1 ? "Reconcile the duplicate opening entries first." : futureOpening ? "Select the opening month or a later month." : undefined} onClick={() => setSheet("opening")}>{recordedOpening ? "Verify recorded opening" : "Record opening balance"}</Button>}
          <Button size="sm" icon="pencil" onClick={() => setSheet("adjustment")}>{partner ? "Account adjustment" : "Adjustment"}</Button>
          {partner && <Button size="sm" icon="landmark" onClick={() => setSheet("settlement")}>Record settlement</Button>}
        </div>
      )}
      {msg && <p className="ds-notice" role="status"><span>{msg}</span><button type="button" className="ds-link" onClick={() => setMsg(null)}>Dismiss</button></p>}
      {!hasOpening && <div className="ds-note mb-3" role="status"><p>{openingProblem}</p><p className="text-[11px] text-muted mt-1">This statement shows recorded entries only until opening verification is complete. {canFinance ? 'Use the opening action above to record or verify it.' : 'Ask a finance-authorized staff member to record or verify it.'}</p></div>}
      {hasOpening && <p className="text-[11px] text-muted mb-2">Opening verified by {recordedOpening!.verifiedByName} · Reference {recordedOpening!.reference} · Effective {recordedOpening!.date}</p>}
      {partner && (
        <div className="ds-note mb-3 flex flex-wrap items-center gap-3">
          <span><strong>Security deposit</strong> {deposit ? rupee(deposit) : "Not recorded"} · {deposit ? "Active" : "Verification pending"}</span>
          <span className="text-[11px] text-faint">Separate from the working statement · Refund only at Full &amp; Final settlement</span>
          {canFinance && <Button size="sm" variant="ghost" onClick={() => setSheet("deposit")}>Record deposit</Button>}
        </div>
      )}
      <DataTable label="Statement" minWidth={820} hideTools>
        <thead><tr><th>DATE</th><th>ENTRY</th><th>{partner ? "TRIP / REFERENCE" : "REFERENCE"}</th>{!partner && <th>SOURCE</th>}<th className="ds-num">DEBIT</th><th className="ds-num">CREDIT</th><th className="ds-num">RUNNING BALANCE</th></tr></thead>
        <tbody>
          <tr><td>{month}-01</td><td><strong>Opening balance</strong></td><td>—</td>{!partner && <td />}<td className="ds-num">—</td><td className="ds-num">—</td><td className="ds-num">{rupee(Math.abs(opening))} · {word(opening, partner)}</td></tr>
          {shown.map((l, i) => <tr key={i}><td>{l.date}</td><td><strong>{l.entry}</strong>{l.sub && <small>{l.sub}</small>}</td><td>{l.ref || "—"}</td>{!partner && <td>{l.source}</td>}<td className="ds-num">{l.debit ? rupee(l.debit) : "—"}</td><td className="ds-num">{l.credit ? rupee(l.credit) : "—"}</td><td className="ds-num">{rupee(Math.abs(l.bal))} · {word(l.bal, partner)}</td></tr>)}
          <tr><td>{month}-{last}</td><td><strong>Closing balance</strong></td><td>—</td>{!partner && <td />}<td className="ds-num">{rupee(debits)}</td><td className="ds-num">{rupee(credits)}</td><td className="ds-num">{rupee(Math.abs(closing))} · {word(closing, partner)}</td></tr>
        </tbody>
      </DataTable>
      <p className="text-[11px] text-faint mt-3">Amounts use verified ledger entries and the selected month. Bank settlements, reversals and charges retain their original partner / trip reference. PDF opens the desktop print dialog; select Save as PDF.</p>
      {sheet === "opening" && <OpeningForm key={`${account.type}:${account.id}:${recordedOpening?.id ?? 'new'}`} account={account} existing={recordedOpening} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); setMsg(t); }} />}
      {sheet === "adjustment" && <AdjustmentForm account={account} existing={register} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); setMsg(t); }} />}
      {sheet === "settlement" && <SettlementForm account={account} outstanding={closing} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); setMsg(t); }} />}
      {sheet === "deposit" && <DepositForm account={account} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); setMsg(t); }} />}
    </>
  );
}

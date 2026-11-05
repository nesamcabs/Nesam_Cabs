// Earnings, Wallet and penalty notices (reference qEarnings / qWalletView / statement / ledger entry / penalty notice).
// Balances come from the server ledger (wallets/vendor_{uid}); nothing here computes money of its own except the
// running "balance after" shown beside each ledger row.
import React, { useMemo, useState } from 'react';
import { usePartner } from '../../state/Partner';
import type { TransactionRecord } from '../../types';
import { acknowledgePenalty, disputePenalty } from '../../services/partnerNotifications';
import { Icon } from '../Icon';
import { Badge, Btn, Check, Dialog, Empty, ErrorLine, ExtraTag, Field, KV, Notice, PageHeading, Tabs } from '../ui';
import { day, dayTime, rupees, signedRupees } from '../format';
import { getDuesSummary, payOutstandingDues, requestDepositRefund, type DuesSummary } from '../services';
import { useWorkspace } from '../Workspace';

const DUE_GROUP: Record<string, 'Wallet posted' | 'Bank settled' | 'Processing'> = { Wallet: 'Wallet posted', Paid: 'Bank settled', Due: 'Processing', Processing: 'Processing', 'On Hold': 'Processing', Failed: 'Processing' };

export const StatementSheet: React.FC<{ tripId: string; onClose: () => void }> = ({ tripId, onClose }) => {
  const p = usePartner();
  const t = p.trips.find((x) => x.id === tripId);
  const due = p.dues.find((d) => d.id === tripId) ?? null;
  const penalties = p.penalties.filter((x) => x.bookingId === tripId && x.status === 'Deducted');
  const penaltyTotal = penalties.reduce((s, x) => s + x.amount, 0);
  const reimbursed = due ? Math.max(0, due.entitlement - (t?.vendorPayout ?? 0)) : 0;
  const tolls = t?.fareLines.filter((l) => /toll|parking|state/i.test(`${l.key} ${l.label}`) && l.amount) ?? [];
  return (
    <Dialog title="Duty statement" onClose={onClose}>
      <div className="v-between"><Badge>{t?.bookingId ?? due?.bookingCode ?? tripId}</Badge><Badge kind={due?.status === 'Paid' || due?.status === 'Wallet' ? 'green' : 'amber'}>{due ? DUE_GROUP[due.status] ?? due.status : 'Settlement pending'}</Badge></div>
      {t ? <p className="v-modal-intro v-mt">{t.pickupLabel || t.pickupAddress} → {t.dropLabel || t.dropAddress}</p> : null}
      <KV rows={[
        ['Agreed vendor payout', rupees(t?.vendorPayout ?? null)],
        ['Approved reimbursements', rupees(reimbursed)],
        ['Fare retained by driver / vendor (fare only)', due ? rupees(due.collectedByPartner) : 'After office verification'],
        ['Trip adjustment', due ? `${due.amount >= 0 ? '+' : '−'}${rupees(Math.abs(due.amount))}` : 'After office verification'],
        ['Confirmed penalties', `${rupees(penaltyTotal)} · separate wallet entries`],
        ...(due?.dueAt && due.status === 'Due' ? [['Expected settlement', dayTime(due.dueAt)] as [string, string]] : []),
      ]} />
      <Notice title="One adjustment per verified amount" icon="receipt-text">Customer advances paid to NESAM are not counted again as driver collection. Toll and parking follow approved receipts.</Notice>
      <section className="u-extra-breakdown">
        <h3>Extra charges</h3>
        <ExtraTag />
        {tolls.length ? <KV rows={tolls.map((l) => [l.label, `${rupees(l.amount)}${l.treatment ? ` · ${l.treatment}` : ''}`])} /> : null}
        <p>Customer reimbursements are recorded separately from fare collection. Office-approved amounts due from NESAM appear under approved reimbursements.</p>
      </section>
    </Dialog>
  );
};

type EarnTab = 'All' | 'Wallet posted' | 'Bank settled' | 'Processing';

export const EarningsScreen: React.FC = () => {
  const p = usePartner();
  const [tab, setTab] = useState<EarnTab>('All');
  const [statement, setStatement] = useState('');
  const completed = p.trips.filter((t) => t.status === 'Completed').sort((a, b) => (b.pickupAt?.getTime() ?? 0) - (a.pickupAt?.getTime() ?? 0));
  const dueOf = (id: string) => p.dues.find((d) => d.id === id) ?? null;
  const groupOf = (id: string): EarnTab => { const d = dueOf(id); return d ? DUE_GROUP[d.status] ?? 'Processing' : 'Processing'; };
  const list = completed.filter((t) => tab === 'All' || groupOf(t.id) === tab);
  const totalPayout = completed.reduce((s, t) => s + (t.vendorPayout ?? 0), 0);
  const collected = p.dues.reduce((s, d) => s + d.collectedByPartner, 0);
  const net = p.dues.reduce((s, d) => s + d.amount, 0);
  return (
    <>
      <PageHeading title="Earnings" subtitle="Duty payouts, verified collections and statements." />
      <div className="q-earning-summary">
        <div><small>Total vendor payout</small><strong>{rupees(totalPayout)}</strong></div>
        <div><small>Verified fare collected</small><strong>{rupees(collected)}</strong></div>
        <div><small>Net trip adjustment</small><strong>{rupees(net)}</strong></div>
      </div>
      <Tabs value={tab} onChange={setTab} items={(['All', 'Wallet posted', 'Bank settled', 'Processing'] as EarnTab[]).map((id) => ({ id, label: id }))} />
      {list.length ? (
        <div className="v-list">
          {list.map((t) => (
            <article key={t.id} className="v-statement">
              <div><strong>{t.bookingId}</strong><p>{t.pickupLabel || t.pickupAddress} → {t.dropLabel || t.dropAddress}</p><small>{dayTime(t.pickupAt)} · {groupOf(t.id)}</small></div>
              <div className="v-statement-amount">
                <strong>{rupees(t.vendorPayout)}</strong><small>Vendor payout</small>
                <Btn style="text" icon="chevron-right" onClick={() => setStatement(t.id)}>View statement</Btn>
              </div>
            </article>
          ))}
        </div>
      ) : <Empty title={completed.length ? 'No duties here' : 'No duty statements'}>{completed.length ? 'Completed duty statements appear here.' : 'Statements will appear after completed trips.'}</Empty>}
      {statement ? <StatementSheet tripId={statement} onClose={() => setStatement('')} /> : null}
    </>
  );
};

// ── Wallet ──────────────────────────────────────────────────────────────────

type WalletTab = 'All' | 'Trips' | 'Recharges' | 'Penalties' | 'Payouts';
const LEDGER_LABEL: Record<string, [string, string, string]> = {
  trip_earning: ['Trip payout credit', 'arrow-left-right', 'q-kind-trip'],
  toll_reimbursement: ['Approved reimbursement', 'receipt-text', 'q-kind-trip'],
  cash_collected: ['Fare collected by driver', 'arrow-left-right', 'q-kind-trip'],
  payout: ['Payout to bank', 'landmark', 'q-kind-payout'],
  penalty_deduction: ['Confirmed penalty', 'triangle-alert', 'q-kind-penalty'],
  wallet_recharge: ['Wallet recharge', 'plus', 'q-kind-recharge'],
  extra_charge: ['Approved extra charges', 'receipt-text', 'q-kind-trip'],
  due_payment: ['Dues payment', 'receipt-text', 'q-kind-recharge'],
  due_payment_held: ['Dues payment · held for review', 'triangle-alert', 'q-kind-penalty'],
};
const tabOf = (e: TransactionRecord): WalletTab =>
  e.type === 'wallet_recharge' || e.type === 'due_payment' || e.type === 'due_payment_held' ? 'Recharges' : e.type === 'penalty_deduction' ? 'Penalties' : e.type === 'payout' ? 'Payouts' : 'Trips';
/** Same reading as the server's walletTotals: what counts towards the available balance. */
const counts = (e: TransactionRecord) => e.status !== 'cancelled' && (e.direction === 'credit' ? e.status === 'available' : e.status === 'reserved' || e.status === 'completed');

export const WalletScreen: React.FC = () => {
  const p = usePartner();
  const ws = useWorkspace();
  const [tab, setTab] = useState<WalletTab>('All');
  const [sheet, setSheet] = useState<'' | 'dues' | 'withdraw' | 'refund'>('');
  const [entry, setEntry] = useState<TransactionRecord | null>(null);

  const withBalance = useMemo(() => {
    const oldest = [...p.ledger].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    let bal = 0;
    const after = new Map<string, number>();
    for (const e of oldest) { if (counts(e)) bal += e.direction === 'credit' ? e.amount : -e.amount; after.set(e.id, Math.round(bal * 100) / 100); }
    return p.ledger.map((e) => ({ e, after: after.get(e.id) ?? 0 }));
  }, [p.ledger]);
  const list = withBalance.filter(({ e }) => tab === 'All' || tabOf(e) === tab);
  const d = p.deposit;
  const pendingPayouts = p.payouts.filter((x) => !['Paid', 'Rejected', 'Cancelled'].includes(x.status));

  return (
    <>
      <PageHeading title="Wallet" subtitle="Your working balance and security deposit." />
      <div className="q-wallet-cards">
        <section className="q-balance-card">
          <span className="v-eyebrow">WORKING WALLET</span>
          <strong className={p.wallet.available < 0 ? 'q-negative' : ''}>{rupees(p.wallet.available)}</strong>
          <p>Available balance{p.wallet.pending ? ` · ${rupees(p.wallet.pending)} awaiting customer payment` : ''}{p.wallet.reserved ? ` · ${rupees(p.wallet.reserved)} in payout requests` : ''}</p>
          <div className="v-action-row">
            {p.wallet.available < 0 ? <Btn icon="receipt-text" onClick={() => setSheet('dues')}>Pay outstanding dues</Btn> : null}
            <Btn style="secondary" icon="landmark" disabled={p.wallet.available <= 0} onClick={() => setSheet('withdraw')}>Withdraw</Btn>
          </div>
        </section>
        <section className="q-deposit-card">
          <span className="q-deposit-icon"><Icon name="shield-check" /></span>
          <span className="v-eyebrow">SECURITY DEPOSIT</span>
          <strong>{rupees(d?.amount ?? 0)}</strong>
          <Badge kind={d?.status === 'Active' ? 'green' : d?.status === 'Refund requested' ? 'amber' : 'neutral'}>{d?.status ?? 'Not recorded'}</Badge>
          <p>Held separately from your working wallet.</p>
          <div className="s-fnf-note"><Icon name="lock-keyhole" /><span>Refund at Full &amp; Final settlement<small>After account closure, completed duties and clearance of outstanding accounts.</small></span></div>
          {d?.status === 'Active' && d.amount > 0 ? <Btn style="text" icon="chevron-right" onClick={() => setSheet('refund')}>Request refund at closure</Btn> : null}
        </section>
      </div>
      <Tabs value={tab} onChange={setTab} items={(['All', 'Trips', 'Recharges', 'Penalties', 'Payouts'] as WalletTab[]).map((id) => ({ id, label: id }))} />
      {tab === 'Penalties' ? <div className="v-action-row"><Btn style="text" icon="chevron-right" onClick={() => ws.open({ kind: 'penalties' })}>All penalty notices</Btn></div> : null}
      {list.length ? (
        <div className="q-ledger-list">
          {list.map(({ e, after }) => {
            const [label, icon, cls] = LEDGER_LABEL[e.type] ?? [e.type, 'arrow-left-right', 'q-kind-trip'];
            return (
              <button key={e.id} type="button" className="q-ledger-row" onClick={() => setEntry(e)}>
                <span className={`q-ledger-icon ${cls}`}><Icon name={icon} /></span>
                <span className="q-ledger-copy">
                  <strong>{label}{e.status === 'pending' ? ' · pending' : e.status === 'reserved' ? ' · processing' : e.status === 'held' ? ' · held for review' : ''}</strong>
                  <small>{e.bookingCode || e.reference || e.id} · {dayTime(e.createdAt)}</small>
                  <small>Balance after {rupees(after)}</small>
                </span>
                <span className={`q-ledger-amount ${e.direction === 'credit' ? 'q-positive' : 'q-negative'}`}>{signedRupees(e.amount, e.direction === 'credit')}<Icon name="chevron-right" /></span>
              </button>
            );
          })}
        </div>
      ) : <Empty title="No entries here">Verified wallet entries appear here.</Empty>}
      {pendingPayouts.length || p.payouts.length ? (
        <section className="v-panel v-mt">
          <h2>Payout requests</h2>
          {p.payouts.slice(0, 10).map((x) => (
            <div key={x.id} className="w-history-row">
              <span>{rupees(x.amount)} · {x.payoutMethod || 'Bank'}<small>{dayTime(x.requestedAt)}{x.utr ? ` · UTR ${x.utr}` : ''}{x.adminNote ? ` · ${x.adminNote}` : ''}</small></span>
              <Badge kind={x.status === 'Paid' ? 'green' : x.status === 'Rejected' ? 'red' : 'amber'}>{x.status}</Badge>
            </div>
          ))}
        </section>
      ) : null}
      {sheet === 'dues' ? <DuesSheet onClose={() => setSheet('')} /> : null}
      {sheet === 'withdraw' ? <WithdrawSheet onClose={() => setSheet('')} /> : null}
      {sheet === 'refund' ? <RefundSheet onClose={() => setSheet('')} /> : null}
      {entry ? <LedgerSheet e={entry} onClose={() => setEntry(null)} /> : null}
    </>
  );
};

const DuesSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const ws = useWorkspace();
  const [summary, setSummary] = useState<DuesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => {
    setLoading(true); setError('');
    getDuesSummary().then(setSummary, (err: Error) => setError(err.message)).finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(load, []);
  const pay = async () => {
    setBusy(true); setError('');
    try { const msg = await payOutstandingDues(); onClose(); ws.say(msg); } catch (err) { setError((err as Error).message); load(); } finally { setBusy(false); }
  };
  const payable = summary?.payable ?? 0;
  return (
    <Dialog title="Pay outstanding dues" onClose={onClose} busy={busy}>
      {loading ? <p className="v-modal-intro">Checking your dues…</p> : payable > 0 ? (
        <>
          <p className="v-modal-intro">Confirmed dues to pay</p>
          <strong className="q-negative" style={{ fontSize: 28 }}>{rupees(payable)}</strong>
          <KV mt rows={(summary?.items ?? []).map((i) => [i.label, rupees(i.amount)] as [React.ReactNode, React.ReactNode])} />
          <p className="v-small v-muted">NESAM calculates this from confirmed cash collections and penalties. Paying it clears these dues; they are not deducted again from your settlement.</p>
        </>
      ) : <p className="v-modal-intro">You have no confirmed dues to pay right now.</p>}
      <ErrorLine message={error} />
      {payable > 0 ? <Btn full icon="arrow-right" busy={busy} onClick={() => void pay()}>{`Pay ${rupees(payable)}`}</Btn> : null}
      <p className="w-demo-note">Secure payment by Razorpay · UPI, cards and net banking.</p>
    </Dialog>
  );
};

const WithdrawSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [amount, setAmount] = useState(String(Math.max(0, Math.floor(p.wallet.available))));
  const [method, setMethod] = useState<'Bank Transfer' | 'UPI'>('Bank Transfer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setError('Enter the amount to withdraw.'); return; }
    if (n > p.wallet.available) { setError(`You can withdraw up to ${rupees(p.wallet.available)}.`); return; }
    setBusy(true); setError('');
    try { await p.actions.requestPayout(n, method); onClose(); ws.say(`Payout request of ${rupees(n)} sent. NESAM pays it to your saved account.`); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Withdraw" onClose={onClose} busy={busy}>
      <p className="v-modal-intro">Available {rupees(p.wallet.available)}</p>
      <form onSubmit={submit}>
        <Field label="Amount (₹)"><input type="number" required min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Pay to">
          <select value={method} onChange={(e) => setMethod(e.target.value as 'Bank Transfer' | 'UPI')}>
            <option value="Bank Transfer">Bank account{p.record.payoutSummary?.bankLast4 ? ` ending ${p.record.payoutSummary.bankLast4}` : ''}</option>
            <option value="UPI">UPI{p.record.payoutSummary?.upiId ? ` · ${p.record.payoutSummary.upiId}` : ''}</option>
          </select>
        </Field>
        <ErrorLine message={error} />
        <Btn submit full icon="arrow-right" busy={busy}>Request payout</Btn>
      </form>
    </Dialog>
  );
};

const RefundSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await requestDepositRefund(); onClose(); ws.say('Refund request sent. The office settles it at full & final settlement.'); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Security deposit refund" onClose={onClose} busy={busy}>
      <p className="v-modal-intro">{rupees(p.deposit?.amount ?? 0)} held as security deposit.</p>
      <Notice title="Refunded at Full & Final settlement" kind="amber" icon="lock-keyhole">After account closure, completed duties and clearance of outstanding accounts.</Notice>
      <form onSubmit={submit}>
        <Check checked={ok} onChange={setOk}>I want to close my partner account and request the deposit refund.</Check>
        <ErrorLine message={error} />
        <Btn submit full busy={busy} disabled={!ok}>Request refund</Btn>
      </form>
    </Dialog>
  );
};

const LedgerSheet: React.FC<{ e: TransactionRecord; onClose: () => void }> = ({ e, onClose }) => {
  const [label] = LEDGER_LABEL[e.type] ?? [e.type];
  return (
    <Dialog title="Wallet entry" onClose={onClose}>
      <div className="v-between"><Badge>{e.id.slice(0, 18).toUpperCase()}</Badge><Badge>{tabOf(e).replace(/s$/, '').toLowerCase()}</Badge></div>
      <div className={`q-demo-payment-amount ${e.direction === 'credit' ? 'q-positive' : 'q-negative'}`}>{signedRupees(e.amount, e.direction === 'credit')}</div>
      <h3>{label}</h3>
      <KV mt rows={[
        ...(e.bookingCode ? [['Duty ID', e.bookingCode] as [string, string]] : []),
        ['Recorded', dayTime(e.createdAt)],
        ['Status', ({ available: 'Credited', pending: 'Awaiting customer payment', reserved: 'Processing', completed: 'Completed', cancelled: 'Cancelled', held: 'Held by NESAM for review · not withdrawable' } as Record<string, string>)[e.status] ?? e.status],
        ...(e.penaltyId ? [['Penalty notice', e.penaltyId] as [string, string]] : []),
        ...(e.payoutRequestId ? [['Payout request', e.payoutRequestId] as [string, string]] : []),
        ...(e.reference ? [['Reference', e.reference] as [string, string]] : []),
        ['Deposit affected', 'No'],
      ]} />
    </Dialog>
  );
};

// ── Penalties ───────────────────────────────────────────────────────────────

const PENALTY_BADGE: Record<string, ['neutral' | 'green' | 'amber' | 'red', string]> = {
  Pending: ['amber', 'Awaiting acknowledgement'], Acknowledged: ['neutral', 'Acknowledged'], Deducted: ['red', 'Confirmed'], Paid: ['green', 'Paid'], Waived: ['green', 'Waived'], Disputed: ['amber', 'Disputed'],
};

export const PenaltiesScreen: React.FC = () => {
  const p = usePartner();
  const ws = useWorkspace();
  return (
    <>
      <PageHeading title="Penalty notices" subtitle="Office decisions and acknowledgements." action={<Btn style="secondary" icon="arrow-left" onClick={() => ws.go('Wallet')}>Wallet</Btn>} />
      {p.penaltiesError ? <div className="v-error" role="alert">{p.penaltiesError}</div> : null}
      {p.penalties.length ? (
        <div className="v-list">
          {p.penalties.map((x) => {
            const [kind, label] = PENALTY_BADGE[x.status] ?? ['neutral', x.status];
            return (
              <article key={x.id} className="v-statement">
                <div><strong>{x.category}</strong><p>{x.bookingCode || 'General'} · {x.reason}</p><small>{dayTime(x.issuedAt)}</small></div>
                <div className="v-statement-amount"><strong>{rupees(x.amount)}</strong><Badge kind={kind}>{label}</Badge>
                  <Btn style="text" icon="chevron-right" onClick={() => ws.open({ kind: 'penalty', id: x.id })}>View notice</Btn>
                </div>
              </article>
            );
          })}
        </div>
      ) : <Empty title="No penalty notices">Any notices and office decisions will appear here.</Empty>}
    </>
  );
};

export const PenaltyNotice: React.FC<{ id: string; returnTo?: string }> = ({ id, returnTo }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dispute, setDispute] = useState(false);
  const [note, setNote] = useState('');
  const x = p.penalties.find((y) => y.id === id);
  const trip = x?.bookingId ? p.trips.find((t) => t.id === x.bookingId) : undefined;
  const back = p.openTrips.find((t) => t.id === returnTo);
  if (!x) return <Empty title="Notice not found">It may have been withdrawn by the office.</Empty>;
  const [kind, label] = PENALTY_BADGE[x.status] ?? ['neutral', x.status];
  const ack = async () => {
    setBusy('ack'); setError('');
    try { await acknowledgePenalty(x.id); ws.say('Notice acknowledged. You can accept new duties again.'); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const sendDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 10) { setError('Explain the dispute in at least 10 characters.'); return; }
    setBusy('dispute'); setError('');
    try { await disputePenalty(x.id, note.trim()); setDispute(false); ws.say('Dispute sent to the NESAM office.'); } catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  };
  return (
    <>
      <PageHeading title="Penalty notice" subtitle={x.id.slice(0, 16).toUpperCase()} action={<Btn style="secondary" icon="arrow-left" onClick={() => ws.go('Wallet', 'Penalties')}>Wallet</Btn>} />
      <ErrorLine message={error} />
      <div className="v-detail-grid">
        <div className="v-stack">
          <section className="v-panel">
            <div className="v-between"><strong>{x.bookingCode || 'General notice'}</strong><Badge kind={kind}>{label}</Badge></div>
            {trip ? <h2 className="q-duty-route v-mt">{trip.pickupLabel || trip.pickupAddress} <Icon name="arrow-right" /> {trip.dropLabel || trip.dropAddress}</h2> : null}
            <KV mt rows={[
              ...(trip?.pickupAt ? [['Pickup', dayTime(trip.pickupAt)] as [string, string]] : []),
              ['Incident date', x.incidentDate ? day(new Date(`${x.incidentDate}T12:00:00+05:30`)) : '—'],
              ['Notice issued', dayTime(x.issuedAt)],
              ['Category', x.category],
              ['Reason', x.reason],
              ['Amount', rupees(x.amount)],
            ]} />
          </section>
          <section className="v-panel">
            <h2>Office remarks</h2>
            <p className="v-small v-muted v-mt">{x.description || 'Please acknowledge this notice. You can dispute it if the details are wrong.'}</p>
            <KV mt rows={[['Wallet entry', x.status === 'Deducted' ? 'Confirmed amount debited' : x.status === 'Waived' ? 'Waived · no debit' : 'Not confirmed · no debit'], ...(x.disputeNote ? [['Your dispute', x.disputeNote] as [string, string]] : [])]} />
          </section>
          {dispute ? (
            <section className="v-panel">
              <h2>Dispute this notice</h2>
              <form onSubmit={sendDispute}>
                <Field label="What is wrong?"><textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <Btn submit icon="arrow-right" busy={busy === 'dispute'}>Send dispute</Btn>
              </form>
            </section>
          ) : null}
        </div>
        <aside className="v-detail-side">
          <section className="v-panel">
            <span className="v-eyebrow">PENALTY NOTICE</span>
            <div className="v-big-amount">{rupees(x.amount)}</div>
            <p className="v-small v-muted">Acknowledgement records that you viewed this notice. It is not an admission; you can dispute it.</p>
            <div className="v-mt v-action-row">
              {!x.acknowledged && x.status === 'Pending' ? <Btn icon="check-check" busy={busy === 'ack'} onClick={ack}>Acknowledge</Btn> : <Badge kind="green">Acknowledged</Badge>}
              {['Pending', 'Acknowledged'].includes(x.status) && !dispute ? <Btn style="secondary" icon="file-pen-line" onClick={() => setDispute(true)}>Dispute</Btn> : null}
            </div>
          </section>
          {back && x.acknowledged ? (
            <section className="v-panel">
              <h3>{back.route}</h3><p className="v-small v-muted">{back.bookingId}</p>
              <Btn icon="arrow-right" onClick={() => ws.open({ kind: 'duty', id: back.id }, 'Trips')}>Return to duty</Btn>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
};

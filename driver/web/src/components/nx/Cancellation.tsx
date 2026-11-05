// Help & cancellation — the reference's openTripHelp / openCancellationRequest / cancellationPolicy / cancellationStatus,
// wired to requestDutyCancellation (functions/src/partnerOps.ts). The duty is cancelled only after NESAM approves.
import React, { useState } from 'react';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { inr } from './format';
import { SUPPORT_PHONE } from '../../screens/VerificationStatusScreen';
import type { TripDetails } from '../../types';
import { REASONS, quote, requestDutyCancellation, type CancellationPolicy, type DriverCancellation } from '../../services/partnerRequests';

const officeNumber = () => {
  const d = SUPPORT_PHONE.replace(/\D/g, '').slice(-10);
  return `${d.slice(0, 5)} ${d.slice(5)}`;
};
const when = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d) : '—';

export const PolicyTable: React.FC<{ policy: CancellationPolicy }> = ({ policy: p }) => (
  <div className="nx-policy">
    <div className="nx-policy-title">Cancellation policy</div>
    <div><span>Pickup in {p.lastMinuteHours} hours or less</span><strong>{inr(p.lastMinuteCharge)}</strong></div>
    <div><span>Pickup more than {p.lastMinuteHours} hours away · cancel within {p.graceHours} hours of acceptance</span><strong>{inr(0)}</strong></div>
    <div><span>Pickup more than {p.lastMinuteHours} hours away · cancel after {p.graceHours} hours of acceptance</span><strong>{inr(p.afterGraceCharge)}</strong></div>
    <p>Valid reasons may be waived by NESAM admin. The last-{p.lastMinuteHours}-hours rule takes priority over the acceptance grace period.</p>
  </div>
);

export const PolicyShort: React.FC<{ policy: CancellationPolicy; onView: () => void }> = ({ policy: p, onView }) => (
  <p className="nx-policy-short">
    Cancellation: {inr(0)} acceptance window · {inr(p.afterGraceCharge)} after the window · {inr(p.lastMinuteCharge)} within {p.lastMinuteHours} hours of pickup. Valid reasons may be waived.{' '}
    <button type="button" onClick={onView}>View policy</button>
  </p>
);

export const PolicyDialog: React.FC<{ open: boolean; onClose: () => void; policy: CancellationPolicy }> = ({ open, onClose, policy }) => (
  <Dialog open={open} onClose={onClose} eyebrow="NESAM duty terms" title="Cancellation & waiver"
    footer={<button type="button" className="button primary full" onClick={onClose}>Understood <Icon name="check" /></button>}>
    <PolicyTable policy={policy} />
    <div className="info-note"><Icon name="shield" />Charges are based on the time your request is submitted. Admin review time does not increase the quoted penalty.</div>
  </Dialog>
);

/** Owner-drivers request cancellation in the app; a vendor's driver goes through their vendor / the office. */
export const canRequestCancellation = (t: TripDetails, request: DriverCancellation | null) =>
  !t.fleetTrip && t.subStatus === 'Not Started' && !request && ['Approved', 'Confirmed', 'Assigned'].includes(t.status);

export const HelpCancellationDialog: React.FC<{
  open: boolean; onClose: () => void; trip: TripDetails | null; request: DriverCancellation | null; policy: CancellationPolicy; onDone: (message: string) => void;
}> = ({ open, onClose, trip, request, policy, onDone }) => {
  const [mode, setMode] = useState<'help' | 'request' | 'policy'>('help');
  const close = () => { setMode('help'); onClose(); };
  if (!trip) return null;
  const started = trip.subStatus !== 'Not Started';
  const pending = request?.status === 'Pending';
  const canRequest = canRequestCancellation(trip, request);

  if (mode === 'policy') return <PolicyDialog open={open} onClose={() => setMode('help')} policy={policy} />;
  if (mode === 'request') return <RequestDialog open={open} onClose={close} trip={trip} policy={policy} onDone={(m) => { close(); onDone(m); }} />;

  const intro = started
    ? 'For changes after starting your duty, call NESAM office. Our team will handle the next steps.'
    : pending ? 'Your request is with NESAM office. The duty remains assigned until admin approves the cancellation.'
      : request?.status === 'Declined' ? 'Your cancellation request was declined. The duty remains assigned. Call NESAM office to discuss the next steps.'
        : trip.fleetTrip ? 'Your vendor manages changes to this duty. Call your vendor or the NESAM office.'
          : 'Before trip start, you can send a cancellation request in the app.';
  return (
    <Dialog open={open} onClose={close} eyebrow={trip.bookingId} title={started ? 'Trip started · Office help' : 'Help & Cancellation'}
      footer={
        <>
          <a className={`button ${started ? 'primary' : 'secondary'} full nx-office-call`} href={`tel:${SUPPORT_PHONE}`} aria-label={`Call NESAM office on ${officeNumber()}`}><Icon name="phone" />Call NESAM Office</a>
          <p className="nx-office-number">{officeNumber()}</p>
          <p className="nx-office-note">{started ? 'Call the office for trip changes or an urgent issue.' : 'For an immediate or urgent issue, call the office.'}</p>
        </>
      }>
      <p className="nx-help-intro">{intro}</p>
      {canRequest ? (
        <>
          <button type="button" className="nx-help-choice nx-request-choice" onClick={() => setMode('request')}>
            <span><Icon name="document" />Request cancellation<small>Select reason → Send Request → Admin review</small></span><Icon name="chevron" />
          </button>
          <ul className="nx-help-rules">
            <li>Any potential penalty is shown before you submit.</li>
            <li>The duty is cancelled only after admin approval.</li>
            <li>Admin may waive the penalty for a valid reason.</li>
          </ul>
        </>
      ) : null}
      {!started ? (
        <button type="button" className="nx-help-choice" onClick={() => setMode('policy')}><span><Icon name="shield" />Cancellation policy</span><Icon name="chevron" /></button>
      ) : null}
      <a className="nx-help-choice" href="tel:112" aria-label="Call police emergency number 112">
        <span><Icon name="alert" />Emergency: police (112)<small>In danger or an accident, call 112 first.</small></span><Icon name="chevron" />
      </a>
    </Dialog>
  );
};

const RequestDialog: React.FC<{ open: boolean; onClose: () => void; trip: TripDetails; policy: CancellationPolicy; onDone: (m: string) => void }> = ({ open, onClose, trip, policy, onDone }) => {
  const [q, setQ] = useState(() => quote(trip.pickupAt, trip.acceptedAt, policy));
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!reason || details.trim().length < 10) { setError('Select a reason and describe the issue in at least 10 characters.'); return; }
    if (!q) { setError('Unable to quote this request. Contact NESAM support.'); return; }
    setBusy(true);
    try {
      await requestDutyCancellation(trip.id, reason, details, q.amount);
      onDone('Request sent. Await office review; the duty remains assigned.');
    } catch (err) {
      const d = (err as { details?: { code?: string; amount?: number; ruleLabel?: string } }).details;
      if (d?.code === 'quote-changed' && typeof d.amount === 'number') setQ({ amount: d.amount, rule: d.ruleLabel ?? '' });
      setError((err as Error).message || 'The request was not sent. Please retry.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} locked={busy} eyebrow={trip.bookingId} title="Request cancellation"
      footer={
        <>
          <a className="button secondary full nx-office-call" href={`tel:${SUPPORT_PHONE}`}><Icon name="phone" />Call NESAM Office</a>
          <p className="nx-office-note">Immediate or urgent issue? Call {officeNumber()}.</p>
        </>
      }>
      <div className="nx-cancel-fee">
        <div><span>Potential penalty</span><strong>{inr(q?.amount ?? 0)}</strong></div>
        <p>{q?.amount ? 'Valid reasons can be waived after admin review.' : 'No penalty in this window. Admin approval is still required.'}</p>
      </div>
      {q ? <div className="nx-cancel-window"><Icon name="clock" />{q.rule}</div> : null}
      <form onSubmit={submit}>
        <label className="nx-cancel-field" htmlFor="cancel-reason">Reason
          <select id="cancel-reason" required value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Select a reason</option>
            {REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="nx-cancel-field" htmlFor="cancel-details">What happened?
          <textarea id="cancel-details" rows={3} maxLength={500} minLength={10} required value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Explain the issue so NESAM can review your request." />
        </label>
        <p className="nx-cancel-explain"><strong>Admin approval is required to cancel this duty.</strong>Your duty stays assigned until approval. Selecting a reason does not automatically waive a charge; admin may waive it after review.</p>
        <div className="nx-cancel-error" role="alert">{error}</div>
        <button className="button primary full" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send Request'} <Icon name="arrow" /></button>
      </form>
      <details className="nx-cancel-policy"><summary>View cancellation policy</summary><PolicyTable policy={policy} /></details>
    </Dialog>
  );
};

/** Shown on the trip page while a request is under review, or after it was declined. */
export const CancellationStatus: React.FC<{ request: DriverCancellation }> = ({ request: c }) => (
  <section className="nx-panel nx-request-status">
    <div className="nx-status amber"><Icon name="clock" />{c.status === 'Declined' ? 'Cancellation request declined' : 'Cancellation under review'}</div>
    <h3>{c.status === 'Declined' ? 'Contact NESAM for help' : 'Office review pending'}</h3>
    <p>{c.status === 'Declined' ? 'This duty remains assigned. No cancellation penalty has been deducted.' : 'The duty remains assigned. Call NESAM if the pickup is approaching.'}</p>
    <div className="nx-row"><span>Reason</span><strong>{c.reasonLabel}</strong></div>
    <div className="nx-row"><span>Requested</span><strong>{when(c.requestedAt)} IST</strong></div>
    <div className="nx-row"><span>{c.status === 'Declined' ? 'Cancellation charge' : 'Potential penalty'}</span><strong>{inr(c.status === 'Declined' ? 0 : c.quotedPenalty)}</strong></div>
    <p className="nx-note">{c.status === 'Declined' ? c.adminReason : 'No wallet deduction during review. Valid reasons may be waived.'}</p>
    <a className="nx-button" style={{ marginTop: 16 }} href={`tel:${SUPPORT_PHONE}`}><Icon name="phone" />Call NESAM support</a>
  </section>
);

/** Cancelled tab card for a duty the office cancelled after a request. */
export const CancelledCard: React.FC<{ request: DriverCancellation }> = ({ request: c }) => (
  <article className="panel completed-card">
    <div className="duty-meta"><span>{when(c.pickupAt)}</span><span className="badge neutral">Cancelled</span></div>
    <h3 className="duty-route">{c.route}</h3>
    <p className="duty-info">{c.bookingCode}</p>
    <div className="duty-bottom">
      <div className="duty-payout"><small>{c.finalPenalty ? 'Cancellation penalty' : 'No cancellation penalty'}</small><strong>{inr(c.finalPenalty ?? 0)}</strong></div>
    </div>
    <p className="duty-info">{c.finalPenalty ? 'Admin-approved debit recorded in your wallet' : 'No penalty · approved by NESAM'}{c.adminReason ? ` · ${c.adminReason}` : ''}</p>
  </article>
);

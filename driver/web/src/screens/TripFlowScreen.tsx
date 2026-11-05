import React, { useRef, useState } from 'react';
import { GoogleMapPreview } from '../../../../user/web/src/components/GoogleMapPreview';
import { CancellationStatus } from '../components/nx/Cancellation';
import { acknowledgeAssignment, type DriverCancellation } from '../services/partnerRequests';
import type { TollReceipt, TripDetails } from '../types';
import { Dialog } from '../components/nx/Dialog';
import { Icon, type IconName } from '../components/nx/Icon';
import { InfoNote } from '../components/nx/parts';
import { Swipe, SwipeHelp } from '../components/nx/Swipe';
import { arrivalWindow, durationText, inr, kmText, payoutLabel, payoutNote, phoneText, placeName, tripStageLabel, tripWhen } from '../components/nx/format';
import { PhotoUpload } from '../components/PhotoUpload';
import { describeFirestoreError, saveTripTolls, type TripRules } from '../services/driverFirestoreService';
import { ActionError } from '../services/callables';
import { newRequestId, recordCollection, revealCustomerContact } from '../services/tripService';
import { SLOTS } from '../services/verificationService';
import { formatTime12 } from '../utils/time';

interface TripFlowProps {
  trip: TripDetails;
  now: number;
  /** Server operating limits; null when they could not be read. */
  rules: TripRules | null;
  onBack: () => void;
  onStartVerification: () => void;
  onReachedPickup: (requestId: string) => Promise<void>;
  onVerifyBoarding: (otp: string) => Promise<void>;
  onTripStart: (requestId: string) => Promise<void>;
  onTripEnd: (totalKm: number, tolls: TollReceipt[], requestId: string) => Promise<void>;
  onHelp: () => void;
  /** Owner-driver cancellation request on this duty (pending / declined are shown on the page). */
  cancellation?: DriverCancellation | null;
}

const mapsLink = (loc: TripDetails['pickup']) =>
  loc.lat != null && loc.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc.address)}&travelmode=driving`;

const REVEAL_WINDOW_MS = 8 * 3600000;
const TREATMENT: Record<string, string> = { included: 'Included', extra: 'Extra · customer pays separately', not_applicable: 'Not applicable' };
const SLOT_ICON: Record<string, IconName> = { selfie: 'user', front: 'car', rear: 'car', interior: 'car' };
type Closing = 'trip' | 'form' | 'review';

export const TripFlowScreen: React.FC<TripFlowProps> = ({ trip, now, rules, onBack, onStartVerification, onReachedPickup, onVerifyBoarding, onTripStart, onTripEnd, onHelp, cancellation = null }) => {
  const pendingCancel = cancellation?.status === 'Pending';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [otp, setOtp] = useState('');
  const [closing, setClosing] = useState<Closing>('trip');
  const [ended, setEnded] = useState(false);
  const [totalKm, setTotalKm] = useState('');
  const [tolls, setTolls] = useState<TollReceipt[]>(trip.tolls);
  const [tollOpen, setTollOpen] = useState(false);
  const [revealed, setRevealed] = useState('');
  const [calling, setCalling] = useState(false);
  // One key per press: a double tap or a retry never repeats the step.
  const requestId = useRef(newRequestId());

  const finished = ended || trip.status === 'Completed' || trip.subStatus === 'Trip Ended';
  const cancelled = trip.status === 'Cancelled' || trip.status === 'Rejected';
  const boardingOk = trip.boardingVerified || trip.legacyFlow;
  const sub = trip.subStatus;
  const when = tripWhen(trip);
  const arrival = arrivalWindow(trip, rules, now);
  const opensText = arrival.opensAt ? `${arrival.opensAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })}, ${formatTime12(arrival.opensAt)} IST` : '';
  const arrivalNote = !arrival.open && rules ? `Marking arrival opens ${opensText} — ${durationText(rules.startWindowMs)} before the pickup time. You can take the vehicle photos now.` : '';

  const run = async (fn: () => Promise<void>, fallback: string): Promise<boolean> => {
    setError('');
    setBusy(true);
    try {
      await fn();
      requestId.current = newRequestId();
      return true;
    } catch (err) {
      setError(err instanceof ActionError ? err.message : describeFirestoreError(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const phase = finished ? 4 : closing !== 'trip' ? 3 : sub === 'Trip Started' ? 2 : sub === 'Reached Pickup' || trip.verificationSubmitted ? 1 : 0;

  // ── Customer contact ──────────────────────────────────────────────────────
  const unlockAt = trip.pickupAt ? trip.pickupAt.getTime() - REVEAL_WINDOW_MS : NaN;
  const knownPhone = revealed || trip.customerPhone;
  // The server enforces the 8-hour window; an unknown pickup time or a number we already hold never blocks the call.
  const contactOpen = Boolean(knownPhone) || !Number.isFinite(unlockAt) || now >= unlockAt;
  const showContact = !finished && !cancelled;
  const callCustomer = async () => {
    setError('');
    setCalling(true);
    try {
      const num = knownPhone || (await revealCustomerContact(trip.id)).phone;
      setRevealed(num);
      if (num) window.location.href = `tel:${num}`;
    } catch (err) {
      setError(err instanceof ActionError ? err.message : 'The customer’s number is not available yet.');
    } finally {
      setCalling(false);
    }
  };
  const unlockText = Number.isFinite(unlockAt) ? `${new Date(unlockAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })} · ${formatTime12(new Date(unlockAt))} IST` : '8 hours before pickup';

  const contactCard = showContact ? (
    <section className="nx-panel nx-customer" aria-label="Customer details">
      <div className="nx-customer-heading">
        <h3>Customer details</h3>
        <span className={`nx-customer-state ${contactOpen ? 'is-open' : ''}`}>
          <Icon name={contactOpen ? 'check' : 'shield'} />
          {contactOpen ? 'Available' : 'Private'}
        </span>
      </div>
      <div className="nx-customer-row">
        <div className="nx-customer-icon">
          <Icon name="user" />
        </div>
        <div>
          <span>Customer name</span>
          <strong>{trip.customerName || 'Customer'}</strong>
        </div>
      </div>
      <div className="nx-customer-row">
        <div className="nx-customer-icon">
          <Icon name="phone" />
        </div>
        <div>
          <span>Mobile number</span>
          <strong className={knownPhone ? '' : 'is-masked'}>{knownPhone ? phoneText(knownPhone) : trip.customerPhoneMasked || '••••••••••'}</strong>
        </div>
        {contactOpen ? (
          <button type="button" className="nx-call-customer" onClick={() => void callCustomer()} disabled={calling} aria-label="Call customer">
            <Icon name="phone" />
            {calling ? '…' : 'Call'}
          </button>
        ) : (
          <button type="button" className="nx-call-customer" disabled aria-label="Customer calling opens 8 hours before pickup">
            <Icon name="phone" />
            Call
          </button>
        )}
      </div>
      {contactOpen ? (
        <p className="nx-customer-note">Tap Call to reach the customer. NESAM reveals the number only for your assigned trip and keeps a record of it.</p>
      ) : (
        <div className="nx-customer-unlock">
          <Icon name="clock" />
          <p>
            <strong>Opens 8 hours before pickup</strong>
            <span>{unlockText}</span>
          </p>
        </div>
      )}
    </section>
  ) : null;

  // ── Fare ──────────────────────────────────────────────────────────────────
  const pay = trip.paymentSummary;
  const extras = (trip.fareBreakup ?? []).filter((l) => l.treatment === 'extra');
  const fareCard = !finished && !cancelled ? (
    <section className="nx-panel" style={{ marginBottom: 16 }} aria-label="Customer fare">
      {!trip.fleetTrip ? (
        <div className="nx-row" style={{ paddingTop: 0 }}>
          <span>
            Your payout
            <br />
            <small>{payoutNote(trip)}</small>
          </span>
          <strong>{payoutLabel(trip)}</strong>
        </div>
      ) : null}
      <div className="nx-row" style={trip.fleetTrip ? { paddingTop: 0 } : undefined}>
        <span>Customer fare</span>
        <strong>{inr(trip.fareAmount)}</strong>
      </div>
      {pay ? (
        <>
          <div className="nx-row">
            <span>Paid so far</span>
            <strong>{inr(pay.totalPaid)}</strong>
          </div>
          <div className="nx-row">
            <span>Balance to collect</span>
            <strong style={{ color: pay.balanceDue > 0 ? 'var(--nx-red)' : undefined }}>{inr(pay.balanceDue)}</strong>
          </div>
        </>
      ) : null}
      {extras.length ? (
        <p className="nx-note">
          Paid separately by the customer at actual cost: {extras.map((l) => `${l.label}${l.amount ? ` ${inr(l.amount)}` : ''}`).join(', ')}.
        </p>
      ) : null}
      {trip.fareBreakup && trip.fareBreakup.length ? (
        <details className="nx-charges">
          <summary>Fare breakup</summary>
          {trip.fareBreakup.map((l) => (
            <div className="nx-row" key={l.key}>
              <span>
                {l.label}
                <br />
                <small>
                  {l.detail ? `${l.detail} · ` : ''}
                  {TREATMENT[l.treatment] ?? ''}
                </small>
              </span>
              <strong>{l.amount === null ? '—' : inr(l.amount)}</strong>
            </div>
          ))}
        </details>
      ) : null}
    </section>
  ) : null;

  // ── Stage panels ─────────────────────────────────────────────────────────
  const photoChecks = (heading: string) => (
    <section className="nx-panel">
      <span className="badge green">
        <Icon name="check" />
        Confirmed duty
      </span>
      <h3 className="nx-heading" style={{ marginTop: 15 }}>
        {heading}
      </h3>
      <p className="nx-copy">Take your live selfie and the three vehicle photos, then enter the starting odometer reading. They are needed before the trip can start.</p>
      <div className="nx-pickup-summary">
        <Icon name="pin" />
        <div>
          <small>Pickup</small>
          <strong>{trip.pickup.address || '—'}</strong>
        </div>
      </div>
      <div className="nx-photo-checks">
        {SLOTS.map((s, i) => (
          <div className="nx-photo-check" key={s.slot}>
            <div className="nx-photo-thumb">
              <Icon name={SLOT_ICON[s.slot] ?? 'camera'} />
            </div>
            <div className="nx-photo-copy">
              <small>STEP {i + 1}</small>
              <strong>{s.label}</strong>
              <p>{s.hint}</p>
            </div>
          </div>
        ))}
        <div className="nx-photo-check">
          <div className="nx-photo-thumb">
            <Icon name="distance" />
          </div>
          <div className="nx-photo-copy">
            <small>STEP {SLOTS.length + 1}</small>
            <strong>Starting odometer</strong>
            <p>Enter the reading shown on the dashboard.</p>
          </div>
        </div>
      </div>
      <p className="nx-camera-only">
        <Icon name="shield" />
        Live camera only · Gallery upload unavailable
      </p>
      {arrivalNote ? <p className="nx-note">{arrivalNote}</p> : null}
      <div className="nx-actions">
        <button type="button" className="nx-button primary" onClick={() => { acknowledgeAssignment(trip.id, 'acknowledged'); onStartVerification(); }}>
          <Icon name="camera" />
          Start photo check
        </button>
      </div>
    </section>
  );

  const navigation = (loc: TripDetails['pickup'], eyebrow: string, label: string, caption: string) => (
    <section className="nx-panel nx-navigation">
      <div className="eyebrow">{eyebrow}</div>
      <div className="nx-location">
        <div className="nx-pin-box">
          <Icon name="pin" />
        </div>
        <div>
          <strong>{loc.address || '—'}</strong>
          <small>{caption}</small>
        </div>
      </div>
      <GoogleMapPreview pickup={{ lat: loc.lat, lng: loc.lng, label: loc.address }} height={180} />
      <a className="nx-button primary" href={mapsLink(loc)} target="_blank" rel="noopener noreferrer">
        <Icon name="pin" />
        {label}
      </a>
      <p className="nx-note">Opens directions in Google Maps.</p>
    </section>
  );

  const submitOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(otp)) return setError('Enter the 4-digit boarding OTP from the customer.');
    void run(async () => {
      await onVerifyBoarding(otp);
      setOtp('');
    }, 'That code is not correct. Please check with the customer and try again.');
  };

  const km = Number(totalKm);
  const goReview = () => {
    if (!(km > 0)) return setError('Enter the total kilometres driven for the whole trip.');
    if (km > 6000) return setError('That distance looks wrong — please check it.');
    setError('');
    setClosing('review');
  };
  const totalTolls = tolls.reduce((s, t) => s + t.amount, 0);

  const removeToll = async (id: string) => {
    const next = tolls.filter((t) => t.id !== id);
    try {
      await saveTripTolls(trip.id, next);
      setTolls(next);
    } catch (err) {
      setError(describeFirestoreError(err, 'Could not remove the toll receipt.'));
    }
  };

  let content: React.ReactNode = null;
  if (cancelled) {
    content = (
      <section className="nx-panel">
        <span className="badge neutral">Cancelled by NESAM</span>
        <h3 className="nx-heading" style={{ marginTop: 16 }}>
          Duty cancelled
        </h3>
        <p className="nx-copy">This duty is no longer assigned to you. Call the NESAM office if you have a question about it.</p>
        <div className="nx-actions">
          <button type="button" className="nx-button primary" onClick={onBack}>
            Back to My Trips <Icon name="arrow" />
          </button>
        </div>
      </section>
    );
  } else if (finished) {
    const balance = pay?.balanceDue ?? null;
    const paid = balance !== null && balance <= 0;
    content = (
      <section className="nx-panel nx-close-panel receipt-panel">
        <div className="nx-success-icon">
          <Icon name="check" />
        </div>
        <h3 className="nx-heading">Trip completed</h3>
        <p className="nx-copy">
          {placeName(trip.pickup.address)} → {placeName(trip.drop.address)}
        </p>
        <div className={`nx-collection-card ${paid ? 'is-paid' : ''}`}>
          <span className="nx-collection-label">{paid ? 'Trip payment' : 'Balance with the customer'}</span>
          <strong aria-live="polite">{balance === null ? 'Pending' : paid ? inr(0) : inr(balance)}</strong>
          <small>{balance === null ? 'Payment details are being confirmed' : paid ? 'No additional trip payment due' : 'Collect from the customer and record it below'}</small>
        </div>
        {pay && pay.totalPaid > 0 ? (
          <div className="nx-status" style={{ marginTop: 4 }}>
            <Icon name="check" />
            {inr(pay.totalPaid)} paid so far
          </div>
        ) : null}
        <div className="nx-row" style={{ marginTop: 14 }}>
          <span>Booked route</span>
          <strong>{trip.distanceKm > 0 ? kmText(trip.distanceKm) : '—'}</strong>
        </div>
        {totalTolls > 0 || trip.tollCharges > 0 ? (
          <div className="nx-row">
            <span>Toll &amp; parking receipts</span>
            <strong>
              {inr(Math.max(totalTolls, trip.tollCharges))}
              {trip.tollsApproved ? '' : ' · awaiting approval'}
            </strong>
          </div>
        ) : null}
        {!trip.fleetTrip ? (
          <div className="nx-row">
            <span>Your payout</span>
            <strong>{trip.driverEarnings !== null ? inr(trip.driverEarnings) : 'Not recorded'}</strong>
          </div>
        ) : null}
        <div className="nx-separate-note">
          <Icon name="info" />
          <p>
            <strong>Toll, parking &amp; state tax are extra</strong>
            <span>The customer pays these separately against actual receipts.</span>
          </p>
        </div>
        <p className="nx-settlement-note">
          <Icon name="shield" />
          {trip.fleetTrip ? 'Your fleet operator settles your pay for this trip.' : 'Your earning is added to your wallet once NESAM verifies the fare.'}
        </p>
        <div className="nx-actions">
          <button type="button" className="nx-button primary" onClick={onBack}>
            Back to My Trips <Icon name="arrow" />
          </button>
        </div>
      </section>
    );
  } else if (closing === 'form') {
    content = (
      <>
        <section className="nx-panel nx-close-panel">
          <div className="nx-close-heading">
            <div className="nx-pin-box">
              <Icon name="distance" />
            </div>
            <div>
              <div className="nx-eyebrow">Trip closing</div>
              <h3 className="nx-heading">Enter trip distance</h3>
            </div>
          </div>
          <p className="nx-copy">Enter the total kilometres driven for the whole trip, add any toll receipts and record the payments you collected.</p>
          <label className="nx-field nx-running" htmlFor="app-km">
            Total running KM
          </label>
          <div className="nx-km-control">
            <input
              id="app-km"
              type="number"
              min="0.1"
              max="6000"
              step="0.1"
              inputMode="decimal"
              placeholder={trip.distanceKm ? String(Math.round(trip.distanceKm)) : ''}
              value={totalKm}
              aria-describedby="app-km-help"
              onChange={(e) => {
                setTotalKm(e.target.value.replace(/[^\d.]/g, ''));
                setError('');
              }}
            />
            <span aria-hidden="true">km</span>
          </div>
          <p className="nx-note" id="app-km-help">
            {trip.distanceKm > 0 ? `Booked route about ${Math.round(trip.distanceKm)} km. ` : ''}NESAM works out the fare from the rates booked.
          </p>
          <div className="nx-separate-note">
            <Icon name="info" />
            <p>
              <strong>Toll, parking &amp; state tax are extra</strong>
              <span>Record each toll with its receipt below; the customer pays them separately.</span>
            </p>
          </div>
        </section>

        <section className="nx-panel nx-close-panel" style={{ marginTop: 16 }}>
          <div className="nx-close-heading">
            <div className="nx-pin-box">
              <Icon name="document" />
            </div>
            <div>
              <div className="nx-eyebrow">Receipts</div>
              <h3 className="nx-heading">Toll &amp; parking</h3>
            </div>
          </div>
          {tolls.length === 0 ? <p className="nx-copy">No tolls added.</p> : null}
          {tolls.map((t) => (
            <div className="nx-row" key={t.id} style={{ alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <img src={t.receiptPhotoUrl} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />
                <span style={{ color: 'var(--nx-ink)', overflowWrap: 'anywhere' }}>{t.name}</span>
              </span>
              <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {inr(t.amount)}
                <button type="button" className="icon-button" style={{ width: 34, minWidth: 34, height: 34 }} onClick={() => void removeToll(t.id)} aria-label={`Remove ${t.name}`}>
                  <Icon name="trash" />
                </button>
              </strong>
            </div>
          ))}
          {tolls.length ? (
            <div className="nx-row">
              <span>Total tolls</span>
              <strong>{inr(totalTolls)}</strong>
            </div>
          ) : null}
          <div className="nx-actions">
            <button type="button" className="nx-button" onClick={() => setTollOpen(true)}>
              <Icon name="plus" />
              Add toll receipt
            </button>
          </div>
          {!trip.fleetTrip ? <p className="nx-note">Tolls are reimbursed once NESAM approves the receipts.</p> : null}
        </section>

        <CollectionPanel trip={trip} />

        <div className="nx-panel nx-close-panel" style={{ marginTop: 16 }}>
          {error ? (
            <div className="nx-form-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="nx-actions" style={{ marginTop: 0 }}>
            <button type="button" className="nx-button primary" onClick={goReview}>
              Review &amp; Close <Icon name="arrow" />
            </button>
            <button type="button" className="nx-button nx-edit-km" onClick={() => { setClosing('trip'); setError(''); }}>
              Back to trip
            </button>
          </div>
        </div>
      </>
    );
  } else if (closing === 'review') {
    content = (
      <section className="nx-panel nx-close-panel">
        <span className="badge green">
          <Icon name="check" />
          Distance confirmed
        </span>
        <h3 className="nx-heading" style={{ marginTop: 15 }}>
          Close this trip?
        </h3>
        <p className="nx-copy">Check the distance before closing your duty.</p>
        <div className="nx-row" style={{ marginTop: 18 }}>
          <span>Total running KM</span>
          <strong>{km} km</strong>
        </div>
        {trip.distanceKm > 0 ? (
          <div className="nx-row">
            <span>Booked route</span>
            <strong>about {Math.round(trip.distanceKm)} km</strong>
          </div>
        ) : null}
        {tolls.length ? (
          <div className="nx-row">
            <span>Toll &amp; parking receipts</span>
            <strong>
              {tolls.length} · {inr(totalTolls)}
            </strong>
          </div>
        ) : null}
        {pay ? (
          <div style={{ marginTop: 17 }}>
            {pay.balanceDue > 0 ? (
              <div className="nx-status amber">
                <Icon name="clock" />
                {inr(pay.balanceDue)} still to be collected from the customer
              </div>
            ) : (
              <div className="nx-status">
                <Icon name="check" />
                {pay.totalPaid > 0 ? 'Booking paid in full' : 'No balance due'}
              </div>
            )}
          </div>
        ) : null}
        <p className="nx-payment-hint">{trip.fleetTrip ? 'Your fleet operator settles your pay.' : 'Your payout is credited once NESAM verifies the fare.'}</p>
        {error ? (
          <div className="nx-form-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="nx-actions">
          <button
            type="button"
            className="nx-button primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onTripEnd(km, tolls, requestId.current);
                setEnded(true);
              }, 'Could not end the trip. Please try again.')
            }
          >
            {busy ? 'Closing…' : 'Confirm & Close'} <Icon name="check" />
          </button>
          <button type="button" className="nx-button nx-edit-km" disabled={busy} onClick={() => setClosing('form')}>
            Edit kilometres
          </button>
        </div>
      </section>
    );
  } else if (sub === 'Trip Started') {
    content = (
      <section className="nx-panel">
        <div className="nx-status">
          <Icon name="check" />
          Customer on board · trip started{trip.tripStartedAt ? ` at ${formatTime12(trip.tripStartedAt)}` : ''}
        </div>
        <h3 className="nx-heading" style={{ marginTop: 18 }}>
          Trip in progress
        </h3>
        <p className="nx-copy">Have a safe journey to {placeName(trip.drop.address)}.</p>
        <div className="nx-location">
          <div className="nx-pin-box">
            <Icon name="pin" />
          </div>
          <div>
            <strong>{trip.drop.address || '—'}</strong>
            <small>Customer’s drop location</small>
          </div>
        </div>
        <a className="nx-button primary" href={mapsLink(trip.drop)} target="_blank" rel="noopener noreferrer">
          <Icon name="pin" />
          Navigate to Drop
        </a>
        {trip.distanceKm > 0 ? (
          <div className="nx-row" style={{ marginTop: 16 }}>
            <span>Trip estimate</span>
            <strong>{kmText(trip.distanceKm)}</strong>
          </div>
        ) : null}
        <Swipe
          key="end-trip"
          label="Slide to End Trip"
          onCommit={async () => {
            setError('');
            setClosing('form');
            return true;
          }}
        />
      </section>
    );
  } else if (sub === 'Reached Pickup') {
    content = (
      <>
        {!boardingOk ? (
          <section className="nx-panel">
            <div className="nx-otp-icon">
              <Icon name="shield" />
            </div>
            <h3 className="nx-heading">Boarding OTP</h3>
            <p className="nx-copy">
              Ask {trip.customerName || 'the customer'} for the 4-digit OTP from their app or message after they board. Five wrong tries lock the check for 10 minutes.
            </p>
            <form onSubmit={submitOtp}>
              <label className="nx-otp-label" htmlFor="app-otp">
                Enter the 4-digit boarding OTP
                <input
                  id="app-otp"
                  className="nx-otp-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  placeholder="••••"
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, '').slice(0, 4));
                    setError('');
                  }}
                />
              </label>
              <div className="nx-otp-error" role="alert">
                {error}
              </div>
              <div className="nx-actions">
                <button className="nx-button primary" type="submit" disabled={otp.length !== 4 || busy}>
                  {busy ? 'Verifying…' : 'Verify & Continue'} <Icon name="arrow" />
                </button>
              </div>
            </form>
            <p className="nx-note">The trip itself starts when you slide to start, after the OTP and vehicle photos are done.</p>
          </section>
        ) : null}
        {!trip.verificationSubmitted ? photoChecks('Vehicle photos needed') : null}
        <section className="nx-panel" style={{ marginTop: !boardingOk || !trip.verificationSubmitted ? 16 : 0 }}>
          {boardingOk ? (
            <div className="nx-status">
              <Icon name="check" />
              Customer on board · OTP verified
            </div>
          ) : null}
          <h3 className="nx-heading" style={{ marginTop: boardingOk ? 18 : 0 }}>
            Start the trip
          </h3>
          <p className="nx-copy">Sliding to start records the real start of the customer’s journey.</p>
          <div className="nx-row" style={{ marginTop: 14 }}>
            <span>Boarding OTP</span>
            <strong>{boardingOk ? 'Verified' : 'Needed'}</strong>
          </div>
          <div className="nx-row">
            <span>Selfie &amp; vehicle photos</span>
            <strong>{trip.verificationSubmitted ? 'Submitted' : 'Needed'}</strong>
          </div>
          {boardingOk && error ? (
            <div className="nx-form-error" role="alert">
              {error}
            </div>
          ) : null}
          <Swipe key="start-trip" label="Slide to Start Trip" disabled={!boardingOk || !trip.verificationSubmitted} busy={busy} onCommit={() => run(() => onTripStart(requestId.current), 'Could not start the trip.')} />
          {!boardingOk || !trip.verificationSubmitted ? <p className="nx-note">Complete the boarding OTP and the vehicle photos to unlock Start Trip.</p> : null}
        </section>
      </>
    );
  } else if (!trip.verificationSubmitted) {
    content = photoChecks('Before you start');
  } else {
    content = (
      <>
        <section className="nx-panel">
          <span className="badge green">
            <Icon name="car" />
            On the way to pickup
          </span>
          <h3 className="nx-heading" style={{ marginTop: 15 }}>
            Reached the location?
          </h3>
          <p className="nx-copy">Confirm when you arrive. GPS verification is disabled.</p>
          {error ? (
            <div className="nx-form-error" role="alert">
              {error}
            </div>
          ) : null}
          <Swipe key="mark-reached" label="Slide to Mark Reached" disabled={!arrival.open} busy={busy} onCommit={() => { acknowledgeAssignment(trip.id, 'acknowledged'); return run(() => onReachedPickup(requestId.current), 'Could not update the trip.'); }} />
          <p className="nx-note">{arrivalNote || `Vehicle photos submitted · pickup ${placeName(trip.pickup.address)}`}</p>
        </section>
        {navigation(trip.pickup, 'Navigate to pickup', 'Navigate to Pickup', 'Customer’s pickup location')}
      </>
    );
  }

  const progressLabels = ['Start', 'Pickup', 'On trip', 'Close'];
  return (
    <>
      <div className="trip-flow">
        <div className="nx-trip-toolbar">
          <button type="button" className="trip-back" onClick={onBack}>
            <Icon name="chevron" />
            My Trips
          </button>
          {!finished && !cancelled ? (
            <button type="button" className="nx-trip-help nx-trip-help-top" onClick={onHelp} aria-haspopup="dialog">
              <Icon name="help" />
              <span>{pendingCancel ? 'Request help' : sub === 'Not Started' ? (trip.fleetTrip ? 'Help / Call office' : 'Help / Request Cancellation') : 'Trip help / Call office'}</span>
            </button>
          ) : null}
        </div>
        <div className="nx-trip-meta">
          {trip.bookingId}
          {trip.serviceType ? ` · ${trip.serviceType.toUpperCase()}` : ''}
        </div>
        <h2 className="nx-route-title">
          {placeName(trip.pickup.address)} → {placeName(trip.drop.address)}
        </h2>
        <p className="nx-trip-date">
          <Icon name="calendar" />
          {when.date}
          {when.time ? ` · ${when.time} IST` : ''} · {tripStageLabel(trip)}
          {trip.paymentMode ? ` · ${trip.paymentMode}` : ''}
        </p>
        {trip.reachedPickupAt || trip.tripStartedAt || trip.tripEndedAt ? (
          <p className="nx-trip-date" style={{ marginTop: 3 }}>
            <Icon name="clock" />
            {[
              trip.reachedPickupAt ? `Reached pickup ${formatTime12(trip.reachedPickupAt)}` : '',
              trip.tripStartedAt ? `Trip started ${formatTime12(trip.tripStartedAt)}` : '',
              trip.tripEndedAt ? `Trip ended ${formatTime12(trip.tripEndedAt)}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
        {!cancelled ? (
          <ol className="nx-progress" aria-label="Trip progress">
            {progressLabels.map((label, i) => (
              <li key={label} data-state={phase >= 4 || i < phase ? 'done' : i === phase ? 'active' : 'waiting'} aria-current={i === phase && phase < 4 ? 'step' : undefined}>
                {label}
              </li>
            ))}
          </ol>
        ) : null}
        <SwipeHelp />
        {error && closing === 'trip' && !(sub === 'Reached Pickup' && !boardingOk) && sub !== 'Reached Pickup' && trip.verificationSubmitted && sub !== 'Not Started' ? (
          <div className="nx-status amber" role="alert" style={{ marginBottom: 16 }}>
            <Icon name="info" />
            {error}
          </div>
        ) : null}
        <div className={`nx-trip-layout ${contactCard || (closing === 'trip' && fareCard) ? '' : 'is-solo'}`}>
          {contactCard ? <div className="nx-trip-customer">{contactCard}</div> : null}
          <div className="nx-trip-main">
            {cancellation && cancellation.status !== 'Approved' ? <CancellationStatus request={cancellation} /> : null}
            {pendingCancel ? null : content}
          </div>
          {closing === 'trip' && fareCard ? <div className="nx-trip-fare">{fareCard}</div> : null}
        </div>
      </div>
      <TollDialog
        open={tollOpen}
        trip={trip}
        onClose={() => setTollOpen(false)}
        onSaved={async (toll) => {
          const next = [...tolls, toll];
          await saveTripTolls(trip.id, next);
          setTolls(next);
          setTollOpen(false);
        }}
      />
    </>
  );
};

/** The driver records money collected from the customer; each entry is saved as a payment against the driver. */
const CollectionPanel: React.FC<{ trip: TripDetails }> = ({ trip }) => {
  const balance = trip.paymentSummary?.balanceDue ?? trip.fareAmount;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'Cash' | 'UPI' | 'Bank Transfer'>('Cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const key = useRef(newRequestId());

  const save = async () => {
    const n = Number(amount);
    if (!(n > 0)) return setMsg({ ok: false, text: 'Enter the amount you collected.' });
    if (method !== 'Cash' && reference.trim().length < 4) return setMsg({ ok: false, text: `Enter the ${method === 'UPI' ? 'UPI transaction' : 'transfer'} reference.` });
    setBusy(true);
    setMsg(null);
    try {
      await recordCollection({ bookingId: trip.id, amount: n, method, reference: reference.trim(), requestId: key.current });
      key.current = newRequestId();
      setAmount('');
      setReference('');
      setMsg({ ok: true, text: `${inr(n)} ${method} recorded as collected by you.` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ActionError ? err.message : 'The payment was not recorded.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="nx-panel nx-close-panel" style={{ marginTop: 16 }}>
      <div className="nx-close-heading">
        <div className="nx-pin-box">
          <Icon name="wallet" />
        </div>
        <div>
          <div className="nx-eyebrow">Collections</div>
          <h3 className="nx-heading">Payment from the customer</h3>
        </div>
      </div>
      <p className="nx-copy">
        Balance still to be paid: <strong>{inr(balance)}</strong>. Record cash or other payments you receive; each one is kept with your name.
      </p>
      <label className="nx-field" htmlFor="collect-amount">
        Amount collected (₹)
        <input id="collect-amount" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </label>
      <label className="nx-field" htmlFor="collect-method">
        Payment method
        <select id="collect-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option>Cash</option>
          <option>UPI</option>
          <option>Bank Transfer</option>
        </select>
      </label>
      {method !== 'Cash' ? (
        <label className="nx-field" htmlFor="collect-ref">
          {method === 'UPI' ? 'UPI transaction ID' : 'Transfer reference'}
          <input id="collect-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
      ) : null}
      {msg ? (
        <div className={msg.ok ? 'nx-status' : 'nx-form-error'} role={msg.ok ? 'status' : 'alert'} style={{ marginTop: 12 }}>
          {msg.text}
        </div>
      ) : null}
      <div className="nx-actions">
        <button type="button" className="nx-button" onClick={() => void save()} disabled={busy || balance <= 0}>
          {busy ? 'Saving…' : 'Record payment'}
        </button>
      </div>
    </section>
  );
};

const TollDialog: React.FC<{ open: boolean; trip: TripDetails; onClose: () => void; onSaved: (t: TollReceipt) => Promise<void> }> = ({ open, trip, onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [photo, setPhoto] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    setName('');
    setAmount('');
    setPhoto('');
    setError('');
    onClose();
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!name.trim() || !(value > 0)) return setError('Enter the toll plaza name and amount.');
    if (!photo) return setError('Upload a photo of the toll receipt.');
    setSaving(true);
    setError('');
    try {
      await onSaved({ id: `TOLL-${Date.now()}`, name: name.trim(), amount: value, receiptPhotoUrl: photo, uploadedAt: new Date().toISOString() });
      close();
    } catch (err) {
      setError(describeFirestoreError(err, 'Could not save the toll receipt.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} eyebrow={trip.bookingId} title="Add toll receipt" locked={saving}>
      <form onSubmit={save} id="toll-form">
        <label className="nx-cancel-field" htmlFor="toll-name">
          Toll plaza name
          <input id="toll-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="nx-cancel-field" htmlFor="toll-amount">
          Amount (₹)
          <input id="toll-amount" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <div style={{ marginTop: 16 }}>
          <PhotoUpload compact label="Receipt photo" value={photo} folder={`trips/${trip.id}/tolls`} name="toll" capture="environment" required onChange={setPhoto} />
        </div>
        <div className="nx-cancel-error" role="alert">
          {error}
        </div>
        <button className="button primary full" type="submit" disabled={saving} style={{ marginTop: 16 }}>
          {saving ? 'Saving…' : 'Save receipt'} <Icon name="check" />
        </button>
      </form>
    </Dialog>
  );
};

export { InfoNote };

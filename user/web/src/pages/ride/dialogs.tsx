import { useEffect, useState } from 'react';
import type { LatLng, TripRecord, UserProfile } from '@core/types';
import { cancelRide, cancellationQuote, raiseSos } from '@core/services/rideService';
import { getCurrentPosition } from '@core/services/geoService';
import { CANCEL_REASONS, EMERGENCY_NUMBER, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { formatPhone, localMobile } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { Button, Dialog, Notice, TextArea } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { buildTripShareText, shareText } from '@/lib/share';
import { useToasts } from '@/state/Toasts';

/** Cancel with a reason and the live fee quote (the fee depends on elapsed time, so it ticks). */
export function CancelDialog({ trip, onClose }: { trip: TripRecord; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, tick] = useState(0);
  const { push } = useToasts();

  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 15000);
    return () => window.clearInterval(t);
  }, []);

  const quote = cancellationQuote(trip);
  const finalReason = reason === 'Other' ? other.trim() : reason;

  const confirm = async () => {
    if (!finalReason) {
      setError('Please tell us why you’re cancelling.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await cancelRide(trip, finalReason);
      push({ title: 'Ride cancelled', message: quote.fee ? `A ₹${quote.fee} cancellation fee applies.` : 'No cancellation fee was charged.', tone: 'info' });
      onClose();
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : describeError(e, 'We couldn’t cancel this ride. Please try again or call support.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Cancel ride ${trip.bookingId}?`}
      onClose={onClose}
      dismissible={!busy}
      footer={
        quote.allowed ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Keep ride
            </Button>
            <Button variant="primary" loading={busy} disabled={!finalReason} onClick={() => void confirm()}>
              Cancel ride
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {!quote.allowed ? (
        <p>{quote.explanation}</p>
      ) : (
        <div className="stack">
          <Notice tone={quote.fee ? 'warning' : 'success'}>
            {quote.fee ? <strong>Cancellation fee: ₹{quote.fee}. </strong> : null}
            {quote.explanation}
          </Notice>
          <fieldset className="reasons">
            <legend>Why are you cancelling?</legend>
            {CANCEL_REASONS.map((r) => (
              <label key={r} className={`reason ${reason === r ? 'is-selected' : ''}`}>
                <input type="radio" name="reason" className="sr-only" checked={reason === r} onChange={() => setReason(r)} />
                <span className="reason__dot" aria-hidden="true" />
                {r}
              </label>
            ))}
          </fieldset>
          {reason === 'Other' ? <TextArea label="Tell us more" value={other} onChange={(e) => setOther(e.target.value.slice(0, 200))} /> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
      )}
    </Dialog>
  );
}

/** Safety centre: call, text, share and alert NESAM operations. */
export function SafetyDialog({ trip, profile, location, onClose }: { trip: TripRecord; profile: UserProfile; location: LatLng | null; onClose: () => void }) {
  const [alerting, setAlerting] = useState(false);
  const [state, setState] = useState<'idle' | 'sent' | 'failed'>('idle');
  const [error, setError] = useState('');
  const { push } = useToasts();
  const emergencyLocal = localMobile(profile.emergencyContact);

  const sendAlert = async () => {
    setAlerting(true);
    setError('');
    try {
      const where = location ?? (await getCurrentPosition(8000).catch(() => null));
      await raiseSos(trip, profile, where);
      setState('sent');
    } catch (e) {
      setState('failed');
      setError(`${describeError(e, 'The alert could not be sent.')} Call ${EMERGENCY_NUMBER} or NESAM support now.`);
    } finally {
      setAlerting(false);
    }
  };

  const share = async () => {
    const result = await shareText(`NESAM ride ${trip.bookingId}`, buildTripShareText(trip, location));
    if (result === 'copied') push({ title: 'Trip details copied', message: 'Paste them into a message to share.', tone: 'success' });
  };

  const sms = `sms:+91${emergencyLocal}?body=${encodeURIComponent(`EMERGENCY — I need help.\n${buildTripShareText(trip, location)}`)}`;

  return (
    <Dialog title="Safety centre" onClose={onClose}>
      <div className="stack">
        <a className="btn btn--primary btn--lg btn--block" href={`tel:${EMERGENCY_NUMBER}`}>
          <Icon name="emergency" /> Call emergency ({EMERGENCY_NUMBER})
        </a>
        <a className="btn btn--secondary btn--block" href={`tel:${SUPPORT_PHONE}`}>
          <Icon name="phone" /> Call NESAM support ({SUPPORT_PHONE_DISPLAY})
        </a>
        {emergencyLocal ? (
          <a className="btn btn--secondary btn--block" href={sms}>
            <Icon name="chat" /> Text emergency contact ({formatPhone(emergencyLocal)})
          </a>
        ) : null}
        <Button variant="secondary" block icon="share" onClick={() => void share()}>
          Share trip details
        </Button>
        <div className="sos">
          <h3>Alert the NESAM safety team</h3>
          <p className="muted small">Sends your booking, driver, vehicle and location to NESAM operations.</p>
          {state === 'sent' ? <Notice tone="success">Alert sent. The NESAM team has your trip and location.</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button variant="dark" block loading={alerting} onClick={() => void sendAlert()}>
            {state === 'sent' ? 'Send again' : 'Send SOS alert'}
          </Button>
        </div>
        {trip.driver ? (
          <p className="muted small">
            Your ride: {trip.driver.name} · {trip.driver.vehicleNumber || trip.categoryName} · Booking {trip.bookingId}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

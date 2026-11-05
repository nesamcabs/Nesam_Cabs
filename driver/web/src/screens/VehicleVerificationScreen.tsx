import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { TripDetails } from '../types';
import { CameraCapture } from '../components/CameraCapture';
import { Icon, type IconName } from '../components/nx/Icon';
import { ActionError } from '../services/callables';
import { getFirebaseLocation } from '../services/location';
import {
  SLOTS,
  createCaptureSession,
  finalizeVehicleVerification,
  getSlotChallenge,
  submitCapturePhoto,
  uploadCapture,
  type CaptureSession,
  type Challenge,
  type Slot,
} from '../services/verificationService';

interface Props {
  trip: TripDetails;
  onDone: () => void;
  onCancel: () => void;
}

type Phase = 'intro' | 'starting' | 'capturing' | 'review' | 'uploading' | 'odometer' | 'submitting';

const SLOT_ICON: Record<Slot, IconName> = { selfie: 'user', front: 'car', rear: 'car', interior: 'car' };
const SUBJECT: Record<Slot, string> = { selfie: 'selfie', front: 'vehicle front', rear: 'vehicle rear', interior: 'dashboard' };

/**
 * Step-by-step vehicle verification: selfie, front, rear, then dashboard/interior. Each step shows a short-lived
 * instruction, opens the live camera (no gallery), lets the driver retake, and only moves on once the server has
 * accepted the photo. The server session, challenge and finalize calls are unchanged.
 */
export const VehicleVerificationScreen: React.FC<Props> = ({ trip, onDone, onCancel }) => {
  const [phase, setPhase] = useState<Phase>('intro');
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [index, setIndex] = useState(0);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string; at: number } | null>(null);
  const [accepted, setAccepted] = useState<Partial<Record<Slot, string>>>({});
  const [reading, setReading] = useState('');
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [consent, setConsent] = useState(false);
  const urls = useRef<string[]>([]);

  const step = SLOTS[index];
  const allDone = SLOTS.every((s) => accepted[s.slot]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  // Countdown for the current instruction.
  useEffect(() => {
    if (!challenge || phase === 'odometer' || phase === 'submitting') return undefined;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((challenge.expiresAtMs - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [challenge, phase]);

  const fail = (err: unknown, fallback: string) => setError(err instanceof ActionError ? err.message : fallback);

  const openStep = useCallback(async (sessionId: string, i: number) => {
    setError('');
    setShot(null);
    setChallenge(null);
    setPhase('starting');
    try {
      setChallenge(await getSlotChallenge(sessionId, SLOTS[i].slot));
      setIndex(i);
      setPhase('capturing');
    } catch (err) {
      fail(err, 'Could not get the instruction for this photo.');
      setIndex(i);
      setPhase('capturing');
    }
  }, []);

  const begin = async () => {
    setError('');
    setPhase('starting');
    try {
      const s = await createCaptureSession(trip.id);
      setSession(s);
      await openStep(s.sessionId, 0);
    } catch (err) {
      fail(err, 'Could not start the verification.');
      setPhase('intro');
    }
  };

  const onCapture = (blob: Blob, at: number) => {
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    setShot({ blob, url, at });
    setPhase('review');
  };

  const usePhoto = async () => {
    if (!session || !challenge || !shot) return;
    if (Date.now() > challenge.expiresAtMs) {
      await openStep(session.sessionId, index);
      setError('That instruction expired. A new one has been issued — take the photo again.');
      return;
    }
    setError('');
    setPhase('uploading');
    try {
      const gps = await getFirebaseLocation(6000);
      await uploadCapture(challenge, session.sessionId, shot.blob);
      await submitCapturePhoto({ sessionId: session.sessionId, slot: step.slot, storagePath: challenge.storagePath, capturedAt: shot.at, gps });
      setAccepted((a) => ({ ...a, [step.slot]: shot.url }));
      if (index + 1 < SLOTS.length) await openStep(session.sessionId, index + 1);
      else setPhase('odometer');
    } catch (err) {
      const message = err instanceof ActionError ? err.message : 'The photo could not be submitted. Take it again.';
      // A rejected photo needs a fresh instruction before the next try.
      await openStep(session.sessionId, index);
      setError(message);
    }
  };

  const submit = async () => {
    const n = Number(reading);
    if (!session) return;
    if (!Number.isInteger(n) || n <= 0) return setError('Enter the starting odometer reading in km.');
    setError('');
    setPhase('submitting');
    try {
      await finalizeVehicleVerification(session.sessionId, n);
      onDone();
    } catch (err) {
      fail(err, 'The verification could not be submitted.');
      setPhase('odometer');
    }
  };

  const back = (
    <button type="button" className="trip-back" onClick={onCancel}>
      <Icon name="chevron" />
      Trip
    </button>
  );

  const errorBox = <div className="nx-form-error" role="alert">{error}</div>;

  const checklist = (withRetake: boolean) => (
    <div className="nx-photo-checks">
      {SLOTS.map((s, i) => (
        <div className={`nx-photo-check ${accepted[s.slot] ? 'is-captured' : ''}`} key={s.slot}>
          <div className="nx-photo-thumb">{accepted[s.slot] ? <img src={accepted[s.slot]} alt={`${s.label} captured`} /> : <Icon name={SLOT_ICON[s.slot]} />}</div>
          <div className="nx-photo-copy">
            <small>STEP {i + 1}</small>
            <strong>{s.label}</strong>
            <p>{accepted[s.slot] ? 'Captured live' : s.hint}</p>
          </div>
          {withRetake && accepted[s.slot] && session ? (
            <button type="button" className="nx-photo-action" disabled={phase === 'submitting'} onClick={() => void openStep(session.sessionId, i)}>
              Retake
              <Icon name="refresh" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );

  if (phase === 'intro') {
    return (
      <div className="trip-flow nx-camera-page">
        {back}
        <div className="nx-trip-meta">{trip.bookingId}{session?.vehicleNumber ? ` · ${session.vehicleNumber}` : ''}</div>
        <h2 className="nx-route-title">Vehicle photo check</h2>
        <p className="nx-copy" style={{ marginTop: 8 }}>Take your live selfie and the vehicle photos, one at a time, then enter the starting odometer reading. This safety check is required before the trip can start.</p>
        <section className="nx-panel" style={{ marginTop: 18 }}>
          {checklist(false)}
          <p className="nx-copy" style={{ marginTop: 16 }}>
            For each photo the app shows a short instruction and a 4-digit code that expire after a few minutes. Take the photo straight away. Photos from the gallery, old photos or photos of another screen are not accepted, and suspicious photos are flagged to NESAM.
          </p>
          <label className="nx-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I understand that the photos, the time they were taken and (if I allow it) my location are saved and shared with NESAM to verify the vehicle.</span>
          </label>
          {errorBox}
          <div className="nx-actions">
            <button type="button" className="nx-button primary" onClick={() => void begin()} disabled={!consent}>
              Start photo check <Icon name="camera" />
            </button>
          </div>
          <p className="nx-camera-only">
            <Icon name="shield" />
            Camera only · No gallery upload
          </p>
        </section>
      </div>
    );
  }

  if (phase === 'odometer' || phase === 'submitting') {
    return (
      <div className="trip-flow nx-camera-page">
        {back}
        <div className="nx-camera-top">
          <span className="nx-eyebrow">Final step</span>
          <span className="nx-live-badge"><span />All photos accepted</span>
        </div>
        <h2 className="nx-route-title">Starting odometer</h2>
        <p className="nx-copy" style={{ marginTop: 8 }}>Enter the reading shown on the dashboard, then submit the check.</p>
        <section className="nx-panel" style={{ marginTop: 18 }}>
          {checklist(true)}
          <label className="nx-field nx-running" htmlFor="odometer">
            Starting odometer reading
          </label>
          <div className="nx-km-control">
            <input
              id="odometer"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="e.g. 48210"
              value={reading}
              onChange={(e) => setReading(e.target.value.replace(/[^\d]/g, ''))}
            />
            <span aria-hidden="true">km</span>
          </div>
          {errorBox}
          <div className="nx-actions">
            <button type="button" className="nx-button primary" onClick={() => void submit()} disabled={phase === 'submitting' || !allDone}>
              {phase === 'submitting' ? 'Submitting…' : 'Submit verification'} <Icon name="check" />
            </button>
            <button type="button" className="nx-button" onClick={() => session && void openStep(session.sessionId, 0)} disabled={phase === 'submitting'}>
              Retake photos
            </button>
          </div>
        </section>
      </div>
    );
  }

  const subject = SUBJECT[step.slot];
  const urgent = secondsLeft <= 30;
  return (
    <div className="trip-flow nx-camera-page">
      {back}
      <div className="nx-camera-top">
        <span className="nx-eyebrow">
          Step {index + 1} of {SLOTS.length}
        </span>
        <span className="nx-live-badge">
          <span />
          {phase === 'review' || phase === 'uploading' ? 'Captured live' : 'Live camera'}
        </span>
      </div>
      <h2 className="nx-route-title">{step.slot === 'selfie' ? 'Take a live selfie' : `Capture ${subject}`}</h2>
      <p className="nx-copy" style={{ marginTop: 8 }}>{step.hint}</p>

      {challenge ? (
        <div className={`nx-status ${urgent ? 'amber' : ''}`} style={{ marginTop: 16 }}>
          <Icon name="clock" />
          <span>
            Now: {challenge.instruction}. Show or write this code in the photo if you can: <strong>{challenge.code}</strong> · {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} left
          </span>
        </div>
      ) : phase !== 'starting' ? (
        <div className="nx-actions" style={{ marginTop: 16 }}>
          <button type="button" className="nx-button" onClick={() => session && void openStep(session.sessionId, index)}>
            Get the instruction again
          </button>
        </div>
      ) : null}

      {phase === 'starting' ? (
        <div className={`nx-camera-frame ${step.slot === 'selfie' ? 'is-selfie' : 'is-car'}`} role="status">
          <div className="nx-camera-placeholder">
            <Icon name={SLOT_ICON[step.slot]} />
            <span>Preparing…</span>
          </div>
        </div>
      ) : null}
      {phase === 'capturing' && challenge ? <CameraCapture key={step.slot} facing={step.slot === 'selfie' ? 'user' : 'environment'} subject={subject} onCapture={onCapture} /> : null}
      {(phase === 'review' || phase === 'uploading') && shot ? (
        <>
          <div className={`nx-camera-frame ${step.slot === 'selfie' ? 'is-selfie' : 'is-car'}`}>
            <img className="nx-camera-result" src={shot.url} alt={`${step.label} captured from the live camera`} />
          </div>
          <p className="nx-camera-message" role="status">{phase === 'uploading' ? 'Checking the photo…' : 'Check that the photo is clear before continuing.'}</p>
          {errorBox}
          <div className="nx-actions">
            <button type="button" className="nx-button primary" onClick={() => void usePhoto()} disabled={phase === 'uploading'}>
              {phase === 'uploading' ? 'Checking…' : 'Use this photo'} <Icon name="check" />
            </button>
            <button
              type="button"
              className="nx-button"
              disabled={phase === 'uploading'}
              onClick={() => {
                setShot(null);
                setPhase('capturing');
              }}
            >
              Retake live photo
            </button>
          </div>
        </>
      ) : phase === 'capturing' ? (
        errorBox
      ) : null}
      <p className="nx-camera-only">
        <Icon name="shield" />
        Camera only · No gallery upload
      </p>
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './nx/Icon';

interface CameraCaptureProps {
  /** Called with the JPEG and the moment it was taken. */
  onCapture: (blob: Blob, capturedAtMs: number) => void;
  disabled?: boolean;
  /** 'user' opens the front (selfie) camera; the default is the rear camera. */
  facing?: 'user' | 'environment';
  /** What is being photographed, for the labels ("selfie", "vehicle front"). */
  subject?: string;
}

const MAX_EDGE = 1600;

function explain(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  if (!window.isSecureContext) return 'The camera needs a secure (https) connection. Open the app from its https address.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was denied. Allow camera access for this site in your browser settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  return 'The camera could not be started. Try again.';
}

/**
 * A live camera view in the reference's frame (guide outline, placeholder while the stream starts). There is
 * deliberately no file picker or gallery option: the only way to produce a photo here is to take it now with the camera.
 */
export const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, disabled, facing = 'environment', subject = 'photo' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'starting' | 'live' | 'error'>('starting');
  const [error, setError] = useState('');
  const selfie = facing === 'user';

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setState('starting');
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotFoundError' });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => undefined);
      }
      setState('live');
    } catch (err) {
      setError(explain(err));
      setState('error');
    }
  }, [facing]);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const at = Date.now();
    canvas.toBlob((b) => b && onCapture(b, at), 'image/jpeg', 0.88);
  };

  return (
    <>
      <div className={`nx-camera-frame ${selfie ? 'is-selfie' : 'is-car'}`}>
        <video ref={videoRef} playsInline muted autoPlay aria-label={`Live ${subject} camera`} />
        {state !== 'live' ? (
          <div className="nx-camera-placeholder" role={state === 'error' ? 'alert' : 'status'}>
            <Icon name={selfie ? 'user' : 'car'} />
            <span>{state === 'starting' ? 'Starting camera…' : `Live ${subject} camera`}</span>
          </div>
        ) : null}
        <div className="nx-camera-guide" aria-hidden="true" />
      </div>
      <p className="nx-camera-message" role="status">
        {state === 'live' ? 'Camera ready. Photos cannot be selected from your gallery.' : 'Camera access is required. Photos cannot be selected from your gallery.'}
      </p>
      <div className="nx-form-error" role="alert">
        {error}
      </div>
      <div className="nx-actions">
        <button type="button" className="nx-button primary" onClick={snap} disabled={disabled || state !== 'live'}>
          Capture {subject} <Icon name="camera" />
        </button>
        <button type="button" className="nx-button" onClick={() => void start()} disabled={state === 'starting'}>
          Open camera
        </button>
      </div>
    </>
  );
};

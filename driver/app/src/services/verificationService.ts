/**
 * Pre-trip evidence: the driver's own selfie, then vehicle front, rear and dashboard/interior, taken live with
 * the in-app camera inside a short-lived session the server issues. Each photo is
 * uploaded to a path the server named and then checked by the server; a retake
 * is a brand-new upload. The gallery is never offered, and nothing here can mark
 * a trip verified by itself — the server decides and records every photo's signals.
 */
import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '../config/firebase';
import { callFunction } from './callables';
import { uriToBlob } from './storageService';
import type { Fix } from './tripService';

export type Slot = 'selfie' | 'front' | 'rear' | 'interior';
export const SLOTS: { slot: Slot; label: string; hint: string }[] = [
  { slot: 'selfie', label: 'Driver Selfie', hint: 'Face the camera with your face fully visible. Remove sunglasses and keep your cap off.' },
  { slot: 'front', label: 'Vehicle Front', hint: 'Stand in front so the whole front and the number plate are visible.' },
  { slot: 'rear', label: 'Vehicle Rear', hint: 'Stand behind the vehicle so the whole rear and the number plate are visible.' },
  { slot: 'interior', label: 'Dashboard / Interior', hint: 'Show the dashboard, steering wheel and odometer.' },
];

export interface CaptureSession {
  sessionId: string;
  expiresAtMs: number;
  vehicleNumber: string;
}

export interface Challenge {
  slot: Slot;
  instruction: string;
  code: string;
  expiresAtMs: number;
  storagePath: string;
}

export const createCaptureSession = (bookingId: string) => callFunction<unknown, CaptureSession>('createCaptureSession', { bookingId, platform: 'android' });

export const getSlotChallenge = (sessionId: string, slot: Slot) => callFunction<unknown, Challenge>('getSlotChallenge', { sessionId, slot });

/** Uploads the camera photo to the server-issued path, tagged as a camera capture for this session and slot. */
export async function uploadCapture(challenge: Challenge, sessionId: string, fileUri: string): Promise<void> {
  const blob = await uriToBlob(fileUri);
  await uploadBytes(ref(storage, challenge.storagePath), blob, {
    contentType: 'image/jpeg',
    customMetadata: { source: 'camera_session', sessionId, slot: challenge.slot },
  });
}

export const submitCapturePhoto = (args: { sessionId: string; slot: Slot; storagePath: string; capturedAt: number; gps: Fix | null }) =>
  callFunction<unknown, { accepted: boolean; flagged: boolean }>(
    'submitCapturePhoto',
    { sessionId: args.sessionId, slot: args.slot, storagePath: args.storagePath, capturedAt: args.capturedAt, gps: args.gps ?? undefined },
    120000,
  );

export const finalizeVehicleVerification = (sessionId: string, odometerReading: number) =>
  callFunction<unknown, { ok: boolean; flagged: boolean }>('finalizeVehicleVerification', { sessionId, odometerReading });

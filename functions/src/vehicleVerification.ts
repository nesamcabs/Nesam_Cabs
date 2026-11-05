// Mandatory pre-trip vehicle photos: front, rear and dashboard/interior.
//
// Flow (every step is checked here, not in the app):
//   1. createCaptureSession   – short-lived session tied to driver, booking, vehicle
//   2. getSlotChallenge       – a random instruction + code, valid for three minutes
//   3. the app takes the photo with the camera and uploads it to the session path
//   4. submitCapturePhoto     – the server reads the uploaded file and scores it
//   5. finalizeVehicleVerification – all three present → verification is Submitted
//
// The scoring is a set of SIGNALS (reused file, near-duplicate, missing or
// mismatching metadata, screenshot dimensions, glare, screen-moiré). They flag
// a photo for admin review; none of them proves a photo is genuine or fake.
// Exact reuse of a file from another trip is refused outright.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import exifr from 'exifr';
import { db } from './admin';
import { audit } from './audit';
import { notify } from './notify';
import { assertDeviceTrusted, logSecurityEvent, requestIp } from './security';
import { tripSubStatusOf } from './domain/bookingFlow';
import {
  CAPTURE_SESSION_MS, INSTRUCTION_MS, MAX_CAPTURE_TO_UPLOAD_MS, MAX_FILE_BYTES, NEAR_DUPLICATE_DISTANCE, RiskSignal, SLOT_FIELD, SLOT_LABEL, VEHICLE_SLOTS,
  VehicleSlot, analyzeImage, hammingDistance, isVehicleSlot, looksLikeScreenshot, perceptualHash, randomInstruction, randomVerificationCode, scoreSignals, sha256Hex,
} from './domain/verification';
import { approved, inIndia, text } from './shared';

const docId = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw new HttpsError('invalid-argument', `Invalid ${what}.`);
  return v;
};

async function activeDriver(uid: string | undefined) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const d = await db.doc(`drivers/${uid}`).get();
  const p = d.data();
  if (!d.exists || !p || !approved(p.status) || p.fleetStatus === 'Suspended') throw new HttpsError('permission-denied', 'Your driver account is not active.');
  return { uid, name: text(p.name) };
}

/**
 * Where a photo must be uploaded. The name carries the moment its instruction was
 * issued, so a retake is always a brand-new object (storage never overwrites).
 */
export const photoPath = (uid: string, bookingId: string, sessionId: string, slot: VehicleSlot, issuedAtMs: number) =>
  `drivers/${uid}/trips/${bookingId}/verification/${sessionId}/${slot}-${issuedAtMs}.jpg`;

export const createCaptureSession = onCall(async (request) => {
  const driver = await activeDriver(request.auth?.uid);
  const bookingId = docId(request.data?.bookingId, 'booking');
  const platform = text(request.data?.platform, 12) || 'android';
  await assertDeviceTrusted(driver.uid, platform);
  const bookingRef = db.doc(`bookings/${bookingId}`);
  const sessionRef = db.collection('capture_sessions').doc();
  return db.runTransaction(async (tx) => {
    const [snap, open] = await Promise.all([
      tx.get(bookingRef),
      tx.get(db.collection('capture_sessions').where('bookingId', '==', bookingId).where('status', '==', 'open')),
    ]);
    if (!snap.exists) throw new HttpsError('not-found', 'This trip no longer exists.');
    const b = snap.data()!;
    if (b.assignedDriverId !== driver.uid) throw new HttpsError('permission-denied', 'This trip is not assigned to you.');
    // Before leaving or at the pickup — any time before Trip Started.
    if (!['Assigned', 'Confirmed'].includes(b.status) || !['Not Started', 'Reached Pickup'].includes(tripSubStatusOf(b))) throw new HttpsError('failed-precondition', 'Vehicle verification is only needed before the trip starts.');
    const done = await tx.get(db.doc(`vehicle_verifications/${bookingId}`));
    if (done.exists && done.data()!.status === 'Submitted' && done.data()!.driverId === driver.uid) {
      throw new HttpsError('failed-precondition', 'Vehicle verification is already submitted for this trip. Ask NESAM if it must be redone.');
    }
    // A new session replaces any earlier one: old photos can no longer be submitted.
    for (const s of open.docs) tx.update(s.ref, { status: 'superseded' });
    const now = Date.now();
    tx.create(sessionRef, {
      id: sessionRef.id, driverId: driver.uid, bookingId, tripId: bookingId, vehicleId: text(b.assignedVehicleId), vehicleNumber: text(b.assignedVehicleNumber),
      platform, status: 'open', challenges: {}, submitted: {}, createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(now + CAPTURE_SESSION_MS),
    });
    return {
      sessionId: sessionRef.id, expiresAtMs: now + CAPTURE_SESSION_MS,
      slots: VEHICLE_SLOTS.map((s) => ({ slot: s, label: SLOT_LABEL[s] })), vehicleNumber: text(b.assignedVehicleNumber),
    };
  });
});

async function loadSession(sessionId: string, uid: string) {
  const ref = db.doc(`capture_sessions/${sessionId}`);
  const snap = await ref.get();
  const s = snap.data();
  if (!snap.exists || !s || s.driverId !== uid) throw new HttpsError('permission-denied', 'This capture session is not yours.');
  if (s.status !== 'open') throw new HttpsError('failed-precondition', 'This capture session is no longer valid. Start the verification again.');
  if ((s.expiresAt as Timestamp).toMillis() < Date.now()) {
    await ref.update({ status: 'expired' });
    throw new HttpsError('failed-precondition', 'The capture session expired. Start the verification again.');
  }
  return { ref, s };
}

export const getSlotChallenge = onCall(async (request) => {
  const driver = await activeDriver(request.auth?.uid);
  const sessionId = docId(request.data?.sessionId, 'session');
  if (!isVehicleSlot(request.data?.slot)) throw new HttpsError('invalid-argument', 'Choose selfie, front, rear or interior.');
  const slot: VehicleSlot = request.data.slot;
  const { ref, s } = await loadSession(sessionId, driver.uid);
  const now = Date.now();
  const challenge = { instruction: randomInstruction(slot), code: randomVerificationCode(), issuedAtMs: now, expiresAtMs: now + INSTRUCTION_MS, used: false };
  await ref.update({ [`challenges.${slot}`]: challenge });
  return {
    slot, label: SLOT_LABEL[slot], instruction: challenge.instruction, code: challenge.code, expiresAtMs: challenge.expiresAtMs,
    storagePath: photoPath(driver.uid, String(s.bookingId), sessionId, slot, now),
  };
});

interface Prior { sha: string; phash: string; bookingId: string; slot: string; sessionId: string }

export const submitCapturePhoto = onCall({ timeoutSeconds: 120, memory: '1GiB' }, async (request) => {
  const driver = await activeDriver(request.auth?.uid);
  const input = request.data ?? {};
  const sessionId = docId(input.sessionId, 'session');
  if (!isVehicleSlot(input.slot)) throw new HttpsError('invalid-argument', 'Choose selfie, front, rear or interior.');
  const slot: VehicleSlot = input.slot;
  const { ref: sessionRef, s } = await loadSession(sessionId, driver.uid);
  const bookingId: string = s.bookingId;
  const ch = s.challenges?.[slot];
  const ip = requestIp(request);
  const path = ch ? photoPath(driver.uid, bookingId, sessionId, slot, ch.issuedAtMs) : '';
  if (!path || input.storagePath !== path) throw new HttpsError('invalid-argument', 'The photo was not uploaded to the capture session. Request the instruction for this photo first.');
  const reject = async (type: string, message: string) => {
    await logSecurityEvent({ type, severity: 'medium', userId: driver.uid, role: 'driver', bookingId, source: 'server', details: { slot, sessionId }, ip }).catch(() => null);
    throw new HttpsError('failed-precondition', message);
  };
  if (!ch) return reject('invalid_capture_session', 'Open the instruction for this photo before capturing it.');
  if (ch.used === true) throw new HttpsError('failed-precondition', 'This instruction was already used. Request a new one to retake the photo.');
  if (ch.expiresAtMs < Date.now()) throw new HttpsError('failed-precondition', 'The instruction for this photo expired. Request a new one and capture again.');

  const file = getStorage().bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('failed-precondition', 'The photo has not finished uploading. Try again.');
  const [meta] = await file.getMetadata();
  const size = Number(meta.size ?? 0);
  if (meta.contentType !== 'image/jpeg') await reject('invalid_capture_session', 'Only camera photos in JPEG format are accepted.');
  if (!(size > 10 * 1024) || size > MAX_FILE_BYTES) await reject('invalid_capture_session', 'The photo is too small or too large. Capture it again with the camera.');
  if (meta.metadata?.source !== 'camera_session' || meta.metadata?.sessionId !== sessionId || meta.metadata?.slot !== slot) {
    await reject('gallery_capture_attempt', 'Photos must be captured live with the in-app camera. Gallery or file uploads are not accepted.');
  }
  const uploadedAtMs = new Date(String(meta.timeCreated)).getTime();
  const [bytes] = await file.download();

  const signals: RiskSignal[] = [];
  const sig = (code: string, weight: number, message: string) => signals.push({ code, weight, message });
  // Capture time: the photo must be taken after the instruction was shown and uploaded promptly.
  const capturedAtMs = typeof input.capturedAt === 'number' && Number.isFinite(input.capturedAt) ? input.capturedAt : 0;
  if (capturedAtMs && capturedAtMs < ch.issuedAtMs - 5000) sig('captured_before_instruction', 40, 'The photo was taken before the instruction was shown.');
  if (uploadedAtMs - ch.issuedAtMs > MAX_CAPTURE_TO_UPLOAD_MS + 60000) sig('slow_upload', 15, 'The photo was uploaded long after the instruction.');
  if (capturedAtMs && Math.abs(uploadedAtMs - capturedAtMs) > MAX_CAPTURE_TO_UPLOAD_MS) sig('capture_upload_gap', 25, 'The reported capture time is far from the upload time.');

  // Embedded metadata (can be stripped or edited, so it only adds signals).
  let hasCameraExif = false;
  let exifTimeMs = 0;
  try {
    const x: any = await exifr.parse(bytes, { pick: ['Make', 'Model', 'DateTimeOriginal', 'CreateDate', 'Software'] });
    hasCameraExif = !!(x?.Make || x?.Model);
    const t = x?.DateTimeOriginal ?? x?.CreateDate;
    exifTimeMs = t instanceof Date ? t.getTime() : 0;
    if (typeof x?.Software === 'string' && /photoshop|gimp|snapseed|lightroom|canva/i.test(x.Software)) sig('edited_software', 50, `Edited with ${String(x.Software).slice(0, 30)}.`);
  } catch { /* unreadable EXIF is treated as absent */ }
  if (!hasCameraExif) sig('no_camera_metadata', 10, 'No camera metadata (stripped, or taken by a non-camera source).');
  if (exifTimeMs) {
    const age = uploadedAtMs - exifTimeMs;
    if (age > 24 * 3600000) sig('old_photo', 60, 'The camera timestamp inside the file is more than a day old.');
    else if (Math.abs(age) > 10 * 60000) sig('exif_time_mismatch', 30, 'The camera timestamp inside the file does not match the upload time.');
  }

  // Duplicates. Exact reuse is refused; near-duplicates are flagged.
  const sha = sha256Hex(bytes);
  const phash = perceptualHash(bytes);
  const hashRef = db.doc(`vehicle_photo_hashes/${sha}`);
  const [exact, byVehicle, byDriver, sameSession] = await Promise.all([
    hashRef.get(),
    s.vehicleId ? db.collection('vehicle_photo_hashes').where('vehicleId', '==', s.vehicleId).orderBy('createdAt', 'desc').limit(100).get() : Promise.resolve(null),
    db.collection('vehicle_photo_hashes').where('driverId', '==', driver.uid).orderBy('createdAt', 'desc').limit(100).get(),
    db.collection('vehicle_photo_hashes').where('sessionId', '==', sessionId).get(),
  ]);
  const priors = new Map<string, Prior>();
  for (const d of [...(byVehicle?.docs ?? []), ...byDriver.docs]) {
    const p = d.data();
    if (p.sessionId !== sessionId && p.bookingId !== bookingId) priors.set(d.id, { sha: d.id, phash: String(p.phash ?? ''), bookingId: p.bookingId, slot: p.slot, sessionId: p.sessionId });
  }
  if (exact.exists && exact.data()!.sessionId !== sessionId) {
    await file.delete().catch(() => null);
    await logSecurityEvent({ type: 'reused_vehicle_photo', severity: 'high', userId: driver.uid, role: 'driver', bookingId, source: 'server', details: { slot, sessionId, firstUsedOn: String(exact.data()!.bookingId) }, ip });
    throw new HttpsError('failed-precondition', 'This exact photo was already submitted before. Capture a new photo with the camera.');
  }
  if (phash) {
    for (const p of priors.values()) {
      if (p.phash && hammingDistance(phash, p.phash) <= NEAR_DUPLICATE_DISTANCE) { sig('near_duplicate_other_trip', 60, 'Looks almost identical to a photo from another trip.'); break; }
    }
    for (const d of sameSession.docs) {
      if (d.data().slot !== slot && d.data().phash && hammingDistance(phash, d.data().phash) <= 4) { sig('same_picture_two_slots', 50, `Looks the same as the ${SLOT_LABEL[d.data().slot as VehicleSlot] ?? 'other'} photo.`); break; }
    }
  } else sig('image_unreadable', 15, 'The image could not be analysed.');

  // Pixel signals.
  const img = analyzeImage(bytes);
  if (img) {
    if (Math.max(img.width, img.height) < 640) sig('low_resolution', 15, 'Very low resolution.');
    if (looksLikeScreenshot(img.width, img.height, hasCameraExif)) sig('screenshot_dimensions', 40, 'The size matches a phone screen capture.');
    if (img.glareRatio > 0.25) sig('display_glare', 20, 'Large bright glare, as when photographing a screen.');
    if (img.moireScore > 2.4) sig('screen_moire', 30, 'Fine repeating texture typical of photographing a display.');
  }
  // Location at capture (shared voluntarily by the driver).
  const gps = inIndia(input.gps?.lat, input.gps?.lng) ? { lat: input.gps.lat as number, lng: input.gps.lng as number, accuracy: Number.isFinite(input.gps.accuracy) ? Math.round(input.gps.accuracy) : null } : null;
  if (!gps) sig('no_location', 5, 'Location was not shared for this photo.');
  const risk = scoreSignals(signals);

  const entry = {
    path, sha256: sha, phash: phash ?? '', capturedAtMs, uploadedAtMs, gps, width: img?.width ?? 0, height: img?.height ?? 0, bytes: size,
    instruction: ch.instruction, code: ch.code, riskScore: risk.score, riskLevel: risk.level, signals,
  };
  const verRef = db.doc(`vehicle_verifications/${bookingId}`);
  await db.runTransaction(async (tx) => {
    const [cur, sess] = await Promise.all([tx.get(verRef), tx.get(sessionRef)]);
    if (sess.data()!.status !== 'open') throw new HttpsError('failed-precondition', 'This capture session is no longer valid. Start the verification again.');
    const base = cur.exists && cur.data()!.sessionId === sessionId ? cur.data()! : null;
    const photos = { ...(base?.photos ?? {}), [slot]: entry };
    tx.set(verRef, {
      bookingId, tripId: bookingId, driverId: driver.uid, vehicleId: s.vehicleId, vehicleNumber: s.vehicleNumber, sessionId, status: 'InProgress',
      photos, [SLOT_FIELD[slot]]: path, capturedAt: base?.capturedAt ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      ...(base ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    tx.update(sessionRef, { [`challenges.${slot}.used`]: true, [`submitted.${slot}`]: true });
    tx.set(hashRef, { driverId: driver.uid, bookingId, vehicleId: s.vehicleId, slot, sessionId, phash: phash ?? '', createdAt: FieldValue.serverTimestamp() });
  });
  return { slot, label: SLOT_LABEL[slot], accepted: true, flagged: risk.level !== 'low' };
});

export const finalizeVehicleVerification = onCall(async (request) => {
  const driver = await activeDriver(request.auth?.uid);
  const sessionId = docId(request.data?.sessionId, 'session');
  const reading = request.data?.odometerReading;
  if (!Number.isSafeInteger(reading) || reading <= 0 || reading > 5000000) throw new HttpsError('invalid-argument', 'Enter the starting odometer reading in kilometres.');
  const { ref: sessionRef, s } = await loadSession(sessionId, driver.uid);
  const bookingId: string = s.bookingId;
  const verRef = db.doc(`vehicle_verifications/${bookingId}`);
  const bookingRef = db.doc(`bookings/${bookingId}`);
  const res = await db.runTransaction(async (tx) => {
    const [ver, b] = await Promise.all([tx.get(verRef), tx.get(bookingRef)]);
    const v = ver.data();
    if (!ver.exists || !v || v.sessionId !== sessionId || v.driverId !== driver.uid) throw new HttpsError('failed-precondition', 'No photos were captured in this session.');
    const missing = VEHICLE_SLOTS.filter((slot) => !v.photos?.[slot]);
    if (missing.length) throw new HttpsError('failed-precondition', `Capture all three photos first. Missing: ${missing.map((m) => SLOT_LABEL[m]).join(', ')}.`, { missing });
    if (!b.exists || b.data()!.assignedDriverId !== driver.uid) throw new HttpsError('permission-denied', 'This trip is no longer assigned to you.');
    const scores = VEHICLE_SLOTS.map((slot) => v.photos[slot].riskScore as number);
    const score = Math.min(100, Math.max(...scores) + (scores.filter((x) => x >= 25).length > 1 ? 15 : 0));
    const level = score >= 60 ? 'high' : score >= 25 ? 'medium' : 'low';
    const flagged = level !== 'low';
    const stamp = FieldValue.serverTimestamp();
    tx.update(verRef, { status: 'Submitted', odometerReading: reading, riskScore: score, riskLevel: level, flagged, submittedAt: stamp, updatedAt: stamp });
    tx.update(sessionRef, { status: 'completed', completedAt: stamp });
    tx.update(bookingRef, {
      driverSelfiePhoto: v.driverSelfiePhoto, vehicleFrontPhoto: v.vehicleFrontPhoto, vehicleRearPhoto: v.vehicleRearPhoto, vehicleInteriorPhoto: v.vehicleInteriorPhoto,
      preTrip: { driverSelfie: v.driverSelfiePhoto, vehicleFront: v.vehicleFrontPhoto, vehicleRear: v.vehicleRearPhoto, vehicleInterior: v.vehicleInteriorPhoto, odometerReading: reading, capturedAt: new Date().toISOString(), sessionId },
      vehicleVerification: { status: 'Submitted', riskLevel: level, flagged, submittedAt: Timestamp.now() }, startOdometer: reading, updatedAt: stamp,
    });
    return { level, score, flagged, code: text(b.data()!.bookingId) || bookingId };
  });
  await audit({ action: 'vehicle_verification_submitted', entity: 'booking', entityId: bookingId, performedBy: driver.uid, performedByName: driver.name, role: 'driver', bookingId, next: { riskLevel: res.level, riskScore: res.score } });
  if (res.flagged) {
    await notify({
      recipientType: 'admin', recipientId: 'admin', category: 'trips', severity: res.level === 'high' ? 'critical' : 'warning', sound: 'general',
      title: `Vehicle photos flagged (${res.level} risk)`, message: `${driver.name} · trip ${res.code}. Review the photos before the trip proceeds.`, bookingId, bookingCode: res.code,
      cta: { label: 'Review photos', page: 'booking-detail', bookingId }, dedupeKey: `vv_flag_${bookingId}_${res.level}`, push: res.level === 'high',
    }).catch(() => null);
  }
  return { ok: true, flagged: res.flagged };
});

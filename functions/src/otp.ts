import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash, randomInt } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';

function hashOtp(code: string, bookingId: string): string {
  return createHash('sha256').update(`${bookingId}:${code}`).digest('hex');
}

/**
 * Called by the customer right before boarding. Generates a 4-digit code,
 * stores only its hash on the booking doc, and returns the plaintext code to
 * the customer's own screen — the rider reads it aloud, the driver types it
 * in (verifyBoardingOtp below), mirroring how Uber/Ola boarding codes work.
 */
export const generateBoardingOtp = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { bookingId } = (request.data ?? {}) as { bookingId?: string };
  if (!bookingId) throw new HttpsError('invalid-argument', 'bookingId is required.');

  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) throw new HttpsError('not-found', 'Booking not found.');

  const booking = bookingSnap.data()!;
  if (booking.customerId !== uid) {
    throw new HttpsError('permission-denied', 'This booking does not belong to you.');
  }

  const code = String(randomInt(1000, 10000));
  await bookingRef.update({
    boardingOtpHash: hashOtp(code, bookingId),
    boardingOtpGeneratedAt: FieldValue.serverTimestamp(),
    boardingOtpVerified: false,
  });

  return { code };
});

/**
 * Called by the assigned driver with the code the customer read aloud.
 * Verified server-side against the stored hash — never a client-side compare.
 */
export const verifyBoardingOtp = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { bookingId, code } = (request.data ?? {}) as { bookingId?: string; code?: string };
  if (!bookingId || !code) {
    throw new HttpsError('invalid-argument', 'bookingId and code are required.');
  }

  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) throw new HttpsError('not-found', 'Booking not found.');

  const booking = bookingSnap.data()!;
  if (booking.assignedDriverId !== uid) {
    throw new HttpsError('permission-denied', 'You are not the assigned driver for this booking.');
  }
  if (!booking.boardingOtpHash) {
    throw new HttpsError('failed-precondition', 'No boarding OTP has been generated for this booking yet.');
  }

  if (booking.boardingOtpHash !== hashOtp(code, bookingId)) {
    throw new HttpsError('invalid-argument', 'Incorrect OTP.');
  }

  await bookingRef.update({
    boardingOtpVerified: true,
    boardingOtpVerifiedAt: FieldValue.serverTimestamp(),
    status: 'Trip Started',
  });

  return { verified: true };
});

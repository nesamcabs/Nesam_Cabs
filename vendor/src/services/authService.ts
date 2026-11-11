// Phone-number sign-in (Firebase Auth), native version of
// vendor/web/src/services/authService.ts. Same Auth users as the Web panel.
import {
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut as firebaseSignOut,
  type ApplicationVerifier,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { auth } from '../config/firebase';
import type { NativeRecaptchaVerifier } from '../components/RecaptchaVerifier';

export async function sendOtpToPhone(phoneE164: string, verifier: NativeRecaptchaVerifier): Promise<ConfirmationResult> {
  // The SDK only needs `type`, `verify()` and `_reset()` from its verifier.
  const appVerifier: ApplicationVerifier = verifier;
  return signInWithPhoneNumber(auth, phoneE164, appVerifier);
}

export async function confirmOtpCode(confirmation: ConfirmationResult, code: string): Promise<User> {
  const credential = await confirmation.confirm(code);
  return credential.user;
}

export function subscribeToAuthUser(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}

/** User-facing message for a Firebase phone-auth failure (never logs the OTP). */
export function describePhoneAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  if (__DEV__) console.warn('[auth]', code);
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'Enter a valid 10-digit mobile number (+91).';
    case 'auth/missing-phone-number':
      return 'Please enter your mobile number.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/invalid-verification-code':
      return 'Incorrect OTP. Please check your SMS and try again.';
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'This OTP has expired. Tap "Resend code" to get a new one.';
    case 'auth/missing-verification-code':
      return 'Please enter the 6-digit OTP.';
    case 'auth/network-request-failed':
      return 'Network connection failed. Please check your internet.';
    case 'auth/quota-exceeded':
      return 'SMS limit reached for today. Please try again later or contact support.';
    case 'auth/operation-not-allowed':
      return 'Phone sign-in is currently unavailable. Please contact support.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    case 'auth/cancelled':
      return 'Verification cancelled.';
    case 'auth/timeout':
      return 'The security check timed out. Please try again.';
    case 'auth/captcha-check-failed':
    case 'auth/invalid-app-credential':
      return 'The security check failed. Please try again.';
    default:
      return 'Unable to complete verification. Please try again.';
  }
}

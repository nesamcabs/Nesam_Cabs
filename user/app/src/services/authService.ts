// Phone-number sign-in (Firebase Auth), native version of
// user/web/src/services/authService.ts. Same Auth users as the Web panel.
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

/** Customer-facing message for a Firebase phone-auth failure (setup details stay in the developer log). */
export function describePhoneAuthError(error: unknown): string {
  const err = error as {
    code?: string;
    message?: string;
    customData?: {
      serverResponse?: {
        error?: {
          message?: string;
          code?: number;
        };
      };
    };
  };

  const code = err?.code ?? '';
  const serverMsg = (err?.customData?.serverResponse?.error?.message ?? err?.message ?? '').toUpperCase();

  if (__DEV__) {
    console.warn('[auth error]', { code, serverMsg, err });
  }

  const has = (...needles: string[]) => needles.some((n) => serverMsg.includes(n));

  if (code === 'auth/unauthorized-domain' || has('SITE_MISMATCH')) {
    return 'Sign-in isn’t available right now. Please update the app or try again later.';
  }

  if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded' || has('TOO_MANY_ATTEMPTS_TRY_LATER', 'SMS_QUOTA_EXCEEDED')) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }

  if (code === 'auth/operation-not-allowed' || has('OPERATION_NOT_ALLOWED', 'BILLING_NOT_ENABLED')) {
    return 'We can’t send verification codes right now. Please try again later or contact support.';
  }

  if (code === 'auth/invalid-app-credential' || code === 'auth/captcha-check-failed' || has('INVALID_APP_CREDENTIAL', 'MISSING_CLIENT_IDENTIFIER')) {
    return 'We couldn’t complete the security check. Please try again.';
  }

  switch (code) {
    case 'auth/invalid-phone-number':
      return 'Enter a valid 10-digit mobile number (+91).';
    case 'auth/missing-phone-number':
      return 'Please enter your mobile number.';
    case 'auth/invalid-verification-code':
      return 'Incorrect OTP. Please check your SMS and try again.';
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'This OTP has expired. Tap "Resend code" to get a new one.';
    case 'auth/missing-verification-code':
      return 'Please enter the 6-digit OTP.';
    case 'auth/network-request-failed':
      return 'Network connection failed. Please check your internet.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    case 'auth/cancelled':
      return 'Verification cancelled.';
    case 'auth/timeout':
      return 'The security check timed out. Please try again.';
    default:
      return 'We couldn’t verify your number. Please try again.';
  }
}

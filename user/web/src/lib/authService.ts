// Phone-number sign-in (Firebase Auth) for the browser: Firebase's own invisible
// reCAPTCHA, a fresh verifier per OTP request (a used or failed one cannot be reused).
//
// Phone sign-in on a deployed site needs its domain under Firebase console ›
// Authentication › Settings › Authorized domains (localhost is there by default).
import {
  RecaptchaVerifier,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut as firebaseSignOut,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { auth } from '@/platform/firebase';

let activeVerifier: RecaptchaVerifier | null = null;

function getFreshContainer(): HTMLElement {
  const existing = document.getElementById('recaptcha-container');
  if (existing && existing.parentNode) {
    const fresh = document.createElement('div');
    fresh.id = 'recaptcha-container';
    existing.parentNode.replaceChild(fresh, existing);
    return fresh;
  }
  if (existing) {
    existing.remove();
  }
  const fresh = document.createElement('div');
  fresh.id = 'recaptcha-container';
  document.body.appendChild(fresh);
  return fresh;
}

export function resetRecaptchaVerifier(): void {
  if (activeVerifier) {
    try {
      activeVerifier.clear();
    } catch {
      /* already cleared */
    }
    activeVerifier = null;
  }
  getFreshContainer();
}

export function createFreshRecaptchaVerifier(): RecaptchaVerifier {
  resetRecaptchaVerifier();
  const host = getFreshContainer();
  activeVerifier = new RecaptchaVerifier(auth, host, {
    size: 'invisible',
    callback: () => {
      /* reCAPTCHA solved */
    },
    'expired-callback': () => {
      resetRecaptchaVerifier();
    },
  });
  return activeVerifier;
}

export async function sendOtpToPhone(phoneE164: string): Promise<ConfirmationResult> {
  const verifier = createFreshRecaptchaVerifier();
  try {
    return await signInWithPhoneNumber(auth, phoneE164, verifier);
  } catch (error) {
    resetRecaptchaVerifier();
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
    // One readable line (the code and the server's reason), so the cause shows without opening the object.
    console.error(`[Firebase Phone Auth Error] ${err?.code ?? 'unknown'} · ${err?.customData?.serverResponse?.error?.message ?? err?.message ?? ''} · ${typeof location !== 'undefined' ? location.host : ''}`, error);
    throw error;
  }
}

export async function confirmOtpCode(confirmation: ConfirmationResult, code: string): Promise<User> {
  return (await confirmation.confirm(code)).user;
}

export const subscribeToAuthUser = (cb: (user: User | null) => void) => onAuthStateChanged(auth, cb);
export const signOutUser = () => firebaseSignOut(auth);

type PhoneAuthError = {
  code?: string;
  message?: string;
  customData?: { serverResponse?: { error?: { message?: string } } };
};

/** Customer-facing message for a Firebase phone-auth failure (setup details stay in the developer log). */
export function describePhoneAuthError(error: unknown): string {
  const err = error as PhoneAuthError;
  const code = err?.code ?? '';
  const serverMsg = (err?.customData?.serverResponse?.error?.message ?? err?.message ?? '').toUpperCase();
  const has = (...needles: string[]) => needles.some((n) => serverMsg.includes(n));

  if (has('ALREADY BEEN RENDERED')) return 'Security check refreshed. Please tap Continue again.';

  if (code === 'auth/unauthorized-domain' || has('SITE_MISMATCH')) {
    return 'Sign-in isn’t available from this web address. Please use the official NESAM website.';
  }

  if (
    code === 'auth/invalid-app-credential' ||
    code === 'auth/captcha-check-failed' ||
    code === 'auth/internal-error' ||
    has('INVALID_APP_CREDENTIAL', 'INVALID-APP-CREDENTIAL', 'MISSING_CLIENT_IDENTIFIER')
  ) {
    return 'We couldn’t complete the security check. Refresh the page and try again.';
  }

  if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded' || has('TOO_MANY_ATTEMPTS_TRY_LATER', 'SMS_QUOTA_EXCEEDED')) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }

  if (code === 'auth/operation-not-allowed' || has('OPERATION_NOT_ALLOWED', 'BILLING_NOT_ENABLED')) {
    return 'We can’t send verification codes right now. Please try again later or contact support.';
  }

  switch (code) {
    case 'auth/invalid-phone-number':
      return 'Enter a valid 10-digit mobile number.';
    case 'auth/missing-phone-number':
      return 'Please enter your mobile number.';
    case 'auth/invalid-verification-code':
      return 'That code is not correct. Check your SMS and try again.';
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'This code has expired. Request a new one.';
    case 'auth/missing-verification-code':
      return 'Enter the 6-digit code.';
    case 'auth/network-request-failed':
      return 'Network connection failed. Check your internet and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    default:
      return 'We couldn’t verify your number. Please try again.';
  }
}

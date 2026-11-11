// Phone-number sign-in (Firebase Auth) for the browser: Firebase's own invisible
// reCAPTCHA, a fresh verifier per OTP request (a used or failed one cannot be reused).
//
// Phone sign-in on a deployed site needs its domain under Firebase console ›
// Authentication › Settings › Authorized domains (localhost is there by default).
import {
  RecaptchaVerifier,
  initializeRecaptchaConfig,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut as firebaseSignOut,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { auth } from '@/platform/firebase';

let activeVerifier: RecaptchaVerifier | null = null;

// When reCAPTCHA Enterprise is switched on for phone sign-in (Firebase console › Authentication › Settings ›
// reCAPTCHA), the SDK checks the request with an invisible score instead of the picture challenge. Loading the project's
// reCAPTCHA settings first lets it use that path; with Enterprise off this does nothing and the invisible v2 check stays.
let recaptchaConfig: Promise<void> | null = null;
function loadRecaptchaConfig(): Promise<void> {
  recaptchaConfig ??= initializeRecaptchaConfig(auth).catch(() => undefined);
  return recaptchaConfig;
}

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

type PhoneAuthError = {
  code?: string;
  message?: string;
  customData?: { serverResponse?: { error?: { message?: string } } };
};

/** Developer diagnostics only: the error code and server reason. Never the phone number, code or tokens. */
function logPhoneAuthError(stage: 'send' | 'confirm', error: unknown): void {
  const err = error as PhoneAuthError;
  console.error('[Firebase Phone Auth]', stage, {
    code: err?.code,
    serverMessage: err?.customData?.serverResponse?.error?.message,
    host: typeof location !== 'undefined' ? location.hostname : undefined,
  });
}

export async function sendOtpToPhone(phoneE164: string): Promise<ConfirmationResult> {
  await loadRecaptchaConfig();
  const verifier = createFreshRecaptchaVerifier();
  try {
    return await signInWithPhoneNumber(auth, phoneE164, verifier);
  } catch (error) {
    // A verifier that has been used or has failed cannot be reused: the retry builds a fresh one.
    resetRecaptchaVerifier();
    logPhoneAuthError('send', error);
    throw error;
  }
}

export async function confirmOtpCode(confirmation: ConfirmationResult, code: string): Promise<User> {
  try {
    return (await confirmation.confirm(code)).user;
  } catch (error) {
    logPhoneAuthError('confirm', error);
    throw error;
  }
}

export const subscribeToAuthUser = (cb: (user: User | null) => void) => onAuthStateChanged(auth, cb);
export const signOutUser = () => firebaseSignOut(auth);

/** Customer-facing message for a Firebase phone-auth failure (setup details stay in the developer log). */
export function describePhoneAuthError(error: unknown): string {
  const err = error as PhoneAuthError;
  const code = err?.code ?? '';
  const serverMsg = (err?.customData?.serverResponse?.error?.message ?? err?.message ?? '').toUpperCase();
  const has = (...needles: string[]) => needles.some((n) => serverMsg.includes(n));

  if (has('ALREADY BEEN RENDERED')) return 'Security check refreshed. Please tap Continue again.';

  if (code === 'auth/unauthorized-domain' || has('SITE_MISMATCH')) {
    return 'Sign-in isn’t available from this web address. Please use the official NESAM Cabs website.';
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

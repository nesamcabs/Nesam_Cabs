import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type ConfirmationResult,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

// Firebase's documented pattern is to keep a single RecaptchaVerifier alive and
// reuse it. Creating a new one on every "Send OTP" / "Resend" click throws
// "reCAPTCHA has already been rendered in this element".
let recaptchaVerifier: RecaptchaVerifier | null = null;
let recaptchaContainerId: string | null = null;

export function createRecaptchaVerifier(
  containerId: string = "vendor-recaptcha-container",
): RecaptchaVerifier {
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    document.body.appendChild(container);
  }

  if (recaptchaVerifier && recaptchaContainerId === containerId) {
    return recaptchaVerifier;
  }

  resetRecaptchaVerifier();
  recaptchaVerifier = new RecaptchaVerifier(auth, container, {
    size: "invisible",
    callback: () => {
      // reCAPTCHA solved
    },
    "expired-callback": () => {
      resetRecaptchaVerifier();
    },
  });
  recaptchaContainerId = containerId;
  return recaptchaVerifier;
}

export function resetRecaptchaVerifier(): void {
  try {
    recaptchaVerifier?.clear();
  } catch {
    /* widget may already be gone */
  }
  recaptchaVerifier = null;
  recaptchaContainerId = null;
}

export async function sendOtpToPhone(
  phoneE164: string,
  verifier: RecaptchaVerifier,
): Promise<ConfirmationResult> {
  try {
    return await signInWithPhoneNumber(auth, phoneE164, verifier);
  } catch (error) {
    // A failed attempt consumes the reCAPTCHA token; force a fresh widget next time.
    resetRecaptchaVerifier();
    throw error;
  }
}

export async function confirmOtpCode(
  confirmation: ConfirmationResult,
  code: string,
): Promise<User> {
  const credential = await confirmation.confirm(code);
  return credential.user;
}

// Which entry path (Login vs Sign Up) the vendor chose before OTP. Routing is
// decided by the vendors/{uid} document, but this lets the app explain why,
// e.g. "no account found for this number" after a Login attempt.
export type AuthIntent = "login" | "signup";
let authIntent: AuthIntent | null = null;
export const setAuthIntent = (intent: AuthIntent | null) => {
  authIntent = intent;
};
export const getAuthIntent = () => authIntent;

export function subscribeToAuthUser(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}

export function describePhoneAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  const message = (error as { message?: string })?.message ?? "";
  console.error("[Firebase Phone Auth - Vendor]", code, message, error);
  switch (code) {
    case "auth/invalid-phone-number":
      return "Enter a valid 10-digit mobile number (+91).";
    case "auth/missing-phone-number":
      return "Please enter your mobile number.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/invalid-verification-code":
      return "Incorrect OTP entered. Please check your SMS and try again.";
    case "auth/code-expired":
      return 'This OTP has expired. Please tap "Resend OTP" to get a new code.';
    case "auth/missing-verification-code":
      return "Please enter the 6-digit OTP code.";
    case "auth/network-request-failed":
      return "Network connection failed. Please check your internet.";
    case "auth/quota-exceeded":
      return "SMS quota exceeded for today. Please contact support or try again later.";
    case "auth/operation-not-allowed":
      return "We can’t send verification codes right now. Please try again later or contact NESAM support.";
    case "auth/unauthorized-domain":
      return "Sign-in isn’t available from this web address. Please use the official NESAM partner website.";
    case "auth/captcha-check-failed":
    case "auth/invalid-app-credential": {
      // The SDK hides the server's reason; log it so the real cause is visible in the console.
      const server = (error as { customData?: { _serverResponse?: unknown } })?.customData?._serverResponse;
      if (server) console.error("[Firebase Phone Auth] server response:", JSON.stringify(server));
      return "We couldn’t complete the security check. Refresh the page and try again.";
    }
    case "auth/billing-not-enabled":
      return "We can’t send verification codes right now. Please try again later or contact NESAM support.";
    default:
      return "We couldn’t verify your number. Please try again.";
  }
}

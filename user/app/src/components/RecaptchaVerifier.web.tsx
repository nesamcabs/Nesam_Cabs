// Browser application verifier for Firebase phone auth.
//
// Same public surface as RecaptchaVerifier.tsx (the Android WebView version), so
// the auth screens and authService are unchanged. In a browser Firebase's own
// invisible reCAPTCHA runs directly in the page; a fresh verifier is created per
// OTP request because a used or failed one cannot be reused.
//
// Phone sign-in on a deployed site requires its domain to be listed under
// Firebase console › Authentication › Settings › Authorized domains.
import React from 'react';
import { RecaptchaVerifier } from 'firebase/auth';
import { auth } from '../config/firebase';

export interface NativeRecaptchaVerifier {
  readonly type: 'recaptcha';
  verify(): Promise<string>;
  _reset(): void;
}

export class RecaptchaError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

let webVerifierInstance: RecaptchaVerifier | null = null;

function getFreshUserContainer(): HTMLElement {
  const existing = document.getElementById('nesam-recaptcha-container');
  if (existing && existing.parentNode) {
    const fresh = document.createElement('div');
    fresh.id = 'nesam-recaptcha-container';
    existing.parentNode.replaceChild(fresh, existing);
    return fresh;
  }
  if (existing) {
    existing.remove();
  }
  const fresh = document.createElement('div');
  fresh.id = 'nesam-recaptcha-container';
  document.body.appendChild(fresh);
  return fresh;
}

function resetWebVerifier(): void {
  if (webVerifierInstance) {
    try {
      webVerifierInstance.clear();
    } catch {
      /* already cleared */
    }
    webVerifierInstance = null;
  }
  getFreshUserContainer();
}

function createFreshWebVerifier(): RecaptchaVerifier {
  resetWebVerifier();
  const host = getFreshUserContainer();
  webVerifierInstance = new RecaptchaVerifier(auth, host, {
    size: 'invisible',
    'expired-callback': () => {
      resetWebVerifier();
    },
  });
  return webVerifierInstance;
}

const webVerifier: NativeRecaptchaVerifier = {
  type: 'recaptcha',
  async verify() {
    const verifier = createFreshWebVerifier();
    try {
      return await verifier.verify();
    } catch (e) {
      resetWebVerifier();
      const code = (e as { code?: string })?.code ?? 'auth/captcha-check-failed';
      console.error('[User Web Recaptcha verify error]', e);
      throw new RecaptchaError(code, 'The security check could not be completed. Check your connection and try again.');
    }
  },
  _reset: () => {
    resetWebVerifier();
  },
};

export function useRecaptchaVerifier(): NativeRecaptchaVerifier {
  return webVerifier;
}

/** Nothing to host on the web — the verifier talks to the page directly. */
export function RecaptchaProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

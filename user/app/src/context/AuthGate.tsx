// Browsing without an account, like the website: the booking form (and the menus) open straight away, and the
// phone sign-in sheet appears only when something needs an account ("Let's Go", Profile, My trips…).
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { SignInSheet } from '../components/SignInSheet';

interface SignInOptions {
  title?: string;
  subtitle?: string;
}

interface AuthGateValue {
  /** True while nobody is signed in. */
  guest: boolean;
  /** Opens the sign-in sheet (no-op once signed in). */
  requestSignIn: (options?: SignInOptions) => void;
}

const Ctx = createContext<AuthGateValue>({ guest: false, requestSignIn: () => undefined });

export const useAuthGate = () => useContext(Ctx);

/**
 * A booking a guest started: after signing in the app goes on to the fares for it, like the website's "pending return".
 * Kept in memory only; the booking draft itself lives in BookingDraftProvider above the sign-in switch.
 */
let resumeFares = false;
export const setResumeFares = (v: boolean) => {
  resumeFares = v;
};
export const takeResumeFares = (): boolean => {
  const v = resumeFares;
  resumeFares = false;
  return v;
};

export function AuthGateProvider({ guest, children }: { guest: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<SignInOptions>({});
  const requestSignIn = useCallback(
    (o?: SignInOptions) => {
      if (!guest) return;
      setOptions(o ?? {});
      setOpen(true);
    },
    [guest],
  );
  const value = useMemo(() => ({ guest, requestSignIn }), [guest, requestSignIn]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {guest ? <SignInSheet visible={open} onClose={() => setOpen(false)} title={options.title} subtitle={options.subtitle} /> : null}
    </Ctx.Provider>
  );
}

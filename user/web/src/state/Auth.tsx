// Who is signed in and what state their account is in. Same resolution order as the
// customer app: signed out → profile loading / failed → needs profile → on hold → ready.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import type { UserProfile } from '@core/types';
import { subscribeToCustomerProfile } from '@core/services/userService';
import { describeError } from '@core/utils/retry';
import { signOutUser, subscribeToAuthUser } from '@/lib/authService';
import { clearPendingReturn } from '@/lib/pendingReturn';

// Same as firestore.rules: only these statuses may use the app (anything else, or none, is on hold).
const ACTIVE_STATUSES = ['Approved', 'Active'];

export type AuthState =
  | { status: 'loading'; label: string }
  | { status: 'signed-out' }
  | { status: 'error'; message: string; user: User }
  | { status: 'needs-profile'; user: User }
  | { status: 'on-hold'; user: User; profile: UserProfile }
  | { status: 'ready'; user: User; profile: UserProfile };

export interface LoginModalOptions {
  title?: string;
  subtitle?: string;
  onSuccess?: () => void;
}

interface AuthApi {
  state: AuthState;
  retry: () => void;
  signOut: () => Promise<void>;
  openLoginModal: (options?: LoginModalOptions) => void;
  closeLoginModal: () => void;
  isLoginModalOpen: boolean;
  loginModalOptions: LoginModalOptions | null;
}

const Ctx = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider is missing');
  return v;
}

interface ProfileResult {
  key: string;
  profile?: UserProfile | null;
  error: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = still resolving; null = signed out.
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [result, setResult] = useState<ProfileResult>({ key: '', error: '' });
  const [attempt, setAttempt] = useState(0);
  const [modalState, setModalState] = useState<{ open: boolean; options: LoginModalOptions | null }>({
    open: false,
    options: null,
  });

  // A signed-in rider who signs out takes any pending "resume booking" with them.
  const hadUser = useRef(false);
  useEffect(
    () =>
      subscribeToAuthUser((u) => {
        if (!u && hadUser.current) clearPendingReturn();
        hadUser.current = !!u;
        setUser(u);
      }),
    [],
  );

  const uid = user?.uid;
  const key = uid ? `${uid}#${attempt}` : '';
  useEffect(() => {
    if (!uid) return undefined;
    const k = `${uid}#${attempt}`;
    return subscribeToCustomerProfile(
      uid,
      (profile) => setResult({ key: k, profile, error: '' }),
      (e) => setResult({ key: k, error: describeError(e, 'We couldn’t load your account.') }),
    );
  }, [uid, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const openLoginModal = useCallback((options?: LoginModalOptions) => {
    setModalState({ open: true, options: options ?? null });
  }, []);

  const state = useMemo<AuthState>(() => {
    if (user === undefined) return { status: 'loading', label: 'Starting NESAM Cabs…' };
    if (!user) return { status: 'signed-out' };
    const current = result.key === key ? result : null;
    if (current?.error && current.profile === undefined) return { status: 'error', message: current.error, user };
    if (!current || current.profile === undefined) return { status: 'loading', label: 'Loading your account…' };
    if (current.profile === null) return { status: 'needs-profile', user };
    if (!ACTIVE_STATUSES.includes(current.profile.status)) return { status: 'on-hold', user, profile: current.profile };
    return { status: 'ready', user, profile: current.profile };
  }, [user, result, key]);

  // Closing the login UI is not a sign-in: while still signed out it also drops any pending
  // "resume booking", so a later unrelated sign-in is never redirected. (Once the code has been
  // verified the pending return stays, so profile setup can still finish and resume.)
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  const closeLoginModal = useCallback(() => {
    if (statusRef.current === 'signed-out') clearPendingReturn();
    setModalState((s) => ({ ...s, open: false }));
  }, []);

  // When successfully signed in and ready, if login modal was open and has onSuccess callback, trigger it
  const onSuccessRef = useRef<(() => void) | undefined>(undefined);
  onSuccessRef.current = modalState.options?.onSuccess;
  const prevStatusRef = useRef<string>(state.status);

  useEffect(() => {
    if (state.status === 'ready' && prevStatusRef.current !== 'ready') {
      if (modalState.open) {
        onSuccessRef.current?.();
        setModalState({ open: false, options: null });
      }
    }
    prevStatusRef.current = state.status;
  }, [state.status, modalState.open]);

  const value = useMemo<AuthApi>(
    () => ({
      state,
      retry,
      signOut: signOutUser,
      openLoginModal,
      closeLoginModal,
      isLoginModalOpen: modalState.open,
      loginModalOptions: modalState.options,
    }),
    [state, retry, openLoginModal, closeLoginModal, modalState.open, modalState.options],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

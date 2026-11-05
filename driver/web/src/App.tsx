import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { DriverAccount, RegistrationData } from './types';
import { AuthScreen, type AuthIntent } from './screens/AuthScreen';
import { RegistrationScreen } from './screens/RegistrationScreen';
import { VerificationStatusScreen, NoAccountScreen } from './screens/VerificationStatusScreen';
import { DriverWorkspace } from './DriverWorkspace';
import { LegalGate } from './components/LegalGate';
import { subscribeToAuthUser, signOutUser, resetRecaptchaVerifier } from './services/authService';
import {
  subscribeToDriverAccount,
  getDriverInvite,
  emptyRegistration,
  formatPhone,
  type DriverInvite,
} from './services/driverFirestoreService';

const FullScreenMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-[#F7F7F7] flex flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>
);

const Loading: React.FC<{ label?: string }> = ({ label = 'Loading...' }) => (
  <FullScreenMessage>
    <Loader2 className="w-7 h-7 text-[#E21E26] animate-spin" />
    <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">{label}</span>
  </FullScreenMessage>
);

export function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [intent, setIntent] = useState<AuthIntent | null>(null);

  const [account, setAccount] = useState<DriverAccount | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [accountError, setAccountError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const [invite, setInvite] = useState<DriverInvite | null>(null);
  const [registerAnyway, setRegisterAnyway] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);

  // Firebase Auth session (persisted across reloads).
  useEffect(() => {
    return subscribeToAuthUser((user) => {
      setAuthUser(user);
      setAuthLoading(false);
      if (!user) {
        setAccount(null);
        setAccountLoaded(false);
        setAccountError(false);
        setInvite(null);
        setRegisterAnyway(false);
        setResubmitting(false);
      }
    });
  }, []);

  // Live driver profile — flips the UI to the workspace the moment an admin
  // approves, with no refresh needed.
  useEffect(() => {
    if (!authUser) return undefined;
    setAccountLoaded(false);
    setAccountError(false);
    return subscribeToDriverAccount(
      authUser.uid,
      (acc) => {
        setAccount(acc);
        setAccountLoaded(true);
        if (acc?.driver.approvalStatus !== 'Rejected') setResubmitting(false);
      },
      () => {
        setAccountError(true);
        setAccountLoaded(true);
      },
    );
  }, [authUser, retryKey]);

  // Invite (admin/vendor pre-registration) pre-fills signup.
  useEffect(() => {
    if (!authUser?.phoneNumber || !accountLoaded || account) return;
    getDriverInvite(authUser.phoneNumber).then(setInvite);
  }, [authUser, accountLoaded, account]);

  const signupInitial: RegistrationData | null = useMemo(() => {
    if (!authUser) return null;
    const base = emptyRegistration(formatPhone(authUser.phoneNumber || ''));
    if (invite?.name) base.profile.name = invite.name;
    return base;
  }, [authUser, invite]);

  const handleSignOut = async () => {
    resetRecaptchaVerifier();
    setIntent(null);
    await signOutUser();
  };

  if (authLoading) return <Loading />;

  if (!authUser) return <AuthScreen onIntent={setIntent} />;

  if (!accountLoaded) return <Loading label="Loading your profile..." />;

  if (accountError) {
    return (
      <FullScreenMessage>
        <AlertTriangle className="w-8 h-8 text-amber-500" />
        <p className="text-sm font-bold text-gray-800">We couldn't load your driver profile.</p>
        <p className="text-xs text-gray-500">Check your internet connection and try again.</p>
        <div className="flex gap-2">
          <button onClick={() => setRetryKey((k) => k + 1)} className="px-4 py-2 bg-[#E21E26] text-white text-xs font-bold rounded-lg">
            Retry
          </button>
          <button onClick={handleSignOut} className="px-4 py-2 border border-gray-300 text-xs font-bold rounded-lg">
            Sign Out
          </button>
        </div>
      </FullScreenMessage>
    );
  }

  // Signed in but no drivers/{uid} yet.
  if (!account) {
    if (intent === 'login' && !registerAnyway) {
      return (
        <NoAccountScreen
          phone={formatPhone(authUser.phoneNumber || '')}
          onRegister={() => setRegisterAnyway(true)}
          onSignOut={handleSignOut}
        />
      );
    }
    return (
      <LegalGate role="driver">
      <RegistrationScreen
        key={`signup-${authUser.uid}-${invite?.name ?? ''}`}
        uid={authUser.uid}
        mode="signup"
        initial={signupInitial!}
        vendorName={invite?.vendorName}
        fleetDriver={!!invite?.vendorId}
        onSubmitted={() => { /* live subscription picks up the new doc */ }}
        onSignOut={handleSignOut}
      />
      </LegalGate>
    );
  }

  const status = account.driver.approvalStatus;

  if (status === 'Rejected' && resubmitting) {
    return (
      <RegistrationScreen
        key={`resubmit-${authUser.uid}`}
        uid={authUser.uid}
        mode="resubmit"
        initial={account}
        fleetDriver={!!account.driver.vendorId}
        currentStatus={status}
        rejectionReason={account.driver.rejectionReason}
        onSubmitted={() => setResubmitting(false)}
        onCancel={() => setResubmitting(false)}
        onSignOut={handleSignOut}
      />
    );
  }

  if (status !== 'Approved') {
    return <VerificationStatusScreen account={account} onSignOut={handleSignOut} onResubmit={() => setResubmitting(true)} />;
  }

  return (
    <LegalGate role="driver">
      <DriverWorkspace account={account} onSignOut={handleSignOut} />
    </LegalGate>
  );
}

export default App;

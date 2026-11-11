// Gatekeeper for the Driver app (native port of driver/web/src/App.tsx):
// Firebase Auth user → drivers/{uid} snapshot → screen for the account state.
// When an admin approves the driver the snapshot fires and the workspace
// mounts immediately.
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import type { User } from 'firebase/auth';
import { RecaptchaProvider } from './src/components/RecaptchaVerifier';
import { NetworkBanner } from './src/components/NetworkBanner';
import { FullScreenLoader } from './src/components/ui';
import { AuthScreen } from './src/screens/auth/AuthScreen';
import { getAuthIntent } from './src/screens/auth/authIntent';
import { LoadErrorScreen, NoAccountScreen, VerificationStatusScreen } from './src/screens/auth/AccountStateScreens';
import { RegistrationScreen } from './src/screens/RegistrationScreen';
import { MainNavigator } from './src/navigation/MainNavigator';
import { navigationRef } from './src/navigation/navigationRef';
import { DriverDataProvider } from './src/context/DriverData';
import { LegalGate } from './src/components/LegalGate';
import { signOutUser, subscribeToAuthUser } from './src/services/authService';
import { emptyRegistration, formatPhone, getDriverInvite, subscribeToDriverAccount, type DriverInvite } from './src/services/driverService';
import type { DriverAccount } from './src/types/driver';
import { describeError } from './src/utils/retry';
import { colors } from './src/theme';
import { POPPINS, POPPINS_FILES, setPoppinsReady } from './src/theme/fonts';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// React Navigation reads its header and tab fonts from the theme.
const navFonts = {
  regular: { fontFamily: POPPINS.regular, fontWeight: '400' as const },
  medium: { fontFamily: POPPINS.medium, fontWeight: '400' as const },
  bold: { fontFamily: POPPINS.bold, fontWeight: '400' as const },
  heavy: { fontFamily: POPPINS.bold, fontWeight: '400' as const },
};

const navTheme = {
  ...DefaultTheme,
  fonts: navFonts,
  colors: { ...DefaultTheme.colors, primary: colors.primary, background: colors.bg, card: colors.card, text: colors.ink, border: colors.border },
};

interface AccountState {
  key: string;
  account?: DriverAccount | null;
  error: string;
}

/** Poppins is bundled; if loading ever fails or stalls, the app continues in the system font instead of blocking. */
function useBrandFonts(): boolean {
  const [loaded, error] = useFonts(POPPINS_FILES);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), 5000);
    return () => clearTimeout(t);
  }, []);
  setPoppinsReady(loaded && !error);
  return loaded || !!error || gaveUp;
}

function Root() {
  const fontsSettled = useBrandFonts();
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined);
  const [accountState, setAccountState] = useState<AccountState>({ key: '', error: '' });
  const [attempt, setAttempt] = useState(0);
  const [invite, setInvite] = useState<{ uid: string; invite: DriverInvite | null } | null>(null);
  const [registerAnyway, setRegisterAnyway] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);

  useEffect(() => subscribeToAuthUser(setAuthUser), []);

  const uid = authUser?.uid;
  const key = uid ? `${uid}#${attempt}` : '';
  useEffect(() => {
    if (!uid) return undefined;
    const k = `${uid}#${attempt}`;
    return subscribeToDriverAccount(
      uid,
      (account) => setAccountState({ key: k, account, error: '' }),
      (e) => setAccountState({ key: k, error: describeError(e, 'Check your internet connection and try again.') }),
    );
  }, [uid, attempt]);

  const current = accountState.key === key ? accountState : null;
  const account = current?.account;
  const accountError = current?.error ?? '';

  // An admin/vendor invite for this phone pre-fills the registration.
  const phoneE164 = authUser?.phoneNumber ?? '';
  const needsInvite = !!uid && account === null;
  useEffect(() => {
    if (!needsInvite || !uid) return undefined;
    let alive = true;
    void getDriverInvite(phoneE164).then((inv) => alive && setInvite({ uid, invite: inv }));
    return () => {
      alive = false;
    };
  }, [needsInvite, uid, phoneE164]);

  const resolved = authUser !== undefined && (!authUser || account !== undefined || !!accountError);
  const ready = resolved && fontsSettled;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  const signOut = () => {
    setRegisterAnyway(false);
    setResubmitting(false);
    void signOutUser();
  };

  // The splash screen stays up until the fonts are settled, so the first screen never flashes in a fallback face.
  if (!fontsSettled) return null;
  if (authUser === undefined) return <FullScreenLoader />;
  if (!authUser) return <AuthScreen />;
  if (account === undefined && accountError) {
    return <LoadErrorScreen message={accountError} onRetry={() => setAttempt((a) => a + 1)} onSignOut={signOut} />;
  }
  if (account === undefined) return <FullScreenLoader label="Loading your profile…" />;

  if (account === null) {
    if (getAuthIntent() === 'login' && !registerAnyway) {
      return <NoAccountScreen phone={formatPhone(phoneE164)} onRegister={() => setRegisterAnyway(true)} onSignOut={signOut} />;
    }
    if (!invite || invite.uid !== authUser.uid) return <FullScreenLoader label="Preparing registration…" />;
    const initial = emptyRegistration(formatPhone(phoneE164));
    if (invite.invite?.name) initial.profile.name = invite.invite.name;
    return <RegistrationScreen key={`signup-${authUser.uid}`} uid={authUser.uid} mode="signup" initial={initial} vendorName={invite.invite?.vendorName} fleetDriver={!!invite.invite?.vendorId} onSignOut={signOut} />;
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
        onDone={() => setResubmitting(false)}
        onCancel={() => setResubmitting(false)}
        onSignOut={signOut}
      />
    );
  }
  if (status !== 'Approved') return <VerificationStatusScreen account={account} onSignOut={signOut} onResubmit={() => setResubmitting(true)} />;

  return (
    <LegalGate key={account.driver.id} role="driver">
      <DriverDataProvider account={account}>
        <MainNavigator onSignOut={signOut} />
      </DriverDataProvider>
    </LegalGate>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <RecaptchaProvider>
        <NavigationContainer ref={navigationRef} theme={navTheme}>
          <StatusBar style="dark" />
          <Root />
          <NetworkBanner />
        </NavigationContainer>
      </RecaptchaProvider>
    </SafeAreaProvider>
  );
}

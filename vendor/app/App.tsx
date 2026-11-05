// Gatekeeper for the Vendor app (native port of vendor/web/src/App.tsx):
// Firebase Auth user → vendors/{uid} snapshot → screen for its status. When an
// admin approves the application the snapshot fires and the dashboard mounts.
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import type { User } from 'firebase/auth';
import { RecaptchaProvider } from './src/components/RecaptchaVerifier';
import { NetworkBanner } from './src/components/NetworkBanner';
import { FullScreenLoader } from './src/components/ui';
import { AuthScreen } from './src/screens/auth/AuthScreen';
import { AccountStatusScreen, LoadErrorScreen } from './src/screens/auth/AccountStatusScreen';
import { OnboardingWizard } from './src/screens/onboarding/OnboardingWizard';
import { RegistrationGate } from './src/screens/onboarding/RegistrationGate';
import { MainNavigator } from './src/navigation/MainNavigator';
import { navigationRef } from './src/navigation/navigationRef';
import { VendorDataProvider } from './src/context/VendorData';
import { InboxProvider } from './src/context/Inbox';
import { LegalGate } from './src/components/LegalGate';
import { signOutUser, subscribeToAuthUser } from './src/services/authService';
import { subscribeToVendor, type VendorSnapshot } from './src/services/onboardingService';
import { describeDataError } from './src/utils/retry';
import { colors } from './src/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, primary: colors.primary, background: colors.bg, card: colors.card, text: colors.ink, border: colors.border },
};

interface VendorState {
  key: string;
  vendor?: VendorSnapshot | null;
  error: string;
}

function Root() {
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined);
  const [state, setState] = useState<VendorState>({ key: '', error: '' });
  const [attempt, setAttempt] = useState(0);
  const [reapplying, setReapplying] = useState(false);

  useEffect(() => subscribeToAuthUser(setAuthUser), []);

  const uid = authUser?.uid;
  const key = uid ? `${uid}#${attempt}` : '';
  useEffect(() => {
    if (!uid) return undefined;
    const k = `${uid}#${attempt}`;
    return subscribeToVendor(
      uid,
      (vendor) => setState({ key: k, vendor, error: '' }),
      (e) => setState({ key: k, error: describeDataError(e) }),
    );
  }, [uid, attempt]);

  const current = state.key === key ? state : null;
  const vendor = current?.vendor;
  const vendorError = current?.error ?? '';
  const status = vendor?.record.status;

  const resolved = authUser !== undefined && (!authUser || vendor !== undefined || !!vendorError);
  useEffect(() => {
    if (resolved) void SplashScreen.hideAsync().catch(() => undefined);
  }, [resolved]);

  const signOut = () => {
    setReapplying(false);
    void signOutUser();
  };

  if (authUser === undefined) return <FullScreenLoader />;
  if (!authUser) return <AuthScreen />;
  if (vendor === undefined && vendorError) return <LoadErrorScreen message={vendorError} onRetry={() => setAttempt((a) => a + 1)} onSignOut={signOut} />;
  if (vendor === undefined) return <FullScreenLoader label="Loading your account…" />;

  const phone = authUser.phoneNumber || vendor?.record.phone || '';
  // No vendor account yet → show self-registration entry screen.
  if (!vendor) return <RegistrationGate key={authUser.uid} phone={phone} onSignOut={signOut} />;
  if (status === 'INCOMPLETE' || status === 'CHANGES_REQUESTED' || (status === 'REJECTED' && reapplying)) {
    return <OnboardingWizard key={authUser.uid} record={vendor.record} phone={phone} onSignOut={signOut} />;
  }
  if (status !== 'APPROVED') {
    return <AccountStatusScreen record={vendor.record} onSignOut={signOut} onReapply={status === 'REJECTED' ? () => setReapplying(true) : undefined} />;
  }

  return (
    <LegalGate key={vendor.profile.id} role="vendor">
      <InboxProvider userId={vendor.profile.id} role="vendor" penaltyField="vendorId">
        <VendorDataProvider profile={vendor.profile} record={vendor.record}>
          <MainNavigator onSignOut={signOut} />
        </VendorDataProvider>
      </InboxProvider>
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

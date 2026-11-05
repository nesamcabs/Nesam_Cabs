import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import type { User } from 'firebase/auth';
import { RecaptchaProvider } from './src/components/RecaptchaVerifier';
import { NetworkBanner } from './src/components/NetworkBanner';
import { FullScreenLoader } from './src/components/ui';
import { AuthScreen } from './src/screens/auth/AuthScreen';
import { ProfileSetupScreen } from './src/screens/auth/ProfileSetupScreen';
import { AccountHoldScreen, LoadErrorScreen } from './src/screens/auth/AccountStateScreens';
import { MainNavigator } from './src/navigation/MainNavigator';
import { navigationRef } from './src/navigation/navigationRef';
import { CustomerDataProvider } from './src/context/CustomerData';
import { InboxProvider } from './src/context/Inbox';
import { LegalGate } from './src/components/LegalGate';
import { signOutUser, subscribeToAuthUser } from './src/services/authService';
import { subscribeToCustomerProfile } from './src/services/userService';
import type { UserProfile } from './src/types';
import { describeError } from './src/utils/retry';
import { Text, TextInput } from 'react-native';
import { colors, fonts } from './src/theme';
import { useFonts } from 'expo-font';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import { Manrope_800ExtraBold } from '@expo-google-fonts/manrope';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Inter is the reference's text face. Tamil text has no Inter glyphs, so the
// platform falls back to its Tamil font (Noto Sans Tamil on Android) per glyph.
const defaultFont = { fontFamily: fonts.regular };
// @ts-ignore
if ((Text as any).defaultProps == null) {
  // @ts-ignore
  (Text as any).defaultProps = {};
}
// @ts-ignore
(Text as any).defaultProps.style = { ...defaultFont, ...(Text as any).defaultProps.style };

// @ts-ignore
if ((TextInput as any).defaultProps == null) {
  // @ts-ignore
  (TextInput as any).defaultProps = {};
}
// @ts-ignore
(TextInput as any).defaultProps.style = { ...defaultFont, ...(TextInput as any).defaultProps.style };

// Same as firestore.rules: only these statuses may use the app (anything else, or none, is on hold).
const ACTIVE_STATUSES = ['Approved', 'Active'];

const APP_TITLE = 'NESAM Cabs';

// Browser tab title: "Screen title · App name" (on Android / iOS this is ignored).
const documentTitle = {
  formatter: (options: { title?: string } | undefined) => (options?.title ? `${options.title} · ${APP_TITLE}` : APP_TITLE),
};

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, primary: colors.primary, background: colors.bg, card: colors.card, text: colors.ink, border: colors.border },
  fonts: {
    ...DefaultTheme.fonts,
    regular: { fontFamily: fonts.regular, fontWeight: '400' as const },
    medium: { fontFamily: fonts.medium, fontWeight: '500' as const },
    bold: { fontFamily: fonts.semiBold, fontWeight: '600' as const },
    heavy: { fontFamily: fonts.bold, fontWeight: '700' as const },
  },
};

interface ProfileState {
  /** The uid + attempt this result belongs to; stale results are ignored. */
  key: string;
  profile?: UserProfile | null;
  error: string;
}

function Root() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Manrope_800ExtraBold,
    [fonts.brand]: require('./assets/reference/fonts/NesamBrand.ttf'),
  });
  // A font that fails to load must not hold the app on the splash screen: the system face is used instead.
  const fontsReady = fontsLoaded || !!fontError;

  // undefined = still resolving; null = signed out / no profile doc yet.
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined);
  const [profileState, setProfileState] = useState<ProfileState>({ key: '', error: '' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => subscribeToAuthUser(setAuthUser), []);

  const uid = authUser?.uid;
  const key = uid ? `${uid}#${attempt}` : '';
  useEffect(() => {
    if (!uid) return undefined;
    const k = `${uid}#${attempt}`;
    return subscribeToCustomerProfile(
      uid,
      (p) => setProfileState({ key: k, profile: p, error: '' }),
      (e) => setProfileState({ key: k, error: describeError(e, 'We couldn’t load your account.') }),
    );
  }, [uid, attempt]);

  const current = profileState.key === key ? profileState : null;
  const profile = current?.profile;
  const profileError = current?.error ?? '';

  const resolved = fontsReady && authUser !== undefined && (!authUser || profile !== undefined || !!profileError);
  useEffect(() => {
    if (resolved) void SplashScreen.hideAsync().catch(() => undefined);
  }, [resolved]);

  if (!fontsReady || authUser === undefined) return <FullScreenLoader />;
  if (!authUser) return <AuthScreen />;
  if (profile === undefined && profileError) {
    return <LoadErrorScreen message={profileError} onRetry={() => setAttempt((k) => k + 1)} onSignOut={() => void signOutUser()} />;
  }
  if (profile === undefined) return <FullScreenLoader label="Loading your account…" />;
  if (profile === null) return <ProfileSetupScreen phone={authUser.phoneNumber ?? ''} />;
  if (!ACTIVE_STATUSES.includes(profile.status)) return <AccountHoldScreen status={profile.status} onSignOut={() => void signOutUser()} />;

  return (
    <LegalGate key={profile.uid} role="customer">
      <InboxProvider userId={profile.uid} role="customer">
        <CustomerDataProvider profile={profile}>
          <MainNavigator />
        </CustomerDataProvider>
      </InboxProvider>
    </LegalGate>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <RecaptchaProvider>
        <NavigationContainer ref={navigationRef} theme={navTheme} documentTitle={documentTitle}>
          <StatusBar style="dark" />
          <Root />
          <NetworkBanner />
        </NavigationContainer>
      </RecaptchaProvider>
    </SafeAreaProvider>
  );
}

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RootStackParamList, TabParamList } from './types';
import { navigationRef } from './navigationRef';
import { useDriverData } from '../context/DriverData';
import { HomeScreen } from '../screens/HomeScreen';
import MarketplaceScreen from '../screens/MarketplaceScreen';
import { TripsScreen } from '../screens/TripsScreen';
import { TripFlowScreen } from '../screens/TripFlowScreen';
import { EarningsScreen } from '../screens/EarningsScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { PreTripScreen } from '../screens/PreTripScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { UpdateDocumentsScreen } from '../screens/UpdateDocumentsScreen';
import { useTripLocationSharing } from '../hooks/useTripLocationSharing';
import { NotificationPopups } from '../components/NotificationPopups';
import { PenaltyAckModal } from '../components/PenaltyAckModal';
import { markNotificationRead } from '../services/driverService';
import { onPushOpened } from '../services/notificationService';
import type { DriverNotification } from '../types/driver';
import { colors } from '../theme';
import { NxTabBar } from '../components/nx/TabBar';
import { ShellProvider } from '../components/nx/Shell';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const SignOutCtx = createContext<() => void>(() => undefined);
export const useSignOut = () => useContext(SignOutCtx);

function Tabs() {
  const { account } = useDriverData();
  // A vendor's employee drives assigned trips only: no commission, wallet or payout screens.
  const fleetDriver = !!account.driver.vendorId;
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <NxTabBar {...props} />}
    >
      <Tab.Screen name="Marketplace" component={MarketplaceScreen} />
      <Tab.Screen name="Trip" component={TripsScreen} />
      <Tab.Screen name="Home" component={HomeScreen} />
      {fleetDriver ? null : <Tab.Screen name="Wallet" component={WalletScreen} />}
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

/** State restoration: a driver with an assigned / ongoing trip lands on it. */
function TripAutoFocus() {
  const { activeTrip } = useDriverData();
  const tripId = activeTrip?.id ?? null;
  useEffect(() => {
    if (!tripId) return undefined;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      if (!navigationRef.isReady()) {
        if (tries++ < 20) timer = setTimeout(attempt, 100);
        return;
      }
      const current = navigationRef.getCurrentRoute()?.name;
      if (current === 'TripFlow' || current === 'PreTrip') return;
      navigationRef.navigate('TripFlow', { bookingId: tripId });
    };
    timer = setTimeout(attempt, 0);
    return () => clearTimeout(timer);
  }, [tripId]);
  return null;
}

/** Where a notification's call-to-action leads. */
function openPage(page: string, tripId?: string) {
  if (!navigationRef.isReady()) return;
  switch (page) {
    case 'dashboard':
    case 'home':
      return navigationRef.navigate('Tabs', { screen: 'Home' });
    case 'marketplace':
      return navigationRef.navigate('Tabs', { screen: 'Marketplace' });
    case 'trip':
    case 'trips':
    case 'booking-detail':
      return tripId ? navigationRef.navigate('TripFlow', { bookingId: tripId }) : navigationRef.navigate('Tabs', { screen: 'Trip' });
    case 'earnings':
      return navigationRef.navigate('Tabs', { screen: 'Profile', params: { openSection: 'earnings' } });
    case 'wallet':
      return navigationRef.navigate('Tabs', { screen: 'Wallet' });
    case 'profile':
      return navigationRef.navigate('Tabs', { screen: 'Profile' });
    default:
      return navigationRef.navigate('Notifications');
  }
}

/** Popups with tones for new events, the penalty acknowledgement that cannot be skipped, and push taps. */
function WorkspaceOverlays() {
  const { notifications, penalties, nextTrip } = useDriverData();
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const pending = penalties.find((p) => p.status === 'Pending' && !p.acknowledged && !doneIds.includes(p.id));
  // The push listener is registered once; it reads the trip to open from a ref.
  const tripRef = useRef<string | undefined>(undefined);
  const nextTripId = nextTrip?.id;
  useEffect(() => {
    tripRef.current = nextTripId;
  }, [nextTripId]);
  // The trip the notification is about; the next trip only when it names none.
  useEffect(() => onPushOpened((d) => openPage(d.page, d.bookingId || tripRef.current)), []);
  return (
    <>
      <NotificationPopups
        notifications={notifications}
        onOpen={(n: DriverNotification) => openPage(n.ctaPage, n.bookingId || nextTrip?.id)}
        onRead={(n) => {
          if (!n.read) markNotificationRead(n.id).catch(() => undefined);
        }}
      />
      {pending ? <PenaltyAckModal key={pending.id} penalty={pending} onDone={() => setDoneIds((ids) => [...ids, pending.id])} /> : null}
    </>
  );
}

/** Shares the driver's live position with the customer during a trip. */
function LocationSharing() {
  const { activeTrip } = useDriverData();
  useTripLocationSharing(activeTrip);
  return null;
}

export function MainNavigator({ onSignOut }: { onSignOut: () => void }) {
  return (
    <SignOutCtx.Provider value={onSignOut}>
      <ShellProvider>
        <Stack.Navigator screenOptions={{ headerTintColor: colors.ink, headerTitleStyle: { fontWeight: '800' }, headerShadowVisible: false }}>
          <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
          <Stack.Screen name="Marketplace" component={MarketplaceScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Earnings" component={EarningsScreen} options={{ headerShown: false }} />
          <Stack.Screen name="TripFlow" component={TripFlowScreen} options={{ headerShown: false }} />
          <Stack.Screen name="PreTrip" component={PreTripScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: false }} />
          <Stack.Screen name="UpdateDocuments" component={UpdateDocumentsScreen} options={{ title: 'Update documents' }} />
        </Stack.Navigator>
        <TripAutoFocus />
        <LocationSharing />
        <WorkspaceOverlays />
      </ShellProvider>
    </SignOutCtx.Provider>
  );
}

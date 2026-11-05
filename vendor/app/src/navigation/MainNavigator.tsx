import React, { createContext, useContext, useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackParamList, TabParamList } from './types';
import { useVendorData } from '../context/VendorData';
import { TripsScreen } from '../screens/TripsScreen';
import { BookingsScreen, BookingDetailScreen } from '../screens/BookingsScreen';
import { FleetScreen } from '../screens/FleetScreen';
import { EarningsScreen } from '../screens/EarningsScreen';
import { HelpdeskScreen } from '../screens/HelpdeskScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { AccountScreen } from '../screens/AccountScreen';
import { RequestsScreen } from '../screens/RequestsScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { PenaltiesScreen } from '../screens/PenaltiesScreen';
import { DocumentsScreen } from '../screens/DocumentsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { AgreementsScreen } from '../screens/AgreementsScreen';
import { NotificationPopups } from '../components/NotificationPopups';
import { PenaltyAckModal } from '../components/PenaltyAckModal';
import { useInbox } from '../context/Inbox';
import { markNotificationRead } from '../services/partnerNotifications';
import { onPushOpened } from '../services/notificationService';
import { navigationRef } from './navigationRef';
import { AppHeader } from '../components/AppHeader';
import { colors } from '../theme';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const SignOutCtx = createContext<() => void>(() => undefined);
export const useSignOut = () => useContext(SignOutCtx);

// Reference navigation: Bookings · Fleet · Trips · Earnings · Wallet (Helpdesk and Profile sit in the header).
const TAB_ICONS: Record<keyof TabParamList, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  Bookings: { on: 'calendar', off: 'calendar-outline' },
  Fleet: { on: 'car', off: 'car-outline' },
  Trips: { on: 'git-network', off: 'git-network-outline' },
  Earnings: { on: 'bar-chart', off: 'bar-chart-outline' },
  Wallet: { on: 'wallet', off: 'wallet-outline' },
};

function Tabs() {
  const { awaitingDispatch, marketTrips } = useVendorData();
  return (
    <Tab.Navigator
      initialRouteName="Trips"
      screenOptions={({ route }) => ({
        headerShown: true,
        tabBarHideOnKeyboard: true,
        header: () => <AppHeader />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600' },
        tabBarStyle: { minHeight: 64, paddingTop: 6 },
        tabBarIcon: ({ color, size, focused }) => <Ionicons name={TAB_ICONS[route.name][focused ? 'on' : 'off']} color={color} size={size} />,
      })}
    >
      <Tab.Screen name="Bookings" component={BookingsScreen} options={{ tabBarBadge: awaitingDispatch.length || undefined }} />
      <Tab.Screen name="Fleet" component={FleetScreen} />
      <Tab.Screen name="Trips" component={TripsScreen} options={{ tabBarBadge: marketTrips.length || undefined }} />
      <Tab.Screen name="Earnings" component={EarningsScreen} />
      <Tab.Screen name="Wallet" component={WalletScreen} />
    </Tab.Navigator>
  );
}

/** Where a notification's call-to-action leads. */
function openPage(page: string, bookingId?: string) {
  if (!navigationRef.isReady()) return;
  switch (page) {
    case 'market':
    case 'marketplace':
      return navigationRef.navigate('Tabs', { screen: 'Trips' });
    case 'trip':
    case 'trips':
    case 'booking-detail':
      // The booking the notification is about, when it names one.
      return bookingId ? navigationRef.navigate('BookingDetail', { id: bookingId }) : navigationRef.navigate('Tabs', { screen: 'Bookings' });
    case 'wallet':
    case 'payouts':
      return navigationRef.navigate('Tabs', { screen: 'Wallet' });
    case 'earnings':
      return navigationRef.navigate('Tabs', { screen: 'Earnings' });
    case 'drivers':
      return navigationRef.navigate('Tabs', { screen: 'Fleet', params: { tab: 'Drivers' } });
    case 'fleet':
    case 'vehicles':
      return navigationRef.navigate('Tabs', { screen: 'Fleet', params: { tab: 'Vehicles' } });
    case 'requests':
      return navigationRef.navigate('Helpdesk');
    case 'links':
    case 'partner-links':
      return navigationRef.navigate('Requests');
    case 'profile':
      return navigationRef.navigate('Account');
    case 'penalties':
      return navigationRef.navigate('Penalties');
    default:
      return navigationRef.navigate('Alerts');
  }
}

/** Popups with tones for new events, the penalty acknowledgement that cannot be skipped, and push taps. */
function WorkspaceOverlays() {
  const { notifications, unacknowledged } = useInbox();
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const pending = unacknowledged.find((x) => !doneIds.includes(x.id));
  useEffect(() => onPushOpened((d) => openPage(d.page, d.bookingId || undefined)), []);
  return (
    <>
      <NotificationPopups
        notifications={notifications}
        onOpen={(n) => openPage(n.ctaPage, n.bookingId || undefined)}
        onRead={(n) => {
          if (!n.read) markNotificationRead(n.id).catch(() => undefined);
        }}
      />
      {pending ? <PenaltyAckModal key={pending.id} penalty={pending} onDone={() => setDoneIds((ids) => [...ids, pending.id])} /> : null}
    </>
  );
}

export function MainNavigator({ onSignOut }: { onSignOut: () => void }) {
  return (
    <SignOutCtx.Provider value={onSignOut}>
      <Stack.Navigator
        screenOptions={{
          headerTintColor: colors.ink,
          headerTitleStyle: { fontWeight: '800' },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Requests" component={RequestsScreen} options={{ title: 'Linking requests' }} />
        <Stack.Screen name="Alerts" component={NotificationsScreen} options={{ title: 'Alerts' }} />
        <Stack.Screen name="Penalties" component={PenaltiesScreen} options={{ title: 'Penalties' }} />
        <Stack.Screen name="Documents" component={DocumentsScreen} options={{ title: 'Documents & compliance' }} />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Business & contact' }} />
        <Stack.Screen name="Agreements" component={AgreementsScreen} options={{ title: 'Agreements accepted' }} />
        <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'Profile' }} />
        <Stack.Screen name="Helpdesk" component={HelpdeskScreen} options={{ title: '24/7 Helpdesk' }} />
        <Stack.Screen name="BookingDetail" component={BookingDetailScreen} options={{ title: 'Booking details' }} />
      </Stack.Navigator>
      <WorkspaceOverlays />
    </SignOutCtx.Provider>
  );
}

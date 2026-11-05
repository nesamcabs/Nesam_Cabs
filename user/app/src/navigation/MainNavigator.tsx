import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { navigationRef } from './navigationRef';
import type { RootStackParamList, TabParamList } from './types';
import { BottomNav } from '../components/brand';
import { useCustomerData } from '../context/CustomerData';
import { BookScreen } from '../screens/BookScreen';
import { TripsScreen } from '../screens/TripsScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { AccountScreen } from '../screens/AccountScreen';
import { ActiveRideScreen } from '../screens/ActiveRideScreen';
import { SavedPlacesScreen } from '../screens/SavedPlacesScreen';
import { OffersScreen } from '../screens/OffersScreen';
import { SupportScreen } from '../screens/SupportScreen';
import { EditProfileScreen } from '../screens/EditProfileScreen';
import { ChooseRideScreen } from '../screens/ChooseRideScreen';
import { ConfirmBookingScreen } from '../screens/ConfirmBookingScreen';
import { PaymentHistoryScreen } from '../screens/PaymentHistoryScreen';
import { LegalDocumentsScreen } from '../screens/LegalDocumentsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { BookingDraftProvider } from '../context/BookingDraft';
import { NotificationPopups } from '../components/NotificationPopups';
import { useInbox } from '../context/Inbox';
import { markNotificationRead } from '../services/partnerNotifications';
import { onPushOpened } from '../services/notificationService';
import { colors, fonts } from '../theme';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

// Rides the rider minimised this session — not re-opened automatically.
interface RideFocus {
  dismiss: (bookingId: string) => void;
  undismiss: (bookingId: string) => void;
}
const RideFocusCtx = createContext<RideFocus>({ dismiss: () => undefined, undismiss: () => undefined });
export const useRideFocus = () => useContext(RideFocusCtx);

// The reference's five-item navigation replaces the stock tab bar: the four services all
// open the Book tab; My Bookings and Notifications are reached from Account and the header,
// and highlight Account like the reference does for every non-home page.
function Tabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <BottomNav active={props.state.routes[props.state.index]?.name === 'Book' ? undefined : 'account'} />}
      screenOptions={{ headerShown: false, tabBarPosition: 'bottom' }}
    >
      <Tab.Screen name="Book" component={BookScreen} options={{ title: 'Book a cab' }} />
      <Tab.Screen name="Trips" component={TripsScreen} options={{ title: 'My Bookings' }} />
      <Tab.Screen name="Alerts" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Tab.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
    </Tab.Navigator>
  );
}

/** Where a notification's call-to-action (or a tapped push) leads. */
function openPage(page: string) {
  if (!navigationRef.isReady()) return;
  switch (page) {
    case 'trips':
    case 'booking-detail':
      return navigationRef.navigate('Tabs', { screen: 'Trips' });
    case 'book':
      return navigationRef.navigate('Tabs', { screen: 'Book' });
    case 'support':
      return navigationRef.navigate('Support');
    default:
      return navigationRef.navigate('Tabs', { screen: 'Alerts' });
  }
}

/** Colour-coded popups with a tone per type for new events, and push-tap routing. */
function InboxOverlays() {
  const { notifications } = useInbox();
  useEffect(() => onPushOpened((d) => openPage(d.page)), []);
  return (
    <NotificationPopups
      notifications={notifications}
      onOpen={(n) => openPage(n.ctaPage)}
      onRead={(n) => {
        if (!n.read) markNotificationRead(n.id).catch(() => undefined);
      }}
    />
  );
}

/** State restoration: open the live ride (or an unrated finished one) on launch. */
function RideAutoFocus({ dismissed }: { dismissed: React.MutableRefObject<Set<string>> }) {
  const { liveRide, unratedTrip } = useCustomerData();
  const candidateId = (liveRide ?? unratedTrip)?.id ?? null;

  useEffect(() => {
    if (!candidateId || dismissed.current.has(candidateId)) return undefined;
    // The navigator mounts in the same commit; wait until it can navigate.
    let tries = 0;
    const attempt = () => {
      if (!navigationRef.isReady()) {
        if (tries++ < 20) timer = setTimeout(attempt, 100);
        return;
      }
      if (navigationRef.getCurrentRoute()?.name === 'ActiveRide') return;
      navigationRef.navigate('ActiveRide', { bookingId: candidateId });
    };
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(attempt, 0);
    return () => clearTimeout(timer);
  }, [candidateId, dismissed]);
  return null;
}

export function MainNavigator() {
  const dismissed = useRef<Set<string>>(new Set());
  const dismiss = useCallback((id: string) => {
    dismissed.current.add(id);
  }, []);
  const undismiss = useCallback((id: string) => {
    dismissed.current.delete(id);
  }, []);
  const focus = useMemo(() => ({ dismiss, undismiss }), [dismiss, undismiss]);

  return (
    <RideFocusCtx.Provider value={focus}>
      <BookingDraftProvider>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: fonts.extraBold, fontWeight: '800' },
          headerShadowVisible: false,
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="ActiveRide" component={ActiveRideScreen} />
        <Stack.Screen name="SavedPlaces" component={SavedPlacesScreen} />
        <Stack.Screen name="Offers" component={OffersScreen} />
        <Stack.Screen name="Support" component={SupportScreen} />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} />
        <Stack.Screen name="ChooseRide" component={ChooseRideScreen} />
        <Stack.Screen name="ConfirmBooking" component={ConfirmBookingScreen} />
        <Stack.Screen name="PaymentHistory" component={PaymentHistoryScreen} />
        <Stack.Screen name="LegalDocuments" component={LegalDocumentsScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
      <RideAutoFocus dismissed={dismissed} />
      <InboxOverlays />
      </BookingDraftProvider>
    </RideFocusCtx.Provider>
  );
}

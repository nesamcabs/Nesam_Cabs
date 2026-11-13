import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { navigationRef } from './navigationRef';
import type { RootStackParamList, TabParamList } from './types';
import { BottomNav } from '../components/brand';
import { useCustomerData } from '../context/CustomerData';
import { BookScreen } from '../screens/BookScreen';
import { LocalRentalsScreen } from '../screens/LocalRentalsScreen';
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
import { NotificationPopups } from '../components/NotificationPopups';
import { SideDrawer } from '../components/SideDrawer';
import { DrawerProvider } from '../context/Drawer';
import { DockPadding } from '../context/Dock';
import { takeResumeFares, useAuthGate } from '../context/AuthGate';
import { SignInPrompt } from '../components/SignInPrompt';
import { useBookingDraft } from '../context/BookingDraft';
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

// The website's floating bar (Outstation · Multicity · Local · Airport · My trips) sits under every tab page. The
// service tabs follow the service chosen on the booking form; My trips lights up on the trips page; the profile and
// Notifications belong to none of them (they open from the side menu and the header).
function tabActive(name?: string): 'rental' | 'trips' | null | undefined {
  if (name === 'Book') return undefined;
  if (name === 'Rentals') return 'rental';
  if (name === 'Trips') return 'trips';
  return null;
}

function Tabs() {
  return (
    <DockPadding>
    <Tab.Navigator
      initialRouteName="Book"
      tabBar={(props) => <BottomNav active={tabActive(props.state.routes[props.state.index]?.name)} />}
      screenOptions={{ headerShown: false, tabBarPosition: 'bottom' }}
    >
      <Tab.Screen name="Book" component={BookScreen} options={{ title: 'Book a cab' }} />
      <Tab.Screen name="Rentals" component={LocalRentalsScreen} options={{ title: 'Local Rentals' }} />
      <Tab.Screen name="Trips" component={TripsTab} options={{ title: 'My Bookings' }} />
      <Tab.Screen name="Alerts" component={AlertsTab} options={{ title: 'Notifications' }} />
      <Tab.Screen name="Account" component={AccountTab} options={{ title: 'Account' }} />
    </Tab.Navigator>
    </DockPadding>
  );
}

/** Pages that keep the website's bottom bar even though they open above the tabs (support, offers, account pages, policies). */
function withDock<P extends object>(Page: React.ComponentType<P>): React.ComponentType<P> {
  function Docked(props: P) {
    return (
      <DockPadding>
        <View style={{ flex: 1 }}>
          <Page {...props} />
          <BottomNav active={null} />
        </View>
      </DockPadding>
    );
  }
  Docked.displayName = `Docked(${Page.displayName ?? Page.name ?? 'Page'})`;
  return Docked;
}
/** Pages that need an account: a guest sees the sign-in prompt in their place. */
function gated<P extends object>(Page: React.ComponentType<P>, title: string, message: string): React.ComponentType<P> {
  function Gated(props: P) {
    const { guest } = useAuthGate();
    return guest ? <SignInPrompt title={title} message={message} /> : <Page {...props} />;
  }
  Gated.displayName = `Gated(${Page.displayName ?? Page.name ?? 'Page'})`;
  return Gated;
}
const TripsTab = gated(TripsScreen, 'My Bookings', 'Sign in with your mobile number to see your upcoming, ongoing and past trips.');
const AlertsTab = gated(NotificationsScreen, 'Notifications', 'Sign in to see booking and payment updates.');
const AccountTab = gated(AccountScreen, 'Account', 'Sign in to manage your profile, saved places and payments.');
const ActiveRide = gated(ActiveRideScreen, 'Trip Details', 'Sign in to follow your trip.');
const ChooseRide = gated(ChooseRideScreen, 'Choose a cab', 'Sign in to compare fares for your trip.');
const ConfirmBooking = gated(ConfirmBookingScreen, 'Review & Book', 'Sign in to review and confirm your booking.');
const SavedPlaces = withDock(gated(SavedPlacesScreen, 'Saved Addresses', 'Sign in to keep your regular pickup and drop places.'));
const Offers = withDock(gated(OffersScreen, 'Offers & Coupons', 'Sign in to see the offers you can use.'));
const Support = withDock(gated(SupportScreen, 'Help & Support', 'Sign in to raise a request or follow one up. You can always call us on +91 90250 99990.'));
const EditProfile = withDock(gated(EditProfileScreen, 'My Profile', 'Sign in to see and edit your profile.'));
const PaymentHistory = withDock(gated(PaymentHistoryScreen, 'Payments & Refunds', 'Sign in to see your payments and refunds.'));
// The policies are public, as on the website; the screen shows the account's agreement versions only when signed in.
const LegalDocuments = withDock(LegalDocumentsScreen);
const Settings = withDock(gated(SettingsScreen, 'Settings', 'Sign in to change your settings.'));

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

/** A booking started as a guest carries straight on to the fares once the rider has signed in. */
function ResumeFares() {
  const { draft } = useBookingDraft();
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !takeResumeFares()) return;
    started.current = true;
    if (!draft.pickup || !draft.drop || !draft.scheduledAt) return;
    let tries = 0;
    const go = () => {
      if (!navigationRef.isReady()) {
        if (tries++ < 20) setTimeout(go, 100);
        return;
      }
      navigationRef.navigate('ChooseRide');
    };
    setTimeout(go, 150);
  }, [draft.pickup, draft.drop, draft.scheduledAt]);
  return null;
}

export function MainNavigator({ guest = false }: { guest?: boolean }) {
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
      <DrawerProvider>
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
        <Stack.Screen name="ActiveRide" component={ActiveRide} />
        <Stack.Screen name="SavedPlaces" component={SavedPlaces} />
        <Stack.Screen name="Offers" component={Offers} />
        <Stack.Screen name="Support" component={Support} />
        <Stack.Screen name="EditProfile" component={EditProfile} />
        <Stack.Screen name="ChooseRide" component={ChooseRide} />
        <Stack.Screen name="ConfirmBooking" component={ConfirmBooking} />
        <Stack.Screen name="PaymentHistory" component={PaymentHistory} />
        <Stack.Screen name="LegalDocuments" component={LegalDocuments} />
        <Stack.Screen name="Settings" component={Settings} />
      </Stack.Navigator>
      {guest ? null : <ResumeFares />}
      <RideAutoFocus dismissed={dismissed} />
      <InboxOverlays />
      <SideDrawer />
      </DrawerProvider>
    </RideFocusCtx.Provider>
  );
}

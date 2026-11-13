// The approved driver's workspace: the responsive frame (sidebar / rail / bottom bar) around one stack whose first page
// holds the workspace pages. Trip, camera, notification and document pages open above it, inside the same frame.
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RootStackParamList, TabParamList } from './types';
import { navigationRef } from './navigationRef';
import { useDriverData } from '../context/DriverData';
import { HomeScreen } from '../screens/HomeScreen';
import MarketplaceScreen from '../screens/MarketplaceScreen';
import { TripsScreen } from '../screens/TripsScreen';
import { LocalTaxiScreen } from '../screens/LocalTaxiScreen';
import { TripFlowScreen } from '../screens/TripFlowScreen';
import { EarningsScreen } from '../screens/EarningsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ProfileSectionScreen, PROFILE_SECTION_TITLES } from '../screens/ProfileSectionScreen';
import { PreTripScreen } from '../screens/PreTripScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { UpdateDocumentsScreen } from '../screens/UpdateDocumentsScreen';
import { useTripLocationSharing } from '../hooks/useTripLocationSharing';
import { NotificationPopups } from '../components/NotificationPopups';
import { PenaltyAckModal } from '../components/PenaltyAckModal';
import { markNotificationRead } from '../services/driverService';
import { onPushOpened } from '../services/notificationService';
import { openNotificationTarget } from './openNotification';
import type { DriverNotification } from '../types/driver';
import { nx } from '../theme/nx';
import { POPPINS } from '../theme/fonts';
import { ShellProvider } from '../components/nx/Shell';
import { AppFrame } from '../components/nx/AppFrame';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const SignOutCtx = createContext<() => void>(() => undefined);
export const useSignOut = () => useContext(SignOutCtx);

/** The workspace pages. Their navigation is drawn by AppFrame, so the tab navigator's own bar is hidden. */
function Pages() {
  const { account } = useDriverData();
  // A vendor's employee drives assigned trips only: no marketplace, commission, wallet or payout pages.
  const fleet = !!account.driver.vendorId;
  return (
    <Tab.Navigator initialRouteName="Home" backBehavior="history" screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: nx.page } }} tabBar={() => null}>
      <Tab.Screen name="Home" component={HomeScreen} />
      {fleet ? null : <Tab.Screen name="Marketplace" component={MarketplaceScreen} />}
      <Tab.Screen name="Local" component={LocalTaxiScreen} />
      <Tab.Screen name="Trip" component={TripsScreen} />
      {fleet ? null : <Tab.Screen name="Earnings" component={EarningsScreen} />}
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

/** Popups with tones for new events, the penalty acknowledgement that cannot be skipped, and push taps. */
function WorkspaceOverlays() {
  const { notifications, penalties, nextTrip, account } = useDriverData();
  const fleet = !!account.driver.vendorId;
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const pending = penalties.find((p) => p.status === 'Pending' && !p.acknowledged && !doneIds.includes(p.id));
  // The push listener is registered once; it reads the trip to open (and the driver kind) from refs.
  const tripRef = useRef<string | undefined>(undefined);
  const fleetRef = useRef(fleet);
  const nextTripId = nextTrip?.id;
  useEffect(() => {
    tripRef.current = nextTripId;
    fleetRef.current = fleet;
  }, [nextTripId, fleet]);
  // The trip the notification is about; the next trip only when it names none.
  useEffect(() => onPushOpened((d) => openNotificationTarget(d.page, { tripId: d.bookingId || tripRef.current, fleet: fleetRef.current })), []);
  return (
    <>
      <NotificationPopups
        notifications={notifications}
        onOpen={(n: DriverNotification) => openNotificationTarget(n.ctaPage, { tripId: n.bookingId || nextTrip?.id, fleet })}
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
        <AppFrame>
          <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: nx.page }, animation: 'fade_from_bottom' }}>
            <Stack.Screen name="Tabs" component={Pages} />
            <Stack.Screen name="TripFlow" component={TripFlowScreen} />
            <Stack.Screen name="PreTrip" component={PreTripScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen
              name="ProfileSection"
              component={ProfileSectionScreen}
              options={({ route }) => ({
                headerShown: true,
                title: PROFILE_SECTION_TITLES[route.params.section],
                headerTintColor: nx.ink,
                headerShadowVisible: false,
                headerStyle: { backgroundColor: nx.white },
                headerTitleStyle: { fontFamily: POPPINS.bold, fontSize: 17 },
              })}
            />
            <Stack.Screen
              name="UpdateDocuments"
              component={UpdateDocumentsScreen}
              options={{
                headerShown: true,
                title: 'Update documents',
                headerTintColor: nx.ink,
                headerShadowVisible: false,
                headerStyle: { backgroundColor: nx.white },
                headerTitleStyle: { fontFamily: POPPINS.bold, fontSize: 17 },
              }}
            />
          </Stack.Navigator>
        </AppFrame>
        <TripAutoFocus />
        <LocationSharing />
        <WorkspaceOverlays />
      </ShellProvider>
    </SignOutCtx.Provider>
  );
}

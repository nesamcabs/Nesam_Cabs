// The approved-vendor workspace: one stack of pages inside the responsive NESAM Partner shell (header + sidebar on wide
// screens, header + bottom bar on phones), plus the notification popups and the penalty acknowledgement that cannot be skipped.
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { AppShell } from '../components/shell/AppShell';
import { VerificationLock } from '../screens/auth/DocumentsRequiredScreen';
import type { VendorRecord } from '../types/vendor';
import { NotificationPopups } from '../components/NotificationPopups';
import { PenaltyAckModal } from '../components/PenaltyAckModal';
import { useInbox } from '../context/Inbox';
import { markNotificationRead } from '../services/partnerNotifications';
import { onPushOpened } from '../services/notificationService';
import { openPage } from './openPage';
import { SignOutCtx } from './signOut';
import { colors } from '../theme';
import { TripsScreen } from '../screens/trips/TripsScreen';
import { DutyScreen, MyBidsScreen } from '../screens/trips/BidsAndDuty';
import { BookingsScreen } from '../screens/bookings/BookingsScreen';
import { BookingDetailScreen } from '../screens/bookings/BookingDetailScreen';
import { AssignScreen } from '../screens/bookings/AssignScreen';
import { FleetScreen } from '../screens/fleet/FleetScreen';
import { DriverScreen, VehicleScreen } from '../screens/fleet/EntityScreens';
import { FleetAddScreen } from '../screens/fleet/FleetAddScreen';
import { DocumentsScreen, LinkingScreen } from '../screens/fleet/LinkingAndDocs';
import { EarningsScreen } from '../screens/money/EarningsScreen';
import { WalletScreen } from '../screens/money/WalletScreen';
import { PenaltyScreen } from '../screens/money/PenaltyScreen';
import { HelpdeskScreen } from '../screens/account/HelpdeskScreen';
import { AccountScreen } from '../screens/account/AccountScreen';
import { AgreementsScreen, AlertsScreen, BusinessScreen } from '../screens/account/InfoScreens';

export { useSignOut } from './signOut';

const Stack = createNativeStackNavigator<RootStackParamList>();

const TITLES: Record<keyof RootStackParamList, string> = {
  Trips: 'Trips', Bookings: 'Bookings', Fleet: 'Fleet', Earnings: 'Earnings', Wallet: 'Wallet', MyBids: 'My bids', Duty: 'Duty details',
  Booking: 'Booking details', Assign: 'Assign driver', FleetAdd: 'Add to fleet', Vehicle: 'Vehicle details', Driver: 'Driver details',
  Linking: 'Linking requests', Documents: 'Documents & verification', Penalty: 'Penalty notice', Helpdesk: '24/7 Helpdesk', Account: 'Profile',
  Business: 'Business & contact', Agreements: 'Agreements', Alerts: 'Notifications',
};

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
        onRead={(n) => { if (!n.read) markNotificationRead(n.id).catch(() => undefined); }}
      />
      {pending ? <PenaltyAckModal key={pending.id} penalty={pending} onDone={() => setDoneIds((ids) => [...ids, pending.id])} /> : null}
    </>
  );
}

export function MainNavigator({ onSignOut, locked = null }: { onSignOut: () => void; locked?: VendorRecord | null }) {
  return (
    <SignOutCtx.Provider value={onSignOut}>
      <AppShell lock={locked ? <VerificationLock record={locked} onSignOut={onSignOut} /> : null}>
        <Stack.Navigator
          initialRouteName="Trips"
          screenOptions={({ route }) => ({
            headerShown: false,
            title: `${TITLES[route.name]} · NESAM Partner`,
            contentStyle: { backgroundColor: colors.bg },
            animation: Platform.OS === 'web' ? 'none' : ['Trips', 'Bookings', 'Fleet', 'Earnings', 'Wallet', 'Helpdesk', 'Account'].includes(route.name) ? 'fade' : 'slide_from_right',
          })}
        >
          <Stack.Screen name="Trips" component={TripsScreen} />
          <Stack.Screen name="Bookings" component={BookingsScreen} />
          <Stack.Screen name="Fleet" component={FleetScreen} />
          <Stack.Screen name="Earnings" component={EarningsScreen} />
          <Stack.Screen name="Wallet" component={WalletScreen} />
          <Stack.Screen name="MyBids" component={MyBidsScreen} />
          <Stack.Screen name="Duty" component={DutyScreen} />
          <Stack.Screen name="Booking" component={BookingDetailScreen} />
          <Stack.Screen name="Assign" component={AssignScreen} />
          <Stack.Screen name="FleetAdd" component={FleetAddScreen} />
          <Stack.Screen name="Vehicle" component={VehicleScreen} />
          <Stack.Screen name="Driver" component={DriverScreen} />
          <Stack.Screen name="Linking" component={LinkingScreen} />
          <Stack.Screen name="Documents" component={DocumentsScreen} />
          <Stack.Screen name="Penalty" component={PenaltyScreen} />
          <Stack.Screen name="Helpdesk" component={HelpdeskScreen} />
          <Stack.Screen name="Account" component={AccountScreen} />
          <Stack.Screen name="Business" component={BusinessScreen} />
          <Stack.Screen name="Agreements" component={AgreementsScreen} />
          <Stack.Screen name="Alerts" component={AlertsScreen} />
        </Stack.Navigator>
      </AppShell>
      {/* Popups, push taps and the penalty prompt would let a locked partner act, so they wait for verification. */}
      {!locked ? <WorkspaceOverlays /> : null}
    </SignOutCtx.Provider>
  );
}

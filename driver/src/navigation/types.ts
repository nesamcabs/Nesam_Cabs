import type { NavigatorScreenParams } from '@react-navigation/native';

/** The workspace pages. Every page is reachable from the sidebar (desktop / tablet) or the bottom bar (phone). */
export type TabParamList = {
  Home: undefined;
  Marketplace: undefined;
  Trip: { tab?: 'upcoming' | 'completed' | 'cancelled' } | undefined;
  Earnings: undefined;
  Wallet: undefined;
  Profile: undefined;
};

export type TabName = keyof TabParamList;

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  PreTrip: { bookingId: string };
  TripFlow: { bookingId: string };
  Notifications: undefined;
  UpdateDocuments: undefined;
};

declare global {
  // React Navigation's documented global typing hook.
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}

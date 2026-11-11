import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Marketplace: undefined;
  Trip: undefined;
  Home: undefined;
  Wallet: undefined;
  Profile: { openSection?: string } | undefined;
  Earnings?: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  PreTrip: { bookingId: string };
  TripFlow: { bookingId: string };
  Notifications: undefined;
  UpdateDocuments: undefined;
  Marketplace: undefined;
  Earnings: undefined;
};

declare global {
  // React Navigation's documented global typing hook.
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}

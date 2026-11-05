import type { NavigatorScreenParams } from '@react-navigation/native';

/** `add` carries a timestamp so "Add …" from another screen opens the sheet every time, not only the first. */
export type TabParamList = {
  Bookings: undefined;
  /** `tab` opens Vehicles or Drivers; `add` (a timestamp) asks that list to open its add sheet. */
  Fleet: { tab?: 'Vehicles' | 'Drivers'; add?: number } | undefined;
  Trips: undefined;
  Earnings: undefined;
  Wallet: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Requests: undefined;
  Alerts: undefined;
  Penalties: undefined;
  Documents: undefined;
  Profile: undefined;
  Agreements: undefined;
  /** Profile (My Business and account settings). */
  Account: undefined;
  Helpdesk: undefined;
  BookingDetail: { id: string };
};

declare global {
  // React Navigation's documented global typing hook.
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}

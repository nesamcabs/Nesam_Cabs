// Every NESAM Partner page. The five sections (Bookings · Fleet · Trips · Earnings · Wallet) sit in the sidebar on wide
// screens and the bottom bar on phones; Helpdesk and Profile sit in the header.
export type FleetTab = 'Vehicles' | 'Drivers';
export type BookingTab = 'Accepted' | 'Upcoming' | 'On Trip' | 'Completed' | 'Cancelled';
export type WalletTab = 'All' | 'Trips' | 'Payments' | 'Penalties' | 'Payouts';

export type RootStackParamList = {
  Trips: undefined;
  Bookings: { tab?: BookingTab } | undefined;
  Fleet: { tab?: FleetTab } | undefined;
  Earnings: undefined;
  Wallet: { tab?: WalletTab } | undefined;

  MyBids: undefined;
  Duty: { id: string };
  Booking: { id: string };
  Assign: { id: string };

  FleetAdd: { kind: 'vehicle' | 'driver' };
  Vehicle: { id: string };
  Driver: { id: string };
  Linking: undefined;
  Documents: undefined;

  Penalty: { id: string };
  Helpdesk: undefined;
  Account: undefined;
  Business: undefined;
  Agreements: undefined;
  Alerts: undefined;
};

export type RouteName = keyof RootStackParamList;
export type Section = 'Bookings' | 'Fleet' | 'Trips' | 'Earnings' | 'Wallet';

declare global {
  // React Navigation's documented global typing hook.
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}

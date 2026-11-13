import type { NavigatorScreenParams } from '@react-navigation/native';

/** The workspace pages. Every page is reachable from the sidebar (desktop / tablet) or the bottom bar (phone). */
export type TabParamList = {
  Home: undefined;
  Marketplace: undefined;
  /** Local duty: `tab` picks Hourly Rental or Pickup & Drop. */
  Local: { tab?: 'rental' | 'pickup_drop'; at?: number } | undefined;
  Trip: { tab?: 'upcoming' | 'completed' | 'cancelled' } | undefined;
  /** One page for money: balance, credited earnings, settlement review, payout account and activity. */
  Earnings: undefined;
  Profile: undefined;
};

export type TabName = keyof TabParamList;

/** The pages opened from the My Profile menu. */
export type ProfileSection = 'details' | 'contact' | 'documents' | 'licence' | 'penalties';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  /** The live photo check of one trip (`bookingId`) or, once for the whole day, of a local duty (`shiftId`). */
  PreTrip: { bookingId?: string; shiftId?: string };
  TripFlow: { bookingId: string };
  Notifications: undefined;
  UpdateDocuments: undefined;
  ProfileSection: { section: ProfileSection };
};

declare global {
  // React Navigation's documented global typing hook.
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}

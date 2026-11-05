import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Book: undefined;
  Trips: undefined;
  Alerts: undefined;
  Account: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  ActiveRide: { bookingId: string; unconfirmed?: boolean; /** Show the booking-confirmed ticket first (set right after booking). */ justBooked?: boolean };
  SavedPlaces: undefined;
  Offers: undefined;
  Support: { bookingId?: string } | undefined;
  EditProfile: undefined;
  /** Booking step 2 and 3; both read the shared BookingDraft. */
  ChooseRide: undefined;
  ConfirmBooking: undefined;
  PaymentHistory: undefined;
  LegalDocuments: undefined;
  Settings: undefined;
};

declare global {
  // React Navigation's documented global typing hook.
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}

// The workspace navigation, shared by the desktop sidebar, the tablet rail and the phone bottom bar.
import { useEffect, useState } from 'react';
import { StackActions } from '@react-navigation/native';
import type { NxIconName } from '../components/nx/Icon';
import { navigationRef } from './navigationRef';
import type { TabName } from './types';

export interface NavItem {
  id: TabName;
  label: string;
  icon: NxIconName;
  /** Shown in the phone bottom bar. The sidebar shows every item. */
  phone: boolean;
  /** Owner-drivers only: a vendor's employee is paid by the vendor and gets trips from them. */
  ownerOnly?: boolean;
  /** Fleet drivers only: local duty is planned by the driver's fleet partner. */
  fleetOnly?: boolean;
}

// The Driver 2.0 workspace: Drive · Bookings · My Trips · Earnings · Wallet. Profile opens from the avatar; Overview (the
// old dashboard, which carries the account alerts and the day's figures) stays in the sidebar only.
export const NAV_ITEMS: NavItem[] = [
  { id: 'Local', label: 'Drive', icon: 'locate', phone: true },
  { id: 'Marketplace', label: 'Bookings', icon: 'map', phone: true },
  { id: 'Trip', label: 'My Trips', icon: 'trip', phone: true },
  { id: 'Earnings', label: 'Earnings', icon: 'chart', phone: true, ownerOnly: true },
  { id: 'Wallet', label: 'Wallet', icon: 'wallet', phone: false, ownerOnly: true },
  { id: 'Home', label: 'Overview', icon: 'home', phone: false },
  { id: 'Profile', label: 'Profile', icon: 'user', phone: false },
];

export const navItemsFor = (fleet: boolean) => NAV_ITEMS.filter((i) => !(fleet && i.ownerOnly) && !(!fleet && i.fleetOnly));

/** Page heading and caption for each page (the reference's `titles` table). */
export const PAGE_TITLES: Record<string, [string, string]> = {
  Tabs: ['Drive', 'Local Pickup & Drop and Hourly Rental, one after another.'],
  Home: ['Overview', 'Your day at a glance.'],
  Marketplace: ['Bookings', 'Available duties for your vehicle.'],
  Local: ['Drive', 'Local Pickup & Drop and Hourly Rental, one after another.'],
  Trip: ['My Trips', 'Your accepted and assigned journeys.'],
  Earnings: ['Earnings', 'What was credited, and what is under settlement review.'],
  Wallet: ['Wallet', 'Balance, payouts and your payout account.'],
  Profile: ['My Profile', 'Your vehicle, documents & preferences.'],
  TripFlow: ['Trip Details', 'Start, navigate, board and close your trip.'],
  PreTrip: ['Trip photos', 'Live trip-start photographs.'],
  Notifications: ['Notifications', 'Trips, approvals, payments and penalties.'],
  UpdateDocuments: ['Update documents', 'Refresh your licence and vehicle papers.'],
  ProfileSection: ['My Profile', 'Your vehicle, documents & preferences.'],
};

/** Which workspace page a route belongs to (a trip page highlights My Trips). */
export function navOwner(route: string): TabName | null {
  if (route === 'Tabs') return 'Local';
  if (route === 'TripFlow' || route === 'PreTrip') return 'Trip';
  if (route === 'UpdateDocuments' || route === 'ProfileSection') return 'Profile';
  return (['Home', 'Marketplace', 'Local', 'Trip', 'Earnings', 'Wallet', 'Profile'] as string[]).includes(route) ? (route as TabName) : null;
}

const readRoute = () => (navigationRef.isReady() ? (navigationRef.getCurrentRoute()?.name ?? 'Local') : 'Local');

/** The focused route's name, kept in sync with the navigation container (usable outside any navigator). */
export function useCurrentRoute(): string {
  const [name, setName] = useState(readRoute);
  useEffect(() => {
    const sync = () => setName(readRoute());
    sync();
    const unsubscribe = navigationRef.addListener('state', sync);
    // The container may become ready after this mounts.
    const t = setTimeout(sync, 0);
    return () => {
      unsubscribe();
      clearTimeout(t);
    };
  }, []);
  return name;
}

/** Opens a workspace page from anywhere, closing any trip / notification page stacked above the pages. */
export function goTab(screen: TabName, params?: Record<string, unknown>) {
  if (!navigationRef.isReady()) return;
  const root = navigationRef.getRootState();
  const top = root?.routes[root.index ?? 0]?.name;
  if (top && top !== 'Tabs' && (root?.routes.length ?? 0) > 1) navigationRef.dispatch(StackActions.popToTop());
  navigationRef.navigate('Tabs', { screen, params } as never);
}

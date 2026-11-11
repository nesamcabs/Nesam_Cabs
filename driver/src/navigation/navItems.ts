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
  /** Shown in the phone bottom bar (five slots, as in the reference). The sidebar shows every item. */
  phone: boolean;
  /** Owner-drivers only: a vendor's employee is paid by the vendor and gets trips from them. */
  ownerOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'Home', label: 'Home', icon: 'home', phone: true },
  { id: 'Marketplace', label: 'Duties', icon: 'marketplace', phone: false, ownerOnly: true },
  { id: 'Trip', label: 'My Trips', icon: 'trip', phone: true },
  { id: 'Earnings', label: 'Earnings', icon: 'chart', phone: true, ownerOnly: true },
  { id: 'Wallet', label: 'Wallet', icon: 'wallet', phone: true, ownerOnly: true },
  { id: 'Profile', label: 'Profile', icon: 'user', phone: true },
];

export const navItemsFor = (fleet: boolean) => NAV_ITEMS.filter((i) => !(fleet && i.ownerOnly));

/** Page heading and caption for each page (the reference's `titles` table). */
export const PAGE_TITLES: Record<string, [string, string]> = {
  Tabs: ['Dashboard', 'Your trips, ready when you are.'],
  Home: ['Dashboard', 'Your trips, ready when you are.'],
  Marketplace: ['Available duties', 'Open duties you can accept or bid on.'],
  Trip: ['My Trips', 'Upcoming duties & completed trips.'],
  Earnings: ['Earnings', 'Credited earnings & pending reviews.'],
  Wallet: ['Wallet', 'Balance, payouts & settlement status.'],
  Profile: ['My Profile', 'Your vehicle, documents & preferences.'],
  TripFlow: ['Trip Details', 'Start, navigate, board and close your trip.'],
  PreTrip: ['Trip photos', 'Live trip-start photographs.'],
  Notifications: ['Notifications', 'Trips, approvals, payments and penalties.'],
  UpdateDocuments: ['Update documents', 'Refresh your licence and vehicle papers.'],
};

/** Which workspace page a route belongs to (a trip page highlights My Trips). */
export function navOwner(route: string): TabName | null {
  if (route === 'Tabs') return 'Home';
  if (route === 'TripFlow' || route === 'PreTrip') return 'Trip';
  if (route === 'UpdateDocuments') return 'Profile';
  return (['Home', 'Marketplace', 'Trip', 'Earnings', 'Wallet', 'Profile'] as string[]).includes(route) ? (route as TabName) : null;
}

const readRoute = () => (navigationRef.isReady() ? (navigationRef.getCurrentRoute()?.name ?? 'Home') : 'Home');

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

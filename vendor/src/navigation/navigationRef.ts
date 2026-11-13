import { useEffect, useState } from 'react';
import { CommonActions, createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList, RouteName, Section } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export const SECTIONS: Section[] = ['Bookings', 'Fleet', 'Trips', 'Earnings', 'Wallet'];

/** Which section (or header page) a route belongs to, for highlighting the sidebar / bottom bar. */
export function sectionOf(route: string | undefined): Section | 'Helpdesk' | 'Account' | '' {
  switch (route) {
    case 'Trips': case 'MyBids': case 'Duty': return 'Trips';
    case 'Bookings': case 'Booking': case 'Assign': return 'Bookings';
    case 'Fleet': case 'FleetAdd': case 'Vehicle': case 'Driver': case 'Documents': return 'Fleet';
    case 'Earnings': return 'Earnings';
    case 'Wallet': case 'Penalty': return 'Wallet';
    case 'Helpdesk': return 'Helpdesk';
    case 'Account': case 'Business': case 'Agreements': case 'Alerts': return 'Account';
    default: return '';
  }
}

/**
 * Open a top-level page. The history becomes [Trips, page] so Back (and the Android back button) returns to Trips,
 * the reference's "Home".
 */
export function goSection<T extends Section | 'Helpdesk' | 'Account'>(name: T, params?: RootStackParamList[T]): void {
  if (!navigationRef.isReady()) return;
  const routes = name === 'Trips' ? [{ name: 'Trips' as const }] : [{ name: 'Trips' as const }, { name, params }];
  navigationRef.dispatch(CommonActions.reset({ index: routes.length - 1, routes }));
}

export function goHome(): void {
  goSection('Trips');
}

export function goBack(): void {
  if (!navigationRef.isReady()) return;
  if (navigationRef.canGoBack()) navigationRef.goBack();
  else goHome();
}

/** The focused route name, kept in sync with the navigation state. */
export function useCurrentRoute(): RouteName | undefined {
  const [name, setName] = useState<RouteName | undefined>(() => (navigationRef.isReady() ? (navigationRef.getCurrentRoute()?.name as RouteName) : undefined));
  useEffect(() => {
    const update = () => setName(navigationRef.getCurrentRoute()?.name as RouteName | undefined);
    update();
    return navigationRef.addListener('state', update);
  }, []);
  return name;
}

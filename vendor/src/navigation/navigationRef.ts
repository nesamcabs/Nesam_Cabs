import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { CommonActions, createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList, RouteName, Section } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// Web: the screen being left is hidden with aria-hidden while the button that opened the next one still has focus, and
// Chrome warns ("Blocked aria-hidden on an element because its descendant retained focus"). Release that focus as the
// navigation action is dispatched, before the old screen is hidden.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  navigationRef.addListener('__unsafe_action__', ({ data }) => {
    if (data.noop) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && el !== document.body) el.blur();
  });
}

export const SECTIONS: Section[] = ['Bookings', 'Fleet', 'Trips', 'Earnings', 'Wallet'];

/** Which section (or header page) a route belongs to, for highlighting the sidebar / bottom bar. */
export function sectionOf(route: string | undefined): Section | 'Account' | '' {
  switch (route) {
    case 'Trips': case 'MyBids': case 'Duty': return 'Trips';
    case 'Bookings': case 'Booking': case 'Assign': return 'Bookings';
    case 'Fleet': case 'FleetAdd': case 'Vehicle': case 'Driver': case 'Documents': return 'Fleet';
    case 'Earnings': return 'Earnings';
    case 'Wallet': case 'Penalty': return 'Wallet';
    case 'Account': case 'Business': case 'Agreements': case 'Alerts': return 'Account';
    default: return '';
  }
}

/**
 * Open a top-level page. The history becomes [Bookings, page] so Back (and the Android back button) returns to Bookings,
 * the reference's "Home".
 */
export function goSection<T extends Section | 'Account'>(name: T, params?: RootStackParamList[T]): void {
  if (!navigationRef.isReady()) return;
  const routes = name === 'Bookings' ? [{ name: 'Bookings' as const }] : [{ name: 'Bookings' as const }, { name, params }];
  navigationRef.dispatch(CommonActions.reset({ index: routes.length - 1, routes }));
}

export function goHome(): void {
  goSection('Bookings');
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

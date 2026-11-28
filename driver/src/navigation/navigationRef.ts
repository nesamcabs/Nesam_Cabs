import { Platform } from 'react-native';
import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

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

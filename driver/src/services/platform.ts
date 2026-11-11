import { Platform } from 'react-native';

/**
 * The platform reported to trip functions. The server applies its web policy (settings/security.allowWebDriverTrips)
 * to 'web' and the Play Integrity check to 'android', so the website must never present itself as the Android app.
 */
export const CLIENT_PLATFORM: 'web' | 'android' = Platform.OS === 'web' ? 'web' : 'android';

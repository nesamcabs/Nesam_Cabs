// firebase/auth's public typings are the browser surface. Its React Native
// build (selected by Metro through the "react-native" export condition) also
// exports getReactNativePersistence — declared here so it type-checks.
import 'firebase/auth';
import type { Persistence, ReactNativeAsyncStorage } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}

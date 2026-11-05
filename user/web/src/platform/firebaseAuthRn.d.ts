// ../app/src/config/firebase.ts calls getReactNativePersistence, which only the
// React Native build of firebase/auth exports. It is never executed in the browser.
import 'firebase/auth';
import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: unknown): Persistence;
}

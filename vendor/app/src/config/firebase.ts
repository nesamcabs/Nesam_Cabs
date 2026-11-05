// Firebase for the Vendor app: same project, Auth users, Firestore and
// Storage as the Vendor Web panel. This is the public client configuration
// (identifiers, not secrets) — access is enforced by firestore.rules and
// storage.rules.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, getReactNativePersistence, initializeAuth, signInWithCustomToken, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, initializeFirestore, memoryLocalCache, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyClCvf1FUnXb6na8UeZ_knRBTCakAVJCQs',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'nesamtoursandtravels-202f5.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'nesamtoursandtravels-202f5',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'nesamtoursandtravels-202f5.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '391292064102',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:391292064102:web:9a8c8d3cbd314cc167b8a7',
};

export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

// initializeAuth may only run once per app; Fast Refresh re-evaluates this
// module, so fall back to the existing instance.
function createAuth(): Auth {
  try {
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    return getAuth(app);
  }
}
export const auth = createAuth();

// React Native has no IndexedDB, so the cache is in-memory; the live
// listeners re-hydrate everything (active ride included) on app start.
// Long-polling auto-detection avoids WebChannel stalls on some networks.
function createFirestore(): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: memoryLocalCache(),
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    return getFirestore(app);
  }
}
export const db = createFirestore();
export const storage = getStorage(app);

// ── Local testing against the Firebase emulators ────────────────────────────
// Only when EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true (never set for a release build).
// Run with EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-nesam so nothing can reach a real project.
if (process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true') {
  const host = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, Number(process.env.EXPO_PUBLIC_STORAGE_EMULATOR_PORT || 9199));
  connectFunctionsEmulator(getFunctions(app), host, 5001);
  // Lets an automated test (web preview) sign in with an emulator custom token.
  (globalThis as unknown as Record<string, unknown>).__nesamTestSignIn = (token: string) => signInWithCustomToken(auth, token);
}

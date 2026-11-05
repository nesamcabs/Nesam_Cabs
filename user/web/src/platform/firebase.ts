// Firebase for the customer website: the same project, Auth users, Firestore and
// Storage as the customer app. Replaces ../app/src/config/firebase.ts (see
// vite.config.ts), which is tied to React Native's auth persistence.
//
// This is the public client configuration (identifiers, not secrets); access is
// enforced by firestore.rules and storage.rules.
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken } from 'firebase/auth';
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

// Browser default persistence (IndexedDB / localStorage) keeps the rider signed in.
export const auth = getAuth(app);

// In-memory cache: a shared browser profile must not keep another rider's
// documents, and the live listeners re-hydrate everything on load.
// Long-polling auto-detection avoids WebChannel stalls on some networks.
function createFirestore(): Firestore {
  try {
    return initializeFirestore(app, { localCache: memoryLocalCache(), experimentalAutoDetectLongPolling: true });
  } catch {
    return getFirestore(app);
  }
}
export const db = createFirestore();
export const storage = getStorage(app);

// Local testing against the Firebase emulators — only when explicitly enabled
// (never set for a production build), with a demo project id.
if (process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true') {
  const host = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, Number(process.env.EXPO_PUBLIC_STORAGE_EMULATOR_PORT || 9199));
  connectFunctionsEmulator(getFunctions(app), host, 5001);
  // Lets an automated test sign in with an emulator custom token.
  (globalThis as unknown as Record<string, unknown>).__nesamTestSignIn = (token: string) => signInWithCustomToken(auth, token);
}

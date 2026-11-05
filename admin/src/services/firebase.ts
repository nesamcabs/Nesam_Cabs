import { initializeApp, getApps, getApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyClCvf1FUnXb6na8UeZ_knRBTCakAVJCQs",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "nesamtoursandtravels-202f5.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "nesamtoursandtravels-202f5",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "nesamtoursandtravels-202f5.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "391292064102",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:391292064102:web:9a8c8d3cbd314cc167b8a7",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-ZEE41TN9EK"
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// ── Local testing against the Firebase emulators ────────────────────────────
// Only when VITE_USE_FIREBASE_EMULATORS=true (never set for a production build).
// Run with VITE_FIREBASE_PROJECT_ID=demo-nesam so nothing can reach a real project.
if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, Number(import.meta.env.VITE_STORAGE_EMULATOR_PORT || 9199));
  connectFunctionsEmulator(functions, host, 5001);
  // Lets an automated browser test sign in with an emulator custom token.
  (window as unknown as Record<string, unknown>).__nesamTestSignIn = (token: string) => signInWithCustomToken(auth, token);
}

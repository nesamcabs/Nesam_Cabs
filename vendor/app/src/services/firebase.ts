import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth } from 'firebase/auth';
// @ts-expect-error - getReactNativePersistence is exported by the React Native bundle at runtime
import { getReactNativePersistence } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env['EXPO_PUBLIC_FIREBASE_API_KEY'] ?? 'AIzaSyClCvf1FUnXb6na8UeZ_knRBTCakAVJCQs',
  authDomain: process.env['EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'] ?? 'nesamtoursandtravels-202f5.firebaseapp.com',
  projectId: process.env['EXPO_PUBLIC_FIREBASE_PROJECT_ID'] ?? 'nesamtoursandtravels-202f5',
  storageBucket: process.env['EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'] ?? 'nesamtoursandtravels-202f5.firebasestorage.app',
  messagingSenderId: process.env['EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'] ?? '391292064102',
  appId: process.env['EXPO_PUBLIC_FIREBASE_APP_ID'] ?? '1:391292064102:web:9a8c8d3cbd314cc167b8a7',
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});

export const storage = getStorage(app);
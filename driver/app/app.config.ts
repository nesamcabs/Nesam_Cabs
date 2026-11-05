import type { ExpoConfig } from 'expo/config';
declare const require: (id: string) => { existsSync(path: string): boolean };
const { existsSync } = require('fs');

// Firebase Cloud Messaging needs the app's google-services.json (download it from the Firebase console).
// Set GOOGLE_SERVICES_JSON to its path (an EAS file secret works); builds without it have no push.
// Falls back to ./google-services.json next to this file when present (local builds); EAS cloud builds
// do not upload that git-ignored file, so there GOOGLE_SERVICES_JSON must be an EAS file secret.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (existsSync('./google-services.json') ? './google-services.json' : undefined);

const config: ExpoConfig = {
  owner: 'vigneshsivakspm',
  name: 'NESAM Driver',
  slug: 'nesam-travels-driver',
  scheme: 'nesamdriver',
  version: '1.0.0',
  platforms: ['android', 'ios'],
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#F7F7F7',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.nesamtours.driver',
  },
  android: {
    package: 'com.nesamtours.driver',
    versionCode: 1,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FFFFFF',
    },
    softwareKeyboardLayoutMode: 'resize',
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.CAMERA',
    ],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
    ],
  },
  plugins: [
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#FFFFFF',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'NESAM Driver shares your location with the customer during a trip and checks you are at the pickup point.',
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'NESAM Driver needs your photos to upload KYC and vehicle documents.',
        cameraPermission: 'NESAM Driver needs the camera for KYC documents, pre-trip checks and toll receipts.',
        microphonePermission: false,
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'NESAM Driver uses the camera to take the live vehicle photos required before each trip.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-notifications',
      {
        color: '#E31E24',
        defaultChannel: 'nesam_general',
        sounds: ['./assets/sounds/new_booking.wav', './assets/sounds/approval.wav', './assets/sounds/general.wav'],
      },
    ],
    ['expo-audio', { microphonePermission: false }],
    '@react-native-community/datetimepicker',
    './plugins/withReleaseSigning',
    './plugins/withSystemBars',
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 24,
          usesCleartextTraffic: false,
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
  ],
  extra: {
    eas: {
      projectId: '7e71d505-8893-42c6-8091-852c9a15622c',
    },
  },
};

export default config;

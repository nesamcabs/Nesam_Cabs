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
  name: 'NESAM Vendor',
  slug: 'nesam-travels-vendor',
  scheme: 'nesamvendor',
  version: '1.0.0',
  platforms: ['android', 'ios'],
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#F7F7F7',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.nesamtours.vendor',
  },
  android: {
    package: 'com.nesamtours.vendor',
    versionCode: 1,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FFFFFF',
    },
    softwareKeyboardLayoutMode: 'resize',
    predictiveBackGestureEnabled: false,
    permissions: ['android.permission.CAMERA'],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
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
      'expo-image-picker',
      {
        photosPermission: 'NESAM Vendor needs your photos to upload business and vehicle documents.',
        cameraPermission: 'NESAM Vendor needs the camera to photograph business and vehicle documents.',
        microphonePermission: false,
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
      projectId: 'eb480650-0772-4aac-9367-4b99095eb41d',
    },
  },
};

export default config;

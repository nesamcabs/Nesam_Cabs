import type { ExpoConfig } from "expo/config";
declare const require: (id: string) => { existsSync(path: string): boolean };
const { existsSync } = require('fs');

// Google Maps is optional: without a key the app shows route cards with an
// "Open in Google Maps" link instead of an embedded map (never a crash).
// Provide it at build time: GOOGLE_MAPS_ANDROID_API_KEY=... npx expo prebuild
const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim() ?? "";

// Firebase Cloud Messaging needs the app's google-services.json (download it from the Firebase console).
// Set GOOGLE_SERVICES_JSON to its path (an EAS file secret works); builds without it have no push.
// Falls back to ./google-services.json next to this file when present (local builds); EAS cloud builds
// do not upload that git-ignored file, so there GOOGLE_SERVICES_JSON must be an EAS file secret.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (existsSync('./google-services.json') ? './google-services.json' : undefined);

const config: ExpoConfig = {
  owner: 'vigneshsivakspm',
  name: 'NESAM Customer',
  slug: 'nesam-customer-app',
  scheme: 'nesamcustomer',
  version: '1.0.0',
  platforms: ['android', 'ios', 'web'],
  // Phones stay comfortable in portrait; tablets, foldables and landscape use the responsive layout (theme/responsive.ts).
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#F7F7F7',
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.nesamtours.customer",
  },
  android: {
    package: "com.nesamtours.customer",
    versionCode: 1,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#FFFFFF",
    },
    softwareKeyboardLayoutMode: "resize",
    predictiveBackGestureEnabled: false,
    permissions: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.CAMERA",
    ],
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
    ],
  },
  web: {
    // Metro bundler, one HTML shell for the whole app (client-side navigation).
    bundler: 'metro',
    output: 'single',
    name: 'NESAM Customer',
    shortName: 'NESAM',
    description: 'Book safe, reliable cabs with NESAM Cabs.',
    lang: 'en-IN',
    favicon: './assets/favicon.png',
    themeColor: '#E31E24',
    backgroundColor: '#F7F7F7',
  },
  plugins: [
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 180,
        resizeMode: "contain",
        backgroundColor: "#FFFFFF",
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "NESAM uses your location to set your pickup point and share it in an emergency.",
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission:
          "NESAM needs access to your photos to set your profile picture.",
        cameraPermission:
          "NESAM needs camera access to take your profile picture.",
        microphonePermission: false,
      },
    ],
    [
      "expo-notifications",
      {
        color: "#E31E24",
        defaultChannel: "nesam_general",
        sounds: ["./assets/sounds/new_booking.wav", "./assets/sounds/approval.wav", "./assets/sounds/general.wav"],
      },
    ],
    ["expo-audio", { microphonePermission: false }],
    "@react-native-community/datetimepicker",
    "expo-sharing",
    "./plugins/withReleaseSigning",
    "./plugins/withSystemBars",
    ...(mapsKey
      ? [
          ["react-native-maps", { androidGoogleMapsApiKey: mapsKey }] as [
            string,
            Record<string, string>,
          ],
        ]
      : []),
    [
      "expo-build-properties",
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
    mapsEnabled: !!mapsKey,
    eas: {
      projectId: '94ce7c34-2741-4406-803d-09ad8d519bbf',
    },
  },
};

export default config;

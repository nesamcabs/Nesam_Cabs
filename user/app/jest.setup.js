// Native modules the service layer imports but the pure logic under test
// never calls.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('./src/config/firebase', () => ({ app: {}, auth: { currentUser: null }, db: {}, storage: {}, firebaseConfig: {} }));

// Pure payload builders only need Firestore's sentinel + Timestamp; the real
// SDK is exercised against the rules in the emulator suite (tests/rules).
jest.mock('firebase/firestore', () => {
  class Timestamp {
    constructor(ms) {
      this.ms = ms;
    }
    static fromDate(d) {
      return new Timestamp(d.getTime());
    }
    toDate() {
      return new Date(this.ms);
    }
  }
  return { serverTimestamp: () => ({ __type: 'serverTimestamp' }), Timestamp };
});

// Callable transport is covered by the backend emulator integration suite.
jest.mock('firebase/functions', () => ({ getFunctions: jest.fn(), httpsCallable: jest.fn() }));

// Auth is mocked too (the real SDK needs a browser or device): the pure logic only signs out a dead session.
jest.mock('firebase/auth', () => ({
  signOut: jest.fn(() => Promise.resolve()),
  onAuthStateChanged: jest.fn(() => () => undefined),
  signInWithPhoneNumber: jest.fn(),
}));

// react-native-webview needs its native module; tests render a plain View in its place.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const WebView = (props) => React.createElement(View, { testID: 'webview', style: props.style });
  return { __esModule: true, WebView, default: WebView };
});

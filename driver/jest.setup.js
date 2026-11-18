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
  // Screens subscribe on mount (payment methods, local duties): a listener that never fires keeps them on their defaults.
  const ref = () => ({});
  return {
    serverTimestamp: () => ({ __type: 'serverTimestamp' }),
    Timestamp,
    doc: ref,
    collection: ref,
    collectionGroup: ref,
    query: ref,
    where: ref,
    orderBy: ref,
    limit: ref,
    onSnapshot: () => () => undefined,
  };
});

// Callable transport is covered by the backend emulator integration suite.
jest.mock('firebase/functions', () => ({ getFunctions: jest.fn(), httpsCallable: jest.fn() }));

// react-native-webview needs its native module; tests render a plain View in its place.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const WebView = (props) => React.createElement(View, { testID: 'webview', style: props.style });
  return { __esModule: true, WebView, default: WebView };
});

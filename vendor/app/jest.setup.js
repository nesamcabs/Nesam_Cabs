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
  return { serverTimestamp: () => ({ __type: 'serverTimestamp' }), increment: (n) => ({ __type: 'increment', n }), Timestamp };
});

// Storage calls are never made by the pure logic under test.
jest.mock('firebase/storage', () => ({}));

// Callable transport is covered by the backend emulator integration suite.
jest.mock('firebase/functions', () => ({ getFunctions: jest.fn(), httpsCallable: jest.fn() }));

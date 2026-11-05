const React = require('react');
const { test, afterEach } = require('@jest/globals');
const renderer = require('react-test-renderer');
const { Text } = require('react-native');
const { act } = renderer;
const mockTripListeners = {};
jest.mock('../src/services/rideService', () => ({
  isLiveRide: () => false,
  subscribeToUserBookings: jest.fn((uid, callback) => {
    mockTripListeners[uid] = callback;
    return jest.fn();
  }),
}));
jest.mock('../src/services/userService', () => ({ subscribeToSavedPlaces: () => jest.fn() }));
jest.mock('../src/services/quoteService', () => ({
  ...jest.requireActual('../src/services/quoteService'), fetchQuotes: jest.fn(),
}));
const { CustomerDataProvider, useCustomerData } = require('../src/context/CustomerData');
const { useServerQuotes } = require('../src/hooks/useServerQuotes');
const { fetchQuotes } = require('../src/services/quoteService');
let tree;
afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = null;
  jest.useRealTimers();
  jest.clearAllMocks();
});

test('switching customer accounts clears trips before the next listener returns', () => {
  function Probe() {
    const { trips } = useCustomerData();
    return React.createElement(Text, null, trips.map(t => t.id).join(',') || 'empty');
  }
  const view = uid => React.createElement(CustomerDataProvider, { profile: { uid } }, React.createElement(Probe));
  act(() => { tree = renderer.create(view('accountA')); });
  act(() => mockTripListeners.accountA([{ id: 'private-trip-A', status: 'Pending' }]));
  expect(JSON.stringify(tree.toJSON())).toContain('private-trip-A');
  act(() => tree.update(view('accountB')));
  expect(JSON.stringify(tree.toJSON())).not.toContain('private-trip-A');
  expect(JSON.stringify(tree.toJSON())).toContain('empty');
});

test('disabled and changed quote requests cannot expose a previous or late fare', async () => {
  jest.useFakeTimers();
  const pending = [];
  fetchQuotes.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const place = { name: 'City', address: 'City', lat: 10, lng: 77 };
  const request = { pickup: place, drop: { ...place, lat: 11 }, tripType: 'One Way', scheduledAt: '2026-11-01T10:00:00+05:30' };
  function Probe({ value }) {
    const q = useServerQuotes(value);
    return React.createElement(Text, null, `${q.status}:${q.data?.service || ''}`);
  }
  act(() => { tree = renderer.create(React.createElement(Probe, { value: request })); });
  act(() => jest.advanceTimersByTime(350));
  await act(async () => { pending[0]({ service: 'old-fare', route: {}, quotes: [] }); });
  expect(JSON.stringify(tree.toJSON())).toContain('ready:old-fare');
  act(() => tree.update(React.createElement(Probe, { value: null })));
  expect(JSON.stringify(tree.toJSON())).toContain('idle:');
  act(() => tree.update(React.createElement(Probe, { value: request })));
  expect(JSON.stringify(tree.toJSON())).not.toContain('old-fare');
  act(() => jest.advanceTimersByTime(350));
  act(() => tree.update(React.createElement(Probe, { value: { ...request, couponCode: 'NEW' } })));
  await act(async () => { pending[1]({ service: 'late-fare', route: {}, quotes: [] }); });
  expect(JSON.stringify(tree.toJSON())).not.toContain('late-fare');
});

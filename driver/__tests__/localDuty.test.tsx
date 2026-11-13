/* eslint-disable import/first, @typescript-eslint/no-require-imports -- jest.mock() calls must precede the imports they replace, and mocks need require() */
// Local duty ("continuous moving") for fleet drivers: the pure helpers (order kind, rental clock, queue rule, totals) and the
// Local Taxi page in each state of a duty — none, planned, running with orders in hand and nearby orders, and closed.
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import type { BoardOrder, DriverAccount, LocalShift, TripDetails } from '../src/types/driver';

const HOUR = 3600000;
const NOW = Date.now();

const baseTrip: TripDetails = {
  id: 't1', bookingId: 'NT-2001', customerName: 'Priya', customerPhone: '', customerPhoneMasked: '98•••••210',
  pickup: { address: 'Erode Bus Stand, Erode', lat: 11.341, lng: 77.717 }, drop: { address: 'Perundurai Road, Erode', lat: 11.33, lng: 77.69 },
  distanceKm: 8, vehicleType: 'Sedan', serviceType: 'One Way', fareAmount: 240, driverEarnings: 0, payoutRecorded: false, payoutFinalized: false,
  fleetTrip: true, tollCharges: 0, status: 'Assigned', stage: 'Assigned', subStatus: 'Not Started', verificationSubmitted: true, boardingVerified: false,
  pickupAt: new Date(NOW + 0.3 * HOUR), scheduledDate: '', scheduledTime: '', paymentMode: 'Cash', notes: '', tolls: [],
  tripType: 'One Way', localMode: 'pickup_drop', localShiftId: 's1', assignedAt: new Date(NOW - HOUR),
};
const trip = (over: Partial<TripDetails>): TripDetails => ({ ...baseTrip, ...over });

const baseShift: LocalShift = {
  id: 's1', vendorName: 'Kongu Travels', vehicleId: 'v1', vehicleNumber: 'TN33AB1234', vehicleCategory: 'Sedan', cityName: 'Erode',
  centre: { lat: 11.341, lng: 77.717 }, radiusKm: 15, services: ['rental', 'pickup_drop'],
  startsAt: new Date(NOW - 2 * HOUR), endsAt: new Date(NOW + 8 * HOUR), status: 'Active', startedAt: new Date(NOW - 2 * HOUR), endedAt: null,
  paused: false, pausedAt: null, breakMs: 0, endRequested: false, endReason: '', verified: true, verificationFlagged: false, releases: 0,
  stats: { orders: 0, completed: 0, active: 0, cancelled: 0, rental: 0, pickupDrop: 0, km: 0, fare: 0, payout: 0, tolls: 0, collected: 0, cashInHand: 0, paidOnline: 0, balanceDue: 0, rentalMinutes: 0, overtimeMinutes: 0 },
  note: '',
};
const shift = (over: Partial<LocalShift>): LocalShift => ({ ...baseShift, ...over });

const order = (over: Partial<BoardOrder>): BoardOrder => ({
  id: 'b9', code: 'NT-2099', source: 'fleet', mode: 'pickup_drop', pickup: { name: 'Brough Road', address: '', lat: 11.345, lng: 77.72, approx: false },
  drop: { name: 'Surampatti', lat: 11.35, lng: 77.73 }, pickupAtMs: NOW + 0.4 * HOUR, overdue: false, tripKm: 6.5, awayKm: 1.2, rentalHours: null, includedKm: null,
  fare: 210, paymentMethod: 'Cash', vehicleCategory: 'Sedan', ...over,
});

const account = { driver: { id: 'drv1', name: 'Arun', vendorId: 'ven1', vendorName: 'Kongu Travels', presenceStatus: 'Online' } } as unknown as DriverAccount;

let mockShifts: LocalShift[] = [];
let mockBookings: TripDetails[] = [];
let mockBoard: { open: boolean; reason: string; orders: BoardOrder[]; serverTime: number; radiusKm: number; centre: { lat: number; lng: number } | null } | null = null;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
  useRoute: () => ({ params: undefined }),
  useIsFocused: () => true,
  createNavigationContainerRef: () => ({ isReady: () => false, addListener: () => () => undefined, getCurrentRoute: () => undefined, getRootState: () => undefined, navigate: jest.fn(), dispatch: jest.fn() }),
  StackActions: { popToTop: () => ({ type: 'POP_TO_TOP' }) },
}));
jest.mock('react-native-safe-area-context', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: unknown }) => R.createElement(View, { style }, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('expo-font', () => ({ useFonts: () => [true, null], isLoaded: () => true, isLoading: () => false, loadAsync: jest.fn(), processFontFamily: (f: string) => f }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));
jest.mock('../src/hooks/usePresence', () => ({ usePresence: () => ({ status: 'Online', online: true, busy: false, locked: false, change: jest.fn(), toggle: jest.fn() }) }));
jest.mock('../src/navigation/MainNavigator', () => ({ useSignOut: () => jest.fn() }));
jest.mock('firebase/storage', () => ({ ref: jest.fn(), uploadBytes: jest.fn(), getDownloadURL: jest.fn() }));
jest.mock('../src/components/forms', () => ({ PhotoField: () => null, displayDate: (d: string) => d }));
jest.mock('../src/services/deviceSecurity', () => ({ refreshDeviceIntegrity: jest.fn(), runDeviceChecks: jest.fn(), describeSignals: () => '' }));
jest.mock('../src/services/locationService', () => ({ getCurrentPosition: jest.fn(() => Promise.reject(new Error('no gps'))), watchPosition: () => () => undefined, LocationError: class LocationError extends Error {} }));
jest.mock('../src/hooks/useLocalBoard', () => ({ useLocalBoard: () => ({ board: mockBoard, loading: false, error: '', updatedAt: Date.now(), me: null, locationError: '', refresh: jest.fn() }) }));
// The map is a WebView page; here it only has to receive the pins.
jest.mock('../src/components/nx/LiveMap', () => {
  const R = require('react');
  const { Text } = require('react-native');
  return { LiveMap: ({ data }: { data: { markers: { label?: string }[] } }) => R.createElement(Text, null, `MAP ${data.markers.map((m) => m.label).join(',')}`) };
});
jest.mock('../src/context/DriverData', () => ({
  useDriverData: () => ({ account, shifts: mockShifts, shiftsLoaded: true, bookings: mockBookings, unreadCount: 0, upcomingTrips: [] }),
}));

import { LocalTaxiScreen } from '../src/screens/LocalTaxiScreen';
import { ShellProvider } from '../src/components/nx/Shell';
import { currentShift, liveTotals, localModeOf, pickupWhen, rentalClock, shiftOrders, takeBlockReason, clockText } from '../src/utils/localDuty';
import { mapBooking } from '../src/services/driverService';

const trees: renderer.ReactTestRenderer[] = [];
afterEach(() => {
  act(() => {
    for (const t of trees.splice(0)) t.unmount();
  });
});
function textOfScreen() {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <ShellProvider>
        <LocalTaxiScreen />
      </ShellProvider>,
    );
  });
  trees.push(tree);
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') return void out.push(n);
    if (Array.isArray(n)) return n.forEach(walk);
    walk((n as { children?: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join(' ');
}

describe('local duty helpers', () => {
  it('recognises rentals and in-city pickup & drop, not outstation or airport', () => {
    expect(localModeOf({ tripType: 'Local Rental' })).toBe('rental');
    expect(localModeOf({ tripType: 'One Way', pricing: { model: 'local_pickup_drop' } })).toBe('pickup_drop');
    expect(localModeOf({ tripType: 'One Way', distanceKm: 12 })).toBe('pickup_drop');
    expect(localModeOf({ tripType: 'One Way', distanceKm: 160 })).toBeNull();
    expect(localModeOf({ tripType: 'Airport Taxi', distanceKm: 20 })).toBeNull();
  });

  it('maps a booking taken on a duty with its rental package and clock', () => {
    const t = mapBooking('b1', {
      bookingId: 'NT-1', status: 'Ongoing', tripSubStatus: 'Trip Started', tripType: 'Local Rental', localShiftId: 's1',
      pricing: { model: 'rental_package', rentalHours: 4, includedKm: 40, extraHourRatePaise: 25000 }, tripStartedAt: new Date(NOW - HOUR),
      paymentSummary: { totalPaid: 0, balanceDue: 1550, partnerCashHeld: 0 },
    });
    expect(t.localMode).toBe('rental');
    expect(t.localShiftId).toBe('s1');
    expect(t.rentalHours).toBe(4);
    expect(t.includedKm).toBe(40);
    expect(t.extraHourRate).toBe(250);
    expect(t.tripStartedAt?.getTime()).toBe(NOW - HOUR);
  });

  it('runs the rental clock from boarding and shows overtime', () => {
    const start = new Date(NOW - 90 * 60000);
    const c = rentalClock(start, 2, NOW);
    expect(clockText(c.remainingMs)).toBe('0:30:00');
    expect(rentalClock(start, 1, NOW).overtimeMs).toBe(30 * 60000);
    expect(rentalClock(null, 4, NOW).started).toBe(false);
  });

  it('allows a current and a next order, and keeps the car for a rental', () => {
    const ongoing = trip({ status: 'Ongoing', subStatus: 'Trip Started' });
    expect(takeBlockReason([], 'pickup_drop')).toBe('');
    expect(takeBlockReason([ongoing], 'pickup_drop')).toBe('');
    expect(takeBlockReason([ongoing, trip({ id: 't2' })], 'pickup_drop')).toMatch(/current and a next/);
    expect(takeBlockReason([trip({ localMode: 'rental', bookingId: 'NT-R' })], 'pickup_drop')).toMatch(/hourly rental NT-R/);
  });

  it('orders a duty’s trips: running first, then next, then finished', () => {
    const done = trip({ id: 'd', status: 'Completed', completedAt: new Date(NOW - HOUR) });
    const next = trip({ id: 'n', assignedAt: new Date(NOW) });
    const cur = trip({ id: 'c', status: 'Ongoing', subStatus: 'Trip Started' });
    const other = trip({ id: 'x', localShiftId: 'other' });
    const o = shiftOrders([done, next, cur, other], 's1');
    expect(o.current?.id).toBe('c');
    expect(o.next?.id).toBe('n');
    expect(o.done.map((t) => t.id)).toEqual(['d']);
  });

  it('adds up completed orders with the cash the driver holds', () => {
    const t = liveTotals([
      trip({ id: 'a', status: 'Completed', fareAmount: 240, totalKm: 9.5, totalPaid: 240, balanceDue: 0, cashHeld: 240 }),
      trip({ id: 'b', status: 'Completed', localMode: 'rental', fareAmount: 1550, totalKm: 52, totalPaid: 1550, balanceDue: 0, cashHeld: 0, rentalUsage: { packageHours: 4, usedMinutes: 250, overtimeMinutes: 10, extraHours: 1, extraHourRate: 250, indicativeExtra: 250 } }),
      trip({ id: 'c', status: 'Ongoing' }),
      trip({ id: 'd', status: 'Cancelled' }),
    ]);
    expect(t).toMatchObject({ done: 2, inHand: 1, rental: 1, pickupDrop: 2, km: 61.5, fare: 1790, collected: 1790, cashInHand: 240, overtimeMinutes: 10 });
  });

  it('picks the running duty, else the next planned one', () => {
    const planned = shift({ id: 'p', status: 'Scheduled', startsAt: new Date(NOW + HOUR) });
    expect(currentShift([planned, shift({ id: 'a' })], NOW)?.id).toBe('a');
    expect(currentShift([planned], NOW)?.id).toBe('p');
    expect(currentShift([shift({ id: 'old', status: 'Ended', endedAt: new Date(NOW - 30 * HOUR) })], NOW)).toBeNull();
    expect(pickupWhen(NOW + 25 * 60000, NOW)).toBe('in 25 m');
    expect(pickupWhen(NOW - 12 * 60000, NOW)).toBe('12 m late');
  });
});

describe('Local Taxi page', () => {
  beforeEach(() => {
    mockShifts = [];
    mockBookings = [];
    mockBoard = null;
  });

  it('explains local duty when none is planned', () => {
    const text = textOfScreen();
    expect(text).toContain('No local duty right now');
    expect(text).toContain('One photo check');
  });

  it('a planned duty asks for the photo check before it can start', () => {
    mockShifts = [shift({ status: 'Scheduled', startedAt: null, verified: false, startsAt: new Date(NOW + 10 * 60000) })];
    const text = textOfScreen();
    expect(text).toContain('Erode');
    expect(text).toContain('Planned');
    expect(text).toContain('How local duty works');
    expect(text).not.toContain('Nearby rentals');
    expect(text).toContain('Start photo check');
    expect(text).toContain('Slide to Start Duty');
  });

  it('a running duty shows the order in hand, the nearby orders on the map and the totals', () => {
    mockShifts = [shift({})];
    mockBookings = [
      trip({ id: 'c', status: 'Ongoing', subStatus: 'Trip Started' }),
      trip({ id: 'done', status: 'Completed', fareAmount: 300, totalPaid: 300, balanceDue: 0, cashHeld: 300, completedAt: new Date(NOW - HOUR) }),
    ];
    mockBoard = { open: true, reason: '', serverTime: NOW, radiusKm: 15, centre: { lat: 11.341, lng: 77.717 }, orders: [order({}), order({ id: 'b10', code: 'NT-2100', awayKm: 2.4, source: 'marketplace' })] };
    const text = textOfScreen();
    expect(text).toContain('On duty');
    expect(text).toContain('Current order');
    expect(text).toContain('Nearby pickup & drop orders');
    expect(text).toContain('Brough Road → Surampatti');
    expect(text).toContain('NESAM order');
    expect(text).toContain('MAP D,1,2');
    expect(text).toContain('Cash with you');
    expect(text).toContain('₹300');
  });

  it('an hourly rental in progress shows its clock and blocks other orders', () => {
    mockShifts = [shift({})];
    mockBookings = [trip({ id: 'r', localMode: 'rental', tripType: 'Local Rental', status: 'Ongoing', subStatus: 'Trip Started', rentalHours: 4, includedKm: 40, tripStartedAt: new Date(NOW - HOUR) })];
    mockBoard = { open: true, reason: '', serverTime: NOW, radiusKm: 15, centre: null, orders: [order({ mode: 'rental', id: 'r2', rentalHours: 3, drop: null })] };
    const text = textOfScreen();
    expect(text).toContain('Current rental');
    expect(text).toContain('Time left');
    expect(text).toContain('Finish your hourly rental');
  });

  it('a closed duty shows its totals', () => {
    mockShifts = [shift({ status: 'Ended', endedAt: new Date(NOW - 10 * 60000) })];
    mockBookings = [trip({ id: 'done', status: 'Completed', fareAmount: 500, totalPaid: 500, balanceDue: 0, cashHeld: 500, completedAt: new Date(NOW - HOUR) })];
    const text = textOfScreen();
    expect(text).toContain('Closed');
    expect(text).toContain('Duty closed');
    expect(text).toContain('Completed orders');
  });
});

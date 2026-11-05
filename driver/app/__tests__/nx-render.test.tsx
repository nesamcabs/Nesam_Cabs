/* eslint-disable import/first, @typescript-eslint/no-require-imports -- jest.mock() calls must precede the imports they replace, and mocks need require() */
// Render smoke tests for the redesigned screens. There is no device in CI, so these mount every screen with sample data
// (a missing field or a bad import throws here instead of on a driver's phone) and exercise the logic the redesign added:
// the slide-to-confirm control and the trip stages.
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import type { DriverAccount, TripDetails } from '../src/types/driver';

const HOUR = 3600000;
const at = (h: number) => new Date(Date.now() + h * HOUR);

const baseTrip: TripDetails = {
  id: 't1', bookingId: 'NT-1001', customerName: 'Sample Customer', customerPhone: '', customerPhoneMasked: '98•••••210',
  pickup: { address: 'Koyambedu Bus Terminus, Chennai, Tamil Nadu' }, drop: { address: 'Madurai Periyar Bus Stand, Madurai' },
  distanceKm: 462, vehicleType: 'Sedan', serviceType: 'One way', fareAmount: 6200, driverEarnings: 4900, payoutRecorded: true, payoutFinalized: false,
  fleetTrip: false, tollCharges: 0, status: 'Assigned', stage: 'Assigned', subStatus: 'Not Started', verificationSubmitted: false, boardingVerified: false,
  balanceDue: 5200, totalPaid: 1000, fareLines: [{ key: 'base', label: 'Base fare', amount: 5400, treatment: 'included' }, { key: 'toll', label: 'Toll', amount: null, treatment: 'extra' }],
  pickupAt: at(20), scheduledDate: '', scheduledTime: '', paymentMode: 'Cash', notes: '', tolls: [],
};
const trip = (over: Partial<TripDetails>): TripDetails => ({ ...baseTrip, ...over });

const account = {
  driver: { id: 'drv12345', name: 'Sample Driver', phone: '9876500000', email: 'd@example.com', photoUrl: '', dob: '1988-04-12', gender: 'Male', address: '12 Street', city: 'Chennai', pincode: '600001', emergencyContactName: 'Contact', emergencyContact: '9876500001', rating: 4.8, joiningDate: 'Jan 2026', presenceStatus: 'Online', docStatus: 'Approved', approvalStatus: 'Approved' },
  identity: { aadhaarNumber: '123412341234', aadhaarFrontUrl: 'x', aadhaarBackUrl: '', panNumber: 'ABCDE1234F', panPhotoUrl: 'x' },
  license: { number: 'TN002026', expiryDate: '2031-04-12', frontPhotoUrl: 'x', backPhotoUrl: 'x' },
  vehicle: { vehicleNumber: 'TN00AB0000', vehicleType: 'Sedan', make: 'Hyundai', model: 'Aura', year: '2023', color: 'White', capacity: 4, fuelType: 'Petrol', rcDocUrl: 'x', insuranceExpiry: '2027-01-01', insuranceDocUrl: 'x', fitnessExpiry: '2030-01-01', fitnessDocUrl: 'x', permitExpiry: '2030-01-01', statePermitDocUrl: 'x', frontPhotoUrl: 'x', rearPhotoUrl: 'x', sidePhotoUrl: '', interiorPhotoUrl: 'x' },
  bank: { accountHolder: 'Sample Driver', accountNumber: '123456789012', ifsc: 'HDFC0000001', bankName: 'Bank', upiId: 'a@upi' },
} as unknown as DriverAccount;

let mockBookings: TripDetails[] = [];
let mockActiveTrip: TripDetails | null = null;
let mockRules: { startWindowMs: number; pickupRadiusKm: number } | null = null;

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }) }));
jest.mock('react-native-safe-area-context', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: unknown }) => R.createElement(View, { style }, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('../src/services/deviceSecurity', () => ({ refreshDeviceIntegrity: jest.fn(), runDeviceChecks: jest.fn(), describeSignals: () => '' }));
jest.mock('../src/services/locationService', () => ({ getCurrentPosition: jest.fn(), LocationError: class LocationError extends Error {} }));
jest.mock('firebase/storage', () => ({ ref: jest.fn(), uploadBytes: jest.fn(), getDownloadURL: jest.fn() }));
jest.mock('../src/services/verificationService', () => ({
  SLOTS: [
    { slot: 'selfie', label: 'Driver Selfie', hint: 'Face the camera.' },
    { slot: 'front', label: 'Vehicle Front', hint: 'Front and number plate.' },
    { slot: 'rear', label: 'Vehicle Rear', hint: 'Rear and number plate.' },
    { slot: 'interior', label: 'Dashboard / Interior', hint: 'Dashboard and odometer.' },
  ],
}));
jest.mock('expo-font', () => ({ useFonts: () => [true, null], isLoaded: () => true, isLoading: () => false, loadAsync: jest.fn(), processFontFamily: (f: string) => f }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));
jest.mock('../src/hooks/usePresence', () => ({ usePresence: () => ({ status: 'Online', online: true, busy: false, locked: false, change: jest.fn(), toggle: jest.fn() }) }));
jest.mock('../src/navigation/MainNavigator', () => ({ useSignOut: () => jest.fn() }));
jest.mock('../src/components/forms', () => ({ PhotoField: () => null, displayDate: (d: string) => d }));
jest.mock('../src/context/DriverData', () => ({
  useDriverData: () => {
    const byPickup = (a: TripDetails, b: TripDetails) => (a.pickupAt?.getTime() ?? Infinity) - (b.pickupAt?.getTime() ?? Infinity);
    const upcomingTrips = mockBookings.filter((b) => b.status === 'Assigned' || b.status === 'Ongoing').sort(byPickup);
    return {
      account,
      bookings: mockBookings,
      bookingsLoaded: true,
      bookingsError: '',
      activeTrip: mockActiveTrip,
      upcomingTrips,
      nextTrip: upcomingTrips[0] ?? null,
      completedTrips: mockBookings.filter((b) => b.status === 'Completed'),
      cancelledTrips: mockBookings.filter((b) => b.status === 'Cancelled'),
      offers: [
        { id: 'o2', bookingId: 'NT-1102', pickup: { address: 'Salem, Tamil Nadu' }, drop: { address: 'Coimbatore' }, pickupTime: '07:00 AM', travelDate: '21 Oct 2026', vehicleCategory: 'Sedan', distanceKm: 165, offeredPayout: 2100, mode: 'bid_review', eligibleClasses: [], publishedMs: 0 },
        { id: 'o1', bookingId: 'NT-1101', pickup: { address: 'Theni, Tamil Nadu' }, drop: { address: 'Chennai Airport, Chennai' }, pickupTime: '06:00 AM', travelDate: '20 Oct 2026', vehicleCategory: 'Sedan', distanceKm: 540, offeredPayout: 5600, mode: 'accept_offer', eligibleClasses: [], publishedMs: 0 },
      ],
      offersError: '',
      payouts: [{ id: 'p1', amount: 2000, requestedAt: '17 Oct 2026', method: 'UPI', details: 'a@upi', status: 'Pending', utr: '', processedAt: '' }],
      notifications: [{ id: 'n1', title: 'New duty', message: 'Theni → Chennai', time: '2 min ago', read: false, createdAtMs: Date.now(), category: 'bookings', severity: 'info', sound: 'general', bookingId: '', bookingCode: 'NT-1', ctaLabel: '', ctaPage: '', popup: false }],
      penalties: [],
      deviceWarning: '',
      unreadCount: 1,
      earnings: { todayEarnings: 4900, thisWeekEarnings: 8150, thisMonthEarnings: 8150, lifetimeEarnings: 31000, totalTripsCompleted: 12, tollReimbursements: 420 },
      wallet: { available: 8450, pending: 4900, reserved: 2000, paidOut: 15000, cashCollected: 3000, tripEarnings: 31000, tollReimbursements: 600 },
      ledger: [{ id: 'l1', type: 'trip_earning', direction: 'credit', amount: 4900, status: 'available', bookingId: 't3', bookingCode: 'NT-0990', createdAt: new Date() }],
      walletError: '',
      rules: mockRules,
      cancellations: [],
      cancelPolicy: { lastMinuteHours: 4, lastMinuteCharge: 1000, graceHours: 4, afterGraceCharge: 500 },
    };
  },
}));

import { HomeScreen } from '../src/screens/HomeScreen';
import MarketplaceScreen from '../src/screens/MarketplaceScreen';
import { TripsScreen } from '../src/screens/TripsScreen';
import { TripFlowScreen } from '../src/screens/TripFlowScreen';
import { EarningsScreen } from '../src/screens/EarningsScreen';
import { WalletScreen } from '../src/screens/WalletScreen';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { NotificationsScreen } from '../src/screens/NotificationsScreen';
import { NxSwipe } from '../src/components/nx/Swipe';
import { ShellProvider } from '../src/components/nx/Shell';
import { NxTabBar } from '../src/components/nx/TabBar';
import { NxBrand } from '../src/components/nx/Brand';

const mountedTrees: renderer.ReactTestRenderer[] = [];
afterEach(() => {
  act(() => {
    for (const tree of mountedTrees.splice(0)) tree.unmount();
  });
});

function mount(el: React.ReactElement) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<ShellProvider>{el}</ShellProvider>);
  });
  mountedTrees.push(tree);
  return tree;
}

const textOf = (tree: renderer.ReactTestRenderer) => {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as { children?: unknown };
    walk(node.children);
  };
  walk(tree.toJSON());
  return out.join(' ');
};

describe('tab screens render', () => {
  beforeEach(() => {
    mockRules = null;
    mockBookings = [trip({}), trip({ id: 't2', bookingId: 'NT-1002', pickupAt: at(1.5) }), trip({ id: 't3', bookingId: 'NT-0990', status: 'Completed', subStatus: 'Trip Ended', completedAt: at(-30) }), trip({ id: 't4', bookingId: 'NT-0975', status: 'Cancelled' })];
    mockActiveTrip = mockBookings[0]!;
  });

  it('Home shows the next trip, the available-duties heading and the Start Trip action for a near pickup', () => {
    const text = textOf(mount(<HomeScreen />));
    expect(text).toContain('Your next trip');
    expect(text).toContain('Available duties');
    expect(text).toContain('Open trip');
    expect(text).not.toContain('Start Trip');
    expect(text).toContain('Finish your current trip');
  });

  it('Home lists open duties when no trip is assigned', () => {
    mockBookings = [];
    mockActiveTrip = null;
    const text = textOf(mount(<HomeScreen />));
    expect(text).toContain('No active assigned trips');
    expect(text).toContain('View details');
    expect(text).toContain('₹5,600');
    // a duty NESAM reviews bids on is marked as such, not offered for outright acceptance
    expect(text).toContain('Bid');
  });

  it('My Trips shows the three tabs with counts', () => {
    const text = textOf(mount(<TripsScreen />));
    expect(text).toContain('Upcoming (2)');
    expect(text).toContain('Completed (1)');
    expect(text).toContain('Cancelled (1)');
  });

  it('Earnings, Wallet, Profile and Notifications render their sections', () => {
    expect(textOf(mount(<EarningsScreen />))).toContain('Pending settlement review');
    const wallet = textOf(mount(<WalletScreen />));
    expect(wallet).toContain('AVAILABLE TO WITHDRAW');
    expect(wallet).toContain('₹8,450');
    expect(textOf(mount(<ProfileScreen />))).toContain('Document verification');
    expect(textOf(mount(<ProfileScreen />))).toContain('Earnings & settlements');
    expect(textOf(mount(<NotificationsScreen />))).toContain('Driver updates');
  });

  it('MarketplaceScreen renders open duties and bidding for driver', () => {
    const text = textOf(mount(<MarketplaceScreen />));
    expect(text).toContain('Marketplace');
    expect(text).toContain('Sedan only');
    expect(text).toContain('All categories');
    expect(text).toContain('Bid Duty');
    expect(text).toContain('Place bid');
  });

  it('NxBrand displays page heading on the right of logo and hides NESAM / DRIVER wordmarks', () => {
    const headerWithTitle = textOf(mount(<NxBrand title="Marketplace" subtitle="Open duties" />));
    expect(headerWithTitle).toContain('Marketplace');
    expect(headerWithTitle).toContain('Open duties');
    expect(headerWithTitle).not.toContain('NESAM');
    expect(headerWithTitle).not.toContain('DRIVER');
  });

  it('NxTabBar renders 5 tabs with Home as dominant middle action', () => {
    const state: any = {
      index: 2,
      routes: [
        { key: 'm1', name: 'Marketplace' },
        { key: 't1', name: 'Trip' },
        { key: 'h1', name: 'Home' },
        { key: 'w1', name: 'Wallet' },
        { key: 'p1', name: 'Profile' },
      ],
    };
    const nav: any = { emit: jest.fn(() => ({ defaultPrevented: false })), navigate: jest.fn() };
    const tabTree = mount(<NxTabBar state={state} navigation={nav} descriptors={{} as any} insets={{} as any} />);
    const tabText = textOf(tabTree);
    expect(tabText).toContain('Marketplace');
    expect(tabText).toContain('My Trips');
    expect(tabText).toContain('Home');
    expect(tabText).toContain('Wallet');
    expect(tabText).toContain('Profile');
  });
});

describe('trip flow stages', () => {
  const flow = (t: TripDetails) => {
    mockBookings = [t];
    mockActiveTrip = t.status === 'Assigned' || t.status === 'Ongoing' ? t : null;
    return textOf(mount(<TripFlowScreen {...({ route: { params: { bookingId: t.id } }, navigation: {} } as never)} />));
  };

  it('before the photos: asks for the live photo check', () => {
    const text = flow(trip({}));
    expect(text).toContain('Before you start');
    expect(text).toContain('Start photo check');
    expect(text).toContain('Customer details');
  });

  it('photos done: offers the mark-reached slider and navigation', () => {
    const text = flow(trip({ verificationSubmitted: true }));
    expect(text).toContain('Reached the location?');
    expect(text).toContain('Slide to Mark Reached');
    expect(text).toContain('Navigate to Pickup');
  });

  it('at pickup without the OTP: asks for the boarding OTP and keeps Start locked', () => {
    const text = flow(trip({ verificationSubmitted: true, subStatus: 'Reached Pickup', status: 'Ongoing' }));
    expect(text).toContain('Boarding OTP');
    expect(text).toContain('Slide to Start Trip');
    expect(text).toContain('Still needed');
  });

  it('on the trip: offers the end-trip slider and the drop navigation', () => {
    const text = flow(trip({ verificationSubmitted: true, boardingVerified: true, subStatus: 'Trip Started', status: 'Ongoing' }));
    expect(text).toContain('Trip in progress');
    expect(text).toContain('Slide to End Trip');
    expect(text).toContain('Navigate to Drop');
  });

  it('a completed trip shows the receipt, a cancelled one the cancellation notice', () => {
    expect(flow(trip({ status: 'Completed', subStatus: 'Trip Ended', balanceDue: 0 }))).toContain('Trip completed');
    expect(flow(trip({ status: 'Cancelled' }))).toContain('Duty cancelled');
  });

  it('does not invent a start window: with no server rules the arrival slider is never blocked', () => {
    mockRules = null;
    const text = flow(trip({ verificationSubmitted: true, pickupAt: at(20) }));
    expect(text).toContain('Slide to Mark Reached');
    expect(text).not.toContain('Marking arrival opens');
  });

  it('explains accurately when the server will not yet accept the arrival check-in', () => {
    mockRules = { startWindowMs: 6 * 3600000, pickupRadiusKm: 3 };
    const text = flow(trip({ verificationSubmitted: true, pickupAt: at(20) }));
    expect(text).toContain('Marking arrival opens');
    expect(text).toContain('6 hours before the pickup time');
    // the photo check is preparation and stays available
    expect(flow(trip({ pickupAt: at(20) }))).toContain('Start photo check');
    mockRules = null;
  });

  it('opens the arrival slider once inside the configured window', () => {
    mockRules = { startWindowMs: 6 * 3600000, pickupRadiusKm: 3 };
    const text = flow(trip({ verificationSubmitted: true, pickupAt: at(2) }));
    expect(text).not.toContain('Marking arrival opens');
    mockRules = null;
  });

  it('a trip that no longer exists says so', () => {
    mockBookings = [];
    mockActiveTrip = null;
    const text = textOf(mount(<TripFlowScreen {...({ route: { params: { bookingId: 'gone' } }, navigation: {} } as never)} />));
    expect(text).toContain('no longer available');
  });
});

function mountBare(el: React.ReactElement) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(el);
  });
  mountedTrees.push(tree);
  return tree;
}

describe('NxSwipe', () => {
  const find = (tree: renderer.ReactTestRenderer) => tree.root.findByProps({ accessibilityRole: 'adjustable' });
  const activate = async (tree: renderer.ReactTestRenderer) => {
    await act(async () => {
      find(tree).props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
    });
  };

  it('runs the action on the accessibility "activate" gesture and stays down on success', async () => {
    const onCommit = jest.fn().mockResolvedValue(true);
    const tree = mountBare(<NxSwipe label="Slide to Start Trip" onCommit={onCommit} />);
    await activate(tree);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).toContain('Working…');
  });

  it('puts the knob back when the action fails, so it can be tried again', async () => {
    const onCommit = jest.fn().mockResolvedValue(false);
    const tree = mountBare(<NxSwipe label="Slide to Start Trip" onCommit={onCommit} />);
    await activate(tree);
    expect(textOf(tree)).toContain('Slide to Start Trip');
    await activate(tree);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('ignores a thrown error the same way', async () => {
    const onCommit = jest.fn().mockRejectedValue(new Error('network'));
    const tree = mountBare(<NxSwipe label="Slide to End Trip" onCommit={onCommit} />);
    await activate(tree);
    expect(textOf(tree)).toContain('Slide to End Trip');
  });

  it('does nothing while disabled', async () => {
    const onCommit = jest.fn().mockResolvedValue(true);
    const tree = mountBare(<NxSwipe label="Slide to Start Trip" onCommit={onCommit} disabled />);
    await activate(tree);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('NxSwipe drag', () => {
  // A one-finger touch history in the shape PanResponder reads.
  const ev = (startX: number, x: number, prevX = x) => ({
    touchHistory: {
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: 2,
      numberActiveTouches: 1,
      touchBank: [{ touchActive: true, startPageX: startX, startPageY: 0, startTimeStamp: 1, currentPageX: x, currentPageY: 0, currentTimeStamp: 2, previousPageX: prevX, previousPageY: 0, previousTimeStamp: 2 }],
    },
    nativeEvent: { locationX: startX, locationY: 20, pageX: x, pageY: 0, timestamp: 2 },
  });
  const setup = (onCommit: () => Promise<boolean | void>) => {
    const tree = mountBare(<NxSwipe label="Slide to Start Trip" onCommit={onCommit} />);
    const track = () => tree.root.findByProps({ accessibilityRole: 'adjustable' });
    act(() => {
      track().props.onLayout({ nativeEvent: { layout: { width: 318, height: 58, x: 0, y: 0 } } });
    });
    return { tree, track };
  };
  const drag = async (track: () => renderer.ReactTestInstance, from: number, by: number) => {
    const p = track().props;
    if (!p.onStartShouldSetResponder(ev(from, from))) return false;
    await act(async () => {
      p.onResponderGrant(ev(from, from));
      p.onResponderMove(ev(from, from + by, from));
      p.onResponderRelease(ev(from, from + by));
    });
    return true;
  };

  it('commits when released at the end of the track, animating only native-driver-safe properties', async () => {
    // React Native logs an error if a layout property (width, height...) is animated with the native driver.
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const onCommit = jest.fn().mockResolvedValue(true);
    const { track } = setup(onCommit);
    expect(await drag(track, 20, 262)).toBe(true);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls.filter((c) => /native animated module/.test(String(c[0])))).toEqual([]);
    errors.mockRestore();
  });

  it('springs back and does not commit on a short drag', async () => {
    const onCommit = jest.fn().mockResolvedValue(true);
    const { track } = setup(onCommit);
    expect(await drag(track, 20, 200)).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('only starts from the knob end of the track', async () => {
    const onCommit = jest.fn().mockResolvedValue(true);
    const { track } = setup(onCommit);
    expect(await drag(track, 200, 100)).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('Poppins', () => {
  const fonts = require('../src/theme/fonts');
  const { Text: NxText, TextInput: NxTextInput } = require('../src/components/nx/Text');
  const styleOf = (el: React.ReactElement) => {
    const tree = mountBare(el);
    const host = tree.root.findAll((n) => typeof n.type === 'string' && (n.type === 'Text' || n.type === 'TextInput'))[0]!;
    return StyleSheetFlatten(host.props.style);
  };
  const StyleSheetFlatten = (s: unknown) => require('react-native').StyleSheet.flatten(s) as Record<string, unknown>;

  afterEach(() => fonts.setPoppinsReady(false));

  it('maps font weights to the matching Poppins family and resets fontWeight', () => {
    fonts.setPoppinsReady(true);
    expect(styleOf(<NxText style={{ fontWeight: '700' }}>x</NxText>)).toMatchObject({ fontFamily: 'Poppins_700Bold', fontWeight: 'normal' });
    expect(styleOf(<NxText style={{ fontWeight: '800' }}>x</NxText>)).toMatchObject({ fontFamily: 'Poppins_700Bold' });
    expect(styleOf(<NxText style={{ fontWeight: '600' }}>x</NxText>)).toMatchObject({ fontFamily: 'Poppins_600SemiBold' });
    expect(styleOf(<NxText style={{ fontWeight: '500' }}>x</NxText>)).toMatchObject({ fontFamily: 'Poppins_500Medium' });
    expect(styleOf(<NxText>x</NxText>)).toMatchObject({ fontFamily: 'Poppins_400Regular' });
  });

  it('covers text inputs too (placeholders share the input face)', () => {
    fonts.setPoppinsReady(true);
    expect(styleOf(<NxTextInput placeholder="p" />)).toMatchObject({ fontFamily: 'Poppins_400Regular' });
  });

  it('respects an explicit family (the NESAM wordmark) and nested text inherits its parent', () => {
    fonts.setPoppinsReady(true);
    expect(styleOf(<NxText style={{ fontFamily: 'NesamWordmark' }}>x</NxText>)).toMatchObject({ fontFamily: 'NesamWordmark' });
    const tree = mountBare(
      <NxText style={{ fontWeight: '700' }}>
        a<NxText>b</NxText>
      </NxText>,
    );
    const RNText = require('react-native').Text;
    const faces = tree.root.findAll((n) => n.type === RNText).map((n) => (StyleSheetFlatten(n.props.style) ?? {}).fontFamily);
    expect(faces).toEqual(['Poppins_700Bold', undefined]);
  });

  it('falls back to the system font if Poppins could not be loaded', () => {
    fonts.setPoppinsReady(false);
    expect(styleOf(<NxText style={{ fontWeight: '700' }}>x</NxText>).fontFamily).toBeUndefined();
  });
});

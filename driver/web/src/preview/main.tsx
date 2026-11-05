// Development-only harness: renders the real screens inside the real shell with sample data, so each state can be
// screenshotted without signing in. Open /preview.html?screen=home (see SCREENS below). Not part of the production build.
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import '../styles/reference.css';
import type { DriverAccount } from '../types';
import { Shell, type ShellPage } from '../components/nx/Shell';
import { SupportDialog } from '../components/nx/Support';
import { HomeScreen } from '../screens/HomeScreen';
import { TripsScreen, type TripsTab } from '../screens/TripsScreen';
import { TripFlowScreen } from '../screens/TripFlowScreen';
import { VehicleVerificationScreen } from '../screens/VehicleVerificationScreen';
import { EarningsScreen } from '../screens/EarningsScreen';
import { WalletPayoutScreen } from '../screens/WalletPayoutScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { summarizeEarnings } from '../services/driverEarnings';
import * as fx from './fixtures';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'home';
const fleet = q.get('fleet') === '1';
const offline = q.get('offline') === '1';
const noRules = q.get('rules') === 'none';

const account: DriverAccount = fleet ? { ...fx.account, driver: { ...fx.account.driver, vendorId: 'v', vendorName: 'Sample Fleet' } } : fx.account;
const noop = async () => undefined;
const upcoming = [fx.trips.soon, fx.trips.confirmed];
const completed = [fx.trips.completed, fx.trips.completed2];

const Preview: React.FC = () => {
  const [tab, setTab] = useState<TripsTab>(screen === 'trips-completed' ? 'completed' : screen === 'trips-cancelled' ? 'cancelled' : 'upcoming');
  const [support, setSupport] = useState(screen === 'support');
  const earnings = summarizeEarnings(fx.ledger);
  const noTrip = q.get('trip') === 'none';

  let page: ShellPage = 'home';
  let body: React.ReactNode = null;
  const tripScreens: Record<string, keyof typeof fx.trips> = {
    'trip-confirmed': 'confirmed', 'trip-photos': 'photos', 'trip-photos-early': 'photosEarly', 'trip-otp': 'otp', 'trip-ready': 'ready', 'trip-started': 'started',
    'trip-receipt': 'completed', 'trip-cancelled': 'cancelled', 'trip-fleet': 'fleet',
  };

  if (screen.startsWith('home')) {
    body = (
      <HomeScreen
        account={account}
        now={Date.now()}
        online={!offline}
        presenceBusy={false}
        hasActiveTrip={!noTrip && !offline && screen !== 'home-free'}
        trip={noTrip || screen === 'home-free' ? null : fx.trips.soon}
        assignedCount={noTrip ? 0 : 2}
        completedCount={2}
        offers={screen === 'home-empty' ? [] : fx.offers}
        acceptingId={null}
        onGoOnline={() => undefined}
        onAccept={async () => true}
        onBid={async () => true}
        onWithdrawBid={async () => true}
        onOpenTrip={() => undefined}
        onNavigate={() => undefined}
        earnings={earnings}
        walletAvailable={fx.wallet.available}
      />
    );
  } else if (screen.startsWith('trips')) {
    page = 'trips';
    body = (
      <TripsScreen tab={tab} onTab={setTab} now={Date.now()} upcoming={upcoming} completed={completed} cancelled={[fx.trips.cancelled]} ledger={fx.ledger} onOpenTrip={() => undefined} onBrowse={() => undefined} />
    );
  } else if (tripScreens[screen]) {
    page = 'trip';
    body = (
      <TripFlowScreen
        trip={fx.trips[tripScreens[screen]]}
        now={Date.now()}
        rules={noRules ? null : { startWindowMs: 6 * 3600000, pickupRadiusKm: 3, locationMaxAccuracyMeters: 200 }}
        onBack={() => undefined}
        onStartVerification={() => undefined}
        onReachedPickup={noop}
        onVerifyBoarding={noop}
        onTripStart={noop}
        onTripEnd={noop}
        onHelp={() => setSupport(true)}
      />
    );
  } else if (screen === 'camera') {
    page = 'camera';
    body = <VehicleVerificationScreen trip={fx.trips.confirmed} onDone={() => undefined} onCancel={() => undefined} />;
  } else if (screen.startsWith('earnings')) {
    page = 'earnings';
    body = <EarningsScreen earnings={earnings} completedTrips={completed} ledger={fx.ledger} fleetDriver={fleet} fleetName="Sample Fleet" />;
  } else if (screen.startsWith('wallet')) {
    page = 'wallet';
    body = <WalletPayoutScreen wallet={fx.wallet} bank={fx.account.bank} payoutRequests={fx.payouts} ledger={fx.ledger} fleetDriver={fleet} onRequestPayout={noop} onSupport={() => setSupport(true)} />;
  } else if (screen === 'profile') {
    page = 'profile';
    body = <ProfileScreen account={account} completedTrips={14} onEditDocuments={() => undefined} onSaveContact={noop} onSignOut={() => undefined} onSupport={() => setSupport(true)} />;
  } else if (screen.startsWith('notifications')) {
    page = 'notifications';
    body = <NotificationsScreen notifications={fx.notifications} penalties={fx.penalties} penaltiesError="" onMarkRead={() => undefined} onOpenPenalty={() => undefined} />;
  }

  return (
    <Shell
      page={page}
      fleetDriver={fleet}
      driver={{ name: account.driver.name, photoUrl: '' }}
      tripCount={upcoming.length}
      online={!offline}
      presenceLocked={false}
      presenceBusy={false}
      hasUnread
      unreadCount={2}
      onNavigate={() => undefined}
      onToggleOnline={() => undefined}
      onOpenNotifications={() => undefined}
      onOpenSupport={() => setSupport(true)}
      toast={q.get('toast') ? { kind: 'ok', text: 'Trip accepted! Drive to the pickup.' } : null}
      onDismissToast={() => undefined}
      overlays={<SupportDialog open={support} onClose={() => setSupport(false)} context={screen.startsWith('trip-') ? { tripCode: 'NT-1001', started: screen === 'trip-started' } : {}} />}
    >
      {body}
    </Shell>
  );
};

// Fixtures must never ship: outside the dev server this page renders nothing.
if (import.meta.env.DEV) ReactDOM.createRoot(document.getElementById('root')!).render(<Preview />);
else document.body.textContent = 'The interface preview is only available in development.';

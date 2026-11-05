import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DriverAccount,
  DriverNotification,
  DriverWallet,
  LedgerEntry,
  DriverStatus,
  MarketplaceOffer,
  DriverPenalty,
  PayoutRequest,
  TollReceipt,
  TripDetails,
} from './types';
import { Shell, type NavItem, type ShellPage } from './components/nx/Shell';
import { SupportDialog, type SupportContext } from './components/nx/Support';
import { HelpCancellationDialog, PolicyDialog } from './components/nx/Cancellation';
import { DEFAULT_POLICY, acknowledgeAssignment, subscribeToCancellationPolicy, subscribeToDriverCancellations, type DriverCancellation } from './services/partnerRequests';
import { tripIsActive } from './components/nx/format';
import { HomeScreen } from './screens/HomeScreen';
import { TripsScreen, type TripsTab } from './screens/TripsScreen';
import { TripFlowScreen } from './screens/TripFlowScreen';
import { VehicleVerificationScreen } from './screens/VehicleVerificationScreen';
import { NotificationPopups } from './components/NotificationPopups';
import { PenaltyAckModal } from './components/PenaltyAckModal';
import { advanceTrip, verifyBoarding } from './services/tripService';
import { getFirebaseLocation } from './services/location';
import { EarningsScreen } from './screens/EarningsScreen';
import { LocalTaxiScreen } from './screens/LocalTaxiScreen';
import { WalletPayoutScreen } from './screens/WalletPayoutScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { RegistrationScreen } from './screens/RegistrationScreen';
import {
  acceptMarketplaceTrip,
  describeFirestoreError,
  markNotificationRead,
  requestPayout,
  setDriverPresence,
  subscribeToDriverBookings,
  subscribeToDriverLedger,
  subscribeToDriverNotifications,
  subscribeToDriverPenalties,
  subscribeToDriverWallet,
  subscribeToOpenMarketplace,
  subscribeToPayoutRequests,
  subscribeToTripRules,
  submitDutyBid,
  withdrawDutyBid,
  updateDriverContactDetails,
  type TripRules,
} from './services/driverFirestoreService';
import { EMPTY_WALLET, summarizeEarnings } from './services/driverEarnings';

interface DriverWorkspaceProps {
  account: DriverAccount;
  onSignOut: () => void;
}

const byPickup = (a: TripDetails, b: TripDetails) => (a.pickupAt?.getTime() ?? Infinity) - (b.pickupAt?.getTime() ?? Infinity);

export const DriverWorkspace: React.FC<DriverWorkspaceProps> = ({ account, onSignOut }) => {
  const driver = account.driver;
  const [page, setPage] = useState<ShellPage>('home');
  const [tripsTab, setTripsTab] = useState<TripsTab>('upcoming');
  const [tripId, setTripId] = useState<string | null>(null);
  const [support, setSupport] = useState<SupportContext | null>(null);
  const [helpTripId, setHelpTripId] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [cancelPolicy, setCancelPolicy] = useState(DEFAULT_POLICY);
  const [cancellations, setCancellations] = useState<DriverCancellation[]>([]);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [bookings, setBookings] = useState<TripDetails[]>([]);
  const [offers, setOffers] = useState<MarketplaceOffer[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [notifications, setNotifications] = useState<DriverNotification[]>([]);
  const [penalties, setPenalties] = useState<DriverPenalty[]>([]);
  const [penaltiesError, setPenaltiesError] = useState('');
  const [ackPenaltyId, setAckPenaltyId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<DriverWallet>(EMPTY_WALLET);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [rules, setRules] = useState<TripRules | null>(null);
  const [presenceBusy, setPresenceBusy] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((kind: 'ok' | 'error', text: string) => {
    setToast({ kind, text });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  // Day labels ("Today") and the pickup windows re-evaluate while the app stays open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // ── Live data ────────────────────────────────────────────────────────────
  useEffect(() => subscribeToDriverBookings(driver.id, setBookings), [driver.id]);
  // The marketplace is for independent drivers; a fleet driver's trips come from its vendor.
  const independent = !driver.vendorId;
  useEffect(() => {
    if (!independent) {
      setOffers([]);
      return undefined;
    }
    return subscribeToOpenMarketplace(setOffers);
  }, [independent]);
  useEffect(() => subscribeToPayoutRequests(driver.id, setPayouts), [driver.id]);
  useEffect(() => subscribeToTripRules(setRules), []);
  useEffect(() => subscribeToCancellationPolicy(setCancelPolicy), []);
  useEffect(() => subscribeToDriverCancellations(driver.id, setCancellations), [driver.id]);
  useEffect(() => subscribeToDriverNotifications(driver.id, setNotifications), [driver.id]);
  useEffect(() => subscribeToDriverPenalties(driver.id, (p) => { setPenalties(p); setPenaltiesError(''); }, setPenaltiesError), [driver.id]);
  // Money comes from the server's partner ledger; the app never computes it.
  useEffect(() => subscribeToDriverWallet(driver.id, setWallet, (m) => notify('error', m)), [driver.id, notify]);
  useEffect(() => subscribeToDriverLedger(driver.id, setLedger, (m) => notify('error', m)), [driver.id, notify]);

  const upcoming = useMemo(() => bookings.filter((b) => b.status === 'Assigned' || b.status === 'Ongoing').sort(byPickup), [bookings]);
  const completedTrips = useMemo(
    () => bookings.filter((b) => b.status === 'Completed').sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)),
    [bookings],
  );
  const cancelledTrips = useMemo(() => bookings.filter((b) => b.status === 'Cancelled' || b.status === 'Rejected').sort(byPickup), [bookings]);
  // A trip already in progress comes first; otherwise the earliest pickup.
  const nextTrip = useMemo(() => upcoming.find(tripIsActive) ?? upcoming[0] ?? null, [upcoming]);
  const activeTrip = nextTrip;
  const viewTrip = useMemo(() => (tripId ? bookings.find((b) => b.id === tripId) ?? null : null), [bookings, tripId]);
  // The vendor sees "Viewed" once the assigned driver opens the duty.
  const viewedId = viewTrip && !viewTrip.driverResponse?.viewedAt && !['Completed', 'Cancelled', 'Rejected'].includes(viewTrip.status) ? viewTrip.id : '';
  useEffect(() => { if (viewedId) acknowledgeAssignment(viewedId, 'viewed'); }, [viewedId]);

  // Presence follows the trip: On Trip while one is active, back to Online after.
  const presence: DriverStatus = driver.presenceStatus;
  useEffect(() => {
    if (activeTrip && presence !== 'On Trip') {
      setDriverPresence(driver.id, 'On Trip').catch(() => undefined);
    } else if (!activeTrip && presence === 'On Trip') {
      setDriverPresence(driver.id, 'Online').catch(() => undefined);
    }
  }, [activeTrip, presence, driver.id]);

  // Leave the photo check if the trip started, was cancelled or was reassigned
  // (photos can be taken before leaving or at the pickup).
  useEffect(() => {
    if (page === 'camera' && (!viewTrip || viewTrip.status === 'Completed' || viewTrip.status === 'Cancelled' || (viewTrip.subStatus !== 'Not Started' && viewTrip.subStatus !== 'Reached Pickup'))) {
      setPage(viewTrip ? 'trip' : 'trips');
    }
  }, [page, viewTrip]);

  // A penalty must be acknowledged (or disputed) before the driver carries on.
  const mustAcknowledge = useMemo(() => penalties.find((p) => p.status === 'Pending' && !p.acknowledged) ?? null, [penalties]);
  const penaltyToShow = penalties.find((p) => p.id === ackPenaltyId && (p.status === 'Pending' || p.status === 'Acknowledged')) ?? mustAcknowledge;

  // ── Earnings (credited by the server when a trip's fare is verified) ────
  const earnings = useMemo(() => summarizeEarnings(ledger), [ledger]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // ── Navigation ───────────────────────────────────────────────────────────
  const go = useCallback((next: ShellPage) => {
    setPage(next);
    window.scrollTo({ top: 0 });
  }, []);
  const openTrip = (t: TripDetails) => {
    setTripId(t.id);
    go('trip');
  };
  const navigate = (id: NavItem['id']) => go(id);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handlePresenceChange = async (next: DriverStatus) => {
    if (activeTrip) {
      notify('error', 'Finish your current trip before changing your duty status.');
      return;
    }
    setPresenceBusy(true);
    try {
      await setDriverPresence(driver.id, next);
    } catch (err) {
      notify('error', describeFirestoreError(err, 'Could not update your status.'));
    } finally {
      setPresenceBusy(false);
    }
  };

  const handleAccept = async (offer: MarketplaceOffer): Promise<boolean> => {
    if (activeTrip) {
      notify('error', 'You already have an active trip.');
      return false;
    }
    setAcceptingId(offer.id);
    try {
      await acceptMarketplaceTrip(driver, account.vehicle.vehicleNumber, offer);
      notify('ok', 'Trip accepted! Drive to the pickup; take the vehicle photos before you start the trip.');
      go('home');
      return true;
    } catch (err) {
      notify('error', err instanceof Error && !(err as { code?: string }).code
        ? err.message
        : describeFirestoreError(err, 'This trip is no longer available — another partner may have taken it.'));
      return false;
    } finally {
      setAcceptingId(null);
    }
  };

  const handleBid = async (offer: MarketplaceOffer, rate: number, note: string): Promise<boolean> => {
    try {
      await submitDutyBid(offer, rate, note);
      notify('ok', 'Bid sent. NESAM reviews bids and will notify you if it is accepted.');
      return true;
    } catch (err) {
      notify('error', err instanceof Error && !(err as { code?: string }).code ? err.message : describeFirestoreError(err, 'Your bid could not be sent.'));
      return false;
    }
  };

  const handleWithdrawBid = async (offer: MarketplaceOffer): Promise<boolean> => {
    try {
      await withdrawDutyBid(offer);
      notify('ok', 'Your bid was withdrawn.');
      return true;
    } catch (err) {
      notify('error', err instanceof Error && !(err as { code?: string }).code ? err.message : describeFirestoreError(err, 'Your bid could not be withdrawn.'));
      return false;
    }
  };

  const handleVerified = () => {
    go('trip');
    notify('ok', 'Vehicle photos submitted. Start the trip at the pickup once the boarding OTP is verified.');
  };

  const handleTripStart = async (requestId: string) => {
    if (!viewTrip) return;
    const location = await getFirebaseLocation();
    await advanceTrip({ bookingId: viewTrip.id, to: 'Trip Started', location, requestId });
  };

  const handleReachedPickup = async (requestId: string) => {
    if (!viewTrip) return;
    await advanceTrip({ bookingId: viewTrip.id, to: 'Reached Pickup', requestId });
  };

  const handleVerifyBoarding = async (otp: string) => {
    if (!viewTrip) return;
    await verifyBoarding(viewTrip.id, otp);
  };

  const handleTripEnd = async (totalKm: number, tolls: TollReceipt[], requestId: string) => {
    if (!viewTrip) return;
    const fleetTrip = viewTrip.fleetTrip;
    const location = await getFirebaseLocation();
    await advanceTrip({ bookingId: viewTrip.id, to: 'Trip Ended', location, totalKm, tolls, requestId });
    notify('ok', fleetTrip
      ? 'Trip ended. Your fleet operator settles your pay for this trip.'
      : 'Trip ended. Your earning is added to your wallet once NESAM verifies the fare, and becomes withdrawable when the customer’s payment is confirmed.');
  };

  const handleRequestPayout = async (amount: number, method: 'UPI' | 'Bank Transfer') => {
    await requestPayout(amount, method);
    notify('ok', 'Payout request sent. The amount is held until NESAM Finance transfers it.');
  };

  // The document update form keeps its production layout; it runs full-screen outside the themed shell.
  if (page === 'documents') {
    return (
      <div className="min-h-screen bg-[#F7F7F7] text-[#111111] font-sans antialiased">
        <main className="max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          <RegistrationScreen
            uid={driver.id}
            mode="update"
            initial={account}
            fleetDriver={!!driver.vendorId}
            currentStatus={driver.approvalStatus}
            onSubmitted={() => {
              go('profile');
              notify('ok', 'Documents submitted for re-verification.');
            }}
            onCancel={() => go('profile')}
          />
        </main>
      </div>
    );
  }

  const online = presence !== 'Offline';
  const activePage: ShellPage = (page === 'earnings' || page === 'wallet') && !independent ? 'home' : page;

  let body: React.ReactNode = null;
  if (activePage === 'home') {
    body = (
      <HomeScreen
        account={account}
        now={now}
        online={online}
        presenceBusy={presenceBusy}
        hasActiveTrip={Boolean(activeTrip)}
        trip={nextTrip}
        assignedCount={upcoming.length}
        completedCount={completedTrips.length}
        offers={offers}
        acceptingId={acceptingId}
        onGoOnline={() => void handlePresenceChange('Online')}
        onAccept={handleAccept}
        onBid={handleBid}
        onWithdrawBid={handleWithdrawBid}
        onOpenTrip={openTrip}
        onNavigate={(p) => go(p)}
        earnings={earnings}
        walletAvailable={wallet.available}
        cancelPolicy={cancelPolicy}
        onViewPolicy={() => setPolicyOpen(true)}
      />
    );
  } else if (activePage === 'local') {
    body = <LocalTaxiScreen />;
  } else if (activePage === 'trips') {
    body = (
      <TripsScreen
        tab={tripsTab}
        onTab={setTripsTab}
        now={now}
        upcoming={upcoming}
        completed={completedTrips}
        cancelled={cancelledTrips}
        cancelledRequests={cancellations}
        ledger={ledger}
        onOpenTrip={openTrip}
        onBrowse={() => go('home')}
      />
    );
  } else if (activePage === 'trip') {
    body = viewTrip ? (
      <TripFlowScreen
        key={viewTrip.id}
        trip={viewTrip}
        now={now}
        rules={rules}
        onBack={() => go('trips')}
        onStartVerification={() => go('camera')}
        onReachedPickup={handleReachedPickup}
        onVerifyBoarding={handleVerifyBoarding}
        onTripStart={handleTripStart}
        onTripEnd={handleTripEnd}
        onHelp={() => setHelpTripId(viewTrip.id)}
        cancellation={cancellations.find((c) => c.bookingId === viewTrip.id) ?? null}
      />
    ) : (
      <section className="panel empty-state">
        <h3>No trip selected</h3>
        <p>Open a trip from My Trips to continue.</p>
        <button type="button" className="button primary" onClick={() => go('trips')}>
          Go to My Trips
        </button>
      </section>
    );
  } else if (activePage === 'camera') {
    body = viewTrip ? <VehicleVerificationScreen trip={viewTrip} onDone={handleVerified} onCancel={() => go('trip')} /> : null;
  } else if (activePage === 'earnings') {
    body = <EarningsScreen earnings={earnings} completedTrips={completedTrips} ledger={ledger} fleetDriver={!independent} fleetName={driver.vendorName} />;
  } else if (activePage === 'wallet') {
    body = (
      <WalletPayoutScreen
        wallet={wallet}
        bank={account.bank}
        payoutRequests={payouts}
        ledger={ledger}
        fleetDriver={!independent}
        onRequestPayout={handleRequestPayout}
        onSupport={() => setSupport({})}
      />
    );
  } else if (activePage === 'notifications') {
    body = (
      <NotificationsScreen
        notifications={notifications}
        penalties={penalties}
        penaltiesError={penaltiesError}
        onMarkRead={(id) => markNotificationRead(id).catch(() => undefined)}
        onOpenPenalty={(p) => setAckPenaltyId(p.id)}
      />
    );
  } else if (activePage === 'profile') {
    body = (
      <ProfileScreen
        account={account}
        completedTrips={completedTrips.length}
        onEditDocuments={() => go('documents')}
        onSaveContact={(fields) => updateDriverContactDetails(driver.id, fields)}
        onSignOut={onSignOut}
        onSupport={() => setSupport({})}
        onViewPolicy={independent ? () => setPolicyOpen(true) : undefined}
      />
    );
  }

  return (
    <>
      <Shell
        page={activePage}
        fleetDriver={!independent}
        driver={{ name: driver.name, photoUrl: driver.photoUrl }}
        tripCount={upcoming.length}
        online={online}
        presenceLocked={Boolean(activeTrip)}
        presenceBusy={presenceBusy}
        hasUnread={unreadCount > 0}
        unreadCount={unreadCount}
        onNavigate={navigate}
        onToggleOnline={() => void handlePresenceChange(online ? 'Offline' : 'Online')}
        onOpenNotifications={() => go('notifications')}
        onOpenSupport={() => setSupport({})}
        toast={toast}
        onDismissToast={() => setToast(null)}
        overlays={
          <>
            <SupportDialog open={support !== null} onClose={() => setSupport(null)} context={support ?? {}} />
            <PolicyDialog open={policyOpen} onClose={() => setPolicyOpen(false)} policy={cancelPolicy} />
            <HelpCancellationDialog
              open={helpTripId !== null}
              onClose={() => setHelpTripId(null)}
              trip={bookings.find((b) => b.id === helpTripId) ?? null}
              request={cancellations.find((c) => c.bookingId === helpTripId) ?? null}
              policy={cancelPolicy}
              onDone={(m) => notify('ok', m)}
            />
          </>
        }
      >
        {body}
      </Shell>

      <NotificationPopups
        notifications={notifications}
        onOpen={(n) => {
          markNotificationRead(n.id).catch(() => undefined);
          if (n.category === 'penalties') go('notifications');
          else if (n.ctaPage === 'dashboard') go('home');
          else if (['trip', 'trips', 'booking-detail'].includes(n.ctaPage)) {
            // The trip the notification is about; the next trip only when it names none.
            const named = n.bookingId ? bookings.find((t) => t.id === n.bookingId) : undefined;
            if (named) openTrip(named);
            else if (nextTrip) openTrip(nextTrip);
            else go('trips');
          } else go(['earnings', 'wallet', 'notifications', 'profile'].includes(n.ctaPage) ? (n.ctaPage as ShellPage) : 'notifications');
        }}
      />
      {penaltyToShow && (
        <PenaltyAckModal
          key={penaltyToShow.id}
          penalty={penaltyToShow}
          onDone={(m) => {
            setAckPenaltyId(null);
            notify('ok', m);
          }}
        />
      )}
    </>
  );
};

// Live data and actions for an approved vendor. Every list is a Firestore listener; every change goes through the
// same services as before (rules and server functions decide what is allowed). Nothing here is simulated.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  BidProposal, FleetDriver, FleetVehicle, OpenTrip, OperationsConfig, PartnerRequestRecord, PayoutRequest, SecurityDeposit, SettlementDue, TransactionRecord,
  VendorProfile, VendorRecord, VendorTrip, WalletDetails,
} from '../types';
import type { PartnerNotification, PartnerPenalty } from '../notificationTypes';
import {
  acceptOfferedRate, assignTripInFirestore, createVehicle, describeActionError, inviteDriverByVendor, pairVehicleDriver, requestVendorPayout,
  setDriverSuspended, setVehicleStatus, submitCounterBid, withdrawBid, subscribeToFleetDrivers, subscribeToFleetVehicles, subscribeToOpenMarketplaceTrips,
  subscribeToVehicleCategories, subscribeToVendorBids, subscribeToVendorLedger, subscribeToVendorPayouts, subscribeToVendorTrips,
  subscribeToVendorWallet, type NewVehicle, type VehicleCategoryOption,
} from '../services/vendorFirestoreService';
import { markNotificationRead, subscribeToVendorNotifications, subscribeToVendorPenalties } from '../services/partnerNotifications';
import { subscribeToInvites, subscribeToMyLinks, type DriverInvite, type PartnerLink } from '../services/partnerLinks';
import { EMPTY_WALLET, mapOperations } from '../services/vendorMappers';
import { subscribeToDeposit, subscribeToOperations, subscribeToPartnerRequests, subscribeToSettlementDues } from '../partner/services';

export type PageId = 'duties' | 'drivers' | 'vehicles' | 'requests' | 'payouts' | 'account' | 'alerts';

export const isLive = (t: VendorTrip) => t.status === 'Ongoing' || t.tripSubStatus === 'Reached Pickup' || t.tripSubStatus === 'Trip Started';
export const isCompleted = (t: VendorTrip) => t.status === 'Completed';
export const isUpcoming = (t: VendorTrip) => (t.status === 'Confirmed' || t.status === 'Assigned') && !isLive(t);
/** A trip can be (re)dispatched until it starts. */
export const canDispatch = (t: VendorTrip) => isUpcoming(t) && (!t.tripSubStatus || t.tripSubStatus === 'Not Started');
export const linkIsOpen = (l: PartnerLink) => l.status === 'Awaiting OTP' || l.status === 'Office review';

interface PartnerValue {
  profile: VendorProfile;
  record: VendorRecord;
  vehicles: FleetVehicle[];
  drivers: FleetDriver[];
  categories: VehicleCategoryOption[];
  openTrips: OpenTrip[];
  bids: BidProposal[];
  trips: VendorTrip[];
  wallet: WalletDetails;
  payouts: PayoutRequest[];
  ledger: TransactionRecord[];
  notifications: PartnerNotification[];
  penalties: PartnerPenalty[];
  penaltiesError: string;
  links: PartnerLink[];
  invites: DriverInvite[];
  requests: PartnerRequestRecord[];
  deposit: SecurityDeposit | null;
  dues: SettlementDue[];
  ops: OperationsConfig;
  loadError: string;
  retry: () => void;
  unread: number;
  /** Requests this vendor still has to act on (a code to enter, or waiting for the office). */
  openLinks: PartnerLink[];
  page: PageId;
  /** Opens a section; `intent` ("add") asks that section to open its add dialog. */
  go: (page: PageId, intent?: string) => void;
  intent: string;
  clearIntent: () => void;
  actions: {
    addVehicle: (v: NewVehicle) => Promise<void>;
    setVehicleStatus: (id: string, status: FleetVehicle['status']) => Promise<void>;
    pairDriver: (vehicleId: string, driverId: string) => Promise<void>;
    inviteDriver: (phone: string, vehicleNumber: string) => Promise<void>;
    setSuspended: (driverId: string, suspended: boolean) => Promise<void>;
    acceptOffer: (trip: OpenTrip) => Promise<void>;
    submitBid: (trip: OpenTrip, rate: number, note: string, autoAcceptConsent?: boolean) => Promise<void>;
    withdrawBid: (bid: BidProposal) => Promise<void>;
    assign: (tripId: string, driverId: string, vehicleId: string) => Promise<void>;
    requestPayout: (amount: number, method: 'UPI' | 'Bank Transfer') => Promise<void>;
    markRead: (id: string) => void;
  };
}

const Ctx = createContext<PartnerValue | null>(null);
/** Development preview harness only (preview.html). */
export const PartnerContextForPreview = Ctx;
export type { PartnerValue };

export function usePartner(): PartnerValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('PartnerProvider is missing');
  return v;
}

export const PartnerProvider: React.FC<{ profile: VendorProfile; record: VendorRecord; children: React.ReactNode }> = ({ profile, record, children }) => {
  const vendorId = profile.id;
  const [page, setPage] = useState<PageId>('duties');
  const [intent, setIntent] = useState('');
  const go = useCallback((p: PageId, i = '') => {
    setPage(p);
    setIntent(i);
    window.scrollTo({ top: 0 });
  }, []);
  const clearIntent = useCallback(() => setIntent(''), []);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [categories, setCategories] = useState<VehicleCategoryOption[]>([]);
  const [openTrips, setOpenTrips] = useState<OpenTrip[]>([]);
  const [bids, setBids] = useState<BidProposal[]>([]);
  const [trips, setTrips] = useState<VendorTrip[]>([]);
  const [wallet, setWallet] = useState<WalletDetails>(EMPTY_WALLET);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [ledger, setLedger] = useState<TransactionRecord[]>([]);
  const [notifications, setNotifications] = useState<PartnerNotification[]>([]);
  const [penalties, setPenalties] = useState<PartnerPenalty[]>([]);
  const [penaltiesError, setPenaltiesError] = useState('');
  const [links, setLinks] = useState<PartnerLink[]>([]);
  const [invites, setInvites] = useState<DriverInvite[]>([]);
  const [requests, setRequests] = useState<PartnerRequestRecord[]>([]);
  const [deposit, setDeposit] = useState<SecurityDeposit | null>(null);
  const [dues, setDues] = useState<SettlementDue[]>([]);
  const [ops, setOps] = useState<OperationsConfig>(() => mapOperations(undefined));
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setLoadError('');
    const fail = (m: string) => setLoadError(m);
    const unsubs = [
      subscribeToOpenMarketplaceTrips(setOpenTrips, fail),
      subscribeToVendorBids(vendorId, setBids, fail),
      subscribeToFleetVehicles(vendorId, setVehicles, fail),
      subscribeToFleetDrivers(vendorId, setDrivers, fail),
      subscribeToVehicleCategories(setCategories, fail),
      subscribeToVendorTrips(vendorId, setTrips, fail),
      subscribeToVendorPayouts(vendorId, setPayouts, fail),
      subscribeToVendorWallet(vendorId, setWallet, fail),
      subscribeToVendorLedger(vendorId, setLedger, fail),
      subscribeToVendorNotifications(vendorId, setNotifications),
      subscribeToVendorPenalties(vendorId, (p) => { setPenalties(p); setPenaltiesError(''); }, setPenaltiesError),
      subscribeToMyLinks(vendorId, setLinks, fail),
      subscribeToInvites(vendorId, setInvites, fail),
      subscribeToPartnerRequests(vendorId, setRequests, fail),
      subscribeToDeposit(vendorId, setDeposit),
      subscribeToSettlementDues(vendorId, setDues),
      subscribeToOperations(setOps),
    ];
    return () => unsubs.forEach((u) => u());
  }, [vendorId, retryKey]);

  const retry = useCallback(() => setRetryKey((k) => k + 1), []);

  const value = useMemo<PartnerValue>(() => {
    // Every action awaits Firestore / the server and reports a real failure.
    const run = async (work: () => Promise<unknown>, fallback: string): Promise<void> => {
      try { await work(); } catch (e) { throw new Error(describeActionError(e, fallback)); }
    };
    const name = profile.companyName;
    return {
      profile, record, vehicles, drivers, categories, openTrips, bids, trips, wallet, payouts, ledger, notifications, penalties, penaltiesError, links, invites,
      requests, deposit, dues, ops, loadError, retry, page, go, intent, clearIntent,
      unread: notifications.filter((n) => !n.read).length,
      openLinks: links.filter((l) => linkIsOpen(l) && l.toVendorId === vendorId),
      actions: {
        addVehicle: (v) => run(async () => { await createVehicle(vendorId, v); }, 'The vehicle was not saved. Please retry.'),
        setVehicleStatus: (id, status) => run(() => setVehicleStatus(id, status), 'The vehicle status was not changed. Please retry.'),
        pairDriver: (vehicleId, driverId) => {
          const vehicle = vehicles.find((v) => v.id === vehicleId);
          if (!vehicle) return Promise.reject(new Error('This vehicle is no longer in your fleet.'));
          const driver = driverId ? drivers.find((d) => d.id === driverId) ?? null : null;
          return run(() => pairVehicleDriver(vehicle, driver, vehicles), 'The driver was not paired. Please retry.');
        },
        inviteDriver: (phone, vehicleNumber) => run(() => inviteDriverByVendor(phone, vendorId, name, vehicleNumber), 'The invitation was not saved. Please retry.'),
        setSuspended: (id, suspended) => run(() => setDriverSuspended(id, suspended), 'The driver status was not changed. Please retry.'),
        acceptOffer: async (trip) => { await run(() => acceptOfferedRate(trip.id), 'Could not accept this trip. Please retry.'); go('duties'); },
        submitBid: (trip, rate, note, consent = true) => run(() => submitCounterBid(trip, rate, note, consent), 'The bid was not submitted. Please retry.'),
        withdrawBid: (bid) => run(() => withdrawBid(bid), 'The bid was not withdrawn. Please retry.'),
        assign: (tripId, driverId, vehicleId) => {
          const driver = drivers.find((d) => d.id === driverId);
          const vehicle = vehicles.find((v) => v.id === vehicleId);
          if (!driver || !vehicle) return Promise.reject(new Error('Choose a driver and a vehicle from your fleet.'));
          return run(() => assignTripInFirestore(tripId, driver, vehicle), 'The trip was not dispatched. Please retry.');
        },
        requestPayout: (amount, method) => run(() => requestVendorPayout(`VPO-${crypto.randomUUID()}`, amount, method), 'Payout request failed. Please retry.'),
        markRead: (id) => { void markNotificationRead(id).catch(() => undefined); },
      },
    };
  }, [profile, record, vehicles, drivers, categories, openTrips, bids, trips, wallet, payouts, ledger, notifications, penalties, penaltiesError, links, invites, requests, deposit, dues, ops, loadError, retry, page, go, intent, clearIntent, vendorId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

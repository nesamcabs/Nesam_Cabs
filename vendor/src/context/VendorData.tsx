// Live data for an approved vendor, subscribed once per session (the Vendor
// Web dashboard mounted the same listeners in App.tsx). Torn down on sign-out
// because the provider is keyed by uid.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { VendorProfile, VendorRecord } from '../types/vendor';
import type {
  DriverInviteRecord,
  FleetDriver,
  FleetVehicle,
  LedgerRecord,
  MarketTrip,
  VendorBid,
  VendorBooking,
  VendorPayoutRequest,
  WalletDetails,
} from '../types/operations';
import {
  subscribeToFleetDrivers,
  subscribeToFleetVehicles,
  subscribeToInvites,
  subscribeToMarketplace,
  subscribeToMyBids,
  subscribeToVendorBookings,
  subscribeToVendorLedger,
  subscribeToVendorPayouts,
  subscribeToVendorWallet,
  isActiveBooking,
  type VendorIdentity,
} from '../services/vendorService';
import { EMPTY_WALLET, monthEarnings } from '../utils/wallet';
import { describeDataError } from '../utils/retry';
import { linkIsOpen, subscribeToMyLinks, type PartnerLink } from '../services/partnerLinks';
import {
  mapOperations, subscribeToDeposit, subscribeToOperations, subscribeToPartnerRequests, subscribeToSettlementDues,
  type OperationsConfig, type PartnerRequestRecord, type SecurityDeposit, type SettlementDue,
} from '../services/partnerOps';

interface VendorDataValue {
  profile: VendorProfile;
  record: VendorRecord;
  identity: VendorIdentity;
  vehicles: FleetVehicle[];
  drivers: FleetDriver[];
  bookings: VendorBooking[];
  activeBookings: VendorBooking[];
  awaitingDispatch: VendorBooking[];
  marketTrips: MarketTrip[];
  bids: VendorBid[];
  invites: DriverInviteRecord[];
  /** Driver / vehicle linking requests that touch this fleet. */
  links: PartnerLink[];
  /** Requests this vendor still has to act on (a code to enter, or waiting for the office). */
  openLinks: PartnerLink[];
  payouts: VendorPayoutRequest[];
  /** The server wallet (wallets/vendor_{uid}); the app never computes a balance. */
  wallet: WalletDetails;
  ledger: LedgerRecord[];
  /** Earnings the server credited this month. */
  monthEarnings: number;
  errors: { bookings: string; market: string; bids: string; wallet: string };
  /** Cancellation, bank and renewal requests sent to the office. */
  requests: PartnerRequestRecord[];
  deposit: SecurityDeposit | null;
  /** Settlement records of completed trips (statements). */
  dues: SettlementDue[];
  ops: OperationsConfig;
}

const Ctx = createContext<VendorDataValue | null>(null);

export function useVendorData(): VendorDataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('VendorDataProvider is missing');
  return v;
}

export function VendorDataProvider({ profile, record, children }: { profile: VendorProfile; record: VendorRecord; children: React.ReactNode }) {
  const vendorId = profile.id;
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [bookings, setBookings] = useState<VendorBooking[]>([]);
  const [marketTrips, setMarketTrips] = useState<MarketTrip[]>([]);
  const [bids, setBids] = useState<VendorBid[]>([]);
  const [invites, setInvites] = useState<DriverInviteRecord[]>([]);
  const [links, setLinks] = useState<PartnerLink[]>([]);
  const [payouts, setPayouts] = useState<VendorPayoutRequest[]>([]);
  const [wallet, setWallet] = useState<WalletDetails>(EMPTY_WALLET);
  const [ledger, setLedger] = useState<LedgerRecord[]>([]);
  const [errors, setErrors] = useState({ bookings: '', market: '', bids: '', wallet: '' });

  useEffect(() => subscribeToFleetVehicles(vendorId, setVehicles), [vendorId]);
  useEffect(() => subscribeToFleetDrivers(vendorId, setDrivers), [vendorId]);
  useEffect(
    () =>
      subscribeToVendorBookings(
        vendorId,
        (b) => {
          setBookings(b);
          setErrors((e) => (e.bookings ? { ...e, bookings: '' } : e));
        },
        (err) => setErrors((e) => ({ ...e, bookings: describeDataError(err) })),
      ),
    [vendorId],
  );
  useEffect(
    () =>
      subscribeToMarketplace(
        (t) => {
          setMarketTrips(t);
          setErrors((e) => (e.market ? { ...e, market: '' } : e));
        },
        (err) => setErrors((e) => ({ ...e, market: describeDataError(err) })),
      ),
    [],
  );
  useEffect(
    () =>
      subscribeToMyBids(
        vendorId,
        (b) => {
          setBids(b);
          setErrors((e) => (e.bids ? { ...e, bids: '' } : e));
        },
        (err) => setErrors((e) => ({ ...e, bids: describeDataError(err) })),
      ),
    [vendorId],
  );
  useEffect(() => subscribeToInvites(vendorId, setInvites), [vendorId]);
  const [requests, setRequests] = useState<PartnerRequestRecord[]>([]);
  const [deposit, setDeposit] = useState<SecurityDeposit | null>(null);
  const [dues, setDues] = useState<SettlementDue[]>([]);
  const [ops, setOps] = useState<OperationsConfig>(() => mapOperations(undefined));
  useEffect(() => subscribeToPartnerRequests(vendorId, setRequests), [vendorId]);
  useEffect(() => subscribeToDeposit(vendorId, setDeposit), [vendorId]);
  useEffect(() => subscribeToSettlementDues(vendorId, setDues), [vendorId]);
  useEffect(() => subscribeToOperations(setOps), []);
  useEffect(() => subscribeToMyLinks(vendorId, setLinks, () => undefined), [vendorId]);
  useEffect(() => subscribeToVendorPayouts(vendorId, setPayouts), [vendorId]);
  useEffect(
    () =>
      subscribeToVendorWallet(
        vendorId,
        (w) => {
          setWallet(w);
          setErrors((e) => ({ ...e, wallet: '' }));
        },
        (err) => setErrors((e) => ({ ...e, wallet: describeDataError(err) })),
      ),
    [vendorId],
  );
  useEffect(() => subscribeToVendorLedger(vendorId, setLedger, (err) => setErrors((e) => ({ ...e, wallet: describeDataError(err) }))), [vendorId]);

  const value = useMemo<VendorDataValue>(() => {
    const sorted = [...bookings].sort((a, b) => (b.confirmedAt?.getTime() ?? 0) - (a.confirmedAt?.getTime() ?? 0));
    const activeBookings = sorted.filter(isActiveBooking);
    return {
      profile,
      record,
      identity: { id: profile.id, companyName: profile.companyName, phone: profile.phone },
      vehicles,
      drivers,
      bookings: sorted,
      activeBookings,
      awaitingDispatch: activeBookings.filter((b) => b.status === 'Confirmed' || (b.status === 'Assigned' && !b.driverId)),
      marketTrips,
      bids,
      invites,
      links,
      openLinks: links.filter((l) => linkIsOpen(l) && l.toVendorId === vendorId),
      payouts,
      wallet,
      ledger,
      monthEarnings: monthEarnings(ledger),
      errors,
      requests,
      deposit,
      dues,
      ops,
    };
  }, [profile, record, vehicles, drivers, bookings, marketTrips, bids, invites, links, vendorId, payouts, wallet, ledger, errors, requests, deposit, dues, ops]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

import { callBackend, settleBooking, settlePayout } from './backend';
import { callFunction } from './callables';
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { describeDataError } from "../utils/retry";
import type {
  BidProposal,
  FleetDriver,
  FleetVehicle,
  OpenTrip,
  PayoutRequest,
  TransactionRecord,
  VendorTrip,
  WalletDetails,
} from "../types";
import {
  mapBid,
  mapDriver,
  mapLedgerEntry,
  mapOpenTrip,
  mapPayout,
  mapVehicle,
  mapVendorTrip,
  mapWallet,
} from "./vendorMappers";

export const VEHICLES_COLLECTION = "vehicles";
export const DRIVERS_COLLECTION = "drivers";
export const MARKETPLACE_COLLECTION = "marketplace_trips";
export const BOOKINGS_COLLECTION = "bookings";
export const PAYOUTS_COLLECTION = "payout_requests";

type OnError = (message: string) => void;

/** Live list; a listener failure is reported (never shown as an empty list). */
function listen<T>(q: ReturnType<typeof query>, map: (id: string, d: Record<string, unknown>) => T | null, cb: (items: T[]) => void, onError: OnError) {
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => map(d.id, d.data() as Record<string, unknown>)).filter((x): x is T => x !== null)),
    (err) => onError(describeDataError(err)),
  );
}

export function subscribeToFleetVehicles(vendorId: string, cb: (vehicles: FleetVehicle[]) => void, onError: OnError) {
  return listen(query(collection(db, VEHICLES_COLLECTION), where("vendorId", "==", vendorId)), mapVehicle, cb, onError);
}

export function subscribeToFleetDrivers(vendorId: string, cb: (drivers: FleetDriver[]) => void, onError: OnError) {
  return listen(query(collection(db, DRIVERS_COLLECTION), where("vendorId", "==", vendorId)), mapDriver, cb, onError);
}

export interface VehicleCategoryOption {
  id: string;
  name: string;
  seatingCapacity: number | null;
}

/** Vehicle categories configured by NESAM (the only categories a vehicle can be registered under). */
export function subscribeToVehicleCategories(cb: (categories: VehicleCategoryOption[]) => void, onError: OnError) {
  return listen(
    query(collection(db, "vehicle_categories"), where("status", "==", "Active")),
    (id, d) => {
      const name = typeof d.name === "string" ? d.name.trim() : "";
      const seats = typeof d.seatingCapacity === "number" && d.seatingCapacity > 0 ? d.seatingCapacity : null;
      return name ? { id, name, seatingCapacity: seats } : null;
    },
    (cats) => cb(cats.sort((a, b) => a.name.localeCompare(b.name))),
    onError,
  );
}

export interface NewVehicle {
  vehicleNumber: string;
  categoryId: string;
  category: string;
  make: string;
  model: string;
  year: string;
  seatingCapacity: number;
  /** Optional documents added at registration (download links + ISO expiry dates) for NESAM review. */
  photoUrl?: string;
  rcDocUrl?: string;
  insuranceDocUrl?: string;
  insuranceExpiry?: string;
  fitnessDocUrl?: string;
  fitnessExpiry?: string;
  statePermitDocUrl?: string;
  permitExpiry?: string;
}

/** Registers a vehicle for NESAM document review (firestore.rules: docStatus "Pending"). */
export async function createVehicle(vendorId: string, v: NewVehicle): Promise<string> {
  const ref = await addDoc(collection(db, VEHICLES_COLLECTION), {
    ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)),
    vehicleNumber: v.vehicleNumber.trim().toUpperCase().replace(/\s+/g, " "),
    vendorId,
    status: "Active",
    docStatus: "Pending",
    assignedDriverId: "",
    assignedDriverName: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function setVehicleStatus(vehicleId: string, status: FleetVehicle["status"]) {
  await updateDoc(doc(db, VEHICLES_COLLECTION, vehicleId), { status, updatedAt: serverTimestamp() });
}

/**
 * Pairs a fleet driver with a vehicle (null unpairs). Both records are kept in
 * step in one batch: the vehicle names its driver and the driver its vehicle
 * (by id), and any previous pairing on either side is released.
 */
export async function pairVehicleDriver(vehicle: FleetVehicle, driver: FleetDriver | null, vehicles: FleetVehicle[]) {
  const batch = writeBatch(db);
  const stamp = serverTimestamp();
  batch.update(doc(db, VEHICLES_COLLECTION, vehicle.id), {
    assignedDriverId: driver?.id ?? "",
    assignedDriverName: driver?.name ?? "",
    updatedAt: stamp,
  });
  if (vehicle.assignedDriverId && vehicle.assignedDriverId !== driver?.id) {
    batch.update(doc(db, DRIVERS_COLLECTION, vehicle.assignedDriverId), { assignedVehicleId: "", assignedVehicleNumber: "", updatedAt: stamp });
  }
  if (driver) {
    const previous = vehicles.find((v) => v.id !== vehicle.id && v.assignedDriverId === driver.id);
    if (previous) batch.update(doc(db, VEHICLES_COLLECTION, previous.id), { assignedDriverId: "", assignedDriverName: "", updatedAt: stamp });
    batch.update(doc(db, DRIVERS_COLLECTION, driver.id), { assignedVehicleId: vehicle.id, assignedVehicleNumber: vehicle.vehicleNumber, updatedAt: stamp });
  }
  await batch.commit();
}

/** Fleet-side suspension; a suspended driver can't be dispatched or go on duty for the fleet. */
export async function setDriverSuspended(driverId: string, suspended: boolean) {
  await updateDoc(doc(db, DRIVERS_COLLECTION, driverId), { fleetStatus: suspended ? "Suspended" : "Active", updatedAt: serverTimestamp() });
}

export async function inviteDriverByVendor(phone: string, vendorId: string, vendorName: string, vehicleNumber: string) {
  const digits = phone.replace(/\D/g, "").slice(-10);
  const normalizedPhone = "+91" + digits;
  await setDoc(
    doc(db, "driver_invites", normalizedPhone),
    {
      phone: normalizedPhone,
      vendorId,
      vendorName,
      vehicleAssignment: vehicleNumber || null,
      preApproved: false,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function subscribeToOpenMarketplaceTrips(cb: (trips: OpenTrip[]) => void, onError: OnError) {
  // Vendors may read only offers still open to them (firestore.rules).
  return listen(query(collection(db, MARKETPLACE_COLLECTION), where("status", "in", ["Open", "Bidding"])), mapOpenTrip, cb, onError);
}

export function subscribeToVendorBids(vendorId: string, cb: (bids: BidProposal[]) => void, onError: OnError) {
  return listen(query(collectionGroup(db, "bids"), where("vendorId", "==", vendorId)), mapBid, (bids) =>
    cb(bids.sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0))), onError);
}

/** The server rejects a counter rate that is the offer itself or implausibly high. */
export const MAX_COUNTER_MULTIPLE = 3;
export function validateCounterRate(rate: number, offered: number | null): string {
  if (!Number.isFinite(rate) || rate <= 0) return "Enter your payout in whole rupees.";
  if (!Number.isInteger(rate)) return "Enter a whole-rupee amount.";
  if (offered && rate === offered) return "That is the offered payout — use Accept instead.";
  if (offered && rate > offered * MAX_COUNTER_MULTIPLE) return `That looks too high (most you can ask is ₹${Math.round(offered * MAX_COUNTER_MULTIPLE).toLocaleString("en-IN")}).`;
  return "";
}

/** Submits a counter-bid for NESAM's review. One bid per vendor per trip: a newer one replaces it. Runs on the server. */
export async function submitCounterBid(trip: OpenTrip, rate: number, note: string, autoAcceptConsent = true) {
  const invalid = validateCounterRate(rate, trip.offeredPayout);
  if (invalid) throw new Error(invalid);
  await callFunction("submitMarketplaceBid", { tripId: trip.id, rate, note: note.trim().slice(0, 300), autoAcceptConsent }, 30000);
  settleBooking(trip.id);
}

/** Withdraws a bid still under review. */
export async function withdrawBid(bid: BidProposal) {
  if (bid.status !== "Pending Review") throw new Error("Only bids under review can be withdrawn.");
  await callFunction("withdrawMarketplaceBid", { tripId: bid.tripId, bidId: bid.id }, 30000);
}

/**
 * Dispatches one of the vendor's drivers in one of its vehicles, referenced by
 * the vehicle's document id (firestore.rules vendorDispatchOk checks both).
 */
export async function assignTripInFirestore(tripId: string, driver: FleetDriver, vehicle: FleetVehicle) {
  await callFunction('vendorAssignDriver', {
    bookingId: tripId,
    driverId: driver.id,
    vehicleId: vehicle.id,
  }, 30000);
  settleBooking(tripId);
}

export function subscribeToVendorActiveTrips(vendorId: string, cb: (trips: VendorTrip[]) => void, onError: OnError) {
  return listen(query(collection(db, BOOKINGS_COLLECTION), where("assignedVendorId", "==", vendorId)), mapVendorTrip, (trips) =>
    cb(trips.filter((t) => t.status !== "Completed" && t.status !== "Cancelled")), onError);
}

/** Every trip this vendor holds, including finished ones (the Duties screen filters by stage). */
export function subscribeToVendorTrips(vendorId: string, cb: (trips: VendorTrip[]) => void, onError: OnError) {
  return listen(query(collection(db, BOOKINGS_COLLECTION), where("assignedVendorId", "==", vendorId)), mapVendorTrip, cb, onError);
}

export function subscribeToVendorPayouts(vendorId: string, cb: (payouts: PayoutRequest[]) => void, onError: OnError) {
  return listen(query(collection(db, PAYOUTS_COLLECTION), where("vendorId", "==", vendorId)), mapPayout, (payouts) =>
    cb(payouts.sort((a, b) => (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0))), onError);
}

/** The server-computed wallet (functions/src/ledger.ts). The portal never computes a balance. */
export function subscribeToVendorWallet(vendorId: string, cb: (wallet: WalletDetails) => void, onError: OnError) {
  return onSnapshot(
    doc(db, "wallets", `vendor_${vendorId}`),
    (snap) => cb(mapWallet(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined)),
    (err) => onError(describeDataError(err)),
  );
}

export function subscribeToVendorLedger(vendorId: string, cb: (entries: TransactionRecord[]) => void, onError: OnError) {
  return listen(query(collection(db, "wallet_ledger"), where("vendorId", "==", vendorId)), mapLedgerEntry, (entries) =>
    cb(entries.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))), onError);
}

/** The server checks the ledger balance and pays to the saved payout account. */
export async function requestVendorPayout(requestId: string, amount: number, method: "UPI" | "Bank Transfer") {
  await callBackend('requestPartnerPayout', { requestId, role: 'vendor', amount, method });
  settlePayout(requestId);
}

/**
 * Accepts a marketplace trip at the offered payout. The claim runs on the server (claimMarketplaceDuty): it picks exactly
 * one winner among vendors, owner-drivers and NESAM's own assignment, so the browser writes nothing to the booking or the offer.
 */
export async function acceptOfferedRate(tripId: string): Promise<void> {
  await callFunction("claimMarketplaceDuty", { bookingId: tripId }, 30000);
  settleBooking(tripId);
}

/** Human message for a failed write or callable. */
export function describeActionError(err: unknown, fallback: string): string {
  const code = (err as { code?: string }).code || "";
  const message = (err as { message?: string }).message || "";
  if (code === "permission-denied") return "This change isn't allowed for your account or the record changed. Refresh and try again.";
  if (/^functions\/(invalid-argument|failed-precondition|permission-denied|unauthenticated)$/.test(code) && message) return message;
  if (!code && message) return message;
  return fallback;
}

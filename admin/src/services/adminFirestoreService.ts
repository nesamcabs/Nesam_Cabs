import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  serverTimestamp,
  addDoc,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { callBackend, usesHttpApi } from "./backend";
async function publishChangedContent(kind:string,id:string) {
  if(usesHttpApi&&['reviews','services','tour_packages','locations'].includes(kind))await callBackend('refreshPublicContent',{kind,id});
}

// ── Bookings without the payout right ─────────────────────────────────────
// Booking documents and marketplace duties carry partner payouts and margin. For an admin without
// the "Vendor payout / company margin" right the rules refuse direct reads; the bookings come from
// getStaffBookings with those fields removed (polled), and marketplace data is not requested.
// The app shell sets the mode before any screen subscribes.
let redactedBookings = false;
const POLL_MS = 20000;
export function setRedactedBookingReads(on: boolean): void {
  redactedBookings = on;
}

/** Rebuilds the { __ts: millis } timestamps getStaffBookings sends. */
function revive(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(revive);
  const o = v as Record<string, unknown>;
  if (typeof o.__ts === "number" && Object.keys(o).length === 1) return Timestamp.fromMillis(o.__ts);
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, revive(x)]));
}

function pollStaffBookings<T>(bookingId: string | null, deliver: (data: T[] | T | null) => void, onError?: (message: string) => void) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const r = await callBackend<{ bookingId?: string }, { bookings?: unknown[]; booking?: unknown }>("getStaffBookings", bookingId ? { bookingId } : {});
      if (stopped) return;
      deliver((bookingId ? revive(r.booking ?? null) : (r.bookings ?? []).map(revive)) as T[] | T | null);
    } catch (err) {
      if (!stopped && onError) onError(describeDataError(err));
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
import {
  Booking,
  Driver,
  Vehicle,
  Vendor,
  Customer,
  MarketplaceTrip,
  PaymentTransaction,
  PenaltyRecord,
  NotificationRecord,
  VehicleCategory,
  Invoice,
  TravelService,
  TourPackage,
  MasterLocation,
  FareRule,
  MasterCoupon,
  CustomerReview,
} from "../types";

export const COLLECTIONS = {
  BOOKINGS: "bookings",
  DRIVERS: "drivers",
  VEHICLES: "vehicles",
  VENDORS: "vendors",
  CUSTOMERS: "customers",
  MARKETPLACE: "marketplace_trips",
  PAYMENTS: "payments",
  PENALTIES: "penalties",
  NOTIFICATIONS: "notifications",
  VEHICLE_CATEGORIES: "vehicle_categories",
  INVOICES: "invoices",
  SERVICES: "services",
  TOUR_PACKAGES: "tour_packages",
  LOCATIONS: "locations",
  FARE_RULES: "fare_rules",
  COUPONS: "coupons",
  REVIEWS: "reviews",
};

/**
 * User-facing text for a failed Firestore read or write. Raw Firebase
 * messages are never shown to operators.
 */
export function describeDataError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  switch (code) {
    case "permission-denied":
      return "You do not have permission for this action. Make sure your admin account is active.";
    case "unavailable":
    case "deadline-exceeded":
      return "Cannot reach the database. Check your internet connection and try again.";
    case "not-found":
      return "This record no longer exists. It may have been deleted by another admin.";
    case "already-exists":
      return "A record with this ID already exists.";
    case "failed-precondition":
      return "The database is not ready for this query (a required index may be missing).";
    case "resource-exhausted":
      return "Too many requests right now. Please wait a moment and try again.";
    case "unauthenticated":
      return "Your session has expired. Sign in again.";
    default:
      return error instanceof Error && error.message && !/firebase|firestore/i.test(error.message)
        ? error.message
        : "Something went wrong while talking to the database. Please try again.";
  }
}

/**
 * Generic real-time collection subscriber.
 *
 * When `onError` is supplied, a listener failure (permission denied, network
 * loss, missing index) is reported through it and the last delivered data is
 * left untouched, so pages can show an error state instead of a misleading
 * "no records" state. Without `onError` the failure is logged and an empty
 * list is delivered.
 */
export function subscribeToCollection<T>(
  collectionName: string,
  callback: (data: T[]) => void,
  onError?: (message: string) => void,
) {
  const fail = (err: unknown) => {
    console.warn(`Firestore listener error on ${collectionName}:`, err);
    if (onError) onError(describeDataError(err));
    else callback([]);
  };
  if (redactedBookings && collectionName === COLLECTIONS.BOOKINGS) {
    return pollStaffBookings<T>(null, (rows) => callback((rows as T[]) ?? []), onError);
  }
  // Marketplace duties, bids, booking events and assignment history all record payouts.
  if (redactedBookings && (collectionName.startsWith("marketplace_trips") || collectionName === PRICING_PRIVATE || /^bookings\/[^/]+\/(events|assignments)$/.test(collectionName))) {
    callback([]);
    return () => {};
  }
  try {
    const q = query(collection(db, collectionName));
    return onSnapshot(
      q,
      (snapshot) => {
        callback(
          snapshot.docs.map((d) => ({ ...d.data(), id: d.id })) as T[],
        );
      },
      fail,
    );
  } catch (err) {
    fail(err);
    return () => {};
  }
}

/**
 * Specific Subscribers
 */
/** The partner side of each booking's pricing snapshot (staff holding the vendor-payout right only; the rules refuse everyone else). */
export const PRICING_PRIVATE = "booking_pricing_private";
export interface PrivatePricing { partner?: unknown; extraPartner?: unknown; extraApproved?: unknown }
/** Puts the private partner pricing back on a booking in memory, so payout screens see the whole snapshot. */
export function withPrivatePricing<B extends { pricing?: unknown }>(b: B, p: PrivatePricing | undefined | null): B {
  if (!p || !b.pricing || typeof b.pricing !== "object") return b;
  const pricing = b.pricing as Record<string, unknown>;
  const extra = pricing.extraCharges && typeof pricing.extraCharges === "object" ? (pricing.extraCharges as Record<string, unknown>) : null;
  return { ...b, pricing: { ...pricing, partner: p.partner ?? pricing.partner ?? null, ...(extra && p.extraPartner ? { extraCharges: { ...extra, partner: p.extraPartner } } : {}) } };
}

/**
 * Bookings with the customer's contact details joined in. The raw phone / WhatsApp / email are not on
 * the booking document (partners can read it); staff read them from booking_contacts.
 */
export const subscribeBookings = (cb: (data: Booking[]) => void, onError?: (message: string) => void) => {
  let bookings: Booking[] = [];
  let contacts = new Map<string, { phone?: string; email?: string; whatsapp?: string }>();
  let priv = new Map<string, PrivatePricing>();
  const emit = () =>
    cb(bookings.map((raw) => {
      const b = withPrivatePricing(raw, priv.get(raw.id));
      const c = contacts.get(b.id);
      return c ? { ...b, phone: c.phone || b.phone, customerEmail: c.email || b.customerEmail, customerWhatsapp: b.customerWhatsapp ?? (c.whatsapp ? { e164: c.whatsapp, sameAsMobile: c.whatsapp === c.phone } : undefined) } : b;
    }) as Booking[]);
  const a = subscribeToCollection<Booking>(COLLECTIONS.BOOKINGS, (d) => { bookings = d; emit(); }, onError);
  const b = subscribeToCollection<{ id: string; phone?: string; email?: string; whatsapp?: string }>("booking_contacts", (d) => { contacts = new Map(d.map((x) => [x.id, x])); emit(); }, () => undefined);
  // Without the payout right the rules refuse this read: the bookings simply carry no partner pricing.
  const p = subscribeToCollection<PrivatePricing & { id: string }>(PRICING_PRIVATE, (d) => { priv = new Map(d.map((x) => [x.id, x])); emit(); }, () => undefined);
  return () => { a(); b(); p(); };
};

export const subscribeDrivers = (cb: (data: Driver[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<Driver>(COLLECTIONS.DRIVERS, cb, onError);

export const subscribeVehicles = (cb: (data: Vehicle[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<Vehicle>(COLLECTIONS.VEHICLES, cb, onError);

export const subscribeVehicleCategories = (cb: (data: VehicleCategory[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<VehicleCategory>(COLLECTIONS.VEHICLE_CATEGORIES, cb, onError);

export const subscribeVendors = (cb: (data: Vendor[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<Vendor>(COLLECTIONS.VENDORS, cb, onError);

export const subscribeCustomers = (cb: (data: Customer[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<Customer>(COLLECTIONS.CUSTOMERS, cb, onError);

export const subscribeMarketplace = (cb: (data: MarketplaceTrip[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<MarketplaceTrip>(COLLECTIONS.MARKETPLACE, cb, onError);

export const subscribePayments = (cb: (data: PaymentTransaction[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<PaymentTransaction>(COLLECTIONS.PAYMENTS, cb, onError);

export const subscribeInvoices = (cb: (data: Invoice[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<Invoice>(COLLECTIONS.INVOICES, cb, onError);

export const subscribeServices = (cb: (data: TravelService[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<TravelService>(COLLECTIONS.SERVICES, cb, onError);

export const subscribeTourPackages = (cb: (data: TourPackage[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<TourPackage>(COLLECTIONS.TOUR_PACKAGES, cb, onError);

export const subscribeLocations = (cb: (data: MasterLocation[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<MasterLocation>(COLLECTIONS.LOCATIONS, cb, onError);

export const subscribeFareRules = (cb: (data: FareRule[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<FareRule>(COLLECTIONS.FARE_RULES, cb, onError);

export const subscribeCoupons = (cb: (data: MasterCoupon[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<MasterCoupon>(COLLECTIONS.COUPONS, cb, onError);

export const subscribeReviews = (cb: (data: CustomerReview[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<CustomerReview>(COLLECTIONS.REVIEWS, cb, onError);

export const subscribePenalties = (cb: (data: PenaltyRecord[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<PenaltyRecord>(COLLECTIONS.PENALTIES, cb, onError);

import {
  subscribeAdminNotifications,
  subscribeOutboundNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  dismissAdminNotification,
  sendAdminNotification,
} from "./adminNotificationService";

export {
  subscribeAdminNotifications,
  subscribeOutboundNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  dismissAdminNotification,
  sendAdminNotification,
};

export const subscribeNotifications = (
  cb: (data: NotificationRecord[]) => void,
) => subscribeAdminNotifications(cb);

/**
 * Mutations
 */
export async function updateFirestoreDocument(
  collectionName: string,
  docId: string,
  data: any,
) {
  try {
    const docRef = doc(db, collectionName, docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
    await publishChangedContent(collectionName,docId);
    return true;
  } catch (error) {
    console.warn(`Update ${collectionName}/${docId} error:`, error);
    return false;
  }
}

export async function setFirestoreDocument(
  collectionName: string,
  docId: string,
  data: any,
) {
  try {
    const docRef = doc(db, collectionName, docId);
    await setDoc(
      docRef,
      { ...data, updatedAt: serverTimestamp() },
      { merge: true },
    );
    await publishChangedContent(collectionName,docId);
    return true;
  } catch (error) {
    console.warn(`Set ${collectionName}/${docId} error:`, error);
    return false;
  }
}

export async function deleteFirestoreDocument(
  collectionName: string,
  docId: string,
) {
  try {
    const docRef = doc(db, collectionName, docId);
    await deleteDoc(docRef);
    return true;
  } catch (error) {
    console.warn(`Delete ${collectionName}/${docId} error:`, error);
    return false;
  }
}

// Add document with auto-generated ID
export async function addFirestoreDocument(collectionName: string, data: any) {
  try {
    const colRef = collection(db, collectionName);
    const docRef = await addDoc(colRef, {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    console.warn(`Add ${collectionName} error:`, error);
    return null;
  }
}

// Subscribe to settings
export function subscribeSettings(cb: (data: any) => void) {
  try {
    let config:Record<string,unknown>={},operations:Record<string,unknown>={};
    const emit=()=>cb({...config,...(typeof operations.bookingMaxAdvanceDays==='number'?{advanceBookingLimit:String(operations.bookingMaxAdvanceDays)}:{}),...(typeof operations.bookingMinLeadMinutes==='number'?{minBookingNotice:String(operations.bookingMinLeadMinutes/60)}:{})});
    const a=onSnapshot(doc(db,'settings','config'),s=>{config=s.data()??{};emit();},()=>cb({}));
    const b=onSnapshot(doc(db,'settings','operations'),s=>{operations=s.data()??{};emit();});
    return ()=>{a();b();};
  } catch {
    cb({});
    return () => {};
  }
}

// Save settings
export async function saveSettings(data: any) {
  try {
    const operations:Record<string,unknown>={};
    for(const [field,target,factor,min,max] of [['advanceBookingLimit','bookingMaxAdvanceDays',1,1,365],['minBookingNotice','bookingMinLeadMinutes',60,0,168]] as const) {
      if(data[field]!==undefined&&String(data[field]).trim()!=='') {
        const value=Number(data[field]);
        if(!Number.isFinite(value)||value<min||value>max)return false;
        operations[target]=Math.round(value*factor);
      }
    }
    const batch=writeBatch(db);
    batch.set(doc(db,'settings','config'),{...data,updatedAt:serverTimestamp()},{merge:true});
    if(Object.keys(operations).length)batch.set(doc(db,'settings','operations'),{...operations,updatedAt:serverTimestamp()},{merge:true});
    await batch.commit();
    return true;
  } catch (error) {
    console.warn("Save settings error:", error);
    return false;
  }
}

export const subscribePayoutRequests = (cb: (data: any[]) => void, onError?: (message: string) => void) =>
  subscribeToCollection<any>("payout_requests", cb, onError);

/** Live single document (settings, a verification record…). Errors go to `onError`; a missing document is `null`. */
export function subscribeToDocument<T>(path: string, cb: (data: T | null) => void, onError?: (message: string) => void) {
  const parts = path.split("/");
  if (redactedBookings && parts.length === 2 && parts[0] === COLLECTIONS.BOOKINGS) {
    return pollStaffBookings<T>(parts[1], (b) => cb((b as T | null) ?? null), onError);
  }
  if (redactedBookings && (parts[0] === "marketplace_trips" || parts[0] === PRICING_PRIVATE)) {
    cb(null);
    return () => {};
  }
  try {
    return onSnapshot(
      doc(db, path),
      (snap) => cb(snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null),
      (err) => {
        console.warn(`Firestore document listener error on ${path}:`, err);
        if (onError) onError(describeDataError(err));
        else cb(null);
      },
    );
  } catch (err) {
    if (onError) onError(describeDataError(err));
    return () => {};
  }
}

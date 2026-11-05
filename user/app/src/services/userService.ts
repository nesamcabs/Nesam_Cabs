// Customer profile, saved places, notifications and support tickets.
// Copied from user/web/src/services/userFirestoreService.ts and adapted:
// typed support tickets (Web used `any`), batched "mark all read" limited to
// the fields firestore.rules allow, and the customer's real name on tickets
// (Web wrote the literal 'Customer').

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import type { LocationItem, NotificationItem, SupportTicket, UserProfile } from '../types';
import { formatDateTime, num, str, timeAgo, toDate } from '../utils/format';
import { withTimeout } from '../utils/retry';
import { callFunction } from './callables';

// Firestore queues and retries writes itself; re-issuing one after a timeout
// could turn a create into a (rule-rejected) update. So: timeout only.
const WRITE_TIMEOUT_MS = 15000;

export const CUSTOMERS_COLLECTION = 'customers';
export const SAVED_PLACES_COLLECTION = 'saved_places';
export const NOTIFICATIONS_COLLECTION = 'notifications';
export const SUPPORT_COLLECTION = 'support_tickets';

// ── Profile ─────────────────────────────────────────────────────────────────

export function mapProfile(uid: string, d: DocumentData): UserProfile {
  return {
    uid,
    name: str(d.name),
    phone: str(d.phone),
    email: str(d.email),
    photoUrl: str(d.photoUrl),
    walletBalance: num(d.walletBalance),
    emergencyContact: str(d.emergencyContact),
    language: str(d.language) || 'English',
    status: str(d.status),
  };
}

/**
 * Live profile for the signed-in customer. Emits `null` when no profile doc
 * exists yet (new user → registration), and calls `onError` if it can't be
 * read so the UI can offer a retry instead of mistaking it for a new user.
 */
export function subscribeToCustomerProfile(
  uid: string,
  cb: (profile: UserProfile | null) => void,
  onError: (e: unknown) => void,
): () => void {
  return onSnapshot(
    doc(db, CUSTOMERS_COLLECTION, uid),
    (snap) => {
      // A cache miss while offline looks like "no document" — wait for the
      // server rather than routing an existing customer to sign-up.
      if (!snap.exists() && snap.metadata.fromCache) return;
      cb(snap.exists() ? mapProfile(uid, snap.data()) : null);
    },
    onError,
  );
}

/** Signup collects the name and an optional e-mail (spec page 20); photo and emergency contact are added later in the profile. */
export interface NewCustomerProfile {
  name: string;
  email: string;
}

/** The customers/{uid} document firestore.rules accepts from a new customer. */
export function buildNewCustomerDoc(uid: string, phoneE164: string, p: NewCustomerProfile) {
  return {
    uid,
    name: p.name.trim(),
    phone: phoneE164 ? `+91 ${phoneE164.slice(-10)}` : '',
    phoneE164,
    email: p.email.trim().toLowerCase(),
    photoUrl: '',
    walletBalance: 0,
    emergencyContact: '',
    language: 'English',
    role: 'customer',
    status: 'Approved',
    createdAt: serverTimestamp(),
  };
}

export async function registerCustomerProfile(p: NewCustomerProfile): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  await withTimeout(setDoc(doc(db, CUSTOMERS_COLLECTION, user.uid), buildNewCustomerDoc(user.uid, user.phoneNumber || '', p)), WRITE_TIMEOUT_MS);
}

export type EditableProfile = Partial<Pick<UserProfile, 'name' | 'email' | 'photoUrl' | 'emergencyContact' | 'language'>>;

/** Only the fields firestore.rules lets a customer change. */
export async function updateCustomerProfile(uid: string, data: EditableProfile): Promise<void> {
  const allowed: Record<string, string> = {};
  for (const k of ['name', 'email', 'photoUrl', 'emergencyContact', 'language'] as const) {
    const v = data[k];
    if (v !== undefined) allowed[k] = v.trim();
  }
  await withTimeout(updateDoc(doc(db, CUSTOMERS_COLLECTION, uid), { ...allowed, updatedAt: serverTimestamp() }), WRITE_TIMEOUT_MS);
}

// ── Saved places ────────────────────────────────────────────────────────────

export function subscribeToSavedPlaces(ownerId: string, cb: (places: LocationItem[]) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    query(collection(db, SAVED_PLACES_COLLECTION), where('ownerId', '==', ownerId)),
    (snap) =>
      cb(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            name: str(x.name),
            address: str(x.address),
            type: (['home', 'work', 'favorite', 'other'].includes(x.type) ? x.type : 'favorite') as LocationItem['type'],
            lat: typeof x.lat === 'number' ? x.lat : undefined,
            lng: typeof x.lng === 'number' ? x.lng : undefined,
          };
        }),
      ),
    (err) => {
      cb([]);
      onError?.(err);
    },
  );
}

export async function savePlace(place: LocationItem, ownerId: string): Promise<void> {
  const id = place.id.startsWith('place-') ? place.id : `place-${ownerId.slice(0, 6)}-${Date.now()}`;
  await withTimeout(
    setDoc(
      doc(db, SAVED_PLACES_COLLECTION, id),
      {
        name: place.name.trim(),
        address: place.address.trim(),
        type: place.type,
        ...(place.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : {}),
        ownerId,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
    WRITE_TIMEOUT_MS,
  );
}

export async function deleteSavedPlace(placeId: string): Promise<void> {
  await withTimeout(deleteDoc(doc(db, SAVED_PLACES_COLLECTION, placeId)), WRITE_TIMEOUT_MS);
}

// ── Notifications ───────────────────────────────────────────────────────────

const NOTIF_CATEGORIES: NotificationItem['category'][] = ['Bookings', 'Driver', 'Payments', 'Offers', 'Support', 'System'];

export function subscribeToUserNotifications(recipientId: string, cb: (notifs: NotificationItem[]) => void): () => void {
  return onSnapshot(
    query(collection(db, NOTIFICATIONS_COLLECTION), where('recipientId', '==', recipientId)),
    (snap) => {
      const items = snap.docs.map((d) => {
        const x = d.data();
        const created = toDate(x.createdAt);
        return {
          item: {
            id: d.id,
            title: str(x.title) || 'Notification',
            message: str(x.message || x.body),
            time: created ? timeAgo(created) : str(x.time) || '',
            category: NOTIF_CATEGORIES.includes(x.category) ? x.category : 'System',
            read: Boolean(x.read),
          } as NotificationItem,
          at: created?.getTime() ?? 0,
        };
      });
      items.sort((a, b) => b.at - a.at);
      cb(items.map((i) => i.item));
    },
    () => cb([]),
  );
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, NOTIFICATIONS_COLLECTION, id), { read: true, readAt: serverTimestamp() });
}

export async function markAllNotificationsRead(ids: string[]): Promise<void> {
  // Firestore batches are capped at 500 writes.
  for (let i = 0; i < ids.length; i += 450) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + 450)) batch.update(doc(db, NOTIFICATIONS_COLLECTION, id), { read: true, readAt: serverTimestamp() });
    await withTimeout(batch.commit(), WRITE_TIMEOUT_MS);
  }
}

// ── Support ─────────────────────────────────────────────────────────────────

export const SUPPORT_CATEGORIES = [
  'Payment / Refund Issue',
  'Driver Behavior / Route Issue',
  'Vehicle Condition Complaint',
  'Billing / Toll Discrepancy',
  'App / Technical Bug',
  'Lost Item',
  'Other',
];

export interface NewSupportTicket {
  category: string;
  bookingId: string;
  description: string;
}

export async function submitSupportTicket(profile: UserProfile, t: NewSupportTicket, brand = 'nesam'): Promise<void> {
  try {
    await callFunction('submitSupportRequest', {
      brand,
      category: t.category,
      bookingId: t.bookingId.trim().toUpperCase(),
      message: t.description.trim().slice(0, 2000),
      name: profile.name,
      phone: profile.phone,
      email: profile.email || '',
      source: 'customer-app',
    });
    return;
  } catch (err) {
    console.warn('[support] server submitSupportRequest error, using direct doc write', err);
  }
  await withTimeout(
    addDoc(collection(db, SUPPORT_COLLECTION), {
      customerId: profile.uid,
      customerName: profile.name,
      customerPhone: profile.phone,
      category: t.category,
      bookingId: t.bookingId.trim().toUpperCase(),
      description: t.description.trim().slice(0, 2000),
      source: 'customer-app',
      status: 'Open',
      createdAt: serverTimestamp(),
    }),
    WRITE_TIMEOUT_MS,
  );
}

const TICKET_STATUSES: SupportTicket['status'][] = ['Open', 'In Progress', 'Resolved', 'Closed'];

export function subscribeToSupportTickets(customerId: string, cb: (tickets: SupportTicket[]) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    query(collection(db, SUPPORT_COLLECTION), where('customerId', '==', customerId)),
    (snap) => {
      const rows = snap.docs.map((d) => {
        const r = d.data();
        const created = toDate(r.createdAt);
        return {
          ticket: {
            id: d.id,
            category: str(r.category),
            bookingId: str(r.bookingId),
            description: str(r.description),
            status: TICKET_STATUSES.includes(r.status) ? r.status : 'Open',
            createdAt: created ? formatDateTime(created) : '',
          } as SupportTicket,
          at: created?.getTime() ?? 0,
        };
      });
      rows.sort((a, b) => b.at - a.at);
      cb(rows.map((r) => r.ticket));
    },
    (err) => {
      cb([]);
      onError?.(err);
    },
  );
}

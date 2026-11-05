/**
 * Office phone enquiries & quotes (Master Admin → Bookings → Enquiries & quotes). A quote keeps the
 * route, the estimate the server calculated and who follows it up. It never becomes a booking by
 * itself: "Convert to booking" opens the New booking flow, which creates the booking on the server.
 */
import { collection, doc, onSnapshot, runTransaction, serverTimestamp, Timestamp, updateDoc, arrayUnion } from "firebase/firestore";
import { auth, db } from "./firebase";
import { describeDataError } from "./adminFirestoreService";
import { callFunction } from "./callables";

export const ENQUIRY_STATUSES = ["New", "Call back", "No response", "Draft", "Quote sent", "Customer accepted", "Converted", "Closed", "Expired"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export interface EnquiryBreakupLine { label: string; amount: number }

export interface EnquiryStop {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export const isMulticityEnquiry = (enquiry: Enquiry) => enquiry.serviceId === 'multicity'
  || enquiry.service === 'Multicity' || enquiry.tripType === 'Multicity' || !!enquiry.stops?.length;
export const MULTICITY_CONVERSION_MESSAGE = 'Use Convert to booking on the enquiry details after saving and reviewing its Multicity quote. The standard pickup/drop form cannot preserve this tour.';

export interface Enquiry {
  id: string;
  code: string;
  status: EnquiryStatus;
  brand?: string;
  pickup: string;
  drop: string;
  stops?: EnquiryStop[];
  itinerary?: EnquiryStop[];
  tripEndAt?: Timestamp | null;
  submissionId?: string;
  customerId?: string;
  customerAcceptedEstimate?: number;
  pickupPoint?: { id?: string; lat: number; lng: number; name?: string; address: string; type?: string } | null;
  dropPoint?: { lat: number; lng: number; name?: string; address: string; type?: string } | null;
  pickupAt?: Timestamp | null;
  serviceId?: string;
  service?: string;
  tripType?: string;
  categoryId?: string | null;
  vehicle?: string;
  includedKm?: number;
  extraKmRate?: number;
  estimate?: number;
  breakup?: EnquiryBreakupLine[];
  gstRate?: number;
  /** Multicity quotes: whether the GST policy had the fare already include GST. */
  gstIncluded?: boolean;
  payout?: number | null;
  customerName?: string;
  phone?: string;
  whatsapp?: string;
  followUpAt?: Timestamp | null;
  note?: string;
  source?: string;
  validUntil?: Timestamp | null;
  sentAt?: Timestamp | null;
  acceptedAt?: Timestamp | null;
  handler?: { uid: string; name: string } | null;
  nextAction?: string;
  due?: Timestamp | null;
  handoverNote?: string;
  convertedBookingId?: string;
  quoteRevision?: string;
  history?: { status: string; note?: string; byName?: string; at?: Timestamp }[];
  createdAt?: Timestamp;
  createdBy: string;
  createdByName?: string;
}

const COL = "enquiries";

export function subscribeEnquiries(cb: (rows: Enquiry[]) => void, onError?: (m: string) => void) {
  return onSnapshot(
    collection(db, COL),
    (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<Enquiry, "id">), id: d.id }))),
    (e) => (onError ? onError(describeDataError(e)) : cb([])),
  );
}

/** An enquiry past its validity that was never converted or closed reads as Expired. */
export function effectiveStatus(e: Enquiry, now = Date.now()): EnquiryStatus {
  if (["Converted", "Closed", "Expired"].includes(e.status)) return e.status;
  const until = e.validUntil?.toMillis?.();
  return until && until < now ? "Expired" : e.status;
}

const me = () => ({ uid: auth.currentUser?.uid ?? "", name: auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Staff" });

export type NewEnquiry = Omit<Enquiry, "id" | "code" | "createdAt" | "createdBy" | "createdByName" | "history" | "status"> & { status?: EnquiryStatus };

/** Saves a quote with the next free NSM-QT-###### code. */
export async function saveEnquiry(e: NewEnquiry): Promise<Enquiry> {
  const who = me();
  for (let attempt = 0; attempt < 5; attempt++) {
    const n = String(Math.floor(Date.now() / 1000) % 1000000 + attempt).padStart(6, "0");
    const code = `NSM-QT-${n}`;
    const ref = doc(db, COL, code);
    const status: EnquiryStatus = e.status ?? (e.phone ? "New" : "Draft");
    const record = {
      ...Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)),
      code, status, createdBy: who.uid, createdByName: who.name, createdAt: serverTimestamp(),
      history: [{ status, note: e.note || "", byName: who.name, at: Timestamp.now() }],
    };
    const ok = await runTransaction(db, async (tx) => {
      if ((await tx.get(ref)).exists()) return false;
      tx.set(ref, record);
      return true;
    });
    if (ok) return { ...(record as unknown as Enquiry), id: code };
  }
  throw new Error("The enquiry could not be saved. Please try again.");
}

export async function updateEnquiryStatus(id: string, status: EnquiryStatus, note: string) {
  const who = me();
  await updateDoc(doc(db, COL, id), { status, ...(note ? { note } : {}), history: arrayUnion({ status, note, byName: who.name, at: Timestamp.now() }) });
}

export async function markEnquirySent(id: string) {
  const who = me();
  const ref = doc(db, COL, id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref), row = snap.data() as Enquiry | undefined;
    if (!row || ['Converted', 'Closed', 'Expired'].includes(effectiveStatus(row))) throw new Error('This enquiry is closed or expired. Refresh its quote before sending.');
    if (!(Number(row.estimate) > 0) || (isMulticityEnquiry(row) && !row.quoteRevision)) throw new Error('Save a priced quote before marking it as sent.');
    tx.update(ref, { status: "Quote sent", sentAt: Timestamp.now(), history: arrayUnion({ status: "Quote sent", byName: who.name, at: Timestamp.now() }) });
  });
}

export async function assignEnquiryHandler(id: string, patch: { handler: { uid: string; name: string } | null; nextAction: string; due: Date | null; handoverNote: string }) {
  await updateDoc(doc(db, COL, id), { handler: patch.handler, nextAction: patch.nextAction, due: patch.due ? Timestamp.fromDate(patch.due) : null, handoverNote: patch.handoverNote });
}

export async function markEnquiryConverted(id: string, bookingId: string) {
  const who = me();
  await updateDoc(doc(db, COL, id), { status: "Converted", convertedBookingId: bookingId, history: arrayUnion({ status: "Converted", note: bookingId, byName: who.name, at: Timestamp.now() }) });
}

export const currentStaff = me;

export interface MulticityQuoteResult {
  estimate: number; breakup: EnquiryBreakupLine[]; gstRate: number; gstIncluded: boolean; includedKm: number; extraKmRate: number;
  days: number; totalKm: number; categoryId: string; vehicle: string; payout: number | null; saved?: boolean; validUntil?: string;
}

/** Prices a Multicity enquiry on the server from the brand's saved Multicity rates; `save` writes it as the customer's quote. */
export const priceMulticityEnquiry = (enquiryId: string, categoryId: string, save: boolean, validDays = 7, pickupLocationId = "") =>
  callFunction<unknown, MulticityQuoteResult>("priceMulticityEnquiry", { enquiryId, categoryId, save, validDays, pickupLocationId });

export const convertMulticityEnquiry = (input: { enquiryId: string; expectedRevision: string; customerName: string; phone: string; paymentMethod: 'Cash' | 'UPI'; customerAccepted: boolean; acceptanceReference: string }) =>
  callFunction<typeof input, { id: string; bookingId: string }>('convertMulticityEnquiry', input);

// Driver ratings (written by the server when a customer rates a trip; see functions/src/ratings.ts).
// Reading is live; the only change the office makes is the follow-up on a low rating, which goes through the server so
// it is audited.
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "./firebase";
import { callFunction, ActionError } from "./callables";
import { describeDataError } from "./adminFirestoreService";
import { FOLLOW_UPS, type DriverRating, type FollowUp } from "../domain/driverRatings";

export { ActionError as DriverRatingActionError };

export const DRIVER_RATINGS = "driverRatings";
/** The newest records kept in memory; older ratings still count in each driver's profile average. */
export const MAX_RECORDS = 2000;

const str = (v: unknown, max = 1200) => (typeof v === "string" ? v.slice(0, max) : "");

/** A stored record, tolerant of older or partial documents. */
export function mapDriverRating(id: string, d: Record<string, unknown>): DriverRating {
  const stars = Number(d.stars);
  const followUp = (FOLLOW_UPS as readonly string[]).includes(String(d.followUp)) ? (d.followUp as FollowUp) : "None";
  return {
    id,
    source: d.source === "local_taxi" ? "local_taxi" : "booking",
    bookingId: str(d.bookingId, 128),
    rideId: str(d.rideId, 128),
    tripCode: str(d.tripCode, 60),
    driverId: str(d.driverId, 128),
    driverName: str(d.driverName, 120),
    vendorId: str(d.vendorId, 128),
    vehicleNumber: str(d.vehicleNumber, 30),
    customerId: str(d.customerId, 128),
    customerName: str(d.customerName, 120),
    customerPhone: str(d.customerPhone, 30),
    serviceName: str(d.serviceName, 120),
    stars: Number.isFinite(stars) ? Math.min(5, Math.max(1, Math.round(stars))) : 0,
    low: d.low === true,
    tags: Array.isArray(d.tags) ? d.tags.map((t) => str(t, 60)).filter(Boolean) : [],
    reason: str(d.reason, 80),
    feedback: str(d.feedback),
    improvements: str(d.improvements),
    comment: str(d.comment),
    followUp,
    adminNote: str(d.adminNote, 600),
    handledByName: str(d.handledByName, 120) || undefined,
    handledAt: d.handledAt,
    createdAt: d.createdAt,
  };
}

export function subscribeDriverRatings(cb: (rows: DriverRating[]) => void, onError?: (message: string) => void): () => void {
  try {
    return onSnapshot(
      query(collection(db, DRIVER_RATINGS), orderBy("createdAt", "desc"), limit(MAX_RECORDS)),
      (snap) => cb(snap.docs.map((d) => mapDriverRating(d.id, d.data())).filter((r) => r.stars > 0)),
      (err) => onError?.(describeDataError(err)),
    );
  } catch (err) {
    onError?.(describeDataError(err));
    return () => {};
  }
}

/** Moves a low rating through the office's follow-up; resolving or dismissing needs a short note. */
export async function setRatingFollowUp(ratingId: string, followUp: Exclude<FollowUp, "None">, note: string): Promise<void> {
  await callFunction<{ ratingId: string; followUp: string; note: string }, { ok: boolean }>("reviewDriverRating", { ratingId, followUp, note: note.trim() }, 30000);
}

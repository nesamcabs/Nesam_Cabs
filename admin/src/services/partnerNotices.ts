/**
 * Notices to one driver or vendor about a staff decision (approved, rejected, changes requested, suspended…).
 * The console files a request; the server (functions/src/notificationTriggers.ts) stores it in that partner's own
 * inbox — driver_notifications or vendor_notifications, never a rider's or the office's — pushes it to that partner's
 * app and logs the delivery. firestore.rules accepts a request only from active staff, signed with their own uid.
 */
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

export type PartnerAudience = "driver" | "vendor";

export interface PartnerNotice {
  title: string;
  message: string;
  category?: "approvals" | "general";
  severity?: "info" | "success" | "warning" | "critical";
}

/** Files the notice; resolves false (never throws) when it could not be filed, so the decision itself is never undone. */
export async function notifyPartner(audience: PartnerAudience, recipientId: string, notice: PartnerNotice): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  const title = notice.title.trim().slice(0, 140);
  if (!uid || !recipientId || !title) return false;
  try {
    await addDoc(collection(db, "partner_notice_requests"), {
      audience,
      recipientId,
      title,
      message: notice.message.trim().slice(0, 500),
      category: notice.category ?? "approvals",
      severity: notice.severity ?? "info",
      sentBy: uid,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.warn(`Partner notice to ${audience} ${recipientId} was not filed:`, err);
    return false;
  }
}

/**
 * Communication › Messages & notices (notice_campaigns). The office saves a Draft with the exact
 * recipient list (duplicate contacts merged), then the server sends it now or at the scheduled
 * time (functions/src/noticeCampaigns.ts) and logs every attempt in notification_deliveries.
 */
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "./firebase";
import { callFunction } from "./callables";

export const MESSAGE_TYPES = ["Festival wishes", "General service notice", "Personal warning"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];
export const GROUPS = ["Customers", "Driver Partners", "Vendors", "Vendor Drivers"] as const;
export type Group = (typeof GROUPS)[number];
export type Target = "Everyone" | "Groups" | "Individuals";
export type CampaignStatus = "Draft" | "Scheduled" | "Sending" | "Sent" | "Cancelled";
export const EXTRA_CHANNELS = [["whatsapp", "WhatsApp"], ["sms", "SMS"], ["email", "Email"]] as const;

export interface Template { id: string; name: string; kind: MessageType; title: string; body: string }
/** Reference templates (Tamil festival wishes, English notices). */
export const TEMPLATES: Template[] = [
  { id: "pongal", name: "Pongal wishes", kind: "Festival wishes", title: "இனிய பொங்கல் நல்வாழ்த்துகள்", body: "உங்களுக்கும் உங்கள் குடும்பத்தினருக்கும் NESAM சார்பாக இனிய பொங்கல் நல்வாழ்த்துகள்! பாதுகாப்பான பயணங்களும் வளமான ஆண்டும் அமையட்டும்." },
  { id: "deepavali", name: "Deepavali wishes", kind: "Festival wishes", title: "இனிய தீபாவளி நல்வாழ்த்துகள்", body: "உங்களுக்கும் உங்கள் குடும்பத்தினருக்கும் இனிய தீபாவளி நல்வாழ்த்துகள். மகிழ்ச்சியும் வளமும் நிறைந்த பண்டிகையாக அமைய NESAM வாழ்த்துகிறது." },
  { id: "newyear", name: "New Year wishes", kind: "Festival wishes", title: "Happy New Year from NESAM", body: "Wishing you and your family a happy, healthy and prosperous New Year. Thank you for being part of the NESAM journey." },
  { id: "documents", name: "Document renewal reminder", kind: "General service notice", title: "Please renew your documents", body: "Please check the expiry dates in your profile and upload the renewal documents. Contact NESAM office if you need assistance." },
  { id: "warning", name: "Service warning", kind: "Personal warning", title: "Service notice from NESAM", body: "Please review the office remarks for the referenced duty. Contact the office for clarification." },
];

export interface Account { type: "customer" | "driver" | "vendor"; id: string }
export interface Recipient { key: string; name: string; phone: string; email: string; roles: string[]; ids: string[]; accounts: Account[] }

export interface Campaign {
  id: string;
  code: string;
  kind: MessageType;
  language: "Tamil" | "English";
  template: string;
  target: Target;
  groups: Group[];
  onlyActive: boolean;
  title: string;
  body: string;
  trip: string;
  requiresAck: boolean;
  image: { name: string; url: string; path: string } | null;
  channels: string[];
  push: boolean;
  recipients: Recipient[];
  status: CampaignStatus;
  sendAt?: Timestamp;
  sentAt?: Timestamp;
  counts?: { sent: number; failed: number; skipped: number };
  createdBy: string;
  createdByName: string;
  createdAt?: Timestamp;
  cancelReason?: string;
}

export type CampaignInput = Omit<Campaign, "id" | "code" | "status" | "createdBy" | "createdByName" | "createdAt" | "sendAt" | "sentAt" | "counts">;

const who = () => auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Staff";

export function subscribeCampaigns(cb: (rows: Campaign[]) => void, onError?: (m: string) => void) {
  return onSnapshot(query(collection(db, "notice_campaigns"), orderBy("createdAt", "desc"), limit(200)),
    (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<Campaign, "id">), id: d.id }))),
    (e) => (onError ? onError(e.message) : cb([])));
}

/** Read / acknowledged counts from the in-app records of a sent campaign. */
export function subscribeCampaignReads(id: string, cb: (c: { read: number; ack: number; byRecipient: Map<string, "Read" | "Acknowledged" | "Delivered"> }) => void) {
  return onSnapshot(query(collection(db, "notifications"), where("campaignId", "==", id), limit(4000)), (s) => {
    const byRecipient = new Map<string, "Read" | "Acknowledged" | "Delivered">();
    let read = 0, ack = 0;
    s.docs.forEach((d) => {
      const n = d.data();
      const st = n.acknowledgedAt ? "Acknowledged" : n.read ? "Read" : "Delivered";
      if (n.acknowledgedAt) ack++;
      if (n.read) read++;
      byRecipient.set(String(n.recipientId), st);
    });
    cb({ read, ack, byRecipient });
  }, () => cb({ read: 0, ack: 0, byRecipient: new Map() }));
}

export async function uploadGreeting(file: File): Promise<{ name: string; url: string; path: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Upload a JPG, PNG or WebP image.");
  if (file.size > 2 * 1024 * 1024) throw new Error("The greeting image must be 2 MB or smaller.");
  const path = `notices/${auth.currentUser?.uid ?? "staff"}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_").slice(-60)}`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return { name: file.name, url: await getDownloadURL(r), path };
}

export async function saveDraft(input: CampaignInput, id?: string): Promise<string> {
  const data = { ...input, recipients: input.recipients.slice(0, 2000) };
  if (id) {
    await updateDoc(doc(db, "notice_campaigns", id), { ...data, status: "Draft", updatedAt: serverTimestamp() });
    return id;
  }
  const r = await addDoc(collection(db, "notice_campaigns"), {
    ...data, status: "Draft", code: `NSM-MSG-${Date.now().toString().slice(-6)}`,
    createdBy: auth.currentUser?.uid ?? "", createdByName: who(), createdAt: serverTimestamp(),
  });
  return r.id;
}

export async function cancelCampaign(c: Campaign, reason: string) {
  await updateDoc(doc(db, "notice_campaigns", c.id), { status: "Cancelled", cancelledAt: serverTimestamp(), cancelledBy: auth.currentUser?.uid ?? "", cancelledByName: who(), cancelReason: reason });
}

export const sendCampaign = (id: string, mode: "now" | "schedule", sendAt?: string) =>
  callFunction<unknown, { status: string; recipients?: number; failed?: number }>("sendNoticeCampaign", { campaignId: id, mode, sendAt }, 540000);

export const retryDeliveries = (p: { campaignId?: string; deliveryId?: string }) =>
  callFunction<unknown, { retried: number; recovered: number }>("retryFailedDeliveries", p, 300000);

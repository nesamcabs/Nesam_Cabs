// Emails to the NESAM office inbox (OFFICE_EMAIL) for things staff must act on: a new booking request, a customer support
// request or contact form, a partner request (cancellation, bank change, document renewal) and a new vendor registration.
// They complement the in-app admin notifications; a failed or unconfigured email never blocks the action that caused it.
import type { DocumentData } from 'firebase-admin/firestore';
import { BRANDS, brandOf, renderEmail, sendOfficeMail, type BrandProfile, type MailResult } from './mailer';
import { pickupWhen } from './customerComms';

const adminUrl = () => (process.env.ADMIN_PORTAL_URL ?? '').trim().replace(/\/+$/, '');
const rupees = (n: unknown) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

async function office(brand: BrandProfile, subject: string, title: string, paragraphs: string[], rows: [string, string][], replyTo?: string): Promise<MailResult> {
  const url = adminUrl();
  const mail = renderEmail(brand, { title, paragraphs, rows, ...(url ? { action: { label: 'Open the admin panel', url } } : {}), note: 'Sent automatically by the NESAM platform.' });
  const r = await sendOfficeMail({ subject, text: mail.text, html: mail.html, brand, ...(replyTo ? { replyTo } : {}) });
  if (!r.ok && r.status !== 'not_configured') console.warn('[mail] office alert not sent:', subject, r.error);
  return r;
}

/** A customer (website / app) or the office created a booking that needs review. */
export function mailOfficeNewBooking(b: DocumentData): Promise<MailResult> {
  const brand = brandOf(b);
  return office(brand, `New ${brand.name} booking ${b.bookingId ?? ''} to review`, 'New booking to review', [`A new booking came in through ${brand.name} and is waiting for approval.`], [
    ['Booking ID', String(b.bookingId ?? '')], ['Customer', String(b.customer ?? '')], ['Pickup', String(b.pickup ?? '')], ['Drop', String(b.drop ?? '')],
    ['Pickup time', pickupWhen(b)], ['Trip type', String(b.tripType ?? '')], ['Vehicle', String(b.vehicleCategory ?? '')], ['Fare', rupees(b.fare)],
    ['Payment', String(b.paymentMethod ?? '')], ['Notes', String(b.notes ?? '')],
  ]);
}

export interface SupportMail {
  ticketId: string;
  brand: BrandProfile;
  name: string;
  email: string;
  phone: string;
  category: string;
  bookingId: string;
  message: string;
  signedIn: boolean;
}

/** A support request or contact form. Replies from the office go straight to the customer. */
export function mailOfficeSupport(t: SupportMail): Promise<MailResult> {
  return office(t.brand, `[${t.brand.name}] ${t.category} — ${t.name || 'Website visitor'}`, 'New support request', [t.message], [
    ['Reference', t.ticketId], ['Brand', t.brand.name], ['Topic', t.category], ['Name', t.name], ['Email', t.email], ['Phone', t.phone],
    ['Booking ID', t.bookingId], ['Signed in', t.signedIn ? 'Yes (customer account)' : 'No (website visitor)'],
  ], t.email || undefined);
}

/** A partner asked the office for something (cancellation, bank change, document renewal, deposit refund). */
export function mailOfficePartnerRequest(title: string, rows: [string, string][]): Promise<MailResult> {
  return office(BRANDS.nesam, `Partner request: ${title}`, `Partner request: ${title}`, ['A partner sent a request that needs an office decision under Partner Requests.'], rows);
}

/** A new vendor asked to join. */
export function mailOfficeVendorRequest(rows: [string, string][]): Promise<MailResult> {
  return office(BRANDS.nesam, 'New vendor registration request', 'New vendor registration request', ['A fleet partner asked to join NESAM. Review it under Vendors.'], rows);
}

// Customer contact privacy (Tariff & Operations v2 p.16).
//
//   • The raw mobile number, WhatsApp number and email live ONLY in booking_contacts/{bookingId},
//     readable by staff and the booking's own customer. The booking document that vendors and
//     drivers can read carries `phoneMasked` and the customer's first name, never a raw value.
//   • Vendors always see a masked number — including documents, exports and the "eye" control.
//   • The assigned driver gets the number from getCustomerContact, from 8 hours before pickup, for
//     the current assignment only (a reassigned driver is refused at once).
//   • Every reveal and every denied attempt is logged without the number in the log.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { DocumentData, FieldValue, Timestamp, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { optionalEmail, indianPhone } from './bookingBuild';
import { pickupInstant } from './domain/time';
import { approved, requireAdmin, requirePermission, text, requireAction } from './shared';
import { matrixFlag } from './permissions';

export const REVEAL_WINDOW_MS = 8 * 3600000;

/** "+91 98••• ••210" — enough to recognise, not enough to dial. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  if (d.length < 8) return '';
  const cc = d.length > 10 ? `+${d.slice(0, d.length - 10)} ` : '';
  const n = d.slice(-10);
  return `${cc}${n.slice(0, 2)}••• ••${n.slice(-3)}`;
}

export interface StoredContact { customerId: string; name: string; phone: string; whatsapp: string; email: string }

/** The contact document's fields written alongside a new booking (inside the creating transaction). */
export function createContactInTx(tx: Transaction, bookingId: string, c: { customerId: string; name: string; phone: string; whatsapp?: unknown; email: string }) {
  const wa = c.whatsapp && typeof c.whatsapp === 'object' ? (c.whatsapp as { e164?: string }).e164 ?? '' : '';
  tx.create(db.doc(`booking_contacts/${bookingId}`), {
    customerId: c.customerId, name: c.name, phone: c.phone, whatsapp: wa || c.phone, email: c.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
}

/** Contact for server use (messages, invoices): the contact document, else a legacy booking's own fields. */
export async function loadContact(bookingId: string, b: DocumentData): Promise<StoredContact> {
  const snap = await db.doc(`booking_contacts/${bookingId}`).get();
  const c = snap.data();
  if (c) return { customerId: text(c.customerId), name: text(c.name), phone: text(c.phone), whatsapp: text(c.whatsapp) || text(c.phone), email: text(c.email) };
  const wa = b.customerWhatsapp && typeof b.customerWhatsapp === 'object' ? text((b.customerWhatsapp as { e164?: string }).e164) : '';
  return { customerId: text(b.customerId), name: text(b.customer), phone: text(b.phone), whatsapp: wa || text(b.phone), email: text(b.customerEmail) };
}

async function logAccess(row: { bookingId: string; actorId: string; role: string; action: 'reveal' | 'denied'; reason: string; platform?: string; linkedId?: string }) {
  await db.collection('contact_access_logs').add({ ...row, at: FieldValue.serverTimestamp() }).catch(() => null);
}

/**
 * The customer's number for the booking's CURRENT assigned driver, inside the T-8h window, or for
 * staff with operations access (every staff reveal is logged under their own account). A vendor is
 * always refused. The number is returned to the caller only — it is never written anywhere else.
 */
export const getCustomerContact = onCall({ timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const bookingId = typeof request.data?.bookingId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(request.data.bookingId) ? request.data.bookingId : '';
  if (!bookingId) throw new HttpsError('invalid-argument', 'Invalid booking.');
  const platform = text(request.data?.platform, 12) || 'app';
  const snap = await db.doc(`bookings/${bookingId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
  const b = snap.data()!;
  const deny = async (role: string, reason: string, message: string, code = 'contact-denied') => {
    await logAccess({ bookingId, actorId: uid, role, action: 'denied', reason, platform });
    await snap.ref.update({ contactDenials: FieldValue.increment(1) }).catch(() => null);
    throw new HttpsError('permission-denied', message, { code });
  };

  // Vendors, always masked.
  const vendor = await db.doc(`vendors/${uid}`).get();
  if (vendor.exists && b.assignedVendorId === uid && b.assignedDriverId !== uid) {
    return deny('vendor', 'vendor-always-masked', 'The customer’s number is not shared with vendors. Your assigned driver receives it before pickup.', 'vendor-masked');
  }

  let role: 'driver' | 'staff' | '' = '';
  let grant = '';
  if (b.assignedDriverId === uid) {
    const d = await db.doc(`drivers/${uid}`).get();
    const p = d.data();
    if (!d.exists || !p || !approved(p.status) || p.fleetStatus === 'Suspended') return deny('driver', 'account-inactive', 'Your driver account is not active.');
    if (!['Assigned', 'Ongoing', 'Confirmed'].includes(b.status)) return deny('driver', `booking-${String(b.status).toLowerCase()}`, 'This trip is not active, so the number is not available.');
    const at = pickupInstant(b);
    if (at && at.getTime() - Date.now() > REVEAL_WINDOW_MS) {
      const opens = new Date(at.getTime() - REVEAL_WINDOW_MS);
      return deny('driver', 'before-window', `The customer's number unlocks 8 hours before pickup (from ${opens.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}).`, 'before-window');
    }
    role = 'driver';
  } else {
    const staff = await requireAdmin(request.auth).catch(() => null);
    if (staff && staff.permissions.includes('operations')) {
      if (staff.kind !== 'staff') {
        role = 'staff';
        grant = 'staff-operations';
      } else {
        // A Staff ID never holds standing access to full contacts: either a temporary reveal on a
        // booking this person handled (when granted), or a Master-approved, unexpired request that
        // is used once. Requests end when the person's access or status changes (staffProfiles).
        const handled = [b.createdBy, b.approvedBy, b.marketplacePublishedBy].includes(uid);
        if (handled && matrixFlag(staff.matrix, 'privacy', 'temporaryReveal')) {
          role = 'staff';
          grant = 'handled-booking';
        } else {
          const approvedReqs = await db.collection('privacy_requests').where('staffUid', '==', uid).where('bookingId', '==', bookingId).where('status', '==', 'Approved').limit(10).get();
          const valid = approvedReqs.docs.find((r) => ((r.data().expiresAt as Timestamp | undefined)?.toMillis?.() ?? 0) > Date.now());
          if (!valid) return deny('staff', 'approval-required', 'The customer’s number needs Master approval for this booking. Request access from the booking.', 'approval-required');
          const used = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(valid.ref);
            if (fresh.data()?.status !== 'Approved') return false;
            tx.update(valid.ref, { status: 'Used', usedAt: FieldValue.serverTimestamp() });
            return true;
          });
          if (!used) return deny('staff', 'approval-used', 'That approval has already been used. Request access again.', 'approval-required');
          role = 'staff';
          grant = 'approved-request';
        }
      }
    }
  }
  if (!role) return deny('other', 'not-authorised', 'You do not have access to this customer’s number.');

  const contact = await loadContact(bookingId, b);
  if (!contact.phone) throw new HttpsError('failed-precondition', 'No contact number is on file for this booking.');
  await logAccess({ bookingId, actorId: uid, role, action: 'reveal', reason: role === 'driver' ? 'assigned-driver' : grant, platform, linkedId: role === 'driver' ? uid : '' });
  await snap.ref.update({ contactViews: FieldValue.increment(1), contactViewers: FieldValue.arrayUnion(uid) }).catch(() => null);
  return { phone: contact.phone, name: contact.name.split(' ')[0] ?? contact.name };
});

/** Staff correct a booking's customer contact details; the raw values go to the contact document only. */
export const updateBookingContact = onCall({ timeoutSeconds: 30 }, async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  requireAction(admin, 'Bookings', 'edit');
  const input = request.data ?? {};
  const bookingId = typeof input.bookingId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.bookingId) ? input.bookingId : '';
  if (!bookingId) throw new HttpsError('invalid-argument', 'Invalid booking.');
  const name = text(input.customer, 80);
  if (name.length < 2) throw new HttpsError('invalid-argument', 'Enter the customer name.');
  const phone = indianPhone(input.phone);
  const email = optionalEmail(input.email);
  const notes = text(input.notes, 500);
  const ref = db.doc(`bookings/${bookingId}`);
  await db.runTransaction(async (tx) => {
    const [snap, contact] = await Promise.all([tx.get(ref), tx.get(db.doc(`booking_contacts/${bookingId}`))]);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const b = snap.data()!;
    if (b.status === 'Completed' && b.finance) throw new HttpsError('failed-precondition', 'A financially finalized trip keeps its contact details.');
    const stamp = FieldValue.serverTimestamp();
    const next = { customerId: text(b.customerId), name, phone, whatsapp: phone, email, updatedAt: stamp };
    if (contact.exists) tx.update(contact.ref, { name, phone, whatsapp: contact.data()!.whatsapp && contact.data()!.whatsapp !== contact.data()!.phone ? contact.data()!.whatsapp : phone, email, updatedAt: stamp });
    else tx.create(contact.ref, { ...next, createdAt: stamp });
    tx.update(ref, { customer: name, phoneMasked: maskPhone(phone), notes, phone: FieldValue.delete(), customerEmail: FieldValue.delete(), customerWhatsapp: FieldValue.delete(), updatedAt: stamp });
    auditInTx(tx, { action: 'booking_contact_updated', entity: 'booking', entityId: bookingId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId, previous: { phoneMasked: b.phoneMasked ?? maskPhone(text(b.phone)) }, next: { phoneMasked: maskPhone(phone) } });
  });
  return { ok: true };
});

/**
 * One-off, idempotent and optional: moves raw contact fields of older bookings into
 * booking_contacts and leaves a masked number on the booking. dryRun (default) only counts.
 * Re-running changes nothing already moved. Nothing runs automatically.
 */
export const migrateBookingContacts = onCall({ timeoutSeconds: 540 }, async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  if (!admin.isSuper) throw new HttpsError('permission-denied', 'Only a super admin can run this migration.');
  const dryRun = request.data?.dryRun !== false;
  const limit = typeof request.data?.limit === 'number' ? Math.max(1, Math.min(2000, request.data.limit)) : 500;
  const snap = await db.collection('bookings').orderBy('createdAt').limit(limit * 4).get();
  const report = { dryRun, scanned: snap.size, needsMigration: 0, migrated: 0, alreadyClean: 0 };
  let batch = db.batch();
  let pending = 0;
  for (const d of snap.docs) {
    const b = d.data();
    const raw = text(b.phone);
    if (!raw && !b.customerWhatsapp && !b.customerEmail) { report.alreadyClean++; continue; }
    if (report.needsMigration >= limit) break;
    report.needsMigration++;
    if (dryRun) continue;
    const wa = b.customerWhatsapp && typeof b.customerWhatsapp === 'object' ? text((b.customerWhatsapp as { e164?: string }).e164) : '';
    batch.set(db.doc(`booking_contacts/${d.id}`), {
      customerId: text(b.customerId), name: text(b.customer), phone: raw, whatsapp: wa || raw, email: text(b.customerEmail), migratedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.update(d.ref, { phoneMasked: maskPhone(raw), phone: FieldValue.delete(), customerWhatsapp: FieldValue.delete(), customerEmail: FieldValue.delete() });
    pending++;
    report.migrated++;
    if (pending >= 200) { await batch.commit(); batch = db.batch(); pending = 0; }
  }
  if (!dryRun && pending) await batch.commit();
  if (!dryRun) await db.collection('audit_logs').add({ action: 'booking_contacts_migrated', entity: 'system', entityId: 'bookings', performedBy: admin.uid, performedByName: admin.name, role: 'admin', meta: { ...report }, at: FieldValue.serverTimestamp() });
  return report;
});

void Timestamp;

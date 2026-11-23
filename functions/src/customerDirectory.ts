// Customers Directory: the trusted side of the admin Customers screen.
//
//   • getCustomerDirectory  – the customer list WITHOUT raw mobile numbers (masked "+91 98765 •••••"). Firestore rules refuse
//     Staff IDs a direct read of customers/{id}, because a readable document carries its phone and rules cannot hide one field;
//     the admin reads this projection instead (the same pattern as getStaffBookings).
//   • revealCustomerNumber  – the only way a full number leaves the server: authorised, reason validated, audit event written
//     (server time, actor) BEFORE the number is returned. If the audit write fails the caller receives nothing.
//   • getCustomerNumberViews – the reveal ledger. Master sees every entry; anyone else sees only their own.
//   • saveCustomerProfile   – create / edit with mobile normalisation and uniqueness enforced in a transaction.
//   • exportCustomerNumbers – Master only: full numbers for a bulk export, with a mandatory reason, logged.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { DocumentData, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { matrixAllows, matrixFlag, type AdminAccess } from './permissions';
import { requireAdmin, text } from './shared';

export const REVEAL_CATEGORIES = [
  'New booking confirmation call',
  'Pickup landmark / address clarification',
  'GST invoice / payment receipt follow-up',
  'Customer support / lost item check',
] as const;

export const ENQUIRY_REVEAL_CATEGORIES = [
  'Scheduled follow-up callback',
  'WhatsApp fare quote confirmation',
  'Pickup time / cab availability update',
] as const;
export const NOTE_MIN = 10;
export const NOTE_MAX = 200;
const LIST_LIMIT = 5000;
const BOOKING_SCAN = 1000;
const DEFAULT_REVEAL_SECONDS = 60;
const GENDERS = ['', 'Male', 'Female', 'Other'];
const LEAD_SOURCES = ['Google Search', 'WhatsApp Direct', 'Repeat / Referral', 'Justdial', 'Airport Walk-in'];
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type BrandKey = 'nesam' | 'people_taxi' | 'onewaycarrentals';

// ── Pure helpers (unit tested) ────────────────────────────────────────────────

/** Last 10 digits of an Indian mobile ("+91 98765 43210" → "9876543210"); '' when there are fewer than 10 digits. */
export function phoneKey(v: unknown): string {
  const d = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  return d.length >= 10 ? d.slice(-10) : '';
}
/**
 * A typed Indian mobile in one of the supported spellings — 10 digits, or with a 0 / 91 / +91 / 091 / 0091 prefix,
 * separated by spaces, dashes, dots or brackets — as its 10 digits; null for anything else. Unlike `phoneKey` (which
 * reads stored records), extra digits are never cut off, so a mistyped 11–14 digit number cannot match a customer.
 */
export function parseIndianMobile(v: unknown): string | null {
  if (typeof v !== 'string' || /[^\d\s+()\-.]/.test(v)) return null;
  const d = v.replace(/\D/g, '');
  const m = /^(?:0091|091|91|0)?([6-9]\d{9})$/.exec(d);
  if (!m) return null;
  // A bare 10-digit number is taken as is; a prefix is accepted only when it leaves exactly 10 digits.
  return m[1];
}
/** "+91 98765 •••••" — the reference's masked form. */
export function maskCustomerPhone(v: unknown): string {
  const k = phoneKey(v);
  return k ? `+91 ${k.slice(0, 5)} •••••` : '';
}
export const formatCustomerPhone = (v: unknown): string => {
  const k = phoneKey(v);
  return k ? `+91 ${k.slice(0, 5)} ${k.slice(5)}` : '';
};
/** Every spelling an older record may carry for one mobile number. */
export function phoneVariants(key: string): string[] {
  return [`+91 ${key.slice(0, 5)} ${key.slice(5)}`, `+91${key}`, `+91 ${key}`, `91${key}`, key, `0${key}`];
}
/** A recognised brand from a booking, or '' (older bookings carry none and are never guessed). */
export function brandOf(v: unknown): BrandKey | '' {
  const s = typeof v === 'string' ? v.toLowerCase().replace(/[\s_-]/g, '') : '';
  if (s.includes('people')) return 'people_taxi';
  if (s.includes('oneway')) return 'onewaycarrentals';
  if (s === 'nesam' || s === 'nesamcabs') return 'nesam';
  return '';
}
export const customerCodeOf = (id: string, d: DocumentData) => text(d.customerCode, 40) || `NSM-CU-${id.slice(0, 6).toUpperCase()}`;

export type Viewer = {
  kind: string; isSuper: boolean; name: string;
  canView: boolean; canCreate: boolean; canEdit: boolean; canReveal: boolean; canExport: boolean;
};
export function viewerOf(a: AdminAccess): Viewer {
  const has = (action: 'view' | 'create' | 'edit') => a.isSuper || matrixAllows(a.matrix, 'Customers', action);
  return {
    kind: a.kind, isSuper: a.isSuper, name: a.name,
    canView: has('view'), canCreate: has('create'), canEdit: has('edit'),
    // A Staff ID reveals only when the Master granted it the temporary-reveal right; the Master always may.
    canReveal: a.isSuper || (has('view') && matrixFlag(a.matrix, 'privacy', 'temporaryReveal')),
    canExport: a.isSuper,
  };
}

const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0);
const roleLabel = (a: AdminAccess) => (a.isSuper ? 'Master Admin' : a.kind === 'staff' ? 'Staff' : 'Staff (role)');

/** The projection row: never carries a raw phone number. */
export function projectCustomer(id: string, d: DocumentData) {
  const email = text(d.email, 120);
  const explicitBrand = brandOf(d.brand);
  return {
    id,
    customerCode: customerCodeOf(id, d),
    name: text(d.name, 120),
    phone: '',
    phoneMasked: maskCustomerPhone(d.phone),
    hasPhone: !!phoneKey(d.phone),
    email: email === 'N/A' ? '' : email,
    status: text(d.status, 30),
    city: text(d.city, 80),
    gender: text(d.gender, 20),
    notes: text(d.notes, 500),
    source: text(d.source, 40),
    leadSource: text(d.leadSource, 60),
    isVip: d.isVip === true,
    isCorporate: d.isCorporate === true,
    company: text(d.company, 120),
    gstin: text(d.gstin, 20),
    preferredCab: text(d.preferredCab, 60),
    preferredDriver: text(d.preferredDriver, 60),
    brands: explicitBrand ? [explicitBrand] : [] as BrandKey[],
    createdAtMs: ms(d.createdAt),
    linkedBookingIds: [] as string[],
  };
}
export type CustomerRow = ReturnType<typeof projectCustomer>;

// ── Reads ────────────────────────────────────────────────────────────────────

export const getCustomerDirectory = onCall({ timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
  // Any active admin may read the masked list (it replaces the open customers read for Staff IDs); the screen itself is gated by its own module.
  const admin = await requireAdmin(request.auth);
  const full = request.data?.directory === true;
  const onlyId = text(request.data?.customerId, 128);
  if (onlyId && !/^[A-Za-z0-9_-]{1,128}$/.test(onlyId)) throw new HttpsError('invalid-argument', 'Invalid customer.');

  const snap = onlyId ? null : await db.collection('customers').limit(LIST_LIMIT).get();
  const docs = snap ? snap.docs : [await db.doc(`customers/${onlyId}`).get()].filter((d) => d.exists);
  const rows = docs.map((d) => projectCustomer(d.id, d.data()!));
  const phoneOwner = new Map<string, string>(); // last-10 digits → customer id ('' when two customers share it)
  for (const d of docs) {
    const k = phoneKey(d.data()!.phone);
    if (k) phoneOwner.set(k, phoneOwner.has(k) ? '' : d.id);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  let truncated = false;

  if (full && !onlyId) {
    // Bookings that belong to a customer by id, or (when unlinked) by an unambiguous mobile number kept in the booking or its contact document.
    const bookings = await db.collection('bookings').orderBy('createdAt', 'desc').limit(BOOKING_SCAN).get();
    truncated = bookings.size === BOOKING_SCAN;
    const unlinked = bookings.docs.filter((b) => !text(b.data().customerId, 128));
    const needContact = unlinked.filter((b) => !phoneKey(b.data().phone) && !phoneKey(b.data().customerPhone));
    const contactPhone = new Map<string, string>();
    for (let i = 0; i < needContact.length; i += 250) {
      const refs = needContact.slice(i, i + 250).map((b) => db.doc(`booking_contacts/${b.id}`));
      for (const c of await db.getAll(...refs)) if (c.exists) contactPhone.set(c.id, text(c.data()!.phone, 40));
    }
    for (const b of bookings.docs) {
      const d = b.data();
      const direct = text(d.customerId, 128);
      const owner = direct || phoneOwner.get(phoneKey(d.phone) || phoneKey(d.customerPhone) || phoneKey(contactPhone.get(b.id))) || '';
      const row = owner ? byId.get(owner) : undefined;
      if (!row) continue;
      if (!direct) row.linkedBookingIds.push(b.id);
      const brand = brandOf(d.brand) || brandOf(d.channel);
      if (brand && !row.brands.includes(brand)) row.brands.push(brand);
    }
  }
  return { customers: rows, viewer: viewerOf(admin), truncated };
});

/** Saved pickup addresses for the drawer (customer-owned records, read on demand). */
export const getCustomerSavedPlaces = onCall({ timeoutSeconds: 30 }, async (request) => {
  await requireAdmin(request.auth);
  const id = text(request.data?.customerId, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new HttpsError('invalid-argument', 'Invalid customer.');
  const s = await db.collection('saved_places').where('ownerId', '==', id).limit(10).get();
  return { places: s.docs.map((d) => ({ id: d.id, name: text(d.data().name, 80), address: text(d.data().address, 240) })).filter((p) => p.address) };
});

/**
 * Mobile lookup: a full 10-digit number the operator already holds finds the customer (ids only — no number is returned).
 * Searching a stored number letter by letter is not possible; the masked list matches the visible first five digits only.
 */
export const findCustomerByMobile = onCall({ timeoutSeconds: 30 }, async (request) => {
  await requireAdmin(request.auth);
  const key = parseIndianMobile(request.data?.phone);
  if (!key) throw new HttpsError('invalid-argument', 'Enter the full 10-digit mobile number.');
  const [idx, legacy] = await Promise.all([db.doc(`customer_phone_index/${key}`).get(), db.collection('customers').where('phone', 'in', phoneVariants(key)).limit(5).get()]);
  const ids = new Set(legacy.docs.map((d) => d.id));
  if (idx.exists) ids.add(String(idx.data()!.customerId));
  return { ids: [...ids] };
});

// ── Number reveal and its ledger ─────────────────────────────────────────────

/**
 * Returns `value` only after `audit` has succeeded. A failed audit write throws and the value is never handed back,
 * so a number can never be shown without its log entry.
 */
export async function releaseAfterAudit<T>(audit: () => Promise<unknown>, value: T): Promise<T> {
  try {
    await audit();
  } catch (e) {
    console.error('[customerDirectory] audit write failed; value withheld', e instanceof Error ? e.message : e);
    throw new HttpsError('unavailable', 'The view could not be logged, so the number was not shown. Try again.');
  }
  return value;
}

const LOG = 'customer_number_views';
const denialsOf = async (a: AdminAccess, customerId: string, reason: string) =>
  db.collection(LOG).add({ kind: 'reveal', outcome: 'denied', customerId, actorId: a.uid, actorName: a.name, actorRole: roleLabel(a), reason, at: FieldValue.serverTimestamp() }).catch(() => null);

export const revealCustomerNumber = onCall({ timeoutSeconds: 30 }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const input = request.data ?? {};
  const customerId = text(input.customerId, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(customerId)) throw new HttpsError('invalid-argument', 'Invalid customer.');
  const viewer = viewerOf(admin);
  if (!viewer.canReveal) {
    await denialsOf(admin, customerId, 'not-authorised');
    throw new HttpsError('permission-denied', 'Your Staff ID does not include viewing full customer numbers. Ask the Master account.');
  }
  const category = text(input.category, 80);
  if (!(REVEAL_CATEGORIES as readonly string[]).includes(category)) throw new HttpsError('invalid-argument', 'Choose a reason category.');
  const note = text(input.note, NOTE_MAX);
  if (note.length < NOTE_MIN) throw new HttpsError('invalid-argument', `Enter a note of at least ${NOTE_MIN} characters.`);

  const snap = await db.doc(`customers/${customerId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Customer not found.');
  const c = snap.data()!;
  const phone = formatCustomerPhone(c.phone);
  if (!phone) throw new HttpsError('failed-precondition', 'No mobile number is on file for this customer.');

  // The audit event is written first and awaited: if it cannot be saved, the number is never returned.
  const entry = db.collection(LOG).doc();
  const phoneOut = await releaseAfterAudit(() => entry.create({
    kind: 'reveal', outcome: 'granted', customerId, customerCode: customerCodeOf(snap.id, c), customerName: text(c.name, 120),
    category, note, platform: text(input.platform, 12) || 'admin',
    actorId: admin.uid, actorName: admin.name, actorRole: roleLabel(admin), at: FieldValue.serverTimestamp(),
  }), phone);
  const policy = (await db.doc('settings/privacy').get().catch(() => null))?.data();
  const secs = Number(policy?.revealSeconds);
  return { phone: phoneOut, logId: entry.id, revealSeconds: Number.isFinite(secs) && secs >= 10 && secs <= 600 ? secs : DEFAULT_REVEAL_SECONDS };
});

export const revealEnquiryNumber = onCall({ timeoutSeconds: 30 }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const input = request.data ?? {};
  const enquiryId = text(input.enquiryId, 128);
  if (!enquiryId || !/^[A-Za-z0-9_-]{1,128}$/.test(enquiryId)) throw new HttpsError('invalid-argument', 'Invalid enquiry reference.');
  const viewer = viewerOf(admin);
  if (!viewer.canReveal) {
    await denialsOf(admin, enquiryId, 'not-authorised');
    throw new HttpsError('permission-denied', 'Your Staff ID does not include viewing full customer numbers. Ask the Master account.');
  }
  const category = text(input.category, 80);
  const validCategories = [...REVEAL_CATEGORIES, ...ENQUIRY_REVEAL_CATEGORIES] as readonly string[];
  if (!validCategories.includes(category)) throw new HttpsError('invalid-argument', 'Choose a valid reason category.');
  const note = text(input.note, NOTE_MAX);
  if (note.length < NOTE_MIN) throw new HttpsError('invalid-argument', `Enter a note of at least ${NOTE_MIN} characters.`);

  const snap = await db.doc(`enquiries/${enquiryId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Enquiry not found.');
  const e = snap.data()!;
  const rawPhone = e.phone || e.whatsapp || '';
  const phone = formatCustomerPhone(rawPhone);
  if (!phone) throw new HttpsError('failed-precondition', 'No mobile number is on file for this enquiry.');

  const entry = db.collection(LOG).doc();
  const phoneOut = await releaseAfterAudit(() => entry.create({
    kind: 'reveal', outcome: 'granted', enquiryId, customerCode: text(e.code, 40) || enquiryId, customerName: text(e.customerName, 120) || 'Enquiry Caller',
    category, note, platform: text(input.platform, 12) || 'admin',
    actorId: admin.uid, actorName: admin.name, actorRole: roleLabel(admin), at: FieldValue.serverTimestamp(),
  }), phone);
  const policy = (await db.doc('settings/privacy').get().catch(() => null))?.data();
  const secs = Number(policy?.revealSeconds);
  return { phone: phoneOut, logId: entry.id, revealSeconds: Number.isFinite(secs) && secs >= 10 && secs <= 600 ? secs : DEFAULT_REVEAL_SECONDS };
});

export const getCustomerNumberViews = onCall({ timeoutSeconds: 30 }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const limit = Math.max(1, Math.min(50, Number(request.data?.limit) || 20));
  let q = db.collection(LOG).orderBy('at', 'desc').limit(limit * 3);
  if (!admin.isSuper) q = db.collection(LOG).where('actorId', '==', admin.uid).orderBy('at', 'desc').limit(limit * 3);
  const snap = await q.get();
  const entries = snap.docs
    .filter((d) => d.data().outcome === 'granted')
    .slice(0, limit)
    .map((d) => {
      const x = d.data();
      return {
        id: d.id, viewedBy: text(x.actorName, 120) || 'Staff', viewedByRole: text(x.actorRole, 30), customer: text(x.customerName, 120), customerCode: text(x.customerCode, 40),
        reason: `${text(x.category, 80)} — ${text(x.note, NOTE_MAX)}`, kind: x.kind === 'export' ? 'export' : 'reveal', atMs: ms(x.at),
      };
    });
  let total = entries.length;
  try {
    const base = admin.isSuper ? db.collection(LOG) : db.collection(LOG).where('actorId', '==', admin.uid);
    total = (await base.where('outcome', '==', 'granted').count().get()).data().count;
  } catch { /* the list stays; the count falls back to what was loaded */ }
  return { entries, total, scope: admin.isSuper ? 'all' : 'own' };
});

// ── Directory export (Master only) ───────────────────────────────────────────
// Every export is authorised here before the admin builds the file. A plain export is logged; one that includes full numbers is a
// separate privileged operation: it needs a reason and the numbers come only from this function (never from the list the page holds).

export const exportCustomerNumbers = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const admin = await requireAdmin(request.auth);
  if (!admin.isSuper) {
    await denialsOf(admin, '', 'export-not-authorised');
    throw new HttpsError('permission-denied', 'Only the Master Admin can export the customer directory.');
  }
  const ids = Array.isArray(request.data?.customerIds) ? [...new Set((request.data.customerIds as unknown[]).filter((v): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v)))] : [];
  if (!ids.length || ids.length > 5000) throw new HttpsError('invalid-argument', 'Choose between 1 and 5000 customers.');
  const includeNumbers = request.data?.includeNumbers === true;
  const note = text(request.data?.reason, NOTE_MAX);
  if (includeNumbers && note.length < NOTE_MIN) throw new HttpsError('invalid-argument', `Enter a reason of at least ${NOTE_MIN} characters to export full numbers.`);
  const numbers: Record<string, string> = {};
  if (includeNumbers) {
    for (let i = 0; i < ids.length; i += 250) {
      for (const s of await db.getAll(...ids.slice(i, i + 250).map((id) => db.doc(`customers/${id}`)))) if (s.exists) numbers[s.id] = formatCustomerPhone(s.data()!.phone);
    }
    // Logged before the numbers are returned, like a single reveal.
    await db.collection(LOG).add({
      kind: 'export', outcome: 'granted', customerId: '', customerCode: '', customerName: `${Object.keys(numbers).length} customers`,
      category: 'Bulk export of full numbers', note, count: Object.keys(numbers).length,
      actorId: admin.uid, actorName: admin.name, actorRole: roleLabel(admin), at: FieldValue.serverTimestamp(),
    });
  } else {
    await db.collection('audit_logs').add({
      action: 'customer_export_authorized', entity: 'customer', entityId: 'directory', performedBy: admin.uid, performedByName: admin.name, role: 'admin',
      reason: '', bookingId: '', meta: { count: ids.length, numbers: false }, at: FieldValue.serverTimestamp(),
    });
  }
  return { numbers, authorized: true };
});

// ── Create / edit ────────────────────────────────────────────────────────────

const clean = (v: unknown, max: number) => text(v, max).replace(/[\u0000-\u001f]/g, ' ').trim();

export const saveCustomerProfile = onCall({ timeoutSeconds: 30 }, async (request) => {
  const admin = await requireAdmin(request.auth);
  const viewer = viewerOf(admin);
  const input = request.data ?? {};
  const customerId = text(input.customerId, 128);
  const creating = !customerId;
  if (!creating && !/^[A-Za-z0-9_-]{1,128}$/.test(customerId)) throw new HttpsError('invalid-argument', 'Invalid customer.');
  if (creating ? !viewer.canCreate : !viewer.canEdit) {
    throw new HttpsError('permission-denied', `Your Staff ID does not include Customers · ${creating ? 'create' : 'edit'}. Ask the Master account.`);
  }
  if (!creating && input.phone !== undefined) throw new HttpsError('invalid-argument', 'The mobile number cannot be changed here.');

  const has = (k: string) => input[k] !== undefined;
  const patch: Record<string, unknown> = {};
  if (creating || has('name')) {
    const name = clean(input.name, 80);
    if (name.length < 2) throw new HttpsError('invalid-argument', 'Enter the customer name.');
    patch.name = name;
  }
  if (has('email')) {
    const email = clean(input.email, 120);
    if (email && !EMAIL.test(email)) throw new HttpsError('invalid-argument', 'Enter a valid email address.');
    patch.email = email;
  }
  if (has('city')) patch.city = clean(input.city, 60);
  if (has('gender')) {
    const g = clean(input.gender, 20);
    if (!GENDERS.includes(g)) throw new HttpsError('invalid-argument', 'Choose a valid gender.');
    patch.gender = g;
  }
  if (has('notes')) patch.notes = clean(input.notes, 300);
  if (has('preferredCab')) patch.preferredCab = clean(input.preferredCab, 60);
  if (has('preferredDriver')) patch.preferredDriver = clean(input.preferredDriver, 60);
  if (has('company')) patch.company = clean(input.company, 120);
  if (has('gstin')) {
    const g = clean(input.gstin, 20).toUpperCase();
    if (g && !GSTIN.test(g)) throw new HttpsError('invalid-argument', 'Enter a valid 15-character GSTIN.');
    patch.gstin = g;
  }
  if (has('isVip')) patch.isVip = input.isVip === true;
  if (has('isCorporate')) patch.isCorporate = input.isCorporate === true;
  if (has('status')) {
    if (input.status !== 'Active' && input.status !== 'Blocked') throw new HttpsError('invalid-argument', 'Status must be Active or Blocked.');
    patch.status = input.status;
  }
  const lead = has('leadSource') ? clean(input.leadSource, 60) : undefined;

  if (creating) {
    const key = parseIndianMobile(input.phone);
    if (!key) throw new HttpsError('invalid-argument', 'Enter a valid 10-digit Indian mobile number.');
    if (lead !== undefined && lead && !LEAD_SOURCES.includes(lead)) throw new HttpsError('invalid-argument', 'Choose a lead source from the list.');
    if (lead) patch.leadSource = lead;
    const id = db.collection('customers').doc().id;
    const index = db.doc(`customer_phone_index/${key}`);

    // Check for older legacy records saved before the index existed in any spelling variant.
    const legacy = await db.collection('customers').where('phone', 'in', phoneVariants(key)).limit(1).get();
    if (legacy.docs[0]?.exists) {
      throw new HttpsError('already-exists', `A customer with this mobile already exists (${text(legacy.docs[0].data()!.name, 80) || 'saved customer'}).`);
    }

    await db.runTransaction(async (tx) => {
      // The index document serialises concurrent creates of one number.
      const idx = await tx.get(index);
      if (idx.exists) throw new HttpsError('already-exists', 'A customer with this mobile already exists.');
      tx.create(db.doc(`customers/${id}`), {
        status: 'Active', isVip: false, isCorporate: false, ...patch, phone: formatCustomerPhone(key), role: 'customer', source: 'admin',
        createdBy: admin.uid, createdByName: admin.name, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(index, { customerId: id, createdAt: FieldValue.serverTimestamp() });
      auditInTx(tx, { action: 'customer_created', entity: 'customer', entityId: id, performedBy: admin.uid, performedByName: admin.name, role: 'admin', next: { name: patch.name, phoneMasked: maskCustomerPhone(key) } });
    });
    return { id, created: true };
  }

  const ref = db.doc(`customers/${customerId}`);
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (!cur.exists) throw new HttpsError('not-found', 'Customer not found.');
    // A historical lead source stays editable; a new value must come from the list.
    if (lead !== undefined) {
      if (lead && !LEAD_SOURCES.includes(lead) && lead !== text(cur.data()!.leadSource, 60)) throw new HttpsError('invalid-argument', 'Choose a lead source from the list.');
      patch.leadSource = lead;
    }
    if (!Object.keys(patch).length) return;
    tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.uid });
    auditInTx(tx, { action: 'customer_updated', entity: 'customer', entityId: customerId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', previous: { status: cur.data()!.status ?? null }, next: { fields: Object.keys(patch), ...(patch.status ? { status: patch.status } : {}) } });
  });
  return { id: customerId, created: false };
});

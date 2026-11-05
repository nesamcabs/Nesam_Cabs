// Partner linking: how a driver or a vehicle moves between an owner-driver, a vendor's fleet and another vendor.
//
//   partner_links/{id}              the request, readable by the vendor(s) involved and by staff; written only here
//   partner_links/{id}/events/{e}   its history (who did what, how it was verified)
//   partner_link_secrets/{id}       the one-time code (salted HMAC), attempts and resend counters; never readable
//
// Two kinds of request:
//   driver   A vendor adds a driver who already has a NESAM account (an owner-driver, or a driver of another vendor).
//            The driver proves consent with a code sent to the driver's own registered number; the vendor types it in.
//   vehicle  A vendor attaches a vehicle that is already on NESAM. The code goes to the driver of the vehicle's most
//            recent completed trip, who is the person most likely to know the car is changing hands.
//
// A request ends in one of: Completed, Rejected, Cancelled. When the code cannot be delivered, or the move cannot happen
// automatically (open duties, a hold, an unverified vehicle, an owner-driver changing role), it goes to "Office review",
// where staff approve it, or override it with a written reason. Open duties always block a move: they must be reassigned first.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp, DocumentData } from 'firebase-admin/firestore';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { db } from './admin';
import { audit, auditInTx } from './audit';
import { deliveryRow, notify, notifyInTx, pushAfterCommit, NotifyInput } from './notify';
import { mask, sendSms, sendWhatsApp, toDigits, SendResult } from './providers';
import { approved, requirePermission, text } from './shared';

export const OPEN_STATUSES = ['Awaiting OTP', 'Office review'] as const;
const CODE_TTL_MS = 5 * 60000;
const RESEND_COOLDOWN_MS = 60000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;
const HOLD_STATUSES = ['Inactive', 'Maintenance', 'Accident Hold'];

type Kind = 'driver' | 'vehicle';
type Actor = { role: 'vendor' | 'admin'; id: string; name: string };

// ── small helpers ─────────────────────────────────────────────────────────

const pepper = (): string => {
  const p = (process.env.OTP_PEPPER ?? '').trim();
  if (p.length < 16) throw new HttpsError('failed-precondition', 'Verification codes are not configured on the server yet (OTP_PEPPER).');
  return p;
};
const hashCode = (code: string, salt: string) => createHmac('sha256', pepper()).update(`partner-link:${salt}:${code}`).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Letters and digits only, upper case: "tn 01-ab 1234" → "TN01AB1234". */
export const plateKey = (s: unknown): string => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The spellings a plate may be stored under (compact, spaced, hyphenated). */
export function plateCandidates(key: string): string[] {
  const out = new Set<string>([key]);
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{1,4})$/.exec(key);
  if (m) {
    out.add(`${m[1]} ${m[2]} ${m[3]} ${m[4]}`);
    out.add(`${m[1]}-${m[2]}-${m[3]}-${m[4]}`);
    out.add(`${m[1]} ${m[2]} ${m[3]}${m[4]}`);
    out.add(`${m[1]}${m[2]} ${m[3]} ${m[4]}`);
  }
  return [...out];
}
const displayPlate = (key: string) => {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{1,4})$/.exec(key);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : key;
};

export const tenDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '').slice(-10);
const phoneCandidates = (ten: string) => [
  `+91${ten}`, ten, `91${ten}`, `+91 ${ten}`,
  `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`, `${ten.slice(0, 5)} ${ten.slice(5)}`,
];

const firstName = (name: string) => (text(name, 80).split(/\s+/)[0] || 'Driver');
const millis = (v: unknown): number => (v && typeof (v as Timestamp).toMillis === 'function' ? (v as Timestamp).toMillis() : 0);
const id = (v: unknown, what: string): string => {
  const s = text(v, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(s)) throw new HttpsError('invalid-argument', `Invalid ${what}.`);
  return s;
};

const vendorLabel = (v: DocumentData | undefined) => text(v?.companyName || v?.business?.businessName || v?.name, 120) || 'Vendor';

async function requireApprovedVendor(uid: string | undefined) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.doc(`vendors/${uid}`).get();
  if (!snap.exists || !approved(snap.data()!.status)) throw new HttpsError('permission-denied', 'Only an approved vendor can do this.');
  return { id: uid, name: vendorLabel(snap.data()), data: snap.data()! };
}

async function openDuties(field: 'assignedDriverId' | 'assignedVehicleId', subjectId: string) {
  const snap = await db.collection('bookings').where(field, '==', subjectId).where('status', 'in', ['Assigned', 'Ongoing']).get();
  return snap.docs.map((d) => ({ id: d.id, code: text(d.data().bookingId) || d.id }));
}

async function lastTripDriver(vehicleId: string): Promise<{ id: string; name: string; phone: string } | null> {
  const snap = await db.collection('bookings').where('assignedVehicleId', '==', vehicleId).where('status', '==', 'Completed').limit(40).get();
  const sorted = snap.docs
    .map((d) => ({ b: d.data(), at: millis(d.data().completedAt) || millis(d.data().tripEndedAt) || millis(d.data().updatedAt) }))
    .filter((x) => text(x.b.assignedDriverId))
    .sort((a, b) => b.at - a.at);
  for (const x of sorted) {
    const d = await db.doc(`drivers/${text(x.b.assignedDriverId)}`).get();
    const phone = text(d.data()?.phone, 20);
    if (d.exists && toDigits(phone).length >= 10) return { id: d.id, name: text(d.data()!.name, 80), phone };
  }
  return null;
}

async function findDriverByPhone(phone: unknown) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  // Accept an Indian local number or its +91 form; never look up an unrelated number by truncating arbitrary prefixes.
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(ten)) throw new HttpsError('invalid-argument', 'Enter the driver’s valid 10-digit mobile number.');
  const drivers = db.collection('drivers');
  // Current registration stores phoneE164 plus a display-formatted phone; older records may have only phone.
  const [canonical, legacy] = await Promise.all([
    drivers.where('phoneE164', '==', `+91${ten}`).limit(2).get(),
    drivers.where('phone', 'in', phoneCandidates(ten)).limit(2).get(),
  ]);
  const matches = new Map([...canonical.docs, ...legacy.docs].map((d) => [d.id, d]));
  if (matches.size > 1) {
    throw new HttpsError('failed-precondition', 'More than one driver account uses this mobile number. Contact the NESAM office before linking it.');
  }
  return matches.values().next().value ?? null;
}

async function findVehicleByPlate(key: string) {
  if (key.length < 6 || key.length > 12) throw new HttpsError('invalid-argument', 'Enter the vehicle registration number.');
  const snap = await db.collection('vehicles').where('vehicleNumber', 'in', plateCandidates(key)).limit(3).get();
  return snap.docs[0] ?? null;
}

async function ownerLabel(vendorId: string): Promise<string> {
  if (!vendorId) return '';
  const v = await db.doc(`vendors/${vendorId}`).get();
  return v.exists ? vendorLabel(v.data()) : 'Another vendor';
}

// ── one-time codes ────────────────────────────────────────────────────────

interface SendOutcome { delivered: boolean; channels: { channel: string; status: string }[]; testCode?: string; sendsLeft: number; error?: string }

/** Issues a fresh code for a link and sends it to `toE164`. Enforces the cooldown and the hourly limit. */
async function issueCode(linkId: string, purpose: string, toE164: string, receiverId: string, message: string): Promise<SendOutcome> {
  const secretRef = db.doc(`partner_link_secrets/${linkId}`);
  const snap = await secretRef.get();
  const now = Date.now();
  const recent: number[] = ((snap.data()?.sends as number[] | undefined) ?? []).filter((t) => now - t < 3600000);
  if (recent.length && now - Math.max(...recent) < RESEND_COOLDOWN_MS) {
    throw new HttpsError('resource-exhausted', `Wait ${Math.ceil((RESEND_COOLDOWN_MS - (now - Math.max(...recent))) / 1000)} seconds before asking for another code.`);
  }
  if (recent.length >= MAX_SENDS_PER_HOUR) throw new HttpsError('resource-exhausted', 'Too many codes were sent for this request. Try again in an hour, or ask the NESAM office to help.');

  const code = String(randomInt(100000, 1000000));
  const salt = randomBytes(12).toString('hex');
  await secretRef.set({
    codeHash: hashCode(code, salt), salt, receiverId, purpose, attempts: 0, status: 'pending',
    expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS), sends: [...recent, now], updatedAt: FieldValue.serverTimestamp(),
  });

  const sms = `${message} Code ${code} is valid for 5 minutes. Share it only if you agree.`;
  const jobs: Promise<SendResult>[] = [sendSms(toE164, { text: sms, variables: { otp: code, var1: code } })];
  const tpl = (process.env.WHATSAPP_TEMPLATE_OTP ?? '').trim();
  if (tpl) jobs.push(sendWhatsApp(toE164, { name: tpl, bodyParams: [code], otpButton: code }));
  const results = await Promise.all(jobs);
  const row = { recipientId: receiverId, recipientType: 'driver' as const, category: 'general' as const, title: 'Verification code', message: 'Verification code sent', bookingId: '' };
  await Promise.all(results.map((r) => db.collection('notification_deliveries').add(deliveryRow('', row, r.channel, r.status === 'sent' ? 'sent' : r.status === 'not_configured' ? 'not_configured' : 'failed', {
    provider: r.provider, providerMessageId: r.providerMessageId ?? '', error: r.error ?? '', kind: 'otp', purpose, linkId,
  }))));
  const delivered = results.some((r) => r.ok);
  return {
    delivered, channels: results.map((r) => ({ channel: r.channel, status: r.status })),
    // Never in production: only the local emulator hands the code back so the flow can be exercised end to end.
    ...(process.env.FUNCTIONS_EMULATOR === 'true' ? { testCode: code } : {}),
    sendsLeft: MAX_SENDS_PER_HOUR - recent.length - 1,
    ...(delivered ? {} : { error: 'The code could not be delivered to that phone.' }),
  };
}

// ── completion ────────────────────────────────────────────────────────────

class Blocked extends Error {
  constructor(message: string, public bookingIds: string[] = []) { super(message); }
}

interface CompleteOptions { method: string; override?: boolean; reason?: string }

/**
 * Moves the driver or vehicle to the requesting vendor if — and only if — everything still holds.
 * Throws Blocked when it cannot (a duty is open, ownership changed, a hold or an unverified record needs staff).
 */
async function applyLink(linkId: string, actor: Actor, opts: CompleteOptions) {
  const linkRef = db.doc(`partner_links/${linkId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];
  await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const linkSnap = await tx.get(linkRef);
    if (!linkSnap.exists) throw new HttpsError('not-found', 'Request not found.');
    const link = linkSnap.data()!;
    if (!(OPEN_STATUSES as readonly string[]).includes(link.status)) throw new HttpsError('failed-precondition', `This request is already ${String(link.status).toLowerCase()}.`);
    const kind: Kind = link.kind;
    const subjectRef = db.doc(`${kind === 'driver' ? 'drivers' : 'vehicles'}/${link.subjectId}`);
    const toRef = db.doc(`vendors/${link.toVendorId}`);
    const [subject, to] = await Promise.all([tx.get(subjectRef), tx.get(toRef)]);
    if (!to.exists || !approved(to.data()!.status)) throw new Blocked('The vendor is not approved.');
    if (!subject.exists) throw new Blocked(kind === 'driver' ? 'The driver no longer exists.' : 'The vehicle no longer exists.');
    const s = subject.data()!;
    if (text(s.vendorId) !== text(link.fromVendorId)) throw new Blocked('The attachment changed after this request was made. Start a new request.');
    if (text(s.vendorId) === link.toVendorId) throw new Blocked('Already part of this fleet.');

    const field = kind === 'driver' ? 'assignedDriverId' : 'assignedVehicleId';
    const duties = await tx.get(db.collection('bookings').where(field, '==', link.subjectId).where('status', 'in', ['Assigned', 'Ongoing']));
    if (!duties.empty) {
      const codes = duties.docs.map((d) => text(d.data().bookingId) || d.id);
      throw new Blocked(`${codes.length} booked ${codes.length === 1 ? 'duty is' : 'duties are'} still open (${codes.slice(0, 4).join(', ')}). Reassign ${codes.length === 1 ? 'it' : 'them'} first.`, duties.docs.map((d) => d.id));
    }

    // The record paired with the subject (a driver's vehicle, or a vehicle's driver) is released in step.
    const pairedId = text(kind === 'driver' ? s.assignedVehicleId : s.assignedDriverId);
    const paired = pairedId ? await tx.get(db.doc(`${kind === 'driver' ? 'vehicles' : 'drivers'}/${pairedId}`)) : null;

    if (kind === 'driver') {
      if (!approved(s.status)) throw new Blocked('The driver is not approved by NESAM yet.');
      if (s.fleetStatus === 'Suspended' && !opts.override) throw new Blocked('The driver is on hold. Staff must review before the move.');
    } else {
      if (s.docStatus !== 'Approved' && !opts.override) throw new Blocked('The vehicle is not verified yet. Staff must review before the move.');
      if (HOLD_STATUSES.includes(text(s.status)) && !opts.override) throw new Blocked(`The vehicle is on hold (${text(s.status)}). Staff must review before the move.`);
    }
    if (kind === 'driver' && !link.consent && !opts.override) throw new Blocked("The driver's consent has not been confirmed.");

    const stamp = FieldValue.serverTimestamp();
    const toName = vendorLabel(to.data());
    if (kind === 'driver') {
      tx.update(subjectRef, {
        vendorId: link.toVendorId, vendorName: toName, fleetStatus: 'Active', assignedVehicleId: '', assignedVehicleNumber: '',
        previousVendorId: text(s.vendorId), previousAccountType: text(s.vendorId) ? 'vendor_driver' : 'owner_driver', linkedAt: stamp, updatedAt: stamp,
      });
      if (paired?.exists && text(paired.data()!.assignedDriverId) === link.subjectId) tx.update(paired.ref, { assignedDriverId: '', assignedDriverName: '', updatedAt: stamp });
    } else {
      tx.update(subjectRef, {
        vendorId: link.toVendorId, assignedDriverId: '', assignedDriverName: '', previousVendorId: text(s.vendorId), linkedAt: stamp, updatedAt: stamp,
      });
      if (paired?.exists && text(paired.data()!.assignedVehicleId) === link.subjectId) tx.update(paired.ref, { assignedVehicleId: '', assignedVehicleNumber: '', updatedAt: stamp });
    }
    tx.update(linkRef, {
      status: 'Completed', method: opts.method, completedAt: stamp, completedBy: actor.id, completedByName: actor.name,
      overrideReason: opts.override ? text(opts.reason, 500) : '', blockedReason: '', updatedAt: stamp,
    });
    tx.create(linkRef.collection('events').doc(), { type: 'completed', method: opts.method, actorId: actor.id, actorRole: actor.role, actorName: actor.name, reason: text(opts.reason, 500), at: stamp });
    auditInTx(tx, {
      action: kind === 'driver' ? 'driver_attachment_changed' : 'vehicle_attachment_changed', entity: kind, entityId: link.subjectId,
      performedBy: actor.id, performedByName: actor.name, role: actor.role, previous: { vendorId: text(s.vendorId) }, next: { vendorId: link.toVendorId },
      reason: text(opts.reason, 500), meta: { linkId, method: opts.method },
    });

    const label = text(link.subjectLabel, 80);
    const base = { category: 'approvals' as const, severity: 'success' as const, sound: 'approval' as const, push: true, sentBy: actor.id, cta: { label: 'Open', page: 'links' } };
    const mk = (input: NotifyInput) => pushes.push({ id: notifyInTx(tx, input), input });
    mk({ ...base, recipientType: 'vendor', recipientId: link.toVendorId, title: kind === 'driver' ? 'Driver added to your fleet' : 'Vehicle added to your fleet', message: `${label} is now part of ${toName}.` });
    if (text(link.fromVendorId)) mk({ ...base, severity: 'info', recipientType: 'vendor', recipientId: text(link.fromVendorId), title: kind === 'driver' ? 'Driver moved to another fleet' : 'Vehicle moved to another fleet', message: `${label} is no longer in your fleet.` });
    if (kind === 'driver') mk({ ...base, recipientType: 'driver', recipientId: link.subjectId, title: 'You joined a new fleet', message: `You now drive for ${toName}. Duties will come to you from them.` });
  });
  await pushAfterCommit(pushes);
}

/** Records why a request cannot finish automatically and hands it to staff. */
async function sendToOffice(linkId: string, actor: Actor, reason: string, extra: Record<string, unknown> = {}) {
  const ref = db.doc(`partner_links/${linkId}`);
  await ref.update({ status: 'Office review', blockedReason: text(reason, 400), ...extra, updatedAt: FieldValue.serverTimestamp() });
  await ref.collection('events').add({ type: 'office_review', actorId: actor.id, actorRole: actor.role, actorName: actor.name, reason: text(reason, 400), at: FieldValue.serverTimestamp() });
  await notify({
    recipientType: 'admin', recipientId: 'admin', category: 'approvals', severity: 'warning', sound: 'general', push: true,
    title: 'Partner link needs review', message: text(reason, 200), cta: { label: 'Review', page: 'partner-links' }, sentBy: actor.id,
  }).catch(() => null);
}

// ── lookup ────────────────────────────────────────────────────────────────

async function lookupActor(auth: { uid: string } | undefined, kind: Kind) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const isVendor = (await db.doc(`vendors/${auth.uid}`).get()).exists;
  if (isVendor) return requireApprovedVendor(auth.uid);
  return requirePermission(auth, kind === 'driver' ? 'people' : 'fleet');
}

/** Whether a mobile number belongs to a NESAM driver, and what kind (owner-driver / another vendor's driver). */
export const findPartnerDriver = onCall(async (request) => {
  await lookupActor(request.auth, 'driver');
  const doc = await findDriverByPhone(request.data?.phone);
  if (!doc) return { found: false };
  const d = doc.data();
  const mine = text(d.vendorId) === (request.auth!.uid);
  const duties = mine ? [] : await openDuties('assignedDriverId', doc.id);
  const open = await db.collection('partner_links').where('subjectId', '==', doc.id).where('status', 'in', [...OPEN_STATUSES]).get();
  const existing = open.docs.find((x) => x.data().kind === 'driver' && x.data().toVendorId === request.auth!.uid);
  return {
    found: true, driverId: doc.id, name: firstName(d.name), phoneMask: mask.phone(toDigits(text(d.phone, 20)).slice(-10)), kind: text(d.vendorId) ? 'vendor_driver' : 'owner_driver',
    fleet: mine ? 'yours' : text(d.vendorId) ? await ownerLabel(text(d.vendorId)) : '', mine, approved: approved(d.status), onHold: d.fleetStatus === 'Suspended',
    openDuties: duties.length, pendingLinkId: existing?.id ?? '',
  };
});

/** Whether a registration number is already on NESAM, who holds it, and who would be asked to confirm a move. */
export const findPartnerVehicle = onCall(async (request) => {
  await lookupActor(request.auth, 'vehicle');
  const key = plateKey(request.data?.plate);
  const doc = await findVehicleByPlate(key);
  if (!doc) return { found: false, plate: displayPlate(key) };
  const v = doc.data();
  const mine = text(v.vendorId) === request.auth!.uid;
  const [owner, last, duties, open] = await Promise.all([
    mine ? Promise.resolve('Your fleet') : text(v.vendorId) ? ownerLabel(text(v.vendorId)) : Promise.resolve(text(v.assignedDriverId) ? 'An owner-driver' : 'Not attached'),
    mine ? Promise.resolve(null) : lastTripDriver(doc.id),
    mine ? Promise.resolve([]) : openDuties('assignedVehicleId', doc.id),
    db.collection('partner_links').where('subjectId', '==', doc.id).where('status', 'in', [...OPEN_STATUSES]).get(),
  ]);
  const existing = open.docs.find((x) => x.data().kind === 'vehicle' && x.data().toVendorId === request.auth!.uid);
  return {
    found: true, vehicleId: doc.id, plate: displayPlate(plateKey(v.vehicleNumber)), model: [text(v.make, 40), text(v.model, 40)].filter(Boolean).join(' '), category: text(v.category, 60),
    owner, mine, verified: v.docStatus === 'Approved', onHold: HOLD_STATUSES.includes(text(v.status)), openDuties: duties.length,
    otpReceiver: last ? { name: firstName(last.name), phoneMask: mask.phone(toDigits(last.phone).slice(-10)) } : null, pendingLinkId: existing?.id ?? '',
  };
});

// ── requests ──────────────────────────────────────────────────────────────

async function createLink(kind: Kind, subjectId: string, toVendorId: string, toVendorName: string, actor: Actor, sendCode: boolean) {
  const subject = await db.doc(`${kind === 'driver' ? 'drivers' : 'vehicles'}/${subjectId}`).get();
  if (!subject.exists) throw new HttpsError('not-found', kind === 'driver' ? 'Driver not found.' : 'Vehicle not found.');
  const s = subject.data()!;
  const fromVendorId = text(s.vendorId);
  if (fromVendorId === toVendorId) throw new HttpsError('failed-precondition', kind === 'driver' ? 'This driver is already in your fleet.' : 'This vehicle is already in your fleet.');
  const existing = await db.collection('partner_links').where('subjectId', '==', subjectId).where('status', 'in', [...OPEN_STATUSES]).get();
  const dup = existing.docs.find((x) => x.data().kind === kind && x.data().toVendorId === toVendorId);
  if (dup) return { linkId: dup.id, existing: true as const };

  const fromName = fromVendorId ? await ownerLabel(fromVendorId) : '';
  const subjectLabel = kind === 'driver' ? text(s.name, 80) || 'Driver' : displayPlate(plateKey(s.vehicleNumber));
  let receiver: { id: string; name: string; phone: string } | null = null;
  if (kind === 'driver') receiver = { id: subject.id, name: text(s.name, 80), phone: text(s.phone, 20) };
  else receiver = await lastTripDriver(subject.id);

  const linkRef = db.collection('partner_links').doc();
  const base = {
    kind, subjectId, subjectLabel, subjectPhoneMask: kind === 'driver' ? mask.phone(toDigits(text(s.phone, 20)).slice(-10)) : '',
    subjectKind: kind === 'driver' ? (fromVendorId ? 'vendor_driver' : 'owner_driver') : '',
    fromVendorId, fromVendorName: fromName, fromType: fromVendorId ? 'vendor' : (kind === 'driver' ? 'owner_driver' : (text(s.assignedDriverId) ? 'owner_driver' : 'unattached')),
    toVendorId, toVendorName, requestedBy: actor.id, requestedByName: actor.name, requestedByRole: actor.role,
    consent: false, otpVerified: false, receiverName: receiver ? firstName(receiver.name) : '', receiverPhoneMask: receiver ? mask.phone(toDigits(receiver.phone).slice(-10)) : '',
    hasReceiver: !!receiver, method: '', blockedReason: '', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  };

  if (!sendCode || !receiver) {
    await linkRef.set({ ...base, status: 'Office review', blockedReason: receiver ? 'Sent to the office for assistance.' : 'No recent driver to confirm this vehicle — the office will verify it.', otp: { delivered: false } });
    await linkRef.collection('events').add({ type: 'created', actorId: actor.id, actorRole: actor.role, actorName: actor.name, reason: receiver ? 'office assisted' : 'no last-trip driver', at: FieldValue.serverTimestamp() });
    await audit({ action: kind === 'driver' ? 'driver_link_requested' : 'vehicle_link_requested', entity: kind, entityId: subjectId, performedBy: actor.id, performedByName: actor.name, role: actor.role, next: { toVendorId }, meta: { linkId: linkRef.id } });
    await notify({ recipientType: 'admin', recipientId: 'admin', category: 'approvals', severity: 'warning', sound: 'general', push: true, title: 'Partner link needs review', message: `${subjectLabel} → ${toVendorName}`, cta: { label: 'Review', page: 'partner-links' }, sentBy: actor.id }).catch(() => null);
    return { linkId: linkRef.id, status: 'Office review' as const, delivered: false, existing: false as const };
  }

  await linkRef.set({ ...base, status: 'Awaiting OTP', otp: { delivered: false } });
  await linkRef.collection('events').add({ type: 'created', actorId: actor.id, actorRole: actor.role, actorName: actor.name, at: FieldValue.serverTimestamp() });
  await audit({ action: kind === 'driver' ? 'driver_link_requested' : 'vehicle_link_requested', entity: kind, entityId: subjectId, performedBy: actor.id, performedByName: actor.name, role: actor.role, next: { toVendorId }, meta: { linkId: linkRef.id } });
  const message = kind === 'driver'
    ? `NESAM: ${toVendorName} wants to add you as a driver.`
    : `NESAM: ${toVendorName} wants to link vehicle ${subjectLabel} to their fleet.`;
  const sent = await issueCode(linkRef.id, kind, receiver.phone.startsWith('+') ? receiver.phone : `+91${tenDigits(receiver.phone)}`, receiver.id, message);
  await linkRef.update({ otp: { delivered: sent.delivered, sentAt: Timestamp.now(), channels: sent.channels } });
  if (kind === 'driver' && sent.delivered) {
    await notify({ recipientType: 'driver', recipientId: subject.id, category: 'approvals', severity: 'info', sound: 'general', push: true, title: 'A vendor wants to add you', message: `${toVendorName} asked you to join their fleet. Share the code you received only if you agree.`, sentBy: actor.id }).catch(() => null);
  }
  return { linkId: linkRef.id, status: 'Awaiting OTP' as const, delivered: sent.delivered, channels: sent.channels, error: sent.error, testCode: sent.testCode, existing: false as const };
}

/** A vendor asks to add a driver who already has a NESAM account. */
export const requestDriverLink = onCall(async (request) => {
  const vendor = await requireApprovedVendor(request.auth?.uid);
  const doc = await findDriverByPhone(request.data?.phone);
  if (!doc) throw new HttpsError('not-found', 'No NESAM driver uses that number. Send an invitation instead.');
  if (!approved(doc.data().status)) throw new HttpsError('failed-precondition', 'This driver has not been approved by NESAM yet.');
  return createLink('driver', doc.id, vendor.id, vendor.name, { role: 'vendor', id: vendor.id, name: vendor.name }, request.data?.office !== true);
});

/** A vendor asks to attach a vehicle that is already on NESAM. */
export const requestVehicleLink = onCall(async (request) => {
  const vendor = await requireApprovedVendor(request.auth?.uid);
  const doc = await findVehicleByPlate(plateKey(request.data?.plate));
  if (!doc) throw new HttpsError('not-found', 'That vehicle is not on NESAM yet. Add it as a new vehicle.');
  return createLink('vehicle', doc.id, vendor.id, vendor.name, { role: 'vendor', id: vendor.id, name: vendor.name }, request.data?.office !== true);
});

/** Staff start a request for a vendor (assisted linking). `sendOtp:false` goes straight to the office queue. */
export const adminCreatePartnerLink = onCall(async (request) => {
  const kind: Kind = request.data?.kind === 'vehicle' ? 'vehicle' : 'driver';
  const admin = await requirePermission(request.auth, kind === 'driver' ? 'people' : 'fleet');
  const toVendorId = id(request.data?.toVendorId, 'vendor');
  const to = await db.doc(`vendors/${toVendorId}`).get();
  if (!to.exists || !approved(to.data()!.status)) throw new HttpsError('failed-precondition', 'Choose an approved vendor.');
  const subject = kind === 'driver' ? await findDriverByPhone(request.data?.phone) : await findVehicleByPlate(plateKey(request.data?.plate));
  if (!subject) throw new HttpsError('not-found', kind === 'driver' ? 'No NESAM driver uses that number.' : 'That vehicle is not on NESAM.');
  return createLink(kind, subject.id, toVendorId, vendorLabel(to.data()), { role: 'admin', id: admin.uid, name: admin.name }, request.data?.sendOtp !== false);
});

// ── verification ──────────────────────────────────────────────────────────

/** The vendor that made the request, or staff with the right permission. */
async function authorizeLink(auth: { uid: string } | undefined, linkId: string, opts: { vendorOnly?: boolean } = {}) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.doc(`partner_links/${linkId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Request not found.');
  const link = snap.data()!;
  if (link.toVendorId === auth.uid) {
    const v = await requireApprovedVendor(auth.uid);
    return { link, actor: { role: 'vendor', id: v.id, name: v.name } as Actor };
  }
  if (opts.vendorOnly) throw new HttpsError('permission-denied', 'This request belongs to another vendor.');
  const admin = await requirePermission(auth, link.kind === 'driver' ? 'people' : 'fleet');
  return { link, actor: { role: 'admin', id: admin.uid, name: admin.name } as Actor };
}

export const verifyPartnerLinkOtp = onCall({ timeoutSeconds: 60 }, async (request) => {
  const linkId = id(request.data?.linkId, 'request');
  const code = text(request.data?.code, 8);
  if (!/^\d{6}$/.test(code)) throw new HttpsError('invalid-argument', 'Enter the 6-digit code.');
  const { link, actor } = await authorizeLink(request.auth, linkId);
  if (!(OPEN_STATUSES as readonly string[]).includes(link.status)) throw new HttpsError('failed-precondition', `This request is already ${String(link.status).toLowerCase()}.`);

  const secretRef = db.doc(`partner_link_secrets/${linkId}`);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(secretRef);
    const d = snap.data();
    if (!snap.exists || !d || d.status !== 'pending') return 'none' as const;
    if (millis(d.expiresAt) < Date.now()) { tx.update(secretRef, { status: 'expired' }); return 'expired' as const; }
    if ((d.attempts ?? 0) >= MAX_ATTEMPTS) return 'locked' as const;
    if (sameHash(hashCode(code, d.salt), d.codeHash)) { tx.update(secretRef, { status: 'used', usedAt: FieldValue.serverTimestamp() }); return 'ok' as const; }
    const attempts = (d.attempts ?? 0) + 1;
    tx.update(secretRef, { attempts });
    return attempts >= MAX_ATTEMPTS ? ('locked' as const) : (`wrong:${MAX_ATTEMPTS - attempts}` as const);
  });
  if (outcome === 'none') throw new HttpsError('failed-precondition', 'There is no active code. Ask for a new one.');
  if (outcome === 'expired') throw new HttpsError('failed-precondition', 'This code has expired. Ask for a new one.');
  if (outcome === 'locked') throw new HttpsError('failed-precondition', 'Too many wrong codes. Ask for a new one, or ask the office to help.');
  if (outcome !== 'ok') throw new HttpsError('failed-precondition', `That code is not correct. ${outcome.split(':')[1]} attempts left.`);

  const ref = db.doc(`partner_links/${linkId}`);
  await ref.update({ otpVerified: true, consent: true, consentAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await ref.collection('events').add({ type: 'otp_verified', actorId: actor.id, actorRole: actor.role, actorName: actor.name, at: FieldValue.serverTimestamp() });

  // An owner-driver changing role is always checked by staff; everything else completes at once when nothing blocks it.
  const needsOffice = link.kind === 'driver' && !link.fromVendorId;
  if (needsOffice) {
    await sendToOffice(linkId, actor, 'The driver has confirmed. The NESAM office now checks the change, because the driver is moving from working on their own to working for a fleet.');
    return { status: 'Office review', completed: false, message: 'Code confirmed. The NESAM office will finish this change.' };
  }
  try {
    await applyLink(linkId, actor, { method: link.kind === 'driver' ? 'Driver code' : 'Last-trip driver code' });
    return { status: 'Completed', completed: true, message: 'Done. It is now part of your fleet.' };
  } catch (err) {
    if (err instanceof Blocked) {
      await sendToOffice(linkId, actor, err.message, { blockedBookingIds: err.bookingIds });
      return { status: 'Office review', completed: false, message: `Code confirmed, but ${err.message}` };
    }
    throw err;
  }
});

export const resendPartnerLinkOtp = onCall({ timeoutSeconds: 60 }, async (request) => {
  const linkId = id(request.data?.linkId, 'request');
  const { link } = await authorizeLink(request.auth, linkId);
  if (!(OPEN_STATUSES as readonly string[]).includes(link.status)) throw new HttpsError('failed-precondition', `This request is already ${String(link.status).toLowerCase()}.`);
  const subject = await db.doc(`${link.kind === 'driver' ? 'drivers' : 'vehicles'}/${link.subjectId}`).get();
  if (!subject.exists) throw new HttpsError('not-found', 'Record not found.');
  const receiver = link.kind === 'driver' ? { id: subject.id, name: text(subject.data()!.name, 80), phone: text(subject.data()!.phone, 20) } : await lastTripDriver(subject.id);
  if (!receiver) throw new HttpsError('failed-precondition', 'There is no recent driver to send a code to. Ask the office to help.');
  const message = link.kind === 'driver' ? `NESAM: ${link.toVendorName} wants to add you as a driver.` : `NESAM: ${link.toVendorName} wants to link vehicle ${link.subjectLabel} to their fleet.`;
  const sent = await issueCode(linkId, link.kind, receiver.phone.startsWith('+') ? receiver.phone : `+91${tenDigits(receiver.phone)}`, receiver.id, message);
  await db.doc(`partner_links/${linkId}`).update({ otp: { delivered: sent.delivered, sentAt: Timestamp.now(), channels: sent.channels }, updatedAt: FieldValue.serverTimestamp() });
  return { delivered: sent.delivered, channels: sent.channels, error: sent.error, testCode: sent.testCode, sendsLeft: sent.sendsLeft };
});

/** The vendor could not get the code: hand the request to the office. */
export const requestPartnerLinkHelp = onCall(async (request) => {
  const linkId = id(request.data?.linkId, 'request');
  const { link, actor } = await authorizeLink(request.auth, linkId, { vendorOnly: true });
  if (link.status !== 'Awaiting OTP') throw new HttpsError('failed-precondition', 'This request is not waiting for a code.');
  await sendToOffice(linkId, actor, text(request.data?.note, 200) || 'The vendor asked for help with the code.', { officeHelp: true });
  return { status: 'Office review' };
});

export const cancelPartnerLink = onCall(async (request) => {
  const linkId = id(request.data?.linkId, 'request');
  const { link, actor } = await authorizeLink(request.auth, linkId);
  if (!(OPEN_STATUSES as readonly string[]).includes(link.status)) throw new HttpsError('failed-precondition', `This request is already ${String(link.status).toLowerCase()}.`);
  const ref = db.doc(`partner_links/${linkId}`);
  await ref.update({ status: 'Cancelled', cancelledBy: actor.id, cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await db.doc(`partner_link_secrets/${linkId}`).delete().catch(() => undefined);
  await ref.collection('events').add({ type: 'cancelled', actorId: actor.id, actorRole: actor.role, actorName: actor.name, reason: text(request.data?.reason, 300), at: FieldValue.serverTimestamp() });
  await audit({ action: 'partner_link_cancelled', entity: link.kind, entityId: link.subjectId, performedBy: actor.id, performedByName: actor.name, role: actor.role, meta: { linkId } });
  return { status: 'Cancelled' };
});

// ── staff decision ────────────────────────────────────────────────────────

/**
 * Staff approve or reject a request in the office queue.
 * Approving a request whose code was never confirmed is an override and needs a written reason.
 */
export const decidePartnerLink = onCall({ timeoutSeconds: 60 }, async (request) => {
  const linkId = id(request.data?.linkId, 'request');
  const decision = request.data?.decision === 'reject' ? 'reject' : 'approve';
  const reason = text(request.data?.reason, 400);
  const { link, actor } = await authorizeLink(request.auth, linkId);
  if (actor.role !== 'admin') throw new HttpsError('permission-denied', 'Only the NESAM office can decide this.');
  if (!(OPEN_STATUSES as readonly string[]).includes(link.status)) throw new HttpsError('failed-precondition', `This request is already ${String(link.status).toLowerCase()}.`);
  const ref = db.doc(`partner_links/${linkId}`);

  if (decision === 'reject') {
    if (reason.length < 3) throw new HttpsError('invalid-argument', 'Give a reason for declining.');
    await ref.update({ status: 'Rejected', rejectedReason: reason, completedBy: actor.id, completedByName: actor.name, completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await db.doc(`partner_link_secrets/${linkId}`).delete().catch(() => undefined);
    await ref.collection('events').add({ type: 'rejected', actorId: actor.id, actorRole: 'admin', actorName: actor.name, reason, at: FieldValue.serverTimestamp() });
    await audit({ action: 'partner_link_rejected', entity: link.kind, entityId: link.subjectId, performedBy: actor.id, performedByName: actor.name, role: 'admin', reason, meta: { linkId } });
    await notify({ recipientType: 'vendor', recipientId: link.toVendorId, category: 'approvals', severity: 'warning', sound: 'general', push: true, title: 'Request declined', message: `${link.subjectLabel}: ${reason}`, cta: { label: 'Open', page: 'links' }, sentBy: actor.id }).catch(() => null);
    return { status: 'Rejected' };
  }

  const override = request.data?.override === true;
  const confirmed = link.kind === 'driver' ? link.consent === true : link.otpVerified === true;
  if (!confirmed && !override) {
    throw new HttpsError('failed-precondition', link.kind === 'driver' ? "The driver's consent has not been confirmed. Override with a reason if the driver agreed another way." : 'The last-trip driver has not confirmed with a code. Override with a reason to move it without one.');
  }
  if (override && reason.length < 5) throw new HttpsError('invalid-argument', 'Write the reason for this override (at least 5 characters).');
  try {
    await applyLink(linkId, actor, { method: confirmed ? 'Office approved' : 'Admin override', override, reason });
  } catch (err) {
    if (err instanceof Blocked) throw new HttpsError('failed-precondition', err.message, { bookingIds: err.bookingIds });
    throw err;
  }
  return { status: 'Completed' };
});

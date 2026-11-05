// One-off, bounded and idempotent migration: moves the PARTNER side of existing bookings' pricing snapshots
// (pricing.partner and pricing.extraCharges.partner) into booking_pricing_private/{bookingId} and removes it from the
// customer-readable booking. Historical rates are copied exactly as stored — today's configuration is never used.
//
//   node scripts/migrate-private-booking-pricing.cjs                 dry run: reports what it would do, writes nothing
//   node scripts/migrate-private-booking-pricing.cjs --apply         does it
//   --limit N        bookings examined per run (default 300, max 450)
//   --after <id>     resume after this booking id (the run prints the id to continue from)
//
// Credentials: FIREBASE_SERVICE_ACCOUNT_KEY must point at a service-account JSON (nothing is read from a default path).
// DEPLOY FIRST: the functions that read booking_pricing_private (Trip End, assignment, publish) and the firestore.rules that
// protect it must be live before --apply, otherwise a booking would lose its partner block before the code can find it.
// Each booking is handled in ONE transaction (create private copy, then strip the booking), so a run can be repeated or
// stopped at any point: a booking is either untouched or fully moved. Existing private records are never overwritten; if one
// already exists and differs from the booking's inline copy, the booking is reported as a conflict and left alone.
const path = require('path');
const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));

const apply = process.argv.includes('--apply');
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const limit = Math.min(Math.max(parseInt(arg('--limit') || '300', 10) || 300, 1), 450);
const after = arg('--after');

const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!keyPath) { console.error('Set FIREBASE_SERVICE_ACCOUNT_KEY to a service-account JSON file.'); process.exit(1); }
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const hasPartnerData = (p) => !!p && typeof p === 'object' && (!!p.partner || !!(p.extraCharges && p.extraCharges.partner));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function migrateOne(ref) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const b = snap.data();
    if (!snap.exists || !hasPartnerData(b.pricing)) return 'skipped';
    const privRef = db.doc(`booking_pricing_private/${snap.id}`);
    const priv = await tx.get(privRef);
    const partner = b.pricing.partner ?? null;
    const extraPartner = b.pricing.extraCharges?.partner ?? null;
    if (priv.exists) {
      const d = priv.data();
      if (!same(d.partner, partner) || (extraPartner && !same(d.extraPartner, extraPartner))) return 'conflict';
    } else if (apply) {
      tx.create(privRef, {
        schema: 1, bookingId: snap.id, customerId: b.customerId ?? '', tariffVersion: Number(b.pricing.tariffVersion) || 0,
        partner, extraPartner, createdAt: FieldValue.serverTimestamp(), migratedFrom: 'booking.pricing',
      });
    }
    if (!apply) return 'would-move';
    const update = { 'pricing.partner': null };
    if (extraPartner) update['pricing.extraCharges.partner'] = FieldValue.delete();
    tx.update(ref, update);
    return 'moved';
  });
}

(async () => {
  let q = db.collection('bookings').orderBy(admin.firestore.FieldPath.documentId()).limit(limit);
  if (after) q = q.startAfter(after);
  const page = await q.get();
  const counts = { examined: page.size, skipped: 0, 'would-move': 0, moved: 0, conflict: 0, failed: 0 };
  const conflicts = [];
  for (const doc of page.docs) {
    try {
      const r = await migrateOne(doc.ref);
      counts[r] += 1;
      if (r === 'conflict') conflicts.push(doc.id);
    } catch (e) {
      counts.failed += 1;
      console.error(`FAILED ${doc.id}: ${e.message}`);
    }
  }
  console.log(apply ? 'APPLIED' : 'DRY RUN (nothing written)', JSON.stringify(counts));
  if (conflicts.length) console.log('Conflicts left untouched (review by hand):', conflicts.join(', '));
  if (page.size === limit) console.log(`More bookings remain. Continue with: --after ${page.docs[page.size - 1].id}`);
  process.exit(counts.failed ? 2 : 0);
})();

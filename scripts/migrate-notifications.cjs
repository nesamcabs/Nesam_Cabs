// One-off, bounded and idempotent migration: moves every record of the old shared `notifications` collection into the
// inbox of the panel it belongs to (functions/src/notify.ts):
//
//   customer → customer_notifications   driver → driver_notifications
//   vendor   → vendor_notifications     admin  → admin_notifications
//
//   node scripts/migrate-notifications.cjs                    dry run: reports what it would do, writes nothing
//   node scripts/migrate-notifications.cjs --apply            copies (same document id, so a re-run never duplicates)
//   node scripts/migrate-notifications.cjs --apply --delete-legacy
//                                                             copies, then deletes each legacy record whose copy exists
//   --limit N        legacy records examined per run (default 400, max 2000)
//   --after <id>     resume after this legacy document id (each run prints the id to continue from)
//
// Credentials: FIREBASE_SERVICE_ACCOUNT_KEY must point at a service-account JSON (nothing is read from a default path).
// For the emulator, set FIRESTORE_EMULATOR_HOST and GCLOUD_PROJECT instead.
// DEPLOY FIRST: firestore.rules + firestore.indexes.json, then the functions (they write the new inboxes), then run this,
// then publish the apps. Records written before the split that name no audience are placed by their recipient: the
// office for 'admin' / no recipient, otherwise the one profile (customers / drivers / vendors) that id has. A record whose
// audience cannot be decided is reported as "unresolved" and left where it is.
const path = require('path');

const INBOX = { customer: 'customer_notifications', driver: 'driver_notifications', vendor: 'vendor_notifications', admin: 'admin_notifications' };
const LEGACY = 'notifications';
const AUDIENCES = Object.keys(INBOX);
const PROFILE = { customer: 'customers', driver: 'drivers', vendor: 'vendors' };

/** Which inbox a legacy record belongs to, or a reason it cannot be moved. */
async function audienceOf(db, data, profileCache) {
  const type = typeof data.recipientType === 'string' ? data.recipientType.trim().toLowerCase() : '';
  const rid = typeof data.recipientId === 'string' ? data.recipientId.trim() : '';
  if (AUDIENCES.includes(type)) {
    if (type !== 'admin' && !rid) return { skip: 'orphan' }; // addressed to nobody: no app could ever show it
    return { audience: type };
  }
  if (rid === 'admin' || (!rid && !type)) return { audience: 'admin' };
  if (!rid) return { skip: 'orphan' };
  // No audience recorded: the profile(s) this id has decide; a partner-approval type breaks a tie.
  if (!profileCache.has(rid)) {
    const found = [];
    for (const a of ['customer', 'driver', 'vendor']) if ((await db.doc(`${PROFILE[a]}/${rid}`).get()).exists) found.push(a);
    profileCache.set(rid, found);
  }
  const found = profileCache.get(rid);
  if (found.length === 1) return { audience: found[0] };
  const hint = String(data.type || '').toLowerCase();
  if ((hint === 'driver' || hint === 'vendor') && found.includes(hint)) return { audience: hint };
  return { skip: 'unresolved' };
}

/**
 * Runs one page. Returns { counts, last, done }. `db` is a firebase-admin Firestore; `admin` the firebase-admin module.
 */
async function migrate(db, admin, { apply = false, deleteLegacy = false, limit = 400, after } = {}) {
  const { FieldPath, FieldValue, Timestamp } = admin.firestore;
  let q = db.collection(LEGACY).orderBy(FieldPath.documentId()).limit(limit);
  if (after) q = q.startAfter(after);
  const snap = await q.get();
  const counts = { examined: 0, copied: 0, alreadyCopied: 0, deleted: 0, orphan: 0, unresolved: 0, wouldCopy: 0, wouldDelete: 0 };
  const byAudience = { customer: 0, driver: 0, vendor: 0, admin: 0 };
  const unresolved = [];
  const profileCache = new Map();
  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops && apply) await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const doc of snap.docs) {
    counts.examined++;
    const data = doc.data();
    const where = await audienceOf(db, data, profileCache);
    if (where.skip) {
      counts[where.skip]++;
      if (where.skip === 'unresolved' && unresolved.length < 50) unresolved.push(doc.id);
      continue;
    }
    const audience = where.audience;
    const target = db.doc(`${INBOX[audience]}/${doc.id}`);
    const exists = (await target.get()).exists;
    if (exists) {
      counts.alreadyCopied++;
    } else {
      byAudience[audience]++;
      const createdAt = data.createdAt instanceof Timestamp ? data.createdAt : data.updatedAt instanceof Timestamp ? data.updatedAt : Timestamp.fromDate(doc.createTime.toDate());
      const record = {
        ...data,
        recipientType: audience,
        recipientId: audience === 'admin' ? 'admin' : String(data.recipientId).trim(),
        read: data.read === true,
        createdAt,
        migratedFrom: LEGACY,
        migratedAt: FieldValue.serverTimestamp(),
      };
      if (apply) {
        batch.create(target, record);
        ops++;
        counts.copied++;
      } else {
        counts.wouldCopy++;
      }
    }
    if (deleteLegacy) {
      if (apply) {
        // Deleted in the same batch as the copy (or after it was found copied), so a record is never lost.
        batch.delete(doc.ref);
        ops++;
        counts.deleted++;
      } else {
        counts.wouldDelete++;
      }
    }
    if (ops >= 400) await flush();
  }
  await flush();
  const last = snap.docs.length ? snap.docs[snap.docs.length - 1].id : null;
  return { counts, byAudience, unresolved, last, done: snap.size < limit };
}

module.exports = { migrate, audienceOf, INBOX, LEGACY };

if (require.main === module) {
  const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));
  const argv = process.argv.slice(2);
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const apply = argv.includes('--apply');
  const deleteLegacy = argv.includes('--delete-legacy');
  const limit = Math.min(Math.max(parseInt(arg('--limit') || '400', 10) || 400, 1), 2000);
  const after = arg('--after');

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-nesam' });
  } else {
    const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!keyPath) { console.error('Set FIREBASE_SERVICE_ACCOUNT_KEY to a service-account JSON file.'); process.exit(1); }
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))) });
  }

  migrate(admin.firestore(), admin, { apply, deleteLegacy, limit, after })
    .then((r) => {
      console.log(`${apply ? 'APPLIED' : 'DRY RUN'}${deleteLegacy ? ' (+ delete legacy)' : ''}`);
      console.log(JSON.stringify({ ...r.counts, byAudience: r.byAudience }, null, 2));
      if (r.unresolved.length) console.log(`Unresolved (left in ${LEGACY}): ${r.unresolved.join(', ')}`);
      console.log(r.done ? 'Done: no more legacy records after this page.' : `More to do: re-run with --after ${r.last}`);
      process.exit(0);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}

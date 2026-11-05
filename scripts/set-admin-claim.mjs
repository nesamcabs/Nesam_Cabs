/**
 * One-off: promote a user to a full platform admin.
 *
 * The admin web app only needs the Firestore `admins/{uid}` doc to have
 * role: "admin" to let someone in. But Firestore security rules check the
 * `role` *custom claim* (request.auth.token.role) before an admin can touch
 * other collections or approve vendors/drivers. `setUserRole` (the Cloud
 * Function) can set that claim, but it refuses unless the caller is already an
 * admin — so the very first admin has to be bootstrapped out of band. That's
 * what this script is for.
 *
 * Usage:
 *   1. Put the Firebase Admin SDK key at scripts/service-account.json
 *      (gitignored). Firebase console > Project settings > Service accounts >
 *      Generate new private key.
 *   2. cd scripts && npm install
 *   3. node set-admin-claim.mjs <uid-or-email>
 *   4. Have that user sign out and back in (or call
 *      auth.currentUser.getIdToken(true)) so the new claim takes effect.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/set-admin-claim.mjs <uid-or-email>');
  process.exit(1);
}

const serviceAccount = JSON.parse(
  readFileSync(new URL('./service-account.json', import.meta.url), 'utf8'),
);

initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth();
const db = getFirestore();

const user = target.includes('@')
  ? await auth.getUserByEmail(target)
  : await auth.getUser(target);

await auth.setCustomUserClaims(user.uid, { role: 'admin', status: 'active' });

await db.collection('admins').doc(user.uid).set(
  {
    uid: user.uid,
    email: user.email ?? null,
    name: user.displayName ?? '',
    role: 'admin',
    status: 'active',
    // Explicit Master record (functions/src/permissions.ts identityKindOf).
    staffRole: 'super_admin',
    roleName: 'Super Admin',
    promotedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

console.log(`✓ ${user.email ?? user.uid} is now an admin (claim + admins/${user.uid} doc).`);
console.log('  They must re-authenticate for the claim to take effect.');
process.exit(0);

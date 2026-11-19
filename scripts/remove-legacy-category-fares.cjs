// Removes the old per-category fares (base fare, base km, per-km rate, minimum fare, allowances, extras) from Firestore.
// Every price now comes from the admin panel (Service & Fare Settings, fixed route fares, rental packages), so the `fare`
// map on vehicle_categories/* is dead data. Nothing else is touched: no booking, tariff, fare rule or other field.
//
// Usage (from the Nesam_Cabs folder):
//   set GOOGLE_APPLICATION_CREDENTIALS=<path to a service-account JSON for the live project>
//   node scripts/remove-legacy-category-fares.cjs            -> dry run: lists what would be removed, writes nothing
//   node scripts/remove-legacy-category-fares.cjs --apply    -> removes the `fare` field from every vehicle category
//
// There is no backup step by request; the dry run prints every value before it is removed.

const path = require('path');
const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'nesamtoursandtravels-202f5';
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file for the project, then run again.');
  process.exit(1);
}
admin.initializeApp({ projectId });
const db = admin.firestore();
const apply = process.argv.includes('--apply');

async function main() {
  console.log(`Project: ${projectId}   Mode: ${apply ? 'APPLY (deleting fields)' : 'DRY RUN (nothing is written)'}\n`);
  const cats = await db.collection('vehicle_categories').get();
  const withFare = cats.docs.filter((d) => d.data().fare !== undefined);
  console.log(`vehicle_categories: ${cats.size} documents, ${withFare.length} still carry an old "fare" map`);
  for (const d of withFare) console.log(`  - ${d.id} (${d.data().name ?? '?'}): ${JSON.stringify(d.data().fare)}`);

  // Report only: older admin "fare rules" that the booking server never reads (it uses FIXED_ROUTE rules only).
  const rules = await db.collection('fare_rules').get();
  const older = rules.docs.filter((d) => d.data().pricingType !== 'FIXED_ROUTE');
  console.log(`\nfare_rules: ${rules.size} documents, ${older.length} are not FIXED_ROUTE (not used for pricing; left untouched)`);

  if (!apply) { console.log('\nDry run only. Run again with --apply to remove the "fare" field from the categories listed above.'); return; }
  for (let i = 0; i < withFare.length; i += 400) {
    const batch = db.batch();
    for (const d of withFare.slice(i, i + 400)) batch.update(d.ref, { fare: admin.firestore.FieldValue.delete() });
    await batch.commit();
  }
  console.log(`\nDone: removed "fare" from ${withFare.length} vehicle categories.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

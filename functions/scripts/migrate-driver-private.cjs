// Dry-run by default. Uses Application Default Credentials; never logs PII.
// GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node ... --apply
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const apply = process.argv.includes('--apply');

(async () => {
  let count = 0;
  for await (const row of db.collection('drivers').stream()) {
    if (!row.data().bank && !row.data().identity) continue;
    count++;
    if (!apply) continue;
    await db.runTransaction(async tx => {
      const privateRef = db.doc(`driver_private/${row.id}`);
      const [driver, existing] = await Promise.all([tx.get(row.ref), tx.get(privateRef)]);
      const data = driver.data();
      if (!data) return;
      const fields = {};
      if (data.bank && !existing.data()?.bank) fields.bank = data.bank;
      if (data.identity && !existing.data()?.identity) fields.identity = data.identity;
      if (Object.keys(fields).length) tx.set(privateRef, { ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.update(row.ref, { bank: FieldValue.delete(), identity: FieldValue.delete() });
    });
  }
  console.log(`${apply ? 'Migrated' : 'Would migrate'} ${count} driver documents. No private values logged.`);
})().catch(() => { console.error('Migration failed. Check credentials/project access; rerunning is safe.'); process.exitCode = 1; });

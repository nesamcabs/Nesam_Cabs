// Runs each emulator suite in its own process against a freshly wiped Firestore + Auth emulator, so one suite's saved
// settings (tariff, GST, service rules, users) can never change what the next suite sees.
// Usage (inside `firebase emulators:exec`): node test/runE2e.cjs [file ...]   - no arguments runs every *.e2e.test.js.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT = 'demo-nesam';
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

async function wipe() {
  const f = await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const a = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  if (!f.ok || !a.ok) throw new Error(`Emulator reset failed (firestore ${f.status}, auth ${a.status})`);
}

(async () => {
  const dir = __dirname;
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs.readdirSync(dir).filter((n) => n.endsWith('.e2e.test.js')).sort().map((n) => path.join('test', n));
  const results = [];
  for (const file of files) {
    await wipe();
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], { cwd: path.join(dir, '..'), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const out = `${r.stdout}\n${r.stderr}`;
    const pick = (k) => Number((out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1] || 0);
    results.push({ file, tests: pick('tests'), pass: pick('pass'), fail: pick('fail'), code: r.status });
    // Keep only the failing-test summary of a failed file, so the log stays readable.
    if (r.status !== 0) {
      const i = out.indexOf('failing tests:');
      console.log(`\n===== ${file} FAILED =====\n${i >= 0 ? out.slice(i, i + 20000) : out.slice(-6000)}`);
    }
  }
  console.log('\n===== E2E SUMMARY =====');
  for (const r of results) console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.file}  tests=${r.tests} pass=${r.pass} fail=${r.fail}`);
  const bad = results.filter((r) => r.code !== 0);
  console.log(`\nfiles=${results.length} failedFiles=${bad.length}`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

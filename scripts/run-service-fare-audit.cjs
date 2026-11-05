// Recheck repaired Multicity cells, then exercise the non-rate controls and conversion guards.
// Only demo Firebase emulators are used by the imported test helpers.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let failed = false;
for (const [args, merge] of [
  [['--test','--test-concurrency=1','--test-name-pattern= / Multicity / ','functions/test/serviceFareMatrix.e2e.test.js'],true],
  [['--test','--test-concurrency=1','functions/test/serviceFareControls.e2e.test.js','functions/test/multicityConversion.e2e.test.js'],false],
]) {
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,AUDIT_MERGE_REPORT:merge?'1':'0'}});
  if(result.status!==0)failed=true;
}
process.exitCode=failed?1:0;

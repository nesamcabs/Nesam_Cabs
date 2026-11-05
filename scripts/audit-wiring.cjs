// Read-only wiring inventory. No network requests and no secret values in output.
// Run from any directory: node scripts/audit-wiring.cjs
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../functions/node_modules/typescript');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const parse = p => ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true, p.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const visit = (node, fn) => { fn(node); ts.forEachChild(node, n => visit(n, fn)); };
const files = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => {
  const p = `${dir}/${e.name}`;
  return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
});
const registry = new Set();
visit(parse('functions/src/registry.ts'), n => {
  if (ts.isVariableDeclaration(n) && n.name.getText() === 'CALLABLES') {
    const obj = n.initializer.arguments[0];
    for (const p of obj.properties) registry.add(p.name.text);
  }
});
const modules = ['user/app', 'user/web', 'driver/app', 'driver/web', 'vendor/app', 'vendor/web', 'admin', 'people_taxi', 'one_way_car_rentals'];
const result = { registeredEndpoints: registry.size, modules: {}, missingEndpoints: [], dynamicCalls: [], localConfiguration: {} };
for (const module of modules) {
  const source = files(`${module}/src`);
  const calls = [];
  for (const file of source) visit(parse(file), n => {
    if (!ts.isCallExpression(n)) return;
    const name = n.expression.getText();
    const localWrapper = (name === 'call' && /admin\/src\/services\/(marketplaceService|staffService)\.ts$/.test(file)) ||
      (name === 'run' && file === 'admin/src/pages/PartnerLinks.tsx');
    if (!['callFunction', 'callBackend', 'httpsCallable'].includes(name) && !localWrapper) return;
    const arg = n.arguments[name === 'httpsCallable' ? 1 : 0];
    if (!arg) return;
    const line = n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1;
    if (ts.isStringLiteralLike(arg)) {
      calls.push({ endpoint: arg.text, file, line });
      if (!registry.has(arg.text)) result.missingEndpoints.push(calls[calls.length - 1]);
    } else result.dynamicCalls.push({ file, line, expression: arg.getText() });
  });
  result.modules[module] = { sourceFiles: source.length, screens: source.filter(f => /\/(pages|screens)\//.test(f) && f.endsWith('.tsx')), endpoints: [...new Set(calls.map(c => c.endpoint))].sort(), calls };
}
const navIds = [];
visit(parse('admin/src/components/shell/navConfig.ts'), n => {
  if (ts.isPropertyAssignment(n) && n.name.getText() === 'id' && ts.isStringLiteral(n.initializer)) navIds.push(n.initializer.text);
});
const routes = new Set();
visit(parse('admin/src/App.tsx'), n => {
  if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) routes.add(n.expression.text);
});
const permissions = new Set();
visit(parse('admin/src/config/permissions.ts'), n => {
  if (ts.isVariableDeclaration(n) && n.name.getText() === 'PAGE_ACCESS') {
    for (const p of n.initializer.properties) permissions.add(p.name.text);
  }
});
result.adminNavigation = navIds.map(id => ({ id, hasRoute: routes.has(id), hasAccessRule: permissions.has(id) }));
const firebaseExports = new Set();
visit(parse('functions/src/index.ts'), n => {
  if (ts.isExportDeclaration(n) && n.exportClause && ts.isNamedExports(n.exportClause)) {
    for (const e of n.exportClause.elements) firebaseExports.add(e.name.text);
  }
});
result.missingFirebaseExports = [...registry].filter(name => !firebaseExports.has(name));
// Presence only: these values are never printed or written to the report.
const env = {};
if (fs.existsSync(path.join(root, 'functions/.env'))) {
  for (const line of read('functions/.env').split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
}
for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE_OTP', 'WHATSAPP_TEMPLATE_BOOKING_UPDATE', 'SMS_PROVIDER', 'MSG91_AUTH_KEY', 'SMS_MSG91_TEMPLATE_ID', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'SENDGRID_API_KEY', 'EMAIL_FROM', 'VEHICLE_LOOKUP_PROVIDER', 'VEHICLE_LOOKUP_API_KEY', 'OTP_PEPPER', 'ALLOWED_ORIGINS', 'CRON_SECRET', 'PLAY_INTEGRITY_PACKAGE_NAME']) {
  result.localConfiguration[key] = !!env[key] && !/^(UNSET|REPLACE_ME|your[_-])/i.test(env[key]);
}
result.notes = ['Static endpoint inventory only; does not exercise every UI control.', 'Dynamic wrapper calls require review.', 'Local .env presence does not prove deployed configuration or provider delivery.'];
fs.mkdirSync(path.join(root, 'output'), { recursive: true });
fs.writeFileSync(path.join(root, 'output/wiring-inventory.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ registeredEndpoints: result.registeredEndpoints, modules: Object.fromEntries(Object.entries(result.modules).map(([k, v]) => [k, { sourceFiles: v.sourceFiles, endpoints: v.endpoints.length, calls: v.calls.length }])), missingEndpoints: result.missingEndpoints, missingFirebaseExports: result.missingFirebaseExports, adminNavigation: result.adminNavigation, dynamicCalls: result.dynamicCalls, localConfiguration: result.localConfiguration }, null, 2));
if (result.missingEndpoints.length || result.missingFirebaseExports.length || result.adminNavigation.some(n => !n.hasRoute || !n.hasAccessRule)) process.exitCode = 1;

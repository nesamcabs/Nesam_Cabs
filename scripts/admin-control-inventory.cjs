// Source-level inventory; does not claim that a control was clicked.
const fs = require('fs'), path = require('path');
const ts = require('../functions/node_modules/typescript');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const ast = f => ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true, f.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const walk = (n, fn) => { fn(n); ts.forEachChild(n, c => walk(c, fn)); };
const collectionNames = {};
walk(ast('admin/src/services/adminFirestoreService.ts'),n=>{
  if(ts.isVariableDeclaration(n)&&n.name.getText()==='COLLECTIONS')for(const p of n.initializer.properties)if(ts.isPropertyAssignment(p)&&ts.isStringLiteral(p.initializer))collectionNames[p.name.getText()]=p.initializer.text;
});
const cache = new Map();
function info(file) {
  if (cache.has(file)) return cache.get(file);
  const source = ast(file), imports = [], controls = [], collections = [], endpoints = [];
  const constants = {};
  walk(source,n=>{if(ts.isVariableDeclaration(n)&&n.initializer&&ts.isStringLiteral(n.initializer))constants[n.name.getText(source)]=n.initializer.text;});
  const stringValue = n => n && (ts.isStringLiteral(n) ? n.text : ts.isIdentifier(n) ? constants[n.text] : ts.isPropertyAccessExpression(n)&&n.expression.getText(source)==='COLLECTIONS' ? collectionNames[n.name.text] : undefined);
  walk(source, n => {
    if (ts.isImportDeclaration(n) && n.moduleSpecifier.text.startsWith('.')) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), n.moduleSpecifier.text));
      const resolved = [base+'.tsx', base+'.ts', base+'/index.tsx', base+'/index.ts'].find(p => fs.existsSync(path.join(root,p)));
      if (resolved) imports.push(resolved);
    }
    if (ts.isCallExpression(n)) {
      const name = n.expression.getText(source);
      if (/^(collection|doc|subscribeToCollection|addDocument|updateDocument|deleteDocument|addFirestoreDocument|setFirestoreDocument|updateFirestoreDocument|deleteFirestoreDocument)$/.test(name)) {
        const a = n.arguments[name === 'doc' || name === 'collection' ? 1 : 0];
        const value=stringValue(a); if(value)collections.push(value);
      }
      if (['callFunction','callBackend','call'].includes(name) && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) endpoints.push(n.arguments[0].text);
    }
    if (!ts.isJsxOpeningElement(n) && !ts.isJsxSelfClosingElement(n)) return;
    const tag = n.tagName.getText(source);
    const attrs = n.attributes.properties.filter(ts.isJsxAttribute);
    const events = attrs.filter(a => /^(on[A-Z]|action|footer)/.test(a.name.getText(source))).map(a => ({event:a.name.getText(source),handler:a.initializer?.getText(source)}));
    if (!events.length && !/^(button|Button|input|select|textarea|form)$/.test(tag)) return;
    const parent = ts.isJsxOpeningElement(n) ? n.parent : n;
    const label = ts.isJsxElement(parent) ? parent.children.filter(c => ts.isJsxText(c)).map(c => c.text.trim()).filter(Boolean).join(' ') : '';
    const extra = Object.fromEntries(attrs.filter(a=>/^(title|aria-label|label|type|disabled|readOnly|defaultChecked|defaultValue|placeholder)$/.test(a.name.getText(source))).map(a=>[a.name.getText(source),a.initializer?.getText(source)??'true']));
    controls.push({file,line:source.getLineAndCharacterOfPosition(n.getStart()).line+1,tag,label,...extra,events});
  });
  const value = {imports,controls,collections:[...new Set(collections)],endpoints:[...new Set(endpoints)]};
  cache.set(file,value); return value;
}
const app = ast('admin/src/App.tsx'), pageComponents = {}, imports = {};
walk(app,n=>{
  if(ts.isImportDeclaration(n) && n.importClause?.name && n.moduleSpecifier.text.startsWith('./')) imports[n.importClause.name.text]=`admin/src/${n.moduleSpecifier.text.slice(2)}.tsx`;
  if(ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) {
    let name; walk(n,c=>{if(!name && (ts.isJsxOpeningElement(c)||ts.isJsxSelfClosingElement(c)))name=c.tagName.getText(app);});
    if(name) pageComponents[n.expression.text]=name;
  }
});
const nav=[];
walk(ast('admin/src/components/shell/navConfig.ts'),n=>{
  if(ts.isObjectLiteralExpression(n)) {
    const p=Object.fromEntries(n.properties.filter(ts.isPropertyAssignment).map(p=>[p.name.getText(),p.initializer]));
    if(p.id&&p.label&&ts.isStringLiteral(p.id)&&ts.isStringLiteral(p.label))nav.push({id:p.id.text,label:p.label.text});
  }
});
const pages=nav.map(page=>{
  const file=imports[pageComponents[page.id] || (page.id==='dashboard'?'Dashboard':'')];
  if(!file) throw Error('Unresolved sidebar page: '+page.id);
  const visited=new Set();
  function follow(f){if(!f||visited.has(f)||!fs.existsSync(path.join(root,f)))return;visited.add(f);for(const i of info(f).imports)follow(i);}
  follow(file);
  return {...page,file,files:[...visited],controls:[...visited].flatMap(f=>info(f).controls),collections:[...new Set([...visited].flatMap(f=>info(f).collections))].sort(),endpoints:[...new Set([...visited].flatMap(f=>info(f).endpoints))].sort()};
});
// Include global shell controls and screens reached from a record rather than the sidebar.
const globalFiles=new Set();
function followGlobal(f){if(globalFiles.has(f))return;globalFiles.add(f);for(const i of info(f).imports)followGlobal(i);}
for(const f of ['admin/src/App.tsx','admin/src/components/Header.tsx','admin/src/components/Sidebar.tsx','admin/src/pages/BookingDetails.tsx','admin/src/pages/NewBooking.tsx'])followGlobal(f);
const controls=[...cache.values()].flatMap(x=>x.controls);
const suspect=controls.filter(c=>c.tag==='button'&&!c.events.some(e=>e.event==='onClick')&&c.type!=='"submit"'&&c.type!=="'submit'");
fs.mkdirSync(path.join(root,'output/admin-audit'),{recursive:true});
fs.writeFileSync(path.join(root,'output/admin-audit/control-inventory.json'),JSON.stringify({pages,files:Object.fromEntries(cache),uniqueFiles:cache.size,uniqueControls:controls.length,suspectButtons:suspect},null,2));
const cell=s=>String(s??'').replace(/\s+/g,' ').replace(/\|/g,'\\|').replace(/`/g,"'");
const register=['# Admin control source register','',`36 menu destinations; ${cache.size} reachable source files; ${controls.length} control/callback declarations. Static source coverage only: these are not browser click results.`, '', 'Shared components appear once in the file register. Their reuse across pages is recorded in control-inventory.json.'];
for(const [file,data] of [...cache.entries()].sort(([a],[b])=>a.localeCompare(b))) {
  if(!data.controls.length)continue;
  register.push('',`## ${file}`,'','| Line | Component | Label / field | Handler / callback | Disabled / read-only |','|---|---|---|---|---|');
  for(const c of data.controls)register.push(`| ${c.line} | ${cell(c.tag)} | ${cell(c.label||c.label||c['aria-label']||c.placeholder||c.title||c.type).slice(0,140)} | ${cell(c.events.map(e=>e.event+' '+e.handler).join('; ')).slice(0,420)} | ${cell(c.disabled||c.readOnly||'')} |`);
}
fs.writeFileSync(path.join(root,'output/admin-audit/control-register.md'),register.join('\n')+'\n');
console.log(JSON.stringify({pages:pages.map(p=>({id:p.id,file:p.file,controls:p.controls.length,collections:p.collections,endpoints:p.endpoints})),uniqueFiles:cache.size,uniqueControls:controls.length,suspectButtons:suspect},null,2));
// The shared Button delegates handlers through {...rest}; all other raw buttons
// must have a handler or be a form submit. This cannot validate arbitrary callbacks.
if(suspect.some(c=>c.file!=='admin/src/components/ui/Button.tsx'))process.exitCode=1;

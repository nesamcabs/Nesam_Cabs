const fs=require('node:fs'),path=require('node:path'),ts=require('../../driver/web/node_modules/typescript');
const dir=__dirname,inv=JSON.parse(fs.readFileSync(path.join(dir,'inventory.json'),'utf8'));
const numbered=fs.readFileSync(path.join(dir,'reference-numbered.txt'),'utf8');
const html=numbered.split('\n').map(s=>s.replace(/^\d+: /,'')).join('\n');
const start=html.indexOf('<script>')+8,end=html.lastIndexOf('</script>'),js=html.slice(start,end),offset=html.slice(0,start).split('\n').length-1;
const sf=ts.createSourceFile('reference.js',js,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const pos=n=>sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1+offset;
const funcs=[],assignments=[],buttons=[],listeners=[];
function walk(n){
 if(ts.isFunctionDeclaration(n)&&n.name)funcs.push({name:n.name.text,start:pos(n),end:sf.getLineAndCharacterOfPosition(n.end).line+1+offset});
 if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&(ts.isFunctionExpression(n.right)||ts.isArrowFunction(n.right)))assignments.push({name:n.left.getText(sf),line:pos(n),end:sf.getLineAndCharacterOfPosition(n.end).line+1+offset});
 if(ts.isCallExpression(n)&&n.expression.getText(sf)==='B')buttons.push({line:pos(n),args:n.arguments.slice(0,4).map(a=>a.getText(sf))});
 if(ts.isCallExpression(n)&&n.expression.getText(sf).endsWith('.addEventListener'))listeners.push({line:pos(n),target:n.expression.getText(sf),type:n.arguments[0]?.getText(sf)});
 ts.forEachChild(n,walk);
}walk(sf);
const diagnostics=sf.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' '));
fs.writeFileSync(path.join(dir,'structure.json'),JSON.stringify({functions:funcs,assignments,buttons,listeners,syntaxDiagnostics:diagnostics},null,2));
fs.writeFileSync(path.join(dir,'FUNCTION-INDEX.md'),['# Customer reference functions and overrides','',...funcs.map(f=>`- Lines ${f.start}–${f.end}: \`${f.name}\``),'','## Later function assignments','',...assignments.map(f=>`- Lines ${f.line}–${f.end}: \`${f.name}\``)].join('\n'));
fs.writeFileSync(path.join(dir,'CONTROLS.md'),['# Button factory calls','',...buttons.map(b=>`- Line ${b.line}: ${b.args.join(' | ')}`),'','## Listeners','',...listeners.map(l=>`- Line ${l.line}: ${l.target}(${l.type})`)].join('\n'));
const lines=html.split('\n');
const ledger=['# Original source-line index','','Every physical source line is indexed. See the main report for behavioral interpretation and reference-numbered.txt for complete readable source. Embedded binary assets are decoded and hashed in inventory.json.','', '| Line | Area / containing function | Context |','|---|---|---|'];
for(let i=1;i<=lines.length;i++){const l=lines[i-1],f=funcs.find(f=>i>=f.start&&i<=f.end),a=assignments.find(a=>i>=a.line&&i<=a.end);let ctx=l.trim().slice(0,100).replace(/\|/g,'\\|').replace(/</g,'&lt;');ledger.push(`| ${i} | ${f?f.name:a?a.name:i<1559?'CSS / shell / assets':'Script / initialization'} | ${ctx||'Blank'} |`);}
fs.writeFileSync(path.join(dir,'LINE-COVERAGE.md'),ledger.join('\n'));
const behavior=lines.map((l,i)=>{if(i<1558)return '';if(l.includes('const ICON_NODES='))return `${i+1}: [Icon path definitions: indexed separately]`;return `${i+1}: `+l.replace(/<\/?[a-zA-Z][^>]*>/g,tag=>/^<(input|select|textarea|button|form)\b/.test(tag)?tag:' ').replace(/\s{2,}/g,' ');}).filter(Boolean);
for(let a=0;a<behavior.length;a+=200)fs.writeFileSync(path.join(dir,`behavior-${a+1}.txt`),behavior.slice(a,a+200).join('\n'));
console.log(JSON.stringify({functions:funcs.length,overrides:assignments.length,buttonFactoryCalls:buttons.length,listeners:listeners.length,syntaxDiagnostics:diagnostics},null,2));

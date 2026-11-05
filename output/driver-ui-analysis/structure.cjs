const fs=require('node:fs');
const path=require('node:path');
const ts=require('../../driver/web/node_modules/typescript');
const root=__dirname;
const inv=JSON.parse(fs.readFileSync(path.join(root,'inventory.json'),'utf8'));
const html=fs.readFileSync(inv.source,'utf8');
const start=html.indexOf('<script>')+8,end=html.indexOf('</script>',start);
const js=html.slice(start,end),offset=html.slice(0,start).split('\n').length-1;
const ast=ts.createSourceFile('reference.js',js,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const nodes=[];
function visit(n){
  if(ts.isFunctionDeclaration(n)&&n.name){
    const a=ast.getLineAndCharacterOfPosition(n.getStart(ast)).line+1+offset;
    const b=ast.getLineAndCharacterOfPosition(n.end).line+1+offset;
    const body=n.getText(ast);
    nodes.push({name:n.name.text,start:a,end:b,characters:body.length,mentions:[]});
  }
  ts.forEachChild(n,visit);
}
visit(ast);
const body=html.slice(html.indexOf('<style>')+7,html.indexOf('</style>'));
const vars=[...body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map(m=>({name:m[1],value:m[2],line:html.slice(0,html.indexOf('<style>')+7+m.index).split('\n').length}));
const allDeclared=nodes.map(n=>n.name);
for(const f of nodes){const declaration=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===f.name);if(declaration){const body=declaration.body.getText(ast);f.mentions=allDeclared.filter(name=>new RegExp('\\b'+name+'\\s*\\(').test(body));}}
const mentionsOnly=nodes.filter(n=>(js.match(new RegExp('\\b'+n.name+'\\b','g'))||[]).length===1).map(n=>n.name);
const parsed={namedFunctions:nodes,syntaxDiagnostics:ast.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),cssVariables:vars,declaredButNameAppearsOnce:mentionsOnly};
fs.writeFileSync(path.join(root,'structure.json'),JSON.stringify(parsed,null,2));
const index=['# Reference function index','',...nodes.map(n=>`- Lines ${n.start}–${n.end}: \`${n.name}\` (${n.characters} source characters)`),'','Name appears only once in script (static indicator, not a runtime proof): '+mentionsOnly.join(', ')];
fs.writeFileSync(path.join(root,'FUNCTION-INDEX.md'),index.join('\n'));
const lines=html.split(/\r?\n/);if(lines.at(-1)==='')lines.pop();
const ledger=['# Original-line coverage ledger','','Every original line is indexed below. Embedded binary data is decoded and hashed in inventory.json rather than printed as base64. See reference-numbered.txt for the complete readable source and the main analysis for behavioral interpretation.','', '| Original line | Area | Source context |','|---|---|---|'];
for(let i=1;i<=lines.length;i++){
 const line=lines[i-1],f=nodes.find(n=>i>=n.start&&i<=n.end);
 const area=i<=8?'Document metadata':i<=358?'CSS / visual cascade':i<=386?'HTML / SVG definitions':i<=409?'Application shell':i<=686?'JavaScript behavior':'Document closing';
 let context=!line.trim()?'Blank separator':f?'Function '+f.name:line.trim().slice(0,120);
 if(line.includes('data:image/'))context='Embedded JPEG logo plus branding markup; bytes decoded and hashed.';
 if(line.includes('@font-face'))context='Embedded WOFF wordmark font; decoded and hashed.';
 context=context.replace(/\|/g,'\\|').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 ledger.push(`| ${i} | ${area} | ${context} |`);
}
fs.writeFileSync(path.join(root,'LINE-COVERAGE.md'),ledger.join('\n'));
console.log(JSON.stringify({syntaxDiagnostics:parsed.syntaxDiagnostics,namedFunctions:nodes.length,declaredButNameAppearsOnce:mentionsOnly,cssVariables:vars},null,2));

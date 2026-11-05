const fs=require('node:fs'),path=require('node:path');
const postcss=require('../../user/web/node_modules/postcss');
const dir=__dirname,html=fs.readFileSync(path.join(dir,'reference-numbered.txt'),'utf8').split('\n').map(s=>s.replace(/^\d+: /,'')).join('\n');
const head=html.slice(0,html.indexOf('</head>'));
const inventory=[];let text=['# CSS source index','','All top-level stylesheet rules are parsed below in source order. Later rules and media conditions matter; this is not a computed-style or visual audit.',''];
for(const m of head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)){
 const offset=head.slice(0,m.index+ m[0].indexOf('>')+1).split('\n').length-1;
 const ast=postcss.parse(m[1]);
 ast.walkRules(r=>{let media=[],parent=r.parent;while(parent){if(parent.type==='atrule')media.unshift('@'+parent.name+' '+parent.params);parent=parent.parent;}
 const item={line:offset+r.source.start.line,condition:media.join(' > ')||'base',selector:r.selector,declarations:r.nodes.filter(n=>n.type==='decl').map(n=>`${n.prop}: ${n.value}${n.important?' !important':''}`)};inventory.push(item);
 text.push(`## Line ${item.line}: ${item.selector}`,`Condition: ${item.condition}`,'',...item.declarations.map(d=>'- `'+d+'`'),'');});
}
fs.writeFileSync(path.join(dir,'CSS-INDEX.md'),text.join('\n'));
fs.writeFileSync(path.join(dir,'css-inventory.json'),JSON.stringify(inventory,null,2));
console.log(JSON.stringify({rules:inventory.length,conditionalRules:inventory.filter(r=>r.condition!=='base').length,fontFamilyDeclarations:inventory.flatMap(r=>r.declarations.filter(x=>x.startsWith('font-family')).map(x=>({line:r.line,selector:r.selector,value:x}))).slice(-14)},null,2));

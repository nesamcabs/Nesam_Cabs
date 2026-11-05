const fs=require('fs'),path=require('path');
const sharp=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const root=path.join(__dirname,'nesam-visual-assets');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
(async()=>{
const icons=walk(path.join(root,'icons')).filter(p=>p.endsWith('.svg'));
for(const p of icons){const svg=fs.readFileSync(p,'utf8').replaceAll('currentColor','#161616'); await sharp(Buffer.from(svg)).resize(96,96).png().toFile(p.replace('.svg','.png'));}
const cols=8,w=160,h=150;const tiles=[];
for(let i=0;i<icons.length;i++){
const p=icons[i];const png=await sharp(p.replace('.svg','.png')).resize(40,40).toBuffer();
const x=i%cols*w,y=Math.floor(i/cols)*h;
tiles.push({input:png,left:x+60,top:y+24});
const label=path.basename(p,'.svg');const group=path.basename(path.dirname(p));
const text=`<svg width="160" height="50"><text x="80" y="17" text-anchor="middle" font-family="Arial" font-size="10" fill="#161616">${label}</text><text x="80" y="34" text-anchor="middle" font-family="Arial" font-size="9" fill="#667085">${group}</text></svg>`;
tiles.push({input:Buffer.from(text),left:x,top:y+78});
}
fs.mkdirSync(path.join(root,'previews'),{recursive:true});
await sharp({create:{width:cols*w,height:Math.ceil(icons.length/cols)*h,channels:3,background:'#F7F4EE'}}).composite(tiles).jpeg({quality:90}).toFile(path.join(root,'previews','icons.jpg'));
for(const p of walk(path.join(root,'backgrounds')).filter(p=>p.endsWith('.svg')))await sharp(p).resize(p.includes('background')?1280:320).png().toFile(p.replace('.svg','.png'));
console.log(JSON.stringify({svgIcons:icons.length,pngPreviews:icons.length}));
})().catch(e=>{console.error(e);process.exitCode=1});

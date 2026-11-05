from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
import json, shutil, zipfile, csv, html

BASE = Path(__file__).resolve().parent
DEST = BASE / 'nesam-website-images-complete'
OLD = BASE / 'nesam-visual-assets'
DEST.mkdir(exist_ok=True)
records = []

def add(src, rel, origin, prompt_id='', web=True):
    out = DEST / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, out)
    if out.suffix.lower() == '.svg':
        records.append(dict(file=rel, origin=origin, width=24, height=24, alpha='', prompt_id=prompt_id))
        return
    with Image.open(out) as im:
        im.load()
        alpha = im.mode in ('RGBA','LA') and im.getchannel('A').getextrema()[0] < 255
        records.append(dict(file=rel, origin=origin, width=im.width, height=im.height, alpha=alpha, prompt_id=prompt_id))
        if web:
            target = DEST / 'web' / Path(rel).with_suffix('.webp')
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists() or target.stat().st_mtime < src.stat().st_mtime:
                web_im = ImageOps.contain(im, (1600,1600))
                web_im.save(target, 'WEBP', quality=86, method=4)

job_file = BASE / 'website-image-generated-jobs.json'
jobs = json.loads(job_file.read_text('utf-8')) if job_file.exists() else []
for job in jobs:
    name = job['name']
    folder = 'heroes' if name.startswith('hero-') else 'destinations' if name.startswith(('route-','destination-')) else 'features' if name.startswith('feature-') else 'photography' if name.startswith(('service-','trust-','about-')) else 'backgrounds'
    add(Path(job['path']), f'{folder}/{name}.png', 'newly generated', job.get('prompt_id',name))

for src in sorted((OLD/'vehicles').glob('*.png')):
    add(src, f'vehicles/{src.name}', 'existing collection')
for src in sorted((OLD/'illustrations'/'customer').glob('*.png')):
    add(src, f'illustrations/{src.name}', 'existing collection')
for src in sorted((OLD/'icons').rglob('*.svg')):
    add(src, f'icons/{src.relative_to(OLD / "icons").as_posix()}', 'existing vector collection', web=False)
add(OLD/'brand'/'original-logo.png','brand/original-logo.png','original supplied logo',web=False)

decor = DEST/'backgrounds'/'subtle-route.svg'
decor.parent.mkdir(exist_ok=True)
decor.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 900"><rect width="2400" height="900" fill="#fffcfa"/><path d="M1770 880C1840 680 2130 840 2210 650S2340 560 2380 590" fill="none" stroke="#e31e24" stroke-opacity=".12" stroke-width="3"/><circle cx="1770" cy="880" r="9" fill="#17171c" opacity=".08"/><circle cx="2380" cy="590" r="9" fill="#17171c" opacity=".08"/></svg>',encoding='utf-8')
records.append(dict(file='backgrounds/subtle-route.svg', origin='new authored vector', width=2400,height=900,alpha=False,prompt_id='B04'))
shutil.copy2(BASE/'NESAM-website-image-prompts.md',DEST/'PROMPTS-AND-AUDIT.md')
shutil.copy2(job_file,DEST/'generation-log.json')

with (DEST/'manifest.csv').open('w',newline='',encoding='utf-8-sig') as f:
    writer=csv.DictWriter(f,fieldnames=['file','origin','width','height','alpha','prompt_id'])
    writer.writeheader();writer.writerows(records)

# Contact sheets are previews, never a substitute for individual assets.
for group in ['heroes','destinations','photography','features','vehicles','illustrations','backgrounds']:
    items=[r for r in records if r['file'].startswith(group+'/') and r['file'].endswith('.png')]
    if not items: continue
    cols=3; w=1050; ch=245
    sheet=Image.new('RGB',(w,((len(items)+cols-1)//cols)*ch),'#f6f5f3')
    draw=ImageDraw.Draw(sheet)
    for i,r in enumerate(items):
        x=(i%cols)*350;y=(i//cols)*ch
        with Image.open(DEST/r['file']) as im:
            thumb=ImageOps.contain(im.convert('RGBA'),(330,205))
            sheet.paste(thumb,(x+(350-thumb.width)//2,y+(205-thumb.height)//2),thumb)
        draw.text((x+10,y+214),Path(r['file']).stem,fill='#17171c')
    p=DEST/'previews'/f'{group}.jpg';p.parent.mkdir(exist_ok=True)
    sheet.save(p,quality=88)

new_count=sum(r['origin']=='newly generated' for r in records)
readme=f'''# NESAM Travels complete website image collection

{new_count} newly generated raster assets, eight reused vehicle cutouts, 18 reused customer illustrations, original SVG icons across all panels, original supplied logo, and a new authored SVG background.

## Folders
- heroes: desktop, mobile, centered background and family alternative.
- destinations: four current route cards plus six optional destinations.
- photography: service, trust and about-fleet images.
- features: four transparent decorative feature illustrations.
- backgrounds: offer, app promotion, social cover and subtle vector route background.
- vehicles and illustrations: existing generated collection included for completeness.
- icons: existing real SVG paths, grouped by panel; use these for functional UI.
- web: compressed WebP copies of raster assets, scaled down to a maximum 1600-pixel edge where needed.
- previews: labeled contact sheets; use individual files in production.

See manifest.csv for actual image sizes, transparency and provenance. See generation-log.json and PROMPTS-AND-AUDIT.md for prompts and placement guidance. Requested dimensions in the prompt brief are targets; master files retain generator-native dimensions. No image has been falsely upscaled to meet a target. The four hero compositions were generated independently and may feature different vehicles; mobile art is not a pixel-identical crop of the desktop hero.

Generated photography is illustrative, not evidence of actual NESAM staff, fleet or premises. Landmark details should be verified before representing exact architecture. Overlay the original logo, all prices, phone numbers, route labels and ratings separately in the website. No generated customer testimonials or fake app screenshots are included. Website code has not been changed.

Made using the built-in image generation tool. Reused assets are explicitly marked in the manifest.
'''
(DEST/'README.md').write_text(readme,encoding='utf-8')

gallery=['<!doctype html><meta charset="utf-8"><title>NESAM Image Collection</title><style>body{font:16px system-ui;background:#fffcfa;color:#17171c;margin:32px}h1{color:#e31e24}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}figure{margin:0;background:#f6f5f3;padding:14px;border-radius:12px}img{width:100%;height:220px;object-fit:contain}figcaption{overflow-wrap:anywhere;font-size:13px}small{color:#62626d}</style><h1>NESAM Travels image collection</h1><p>Individual assets and provenance. See README.md and manifest.csv for details.</p><div class="grid">']
for r in records:
    if r['file'].endswith('.svg') and r['file'].startswith('icons/'): continue
    escaped=html.escape(r['file'])
    gallery.append(f'<figure><a href="{escaped}"><img loading="lazy" src="{escaped}" alt="{escaped}"></a><figcaption>{escaped}<br><small>{r["width"]} × {r["height"]} · {r["origin"]}</small></figcaption></figure>')
gallery.append('</div>');(DEST/'START-HERE.html').write_text('\n'.join(gallery),encoding='utf-8')

archive=BASE/'NESAM-Complete-Website-Images.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=5) as z:
    for p in sorted(DEST.rglob('*')):
        if p.is_file(): z.write(p,p.relative_to(BASE))
with zipfile.ZipFile(archive) as z:
    bad=z.testzip()
    if bad: raise RuntimeError(bad)
print(json.dumps(dict(zip=str(archive),bytes=archive.stat().st_size,new_images=new_count,assets=len(records),files=len(list(DEST.rglob('*')))),indent=2))

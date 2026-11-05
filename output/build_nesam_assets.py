from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json, csv, zipfile, hashlib, math, html

ROOT = Path(__file__).parent / 'nesam-visual-assets'
def write(path, content):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')

P = lambda d: f'<path d="{d}"/>'
C = lambda x,y,r: f'<circle cx="{x}" cy="{y}" r="{r}"/>'
R = lambda x,y,w,h,rr=2: f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rr}"/>'
home=P('M3 10 12 3 21 10M5 9v12h14V9M9 21v-7h6v7')
person=C(12,7,3)+P('M5 21v-2a7 7 0 0 1 14 0v2')
pin=P('M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z')+C(12,10,2)
car=P('M4 11 6 5h12l2 6M3 11h18v8H3ZM6 19v2M18 19v2M6 14h2M16 14h2')
doc=P('M14 3H5v18h14V8ZM14 3v5h5M8 12h8M8 16h6')
clock=C(12,12,9)+P('M12 7v5l3 2')
wallet=R(3,6,18,14)+P('M4 6V4h14M16 11h5v5h-5Z')+C(18,13.5,.6)
shield=P('M12 3 20 6v6c0 5-8 9-8 9S4 17 4 12V6Z')
check=P('m5 12 4 4 10-10')
camera=R(3,7,18,14)+P('M7 7 9 3h6l2 4')+C(12,14,4)
bank=P('M3 8 12 3 21 8ZM5 10v8M10 10v8M14 10v8M19 10v8M3 21h18M4 18h16')
route=C(5,5,2)+C(19,19,2)+P('M7 5h9a4 4 0 0 1 0 8H8a4 4 0 0 0 0 6h9')
people=C(9,7,3)+P('M3 21v-2a6 6 0 0 1 12 0v2M17 4a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v2')
headset=P('M4 13v-2a8 8 0 0 1 16 0v2M4 12H2v7h4v-7ZM20 12h2v7h-4v-7ZM20 19v2h-6')
calendar=R(3,5,18,16)+P('M7 3v4M17 3v4M3 10h18M7 14h2M13 14h2M7 18h2')
bell=P('M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4M12 2v2')
star=P('m12 3 2.8 5.6 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.5l6.2-.9Z')
phone=P('M7 3H4v3c0 8 6 14 14 14h3v-4l-5-2-2 2a14 14 0 0 1-6-6l2-2Z')
chat=P('M3 4h18v13H9l-6 4ZM7 9h10M7 13h6')
envelope=R(3,5,18,14)+P('m3 6 9 7 9-7')
plus=P('M12 5v14M5 12h14')
minus=P('M5 12h14')
close=P('m6 6 12 12M18 6 6 18')
refresh=P('M20 8a8 8 0 0 0-14-3L3 8M3 3v5h5M4 16a8 8 0 0 0 14 3l3-3M21 21v-5h-5')
info=C(12,12,9)+P('M12 11v6M12 7v.1')
warning=P('M12 3 22 21H2ZM12 9v5M12 17v.1')
lock=R(5,10,14,11)+P('M8 10V7a4 4 0 0 1 8 0v3M12 14v3')
image=R(3,3,18,18)+C(8,8,2)+P('m3 18 6-6 4 4 3-3 5 5')
upload=P('M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6')
download=P('M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4')
receipt=P('M5 3v18l3-2 4 2 4-2 3 2V3l-3 2-4-2-4 2ZM8 9h8M8 13h8M8 17h4')
coin=C(12,12,9)+P('M9 7h6M9 10h6M10 7c5 0 5 6 0 6l5 5')
coupon=P('M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4ZM9 6v2M9 11v2M9 16v2')
gear=C(12,12,3)+P('m10 3 4 0 1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3l-2-2 2-4 3 1 3-1Z')
signal=P('M4 8a12 12 0 0 1 16 0M7 12a8 8 0 0 1 10 0M10 16a3 3 0 0 1 4 0')+C(12,20,.7)
fleet=P('M2 12 4 7h10l2 5M2 12h12v7H2ZM4 19v2M12 19v2M15 4h5l2 5v8h-5M17 8h5M20 17v2')
business=R(4,8,16,13)+P('M8 8V3h8v5M9 12v5M15 12v5M4 15h16')
shapes={
'home':home,'search':C(10,10,7)+P('m15 15 6 6'),'notifications':bell,'profile':person,'settings':gear,
'help':C(12,12,9)+P('M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17v.1'),'support':headset,'chat':chat,'phone':phone,'email':envelope,
'calendar':calendar,'clock':clock,'location-pin':pin,'pickup':pin+P('M9 10h6M12 7v6'),'destination':P('M5 21V3h14l-3 4 3 4H5'),
'route':route,'navigation':P('M3 10 21 3l-7 18-3-8Z'),'current-location':C(12,12,6)+C(12,12,2)+P('M12 1v5M12 18v5M1 12h5M18 12h5'),
'car':car,'fleet':fleet,'driver':person+P('M3 21h18'),'passengers':people,'booking':calendar+P('m13 16 2 2 3-4'),'trip-history':clock,
'receipt':receipt,'wallet':wallet,'payment-card':R(3,5,18,14)+P('M3 10h18M6 15h4'),'bank-transfer':bank,
'earnings':coin,'offers':coupon,'rating':star,'saved-place':P('M6 3h12v18l-6-4-6 4Z'),'document':doc,'document-upload':doc,
'camera':camera,'gallery':image,'verified':shield+P('m8 12 3 3 5-6'),'lock':lock,'otp-security':lock,
'emergency':shield+P('M12 8v6M12 17v.1'),'online':signal,'offline':signal+P('M3 3 21 21'),
'filter':P('M3 4h18l-7 8v8l-4 1v-9Z'),'sort':P('M7 3v18m-4-4 4 4 4-4M14 5h7M14 10h5M14 15h3'),
'refresh':refresh,'download':download,'share':C(5,12,3)+C(19,5,3)+C(19,19,3)+P('m8 11 8-5M8 13l8 5'),
'edit':P('m4 16-1 5 5-1L21 7l-5-5ZM14 4l5 5'),'add':plus,'remove':minus,'close':close,'check':check,'warning':warning,'information':info,
'success':C(12,12,9)+P('m7 12 3 3 7-7'),'error':C(12,12,9)+P('m8 8 8 8M16 8l-8 8'),
'more-options':C(5,12,1)+C(12,12,1)+C(19,12,1),'logout':P('M10 3H3v18h7M9 12h12m-4-4 4 4-4 4'),
'chevron-left':P('m15 5-7 7 7 7'),'chevron-right':P('m9 5 7 7-7 7'),'chevron-up':P('m5 15 7-7 7 7'),'chevron-down':P('m5 9 7 7 7-7'),
'external-link':P('M14 3h7v7M21 3 10 14M10 3H3v18h18v-7'),'expand':P('M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6'),
'collapse':P('M9 3v6H3M15 3v6h6M21 15h-6v6M3 15h6v6')}
groups={'shared':{k:k for k in shapes},
'customer':{'one-way':'navigation','round-trip':'refresh','local-rental':'clock','outstation':'route','tour-package':'fleet','luggage':'business','air-conditioning':'settings','vehicle-seats':'passengers','cancellation':'close','favourite':'rating','trip-tracking':'current-location'},
'driver':{'duty-status':'online','available-trip':'route','accept-trip':'check','reached-pickup':'pickup','trip-started':'navigation','trip-completed':'success','boarding-verification':'verified','vehicle-inspection':'car','front-vehicle-photo':'camera','rear-vehicle-photo':'camera','interior-vehicle-photo':'gallery','toll':'bank-transfer','fuel':'wallet','driving-licence':'profile','vehicle-registration':'document','insurance':'verified','payout':'bank-transfer'},
'vendor':{'fleet-overview':'fleet','add-vehicle':'car','driver-management':'passengers','driver-invitation':'email','assign-driver':'driver','vehicle-availability':'online','maintenance':'settings','document-expiry':'calendar','marketplace-bid':'offers','commission':'earnings','settlement':'bank-transfer','business-profile':'document','team':'passengers'}}
# Distinct task-specific geometry; shared metaphors are intentionally reused.
shapes.update({'luggage':R(6,7,12,13)+P('M9 7V3h6v4M9 10v7M15 10v7M8 20v2M16 20v2'),
'seat':P('M7 3v10h11v7H5V10M7 10h8V5M5 20v2M18 20v2'),
'snow':P('M12 3v18M4 7l16 10M4 17 20 7M9 5l3 3 3-3M9 19l3-3 3 3'),
'fuel':R(3,4,11,17)+P('M6 7h5v5H6ZM14 9h3v8a2 2 0 0 0 4 0V9l-4-4M18 6v5h3'),
'tool':P('M14 3a6 6 0 0 0-6 8l-6 6 5 5 6-6a6 6 0 0 0 8-6l-4 4-5-5 4-4Z'),
'licence':R(3,5,18,14)+C(8,10,2)+P('M5 16a3 3 0 0 1 6 0M14 9h4M14 13h4M14 16h2'),
'front-car':P('M5 10 7 4h10l2 6M4 10h16v10H4ZM6 13h3M15 13h3M7 17h10M6 20v2M18 20v2'),
'rear-car':P('M5 10 7 4h10l2 6M4 10h16v10H4ZM6 13h3M15 13h3M9 17h6M6 20v2M18 20v2'),
'toll':P('M3 21V5h4v16M7 7h14M10 7l3 4M16 7l3 4M10 21V15h10v6'),
'heart':P('M12 21 3 12a5.5 5.5 0 0 1 9-7 5.5 5.5 0 0 1 9 7Z'),
'transfer':P('M3 7h16m-4-4 4 4-4 4M21 17H5m4-4-4 4 4 4'),
'bid':P('m14 3 7 7-4 4-7-7ZM12 9 3 18l3 3 9-9M14 21h8'),
'percent':P('m5 19 14-14')+C(6,6,3)+C(18,18,3)})
groups['customer'].update({'luggage':'luggage','vehicle-seats':'seat','air-conditioning':'snow','favourite':'heart'})
groups['driver'].update({'front-vehicle-photo':'front-car','rear-vehicle-photo':'rear-car','fuel':'fuel','driving-licence':'licence','toll':'toll','payout':'transfer'})
groups['vendor'].update({'maintenance':'tool','marketplace-bid':'bid','commission':'percent','settlement':'transfer','business-profile':'document'})
for group,items in groups.items():
    for name,key in items.items():
        shape=shapes[key]
        if name=='add-vehicle': shape=car+P('M19 1v5M16.5 3.5h5')
        if name=='vehicle-inspection': shape=car+C(17,6,3)+P('m19 8 3 3')
        if name=='document-expiry': shape=doc+C(17,17,5)+P('M17 14v3l2 1')
        if name=='driver-invitation': shape=envelope+P('M18 1v6M15 4h6')
        if name=='assign-driver': shape=person+P('M17 11h5m-3-3 3 3-3 3')
        if name=='document-upload': shape=P('M13 3H4v18h16V9M13 3v6h7M8 16v-4m-3 3 3-3 3 3')
        write(f'icons/{group}/{name}.svg',f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{shape}</svg>')

# Genuine vector patterns, designed as repeating tiles.
patterns={
'route-pattern':('<path d="M-20 20h70a30 30 0 0 1 0 60H10a30 30 0 0 0 0 60h170"/>','#E5D8D5'),
'location-pin-pattern':('<path d="M90 60c0 18-20 34-20 34S50 78 50 60a20 20 0 1 1 40 0Z"/><circle cx="70" cy="60" r="6"/>','#E8DCD8'),
'fleet-road-pattern':('<path d="M0 110h160M0 118h160"/><path d="m38 70 8-20h42l8 20v22H38ZM48 92v6M86 92v6M48 78h8M78 78h8"/>','#E0DEDB'),
'light-background':('<path d="M-40 200Q140-40 320 100T680 50"/><path d="M-20 220Q140-20 320 120T700 70"/>','#E9E1DE'),
'dark-background':('<path d="M-40 200Q140-40 320 100T680 50"/><path d="M-20 220Q140-20 320 120T700 70"/>','#37302F')}
for name,(body,color) in patterns.items():
    w,h=(640,360) if 'background' in name else (160,160)
    bg='#181818' if name=='dark-background' else '#F7F4EE'
    write(f'backgrounds/{name}.svg',f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"><rect width="{w}" height="{h}" fill="{bg}"/><g fill="none" stroke="{color}" stroke-width="1.5">{body}</g></svg>')

write('brand/style-guide.md','''# NESAM visual asset guide

Original logo: `brand/original-logo.png` is copied without alteration. It has its supplied white background; it is not a transparent logo. Use a white tile on dark surfaces.

## Palette
Brand red: #EF0000. Charcoal: #161616. Warm ivory: #F7F4EE. Slate: #667085. Success: #18854B. Warning: #B7791F. The logo includes tonal red variations; the chosen token represents its vivid red appearance.

## Usage
Icons are genuine authored SVG, 24-unit viewBox, 1.8-unit stroke, rounded caps, `currentColor`. Shared metaphors intentionally recur in task-specific folders. Use 20/24/32 CSS pixels; include accessible labels on controls. Decorative illustrations never replace textual statuses. Some generated illustrations may vary in rendering detail; inspect fit before release.

Keep imagery subordinate to booking, navigation and trip actions. Use ivory/white surfaces and charcoal body text. Red is an accent; do not use it for small normal text on low-contrast backgrounds without checking contrast. Semantic green/amber must accompany readable labels.

Generated people, vehicles and scenes are illustrative, not actual employees, customers, assigned vehicles or verified destinations. Images contain no intentional textual labels or reconstructed brand logos.

Typography recommendation: use the application's readable sans-serif family; 15–16px body, 24–32px page titles, comfortable line-height. All headings and labels belong in live UI, not baked into imagery.

Raster images retain generated dimensions and original alpha. See manifest for actual dimensions. Contact sheets are review previews only. SVG backgrounds are restrained decorative motifs; route and fleet tiles continue across horizontal boundaries. Do not assume all backgrounds repeat seamlessly in both axes.
''')

def sheet(files,name,cols=5):
    cellw,cellh=240,260
    canvas=Image.new('RGB',(cols*cellw,math.ceil(len(files)/cols)*cellh),'#F7F4EE')
    draw=ImageDraw.Draw(canvas)
    for i,p in enumerate(files):
        im=Image.open(p).convert('RGBA'); im.thumbnail((220,210))
        x=(i%cols)*cellw; y=(i//cols)*cellh
        canvas.paste(im,(x+(cellw-im.width)//2,y+(220-im.height)//2),im)
        label=p.stem.replace('-',' ')
        draw.text((x+10,y+222),label[:32],fill='#161616')
    dest=ROOT/'previews'/name; dest.parent.mkdir(parents=True,exist_ok=True);canvas.save(dest)

def package():
    for directory in ['illustrations/customer','illustrations/driver','illustrations/vendor','vehicles','stickers','photography']:
        files=sorted((ROOT/directory).glob('*.png'))
        if files: sheet(files,directory.replace('/','-')+'.jpg',4 if directory=='photography' else 5)
    rows=[]
    for p in sorted(ROOT.rglob('*')):
        if not p.is_file() or 'asset-manifest' in p.parts: continue
        rel=p.relative_to(ROOT).as_posix(); parts=rel.split('/'); row={'filename':rel,'panel':next((x for x in parts if x in ['customer','driver','vendor']),'shared'),'placement':p.stem.replace('-',' '),'format':p.suffix[1:],'width':'','height':'','transparency':'not applicable','bytes':p.stat().st_size}
        if p.suffix.lower() in ['.png','.jpg','.webp']:
            im=Image.open(p); row.update(width=im.width,height=im.height)
            row['transparency']=bool('A' in im.getbands() and im.getchannel('A').getextrema()[0]<255)
        elif p.suffix=='.svg': row.update(width=24 if 'icons' in parts else 'viewBox',height=24 if 'icons' in parts else 'viewBox',transparency='vector background' if 'backgrounds' in parts else True)
        rows.append(row)
    write('asset-manifest/manifest.json',json.dumps(rows,indent=2))
    dest=ROOT/'asset-manifest/manifest.csv'
    with dest.open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    zip_path=ROOT.parent/'nesam-visual-assets.zip'
    with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(ROOT.rglob('*')):
            if p.is_file(): z.write(p,Path('nesam-visual-assets')/p.relative_to(ROOT))
    with zipfile.ZipFile(zip_path) as z: assert z.testzip() is None
    print(json.dumps({'files':len(rows),'zip':str(zip_path),'zip_mb':round(zip_path.stat().st_size/1024/1024,1)}))

if __name__=='__main__': package()

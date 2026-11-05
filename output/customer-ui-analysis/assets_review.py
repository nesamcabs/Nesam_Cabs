from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
import json
p=Path(__file__).parent
items=json.loads((p/'inventory.json').read_text())['embedded']
result=[]
sheet=Image.new('RGB',(1000,3*210),'#eef1f4'); draw=ImageDraw.Draw(sheet)
n=0
for item in items:
    f=p/item['file']
    if item['media'].startswith('font/'):
        result.append(dict(file=f.name,bytes=f.stat().st_size,note='Font family declarations are recorded from CSS; internal font names not inspected.'))
    else:
        im=Image.open(f)
        result.append(dict(file=f.name,size=im.size,mode=im.mode))
        thumb=ImageOps.contain(im.convert('RGBA'),(225,165))
        x=(n%4)*250;y=(n//4)*210
        sheet.paste(thumb,(x+(250-thumb.width)//2,y),thumb)
        draw.text((x+8,y+171),f.name,fill='#222222')
        draw.text((x+8,y+188),str(im.size),fill='#555555'); n+=1
sheet.save(p/'ASSET-CONTACT-SHEET.jpg')
(p/'asset-metadata.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))

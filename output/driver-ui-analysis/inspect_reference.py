from pathlib import Path
import re, json, hashlib, base64

source = Path(r'C:\Users\User\AppData\Local\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\sessions\D7D63B2FDAD1E6D555CC68856B66F53BB992169A\transfers\2026-42\Nesam_Driver_App_UX_Updated.html')
dest = Path(__file__).parent
raw = source.read_bytes()
text = raw.decode('utf-8-sig')
lines = text.splitlines()
payloads=[]
def replace_data(m):
    media, encoded = m.group(1), m.group(2)
    decoded = base64.b64decode(encoded)
    record={'media':media,'encoded_chars':len(encoded),'decoded_bytes':len(decoded),'sha256':hashlib.sha256(decoded).hexdigest()}
    payloads.append(record)
    if media.startswith('image/'):
        (dest / ('embedded-logo-'+str(len(payloads))+'.'+media.split('/')[1])).write_bytes(decoded)
    elif media == 'font/woff':
        (dest / 'embedded-wordmark.woff').write_bytes(decoded)
    return '[EMBEDDED '+media+'; '+str(len(decoded))+' bytes; SHA256 '+record['sha256']+']'
clean=re.sub(r'data:([^;,]+);base64,([A-Za-z0-9+/=]+)',replace_data,text)
clean_lines=clean.splitlines()
(dest/'reference-numbered.txt').write_text('\n'.join(f'{i}: {s}' for i,s in enumerate(clean_lines,1)),encoding='utf-8')
for a,b,name in [(1,120,'css-01'),(121,240,'css-02'),(241,409,'css-03-shell'),(410,505,'script-01'),(506,582,'script-02'),(583,688,'script-03')]:
    (dest/(name+'.txt')).write_text('\n'.join(f'{i}: {clean_lines[i-1]}' for i in range(a,min(b,len(clean_lines))+1)),encoding='utf-8')
functions=[]
for i,line in enumerate(lines,1):
    for m in re.finditer(r'(?:async\s+)?function\s+(\w+)\s*\(',line): functions.append({'name':m[1],'line':i})
actions=sorted(set(re.findall(r'data-action=[\'"]([a-zA-Z][a-zA-Z0-9-]+)[\'"]',text)))
symbols=re.findall(r'<symbol\b[^>]*id=[\'"]([^\'"]+)',text)
inventory={'source':str(source),'line_count':len(lines),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'functions':functions,'literal_actions':actions,'svg_symbols':symbols,'embedded_payloads':payloads,'media_queries':sorted(set(re.findall(r'@media[^\{]+',text)))}
(dest/'inventory.json').write_text(json.dumps(inventory,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps({k:v for k,v in inventory.items() if k not in ['functions','literal_actions','embedded_payloads']},ensure_ascii=False,indent=2))
print('Functions:',len(functions),'literal actions:',len(actions),'embedded payloads:',len(payloads))

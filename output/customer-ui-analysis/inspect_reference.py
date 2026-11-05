from pathlib import Path
import re,json,hashlib,base64
src=Path(r'C:\Users\User\AppData\Local\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\sessions\D7D63B2FDAD1E6D555CC68856B66F53BB992169A\transfers\2026-43\Nesam_Customer_App_Outstation_UX.html')
dest=Path(__file__).parent
raw=src.read_bytes(); text=raw.decode('utf-8-sig'); payloads=[]
def redact(m):
    media,encoded=m[1],m[2]; data=base64.b64decode(encoded); digest=hashlib.sha256(data).hexdigest()
    suffix=media.split('/')[-1]; p=dest/f'embedded-{len(payloads)+1}.{suffix}'
    p.write_bytes(data)
    payloads.append(dict(media=media,bytes=len(data),sha256=digest,file=p.name))
    return f'[EMBEDDED {media}: {len(data)} bytes; SHA256 {digest}]'
clean=re.sub(r'data:([^;,]+);base64,([A-Za-z0-9+/=]+)',redact,text)
lines=clean.splitlines()
(dest/'reference-numbered.txt').write_text('\n'.join(f'{i}: {s}' for i,s in enumerate(lines,1)),encoding='utf-8')
for start in range(1,len(lines)+1,350):
    end=min(start+349,len(lines));(dest/f'lines-{start:04d}-{end:04d}.txt').write_text('\n'.join(f'{i}: {lines[i-1]}' for i in range(start,end+1)),encoding='utf-8')
inventory=dict(source=str(src),bytes=len(raw),lines=len(lines),sha256=hashlib.sha256(raw).hexdigest(),embedded=payloads,scripts=[dict(line=clean[:m.start()].count('\n')+1,characters=len(m[1])) for m in re.finditer(r'<script\b[^>]*>(.*?)</script>',clean,re.S)],style_blocks=[dict(line=clean[:m.start()].count('\n')+1,characters=len(m[1])) for m in re.finditer(r'<style\b[^>]*>(.*?)</style>',clean,re.S)],media_queries=sorted(set(re.findall(r'@media[^\{]+',clean))),functions=[dict(name=m[1],line=clean[:m.start()].count('\n')+1) for m in re.finditer(r'(?:async\s+)?function\s+(\w+)\s*\(',clean)],actions=sorted(set(re.findall(r'data-action=[\'"]([\w-]+)[\'"]',clean))))
(dest/'inventory.json').write_text(json.dumps(inventory,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in inventory.items() if k not in ['functions','actions','embedded']},indent=2))
print('FUNCTIONS',len(inventory['functions']),'ACTIONS',len(inventory['actions']))
for p in payloads:print(p)
for i,line in enumerate(lines,1):
    if re.search(r'<(?:script|style)|</(?:script|style)>|function\s+\w+|^\s*(?:const|let)\s+(?:state|STATE|screens|routes|SERVICES|CITIES|STORAGE)',line): print(f'{i}: {line[:170]}')

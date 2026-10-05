from pathlib import Path
import json,re,xml.etree.ElementTree as E
P=Path(__file__).parent;(P/'svg').mkdir(exist_ok=True)
NS='http://www.w3.org/2000/svg';E.register_namespace('',NS)
members={m['id']:m for m in json.loads((P/'members.json').read_text())}
cache={}
for record in json.loads((P/'render-inputs.json').read_text()):
 m,t,s,size=record['member'],record['theme'],record['state'],record['size'];root=E.fromstring(record['svg']);root.attrib.pop('style',None);root.set('overflow','hidden')
 shell='#e9e1d4' if t=='dark' else '#d8ccba';outline='#24211e' if t=='dark' else '#3b3731';status='#f2eee9' if t=='dark' else '#34302b';bg='#1f1d1b' if t=='dark' else '#f5f2ed'
 for el in root.iter():
  cl=el.get('class','').split()
  if 'stack-shell' in cl or 'stack-accent' in cl:el.attrib.update(fill=shell if 'stack-shell' in cl else '#97ad9a',stroke=outline,**{'stroke-width':'1.1','stroke-linejoin':'round'})
  if 'stack-joint' in cl or 'stack-feature' in cl:el.set('fill','#24221f')
  if 'stack-feature-line' in cl:el.attrib.update(fill='none',stroke='#24221f',**{'stroke-width':'1.9','stroke-linecap':'round','stroke-linejoin':'round'})
  if 'stack-body' in cl and size<=36:el.set('transform',members[m]['crop'].replace('px',''))
  if 'stack-character' in cl and s=='exited':el.set('opacity','.48')
  if 'stack-face' in cl:
   if 'stack-face--'+s not in cl:el.set('display','none')
   elif s=='working':el.set('transform','translate(0 .65)')
  if 'stack-status-bg' in cl:el.set('fill','#d97757' if s=='needs-you' else bg)
  if 'stack-mark' in cl:
   if 'stack-mark--'+s not in cl:el.set('display','none')
   el.attrib.update(fill='none',stroke='#24221f' if s=='needs-you' else status,**{'stroke-width':'2.4','stroke-linecap':'round','stroke-linejoin':'round'})
 svg=E.tostring(root,encoding='unicode');cache[(m,t,s,size)]=svg
 (P/'svg'/f'{m}-{s}-{t}-{size}.svg').write_text(svg)
def tx(x,y,v,size=13,color='#f2eee9'):return f'<text x="{x}" y="{y}" font-family="sans-serif" font-size="{size}" fill="{color}">{v}</text>'
def at(svg,x,y):return f'<g transform="translate({x},{y})">{svg}</g>'
for size in [32,48]:
 out=f'<svg xmlns="{NS}" width="1100" height="1160" viewBox="0 0 1100 1160"><rect width="1100" height="1160" fill="#141312"/>'+tx(25,38,f'STACK native SVG / {size}px / all 12 members and 5 states',23)+tx(25,65,'32px uses upper-body fallback. 48px uses full-body anatomy. Static canonical frames; no browser timing claim.',12,'#b1a99d')
 for ti,t in enumerate(['dark','light']):
  x=25+ti*535;bg='#1f1d1b' if t=='dark' else '#f5f2ed';fg='#f2eee9' if t=='dark' else '#24221f'
  out+=f'<rect x="{x}" y="90" width="515" height="1035" rx="12" fill="{bg}"/>'+tx(x+16,120,t.title(),16,fg)
  for si,state in enumerate(['producing','working','needs-you','idle','exited']):out+=tx(x+112+si*81,150,state.replace('-',' '),10,fg)
  for mi,m in enumerate(members):
   y=174+mi*77;out+=tx(x+14,y+size*.65,m,11,fg)
   for si,s in enumerate(['producing','working','needs-you','idle','exited']):out+=at(cache[(m,t,s,size)],x+122+si*80,y)
 out+='</svg>';(P/f'proof-all-states-{size}.svg').write_text(out)
out=f'<svg xmlns="{NS}" width="1100" height="430" viewBox="0 0 1100 430"><rect width="1100" height="430" fill="#141312"/>'+tx(25,38,'STACK / native anatomy and 32px fallback',24)+tx(25,66,'Twelve builds preserve different proportions. Project color is shared across the entire family here.',13,'#b1a99d')
for i,m in enumerate(members):
 x=25+i%6*178;y=100+i//6*151
 large=cache[(m,'dark','producing',48)].replace('width="48" height="48"','width="80" height="80"')
 out+=at(large,x,y)+at(cache[(m,'dark','producing',32)],x+95,y+35)+tx(x,y+105,m,12)
out+='</svg>';(P/'native-family-proof.svg').write_text(out)
print('240 self-contained static SVG exports plus matrices generated')

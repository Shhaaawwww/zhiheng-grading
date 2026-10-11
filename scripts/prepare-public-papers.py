from pathlib import Path
import json,hashlib
from datetime import datetime,timezone
import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import Image,ImageFilter,ImageDraw
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

root=Path(__file__).resolve().parents[1]
out=root/'output/real-api/public-papers-20260908'
cases=[
 {'id':'national1-2024','title':'2024年高考新课标I卷（网络整理版）','pages':4,'url':'https://static-gkcx.gaokao.cn/upload/zhenti/20240611/1718078152_5550.pdf','paperMax':150,'printedMarks':[5]*8+[6]*3+[5]*3+[None]*5,'teacherMarks':[5]*8+[6]*3+[5]*3+[13,15,15,17,17],'questionPages':[1]*6+[2]*5+[3]*6+[4]*2,'types':['choice']*8+['multiple']*3+['fill']*3+['solve']*5},
 {'id':'national2-2024','title':'2024年高考新课标II卷（网络整理版）','pages':6,'url':'https://static-gkcx.gaokao.cn/upload/zhenti/20240609/1717916773_9867.pdf','paperMax':None,'printedMarks':[None]*19,'teacherMarks':[5]*8+[6]*3+[5]*3+[13,15,15,17,17],'questionPages':[1]*4+[2]*5+[3]*5+[4]*3+[5,6],'types':['choice']*8+['multiple']*3+['fill']*3+['solve']*5},
 {'id':'haidian-2024','title':'2024年1月北京海淀高二期末数学','pages':3,'url':'https://cdn.gaokzx.com/zixunzhan/202403/b67ffbbe-abee-4c7c-8630-5f73d5cde19d.pdf','paperMax':100,'printedMarks':[4]*15+[10]*4,'teacherMarks':[4]*15+[10]*4,'questionPages':[1]*8+[2]*8+[3]*3,'types':['choice']*10+['fill']*5+['solve']*4},
]
for case in cases:
 d=out/case['id'];f=d/'source.pdf';raw=f.read_bytes();doc=pdfium.PdfDocument(str(f))
 case.update(sourcePages=len(doc),sourceSha256=hashlib.sha256(raw).hexdigest(),retrievedAt=datetime.now(timezone.utc).isoformat(),sourceQuestionPages=list(range(1,case['pages']+1)),referenceOnlyPages=list(range(case['pages']+1,len(doc)+1)))
 texts=[p.extract_text() or '' for p in PdfReader(f).pages]
 (d/'local-reference-text.txt').write_text('\n'.join(f'\nPAGE {i+1}\n'+t for i,t in enumerate(texts)),encoding='utf-8')
 for variant in ['clean']+(['degraded'] if case['id']=='haidian-2024' else []):
  dest=d/variant;dest.mkdir(exist_ok=True);pdf=canvas.Canvas(str(dest/'试卷题面-纯图片.pdf'));thumbs=[];images=[]
  for i in range(case['pages']):
   p=doc[i];w,h=p.get_size();size=1800 if variant=='clean' else 900
   im=p.render(scale=size/w).to_pil().convert('L')
   if variant=='degraded': im=im.rotate(1.2 if i%2==0 else -1.0,resample=Image.Resampling.BICUBIC,expand=False,fillcolor=255).filter(ImageFilter.GaussianBlur(.6))
   image=dest/f'page-{i+1}.jpg';im.save(image,quality=90 if variant=='clean' else 58)
   pdf.setPageSize((w,h));pdf.drawImage(ImageReader(str(image)),0,0,width=w,height=h);pdf.showPage()
   images.append({'file':image.name,'width':im.width,'height':im.height,'sha256':hashlib.sha256(image.read_bytes()).hexdigest()})
   im=im.convert('RGB');im.thumbnail((395,550));tile=Image.new('RGB',(415,585),'#e9edef');tile.paste(im,((415-im.width)//2,10));ImageDraw.Draw(tile).text((12,565),f'Page {i+1}',fill='black');thumbs.append(tile)
  pdf.save();r=PdfReader(dest/'试卷题面-纯图片.pdf');assert sum(len(p.extract_text() or '') for p in r.pages)==0
  contact=Image.new('RGB',(415*min(3,len(thumbs)),585*((len(thumbs)+2)//3)),'white')
  for i,t in enumerate(thumbs): contact.paste(t,((i%3)*415,(i//3)*585))
  contact.save(dest/'contact.png')
  (dest/'image-manifest.json').write_text(json.dumps({'variant':variant,'textLayerCharacters':0,'images':images},ensure_ascii=False,indent=2),encoding='utf-8')
 (d/'source.json').write_text(json.dumps(case,ensure_ascii=False,indent=2),encoding='utf-8')
(out/'cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf-8')
print('Prepared 3 genuine public papers and 1 degraded variant; no answer pages in image inputs.')

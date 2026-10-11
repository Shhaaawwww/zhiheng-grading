from pathlib import Path
import json,hashlib
import pypdfium2 as pdfium
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[1]
out=root/'output/real-api/release-020-round2'
out.mkdir(parents=True,exist_ok=True)
old=root/'output/real-api/public-papers-20260908'
cases=[]
for c in json.loads((old/'cases.json').read_text(encoding='utf-8')):
 for variant in ['clean']+(['degraded'] if c['id']=='haidian-2024' else []):
  cases.append(dict(c,caseId=c['id']+'-'+variant,pdf=str(old/c['id']/variant/'试卷题面-纯图片.pdf'),variant=variant))
source=root/'output/real-api/release-020/sources/national-a-2024.pdf'
d=out/'national-a-2024-clean';d.mkdir(exist_ok=True)
doc=pdfium.PdfDocument(str(source));pdf=canvas.Canvas(str(d/'试卷题面-纯图片.pdf'));thumbs=[]
for i in range(5):
 p=doc[i];w,h=p.get_size();im=p.render(scale=1800/w).to_pil().convert('L');f=d/f'page-{i+1}.jpg';im.save(f,quality=90)
 pdf.setPageSize((w,h));pdf.drawImage(ImageReader(str(f)),0,0,width=w,height=h);pdf.showPage()
 im=im.convert('RGB');im.thumbnail((400,560));tile=Image.new('RGB',(420,590),'white');tile.paste(im,((420-im.width)//2,0));ImageDraw.Draw(tile).text((10,570),f'Page {i+1}',fill='black');thumbs.append(tile)
pdf.save();assert not any(p.extract_text() for p in PdfReader(d/'试卷题面-纯图片.pdf').pages)
contact=Image.new('RGB',(1260,1180),'#ddd')
for i,t in enumerate(thumbs):contact.paste(t,((i%3)*420,(i//3)*590))
contact.save(d/'contact.png')
case={'id':'national-a-2024','caseId':'national-a-2024-clean','title':'2024全国甲卷理科数学（网络整理版）','variant':'clean','pdf':str(d/'试卷题面-纯图片.pdf'),'url':'https://static-gkcx.gaokao.cn/upload/zhenti/20240826/1724667231_6668.pdf','pages':5,'sourcePages':8,'sourceQuestionPages':[1,2,3,4,5],'referenceOnlyPages':[6,7,8],'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'teacherMarks':[5]*16+[12]*5+[10]*2,'paperMax':None,'optionalQuestions':['22','23'],'testSelectedOption':'22','scopeNote':'模拟全班统一选做22题，23题在核对时取消计分；不混算两道选考题。'}
cases.append(case)
(out/'cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf-8')
print('Prepared 5 inputs from 4 public papers; answer pages excluded; all PDFs have no text layer.')

"""Render public exam/real handwriting to image-only PDFs. Commentary is held out."""
from pathlib import Path
import json, hashlib
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image, ImageFilter, ImageEnhance

root=Path('output/real-api/release-030')
sources=root/'sources'
cases=[
 dict(id='ap25-q5',title='2025 AP Calculus AB Q5',paper='ap25-questions.pdf',page=8,reference=[2,3,4,5],samples=[[6,7],[8,9],[10,11]],points=[[1]*9,[1,1,0,0,0,0,1,1,0],[1,0,1,0,0,0,1,0,0]],parts=[2,3,1,3],commentary=[12,13]),
 dict(id='ap25-q6',title='2025 AP Calculus AB Q6',paper='ap25-questions.pdf',page=9,reference=[2,3,4,5],samples=[[6,7],[8,9],[10,11]],points=[[1]*9,[1,1,1,0,1,1,1,0,0],[1,1,0,0,1,0,0,0,0]],parts=[2,2,2,3],commentary=[12,13]),
 dict(id='ap24-q6',title='2024 AP Calculus AB Q6',paper='ap24-questions.pdf',page=10,reference=[2,3,4],samples=[[5,6],[7,8],[9,10]],points=[[1]*9,[1,1,1,1,0,0,1,0,1],[1,1,0,1,0,0,0,0,0]],parts=[2,4,3],commentary=[11,12]),
]
def render(file,pages):
 doc=pdfium.PdfDocument(sources/file)
 result=[]
 for p in pages:
  page=doc[p-1]; im=page.render(scale=2.8).to_pil().convert('RGB'); result.append(im.copy()); page.close()
 doc.close();return result
def save_pdf(images,target):
 target.parent.mkdir(parents=True,exist_ok=True)
 images[0].save(target,save_all=True,append_images=images[1:],resolution=201.6)
 assert all(not p.extract_text().strip() for p in PdfReader(target).pages)
 return str(target.resolve())
for c in cases:
 d=root/'fixtures'/c['id'];d.mkdir(parents=True,exist_ok=True)
 c['paperPdf']=save_pdf(render(c['paper'],[c['page']]),d/'原卷-图片版.pdf')
 c['referencePdf']=save_pdf(render(c['id']+'.pdf',c['reference']),d/'参考标准-图片版.pdf')
 c['studentPdfs']=[]
 for i,pages in enumerate(c['samples']):
  images=render(c['id']+'.pdf',pages)
  c['studentPdfs'].append(save_pdf(images,d/f'00{i+1}.pdf'))
  if i==1:
   variants=[ImageEnhance.Contrast(im.convert('L').resize((int(im.width*.72),int(im.height*.72))).filter(ImageFilter.GaussianBlur(.45))).enhance(.75).convert('RGB') for im in images]
   c['degradedPdf']=save_pdf(variants,d/'退化扫描-B.pdf')
   c['rotatedPdf']=save_pdf([im.rotate(90,expand=True) for im in images],d/'横转扫描-B.pdf')
   c['missingPagePdf']=save_pdf(images[:1],d/'缺续页-B.pdf')
  images[0].thumbnail((1000,1400));images[0].save(d/f'preview-{i+1}.jpg')
 reader=PdfReader(sources/(c['id']+'.pdf'))
 (d/'heldout-official-commentary.txt').write_text('\n'.join(reader.pages[p-1].extract_text() for p in c['commentary']),encoding='utf8')
 c['expectedTotals']=[sum(p) for p in c['points']]
 c['provenance']='Official independent student samples A/B/C, not the same pupils across questions; no representative class claims.'
(root/'fixtures.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps([{'id':c['id'],'scores':c['expectedTotals'],'paperPage':c['page']} for c in cases]))

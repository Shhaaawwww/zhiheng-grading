from pathlib import Path
import json
import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[1]
out=root/'output/real-api/release-020-round2'
review=out/'pdf-review';review.mkdir(exist_ok=True)
files=sorted(out.glob('*/final-*.pdf'))+[root/'public/help/知衡-教师上手指南.pdf']
results=[];tiles=[]
for i,file in enumerate(files):
 doc=pdfium.PdfDocument(str(file));r=PdfReader(file);text='\n'.join(p.extract_text() or '' for p in r.pages)
 issues=[s for s in ['undefined','NaN','null'] if s in text]
 if file.name.startswith('final-模拟') and len(doc)!=1:issues.append('personal action card exceeds one page')
 if not text.strip():issues.append('no extractable text')
 results.append({'file':str(file.relative_to(root)),'pages':len(doc),'issues':issues})
 for page_no in range(len(doc)):
  im=doc[page_no].render(scale=1.4).to_pil().convert('RGB');im.save(review/f'{i:02d}-{page_no+1}.png')
  im.thumbnail((260,370));tile=Image.new('RGB',(280,410),'white');tile.paste(im,((280-im.width)//2,0));ImageDraw.Draw(tile).text((8,382),f'File {i:02d} / Page {page_no+1}',fill='black');tiles.append(tile)
for start in range(0,len(tiles),12):
 group=tiles[start:start+12];contact=Image.new('RGB',(1120,410*((len(group)+3)//4)),'#ddd')
 for j,tile in enumerate(group):contact.paste(tile,((j%4)*280,(j//4)*410))
 contact.save(review/f'contact-{start//12+1}.png')
(review/'verification.json').write_text(json.dumps({'files':results,'ok':all(not r['issues'] for r in results)},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pdfs':len(files),'pages':sum(r['pages'] for r in results),'issues':[r for r in results if r['issues']]},ensure_ascii=False))
assert all(not r['issues'] for r in results)

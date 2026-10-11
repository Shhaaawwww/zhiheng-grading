"""Render exported report pages and the guide for visual review; never use source PDFs as grading text."""
from pathlib import Path
import json
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parents[1]
out=root/'output/pdf-review-030';out.mkdir(exist_ok=True)
files=sorted((root/'output/real-api/release-030').glob('ap*/学情-*.pdf'))+[root/'public/help/知衡-教师上手指南.pdf']
results=[];tiles=[]
for i,file in enumerate(files):
 doc=pdfium.PdfDocument(file);reader=PdfReader(file);text='\n'.join(p.extract_text() or '' for p in reader.pages)
 issues=[s for s in ['undefined','NaN','null'] if s in text]
 if not text.strip():issues.append('no extractable text')
 if file.name.startswith('学情-') and '已核对的逐点表现' not in text:issues.append('missing confirmed skill table')
 results.append({'file':str(file.relative_to(root)),'pages':len(doc),'issues':issues})
 for j in range(len(doc)):
  im=doc[j].render(scale=1.3).to_pil().convert('RGB');im.save(out/f'{i:02d}-{j+1}.png');im.thumbnail((240,340));tile=Image.new('RGB',(260,375),'white');tile.paste(im,((260-im.width)//2,0));ImageDraw.Draw(tile).text((8,352),f'File {i:02d}, page {j+1}',fill='black');tiles.append(tile)
 doc.close()
for start in range(0,len(tiles),12):
 group=tiles[start:start+12];sheet=Image.new('RGB',(1040,375*((len(group)+3)//4)),'#ddd')
 for j,tile in enumerate(group):sheet.paste(tile,((j%4)*260,(j//4)*375))
 sheet.save(out/f'contact-{start//12+1}.png')
result={'ok':all(not r['issues'] for r in results),'files':results,'pages':sum(r['pages'] for r in results)}
(out/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False));assert result['ok']

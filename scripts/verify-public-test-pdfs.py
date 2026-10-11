"""Render every exported test report for visual review; no model calls."""
from pathlib import Path
import json
import pypdfium2 as pdfium
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
out = root / 'output/real-api/public-papers-20260908'
review = root / 'output/playwright/public-papers/pdf-review'
review.mkdir(parents=True, exist_ok=True)
reports = [out / '公开真卷测试与费用报告.pdf']
for scenario in ['national1-2024-with-notes', 'haidian-2024-with-notes', 'haidian-2024-no-notes']:
    reports += sorted((out / scenario).glob('*.pdf'))
assert len(reports) == 12, len(reports)
results = []
for n, report in enumerate(reports):
    doc = pdfium.PdfDocument(report)
    thumbnails = []
    checks = []
    for i in range(len(doc)):
        page = doc[i]
        text = page.get_textpage().get_text_range()
        assert len(text.strip()) > 50, f'Nearly empty page: {report.name}:{i+1}'
        image = page.render(scale=1.5).to_pil().convert('RGB')
        dest = review / f'{n:02d}-page-{i+1:02d}.png'
        image.save(dest)
        thumb = image.copy()
        thumb.thumbnail((420, 594))
        labeled = Image.new('RGB', (440, 624), '#e8eeed')
        labeled.paste(thumb, ((440-thumb.width)//2, 24))
        ImageDraw.Draw(labeled).text((12, 7), f'Report {n:02d}, page {i+1}', fill='#264238')
        thumbnails.append(labeled)
        checks.append({'page': i+1, 'textCharacters': len(text), 'image': str(dest.relative_to(root))})
    if n == 0:
        assert len(doc) == 6, f'Expected 6 summary pages, got {len(doc)}'
    columns = min(3, len(thumbnails))
    contact = Image.new('RGB', (columns*440, ((len(thumbnails)+columns-1)//columns)*624), 'white')
    for i, thumb in enumerate(thumbnails):
        contact.paste(thumb, ((i%columns)*440, (i//columns)*624))
    contact.save(review / f'{n:02d}-contact.png')
    results.append({'file': str(report.relative_to(out)), 'pages': len(doc), 'checks': checks})
    doc.close()
(out / 'pdf-validation.json').write_text(json.dumps({'ok': True, 'reportCount': len(reports), 'reports': results}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'ok': True, 'reports': [{'file': r['file'], 'pages': r['pages']} for r in results]}, ensure_ascii=False))

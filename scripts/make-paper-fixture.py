from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
out=Path('output/tests/fixtures'); out.mkdir(parents=True, exist_ok=True)
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',32)
small=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',25)
pdf=canvas.Canvas(str(out/'整卷识别样卷.pdf'),pagesize=(595,842))
lines=[['一、单项选择题：本题 5 分。','1. 已知集合 A={1,2}，B={2,3}，则 A∩B 为','A. {1}    B. {2}    C. {3}    D. {1,2,3}'],['二、填空题：本题 5 分。','2. 等差数列首项为 2，公差为 3，第 5 项为____。'],['三、解答题：本题 10 分。','3. 已知函数 f(x)=x²-2x。','（1）求 f(x) 的导数。','（2）求 f(x) 的单调区间。']]
for i, content in enumerate(lines):
    im=Image.new('RGB',(1190,1684),'white'); d=ImageDraw.Draw(im)
    d.text((90,70),'高中数学整卷识别样卷（虚构）',font=font,fill='black')
    d.text((90,130),f'共 3 页，第 {i+1} 页     全卷满分：20 分',font=small,fill='black')
    for j,line in enumerate(content): d.text((90,230+j*90),line,font=small,fill='black')
    d.text((90,1480),'软件流程验收用；不用于验证实际模型准确率。',font=small,fill='gray')
    pdf.drawImage(ImageReader(im),0,0,595,842)
    pdf.showPage()
pdf.save()
print(out/'整卷识别样卷.pdf')

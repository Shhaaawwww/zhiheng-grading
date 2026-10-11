"""Create a real authored exam, then rasterize it. Ground truth stays local."""
from pathlib import Path
import json, math, hashlib
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, KeepTogether
from reportlab.lib.styles import ParagraphStyle
import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

out=Path('output/real-api/deepseek-20260908'); out.mkdir(parents=True,exist_ok=True)
pdfout=Path('output/pdf'); pdfout.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('Chinese','C:/Windows/Fonts/msyh.ttc'))
W,H=595.28,841.89
style=ParagraphStyle('body',fontName='Chinese',fontSize=11,leading=20,textColor='#192c36')
src=pdfout/'真实测试-高中数学综合试卷.pdf'
c=canvas.Canvas(str(src),pagesize=(W,H)); c.setTitle('高中数学综合检测 - API真实测试用原创试卷')
def text(s,x,y,size=11):
    c.setFont('Chinese',size);c.setFillColorRGB(.08,.12,.16);c.drawString(x,y,s)
def p(s,y,x=48,width=499):
    para=Paragraph(s,style);_,h=para.wrap(width,1000);para.drawOn(c,x,y-h);return y-h
def heading(page,section):
    text('高中数学综合检测',48,790,20);text('满分 100 分   建议用时 90 分钟',48,758,11)
    text('班级：____________  姓名：____________  学号：____________',48,728,10)
    c.setStrokeColorRGB(.35,.45,.5);c.line(48,715,547,715)
    text(section,48,686,13)
    text(f'第 {page} 页 / 共 4 页',454,31,9)
    text('本卷为软件真实接口测试原创题面，无真实学生信息。',48,31,8)
def answerlines(y,n=3):
    c.setStrokeColorRGB(.81,.84,.86)
    for i in range(n):c.line(55,y-i*26,542,y-i*26)

heading(1,'一、单项选择题：本题共 4 小题，每小题 5 分，共 20 分。')
p('1. 已知集合 A = {x | −1 &lt; x ≤ 3}，B = {x | 1 ≤ x &lt; 4}，则 A ∩ B =（　）',651)
p('A. (1, 3]　　 B. [1, 3]　　 C. [1, 3)　　 D. (−1, 4)',602)
p('2. 复数 (1 + i) / (1 − i) 的值为（　），其中 i 为虚数单位。',554)
p('A. −1　　　 B. i　　　 C. −i　　　 D. 1',525)
p('3. 下图是某二次函数的图像，则该函数的解析式为（　）',477)
# Actual vector graph: vertex (1,-1), roots 0 and 2; graph is part of the exam.
ox,oy,s=335,350,40
c.setLineWidth(.7);c.setStrokeColorRGB(.2,.25,.3)
c.line(ox-65,oy,ox+135,oy);c.line(ox,oy-70,ox,oy+85)
text('x',ox+140,oy-5,9);text('y',ox-13,oy+87,9);text('O',ox-12,oy-13,8)
for x in [1,2,3]:
    c.line(ox+x*s,oy-3,ox+x*s,oy+3);text(str(x),ox+x*s-3,oy+7,8)
c.setDash(2,2);c.line(ox+s,oy,ox+s,oy-s);c.line(ox,oy-s,ox+s,oy-s);c.setDash()
text('−1',ox-21,oy-s-3,8);text('(1, −1)',ox+s+7,oy-s-8,8)
curve=c.beginPath()
for i in range(151):
    x=-.65+i*3.3/150;y=x*x-2*x
    (curve.moveTo if i==0 else curve.lineTo)(ox+x*s,oy+y*s)
c.setLineWidth(1.5);c.drawPath(curve)
p('A. y = x² + 2x<br/>B. y = x² − 2x<br/>C. y = −x² + 2x<br/>D. y = x² − 1',420,width=210)
p('4. 袋中有 3 个红球和 2 个白球，这些球除颜色外完全相同。从中随机一次取出 2 个球，则两个球颜色相同的概率为（　）',236)
p('A. 1/5　　 B. 3/10　　 C. 2/5　　 D. 3/5',180)
c.showPage()

heading(2,'二、多项选择题：本题共 2 小题，每小题 6 分，共 12 分。')
p('每题有多个正确选项；全对得 6 分，部分选对得 3 分，有错选得 0 分。',654)
p('5. 已知函数 f(x) = ln x，下列结论正确的是（　）',613)
p('A. 定义域为 (0, +∞)<br/>B. f′(x) = 1/x<br/>C. 对任意 x &gt; 0、y &gt; 0，有 f(xy) = f(x) + f(y)<br/>D. 对任意 x &gt; 0，都有 f(x) &gt; 0',582)
p('6. 已知平面向量 a = (1, 2)，b = (2, −1)，下列结论正确的是（　）',474)
p('A. a ⊥ b　　 B. a 与 b 共线<br/>C. |a| = |b|　　 D. a + b = (3, 1)',443)
text('三、填空题：本题共 2 小题，每小题 5 分，共 10 分。',48,356,13)
p('7. 等差数列 {a<sub>n</sub>} 的首项为 3，公差为 2，则它的前 10 项和为 __________。',324)
answerlines(254,2)
p('8. 椭圆 x²/9 + y²/4 = 1 的离心率为 __________。',182)
answerlines(123,2)
c.showPage()

heading(3,'四、解答题：本题共 4 小题，共 58 分。请写出必要过程。')
p('9.（本题满分 12 分）已知函数 f(x) = x³ − 3x。',650)
p('（1）（6 分）求 f′(x)，并求 f(x) 的单调区间。',619)
answerlines(572,3)
p('（2）（6 分）求 f(x) 的极大值和极小值。',477)
answerlines(430,3)
p('10.（本题满分 14 分）某射手每次射击命中的概率为 0.6，且各次射击结果相互独立。该射手射击 2 次，设命中次数为 X。',333)
p('（1）（6 分）列出 X 的分布列。',281)
answerlines(242,2)
p('（2）（8 分）求 X 的数学期望 E(X) 和方差 D(X)。',169)
answerlines(125,3)
c.showPage()

heading(4,'四、解答题（续）')
p('11.（本题满分 16 分）已知圆 C：x² + y² = 25，直线 l：y = x + 1。',650)
p('（1）（6 分）求圆心到直线 l 的距离。',617)
answerlines(573,3)
p('（2）（10 分）直线 l 与圆 C 交于 A、B 两点，求弦 AB 的长。',477)
answerlines(432,3)
p('12.（本题满分 16 分）已知数列 {a<sub>n</sub>} 满足 a<sub>1</sub> = 1，a<sub>n+1</sub> = 2a<sub>n</sub> + 1（n ≥ 1）。',334)
p('（1）证明数列 {a<sub>n</sub> + 1} 是等比数列，并写出其公比。',285)
p('（2）求 a<sub>n</sub> 的通项公式和前 n 项和 S<sub>n</sub>。',253)
answerlines(205,5)
c.save()

# Rasterize every page and rebuild a PDF that contains only images, no text layer.
doc=pdfium.PdfDocument(str(src));scan=pdfout/'真实测试-高中数学综合试卷-扫描版.pdf'
sc=canvas.Canvas(str(scan),pagesize=(W,H));sc.setTitle('高中数学综合检测 - 纯图片扫描版')
manifest=[];thumbs=[]
for i,page in enumerate(doc):
    im=page.render(scale=2.6).to_pil().convert('L')
    im=ImageEnhance.Contrast(im).enhance(.93)
    im=im.rotate([.18,-.12,.15,-.18][i],resample=Image.Resampling.BICUBIC,expand=False,fillcolor=255)
    im=im.filter(ImageFilter.GaussianBlur(.18)).convert('RGB')
    dest=out/f'scan-page-{i+1}.jpg';im.save(dest,quality=92)
    sc.drawImage(ImageReader(str(dest)),0,0,W,H);sc.showPage()
    manifest.append({'page':i+1,'file':str(dest),'width':im.width,'height':im.height,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()})
    thumb=im.copy();thumb.thumbnail((420,594));thumbs.append(thumb)
sc.save()
assert len(PdfReader(scan).pages)==4
assert all(not page.extract_text().strip() for page in PdfReader(scan).pages)
contact=Image.new('RGB',(840,1200),'#ced7da')
for i,im in enumerate(thumbs):contact.paste(im,((i%2)*420,(i//2)*600))
contact.save(out/'scan-contact.png')

labels=['1','2','3','4','5','6','7','8','9(1)','9(2)','10(1)','10(2)','11(1)','11(2)','12']
maxima=[5,5,5,5,6,6,5,5,6,6,6,8,6,10,16]
topics=['集合与运算','复数运算','二次函数图像','古典概型','对数函数','平面向量','等差数列求和','椭圆离心率','导数与单调性','导数与极值','二项分布','数学期望与方差','点到直线的距离','直线与圆的位置关系','递推数列与等比求和']
answers=['B：[1,3]','B：i','B：y=x²−2x','C：2/5','ABC','ACD','120','√5/3','f′(x)=3x²−3；增区间(−∞,−1)、(1,+∞)，减区间(−1,1)。','极大值 f(−1)=2；极小值 f(1)=−2。','X=0,1,2 时的概率分别为0.16、0.48、0.36。','E(X)=1.2；D(X)=0.48。','d=1/√2=√2/2。','AB=2√(25−1/2)=7√2。','由 a_(n+1)+1=2(a_n+1)，且 a_1+1=2，公比为2；a_n=2^n−1；S_n=2^(n+1)−n−2。']
pages=[1,1,1,1,2,2,2,2,3,3,3,3,4,4,4]
types=['choice']*4+['multiple']*2+['fill']*2+['solve']*7
ground={'title':'高中数学综合检测','total':100,'pages':4,'mainQuestions':12,'scoringUnits':15,'questions':[{'label':l,'max':m,'type':t,'page':pg,'topic':tp,'answer':a} for l,m,t,pg,tp,a in zip(labels,maxima,types,pages,topics,answers)],'images':manifest,'scanPdf':str(scan),'sourcePdf':str(src),'scanTextLayerCharacters':0}
assert sum(maxima)==100 and math.comb(3,2)+math.comb(2,2)==4
assert sum(3+2*i for i in range(10))==120
for n in range(1,8):assert sum(2**i-1 for i in range(1,n+1))==2**(n+1)-n-2
(out/'ground-truth.json').write_text(json.dumps(ground,ensure_ascii=False,indent=2),encoding='utf-8')
rows=[
 [5,5,5,5,6,6,5,5,6,6,6,8,6,9,14],
 [5,5,0,5,6,3,5,5,6,5,6,7,6,8,12],
 [5,5,5,0,3,6,5,5,3,4,6,6,6,7,10],
 [5,0,5,5,6,3,5,0,6,4,6,2,6,8,11],
 [5,5,5,5,3,6,5,5,6,6,3,5,6,6,10],
 [5,5,0,5,3,3,5,5,4,4,6,6,6,4,9],
 [0,5,5,0,3,6,5,0,5,4,6,5,3,5,8],
 [5,0,5,5,3,3,0,5,4,3,3,4,6,6,6],
 [5,5,0,0,0,3,5,0,3,2,3,3,3,4,4],
 [0,5,0,5,3,0,5,0,3,1,3,2,3,2,3],
 [5,0,5,0,0,3,0,0,2,1,3,1,3,3,2],
 [0,0,0,5,0,0,0,0,1,0,0,1,3,0,1]
]
notes={(0,'12'):'通项正确，求和最后一步漏化简。',(2,'9(1)'):'求导式正确，但把导数正负对应的增减性写反。',(3,'10(2)'):'期望正确，计算方差时漏减期望的平方。',(5,'11(2)'):'垂径定理使用正确，弦长只写了半弦长。',(8,'12'):'递推式变形正确，等比数列通项指数差一。',(11,'7'):'把等差数列求和公式中的项数写成9。',(6,'8'):'把椭圆中的半短轴当成焦距的一半。',(0,'9(1)'):'求导与单调区间完整正确。'}
students=[]
for i,row in enumerate(rows):
    assert len(row)==len(labels) and all(0<=s<=m for s,m in zip(row,maxima))
    students.append({'number':f'2609{i+1:02d}','name':f'试测{i+1:02d}','grades':[{'label':l,'score':s,'note':notes.get((i,l),'')} for l,s in zip(labels,row)],'total':sum(row)})
dataset={'description':'为模拟教师录分而编制的测试班级和小分，不是真实学生的考试结果。模型调用和软件流程均使用这些实际录入记录。','className':'高二数学实测班（测试资料）','examName':'综合检测 · DeepSeek真实接口实测','date':'2026-09-08','students':students,'expectedAverage':sum(s['total'] for s in students)/len(students)}
(out/'teacher-input.json').write_text(json.dumps(dataset,ensure_ascii=False,indent=2),encoding='utf-8')
answerfile=pdfout/'真实测试-标准答案与核对依据.pdf'
story=[Paragraph('高中数学综合检测 · 标准答案与核对依据',ParagraphStyle('title',parent=style,fontSize=18,leading=28)),Spacer(1,15),Paragraph('仅用于本地核对。识别请求不包含本文件及 ground-truth.json。',style),Spacer(1,12)]
for q in ground['questions']:
    story.append(KeepTogether([Paragraph(f"第 {q['label']} 题 / {q['max']} 分 / {q['topic']}",style),Paragraph(q['answer'].replace('&','&amp;').replace('<','&lt;'),style),Spacer(1,12)]))
SimpleDocTemplate(str(answerfile),pagesize=(W,H),leftMargin=48,rightMargin=48,topMargin=48,bottomMargin=48).build(story)
print(json.dumps({'exam':str(src),'scan':str(scan),'pages':4,'imageOnly':True,'scoringUnits':15,'max':100,'students':12,'expectedAverage':dataset['expectedAverage']},ensure_ascii=False))

"""Audit and package completed public-paper tests. No network or model calls."""
from pathlib import Path
import gzip
import hashlib
import io
import json
import os
import zipfile

root = Path(__file__).resolve().parents[1]
out = root / 'output/real-api/public-papers-20260908'
shots = root / 'output/playwright/public-papers'
credential = os.environ.pop('DEEPSEEK_API_KEY', '')
if not credential:
    raise RuntimeError('Credential required only to verify its absence from deliverables')
needles = [credential.encode(), credential.encode('utf-16le')]
checked = 0

def inspect(data):
    if any(n in data for n in needles):
        raise RuntimeError('Credential check failed; no archive produced')

def check_file(item):
    global checked
    data = item.read_bytes()
    inspect(data)
    if item.suffix == '.zhb':
        inspect(gzip.decompress(data))
    elif item.suffix == '.xlsx':
        with zipfile.ZipFile(io.BytesIO(data)) as workbook:
            for name in workbook.namelist():
                inspect(workbook.read(name))
    checked += 1
    return data

for folder in ['src', 'server', 'electron', 'scripts', 'tests', 'public/help']:
    for item in (root / folder).rglob('*'):
        if item.is_file() and item.suffix in {'.mjs', '.cjs', '.py', '.ts', '.tsx', '.md', '.html', '.json', '.css'}:
            check_file(item)
for item in (out / 'workspace').glob('zhiheng.sqlite*'):
    check_file(item)

assert json.loads((out / 'verification.json').read_text(encoding='utf-8'))['ok']
assert json.loads((out / 'pdf-validation.json').read_text(encoding='utf-8'))['reportCount'] == 12
items = []
for item in out.iterdir():
    if not item.is_file() or item.suffix == '.cmd':
        continue
    if item.name.startswith('公开真卷测试与费用报告.'):
        group = '01-测试结论'
    elif item.suffix == '.zhb':
        group = '06-完整备份'
    elif item.suffix in {'.json', '.jpg', '.png'}:
        group = '05-接口与核验记录'
    else:
        continue
    items.append((item, f'{group}/{item.name}'))
for folder in ['national1-2024', 'national2-2024', 'haidian-2024']:
    for item in (out / folder).rglob('*'):
        if item.is_file():
            items.append((item, '02-试卷与识别/' + item.relative_to(out).as_posix()))
for folder in ['national1-2024-with-notes', 'haidian-2024-with-notes', 'haidian-2024-no-notes']:
    for item in (out / folder).rglob('*'):
        if item.is_file():
            items.append((item, '03-录分与报告/' + item.relative_to(out).as_posix()))
for item in shots.glob('*.png'):
    if not item.name.startswith('failure-'):
        items.append((item, f'04-操作截图/{item.name}'))
for item in (shots / 'pdf-review').glob('*-contact.png'):
    items.append((item, f'04-操作截图/PDF复核/{item.name}'))
for name in ['prepare-public-papers.py', 'public-paper-session.mjs', 'prepare-analysis-scenarios.mjs', 'review-public-paper-results.mjs', 'verify-public-tests.mjs', 'review-public-analysis.mjs', 'build-public-test-report.mjs', 'verify-public-test-pdfs.py', 'package-public-tests.py']:
    items.append((root / 'scripts' / name, f'07-复现脚本/{name}'))

intro = '''知衡 · 公开真卷测试材料 · 2026-09-08

先看“01-测试结论/公开真卷测试与费用报告.pdf”。详细核验与调用清单见同目录 Markdown 报告。
02：三套网上公开真题整理版、纯图片输入、识别结果与教师修正。答案页未发送给识题模型。
03：三个场景的录分表与11份报告，其中8份AI报告、3份基础报告。
04：软件实际操作及PDF排版截图。
05：真实DeepSeek官方请求记录、返回结果、用量与独立核验；不含鉴权头或长篇模型思考内容。
06：完整备份。恢复会替换当前工作区，请在独立测试工作区使用。
07：本轮测试脚本。重跑实时调用需自行提供环境变量密钥并承担费用，查看报告不需要密钥。

试卷来自真实考试的公开网络整理版；班级成员、小分和备注是明确编制的模拟测试资料。
全部API调用与处理真实发生，没有模拟响应。模型为deepseek-v4-flash-vision-exp。
4个识别输入仅2个形成可编辑提案，两者均有题面错误；8份AI报告中3份有具体事实或引用问题。
已知用量费用约0.07588美元，另外2次超时的开销未知；费用是根据响应用量和当日价格估算，未核对账户扣款。
全国I卷测评02第14题同时有满分与错误备注，属于矛盾输入，不能作为失分事实；原始报告保留以展示此问题。
统计核算通过不代表报告语义均正确，也不是教师盲评结论。本轮没有修改产品代码。

本包不含API密钥或Windows安装程序。试题版权归原权利人，仅用于本次测试核对。
本机已有独立测试目录时，可双击其中的“打开本次真卷实测.cmd”。
'''
inspect(intro.encode())
for item, _ in items:
    check_file(item)
audit = {'ok': True, 'checkedFiles': checked, 'backupDecompressedAndChecked': True, 'workbooksDecompressedAndChecked': True, 'databaseChecked': True, 'keyIncluded': False}
audit_path = out / 'credential-check.json'
audit_path.write_text(json.dumps(audit, indent=2), encoding='utf-8')
if not any(item == audit_path for item, _ in items):
    items.append((audit_path, '05-接口与核验记录/credential-check.json'))
archive = root / 'release/知衡-公开真卷测试材料.zip'
archive.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    z.writestr('请先阅读.txt', intro)
    for item, name in items:
        z.writestr(name, item.read_bytes())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert len(set(z.namelist())) == len(z.namelist())
    assert all('workspace/' not in name and 'national-a-2024' not in name and not name.endswith(('.exe', '.sqlite')) for name in z.namelist())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(root / 'release/公开真卷测试材料-SHA256.txt').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
print(json.dumps({'ok': True, 'credentialCheckFiles': checked, 'archiveFiles': len(items)+1, 'archiveBytes': archive.stat().st_size, 'archive': str(archive)}, ensure_ascii=False))

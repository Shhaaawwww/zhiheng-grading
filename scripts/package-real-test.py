"""Package the completed live test artifacts; never call a model or include user profiles."""
from pathlib import Path
import gzip
import hashlib
import json
import os
import zipfile

root = Path(__file__).resolve().parents[1]
out = root / 'output/real-api/deepseek-20260908'
shots = root / 'output/playwright/real-deepseek'
key = os.environ.pop('DEEPSEEK_API_KEY', '')
if not key:
    raise RuntimeError('A temporary key is required solely to verify its absence from artifacts')
needles = [key.encode(), key.encode('utf-16le')]

def inspect_bytes(data):
    if any(needle in data for needle in needles):
        raise RuntimeError('Credential check failed; no archive has been generated')

checked = 0
for folder in ['src', 'server', 'electron', 'scripts', 'tests', 'public/help']:
    for item in (root / folder).rglob('*'):
        if item.is_file() and item.suffix in {'.mjs', '.cjs', '.py', '.ts', '.tsx', '.md', '.html', '.json', '.css'}:
            inspect_bytes(item.read_bytes())
            checked += 1
for item in out.iterdir():
    if item.is_file():
        data = item.read_bytes()
        inspect_bytes(data)
        if item.suffix == '.zhb':
            inspect_bytes(gzip.decompress(data))
        checked += 1
for item in (out / 'workspace').glob('zhiheng.sqlite*'):
    inspect_bytes(item.read_bytes())
    checked += 1

native = json.loads((shots / 'portable-013.png.json').read_text(encoding='utf-8'))
assert native['ok'] and native['workspaceReady']['examLoaded']
assert '180 / 180' in native['workspaceReady']['text']
package = json.loads((root / 'output/playwright/paper/package-check.json').read_text(encoding='utf-8'))
assert package['ok'] and package['version'] == '0.1.3'
(out / 'windows-package-validation.json').write_text(json.dumps({'native': native, 'package': package}, ensure_ascii=False, indent=2), encoding='utf-8')
(out / 'credential-check.json').write_text(json.dumps({'ok': True, 'checkedFiles': checked, 'backupDecompressedAndChecked': True, 'databaseChecked': True, 'keyIncluded': False}, indent=2), encoding='utf-8')

intro = '''知衡 · 真实 API 测试材料

先打开“01-测试结论/真实API全流程测试报告.pdf”。
“02-试卷”包含原卷、纯图片扫描版、标准答案。
“03-录分与报告”包含两种 Excel 录分表与全部 17 个报告版本。
“04-实际操作截图”展示创建班级、识别、教师核对、录分、分析及 Windows 程序。
“05-接口与校验记录”保留实际请求元数据、图片、模型完整结果和校验依据，去除了鉴权头和模型长篇思考内容。
“06-完整备份”可以在知衡的“设置与数据”中恢复。恢复会替换当前工作区，请使用单独测试工作区。

模型：DeepSeek 官方 deepseek-v4-flash-vision-exp。
试卷、班级成员和成绩是专门编制的测试资料；调用与处理均真实发生，没有假响应。
本资料包不含 API 密钥，不含 Windows 程序。查看 PDF 和录分表无需密钥。
本机已有程序与独立测试工作区时，可在 output/real-api/deepseek-20260908 双击“打开本次实测.cmd”。
'''
archive = root / 'release/知衡-真实API测试材料.zip'
items = []
for item in out.iterdir():
    if not item.is_file():
        continue
    if item.name.startswith('真实API全流程测试报告.'):
        group = '01-测试结论'
    elif item.suffix in {'.xlsx', '.pdf', '.html'}:
        group = '03-录分与报告'
    elif item.suffix in {'.json', '.jpg', '.png'}:
        group = '05-接口与校验记录'
    elif item.suffix == '.zhb':
        group = '06-完整备份'
    else:
        continue
    items.append((item, f'{group}/{item.name}'))
for item in (root / 'output/pdf').glob('真实测试-*.pdf'):
    items.append((item, f'02-试卷/{item.name}'))
for item in shots.glob('*.png'):
    if item.name != 'failure-extract-recheck.png':
        items.append((item, f'04-实际操作截图/{item.name}'))
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    z.writestr('请先阅读.txt', intro)
    for item, arcname in items:
        data = item.read_bytes()
        inspect_bytes(data)
        z.writestr(arcname, data)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert all('workspace/' not in f and not f.endswith('.exe') for f in z.namelist())
names = ['Zhiheng-Portable-0.1.3-x64.exe', 'Zhiheng-Setup-0.1.3-x64.exe', '知衡-教师上手指南.pdf', archive.name]
lines = [f'{hashlib.sha256((root / "release" / name).read_bytes()).hexdigest()}  {name}' for name in names]
(root / 'release/SHA256SUMS.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps({'ok': True, 'credentialCheckFiles': checked, 'archiveFiles': len(items)+1, 'archiveBytes': archive.stat().st_size, 'archive': str(archive)}, ensure_ascii=False))

from pathlib import Path
import json, zipfile

root = Path(__file__).resolve().parents[1]
out = root / 'output/real-api/release-020-round2'
dest = root / 'release/Zhiheng-0.2.0-示例报告与录分表.zip'
cases = json.loads((out / 'cases.json').read_text(encoding='utf-8'))
names = []
with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    archive.writestr('先读说明.txt', '全部学生、分数和备注均为模拟数据。报告由本轮官方 DeepSeek 接口真实生成。\n每个目录含一份最终宽录分表、班级报告及个人行动卡。\n海淀清晰卷中模拟03和模拟04分数相同、备注不同；模拟01为满分但有历史订正记录。\n样例便于查看产品产物，不能作为真实课堂效果证据。\n本包不附原试卷图片或数据库。\n')
    for c in cases:
        folder = out / c['caseId']
        for file in [folder / '最终录分表.xlsx', *sorted(folder.glob('final-*.pdf'))]:
            name = c['caseId'] + '/' + file.name
            archive.write(file, name)
            names.append(name)
with zipfile.ZipFile(dest) as archive:
    assert archive.testzip() is None
assert len(names) == 17
print(json.dumps({'ok': True, 'excelFiles': 5, 'pdfFiles': 12, 'output': str(dest)}, ensure_ascii=False))

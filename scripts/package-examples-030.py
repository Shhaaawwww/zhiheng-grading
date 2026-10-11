from pathlib import Path
import zipfile
root=Path(__file__).resolve().parents[1]
out=root/'release/Zhiheng-0.3.0-示例报告与录分表.zip'
notes='''# 0.3 示例输出\n\nAP 文件夹内为公开独立手写样例经教师复核后的3份班级报告、6份个人报告及3份录分表。不同题的A/B/C不是同一个学生，构造班级只检验软件统计。只选择性确认部分作答表现，不代表已穷尽全部知识点。\n\n国内整卷文件夹为公开题目、40名模拟学生的小分及基础报告，不是真实班级的手写批卷效果。\n\n接口调用为真实DeepSeek官方服务。样例展示输出格式和流程，不代表无人复核的准确率或教学效果。原卷、学生图片、参考答案、接口日志、资料库和密钥均不附在此包。详情见交付验收报告。\n'''
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 z.writestr('阅读说明.md',notes)
 for folder in sorted((root/'output/real-api/release-030').glob('ap*')):
  if not folder.is_dir():continue
  for file in list(folder.glob('学情-*.pdf'))+list(folder.glob('教师确认录分表.xlsx')):z.write(file,'真实手写复核/'+folder.name+'/'+file.name)
 for folder in sorted((root/'output/real-api/release-030-chinese').glob('*-clean')):
  for name in ['录分表.xlsx','班级基础报告.pdf']:z.write(folder/name,'国内整卷模拟录分/'+folder.name+'/'+name)
with zipfile.ZipFile(out) as z:assert z.testzip() is None;print('Example package:',len(z.namelist()),'files; no source scans or runtime data')

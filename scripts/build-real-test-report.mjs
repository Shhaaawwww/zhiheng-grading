import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
const dir=path.resolve('output/real-api/deepseek-20260908');
const read=f=>JSON.parse(readFileSync(path.join(dir,f),'utf8'));
const v=read('verification.json'),e=read('final-exam.json'),source=read('teacher-input.json');
const logs=readdirSync(dir).filter(f=>f.startsWith('network-')).map(f=>({file:f,...read(f)}));
const calls=logs.filter(x=>x.method==='POST');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const low=[...e.analysis.topics].sort((a,b)=>a.rate-b.rate).slice(0,5);
const timings=calls.map((c,i)=>({name:i===0?'首次识别':i===1?'重跑中止':i===2?'改进后识别':i===3?'备注归类':i===4?'班级解读':i===5?'试测01解读':'试测09解读',seconds:(c.elapsedMs/1000).toFixed(1),id:c.response?.id||'完整响应未取得',usage:c.response?.usage,ok:!c.error}));
const md=`# 知衡 · DeepSeek 官方 API 全流程实测

测试日期：2026-09-08。实测流程通过，图像与分析结论仍需教师核对。实测中改进的小问识别提示已包含在 0.1.3 程序中。

## 这次确实做了什么

- 从零编写并生成一份高中数学试卷：4 页、12 道大题、15 个计分项、100 分，含实际函数图像。
- 先生成 PDF，再栅格化为图片，加入轻微倾斜与灰度效果，并合成纯图片 PDF。检查文字层字符数为 0。
- 使用教师界面创建 12 人班级、12 个成员和考试，上传扫描版；应用将全部 4 页转为图像发送。
- 使用 DeepSeek 官方地址 https://api.deepseek.com/chat/completions，模型始终为 deepseek-v4-flash-vision-exp。未使用模拟服务、假响应、拦截替换或预填题目结果。
- 模型识题请求只获得页面图片和通用整理要求，没有得到原始题目文本、标准答案或核对用 JSON。
- 教师通过界面录入 180 个最终小分和 8 条可选备注，导出长表、宽表，生成个人和班级学情。
- 完成 12 份个人基础报告、1 份班级基础报告、3 份真实 AI 解读（班级、试测01、试测09），并保存 1 份教师修订报告，共 17 个报告版本。

班级成员与小分是为模拟教师而编制的测试资料，不是真实学生的考试成绩；试卷文件、录入记录、模型请求、响应和报告均实际生成。没有测试自动批阅真实手写作答，也没有使用真实扫描仪采集纸卷。

## 真实发现的问题与处理

| 检查 | 首次结果 | 处理及复测 |
| --- | --- | --- |
| 大题覆盖 | 12 道大题全部出现，总分 100 | 保持正确 |
| 明确标分的小问 | 第 9—11 题未拆分；返回 12 个计分项而非 15 个 | 强化通用识别提示，明确有小问分值必须拆分；重跑后题号、分值、题型、页码 15/15 匹配 |
| 图像条件 | 将辅助虚线相关坐标误读为函数纵轴交点 −1 | 改进提示后错误交点消失；仍多写图上未标明的点 (3,3)，教师删除这一句 |
| 未分配小问分值 | 第 12 题只印整题 16 分 | 保留一个计分项，没有猜分配 |
| AI 分析措辞 | 一句把当次方差公式遗漏表述为“掌握不牢” | 教师修订为本次观察与后续验证，保留 AI 原版 |
| 备注归类 | 正面备注留空，其余给出标签 | 个别标签偏粗，如增减性写反归为“推理不完整”；原备注仍完整保留，不能只看标签 |

两次成功识别和一次中途中止的识别使用了完全相同的 4 幅图像，已比较逐页哈希。复测没有修改原卷、注入答案或手填缺失小问。改进提示后仍发生一次人工题干修正，因此不声称实现免核对或识别准确率 100%。

另有一次重跑被测试脚本过早结束等待而中止，未拿到完整响应；已修复脚本按新任务 ID 等待。它是一次实际发出的请求，单独保留错误记录，没有计作成功。

## 数据核算结果

| 指标 | 结果 |
| --- | ---: |
| 完整成绩 | 12 人 / 180 格 |
| 平均分 | ${v.average} |
| 中位数 | ${v.median} |
| 总体标准差 | ${v.standardDeviation} |
| 最高 / 最低 | ${v.highest} / ${v.lowest} |
| 知识点统计项 | ${v.topics} |
| 有文字备注 | ${v.notes} 格 |

每一个小分、备注、学生总分，以及全班均分、中位数、标准差和知识点得分率，均用原始教师输入独立重算，与软件一致。0 分正常参与统计。长表包含 180 条记录，宽表包含 12 人、15 道计分题，两种导出均校验通过。

本测试资料中较低的题组表现：${low.map(t=>`${t.name} ${t.rate}%`).join('；')}。每个知识点在本卷只对应一个计分项，不能由单题结果推断长期能力。

## AI 分析使用了哪些依据

分析请求不含原卷图像、学生姓名和学号，只含匿名编号、题目（含父题公共条件）、最终小分、已采用备注及程序统计。所有报告题目 ID 和备注引用都能在快照中找到；“已有备注支持”的结论均有备注引用。

班级报告识别了导数符号与增减方向、方差公式遗漏、半弦长未翻倍、数列项数与指数等备注反映的问题。对无备注的对数函数失分保留不确定性。

试测01（97 分）的报告集中于数列化简和弦长题回看；试测09（40 分）的报告区分了无备注的基础题复核与有明确备注的数列指数错误。报告给出了复测办法。措辞修订记录展示了教师如何保留证据并避免把一次错误直接扩大成长期能力结论。

## 真实调用和费用记录

${timings.map(t=>`- ${t.name}：${t.seconds} 秒；${t.ok?'完整响应成功':'中止，完整响应未取得'}；响应 ID：${t.id}。`).join('\n')}

合计 6 次完整成功的模型调用，另 1 次中止调用；另外完成 3 次只读模型列表检查，列表中包含指定模型。成功调用返回输入 ${v.usage.input} tokens、输出 ${v.usage.output} tokens（含模型计入的推理用量），缓存命中输入 ${v.usage.cached} tokens。

本次请求时间均位于官方非高峰时段。按当天官方 USD 费率，已取得完整用量的 6 次调用估算约 **$${v.usage.estimatedUSD.toFixed(5)}**。中止请求的用量未取得，可能已计费，不包含在估算内；此数不是账户实际扣款核对结果。软件价格字段本次未配置，界面中的 0 估算不代表免费。

接口与计价依据：[官方图片输入文档](https://api-docs.deepseek.com/guides/vision/)、[官方模型价格](https://api-docs.deepseek.com/quick_start/pricing/)。

## 查看与复现

- 本机双击本目录中的“打开本次实测.cmd”，使用 0.1.3 免安装程序打开独立测试工作区；查看已保存报告不需要再次调用模型。
- 已实际启动最终 Windows 免安装程序，确认显示本次考试、12 名学生、15 道计分题和 180/180 已确认小分；原生 PDF 导出也已完成。安装包内源码与本次构建一致，不含测试工作区。
- 换电脑可使用“真实API全流程测试资料.zhb”恢复测试资料，恢复会替换所选工作区，宜用单独测试环境。密钥未放入代码、测试报告、接口记录或备份。
- 原卷和标准答案在 output/pdf；本目录保存扫描 JPG、实际发送 JPG、核对依据、教师输入、两种成绩表、全部报告和脱敏接口记录。
- verification.json 保存独立校验结果；network-*.json 保存目标地址、请求形态、逐图哈希、HTTP 状态、真实响应 ID、内容及用量；不保存请求鉴权头，也不展示模型的长篇思考内容。
- 真实操作脚本为 scripts/real-api-session.mjs，按 extract、extract-recheck、finish、review 分阶段执行。密钥只通过进程环境提供；重新执行识别或 AI 解读可能再次产生费用，不要无意重复运行。

本轮证明这份试卷上的“图像识别—教师录分—统计—AI 分析—报告”链路可以真实执行，也暴露了图形补充、评分单位拆分和分析措辞方面的风险。尚需多套不同排版、不同清晰度试卷及真实教师试用来评估稳定性。
`;
writeFileSync(path.join(dir,'真实API全流程测试报告.md'),md);
const table=(headers,rows)=>`<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const sections=[
  `<h1>真实 API 全流程测试</h1><p class="lead">流程已跑通，教师核对仍然必要。</p><p>知衡 0.1.3 · 高中数学 · 2026 年 9 月 8 日</p><div class="metrics"><b>4 页图片</b><b>15 个计分项</b><b>12 名测试学生</b><b>180 个小分</b></div><h2>实际执行的链路</h2><p>原创试卷 → PDF 栅格化 → 纯图片扫描 PDF → 官方模型识题 → 教师整体核对 → 全班录小分和错因 → 个人与班级统计 → 真实 AI 分析 → 导出报告及备份。</p>${table(['环节','结果'],[['扫描输入','4 页，文字层字符数为 0；含函数图像'],['识题与题目结构','重跑后 15 项题号、分值、题型、页码与原卷一致'],['教师操作','界面建立班级与考试，录入 180 个小分、8 条备注'],['数据统计','独立重算总分、均分及所有知识点得分率，结果一致'],['报告','13 份基础报告、3 份真实 AI 解读、1 份教师修订版']])}<aside>试卷和班级小分均为专门编制的测试资料，API 调用、界面操作和文件输出均真实发生。没有使用模拟接口或假模型响应。本次验证教师录分模式，没有测试真实手写作答的自动评分。</aside><h2>使用的服务</h2><p>官方地址：api.deepseek.com<br/>指定模型：deepseek-v4-flash-vision-exp<br/>首次连接信息、全部真实请求及用量已留存脱敏记录。密钥没有写入代码、报告或备份。</p>`,
  `<h1>识别并非第一次就全对</h1><p class="lead">保留失败，再改进和复测。</p>${table(['项目','首次识别','改进后'],[['大题 / 全卷总分','12 道 / 100 分，正确','保持正确'],['小问拆分','第 9—11 题没有拆开','15 个计分项匹配原卷'],['函数图像','误写纵轴交点为 −1','错误交点消失，但仍补充图上未标的点'],['第 12 题小问','只有整题总分','保留整题 16 分，不猜分配']])}<h2>怎样改进</h2><p>修改的是通用识别要求：有明确小问分值就必须拆分，回看括号内分值；区分函数曲线与辅助虚线，检查图像描述是否矛盾。没有向模型透露这份试卷的标准答案。</p><h2>教师实际修正了一处题干</h2><p>重跑结果多写了“过点 (3,3)”。该点与函数推导相符，但原图没有直接画出或标明，因此在核对界面删去这句。原始模型响应完整保留。</p><aside>两次成功识别及一次中止请求发送的 4 幅图片哈希完全相同。15/15 是结构字段匹配，不是公式与图形识别准确率 100%。不能据本次结果省去教师核对。</aside><h2>另外记录的中止</h2><p>一次重跑因测试脚本过早结束等待而中止，随后修复为按新任务 ID 等待。它实际发出了请求，但没有拿到完整响应，因此不计入成功次数。</p>`,
  `<h1>录分与学情核算</h1><p class="lead">每个小分与统计都有独立对照。</p>${table(['平均分','中位数','最高 / 最低','总体标准差'],[[v.average,v.median,`${v.highest} / ${v.lowest}`,v.standardDeviation]])}${table(['测试学生','总分','测试学生','总分'],Array.from({length:6},(_,i)=>[source.students[i].name,source.students[i].total,source.students[i+6].name,source.students[i+6].total]))}<h2>本次较低的题组表现</h2>${table(['主要考查知识点','得分率','有效人数'],low.map(t=>[t.name,`${t.rate}%`,t.n]))}<p>各知识点在本卷仅对应一个计分项。得分率描述这次题目表现；没有备注时，无法据分数确定具体错因。</p><aside>180 个小分、8 条备注、12 个学生总分全部与教师输入一致。均分、中位数、总体标准差和 15 项知识点得分率独立重算通过。长表 180 条，宽表 12 人 × 15 题，0 分保留。</aside>`,
  `<h1>真实 AI 分析与教师修订</h1><p class="lead">先看证据，再决定教学行动。</p><h2>班级</h2><p>报告引用实际备注，指出导数符号与增减方向、方差公式遗漏、半弦长未翻倍，以及数列项数与指数问题。对于没有备注的对数函数失分，模型明确保留不确定性。</p><h2>两个不同表现的学生</h2><p>试测01（97 分）：数列求和最后漏化简，有备注支持；弦长题少量失分没有备注，需要回看原卷。<br/>试测09（40 分）：区分没有备注的基础题复核和备注明确的数列指数错误，给出复测办法。</p><h2>没有把所有模型用语直接当结论</h2><p>班级原报告有一句“反映方差公式掌握不牢”。教师改为“本次遗漏减去期望平方，需再确认是记忆、理解还是当次执行问题”，并保存新版本，原 AI 版仍可回看。</p><h2>备注分类也有粗化</h2><p>正面备注没有被归为错误；但“增减性写反”被归为“推理不完整”等标签，未必是教师最合适的分类。报告始终保留原文字备注作为依据，不能只依赖标签。</p><aside>分析请求不包含原卷图片、学生姓名或学号；使用匿名编号、题目、最终小分、已采用备注与程序统计。所有题目引用与备注引用已核对存在。</aside>`,
  `<h1>调用记录与可查看的材料</h1><p class="lead">6 次完整成功响应，另有 1 次中止。</p>${table(['实际调用','耗时','结果'],timings.map(t=>[t.name,`${t.seconds} 秒`,t.ok?'完整响应成功':'中止，完整响应未取得']))}<p>另有 3 次只读模型列表检查，指定模型均可见。成功响应均返回指定模型名、响应 ID 和 token 用量。</p><h2>费用估算</h2><p>成功调用：输入 ${v.usage.input.toLocaleString()} tokens、输出 ${v.usage.output.toLocaleString()} tokens，缓存命中输入 ${v.usage.cached} tokens。按当日官方非高峰 USD 单价估算约 <b>$${v.usage.estimatedUSD.toFixed(5)}</b>。中止请求可能已计费，未包含在估算内；未核对账户实际扣款。</p><p class="small">价格依据：<a href="https://api-docs.deepseek.com/quick_start/pricing/">DeepSeek 官方模型价格</a>；图片格式依据：<a href="https://api-docs.deepseek.com/guides/vision/">DeepSeek 官方图片输入文档</a>。</p><h2>打开结果</h2><p>本机双击“打开本次实测.cmd”，查看独立班级、成绩和已保存报告。原始试卷、扫描版、标准答案、两种录分表、17 个报告版本、脱敏接口记录与完整测试备份均已保留。详细文件索引与响应 ID 见同目录 Markdown 报告。</p><aside>本轮只覆盖一份原创题面与一组模拟教师成绩，证明链路能运行，也发现了实际质量问题。尚需不同版式和清晰度试卷，以及真实教师试用来评估稳定性。</aside>`
];
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>知衡 · 真实 API 全流程测试报告</title><style>@page{size:A4;margin:15mm 17mm}*{box-sizing:border-box}body{margin:0;color:#233e49;font:14px/1.85 'Microsoft YaHei',sans-serif;background:#eef3f4}.page{padding:36px;background:#fff;margin:20px auto;max-width:780px;break-after:page}.page:last-child{break-after:auto}header{display:flex;justify-content:space-between;color:#227c6a;border-bottom:1px solid #d6e4e3;padding-bottom:9px;font-size:10px}h1{font-size:27px;margin:22px 0 4px}h2{font-size:16px;margin:20px 0 6px;break-after:avoid}p{margin:9px 0}.lead{font-size:16px;color:#548076;margin:4px 0 18px}.metrics{display:flex;justify-content:space-between;background:#edf6f2;padding:15px;font-size:13px;margin:18px 0}table{width:100%;border-collapse:collapse;margin:15px 0;font-size:12px}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #dce7e8;vertical-align:top}th{background:#edf4f3;color:#346255}tr{break-inside:avoid}aside{border-left:3px solid #338271;padding:12px 15px;margin:20px 0;background:#f0f7f3;font-size:12px;break-inside:avoid}.small{font-size:11px}a{color:#247a6b}footer{color:#73878d;font-size:10px;margin-top:20px;border-top:1px solid #dce7e8;padding-top:9px}@media print{body{background:white}.page{padding:0;margin:0;max-width:none}}</style>${sections.map((s,i)=>`<section class="page"><header><span>知衡 · 真实 API 全流程实测</span><span>${i+1} / ${sections.length}</span></header>${s}<footer>2026-09-08 · 原始响应保留，测试资料不含真实学生信息。</footer></section>`).join('')}</html>`;
writeFileSync(path.join(dir,'真实API全流程测试报告.html'),html);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage();await page.goto(pathToFileURL(path.join(dir,'真实API全流程测试报告.html')).href);await page.evaluate(()=>document.fonts.ready);await page.pdf({path:path.join(dir,'真实API全流程测试报告.pdf'),format:'A4',preferCSSPageSize:true,printBackground:true});}finally{await browser.close();}
console.log('Real API test report generated in Markdown, HTML and PDF.');

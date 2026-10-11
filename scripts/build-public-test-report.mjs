import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
const dir=path.resolve('output/real-api/public-papers-20260908');const read=f=>JSON.parse(readFileSync(path.join(dir,f),'utf8'));
const v=read('verification.json'),qa=read('semantic-review.json'),cases=read('cases.json');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=(heads,rows)=>`<table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const sum=(xs,k)=>xs.reduce((a,x)=>a+(x[k]||0),0),known=xs=>xs.filter(x=>x.input!==null);
const costRows=Object.entries(v.groups).map(([k,xs])=>({kind:k,name:{extract:'识卷',classReport:'班级 AI 解读',personalReport:'个人 AI 解读'}[k],calls:xs.length,known:known(xs).length,input:sum(xs,'input'),output:sum(xs,'output'),usd:sum(xs,'estimatedUSD'),min:Math.min(...known(xs).map(x=>x.estimatedUSD)),max:Math.max(...known(xs).map(x=>x.estimatedUSD))}));
const individual=costRows.find(r=>r.kind==='personalReport'),classes=costRows.find(r=>r.kind==='classReport');
const cost40=.007336074+classes.usd/classes.known+40*individual.usd/individual.known;
const recognition=[
 ['全国I卷 · 清晰','4','可编辑，但不正确','19 道大题被拆成26个计分项；未印小问分值却各填6分，合计145而非150；3道多选标单选，第19题不等号反向'],
 ['全国II卷 · 清晰','6','识别任务失败','两次120秒超时后第三次取得响应，但公式定界符转义不符合JSON要求，程序不能展示可编辑结果'],
 ['海淀期末 · 清晰','3','可编辑，但不正确','19题、100分、题型、页码均匹配；仍有6道题包含影响数学含义的转录问题'],
 ['海淀期末 · 模糊倾斜','3','识别任务失败','返回16(1)等小问却没有对应父题，层级校验拒绝；诊断还发现公式、端点和下标误读'],
];
const defects=[
 ['1','y²/2+x²=1','x²/2+y²=1','改变焦点所在轴'],
 ['4','选项C：(-1/2,-1)','(1/2,-1)','漏负号'],
 ['6','侧面与底面垂直','垂直符号遗漏','丢失关键已知条件'],
 ['9','选项A：x+2y=a','x+2y-a','方程丢失等号'],
 ['15','∠AOD=91°','∠AOD=90°','改变结论判断'],
 ['19','动直线 x=t','直线 x=1','参数变成常数；向量数量积符号也需明确'],
];
const md=`# 知衡 0.1.3 · 公开真卷、学情质量与 token 开销实测

测试日期：2026-09-08。模型：DeepSeek 官方 deepseek-v4-flash-vision-exp。结论：统计与导出可靠；识卷仍不稳定，报告可以作为可编辑草稿；本轮费用较低，但不能用低费用代替准确性验收。

## 样本与测试方式

使用3套网上公开的真实考试题整理版PDF：${cases.map(c=>`[${c.title}](${c.url})`).join('、')}。这些是公开流传的整理版，不是本次从考试院取得的原版扫描件。

只选题面页（全国I卷1—4页，全国II卷1—6页，海淀1—3页），先栅格化再生成没有文字层的PDF，软件再通过真实界面读取全部页并发送图片。答案页仅留在本地核对，未送入识卷模型。清晰版宽1800像素；海淀另做宽900像素、轻微旋转与模糊的对照，原有水印保留。不是现场扫描仪采集，也没有模拟手写作答。

固定当前程序的识别提示和默认模型请求方式，单次输出上限16000 tokens。全程真实调用，没有假响应或拦截替换。原始响应、实际发送图片、用量、失败和教师修正均留档。班级、成员与小分是明确标注的模拟教师资料，未使用真实学生个人信息。

## 识别结果

| 输入 | 题面页 | 应用结果 | 主要发现 |
|---|---:|---|---|
${recognition.map(r=>'|'+r.join('|')+'|').join('\n')}

4个输入仅2个形成可编辑提案，两个提案均需要人工纠正。这不是大样本准确率。海淀清晰版的结构字段19/19匹配，并不代表题干正确。逐题核对发现6道题有影响数学含义的错误：

| 题号 | 原稿 | AI输出 | 影响 |
|---|---|---|---|
${defects.map(r=>'|'+r.join('|')+'|').join('\n')}

上述海淀题干错误没有被逐题不确定性提示标出。清晰版只提示跨页合并。全国I卷的145/150分不一致会触发确认拦截，但仍需教师识别并纠正错误拆分，不能直接认同模型猜出的分值。

网络源本身也影响测试：全国I卷只印了解答题合计77分，未印各大题分值；全国II卷的整理版未印逐题分值或全卷总分。正确行为应保留未知并请教师补齐。全国II卷虽未被应用接受，离线诊断仍发现模型自行填了150分和小问6分；修复JSON仅用于查看失败原因，未算作识别成功，未把它送入后续分析。

## 题面核对与分析输入

后续分析使用全国I卷及海淀清晰版，由我对照原稿修正题面；全国I卷合并错误小问，由模拟教师明确提供整题评分方案。修正记录在teacher-corrections.json。此次没有通过调整生产识别提示并重跑来掩盖首次结果。

建立40人测试班级，构造3个分析场景：全国I卷有备注、海淀有备注、海淀相同小分无备注。每场19个计分项、760个单元格记录，713格为最终成绩。包含37份完整成绩（含一名全零分学生）、1份漏录、1份草稿、1份缺考。海淀的两名对照学生逐题分数完全相同，总分均54/100，第16题均7/10，但备注分别指向勾股关系理解与根式化简。

模拟数据中，全国I卷测评02的第14题同时有5/5满分和“配对遗漏”备注，属于不一致输入，不能据此断定扣分。模型未提示矛盾而自行写成失分，单独列为边界问题。第15题实际0分，“未得分”的描述正确，不列作错误。

班级创建、评分写入及分析任务使用真实应用服务；识卷导入、结果查看、报告查看与PDF导出使用真实界面。前一轮已完成逐格教师界面流程，本轮重点是输入多样性、分析质量与费用。

## 独立数据核算

| 场景 | 均分/满分 | 完整/班级人数 | 缺考/待完成 | 知识点聚合项 |
|---|---|---|---|---|
${v.scenarios.map(s=>`|${s.id}|${s.average}/${s.max}|${s.complete}/${s.students}|${s.absent}/${s.pending}|${s.topics}|`).join('\n')}

三组共2280格记录（包含无备注对照的重复小分），2139格最终成绩；逐格分数、状态、备注、总分、均分、中位数、标准差、逐题得分率和知识点得分率独立重算一致。Excel导出保留零分，草稿/漏录为空，缺考标记为缺考。海淀有备注与无备注场景统计完全相同。

## AI报告质量

生成3份班级与5份个人AI报告，另存3份基础报告。逐项审阅8份AI报告中的36条发现；有3份报告存在具体事实或引用问题，不应原样发出。由本次执行者对照题目和输入审阅，并非正式教师盲评，不能推广成稳定准确率。

${qa.reviews.map(r=>`### ${r.name}：${r.judgment}\n\n优点：${r.strength}\n\n问题/局限：${r.issue}\n\n建议：${r.suggestion}`).join('\n\n')}

程序的引用检查已全部通过，但它只能保证引用存在，不能保证引用语义支持结论。满分学生“抽查解答题”却引用选择题就是实际例子。海淀原始知识点聚合仅有“解析几何”和“立体几何”两类，标签方向不算错，但粒度过粗；模糊版反而给出更细标签，说明标签粒度也不稳定。

## token与实际调用记录

| 用途 | 取得用量/实际请求 | 输入token | 输出token | 已知用量费用USD |
|---|---:|---:|---:|---:|
${costRows.map(r=>`|${r.name}|${r.known}/${r.calls}|${r.input}|${r.output}|${r.usd.toFixed(6)}|`).join('\n')}
|合计|${v.usage.withUsage}/${v.usage.calls}|${v.usage.input}|${v.usage.output}|${v.usage.estimatedUSD.toFixed(6)}|

输出包含${v.usage.reasoning}个服务商报告的推理tokens，已经计在${v.usage.output}中，不能再次相加。缓存命中输入${v.usage.cached} tokens。两次超时请求各等待约120秒，用量未知，可能已经计费，未计入上述估算。取得响应但被应用拒绝的输出仍计费，已计入表内。

采用[DeepSeek当日官方价格](https://api-docs.deepseek.com/quick_start/pricing/)：本轮均在非高峰，输入缓存未命中$0.22/百万、命中$0.007/百万、输出$0.66/百万。费用为按响应用量核算的估计，不是账户扣款核对。软件内简化估算没有分开缓存价格，本报告以原始响应计算。仅为便于理解，若按1美元=7元的假设换算，已知费用约${(v.usage.estimatedUSD*7).toFixed(2)}元人民币，此换算不是实时汇率。

| 调用 | 秒 | 输入/输出token | 费用USD | 结果/响应ID |
|---|---:|---:|---:|---|
${v.calls.map(c=>`|${c.context}|${c.seconds.toFixed(1)}|${c.input??'未知'}/${c.output??'未知'}|${c.estimatedUSD===null?'未知':c.estimatedUSD.toFixed(6)}|${c.error||c.id}|`).join('\n')}

按本轮个人报告样本，单份约$${individual.min.toFixed(4)}—$${individual.max.toFixed(4)}，约13—39秒；班级报告约$${classes.min.toFixed(4)}—$${classes.max.toFixed(4)}，约9—36秒。取得完整响应的识卷单次约60—105秒，全国II卷经历重试总计约344秒仍失败。

如果按40份个人报告、1份班级报告和1次识卷估算，以本轮平均用量约$${cost40.toFixed(3)}（按7元/美元假设约${(cost40*7).toFixed(2)}元）。这是样本推算，不是已经运行40次个人分析；不含重试，不保证未来模型价格或复杂试卷用量。

对8个已完成报告逐一发起相同任务请求，均返回原任务且新增外部调用为0；这是应用已有结果复用，与服务商token缓存计价不同。

## 交付前优先处理

1. 识卷可靠性：未知分值不可推断；不合法JSON、缺失父题应有可恢复的处理；数学符号、参数与跨页题应便于对照核对。
2. 报告事实检查：对满分、零分、有无备注等关键断言核验；发现备注与小分不一致时提示教师；检查引用题目是否支持建议。
3. 知识点规范：统一知识目录层级，避免同一卷只得到两个大类而另一轮得到细分标签。
4. 时间和费用：分批识卷、可续跑任务、超时调用单独记账；缩短重复字段，评估是否需要当前推理强度。优化前后需要重新做质量对照，不能只看token下降。

本轮未修改产品源代码或发布新版本。测试脚本中两处接口使用问题已经修正并留档，均在任务结束后发生，没有新增付费重跑；与上述产品/模型失败分开记录。

导出视觉复核：12份PDF（含本测试总结）均可正常阅读，未发现正文裁切。海淀测评03的AI报告末页仅剩说明文字，出现了不必要的分页；保留原始导出，列为排版改进项。

## 查看材料

本机双击“打开本次真卷实测.cmd”可查看独立测试工作区。报告、录分表与“公开真题实测资料.zhb”可离线查看/备份恢复。source.json保存来源和哈希，image-manifest保存输入图像尺寸与哈希，network记录官方响应与用量。密钥不写入报告或资料包。原始PDF、网络整理内容的版权归原权利人，仅作为本次测试依据。
`;
writeFileSync(path.join(dir,'公开真卷测试与费用报告.md'),md);
const pages=[
 `<h1>真卷识别与学情分析实测</h1><p class="lead">识别仍不稳定，分析草稿有价值，调用费用较低。</p><p>知衡 0.1.3 · DeepSeek 官方接口 · 2026 年 9 月 8 日</p><div class="metrics"><b>3 套真卷</b><b>4 个图片输入</b><b>8 份 AI 报告</b><b>14 次真实请求</b></div><h2>先看结论</h2>${table(['检查','实际结果'],[['识卷可编辑结果','2/4 个输入形成提案；两份均有需要修正的题面问题'],['学情分析','8 份报告、36 条发现；3 份存在具体事实或引用问题'],['数据计算与导出','3 组场景逐格独立核算一致，缺考/草稿/漏录处理正确'],['已知用量费用',`$${v.usage.estimatedUSD.toFixed(5)}；另2次超时开销未知`]])}<h2>测的是什么</h2><p>2024 高考新课标 I 卷、II 卷及北京海淀高二期末的公开整理版 PDF。只取题面，转成纯图片，再由软件发送全部页面。答案解析未送入识题模型。</p><p>海淀另做模糊、倾斜对照；40 人班级小分与备注为专门编制的测试资料。实际接口、任务和导出均真实执行，没有模拟响应。</p><aside>这轮显示：教师拥有编辑权是必要功能，但仍不足以解决格式失败、漏掉数学符号、以及报告文字与成绩不一致的问题。当前组合应继续作为需要核对的试用工具。</aside>`,
 `<h1>四个识别输入发生了什么</h1><p class="lead">固定提示，保留首次结果和全部失败。</p>${table(['输入 / 页数','结果','主要问题'],recognition.map(r=>[r[0]+' / '+r[1]+'页',r[2],r[3]]))}<h2>结构匹配也会漏掉题干错误</h2>${table(['海淀题号','原稿','模型输出'],defects.map(r=>[r[0],r[1],r[2]]))}<p class="small">海淀清晰版这6道题的错误没有被逐题不确定性提示标出。原卷未标小问分值时，应整题计分；原卷未标整题分值时，应留待教师补充。</p><aside>格式错误与父题缺失均被应用拒绝，没有写入正式题目；此时老师也无法直接编辑一份完整的识别提案。4 个输入不足以推断通用识别准确率。</aside>`,
`<h1>分析是否真的看了证据</h1><p class="lead">同分不同错因的对照有效；关键事实仍有错误。</p>${table(['控制条件','模型表现'],[['两人逐题相同、总分均54，第16题均7/10','根据备注分别建议补勾股关系理解、根式化简，方向不同'],['删除全部备注，保持相同小分','改为待验证解释，未沿用确定错因；建议更宽泛'],['个人满分、班级均分47.22','未把班级失分套到满分学生身上']])}<h2>三份报告需要修订</h2>${table(['报告','核对发现'],[['全国I卷班级','已引用17—19题备注，后文却将15—19题概括为没有具体错因备注'],['全国I卷测评02','第14题实际5/5，遇到“配对遗漏”的矛盾备注后，自行写成未得满分'],['海淀满分学生','建议抽查解答题书写过程，却只引用第1、2题，两题都是选择题']])}<p>第14题的满分与错因备注是不一致测试输入，应先请教师核对；AI 不应自行改写得分事实。程序保证引用存在，但尚不能保证引用在语义上支持建议。</p><aside>其余报告也有“可能综合推理能力不足”等笼统措辞，应改为可观察的解题步骤。原报告全部保留，没有用教师修订版代替模型原始表现。评审由本次执行者逐项完成，尚未经过真实教师盲评。</aside>`,
 `<h1>token 开销与等待时间</h1><p class="lead">12 次取得用量的响应，合计约 $${v.usage.estimatedUSD.toFixed(5)}。</p>${table(['用途','有用量 / 请求','输入 token','输出 token','估算 USD'],costRows.map(r=>[r.name,r.known+'/'+r.calls,r.input.toLocaleString(),r.output.toLocaleString(),'$'+r.usd.toFixed(5)]))}<p>合计输入 <b>${v.usage.input.toLocaleString()}</b>、输出 <b>${v.usage.output.toLocaleString()}</b> tokens；输出中含 <b>${v.usage.reasoning.toLocaleString()}</b> 个推理 tokens，已经包含在总输出中。缓存命中输入 ${v.usage.cached.toLocaleString()} tokens。</p><aside>另外两次超时各等待120秒，可能已经计费，用量未知，未计入上述估算。取得响应但因格式或层级问题被应用拒绝的费用已经计入。未核对账户实际扣款。</aside><h2>一次教学任务的预算参考</h2>${table(['项目','本轮样本范围'],[['单份个人 AI 报告',`$${individual.min.toFixed(4)}—$${individual.max.toFixed(4)}，约13—39秒`],['单份班级 AI 报告',`$${classes.min.toFixed(4)}—$${classes.max.toFixed(4)}，约9—36秒`],['取得完整响应的识卷','单次约60—105秒；全国II卷重试后仍失败'],['40份个人+1份班级+1次识卷',`按平均用量推算约$${cost40.toFixed(3)}，不含重试，并非已运行40次个人分析`]])}<p class="small">本轮均为非高峰。按官方美元/百万tokens：输入未命中0.22、命中0.007、输出0.66。若仅以1美元=7元假设换算，本轮已知费用约${(v.usage.estimatedUSD*7).toFixed(2)}元；整班预算算例约${(cost40*7).toFixed(2)}元。此换算不是实时汇率。<a href="https://api-docs.deepseek.com/quick_start/pricing/">官方价格依据</a></p>`,
 `<h1>统计核算与测试边界</h1><p class="lead">分数计算可信，语义准确性需要另行核查。</p>${table(['场景','均分 / 满分','完整成绩'],[['全国I卷 · 有备注','67.92 / 150','37 / 40'],['海淀期末 · 有备注','47.22 / 100','37 / 40'],['海淀期末 · 无备注','47.22 / 100','37 / 40']])}<p>每场760个单元格记录，其中713格是最终成绩；均有1人漏录、1人全草稿、1人缺考，完整成绩中包含1名全零分学生。三组共2280格（包含对照组重复小分），均按原始教师输入独立重算。</p><h2>核对通过</h2><p>逐格分数、状态和备注；学生总分；均分、中位数、总体标准差；逐题得分率与知识点得分率；Excel零分、空白和缺考状态。全部36条分析的题目引用、备注引用均存在。重复请求8个已完成报告，外部新增调用均为0。</p><h2>尚不能据此保证的事项</h2><p>真实学生学习提升、不同老师的评分一致性、不同扫描仪和手写覆盖、更多试卷的稳定识别，以及全班40份AI个人报告的实际总耗时。</p><aside>海淀清晰版的主要知识点被合并成“解析几何”和“立体几何”两类。标签方向大体正确，但太粗，难以直接支持细分知识点统计。仅有结构校验和得分核算，不能替代数学题面与报告语义核对。</aside>`,
 `<h1>下一版最该改进的地方</h1><p class="lead">先补可靠性，再扩大教师试用。</p>${table(['优先级','改进目标','本轮证据'],[['高','未知分值保护、格式与层级错误恢复','自行分配小问分数；非法JSON；找不到父题'],['高','报告关键事实检查','满分写成失分；有备注写成无备注'],['高','原卷与公式、参数的便捷核对','椭圆轴向、负号、角度、参数t均有误读'],['中','引用相关性与标签粒度','选择题引用用于解答题建议；知识点仅两个大类'],['中','超时、续跑和费用记录','2次超时无用量；长输出推理占用明显']])}<h2>材料与复现</h2><p>本机双击“打开本次真卷实测.cmd”，查看独立测试工作区。已保存11份报告（8份AI、3份基础）、3份录分表、完整备份和脱敏接口记录。详细响应ID、逐份质量评审、教师修正和全部用量见同目录 Markdown 报告。</p><p class="small">来源：${cases.map(c=>`<a href="${esc(c.url)}">${esc(c.title)}</a>`).join('；')}。公开整理版不等于考试院原始扫描件。仅将题面送入API，参考答案留在本地；试题版权归原权利人。</p><aside>本轮没有改动产品代码来追求通过率。费用低说明试用成本可控，尚不意味着可以取消教师核对。正式交付应继续以更多真卷和教师盲评检验改进效果。</aside>`
];
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>公开真卷测试与费用报告</title><style>@page{size:A4;margin:14mm 16mm}*{box-sizing:border-box}body{margin:0;background:#edf2f3;color:#243e49;font:13px/1.8 'Microsoft YaHei',sans-serif}.page{background:#fff;margin:20px auto;padding:36px;max-width:800px;break-after:page}.page:last-child{break-after:auto}header{display:flex;justify-content:space-between;color:#287a70;font-size:10px;border-bottom:1px solid #dbe5e6;padding-bottom:8px}h1{font-size:26px;line-height:1.35;margin:23px 0 7px}h2{font-size:16px;margin:19px 0 6px;break-after:avoid}.lead{font-size:15px;color:#54796f;margin:0 0 17px}p{margin:10px 0}.metrics{display:flex;justify-content:space-between;background:#eaf5f0;padding:14px;margin:20px 0;font-size:13px}table{width:100%;border-collapse:collapse;font-size:11px;margin:14px 0}th,td{padding:8px 9px;border-bottom:1px solid #dde6e6;text-align:left;vertical-align:top}th{background:#edf4f2;color:#2f635b}tr{break-inside:avoid}aside{font-size:11px;padding:12px 14px;border-left:3px solid #238275;background:#edf6f2;margin:18px 0;break-inside:avoid}.small{font-size:10px;line-height:1.75}footer{border-top:1px solid #dbe5e6;color:#788b91;font-size:10px;margin-top:20px;padding-top:9px}a{color:#207b6b}@media print{body{background:white}.page{padding:0;margin:0;max-width:none}}</style>${pages.map((s,i)=>`<section class="page"><header><span>知衡 · 公开真卷实测</span><span>${i+1} / ${pages.length}</span></header>${s}<footer>2026-09-08 · 真实调用，模拟教师成绩 · 原始结果保留</footer></section>`).join('')}</html>`;
writeFileSync(path.join(dir,'公开真卷测试与费用报告.html'),html);
const browser=await chromium.launch({channel:'chrome',headless:true});try{const page=await browser.newPage();await page.goto(pathToFileURL(path.join(dir,'公开真卷测试与费用报告.html')).href);await page.evaluate(()=>document.fonts.ready);await page.pdf({path:path.join(dir,'公开真卷测试与费用报告.pdf'),format:'A4',preferCSSPageSize:true,printBackground:true});}finally{await browser.close();}
console.log('Created detailed Markdown and 6-page PDF test report.');

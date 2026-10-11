import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('output/real-api/public-papers-20260908');const read=f=>JSON.parse(readFileSync(path.join(out,f),'utf8'));
const reviews=[
 {scenario:'national1-2024-with-notes',target:'class',name:'全国I卷 · 班级',judgment:'需修订',hardIssue:true,issue:'前四项引用了第17—19题的具体备注，第五项却把第15—19题统称为“目前没有具体错因备注”，与输入和本报告前文矛盾。',suggestion:'明确区分第15、16题无备注，以及第17—19题有少量备注但不能代表全班。',strength:'能够引用导数符号、定义域、空间角、枚举和证明备注，多处注明只是个别样本。'},
 {scenario:'national1-2024-with-notes',target:'individual',name:'全国I卷 · 测评02',judgment:'需修订',hardIssue:true,issue:'第14题实际5/5，却被写成“导致本题未得满分”。第15题实际为0分，报告所说“未得分”在这一题上是正确的。',suggestion:'关键得分状态须与程序记录逐题一致；分数和备注冲突时，提示核对而不是自行解释成扣分。',strength:'能够根据第14题的枚举备注提出系统列举建议，对其他错因多用待验证表述。',inputCaveat:'本测试数据中第14题同时存在满分和“配对遗漏”的备注，这是不一致输入。无法据此认定真的失分；该条也检验了模型是否会尊重最终分数。'},
 {scenario:'haidian-2024-with-notes',target:'class',name:'海淀期末 · 有备注班级',judgment:'未发现明确事实错误',hardIssue:false,issue:'建议基本合理，但仍较概括，未形成明确的课时安排和优先级。',suggestion:'教师结合班级实际安排教学顺序。',strength:'区分弦长关系理解与根式运算，正确解释抛物线焦点、双曲线关系、二面角和数量积；明确备注只代表个别学生。'},
 {scenario:'haidian-2024-with-notes',target:'same-score-concept',name:'海淀期末 · 测评02（关系理解）',judgment:'基本可用，措辞宜收窄',hardIssue:false,issue:'“综合推理能力不足”等候选解释较宽泛，虽然标为可能，仍宜改成可观察的解题步骤。',suggestion:'围绕能否画出直角三角形并写出勾股关系安排复测。',strength:'针对第16题7/10的明确备注，建议补弦长公式推导与勾股关系。'},
 {scenario:'haidian-2024-with-notes',target:'same-score-calculation',name:'海淀期末 · 测评03（根式运算）',judgment:'未发现明确事实错误',hardIssue:false,issue:'有时重复分数，虽与本次数据一致，仍应由程序统一展示。',suggestion:'保留针对根式化简的行动及复测；继续核对其他无备注失分点。',strength:'与测评02小分完全相同，却根据备注正确转为根式化简训练，没有要求重新学习列式。'},
 {scenario:'haidian-2024-with-notes',target:'full-score',name:'海淀期末 · 满分学生',judgment:'引用需修订',hardIssue:true,issue:'“抽查解答题书写过程”的建议只引用第1、2题，两题实际上都是选择题，引用与建议对象不匹配。',suggestion:'若保留过程抽查建议，应引用实际解答题；也可增加迁移应用或优秀解法整理。',strength:'识别出该生全部满分，没有将班级弱项当作其个人失分；正面备注未被改写为错误。'},
 {scenario:'haidian-2024-no-notes',target:'class',name:'海淀期末 · 无备注班级',judgment:'可作待验证方向，不能作错因结论',hardIssue:false,issue:'“综合推理能力不足”“基础知识掌握不够牢固”虽然加了可能，仍比较笼统。',suggestion:'先用答题过程或短测核对，再决定是否需要相应专项复习。',strength:'全部5项均标为假设，没有伪造具体备注；关注较低得分的解答题和结论判断题。'},
 {scenario:'haidian-2024-no-notes',target:'same-score-without-evidence',name:'海淀期末 · 测评02（无备注）',judgment:'未发现明确事实错误',hardIssue:false,issue:'建议比有备注版本宽泛，无法定位第16题是不会关系还是算错。',suggestion:'用教师的一句具体备注缩小检查范围。',strength:'没有沿用有备注版本的确定错因，区分未得分与部分完成；安排对应的变式检查。'},
];
const n1=read('national1-2024-with-notes/report-individual.json');const s=n1.snapshot.finalResults[0];const score=label=>s.grades.find(g=>g.questionId===n1.snapshot.questions.find(q=>q.label===label).id).score;
assert.equal(score('15'),0);assert.equal(score('14'),5);assert.ok(n1.content.findings.some(f=>f.observation.includes('均未得分')));assert.ok(n1.content.findings.some(f=>f.observation.includes('未得满分')));
const full=read('haidian-2024-with-notes/report-full-score.json');const step=full.content.findings.find(f=>f.action.includes('解答题'));assert.ok(step);assert.deepEqual(step.evidence.map(id=>full.snapshot.questions.find(q=>q.id===id).label),['1','2']);
const plan=read('analysis-plan.json');const hs=plan.scenarios.find(s=>s.id==='haidian-2024-with-notes');assert.deepEqual(hs.students[1].grades.map(g=>g.score),hs.students[2].grades.map(g=>g.score));assert.equal(hs.students[1].total,54);assert.equal(hs.students[2].total,54);
for(const r of reviews){const report=read(`${r.scenario}/report-${r.target}.json`);r.reportId=report.id;r.findings=report.content.findings.length;}
const result={reviewer:'本次测试执行者逐项对照题面、输入成绩和原备注；不是模型自评，也不是正式教师盲评。',reports:8,reportsWithConcreteFactOrReferenceIssue:3,findingsReviewed:reviews.reduce((n,r)=>n+r.findings,0),allScoresEqualForPairedStudents:true,pairedTotal:54,limits:'仅两份完成教师题面核对的真题、三组模拟成绩场景。一次输出的人工检查结果，不能推广为稳定准确率。',reviews};
writeFileSync(path.join(out,'semantic-review.json'),JSON.stringify(result,null,2));console.log('Reviewed all 8 reports and 36 findings; 3 reports have concrete fact/reference issues.');

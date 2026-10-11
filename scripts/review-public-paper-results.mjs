// Teacher review against the downloaded page images. Raw provider output is immutable.
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('output/real-api/public-papers-20260908');
const read=f=>JSON.parse(readFileSync(path.join(out,f),'utf8'));
const save=(f,v)=>writeFileSync(path.join(out,f),JSON.stringify(v,null,2));
const cases=read('cases.json'),records=[];
for(const id of ['national1-2024','haidian-2024']){
 const c=cases.find(x=>x.id===id),task=read(id+'/clean/task-extract.json');assert.equal(task.status,'succeeded');
 const all=task.result.questions,questions=[];
 for(let i=1;i<=19;i++){
  const q=structuredClone(all.find(x=>x.label===String(i)));assert.ok(q);
  const children=all.filter(x=>x.parentId===q.id);
  if(children.length){q.stem=[q.stem,...children.map(x=>x.label+' '+x.stem)].join('\n');q.type='solve';q.parentId=null;records.push({paper:id,label:q.label,field:'scoringStructure',before:children.map(x=>({label:x.label,max:x.max})),after:'整题一个计分项',reason:'题面未印小问分值，删除模型自行分配的小问分数，保留完整小问原文。'});}
  for(const [field,value] of [['max',c.teacherMarks[i-1]],['type',c.types[i-1]],['page',c.questionPages[i-1]]])if(q[field]!==value){records.push({paper:id,label:q.label,field,before:q[field],after:value,reason:field==='max'&&c.printedMarks[i-1]===null?'题面缺少本题分值；教师为测试录分明确提供评分方案，不计作自动识别正确。':'对照原卷印刷内容修正。'});q[field]=value;}
  q.confirmed=true;questions.push(q);
 }
 function edit(label,from,to,reason){const q=questions.find(q=>q.label===label);assert.ok(q.stem.includes(from),`Missing expected phrase ${id} ${label}`);const before=q.stem;q.stem=q.stem.replace(from,to);records.push({paper:id,label,field:'stem',before,after:q.stem,reason});}
 if(id==='national1-2024'){
  edit('19','P_m\\le\\frac{1}{8}','P_m>\\frac{1}{8}','原卷第19题(3)要求证明 P_m>1/8，模型反转为≤。');
  const q=questions.find(q=>q.label==='11');q.related=q.related.filter(t=>t!=='抛物线的定义');records.push({paper:id,label:'11',field:'related',reason:'距离乘积为常数的轨迹不是抛物线定义，删除不合适的相关标签。'});
 }else{
  edit('1','x^2/2 + y^2 = 1','y^2/2 + x^2 = 1','原卷的分母2在y²下方，轴向不能互换。');
  edit('4','(1/2, -1)','(-1/2, -1)','恢复C选项横坐标前的负号。');
  edit('6','侧面 ABB1A1 底面 ABC','侧面 ABB1A1 ⊥ 底面 ABC','恢复侧面与底面垂直这一关键条件。');
  edit('9','(A) x+2y-a','(A) x+2y=a','原卷选项A是方程，恢复等号。');
  edit('15','∠AOD = 90°','∠AOD = 91°','原卷印刷值为91°，不是90°。');
  edit('19','交直线 x=1','交动直线 x=t','原卷是动直线x=t，模型误识别为固定直线x=1。');
  edit('19','HC·HD','向量 HC 与向量 HD 的数量积','恢复向量箭头所表达的数量积含义，避免误解为长度相乘。');
 }
 assert.equal(questions.length,19);assert.equal(questions.reduce((n,q)=>n+q.max,0),c.teacherMarks.reduce((a,b)=>a+b,0));
 save(id+'/teacher-reviewed-questions.json',questions);
}
save('teacher-corrections.json',records);
const plan=read('analysis-plan-draft.json');plan.excluded=[{paper:'national2-2024',reason:'程序在两次超时后取得的响应仍因非法JSON而失败。保留失败，不以手工修复JSON冒充自动识别成功；不将该卷送入后续分析。'}];
plan.scenarios=plan.scenarios.filter(s=>!s.id.startsWith('national2-2024')).map(s=>({...s,reviewedQuestionsFile:s.paper.split('/')[0]+'/teacher-reviewed-questions.json'}));
save('analysis-plan.json',plan);
console.log('Teacher-reviewed 2 papers. Kept the failed third paper outside analysis. Analysis targets:',plan.scenarios.reduce((n,s)=>n+s.reports.length,0));

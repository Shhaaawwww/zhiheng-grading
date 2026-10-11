// Fixed teacher-authored score scenarios. These are test records, not real pupil results.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
const out=path.resolve('output/real-api/public-papers-20260908');
const cases=JSON.parse(readFileSync(path.join(out,'cases.json'),'utf8'));
const save=(f,v)=>writeFileSync(path.join(out,f),JSON.stringify(v,null,2));
const notes={
 'national1-2024':[
 [2,14,'列举卡片配对时遗漏了一种符合条件的配对。'],[3,17,'空间法向量已列出，但把题目要求的正弦值当成余弦值使用。'],[4,18,'求导时对 ln(2-x) 的复合求导符号处理错误。'],[5,19,'只举出几个分组例子，尚未证明对一般 m 都成立。'],[6,18,'讨论参数时遗漏函数定义域 0<x<2 的限制。'],[1,2,'复数运算和检验都正确。'],[7,12,'待核对。']
 ],
 'national2-2024':[
 [2,18,'第二阶段概率计算正确，但漏乘第一阶段至少投中一次的概率。'],[3,16,'求导后没有区分极大值与极小值，只找到了驻点。'],[4,17,'所取法向量方向没有核对，二面角的三角函数值处理有误。'],[5,19,'把第 n 项与第 n+1 项下标混用了。'],[6,14,'每行只选一个，但未排除同一列重复选择。'],[1,1,'复数模的计算正确。'],[7,11,'再看看。']
 ],
 'haidian-2024':[
 [2,16,'圆心到直线的距离已算对，但不知道半弦长、圆心距和半径应满足勾股关系，后半段未完成。'],
 [3,16,'半弦长公式和代入过程均正确，最后化简根式时发生计算错误；并非不会列式。'],
 [4,17,'焦点坐标写成 (0,p)，未使用 (0,p/2)。'],[5,18,'法向量已求出，选取二面角时没有核对法向量夹角与二面角的关系。'],
 [6,19,'求向量 HC 与 HD 的数量积时，把两个向量的长度直接相乘，遗漏了夹角因素。'],[7,15,'待核对。'],[1,16,'方法和计算均正确。'],[8,8,'错把双曲线关系写成 c²=a²-b²。']
 ]
};
const scenarios=[];
for(const c of cases){
 const students=Array.from({length:40},(_,i)=>({number:String(270001+i),name:`测评${String(i+1).padStart(2,'0')}`,grades:c.teacherMarks.map((max,j)=>{
  let score;
  if(i===0)score=max;
  else if(i===36)score=0;
  else if(i===1||i===2){score=j<10?(j%3===0?0:max):j<15?(j%2?max:0):Math.floor(max*.5);}
  else{const rate=Math.max(.05,Math.min(.92,.92-(i%9)*.085-(j>=14?.23:0)+(j%4===0?.04:0)));const r=((i+3)*37+(j+5)*61)%101/100;score=j<8?(r<rate?max:0):Math.round(max*Math.max(0,Math.min(1,rate+(r-.5)*.45)));}
  const g={label:String(j+1),score,status:'final',note:''};
  if(i===37&&j>=10){g.status='ungraded';g.score=null;}
  if(i===38){g.status='draft';g.score=Math.floor(max*.8);}
  if(i===39){g.status='absent';g.score=null;}
  return g;
 })}));
 for(const [student,q,note] of notes[c.id])students[student-1].grades[q-1].note=note;
 if(c.id==='haidian-2024'){students[1].grades[15].score=7;students[2].grades[15].score=7;}
 for(const s of students){s.total=s.grades.every(g=>g.status==='final')?s.grades.reduce((n,g)=>n+g.score,0):null;}
 const scenario={id:c.id+'-with-notes',title:c.title+' · 教师核对后分析（模拟成绩）',paper:c.id+'/clean',students,corrections:[],reports:[{name:'class',number:null},{name:c.id==='haidian-2024'?'same-score-concept':'individual',number:'270002'}]};
 if(c.id==='national2-2024')scenario.reports[1].number='270006';
 if(c.id==='haidian-2024')scenario.reports.push({name:'same-score-calculation',number:'270003'},{name:'full-score',number:'270001'});
 scenarios.push(scenario);
 if(c.id==='haidian-2024')scenarios.push({...structuredClone(scenario),id:'haidian-2024-no-notes',title:'海淀期末 · 相同小分无备注对照（模拟成绩）',students:students.map(s=>({...s,grades:s.grades.map(g=>({...g,note:''}))})),reports:[{name:'class',number:null},{name:'same-score-without-evidence',number:'270002'}]});
}
save('analysis-plan-draft.json',{disclosure:'Real public exam papers; teacher scores and remarks deliberately composed for testing. No scores are claimed to be real pupils. No student solutions are provided to the analysis model.',scenarios});
save('quality-criteria.json',{frozenBeforeAnalysis:true,criteria:[
 'Recognize the source as printed; do not invent missing marks or infer unprinted subpart allocations.',
 'Preserve formulas, inequalities, options, tables and cross-page question continuations.',
 'Primary and related knowledge must fit the actual mathematical task; broad labels are not equivalent to detailed diagnosis.',
 'Recorded causes require relevant teacher notes, not merely a reference that exists.',
 'No-note results describe observed performance and hypotheses, not certain causes, effort or long-term ability.',
 'A full-score pupil must not inherit the class weaknesses as their personal errors.',
 'Equal scores with different notes should yield different targeted actions; no-note counterparts should acknowledge uncertainty.',
 'Teaching actions and suggested exercises must be mathematically appropriate and testable.',
 'Missing, draft and absent scores must not become zero or complete totals.',
 'Provider token usage, retries, failures, elapsed time and cache hits are retained; cost is an estimate from current official prices.'
]});
console.log('Prepared 4 fixed analysis scenarios, 10 report targets, 40 students each, including missing/draft/absence controls.');

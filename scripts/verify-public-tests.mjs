import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
const out=path.resolve('output/real-api/public-papers-20260908');const read=f=>JSON.parse(readFileSync(path.join(out,f),'utf8'));
const plan=read('analysis-plan.json'),results=[];let validReports=0,findings=0;
const near=(a,b)=>assert.ok(Math.abs(a-b)<.005001,`${a} != ${b}`);
for(const scenario of plan.scenarios){
 const e=read(scenario.id+'/exam.json');assert.equal(e.questions.length,19);assert.equal(e.students.length,40);assert.equal(Object.keys(e.grades).length,760);
 for(const s of scenario.students){const actual=e.students.find(x=>x.number===s.number);assert.ok(actual);for(const g of s.grades){const q=e.questions.find(q=>q.label===g.label);const found=e.grades[`${actual.id}:${q.id}`];assert.equal(found.score,g.score);assert.equal(found.status,g.status);assert.equal(found.note,g.note);assert.equal(found.source,'teacher');}assert.equal(e.analysis.students.find(x=>x.id===actual.id).total,s.total);}
 const totals=scenario.students.map(s=>s.total).filter(n=>n!==null).sort((a,b)=>a-b),average=totals.reduce((a,b)=>a+b,0)/totals.length;
 assert.equal(totals.length,37);assert.equal(e.analysis.complete,37);assert.equal(e.analysis.absent,1);assert.equal(e.analysis.pending,2);assert.equal(e.analysis.lowest,0);assert.equal(e.analysis.confirmedCells,713);
 near(e.analysis.average,average);assert.equal(e.analysis.median,totals[18]);near(e.analysis.std,Math.sqrt(totals.reduce((s,x)=>s+(x-average)**2,0)/37));
 for(const q of e.analysis.questions){const gs=scenario.students.map(s=>s.grades.find(g=>g.label===q.label)).filter(g=>g.status==='final');assert.equal(q.n,gs.length);near(q.average,gs.reduce((s,g)=>s+g.score,0)/gs.length);near(q.rate,100*gs.reduce((s,g)=>s+g.score,0)/(gs.length*q.max));}
 for(const t of e.analysis.topics){const qs=e.questions.filter(q=>q.primary===t.name);const sets=scenario.students.map(s=>qs.map(q=>s.grades.find(g=>g.label===q.label))).filter(gs=>gs.every(g=>g.status==='final'));assert.equal(t.n,sets.length);near(t.rate,100*sets.flat().reduce((s,g)=>s+g.score,0)/(sets.length*qs.reduce((s,q)=>s+q.max,0)));}
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(path.join(out,scenario.id,'录分表.xlsx'));const sheet=workbook.getWorksheet('成绩表');assert.equal(sheet.rowCount,41);assert.equal(sheet.columnCount,21);
 for(let i=0;i<40;i++)for(let j=0;j<19;j++){const g=scenario.students[i].grades[j];const value=sheet.getRow(i+2).getCell(j+3).value;const expected=g.status==='final'?g.score:g.status==='absent'?'缺考':null;assert.equal(value,expected);}
 const scopeReports=[];
 for(const target of scenario.reports){const file=scenario.id+'/report-'+target.name+'.json';if(!existsSync(path.join(out,file))){scopeReports.push({target:target.name,ok:false});continue;}const r=read(file);const ids=new Set(r.snapshot.questions.map(q=>q.id));const notes=new Set(r.snapshot.finalResults.flatMap(s=>s.grades.filter(g=>g.note||g.tags.length).map(g=>`${s.student}:${g.questionId}`)));
  for(const f of r.content.findings){findings++;assert.ok(f.evidence.every(id=>ids.has(id)));assert.ok(f.remarkRefs.every(ref=>notes.has(ref)));if(f.certainty==='recorded')assert.ok(f.remarkRefs.length);}
  if(scenario.id.includes('no-notes'))assert.ok(r.content.findings.every(f=>f.certainty==='hypothesis'&&f.remarkRefs.length===0));
  if(target.number){const student=e.students.find(s=>s.number===target.number);assert.equal(r.studentId,student.id);assert.equal(r.snapshot.finalResults.length,1);assert.equal(r.snapshot.scope,'student');}
  const input=JSON.stringify(r.snapshot);for(const s of e.students){assert.ok(!input.includes(s.name));assert.ok(!input.includes(s.number));}assert.ok(!input.includes('image_url'));
  const cache=read(scenario.id+'/cache-'+target.name+'.json');assert.ok(cache.sameTaskId);assert.equal(cache.additionalProviderCalls,0);
  validReports++;scopeReports.push({target:target.name,ok:true,findings:r.content.findings.length,reportId:r.id});
 }
 results.push({id:scenario.id,students:40,complete:37,absent:1,pending:2,finalScores:713,storedCells:760,average:e.analysis.average,max:e.analysis.max,median:e.analysis.median,std:e.analysis.std,topics:e.analysis.topics.length,reports:scopeReports});
}
const logs=readdirSync(out).filter(f=>f.startsWith('network-')).map(f=>({file:f,...read(f)})).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
const usage=logs.map(l=>{assert.equal(l.url,'https://api.deepseek.com/chat/completions');assert.equal(l.request.model,'deepseek-v4-flash-vision-exp');const u=l.response?.usage;const d=new Date(l.startedAt),h=d.getUTCHours(),weekday=d.getUTCDay()>0&&d.getUTCDay()<6,peak=weekday&&((h>=1&&h<4)||(h>=6&&h<10)),mult=peak?2:1;return{context:l.context,file:l.file,status:l.status,error:l.error||null,finish:l.response?.choices?.[0]?.finish_reason||null,id:l.response?.id||null,seconds:l.elapsedMs/1000,input:u?.prompt_tokens??null,output:u?.completion_tokens??null,cached:u?.prompt_cache_hit_tokens??u?.prompt_tokens_details?.cached_tokens??0,reasoning:u?.completion_tokens_details?.reasoning_tokens??null,peak,estimatedUSD:u?((u.prompt_tokens-(u.prompt_cache_hit_tokens??u.prompt_tokens_details?.cached_tokens??0))*.22+(u.prompt_cache_hit_tokens??u.prompt_tokens_details?.cached_tokens??0)*.007+u.completion_tokens*.66)*mult/1e6:null};});
const groups={};for(const u of usage){const kind=u.context.endsWith('/extract')?'extract':u.context.endsWith('/class')?'classReport':'personalReport';(groups[kind]??=[]).push(u);}
const totals={calls:usage.length,withUsage:usage.filter(u=>u.input!==null).length,unknownUsage:usage.filter(u=>u.input===null).length,input:usage.reduce((n,u)=>n+(u.input||0),0),output:usage.reduce((n,u)=>n+(u.output||0),0),cached:usage.reduce((n,u)=>n+u.cached,0),reasoning:usage.reduce((n,u)=>n+(u.reasoning||0),0),estimatedUSD:usage.reduce((n,u)=>n+(u.estimatedUSD||0),0)};
for(const l of logs.filter(l=>!l.context.endsWith('/extract'))){const input=JSON.parse(l.request.messages.find(m=>m.role==='user').content);assert.ok(input.finalResults);assert.ok(!JSON.stringify(input).includes('测评'));assert.ok(!JSON.stringify(input).includes('image_url'));}
const result={ok:true,scope:'Numerical/export/reference checks only; semantic quality is assessed separately in the report.',validReports,findings,scenarios:results,usage:totals,calls:usage,groups,priceSource:'https://api-docs.deepseek.com/quick_start/pricing/',unreportedCallsExcludedFromEstimatedCost:true};
writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:true,validReports,findings,usage:totals,scenarios:results.map(({reports,...x})=>x)},null,2));

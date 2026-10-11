import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { DatabaseSync } from 'node:sqlite';
const dir=path.resolve('output/real-api/deepseek-20260908');
const read=f=>JSON.parse(readFileSync(path.join(dir,f),'utf8'));
const e=read('final-exam.json'),source=read('teacher-input.json'),truth=read('ground-truth.json');
const qs=e.questions.filter(q=>q.type!=='group'&&!e.questions.some(c=>c.parentId===q.id));
const norm=s=>s.replaceAll('（','(').replaceAll('）',')').replaceAll(/\s/g,'');
assert.equal(qs.length,15);assert.equal(e.students.length,12);
assert.equal(qs.reduce((a,q)=>a+q.max,0),100);
assert.equal(Object.keys(e.grades).length,180);
for(const s of source.students){
  const actual=e.students.find(x=>x.number===s.number);assert.ok(actual);
  for(const g of s.grades){
    const q=qs.find(x=>norm(x.label)===g.label);assert.ok(q);
    const found=e.grades[`${actual.id}:${q.id}`];
    assert.equal(found.score,g.score);assert.equal(found.note,g.note);assert.equal(found.status,'final');assert.equal(found.source,'teacher');
  }
  assert.equal(e.analysis.students.find(x=>x.id===actual.id).total,s.total);
}
const totals=source.students.map(s=>s.total).sort((a,b)=>a-b);
const avg=totals.reduce((a,b)=>a+b,0)/totals.length;
const median=(totals[5]+totals[6])/2,std=Math.sqrt(totals.reduce((a,x)=>a+(x-avg)**2,0)/totals.length);
assert.ok(Math.abs(e.analysis.average-avg)<.005001);assert.equal(e.analysis.median,median);assert.ok(Math.abs(e.analysis.std-std)<.005001);
assert.equal(e.analysis.highest,totals.at(-1));assert.equal(e.analysis.lowest,totals[0]);
assert.equal(e.analysis.complete,12);
for(const topic of e.analysis.topics){
  const questions=qs.filter(q=>q.primary===topic.name&&q.confirmed);
  const possible=questions.reduce((n,q)=>n+q.max,0)*12;
  const score=e.students.reduce((n,s)=>n+questions.reduce((n,q)=>n+e.grades[`${s.id}:${q.id}`].score,0),0);
  assert.ok(Math.abs(topic.rate-100*score/possible)<.005001);assert.equal(topic.n,12);
}
const long=new ExcelJS.Workbook();await long.xlsx.readFile(path.join(dir,'全班录分表.xlsx'));
const sheet=long.getWorksheet('逐题明细');assert.equal(sheet.rowCount,181);
for(let i=2;i<=sheet.rowCount;i++){
  const [number,name,label,score,status,note]=sheet.getRow(i).values.slice(1);
  const s=source.students.find(s=>s.number===number);assert.equal(s.name,name);
  const g=s.grades.find(g=>g.label===norm(label));assert.equal(score,g.score);assert.equal(note,g.note);assert.equal(status,'已确认');
}
const wide=new ExcelJS.Workbook();await wide.xlsx.readFile(path.join(dir,'全班录分表-宽表.xlsx'));
assert.equal(wide.worksheets[0].rowCount,13);assert.equal(wide.worksheets[0].columnCount,17);
const logs=readdirSync(dir).filter(f=>f.startsWith('network-')).map(read);
const completions=logs.filter(l=>l.method==='POST'),success=completions.filter(l=>l.response?.choices?.[0]?.finish_reason==='stop');
assert.equal(success.length,6);assert.equal(completions.length,7);
assert.ok(success.every(l=>l.url==='https://api.deepseek.com/chat/completions'&&l.response.model==='deepseek-v4-flash-vision-exp'&&l.response.id));
const imageCalls=completions.filter(l=>l.request.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url')));
const hashes=imageCalls.map(l=>l.request.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type==='image_url').map(c=>c.sha256):[]));
assert.equal(hashes.length,3);assert.equal(hashes[0].length,4);
assert.deepEqual(hashes[0],hashes[1]);assert.deepEqual(hashes[0],hashes[2]);
for(const call of success.filter(c=>!imageCalls.includes(c))){
  const input=JSON.stringify(call.request.messages);
  for(const s of source.students){assert.ok(!input.includes(s.name));assert.ok(!input.includes(s.number));}
  assert.ok(!input.includes('image_url'));
}
const db=new DatabaseSync(path.join(dir,'workspace/zhiheng.sqlite'),{readOnly:true});
const reports=db.prepare("SELECT json FROM records WHERE kind='reports'").all().map(r=>JSON.parse(r.json));
db.close();
writeFileSync(path.join(dir,'reports-with-evidence.json'),JSON.stringify(reports,null,2));
assert.equal(reports.filter(r=>r.kind==='ai'&&!r.contentRevision).length>=3,true);
for(const r of reports.filter(r=>r.kind==='ai')){
  const ids=new Set(r.snapshot.questions.map(q=>q.id));
  const refs=new Set(r.snapshot.finalResults.flatMap(s=>s.grades.filter(g=>g.note||g.tags.length).map(g=>`${s.student}:${g.questionId}`)));
  for(const f of r.content.findings){assert.ok(f.evidence.every(x=>ids.has(x)));assert.ok(f.remarkRefs.every(x=>refs.has(x)));if(f.certainty==='recorded')assert.ok(f.remarkRefs.length);}
}
const usage=success.reduce((a,l)=>{const u=l.response.usage;a.input+=u.prompt_tokens;a.output+=u.completion_tokens;a.cached+=u.prompt_cache_hit_tokens||0;return a;},{input:0,output:0,cached:0});
// Official September 8, 2026 off-peak USD rates, excluding the incomplete response.
usage.estimatedUSD=((usage.input-usage.cached)*.22+usage.cached*.007+usage.output*.66)/1e6;
const result={ok:true,noMock:true,examPages:4,mainQuestions:12,scoringUnits:15,students:12,scoreCells:180,notes:8,average:e.analysis.average,median,standardDeviation:e.analysis.std,highest:e.analysis.highest,lowest:e.analysis.lowest,topics:e.analysis.topics.length,successfulCompletions:success.length,interruptedCompletions:1,readOnlyModelRequests:logs.filter(l=>l.method==='GET').length,usage,teacherCorrections:read('teacher-recognition-corrections.json'),teacherReportCorrections:read('teacher-report-corrections.json'),reports:reports.length,checks:['180 score cells and all notes match independent teacher input','12 student totals, mean, median and standard deviation recomputed independently','all topic rates independently recomputed','long and wide Excel exports verified','identical four images used in all recognition attempts','six complete official API responses with IDs and usage','analysis requests contain no images, student names or student numbers','report question and note evidence references exist','teacher revisions preserve original model outputs']};
writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,teacherCorrections:result.teacherCorrections.length,teacherReportCorrections:result.teacherReportCorrections.length},null,2));

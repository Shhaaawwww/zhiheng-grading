// Live application and official provider. Requests/responses are audited, never replaced.
import { chromium } from 'playwright-core';
import { createApp } from '../server/app.mjs';
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const out=path.resolve('output/real-api/public-papers-20260908');
const shots=path.resolve('output/playwright/public-papers');mkdirSync(shots,{recursive:true});
const key=process.env.DEEPSEEK_API_KEY;if(!key)throw Error('Provide the existing key through the process environment');delete process.env.DEEPSEEK_API_KEY;
const mode=process.argv[2]||'extract',endpoint='https://api.deepseek.com',model='deepseek-v4-flash-vision-exp';
const read=f=>JSON.parse(readFileSync(path.join(out,f),'utf8'));
const save=(f,v)=>{const target=path.join(out,f);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,JSON.stringify(v,null,2).replaceAll(key,'[REDACTED]'))};
const cases=read('cases.json'),state=existsSync(path.join(out,'state.json'))?read('state.json'):{exams:{}};
const nativeFetch=globalThis.fetch;let contextLabel='',calls=0;
globalThis.fetch=async(input,init)=>{
 const url=String(input);if(new URL(url).origin!==endpoint)return nativeFetch(input,init);
 if(++calls>30)throw Error('Live test per-process call limit reached');
 const started=Date.now(),stamp=new Date().toISOString().replaceAll(':','-');
 const log={context:contextLabel,url,method:init?.method||'GET',startedAt:new Date(started).toISOString()};
 if(init?.body){const body=JSON.parse(init.body);log.request={...body,messages:body.messages.map(m=>({...m,content:Array.isArray(m.content)?m.content.map((c,i)=>{
   if(c.type!=='image_url')return c;const bytes=Buffer.from(c.image_url.url.split(',')[1],'base64');const file=`sent-${stamp}-${i}.jpg`;writeFileSync(path.join(out,file),bytes);return{type:'image_url',file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 }):m.content}))};}
 try{const response=await nativeFetch(input,init);log.status=response.status;const raw=await response.clone().json();for(const c of raw.choices||[]){if(c.message?.reasoning_content){c.message.reasoning_content_length=c.message.reasoning_content.length;delete c.message.reasoning_content;}}log.response=raw;log.elapsedMs=Date.now()-started;save(`network-${stamp}.json`,log);console.log(`Official API ${contextLabel}: HTTP ${response.status}, ${(log.elapsedMs/1000).toFixed(1)}s, ${raw.usage?.prompt_tokens||0} input / ${raw.usage?.completion_tokens||0} output tokens`);return response;
 }catch(e){log.error=e.message;log.elapsedMs=Date.now()-started;save(`network-${stamp}.json`,log);throw e;}
};
const instance=createApp({dataDir:path.join(out,'workspace')});const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const request=async(route,data,method=data===undefined?'GET':'POST')=>{const r=await nativeFetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json','X-Zhiheng-Client':'desktop'},...(data===undefined?{}:{body:JSON.stringify(data)})});const raw=await r.text();let j;try{j=JSON.parse(raw)}catch{throw Error('Non-JSON local app response '+r.status)}if(!r.ok)throw Error(j.error||String(r.status));return j;};
await request('/settings',{baseUrl:endpoint,visionModel:model,gradingModel:model,reportModel:model,apiKey:key,dailyCalls:80,maxTokens:16000,inputPrice:.22,outputPrice:.66,currency:'USD'},'PUT');
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1550,height:1060}});page.setDefaultTimeout(25000);const browserErrors=[];page.on('pageerror',e=>browserErrors.push(e.message));const btn=s=>page.getByRole('button',{name:s,exact:true});
const snap=async s=>page.screenshot({path:path.join(shots,s+'.png'),fullPage:true});
async function waitTask(examId,taskId){const start=Date.now();let last='';while(Date.now()-start<410000){const list=await request(`/tasks?examId=${examId}`);const t=list.find(x=>x.id===taskId);if(t){if(t.status!==last){console.log(contextLabel,t.status);last=t.status;}if(!['queued','running'].includes(t.status))return t;}await new Promise(r=>setTimeout(r,1200));}throw Error('Task wait timed out');}
async function newExam(name){return request('/exams',{classId:state.classId,name,date:'2026-09-08'});}
async function selectExam(id){await page.goto(base);await page.getByLabel('当前考试',{exact:true}).selectOption(id);await page.locator('.exam-hero').waitFor();}
const norm=s=>s.replace(/^第|题$/g,'').replace(/[（）()\s]/g,'');
try{
 if(!state.classId){const c=await request('/classes',{name:'公开真题实测班（模拟成绩）',grade:'高三',students:Array.from({length:40},(_,i)=>({number:String(270001+i),name:`测评${String(i+1).padStart(2,'0')}`}))});state.classId=c.id;save('state.json',state);}
 save('test-configuration.json',{model,endpoint,maxTokens:16000,version:'0.1.3',sourceHash:createHash('sha256').update(readFileSync('server/ai.mjs')).digest('hex'),noMock:true,apiKeyPersisted:false,analysisPricesAreEstimates:true});
 if(mode==='extract'){
  for(const c of cases)for(const variant of ['clean',...(c.id==='haidian-2024'?['degraded']:[])]){
   const id=c.id+'/'+variant;contextLabel=id+'/extract';
   if(!state.exams[id]){const e=await newExam(c.title+(variant==='degraded'?' · 模糊倾斜版':' · 清晰图片版'));state.exams[id]=e.id;save('state.json',state);}
   const examId=state.exams[id];let t=(await request(`/tasks?examId=${examId}`)).find(t=>t.kind==='extract');
   if(!t){await selectExam(examId);await btn('试卷准备').click();await page.getByLabel('选择试卷 PDF',{exact:true}).setInputFiles(path.join(out,id,'试卷题面-纯图片.pdf'));
    const pending=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/api/exams/${examId}/tasks`),{timeout:60000});await btn('开始整卷识别').click();const response=await pending;if(!response.ok())throw Error('Failed to start extraction');t=await response.json();
   }
   if(['queued','running'].includes(t.status))t=await waitTask(examId,t.id);
   save(id+'/task-extract.json',t);
   if(t.status==='succeeded'){
    const qs=t.result.questions.filter(q=>q.type!=='group'&&!t.result.questions.some(x=>x.parentId===q.id));const issues=[];
    for(let i=0;i<19;i++){const q=qs.find(q=>norm(q.label)===String(i+1));if(!q){issues.push({label:String(i+1),field:'question',expected:'present',actual:'missing'});continue;}for(const [field,expected] of [['max',c.printedMarks[i]],['page',c.questionPages[i]],['type',c.types[i]]])if(q[field]!==expected)issues.push({label:q.label,field,expected,actual:q[field]});}
    if(t.result.paperMax!==c.paperMax)issues.push({field:'paperMax',expected:c.paperMax,actual:t.result.paperMax});
    save(id+'/structural-comparison.json',{expectedQuestions:19,actualQuestions:qs.length,unknownMarks:qs.filter(q=>q.max==null).length,issues,questions:qs,warnings:t.result.warnings});
    await selectExam(examId);await btn('试卷准备').click();await page.getByRole('dialog',{name:'核对整卷识别结果'}).waitFor();await snap(id.replace('/','-')+'-recognition');
   }else console.log('Retained failed result:',id,t.error);
  }
 }else if(mode==='export'){
  const plan=read('analysis-plan.json');
  for(const scenario of plan.scenarios){
   const examId=state.exams[scenario.id];if(!examId)continue;
   const exam=await request(`/exams/${examId}`);const reports=await request(`/exams/${examId}/reports`);
   await selectExam(examId);await btn('报告归档').click();
   for(const report of reports){
    const student=report.studentId?exam.students.find(s=>s.id===report.studentId):null;
    const row=page.locator('tbody tr').filter({hasText:(student?.name||'全班')+' · 学情报告'}).filter({hasText:report.kind==='ai'?'AI 解读':'基础报告'}).first();
    await row.getByRole('button',{name:'查看 / 导出',exact:true}).click();await page.locator('.report-sheet').waitFor();
    const name=(student?.name||'班级')+'-'+(report.kind==='ai'?'AI解读':'基础报告');await snap(scenario.id+'-'+name);
    const [print]=await Promise.all([page.waitForEvent('popup'),btn('导出 PDF').click()]);await print.waitForLoadState('load');await print.evaluate(()=>document.fonts.ready);
    writeFileSync(path.join(out,scenario.id,name+'.html'),await print.content());await print.pdf({path:path.join(out,scenario.id,name+'.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});await print.close();await btn('关闭').click();
   }
  }
  const backup=await nativeFetch(base+'/api/backup');writeFileSync(path.join(out,'公开真题实测资料.zhb'),Buffer.from(await backup.arrayBuffer()));
 }else if(mode==='analysis'){
  const plan=read('analysis-plan.json');
  for(const scenario of plan.scenarios){
   contextLabel=scenario.id;let examId=state.exams[scenario.id];
   if(!examId){const e=await newExam(scenario.title);examId=e.id;state.exams[scenario.id]=examId;save('state.json',state);}
   let exam=await request(`/exams/${examId}`);
   if(!exam.questions.length){
    const qs=read(scenario.reviewedQuestionsFile).map(q=>({...q,confirmed:true}));
    for(const edit of scenario.corrections||[]){const q=qs.find(q=>norm(q.label)===edit.label);assert.ok(q);Object.assign(q,edit.changes);}
    exam=await request(`/exams/${examId}/questions`,{questions:qs,revision:exam.revision},'PUT');
   }
   if(!Object.keys(exam.grades).length){
    const grades=[];for(const s of scenario.students){const actual=exam.students.find(x=>x.number===s.number);assert.ok(actual);for(const g of s.grades){const q=exam.questions.find(q=>norm(q.label)===g.label);assert.ok(q);grades.push({studentId:actual.id,questionId:q.id,status:g.status||'final',score:g.score,note:g.note||'',tags:[],source:'teacher'});}}
    exam=await request(`/exams/${examId}/grades`,{grades,revision:exam.revision},'PUT');
   }
   save(scenario.id+'/exam.json',exam);
   for(const target of scenario.reports){
    const studentId=target.number?exam.students.find(s=>s.number===target.number).id:null;contextLabel=scenario.id+'/'+target.name;
    const payload={kind:'report',payload:{studentId}};
    const t0=await request(`/exams/${examId}/tasks`,payload);const t=await waitTask(examId,t0.id);save(scenario.id+'/task-'+target.name+'.json',t);
    assert.equal(t.target?.studentId||null,studentId);
    if(t.status!=='succeeded'){console.log('Analysis failure retained',t.error);continue;}
    const reports=await request(`/exams/${examId}/reports`);const report=reports.find(r=>r.studentId===studentId&&r.kind==='ai');assert.ok(report);save(scenario.id+'/report-'+target.name+'.json',await request('/reports/'+report.id));
    const before=calls;const again=await request(`/exams/${examId}/tasks`,payload);assert.equal(again.id,t.id);assert.equal(calls,before);save(scenario.id+'/cache-'+target.name+'.json',{sameTaskId:again.id===t.id,additionalProviderCalls:calls-before});
   }
   const existingBasic=(await request(`/exams/${examId}/reports`)).find(r=>r.kind==='basic'&&!r.studentId&&r.revision===exam.revision);
   const basic=existingBasic||await request(`/exams/${examId}/reports`,{});save(scenario.id+'/report-basic.json',await request('/reports/'+basic.id));
   await selectExam(examId);await btn('班级学情').click();await snap(scenario.id+'-class');
   const excel=await nativeFetch(base+`/api/exams/${examId}/export?mode=grades`);if(!excel.ok)throw Error('Score export failed');writeFileSync(path.join(out,scenario.id,'录分表.xlsx'),Buffer.from(await excel.arrayBuffer()));
  }
 }
 save('usage.json',await request('/usage'));
 save(`session-${mode}.json`,{ok:true,browserErrors,calls,finishedAt:new Date().toISOString()});
}catch(e){save(`session-${mode}.json`,{ok:false,error:e.message,browserErrors,calls,finishedAt:new Date().toISOString()});try{await snap('failure-'+mode)}catch{}console.error(e.message.replaceAll(key,'[REDACTED]'));process.exitCode=1;
}finally{await browser.close();instance.ai.close();await new Promise(r=>server.close(r));instance.store.close();}

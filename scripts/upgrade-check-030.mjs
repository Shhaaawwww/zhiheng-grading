import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.mjs';
const source=path.resolve('output/real-api/release-020-round2/交付验收资料.zhb');
if(!fs.existsSync(source))throw Error('Historical 0.2 backup not available; upgrade check was not run.');
const out=path.resolve('output/upgrade-030');fs.mkdirSync(out,{recursive:true});
const app=createApp({dataDir:fs.mkdtempSync(path.join(out,'restored-'))}),server=app.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
try{
 const bytes=fs.readFileSync(source),raw=JSON.parse(gunzipSync(bytes));const r=await fetch(`http://127.0.0.1:${server.address().port}/api/backup/restore`,{method:'POST',headers:{'Content-Type':'application/json','X-Zhiheng-Client':'desktop'},body:JSON.stringify({base64:bytes.toString('base64'),confirm:'恢复备份'})});assert.equal(r.status,200,await r.text());
 let grades=0,exams=0;for(const row of raw.records.filter(r=>r.kind==='exams')){const before=JSON.parse(row.json),after=app.store.get('exams',row.id);assert.deepEqual(after.grades,before.grades);assert.deepEqual(after.questions,before.questions);grades+=Object.keys(before.grades).length;exams++;}
 const result={ok:true,sourceVersion:'0.2.0',targetVersion:'0.3.0',restoredExams:exams,gradesPreservedExactly:grades,attachmentsPreserved:raw.attachments.length,restoredDatabase:path.join(app.store.dir,'zhiheng.sqlite')};fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{app.ai.close();server.close();app.store.close();}

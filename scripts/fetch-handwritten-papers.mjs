import fs from 'node:fs';
import path from 'node:path';
const dir=path.resolve('output/real-api/release-030/sources');fs.mkdirSync(dir,{recursive:true});
const sources=[
 ['ap25-q5.pdf','https://apcentral.collegeboard.org/media/pdf/ap25-apc-calculus-ab-q5.pdf'],
 ['ap25-q6.pdf','https://apcentral.collegeboard.org/media/pdf/ap25-apc-calculus-ab-q6.pdf'],
 ['ap24-q6.pdf','https://apcentral.collegeboard.org/media/pdf/ap24-apc-calculus-ab-q6.pdf'],
 ['ap25-questions.pdf','https://apcentral.collegeboard.org/media/pdf/ap25-frq-calculus-ab.pdf'],
 ['ap24-questions.pdf','https://apcentral.collegeboard.org/media/pdf/ap24-frq-calculus-ab.pdf'],
 ['ap25-guidelines.pdf','https://apcentral.collegeboard.org/media/pdf/ap25-sg-calculus-ab.pdf'],
];
for(const [name,url]of sources){const file=path.join(dir,name);if(fs.existsSync(file)&&fs.readFileSync(file).subarray(0,5).toString()==='%PDF-')continue;const r=await fetch(url,{signal:AbortSignal.timeout(55000)});if(!r.ok)throw Error(`${name}: HTTP ${r.status}`);const b=Buffer.from(await r.arrayBuffer());if(b.subarray(0,5).toString()!=='%PDF-')throw Error(`${name}: not PDF`);fs.writeFileSync(file,b);console.log('Downloaded official sample',name,b.length);}
fs.writeFileSync(path.join(dir,'sources.json'),JSON.stringify(sources.map(([file,url])=>({file,url,downloadedAt:new Date().toISOString(),rights:'College Board; retained locally for evaluation, not included in the source release'})),null,2));

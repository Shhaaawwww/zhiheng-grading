import { listPackage, extractFile } from '@electron/asar';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const archive=path.resolve('release/win-unpacked/resources/app.asar');
const files=listPackage(archive).map(f=>f.replaceAll('\\','/'));
assert.ok(!files.some(f=>/^\/(output|tests|\.data|release)\//.test(f)));
const version=JSON.parse(readFileSync('package.json','utf8')).version;
assert.equal(JSON.parse(extractFile(archive,'package.json').toString()).version,version);
const check=file=>assert.deepEqual(extractFile(archive,path.normalize(file)),readFileSync(file),file);
for(const file of ['electron/main.cjs','electron/preload.cjs','LICENSE','THIRD_PARTY_NOTICES.md','dist/index.html'])check(file);
for(const file of readdirSync('server'))check('server/'+file);
for(const file of readdirSync('dist/assets'))check('dist/assets/'+file);
const help=readdirSync('public/help');
for(const file of help){
  assert.deepEqual(extractFile(archive,path.normalize('dist/help/'+file)),readFileSync('public/help/'+file),file);
}
const checks={ok:true,version,helpFiles:help,excludedWorkspaceData:true,sourceAndBundleMatch:true};
mkdirSync('output/desktop-smoke-030',{recursive:true});
writeFileSync('output/desktop-smoke-030/package-check.json',JSON.stringify(checks,null,2));
console.log(JSON.stringify(checks,null,2));

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright-core';
import { createApp } from '../server/app.mjs';
import { gunzipSync } from 'node:zlib';
const out = path.resolve('output/real-api/release-020-round2');
const cases = JSON.parse(fs.readFileSync(path.join(out, 'cases.json'))), state = JSON.parse(fs.readFileSync(path.join(out, 'state.json')));
const instance = createApp({ dataDir: path.join(out, 'workspace') });
const server = instance.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (url, body, method = body ? 'POST' : 'GET') => { const r = await fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', 'X-Zhiheng-Client': 'desktop' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw Error(j.error); return j; };
const browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 950 } }); page.setDefaultTimeout(15000);
let cells = 0, reportCount = 0; const summaries = [];
const round = n => Math.round(n * 100) / 100;
try {
 for (const c of cases) {
  const exam = await call(`/exams/${state.exams[c.caseId]}`), qs = exam.questions.filter(q => q.type !== 'group');
  const fixture = JSON.parse(fs.readFileSync(path.join(out, c.caseId, 'teacher-score-fixture.json')));
  const totals = [];
  for (const row of fixture.students) {
   const s = exam.students.find(s => s.number === row.number); let sum = 0, complete = true;
   for (let j = 0; j < fixture.questionLabels.length; j++) {
    const q = qs.find(q => q.label === fixture.questionLabels[j]), g = exam.grades[`${s.id}:${q.id}`], value = row.scores[j]; cells++;
    if (value === '') { assert.ok(!g || g.status === 'ungraded'); complete = false; }
    else if (value === '缺考') { assert.equal(g.status, 'absent'); complete = false; }
    else { assert.equal(g.status, 'final'); assert.equal(g.score, Number(value)); sum += Number(value); }
   }
   if (complete) totals.push(sum);
   assert.equal(exam.analysis.students.find(x => x.id === s.id).total, complete ? sum : null);
  }
  assert.equal(exam.analysis.average, round(totals.reduce((a, b) => a + b, 0) / totals.length));
  for (const q of qs) {
   const valid = exam.students.map(s => exam.grades[`${s.id}:${q.id}`]).filter(g => g?.status === 'final');
   const sum = valid.reduce((n, g) => n + g.score, 0), actual = exam.analysis.questions.find(x => x.id === q.id);
   assert.equal(actual.n, valid.length); assert.equal(actual.rate, round(sum / (valid.length * q.max) * 100)); assert.equal(actual.lost, valid.filter(g => g.score < q.max).length);
  }
  await page.goto(base); await page.getByLabel('当前考试', { exact: true }).selectOption(exam.id); await page.getByRole('button', { name: '阅卷与录分', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出录分表', exact: true }).click()]);
  const f = path.join(out, c.caseId, '最终录分表.xlsx'); await download.saveAs(f);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f); const sheet = wb.worksheets[0]; assert.equal(sheet.getRow(1).getCell(1).text, '学号'); assert.equal(sheet.rowCount, 41);
  for (let i = 0; i < 40; i++) for (let j = 0; j < qs.length; j++) {
   const expected = fixture.students[i].scores[j], value = sheet.getRow(i + 2).getCell(j + 3).value;
   assert.equal(value, expected === '' ? null : expected === '缺考' ? '缺考' : Number(expected));
  }
  const reportFiles = fs.readdirSync(path.join(out, c.caseId)).filter(f => f.startsWith('final-report-') && f.endsWith('.json'));
  for (const file of reportFiles) {
   const r = JSON.parse(fs.readFileSync(path.join(out, c.caseId, file))); reportCount++;
   assert.equal((await call(`/reports/${r.id}`)).stale, false);
   assert.ok(r.snapshot.questions.every(q => !('stem' in q) && !('answer' in q) && !('parentContext' in q)));
   if (r.studentId) assert.equal(r.snapshot.finalResults.length, 1);
   for (const f of r.content.findings) { assert.ok(r.snapshot.focusGroups.some(g => f.evidence.every(id => g.evidence.includes(id)))); if (f.certainty === 'recorded') assert.ok(f.remarkRefs.length); }
  }
  const t = (await call(`/exams/${exam.id}/teaching`)).interventions;
  assert.ok(t.length); assert.equal(t[0].outcomes[0].status, 'independent');
  summaries.push({ case: c.caseId, questions: qs.length, complete: exam.analysis.complete, pending: exam.analysis.pending, absent: exam.analysis.absent, average: exam.analysis.average, max: exam.analysis.max, finalReports: reportFiles.length, excelVerified: true, retestVerified: true });
 }
 const logs = [];
 for (const folder of ['output/real-api/release-020', 'output/real-api/release-020-round2']) {
  const dir = path.join(folder, 'network'); for (const f of fs.readdirSync(dir)) logs.push(JSON.parse(fs.readFileSync(path.join(dir, f))));
 }
 const cost = { calls: logs.length, known: 0, unknown: 0, input: 0, output: 0, cached: 0, usd: 0, byPhase: {} };
 for (const log of logs) {
  const u = log.response?.usage; if (!u) { cost.unknown++; continue; } cost.known++;
  const date = new Date(log.startedAt), h = date.getUTCHours(), peak = date.getUTCDay() > 0 && date.getUTCDay() < 6 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
  const input = u.prompt_tokens, output = u.completion_tokens, hit = u.prompt_cache_hit_tokens || 0;
  const usd = ((input - hit) * .22 + hit * .007 + output * .66) / 1e6 * (peak ? 2 : 1);
  cost.input += input; cost.output += output; cost.cached += hit; cost.usd += usd;
  const phase = log.currentCase.includes('focused-report') ? 'focusedReports' : log.currentCase.includes('/report/') ? 'initialReports' : 'extraction';
  const p = cost.byPhase[phase] ||= { calls: 0, input: 0, output: 0, usd: 0 }; p.calls++; p.input += input; p.output += output; p.usd += usd;
  if (!Array.isArray(log.request.messages[1].content)) {
   const body = log.request.messages[1].content; assert.ok(!body.includes('模拟01')); const p = JSON.parse(body); assert.ok(!p.questions?.some(q => 'stem' in q));
  }
 }
 const result = { ok: true, verifiedCells: cells, verifiedFinalAIReports: reportCount, summaries, cost, pricingSource: 'https://api-docs.deepseek.com/quick_start/pricing/', costBasis: '官方返回用量和请求时段估算；最终以服务商账单为准', studentData: 'synthetic' };
 fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); instance.ai.close(); await new Promise(r => server.close(r)); instance.store.close(); }

// Restore a real 0.1.3 backup into a separate directory, compare every saved grade.
const legacy = 'output/real-api/public-papers-20260908/公开真题实测资料.zhb';
if (!fs.existsSync(legacy)) {
 fs.writeFileSync(path.join(out, 'upgrade-verification.json'), JSON.stringify({ ok: null, skipped: true, reason: 'Historical 0.1.3 backup is not distributed with the source release.' }, null, 2));
 console.log('SKIPPED legacy upgrade: historical backup not available. This is not a passing upgrade check.');
 process.exit(0);
}
const folder = fs.mkdtempSync(path.resolve('output/upgrade-020-'));
const app = createApp({ dataDir: folder }); const srv = app.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
try {
 const bytes = fs.readFileSync(legacy), raw = JSON.parse(gunzipSync(bytes));
 const response = await fetch(`http://127.0.0.1:${srv.address().port}/api/backup/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zhiheng-Client': 'desktop' }, body: JSON.stringify({ base64: bytes.toString('base64'), confirm: '恢复备份' }) }); assert.ok(response.ok, await response.text());
 let grades = 0;
 for (const row of raw.records.filter(r => r.kind === 'exams')) { const before = JSON.parse(row.json), after = app.store.get('exams', row.id); assert.deepEqual(after.grades, before.grades); assert.deepEqual(after.questions, before.questions); grades += Object.keys(before.grades).length; }
 fs.writeFileSync(path.join(out, 'upgrade-verification.json'), JSON.stringify({ ok: true, sourceVersion: '0.1.3', targetVersion: '0.2.0', restoredExams: raw.records.filter(r => r.kind === 'exams').length, gradesPreservedExactly: grades }, null, 2)); console.log('Legacy upgrade preserves', grades, 'grade records');
} finally { app.ai.close(); await new Promise(r => srv.close(r)); app.store.close(); }

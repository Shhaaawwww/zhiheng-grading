// Explicitly paid live tests. No fake provider, no replacement responses.
import { chromium } from 'playwright-core';
import { createApp } from '../server/app.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const out = path.resolve(process.env.ZHIHENG_TEST_OUT || 'output/real-api/release-020');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(path.join(out, 'screenshots'), { recursive: true });
const key = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY;
if (!key) throw Error('Set DEEPSEEK_API_KEY in the process environment');
const mode = process.argv[2] || 'extract';
const save = (file, data) => { const p = path.join(out, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2).replaceAll(key, '[REDACTED]')); };
const read = file => JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
const old = path.resolve('output/real-api/public-papers-20260908');
const originals = JSON.parse(fs.readFileSync(path.join(old, 'cases.json'), 'utf8'));
const cases = fs.existsSync(path.join(out, 'cases.json')) ? read('cases.json') : originals.flatMap(c => ['clean', ...(c.id === 'haidian-2024' ? ['degraded'] : [])].map(variant => ({ ...c, caseId: `${c.id}-${variant}`, pdf: path.join(old, c.id, variant, '试卷题面-纯图片.pdf'), variant })));
const state = fs.existsSync(path.join(out, 'state.json')) ? read('state.json') : { exams: {} };
let currentCase = '', calls = 0;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (new URL(String(url)).origin !== 'https://api.deepseek.com') return nativeFetch(url, init);
  if (++calls > 40) throw Error('Live test per-process call cap reached');
  const stamp = `${Date.now()}-${calls}`, started = Date.now();
  const log = { currentCase, startedAt: new Date(started).toISOString(), endpoint: 'https://api.deepseek.com/chat/completions' };
  const body = JSON.parse(init.body);
  log.request = { ...body, messages: body.messages.map(m => ({ ...m, content: Array.isArray(m.content) ? m.content.map((c, i) => {
    if (c.type !== 'image_url') return c;
    const bytes = Buffer.from(c.image_url.url.split(',')[1], 'base64'), file = `sent/${stamp}-${i}.jpg`;
    fs.mkdirSync(path.join(out, 'sent'), { recursive: true }); fs.writeFileSync(path.join(out, file), bytes);
    return { type: 'image_url', file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }) : m.content })) };
  try {
    const response = await nativeFetch(url, init); log.httpStatus = response.status;
    const data = await response.clone().json();
    for (const c of data.choices || []) { if (c.message?.reasoning_content) { c.message.reasoningCharacters = c.message.reasoning_content.length; delete c.message.reasoning_content; } }
    log.response = data; log.elapsedMs = Date.now() - started; save(`network/${stamp}.json`, log);
    console.log(`LIVE ${currentCase}: HTTP ${response.status}, ${Math.round(log.elapsedMs / 1000)}s, input ${data.usage?.prompt_tokens ?? 'unknown'}, output ${data.usage?.completion_tokens ?? 'unknown'}`);
    return response;
  } catch (e) { log.error = e.name; log.elapsedMs = Date.now() - started; save(`network/${stamp}.json`, log); throw e; }
};
const instance = createApp({ dataDir: path.join(out, 'workspace') });
const server = instance.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (url, body, method = body ? 'POST' : 'GET') => {
  const response = await nativeFetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', 'X-Zhiheng-Client': 'desktop' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw Error(data.error); return data;
};
await api('/settings', { baseUrl: 'https://api.deepseek.com', visionModel: 'deepseek-v4-flash-vision-exp', gradingModel: 'deepseek-v4-flash-vision-exp', reportModel: 'deepseek-v4-flash-vision-exp', apiKey: key, dailyCalls: 100, maxTokens: 8000, inputPrice: .22, outputPrice: .66, currency: 'USD' }, 'PUT');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } }); page.setDefaultTimeout(20000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
const btn = name => page.getByRole('button', { name, exact: true });
const shot = name => page.screenshot({ path: path.join(out, 'screenshots', `${name}.png`), fullPage: true });
async function waitTask(examId, taskId) {
  const start = Date.now(); let progress = '';
  while (Date.now() - start < 900000) {
    const t = (await api(`/tasks?examId=${examId}`)).find(t => t.id === taskId);
    const next = `${t.status}:${t.progress?.done || 0}`;
    if (next !== progress) { console.log(currentCase, next); progress = next; }
    if (!['queued', 'running'].includes(t.status)) return t;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw Error('Live task deadline exceeded');
}
try {
  await page.goto(base);
  if (!state.classId) {
    await btn('班级与学生').click(); await btn('新建班级').click();
    await page.getByLabel('班级名称', { exact: true }).fill('交付验收班（40名模拟学生）');
    for (let i = 1; i <= 40; i++) {
      if (i > 1) await btn('添加学生').click();
      await page.getByLabel(`第 ${i} 位学生学号`, { exact: true }).fill(String(280000 + i));
      await page.getByLabel(`第 ${i} 位学生姓名`, { exact: true }).fill(`模拟${String(i).padStart(2, '0')}`);
    }
    await btn('保存班级').click(); await page.locator('dialog').waitFor({ state: 'hidden' });
    state.classId = (await api('/bootstrap')).classes.find(c => c.name.includes('交付验收班')).id; save('state.json', state); await shot('class-created-in-ui');
  }
  if (mode === 'extract') {
    for (const c of cases) {
      currentCase = c.caseId;
      if (!state.exams[c.caseId]) {
        await page.goto(base); await btn('班级与学生').click(); await page.locator('.class-card').filter({ hasText: '交付验收班' }).click(); await btn('为班级创建考试').click();
        await page.getByLabel('考试名称', { exact: true }).fill(`${c.title} · ${c.variant} · 模拟录分验收`); await btn('创建考试').click();
        await page.getByRole('heading', { name: '试卷准备', exact: true }).waitFor();
        state.exams[c.caseId] = (await api('/bootstrap')).exams[0].id; save('state.json', state);
      }
      const examId = state.exams[c.caseId]; await page.goto(base); await page.getByLabel('当前考试', { exact: true }).selectOption(examId); await btn('试卷准备').click();
      let task = (await api(`/tasks?examId=${examId}`)).find(t => t.kind === 'extract');
      if (!task) {
        await page.getByLabel('选择试卷 PDF', { exact: true }).setInputFiles(c.pdf);
        const pending = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/api/exams/${examId}/tasks`)); await btn('开始整卷识别').click(); const response = await pending; task = await response.json(); assert.ok(response.ok(), task.error);
      }
      task = await waitTask(examId, task.id); save(`${c.caseId}/extraction.json`, task);
      save(`${c.caseId}/source.json`, { ...c, sourcePdfSha256: createHash('sha256').update(fs.readFileSync(c.pdf)).digest('hex'), inputTextLayer: false });
      if (['succeeded', 'partial'].includes(task.status)) { await page.getByRole('dialog', { name: '核对整卷识别结果' }).waitFor(); await shot(`${c.caseId}-review`); await btn('稍后核对').click(); }
      console.log(`RESULT ${c.caseId}: ${task.status}, ${task.result?.questions?.length || 0} rows`);
    }
  }
  if (mode === 'workflow') {
    for (const c of cases) {
      currentCase = c.caseId + '/workflow';
      const examId = state.exams[c.caseId]; assert.ok(examId, 'Run extraction first');
      let exam = await api(`/exams/${examId}`);
      await page.goto(base); await page.getByLabel('当前考试', { exact: true }).selectOption(examId); await btn('试卷准备').click();
      const task = (await api(`/tasks?examId=${examId}`)).find(t => t.kind === 'extract');
      if (!task.adoptedAt) {
        const dialog = page.getByRole('dialog', { name: '核对整卷识别结果' }); await dialog.waitFor();
        // Real UI draft recovery, including closing and reopening the modal.
        const first = task.result.questions[0]; const before = first.primary;
        await page.getByLabel(`第 ${first.label} 题主要知识点`, { exact: true }).fill(before + ' · 草稿恢复检查');
        await btn('稍后核对').click(); await btn('查看结果并生成录分表').click();
        assert.equal(await page.getByLabel(`第 ${first.label} 题主要知识点`, { exact: true }).inputValue(), before + ' · 草稿恢复检查');
        await page.getByLabel(`第 ${first.label} 题主要知识点`, { exact: true }).fill(before);
        const corrections = [];
        for (const q of task.result.questions) {
          const number = Number(q.label);
          if (c.optionalQuestions?.includes(q.label) && q.label !== c.testSelectedOption) {
            await page.getByRole('button', { name: `移除识别的第 ${q.label} 题`, exact: true }).click(); corrections.push({ label: q.label, field: 'scoring', after: 'excluded', reason: '模拟全班统一选择22题，未选的23题不计分' }); continue;
          }
          assert.ok(Number.isInteger(number) && number >= 1 && number <= c.teacherMarks.length, `Teacher review needed for nonstandard row ${q.label}`);
          const mark = c.teacherMarks[number - 1];
          if (q.max !== mark) { await page.getByLabel(`第 ${q.label} 题满分`, { exact: true }).fill(String(mark)); corrections.push({ label: q.label, field: 'max', before: q.max, after: mark, reason: '教师模拟评分方案；原卷未标分时不冒称OCR识别' }); }
          const type = c.types?.[number - 1];
          if (type && q.type !== type) { await page.getByLabel(`第 ${q.label} 题题型`, { exact: true }).selectOption(type); corrections.push({ label: q.label, field: 'type', before: q.type, after: type }); }
        }
        save(`${c.caseId}/teacher-corrections.json`, corrections);
        const mismatch = page.getByText(/^我已核对，按当前合计/); if (await mismatch.count()) await mismatch.click();
        await shot(c.caseId + '-teacher-corrected');
        await btn('确认题目，生成全班录分表').click(); await dialog.waitFor({ state: 'hidden' });
      }
      exam = await api(`/exams/${examId}`);
      const qs = exam.questions.filter(q => q.type !== 'group'); const expectedN = c.id === 'national-a-2024' ? 22 : 19; assert.equal(qs.length, expectedN);
      if (!Object.keys(exam.grades).length) {
        await btn('阅卷与录分').click();
        const scores = exam.students.map((s, i) => qs.map((q, j) => i === 39 ? '缺考' : i === 38 && j === qs.length - 1 ? '' : i === 0 ? String(q.max) : i === 1 ? '0' : i === 2 || i === 3 ? String(q.max === 10 ? 7 : Math.max(0, q.max - 2)) : String((i * 3 + j * 2) % (q.max + 1))));
        save(`${c.caseId}/teacher-score-fixture.json`, { provenance: 'deterministic synthetic teacher-entered scores', students: exam.students.map(s => ({ number: s.number, scores: scores[exam.students.indexOf(s)] })), questionLabels: qs.map(q => q.label) });
        const field = page.getByLabel(`${exam.students[0].name} 第 ${qs[0].label} 题得分`, { exact: true });
        await field.evaluate((el, text) => { const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })); }, scores.map(row => row.join('\t')).join('\n'));
        await btn('确认导入').waitFor(); await btn('确认导入').click(); await page.locator('dialog').waitFor({ state: 'hidden' });
        exam = await api(`/exams/${examId}`); assert.equal(exam.analysis.complete, 38); assert.equal(exam.analysis.absent, 1); assert.equal(exam.analysis.pending, 1);
        for (let i = 0; i < 40; i++) for (let j = 0; j < qs.length; j++) {
          const g = exam.grades[`${exam.students[i].id}:${qs[j].id}`], value = scores[i][j];
          if (value === '') assert.ok(!g || g.status === 'ungraded'); else if (value === '缺考') assert.equal(g.status, 'absent'); else assert.equal(g.score, Number(value));
        }
        if (c.id === 'haidian-2024' && c.variant === 'clean') {
          const q = qs.find(q => q.label === '16');
          for (const [i, note] of [[0, '满分；此前订正时漏写单位，本次表达完整。'], [2, '能求圆心和半径，但没有建立两圆相切的圆心距关系。'], [3, '能够建立相切方程，解方程时符号运算出错。']]) {
            await btn('成绩表').click(); await page.getByLabel(`${exam.students[i].name} 第 ${q.label} 题备注与状态`, { exact: true }).click();
            await page.getByLabel('简短备注（可选）').fill(note); await btn('保存').click(); await page.getByText('已保存到本机', { exact: true }).waitFor();
          }
        }
      }
      await btn('阅卷与录分').click(); await btn('成绩表').click(); await shot(c.caseId + '-scores');
      const [download] = await Promise.all([page.waitForEvent('download'), btn('导出录分表').click()]); await download.saveAs(path.join(out, c.caseId, '录分表.xlsx'));
      exam = await api(`/exams/${examId}`); save(`${c.caseId}/exam-final.json`, exam);
      const targets = [null, exam.students[2].id, ...(c.id === 'haidian-2024' && c.variant === 'clean' ? [exam.students[3].id, exam.students[0].id] : [])];
      for (const studentId of targets) {
        currentCase = c.caseId + '/report/' + (studentId || 'class');
        const t = await waitTask(examId, (await api(`/exams/${examId}/tasks`, { kind: 'report', payload: { studentId } })).id);
        save(`${c.caseId}/report-task-${studentId || 'class'}.json`, t); assert.equal(t.status, 'succeeded', t.error);
        const report = await api(`/reports/${t.result.reportId}`); save(`${c.caseId}/report-${studentId || 'class'}.json`, report);
        assert.ok(report.content.findings.length, 'No usable AI suggestions');
        const count = calls; const cached = await api(`/exams/${examId}/tasks`, { kind: 'report', payload: { studentId } }); assert.equal(cached.id, t.id); assert.equal(calls, count);
      }
      await btn('班级学情').click(); await btn('保存基础报告').click(); await page.locator('.report-sheet').waitFor();
      const [print] = await Promise.all([page.waitForEvent('popup'), btn('导出 PDF').click()]); await print.waitForLoadState(); await print.pdf({ path: path.join(out, c.caseId, '班级基础报告.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true }); await print.close(); await btn('关闭').click();
      await btn('教学与复测').click(); await page.getByRole('heading', { name: '本次优先讲评（最多三项）' }).waitFor();
      await btn('安排本题组辅导').first().click();
      await page.getByLabel('复测题目、任务或校内材料出处').fill('验收模拟：校本同目标短题；现场独立作答并口述关键条件。');
      const select = page.getByRole('dialog').getByRole('combobox').first(); await select.selectOption('independent');
      await btn('保存辅导与复测').click(); await page.locator('dialog').waitFor({ state: 'hidden' });
      await shot(c.caseId + '-teaching'); save(`${c.caseId}/teaching.json`, await api(`/exams/${examId}/teaching`));
      console.log('WORKFLOW PASS', c.caseId, qs.length * 40, 'cells');
    }
    const backup = await nativeFetch(base + '/api/backup'); fs.writeFileSync(path.join(out, '交付验收资料.zhb'), Buffer.from(await backup.arrayBuffer()));
  }
  if (mode === 'final-reports') {
    for (const c of cases) {
      const examId = state.exams[c.caseId], exam = await api(`/exams/${examId}`);
      const targets = [null, exam.students[2].id, ...(c.id === 'haidian-2024' && c.variant === 'clean' ? [exam.students[3].id, exam.students[0].id] : [])];
      for (const studentId of targets) {
        currentCase = c.caseId + '/focused-report/' + (studentId || 'class');
        const task = await waitTask(examId, (await api(`/exams/${examId}/tasks`, { kind: 'report', payload: { studentId } })).id);
        assert.equal(task.status, 'succeeded', task.error); const report = await api(`/reports/${task.result.reportId}`);
        assert.ok(report.content.findings.length, 'No valid focused suggestions');
        save(`${c.caseId}/final-report-${studentId || 'class'}.json`, report);
        assert.equal(report.stale, false);
        const before = calls; const cached = await api(`/exams/${examId}/tasks`, { kind: 'report', payload: { studentId } }); assert.equal(cached.id, task.id); assert.equal(calls, before);
        await page.goto(base); await page.getByLabel('当前考试', { exact: true }).selectOption(examId); await btn('报告归档').click();
        const name = studentId ? exam.students.find(s => s.id === studentId).name : '全班';
        const row = page.locator('tbody tr').filter({ hasText: name + ' · 学情报告' }).filter({ hasText: 'AI 解读' }).first(); await row.getByRole('button', { name: '查看 / 导出', exact: true }).click();
        await page.locator('.report-sheet').waitFor();
        const [print] = await Promise.all([page.waitForEvent('popup'), btn(studentId ? '导出个人行动卡' : '导出 PDF').click()]); await print.waitForLoadState(); await print.evaluate(() => document.fonts.ready);
        const file = `${c.caseId}/final-${name}`; fs.writeFileSync(path.join(out, file + '.html'), await print.content()); await print.pdf({ path: path.join(out, file + '.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true }); await print.close();
        await shot(c.caseId + '-final-' + name); await btn('关闭').click();
      }
    }
    const backup = await nativeFetch(base + '/api/backup'); fs.writeFileSync(path.join(out, '交付验收资料.zhb'), Buffer.from(await backup.arrayBuffer()));
  }
  save(`run-${mode}.json`, { finishedAt: new Date().toISOString(), calls, browserErrors: errors, studentData: 'synthetic', provider: 'official-live-no-mock', cases: Object.keys(state.exams), appVersion: JSON.parse(fs.readFileSync('package.json')).version });
  assert.deepEqual(errors, []);
} catch (e) { await shot('failure').catch(() => {}); save(`failure-${Date.now()}.json`, { error: String(e), currentCase, calls, browserErrors: errors }); throw e; }
finally { await browser.close(); instance.ai.close(); while (instance.ai.active) await new Promise(r => setTimeout(r, 50)); globalThis.fetch = nativeFetch; await new Promise(r => server.close(r)); instance.store.close(); }

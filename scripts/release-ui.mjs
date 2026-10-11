// Offline UI reliability checks; no model calls or paid provider.
import { chromium } from 'playwright-core';
import { createApp } from '../server/app.mjs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out = path.resolve('output/playwright/release-030'); mkdirSync(out, { recursive: true });
const instance = createApp({ dataDir: mkdtempSync(path.join(out, 'workspace-')) });
const server = instance.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (url, body, method = body ? 'POST' : 'GET') => { const r = await fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', 'X-Zhiheng-Client': 'desktop' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw Error(j.error); return j; };
const c = await api('/classes', { name: '离线边界验收班（模拟）', grade: '高二', students: [{ number: '001', name: '测试同学' }] });
let e = await api('/exams', { classId: c.id, name: '缺分值和编辑恢复', date: '2026-09-08' });
e = await api(`/exams/${e.id}/questions`, { questions: [{ id: 'q1', label: '1', max: null, primary: '' }, { id: 'q2', label: '2', max: 5, primary: '导数符号', confirmed: true }] }, 'PUT');
const browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(15000);
const errors = [], checks = []; page.on('pageerror', er => errors.push(er.message)); const btn = name => page.getByRole('button', { name, exact: true });
try {
 await page.goto(base); await btn('阅卷与录分').click();
 for (const [q, value] of [['1', '4.5'], ['2', '5']]) { const field = page.getByLabel(`测试同学 第 ${q} 题得分`, { exact: true }); await field.fill(value); await field.press('Tab'); await page.getByText('已保存到本机', { exact: true }).waitFor(); }
 e = await api(`/exams/${e.id}`); assert.equal(e.grades[`${e.students[0].id}:q1`].status, 'draft'); assert.equal(e.analysis.max, null); checks.push('unknown max retains 4.5 as draft');
 await btn('试卷准备').click(); await page.getByRole('button', { name: '编辑第 1 题', exact: true }).click();
 await page.getByLabel('满分', { exact: true }).fill('5'); await page.getByLabel('主要考查知识点', { exact: true }).fill('圆心距与相切条件'); await page.getByLabel('已核对主要考查知识点').check(); await btn('保存题目').click(); await page.locator('dialog').waitFor({ state: 'hidden' });
 await btn('阅卷与录分').click(); await btn('核对并确认 1 项草稿').click(); await page.getByRole('dialog').getByText('4.5 / 5', { exact: true }).waitFor();
 await btn('已核对，确认为最终成绩').click(); await page.locator('dialog').waitFor({ state: 'hidden' }); await page.getByText('已保存到本机', { exact: true }).waitFor();
 e = await api(`/exams/${e.id}`); assert.equal(e.analysis.students[0].total, 9.5); checks.push('teacher confirms previously unknown maximum and score');
 await btn('班级学情').click(); await btn('生成 AI 解读').click(); await page.getByText(/请先在设置中配置/).waitFor(); await btn('保存基础报告').click(); await page.locator('.report-sheet').waitFor();
 await page.getByText('修订报告措辞（保存为新版本）', { exact: true }).click(); await page.getByLabel('报告总结', { exact: true }).fill('教师已核对，下一步检查圆心距关系。'); await btn('导出 PDF').click(); await page.getByText(/请先点击“保存为新版本”/).waitFor(); await btn('关闭').click();
 await btn('报告归档').click(); await btn('查看 / 导出').first().click(); await page.getByText('修订报告措辞（保存为新版本）', { exact: true }).click(); assert.equal(await page.getByLabel('报告总结', { exact: true }).inputValue(), '教师已核对，下一步检查圆心距关系。'); await btn('保存为新版本').click(); await page.getByText('教师修订版', { exact: true }).waitFor(); checks.push('report draft restored and unsaved export blocked');
 await page.screenshot({ path: path.join(out, 'teacher-edited-report.png'), fullPage: true }); await btn('关闭').click();
 let reports = await api(`/exams/${e.id}/reports`); const latest = reports[0]; assert.equal(latest.stale, false);
 e = await api(`/exams/${e.id}`); e = await api(`/exams/${e.id}/questions`, { questions: e.questions.map(q => ({ ...q, stem: '仅本地改公式', page: 2 })), revision: e.revision }, 'PUT'); assert.equal((await api(`/reports/${latest.id}`)).stale, false);
 await api(`/exams/${e.id}/grades`, { grades: [{ ...e.grades[`${e.students[0].id}:q1`], score: 3.5 }] }, 'PUT'); assert.equal((await api(`/reports/${latest.id}`)).stale, true); checks.push('dependency staleness follows marks, not local stems');
 await page.reload(); await btn('试卷准备').click(); await btn('调整计分结构 / 恢复').click(); await page.getByLabel('选择题目', { exact: true }).selectOption(['q1', 'q2']); await btn('预览班级影响').click(); await btn('确认按此预览调整').click(); await page.locator('dialog').waitFor({ state: 'hidden' });
 e = await api(`/exams/${e.id}`); assert.equal(e.questions.length, 1); assert.equal(e.analysis.students[0].total, 8.5);
 await btn('调整计分结构 / 恢复').click(); await page.getByText('结构调整历史', { exact: true }).click(); await btn('撤销这次调整').click(); await page.locator('dialog').waitFor({ state: 'hidden' }); e = await api(`/exams/${e.id}`); assert.equal(e.questions.length, 2); checks.push('structure UI preview, apply and rollback');
 assert.deepEqual(errors, []);
 writeFileSync(path.join(out, 'ui-verification.json'), JSON.stringify({ ok: true, checks, browserErrors: errors, paidCalls: 0 }, null, 2)); console.log(JSON.stringify({ ok: true, checks }));
} catch (err) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); writeFileSync(path.join(out, `failure-${Date.now()}.json`), JSON.stringify({ error: String(err), checks, browserErrors: errors })); throw err; }
finally { await browser.close(); instance.ai.close(); await new Promise(r => server.close(r)); instance.store.close(); }

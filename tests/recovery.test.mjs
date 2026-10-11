// Fault injection only: distinct from scripts/release-live.mjs real paid tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.mjs';

test('fault injection: malformed second batch preserves first, retry sends only failed pages and restart restores drafts', async () => {
  let calls = 0, broken = true;
  const provider = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain request */ }
    calls++; res.setHeader('Content-Type', 'application/json');
    const content = calls === 2 && broken ? 'broken json' : JSON.stringify({ questions: [{ label: calls === 1 ? '1' : '2', max: 5, scoreEvidence: '每小题5分', primary: '集合运算', page: 1 }] });
    res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 10 } }));
  });
  provider.listen(0, '127.0.0.1'); await new Promise(r => provider.once('listening', r));
  const dir = mkdtempSync(path.join(tmpdir(), 'zh-recovery-'));
  let app = createApp({ dataDir: dir });
  const e = { id: 'test', revision: 1, name: '故障注入', questions: [], students: [], grades: {}, attachments: [{ id: 'source', studentId: null }] };
  app.store.put('exams', e);
  app.ai.saveConfig({ baseUrl: `http://127.0.0.1:${provider.address().port}`, visionModel: 'fault-injection-only', apiKey: 'local-test-only', maxTokens: 1000 });
  const wait = async id => { for (let i = 0; i < 400; i++) { const t = app.store.get('tasks', id); if (!['queued', 'running'].includes(t.status)) return t; await new Promise(r => setTimeout(r, 10)); } throw Error('test timeout'); };
  try {
    const payload = { wholePaper: true, sourceFileId: 'source', pages: [1, 2, 3, 4], images: Array(4).fill('data:image/png;base64,iVBORw0KGgo=') };
    const task = await wait(app.ai.enqueue(e, 'extract', payload).id);
    assert.equal(task.status, 'partial'); assert.equal(task.result.questions.length, 1); assert.equal(task.result.questions[0].label, '1'); assert.equal(calls, 2);
    const firstId = task.result.questions[0].id; broken = false;
    const retry = await wait(app.ai.enqueue(e, 'extract', { ...payload, resumeBatches: task.result.batches }).id);
    assert.equal(retry.status, 'succeeded'); assert.equal(calls, 3); assert.equal(retry.result.questions.length, 2); assert.equal(retry.result.questions[0].id, firstId); assert.equal(retry.result.questions[1].page, 3);
    app.store.put('drafts', { id: 'scan-draft', value: { data: '教师改过的知识点' } });
    app.store.put('tasks', { ...task, id: 'interrupted', status: 'running' });
    app.ai.close(); while (app.ai.active) await new Promise(r => setTimeout(r, 10)); app.store.close();
    app = createApp({ dataDir: dir }); assert.equal(app.store.get('drafts', 'scan-draft').value.data, '教师改过的知识点'); assert.equal(app.store.get('tasks', 'interrupted').status, 'interrupted'); assert.equal(app.store.get('tasks', 'interrupted').result.questions[0].id, firstId);
  } finally { app.ai.close(); while (app.ai.active) await new Promise(r => setTimeout(r, 10)); app.store.close(); await new Promise(r => provider.close(r)); }
});

test('fault injection: truncated responses retain token accounting; unknown failures never show zero cost', async () => {
  let mode = 'length';
  const provider = http.createServer(async (req, res) => {
    for await (const _ of req) { }
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'http') { res.writeHead(401); res.end('{}'); return; }
    res.end(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'length' }], usage: { prompt_tokens: 55, completion_tokens: 100 } }));
  });
  provider.listen(0, '127.0.0.1'); await new Promise(r => provider.once('listening', r));
  const app = createApp({ dataDir: mkdtempSync(path.join(tmpdir(), 'zh-usage-')) });
  const e = { id: 'e', revision: 1, questions: [], students: [], grades: {}, attachments: [] }; app.store.put('exams', e);
  app.ai.saveConfig({ baseUrl: `http://127.0.0.1:${provider.address().port}`, reportModel: 'fault-injection-only', apiKey: 'local-test-only' });
  const wait = async id => { for (let i = 0; i < 400; i++) { const t = app.store.get('tasks', id); if (!['queued', 'running'].includes(t.status)) return t; await new Promise(r => setTimeout(r, 10)); } throw Error('test timeout'); };
  try {
    const t = await wait(app.ai.enqueue(e, 'report', {}).id); assert.equal(t.status, 'failed'); const u = app.store.list('usage')[0]; assert.equal(u.input, 55); assert.equal(u.output, 100);
    mode = 'http'; await wait(app.ai.enqueue(e, 'report', {}).id); const unknown = app.store.list('usage')[0]; assert.equal(unknown.reported, false); assert.equal(unknown.estimatedCost, null);
  } finally { app.ai.close(); while (app.ai.active) await new Promise(r => setTimeout(r, 10)); app.store.close(); await new Promise(r => provider.close(r)); }
});

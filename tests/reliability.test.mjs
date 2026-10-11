import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { Question, updateQuestions, updateGrades, analyze, analysisInput, snapshotHash, keyOf } from '../server/domain.mjs';
import { normalizeChunk, mergeChunks } from '../server/scan-batches.mjs';
import { constrainedReport } from '../server/report-contract.mjs';
import { validateReport } from '../server/ai.mjs';
import { structurePreview, supportView } from '../server/teaching.mjs';

const question = (id, max = 5) => Question.parse({ id, label: id, max, primary: '利用导数判断单调性', confirmed: true, stem: 'LOCAL-STEM-ONLY', answer: 'SECRET-ANSWER' });
function fixture(n = 3) { return { id: 'exam', classId: 'class', name: '单测', className: '测试班', date: '2026-09-08', revision: 1, questions: [question('1'), question('2')], students: Array.from({ length: n }, (_, i) => ({ id: `student${i}`, number: `000${i}`, name: `私有姓名${i}` })), grades: {}, attachments: [] }; }
function grade(e, sid, qid, score, extra = {}) { return { studentId: sid, questionId: qid, score, status: 'final', note: '', tags: [], source: 'teacher', ...extra }; }

test('unknown maximum retains entered score as draft, no invented total; later confirmation recovers it', () => {
  let e = fixture(); e.questions[0].max = null;
  e = updateGrades(e, [grade(e, 'student0', '1', 4.5), grade(e, 'student0', '2', 5)]);
  assert.equal(e.grades['student0:1'].status, 'draft'); assert.equal(e.grades['student0:1'].score, 4.5);
  assert.equal(analyze(e).max, null); assert.equal(analyze(e).complete, 0);
  e = updateQuestions(e, e.questions.map(q => ({ ...q, max: 5 })));
  e = updateGrades(e, [{ ...e.grades['student0:1'], status: 'final' }]);
  assert.equal(analyze(e).students[0].total, 9.5);
});
test('diagnostic exclusion changes only knowledge aggregation, not scores', () => {
  let e = fixture(); e = updateGrades(e, [grade(e, 'student0', '1', 2), grade(e, 'student0', '2', 5)]);
  const before = analyze(e); e = updateQuestions(e, e.questions.map(q => ({ ...q, diagnosticExcluded: true })));
  const after = analyze(e); assert.equal(after.average, before.average); assert.equal(after.topics.length, 0); assert.deepEqual(after.topicCoverage, { confirmed: 0, total: 2 });
});
test('model contract excludes stems, answers, peer identities and bulk class score grid', () => {
  let e = fixture(40); const gs = e.students.flatMap((s, i) => e.questions.map(q => grade(e, s.id, q.id, i % 6, { note: '有记录' })));
  e = updateGrades(e, gs); const input = analysisInput(e), personal = analysisInput(e, 'student0');
  assert.equal(input.finalResults.reduce((n, s) => n + s.grades.length, 0), 8);
  assert.equal(personal.finalResults.length, 1);
  for (const v of [input, personal]) { const s = JSON.stringify(v); for (const forbidden of ['LOCAL-STEM-ONLY', 'SECRET-ANSWER', '私有姓名', 'student1']) assert.ok(!s.includes(forbidden)); }
  assert.equal(personal.statistics.questions[0].tags.some(t => t.studentIds), false);
});
test('analysis dependency excludes local stem/page edits; score, note and topic edits invalidate snapshots', () => {
  let e = updateGrades(fixture(), [grade(null, 'student0', '1', 5)]); const hash = snapshotHash(analysisInput(e));
  const local = updateQuestions(e, e.questions.map(q => ({ ...q, stem: '改公式', page: 3 })));
  assert.equal(snapshotHash(analysisInput(local)), hash);
  for (const changed of [updateGrades(e, [grade(e, 'student0', '1', 4)]), updateGrades(e, [grade(e, 'student0', '1', 5, { note: '满分但方法可改进' })]), updateQuestions(e, e.questions.map(q => ({ ...q, primary: '数列求和' })))]) assert.notEqual(snapshotHash(analysisInput(changed)), hash);
});
test('malformed and orphan OCR rows are recoverable and duplicate labels remain visible', () => {
  const chunk = normalizeChunk({ questions: [{ label: '17(1)', parentLabel: '17', max: 6, primary: '数列' }, { label: '17(1)', max: 5, scoreEvidence: '本小题5分' }, { label: '18', type: 'nonsense' }] }, [4, 5]);
  const result = mergeChunks([{ pages: [4, 5], result: chunk }], [4, 5, 6]);
  assert.equal(result.questions.length, 3); assert.equal(result.questions[0].max, null); assert.match(result.questions[0].reviewNote, /待关联/);
  assert.equal(new Set(result.questions.map(q => q.label)).size, 3);
  assert.ok(result.questions.every(q => q.id && q.page));
});

test('an unfamiliar OCR question type preserves printed marks and context for teacher review', () => {
  const chunk = normalizeChunk({ questions: [
    { label: '1(1)', parentLabel: '1', type: 'true_false', max: 8, scoreEvidence: '8 points', primary: '渐近复杂度', skill: '判断增长阶', page: 2 },
    { label: '2', type: 'algorithm', max: 20, primary: '最小生成树', page: 1 },
  ] }, [4, 5]);
  const q = chunk.questions[0];
  assert.equal(q.max, 8);
  assert.equal(q.primary, '渐近复杂度');
  assert.equal(q.skill, '判断增长阶');
  assert.equal(q.parentLabel, '1');
  assert.equal(q.page, 5);
  assert.equal(q.type, 'solve');
  assert.equal(q.confirmed, false);
  assert.match(q.reviewNote, /题型/);
  assert.ok(chunk.warnings.some(w => /题型/.test(w)));
  assert.equal(chunk.questions[1].max, null, 'an unfamiliar type must not bypass printed-score evidence');
});
test('full-score note cannot change program facts and a bad suggestion does not discard good ones', () => {
  const e = updateGrades(fixture(), [grade(null, 'student0', '1', 5, { note: '未扣分，但书写还可改进' })]); const input = analysisInput(e, 'student0');
  const base = { title: '错误标题', observation: '仅得3分', evidence: ['1'], remarkRefs: ['S001:1'], certainty: 'recorded', action: '核对表达', check: '独立写出关键步骤' };
  const r = constrainedReport({ summary: '全班都不会', findings: [base, { ...base, evidence: ['missing'] }, { ...base, action: '有25人失分' }] }, input, validateReport);
  assert.equal(r.findings.length, 1); assert.equal(r.rejected.length, 2); assert.match(r.findings[0].observation, /满分/); assert.ok(!r.findings[0].observation.includes('3分')); assert.equal(r.findings[0].recordedNotes[0].note, '未扣分，但书写还可改进');
});
test('merge sums only complete scores, split never distributes original grades, invalid maxima are atomic', () => {
  let e = updateGrades(fixture(), [grade(null, 'student0', '1', 4), grade(null, 'student0', '2', 3), grade(null, 'student1', '1', 0)]);
  const original = JSON.stringify(e); const merge = structurePreview(e, { operation: 'merge', questionIds: ['1', '2'], label: '综合' });
  assert.equal(analyze(merge.next).students[0].total, 7); assert.equal(analyze(merge.next).students[1].total, null); assert.equal(JSON.stringify(e), original);
  const split = structurePreview(e, { operation: 'split', questionIds: ['1'], children: [{ label: '1(1)', max: 2 }, { label: '1(2)', max: 3 }] });
  assert.equal(analyze(split.next).students[0].total, null); assert.equal(split.next.grades['student0:1'], undefined);
  assert.throws(() => updateQuestions(e, e.questions.map(q => ({ ...q, max: 1 })))); assert.equal(JSON.stringify(e), original);
});
test('temporary support groups do not infer causes from bare scores or full-score remarks', () => {
  const e = updateGrades(fixture(), [grade(null, 'student0', '1', 2), grade(null, 'student1', '1', 3, { tags: ['条件遗漏'] }), grade(null, 'student2', '1', 5, { note: '可能算错过' })]);
  const v = supportView(e); assert.deepEqual(v.groups.map(g => g.cause).sort(), ['条件遗漏', '需补充诊断']); assert.ok(v.groups.every(g => !g.members.some(m => m.studentId === 'student2')));
});
test('40 by 25 cells: weighted totals and missingness agree with independent arithmetic', () => {
  let e = fixture(40); e.questions = Array.from({ length: 25 }, (_, i) => question(String(i + 1), i % 2 ? 10 : 5));
  e = updateGrades(e, e.students.flatMap((s, i) => e.questions.map((q, j) => grade(e, s.id, q.id, i === 39 ? null : (i + j) % (q.max + 1), { status: i === 39 ? 'absent' : i === 38 && j === 24 ? 'draft' : 'final' }))));
  const a = analyze(e); assert.equal(a.complete, 38); assert.equal(a.absent, 1); assert.equal(a.pending, 1); assert.equal(a.max, 185);
  const totals = Array.from({ length: 38 }, (_, i) => e.questions.reduce((n, q, j) => n + (i + j) % (q.max + 1), 0));
  assert.equal(a.average, Math.round(totals.reduce((a, b) => a + b, 0) / 38 * 100) / 100);
});
test('durable drafts, retest validation, structural preview/undo and backup round trip through real local HTTP', async () => {
  const instance = createApp({ dataDir: mkdtempSync(path.join(tmpdir(), 'zh-reliability-')) });
  const server = instance.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const call = async (url, body, method = body ? 'POST' : 'GET') => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Zhiheng-Client': 'desktop' }, body: body ? JSON.stringify(body) : undefined }); const data = await r.json(); if (!r.ok) throw Error(data.error); return data; };
  try {
    const e = fixture(); instance.store.put('classes', { id: e.classId, name: '测试班', students: e.students }); instance.store.put('exams', e);
    await call('/drafts/check', { value: { data: '核对中', changedAt: '2026-09-08T01:00:00Z' } }, 'PUT'); assert.equal((await call('/drafts/check')).value.data, '核对中');
    const v = { id: 'intervention', topic: '单调性', action: '对照导数符号', date: '2026-09-08', studentIds: ['student0'], questionIds: ['1'], outcomes: [{ studentId: 'student0', status: 'independent' }] };
    await assert.rejects(call(`/exams/${e.id}/teaching`, { revision: 1, intervention: v }, 'PUT'), /任务/);
    await call(`/exams/${e.id}/teaching`, { revision: 1, intervention: { ...v, task: '校内复测第1题' } }, 'PUT');
    assert.equal((await call(`/exams/${e.id}/teaching`)).interventions[0].outcomes[0].status, 'independent');
    const input = { operation: 'merge', questionIds: ['1', '2'], label: '综合' }; const p = await call(`/exams/${e.id}/structure/preview`, input);
    await call(`/exams/${e.id}/structure/apply`, { input, revision: p.revision, token: p.token });
    await assert.rejects(call(`/exams/${e.id}/structure/apply`, { input, revision: p.revision, token: p.token }), /变化/);
    const audit = await call(`/exams/${e.id}/audit`); await call(`/exams/${e.id}/structure/undo`, { auditId: audit[0].id }); assert.equal((await call(`/exams/${e.id}`)).questions.length, 2);
    const backup = instance.store.dump(); assert.ok(backup.records.some(x => x.kind === 'drafts')); assert.ok(backup.records.some(x => x.kind === 'exams' && JSON.parse(x.json).teaching.length === 1));
  } finally { instance.ai.close(); await new Promise(r => server.close(r)); instance.store.close(); }
});

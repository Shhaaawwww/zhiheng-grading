import { z } from "zod";
import { analyze, leaves, keyOf, fail, id, now, updateQuestions, snapshotHash, analysisInput, validateQuestions } from "./domain.mjs";

const Intervention = z.object({
  id: z.string().default(() => id()), topic: z.string().trim().min(1).max(120),
  action: z.string().trim().min(1).max(2000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  questionIds: z.array(z.string()).min(1).max(200), studentIds: z.array(z.string()).min(1).max(1000),
  task: z.string().max(4000).default(""), criterion: z.string().max(1000).default("独立完成并说明关键理由"),
  outcomes: z.array(z.object({ studentId: z.string(), status: z.enum(["pending", "independent", "support", "absent", "delayed"]), note: z.string().max(1000).default("") })).max(1000).default([]),
});

export function supportView(exam) {
  const a = analyze(exam), qs = leaves(exam);
  const priorities = a.topics.filter(t => t.n && t.rate < 100).sort((x, y) => x.rate - y.rate).slice(0, 3);
  const groups = [];
  for(const skill of a.assessment.skills) for(const [status,cause] of [['error','已确认的具体错误'],['blocked','前面错误影响，需独立复测'],['unknown','证据不足，先补充诊断']]) {
    const ids=skill[status];if(!ids.length)continue;
    groups.push({topic:skill.name,cause,questionIds:skill.questionIds,members:ids.map(studentId=>({studentId,questionIds:[...new Set(skill.members.filter(m=>m.studentId===studentId).map(m=>m.questionId))]}))});
  }
  for (const t of a.topics) {
    const buckets = new Map();
    for (const s of exam.students) {
      const loss = t.questionIds.map(qid => exam.grades[keyOf(s.id, qid)]).filter(g => g?.status === "final" && g.score < qs.find(q => q.id === g.questionId).max);
      if (!loss.length) continue;
      const tags = [...new Set(loss.flatMap(g => g.tags))];
      const categories = tags.length ? tags : ["需补充诊断"];
      for (const cause of categories) {
        if (!buckets.has(cause)) buckets.set(cause, []);
        buckets.get(cause).push({ studentId: s.id, questionIds: loss.map(g => g.questionId) });
      }
    }
    for (const [cause, members] of buckets) groups.push({ topic: t.name, cause, members, questionIds: t.questionIds });
  }
  return { priorities, groups, interventions: exam.teaching || [], coverage: a.topicCoverage };
}

export function structurePreview(exam, input) {
  const { operation, questionIds, label } = z.object({ operation: z.enum(["merge", "split", "remove"]), questionIds: z.array(z.string()).min(1).max(200), label: z.string().trim().min(1).max(40).default("调整题"), children: z.array(z.object({ label: z.string(), max: z.number().positive() })).optional() }).parse(input);
  if (new Set(questionIds).size !== questionIds.length) fail("请选择不重复的题目。");
  const source = questionIds.map(qid => leaves(exam).find(q => q.id === qid));
  if (source.some(q => !q)) fail("只能调整可录分题。");
  if (source.some(q => q.parentId)) fail("此工具先支持独立计分题；小问请在题目编辑中核对所属大题，避免重复计分。");
  let questions = exam.questions.filter(q => !questionIds.includes(q.id)), grades = { ...exam.grades };
  const impacted = Object.values(grades).filter(g => questionIds.includes(g.questionId) && g.status !== "ungraded");
  for (const key of Object.keys(grades)) if (questionIds.includes(grades[key].questionId)) delete grades[key];
  if (operation === "merge") {
    if (source.length < 2) fail("合并至少选择两题。");
    const q = { ...source[0], id: `merge:${snapshotHash({ questionIds, label }).slice(0, 24)}`, label, max: source.every(q => q.max != null) ? source.reduce((s, q) => s + q.max, 0) : null, primary: "综合题组", skill: "", confirmed: false };
    questions.push(q);
    for (const s of exam.students) {
      const gs = source.map(q => exam.grades[keyOf(s.id, q.id)]);
      const complete = q.max != null && gs.every(g => g?.status === "final");
      const absent = gs.every(g => g?.status === "absent");
      grades[keyOf(s.id, q.id)] = { studentId: s.id, questionId: q.id, status: complete ? "final" : absent ? "absent" : "ungraded", score: complete ? gs.reduce((sum, g) => sum + g.score, 0) : null, note: gs.map((g, i) => g?.note ? `原第${source[i].label}题：${g.note}` : "").filter(Boolean).join("；").slice(0, 4000), tags: [], source: "teacher", updatedAt: now() };
    }
  } else if (operation === "split") {
    if (source.length !== 1 || !input.children || input.children.length < 2) fail("拆分请选择一题，并提供至少两个小问及满分。");
    const parent = { ...source[0], type: "group" };
    questions.push(parent, ...input.children.map((c, i) => ({ ...source[0], ...c, id: `${parent.id}:part:${i + 1}`, parentId: parent.id, primary: "", confirmed: false })));
  }
  questions = validateQuestions(questions);
  const next = updateQuestions({ ...exam, grades }, questions);
  return { operation, impactedCells: impacted.length, message: operation === "split" ? "原分数保留在调整历史；小问全部待录入，不自动分摊。" : operation === "merge" ? "仅完整的最终小分相加；不完整保留待录入，原记录保留在历史。" : "所选题退出计分，总分分母相应改变；原成绩保留在历史。", before: analyze(exam), after: analyze(next), next };
}

export function registerTeachingRoutes(app, store) {
  const requireRevision = (e, value) => { if (e.revision !== value) fail("数据已变化，请重新预览后执行。", 409); };
  app.get("/api/exams/:id/teaching", (req, res) => res.json(supportView(store.get("exams", req.params.id))));
  app.put("/api/exams/:id/teaching", (req, res) => {
    const e = store.get("exams", req.params.id); requireRevision(e, req.body.revision);
    const v = Intervention.parse(req.body.intervention);
    if (v.questionIds.some(q => !leaves(e).some(x => x.id === q)) || v.studentIds.some(s => !e.students.some(x => x.id === s))) fail("请核对题目与学生。");
    if (new Set(v.studentIds).size !== v.studentIds.length || new Set(v.outcomes.map(x => x.studentId)).size !== v.outcomes.length || v.outcomes.some(x => !v.studentIds.includes(x.studentId))) fail("复测名单重复或不属于本组。");
    if (v.outcomes.some(x => x.status !== "pending") && !v.task.trim()) fail("请先填写复测题目或任务来源，确保结果有依据。");
    const teaching = [...(e.teaching || []).filter(x => x.id !== v.id), v];
    const next = { ...e, teaching, revision: e.revision + 1, updatedAt: now() };
    store.transaction(() => { store.put("exams", next); store.audit(e.id, "更新辅导与复测", e.teaching || [], teaching); });
    res.json(v);
  });
  app.get("/api/drafts/:id", (req, res) => res.json(store.get("drafts", req.params.id, false)));
  app.put("/api/drafts/:id", (req, res) => {
    const key = z.string().min(1).max(400).parse(req.params.id);
    if (JSON.stringify(req.body).length > 1_000_000) fail("草稿过大。");
    const prior = store.get("drafts", key, false);
    if (prior?.value?.changedAt > req.body.value?.changedAt) return res.json(prior);
    res.json(store.put("drafts", { id: key, value: req.body.value, updatedAt: now() }));
  });
  app.delete("/api/drafts/:id", (req, res) => { store.remove("drafts", req.params.id); res.json({ ok: true }); });
  app.post("/api/exams/:id/structure/preview", (req, res) => {
    const e = store.get("exams", req.params.id); const p = structurePreview(e, req.body);
    res.json({ ...p, next: undefined, revision: e.revision, token: snapshotHash({ input: req.body, revision: e.revision }) });
  });
  app.post("/api/exams/:id/structure/apply", (req, res) => {
    const e = store.get("exams", req.params.id); requireRevision(e, req.body.revision);
    if (req.body.token !== snapshotHash({ input: req.body.input, revision: e.revision })) fail("请先查看本次调整预览。");
    const p = structurePreview(e, req.body.input);
    store.transaction(() => { store.put("exams", p.next); store.audit(e.id, "调整计分结构", e, p.next); });
    res.json({ ...p.next, analysis: analyze(p.next) });
  });
  app.post("/api/exams/:id/structure/undo", (req, res) => {
    const e = store.get("exams", req.params.id), a = store.get("audit", req.body.auditId);
    if (a.examId !== e.id || a.action !== "调整计分结构" || snapshotHash(e) !== snapshotHash(a.after)) fail("后续已有修改，不能直接回滚整份考试；请先备份并核对。");
    const next = { ...a.before, revision: e.revision + 1, updatedAt: now() };
    store.transaction(() => { store.put("exams", next); store.audit(e.id, "撤销结构调整", e, next); });
    res.json({ ...next, analysis: analyze(next) });
  });
}

export function reportState(report, exam) {
  return { ...report, stale: report.snapshotHash !== snapshotHash(analysisInput(exam, report.studentId)), currentRevision: exam.revision };
}

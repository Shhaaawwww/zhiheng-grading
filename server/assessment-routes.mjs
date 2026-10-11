import { z } from "zod";
import { analyze, updateGrades, validateQuestions, now } from "./domain.mjs";
import {
  Mapping,
  Evidence,
  validateRubric,
  rubricHash,
  mappingHash,
  questionHash,
  gradeHash,
  mapKey,
  cellKey,
  evaluationState,
  assessmentStatistics,
  invalid,
  fingerprint,
} from "./assessment-core.mjs";

export function validateAssessmentData(exam) {
  for (const q of exam.questions)
    if (q.rubricSpec?.confirmed) validateRubric(q.rubricSpec, q);
  for (const m of Object.values(exam.answerMaps || {})) {
    Mapping.parse(m);
    if (
      !exam.questions.some((q) => q.id === m.questionId) ||
      !exam.attachments.some(
        (f) => f.id === m.fileId && (f.studentId || null) === m.studentId,
      )
    )
      invalid("备份作答区域关联无效。");
  }
  for (const e of Object.values(exam.evaluations || {})) {
    if (
      !exam.students.some((s) => s.id === e.studentId) ||
      !exam.questions.some((q) => q.id === e.questionId) ||
      !Array.isArray(e.criteria)
    )
      invalid("备份逐点批阅关联无效。");
    e.criteria.forEach((c) => Evidence.parse(c));
  }
}
export function registerAssessmentRoutes(app, store) {
  app.get("/api/exams/:id/assessment", (req, res) => {
    const e = store.get("exams", req.params.id);
    const sid =
      typeof req.query.studentId === "string" ? req.query.studentId : null;
    if (sid && !e.students.some((s) => s.id === sid)) invalid("学生不存在。");
    res.json({
      mappings: e.answerMaps || {},
      evaluations: Object.values(e.evaluations || {}).map((x) =>
        evaluationState(e, x),
      ),
      statistics: assessmentStatistics(e, sid),
      skillAliases: e.skillAliases || {},
    });
  });
  app.put("/api/exams/:id/rubric/:questionId", (req, res) => {
    const e = store.get("exams", req.params.id),
      q = e.questions.find((q) => q.id === req.params.questionId);
    if (!q) invalid("题目不存在。");
    if (req.body.expectedHash !== rubricHash(q))
      invalid("本题标准已经改变，请重新打开核对。", 409);
    const affected = Object.values(e.evaluations || {}).filter(
      (x) => x.questionId === q.id,
    ).length;
    if (affected && !req.body.acknowledgeImpact)
      invalid(`此改动影响 ${affected} 份逐点解释，请确认影响；原成绩会保留。`);
    const spec = validateRubric(
      { ...req.body.spec, version: (q.rubricSpec?.version || 0) + 1 },
      q,
    );
    for (const s of spec.sourceRefs)
      if (!e.attachments.some((f) => f.id === s.fileId && !f.studentId))
        invalid("标准来源必须是本考试题面或参考答案。");
    let task;
    if (req.body.taskId) {
      task = store.get("tasks", req.body.taskId);
      if (
        task.examId !== e.id ||
        task.kind !== "rubric" ||
        task.status !== "succeeded" ||
        task.payload.questionId !== q.id
      )
        invalid("评分标准任务不属于本题。");
      if (task.payload.questionHash !== questionHash(q))
        invalid("生成标准后题目已改变，请重新生成或手动核对。", 409);
    }
    const statement = z
      .string()
      .max(15000)
      .parse(req.body.statement ?? q.stem);
    const skills = [...new Set(spec.criteria.flatMap((c) => c.skills))];
    const nq = {
      ...q,
      stem: statement,
      rubricSpec: spec,
      answer: spec.answer,
      rubric: spec.instructions,
      primary: q.primary || skills[0] || "",
      related: q.related,
    };
    const next = {
      ...e,
      questions: validateQuestions(
        e.questions.map((x) => (x.id === q.id ? nq : x)),
      ),
      revision: e.revision + 1,
      updatedAt: now(),
    };
    store.transaction(() => {
      store.put("exams", next);
      store.audit(e.id, "确认逐点评分标准", q, nq);
      if (task) store.put("tasks", { ...task, adoptedAt: now() });
    });
    res.json({ ...next, analysis: analyze(next) });
  });
  app.put("/api/exams/:id/answer-map", (req, res) => {
    const e = store.get("exams", req.params.id),
      m = Mapping.parse(req.body.mapping),
      key = mapKey(m.fileId, m.questionId),
      old = e.answerMaps?.[key];
    if ((req.body.expectedVersion ?? 0) !== (old?.version || 0))
      invalid("作答区域已有新修改，请重新打开。", 409);
    if (
      !e.questions.some((q) => q.id === m.questionId) ||
      !e.attachments.some(
        (f) => f.id === m.fileId && (f.studentId || null) === m.studentId,
      )
    )
      invalid("所选区域与学生、试卷或题目不匹配。");
    if (new Set(m.regions.map((r) => r.id)).size !== m.regions.length)
      invalid("作答区域标识重复。");
    const nextMap = { ...m, version: (old?.version || 0) + 1, edited: true };
    const next = {
      ...e,
      answerMaps: { ...(e.answerMaps || {}), [key]: nextMap },
      revision: e.revision + 1,
      updatedAt: now(),
    };
    store.transaction(() => {
      store.put("exams", next);
      store.audit(e.id, "调整作答区域", old, nextMap);
    });
    res.json(nextMap);
  });
  app.post("/api/tasks/:id/apply-locations", (req, res) => {
    const t = store.get("tasks", req.params.id);
    if (t.kind !== "locate" || t.status !== "succeeded")
      invalid("定位任务尚未完成。");
    const e = store.get("exams", t.examId);
    if (t.adoptedAt) return res.json({ applied: 0, alreadyApplied: true });
    const maps = { ...(e.answerMaps || {}) },
      changed = [];
    for (const row of t.result.mappings) {
      const m = Mapping.parse(row);
      if (
        !e.questions.some((q) => q.id === m.questionId) ||
        !e.attachments.some(
          (f) => f.id === m.fileId && (f.studentId || null) === m.studentId,
        )
      )
        continue;
      const key = mapKey(m.fileId, m.questionId),
        old = maps[key];
      if (old?.edited) continue;
      const pages = new Set(t.result.pages);
      const regions = [
        ...(old?.regions || []).filter((r) => !pages.has(r.page)),
        ...m.regions,
      ].sort((a, b) => a.page - b.page || a.box.y - b.box.y);
      const value = {
        ...m,
        regions,
        warnings: [
          ...new Set([
            ...(old?.warnings || []),
            ...m.warnings,
            ...t.result.warnings,
          ]),
        ].slice(0, 30),
        version: (old?.version || 0) + 1,
      };
      maps[key] = value;
      changed.push({ before: old || null, after: value });
    }
    store.transaction(() => {
      store.put("exams", {
        ...e,
        answerMaps: maps,
        revision: e.revision + 1,
        updatedAt: now(),
      });
      store.audit(
        e.id,
        "应用自动定位",
        changed.map((c) => c.before),
        changed.map((c) => c.after),
      );
      store.put("tasks", { ...t, adoptedAt: now() });
    });
    res.json({ applied: changed.length, warnings: t.result.warnings });
  });
  app.post("/api/tasks/:id/review-assessment", (req, res) => {
    const t = store.get("tasks", req.params.id);
    if (t.kind !== "assess" || t.status !== "succeeded")
      invalid("逐点预批尚未完成。");
    const e = store.get("exams", t.examId),
      q = e.questions.find((q) => q.id === t.payload.questionId),
      sid = t.payload.studentId,
      key = cellKey(sid, q?.id);
    if (
      !q ||
      !q.rubricSpec?.confirmed ||
      rubricHash(q) !== t.payload.rubricHash
    )
      invalid("评分标准已改变，请重新预批；原分数未改动。", 409);
    const m = e.answerMaps?.[mapKey(t.payload.mapping.fileId, q.id)];
    if (
      !m ||
      mappingHash(m) !== t.payload.mappingHash ||
      e.attachments.filter((f) => f.studentId === sid).at(-1)?.id !== m.fileId
    )
      invalid("作答文件或区域已改变，请重新预批。", 409);
    const prior = e.grades[key] || null;
    if (req.body.expectedGradeHash !== gradeHash(prior))
      invalid("成绩已经变化，请重新核对当前分数。", 409);
    if (req.body.coverageConfirmed !== true)
      invalid("请先核对本题作答区域完整，或补选续页。");
    const criteria = z.array(Evidence).max(40).parse(req.body.criteria);
    if (
      criteria.length !== q.rubricSpec.criteria.length ||
      new Set(criteria.map((c) => c.criterionId)).size !== criteria.length ||
      criteria.some(
        (c) => !q.rubricSpec.criteria.some((x) => x.id === c.criterionId),
      )
    )
      invalid("评分点必须与当前标准一一对应。");
    for (const c of criteria) {
      const def = q.rubricSpec.criteria.find((x) => x.id === c.criterionId);
      if (
        new Set(c.skillEvidence.map((x) => x.skill)).size !==
          c.skillEvidence.length ||
        c.skillEvidence.some((x) => !def.skills.includes(x.skill))
      )
        invalid("技能判断必须对应本评分点的技能名称且不能重复。");
      if (
        c.accepted &&
        c.skillEvidence.some((x) =>
          ["demonstrated", "error", "blocked"].includes(x.status),
        ) &&
        !c.references.length
      )
        invalid("技能判断缺少原图证据。");
      if (c.references.some((r) => !m.regions.some((x) => x.id === r.regionId)))
        invalid("评语引用了不存在的原图区域。");
      if (
        c.accepted &&
        ["demonstrated", "error", "blocked"].includes(c.status) &&
        !c.references.length
      )
        invalid("请为已确认的具体表现选择原图依据。");
      if (
        c.score != null &&
        (def.points == null ||
          c.score > def.points ||
          Math.abs(c.score / q.step - Math.round(c.score / q.step)) > 1e-7)
      )
        invalid("评分点分数与标准不符。");
      if (c.status === "unreadable" && c.score != null)
        invalid("无法辨认的评分点不能记作确定分数。");
    }
    const keep = req.body.scoreAction === "keep";
    if (keep && prior?.status !== "final")
      invalid("目前没有可保留的教师最终成绩。");
    const score = keep ? prior.score : req.body.score;
    const total = criteria.every((c) => c.score != null)
      ? criteria.reduce((s, c) => s + c.score, 0)
      : null;
    const pointsMatch = total != null && Math.abs(total - score) < 1e-7;
    if (
      q.rubricSpec.criteria.every((c) => c.points != null) &&
      !pointsMatch &&
      criteria.some((c) => c.accepted)
    ) {
      if (req.body.diagnosticOnly !== true)
        invalid(
          "逐点分数与总分不一致。请调整评分点，或明确只保留表现证据并清空逐点分数。",
        );
      for (const c of criteria) c.score = null;
    }
    const note = z
      .string()
      .max(4000)
      .parse(req.body.note ?? prior?.note ?? "");
    const grade = {
      ...(prior || {}),
      studentId: sid,
      questionId: q.id,
      score,
      status: "final",
      note,
      tags: prior?.tags || [],
      aiTags: prior?.aiTags || [],
      source: keep ? prior.source || "teacher" : "ai",
    };
    const next = updateGrades(e, [grade], keep ? null : "ai");
    const value = {
      id: key,
      studentId: sid,
      questionId: q.id,
      fileId: m.fileId,
      sourceTaskId: t.id,
      version: (e.evaluations?.[key]?.version || 0) + 1,
      rubricHash: rubricHash(q),
      mappingHash: mappingHash(m),
      gradeHash: gradeHash(next.grades[key]),
      criteria,
      teacherConfirmed: true,
      diagnosticOnly: !!req.body.diagnosticOnly,
      confirmedAt: now(),
    };
    next.evaluations = { ...(e.evaluations || {}), [key]: value };
    next.answerMaps = {
      ...(e.answerMaps || {}),
      [mapKey(m.fileId, q.id)]: { ...m, confirmed: true },
    };
    store.transaction(() => {
      store.put("exams", next);
      store.audit(
        e.id,
        "确认逐点评阅",
        { grade: prior, evaluation: e.evaluations?.[key] || null },
        { grade: next.grades[key], evaluation: value },
      );
      store.put("tasks", { ...t, adoptedAt: now() });
    });
    res.json({ ...next, analysis: analyze(next) });
  });
  app.put("/api/exams/:id/skill-aliases", (req, res) => {
    const e = store.get("exams", req.params.id);
    if (req.body.revision !== e.revision) invalid("资料已改变，请刷新。", 409);
    const aliases = z
      .record(z.string().min(1).max(120), z.string().min(1).max(120))
      .parse(req.body.aliases);
    if (Object.keys(aliases).length > 300)
      invalid("一次最多整理300个技能名称。");
    for (const [from, to] of Object.entries(aliases))
      if (from === to || aliases[to])
        invalid("别名不能指向自己或另一个别名，请直接填写统一名称。");
    const next = {
      ...e,
      skillAliases: aliases,
      revision: e.revision + 1,
      updatedAt: now(),
    };
    store.transaction(() => {
      store.put("exams", next);
      store.audit(e.id, "统一技能名称", e.skillAliases || {}, aliases);
    });
    res.json({ ok: true });
  });
  app.get("/api/exams/:id/assessment-hashes", (req, res) => {
    const e = store.get("exams", req.params.id);
    res.json({
      mappings: Object.fromEntries(
        Object.entries(e.answerMaps || {}).map(([key, m]) => [
          key,
          mappingHash(m),
        ]),
      ),
      rubrics: Object.fromEntries(
        e.questions.map((q) => [q.id, rubricHash(q)]),
      ),
      grades: Object.fromEntries(
        e.students.flatMap((s) =>
          e.questions.map((q) => [
            cellKey(s.id, q.id),
            gradeHash(e.grades[cellKey(s.id, q.id)]),
          ]),
        ),
      ),
    });
  });
}

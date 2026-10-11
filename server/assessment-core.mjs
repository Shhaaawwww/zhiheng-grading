import { z } from "zod";
import { createHash } from "node:crypto";

export const fingerprint = (value) =>
  createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
export const cellKey = (studentId, questionId) => `${studentId}:${questionId}`;
export function invalid(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
export const scoringQuestions = (e) =>
  e.questions.filter(
    (q) => q.type !== "group" && !e.questions.some((c) => c.parentId === q.id),
  );
export const Box = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().positive().max(1),
    h: z.number().positive().max(1),
  })
  .refine((r) => r.x + r.w <= 1.002 && r.y + r.h <= 1.002, "区域超出页面");
export const Region = z.object({
  id: z.string().min(1).max(100),
  page: z.number().int().min(1).max(300),
  box: Box,
  label: z.string().max(200).default(""),
  rotation: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .default(0),
});
export const Criterion = z.object({
  id: z.string().min(1).max(100),
  part: z.string().max(80).default(""),
  label: z.string().trim().min(1).max(240),
  points: z.number().min(0).max(1000).nullable(),
  skills: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  expected: z.string().max(2500).default(""),
  alternatives: z.string().max(2000).default(""),
});
export const RubricSpec = z.object({
  version: z.number().int().positive().default(1),
  confirmed: z.boolean().default(false),
  origin: z.enum(["reference", "generated", "teacher"]).default("teacher"),
  answer: z.string().max(20000).default(""),
  instructions: z.string().max(10000).default(""),
  criteria: z.array(Criterion).min(1).max(40),
  warnings: z.array(z.string().max(600)).max(30).default([]),
  sourceRefs: z
    .array(
      z.object({
        fileId: z.string(),
        pages: z.array(z.number().int().min(1).max(300)).max(50),
      }),
    )
    .max(10)
    .default([]),
});
export function validateRubric(value, question) {
  const spec = RubricSpec.parse(value);
  if (new Set(spec.criteria.map((c) => c.id)).size !== spec.criteria.length)
    invalid("评分点标识重复。");
  const scored = spec.criteria.filter((c) => c.points != null);
  if (scored.length && scored.length !== spec.criteria.length)
    invalid("请为所有评分点设置分值，或全部留空并按整题给分。");
  if (
    scored.length &&
    question.max != null &&
    Math.abs(scored.reduce((s, c) => s + c.points, 0) - question.max) > 1e-7
  )
    invalid("评分点合计不等于本题满分，请核对。");
  if (
    spec.confirmed &&
    (!spec.answer.trim() || !spec.instructions.trim() || question.max == null)
  )
    invalid("请核对本题满分、参考答案和给分规则后确认标准。");
  for (const c of scored)
    if (
      Math.abs(
        c.points / question.step - Math.round(c.points / question.step),
      ) > 1e-7
    )
      invalid("评分点分值与本题分数间隔不一致。");
  return spec;
}
export const evidenceStatuses = [
  "demonstrated",
  "error",
  "not_observed",
  "blocked",
  "unreadable",
  "not_applicable",
];
export const Evidence = z.object({
  criterionId: z.string(),
  status: z.enum(evidenceStatuses),
  score: z.number().finite().min(0).nullable(),
  comment: z.string().max(1500).default(""),
  references: z
    .array(
      z.object({
        regionId: z.string(),
        location: z.string().max(300).default(""),
        quote: z.string().max(1000).default(""),
      }),
    )
    .max(12)
    .default([]),
  accepted: z.boolean().default(false),
  skillEvidence: z
    .array(
      z.object({
        skill: z.string().min(1).max(120),
        status: z.enum(evidenceStatuses),
        comment: z.string().max(1000).default(""),
      }),
    )
    .max(8)
    .default([]),
});
export const Mapping = z.object({
  questionId: z.string(),
  studentId: z.string().nullable(),
  fileId: z.string(),
  regions: z.array(Region).min(1).max(30),
  warnings: z.array(z.string().max(600)).max(30).default([]),
  confirmed: z.boolean().default(false),
  edited: z.boolean().default(false),
  version: z.number().int().positive().default(1),
});
export const mapKey = (fileId, questionId) => `${fileId}:${questionId}`;
export function mappingHash(m) {
  return fingerprint(
    m
      ? {
          fileId: m.fileId,
          questionId: m.questionId,
          studentId: m.studentId,
          regions: m.regions,
        }
      : null,
  );
}
export function rubricHash(q) {
  return fingerprint(
    q
      ? {
          stem: q.rubricSpec ? q.stem : "",
          max: q.max,
          step: q.step,
          rubric: q.rubricSpec || null,
        }
      : null,
  );
}
export function gradeHash(g) {
  return fingerprint(
    g
      ? {
          score: g.score,
          status: g.status,
          note: g.note || "",
          tags: g.tags || [],
        }
      : null,
  );
}
export function questionHash(q) {
  return fingerprint(
    q
      ? {
          label: q.label,
          stem: q.stem,
          max: q.max,
          step: q.step,
          rubric: q.rubricSpec,
        }
      : null,
  );
}
export function mappingFor(exam, sid, qid, fileId) {
  const files = exam.attachments.filter(
    (f) => f.studentId === sid && (!fileId || f.id === fileId),
  );
  const file = files.at(-1);
  return file ? exam.answerMaps?.[mapKey(file.id, qid)] || null : null;
}
export function normalizeAssessment(raw, question, mapping) {
  const spec = question.rubricSpec,
    regionIds = new Set(mapping.regions.map((r) => r.id));
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.map(String).slice(0, 25)
    : [];
  const input = Array.isArray(raw.criteria) ? raw.criteria : [];
  const coverage = ["complete", "uncertain", "incomplete"].includes(
    raw.coverage,
  )
    ? raw.coverage
    : "unspecified";
  const missingContext = coverage === "uncertain" || coverage === "incomplete";
  if (missingContext)
    warnings.push(
      "作答区域或续页完整性未确认，本题暂不合计分数；缺少的步骤不能当作零分。",
    );
  const criteria = spec.criteria.map((c) => {
    const matches = input.filter((x) => x.criterionId === c.id);
    let result = Evidence.safeParse(
      matches.length === 1 ? { ...matches[0], accepted: false } : null,
    );
    if (!result.success) {
      warnings.push(`${c.label}：模型未提供可用判断。`);
      return Evidence.parse({
        criterionId: c.id,
        status: "unreadable",
        score: null,
        comment: "此评分点需教师核对。",
      });
    }
    const v = result.data;
    if (v.references.some((r) => !regionIds.has(r.regionId))) {
      v.references = [];
      v.status = "unreadable";
      v.score = null;
      v.comment = "原图引用无效，请教师核对。";
      warnings.push(`${c.label}：无效证据引用已排除。`);
    }
    if (
      ["demonstrated", "error", "blocked"].includes(v.status) &&
      !v.references.length
    ) {
      v.status = "unreadable";
      v.score = null;
      v.comment = "没有可定位的原图证据，请核对。";
      warnings.push(`${c.label}：缺少证据。`);
    }
    if (c.points == null) v.score = null;
    else if (
      v.score != null &&
      (v.score > c.points ||
        Math.abs(
          v.score / question.step - Math.round(v.score / question.step),
        ) > 1e-7)
    ) {
      v.score = null;
      warnings.push(`${c.label}：分值越界或间隔不符，未采用。`);
    }
    if (v.status === "unreadable") v.score = null;
    if (missingContext && v.status === "not_observed") v.score = null;
    v.skillEvidence = c.skills.map((skill) => {
      const matches = v.skillEvidence.filter((x) => x.skill === skill);
      if (matches.length !== 1 || v.status === "unreadable")
        return {
          skill,
          status: v.status === "unreadable" ? "unreadable" : "not_observed",
          comment: "没有足够证据单独判断此技能。",
        };
      const value = matches[0];
      if (
        ["demonstrated", "error", "blocked"].includes(value.status) &&
        !v.references.length
      )
        return { skill, status: "not_observed", comment: "缺少可定位依据。" };
      return value;
    });
    return v;
  });
  if (input.some((c) => !spec.criteria.some((x) => x.id === c.criterionId)))
    warnings.push("模型返回了标准外评分点，已忽略。");
  const pointScoring = spec.criteria.every((c) => c.points != null);
  let score = pointScoring
    ? criteria.every((c) => c.score != null)
      ? criteria.reduce((s, c) => s + c.score, 0)
      : null
    : raw.score;
  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < 0 ||
    question.max == null ||
    score > question.max ||
    Math.abs(score / question.step - Math.round(score / question.step)) > 1e-7
  )
    score = null;
  return {
    score: missingContext ? null : score,
    coverage,
    criteria,
    warnings: [...new Set(warnings)],
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 1800) : "",
    transcription:
      typeof raw.transcription === "string"
        ? raw.transcription.slice(0, 12000)
        : "",
    alternativeMethod:
      typeof raw.alternativeMethod === "string"
        ? raw.alternativeMethod.slice(0, 2000)
        : "",
    pointScoring,
  };
}
export function evaluationState(exam, evaluation) {
  const q = exam.questions.find((q) => q.id === evaluation.questionId);
  const map =
    exam.answerMaps?.[mapKey(evaluation.fileId, evaluation.questionId)];
  const g = exam.grades[cellKey(evaluation.studentId, evaluation.questionId)];
  const currentFile = exam.attachments
    .filter((f) => f.studentId === evaluation.studentId)
    .at(-1);
  const reasons = [];
  if (!q || !q.rubricSpec?.confirmed || rubricHash(q) !== evaluation.rubricHash)
    reasons.push("评分标准已改变");
  if (
    !map ||
    mappingHash(map) !== evaluation.mappingHash ||
    currentFile?.id !== evaluation.fileId
  )
    reasons.push("作答文件或区域已改变");
  if (!g || g.status !== "final" || gradeHash(g) !== evaluation.gradeHash)
    reasons.push("最终分数或备注已改变");
  return { ...evaluation, stale: reasons.length > 0, staleReasons: reasons };
}
export function confirmedEvidence(exam, studentId = null) {
  const rows = [];
  for (const evaluation of Object.values(exam.evaluations || {})) {
    if (studentId && evaluation.studentId !== studentId) continue;
    const state = evaluationState(exam, evaluation);
    if (state.stale) continue;
    const q = exam.questions.find((q) => q.id === evaluation.questionId);
    if (!q || q.diagnosticExcluded) continue;
    for (const c of evaluation.criteria) {
      const criterion = q.rubricSpec.criteria.find(
        (x) => x.id === c.criterionId,
      );
      if (!c.accepted || !criterion) continue;
      rows.push({
        studentId: evaluation.studentId,
        questionId: q.id,
        questionLabel: q.label,
        criterionId: c.criterionId,
        criterionLabel: criterion.label,
        part: criterion.part,
        skills: criterion.skills,
        skillEvidence: c.skillEvidence || [],
        status: c.status,
        score: c.score,
        max: criterion.points,
        comment: c.comment,
        references: c.references,
        fileId: evaluation.fileId,
      });
    }
  }
  return rows;
}
export function assessmentStatistics(exam, studentId = null) {
  const rows = confirmedEvidence(exam, studentId),
    skills = new Map();
  const aliases = exam.skillAliases || {};
  for (const row of rows)
    for (const original of [...new Set(row.skills)]) {
      const name = aliases[original] || original;
      let item = skills.get(name);
      if (!item) {
        item = {
          name,
          students: new Set(),
          demonstrated: new Set(),
          error: new Set(),
          unknown: new Set(),
          blocked: new Set(),
          events: 0,
          questionIds: new Set(),
          members: [],
        };
        skills.set(name, item);
      }
      const detail = row.skillEvidence.find((v) => v.skill === original) || {
        status: "not_observed",
        comment: "此技能只有关联标签，尚无单独表现证据。",
      };
      const member = {
        ...row,
        status: detail.status,
        comment: detail.comment || row.comment,
      };
      const duplicate = item.members.find(
        (m) =>
          m.studentId === row.studentId &&
          m.questionId === row.questionId &&
          m.criterionId === row.criterionId,
      );
      if (duplicate) {
        if (duplicate.status !== member.status) {
          duplicate.status = "not_observed";
          duplicate.comment = "合并技能名称后存在不同判断，请核对。";
        }
        continue;
      }
      item.students.add(row.studentId);
      item.questionIds.add(row.questionId);
      item.events++;
      item.members.push(member);
    }
  for (const item of skills.values())
    for (const row of item.members) {
      if (row.status === "demonstrated") item.demonstrated.add(row.studentId);
      else if (row.status === "error") item.error.add(row.studentId);
      else if (row.status === "blocked") item.blocked.add(row.studentId);
      else if (row.status !== "not_applicable") item.unknown.add(row.studentId);
    }
  return {
    confirmedEvents: rows.length,
    reviewedAnswers: new Set(
      rows.map((r) => cellKey(r.studentId, r.questionId)),
    ).size,
    skills: [...skills.values()].map((s) => ({
      ...s,
      students: [...s.students],
      demonstrated: [...s.demonstrated],
      error: [...s.error],
      unknown: [...s.unknown],
      blocked: [...s.blocked],
      questionIds: [...s.questionIds],
    })),
    staleAnswers: Object.values(exam.evaluations || {}).filter(
      (e) =>
        (!studentId || e.studentId === studentId) &&
        evaluationState(exam, e).stale,
    ).length,
  };
}
export function assessmentInput(exam, studentId, anonymize) {
  const a = assessmentStatistics(exam, studentId);
  return {
    confirmedEvents: a.confirmedEvents,
    reviewedAnswers: a.reviewedAnswers,
    staleAnswers: a.staleAnswers,
    skills: a.skills.map((s) => ({
      name: s.name,
      questionIds: s.questionIds,
      reviewedStudents: s.students.length,
      demonstratedStudents: s.demonstrated.length,
      errorStudents: s.error.length,
      unknownStudents: s.unknown.length,
      blockedStudents: s.blocked.length,
      events: s.events,
      examples: s.members.slice(0, studentId ? 30 : 4).map((r) => ({
        questionId: r.questionId,
        criterionId: r.criterionId,
        criterionLabel: r.criterionLabel,
        part: r.part,
        status: r.status,
        comment: anonymize(r.comment),
        evidenceRef: `S${String(exam.students.findIndex((x) => x.id === r.studentId) + 1).padStart(3, "0")}:${r.questionId}:${r.criterionId}`,
        source: "teacher-confirmed",
      })),
    })),
    policy:
      "这些记录经教师确认，描述本次可观察表现。一个学生可出现在同技能多个状态，人数不可相加。未观察到/受前错影响/看不清不等于不会。技能共享评分点不分摊分数。",
  };
}

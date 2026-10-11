import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { RubricSpec, assessmentStatistics, assessmentInput } from './assessment-core.mjs';

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const QUESTION_TYPES = ["choice", "multiple", "fill", "solve", "proof", "group"];
export const TOPICS = [
  "集合与逻辑",
  "函数性质",
  "导数与单调性",
  "导数综合应用",
  "三角函数",
  "数列",
  "平面向量",
  "立体几何",
  "解析几何",
  "概率与统计",
];
export const ERROR_TAGS = [
  "运算错误",
  "条件遗漏",
  "分类讨论遗漏",
  "推理不完整",
  "表达不规范",
  "方法使用问题",
  "未作答",
];
export const fail = (message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
export const Student = z.object({
  id: z.string().min(1),
  number: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
});
export const Question = z.object({
  rubricSpec: RubricSpec.optional(),
  id: z.string().min(1),
  label: z.string().trim().min(1).max(40),
  parentId: z.string().nullable().default(null),
  stem: z.string().max(15000).default(""),
  max: z.number().positive().max(1000).nullable(),
  step: z.number().positive().max(100).default(0.5),
  type: z
    .enum(QUESTION_TYPES)
    .default("solve"),
  primary: z.string().max(120).default(""),
  skill: z.string().max(240).default(""),
  diagnosticExcluded: z.boolean().default(false),
  related: z.array(z.string().max(120)).max(20).default([]),
  confirmed: z.boolean().default(false),
  answer: z.string().max(20000).default(""),
  rubric: z.string().max(15000).default(""),
  page: z.number().int().min(1).max(300).default(1),
  region: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().positive().max(1),
      h: z.number().positive().max(1),
    })
    .nullable()
    .default(null),
});
export const Grade = z.object({
  studentId: z.string().min(1),
  questionId: z.string().min(1),
  score: z.number().finite().nullable(),
  status: z.enum(["ungraded", "draft", "final", "absent", "na"]),
  note: z.string().max(4000).default(""),
  tags: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  aiTags: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  source: z.enum(["teacher", "import", "ai"]).default("teacher"),
  updatedAt: z.string().optional(),
});
export const keyOf = (s, q) => `${s}:${q}`;
export function questionContext(exam, q) {
  const context = [];
  let parent = q.parentId;
  while (parent) {
    const p = exam.questions.find((x) => x.id === parent);
    if (!p) break;
    context.unshift({
      label: p.label,
      stem: p.stem,
      answer: p.answer,
      rubric: p.rubric,
    });
    parent = p.parentId;
  }
  return context;
}
export function leaves(exam) {
  const parents = new Set(
    exam.questions.map((q) => q.parentId).filter(Boolean),
  );
  return exam.questions.filter((q) => !parents.has(q.id) && q.type !== "group");
}
export function validateQuestions(questions) {
  const parsed = z.array(Question).max(200).parse(questions);
  const ids = new Set(),
    labels = new Set();
  for (const q of parsed) {
    if (ids.has(q.id) || labels.has(q.label))
      fail("题号或题目标识重复，请先检查。");
    if (
      q.max != null && (q.max / q.step < 1 ||
      Math.abs(q.max / q.step - Math.round(q.max / q.step)) > 1e-7)
    )
      fail(`第 ${q.label} 题满分必须符合分数步长。`);
    if (
      q.region &&
      (q.region.x + q.region.w > 1.001 || q.region.y + q.region.h > 1.001)
    )
      fail("作答区域超出页面。");
    ids.add(q.id);
    labels.add(q.label);
  }
  for (const q of parsed) {
    if (q.parentId && !ids.has(q.parentId)) fail("小问的父题不存在。");
    const chain = new Set([q.id]);
    let p = q.parentId;
    while (p) {
      if (chain.has(p)) fail("题目层级存在循环。");
      chain.add(p);
      p = parsed.find((x) => x.id === p)?.parentId;
    }
    const children = parsed.filter((c) => c.parentId === q.id);
    if (children.length && q.type !== "group")
      fail(`第 ${q.label} 题有小问，请将题型设为“大题汇总”。`);
    if (
      children.length &&
      q.max != null && children.every(c => c.max != null) &&
      Math.abs(children.reduce((a, c) => a + c.max, 0) - q.max) > 1e-7
    )
      fail(`第 ${q.label} 题小问满分之和与大题满分不一致。`);
  }
  return parsed;
}
export function validateGrade(exam, input) {
  const g = Grade.parse(input),
    q = leaves(exam).find((q) => q.id === g.questionId);
  if (!q || !exam.students.some((s) => s.id === g.studentId))
    fail("学生或可录分题目不存在。");
  if (["final", "draft"].includes(g.status)) {
    if (g.score === null || g.score < 0 || (q.max != null && g.score > q.max))
      fail(`第 ${q.label} 题得分应在 0–${q.max} 之间。`);
    if (Math.abs(g.score / q.step - Math.round(g.score / q.step)) > 1e-7)
      fail(`第 ${q.label} 题按 ${q.step} 分为步长录入。`);
    // Unknown maxima never become official scores; the entered value is retained.
    if (q.max == null) g.status = "draft";
  } else if (g.score !== null) fail("未录入、缺考和不适用状态不能同时有分数。");
  return { ...g, tags: [...new Set(g.tags)], updatedAt: now() };
}
export function updateGrades(exam, inputs, source = "teacher") {
  const changes = inputs.map((x) => {
    const prior = exam.grades[keyOf(x.studentId, x.questionId)];
    return validateGrade(exam, {
      ...x,
      aiTags: prior && prior.note !== x.note ? [] : x.aiTags || [],
      source: source || x.source || "teacher",
    });
  });
  const grades = { ...exam.grades };
  for (const g of changes) grades[keyOf(g.studentId, g.questionId)] = g;
  return { ...exam, grades, revision: exam.revision + 1, updatedAt: now() };
}
export function updateQuestions(exam, inputs) {
  const questions = validateQuestions(inputs),
    next = { ...exam, questions };
  for (const q of questions) {
    const old=exam.questions.find(x=>x.id===q.id);
    if(q.rubricSpec && old && (old.stem!==q.stem||old.max!==q.max||old.step!==q.step)) q.rubricSpec={...q.rubricSpec,confirmed:false};
  }
  next.answerMaps=Object.fromEntries(Object.entries(exam.answerMaps||{}).filter(([,m])=>questions.some(q=>q.id===m.questionId)));
  next.evaluations=Object.fromEntries(Object.entries(exam.evaluations||{}).filter(([,e])=>questions.some(q=>q.id===e.questionId)));
  for (const g of Object.values(exam.grades)) {
    if (g.status === "ungraded") continue;
    if (!leaves(next).some((q) => q.id === g.questionId))
      fail("该题已有成绩，不能删除或改为汇总题。请先清除对应成绩。");
    if (g.status === "final" && questions.find(q => q.id === g.questionId)?.max == null)
      fail("该题已有正式成绩，请保留已核对满分；需要改变计分结构时使用结构调整工具。");
    validateGrade(next, g);
  }
  next.grades = Object.fromEntries(
    Object.entries(exam.grades).filter(([, g]) =>
      leaves(next).some((q) => q.id === g.questionId),
    ),
  );
  return { ...next, revision: exam.revision + 1, updatedAt: now() };
}
const round = (n) => Math.round(n * 100) / 100;
const mean = (a) =>
  a.length ? round(a.reduce((s, x) => s + x, 0) / a.length) : null;
const rate = (a, b) => (b ? round((a / b) * 100) : null);
export function analyze(exam) {
  const qs = leaves(exam),
    max = qs.some(q => q.max == null) ? null : round(qs.reduce((a, q) => a + q.max, 0));
  const students = exam.students.map((s) => {
    const cells = qs.map((q) => exam.grades[keyOf(s.id, q.id)]);
    const valid = cells.filter((g) => g?.status === "final");
    const allAbsent =
      cells.length > 0 && cells.every((g) => g?.status === "absent");
    const complete = qs.length > 0 && max != null && valid.length === qs.length;
    return {
      ...s,
      confirmed: valid.length,
      complete,
      absent: allAbsent,
      total: complete ? round(valid.reduce((a, g) => a + g.score, 0)) : null,
      partial: round(valid.reduce((a, g) => a + g.score, 0)),
      noteCount: valid.filter((g) => g.note.trim() || g.tags.length).length,
    };
  });
  const totals = students
      .filter((s) => s.complete)
      .map((s) => s.total)
      .sort((a, b) => a - b),
    avg = mean(totals);
  const median = totals.length
    ? round(
        totals.length % 2
          ? totals[(totals.length - 1) / 2]
          : (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2,
      )
    : null;
  const questions = qs.map((q) => {
    const gs = exam.students
      .map((s) => exam.grades[keyOf(s.id, q.id)])
      .filter((g) => g?.status === "final");
    const lost = gs.filter((g) => g.score < q.max),
      annotated = gs.filter((g) => g.note.trim() || g.tags.length),
      annotatedLost = lost.filter((g) => g.note.trim() || g.tags.length);
    const tags = [...new Set(gs.flatMap((g) => g.tags))].map((tag) => ({
      tag,
      count: gs.filter((g) => g.tags.includes(tag)).length,
      studentIds: gs
        .filter((g) => g.tags.includes(tag))
        .map((g) => g.studentId),
    }));
    const sum = gs.reduce((a, g) => a + g.score, 0);
    return {
      id: q.id,
      label: q.label,
      primary: q.primary,
      confirmedTopic: q.confirmed && !q.diagnosticExcluded && q.max != null,
      max: q.max,
      n: gs.length,
      average: mean(gs.map((g) => g.score)),
      rate: rate(sum, gs.length * q.max),
      full: gs.filter((g) => g.score === q.max).length,
      zero: gs.filter((g) => g.score === 0).length,
      lost: lost.length,
      lostPoints: round(gs.length * q.max - sum),
      partial: gs.filter(g => g.score > 0 && g.score < q.max).length,
      pending: exam.students.filter(s => !["final", "absent", "na"].includes(exam.grades[keyOf(s.id, q.id)]?.status)).length,
      lostStudentIds: lost.map(g => g.studentId),
      annotated: annotated.length,
      annotatedLost: annotatedLost.length,
      tags,
    };
  });
  const topics = [
    ...new Set(
      qs.filter((q) => q.confirmed && q.primary && q.max != null && !q.diagnosticExcluded).map((q) => q.primary),
    ),
  ].map((name) => {
    const group = qs.filter((q) => q.confirmed && q.primary === name && q.max != null && !q.diagnosticExcluded),
      groupMax = group.reduce((a, q) => a + q.max, 0);
    const values = students.map((s) => {
      const gs = group.map((q) => exam.grades[keyOf(s.id, q.id)]),
        valid = gs.filter((g) => g?.status === "final");
      return {
        studentId: s.id,
        n: valid.length,
        complete: valid.length === group.length,
        score: round(valid.reduce((a, g) => a + g.score, 0)),
        rate:
          valid.length === group.length
            ? rate(
                valid.reduce((a, g) => a + g.score, 0),
                groupMax,
              )
            : null,
      };
    });
    const complete = values.filter((x) => x.complete);
    return {
      name,
      questionIds: group.map((q) => q.id),
      questionLabels: group.map((q) => q.label),
      count: group.length,
      max: groupMax,
      n: complete.length,
      rate: rate(
        complete.reduce((a, v) => a + v.score, 0),
        complete.length * groupMax,
      ),
      students: values,
    };
  });
  const histogram = Array.from({ length: 5 }, (_, i) => ({
    label: `${i * 20}–${(i + 1) * 20}%`,
    count: totals.filter(
      (t) =>
        max > 0 &&
        (t / max) * 100 >= i * 20 &&
        (i === 4 ? t <= max : (t / max) * 100 < (i + 1) * 20),
    ).length,
  }));
  const tagNames = [
    ...new Set(questions.flatMap((q) => q.tags.map((t) => t.tag))),
  ];
  const remarks = tagNames.map((tag) => {
    const qRows = questions.filter((q) => q.tags.some((t) => t.tag === tag));
    return {
      tag,
      students: [
        ...new Set(
          qRows.flatMap((q) => q.tags.find((t) => t.tag === tag).studentIds),
        ),
      ],
      occurrences: qRows.reduce(
        (a, q) => a + q.tags.find((t) => t.tag === tag).count,
        0,
      ),
      questionIds: qRows.map((q) => q.id),
    };
  });
  const aiNames = [
    ...new Set(
      Object.values(exam.grades)
        .filter((g) => g.status === "final")
        .flatMap((g) => g.aiTags || []),
    ),
  ];
  for (const tag of aiNames) {
    const gs = Object.values(exam.grades).filter(
      (g) => g.status === "final" && (g.aiTags || []).includes(tag),
    );
    remarks.push({
      tag,
      source: "ai",
      students: [...new Set(gs.map((g) => g.studentId))],
      occurrences: gs.length,
      questionIds: [...new Set(gs.map((g) => g.questionId))],
    });
  }
  const issues = [];
  if (!qs.length)
    issues.push({ kind: "question", text: "尚未添加可录分题目。" });
  if (!students.length)
    issues.push({ kind: "student", text: "考试名单为空。" });
  for (const q of qs)
    if (q.max == null) issues.push({ kind: "max", questionId: q.id, text: `第 ${q.label} 题满分待核对，小分仅暂存，暂不计算正式总分。` });
  for (const q of qs)
    if (!q.confirmed || !q.primary)
      issues.push({
        kind: "topic",
        questionId: q.id,
        text: `第 ${q.label} 题知识点待确认，暂不参加知识点聚合。`,
      });
  for (const s of students)
    if (!s.complete && !s.absent)
      issues.push({
        kind: "grade",
        studentId: s.id,
        text: `${s.name}：${qs.length - s.confirmed} 项成绩待完成或不适用。`,
      });
  return {
    revision: exam.revision,
    assessment: assessmentStatistics(exam),
    max,
    knownMax: round(qs.reduce((a, q) => a + (q.max ?? 0), 0)),
    topicCoverage: { confirmed: questions.filter(q => q.confirmedTopic && q.primary).length, total: qs.length },
    expected: students.length,
    complete: totals.length,
    absent: students.filter((s) => s.absent).length,
    pending: students.filter((s) => !s.complete && !s.absent).length,
    confirmedCells: questions.reduce((a, q) => a + q.n, 0),
    totalCells: students.length * qs.length,
    average: avg,
    median,
    std:
      avg === null
        ? null
        : round(
            Math.sqrt(
              totals.reduce(
                (a, x) =>
                  a +
                  (x - totals.reduce((a, b) => a + b, 0) / totals.length) ** 2,
                0,
              ) / totals.length,
            ),
          ),
    highest: totals.length ? totals.at(-1) : null,
    lowest: totals.length ? totals[0] : null,
    students,
    questions,
    topics,
    histogram,
    remarks,
    issues,
  };
}
// Deliberately excludes attachments, raw AI attempts, draft values and grader reasoning.
export function analysisInput(exam, studentId = null) {
  const stats = analyze(exam),
    qs = leaves(exam),
    aliases = Object.fromEntries(
      exam.students.map((s, i) => [s.id, `S${String(i + 1).padStart(3, "0")}`]),
    );
  if (studentId && !exam.students.some(s => s.id === studentId)) fail("学生不存在。");
  const selected = studentId
    ? exam.students.filter((s) => s.id === studentId)
    : exam.students;
  const anonymize = text => {
    let result = String(text || "");
    for (const s of [...exam.students].sort((a, b) => b.name.length - a.name.length)) {
      if (s.name.length >= 2) result = result.replaceAll(s.name, aliases[s.id]);
      if (s.number.length >= 4) result = result.replaceAll(s.number, aliases[s.id]);
    }
    return result;
  };
  const candidates = stats.questions.filter(q => {
    const g = studentId ? exam.grades[keyOf(studentId, q.id)] : null;
    return q.max != null && (studentId ? g?.status === "final" && (g.score < q.max || g.note || g.tags.length) : q.n > 0 && q.lost > 0);
  }).sort((a, b) => {
    if (studentId) {
      const ga = exam.grades[keyOf(studentId, a.id)], gb = exam.grades[keyOf(studentId, b.id)];
      return Number(!!(gb.note || gb.tags.length)) - Number(!!(ga.note || ga.tags.length)) || ga.score / a.max - gb.score / b.max;
    }
    return Number(b.annotatedLost > 0) - Number(a.annotatedLost > 0) || a.rate - b.rate;
  });
  const assessment = assessmentInput(exam, studentId, anonymize);
  const focusGroups = assessment.skills.filter(s=>s.errorStudents||s.blockedStudents||s.unknownStudents).sort((a,b)=>b.errorStudents-a.errorStudents).slice(0,studentId?2:3).map(s=>({topic:s.name,evidence:s.questionIds,assessmentRefs:s.examples.map(x=>x.evidenceRef)}));
  for (const q of candidates) {
    if (focusGroups.length >= (studentId ? 2 : 3)) break;
    if (focusGroups.some(g => g.evidence.includes(q.id))) continue;
    const evidence = candidates.filter(x => x.id === q.id || (q.confirmedTopic && x.confirmedTopic && q.primary === x.primary)).slice(0, 8).map(x => x.id);
    focusGroups.push({ topic: q.confirmedTopic ? q.primary : "知识点待核对", evidence });
    if (focusGroups.length >= (studentId ? 2 : 3)) break;
  }
  return {
    scope: studentId ? "student" : "class",
    schemaVersion: 3,
    reportContract: 'skill-reference-2',
    assessment,
    focusGroups,
    questions: qs.map(
      ({ id, label, max, primary, skill, confirmed, diagnosticExcluded }) => ({
        id,
        label,
        max,
        primary: confirmed && !diagnosticExcluded ? primary : "待核对",
        skill: confirmed && !diagnosticExcluded ? skill || "" : "",
        confirmed: confirmed && !diagnosticExcluded && max != null,
      }),
    ),
    statistics: {
      max: stats.max,
      complete: stats.complete,
      expected: stats.expected,
      average: stats.average,
      questions: stats.questions.map(({ lostStudentIds, primary, ...q }) => ({
        ...q, primary: q.confirmedTopic ? primary : "待核对",
        tags: q.tags.map((t) => ({
          ...t,
          studentIds: undefined,
        })),
      })),
      topics: stats.topics.map((t) => ({
        ...t,
        students: t.students
          .filter((s) => studentId && s.studentId === studentId)
          .map((s) => ({ ...s, studentId: aliases[s.studentId] })),
      })),
    },
    finalResults: selected.map((s) => ({
      student: aliases[s.id],
      grades: qs
        .map((q) => exam.grades[keyOf(s.id, q.id)])
        .filter((g) => g?.status === "final" && (studentId || (g.note.trim() || g.tags.length)))
        .map((g) => ({
          questionId: g.questionId,
          score: g.score,
          note: anonymize(g.note),
          tags: g.tags,
          aiTags: g.aiTags || [],
        })),
    })).map(s => ({ ...s, grades: s.grades.filter(g => {
      if (studentId) return true;
      // Bound class examples per question in a deterministic student order.
      const earlier = selected.slice(0, selected.findIndex(x => aliases[x.id] === s.student));
      return earlier.filter(x => {
        const v = exam.grades[keyOf(x.id, g.questionId)];
        return v?.status === "final" && (v.note.trim() || v.tags.length);
      }).length < 4;
    }) })).filter(s => s.grades.length),
    evidencePolicy: "班级备注仅为每题最多4条的有记录样本，不代表全班；满分备注不代表扣分。无题干、无作答过程，不能推断未记录错因。",
    teaching: (exam.teaching || []).map(x => ({ topic: x.topic, action: x.action, date: x.date, outcomes: x.outcomes?.filter(v => !studentId || v.studentId === studentId).map(({ studentId: sid, ...v }) => ({ ...v, student: studentId ? aliases[sid] : undefined })) })),
  };
}
export function snapshotHash(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
export function basicReport(exam, studentId = null) {
  const a = analyze(exam),
    student = studentId ? a.students.find((s) => s.id === studentId) : null;
  if (studentId && !student) fail("学生不存在。");
  const qs = student
    ? a.questions
        .map((q) => {
          const g = exam.grades[keyOf(studentId, q.id)];
          return {
            ...q,
            rate: g?.status === "final" ? rate(g.score, q.max) : null,
          };
        })
        .filter((q) => q.rate !== null)
    : a.questions.filter((q) => q.rate !== null);
  const focus = [...qs]
    .sort((x, y) => x.rate - y.rate)
    .filter((q) => q.rate < 100)
    .slice(0, student ? 2 : 3);
  return {
    title: student ? `${student.name} · 本次学习反馈` : "班级讲评与教学建议",
    summary: student
      ? student.complete
        ? `本次总分 ${student.total}/${a.max}。以下建议来自最终逐题成绩与已有备注。`
        : "成绩尚未完整，当前展示已确认题目的阶段性表现。"
      : `${a.complete}/${a.expected} 名学生完成全部评分。总分统计只包括完整有效答卷。`,
    findings: focus.map((q) => ({
      title: `优先回看第 ${q.label} 题`,
      observation: `${student ? "个人" : "已确认作答"}得分率 ${q.rate}%。${q.confirmedTopic && q.primary ? `主要考查：${q.primary}。` : "知识点待核对。"}`,
      evidence: [q.id],
      action: `结合原题回顾${q.confirmedTopic ? q.primary : "对应内容（先核对知识点）"}，用一道同类短题进一步检查。`,
      check: "核对关键条件与作答过程；没有备注时暂不确定具体错因。",
    })),
    note: "本次题组表现不等于长期掌握程度；备注缺失不表示没有问题。",
  };
}

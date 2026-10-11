import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../server/app.mjs";
import {
  Question,
  updateGrades,
  updateQuestions,
  analyze,
  analysisInput,
  snapshotHash,
} from "../server/domain.mjs";
import {
  RubricSpec,
  Mapping,
  Evidence,
  validateRubric,
  normalizeAssessment,
  rubricHash,
  mappingHash,
  gradeHash,
  confirmedEvidence,
  assessmentStatistics,
} from "../server/assessment-core.mjs";
import {
  prepareAssessment,
  runAssessment,
  protectStudentPageContext,
} from "../server/assessment-ai.mjs";
import { validateReport } from "../server/ai.mjs";
import {
  constrainedReport,
  recordedNotes,
} from "../server/report-contract.mjs";
import { validateAssessmentData } from "../server/assessment-routes.mjs";
test("report references retain the selected skill comment when a criterion has multiple skills", () => {
  const { e } = fixture();
  const evidence = e.evaluations["s1:q1"].criteria[1];
  evidence.skillEvidence = [
    {
      skill: "方程",
      status: "not_observed",
      comment: "未单独观察到列方程过程",
    },
    { skill: "运算", status: "error", comment: "移项时没有变号" },
  ];
  const input = analysisInput(e, "s1"),
    skill = input.assessment.skills.find((s) => s.name === "方程");
  const ref = skill.examples.find((x) => x.criterionId === "c2").evidenceRef;
  const finding = {
    title: "核对方程",
    observation: "",
    evidence: ["q1"],
    remarkRefs: [],
    assessmentRefs: [ref],
    skillName: "方程",
    certainty: "recorded",
    action: "请单独列出方程",
    check: "观察列式依据",
  };
  assert.ok(
    recordedNotes(input, finding)[0].note.includes("未单独观察到列方程过程"),
  );
  assert.ok(!recordedNotes(input, finding)[0].note.includes("移项时没有变号"));
  assert.throws(
    () =>
      validateReport(
        { summary: "", findings: [{ ...finding, skillName: "" }] },
        input,
      ),
    /对应技能/,
  );
});
function fixture() {
  const spec = RubricSpec.parse({
    confirmed: true,
    answer: "x=2",
    instructions: "每点一分，允许等价解法",
    criteria: [
      {
        id: "c1",
        part: "a",
        label: "建立关系",
        points: 1,
        skills: ["建模", "方程"],
      },
      {
        id: "c2",
        part: "b",
        label: "求解",
        points: 1,
        skills: ["方程", "运算"],
      },
    ],
  });
  const q = Question.parse({
    id: "q1",
    label: "1",
    max: 2,
    step: 1,
    stem: "敏感完整题干",
    confirmed: true,
    primary: "方程",
    rubricSpec: spec,
  });
  const m = Mapping.parse({
    fileId: "f1",
    studentId: "s1",
    questionId: q.id,
    regions: [
      { id: "r1", page: 1, box: { x: 0, y: 0, w: 1, h: 1 } },
      { id: "r2", page: 2, box: { x: 0, y: 0, w: 1, h: 1 } },
    ],
  });
  let e = {
    id: "exam",
    name: "考试",
    className: "班级",
    date: "2026-09-10",
    revision: 1,
    students: [
      { id: "s1", name: "测试甲", number: "1001" },
      { id: "s2", name: "测试乙", number: "1002" },
    ],
    questions: [q],
    attachments: [
      {
        id: "f1",
        studentId: "s1",
        role: "student",
        mime: "application/pdf",
        name: "1001.pdf",
      },
    ],
    grades: {},
    answerMaps: { "f1:q1": m },
  };
  e = updateGrades(e, [
    {
      studentId: "s1",
      questionId: "q1",
      score: 1,
      status: "final",
      note: "",
      tags: [],
      source: "teacher",
    },
  ]);
  const criteria = [
    Evidence.parse({
      criterionId: "c1",
      status: "demonstrated",
      score: 1,
      references: [{ regionId: "r1" }],
      comment: "建立正确关系",
      accepted: true,
    }),
    Evidence.parse({
      criterionId: "c2",
      status: "error",
      score: 0,
      references: [{ regionId: "r2" }],
      comment: "移项符号错误",
      accepted: true,
    }),
  ];
  for (const c of criteria)
    c.skillEvidence = spec.criteria
      .find((x) => x.id === c.criterionId)
      .skills.map((skill) => ({ skill, status: c.status, comment: c.comment }));
  e.evaluations = {
    "s1:q1": {
      id: "s1:q1",
      studentId: "s1",
      questionId: "q1",
      fileId: "f1",
      rubricHash: rubricHash(q),
      mappingHash: mappingHash(m),
      gradeHash: gradeHash(e.grades["s1:q1"]),
      criteria,
      teacherConfirmed: true,
    },
  };
  return { e, q, m, spec, criteria };
}
test("single-question student pages preserve full-page context, while shared pages retain individual crops", () => {
  const { m } = fixture();
  m.regions[0].box.h = 0.2;
  const one = protectStudentPageContext([m]);
  assert.deepEqual(one[0].regions[0].box, { x: 0, y: 0, w: 1, h: 1 });
  const shared = protectStudentPageContext([
    m,
    { ...m, questionId: "q2", regions: [m.regions[0]] },
  ]);
  assert.equal(shared[0].regions[0].box.h, 0.2);
  assert.equal(shared[0].regions[1].box.h, 1);
  assert.deepEqual(
    protectStudentPageContext([{ ...m, studentId: null }])[0].regions,
    m.regions,
  );
});
test("fault injection: a truncated group splits into single criteria and preserves each completed retry", async () => {
  const { q, m } = fixture();
  q.rubricSpec.criteria.forEach((c) => (c.part = "A"));
  let task = {
    id: "split-test",
    kind: "assess",
    payload: {
      question: q,
      mapping: m,
      sources: m.regions.map((r) => ({ page: r.page, regionId: r.id })),
      images: ["data:image/png;base64,AA=="],
      inputHash: "split-hash",
    },
  };
  const requests = [];
  let fail = true;
  const manager = {
    store: {
      get: () => structuredClone(task),
      put: (_, v) => {
        task = v;
      },
    },
    request: async (_, messages) => {
      const cs = JSON.parse(messages[1].content[0].text).rubric.criteria;
      requests.push(cs.map((c) => c.id));
      if (cs.length > 1) throw Error("模型输出被截断");
      if (cs[0].id === "c2" && fail) throw Error("deliberate interruption");
      return {
        text: JSON.stringify({
          coverage: "complete",
          criteria: cs.map((c) => ({
            criterionId: c.id,
            score: 1,
            status: "demonstrated",
            references: [{ regionId: "r1" }],
          })),
        }),
        usage: { input: 1, output: 2 },
      };
    },
  };
  await assert.rejects(
    () => runAssessment(manager, task, new AbortController().signal),
    /deliberate/,
  );
  assert.equal(task.payload.resumeAssessmentSingles.length, 1);
  fail = false;
  const result = await runAssessment(
    manager,
    task,
    new AbortController().signal,
  );
  assert.equal(result.result.score, 2);
  assert.deepEqual(requests, [["c1", "c2"], ["c1"], ["c2"], ["c2"]]);
});
test("incomplete or uncertain page coverage never becomes a complete low total or a zero for unseen work", () => {
  const { q, m, criteria } = fixture();
  for (const coverage of ["incomplete", "uncertain"]) {
    const raw = normalizeAssessment(
      {
        coverage,
        criteria: [
          criteria[0],
          { ...criteria[1], status: "not_observed", score: 0 },
        ],
      },
      q,
      m,
    );
    assert.equal(raw.score, null);
    assert.equal(raw.criteria[0].score, 1);
    assert.equal(raw.criteria[1].score, null);
  }
  assert.equal(
    normalizeAssessment(
      {
        coverage: "complete",
        criteria: [
          criteria[0],
          { ...criteria[1], status: "not_observed", score: 0 },
        ],
      },
      q,
      m,
    ).score,
    1,
  );
});
test("rubrics require consistent allocation, reject duplicate IDs and preserve diagnostic-only mode", () => {
  const { q, spec } = fixture();
  assert.equal(validateRubric(spec, q).criteria.length, 2);
  assert.throws(
    () =>
      validateRubric(
        { ...spec, criteria: spec.criteria.map((c) => ({ ...c, points: 2 })) },
        q,
      ),
    /合计/,
  );
  assert.throws(
    () =>
      validateRubric(
        { ...spec, criteria: [spec.criteria[0], spec.criteria[0]] },
        q,
      ),
    /重复/,
  );
  assert.throws(
    () =>
      validateRubric(
        {
          ...spec,
          criteria: [spec.criteria[0], { ...spec.criteria[1], points: null }],
        },
        q,
      ),
    /所有/,
  );
  assert.ok(
    validateRubric(
      { ...spec, criteria: spec.criteria.map((c) => ({ ...c, points: null })) },
      q,
    ),
  );
});
test("unreadable, invalid evidence and missing criteria never silently become zero; sum is program computed", () => {
  const { q, m, criteria } = fixture();
  const raw = { score: 999, criteria };
  assert.equal(normalizeAssessment(raw, q, m).score, 1);
  assert.equal(
    normalizeAssessment({ ...raw, criteria: [criteria[0]] }, q, m).score,
    null,
  );
  const invalid = normalizeAssessment(
    {
      ...raw,
      criteria: criteria.map((c) => ({
        ...c,
        references: [{ regionId: "someone-else" }],
      })),
    },
    q,
    m,
  );
  assert.equal(invalid.score, null);
  assert.ok(invalid.criteria.every((c) => c.status === "unreadable"));
  assert.equal(
    normalizeAssessment(
      {
        ...raw,
        criteria: [
          criteria[0],
          { ...criteria[1], status: "unreadable", score: 0 },
        ],
      },
      q,
      m,
    ).score,
    null,
  );
});
test("multi-skill statistics deduplicate students, distinguish evidence states and exclude unconfirmed judgments", () => {
  const { e } = fixture();
  let a = assessmentStatistics(e);
  const s = a.skills.find((s) => s.name === "方程");
  assert.equal(s.students.length, 1);
  assert.equal(s.demonstrated.length, 1);
  assert.equal(s.error.length, 1);
  assert.equal(s.events, 2);
  e.evaluations["s1:q1"].criteria[1].status = "blocked";
  e.evaluations["s1:q1"].criteria[1].skillEvidence.forEach(
    (x) => (x.status = "blocked"),
  );
  a = assessmentStatistics(e);
  assert.equal(a.skills.find((s) => s.name === "运算").error.length, 0);
  assert.equal(a.skills.find((s) => s.name === "运算").blocked.length, 1);
  e.evaluations["s1:q1"].criteria[1].accepted = false;
  assert.equal(confirmedEvidence(e).length, 1);
  e.skillAliases = { 建模: "方程" };
  assert.equal(assessmentStatistics(e).skills[0].events, 1);
  assert.equal(analyze(e).average, 1);
});
test("editing grade, rubric, mapping or replacing file invalidates old diagnostics while scores survive", () => {
  const { e } = fixture();
  for (const mutate of [
    (v) => {
      v.grades["s1:q1"].score = 2;
    },
    (v) => {
      v.questions[0].rubricSpec.instructions += "新规则";
    },
    (v) => {
      v.answerMaps["f1:q1"].regions[0].box.h = 0.5;
    },
    (v) => {
      v.attachments.push({ id: "f2", studentId: "s1" });
    },
  ]) {
    const copy = structuredClone(e);
    mutate(copy);
    assert.equal(confirmedEvidence(copy).length, 0);
    assert.equal(assessmentStatistics(copy).staleAnswers, 1);
    assert.equal(copy.grades["s1:q1"].status, "final");
  }
  const next = updateQuestions(e, [{ ...e.questions[0], max: 3 }]);
  assert.equal(next.questions[0].rubricSpec.confirmed, false);
  assert.doesNotThrow(() => validateAssessmentData(next));
});
test("analysis includes only confirmed compact evidence and reports can cite it without invented teacher remarks", () => {
  const { e } = fixture();
  const input = analysisInput(e, "s1"),
    text = JSON.stringify(input);
  assert.ok(!text.includes("敏感完整题干"));
  assert.ok(!text.includes("测试甲"));
  assert.ok(!text.includes("r1"));
  assert.ok(!text.includes("x=2"));
  assert.equal(input.assessment.confirmedEvents, 2);
  const skill = input.assessment.skills.find((s) => s.name === "运算"),
    ref = skill.examples[0].evidenceRef;
  const candidate = {
    title: "建议",
    observation: "错误的模型统计888",
    evidence: ["q1"],
    remarkRefs: [],
    assessmentRefs: [ref],
    skillName: skill.name,
    certainty: "recorded",
    action: "先逐行检查移项符号，再独立解一题",
    check: "独立说明每一步等价变形",
  };
  const report = constrainedReport(
    { findings: [candidate] },
    input,
    validateReport,
  );
  assert.equal(report.findings.length, 1);
  assert.ok(!report.findings[0].observation.includes("888"));
  assert.ok(report.findings[0].recordedNotes[0].note.includes("移项符号错误"));
  assert.throws(() =>
    validateReport(
      { summary: "", findings: [{ ...candidate, assessmentRefs: ["fake"] }] },
      input,
    ),
  );
  const before = snapshotHash(input);
  e.evaluations["s1:q1"].criteria[1].accepted = false;
  assert.notEqual(snapshotHash(analysisInput(e, "s1")), before);
});
test("assessment preparation binds every crop to latest student file and confirmed rubric", () => {
  const { e } = fixture();
  const p = {
    studentId: "s1",
    questionId: "q1",
    images: ["data:image/png;base64,AA==", "data:image/png;base64,AA=="],
    sources: [
      { fileId: "f1", page: 1, regionId: "r1" },
      { fileId: "f1", page: 2, regionId: "r2" },
    ],
  };
  assert.ok(prepareAssessment(e, "assess", p).inputHash);
  assert.throws(
    () => prepareAssessment(e, "assess", { ...p, studentId: "s2" }),
    /不属于/,
  );
  assert.throws(
    () =>
      prepareAssessment(e, "assess", { ...p, sources: p.sources.slice(0, 1) }),
    /对应/,
  );
  assert.throws(() => prepareAssessment(e, "rubric", p), /学生/);
  e.questions[0].rubricSpec.confirmed = false;
  assert.throws(() => prepareAssessment(e, "assess", p), /确认/);
});
test("a scored criterion does not imply all associated skills were demonstrated or wrong", () => {
  const { e, q, m, criteria } = fixture();
  const raw = normalizeAssessment(
    { criteria: criteria.map((c) => ({ ...c, skillEvidence: [] })) },
    q,
    m,
  );
  assert.equal(raw.score, 1);
  assert.ok(
    raw.criteria.every((c) =>
      c.skillEvidence.every((s) => s.status === "not_observed"),
    ),
  );
  e.evaluations["s1:q1"].criteria = raw.criteria.map((c) => ({
    ...c,
    accepted: true,
  }));
  assert.ok(
    assessmentStatistics(e).skills.every(
      (s) =>
        !s.error.length && !s.demonstrated.length && s.unknown.length === 1,
    ),
  );
});
test("fault injection only: completed criterion batches survive interruption and are not re-requested", async () => {
  const { q, m } = fixture();
  q.max = 5;
  q.rubricSpec.criteria = Array.from({ length: 5 }, (_, i) => ({
    ...q.rubricSpec.criteria[0],
    id: "batch-" + i,
    part: "A",
    points: 1,
  }));
  let task = {
      id: "batch-task",
      kind: "assess",
      payload: {
        question: q,
        mapping: m,
        sources: m.regions.map((r) => ({ page: r.page, regionId: r.id })),
        images: ["data:image/png;base64,AA=="],
        inputHash: "same-input",
      },
    },
    failSecond = true;
  const requests = [];
  const manager = {
    store: {
      get: () => structuredClone(task),
      put: (_, t) => {
        task = t;
      },
    },
    request: async (t, messages) => {
      const c = JSON.parse(messages[1].content[0].text);
      requests.push(c.rubric.criteria.map((x) => x.id));
      if (requests.length === 2 && failSecond)
        throw Error("deliberate connection failure");
      return {
        text: JSON.stringify({
          coverage: "complete",
          criteria: c.rubric.criteria.map((x) => ({
            criterionId: x.id,
            status: "demonstrated",
            score: 1,
            references: [{ regionId: "r1" }],
            skillEvidence: x.skills.map((skill) => ({
              skill,
              status: "demonstrated",
              comment: "test only",
            })),
          })),
        }),
        usage: { input: 10, output: 20 },
      };
    },
  };
  await assert.rejects(
    () => runAssessment(manager, task, new AbortController().signal),
    /deliberate/,
  );
  assert.equal(task.progress.done, 1);
  assert.equal(task.payload.resumeAssessmentBatches.length, 1);
  failSecond = false;
  const result = await runAssessment(
    manager,
    task,
    new AbortController().signal,
  );
  assert.equal(result.result.score, 5);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[1], requests[2]);
  assert.notDeepEqual(requests[0], requests[2]);
  assert.equal(result.usage.input, 20);
});
test("real local HTTP review keeps teacher score, requires coverage, rejects stale edits and roundtrips evidence backup", async (t) => {
  const root = path.resolve("output/tests");
  fs.mkdirSync(root, { recursive: true });
  const app = createApp({
    dataDir: fs.mkdtempSync(path.join(root, "assessment-")),
  });
  const server = app.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    app.ai.close();
    server.close();
    app.store.close();
  });
  const { e, q, m, criteria } = fixture();
  app.store.put("exams", e);
  const task = {
    id: "t1",
    kind: "assess",
    examId: e.id,
    status: "succeeded",
    payload: {
      questionId: q.id,
      studentId: "s1",
      mapping: m,
      mappingHash: mappingHash(m),
      rubricHash: rubricHash(q),
    },
    result: { score: 1, criteria },
  };
  app.store.put("tasks", task);
  const call = async (route, body, method = "POST") => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api${route}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Zhiheng-Client": "desktop",
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return { status: r.status, value: await r.json() };
  };
  const body = {
    criteria,
    scoreAction: "keep",
    score: 0,
    expectedGradeHash: gradeHash(e.grades["s1:q1"]),
    coverageConfirmed: false,
  };
  assert.equal((await call("/tasks/t1/review-assessment", body)).status, 400);
  body.coverageConfirmed = true;
  let response = await call("/tasks/t1/review-assessment", body);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal(response.value.grades["s1:q1"].score, 1);
  assert.equal(response.value.grades["s1:q1"].source, "teacher");
  assert.equal(response.value.analysis.assessment.confirmedEvents, 2);
  body.criteria = criteria.map((c) => ({ ...c, score: 0 }));
  assert.equal((await call("/tasks/t1/review-assessment", body)).status, 400);
  body.diagnosticOnly = true;
  response = await call("/tasks/t1/review-assessment", body);
  assert.equal(response.status, 200);
  assert.ok(
    response.value.evaluations["s1:q1"].criteria.every((c) => c.score === null),
  );
  body.expectedGradeHash = "stale";
  assert.equal((await call("/tasks/t1/review-assessment", body)).status, 409);
  const stored = app.store.get("exams", e.id);
  assert.doesNotThrow(() => validateAssessmentData(stored));
  assert.equal(
    assessmentStatistics(JSON.parse(JSON.stringify(stored))).confirmedEvents,
    2,
  );
  const missing = await call(
    `/exams/${e.id}/assessment?studentId=unknown`,
    undefined,
    "GET",
  );
  assert.equal(missing.status, 400);
  const broad = structuredClone(q.rubricSpec);
  broad.criteria = Array.from({ length: 30 }, (_, i) => ({
    id: "many-" + i,
    part: "",
    label: "评分点" + i,
    points: null,
    skills: ["独立技能" + i],
    expected: "",
    alternatives: "",
  }));
  response = await call(
    `/exams/${e.id}/rubric/${q.id}`,
    { spec: broad, expectedHash: rubricHash(q), acknowledgeImpact: true },
    "PUT",
  );
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal(response.value.questions[0].rubricSpec.criteria.length, 30);
  assert.equal(response.value.questions[0].related.length, 0);
  assert.equal(response.value.analysis.assessment.staleAnswers, 1);
});

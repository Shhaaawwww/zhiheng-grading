import test from "node:test";
import assert from "node:assert/strict";
import {
  Question,
  validateQuestions,
  validateGrade,
  updateGrades,
  updateQuestions,
  analyze,
  analysisInput,
  keyOf,
} from "../server/domain.mjs";
import {
  parseDelimited,
  readSheet,
  previewGrades,
  previewRoster,
  workbook,
} from "../server/imports.mjs";
import { validateReport } from "../server/ai.mjs";
import ExcelJS from "exceljs";
const question = (id, max, primary = "函数性质") =>
  Question.parse({ id, label: id, max, primary, confirmed: true });
const make = () => ({
  id: "exam",
  name: "测试",
  revision: 1,
  questions: [question("q1", 5), question("q2", 10)],
  students: [
    { id: "a", name: "甲", number: "001" },
    { id: "b", name: "乙", number: "002" },
    { id: "c", name: "丙", number: "003" },
  ],
  grades: {},
  attachments: [],
});
const grade = (s, q, score, status = "final", extra = {}) => ({
  studentId: s,
  questionId: q,
  score,
  status,
  note: "",
  tags: [],
  source: "teacher",
  ...extra,
});

test("English roster and score headers preserve identifiers, blanks and identity checks", () => {
  const roster = previewRoster([], [['STUDENT ID', 'Name'], ['0007', 'Test Student']]);
  assert.equal(roster.errors.length, 0);
  assert.equal(roster.students[0].number, '0007');
  const e = make();
  const imported = previewGrades(e, [['Student ID', 'NAME', 'Q1', 'Q2'], ['001', '甲', '0', ''], ['002', '乙', '5', '10']]);
  assert.equal(imported.errors.length, 0);
  assert.equal(imported.changes.length, 3);
  assert.equal(imported.changes.find(g => g.studentId === 'a').score, 0);
  assert.ok(!imported.changes.some(g => g.studentId === 'a' && g.questionId === 'q2'));
  const wrongName = previewGrades(e, [['Student Number', 'Student Name', 'Q1'], ['001', '乙', '5']]);
  assert.equal(wrongName.changes.length, 0);
  assert.match(wrongName.errors[0].message, /姓名/);
  assert.throws(() => previewGrades(e, [['Student ID', 'Name', 'Unknown Column'], ['001', '甲', '5']]), /题号/);
});
test("zero is valid; missing, draft, absence and NA do not enter completed totals", () => {
  let e = make();
  e = updateGrades(e, [
    grade("a", "q1", 0),
    grade("a", "q2", 10),
    grade("b", "q1", 5),
    grade("b", "q2", 7, "draft"),
    grade("c", "q1", null, "absent"),
    grade("c", "q2", null, "absent"),
  ]);
  const a = analyze(e);
  assert.equal(a.complete, 1);
  assert.equal(a.absent, 1);
  assert.equal(a.pending, 1);
  assert.equal(a.average, 10);
  assert.equal(a.questions[0].n, 2);
  assert.equal(a.questions[0].average, 2.5);
  assert.equal(a.questions[0].zero, 1);
  assert.equal(a.students[1].total, null);
  assert.equal(a.topics[0].n, 1);
  assert.equal(a.topics[0].rate, 66.67);
  e = updateGrades(e, [grade("a", "q2", null, "na")]);
  assert.equal(analyze(e).average, null);
});
test("only confirmed primary knowledge contributes; composite parents never double count", () => {
  const e = make();
  e.questions = [
    Question.parse({ id: "p", label: "9", max: 15, type: "group" }),
    { ...question("q1", 5), parentId: "p", related: ["数列"] },
    { ...question("q2", 10), parentId: "p", confirmed: false },
  ];
  validateQuestions(e.questions);
  const a = analyze(
    updateGrades(e, [grade("a", "q1", 5), grade("a", "q2", 5)]),
  );
  assert.equal(a.max, 15);
  assert.equal(a.topics.length, 1);
  assert.equal(a.topics[0].max, 5);
  assert.equal(a.topics[0].rate, 100);
  assert.equal(a.questions.length, 2);
  assert.throws(() => validateGrade(e, grade("a", "p", 10)));
});
test("score range, step, status and question hierarchy are validated", () => {
  const e = make();
  for (const g of [
    grade("a", "q1", 6),
    grade("a", "q1", -1),
    grade("a", "q1", 0.3),
    grade("a", "q1", null),
    grade("a", "q1", 2, "absent"),
    grade("unknown", "q1", 0),
  ])
    assert.throws(() => validateGrade(e, g));
  assert.throws(() =>
    validateQuestions([question("q1", 5), question("q1", 10)]),
  );
  assert.throws(() =>
    validateQuestions([
      { ...question("x", 5), parentId: "y" },
      { ...question("y", 5), parentId: "x" },
    ]),
  );
  assert.throws(() =>
    validateQuestions([
      { ...question("x", 5), type: "group" },
      { ...question("y", 10), parentId: "x" },
    ]),
  );
});
test("a grade batch fails atomically and scored questions cannot disappear", () => {
  const e = make();
  assert.throws(() =>
    updateGrades(e, [grade("a", "q1", 5), grade("b", "q2", 11)]),
  );
  assert.equal(Object.keys(e.grades).length, 0);
  const next = updateGrades(e, [grade("a", "q1", 5)]);
  assert.throws(() => updateQuestions(next, [question("q2", 10)]));
  assert.throws(() =>
    updateQuestions(next, [question("q1", 3), question("q2", 10)]),
  );
  const cleared = updateGrades(next, [grade("a", "q1", null, "ungraded")]);
  assert.equal(
    Object.keys(updateQuestions(cleared, [question("q2", 10)]).grades).length,
    0,
  );
});
test("remarks distinguish unique students, question occurrences and annotated lost cases", () => {
  const e = updateGrades(make(), [
    grade("a", "q1", 0, "final", { tags: ["运算错误"], note: "计算有误" }),
    grade("a", "q2", 5, "final", { tags: ["运算错误"] }),
    grade("b", "q1", 0),
    grade("b", "q2", 10, "final", { note: "解法简洁" }),
  ]);
  const a = analyze(e);
  assert.equal(a.remarks[0].students.length, 1);
  assert.equal(a.remarks[0].occurrences, 2);
  assert.equal(a.questions[0].lost, 2);
  assert.equal(a.questions[0].annotatedLost, 1);
  assert.equal(a.questions[1].annotated, 2);
  assert.equal(a.questions[1].annotatedLost, 1);
});
test("AI analysis input excludes handwriting, identities, draft scores and detailed grader reasoning", () => {
  const e = updateGrades(make(), [
    grade("a", "q1", 0, "final", { note: "仅此条备注" }),
    grade("a", "q2", 7, "draft"),
  ]);
  e.attachments = [{ name: "RAW-HANDWRITING-SECRET" }];
  e.rawAi = "GRADER-REASONING-SECRET";
  const input = analysisInput(e, "a"),
    json = JSON.stringify(input);
  assert.equal(input.finalResults.length, 1);
  assert.equal(input.finalResults[0].student, "S001");
  assert.equal(input.finalResults[0].grades.length, 1);
  for (const forbidden of [
    "甲",
    "乙",
    "丙",
    "RAW-HANDWRITING-SECRET",
    "GRADER-REASONING-SECRET",
    "updatedAt",
  ])
    assert.ok(!json.includes(forbidden));
  assert.ok(json.includes("仅此条备注"));
});
test("AI report rejects nonexistent evidence and unsupported definite causes", () => {
  const input = analysisInput(
    updateGrades(make(), [grade("a", "q1", 0, "final", { note: "计算有误" })]),
  );
  const base = {
    summary: "回看本次题目",
    findings: [
      {
        title: "建议",
        observation: "复核",
        evidence: ["q1"],
        action: "复习",
        check: "短题",
        certainty: "hypothesis",
      },
    ],
  };
  assert.equal(validateReport(base, input).findings.length, 1);
  assert.throws(() =>
    validateReport(
      { ...base, findings: [{ ...base.findings[0], evidence: ["invented"] }] },
      input,
    ),
  );
  assert.throws(() =>
    validateReport(
      { ...base, findings: [{ ...base.findings[0], certainty: "recorded" }] },
      input,
    ),
  );
  assert.throws(() =>
    validateReport(
      { ...base, findings: [{ ...base.findings[0], remarkRefs: ["S003:q1"] }] },
      input,
    ),
  );
  assert.equal(
    validateReport(
      {
        ...base,
        findings: [
          {
            ...base.findings[0],
            certainty: "recorded",
            remarkRefs: ["S001:q1"],
          },
        ],
      },
      input,
    ).findings[0].certainty,
    "recorded",
  );
});
test("CSV supports BOM, quoted commas, multiline comments and rejects broken quoting", () => {
  assert.deepEqual(
    parseDelimited('\uFEFF学号,备注\r\n001,"hello, world\nnext"\r\n'),
    [
      ["学号", "备注"],
      ["001", "hello, world\nnext"],
    ],
  );
  assert.throws(() => parseDelimited('a,b\n1,"oops'));
});
test("import preview preserves blanks and notes, counts conflicts, blocks duplicate rows and unknown columns", () => {
  const e = updateGrades(make(), [
    grade("a", "q1", 5, "final", { note: "保留备注" }),
  ]);
  const p = previewGrades(e, [
    ["学号", "姓名", "q1", "q2"],
    ["001", "甲", "0", ""],
    ["002", "乙", "", "10"],
  ]);
  assert.equal(p.errors.length, 0);
  assert.equal(p.conflicts, 1);
  assert.equal(p.changes.length, 2);
  assert.equal(p.changes[0].score, 0);
  assert.equal(p.changes[0].note, "保留备注");
  assert.ok(
    previewGrades(e, [
      ["学号", "q1"],
      ["001", "0"],
      ["001", "4"],
    ]).errors.length,
  );
  assert.ok(
    previewGrades(e, [
      ["学号", "q1", "不存在"],
      ["001", "0", "1"],
    ]).errors.length,
  );
  assert.ok(
    previewGrades(e, [
      ["学号", "姓名", "q1"],
      ["001", "乙", "0"],
    ]).errors.length,
  );
  assert.ok(
    previewGrades(e, [
      ["学号", "题号", "得分", "状态"],
      ["001", "q1", "5", "缺考"],
    ]).errors.length,
  );
});
test("Excel roundtrip retains leading zero student numbers, zero and absence; roster template works", async () => {
  const e = updateGrades(make(), [
    grade("a", "q1", 0),
    grade("b", "q2", null, "absent"),
  ]);
  const bytes = await workbook(e, "long"),
    rows = await readSheet("grades.xlsx", bytes.toString("base64"));
  assert.equal(rows[1][0], "001");
  assert.equal(rows[1][3], "0");
  assert.equal(previewGrades(e, rows).errors.length, 0);
  const roster = await workbook({ students: e.students }, "roster");
  assert.equal(
    (await readSheet("roster.xlsx", roster.toString("base64"))).length,
    4,
  );
});
test("formulas and conflicting roster identities cannot silently enter scores", async () => {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet("s");
  s.addRow(["学号", "q1"]);
  s.addRow(["001", { formula: "1+1", result: 2 }]);
  const b = await w.xlsx.writeBuffer();
  await assert.rejects(
    () => readSheet("formula.xlsx", Buffer.from(b).toString("base64")),
    /公式/,
  );
  assert.equal(
    previewRoster(make().students, [
      ["学号", "姓名"],
      ["001", "错误姓名"],
    ]).errors.length,
    1,
  );
});

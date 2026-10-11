// Independent arithmetic and export checks over saved real API evidence; no model calls.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
const root = path.resolve("output/real-api/release-030"),
  chinese = path.resolve("output/real-api/release-030-chinese");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8")),
  round = (n) => Math.round(n * 100) / 100;
const cases = read(path.join(root, "fixtures.json"));
const metrics = {
  samples: 0,
  exactTotals: 0,
  wrongTotals: 0,
  abstainedTotals: 0,
  absoluteTotalError: 0,
  points: 0,
  exactPoints: 0,
  wrongPoints: 0,
  abstainedPoints: 0,
  cases: [],
};
const teacher = { answers: 0, acceptedCriteria: 0, reports: 0, excelCells: 0 },
  variants = [];
for (const c of cases) {
  const raw = read(path.join(root, c.id, "round2-batched-grading.json")),
    final = read(path.join(root, c.id, "teacher-confirmed-exam.json")),
    q = final.questions[0];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(root, c.id, "教师确认录分表.xlsx"));
  assert.equal(wb.worksheets[0].rowCount, 4);
  for (const [i, s] of raw.exam.students.entries()) {
    const t = raw.tasks.find(
      (t) => t.target.studentId === s.id && t.status === "succeeded",
    );
    assert.ok(t);
    const result = t.result,
      expected = c.expectedTotals[i];
    metrics.samples++;
    if (result.score == null) metrics.abstainedTotals++;
    else if (result.score === expected) metrics.exactTotals++;
    else {
      metrics.wrongTotals++;
      metrics.absoluteTotalError += Math.abs(result.score - expected);
    }
    assert.equal(result.criteria.length, c.points[i].length);
    result.criteria.forEach((p, j) => {
      metrics.points++;
      if (p.score == null) metrics.abstainedPoints++;
      else if (p.score === c.points[i][j]) metrics.exactPoints++;
      else metrics.wrongPoints++;
    });
    metrics.cases.push({
      case: c.id,
      sample: s.name,
      modelScore: result.score,
      officialScore: expected,
      pointScores: result.criteria.map((p) => p.score),
    });
    assert.equal(final.grades[`${s.id}:${q.id}`].score, expected);
    teacher.answers++;
    teacher.acceptedCriteria += final.evaluations[
      `${s.id}:${q.id}`
    ].criteria.filter((e) => e.accepted).length;
    assert.equal(wb.worksheets[0].getRow(i + 2).getCell(3).value, expected);
    teacher.excelCells++;
  }
  assert.equal(
    final.analysis.average,
    round(c.expectedTotals.reduce((a, b) => a + b, 0) / 3),
  );
  for (const f of fs
    .readdirSync(path.join(root, c.id))
    .filter((f) => /^report-.*\.json$/.test(f))) {
    const r = read(path.join(root, c.id, f));
    assert.equal(r.snapshot.reportContract, "skill-reference-2");
    assert.equal(r.stale, false);
    teacher.reports++;
    assert.ok(
      r.snapshot.questions.every(
        (q) => !("stem" in q) && !("answer" in q) && !("rubricSpec" in q),
      ),
    );
    for (const finding of r.content.findings) {
      for (const ref of finding.assessmentRefs) {
        const e = r.snapshot.assessment.skills
          .find((s) => s.name === finding.skillName)
          ?.examples.find((e) => e.evidenceRef === ref);
        assert.ok(e);
        assert.ok(
          finding.recordedNotes.some(
            (n) => n.ref === ref && n.note.includes(e.comment),
          ),
        );
      }
      if (finding.skillName) {
        const s = r.snapshot.assessment.skills.find(
          (s) => s.name === finding.skillName,
        );
        assert.ok(
          finding.observation.includes(`有明确错误 ${s.errorStudents} 人`),
        );
      }
    }
  }
  for (const name of fs
    .readdirSync(path.join(root, c.id))
    .filter((f) =>
      /^round4-(degraded|rotated|missing-page|rotation-teacher-repaired)-B\.json$/.test(
        f,
      ),
    )) {
    const v = read(path.join(root, c.id, name));
    assert.equal(v.finalGrade.score, c.expectedTotals[1]);
    assert.ok(v.statistics.staleAnswers >= 1);
    variants.push({
      case: c.id,
      variant: name,
      status: v.task?.status,
      score: v.task?.result?.score,
      officialCompleteScore: c.expectedTotals[1],
      unreadable: v.task?.result?.criteria.filter(
        (c) => c.status === "unreadable",
      ).length,
      warnings: v.task?.result?.warnings,
      teacherGradePreserved: true,
    });
  }
}
assert.equal(teacher.reports, 9);
const chineseChecks = { cells: 0, reports: 0, cases: [] };
for (const c of read(path.join(chinese, "cases.json"))) {
  const dir = path.join(chinese, c.caseId),
    e = read(path.join(dir, "exam-final.json")),
    scores = read(path.join(dir, "teacher-score-fixture.json")),
    totals = [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, "录分表.xlsx"));
  assert.equal(wb.worksheets[0].rowCount, 41);
  for (const [i, s] of e.students.entries()) {
    let sum = 0,
      complete = true;
    for (const [j, label] of scores.questionLabels.entries()) {
      const q = e.questions.find((q) => q.label === label),
        g = e.grades[`${s.id}:${q.id}`],
        value = scores.students[i].scores[j];
      chineseChecks.cells++;
      if (value === "") {
        assert.ok(!g || g.status === "ungraded");
        complete = false;
      } else if (value === "缺考") {
        assert.equal(g.status, "absent");
        complete = false;
      } else {
        assert.equal(g.score, Number(value));
        sum += Number(value);
      }
      assert.equal(
        wb.worksheets[0].getRow(i + 2).getCell(j + 3).value,
        value === "" ? null : value === "缺考" ? "缺考" : Number(value),
      );
    }
    if (complete) totals.push(sum);
    assert.equal(
      e.analysis.students.find((x) => x.id === s.id).total,
      complete ? sum : null,
    );
  }
  assert.equal(
    e.analysis.average,
    round(totals.reduce((a, b) => a + b, 0) / totals.length),
  );
  for (const q of e.questions.filter((q) => q.type !== "group")) {
    const g = e.students
        .map((s) => e.grades[`${s.id}:${q.id}`])
        .filter((x) => x?.status === "final"),
      actual = e.analysis.questions.find((x) => x.id === q.id);
    assert.equal(
      actual.rate,
      round((g.reduce((n, x) => n + x.score, 0) / (g.length * q.max)) * 100),
    );
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^report-(?!task).*\.json$/.test(f));
  chineseChecks.reports += files.length;
  const extraction = read(path.join(dir, "extraction.json"));
  chineseChecks.cases.push({
    case: c.caseId,
    questions: extraction.result.questions.length,
    rawPrintedMaxima: extraction.result.questions.map((q) => q.max),
    corrections: read(path.join(dir, "teacher-corrections.json")),
    average: e.analysis.average,
    complete: e.analysis.complete,
    pending: e.analysis.pending,
    absent: e.analysis.absent,
  });
}
const cost = {
  calls: 0,
  known: 0,
  unknown: 0,
  input: 0,
  output: 0,
  cached: 0,
  usd: 0,
  truncated: 0,
  malformedFinalJson: 0,
  byPhase: {},
};
for (const dir of [
  root,
  chinese,
  path.resolve("output/real-api/release-030-answerless"),
  path.resolve("output/real-api/release-030-coverage"),
])
  for (const name of fs.readdirSync(path.join(dir, "network"))) {
    const log = read(path.join(dir, "network", name)),
      u = log.response?.usage;
    cost.calls++;
    if (
      !u ||
      !Number.isFinite(u.prompt_tokens) ||
      !Number.isFinite(u.completion_tokens)
    ) {
      cost.unknown++;
      continue;
    }
    cost.known++;
    const date = new Date(log.startedAt),
      h = date.getUTCHours(),
      peak =
        date.getUTCDay() > 0 &&
        date.getUTCDay() < 6 &&
        ((h >= 1 && h < 4) || (h >= 6 && h < 10));
    const input = u.prompt_tokens,
      output = u.completion_tokens,
      hit = u.prompt_cache_hit_tokens || 0,
      usd =
        (((input - hit) * 0.22 + hit * 0.007 + output * 0.66) / 1e6) *
        (peak ? 2 : 1);
    const system = log.request.messages[0].content,
      content = log.request.messages[1].content;
    const kind =
      typeof content === "string"
        ? "report"
        : system.includes("你负责把原始页面")
          ? "locate"
          : system.includes("整理这一道题")
            ? "rubric"
            : system.includes("依据教师确认的标准批阅")
              ? "assess"
              : "extract";
    const phase =
      (dir === root
        ? "handwriting"
        : dir === chinese
          ? "chinese"
          : dir.endsWith("coverage")
            ? "coverage-repair"
            : "answerless") +
      "/" +
      kind +
      (kind === "assess"
        ? log.request.thinking?.type === "disabled"
          ? "/fast"
          : "/normal"
        : "");
    const p = (cost.byPhase[phase] ||= {
      calls: 0,
      input: 0,
      output: 0,
      usd: 0,
      seconds: 0,
    });
    p.calls++;
    p.input += input;
    p.output += output;
    p.usd += usd;
    p.seconds += log.elapsedMs / 1000;
    cost.input += input;
    cost.output += output;
    cost.cached += hit;
    cost.usd += usd;
    if (log.response.choices?.[0]?.finish_reason === "length") cost.truncated++;
    try {
      JSON.parse(
        log.response.choices[0].message.content
          .replace(/^```(?:json)?\s*/, "")
          .replace(/\s*```$/, ""),
      );
    } catch {
      cost.malformedFinalJson++;
    }
    if (kind === "report") {
      const payload = JSON.parse(content);
      assert.ok(
        payload.questions.every((q) => !("stem" in q) && !("answer" in q)),
      );
      assert.ok(!content.includes("image_url"));
      assert.ok(!content.includes("公开样例A"));
    }
  }
const result = {
  ok: true,
  model: "deepseek-v4-flash-vision-exp",
  provider: "https://api.deepseek.com",
  metrics,
  teacher,
  chineseChecks,
  variants,
  coverageRepair: (() => {
    const d = read(
      path.resolve(
        "output/real-api/release-030-coverage/ap24-q6/round4-missing-page-B.json",
      ),
    );
    assert.equal(d.task.result.score, null);
    assert.equal(d.task.result.coverage, "incomplete");
    assert.equal(d.finalGrade.score, 6);
    return {
      ok: true,
      score: d.task.result.score,
      coverage: d.task.result.coverage,
      teacherGradePreserved: d.finalGrade.score,
      pointScores: d.task.result.criteria.map((c) => c.score),
    };
  })(),
  cost,
  pricingSource: "https://api-docs.deepseek.com/quick_start/pricing/",
  costBasis:
    "Official returned tokens and request time; estimated USD, not a provider bill. Failed requests included when usage is available.",
  scope:
    "9 independent official handwritten responses from 3 AP calculus questions; variants reuse B. Chinese public papers have synthetic classroom scores, not handwriting labels.",
};
fs.writeFileSync(
  path.join(root, "verification.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));

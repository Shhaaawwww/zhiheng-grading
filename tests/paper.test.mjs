import test from "node:test";
import assert from "node:assert/strict";
import { normalizePaper, acceptPaper } from "../server/paper.mjs";
import {
  updateQuestions,
  updateGrades,
  analyze,
  keyOf,
} from "../server/domain.mjs";
const q = (label, max, extra = {}) => ({
  label,
  max,
  stem: "求函数单调区间",
  primary: "导数与单调性",
  type: "solve",
  ...extra,
});
test("whole-paper proposals preserve unknown marks and permit a recoverable template", () => {
  const result = normalizePaper(
    { questions: [q("1", null)], pagesReviewed: [1] },
    [1],
  );
  assert.equal(result.questions[0].max, null);
  assert.equal(acceptPaper(result, { questions: result.questions })[0].max, null);
  const accepted = acceptPaper(result, {
    questions: result.questions.map((q) => ({ ...q, max: 5 })),
  });
  assert.equal(accepted[0].confirmed, true);
  assert.equal(acceptPaper(result, { questions: accepted.map(q => ({ ...q, primary: "" })) })[0].confirmed, false);
});
test("only printed subpart allocations become separate scoring units, preserving shared conditions", () => {
  const result = normalizePaper(
    {
      questions: [
        q("19", 12, { type: "group" }),
        q("19(1)", null, { parentLabel: "19" }),
        q("19(2)", null, { parentLabel: "19", page: 2 }),
      ],
      pagesReviewed: [1, 2],
      paperMax: 12,
    },
    [1, 2],
  );
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].max, 12);
  assert.match(result.questions[0].stem, /19\(2\)/);
  assert.equal(result.questions[0].type, "solve");
  assert.match(result.warnings.join(), /整题/);
  const split = normalizePaper(
    {
      questions: [
        q("19", 12, { type: "group" }),
        q("19(1)", 5, { parentLabel: "19" }),
        q("19(2)", 7, { parentLabel: "19", page: 2 }),
      ],
      pagesReviewed: [1, 2],
      paperMax: 12,
    },
    [1, 2],
  );
  const accepted = acceptPaper(split, { questions: split.questions });
  const exam = {
    id: "e",
    name: "测试",
    revision: 1,
    questions: accepted,
    students: [{ id: "s", name: "测试", number: "001" }],
    attachments: [],
    grades: {},
  };
  const next = updateGrades(
    exam,
    accepted
      .filter((q) => q.type !== "group")
      .map((q) => ({
        studentId: "s",
        questionId: q.id,
        score: q.max,
        status: "final",
        source: "teacher",
      })),
  );
  assert.equal(analyze(next).max, 12);
  assert.equal(analyze(next).average, 12);
  assert.equal(analyze(next).topics[0].rate, 100);
});
test("whole-paper total mismatch needs explicit acknowledgement and scored questions are protected", () => {
  const result = normalizePaper(
    { questions: [q("1", 5)], paperMax: 10, pagesReviewed: [1] },
    [1],
  );
  assert.throws(
    () => acceptPaper(result, { questions: result.questions }),
    /总分/,
  );
  const accepted = acceptPaper(result, {
    questions: result.questions,
    allowTotalMismatch: true,
  });
  const exam = {
    id: "e",
    revision: 1,
    questions: accepted,
    students: [{ id: "s", name: "测试", number: "001" }],
    attachments: [],
    grades: {},
  };
  const scored = updateGrades(exam, [
    {
      studentId: "s",
      questionId: accepted[0].id,
      score: 0,
      status: "final",
      source: "teacher",
    },
  ]);
  assert.equal(scored.grades[keyOf("s", accepted[0].id)].score, 0);
  const newResult = normalizePaper({ questions: [q("1", 5)] }, [1]);
  assert.throws(() =>
    updateQuestions(
      scored,
      acceptPaper(newResult, { questions: newResult.questions }),
    ),
  );
});
test("malformed hierarchy, duplicate labels and invalid pages fail; absent coverage creates a warning", () => {
  assert.throws(
    () => normalizePaper({ questions: [q("1", 5), q("1", 5)] }, [1]),
    /重复/,
  );
  assert.throws(
    () => normalizePaper({ questions: [q("1", 5, { page: 2 })] }, [1]),
    /页码/,
  );
  assert.throws(
    () =>
      normalizePaper(
        {
          questions: [
            q("1", 5, { parentLabel: "2" }),
            q("2", 5, { parentLabel: "1" }),
          ],
        },
        [1],
      ),
    /循环/,
  );
  assert.throws(
    () => normalizePaper({ questions: [q("1", 5, { parentLabel: "2" })] }, [1]),
    /所属/,
  );
  const incomplete = normalizePaper(
    { questions: [q("1", 5)], pagesReviewed: [1] },
    [1, 2, 3],
  );
  assert.match(incomplete.warnings.join(), /逐页覆盖/);
});

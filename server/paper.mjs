import { z } from "zod";
import { Question, fail, id, validateQuestions } from "./domain.mjs";

const Proposal = Question.extend({
  max: z.number().positive().max(1000).nullable(),
  reviewNote: z.string().max(1500).default(""),
});

export function normalizePaper(raw, pages) {
  const parsed = z
    .object({
      questions: z
        .array(
          z
            .object({
              label: z.string().trim().min(1).max(40),
              parentLabel: z.string().trim().nullable().optional(),
            })
            .passthrough(),
        )
        .min(1)
        .max(200),
      paperMax: z.number().positive().max(10000).nullable().optional(),
      warnings: z.array(z.string().max(1000)).max(30).default([]),
      pagesReviewed: z.array(z.number().int().positive()).optional(),
    })
    .parse(raw);
  const labels = parsed.questions.map((q) => q.label);
  if (new Set(labels).size !== labels.length)
    fail("识别结果出现重复题号，请重新识别，原题目未改动。");
  const ids = new Map(labels.map((label) => [label, id()]));
  let questions = parsed.questions.map((q) => {
    if (q.parentLabel && !ids.has(q.parentLabel))
      fail(`第 ${q.label} 题缺少所属大题，请重新识别完整试卷。`);
    const imageIndex = q.page ?? 1;
    if (
      !Number.isInteger(imageIndex) ||
      imageIndex < 1 ||
      imageIndex > pages.length
    )
      fail(`第 ${q.label} 题的来源页码无效，请重新识别。`);
    return Proposal.parse({
      ...q,
      id: ids.get(q.label),
      parentId: q.parentLabel ? ids.get(q.parentLabel) : null,
      page: pages[imageIndex - 1],
      max: q.max ?? null,
      confirmed: false,
    });
  });
  for (const q of questions) {
    const seen = new Set([q.id]);
    let parent = q.parentId;
    while (parent) {
      if (seen.has(parent)) fail("识别结果的小问层级有循环，请重新识别。");
      seen.add(parent);
      parent = questions.find((x) => x.id === parent)?.parentId;
    }
  }
  const warnings = [...parsed.warnings];
  // A printed total without explicit subpart scores stays one scoring unit.
  // Inventing a distribution across the subparts would distort later analysis.
  for (const parent of [...questions].reverse()) {
    const children = questions.filter((q) => q.parentId === parent.id);
    if (!children.length) continue;
    if (
      parent.max != null &&
      children.some((q) => q.max == null) &&
      children.every((q) => !questions.some((c) => c.parentId === q.id))
    ) {
      const removed = new Set(children.map((q) => q.id));
      questions = questions
        .filter((q) => !removed.has(q.id))
        .map((q) =>
          q.id === parent.id
            ? {
                ...q,
                type: "solve",
                stem: [
                  q.stem,
                  ...children.map((c) => `${c.label} ${c.stem}`),
                ].join("\n"),
                primary:
                  q.primary || children.find((c) => c.primary)?.primary || "",
                related: [
                  ...new Set(
                    [
                      ...q.related,
                      ...children.flatMap((c) => [c.primary, ...c.related]),
                    ].filter((s) => s && s !== q.primary),
                  ),
                ].slice(0, 20),
              }
            : q,
        );
      warnings.push(
        `第 ${parent.label} 题未明确分配小问分值，已保留整题一个录分项，使用整题小分。`,
      );
    }
  }
  for (let i = 0; i < questions.length; i++) {
    questions = questions.map((q) => {
      const children = questions.filter((c) => c.parentId === q.id);
      if (!children.length) return q;
      const sum = children.every((c) => c.max != null)
        ? Math.round(children.reduce((n, c) => n + c.max, 0) * 100) / 100
        : null;
      return { ...q, type: "group", max: q.max ?? sum };
    });
  }
  if (
    !parsed.pagesReviewed ||
    new Set(parsed.pagesReviewed).size !== pages.length ||
    pages.some((_, i) => !parsed.pagesReviewed.includes(i + 1))
  ) {
    warnings.push("模型未完整说明逐页覆盖情况，请重点核对是否有跨页漏题。");
  }
  if (
    !questions.some(
      (q) => q.type !== "group" && !questions.some((c) => c.parentId === q.id),
    )
  )
    fail("没有识别到可以录分的题目，请检查是否选中了试卷题面。");
  return {
    questions,
    paperMax: parsed.paperMax ?? null,
    warnings: [...new Set(warnings)],
    pageCount: pages.length,
    pages,
  };
}

export function acceptPaper(result, input) {
  if (!Array.isArray(input.questions) || !input.questions.length)
    fail("请先查看识别结果，再确认题目。");
  const questions = validateQuestions(
    input.questions.map((q) => ({
      ...q,
      confirmed: q.type !== "group" && !!q.primary?.trim(),
    })),
  );
  const leaves = questions.filter(
    (q) => q.type !== "group" && !questions.some((c) => c.parentId === q.id),
  );
  if (!leaves.length) fail("至少需要一道可以录分的题目。");
  const total = leaves.reduce((n, q) => n + q.max, 0);
  if (
    result.paperMax != null &&
    leaves.every(q => q.max != null) &&
    Math.abs(total - result.paperMax) > 1e-7 &&
    !input.allowTotalMismatch
  ) {
    fail(
      `识别的题目满分合计 ${total} 分，与卷面总分 ${result.paperMax} 分不同。请核对，或明确按当前合计使用。`,
    );
  }
  return questions;
}

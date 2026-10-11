// Teacher UI verification against held-out official scores. This is not model ground truth input.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
export async function reviewWorkflow(ctx, c, eid) {
  const { page, api, btn, out, save, shot } = ctx;
  let exam = await api(`/exams/${eid}`);
  const q = exam.questions[0];
  await btn("AI 阅卷与复核").click();
  const corrections = [];
  const policies = {
    "ap25-q5": [
      [
        {
          index: 0,
          skill: q.rubricSpec.criteria[0].skills[0],
          status: "demonstrated",
          comment: "原图写出位置函数的正确导数，体现本次求导成功。",
        },
      ],
      [
        {
          index: 5,
          skill: "速度与加速度符号关系",
          status: "error",
          comment: "仅以加速度为正说明速率增加，未结合速度符号，理由不足。",
        },
      ],
      [
        {
          index: 0,
          skill: "瞬时速度与位置的关系",
          status: "demonstrated",
          comment:
            "已写出位置函数求导记号；按标准取得该步骤分。后面的乘积缺括号另行核对，不把整个步骤记零。",
        },
        {
          index: 5,
          skill: "速度与加速度符号关系",
          status: "error",
          comment: "只引用加速度为正，未说明速度与加速度同号。",
        },
      ],
    ],
    "ap25-q6": [
      [
        {
          index: 0,
          skill: q.rubricSpec.criteria[0].skills[0],
          status: "demonstrated",
          comment: "原图对曲线方程逐项隐函数求导正确。",
        },
      ],
      [
        {
          index: 6,
          skill: "乘积法则",
          status: "error",
          comment:
            "对乘积求导的两项之间写了乘号，未按加和连接。官方允许一次求导错误取得尝试分，该错误仍需订正。",
        },
      ],
      [
        {
          index: 2,
          skill: "导数值计算",
          status: "error",
          comment: "把算出的分母8作为斜率，未保留分子-2与分式结构。",
        },
      ],
    ],
    "ap24-q6": [
      [
        {
          index: 0,
          skill: q.rubricSpec.criteria[0].skills[0],
          status: "demonstrated",
          comment: "原图用上方曲线减下方曲线建立面积积分，表达式正确。",
        },
      ],
      [
        {
          index: 7,
          skill: "代数等价变形",
          status: "error",
          comment:
            "先用g(x)写出可接受的圆环结构，随后代入g(x)时括号或符号处理错误，表达式不再等价。",
        },
      ],
      [
        {
          index: 2,
          skill: "截面法求体积",
          status: "error",
          comment:
            "直接把g(x)作为体积积分的被积函数，没有构造题目要求的矩形截面积½g(x)²。",
        },
      ],
    ],
  };
  for (const [i, s] of exam.students.entries()) {
    const tasks = await api(`/tasks?examId=${eid}`),
      t = tasks.find(
        (t) =>
          t.kind === "assess" &&
          t.target?.studentId === s.id &&
          t.status === "succeeded",
      );
    assert.ok(t, `${c.id} ${s.name} has no complete real assessment`);
    assert.equal(t.result.criteria.length, 9);
    const row = page
      .getByRole("row")
      .filter({ hasText: `${s.name} · 第 ${q.label} 题` });
    await row
      .getByRole("button", { name: "看原卷并复核", exact: true })
      .click();
    const d = page.getByRole("dialog", { name: /教师复核/ });
    await d.waitFor();
    await d.locator(".evidence-images img").first().waitFor();
    await d.getByRole("button", { name: "展开 AI 建议", exact: true }).click();
    const blocks = d.locator("fieldset");
    assert.equal(await blocks.count(), 9);
    // All official point scores are checked; diagnostic confirmation is intentionally selective.
    for (let j = 0; j < 9; j++) {
      const b = blocks.nth(j);
      if (t.result.criteria[j].status === "unreadable")
        await b
          .getByLabel("本次表现", { exact: true })
          .selectOption(c.points[i][j] ? "demonstrated" : "not_observed");
      const field = b.getByLabel("本评分点得分 / 1", { exact: true });
      await field.fill(String(c.points[i][j]));
      if (t.result.criteria[j].score !== c.points[i][j])
        corrections.push({
          student: s.name,
          criterion: j + 1,
          before: t.result.criteria[j].score,
          after: c.points[i][j],
          basis:
            "Held-out official scoring commentary, read only by teacher/test after model response",
        });
    }
    for (const p of policies[c.id][i]) {
      const b = blocks.nth(p.index),
        def = q.rubricSpec.criteria[p.index];
      if (i === 0 && p.index === 0) {
        const count = await b.getByLabel(/可见原文（可纠正识别）/).count();
        await b
          .getByRole("button", { name: "添加原图依据", exact: true })
          .click();
        assert.equal(
          await b.getByLabel(/可见原文（可纠正识别）/).count(),
          count + 1,
        );
        await b
          .getByLabel(`证据 ${count + 1} 原图区域`, { exact: true })
          .selectOption({ index: 1 });
        await b
          .getByRole("button", { name: `移除证据 ${count + 1}`, exact: true })
          .click();
        assert.equal(
          await b.getByLabel(/可见原文（可纠正识别）/).count(),
          count,
        );
      }
      assert.ok(
        def.skills.includes(p.skill),
        `Review policy skill missing: ${p.skill}`,
      );
      await b
        .getByLabel("具体表现或需核对之处", { exact: true })
        .fill(p.comment);
      await b.getByLabel("本次表现", { exact: true }).selectOption(p.status);
      if ((await b.getByLabel(/可见原文（可纠正识别）/).count()) === 0) {
        await b
          .getByRole("button", { name: "添加原图依据", exact: true })
          .click();
        const mapping = exam.answerMaps[`${t.target.fileId}:${q.id}`],
          sourcePage = p.index >= (c.id === "ap25-q5" ? 5 : 6) ? 2 : 1;
        await b
          .getByLabel("证据 1 原图区域", { exact: true })
          .selectOption(mapping.regions.find((r) => r.page === sourcePage).id);
        await b
          .getByLabel("证据 1 所在位置", { exact: true })
          .fill(`${def.part} 作答区域`);
        await b
          .getByLabel("证据 1 可见原文（可纠正识别）", { exact: true })
          .fill(p.comment);
      }
      if (c.id === "ap25-q6" && i === 1 && p.index === 6) {
        await b
          .getByLabel("证据 1 所在位置", { exact: true })
          .fill("第二页 (d) 求导第一行");
        await b
          .getByLabel("证据 1 可见原文（可纠正识别）", { exact: true })
          .fill(
            "2x dy/dt · y 2 dx/dt + 1/y dy/dt = 0；前两项之间为乘点，并非加号。",
          );
      }
      for (const skill of def.skills) {
        await b
          .getByLabel(`${skill} · 本次证据`, { exact: true })
          .selectOption(skill === p.skill ? p.status : "not_observed");
        await b
          .getByLabel(`${skill} · 依据说明`, { exact: true })
          .fill(
            skill === p.skill
              ? p.comment
              : "该技能本轮未单独确认；不能由此评分点的得失分推断。",
          );
      }
      await b.getByLabel("确认这条表现，用于学情分析", { exact: true }).check();
    }
    if (c.id === "ap25-q5" && i === 2)
      await blocks
        .nth(1)
        .getByLabel("具体表现或需核对之处", { exact: true })
        .fill("代入式缺少必要括号，不能与正确结果等价；问题不是没有化简。");
    await d.getByLabel("最终分数的处理", { exact: true }).selectOption("apply");
    await d
      .getByLabel("最终得分 / 9", { exact: true })
      .fill(String(c.expectedTotals[i]));
    await d
      .getByLabel("已核对题号和学生，作答区域完整（包括续页）", { exact: true })
      .check();
    await shot(`${c.id}-review-${s.number}`);
    await d
      .getByRole("button", { name: "确认本题分数与所选表现", exact: true })
      .click();
    await d.waitFor({ state: "hidden" });
    exam = await api(`/exams/${eid}`);
    assert.equal(exam.grades[`${s.id}:${q.id}`].score, c.expectedTotals[i]);
  }
  save(`${c.id}/teacher-review-corrections.json`, {
    scoreCorrections: corrections,
    diagnostics: policies[c.id],
    scope:
      "Only explicitly checked skill evidence is accepted; other associations remain unknown.",
  });
  exam = await api(`/exams/${eid}`);
  assert.equal(exam.analysis.complete, 3);
  assert.equal(
    exam.analysis.average,
    Math.round((c.expectedTotals.reduce((a, b) => a + b, 0) / 3) * 100) / 100,
  );
  save(`${c.id}/teacher-confirmed-exam.json`, exam);
  await btn("阅卷与录分").click();
  const download = page.waitForEvent("download");
  await btn("导出录分表").click();
  await (await download).saveAs(path.join(out, c.id, "教师确认录分表.xlsx"));
  await btn("班级学情").click();
  await page
    .getByRole("heading", { name: "已核对的逐点表现", exact: true })
    .waitFor();
  await shot(c.id + "-confirmed-class-statistics");
  await btn("个人学情").click();
  await page
    .getByLabel("查看学生", { exact: true })
    .selectOption(exam.students[1].id);
  await shot(c.id + "-confirmed-personal-statistics");
  await btn("教学与复测").click();
  await shot(c.id + "-confirmed-teaching-groups");
  const view = await api(`/exams/${eid}/teaching`);
  assert.ok(view.groups.some((g) => g.cause === "已确认的具体错误"));
  save(`${c.id}/confirmed-teaching-groups.json`, view);
  return exam;
}
export async function reportWorkflow(ctx, c, eid) {
  const { page, api, btn, out, save, shot, waitTask, calls } = ctx;
  const exam = await api(`/exams/${eid}`);
  for (const studentId of [null, exam.students[1].id, exam.students[2].id]) {
    await btn(studentId ? "个人学情" : "班级学情").click();
    if (studentId)
      await page
        .getByLabel("查看学生", { exact: true })
        .selectOption(studentId);
    const pending = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith(`/api/exams/${eid}/tasks`),
    );
    await btn("生成 AI 解读").click();
    const task = await waitTask(eid, (await (await pending).json()).id);
    assert.equal(task.status, "succeeded", task.error);
    const report = await api(`/reports/${task.result.reportId}`);
    assert.equal(report.stale, false);
    assert.ok(report.snapshot.assessment.confirmedEvents > 0);
    assert.ok(
      report.content.findings.length,
      "No evidence-backed action returned",
    );
    for (const f of report.content.findings)
      for (const ref of f.assessmentRefs) {
        const example = report.snapshot.assessment.skills
          .find((s) => s.name === f.skillName)
          .examples.find((x) => x.evidenceRef === ref);
        assert.ok(
          f.recordedNotes.some(
            (n) => n.ref === ref && n.note.includes(example.comment),
          ),
          "Report must quote this skill rather than a sibling skill on the same criterion",
        );
      }
    save(`${c.id}/report-${studentId || "class"}.json`, report);
    const before = calls();
    const cached = await api(`/exams/${eid}/tasks`, {
      kind: "report",
      payload: { studentId },
    });
    assert.equal(cached.id, task.id);
    assert.equal(calls(), before);
    await btn("报告归档").click();
    const name = studentId
      ? exam.students.find((s) => s.id === studentId).name
      : "全班";
    await page
      .locator("tbody tr")
      .filter({ hasText: name + " · 学情报告" })
      .filter({ hasText: "AI 解读" })
      .first()
      .getByRole("button", { name: "查看 / 导出", exact: true })
      .click();
    await page.locator(".report-sheet").waitFor();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      btn("导出 PDF").click(),
    ]);
    await popup.waitForLoadState();
    await popup.evaluate(() => document.fonts.ready);
    const html = await popup.content();
    assert.ok(html.includes("已核对的逐点表现"));
    fs.writeFileSync(path.join(out, c.id, `学情-${name}.html`), html);
    await popup.pdf({
      path: path.join(out, c.id, `学情-${name}.pdf`),
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    await popup.close();
    await shot(c.id + "-report-" + name);
    await btn("关闭").click();
  }
}

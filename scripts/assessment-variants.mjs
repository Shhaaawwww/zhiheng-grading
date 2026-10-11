// Paid live perturbations of existing public handwriting; these are not independent pupils.
import fs from "node:fs";
import assert from "node:assert/strict";
export async function variantWorkflow(ctx, c, eid, mode) {
  const { page, api, btn, save, shot, waitPipeline, waitTask, calls } = ctx;
  await api(
    "/settings",
    { ...(await api("/settings")), fastReview: mode === "fast" },
    "PUT",
  );
  await btn("AI 阅卷与复核").click();
  let exam = await api(`/exams/${eid}`);
  const student = exam.students[1],
    q = exam.questions[0],
    key = `${student.id}:${q.id}`,
    before = structuredClone(exam.grades[key]);
  await page.getByLabel("处理学生", { exact: true }).selectOption(student.id);
  await page
    .getByLabel("只处理尚无最终分数的题（取消可给老师已批的卷补充评语）", {
      exact: true,
    })
    .uncheck();
  const upload = async (file) => {
    await btn("上传学生原卷").click();
    await page.locator("dialog input[type=file]").setInputFiles({
      name: "002.pdf",
      mimeType: "application/pdf",
      buffer: fs.readFileSync(file),
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存附件", exact: true })
      .click();
    await page.locator("dialog").waitFor({ state: "hidden" });
  };
  const execute = async (name) => {
    const previous = calls();
    await btn("自动定位并预批").click();
    await waitPipeline();
    const tasks = await api(`/tasks?examId=${eid}`);
    const task = tasks.find(
      (t) => t.kind === "assess" && t.target.studentId === student.id,
    );
    exam = await api(`/exams/${eid}`);
    assert.equal(
      exam.grades[key]?.score,
      before?.score,
      "Pregrading must preserve the teacher score",
    );
    save(`${c.id}/${name}.json`, {
      name,
      expected: c.points[1],
      expectedTotal: c.expectedTotals[1],
      task,
      extraCalls: calls() - previous,
      statistics: exam.analysis.assessment,
      mapping: exam.answerMaps[`${task?.target?.fileId}:${q.id}`],
      finalGrade: exam.grades[key],
    });
    await shot(c.id + "-" + name);
    return task;
  };
  if(mode==='scan-repair'){await upload(c.degradedPdf);const t=await execute('round5-degraded-context-repair-B');assert.equal(t.status,'succeeded',t.error);const mapping=(await api(`/exams/${eid}`)).answerMaps[`${t.target.fileId}:${q.id}`];assert.equal(mapping.regions.length,2);assert.ok(mapping.regions.every(r=>r.box.x===0&&r.box.y===0&&r.box.w===1&&r.box.h===1));return;}
  if(mode==='recover'){
   const old=(await api(`/tasks?examId=${eid}`)).find(t=>t.kind==='assess'&&t.target.studentId===student.id);assert.equal(old.status,'failed');assert.equal(old.progress.done,3);
   const count=calls(),pending=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/api/exams/${eid}/tasks`));await btn('继续预批').click();const t=await waitTask(eid,(await(await pending).json()).id);assert.equal(t.status,'succeeded',t.error);assert.ok(calls()-count<=4,'Completed first three batches should not be sent again');
   exam=await api(`/exams/${eid}`);assert.equal(exam.grades[key].score,before.score);save(`${c.id}/round5-real-truncation-recovery.json`,{ok:true,previousTask:old.id,previousProgress:old.progress,task:t,extraCalls:calls()-count,finalGrade:exam.grades[key]});return;
  }
  if (mode === "fast") {
    const a = exam.analysis.assessment;
    const t = await execute("round3-fast-clean-B");
    assert.equal(t.status, "succeeded", t.error);
    assert.deepEqual(
      (await api(`/exams/${eid}`)).analysis.assessment,
      a,
      "Unconfirmed suggestions must not change knowledge statistics",
    );
    const count = calls();
    const pending = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith(`/api/exams/${eid}/tasks`),
    );
    await btn("自动定位并预批").click();
    const cached = await (await pending).json();
    assert.equal(cached.id, t.id);
    await page
      .getByRole("button", { name: "暂停后续处理", exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(calls(), count);
    save(`${c.id}/fast-cache-check.json`, {
      ok: true,
      cachedTaskId: t.id,
      extraCalls: 0,
    });
    return;
  }
  const variant =
      c.id === "ap25-q5"
        ? "degraded"
        : c.id === "ap25-q6"
          ? "rotated"
          : "missing-page",
    file =
      c.id === "ap25-q5"
        ? c.degradedPdf
        : c.id === "ap25-q6"
          ? c.rotatedPdf
          : c.missingPagePdf;
  await upload(file);
  let changed = await api(`/exams/${eid}`);
  assert.equal(changed.grades[key]?.score, before?.score);
  assert.ok(
    changed.analysis.assessment.staleAnswers >= 1,
    "Replacing a scan must invalidate previous evidence",
  );
  save(`${c.id}/replacement-invalidates-evidence.json`, {
    ok: true,
    staleAnswers: changed.analysis.assessment.staleAnswers,
    grade: changed.grades[key],
  });
  const t = await execute("round4-" + variant + "-B");
  if (variant === "rotated") {
    // Test the teacher's orientation and full-page recovery controls regardless of raw accuracy.
    await page
      .getByText("漏题、续页或框选错误时在这里补选", { exact: true })
      .click();
    await btn(`第 ${q.label} 题区域`).click();
    const d = page.getByRole("dialog", { name: /调整题目与作答区域/ });
    await d.waitFor();
    let n = await d
      .getByLabel("当前区域", { exact: true })
      .locator("option")
      .count();
    while (n > 1) {
      await d
        .getByLabel("当前区域", { exact: true })
        .selectOption(String(n - 1));
      await d.getByRole("button", { name: "移除区域", exact: true }).click();
      n--;
    }
    await d.getByLabel(/页码（共/).fill("1");
    await d.getByLabel("页面旋转", { exact: true }).selectOption("90");
    await d.getByRole("button", { name: "包含整页", exact: true }).click();
    await d.getByRole("button", { name: "添加续页区域", exact: true }).click();
    await d.getByLabel(/页码（共/).fill("2");
    await d.getByLabel("页面旋转", { exact: true }).selectOption("90");
    await shot(c.id + "-teacher-rotation-repair");
    await d.getByRole("button", { name: "保存作答区域", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    const fixed = await execute("round4-rotation-teacher-repaired-B");
    assert.equal(fixed.status, "succeeded", fixed.error);
  }
  if (variant === "missing-page")
    save(`${c.id}/missing-page-review-required.json`, {
      taskStatus: t?.status,
      suggestedScore: t?.result?.score,
      warnings: t?.result?.warnings,
      confirmedScoreUnchanged: exam.grades[key]?.score === before?.score,
      note: "The submitted PDF contains only the first of two answer pages. No suggestion from it was adopted.",
    });
  if (process.env.ZHIHENG_VARIANT_RECOVERY === "backup") return;
  await upload(c.studentPdfs[1]);
  const restored = await execute("round4-restored-original-B");
  assert.equal(restored.status, "succeeded", restored.error);
}

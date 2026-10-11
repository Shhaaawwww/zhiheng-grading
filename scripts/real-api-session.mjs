// Real service and real application UI. No mocked responses, routes or desktop bridge.
import { chromium } from "playwright-core";
import { createApp } from "../server/app.mjs";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const mode = process.argv[2] || "extract";
const key = process.env.DEEPSEEK_API_KEY;
if (!key)
  throw Error(
    "DEEPSEEK_API_KEY must be provided through the process environment.",
  );
delete process.env.DEEPSEEK_API_KEY;
const model = "deepseek-v4-flash-vision-exp",
  endpoint = "https://api.deepseek.com";
const out = path.resolve("output/real-api/deepseek-20260908");
const shots = path.resolve("output/playwright/real-deepseek");
mkdirSync(out, { recursive: true });
mkdirSync(shots, { recursive: true });
const read = (f) => JSON.parse(readFileSync(path.join(out, f), "utf8"));
const save = (f, v) =>
  writeFileSync(
    path.join(out, f),
    JSON.stringify(v, null, 2).replaceAll(key, "[REDACTED]"),
  );
const source = read("teacher-input.json"),
  truth = read("ground-truth.json");
const state = existsSync(path.join(out, "state.json"))
  ? read("state.json")
  : {};
const nativeFetch = globalThis.fetch;
let calls = 0;
// Read-only audit: forward the original request and return the original Response unchanged.
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (new URL(url).origin !== endpoint) return nativeFetch(input, init);
  const start = Date.now(),
    stamp = new Date(start).toISOString().replaceAll(":", "-");
  const number = ++calls;
  if (number > 12) throw Error("Real-session call limit reached.");
  const record = {
    url,
    method: init?.method || "GET",
    startedAt: new Date(start).toISOString(),
    model,
  };
  if (init?.body) {
    const body = JSON.parse(init.body);
    record.request = {
      ...body,
      messages: body.messages.map((m) => ({
        ...m,
        content: Array.isArray(m.content)
          ? m.content.map((c, i) => {
              if (c.type !== "image_url") return c;
              const bytes = Buffer.from(
                c.image_url.url.split(",")[1],
                "base64",
              );
              const filename = `sent-${stamp}-${number}-${i}.jpg`;
              writeFileSync(path.join(out, filename), bytes);
              return {
                type: "image_url",
                file: filename,
                bytes: bytes.length,
                sha256: createHash("sha256").update(bytes).digest("hex"),
              };
            })
          : m.content,
      })),
    };
  }
  try {
    const response = await nativeFetch(input, init);
    record.status = response.status;
    record.requestId =
      response.headers.get("x-request-id") ||
      response.headers.get("x-ds-request-id");
    const raw = await response.clone().json();
    if (Array.isArray(raw.choices))
      for (const c of raw.choices) {
        if (c.message?.reasoning_content) {
          c.message.reasoning_content_length =
            c.message.reasoning_content.length;
          delete c.message.reasoning_content;
        }
      }
    record.response = raw;
    record.elapsedMs = Date.now() - start;
    save(`network-${stamp}-${number}.json`, record);
    console.log(
      `Official API: ${record.method} ${new URL(url).pathname}, HTTP ${response.status}, ${record.elapsedMs} ms`,
    );
    return response;
  } catch (e) {
    record.elapsedMs = Date.now() - start;
    record.error = e.message;
    save(`network-${stamp}-${number}.json`, record);
    throw e;
  }
};

const instance = createApp({ dataDir: path.join(out, "workspace") });
const server = instance.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (route) => {
  const r = await nativeFetch(base + "/api" + route);
  const j = await r.json();
  if (!r.ok) throw Error(j.error);
  return j;
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1550, height: 1060 },
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const btn = (name) => page.getByRole("button", { name, exact: true });
const snapshot = async (name) =>
  page.screenshot({ path: path.join(shots, name + ".png"), fullPage: true });
async function settings() {
  await btn("设置与数据").click();
  const details = page.locator(".optional-ai");
  if (!(await details.getAttribute("open")))
    await details.locator("summary").first().click();
  await page.getByLabel("1. 服务地址", { exact: true }).fill(endpoint);
  await page.getByLabel("2. 访问密钥", { exact: true }).fill(key);
  const same = page.getByLabel("各项智能辅助使用同一个模型（通常选这一项）", {
    exact: true,
  });
  if (!(await same.isChecked())) await same.check();
  await page.getByLabel("3. 模型名称", { exact: true }).fill(model);
  await page.locator(".optional-ai .advanced summary").click();
  await page.getByLabel("每日请求次数上限", { exact: true }).fill("20");
  await page
    .getByLabel("单次回复长度上限（token）", { exact: true })
    .fill("16000");
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT",
  );
  await btn("保存设置").click();
  assert.ok((await saved).ok());
  assert.equal((await api("/settings")).hasKey, true);
  await btn("工作概览").click();
}
async function waitTask(kind, studentId = null, requestedId = null) {
  const started = Date.now();
  let last = "";
  for (;;) {
    const tasks = await api(`/tasks?examId=${state.examId}`);
    const task = tasks.find(
      (t) =>
        t.kind === kind &&
        (!requestedId || t.id === requestedId) &&
        (kind !== "report" || (t.target?.studentId || null) === studentId),
    );
    if (task) {
      if (task.status !== last) {
        console.log(`${kind} task: ${task.status}`);
        last = task.status;
      }
      if (!["queued", "running"].includes(task.status)) {
        save(`task-${kind}-${studentId || "class"}.json`, task);
        if (task.status !== "succeeded")
          throw Error(`${kind} failed: ${task.error}`);
        return task;
      }
    }
    if (Date.now() - started > 410000)
      throw Error(`Timed out waiting for ${kind}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}
async function startTask(button) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      (r.url().endsWith(`/api/exams/${state.examId}/tasks`) ||
        /\/api\/tasks\/[^/]+\/retry$/.test(r.url())),
    { timeout: 60000 },
  );
  await btn(button).click();
  const r = await response;
  const task = await r.json();
  if (!r.ok()) throw Error(task.error);
  return task.id;
}
const normalizeLabel = (s) =>
  s
    .replaceAll("（", "(")
    .replaceAll("）", ")")
    .replace(/^第\s*/, "")
    .replace(/题$/, "")
    .replaceAll(/\s/g, "");
async function exportReport(filename) {
  const [print] = await Promise.all([
    page.waitForEvent("popup"),
    btn("导出 PDF").click(),
  ]);
  await print.waitForLoadState("load");
  await print.evaluate(() => document.fonts.ready);
  const html = await print.content();
  writeFileSync(path.join(out, filename + ".html"), html);
  await print.addStyleTag({
    content: "@media print{.print-button{display:none!important}}",
  });
  await print.pdf({
    path: path.join(out, filename + ".pdf"),
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  await print.close();
  await btn("关闭").click();
}
try {
  if (mode.startsWith("extract")) {
    const response = await fetch(endpoint + "/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Error(
        `Official model-list request returned HTTP ${response.status}.`,
      );
    const models = await response.json();
    save("model-availability.json", {
      model,
      listed: models.data?.some((m) => m.id === model),
      checkedAt: new Date().toISOString(),
      endpoint,
    });
  }
  await page.goto(base);
  await page.getByRole("button", { name: "班级与学生", exact: true }).waitFor();
  if (!state.examId) {
    await btn("建立我的班级").click();
    await btn("新建班级").click();
    await page.getByLabel("班级名称", { exact: true }).fill(source.className);
    await page.getByLabel("年级", { exact: true }).selectOption("高二");
    for (let i = 0; i < source.students.length; i++) {
      if (i) await btn("添加学生").click();
      await page
        .getByLabel(`第 ${i + 1} 位学生学号`, { exact: true })
        .fill(source.students[i].number);
      await page
        .getByLabel(`第 ${i + 1} 位学生姓名`, { exact: true })
        .fill(source.students[i].name);
    }
    await snapshot("01-create-class");
    await btn("保存班级").click();
    await page.locator("dialog").waitFor({ state: "hidden" });
    await snapshot("02-roster");
    await btn("为班级创建考试").click();
    await page.getByLabel("考试名称", { exact: true }).fill(source.examName);
    await page.getByLabel("考试日期", { exact: true }).fill(source.date);
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/api/exams") && r.request().method() === "POST",
    );
    await btn("创建考试").click();
    state.examId = (await (await created).json()).id;
    save("state.json", state);
    await page.locator("dialog").waitFor({ state: "hidden" });
  } else
    await page
      .getByLabel("当前考试", { exact: true })
      .selectOption(state.examId);
  await settings();
  if (mode.startsWith("extract")) {
    await btn("试卷准备").click();
    const prior = (await api(`/tasks?examId=${state.examId}`)).find(
      (t) => t.kind === "extract" && t.target.wholePaper,
    );
    let requestedId = prior?.id;
    if (mode === "extract-recheck" && prior?.status === "succeeded") {
      await page.getByRole("dialog", { name: "核对整卷识别结果" }).waitFor();
      await btn("稍后核对").click();
      requestedId = await startTask("开始整卷识别");
    } else if (!prior) {
      await page
        .getByLabel("选择试卷 PDF", { exact: true })
        .setInputFiles(path.resolve(truth.scanPdf));
      await snapshot("03-ready-to-scan");
      requestedId = await startTask("开始整卷识别");
    } else if (prior.status !== "succeeded") {
      requestedId = await startTask("重新尝试识别");
    }
    const task = await waitTask("extract", null, requestedId);
    state.extractTaskId = task.id;
    save("state.json", state);
    await page.getByRole("dialog", { name: "核对整卷识别结果" }).waitFor();
    await snapshot("04-real-recognition");
    const leaves = task.result.questions.filter(
      (q) =>
        q.type !== "group" &&
        !task.result.questions.some((c) => c.parentId === q.id),
    );
    const discrepancies = [];
    for (const expected of truth.questions) {
      const actual = leaves.find(
        (q) => normalizeLabel(q.label) === expected.label,
      );
      if (!actual)
        discrepancies.push({ label: expected.label, issue: "missing" });
      else
        for (const key of ["max", "type", "page"])
          if (actual[key] !== expected[key])
            discrepancies.push({
              label: expected.label,
              key,
              expected: expected[key],
              actual: actual[key],
            });
    }
    save("recognition-comparison.json", {
      expected: truth.scoringUnits,
      actual: leaves.length,
      paperMax: task.result.paperMax,
      total: leaves.reduce((n, q) => n + (q.max || 0), 0),
      warnings: task.result.warnings,
      discrepancies,
      questions: task.result.questions,
    });
    console.log(
      "Extraction ready for local comparison. No answer key was sent.",
    );
  } else if (mode === "finish") {
    let exam = await api(`/exams/${state.examId}`);
    if (!exam.questions.length) {
      await btn("试卷准备").click();
      await page.getByRole("dialog", { name: "核对整卷识别结果" }).waitFor();
      // Teacher review against the graph; the raw API result remains unchanged.
      await page
        .getByRole("button", { name: "第 1 页 · 查看题干", exact: true })
        .nth(2)
        .click();
      const graphStem = page.getByLabel("第 3 题识别题干", { exact: true });
      const before = await graphStem.inputValue();
      const after = before.replace(/，过点\(3,\s*3\)/, "");
      if (after !== before) {
        await graphStem.fill(after);
        save("teacher-recognition-corrections.json", [
          {
            label: "3",
            before,
            after,
            reason:
              "原图没有直接画出或标明(3,3)，删去模型自行补充的点；保留图中明确的顶点和横轴交点。",
          },
        ]);
        await snapshot("04b-teacher-check-graph");
      }
      await btn("确认题目，生成全班录分表").click();
    } else await btn("阅卷与录分").click();
    exam = await api(`/exams/${state.examId}`);
    const leaves = exam.questions.filter(
      (q) =>
        q.type !== "group" && !exam.questions.some((c) => c.parentId === q.id),
    );
    assert.equal(exam.analysis.max, 100);
    assert.equal(leaves.length, 15);
    for (const student of source.students) {
      const savedStudent = exam.students.find(
        (s) => s.number === student.number,
      );
      assert.ok(savedStudent);
      for (const input of student.grades) {
        const q = leaves.find((q) => normalizeLabel(q.label) === input.label);
        assert.ok(q, `missing ${input.label}`);
        const old = exam.grades[`${savedStudent.id}:${q.id}`];
        if (old?.score === input.score && old.status === "final") continue;
        const cell = page.getByLabel(`${student.name} 第 ${q.label} 题得分`, {
          exact: true,
        });
        await cell.fill(String(input.score));
        const saved = page.waitForResponse(
          (r) =>
            r.url().endsWith(`/api/exams/${state.examId}/grades`) &&
            r.request().method() === "PUT",
        );
        await cell.press("Enter");
        assert.ok((await saved).ok());
      }
      console.log(`Teacher entered ${student.name}: ${student.total}/100`);
    }
    await snapshot("05-full-score-grid");
    await btn("按题阅卷").click();
    for (const student of source.students) {
      const s = exam.students.find((s) => s.number === student.number);
      for (const input of student.grades.filter((g) => g.note)) {
        const q = leaves.find((q) => normalizeLabel(q.label) === input.label);
        await page.getByLabel("当前学生", { exact: true }).selectOption(s.id);
        await page.getByLabel("当前题目", { exact: true }).selectOption(q.id);
        await page
          .getByLabel("简短备注（可选）", { exact: true })
          .fill(input.note);
        const saved = page.waitForResponse(
          (r) =>
            r.url().endsWith(`/api/exams/${state.examId}/grades`) &&
            r.request().method() === "PUT",
        );
        await btn("保存").click();
        assert.ok((await saved).ok());
      }
    }
    await snapshot("06-teacher-note");
    await btn("成绩表").click();
    const [sheet] = await Promise.all([
      page.waitForEvent("download"),
      btn("导出").click(),
    ]);
    await sheet.saveAs(path.join(out, "全班录分表.xlsx"));
    exam = await api(`/exams/${state.examId}`);
    save("exam-after-teacher-input.json", exam);
    assert.equal(exam.analysis.complete, 12);
    assert.ok(Math.abs(exam.analysis.average - source.expectedAverage) < 0.051);
    for (const s of source.students)
      assert.equal(
        exam.analysis.students.find((v) => v.number === s.number).total,
        s.total,
      );
    await btn("班级学情").click();
    await snapshot("07-class-analysis");
    await btn("保存基础报告").click();
    await page.locator(".report-sheet").waitFor();
    await exportReport("班级学情-基础报告");
    for (const student of source.students) {
      await btn("个人学情").click();
      const s = exam.students.find((s) => s.number === student.number);
      await page.getByLabel("查看学生", { exact: true }).selectOption(s.id);
      await btn("保存基础报告").click();
      await page.locator(".report-sheet").waitFor();
      await exportReport(`${student.name}-个人学情-基础报告`);
    }
    state.teacherFlowComplete = true;
    save("state.json", state);
    console.log(
      "Teacher input, score export and all 12 individual basic reports completed.",
    );
    await btn("班级学情").click();
    let tasks = await api(`/tasks?examId=${state.examId}`);
    let classification = tasks.find(
      (t) => t.kind === "classify" && t.status === "succeeded",
    );
    if (!classification) {
      const requestedId = await startTask("整理文字备注");
      classification = await waitTask("classify", null, requestedId);
    }
    if (!classification.adoptedAt) {
      const row = page
        .locator(".task-row")
        .filter({ hasText: "备注归类" })
        .first();
      await row.getByRole("button", { name: "查看", exact: true }).click();
      await snapshot("08-real-remark-classification");
      await btn("确认采用这些归类").click();
    }
    exam = await api(`/exams/${state.examId}`);
    const scopes = [null, exam.students[0], exam.students[8]];
    state.aiReports = [];
    for (const s of scopes) {
      await btn(s ? "个人学情" : "班级学情").click();
      if (s)
        await page.getByLabel("查看学生", { exact: true }).selectOption(s.id);
      const requestedId = await startTask("生成 AI 解读");
      const task = await waitTask("report", s?.id || null, requestedId);
      state.aiReports.push(task.result.reportId);
      save("state.json", state);
      await btn("报告归档").click();
      const label = (s ? s.name : "全班") + " · 学情报告";
      const row = page
        .locator("tbody tr")
        .filter({ hasText: label })
        .filter({ hasText: "AI 解读" })
        .first();
      await row
        .getByRole("button", { name: "查看 / 导出", exact: true })
        .click();
      await page.locator(".report-sheet").waitFor();
      await snapshot(`09-AI-${s?.name || "class"}`);
      await exportReport(`${s?.name || "班级"}-学情-AI解读`);
    }
    await btn("设置与数据").click();
    const [backup] = await Promise.all([
      page.waitForEvent("download"),
      btn("导出完整备份").click(),
    ]);
    await backup.saveAs(path.join(out, "真实API全流程测试资料.zhb"));
    save("final-exam.json", await api(`/exams/${state.examId}`));
    save("final-reports.json", await api(`/exams/${state.examId}/reports`));
    state.complete = true;
    save("state.json", state);
  }
  if (mode === "review") {
    await btn("报告归档").click();
    const row = page
      .locator("tbody tr")
      .filter({ hasText: "全班 · 学情报告" })
      .filter({ hasText: "AI 解读" })
      .first();
    await row.getByRole("button", { name: "查看 / 导出", exact: true }).click();
    await page.locator(".report-edit summary").click();
    const observation = page.getByLabel("建议 2 观察与解释", { exact: true });
    const before = await observation.inputValue();
    const after =
      "有备注样本显示，本次期望计算正确，但方差计算遗漏了减去期望平方这一项。需用同类题再确认是记忆、理解还是当次执行问题。";
    await observation.fill(after);
    await page
      .getByLabel("教师补充或修订意见", { exact: true })
      .fill(
        "下一课先用三道短题检查导数符号、方差与半弦长，再按实际错误分组讲评。备注仅覆盖部分题目与学生；本报告描述本次测试表现。",
      );
    await btn("保存为新版本").click();
    await page.getByText("教师修订版", { exact: true }).waitFor();
    await snapshot("10-teacher-report-revision");
    await exportReport("班级-学情-教师修订版");
    save("teacher-report-corrections.json", [
      {
        before,
        after,
        reason: "将单次错误的能力判断改为本次可观察的遗漏，并安排后续验证。",
      },
    ]);
    const response = await nativeFetch(
      `${base}/api/exams/${state.examId}/export?mode=grades`,
    );
    assert.ok(response.ok);
    writeFileSync(
      path.join(out, "全班录分表-宽表.xlsx"),
      Buffer.from(await response.arrayBuffer()),
    );
    await btn("设置与数据").click();
    const [backup] = await Promise.all([
      page.waitForEvent("download"),
      btn("导出完整备份").click(),
    ]);
    await backup.saveAs(path.join(out, "真实API全流程测试资料.zhb"));
    save("final-reports.json", await api(`/exams/${state.examId}/reports`));
  }
  assert.deepEqual(errors, []);
  save(`ui-${mode}-result.json`, {
    ok: true,
    mode,
    noMock: true,
    model,
    endpoint,
    rendererErrors: errors,
    completedAt: new Date().toISOString(),
    state,
  });
} catch (e) {
  console.error(e.message.replaceAll(key, "[REDACTED]"));
  await snapshot(`failure-${mode}`);
  save(`ui-${mode}-result.json`, {
    ok: false,
    mode,
    error: e.message,
    rendererErrors: errors,
    state,
  });
  process.exitCode = 1;
} finally {
  save("state.json", state);
  save("usage.json", await api("/usage"));
  await browser.close();
  instance.ai.close();
  while (instance.ai.active) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => server.close(r));
  instance.store.close();
  globalThis.fetch = nativeFetch;
}

import { variantWorkflow } from "./assessment-variants.mjs";
import {
  reviewWorkflow,
  reportWorkflow,
} from "./assessment-review-workflow.mjs";
// Explicitly paid live tests. No fake provider, no replacement responses.
import { chromium } from "playwright-core";
import { createApp } from "../server/app.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const out = path.resolve(
  process.env.ZHIHENG_TEST_OUT || "output/real-api/release-030",
);
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(out, "screenshots"), { recursive: true });
const key = process.env.DEEPSEEK_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
if (!key) throw Error("Set DEEPSEEK_API_KEY in the process environment");
const mode = process.argv[2] || "prepare";
const save = (file, data) => {
  const p = path.join(out, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify(data, null, 2).replaceAll(key, "[REDACTED]"),
  );
};
const read = (file) =>
  JSON.parse(fs.readFileSync(path.join(out, file), "utf8"));
const cases = read("fixtures.json");
const state = fs.existsSync(path.join(out, "state.json"))
  ? read("state.json")
  : { exams: {} };
let currentCase = "",
  calls = 0;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (new URL(String(url)).origin !== "https://api.deepseek.com")
    return nativeFetch(url, init);
  if (++calls > 80) throw Error("Live test per-process call cap reached");
  const stamp = `${Date.now()}-${calls}`,
    started = Date.now();
  const log = {
    currentCase,
    startedAt: new Date(started).toISOString(),
    endpoint: "https://api.deepseek.com/chat/completions",
  };
  const body = JSON.parse(init.body);
  log.request = {
    ...body,
    messages: body.messages.map((m) => ({
      ...m,
      content: Array.isArray(m.content)
        ? m.content.map((c, i) => {
            if (c.type !== "image_url") return c;
            const bytes = Buffer.from(c.image_url.url.split(",")[1], "base64"),
              file = `sent/${stamp}-${i}.jpg`;
            fs.mkdirSync(path.join(out, "sent"), { recursive: true });
            fs.writeFileSync(path.join(out, file), bytes);
            return {
              type: "image_url",
              file,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              bytes: bytes.length,
            };
          })
        : m.content,
    })),
  };
  try {
    const response = await nativeFetch(url, init);
    log.httpStatus = response.status;
    const data = await response.clone().json();
    for (const c of data.choices || []) {
      if (c.message?.reasoning_content) {
        c.message.reasoningCharacters = c.message.reasoning_content.length;
        delete c.message.reasoning_content;
      }
    }
    log.response = data;
    log.elapsedMs = Date.now() - started;
    save(`network/${stamp}.json`, log);
    console.log(
      `LIVE ${currentCase}: HTTP ${response.status}, ${Math.round(log.elapsedMs / 1000)}s, input ${data.usage?.prompt_tokens ?? "unknown"}, output ${data.usage?.completion_tokens ?? "unknown"}`,
    );
    return response;
  } catch (e) {
    log.error = e.name;
    log.elapsedMs = Date.now() - started;
    save(`network/${stamp}.json`, log);
    throw e;
  }
};
const instance = createApp({ dataDir: path.join(out, "workspace") });
const server = instance.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (url, body, method = body ? "POST" : "GET") => {
  const response = await nativeFetch(base + "/api" + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Zhiheng-Client": "desktop",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
};
await api(
  "/settings",
  {
    baseUrl: "https://api.deepseek.com",
    visionModel: "deepseek-v4-flash-vision-exp",
    gradingModel: "deepseek-v4-flash-vision-exp",
    reportModel: "deepseek-v4-flash-vision-exp",
    apiKey: key,
    dailyCalls: 300,
    maxTokens: 12000,
    inputPrice: 0.22,
    outputPrice: 0.66,
    currency: "USD",
  },
  "PUT",
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const btn = (name) => page.getByRole("button", { name, exact: true });
const shot = (name) =>
  page.screenshot({
    path: path.join(out, "screenshots", `${name}.png`),
    fullPage: true,
  });
async function waitTask(examId, taskId) {
  const start = Date.now();
  let progress = "";
  while (Date.now() - start < 900000) {
    const t = (await api(`/tasks?examId=${examId}`)).find(
      (t) => t.id === taskId,
    );
    const next = `${t.status}:${t.progress?.done || 0}`;
    if (next !== progress) {
      console.log(currentCase, next);
      progress = next;
    }
    if (!["queued", "running"].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Live task deadline exceeded");
}
async function selectExam(id) {
  await page.goto(base);
  await page.getByLabel("当前考试", { exact: true }).selectOption(id);
}
async function waitPipeline() {
  const start = Date.now();
  while (Date.now() - start < 1200000) {
    const status = await page.evaluate(() => ({
      body: document.body.innerText,
      busy: [...document.querySelectorAll("button")].some((b) =>
        b.textContent.includes("暂停后续处理"),
      ),
    }));
    if (status.body.includes("本批处理完成。")) return;
    if (!status.busy && Date.now() - start > 2000) {
      const err = await page.locator('[role="alert"]').allTextContents();
      throw Error("Pipeline stopped: " + err.join(";"));
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Pipeline timeout");
}
try {
  await page.goto(base);
  if (!state.classId) {
    await btn("班级与学生").click();
    await btn("新建班级").click();
    await page
      .getByLabel("班级名称", { exact: true })
      .fill("公开答卷验证组（独立样例，非真实班级）");
    for (let i = 0; i < 3; i++) {
      if (i) await btn("添加学生").click();
      await page
        .getByLabel(`第 ${i + 1} 位学生学号`, { exact: true })
        .fill(`00${i + 1}`);
      await page
        .getByLabel(`第 ${i + 1} 位学生姓名`, { exact: true })
        .fill(`公开样例${"ABC"[i]}`);
    }
    await btn("保存班级").click();
    await page.locator("dialog").waitFor({ state: "hidden" });
    state.classId = (await api("/bootstrap")).classes[0].id;
    save("state.json", state);
    await shot("class-ui");
  }
  for (const c of cases.filter(
    (c) => !process.env.ZHIHENG_CASE || c.id === process.env.ZHIHENG_CASE,
  )) {
    currentCase =
      c.id + "/" + mode + "/" + (process.env.ZHIHENG_ROUND || "baseline");
    if (!state.exams[c.id]) {
      await page.goto(base);
      await btn("班级与学生").click();
      await page
        .locator(".class-card")
        .filter({ hasText: "公开答卷验证组" })
        .click();
      await btn("为班级创建考试").click();
      await page
        .getByLabel("考试名称", { exact: true })
        .fill(c.title + " · 真实手写样例验证");
      await btn("创建考试").click();
      await page
        .getByRole("heading", { name: "试卷准备", exact: true })
        .waitFor();
      state.exams[c.id] = (await api("/bootstrap")).exams[0].id;
      save("state.json", state);
    }
    const eid = state.exams[c.id];
    await selectExam(eid);
    let exam = await api(`/exams/${eid}`);
    if (mode === "prepare") {
      await btn("试卷准备").click();
      let t = (await api(`/tasks?examId=${eid}`)).find(
        (t) => t.kind === "extract" && t.result?.questions?.length,
      );
      if (!t) {
        await page
          .getByLabel("选择试卷 PDF", { exact: true })
          .setInputFiles(c.paperPdf);
        const response = page.waitForResponse(
          (r) =>
            r.request().method() === "POST" &&
            r.url().endsWith(`/api/exams/${eid}/tasks`),
        );
        await btn("开始整卷识别").click();
        t = await (await response).json();
      }
      t = await waitTask(eid, t.id);
      save(`${c.id}/extraction.json`, t);
      assert.ok(t.status === "succeeded" || t.status === "partial", t.error);
      if (!t.adoptedAt) {
        const dialog = page.getByRole("dialog", { name: "核对整卷识别结果" });
        try {
          await dialog.waitFor({ timeout: 5000 });
        } catch {
          await btn("查看结果并生成录分表").click();
          await dialog.waitFor();
        }
        const qs = t.result.questions.filter((q) => q.type !== "group");
        assert.equal(
          qs.length,
          1,
          "Expected one whole question; inspect split rows before proceeding",
        );
        const q = qs[0];
        await page
          .getByLabel(`第 ${q.label} 题满分`, { exact: true })
          .fill("9");
        const mismatch = page.getByLabel(/我已核对，按当前合计/);
        if (await mismatch.count()) await mismatch.check();
        await btn("确认题目，生成全班录分表").click();
        await dialog.waitFor({ state: "hidden" });
        save(`${c.id}/teacher-template-review.json`, {
          source: "Official scoring guidelines: question total 9",
          maxBefore: q.max,
          maxAfter: 9,
          questions: t.result.questions,
        });
      }
      await btn("AI 阅卷与复核").click();
      exam = await api(`/exams/${eid}`);
      if (
        !process.env.ZHIHENG_WITHOUT_REFERENCE &&
        !exam.attachments.some((f) => f.role === "reference")
      )
        await page
          .getByLabel("上传参考答案（可选，PDF 或图片）", { exact: true })
          .setInputFiles(c.referencePdf);
      if (!process.env.ZHIHENG_WITHOUT_REFERENCE)
        await page
          .getByText("参考文件：参考标准-图片版.pdf", { exact: true })
          .waitFor();
      if (
        !(await api(`/tasks?examId=${eid}`)).some(
          (t) => t.kind === "rubric" && t.status === "succeeded",
        )
      ) {
        await btn("自动整理评分标准").click();
        await waitPipeline();
      }
      const standard = (await api(`/tasks?examId=${eid}`)).find(
        (t) => t.kind === "rubric" && t.status === "succeeded",
      );
      assert.ok(standard, "No completed rubric");
      if (process.env.ZHIHENG_WITHOUT_REFERENCE) {
        assert.equal(standard.result.spec.origin, "generated");
        assert.ok(
          standard.result.spec.sourceRefs.every(
            (s) => !exam.attachments.find((f) => f.id === s.fileId)?.studentId,
          ),
        );
      }
      save(`${c.id}/rubric-proposal.json`, standard);
      await shot(c.id + "-rubric-proposal");
    }
    if (["fast", "variants", "scan-repair", "recover"].includes(mode))
      await variantWorkflow(
        { page, api, btn, save, shot, waitPipeline, waitTask, calls: () => calls },
        c,
        eid,
        mode,
      );
    if (mode === "review")
      await reviewWorkflow({ page, api, btn, out, save, shot }, c, eid);
    if (mode === "reports")
      await reportWorkflow(
        { page, api, btn, out, save, shot, waitTask, calls: () => calls },
        c,
        eid,
      );
    if (mode === "grade") {
      await btn("AI 阅卷与复核").click();
      exam = await api(`/exams/${eid}`);
      if (!exam.questions[0].rubricSpec?.confirmed) {
        await btn("核对标准").click();
        const d = page.getByRole("dialog", { name: /核对评分标准/ });
        await d.waitFor();
        const correctionPath = path.join(
          out,
          c.id,
          "teacher-rubric-corrections.json",
        );
        if (fs.existsSync(correctionPath)) {
          const fix = JSON.parse(fs.readFileSync(correctionPath, "utf8"));
          const rules = page.getByLabel("给分规则、等价解法及前错后对的处理", {
            exact: true,
          });
          await rules.fill(
            (await rules.inputValue()) + "\n" + fix.instructionsAppend,
          );
          for (const [index, fields] of Object.entries(fix.criteria || {})) {
            const row = d.locator("fieldset").nth(Number(index));
            for (const [field, value] of Object.entries(fields))
              await row
                .getByLabel(
                  field === "expected"
                    ? "应当看到的作答证据"
                    : "允许的其他解法",
                  { exact: true },
                )
                .fill(value);
          }
        }
        await page
          .getByLabel("我已核对标准，可用于本次预批", { exact: true })
          .check();
        await btn("保存评分标准").click();
        await d.waitFor({ state: "hidden" });
      }
      exam = await api(`/exams/${eid}`);
      if (
        exam.students.some(
          (s) => !exam.attachments.some((f) => f.studentId === s.id),
        )
      ) {
        await btn("上传学生原卷").click();
        await page
          .locator("dialog input[type=file]")
          .setInputFiles(c.studentPdfs);
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "保存附件" })
          .click();
        await page.locator("dialog").waitFor({ state: "hidden" });
      }
      await btn("自动定位并预批").click();
      await waitPipeline();
      exam = await api(`/exams/${eid}`);
      const ts = (await api(`/tasks?examId=${eid}`)).filter(
        (t) => t.kind === "assess",
      );
      save(`${c.id}/${process.env.ZHIHENG_ROUND || "baseline"}-grading.json`, {
        tasks: ts,
        expected: c.points,
        totals: c.expectedTotals,
        exam,
      });
      await shot(c.id + "-pregraded");
    }
  }
  const backup = await nativeFetch(base + "/api/backup");
  fs.writeFileSync(
    path.join(out, "latest-test-workspace.zhb"),
    Buffer.from(await backup.arrayBuffer()),
  );
  save("browser-errors.json", errors);
  assert.deepEqual(errors, []);
  save("usage.json", instance.store.list("usage"));
  console.log("DONE", mode, "calls", calls);
} catch (e) {
  save("last-error.json", {
    mode,
    currentCase,
    error: e.message,
    stack: e.stack,
    browserErrors: errors,
  });
  await shot("failure-" + mode).catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  instance.ai.close();
  while (instance.ai.active) await new Promise((r) => setTimeout(r, 100));
  server.close();
  save("usage.json", instance.store.list("usage"));
  instance.store.close();
}

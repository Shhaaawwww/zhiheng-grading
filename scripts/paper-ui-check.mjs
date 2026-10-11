import { chromium } from "playwright-core";
import { createApp } from "../server/app.mjs";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
const out = path.resolve("output/playwright/paper");
mkdirSync(out, { recursive: true });
mkdirSync("output/tests", { recursive: true });
const instance = createApp({
  dataDir: mkdtempSync(path.resolve("output/tests/paper-ui-")),
});
const server = instance.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (route, body, method = body ? "POST" : "GET") => {
  const r = await fetch(base + "/api" + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Zhiheng-Client": "desktop",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error);
  return j;
};
const requests = [];
let missingMark = false;
const mock = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const request = JSON.parse(raw);
  requests.push(request);
  const result = {
    paperMax: 20,
    pagesReviewed: [1, 2, 3],
    warnings: [],
    questions: [
      {
        label: "1",
        type: "choice",
        max: 5,
        primary: "集合与逻辑",
        stem: "已知集合 A={1,2}，B={2,3}，则 A∩B 为 A. {1} B. {2} C. {3} D. {1,2,3}",
        page: 1,
      },
      {
        label: "2",
        type: "fill",
        max: 5,
        primary: "等差数列",
        stem: "等差数列首项为 2，公差为 3，第 5 项为____。",
        page: 2,
      },
      {
        label: "3",
        type: "solve",
        max: missingMark ? null : 10,
        primary: "导数与单调性",
        related: ["函数性质"],
        stem: "已知函数 f(x)=x²-2x。（1）求导数；（2）求单调区间。",
        page: 3,
        reviewNote: missingMark ? "本题分值不清楚，请对照原稿核对。" : "",
      },
    ],
  };
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        { message: { content: JSON.stringify(result) }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    }),
  );
});
mock.listen(0, "127.0.0.1");
await new Promise((r) => mock.once("listening", r));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.setDefaultTimeout(18000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const btn = (name) => page.getByRole("button", { name, exact: true });
try {
  const c = await api("/classes", {
    name: "自动识卷验收班（虚构）",
    students: [
      { number: "001", name: "练习甲" },
      { number: "002", name: "练习乙" },
    ],
  });
  const e = await api("/exams", {
    classId: c.id,
    name: "整卷识别练习（虚构）",
    date: "2026-09-08",
  });
  await page.goto(base);
  await btn("去自动识别试卷").click();
  await btn("连接智能识卷服务").click();
  assert.ok(await page.getByLabel("1. 服务地址", { exact: true }).isVisible());
  await api(
    "/settings",
    {
      baseUrl: `http://127.0.0.1:${mock.address().port}`,
      apiKey: "LOCAL-MOCK-ONLY",
      visionModel: "mock-v",
      gradingModel: "mock-v",
      reportModel: "mock-v",
    },
    "PUT",
  );
  await page.reload();
  await btn("试卷准备").click();
  await page
    .getByLabel("选择试卷 PDF", { exact: true })
    .setInputFiles(path.resolve("output/tests/fixtures/整卷识别样卷.pdf"));
  if (!process.env.ZHIHENG_CHECK_NO_ILLUSTRATIONS)
    await page.locator(".paper-scan").screenshot({ path: "public/help/prepare.png" });
  await btn("开始整卷识别").click();
  await page.getByRole("dialog", { name: "核对整卷识别结果" }).waitFor();
  assert.equal(requests.length, 1);
  const images = requests[0].messages[1].content.filter(
    (c) => c.type === "image_url",
  );
  assert.equal(images.length, 3);
  const resolution = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  }, images[0].image_url.url);
  assert.equal(resolution.width, 1800);
  assert.equal(new Set(images.map((i) => i.image_url.url)).size, 3);
  assert.ok(images.every((i) => i.image_url.url.length > 20000));
  assert.equal(
    await page.getByLabel("第 3 题主要知识点", { exact: true }).inputValue(),
    "导数与单调性",
  );
  assert.equal(
    await page.getByLabel("第 2 题题型", { exact: true }).inputValue(),
    "fill",
  );
  assert.equal(
    await page.getByLabel("第 3 题满分", { exact: true }).inputValue(),
    "10",
  );
  assert.equal((await api(`/exams/${e.id}`)).questions.length, 0);
  await page.screenshot({ path: path.join(out, "review.png") });
  if (!process.env.ZHIHENG_CHECK_NO_ILLUSTRATIONS)
    await page.locator(".scan-review-table").screenshot({ path: "public/help/review.png" });
  await btn("第 3 页 · 查看题干").click();
  await page.getByLabel("第 3 题识别题干", { exact: true }).waitFor();
  const originalImage = page.getByRole('img', { name: '整卷识别样卷.pdf 第 3 页', exact: true });
  await originalImage.waitFor();
  assert.equal(await originalImage.getAttribute('src'), images[2].image_url.url);
  assert.ok(
    (
      await page.getByLabel("第 3 题识别题干", { exact: true }).inputValue()
    ).includes("x²-2x"),
  );
  await page.screenshot({ path: path.join(out, "original-page3.png") });
  await btn("稍后核对").click();
  await btn("工作概览").click();
  await btn("试卷准备").click();
  await page.getByRole("dialog", { name: "核对整卷识别结果" }).waitFor();
  await btn("确认题目，生成全班录分表").click();
  await page.getByLabel("练习甲 第 3 题得分", { exact: true }).waitFor();
  const ready = await api(`/exams/${e.id}`);
  assert.equal(ready.questions.length, 3);
  assert.ok(ready.questions.every((q) => q.confirmed && q.primary));
  assert.equal(ready.analysis.max, 20);
  assert.equal(ready.paperScan.pageCount, 3);
  for (const [name, scores] of [
    ["练习甲", [5, 5, 7]],
    ["练习乙", [0, 5, 10]],
  ]) {
    for (let i = 0; i < scores.length; i++) {
      const input = page.getByLabel(`${name} 第 ${i + 1} 题得分`, {
        exact: true,
      });
      await input.fill(String(scores[i]));
      await input.press("Enter");
      await page.getByText("已保存到本机", { exact: true }).waitFor();
    }
  }
  await btn("按题阅卷").click();
  await page
    .getByLabel("简短备注（可选）")
    .fill("示例错因：集合交集与并集混淆。");
  await btn("保存").click();
  await page.getByText("已保存到本机", { exact: true }).waitFor();
  const scored = await api(`/exams/${e.id}`);
  assert.equal(scored.analysis.complete, 2);
  assert.equal(scored.analysis.average, 16);
  assert.equal(scored.analysis.topics.length, 3);
  assert.ok(Object.values(scored.grades).some((g) => g.note.includes("交集")));
  assert.ok(Object.values(scored.grades).some((g) => g.score === 0));
  assert.equal(requests.length, 1);
  await btn("班级学情").click();
  await btn("保存基础报告").waitFor();
  await page.screenshot({ path: path.join(out, "analysis.png") });
  await btn("保存基础报告").click();
  await page.locator(".report-sheet").waitFor();
  await btn("关闭").click();
  missingMark = true;
  const e2 = await api("/exams", {
    classId: c.id,
    name: "分值缺失验收（虚构）",
    date: "2026-09-08",
  });
  await page.reload();
  await page.getByLabel("当前考试", { exact: true }).selectOption(e2.id);
  await btn("试卷准备").click();
  await page
    .getByLabel("选择试卷 PDF", { exact: true })
    .setInputFiles(path.resolve("output/tests/fixtures/整卷识别样卷.pdf"));
  await btn("开始整卷识别").click();
  await page.getByRole("dialog", { name: "核对整卷识别结果" }).waitFor();
  assert.equal(
    await page.getByLabel("第 3 题满分", { exact: true }).inputValue(),
    "",
  );
  assert.ok(await btn("确认题目，生成全班录分表").isDisabled());
  assert.equal((await api(`/exams/${e2.id}`)).questions.length, 0);
  await page.getByLabel("第 3 题满分", { exact: true }).fill("10");
  assert.ok(await btn("确认题目，生成全班录分表").isEnabled());
  for (const width of [1050, 700]) {
    await page.setViewportSize({ width, height: 850 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    const d = await page.getByRole("dialog").boundingBox();
    assert.ok(d.x >= 0 && d.x + d.width <= width + 1);
    await page.screenshot({ path: path.join(out, `review-${width}.png`) });
  }
  await btn("确认题目，生成全班录分表").click();
  await page.getByLabel("练习甲 第 3 题得分", { exact: true }).waitFor();
  assert.equal(requests.length, 2);
  const tasks = await api(`/tasks?examId=${e2.id}`);
  assert.ok(tasks.every((t) => t.kind === "extract" && t.target.wholePaper));
  await assert.rejects(
    () =>
      api(`/exams/${e2.id}/tasks`, {
        kind: "extract",
        payload: {
          wholePaper: true,
          sourceFileId: tasks[0].target.sourceFileId,
          images: images.slice(0, 2).map((i) => i.image_url.url),
          pages: [1, 3],
        },
      }),
    /全部页面/,
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    path.join(out, "checks.json"),
    JSON.stringify(
      {
        ok: true,
        realProvider: false,
        checks: [
          "unconfigured service shortcut",
          "3 distinct scanned PDF pages sent in one request",
          "types and topics prefilled including last page",
          "resume unadopted result",
          "single confirmation opens class score grid and confirms topics",
          "teacher scores including zero and optional note produce 3 topic statistics",
          "unknown mark blocks adoption until correction",
          "responsive dialog",
          "non-contiguous pages rejected",
        ],
        requests: requests.length,
        rendererErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Whole-paper UI passed using an isolated local mock; no real OCR accuracy measured.",
  );
} catch (e) {
  await page.screenshot({
    path: path.join(out, "failure.png"),
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  instance.ai.close();
  while (instance.ai.active) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => server.close(r));
  await new Promise((r) => mock.close(r));
  instance.store.close();
}

import { chromium } from "playwright-core";
import { createApp } from "../server/app.mjs";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
const out = path.resolve("output/tests");
mkdirSync(out, { recursive: true });
const instance = createApp({ dataDir: mkdtempSync(path.join(out, "ai-ui-")) });
const server = instance.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = "http://127.0.0.1:" + server.address().port;
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
const mock = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const data = JSON.parse(raw),
    system = data.messages[0].content,
    user = data.messages[1].content;
  let result;
  if (system.includes("简短备注归类")) {
    result = {
      items: JSON.parse(user).map((x) => ({
        ref: x.ref,
        categories: ["运算错误"],
      })),
    };
  } else if (system.includes("教学反馈助手")) {
    const input = JSON.parse(user);
    result = {
      summary: "模拟接口生成的教学反馈，仅用于软件验收。",
      findings: [
        {
          title: "回看本次题目",
          observation: "需要核对作答过程",
          evidence: [input.questions[0].id],
          remarkRefs: [],
          certainty: "hypothesis",
          action: "安排同类短题",
          check: "检查关键条件",
        },
      ],
    };
  } else {
    result = {
      score: 1,
      note: "模拟评分备注",
      tags: [],
      uncertainty: "这是模拟接口验收结果",
      justification: "不用于评价实际模型准确率",
    };
  }
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        { message: { content: JSON.stringify(result) }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 30 },
    }),
  );
});
mock.listen(0, "127.0.0.1");
await new Promise((r) => mock.once("listening", r));
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  page = await browser.newPage({ viewport: { width: 1480, height: 1020 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  const e = await api("/demo", {});
  await api(`/exams/${e.id}/attachments`, {
    filename: "202601.pdf",
    mime: "application/pdf",
    studentId: e.students[0].id,
    base64: readFileSync(
      path.resolve("output/tests/fixtures/202601.pdf"),
    ).toString("base64"),
  });
  await api(
    "/settings",
    {
      baseUrl: `http://127.0.0.1:${mock.address().port}`,
      apiKey: "MOCK-ONLY",
      visionModel: "mock-v",
      gradingModel: "mock-g",
      reportModel: "mock-r",
    },
    "PUT",
  );
  await page.goto(base);
  await page.getByRole("button", { name: "阅卷与录分", exact: true }).click();
  await page.getByRole("button", { name: "批量试批", exact: true }).click();
  await page.getByRole("checkbox", { name: /第 1 题 ·/ }).check();
  await page
    .getByRole("checkbox", { name: "仅试批尚未确认最终成绩的题目" })
    .uncheck();
  await page.getByRole("button", { name: "创建试批任务", exact: true }).click();
  await page.getByText("已创建 1 个任务", { exact: false }).waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "批量核对采纳", exact: true }).click();
  await page.locator("dialog input[type=checkbox]").first().check();
  await page.getByRole("button", { name: "采纳所选建议", exact: true }).click();
  await page.getByText("已采纳 1 条", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const next = await api(`/exams/${e.id}`);
  const first = next.questions.find((q) => q.label === "1");
  assert.equal(next.grades[`${e.students[0].id}:${first.id}`].score, 1);
  assert.equal(next.grades[`${e.students[0].id}:${first.id}`].note, "");
  await page.getByRole("button", { name: "班级学情", exact: true }).click();
  await page.getByRole("button", { name: "整理文字备注", exact: true }).click();
  const classification = page
    .locator(".task-row")
    .filter({ hasText: "备注归类" });
  await classification
    .getByRole("button", { name: "查看", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认采用这些归类", exact: true })
    .click();
  await page.getByText("已采用 AI 归类", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "生成 AI 解读", exact: true }).click();
  const reportTask = page.locator(".task-row").filter({ hasText: "学情解读" });
  await reportTask.getByRole("button", { name: "查看", exact: true }).waitFor();
  await page.getByRole("button", { name: "报告归档", exact: true }).click();
  await page
    .getByRole("button", { name: "查看 / 导出", exact: true })
    .first()
    .click();
  await page.locator(".report-summary").waitFor();
  await page.locator(".finding-evidence").getByRole("button").first().click();
  await page.getByRole("dialog", { name: /报告生成时的依据/ }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".report-edit summary").click();
  await page
    .getByLabel("报告总结", { exact: true })
    .fill("教师修订了模拟模型的总结。");
  await page.getByRole("button", { name: "保存为新版本", exact: true }).click();
  await page.getByText("教师修订版", { exact: true }).waitFor();
  await page.screenshot({ path: "output/playwright/ai-report-review.png" });
  assert.deepEqual(errors, []);
  writeFileSync(
    "output/playwright/ai-ui-check.json",
    JSON.stringify(
      {
        ok: true,
        realProvider: false,
        checks: [
          "batch image task",
          "batch score adoption without notes",
          "AI remark classification with source label",
          "AI report",
          "snapshot evidence modal",
          "teacher content revision",
        ],
        rendererErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("AI UI workflows passed against an isolated local mock API.");
} finally {
  await browser.close();
  instance.ai.close();
  while (instance.ai.active) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => server.close(r));
  await new Promise((r) => mock.close(r));
  instance.store.close();
}

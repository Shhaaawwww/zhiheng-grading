import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const out = path.resolve("output/playwright");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1480, height: 1020 },
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = "http://127.0.0.1:4318";
const api = async (route, body) => {
  const r = await context.request.fetch(base + "/api" + route, {
    method: body ? "POST" : "GET",
    headers: { "X-Zhiheng-Client": "desktop" },
    data: body,
  });
  assert.ok(r.ok(), await r.text());
  return r.json();
};
try {
  const sample = await api("/demo", {});
  await page.goto(base);
  await page.getByLabel("当前考试", { exact: true }).selectOption(sample.id);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.screenshot({
    path: path.join(out, "overview.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "阅卷与录分", exact: true }).click();
  await page.getByRole("button", { name: "关联原卷", exact: true }).click();
  await page
    .getByLabel("选择 PDF 或图片")
    .setInputFiles(path.resolve("output/tests/fixtures/202601.pdf"));
  await page.getByRole("button", { name: "保存附件", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "按题阅卷", exact: true }).click();
  await page.getByAltText("202601.pdf 第 1 页").waitFor();
  assert.ok(
    await page
      .getByAltText("202601.pdf 第 1 页")
      .evaluate((el) => el.naturalWidth > 500),
  );
  await page.screenshot({
    path: path.join(out, "grading-with-scan.png"),
    fullPage: true,
  });
  await page
    .getByLabel("简短备注（可选）")
    .fill("界面验收：本条仅为模拟备注。");
  await page.getByRole("button", { name: "下一位", exact: true }).click();
  await page.getByRole("button", { name: "上一位", exact: true }).click();
  assert.equal(
    await page.getByLabel("简短备注（可选）").inputValue(),
    "界面验收：本条仅为模拟备注。",
  );
  await page.getByLabel("简短备注（可选）").fill("");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("已保存到本机", { exact: true }).waitFor();
  await page.getByRole("button", { name: "导入成绩", exact: true }).click();
  await page
    .getByLabel("选择表格文件")
    .setInputFiles(path.resolve("output/tests/fixtures/grades.csv"));
  await page.getByRole("button", { name: "确认导入", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "确认导入", exact: true })
      .isEnabled(),
    false,
  );
  assert.ok((await page.locator("dialog").innerText()).includes("允许替换"));
  await page.screenshot({ path: path.join(out, "import-preview.png") });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "批量备注", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "为 林同学 追加备注", exact: true })
    .check();
  await page
    .getByLabel("追加的简短备注", { exact: true })
    .fill("模拟批量备注验收");
  await page
    .getByRole("button", { name: "确认追加到所选学生", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "修改历史", exact: true }).click();
  const undoResponse = page.waitForResponse(
    (r) => r.url().endsWith("/undo") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "撤销", exact: true }).first().click();
  assert.ok((await undoResponse).ok());
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await page.getByRole("button", { name: "成绩表", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "林同学 第 1 题得分", exact: true })
    .evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "4\t5\n5\t4");
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await page.getByRole("button", { name: "确认导入", exact: true }).waitFor();
  assert.ok((await page.locator("dialog").innerText()).includes("陈同学"));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "班级学情", exact: true }).click();
  await page
    .getByRole("heading", { name: "主要考查知识表现", exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(out, "class-analysis.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "保存基础报告", exact: true }).click();
  await page.locator(".report-sheet").waitFor();
  await page.evaluate(() => {
    window.desktop = {
      exportPdf: async (html) => {
        window.__reportHtml = html;
        return "测试报告";
      },
      openDataFolder: async () => "",
    };
  });
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  const html = await page.evaluate(() => window.__reportHtml);
  assert.ok(html.includes("逐题数据依据"));
  writeFileSync(path.join(out, "class-report.html"), html);
  const print = await context.newPage();
  await print.setContent(html, { waitUntil: "load" });
  await print.pdf({
    path: path.join(out, "class-report.pdf"),
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  await print.close();
  await page
    .getByLabel("教师补充或修订意见")
    .fill("下节课回顾参数分类讨论，并安排两道短题复测。");
  await page.getByRole("button", { name: "保存为新版本", exact: true }).click();
  await page.getByRole("heading", { name: "教师补充", exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "个人学情", exact: true }).click();
  await page.getByRole("button", { name: "保存基础报告", exact: true }).click();
  await page.locator(".report-sheet").waitFor();
  const text = await page.locator(".report-sheet").innerText();
  assert.ok(text.includes("林同学"));
  assert.ok(!text.includes("个人最终得分\n—"));
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  const personal = await page.evaluate(() => window.__reportHtml);
  assert.ok(personal.includes("个人总分"));
  writeFileSync(path.join(out, "student-report.html"), personal);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "报告归档", exact: true }).click();
  await page
    .getByRole("button", { name: "查看 / 导出", exact: true })
    .first()
    .waitFor();
  assert.ok(
    (await page
      .getByRole("button", { name: "查看 / 导出", exact: true })
      .count()) >= 3,
  );
  await page.getByRole("button", { name: "设置与数据", exact: true }).click();
  await page.getByRole("heading", { name: "数据备份与恢复", exact: true }).waitFor();
  assert.ok(
    await page
      .getByRole("button", { name: "导出完整备份", exact: true })
      .isVisible(),
  );
  await page.setViewportSize({ width: 1050, height: 740 });
  await page.getByRole("button", { name: "工作概览", exact: true }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(out, "desktop-1050.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 700, height: 900 });
  assert.ok(
    await page
      .getByRole("button", { name: "阅卷与录分", exact: true })
      .isVisible(),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(out, "compact-700.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "班级与学生", exact: true }).click();
  await page.getByRole("button", { name: "新建班级", exact: true }).click();
  await page.getByRole("dialog", { name: "新建班级", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  writeFileSync(
    path.join(out, "ui-check.json"),
    JSON.stringify(
      {
        ok: true,
        checked: [
          "scan upload and PDF render",
          "teacher draft retained on navigation",
          "score save",
          "import conflict preview",
          "batch remarks and undo",
          "matrix clipboard paste preview",
          "class and student report",
          "versioned teacher notes",
          "PDF report HTML and actual PDF",
          "archive",
          "settings",
          "1050 and 700 px layouts",
          "dialog Escape",
          "no renderer exceptions",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "UI checks passed: scan, grading, import, reports, export, layouts, accessibility.",
  );
} finally {
  await browser.close();
}

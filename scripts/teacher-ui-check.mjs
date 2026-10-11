import { chromium } from "playwright-core";
import { createApp } from "../server/app.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const out = path.resolve("output/playwright/teacher");
const illustrations = path.resolve("public/help");
mkdirSync(out, { recursive: true });
mkdirSync(illustrations, { recursive: true });
mkdirSync("output/tests", { recursive: true });
const instance = createApp({
  dataDir: mkdtempSync(path.resolve("output/tests/teacher-")),
});
const server = instance.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const btn = (name) => page.getByRole("button", { name, exact: true });
const api = async (route, data) => {
  const response = await fetch(base + "/api" + route, {
    method: data ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Zhiheng-Client": "desktop",
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
};
const capture = async (name) => {
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(out, name), fullPage: true });
  // The main PDF-first illustration comes from paper-ui-check.mjs.
  if (name === "prepare.png") return;
  const selector =
    name === "welcome.png"
      ? ".welcome-flow"
      : name === "classes.png"
        ? ".classes-layout .panel"
        : name === "settings.png"
          ? ".settings-panel"
          : ".page-heading";
  const box = await page.locator(selector).first().boundingBox();
  const height =
    name === "welcome.png"
      ? 150
      : name === "settings.png"
        ? box.height
        : name === "classes.png"
          ? Math.min(box.height, 330)
          : 410;
  await page.screenshot({
    path: path.join(illustrations, name),
    clip: { x: box.x, y: box.y, width: box.width, height },
  });
};
try {
  await page.goto(base);
  await page
    .getByRole("heading", { name: "把这次考试，变成下一课的依据" })
    .waitFor();
  await capture("welcome.png");
  assert.equal(await page.locator(".welcome-flow li").count(), 4);
  await btn("先看操作说明").click();
  await page.getByRole("dialog").waitFor();
  assert.ok(
    await page.getByRole("link", { name: "下载图文指南 PDF" }).isVisible(),
  );
  const [guideDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "下载图文指南 PDF" }).click(),
  ]);
  await guideDownload.saveAs(path.join(out, "downloaded-guide.pdf"));
  assert.equal(
    readFileSync(path.join(out, "downloaded-guide.pdf"))
      .subarray(0, 5)
      .toString(),
    "%PDF-",
  );
  await btn("返回刚才的操作").focus();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent),
    "先看操作说明",
  );

  // A teacher can finish a real manual workflow with no service credentials.
  await btn("建立我的班级").click();
  await btn("新建班级").click();
  await page
    .getByLabel("班级名称", { exact: true })
    .fill("上手验收一班（虚构）");
  await page.getByLabel("第 1 位学生学号", { exact: true }).fill("001");
  await page.getByLabel("第 1 位学生姓名", { exact: true }).fill("练习同学");
  await btn("保存班级").click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await btn("为班级创建考试").click();
  await page
    .getByLabel("考试名称", { exact: true })
    .fill("首次使用练习（虚构）");
  await btn("创建考试").click();
  await page.getByRole("heading", { name: "试卷准备", exact: true }).waitFor();
  await btn("添加题目").click();
  await page.getByLabel("题号", { exact: true }).fill("1");
  await page.getByLabel("题干与必要的图形条件").fill("求函数 f(x)=x² 的导数。");
  await page.getByLabel("主要考查知识点", { exact: true }).fill("导数与单调性");
  await page.getByLabel("已核对主要考查知识点", { exact: true }).check();
  await page.getByLabel("最小分数间隔", { exact: true }).selectOption("1");
  await btn("保存题目").click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await btn("工作概览").click();
  await btn("去录成绩").waitFor();
  await btn("去录成绩").click();
  await page.getByLabel("练习同学 第 1 题得分", { exact: true }).fill("3");
  await page.getByLabel("练习同学 第 1 题得分", { exact: true }).press("Enter");
  await page.getByText("已保存到本机", { exact: true }).waitFor();
  await btn("按题阅卷").click();
  await page
    .getByLabel("简短备注（可选）")
    .fill("练习备注：求导符号写错，保存前查看帮助。");
  await btn("本页怎么用").click();
  await page
    .getByRole("heading", { name: "3 · 录入逐题成绩", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByLabel("简短备注（可选）").inputValue(),
    "练习备注：求导符号写错，保存前查看帮助。",
  );
  await btn("保存").click();
  await page.getByText("已保存到本机", { exact: true }).waitFor();
  await btn("工作概览").click();
  await btn("去看学情").click();
  await btn("保存基础报告").click();
  await page.locator(".report-sheet").waitFor();
  await btn("关闭").click();

  // Creating an exam from a selected classroom must not choose the first classroom.
  await btn("班级与学生").click();
  await btn("新建班级").click();
  await page
    .getByLabel("班级名称", { exact: true })
    .fill("上手验收二班（虚构）");
  await page.getByLabel("第 1 位学生学号", { exact: true }).fill("002");
  await page.getByLabel("第 1 位学生姓名", { exact: true }).fill("示意同学");
  await btn("保存班级").click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await btn("为班级创建考试").click();
  assert.match(
    await page
      .getByLabel("班级", { exact: true })
      .locator("option:checked")
      .textContent(),
    /上手验收二班/,
  );
  await page.keyboard.press("Escape");

  // Capture explicitly marked demo data for the teacher guide.
  const demo = await api("/demo", {});
  await page.reload();
  await page.getByLabel("当前考试", { exact: true }).selectOption(demo.id);
  await btn("班级与学生").click();
  await page.locator(".class-card").filter({ hasText: "示例" }).click();
  await capture("classes.png");
  await btn("试卷准备").click();
  await page
    .getByRole("heading", { name: "题目与知识点", exact: true })
    .waitFor();
  await capture("prepare.png");
  await btn("阅卷与录分").click();
  await page.locator(".score-cell").first().waitFor();
  await capture("grade.png");
  await btn("班级学情").click();
  await btn("保存基础报告").waitFor();
  await capture("reports.png");
  await btn("设置与数据").click();
  assert.equal(await page.locator(".optional-ai").getAttribute("open"), null);
  assert.ok(await btn("导出完整备份").isVisible());
  await capture("settings.png");
  await page.locator(".optional-ai > summary").click();
  await page
    .getByLabel("1. 服务地址", { exact: true })
    .fill("https://example.invalid/v1");
  await page
    .getByLabel("2. 访问密钥", { exact: true })
    .fill("test-key-not-real");
  await page
    .getByLabel("3. 模型名称", { exact: true })
    .fill("teacher-demo-model");
  await btn("保存设置").click();
  await page
    .getByText(
      "连接信息已保存，尚未验证服务是否可用。请到“试卷准备”导入一份样卷，点击“开始整卷识别”检查结果。",
      { exact: true },
    )
    .waitFor();
  const config = await api("/settings");
  assert.deepEqual(
    [config.visionModel, config.gradingModel, config.reportModel],
    Array(3).fill("teacher-demo-model"),
  );
  assert.equal((await api("/usage")).counter?.count || 0, 0);
  await page
    .getByLabel("各项智能辅助使用同一个模型（通常选这一项）", { exact: true })
    .uncheck();
  await page
    .getByLabel("辅助阅卷模型", { exact: true })
    .fill("separate-grading-model");
  const savedModels = page.waitForResponse(
    (r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT",
  );
  await btn("保存设置").click();
  assert.ok((await savedModels).ok());
  await page.reload();
  await btn("设置与数据").click();
  await page.locator(".optional-ai > summary").click();
  assert.equal(
    await page.getByLabel("辅助阅卷模型", { exact: true }).inputValue(),
    "separate-grading-model",
  );
  await btn("使用帮助").click();
  await page
    .getByRole("navigation", { name: "帮助目录" })
    .getByRole("button", { name: "常见问题", exact: true })
    .click();
  await page.getByText("为什么有成绩却没有总分？", { exact: true }).click();
  assert.ok(
    await page
      .getByText("先检查该学生是否有空白", { exact: false })
      .isVisible(),
  );
  await page.screenshot({ path: path.join(out, "help-faq.png") });
  await page.keyboard.press("Escape");
  for (const size of [
    { width: 1050, height: 740 },
    { width: 700, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await btn("使用帮助").click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    );
    assert.ok(
      await page
        .locator("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await page.screenshot({ path: path.join(out, `help-${size.width}.png`) });
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    path.join(out, "checks.json"),
    JSON.stringify(
      {
        ok: true,
        realProvider: false,
        checks: [
          "empty workspace onboarding",
          "manual create-class to report without API",
          "correct selected classroom",
          "help preserves unsaved grade form and restores focus",
          "context-specific guidance and next step",
          "collapsed optional AI and three-field configuration",
          "distinct models survive reload",
          "saving settings makes no provider calls",
          "FAQ and responsive keyboard-accessible help",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Teacher onboarding, manual workflow, context help and settings checks passed.",
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
    .catch(() => {});
  writeFileSync(
    path.join(out, "failure.txt"),
    `${error.stack}\n${await page
      .locator("body")
      .innerText()
      .catch(() => "")}\nRenderer errors: ${JSON.stringify(errors)}`,
  );
  throw error;
} finally {
  await browser.close();
  instance.ai.close();
  await new Promise((r) => server.close(r));
  instance.store.db.close();
}

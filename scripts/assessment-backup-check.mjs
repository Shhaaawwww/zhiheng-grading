// Restore only the isolated live-test workspace, preserving its previous state first.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright-core";
import { createApp } from "../server/app.mjs";
const out = path.resolve("output/real-api/release-030"),
  stage = process.argv[2] || "after-variants";
assert.ok(["before-variants", "after-variants"].includes(stage));
const backup = path.join(out, "before-scan-variants.zhb"),
  bytes = fs.readFileSync(backup),
  raw = JSON.parse(gunzipSync(bytes));
const instance = createApp({ dataDir: path.join(out, "workspace") }),
  server = instance.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`,
  browser = await chromium.launch({ channel: "chrome", headless: true }),
  page = await browser.newPage();
try {
  const old = await fetch(base + "/api/backup");
  fs.writeFileSync(
    path.join(out, stage + "-preserved-workspace.zhb"),
    Buffer.from(await old.arrayBuffer()),
  );
  await page.goto(base);
  await page.getByRole("button", { name: "设置与数据", exact: true }).click();
  await page.getByLabel("选择备份恢复", { exact: true }).setInputFiles(backup);
  const dialog = page.getByRole("dialog", { name: "恢复备份预览" });
  await dialog.waitFor();
  await dialog
    .getByLabel("输入“恢复备份”以确认", { exact: true })
    .fill("恢复备份");
  await dialog.getByRole("button", { name: "恢复并替换", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  let grades = 0,
    events = 0;
  for (const row of raw.records.filter((r) => r.kind === "exams")) {
    const before = JSON.parse(row.json),
      after = instance.store.get("exams", row.id);
    for (const key of ["grades", "questions", "answerMaps", "evaluations"])
      assert.deepEqual(after[key], before[key], key);
    grades += Object.keys(after.grades).length;
    events += Object.keys(after.evaluations || {}).length;
  }
  fs.writeFileSync(
    path.join(out, stage + "-backup-check.json"),
    JSON.stringify(
      {
        ok: true,
        gradesPreserved: grades,
        evaluationsPreserved: events,
        restoredThroughTeacherUI: true,
      },
      null,
      2,
    ),
  );
  console.log("BACKUP UI PASS", stage, grades, events);
} finally {
  await browser.close();
  instance.ai.close();
  server.close();
  instance.store.close();
}

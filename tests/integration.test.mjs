import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createApp } from "../server/app.mjs";
import { Question, keyOf } from "../server/domain.mjs";
const root = path.resolve("output/tests");
mkdirSync(root, { recursive: true });
test("local application end to end: grade, import conflict, undo, immutable report, AI adoption, backup restore", async (t) => {
  const instance = createApp({ dataDir: mkdtempSync(path.join(root, "run-")) });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const api = async (route, body, method = body ? "POST" : "GET") => {
    const r = await fetch(url + "/api" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Zhiheng-Client": "desktop",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!r.ok) throw Object.assign(Error(j.error), { status: r.status });
    return j;
  };
  t.after(async () => {
    instance.ai.close();
    while (instance.ai.active) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => server.close(r));
    instance.store.close();
  });
  assert.equal((await api("/health")).ok, true);
  assert.equal(
    (
      await fetch(url + "/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url + "/api/bootstrap", {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  const c = await api("/classes", {
    name: "测试班",
    students: [
      { name: "甲同学", number: "001" },
      { name: "乙同学", number: "002" },
    ],
  });
  let e = await api("/exams", {
    classId: c.id,
    name: "测试考试",
    date: "2026-09-08",
  });
  const q = Question.parse({
    id: "q",
    label: "1",
    stem: "2+2=?",
    max: 5,
    step: 1,
    primary: "函数性质",
    confirmed: true,
    answer: "4",
    rubric: "正确得5分",
  });
  e = await api(
    `/exams/${e.id}/questions`,
    { questions: [q], revision: e.revision },
    "PUT",
  );
  const [s1, s2] = e.students;
  const g = (s, score) => ({
    studentId: s.id,
    questionId: q.id,
    status: "final",
    score,
    note: "",
    tags: [],
    source: "teacher",
  });
  e = await api(`/exams/${e.id}/grades`, { grades: [g(s1, 0)] }, "PUT");
  assert.equal(e.analysis.average, 0);
  assert.equal(e.analysis.complete, 1);
  assert.equal(e.analysis.students[1].total, null);
  const report = await api(`/exams/${e.id}/reports`, {}),
    oldhash = report.snapshotHash;
  const preview = await api("/imports/preview", {
    kind: "grades",
    examId: e.id,
    filename: "成绩.csv",
    base64: Buffer.from("学号,1\n001,5\n002,4").toString("base64"),
  });
  assert.equal(preview.conflicts, 1);
  await assert.rejects(() => api(`/imports/${preview.id}/apply`, {}), /替换/);
  await api(`/imports/${preview.id}/apply`, { replace: true });
  e = await api(`/exams/${e.id}`);
  assert.equal(e.analysis.average, 4.5);
  const old = await api(`/reports/${report.id}`);
  assert.equal(old.snapshotHash, oldhash);
  assert.equal(old.display.analysis.average, 0);
  const edit = await api(
    `/reports/${report.id}`,
    { teacherText: "补充课堂观察" },
    "PATCH",
  );
  assert.notEqual(edit.id, report.id);
  assert.equal((await api(`/reports/${report.id}`)).teacherText, null);
  const audit = await api(`/exams/${e.id}/audit`);
  await api(`/exams/${e.id}/undo`, { auditId: audit[0].id });
  e = await api(`/exams/${e.id}`);
  assert.equal(e.analysis.average, 0);
  await assert.rejects(
    () => api(`/imports/${preview.id}/apply`, { replace: true }),
    /已经完成/,
  );
  const stale = await api("/imports/preview", {
    kind: "grades",
    examId: e.id,
    filename: "scores.csv",
    base64: Buffer.from("学号,1\n001,3").toString("base64"),
  });
  await api(`/exams/${e.id}/grades`, { grades: [g(s2, 4)] }, "PUT");
  await assert.rejects(
    () => api(`/imports/${stale.id}/apply`, { replace: true }),
    /数据已变化/,
  );
  const exported = await fetch(url + `/api/classes/${c.id}/export`);
  assert.equal(exported.status, 200);
  assert.ok((await exported.arrayBuffer()).byteLength > 1000);
  const received = [];
  let modelScore = 3;
  const mock = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: modelScore,
                note: "建议备注",
                tags: ["运算错误"],
                uncertainty: "",
                justification: "INTERNAL-REASONING",
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 40 },
      }),
    );
  });
  mock.listen(0, "127.0.0.1");
  await new Promise((r) => mock.once("listening", r));
  t.after(() => new Promise((r) => mock.close(r)));
  await api(
    "/settings",
    {
      baseUrl: `http://127.0.0.1:${mock.address().port}/v1`,
      apiKey: "MOCK-KEY-NOT-REAL",
      gradingModel: "mock-vision",
      reportModel: "mock-text",
      visionModel: "mock-vision",
    },
    "PUT",
  );
  const wait = async (id) => {
    for (let i = 0; i < 150; i++) {
      const task = (await api("/tasks")).find((t) => t.id === id);
      if (!["running", "queued"].includes(task.status)) return task;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("task timed out");
  };
  const payload = {
    questionId: q.id,
    studentId: s1.id,
    images: ["data:image/png;base64,iVBORw0KGgo="],
  };
  let task = await api(`/exams/${e.id}/tasks`, { kind: "grade", payload });
  task = await wait(task.id);
  assert.equal(task.status, "succeeded");
  assert.equal(
    (await api(`/exams/${e.id}`)).grades[keyOf(s1.id, q.id)].score,
    0,
  );
  e = await api(`/tasks/${task.id}/adopt`, { includeNote: false });
  assert.equal(e.grades[keyOf(s1.id, q.id)].score, 3);
  assert.equal(e.grades[keyOf(s1.id, q.id)].note, "");
  assert.equal(e.grades[keyOf(s1.id, q.id)].source, "ai");
  await assert.rejects(() => api(`/tasks/${task.id}/adopt`, {}), /不可采纳/);
  task = await api(`/exams/${e.id}/tasks`, { kind: "grade", payload });
  task = await wait(task.id);
  await api(`/exams/${e.id}/grades`, { grades: [g(s1, 5)] }, "PUT");
  await assert.rejects(
    () => api(`/tasks/${task.id}/adopt`, { includeNote: true }),
    /已变化/,
  );
  modelScore = 999;
  task = await api(`/exams/${e.id}/tasks`, { kind: "grade", payload });
  task = await wait(task.id);
  assert.equal(task.status, "failed");
  assert.equal(
    (await api(`/exams/${e.id}`)).grades[keyOf(s1.id, q.id)].score,
    5,
  );
  assert.equal((await api("/usage")).entries.length, 3);
  assert.ok(
    !JSON.stringify(await api("/bootstrap")).includes("MOCK-KEY-NOT-REAL"),
  );
  const backup = Buffer.from(
    await (await fetch(url + "/api/backup")).arrayBuffer(),
  );
  assert.ok(!gunzipSync(backup).toString().includes("MOCK-KEY-NOT-REAL"));
  const bp = await api("/backup/preview", {
    base64: backup.toString("base64"),
  });
  assert.equal(bp.classes, 1);
  await api("/classes", { name: "之后新增班级", students: [] });
  assert.equal((await api("/bootstrap")).classes.length, 2);
  await api("/backup/restore", {
    base64: backup.toString("base64"),
    confirm: "恢复备份",
  });
  assert.equal((await api("/bootstrap")).classes.length, 1);
  assert.equal(
    (await api(`/exams/${e.id}`)).grades[keyOf(s1.id, q.id)].score,
    5,
  );
  assert.ok(readdirSync(path.join(instance.store.dir, "recovery")).length > 0);
});

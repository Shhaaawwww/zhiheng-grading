import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createApp } from "../server/app.mjs";
import { Question, keyOf, analysisInput } from "../server/domain.mjs";
test("AI extraction page mapping, parent context, classification adoption and report snapshot cache", async (t) => {
  const dir = path.resolve("output/tests");
  mkdirSync(dir, { recursive: true });
  const instance = createApp({ dataDir: mkdtempSync(path.join(dir, "ai-")) }),
    server = instance.app.listen(0, "127.0.0.1");
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
    const v = await r.json();
    if (!r.ok) throw Error(v.error);
    return v;
  };
  const requests = [];
  let reply = {};
  const mock = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    requests.push(JSON.parse(raw));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { content: JSON.stringify(reply) },
            finish_reason: "stop",
          },
        ],
      }),
    );
  });
  mock.listen(0, "127.0.0.1");
  await new Promise((r) => mock.once("listening", r));
  t.after(async () => {
    instance.ai.close();
    while (instance.ai.active) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => server.close(r));
    await new Promise((r) => mock.close(r));
    instance.store.close();
  });
  const c = await api("/classes", {
      name: "高中数学测试",
      students: [{ number: "001", name: "匿名测试学生" }],
    }),
    e = await api("/exams", {
      classId: c.id,
      name: "题面工作流",
      date: "2026-09-08",
    });
  await api(
    "/settings",
    {
      baseUrl: `http://127.0.0.1:${mock.address().port}`,
      apiKey: "local-mock",
      visionModel: "v",
      gradingModel: "g",
      reportModel: "r",
    },
    "PUT",
  );
  const wait = async (task) => {
    for (let i = 0; i < 100; i++) {
      const t = (await api("/tasks")).find((t) => t.id === task.id);
      if (!["running", "queued"].includes(t.status)) return t;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw Error("timeout");
  };
  reply = {
    questions: [
      {
        label: "19",
        type: "group",
        stem: "公共条件：f(x)=x^2-a*x",
        max: 10,
        page: 1,
      },
      {
        label: "19(1)",
        parentLabel: "19",
        stem: "求函数单调区间",
        max: 10,
        primary: "函数性质",
        page: 1,
      },
    ],
  };
  let task = await wait(
    await api(`/exams/${e.id}/tasks`, {
      kind: "extract",
      payload: { images: ["data:image/png;base64,iVBORw0KGgo="], pages: [5] },
    }),
  );
  assert.equal(task.status, "succeeded");
  assert.equal(task.result.questions[1].page, 5);
  let exam = await api(`/tasks/${task.id}/adopt`, { replace: true });
  assert.equal(exam.questions[1].confirmed, false);
  const q = exam.questions.find((q) => q.type !== "group"),
    s = exam.students[0];
  assert.equal(analysisInput(exam).questions[0].parentContext, undefined);
  assert.equal(analysisInput(exam).questions[0].stem, undefined);
  exam = await api(
    `/exams/${e.id}/grades`,
    {
      grades: [
        {
          studentId: s.id,
          questionId: q.id,
          score: 4,
          status: "final",
          note: "求导计算有误",
          tags: [],
          source: "teacher",
        },
      ],
    },
    "PUT",
  );
  reply = { items: [{ ref: `S001:${q.id}`, categories: ["运算错误"] }] };
  task = await wait(await api(`/exams/${e.id}/tasks`, { kind: "classify" }));
  assert.equal(task.status, "succeeded");
  assert.ok(!JSON.stringify(requests.at(-1)).includes("匿名测试学生"));
  assert.ok(!JSON.stringify(requests.at(-1)).includes(s.id));
  assert.equal((await api(`/exams/${e.id}`)).analysis.remarks.length, 0);
  exam = await api(`/tasks/${task.id}/adopt`, {});
  assert.equal(exam.grades[keyOf(s.id, q.id)].source, "teacher");
  assert.equal(exam.grades[keyOf(s.id, q.id)].score, 4);
  assert.equal(exam.analysis.remarks[0].source, "ai");
  assert.deepEqual(analysisInput(exam).finalResults[0].grades[0].aiTags, [
    "运算错误",
  ]);
  reply = {
    summary: "需要继续检查对应题组",
    findings: [
      {
        title: "复核运算",
        observation: "已有备注记录了计算问题",
        evidence: [q.id],
        remarkRefs: [`S001:${q.id}`],
        certainty: "recorded",
        action: "回看计算步骤",
        check: "安排一道短题",
      },
    ],
  };
  const before = requests.length;
  task = await wait(
    await api(`/exams/${e.id}/tasks`, {
      kind: "report",
      payload: { studentId: s.id },
    }),
  );
  assert.equal(task.status, "succeeded");
  const cached = await api(`/exams/${e.id}/tasks`, {
    kind: "report",
    payload: { studentId: s.id },
  });
  assert.equal(cached.id, task.id);
  assert.equal(cached.cached, true);
  assert.equal(requests.length, before + 1);
  const report = await api(`/reports/${task.result.reportId}`);
  const revised = await api(
    `/reports/${report.id}`,
    {
      teacherText: "",
      content: { ...report.content, summary: "教师修订后的总结" },
    },
    "PATCH",
  );
  assert.equal(revised.editedByTeacher, true);
  assert.equal(revised.content.summary, "教师修订后的总结");
  assert.equal(
    (await api(`/reports/${report.id}`)).content.summary,
    report.content.summary,
  );
  exam = await api(
    `/exams/${e.id}/grades`,
    { grades: [{ ...exam.grades[keyOf(s.id, q.id)], note: "表达需要规范" }] },
    "PUT",
  );
  assert.deepEqual(exam.grades[keyOf(s.id, q.id)].aiTags, []);
  assert.equal(exam.analysis.remarks.length, 0);
  assert.equal(report.snapshot.finalResults[0].grades[0].note, "求导计算有误");
});

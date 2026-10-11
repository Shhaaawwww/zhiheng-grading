import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { Store } from "./store.mjs";
import { AIManager, validateReport } from "./ai.mjs";
import { recordedNotes } from './report-contract.mjs';
import { acceptPaper } from "./paper.mjs";
import { registerTeachingRoutes, reportState } from "./teaching.mjs";
import { registerAssessmentRoutes, validateAssessmentData } from './assessment-routes.mjs';
import {
  id,
  now,
  fail,
  Student,
  Question,
  Grade,
  TOPICS,
  ERROR_TAGS,
  leaves,
  keyOf,
  analyze,
  updateGrades,
  updateQuestions,
  validateQuestions,
  validateGrade,
  analysisInput,
  snapshotHash,
  basicReport,
} from "./domain.mjs";
import { createDemo } from "./demo.mjs";
import {
  readSheet,
  previewGrades,
  previewRoster,
  workbook,
} from "./imports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const summary = (e) => ({
  id: e.id,
  name: e.name,
  classId: e.classId,
  className: e.className,
  date: e.date,
  demo: e.demo,
  revision: e.revision,
  studentCount: e.students.length,
  questionCount: leaves(e).length,
  updatedAt: e.updatedAt,
});
function revision(exam, value) {
  if (value !== undefined && exam.revision !== value)
    fail("数据已变化，请刷新后再执行，避免覆盖新的成绩。", 409);
}
function validateBackup(raw) {
  const b = z
    .object({
      format: z.literal("zhiheng-backup"),
      version: z.literal(1),
      records: z
        .array(
          z.object({
            kind: z.enum([
              "classes",
              "exams",
              "audit",
              "tasks",
              "reports",
              "usage",
              "imports",
              "drafts",
            ]),
            id: z.string(),
            json: z.string(),
          }),
        )
        .max(100000),
      attachments: z
        .array(
          z.object({ id: z.string(), json: z.string(), bytes: z.string() }),
        )
        .max(20000),
    })
    .parse(raw);
  const seen = new Set();
  for (const r of b.records) {
    const value = JSON.parse(r.json);
    if (value.id !== r.id) fail("备份中的记录标识不一致。");
    const key = r.kind + ":" + r.id;
    if (seen.has(key)) fail("备份包含重复记录。");
    seen.add(key);
    if (r.kind === "exams") {
      z.array(Student).max(1000).parse(value.students);
      value.questions = validateQuestions(value.questions);
      validateAssessmentData(value);
      if (!Number.isInteger(value.revision) || value.revision < 0)
        fail("备份版本字段无效。");
      for (const [k, g] of Object.entries(value.grades)) {
        const checked = validateGrade(value, g);
        if (checked.status !== g.status) fail("备份中存在满分未核对的正式成绩，请先核对原资料。");
        if (k !== keyOf(g.studentId, g.questionId)) fail("备份成绩标识无效。");
      }
    }
    if (r.kind === "classes") z.array(Student).max(1000).parse(value.students);
  }
  const files = new Set();
  for (const f of b.attachments) {
    if (files.has(f.id) || JSON.parse(f.json).id !== f.id)
      fail("备份附件标识无效。");
    files.add(f.id);
    if (Buffer.from(f.bytes, "base64").length > 35 * 1024 * 1024)
      fail("备份中有过大的附件。");
  }
  for (const r of b.records.filter((r) => r.kind === "exams")) {
    const e = JSON.parse(r.json);
    if (!seen.has("classes:" + e.classId)) fail("备份中考试对应的班级不存在。");
    for (const a of e.attachments || [])
      if (!files.has(a.id)) fail("备份缺少考试附件。");
  }
  return b;
}
export function createApp(options = {}) {
  const store = new Store(options.dataDir || path.join(root, ".data")),
    ai = new AIManager(store, options.crypto),
    app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const host = req.headers.host?.split(":")[0];
    if (!["127.0.0.1", "localhost", "["].includes(host))
      return res.status(403).json({ error: "仅允许本机访问。" });
    const origin = req.headers.origin;
    if (origin) {
      let u;
      try {
        u = new URL(origin);
      } catch {
        return res.status(403).end();
      }
      if (
        ![
          "http://127.0.0.1:5173",
          "http://localhost:5173",
          `http://${req.headers.host}`,
        ].includes(u.origin)
      )
        return res.status(403).json({ error: "不允许的来源。" });
    }
    if (
      req.path.startsWith("/api") &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-zhiheng-client"] !== "desktop"
    )
      return res.status(403).json({ error: "请求来源校验失败。" });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "260mb" }));
  registerTeachingRoutes(app, store);
  registerAssessmentRoutes(app, store);
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, version: "0.3.0" }),
  );
  app.get("/api/bootstrap", (_req, res) =>
    res.json({
      classes: store.list("classes"),
      exams: store.list("exams").map(summary),
      topics: TOPICS,
      tags: ERROR_TAGS,
      settings: ai.publicConfig(),
      dataDir: store.dir,
    }),
  );
  app.post("/api/demo", (_req, res) => res.json(createDemo(store)));
  app.post("/api/classes", (req, res) => {
    const v = z
      .object({
        name: z.string().trim().min(1).max(100),
        grade: z.string().max(40).default("高中"),
        students: z
          .array(
            z.object({
              number: z.string().trim().min(1).max(80),
              name: z.string().trim().min(1).max(80),
            }),
          )
          .max(1000)
          .default([]),
      })
      .parse(req.body);
    if (new Set(v.students.map((s) => s.number)).size !== v.students.length)
      fail("学号重复。");
    res.json(
      store.put("classes", {
        id: id(),
        ...v,
        students: v.students.map((s) => ({ ...s, id: id() })),
        createdAt: now(),
        demo: false,
      }),
    );
  });
  app.patch("/api/classes/:id", (req, res) => {
    const c = store.get("classes", req.params.id);
    const v = z
      .object({
        name: z.string().trim().min(1).max(100),
        grade: z.string().max(40),
        students: z.array(Student).max(1000),
      })
      .parse(req.body);
    if (
      new Set(v.students.map((s) => s.number)).size !== v.students.length ||
      new Set(v.students.map((s) => s.id)).size !== v.students.length
    )
      fail("名单有重复学号或标识。");
    res.json(store.put("classes", { ...c, ...v }));
  });
  app.post("/api/exams", (req, res) => {
    const v = z
        .object({
          classId: z.string(),
          name: z.string().trim().min(1).max(120),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .parse(req.body),
      c = store.get("classes", v.classId);
    if (!c.students.length) fail("请先在班级中添加学生。");
    const exam = {
      id: id(),
      ...v,
      className: c.name,
      students: c.students,
      questions: [],
      grades: {},
      attachments: [],
      revision: 1,
      demo: !!c.demo,
      plan: "",
      createdAt: now(),
      updatedAt: now(),
    };
    res.json(store.put("exams", exam));
  });
  app.get("/api/exams/:id", (req, res) => {
    const e = store.get("exams", req.params.id);
    res.json({ ...e, analysis: analyze(e) });
  });
  app.patch("/api/exams/:id", (req, res) => {
    const e = store.get("exams", req.params.id);
    revision(e, req.body.revision);
    const v = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        plan: z.string().max(20000).optional(),
      })
      .parse(req.body);
    res.json(
      store.put("exams", {
        ...e,
        ...v,
        revision: e.revision + 1,
        updatedAt: now(),
      }),
    );
  });
  app.put("/api/exams/:id/questions", (req, res) => {
    const e = store.get("exams", req.params.id);
    revision(e, req.body.revision);
    const next = updateQuestions(e, req.body.questions);
    store.transaction(() => {
      store.put("exams", next);
      store.audit(e.id, "修改试卷模板", e.questions, next.questions);
    });
    res.json({ ...next, analysis: analyze(next) });
  });
  app.put("/api/exams/:id/grades", (req, res) => {
    const e = store.get("exams", req.params.id);
    const inputs = z.array(Grade).min(1).max(30000).parse(req.body.grades);
    if (req.body.revision !== undefined) revision(e, req.body.revision);
    const next = updateGrades(e, inputs, "teacher");
    const keys = inputs.map((g) => keyOf(g.studentId, g.questionId));
    store.transaction(() => {
      store.put("exams", next);
      store.audit(
        e.id,
        "教师录分",
        keys.map((k) => e.grades[k] || null),
        keys.map((k) => next.grades[k]),
      );
    });
    res.json({ ...next, analysis: analyze(next) });
  });
  app.get("/api/exams/:id/audit", (req, res) =>
    res.json(
      store
        .list("audit")
        .filter((a) => a.examId === req.params.id)
        .slice(0, 100),
    ),
  );
  app.post("/api/exams/:id/undo", (req, res) => {
    const e = store.get("exams", req.params.id),
      a = store.get("audit", req.body.auditId);
    if (
      a.examId !== e.id ||
      ![
        "教师录分",
        "导入成绩",
        "采纳 AI 评分",
        "撤销录分",
        "采纳 AI 备注归类",
      ].includes(a.action)
    )
      fail("此记录不支持撤销。");
    const equal = (x, y) =>
      JSON.stringify(x || null) === JSON.stringify(y || null);
    for (const g of a.after)
      if (!equal(e.grades[keyOf(g.studentId, g.questionId)], g))
        fail("相关成绩后来已经修改，无法直接撤销。");
    const inputs = a.after.map(
        (g, i) =>
          a.before[i] || {
            ...g,
            score: null,
            status: "ungraded",
            note: "",
            tags: [],
          },
      ),
      next = updateGrades(e, inputs, "teacher");
    store.transaction(() => {
      store.put("exams", next);
      store.audit(
        e.id,
        "撤销录分",
        a.after,
        inputs.map((g) => next.grades[keyOf(g.studentId, g.questionId)]),
      );
    });
    res.json({ ...next, analysis: analyze(next) });
  });
  app.post("/api/imports/preview", async (req, res) => {
    const v = z
      .object({
        kind: z.enum(["grades", "roster"]),
        examId: z.string().optional(),
        classId: z.string().optional(),
        filename: z.string(),
        base64: z.string().max(36_000_000),
      })
      .parse(req.body);
    const rows = await readSheet(v.filename, v.base64);
    let preview;
    if (v.kind === "grades") {
      const e = store.get("exams", v.examId);
      preview = { ...previewGrades(e, rows), examId: e.id };
    } else {
      const c = store.get("classes", v.classId);
      preview = {
        ...previewRoster(c.students, rows),
        classId: c.id,
        rosterHash: snapshotHash(c.students),
      };
    }
    preview = { ...preview, id: id(), createdAt: now() };
    store.put("imports", preview);
    res.json(preview);
  });
  app.post("/api/imports/:id/apply", (req, res) => {
    const p = store.get("imports", req.params.id);
    if (p.applied) fail("此批导入已经完成。");
    if (p.errors.length) fail("请修正导入错误后重新预览。");
    if (p.kind === "grades") {
      const e = store.get("exams", p.examId);
      revision(e, p.revision);
      if (p.conflicts && !req.body.replace)
        fail("存在旧成绩，请明确选择允许替换后再导入。");
      const next = updateGrades(e, p.changes, "import"),
        keys = p.changes.map((g) => keyOf(g.studentId, g.questionId));
      store.transaction(() => {
        store.put("exams", next);
        store.audit(
          e.id,
          "导入成绩",
          keys.map((k) => e.grades[k] || null),
          keys.map((k) => next.grades[k]),
        );
        store.put("imports", { ...p, applied: true });
      });
      res.json({ exam: next, count: p.changes.length });
    } else {
      const c = store.get("classes", p.classId);
      if (snapshotHash(c.students) !== p.rosterHash)
        fail("名单已变化，请重新预览。");
      store.transaction(() => {
        store.put("classes", {
          ...c,
          students: [...c.students, ...p.students],
        });
        store.put("imports", { ...p, applied: true });
      });
      res.json({ count: p.students.length });
    }
  });
  app.get("/api/exams/:id/export", async (req, res) => {
    const e = store.get("exams", req.params.id),
      mode = ["long", "template", "grades"].includes(req.query.mode)
        ? req.query.mode
        : "grades";
    const bytes = await workbook(e, mode);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="grades.xlsx"; filename*=UTF-8''${encodeURIComponent(e.name + "-" + mode + ".xlsx")}`,
    );
    res.send(bytes);
  });
  app.get("/api/classes/:id/export", async (req, res) => {
    const c = store.get("classes", req.params.id);
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(await workbook(c, "roster"));
  });
  app.post("/api/exams/:id/attachments", (req, res) => {
    const e = store.get("exams", req.params.id),
      v = z
        .object({
          filename: z.string().min(1).max(240),
          mime: z.enum([
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/webp",
          ]),
          base64: z.string().max(48_000_000),
          studentId: z.string().nullable().default(null),
          role: z.enum(['paper','reference','student']).optional(),
        })
        .parse(req.body);
    if (v.studentId && !e.students.some((s) => s.id === v.studentId))
      fail("附件学生不存在。");
    const bytes = Buffer.from(v.base64, "base64");
    if (bytes.length > 35 * 1024 * 1024) fail("单份附件最大 35 MB。");
    const ok =
      v.mime === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : v.mime === "image/png"
          ? bytes.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71]))
          : v.mime === "image/jpeg"
            ? bytes[0] === 255 && bytes[1] === 216
            : bytes.subarray(0, 4).toString() === "RIFF" &&
              bytes.subarray(8, 12).toString() === "WEBP";
    if (!ok) fail("文件内容与格式不一致。");
    const meta = {
      id: id(),
      examId: e.id,
      studentId: v.studentId,
      role: v.studentId ? 'student' : (v.role === 'reference' ? 'reference' : 'paper'),
      name: v.filename,
      mime: v.mime,
      size: bytes.length,
      createdAt: now(),
    };
    store.transaction(() => {
      store.attachment(meta, bytes);
      store.put("exams", {
        ...e,
        attachments: [...e.attachments, meta],
        updatedAt: now(),
      });
    });
    res.json(meta);
  });
  app.get("/api/files/:id", (req, res) => {
    const f = store.file(req.params.id);
    res.type(f.mime);
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    );
    res.send(f.bytes);
  });
  app.get("/api/settings", (_req, res) => res.json(ai.publicConfig()));
  app.put("/api/settings", (req, res) => res.json(ai.saveConfig(req.body)));
  app.get("/api/usage", (_req, res) =>
    res.json({
      entries: store.list("usage").slice(0, 500),
      counter: store.setting("callCounter"),
    }),
  );
  app.get("/api/tasks", (req, res) =>
    res.json(
      store
        .list("tasks")
        .filter((t) => !req.query.examId || t.examId === req.query.examId)
        .map((t) => ai.publicTask(t)),
    ),
  );
  app.post("/api/exams/:id/tasks", (req, res) =>
    res.json(
      ai.enqueue(
        store.get("exams", req.params.id),
        req.body.kind,
        req.body.payload,
      ),
    ),
  );
  app.post("/api/tasks/:id/cancel", (req, res) =>
    res.json(ai.cancel(req.params.id)),
  );
  app.post("/api/tasks/:id/retry", (req, res) => {
    const t = store.get("tasks", req.params.id);
    if (!["failed", "interrupted", "cancelled", "partial"].includes(t.status))
      fail("此任务无需重试。");
    res.json(ai.enqueue(store.get("exams", t.examId), t.kind, { ...t.payload, resumeBatches: t.result?.batches || t.payload.resumeBatches }));
  });
  app.post("/api/tasks/:id/adopt", (req, res) => {
    const t = store.get("tasks", req.params.id);
    if ((!['succeeded', 'partial', 'failed', 'cancelled', 'interrupted'].includes(t.status) || (t.status !== 'succeeded' && !t.payload.wholePaper)) || t.adoptedAt)
      fail("该结果不可采纳或已经采纳。");
    const e = store.get("exams", t.examId);
    if (t.kind !== "grade") revision(e, t.revision);
    else {
      const current = leaves(e).find((q) => q.id === t.payload.questionId);
      if (
        snapshotHash(current) !== snapshotHash(t.payload.question) ||
        JSON.stringify(
          e.grades[keyOf(t.payload.studentId, t.payload.questionId)] || null,
        ) !== JSON.stringify(t.payload.previous)
      )
        fail("此题或此学生的成绩已变化，请重新试批，原成绩未覆盖。", 409);
    }
    let next;
    if (t.kind === "classify") {
      const inputs = t.result.items.map((item) => {
        const prior = t.payload.notes.find((n) => n.ref === item.ref);
        const g = e.grades[keyOf(item.studentId, item.questionId)];
        if (JSON.stringify(g) !== JSON.stringify(prior.previous))
          fail("部分备注或成绩已变化，请重新归类。", 409);
        return { ...g, aiTags: [...new Set(item.categories)] };
      });
      if (!inputs.length) fail("没有可采纳的归类。");
      next = updateGrades(e, inputs, null);
      store.transaction(() => {
        store.put("exams", next);
        store.audit(
          e.id,
          "采纳 AI 备注归类",
          inputs.map((g) => e.grades[keyOf(g.studentId, g.questionId)]),
          inputs.map((g) => next.grades[keyOf(g.studentId, g.questionId)]),
        );
        store.put("tasks", { ...t, adoptedAt: now() });
      });
    } else if (t.kind === "grade") {
      const { studentId, questionId, previous } = t.payload,
        g = validateGrade(e, {
          studentId,
          questionId,
          score: req.body.score ?? t.result.score,
          status: "final",
          note: req.body.includeNote ? t.result.note : previous?.note || "",
          tags: req.body.includeNote ? t.result.tags : previous?.tags || [],
          source: "ai",
        });
      next = updateGrades(e, [g], "ai");
      store.transaction(() => {
        store.put("exams", next);
        store.audit(
          e.id,
          "采纳 AI 评分",
          [previous],
          [next.grades[keyOf(studentId, questionId)]],
        );
        store.put("tasks", { ...t, adoptedAt: now() });
      });
    } else if (t.kind === "extract" || t.kind === "tag") {
      const questions =
        t.kind === "extract"
          ? t.payload.wholePaper
            ? acceptPaper(t.result || {}, req.body)
            : t.result.questions
          : e.questions.map((q) => {
              const suggestion = t.result.questions.find((x) => x.id === q.id);
              return suggestion ? { ...q, ...suggestion, confirmed: false } : q;
            });
      if (t.kind === "extract" && e.questions.length && !req.body.replace)
        fail("替换试卷模板前需要确认。");
      if (t.kind === "extract" && e.questions.length) {
        // Matching labels reuse stable IDs. Existing teacher fields always win.
        const mapping = new Map(questions.map(q => [q.id, e.questions.find(x => x.label === q.label)?.id || q.id]));
        questions.forEach((q, i) => {
          const existing = e.questions.find(x => x.label === q.label);
          questions[i] = existing ? { ...existing } : { ...q, id: mapping.get(q.id), parentId: q.parentId ? mapping.get(q.parentId) : null };
        });
        for (const q of e.questions) if (!questions.some(x => x.id === q.id)) questions.push(q);
      }
      next = updateQuestions(e, questions);
      if (t.payload.wholePaper)
        next.paperScan = {
          taskId: t.id,
          sourceFileId: t.payload.sourceFileId,
          pageCount: t.result?.pageCount || t.payload.pages.length,
          confirmedAt: now(),
        };
      store.transaction(() => {
        store.put("exams", next);
        store.audit(e.id, "采纳题目建议", e.questions, next.questions);
        store.put("tasks", { ...t, adoptedAt: now() });
      });
    } else fail("报告在报告页面查看，无需采纳为成绩。");
    res.json({ ...next, analysis: analyze(next) });
  });
  app.get("/api/exams/:id/reports", (req, res) =>
    res.json(
      store
        .list("reports")
        .filter((r) => r.examId === req.params.id)
        .map(({ snapshot, ...r }) => reportState(r, store.get("exams", req.params.id))),
    ),
  );
  app.get("/api/reports/:id", (req, res) =>
    res.json(reportState(store.get("reports", req.params.id), store.get("exams", store.get("reports", req.params.id).examId))),
  );
  app.post("/api/exams/:id/reports", (req, res) => {
    const e = store.get("exams", req.params.id),
      studentId = req.body.studentId || null,
      input = analysisInput(e, studentId);
    const r = {
      id: id(),
      examId: e.id,
      studentId,
      revision: e.revision,
      snapshot: input,
      display: {
        name: e.name,
        className: e.className,
        date: e.date,
        demo: e.demo,
        analysis: analyze(e),
      },
      snapshotHash: snapshotHash(input),
      content: basicReport(e, studentId),
      teacherText: null,
      createdAt: now(),
      kind: "basic",
    };
    res.json(store.put("reports", r));
  });
  app.patch("/api/reports/:id", (req, res) => {
    const r = store.get("reports", req.params.id),
      text = z.string().max(30000).parse(req.body.teacherText);
    const content = req.body.content
      ? { ...r.content, ...validateReport(req.body.content, r.snapshot) }
      : r.content;
    if(req.body.content)content.findings=content.findings.map(f=>({...f,recordedNotes:recordedNotes(r.snapshot,f)}));
    const next = {
      ...r,
      id: id(),
      teacherText: text,
      content,
      editedByTeacher: true,
      parentReportId: r.id,
      editedAt: now(),
      createdAt: now(),
    };
    res.json(store.put("reports", next));
  });
  app.get("/api/backup", (_req, res) => {
    res.type("application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="zhiheng-backup.zhb"',
    );
    res.send(gzipSync(JSON.stringify(store.dump())));
  });
  app.post("/api/backup/preview", (req, res) => {
    const bytes = Buffer.from(
      z.string().max(350_000_000).parse(req.body.base64),
      "base64",
    );
    const dump = validateBackup(
      JSON.parse(
        gunzipSync(bytes, { maxOutputLength: 400 * 1024 * 1024 }).toString(
          "utf8",
        ),
      ),
    );
    res.json({
      classes: dump.records.filter((r) => r.kind === "classes").length,
      exams: dump.records.filter((r) => r.kind === "exams").length,
      attachments: dump.attachments.length,
    });
  });
  app.post("/api/backup/restore", (req, res) => {
    if (req.body.confirm !== "恢复备份") fail("恢复前请确认替换当前数据。");
    if (ai.active || store.list("tasks").some((t) => t.status === "queued"))
      fail("请先等待或取消正在运行的 AI 任务。");
    const dump = validateBackup(
      JSON.parse(
        gunzipSync(Buffer.from(req.body.base64, "base64"), {
          maxOutputLength: 400 * 1024 * 1024,
        }).toString("utf8"),
      ),
    );
    const folder = path.join(store.dir, "recovery");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      path.join(folder, `before-restore-${Date.now()}.zhb`),
      gzipSync(JSON.stringify(store.dump())),
    );
    store.transaction(() => {
      store.db.exec("DELETE FROM records; DELETE FROM attachments;");
      for (const r of dump.records) {
        const value = JSON.parse(r.json);
        if (
          r.kind === "tasks" &&
          ["queued", "running"].includes(value.status)
        ) {
          value.status = "interrupted";
          value.error = "从备份恢复，请手动重试任务。";
        }
        store.put(r.kind, value);
      }
      for (const f of dump.attachments)
        store.attachment(JSON.parse(f.json), Buffer.from(f.bytes, "base64"));
    });
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "接口不存在。" }),
  );
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(root, "dist", "index.html")),
  );
  app.use((err, _req, res, _next) => {
    const issue=err instanceof z.ZodError?err.issues[0]:null;
    const label=issue?({label:'题号或名称',max:'满分',score:'得分',points:'评分点分值',skills:'技能',related:'相关知识点',criteria:'评分点',regions:'作答区域',statement:'题面',answer:'参考答案',instructions:'给分规则',comment:'评语',note:'备注',page:'页码',name:'姓名或名称',number:'学号'}[issue.path.filter(x=>typeof x==='string').at(-1)]||'所填内容'):'';
    const message =
      err instanceof z.ZodError
        ? issue?.code==='too_big'?`${label}超出允许范围（上限 ${issue.maximum}），请缩短文字或减少条目。`:issue?.code==='too_small'?`${label}未达到要求，请补充完整或检查数值。`:`${label}格式不正确，请检查空白项、数字和选项后重新保存。`
        : err.message || "操作失败。";
    res.status(err.status || 400).json({ error: message.slice(0, 1200) });
  });
  return {
    app,
    store,
    ai,
    close: () => {
      ai.close();
      store.close();
    },
  };
}

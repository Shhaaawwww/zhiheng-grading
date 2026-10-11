import { useEffect, useRef, useState } from "react";
import { api, base64, leafQuestions, keyOf, fmt } from "./api";
import { Button, Field, Notice, ErrorBox, Badge } from "./components";
import { UploadModal } from "./workflows";
import { pageImage, regionImage, documentPageCount } from "./pdf";
import {
  RubricEditor,
  MappingEditor,
  AssessmentReview,
} from "./assessment-components";
import type { Exam, Attachment, Question, Task, Page } from "./types";

export function EvidenceOverview({
  exam,
  studentId,
}: {
  exam: Exam;
  studentId?: string;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api(
      `/exams/${exam.id}/assessment${studentId ? "?studentId=" + studentId : ""}`,
    )
      .then((x) => {
        if (live) setData(x);
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [exam.id, exam.revision, studentId]);
  if (!data) return <ErrorBox error={error} />;
  const a = data.statistics;
  if (!a.confirmedEvents && !a.staleAnswers) return null;
  return (
    <section className="panel assessment-overview">
      <h2>已核对的逐点表现</h2>
      <p>
        {a.reviewedAnswers} 份题目作答、{a.confirmedEvents} 条表现已确认。
        {a.staleAnswers > 0 &&
          `${a.staleAnswers} 份旧解释因分数、标准或原卷改变已暂时排除，请回到 AI 阅卷重新核对。`}
      </p>
      <Notice>
        以下人数来自实际核对的作答，同一学生可能在不同评分点表现不同，人数不能相加；“未观察到”和“受前错影响”不等于不会，也不作为掌握率。
      </Notice>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>具体技能</th>
              <th>已核对人数</th>
              <th>已表现</th>
              <th>有明确错误</th>
              <th>未能判断</th>
              <th>受前错影响</th>
            </tr>
          </thead>
          <tbody>
            {a.skills.map((s: any) => (
              <tr key={s.name}>
                <th scope="row">{s.name}</th>
                {[
                  s.students,
                  s.demonstrated,
                  s.error,
                  s.unknown,
                  s.blocked,
                ].map((ids: string[], i) => (
                  <td key={i}>
                    <details>
                      <summary>{ids.length}</summary>
                      {ids
                        .map(
                          (id) => exam.students.find((s) => s.id === id)?.name,
                        )
                        .join("、") || "暂无记录"}
                    </details>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a.skills.map((s: any) => (
        <details key={s.name}>
          <summary>{s.name} · 查看具体作答依据</summary>
          {s.members.map((m: any) => (
            <p key={`${m.studentId}:${m.questionId}:${m.criterionId}`}>
              {exam.students.find((s) => s.id === m.studentId)?.name} · 第{" "}
              {m.questionLabel} 题 {m.part} · {m.criterionLabel}：
              {m.comment || "教师未附说明"}（原卷第{" "}
              {m.references
                .map(
                  (r: any) =>
                    exam.answerMaps?.[
                      `${m.fileId}:${m.questionId}`
                    ]?.regions.find((x) => x.id === r.regionId)?.page,
                )
                .filter(Boolean)
                .join("、") || "待核对"}{" "}
              页）
            </p>
          ))}
        </details>
      ))}
    </section>
  );
}

export function AssessmentPage({
  exam: initial,
  onChanged,
  go,
}: {
  exam: Exam | null;
  onChanged: () => void;
  go: (p: Page) => void;
}) {
  const [exam, setExam] = useState(initial),
    [tasks, setTasks] = useState<Task[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [upload, setUpload] = useState(false),
    [onlyMissing, setOnlyMissing] = useState(true),
    [selected, setSelected] = useState(""),
    [student, setStudent] = useState(""),
    [editor, setEditor] = useState<any>(null);
  const stop = useRef(false),
    mounted = useRef(true),
    current = useRef(initial);
  useEffect(() => {
    setExam(initial);
    current.current = initial;
  }, [initial]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);
  const eid = initial?.id;
  async function refresh() {
    if (!eid) return;
    const e = await api<Exam>(`/exams/${eid}`);
    current.current = e;
    if (mounted.current) setExam(e);
    return e;
  }
  async function reloadTasks() {
    if (!eid) return [];
    const ts = await api<Task[]>(`/tasks?examId=${eid}`);
    if (mounted.current)
      setTasks(
        ts.filter((t) => ["rubric", "locate", "assess"].includes(t.kind)),
      );
    return ts;
  }
  useEffect(() => {
    void reloadTasks().catch((e) => setError(e.message));
    const t = setInterval(() => void reloadTasks().catch(() => {}), 2500);
    return () => clearInterval(t);
  }, [eid]);
  if (!exam) return <Notice>请先建立或选择一场考试。</Notice>;
  const qs = leafQuestions(exam),
    targets = qs.filter((q) => !selected || q.id === selected),
    references = exam.attachments.filter(
      (f) => f.role === "reference" && !f.studentId,
    ),
    paper = exam.attachments
      .filter((f) => !f.studentId && f.role !== "reference")
      .at(-1);
  const students = exam.students.filter(
    (s) =>
      (!student || s.id === student) &&
      exam.attachments.some((f) => f.studentId === s.id),
  );
  const checkStop = () => {
    if (stop.current)
      throw Error(
        "已暂停。已完成结果保留，点击原按钮可继续；正在发送的请求可能仍计费。",
      );
  };
  async function waitTask(kind: string, payload: any) {
    checkStop();
    const queued = await api<Task>(`/exams/${eid}/tasks`, { kind, payload });
    let t = queued;
    while (["queued", "running"].includes(t.status)) {
      await new Promise((r) => setTimeout(r, 1000));
      checkStop();
      const all = await reloadTasks();
      t = all.find((x) => x.id === queued.id) || t;
    }
    if (t.status !== "succeeded")
      throw Error(t.error || "任务未完成，可重试或改用人工处理。");
    return t;
  }
  async function locate(file: Attachment, questionIds: string[]) {
    const count = await documentPageCount(file);
    if (count > 40)
      throw Error("当前自动流程每份最多 40 页，请拆分只含本次答卷的文件。");
    for (let page = 1; page <= count; page += 2) {
      checkStop();
      setProgress(
        `${file.name} · 正在定位第 ${page}–${Math.min(page + 1, count)} 页`,
      );
      const pages = [page, ...(page < count ? [page + 1] : [])];
      const images = [];
      for (const p of pages) images.push((await pageImage(file, p)).image);
      const task = await waitTask("locate", {
        questionIds,
        images,
        sources: pages.map((page) => ({ fileId: file.id, page })),
      });
      await api(`/tasks/${task.id}/apply-locations`, {});
    }
    await refresh();
  }
  async function rubric(q: Question) {
    const e = current.current!,
      sources: any[] = [],
      images: string[] = [];
    for (const f of [paper, ...references].filter(Boolean) as Attachment[]) {
      const m = e.answerMaps?.[`${f.id}:${q.id}`];
      if (m) {
        for (const r of m.regions) {
          images.push(await regionImage(f, r));
          sources.push({
            fileId: f.id,
            page: r.page,
            regionId: r.id,
            label: r.label,
          });
        }
      } else if (f.id === paper?.id) {
        images.push((await pageImage(f, q.page || 1)).image);
        sources.push({ fileId: f.id, page: q.page || 1 });
      }
    }
    if (!sources.length) throw Error("请先上传并识别原卷。");
    if (
      references.length &&
      !sources.some((s) => references.some((f) => f.id === s.fileId))
    )
      throw Error(
        `第 ${q.label} 题未匹配到参考答案，请先用“调整区域”核对参考文件。`,
      );
    setProgress(`正在整理第 ${q.label} 题评分标准`);
    await waitTask("rubric", { questionId: q.id, sources, images });
  }
  async function assess(file: Attachment, q: Question, force = false) {
    const e = current.current!,
      m = e.answerMaps?.[`${file.id}:${q.id}`];
    if (!m)
      throw Error(`${file.name} 第 ${q.label} 题没有定位到作答，请补选区域。`);
    const images = [];
    for (const r of m.regions) {
      checkStop();
      images.push(await regionImage(file, r));
    }
    setProgress(
      `${exam!.students.find((s) => s.id === file.studentId)?.name} · 第 ${q.label} 题预批`,
    );
    await waitTask("assess", {
      studentId: file.studentId,
      questionId: q.id,
      images,
      sources: m.regions.map((r) => ({
        fileId: file.id,
        page: r.page,
        regionId: r.id,
        label: r.label,
      })),
      force,
    });
  }
  async function run(mode: "rubric" | "assess") {
    setBusy(true);
    setError("");
    setProgress("正在准备本批处理……");
    stop.current = false;
    let failures: string[] = [];
    try {
      await refresh();
      if (!targets.length) throw Error("请先在“试卷准备”识别题目清单。");
      if (mode === "rubric") {
        if (!paper) throw Error("请先上传空白原卷。");
        const pending = targets.filter((q) => !q.rubricSpec?.confirmed);
        for (const f of pending.length ? [paper, ...references] : [])
          await locate(
            f,
            pending.map((q) => q.id),
          );
        for (const q of targets) {
          checkStop();
          if (q.rubricSpec?.confirmed) continue;
          try {
            await rubric(q);
          } catch (e) {
            failures.push((e as Error).message);
          }
        }
      } else {
        const ready = targets.filter((q) => q.rubricSpec?.confirmed);
        if (!ready.length)
          throw Error("请先打开“核对标准”，确认至少一道题的评分规则。");
        if (!students.length) throw Error("请先上传学生作答并匹配名单。");
        for (const s of students) {
          checkStop();
          const file = current
            .current!.attachments.filter((f) => f.studentId === s.id)
            .at(-1)!;
          const todo = ready.filter(
            (q) =>
              !["absent", "na"].includes(
                current.current!.grades[keyOf(s.id, q.id)]?.status || "",
              ) &&
              (!onlyMissing ||
                current.current!.grades[keyOf(s.id, q.id)]?.status !== "final"),
          );
          if (!todo.length) continue;
          try {
            const missing = todo.filter(
              (q) => !current.current!.answerMaps?.[`${file.id}:${q.id}`],
            );
            if (missing.length)
              await locate(
                file,
                missing.map((q) => q.id),
              );
            for (const q of todo) {
              checkStop();
              try {
                await assess(file, q);
              } catch (e) {
                failures.push((e as Error).message);
              }
            }
          } catch (e) {
            failures.push((e as Error).message);
          }
        }
      }
      setProgress(
        failures.length
          ? `本批处理完成。${failures.length} 项未完成，请根据下方提示重试或人工处理。`
          : "本批处理完成。请逐题查看原卷并确认。",
      );
    } catch (e) {
      failures.push((e as Error).message);
    } finally {
      if (mounted.current) {
        setError(failures.join("\n"));
        setBusy(false);
        await refresh();
        await reloadTasks();
        onChanged();
      }
    }
  }
  async function open(
    kind: string,
    q: Question,
    task?: Task,
    file?: Attachment,
  ) {
    try {
      const fresh = await refresh();
      const hashes = await api(`/exams/${eid}/assessment-hashes`);
      if (kind === "review") {
        const qid = q.id,
          fid = task!.target!.fileId,
          sid = task!.target!.studentId;
        if (
          hashes.rubrics[qid] !== task!.target!.rubricHash ||
          hashes.mappings[fid + ":" + qid] !== task!.target!.mappingHash ||
          fresh!.attachments.filter((f) => f.studentId === sid).at(-1)?.id !==
            fid
        )
          throw Error("评分标准、作答区域或文件已改变，请重新预批后复核。");
      }
      setEditor({
        kind,
        q: fresh!.questions.find((x) => x.id === q.id),
        task,
        file,
        hash:
          kind === "review"
            ? hashes.grades[keyOf(task!.target!.studentId!, q.id)]
            : hashes.rubrics[q.id],
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function addReference(file: File) {
    setBusy(true);
    setError("");
    try {
      await api(`/exams/${eid}/attachments`, {
        filename: file.name,
        mime: file.type || "application/pdf",
        studentId: null,
        role: "reference",
        base64: await base64(file),
      });
      await refresh();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const done = () => {
    void refresh();
    void reloadTasks();
    onChanged();
  };
  const latestTasks = tasks
    .filter(
      (t) =>
        t.kind === "assess" &&
        (!selected || t.target?.questionId === selected) &&
        (!student || t.target?.studentId === student),
    )
    .filter(
      (t, i, all) =>
        !all
          .slice(0, i)
          .some(
            (x) =>
              x.target?.studentId === t.target?.studentId &&
              x.target?.questionId === t.target?.questionId,
          ),
    );
  return (
    <div className="assessment-page">
      <div className="section-heading">
        <div>
          <h1>AI 阅卷与教师复核</h1>
          <p>准备标准 → 上传作答 → 自动预批 → 看原卷确认 → 学情分析</p>
        </div>
      </div>
      <Notice>
        原卷只需识别一次，评分标准全班共用。预批不会覆盖教师成绩，也不会直接形成正式诊断。可单独使用人工录分或只让
        AI 补充作答评语。
      </Notice>
      <ErrorBox error={error} />
      <p role="status" aria-live="polite">
        {progress}
      </p>
      <div className="toolbar">
        <Field label="处理题目">
          <select
            disabled={busy}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">全部题目</option>
            {qs.map((q) => (
              <option key={q.id} value={q.id}>
                第 {q.label} 题
              </option>
            ))}
          </select>
        </Field>
        <Field label="处理学生">
          <select
            disabled={busy}
            value={student}
            onChange={(e) => setStudent(e.target.value)}
          >
            <option value="">全班</option>
            {exam.students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {busy && (
          <Button
            variant="danger"
            onClick={() => {
              stop.current = true;
              setProgress("正在暂停，已完成的任务会保留。");
            }}
          >
            暂停后续处理
          </Button>
        )}
      </div>
      <section className="panel">
        <h2>1 · 核对全班共用的标准</h2>
        <div className="toolbar">
          <Button variant="secondary" onClick={() => go("prepare")}>
            上传／识别原卷
          </Button>
          <Field label="上传参考答案（可选，PDF 或图片）">
            <input
              disabled={busy}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => {
                if (e.target.files?.[0]) void addReference(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </Field>
          <Button
            busy={busy}
            disabled={!qs.length}
            onClick={() => run("rubric")}
          >
            自动整理评分标准
          </Button>
        </div>
        <p>
          参考文件：
          {references.map((f) => f.name).join("、") ||
            "未上传，将生成待教师核对的解答"}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>题目</th>
                <th>评分点与技能</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((q) => {
                const t = tasks.find(
                  (t) =>
                    t.kind === "rubric" &&
                    t.target?.questionId === q.id &&
                    t.status === "succeeded" &&
                    !t.adoptedAt,
                );
                return (
                  <tr key={q.id}>
                    <th>
                      第 {q.label} 题<br />
                      {fmt(q.max)} 分
                    </th>
                    <td>
                      {q.rubricSpec?.criteria.map((c) => (
                        <p key={c.id}>
                          {c.part} {c.label} · {c.skills.join("、")}
                        </p>
                      )) || "自动整理后可编辑多个评分点"}
                    </td>
                    <td>
                      <Badge tone={q.rubricSpec?.confirmed ? "teal" : "amber"}>
                        {q.rubricSpec?.confirmed
                          ? "标准已确认"
                          : t
                            ? "等待核对"
                            : "尚未确认"}
                      </Badge>
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => open("rubric", q, t)}
                      >
                        核对标准
                      </Button>
                      {[paper, ...references].filter(Boolean).map((f) => (
                        <Button
                          key={f!.id}
                          variant="ghost"
                          disabled={busy}
                          onClick={() => open("mapping", q, undefined, f)}
                        >
                          调整{f!.role === "reference" ? "答案" : "题面"}区域
                        </Button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>2 · 学生作答与自动预批</h2>
        <p>
          当前已上传{" "}
          {
            exam.students.filter((s) =>
              exam.attachments.some((f) => f.studentId === s.id),
            ).length
          }
          /{exam.students.length}{" "}
          人。文件名用学号可自动匹配；每位学生使用最新上传的文件。
        </p>
        <div className="toolbar">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setUpload(true)}
          >
            上传学生原卷
          </Button>
          <Button busy={busy} onClick={() => run("assess")}>
            自动定位并预批
          </Button>
          <label className="check-label">
            <input
              type="checkbox"
              disabled={busy}
              checked={onlyMissing}
              onChange={(e) => setOnlyMissing(e.target.checked)}
            />
            只处理尚无最终分数的题（取消可给老师已批的卷补充评语）
          </label>
        </div>
        <details>
          <summary>漏题、续页或框选错误时在这里补选</summary>
          {students.map((s) => {
            const f = exam.attachments
              .filter((f) => f.studentId === s.id)
              .at(-1)!;
            return (
              <div key={s.id}>
                <strong>{s.name}</strong>
                {targets.map((q) => (
                  <Button
                    key={q.id}
                    variant="ghost"
                    disabled={busy}
                    onClick={() => open("mapping", q, undefined, f)}
                  >
                    第 {q.label} 题区域
                  </Button>
                ))}
              </div>
            );
          })}
        </details>
      </section>
      <section className="panel">
        <h2>3 · 对照原卷确认</h2>
        <p>
          发现识别或判断不对，可改评分点得分、表现及评语；区域不完整则补选后重新预批。
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>学生／题号</th>
                <th>进度</th>
                <th>建议分数</th>
                <th>提示</th>
                <th>教师操作</th>
              </tr>
            </thead>
            <tbody>
              {latestTasks.map((t) => {
                const q = qs.find((q) => q.id === t.target?.questionId);
                if (!q) return null;
                return (
                  <tr key={t.id}>
                    <th>
                      {
                        exam.students.find((s) => s.id === t.target?.studentId)
                          ?.name
                      }{" "}
                      · 第 {q.label} 题
                    </th>
                    <td>
                      {t.adoptedAt
                        ? "已复核"
                        : (
                            {
                              queued: "等待处理",
                              running: "处理中",
                              succeeded: "待复核",
                              failed: "处理失败",
                              cancelled: "已取消",
                            } as any
                          )[t.status] || t.status}
                      {t.progress && (
                        <small className="muted">
                          {" "}
                          · {t.progress.done}/{t.progress.total} 批已保存
                        </small>
                      )}
                    </td>
                    <td>{fmt(t.result?.score)}</td>
                    <td>
                      {t.error ||
                        (t.result?.warnings || []).join("；") ||
                        "请核对原卷"}
                    </td>
                    <td>
                      {t.status === "succeeded" && (
                        <Button
                          variant="secondary"
                          onClick={() => open("review", q, t)}
                        >
                          看原卷并复核
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError("");
                          stop.current = false;
                          try {
                            await refresh();
                            const file = current
                              .current!.attachments.filter(
                                (f) => f.studentId === t.target?.studentId,
                              )
                              .at(-1)!;
                            await assess(
                              file,
                              current.current!.questions.find(
                                (x) => x.id === q.id,
                              )!,
                              t.status === "succeeded",
                            );
                            await reloadTasks();
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {t.status === "succeeded" ? "重新预批" : "继续预批"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details>
          <summary>查看定位与标准整理任务</summary>
          {tasks
            .filter((t) => t.kind !== "assess")
            .map((t) => (
              <p key={t.id}>
                {t.kind === "rubric" ? "整理标准" : "定位区域"} · {t.status} ·{" "}
                {t.error || (t.result?.warnings || []).join("；")}
              </p>
            ))}
        </details>
      </section>
      <EvidenceOverview exam={exam} />
      <div className="toolbar">
        <Button onClick={() => go("classReport")}>查看班级学情</Button>
        <Button variant="secondary" onClick={() => go("student")}>
          查看个人学情
        </Button>
        <Button variant="secondary" onClick={() => go("grade")}>
          人工录分／导出录分表
        </Button>
      </div>
      {upload && (
        <UploadModal
          exam={exam}
          onClose={() => setUpload(false)}
          onDone={done}
        />
      )}
      {editor?.kind === "rubric" && (
        <RubricEditor
          key={editor.q.id + editor.hash + (editor.task?.id || "")}
          exam={exam}
          q={editor.q}
          task={editor.task}
          hash={editor.hash}
          onClose={() => setEditor(null)}
          onDone={done}
        />
      )}
      {editor?.kind === "mapping" && (
        <MappingEditor
          key={editor.q.id + editor.file.id}
          exam={exam}
          q={editor.q}
          file={editor.file}
          onClose={() => setEditor(null)}
          onDone={done}
        />
      )}
      {editor?.kind === "review" && (
        <AssessmentReview
          key={editor.task.id + editor.hash}
          exam={exam}
          task={editor.task}
          hash={editor.hash}
          onClose={() => setEditor(null)}
          onDone={done}
        />
      )}
    </div>
  );
}

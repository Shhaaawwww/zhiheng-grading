import { useEffect, useRef, useState } from "react";
import {
  FileScan,
  Sparkles,
  CheckCheck,
  Trash2,
  Plus,
  ArrowRight,
} from "lucide-react";
import { api, base64, uid } from "./api";
import { useDraft } from "./drafts";
import { Button, Notice, ErrorBox, Badge, Field, Modal } from "./components";
import { documentImages, PdfViewer } from "./pdf";
import type { Attachment, Exam, Question, Settings, Task } from "./types";

type ScannedQuestion = Omit<Question, "max"> & {
  max: number | null;
  reviewNote?: string;
};
type PaperResult = {
  questions: ScannedQuestion[];
  paperMax: number | null;
  warnings: string[];
  pageCount: number;
};
const typeNames: Record<Question["type"], string> = {
  choice: "单选题",
  multiple: "多选题",
  fill: "填空题",
  solve: "解答题",
  proof: "证明题",
  group: "大题汇总",
};

export function PaperScan({
  exam,
  settings,
  topics,
  onChanged,
  onReady,
  onSettings,
}: {
  exam: Exam;
  settings: Settings;
  topics: string[];
  onChanged: () => void;
  onReady: (exam: Exam) => void;
  onSettings: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [source, setSource] = useState<Attachment | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [review, setReview] = useState(false);
  const [pageRange, setPageRange] = useState("");
  const [ready, setReady] = useState(
    settings.hasKey && !!settings.baseUrl && !!settings.visionModel,
  );
  const controller = useRef<AbortController | null>(null);
  const cancelled = useRef(false);
  const alive = useRef(true);
  const activeId = useRef<string | null>(null);
  const restored = useRef(false);
  const opened = useRef<string | null>(null);
  const existing = exam.attachments.filter((a) => !a.studentId && a.role !== 'reference').at(-1);
  const file = source || existing;
  const working =
    busy || (!!task && ["queued", "running"].includes(task.status));
  useEffect(() => {
    alive.current = true;
    async function reload() {
      try {
        const list = await api<Task[]>(`/tasks?examId=${exam.id}`);
        if (!alive.current) return;
        if (!restored.current) {
          restored.current = true;
          const prior = list.find((t) => t.target?.wholePaper && !t.adoptedAt);
          if (prior) activeId.current = prior.id;
        }
        const current = list.find((t) => t.id === activeId.current);
        if (current) {
          setTask(current);
          const original = exam.attachments.find(
            (f) => f.id === current.target?.sourceFileId,
          );
          if (original) setSource(original);
        }
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      }
    }
    void reload();
    const timer = setInterval(reload, 2000);
    return () => {
      alive.current = false;
      controller.current?.abort();
      clearInterval(timer);
    };
  }, [exam.id]);
  useEffect(
    () =>
      setReady(settings.hasKey && !!settings.baseUrl && !!settings.visionModel),
    [settings],
  );
  useEffect(() => {
    if (
      ["succeeded", "partial"].includes(task?.status || "") &&
      task &&
      !task.adoptedAt &&
      opened.current !== task.id &&
      !document.querySelector("dialog[open]")
    ) {
      opened.current = task.id;
      setReview(true);
    }
  }, [task]);

  async function run() {
    setBusy(true);
    setError("");
    setProgress({ done: 0, total: 0 });
    const control = new AbortController();
    cancelled.current = false;
    controller.current = control;
    try {
      const config = await api<Settings>("/settings");
      const connected =
        config.hasKey && !!config.baseUrl && !!config.visionModel;
      setReady(connected);
      if (!connected)
        throw Error(
          "请先连接一次智能识卷服务。连接好以后，每次只需选择试卷 PDF。",
        );
      let original = file;
      if (selectedFile) {
        if (selectedFile.size > 35 * 1024 * 1024)
          throw Error("单份试卷最多 35 MB，请先压缩扫描 PDF。");
        if (
          !/\.pdf$/i.test(selectedFile.name) &&
          !["image/png", "image/jpeg", "image/webp"].includes(selectedFile.type)
        )
          throw Error("请选择试卷 PDF 或清晰的题面图片。");
        setPhase("正在保存试卷…");
        original = await api<Attachment>(`/exams/${exam.id}/attachments`, {
          filename: selectedFile.name,
          mime: /\.pdf$/i.test(selectedFile.name)
            ? "application/pdf"
            : selectedFile.type,
          studentId: null,
          base64: await base64(selectedFile),
        });
        if (alive.current) {
          setSource(original);
          setSelectedFile(null);
          onChanged();
        }
      }
      control.signal.throwIfAborted();
      if (!original) throw Error("请先选择这次考试的试卷 PDF。");
      setPhase("正在读取整份试卷…");
      const { images, pages } = await documentImages(original, "all", null, {
        signal: control.signal,
        onProgress: (done, total) => {
          if (alive.current) setProgress({ done, total });
        },
      });
      control.signal.throwIfAborted();
      setPhase("正在开始识别题目、题型和知识点…");
      const selectedPages = pageRange.trim() ? pageRange.split(/[,，\s]+/).flatMap(part => {
        const m = /^(\d+)(?:-(\d+))?$/.exec(part);
        if (!m) throw Error("页码请填写例如 1-4 或 2,4；只选题面，不选答案页。");
        const from = Number(m[1]), to = Number(m[2] || m[1]);
        if (from < 1 || to < from || to > pages.length) throw Error("选择的页码超出试卷范围。");
        return Array.from({ length: to - from + 1 }, (_, i) => from + i);
      }) : pages;
      const ordered = [...new Set(selectedPages)].sort((a, b) => a - b);
      let next = await api<Task>(`/exams/${exam.id}/tasks`, {
        kind: "extract",
        payload: { images: ordered.map(p => images[pages.indexOf(p)]), pages: ordered, wholePaper: true, sourceFileId: original.id },
      });
      if (cancelled.current)
        next = await api<Task>(`/tasks/${next.id}/cancel`, {});
      activeId.current = next.id;
      restored.current = true;
      if (alive.current) {
        setTask(next);
        setPhase("");
      }
    } catch (e) {
      if (alive.current)
        setError(
          control.signal.aborted
            ? "已停止读取。原试卷已保存，可以重新开始。"
            : (e as Error).message,
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function cancel() {
    cancelled.current = true;
    controller.current?.abort();
    if (task && ["queued", "running"].includes(task.status)) {
      try {
        setTask(await api(`/tasks/${task.id}/cancel`, {}));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }
  async function retry() {
    if (!task) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<Task>(`/tasks/${task.id}/retry`, {});
      activeId.current = next.id;
      setTask(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const result = task && !["queued", "running"].includes(task.status)
    ? ((task.result || { questions: [], warnings: ["未提取到可用结果。可补充题号、满分与知识点后继续。"], paperMax: null, pageCount: task.target?.pageCount || 0 }) as PaperResult) : null;
  const usable = result?.questions.filter((q) => q.type !== "group");
  return (
    <section className="paper-scan panel" aria-label="AI 整卷识别">
      <div className="scan-heading">
        <div className="scan-icon">
          <FileScan size={28} />
        </div>
        <div>
          <h2>导入一份试卷，AI 自动整理全班题目</h2>
          <p>
            整份 PDF
            分批整理题号、满分、题型和具体知识点。无需手工转写完整题干；每批完成即保存。
          </p>
        </div>
        <Badge tone={ready ? "teal" : "amber"}>
          {ready ? "识卷服务已配置" : "首次需连接识卷服务"}
        </Badge>
      </div>
      <ol className="scan-route">
        <li>1 选择整份 PDF</li>
        <li>2 自动识别题目与知识点</li>
        <li>3 确认后直接录小分</li>
      </ol>
      {!ready && (
        <Notice>
          <strong>先连接一次识卷服务，就可以自动整理试卷。</strong>
          <p>可以请学校信息老师协助完成，老师日常无需填写这些连接参数。</p>
          <Button variant="secondary" onClick={onSettings}>
            连接智能识卷服务
            <ArrowRight size={15} />
          </Button>
        </Notice>
      )}
      <div className="scan-file-area">
        <Field
          label="选择试卷 PDF"
          hint="同一套试题只上传一份；可用清晰的空白试卷，或一位学生的完整试卷。"
        >
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            disabled={working}
            onChange={(e) => {
              const next = e.target.files?.[0];
              if (!next) return;
              setSelectedFile(next);
              setTask(null);
              setSource(null);
              activeId.current = null;
              restored.current = true;
              setError("");
            }}
          />
        </Field>
        <div className="scan-file-info">
          {selectedFile
            ? `已选择：${selectedFile.name}`
            : file
              ? `可使用已上传试卷：${file.name}`
              : "每场考试整理一次，之后直接录入所有学生的小分。"}
        </div>
        <Field label="识别页码（留空为全部）" hint="例如 1-4 或 2,4。请选择题面页；需要重识别某页时也可在这里指定。"><input aria-label="识别页码" value={pageRange} onChange={e => setPageRange(e.target.value)} disabled={working} /></Field>
        <div className="toolbar">
          <Button
            busy={busy}
            disabled={working || !ready || (!selectedFile && !file)}
            onClick={run}
          >
            <Sparkles size={17} />
            {exam.questions.length ? "重新识别整份试卷" : "开始整卷识别"}
          </Button>
          {working && (
            <Button variant="secondary" onClick={cancel}>
              停止本次识别
            </Button>
          )}
        </div>
        <small>
          点击开始会将整份题面发送到已配置的智能服务，可能产生服务商费用。支持最多
          40 页、35 MB。
        </small>
      </div>
      {working && (
        <div className="scan-progress" role="status">
          <strong>
            {busy
              ? phase
              : task?.status === "queued"
                ? "正在排队，随后自动识别…"
                : "AI 正在整理整卷题目、题型和知识点…"}
          </strong>
          {progress.total > 0 && busy && (
            <>
              <progress
                aria-label="整卷页面读取进度"
                value={progress.done}
                max={progress.total}
              />
              <span>
                读取页面 {progress.done} / {progress.total}
              </span>
            </>
          )}
          <p>
            {task?.progress && `已处理 ${task.progress.done}/${task.progress.total} 页。`}
            {busy
              ? "读取页面时请保留本页。"
              : "可以离开本页，返回后继续查看结果。"}{" "}
            无需再逐题点击识别。
          </p>
        </div>
      )}
      <ErrorBox
        error={
          error ||
          (task && ["failed", "interrupted", "cancelled", "partial"].includes(task.status)
            ? task.error || "识别已停止，可重新开始。"
            : "")
        }
      />
      {task && ["failed", "interrupted", "cancelled", "partial"].includes(task.status) && (
        <Button variant="secondary" busy={busy} onClick={retry}>
          仅重试未完成页面
        </Button>
      )}
      {result && !task?.adoptedAt && (
        <div className="scan-success">
          <CheckCheck size={25} />
          <div>
            <strong>
              已整理 {usable?.length || 0} 道计分题，自动分析题型和知识点
            </strong>
            <p>
              本次发送 {result.pageCount}{" "}
              页。请核对题数、分值和知识点；提示未必覆盖所有识别错误。
            </p>
          </div>
          <Button onClick={() => setReview(true)}>
            查看结果并生成录分表
            <ArrowRight size={17} />
          </Button>
        </div>
      )}
      {task?.adoptedAt && (
        <Notice tone="success">
          这份试卷已生成录分表，可直接填写每位学生的小分与可选错因。
        </Notice>
      )}
      {review && task && result && (
        <PaperReview
          exam={exam}
          task={task}
          result={result}
          file={
            source ||
            exam.attachments.find((f) => f.id === task.target?.sourceFileId)
          }
          topics={topics}
          onClose={() => setReview(false)}
          onReady={onReady}
        />
      )}
    </section>
  );
}

function PaperReview({
  exam,
  task,
  result,
  file,
  topics,
  onClose,
  onReady,
}: {
  exam: Exam;
  task: Task;
  result: PaperResult;
  file?: Attachment;
  topics: string[];
  onClose: () => void;
  onReady: (e: Exam) => void;
}) {
  const [questions, setQuestions, draftStatus, clearDraft] = useDraft<ScannedQuestion[]>(`paper-${task.id}`,
    result.questions,
  );
  const [bulkMax, setBulkMax] = useState("");
  const [selected, setSelected] = useState(result.questions[0]?.id || "");
  const [showOriginal, setShowOriginal] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [replace, setReplace] = useState(false),
    [allowTotalMismatch, setAllowTotalMismatch] = useState(false);
  const q = questions.find((q) => q.id === selected);
  const leaves = questions.filter(
    (q) => q.type !== "group" && !questions.some((c) => c.parentId === q.id),
  );
  const missing = questions.filter(
    (q) =>
      !q.label.trim() ||
      (q.max != null && q.max <= 0),
  );
  const total = leaves.reduce((n, q) => n + (q.max || 0), 0);
  const mismatch =
    leaves.every(q => q.max != null) && result.paperMax != null && Math.abs(total - result.paperMax) > 1e-7;
  const needAttention = questions.filter(
    (q) => q.reviewNote || missing.includes(q) || q.max == null || !q.primary.trim(),
  );
  function update(id: string, key: keyof ScannedQuestion, value: unknown) {
    setQuestions((xs) =>
      xs.map((x) => (x.id === id ? { ...x, [key]: value } : x)),
    );
    setAllowTotalMismatch(false);
  }
  async function accept() {
    setBusy(true);
    setError("");
    try {
      const next = await api<Exam>(`/tasks/${task.id}/adopt`, {
        questions,
        replace,
        allowTotalMismatch,
      });
      await clearDraft();
      onReady(next);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="核对整卷识别结果"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Notice>
        AI
        已整理题目清单。请核对题号、分值和具体知识点。满分未知可先存小分草稿；知识点留空时仍可按题统计，补充确认后再纳入知识诊断。
      </Notice>
      <p role="status">{draftStatus}</p>
      <Field label="批量补充分值" hint="输入例如 1-8=5，仅修改这个题号范围的满分。"><input aria-label="批量补充分值" value={bulkMax} onChange={e => setBulkMax(e.target.value)} /></Field>
      <Button variant="secondary" onClick={() => {
        const m = /^(\d+)-(\d+)=(\d+(?:\.\d+)?)$/.exec(bulkMax.trim());
        if (!m || Number(m[3]) <= 0 || Number(m[3]) > 1000) { setError("请按 1-8=5 的形式输入，满分应大于零。"); return; }
        setQuestions(xs => xs.map(q => /^\d+$/.test(q.label) && Number(q.label) >= Number(m[1]) && Number(q.label) <= Number(m[2]) ? { ...q, max: Number(m[3]) } : q));
        setError("");
      }}>应用批量分值</Button>
      <div className="scan-review-summary">
        <Badge tone="teal">{leaves.length} 道计分题</Badge>
        <Badge>{leaves.some(q => q.max == null) ? "已知分值小计" : "合计"} {total} 分</Badge>
        <Badge>卷面总分 {result.paperMax ?? "未明确印刷"}</Badge>
        <Badge tone={needAttention.length ? "amber" : "teal"}>
          {needAttention.length
            ? `${needAttention.length} 项建议重点核对`
            : "可整体确认"}
        </Badge>
      </div>
      {result.warnings.length > 0 && (
        <Notice tone="warn">
          {result.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </Notice>
      )}
      <div className="scan-review-table table-wrap">
        <table>
          <thead>
            <tr>
              <th>题号</th>
              <th>题型</th>
              <th>满分</th>
              <th>主要考查知识点</th>
              <th>原稿 / 核对提示</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((item) => (
              <tr
                key={item.id}
                className={missing.includes(item) ? "scan-row-warning" : ""}
              >
                <td>
                  <input
                    aria-label={`第 ${item.label || "新增"} 题题号`}
                    value={item.label}
                    onChange={(e) => update(item.id, "label", e.target.value)}
                  />
                </td>
                <td>
                  <select
                    aria-label={`第 ${item.label} 题题型`}
                    value={item.type}
                    onChange={(e) => update(item.id, "type", e.target.value)}
                  >
                    {Object.entries(typeNames).map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`第 ${item.label} 题满分`}
                    type="number"
                    min="0.1"
                    max="1000"
                    step={item.step}
                    value={item.max ?? ""}
                    placeholder="待核对"
                    onChange={(e) =>
                      update(
                        item.id,
                        "max",
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  />
                </td>
                <td>
                  {item.type === "group" ? (
                    <span className="muted">按小问统计</span>
                  ) : (
                    <input
                      aria-label={`第 ${item.label} 题主要知识点`}
                      list="scan-topic-options"
                      value={item.primary}
                      placeholder="待核对"
                      onChange={(e) =>
                        update(item.id, "primary", e.target.value)
                      }
                    />
                  )}
                </td>
                <td>
                  <button
                    className="scan-source-button"
                    onClick={() => {
                      setSelected(item.id);
                      setShowOriginal(true);
                    }}
                  >
                    第 {item.page} 页 · 查看题干
                  </button>
                  {(item.reviewNote || missing.includes(item)) && (
                    <small className="block scan-warning">
                      {item.reviewNote || "请补充分值或知识点"}
                    </small>
                  )}
                </td>
                <td>
                  <button
                    className="icon-btn"
                    aria-label={`移除识别的第 ${item.label} 题`}
                    onClick={() => {
                      const removed = new Set([item.id]);
                      let before = -1;
                      while (before !== removed.size) {
                        before = removed.size;
                        questions.forEach((x) => {
                          if (x.parentId && removed.has(x.parentId))
                            removed.add(x.id);
                        });
                      }
                      setQuestions((xs) =>
                        xs.filter((x) => !removed.has(x.id)),
                      );
                      setAllowTotalMismatch(false);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="scan-topic-options">
        {topics.map((t) => (
          <option value={t} key={t} />
        ))}
      </datalist>
      <details
        className="scan-detail"
        open={showOriginal}
        onToggle={(e) => setShowOriginal(e.currentTarget.open)}
      >
        <summary>对照原稿与题干：第 {q?.label || "—"} 题（需要时修改）</summary>
        {q && (
          <div className="scan-original">
            <div style={{ height: 440 }}>
              <PdfViewer file={file} initialPage={q.page} />
            </div>
            <div>
              <Field label={`第 ${q.label} 题识别题干`}>
                <textarea
                  rows={10}
                  value={q.stem}
                  onChange={(e) => update(q.id, "stem", e.target.value)}
                />
              </Field>
              <p className="muted">
                涉及知识：{q.related.join("、") || "无其他标签"}{" "}
                {q.parentId
                  ? `· 所属大题 ${questions.find((p) => p.id === q.parentId)?.label}`
                  : ""}
              </p>
            </div>
          </div>
        )}
      </details>
      <Button
        variant="ghost"
        onClick={() => {
          const id = uid();
          setQuestions((xs) => [
            ...xs,
            {
              id,
              label: "",
              parentId: null,
              stem: "",
              max: null,
              step: 0.5,
              type: "solve",
              primary: "",
              related: [],
              confirmed: false,
              answer: "",
              rubric: "",
              page: 1,
              region: null,
            },
          ]);
          setSelected(id);
        }}
      >
        <Plus size={15} />
        仅在漏题时补充一题
      </Button>
      {missing.length > 0 && (
        <Notice tone="warn">
          仅有 {missing.length} 项信息不完整：
          {missing.map((q) => q.label || "新增题").join("、")}
          。请补齐标出的题号、满分或知识点，其他题目无需重填。
        </Notice>
      )}
      {mismatch && (
        <Notice tone="warn">
          <p>
            题目满分合计 {total} 分，与识别的卷面总分 {result.paperMax}{" "}
            分不同，请先核对是否漏题或分值识别有误。
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={allowTotalMismatch}
              onChange={(e) => setAllowTotalMismatch(e.target.checked)}
            />
            我已核对，按当前合计 {total} 分使用
          </label>
        </Notice>
      )}
      {exam.questions.length > 0 && (
        <Notice tone="warn">
          <label className="check-label">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            将新题加入模板；同题号保留老师原有修改和成绩，未识别到的原题也保留
          </label>
        </Notice>
      )}
      <ErrorBox error={error} />
      <div className="modal-actions">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          稍后核对
        </Button>
        <Button
          busy={busy}
          disabled={
            !leaves.length ||
            missing.length > 0 ||
            (mismatch && !allowTotalMismatch) ||
            (exam.questions.length > 0 && !replace)
          }
          onClick={accept}
        >
          <CheckCheck size={17} />
          确认题目，生成全班录分表
        </Button>
      </div>
    </Modal>
  );
}

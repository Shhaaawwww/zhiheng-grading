import { useState, useEffect } from "react";
import {
  Upload,
  Download,
  FileSpreadsheet,
  Sparkles,
  Check,
  RotateCcw,
  Square,
  FileText,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { api, base64, download, dateTime, fmt } from "./api";
import {
  Modal,
  Field,
  Button,
  Notice,
  ErrorBox,
  Badge,
  Empty,
} from "./components";
import { documentImages } from "./pdf";
import { BatchAdopt } from "./bulk";
import type { Exam, Task, Attachment } from "./types";

export function ImportModal({
  kind,
  exam,
  classId,
  onClose,
  onDone,
  initialFile,
}: {
  initialFile?: File;
  kind: "grades" | "roster";
  exam?: Exam;
  classId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [replace, setReplace] = useState(false);
  async function choose(file: File) {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const p = await api("/imports/preview", {
        kind,
        examId: exam?.id,
        classId,
        filename: file.name,
        base64: await base64(file),
      });
      setPreview(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (initialFile) void choose(initialFile);
  }, []);
  async function apply() {
    setBusy(true);
    setError("");
    try {
      await api(`/imports/${preview.id}/apply`, { replace });
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={kind === "grades" ? "导入逐题成绩" : "导入学生名单"}
      onClose={onClose}
      wide
    >
      <Notice>
        支持 Excel、CSV、TSV。空白不覆盖已有成绩，0
        是有效零分。导入前先检查映射。
      </Notice>
      <div className="upload-box">
        <FileSpreadsheet size={28} />
        <Field label="选择表格文件">
          <input
            type="file"
            accept=".xlsx,.csv,.tsv"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.[0]) void choose(e.target.files[0]);
            }}
          />
        </Field>
        <Button
          variant="ghost"
          onClick={() =>
            download(
              kind === "grades"
                ? `/exams/${exam!.id}/export?mode=template`
                : `/classes/${classId}/export`,
              "导入模板.xlsx",
            ).catch((e) => setError(e.message))
          }
        >
          <Download size={16} />
          下载模板
        </Button>
      </div>
      <ErrorBox error={error} />
      {busy && (
        <div className="loading" role="status">
          <LoaderCircle className="spin" size={18} />
          正在处理…
        </div>
      )}
      {preview && (
        <>
          <div className="preview-count">
            <strong>
              {kind === "grades"
                ? preview.changes.length
                : preview.students.length}
            </strong>{" "}
            条新记录{" "}
            <Badge tone={preview.errors.length ? "amber" : "teal"}>
              {preview.errors.length
                ? `${preview.errors.length} 个问题`
                : "检查通过"}
            </Badge>
          </div>
          {preview.errors.length > 0 && (
            <div className="error-list" role="alert">
              {preview.errors.slice(0, 30).map((e: any, i: number) => (
                <p key={i}>
                  第 {e.row} 行：{e.message}
                </p>
              ))}
            </div>
          )}
          <div className="table-wrap compact">
            <table>
              <thead>
                <tr>
                  {(kind === "grades"
                    ? ["学生", "题号", "原得分", "新得分", "备注"]
                    : ["学号", "姓名"]
                  ).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(kind === "grades" ? preview.changes : preview.students)
                  .slice(0, 100)
                  .map((v: any, i: number) => (
                    <tr key={i}>
                      {kind === "grades" ? (
                        <>
                          <td>{v.studentName}</td>
                          <td>{v.label}</td>
                          <td>{fmt(v.previous?.score)}</td>
                          <td>
                            {v.status === "absent" ? "缺考" : fmt(v.score)}
                          </td>
                          <td>{v.note || "—"}</td>
                        </>
                      ) : (
                        <>
                          <td>{v.number}</td>
                          <td>{v.name}</td>
                        </>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {preview.conflicts > 0 && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              允许替换上方 {preview.conflicts} 条已有记录（保留修改历史）
            </label>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              busy={busy}
              disabled={
                !!preview.errors.length || (!!preview.conflicts && !replace)
              }
              onClick={apply}
            >
              确认导入
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function UploadModal({
  exam,
  paper = false,
  onClose,
  onDone,
}: {
  exam: Exam;
  paper?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [files, setFiles] = useState<
      { file: File; studentId: string; done: boolean }[]
    >([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const duplicateStudent = !paper && files.find((item, index) =>
    item.studentId && files.some((other, otherIndex) =>
      otherIndex < index && other.studentId === item.studentId,
    ),
  );
  const uploadConflict = duplicateStudent
    ? `${exam.students.find((s) => s.id === duplicateStudent.studentId)?.name || "同一学生"}在本批中对应多个文件。每位学生请只选择一份完整 PDF，或一张包含全部作答的图片；正反面及多页照片请先合成一份 PDF。系统不会自动合并这些文件。`
    : "";
  function choose(list: FileList) {
    setError("");
    setFiles(
      Array.from(list).map((file) => {
        const stem = file.name.replace(/\.[^.]+$/, "");
        const matches = exam.students.filter(
          (s) =>
            stem === s.number ||
            stem === s.name ||
            stem.startsWith(s.number + "_") ||
            stem.startsWith(s.number + "-"),
        );
        return {
          file,
          studentId: matches.length === 1 ? matches[0].id : "",
          done: false,
        };
      }),
    );
  }
  async function upload() {
    if (uploadConflict) {
      setError(uploadConflict);
      return;
    }
    if (!paper) {
      const unmatched = files.find((f) => !f.studentId);
      if (unmatched) {
        setError(`请先匹配 ${unmatched.file.name} 的学生。`);
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f.done) continue;
        if (!paper && !f.studentId)
          throw new Error(`请先匹配 ${f.file.name} 的学生。`);
        await api(`/exams/${exam.id}/attachments`, {
          filename: f.file.name,
          mime:
            f.file.type ||
            (/\.pdf$/i.test(f.file.name) ? "application/pdf" : ""),
          studentId: paper ? null : f.studentId,
          base64: await base64(f.file),
        });
        setFiles((old) =>
          old.map((x, j) => (i === j ? { ...x, done: true } : x)),
        );
      }
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={paper ? "上传印刷题面" : "关联学生原卷"}
      onClose={onClose}
      wide
    >
      <Notice>
        {paper
          ? "选择清晰题面。系统保留原文件，随后可让 AI 建议题目与知识点。"
          : "本批每人一份完整 PDF，或一张包含全部作答的图片，可按学号命名。正反面及多页照片请先合成 PDF；系统不会自动合卷或读取卷头姓名学号。先核对学生，再上传。以后上传新版本会保留历史附件，查看与预批使用最新一份。"}
      </Notice>
      <Field label="选择 PDF 或图片">
        <input
          type="file"
          multiple={!paper}
          accept="application/pdf,image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files) choose(e.target.files);
          }}
        />
      </Field>
      <div className="file-list">
        {files.map((f, i) => (
          <div className="file-row" key={i}>
            <FileText size={20} />
            <span>
              {f.file.name}
              <small>{(f.file.size / 1024 / 1024).toFixed(1)} MB</small>
            </span>
            {!paper && (
              <select
                aria-label={`${f.file.name} 对应学生`}
                value={f.studentId}
                disabled={busy || f.done}
                onChange={(e) => {
                  setError("");
                  setFiles((xs) =>
                    xs.map((x, j) =>
                      i === j ? { ...x, studentId: e.target.value } : x,
                    ),
                  );
                }}
              >
                <option value="">选择学生</option>
                {exam.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number} · {s.name}
                  </option>
                ))}
              </select>
            )}
            {f.done && <Badge tone="teal">已保存</Badge>}
          </div>
        ))}
      </div>
      <ErrorBox error={uploadConflict || error} />
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button
          busy={busy}
          disabled={
            !files.length || !!uploadConflict || (!paper && files.some((f) => !f.studentId))
          }
          onClick={upload}
        >
          <Upload size={16} />
          保存附件
        </Button>
      </div>
    </Modal>
  );
}

export function AICompose({
  exam,
  file,
  kind,
  questionId,
  studentId,
  onClose,
  onDone,
}: {
  exam: Exam;
  file: Attachment;
  kind: "extract" | "grade";
  questionId?: string;
  studentId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const q = exam.questions.find((q) => q.id === questionId),
    [range, setRange] = useState(String(q?.page || 1)),
    [crop, setCrop] = useState(!!q?.region),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    try {
      const { images, pages } = await documentImages(
        file,
        range,
        crop ? q?.region : null,
      );
      await api(`/exams/${exam.id}/tasks`, {
        kind,
        payload: { images, pages, studentId, questionId },
      });
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={kind === "extract" ? "识别印刷题面" : "AI 辅助试批"}
      onClose={onClose}
    >
      <Notice>
        将选定页面发送到你配置的模型服务。
        {kind === "grade"
          ? "结果作为建议保存，采纳后才进入最终成绩。"
          : "建议结果需要核对，知识点不会自动确认为有效。"}
      </Notice>
      <p className="selected-file">
        <FileText size={18} />
        {file.name}
      </p>
      <Field label="处理页码" hint="例如 1-3 或 1,3。最多 20 页，可分批处理。">
        <input value={range} onChange={(e) => setRange(e.target.value)} />
      </Field>
      {kind === "grade" && q?.region && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={crop}
            onChange={(e) => setCrop(e.target.checked)}
          />
          只发送此题设定的作答区域（所有选定页均使用此区域）
        </label>
      )}
      <ErrorBox error={error} />
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button busy={busy} onClick={run}>
          <Sparkles size={16} />
          创建任务
        </Button>
      </div>
    </Modal>
  );
}

const kindNames = {
  rubric: '评分标准', locate: '作答定位', assess: '逐点预批',
  classify: "备注归类",
  extract: "题面识别",
  tag: "知识点建议",
  grade: "辅助阅卷",
  report: "学情解读",
};
const states: Record<string, string> = {
  queued: "排队中",
  running: "处理中",
  succeeded: "已完成",
  partial: "部分完成，可继续核对或局部重试",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "待重试",
};
export function AITasks({
  exam,
  filter,
  onChanged,
  tick = 0,
}: {
  exam: Exam;
  filter?: Task["kind"][];
  onChanged: () => void;
  tick?: number;
}) {
  const [batchAdopt, setBatchAdopt] = useState(false),
    [adoptScore, setAdoptScore] = useState(""),
    [limit, setLimit] = useState(30),
    [tasks, setTasks] = useState<Task[]>([]),
    [selected, setSelected] = useState<Task | null>(null),
    [includeNote, setIncludeNote] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function reload() {
    try {
      setTasks(await api(`/tasks?examId=${exam.id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void reload();
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [exam.id, tick]);
  async function action(t: Task, op: string) {
    setError("");
    setBusy(true);
    try {
      await api(
        `/tasks/${t.id}/${op}`,
        op === "adopt"
          ? {
              includeNote,
              replace: true,
              score:
                selected?.kind === "grade" ? Number(adoptScore) : undefined,
            }
          : {},
      );
      if (op === "adopt") {
        setSelected(null);
        onChanged();
      }
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const eligible = (t: Task) =>
    !t.target?.wholePaper && !['rubric','locate','assess'].includes(t.kind) && (!filter || filter.includes(t.kind));
  const visible = tasks.filter(eligible).slice(0, limit);
  return (
    <div className="ai-tasks">
      <ErrorBox error={!selected ? error : ""} />
      {visible.length > 0 ? (
        <>
          <div className="task-heading">
            <Sparkles size={17} />
            <strong>AI 任务</strong>
            {visible.some(
              (t) =>
                t.kind === "grade" && t.status === "succeeded" && !t.adoptedAt,
            ) && (
              <Button variant="secondary" onClick={() => setBatchAdopt(true)}>
                批量核对采纳
              </Button>
            )}
            <small>关闭页面后继续处理，重启后可重试</small>
          </div>
          {visible.map((t) => (
            <div className="task-row" key={t.id}>
              <span className={`task-dot ${t.status}`} />
              <div className="task-main">
                <strong>
                  {kindNames[t.kind]}
                  {t.target?.studentId &&
                    ` · ${exam.students.find((s) => s.id === t.target!.studentId)?.name || ""}`}
                  {t.target?.questionId &&
                    ` · 第 ${exam.questions.find((q) => q.id === t.target!.questionId)?.label || ""} 题`}
                </strong>
                <small>
                  {dateTime(t.createdAt)} · {t.model}
                  {t.error && ` · ${t.error}`}
                </small>
              </div>
              <Badge
                tone={
                  t.status === "succeeded"
                    ? "teal"
                    : t.status === "failed"
                      ? "amber"
                      : "neutral"
                }
              >
                {t.adoptedAt ? "已采纳" : states[t.status]}
              </Badge>
              {["queued", "running"].includes(t.status) ? (
                <button
                  className="icon-btn"
                  aria-label="取消任务"
                  onClick={() => action(t, "cancel")}
                >
                  <Square size={15} />
                </button>
              ) : ["failed", "interrupted", "cancelled"].includes(t.status) ? (
                <Button variant="ghost" onClick={() => action(t, "retry")}>
                  <RotateCcw size={15} />
                  重试
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSelected(t);
                    setAdoptScore(String(t.result?.score ?? ""));
                    setError("");
                    setIncludeNote(false);
                  }}
                >
                  查看
                  <ChevronRight size={15} />
                </Button>
              )}
            </div>
          ))}
          {tasks.filter(eligible).length > limit && (
            <Button variant="ghost" onClick={() => setLimit((x) => x + 30)}>
              显示更多任务
            </Button>
          )}
        </>
      ) : null}
      {batchAdopt && (
        <BatchAdopt
          exam={exam}
          tasks={tasks}
          onClose={() => setBatchAdopt(false)}
          onDone={() => {
            void reload();
            onChanged();
          }}
        />
      )}
      {selected && (
        <Modal
          title={`${kindNames[selected.kind]} · 结果`}
          wide
          onClose={() => setSelected(null)}
        >
          {selected.kind === "grade" ? (
            <>
              <div className="suggestion-score">
                {selected.result.score}
                <small>建议得分</small>
              </div>
              <Field label="采用得分（可修改）">
                <input
                  type="number"
                  min="0"
                  max={
                    exam.questions.find(
                      (q) => q.id === selected.target?.questionId,
                    )?.max ?? undefined
                  }
                  step={
                    exam.questions.find(
                      (q) => q.id === selected.target?.questionId,
                    )?.step || 0.5
                  }
                  value={adoptScore}
                  onChange={(e) => setAdoptScore(e.target.value)}
                />
              </Field>
              <p>{selected.result.note || "无建议备注"}</p>
              {selected.result.uncertainty && (
                <Notice tone="warn">{selected.result.uncertainty}</Notice>
              )}
              <details>
                <summary>查看简要评分依据</summary>
                <p className="pre-wrap">{selected.result.justification}</p>
              </details>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={includeNote}
                  onChange={(e) => setIncludeNote(e.target.checked)}
                />
                同时采纳简短备注与标签，纳入学情分析
              </label>
            </>
          ) : selected.kind === "classify" ? (
            <>
              <Notice>
                以下是 AI
                对已有文字备注的归类建议。核对并采纳后，统计会将其标记为“已采用
                AI 归类”，与原有标签分开显示。
              </Notice>
              <div className="table-wrap compact">
                <table>
                  <thead>
                    <tr>
                      <th>学生 / 题目</th>
                      <th>原始备注</th>
                      <th>建议标签</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.result.items.map((x: any) => (
                      <tr key={x.ref}>
                        <td>
                          {
                            exam.students.find((s) => s.id === x.studentId)
                              ?.name
                          }{" "}
                          · 第{" "}
                          {
                            exam.questions.find((q) => q.id === x.questionId)
                              ?.label
                          }{" "}
                          题
                        </td>
                        <td>{x.note}</td>
                        <td>{x.categories.join("、") || "未分类"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : selected.kind === "report" ? (
            <>
              <p>{selected.result.summary}</p>
              {selected.result.findings?.map((f: any, i: number) => (
                <div className="finding" key={i}>
                  <h3>{f.title}</h3>
                  <p>{f.observation}</p>
                  <p>{f.action}</p>
                </div>
              ))}
              <Notice>完整报告与版本在“报告归档”中查看。</Notice>
            </>
          ) : (
            <>
              <Notice>
                以下为模型建议，采纳后请在试卷准备页核对题目与知识点。识别整卷会替换当前模板；已有成绩不兼容时系统会阻止替换。
              </Notice>
              <div className="table-wrap compact">
                <table>
                  <thead>
                    <tr>
                      <th>题号</th>
                      <th>题干 / 标识</th>
                      <th>满分</th>
                      <th>建议知识点</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.result.questions.map((q: any, i: number) => (
                      <tr key={i}>
                        <td>
                          {q.label ||
                            exam.questions.find((x) => x.id === q.id)?.label}
                        </td>
                        <td className="stem-cell">{q.stem || q.id}</td>
                        <td>{q.max ?? "—"}</td>
                        <td>{q.primary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <ErrorBox error={error} />
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setSelected(null)}>
              关闭
            </Button>
            {selected.kind !== "report" && !selected.adoptedAt && (
              <Button busy={busy} onClick={() => action(selected, "adopt")}>
                <Check size={16} />
                {selected.kind === "grade"
                  ? "采纳为最终成绩"
                  : selected.kind === "classify"
                    ? "确认采用这些归类"
                    : "采纳建议并继续核对"}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

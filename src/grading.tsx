import { useState, useEffect, useRef } from "react";
import {
  Upload,
  Download,
  Grid2X2,
  FileCheck,
  UserRound,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Save,
  History,
  Sparkles,
  Check,
  Search,
  Undo2,
} from "lucide-react";
import { api, keyOf, fmt, leafQuestions, dateTime, download } from "./api";
import { useDraft } from "./drafts";
import {
  Button,
  Field,
  Modal,
  Badge,
  Notice,
  ErrorBox,
  Empty,
  Completion,
} from "./components";
import { PdfViewer } from "./pdf";
import { BatchGrading } from "./batch";
import { BatchNotes } from "./bulk";
import { AITasks, AICompose, ImportModal, UploadModal } from "./workflows";
import type { Exam, Grade, Question, Student } from "./types";

const states = {
  ungraded: "未录入",
  draft: "草稿",
  final: "已确认",
  absent: "缺考",
  na: "不适用",
};
const newGrade = (s: string, q: string): Grade => ({
  studentId: s,
  questionId: q,
  score: null,
  status: "ungraded",
  note: "",
  tags: [],
  source: "teacher",
});
export function GradePage({
  exam,
  tags,
  onChanged,
  notify,
  initialQuestion,
  initialStudent,
}: {
  exam: Exam;
  tags: string[];
  onChanged: () => void;
  notify: (s: string) => void;
  initialQuestion?: string;
  initialStudent?: string;
}) {
  const qs = leafQuestions(exam),
    [mode, setMode] = useState<"grid" | "question" | "student">(
      initialQuestion ? "question" : initialStudent ? "student" : "grid",
    ),
    [studentId, setStudentId] = useState(
      initialStudent || exam.students[0]?.id || "",
    ),
    [questionId, setQuestionId] = useState(initialQuestion || qs[0]?.id || ""),
    [filter, setFilter] = useState(""),
    [notes, setNotes] = useState(false),
    [pasteFile, setPasteFile] = useState<File | null>(null),
    [batch, setBatch] = useState(false),
    [importing, setImporting] = useState(false),
    [upload, setUpload] = useState(false),
    [history, setHistory] = useState<any[] | null>(null),
    [compose, setCompose] = useState(false),
    [tick, setTick] = useState(0),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(0),
    [saved, setSaved] = useState(false);
  const [confirmDrafts, setConfirmDrafts] = useState(false);
  const readyDrafts = Object.values(exam.grades).filter(g => g.status === "draft" && qs.some(q => q.id === g.questionId && q.max != null));
  const student =
      exam.students.find((s) => s.id === studentId) || exam.students[0],
    q = qs.find((q) => q.id === questionId) || qs[0];
  const students = exam.students.filter((s) =>
    (s.name + s.number).includes(filter),
  );
  const file = exam.attachments
    .filter((a) => a.studentId === student?.id)
    .at(-1);
  async function save(g: Grade) {
    setSaving((x) => x + 1);
    setSaved(false);
    setError("");
    try {
      await api(`/exams/${exam.id}/grades`, { grades: [g] }, "PUT");
      setSaved(true);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setSaving((x) => x - 1);
    }
  }
  function select(s: string, q: string) {
    setStudentId(s);
    setQuestionId(q);
    setMode("question");
  }
  function next(dir: number) {
    if (mode === "student") {
      const i = qs.findIndex((x) => x.id === q.id);
      setQuestionId(qs[(i + dir + qs.length) % qs.length].id);
    } else {
      const i = exam.students.findIndex((x) => x.id === student.id);
      setStudentId(
        exam.students[(i + dir + exam.students.length) % exam.students.length]
          .id,
      );
    }
  }
  function paste(text: string, row: number, col: number) {
    try {
      const lines = text
        .replace(/\r/g, "")
        .replace(/\n+$/, "")
        .split("\n")
        .map((x) => x.split("\t"));
      const width = Math.max(...lines.map((x) => x.length));
      if (row + lines.length > students.length || col + width > qs.length)
        throw Error("粘贴范围超出当前学生或题目，请检查起始单元格。");
      const quote = (x: string) => '"' + x.replaceAll('"', '""') + '"';
      const csv = [
        ["学号", ...qs.slice(col, col + width).map((q) => q.label)],
        ...lines.map((cells, i) => [students[row + i].number, ...cells]),
      ]
        .map((row) => row.map(quote).join(","))
        .join("\n");
      setPasteFile(new File([csv], "粘贴成绩.csv", { type: "text/csv" }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function absent() {
    if (
      !window.confirm(
        `将 ${student.name} 的本次考试所有题目标记为缺考？原成绩会保留在修改历史。`,
      )
    )
      return;
    try {
      await api(
        `/exams/${exam.id}/grades`,
        {
          grades: qs.map((q) => ({
            ...newGrade(student.id, q.id),
            status: "absent",
          })),
          revision: exam.revision,
        },
        "PUT",
      );
      onChanged();
      notify("已标记缺考");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function undo(a: any) {
    try {
      await api(`/exams/${exam.id}/undo`, { auditId: a.id });
      onChanged();
      const rows = await api<any[]>(`/exams/${exam.id}/audit`);
      setHistory((current) => (current ? rows : null));
      notify("已撤销这次录分");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">第三步 · 保存逐题成绩</span>
          <h1>阅卷与录分</h1>
          <p>分数是必需输入，备注按需填写。未录入与零分分别保存。</p>
        </div>
        <div className="toolbar">
          {!!readyDrafts.length && <Button variant="secondary" onClick={() => setConfirmDrafts(true)}>核对并确认 {readyDrafts.length} 项草稿</Button>}
          <Button variant="secondary" disabled={!qs.length} onClick={() => download(`/exams/${exam.id}/export?mode=grades`, `${exam.name}-录分表.xlsx`).catch(e => setError(e.message))}>导出录分表</Button>
          <Button
            variant="secondary"
            disabled={!qs.length}
            onClick={() => setNotes(true)}
          >
            <MessageSquare size={16} />
            批量备注
          </Button>
          <Button
            variant="secondary"
            disabled={!qs.length}
            onClick={() => setBatch(true)}
          >
            <Sparkles size={16} />
            批量试批
          </Button>
          <Button variant="secondary" onClick={() => setUpload(true)}>
            <Upload size={16} />
            关联原卷
          </Button>
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <Upload size={16} />
            导入成绩
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              download(
                `/exams/${exam.id}/export?mode=long`,
                `${exam.name}-逐题明细.xlsx`,
              ).catch((e) => setError(e.message))
            }
          >
            <Download size={16} />
            导出明细
          </Button>
        </div>
      </div>
      {!qs.length ? (
        <Empty
          title="先添加可录分题目"
          detail="请在试卷准备页建立题目和分值，再开始阅卷。"
        />
      ) : (
        <>
          <div className="grading-toolbar">
            <div className="segmented" role="group" aria-label="阅卷视图">
              {(
                [
                  ["grid", "成绩表", Grid2X2],
                  ["question", "按题阅卷", FileCheck],
                  ["student", "按学生阅卷", UserRound],
                ] as const
              ).map(([v, label, Icon]) => (
                <button
                  key={v}
                  className={mode === v ? "active" : ""}
                  aria-pressed={mode === v}
                  onClick={() => setMode(v)}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
            <div className="save-status" role="status">
              {saving ? (
                "正在保存…"
              ) : saved ? (
                <>
                  <Check size={15} />
                  已保存到本机
                </>
              ) : mode === "grid" ? (
                "得分离开单元格时自动保存"
              ) : (
                "填写后保存，或保存并下一份"
              )}
            </div>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  setHistory(await api(`/exams/${exam.id}/audit`));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <History size={16} />
              修改历史
            </Button>
          </div>
          <ErrorBox error={error} />
          {mode === "grid" ? (
            <section className="panel score-panel">
              <div className="score-header">
                <label className="search-box">
                  <Search size={17} />
                  <input
                    aria-label="查找学生"
                    placeholder="查找姓名或学号"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </label>
                <span className="muted">
                  Enter 移到下一位 · 点击备注图标进入阅卷
                </span>
                <Badge tone="teal">
                  {exam.analysis.confirmedCells}/{exam.analysis.totalCells}{" "}
                  项已确认
                </Badge>
              </div>
              <div className="table-wrap score-scroll">
                <table className="score-table">
                  <thead>
                    <tr>
                      <th className="sticky-col">学生 / 学号</th>
                      {qs.map((q) => (
                        <th key={q.id}>
                          <button
                            onClick={() => {
                              setQuestionId(q.id);
                              setMode("question");
                            }}
                          >
                            {q.label}
                            <small>满分 {q.max}</small>
                          </button>
                        </th>
                      ))}
                      <th>总分</th>
                      <th>进度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, i) => {
                      const a = exam.analysis.students.find(
                        (x) => x.id === s.id,
                      )!;
                      return (
                        <tr key={s.id}>
                          <th scope="row" className="sticky-col">
                            <button
                              className="student-cell"
                              onClick={() => {
                                setStudentId(s.id);
                                setMode("student");
                              }}
                            >
                              <span className="avatar small">
                                {s.name.slice(0, 1)}
                              </span>
                              <span>
                                {s.name}
                                <small>{s.number}</small>
                              </span>
                            </button>
                          </th>
                          {qs.map((q, j) => (
                            <td key={q.id}>
                              <ScoreCell
                                student={s}
                                question={q}
                                grade={exam.grades[keyOf(s.id, q.id)]}
                                row={i}
                                col={j}
                                onSave={save}
                                onNote={() => select(s.id, q.id)}
                                onPaste={paste}
                              />
                            </td>
                          ))}
                          <td>
                            <strong className="tabular">
                              {a.absent ? "缺考" : fmt(a.total)}
                            </strong>
                          </td>
                          <td>
                            <Badge
                              tone={
                                a.complete
                                  ? "teal"
                                  : a.absent
                                    ? "neutral"
                                    : "amber"
                              }
                            >
                              {a.complete
                                ? "完整"
                                : a.absent
                                  ? "缺考"
                                  : `${a.confirmed}/${qs.length}`}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="table-footer">
                仅完整有效答卷显示总分。草稿与不适用项不会混入班级总分统计。
              </div>
            </section>
          ) : (
            <>
              <div className="review-selector">
                <Field label="当前学生">
                  <select
                    value={student.id}
                    onChange={(e) => setStudentId(e.target.value)}
                  >
                    {exam.students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.number} · {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="当前题目">
                  <select
                    value={q.id}
                    onChange={(e) => setQuestionId(e.target.value)}
                  >
                    {qs.map((q) => (
                      <option key={q.id} value={q.id}>
                        第 {q.label} 题 · {q.max} 分
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="review-nav">
                  <Button variant="secondary" onClick={() => next(-1)}>
                    <ChevronLeft size={16} />
                    上一{mode === "student" ? "题" : "位"}
                  </Button>
                  <Button variant="secondary" onClick={() => next(1)}>
                    下一{mode === "student" ? "题" : "位"}
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
              <div className="review-layout">
                <div className="paper-panel">
                  <PdfViewer
                    file={file}
                    initialPage={q.page}
                    region={q.region}
                  />
                </div>
                <section className="panel review-form">
                  <div className="review-title">
                    <Badge>{q.primary || "知识点未标注"}</Badge>
                    <strong>
                      第 {q.label} 题 <small>/ {q.max} 分</small>
                    </strong>
                  </div>
                  <p className="question-stem pre-wrap">
                    {q.stem || "暂无题干，仍可按纸卷录分。"}
                  </p>
                  {q.answer && (
                    <details>
                      <summary>参考答案与评分细则</summary>
                      <p className="pre-wrap">{q.answer}</p>
                      <p className="pre-wrap muted">{q.rubric}</p>
                    </details>
                  )}
                  <GradeEditor
                    examId={exam.id}
                    key={keyOf(student.id, q.id)}
                    grade={
                      exam.grades[keyOf(student.id, q.id)] ||
                      newGrade(student.id, q.id)
                    }
                    q={q}
                    tags={tags}
                    onSave={save}
                    onNext={() => next(1)}
                  />
                  <div className="review-secondary">
                    <Button
                      variant="ghost"
                      disabled={!file}
                      onClick={() => setCompose(true)}
                    >
                      <Sparkles size={16} />
                      AI 辅助试批
                    </Button>
                    <Button variant="ghost" onClick={absent}>
                      整卷缺考
                    </Button>
                  </div>
                  {!file && (
                    <small className="muted">
                      关联原卷后可使用 AI 试批；人工录分不需要附件。
                    </small>
                  )}
                </section>
              </div>
            </>
          )}
          <AITasks
            exam={exam}
            filter={["grade"]}
            tick={tick}
            onChanged={onChanged}
          />
        </>
      )}
      {notes && (
        <BatchNotes
          exam={exam}
          tags={tags}
          onClose={() => setNotes(false)}
          onDone={onChanged}
        />
      )}{" "}
      {pasteFile && (
        <ImportModal
          kind="grades"
          exam={exam}
          initialFile={pasteFile}
          onClose={() => setPasteFile(null)}
          onDone={onChanged}
        />
      )}{" "}
      {batch && (
        <BatchGrading
          exam={exam}
          onClose={() => setBatch(false)}
          onDone={() => setTick((x) => x + 1)}
        />
      )}{" "}
      {importing && (
        <ImportModal
          kind="grades"
          exam={exam}
          onClose={() => setImporting(false)}
          onDone={() => {
            onChanged();
            notify("成绩导入完成");
          }}
        />
      )}
      {confirmDrafts && <Modal title="确认小分草稿" wide onClose={() => setConfirmDrafts(false)}><Notice>以下题目的满分已填写。请核对原始小分后确认；超出范围或分数间隔不符时，整批不会写入。尚无满分的题目继续保留草稿。</Notice><div className="table-wrap"><table><thead><tr><th>学生</th><th>题号</th><th>草稿得分 / 满分</th></tr></thead><tbody>{readyDrafts.map(g => <tr key={keyOf(g.studentId, g.questionId)}><td>{exam.students.find(s => s.id === g.studentId)?.name}</td><td>{qs.find(q => q.id === g.questionId)?.label}</td><td>{g.score} / {qs.find(q => q.id === g.questionId)?.max}</td></tr>)}</tbody></table></div><ErrorBox error={error} /><Button busy={saving > 0} onClick={async () => { setSaving(x => x + 1); setSaved(false); try { await api(`/exams/${exam.id}/grades`, { revision: exam.revision, grades: readyDrafts.map(g => ({ ...g, status: "final" })) }, "PUT"); setConfirmDrafts(false); setSaved(true); onChanged(); } catch (e) { setError((e as Error).message); } finally { setSaving(x => x - 1); } }}>已核对，确认为最终成绩</Button></Modal>}
      {upload && (
        <UploadModal
          exam={exam}
          onClose={() => setUpload(false)}
          onDone={onChanged}
        />
      )}{" "}
      {compose && file && q && student && (
        <AICompose
          exam={exam}
          file={file}
          kind="grade"
          questionId={q.id}
          studentId={student.id}
          onClose={() => setCompose(false)}
          onDone={() => setTick((x) => x + 1)}
        />
      )}{" "}
      {history && (
        <Modal title="修改历史" onClose={() => setHistory(null)} wide>
          <ErrorBox error={error} />
          {history.length ? (
            history.map((a) => (
              <div className="history-row" key={a.id}>
                <History size={18} />
                <div>
                  <strong>{a.action}</strong>
                  <small>{dateTime(a.createdAt)}</small>
                  {[
                    "教师录分",
                    "导入成绩",
                    "采纳 AI 评分",
                    "撤销录分",
                    "采纳 AI 备注归类",
                  ].includes(a.action) && (
                    <p>
                      {a.after
                        .slice(0, 4)
                        .map(
                          (g: any) =>
                            `${exam.students.find((s) => s.id === g.studentId)?.name || ""} 第 ${qs.find((q) => q.id === g.questionId)?.label || ""} 题：${g.score ?? states[g.status as Grade["status"]]}`,
                        )
                        .join("；")}
                      {a.after.length > 4 ? " …" : ""}
                    </p>
                  )}
                </div>
                {[
                  "教师录分",
                  "导入成绩",
                  "采纳 AI 评分",
                  "撤销录分",
                  "采纳 AI 备注归类",
                ].includes(a.action) && (
                  <Button variant="ghost" onClick={() => undo(a)}>
                    <Undo2 size={15} />
                    撤销
                  </Button>
                )}
              </div>
            ))
          ) : (
            <Empty title="暂无修改记录" />
          )}
        </Modal>
      )}
    </>
  );
}
function ScoreCell({
  student,
  question,
  grade,
  row,
  col,
  onSave,
  onNote,
  onPaste,
}: {
  onPaste: (text: string, row: number, col: number) => void;
  student: Student;
  question: Question;
  grade?: Grade;
  row: number;
  col: number;
  onSave: (g: Grade) => Promise<void>;
  onNote: () => void;
}) {
  const [text, setText] = useState(grade?.score?.toString() ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(
    () => setText(grade?.score?.toString() ?? ""),
    [grade?.score, grade?.status],
  );
  async function blur() {
    if (text === (grade?.score?.toString() ?? "")) return;
    setError("");
    setBusy(true);
    try {
      await onSave({
        ...(grade || newGrade(student.id, question.id)),
        score: text.trim() === "" ? null : Number(text),
        status: text.trim() === "" ? "ungraded" : "final",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`score-cell ${grade?.status === "final" ? "final" : ""} ${error ? "invalid" : ""}`}
      title={error || grade?.note || ""}
    >
      {["absent", "na"].includes(grade?.status || "") ? (
        <button className="cell-status" onClick={onNote}>
          {states[grade!.status]}
        </button>
      ) : (
        <input
          type="number"
          min="0"
          max={question.max ?? undefined}
          step={question.step}
          aria-label={`${student.name} 第 ${question.label} 题得分`}
          aria-invalid={!!error}
          aria-describedby={error ? `err-${row}-${col}` : undefined}
          data-row={row}
          data-col={col}
          disabled={busy}
          value={text}
          placeholder="—"
          onChange={(e) => setText(e.target.value)}
          onBlur={blur}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text/plain");
            if (/[\t\r\n]/.test(text)) {
              e.preventDefault();
              onPaste(text, row, col);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
              document
                .querySelector<HTMLInputElement>(
                  `[data-row="${row + 1}"][data-col="${col}"]`,
                )
                ?.focus();
            }
          }}
        />
      )}
      <button
        className={`note-button ${grade?.note || grade?.tags.length ? "has-note" : ""}`}
        aria-label={`${student.name} 第 ${question.label} 题备注与状态`}
        onClick={onNote}
      >
        <MessageSquare size={13} />
      </button>
      {grade?.status === "draft" && (
        <span className="draft-dot" title="草稿">
          草稿
        </span>
      )}
      {error && (
        <span id={`err-${row}-${col}`} className="sr-only">
          {error}
        </span>
      )}
    </div>
  );
}
function GradeEditor({
  examId,
  grade,
  q,
  tags,
  onSave,
  onNext,
}: {
  examId: string;
  grade: Grade;
  q: Question;
  tags: string[];
  onSave: (g: Grade) => Promise<void>;
  onNext: () => void;
}) {
  const [buffer, setBuffer, draftStatus, clearBuffer] = useDraft(`grade-${examId}-${keyOf(grade.studentId, grade.questionId)}`, { draft: { ...grade }, score: grade.score?.toString() ?? "" });
  const draft = buffer.draft, score = buffer.score;
  const setDraft = (value: Grade | ((g: Grade) => Grade)) => setBuffer(b => ({ ...b, draft: typeof value === "function" ? value(b.draft) : value }));
  const setScore = (value: string) => setBuffer(b => ({ ...b, score: value }));
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(next = false) {
    setBusy(true);
    setError("");
    try {
      const hasScore = ["final", "draft"].includes(draft.status),
        g = {
          ...draft,
          score: hasScore && score.trim() !== "" ? Number(score) : null,
        };
      await onSave(g);
      await clearBuffer();
      setDirty(false);
      if (next) onNext();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="grade-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save(true);
      }}
    >
      <div className="form-grid">
        <p role="status">{draftStatus}</p>
        <Field label="最终得分">
          <input
            className="big-score"
            type="number"
            min="0"
            max={q.max ?? undefined}
            step={q.step}
            value={score}
            disabled={["absent", "na"].includes(draft.status)}
            onChange={(e) => {
              setScore(e.target.value);
              setDirty(true);
              if (draft.status === "ungraded")
                setDraft((x) => ({ ...x, status: "final" }));
            }}
          />
        </Field>
        <Field label="成绩状态">
          <select
            value={draft.status}
            onChange={(e) => {
              setDraft((x) => ({
                ...x,
                status: e.target.value as Grade["status"],
              }));
              setDirty(true);
              if (!["final", "draft"].includes(e.target.value)) setScore("");
            }}
          >
            {Object.entries(states).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="field">
        <span>
          问题标签 <small>可选</small>
        </span>
        <div className="tag-picker">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={draft.tags.includes(tag) ? "selected" : ""}
              aria-pressed={draft.tags.includes(tag)}
              onClick={() => {
                setDraft((g) => ({
                  ...g,
                  tags: g.tags.includes(tag)
                    ? g.tags.filter((t) => t !== tag)
                    : [...g.tags, tag],
                }));
                setDirty(true);
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
      {grade.aiTags?.length ? (
        <Notice>
          已采用 AI 归类：{grade.aiTags.join("、")}
          。修改文字备注后将清除原归类。
        </Notice>
      ) : null}
      <Field label="简短备注（可选）">
        <textarea
          rows={3}
          value={draft.note}
          placeholder="例如：第二问漏讨论 a=0。也可以留空。"
          onChange={(e) => {
            setDraft((g) => ({ ...g, note: e.target.value }));
            setDirty(true);
          }}
        />
      </Field>
      <ErrorBox error={error} />
      <div className="grade-save">
        <Button
          type="button"
          variant="secondary"
          busy={busy}
          onClick={() => save()}
        >
          <Save size={16} />
          保存
        </Button>
        <Button type="submit" busy={busy}>
          保存并下一份
          <ChevronRight size={16} />
        </Button>
      </div>
      {dirty && (
        <small className="dirty-note" role="status">
          有未提交修改，已暂存在本机。切换后可回来继续填写；点击保存才更新成绩。
        </small>
      )}
    </form>
  );
}

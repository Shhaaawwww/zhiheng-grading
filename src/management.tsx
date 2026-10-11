import { useState } from "react";
import {
  Plus,
  Users,
  Upload,
  Trash2,
  Pencil,
  FileText,
  Sparkles,
  CheckCheck,
  Save,
  BookOpen,
} from "lucide-react";
import { api, uid, leafQuestions, download } from "./api";
import {
  Button,
  Modal,
  Field,
  Notice,
  ErrorBox,
  Empty,
  Badge,
  SectionTitle,
} from "./components";
import { ImportModal, AITasks } from "./workflows";
import { PdfViewer } from "./pdf";
import { PaperScan } from "./paper-scan";
import { StructureTool } from "./teaching";
import { useDraft } from "./drafts";
import type { Boot, ClassRoom, Exam, Question, Settings } from "./types";

export function NewExam({
  classes,
  initialClassId,
  onClose,
  onCreated,
}: {
  classes: ClassRoom[];
  initialClassId?: string;
  onClose: () => void;
  onCreated: (exam: Exam) => void;
}) {
  const [classId, setClassId] = useState(
      initialClassId ||
        classes.find((c) => !c.demo && c.students.length)?.id ||
        classes[0]?.id ||
        "",
    ),
    [name, setName] = useState(""),
    [date, setDate] = useState(new Date().toLocaleDateString("sv-SE")),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onCreated(await api("/exams", { classId, name, date }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="新建考试" onClose={onClose}>
      <form onSubmit={create}>
        <Field label="考试名称">
          <input
            autoFocus
            required
            placeholder="例如：函数与导数单元检测"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="班级">
            <select
              required
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">选择班级</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.students.length} 人）
                </option>
              ))}
            </select>
          </Field>
          <Field label="考试日期">
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </div>
        <Notice>
          本次考试保存当前学生名单，之后调整班级不会改变已有考试。
        </Notice>
        <ErrorBox error={error} />
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" busy={busy}>
            创建考试
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ClassesPage({
  boot,
  onRefresh,
  onNewExam,
  notify,
}: {
  boot: Boot;
  onRefresh: () => Promise<void>;
  onNewExam: (classId: string) => void;
  notify: (s: string) => void;
}) {
  const [selected, setSelected] = useState(boot.classes[0]?.id || ""),
    [editing, setEditing] = useState<ClassRoom | null | "new">(null),
    [importing, setImporting] = useState(false);
  const classroom =
    boot.classes.find((c) => c.id === selected) || boot.classes[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">第一步 · 建立名单</span>
          <h1>班级与学生</h1>
          <p>先核对学号和姓名，再创建考试；每场考试保留当时的名单。</p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus size={17} />
          新建班级
        </Button>
      </div>
      <div className="classes-layout">
        <div className="class-list">
          {boot.classes.map((c) => (
            <button
              key={c.id}
              className={`class-card ${classroom?.id === c.id ? "selected" : ""}`}
              onClick={() => setSelected(c.id)}
            >
              <span className="class-avatar">
                <Users size={21} />
              </span>
              <strong>{c.name}</strong>
              <small>
                {c.grade} · {c.students.length} 名学生
              </small>
              {c.demo && <Badge>示例</Badge>}
            </button>
          ))}
          {!boot.classes.length && (
            <Empty title="还没有班级" detail="先建立班级，再导入学生名单。" />
          )}
        </div>
        <section className="panel">
          {classroom ? (
            <>
              <SectionTitle
                title={classroom.name}
                subtitle={`${classroom.students.length} 名学生 · 学号用于匹配原卷与成绩`}
                action={
                  <div className="toolbar">
                    <Button
                      variant="secondary"
                      onClick={() => setEditing(classroom)}
                    >
                      <Pencil size={15} />
                      编辑名单
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setImporting(true)}
                    >
                      <Upload size={15} />
                      导入名单
                    </Button>
                  </div>
                }
              />
              {classroom.students.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>序号</th>
                        <th>学号</th>
                        <th>姓名</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classroom.students.map((s, i) => (
                        <tr key={s.id}>
                          <td className="muted">
                            {String(i + 1).padStart(2, "0")}
                          </td>
                          <td className="tabular">{s.number}</td>
                          <td>{s.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="添加第一位学生"
                  detail="可以手工输入，也可以导入两列名单：学号、姓名。"
                >
                  <Button
                    variant="secondary"
                    onClick={() => setEditing(classroom)}
                  >
                    手工添加
                  </Button>
                </Empty>
              )}
              <div className="panel-bottom">
                <Button
                  disabled={!classroom.students.length}
                  onClick={() => onNewExam(classroom.id)}
                >
                  为班级创建考试
                </Button>
              </div>
            </>
          ) : (
            <Empty title="班级会显示在这里" />
          )}
        </section>
      </div>
      {editing && (
        <ClassEditor
          classroom={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (c) => {
            setSelected(c.id);
            await onRefresh();
            notify("班级名单已保存");
          }}
        />
      )}
      {importing && classroom && (
        <ImportModal
          kind="roster"
          classId={classroom.id}
          onClose={() => setImporting(false)}
          onDone={() => {
            void onRefresh();
            notify("名单导入完成");
          }}
        />
      )}
    </>
  );
}
function ClassEditor({
  classroom,
  onClose,
  onSaved,
}: {
  classroom: ClassRoom | null;
  onClose: () => void;
  onSaved: (c: ClassRoom) => Promise<void>;
}) {
  const [name, setName] = useState(classroom?.name || ""),
    [grade, setGrade] = useState(classroom?.grade || "高二"),
    [students, setStudents] = useState(
      classroom?.students || [{ id: uid(), number: "", name: "" }],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const list = students.filter((s) => s.name.trim() || s.number.trim());
      const c = await api<ClassRoom>(
        classroom ? "/classes/" + classroom.id : "/classes",
        { name, grade, students: list },
        classroom ? "PATCH" : "POST",
      );
      await onSaved(c);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={classroom ? "编辑班级与名单" : "新建班级"}
      wide
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="班级名称">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：高二（3）班"
            />
          </Field>
          <Field label="年级">
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              {["高一", "高二", "高三", "高中"].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>学号</th>
                <th>姓名</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => (
                <tr key={s.id}>
                  <td>
                    <input
                      aria-label={`第 ${i + 1} 位学生学号`}
                      value={s.number}
                      onChange={(e) =>
                        setStudents((xs) =>
                          xs.map((x) =>
                            x.id === s.id
                              ? { ...x, number: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`第 ${i + 1} 位学生姓名`}
                      value={s.name}
                      onChange={(e) =>
                        setStudents((xs) =>
                          xs.map((x) =>
                            x.id === s.id ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`移除第 ${i + 1} 位学生`}
                      onClick={() =>
                        setStudents((xs) => xs.filter((x) => x.id !== s.id))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            setStudents((xs) => [...xs, { id: uid(), name: "", number: "" }])
          }
        >
          <Plus size={15} />
          添加学生
        </Button>
        <ErrorBox error={error} />
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" busy={busy}>
            <Save size={16} />
            保存班级
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const typeNames: Record<Question["type"], string> = {
  choice: "单选题",
  multiple: "多选题",
  fill: "填空题",
  solve: "解答题",
  proof: "证明题",
  group: "大题汇总",
};
const blankQuestion = (): Question => ({
  id: uid(),
  label: "",
  parentId: null,
  stem: "",
  max: 5,
  step: 0.5,
  type: "fill",
  primary: "",
  related: [],
  confirmed: false,
  answer: "",
  rubric: "",
  page: 1,
  region: null,
});
export function PreparePage({
  exam,
  topics,
  onChanged,
  notify,
  settings,
  onReady,
  onSettings,
}: {
  exam: Exam;
  topics: string[];
  onChanged: () => void;
  notify: (s: string) => void;
  settings: Settings;
  onReady: (e: Exam) => void;
  onSettings: () => void;
}) {
  const [editing, setEditing] = useState<Question | null>(null),
    [showPaper, setShowPaper] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tick, setTick] = useState(0);
  const paper = exam.attachments.filter((a) => !a.studentId && a.role !== 'reference').at(-1),
    qs = leafQuestions(exam);
  async function saveAll(questions: Question[]) {
    setBusy(true);
    setError("");
    try {
      await api(
        `/exams/${exam.id}/questions`,
        { questions, revision: exam.revision },
        "PUT",
      );
      onChanged();
      notify("试卷模板已保存");
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function remove(q: Question) {
    if (
      !window.confirm(
        `删除第 ${q.label} 题及其小问？已有成绩的题目将受到保护。`,
      )
    )
      return;
    const removed = new Set([q.id]);
    let n = 0;
    while (n !== removed.size) {
      n = removed.size;
      exam.questions.forEach((x) => {
        if (x.parentId && removed.has(x.parentId)) removed.add(x.id);
      });
    }
    try {
      await saveAll(
        rebalance(exam.questions.filter((x) => !removed.has(x.id))),
      );
    } catch {}
  }
  async function tag() {
    setBusy(true);
    setError("");
    try {
      await api(`/exams/${exam.id}/tasks`, { kind: "tag" });
      setTick((x) => x + 1);
      notify("知识点建议任务已创建");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">第二步 · 整理这次试卷</span>
          <h1>试卷准备</h1>
          <p>
            导入试卷 PDF，AI
            自动识别题目、分值、题型和知识点，确认后老师只录小分。
          </p>
        </div>
        <div className="toolbar">
          <Button variant="ghost" onClick={() => setEditing(blankQuestion())}>
            <Plus size={17} />
            添加题目
          </Button>
          <StructureTool exam={exam} onChanged={onChanged} />
        </div>
      </div>
      <PaperScan
        key={exam.id}
        exam={exam}
        settings={settings}
        topics={topics}
        onChanged={onChanged}
        onReady={onReady}
        onSettings={onSettings}
      />
      <div className="prep-summary">
        <div>
          <BookOpen size={22} />
          <strong>
            {qs.length}
            <small>道计分题</small>
          </strong>
        </div>
        <div>
          <strong>
            {qs.some(q => q.max == null) ? "待核对；已知分值小计 " : ""}{qs.reduce((a, q) => a + (q.max ?? 0), 0)}
            <small>分 · 全卷满分</small>
          </strong>
        </div>
        <div>
          <strong>
            {qs.filter((q) => q.confirmed && q.primary).length}
            <small>项知识点已确认</small>
          </strong>
        </div>
        {paper && (
          <button className="paper-link" onClick={() => setShowPaper(true)}>
            <FileText size={18} />
            {paper.name}
          </button>
        )}
      </div>
      <section className="panel">
        <SectionTitle
          title="题目与知识点"
          subtitle="识别确认后会自动填好下表，全班共用。需要时可修改个别题目。"
          action={
            <div className="toolbar">
              <Button
                variant="ghost"
                disabled={!qs.length || busy}
                onClick={tag}
              >
                <Sparkles size={16} />
                建议知识点
              </Button>
              <Button
                variant="secondary"
                disabled={!qs.length || busy}
                onClick={() =>
                  saveAll(
                    exam.questions.map((q) => ({
                      ...q,
                      confirmed: !!q.primary || q.type === "group",
                    })),
                  ).catch(() => {})
                }
              >
                <CheckCheck size={16} />
                确认已有标签
              </Button>
            </div>
          }
        />
        <ErrorBox error={error} />
        {exam.questions.length ? (
          <div className="table-wrap">
            <table className="question-table">
              <thead>
                <tr>
                  <th>题号 / 类型</th>
                  <th>题目内容</th>
                  <th>满分</th>
                  <th>主要考查</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {exam.questions.map((q) => (
                  <tr
                    key={q.id}
                    className={q.type === "group" ? "group-row" : ""}
                  >
                    <td>
                      <strong>
                        {q.parentId ? "↳ " : ""}
                        {q.label}
                      </strong>
                      <small className="block muted">{typeNames[q.type]}</small>
                    </td>
                    <td className="stem-cell">
                      {q.stem || <span className="muted">未填写题干</span>}
                      {q.related.length > 0 && (
                        <small className="related">
                          涉及：{q.related.join(" · ")}
                        </small>
                      )}
                    </td>
                    <td className="tabular">{q.max}</td>
                    <td>
                      {q.type === "group" ? (
                        <span className="muted">按小问统计</span>
                      ) : (
                        q.primary || "待标注"
                      )}
                    </td>
                    <td>
                      {q.type !== "group" && (
                        <Badge
                          tone={q.confirmed && q.primary ? "teal" : "amber"}
                        >
                          {q.confirmed && q.primary ? "已确认" : "待核对"}
                        </Badge>
                      )}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="icon-btn"
                          aria-label={`编辑第 ${q.label} 题`}
                          onClick={() => setEditing(q)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`删除第 ${q.label} 题`}
                          onClick={() => remove(q)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="识别确认后，全班题目会出现在这里"
            detail="请使用上方“开始整卷识别”。题干、题型、分值和知识点由 AI 一次整理。"
          >
            <Button variant="ghost" onClick={() => setEditing(blankQuestion())}>
              <Plus size={16} />
              特殊情况：手工补充题目
            </Button>
          </Empty>
        )}
      </section>
      <AITasks
        exam={exam}
        filter={["extract", "tag"]}
        tick={tick}
        onChanged={onChanged}
      />
      {editing && (
        <QuestionEditor
          key={editing.id}
          question={editing}
          all={exam.questions}
          topics={topics}
          onClose={() => setEditing(null)}
          onSave={async (q) => {
            const list = exam.questions.some((x) => x.id === q.id)
              ? exam.questions.map((x) => (x.id === q.id ? q : x))
              : [...exam.questions, q];
            await saveAll(rebalance(list));
          }}
        />
      )}
      {showPaper && paper && (
        <Modal title="印刷题面原稿" onClose={() => setShowPaper(false)} wide>
          <div style={{ height: 650 }}>
            <PdfViewer file={paper} />
          </div>
        </Modal>
      )}
    </>
  );
}
function rebalance(list: Question[]) {
  let next = list.map((q) => ({ ...q }));
  for (let i = 0; i < next.length; i++)
    next = next.map((q) => {
      const cs = next.filter((c) => c.parentId === q.id);
      return cs.length
        ? {
            ...q,
            max: cs.some(c => c.max == null) ? null : Math.round(cs.reduce((a, c) => a + (c.max ?? 0), 0) * 100) / 100,
          }
        : q;
    });
  return next.sort((a, b) =>
    a.label.localeCompare(b.label, "zh-CN", { numeric: true }),
  );
}
function QuestionEditor({
  question,
  all,
  topics,
  onClose,
  onSave,
}: {
  question: Question;
  all: Question[];
  topics: string[];
  onClose: () => void;
  onSave: (q: Question) => Promise<void>;
}) {
  const [q, setQ, draftStatus, clearDraft] = useDraft(`question-${question.id}`, { ...question });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (key: keyof Question, value: any) =>
    setQ((x) => ({ ...x, [key]: value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(q);
      await clearDraft();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={question.label ? `编辑第 ${question.label} 题` : "添加题目"}
      wide
      onClose={onClose}
    >
      <form onSubmit={save}>
        <p role="status">{draftStatus}</p>
        <div className="form-grid three">
          <Field label="题号">
            <input
              autoFocus
              required
              value={q.label}
              placeholder="如 19(1)"
              onChange={(e) => set("label", e.target.value)}
            />
          </Field>
          <Field label="题型">
            <select
              value={q.type}
              onChange={(e) => set("type", e.target.value)}
            >
              {Object.entries(typeNames).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="所属大题">
            <select
              value={q.parentId || ""}
              onChange={(e) => set("parentId", e.target.value || null)}
            >
              <option value="">独立题目</option>
              {all
                .filter((x) => x.type === "group" && x.id !== q.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    第 {x.label} 题
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="题干与必要的图形条件">
          <textarea
            rows={3}
            value={q.stem}
            onChange={(e) => set("stem", e.target.value)}
            placeholder="粘贴或输入题干，例如：已知函数 f(x)=x²，求 f′(x)。"
          />
        </Field>
        <div className="form-grid three">
          <Field label="满分">
            <input
              type="number"
              min="0.1"
              step="0.1"
              placeholder="待核对，可先留空"
              value={q.max ?? ""}
              onChange={(e) => set("max", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
          <Field label="最小分数间隔" hint="可以打半分选 0.5；只打整数选 1。">
            <select
              value={q.step}
              onChange={(e) => set("step", Number(e.target.value))}
            >
              {[1, 0.5, 0.1].map((x) => (
                <option key={x} value={x}>
                  {x} 分
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="作答所在页码"
            hint="只录分时可保留默认值；看卷或试批前核对。"
          >
            <input
              type="number"
              min="1"
              max="300"
              value={q.page}
              onChange={(e) => set("page", Number(e.target.value))}
            />
          </Field>
        </div>
        {q.type !== "group" && (
          <>
            <div className="form-grid">
              <Field
                label="主要考查知识点"
                hint="综合题无法细分时，可填写综合题组名称。"
              >
                <input
                  list="topic-options"
                  value={q.primary}
                  onChange={(e) => {
                    set("primary", e.target.value);
                    set("confirmed", false);
                  }}
                />
                <datalist id="topic-options">
                  {topics.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Field>
              <Field
                label="相关知识（可选）"
                hint="用顿号分隔，不会把得分分摊到这些标签。"
              >
                <input
                  value={q.related.join("、")}
                  onChange={(e) =>
                    set(
                      "related",
                      e.target.value.split(/[、,，]/).filter(Boolean),
                    )
                  }
                />
              </Field>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={q.confirmed}
                disabled={!q.primary.trim()}
                onChange={(e) => set("confirmed", e.target.checked)}
              />
              已核对主要考查知识点
            </label>
            <Field label="具体考查技能（可选）"><input value={q.skill || ""} onChange={e => set("skill", e.target.value)} placeholder="例如：根据导数符号确定单调区间" /></Field>
            <label className="check-label"><input type="checkbox" checked={!!q.diagnosticExcluded} onChange={e => set("diagnosticExcluded", e.target.checked)} />暂不纳入知识诊断（分数和总分仍保留）</label>
          </>
        )}
        <details className="advanced">
          <summary>参考答案、评分细则与作答区域（可选）</summary>
          <Field label="参考答案">
            <textarea
              rows={2}
              value={q.answer}
              onChange={(e) => set("answer", e.target.value)}
            />
          </Field>
          <Field label="评分细则">
            <textarea
              rows={2}
              value={q.rubric}
              onChange={(e) => set("rubric", e.target.value)}
              placeholder="AI 试批前需要填写。允许不同解法、部分分和半分规则。"
            />
          </Field>
          <label className="check-label">
            <input
              type="checkbox"
              checked={!!q.region}
              onChange={(e) =>
                set(
                  "region",
                  e.target.checked ? { x: 0, y: 0, w: 1, h: 1 } : null,
                )
              }
            />
            为同版式原卷设定作答区域
          </label>
          {q.region && (
            <div className="form-grid four">
              {(
                [
                  ["x", "左侧位置"],
                  ["y", "顶部位置"],
                  ["w", "区域宽度"],
                  ["h", "区域高度"],
                ] as const
              ).map(([k, label]) => (
                <Field key={k} label={`${label}（%）`}>
                  <input
                    type="number"
                    min={k === "w" || k === "h" ? 1 : 0}
                    max="100"
                    step="1"
                    value={Math.round(q.region![k] * 100)}
                    onChange={(e) =>
                      set("region", {
                        ...q.region,
                        [k]: Number(e.target.value) / 100,
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          )}
        </details>
        <ErrorBox error={error} />
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" busy={busy}>
            <Save size={16} />
            保存题目
          </Button>
        </div>
      </form>
    </Modal>
  );
}

import { useState } from "react";
import { Check, Save } from "lucide-react";
import { api, keyOf, leafQuestions } from "./api";
import { Modal, Field, Notice, Button, ErrorBox, Badge } from "./components";
import type { Exam, Task } from "./types";
export function BatchNotes({
  exam,
  tags,
  onClose,
  onDone,
}: {
  exam: Exam;
  tags: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const qs = leafQuestions(exam),
    [questionId, setQuestionId] = useState(qs[0]?.id || ""),
    [selected, setSelected] = useState<string[]>([]),
    [note, setNote] = useState(""),
    [chosen, setChosen] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const students = exam.students.filter(
    (s) => exam.grades[keyOf(s.id, questionId)]?.status === "final",
  );
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const grades = selected.map((s) => {
        const g = exam.grades[keyOf(s, questionId)];
        return {
          ...g,
          note: [g.note, note.trim()].filter(Boolean).join("\n"),
          tags: [...new Set([...g.tags, ...chosen])],
        };
      });
      await api(
        `/exams/${exam.id}/grades`,
        { grades, revision: exam.revision },
        "PUT",
      );
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="批量追加备注与标签" wide onClose={onClose}>
      <Field label="备注对应题目">
        <select
          disabled={busy}
          value={questionId}
          onChange={(e) => {
            setQuestionId(e.target.value);
            setSelected([]);
          }}
        >
          {qs.map((q) => (
            <option key={q.id} value={q.id}>
              第 {q.label} 题
            </option>
          ))}
        </select>
      </Field>
      <Notice>
        仅对下方选中的已确认成绩追加备注。保存前请核对学生范围，之后可在修改历史中撤销这一批操作。
      </Notice>
      <div className="table-wrap compact">
        <table>
          <thead>
            <tr>
              <th>选择</th>
              <th>学生</th>
              <th>得分</th>
              <th>已有备注</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const g = exam.grades[keyOf(s.id, questionId)];
              return (
                <tr key={s.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`为 ${s.name} 追加备注`}
                      checked={selected.includes(s.id)}
                      disabled={busy}
                      onChange={(e) =>
                        setSelected((xs) =>
                          e.target.checked
                            ? [...xs, s.id]
                            : xs.filter((x) => x !== s.id),
                        )
                      }
                    />
                  </td>
                  <td>{s.name}</td>
                  <td>{g.score}</td>
                  <td className="pre-wrap">
                    {[g.note, ...g.tags].filter(Boolean).join("；") ||
                      "暂无备注"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Field label="追加的简短备注">
        <textarea
          rows={3}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="tag-picker">
        {tags.map((t) => (
          <button
            type="button"
            key={t}
            aria-pressed={chosen.includes(t)}
            className={chosen.includes(t) ? "selected" : ""}
            onClick={() =>
              setChosen((xs) =>
                xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t],
              )
            }
          >
            {t}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      <div className="modal-actions">
        <span className="muted">
          第 {qs.find((q) => q.id === questionId)?.label} 题 · 已选{" "}
          {selected.length} 人
        </span>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button
          busy={busy}
          disabled={!selected.length || (!note.trim() && !chosen.length)}
          onClick={apply}
        >
          <Save size={15} />
          确认追加到所选学生
        </Button>
      </div>
    </Modal>
  );
}
export function BatchAdopt({
  exam,
  tasks,
  onClose,
  onDone,
}: {
  exam: Exam;
  tasks: Task[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [includeNote, setIncludeNote] = useState(false),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState<string[]>([]),
    [errors, setErrors] = useState<string[]>([]);
  const ready = tasks.filter(
    (t) => t.kind === "grade" && t.status === "succeeded" && !t.adoptedAt,
  );
  async function apply() {
    setBusy(true);
    setErrors([]);
    for (const t of ready.filter(
      (t) => selected.includes(t.id) && !done.includes(t.id),
    )) {
      try {
        await api(`/tasks/${t.id}/adopt`, { includeNote });
        setDone((ds) => [...ds, t.id]);
      } catch (e) {
        setErrors((xs) => [
          ...xs,
          `${exam.students.find((s) => s.id === t.target?.studentId)?.name} · ${(e as Error).message}`,
        ]);
      }
    }
    setBusy(false);
    onDone();
  }
  return (
    <Modal
      title="核对并批量采纳 AI 建议"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Notice>
        逐条核对下方建议并勾选。已有成绩发生变化的记录会被跳过并提示，请回到单题阅卷复核。每次成功采纳均保留修改历史。
      </Notice>
      <div className="table-wrap compact">
        <table>
          <thead>
            <tr>
              <th>选择</th>
              <th>学生 / 题目</th>
              <th>建议分数</th>
              <th>备注 / 不确定处</th>
            </tr>
          </thead>
          <tbody>
            {ready.map((t) => (
              <tr key={t.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`采纳 ${exam.students.find((s) => s.id === t.target?.studentId)?.name} 第 ${exam.questions.find((q) => q.id === t.target?.questionId)?.label} 题建议`}
                    disabled={busy || done.includes(t.id)}
                    checked={selected.includes(t.id)}
                    onChange={(e) =>
                      setSelected((xs) =>
                        e.target.checked
                          ? [...xs, t.id]
                          : xs.filter((x) => x !== t.id),
                      )
                    }
                  />
                </td>
                <td>
                  {
                    exam.students.find((s) => s.id === t.target?.studentId)
                      ?.name
                  }{" "}
                  · 第{" "}
                  {
                    exam.questions.find((q) => q.id === t.target?.questionId)
                      ?.label
                  }{" "}
                  题
                </td>
                <td>
                  {t.result.score}
                  {done.includes(t.id) && <Badge tone="teal">已采纳</Badge>}
                </td>
                <td>
                  <p>{t.result.note || "无建议备注"}</p>
                  {t.result.uncertainty && (
                    <Badge tone="amber">{t.result.uncertainty}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={includeNote}
          disabled={busy}
          onChange={(e) => setIncludeNote(e.target.checked)}
        />
        同时采纳所选记录的简短备注与标签
      </label>
      {errors.map((e, i) => (
        <ErrorBox key={i} error={e} />
      ))}
      <div className="modal-actions">
        <span className="muted">已采纳 {done.length} 条</span>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          关闭
        </Button>
        <Button
          busy={busy}
          disabled={!selected.some((id) => !done.includes(id))}
          onClick={apply}
        >
          <Check size={16} />
          采纳所选建议
        </Button>
      </div>
    </Modal>
  );
}

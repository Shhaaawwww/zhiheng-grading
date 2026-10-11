import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { api, keyOf, leafQuestions } from "./api";
import { pageImage } from "./pdf";
import { Modal, Field, Notice, Button, ErrorBox, Badge } from "./components";
import type { Exam } from "./types";
export function BatchGrading({
  exam,
  onClose,
  onDone,
}: {
  exam: Exam;
  onClose: () => void;
  onDone: () => void;
}) {
  const qs = leafQuestions(exam),
    [ids, setIds] = useState<string[]>([]),
    [onlyMissing, setOnlyMissing] = useState(true),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(0),
    [errors, setErrors] = useState<string[]>([]);
  const stop = useRef(false),
    sent = useRef(new Set<string>());
  const students = exam.students.filter((s) =>
    exam.attachments.some((a) => a.studentId === s.id),
  );
  const jobs = students.flatMap((s) =>
    qs
      .filter(
        (q) =>
          ids.includes(q.id) &&
          !["absent", "na"].includes(
            exam.grades[keyOf(s.id, q.id)]?.status || "",
          ) &&
          (!onlyMissing || exam.grades[keyOf(s.id, q.id)]?.status !== "final"),
      )
      .map((q) => ({
        s,
        q,
        file: exam.attachments.filter((a) => a.studentId === s.id).at(-1)!,
      })),
  );
  async function run() {
    setBusy(true);
    setErrors([]);
    stop.current = false;
    for (const j of jobs) {
      if (stop.current) break;
      const key = keyOf(j.s.id, j.q.id);
      if (sent.current.has(key)) continue;
      try {
        const result = await pageImage(j.file, j.q.page, j.q.region);
        await api(`/exams/${exam.id}/tasks`, {
          kind: "grade",
          payload: {
            studentId: j.s.id,
            questionId: j.q.id,
            images: [result.image],
          },
        });
        sent.current.add(key);
        setDone(sent.current.size);
      } catch (e) {
        setErrors((v) => [
          ...v,
          `${j.s.name} · 第 ${j.q.label} 题：${(e as Error).message}`,
        ]);
        if (/API|密钥|模型名称/.test((e as Error).message)) break;
      }
    }
    setBusy(false);
    onDone();
  }
  return (
    <Modal
      title="批量创建 AI 试批任务"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Notice>
        按题目设定的页码与作答区域读取每位学生的最新原卷。请先抽查几份确认版式一致。每个“学生
        × 题目”创建一个请求；结果需在任务列表中逐条核对采纳。
      </Notice>
      <div className="batch-question-list">
        {qs.map((q) => (
          <label className="check-label" key={q.id}>
            <input
              type="checkbox"
              disabled={busy || !q.answer.trim() || !q.rubric.trim()}
              checked={ids.includes(q.id)}
              onChange={(e) =>
                setIds((xs) =>
                  e.target.checked
                    ? [...xs, q.id]
                    : xs.filter((x) => x !== q.id),
                )
              }
            />
            <span>
              第 {q.label} 题 · {q.max} 分 · 第 {q.page} 页
            </span>
            <Badge tone={q.answer.trim() && q.rubric.trim() ? "teal" : "amber"}>
              {q.answer.trim() && q.rubric.trim()
                ? "评分规则就绪"
                : "需补答案与细则"}
            </Badge>
            {q.region ? <small>已设作答区域</small> : <small>发送整页</small>}
          </label>
        ))}
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={onlyMissing}
          disabled={busy}
          onChange={(e) => setOnlyMissing(e.target.checked)}
        />
        仅试批尚未确认最终成绩的题目
      </label>
      <p className="muted">
        {students.length}/{exam.students.length} 名学生已关联原卷 · 预计创建{" "}
        {jobs.length} 个任务。单批最多 200 个，可按题分批。
      </p>
      {done > 0 && (
        <Notice tone="success">
          已创建 {done} 个任务，可在页面下方查看处理进度。
        </Notice>
      )}
      {errors.map((e, i) => (
        <ErrorBox error={e} key={i} />
      ))}
      <div className="modal-actions">
        <Button
          variant="secondary"
          onClick={() => {
            if (busy) stop.current = true;
            else onClose();
          }}
        >
          {busy ? "停止继续创建" : "关闭"}
        </Button>
        <Button
          busy={busy}
          disabled={
            !jobs.length ||
            jobs.length > 200 ||
            sent.current.size === jobs.length
          }
          onClick={run}
        >
          <Sparkles size={16} />
          {done ? "继续创建剩余任务" : "创建试批任务"}
        </Button>
      </div>
    </Modal>
  );
}

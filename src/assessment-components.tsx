import { useEffect, useState } from "react";
import { api, uid, fmt, keyOf } from "./api";
import { Button, Modal, Field, Notice, ErrorBox } from "./components";
import { useDraft } from "./drafts";
import { documentPageCount, regionImage, PdfViewer } from "./pdf";
import type {
  Exam,
  Question,
  Task,
  RubricSpec,
  AnswerMap,
  AnswerRegion,
  Attachment,
  CriterionEvidence,
} from "./types";

const whole = { x: 0, y: 0, w: 1, h: 1 };
export const statusNames = {
  demonstrated: "本次已表现",
  error: "有明确错误",
  not_observed: "未观察到",
  blocked: "受前面错误影响",
  unreadable: "无法辨认",
  not_applicable: "此解法不适用",
};
export const freshRegion = (page = 1): AnswerRegion => ({
  id: uid(),
  page,
  box: { ...whole },
  rotation: 0,
  label: "",
});
export function RubricEditor({
  exam,
  q,
  task,
  hash,
  onClose,
  onDone,
}: {
  exam: Exam;
  q: Question;
  task?: Task;
  hash: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const initial: RubricSpec = task?.result?.spec ||
    q.rubricSpec || {
      version: 1,
      confirmed: false,
      origin: "teacher",
      answer: q.answer || "",
      instructions: q.rubric || "",
      criteria: [
        {
          id: uid(),
          part: "",
          label: "本题作答",
          points: q.max,
          skills: [q.primary || "待核对"],
          expected: "",
          alternatives: "",
        },
      ],
      warnings: [],
      sourceRefs: [],
    };
  const [draft, setDraft, status, clear] = useDraft(
    `rubric:${exam.id}:${q.id}:${hash}:${task?.id || "manual"}`,
    {
      spec: initial,
      statement: task?.result?.statement || q.stem,
      acknowledgeImpact: false,
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [sourceId, setSourceId] = useState(
    initial.sourceRefs[0]?.fileId ||
      exam.attachments.find((f) => !f.studentId)?.id ||
      "",
  );
  const { spec } = draft;
  const patch = (v: Partial<RubricSpec>) =>
    setDraft((d) => ({ ...d, spec: { ...d.spec, ...v } }));
  const row = (i: number, v: any) =>
    patch({
      criteria: spec.criteria.map((c, j) => (i === j ? { ...c, ...v } : c)),
    });
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(
        `/exams/${exam.id}/rubric/${q.id}`,
        { ...draft, expectedHash: hash, taskId: task?.id },
        "PUT",
      );
      await clear();
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide title={`第 ${q.label} 题 · 核对评分标准`} onClose={onClose}>
      <Notice>
        这份标准供全班共用。核对题面、参考答案及每个评分点后确认；没有官方答案时，AI
        自行解答的内容也需要核对。
      </Notice>
      <details>
        <summary>对照题面／参考答案原图</summary>
        <Field label="核对来源文件">
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            {exam.attachments
              .filter((f) => !f.studentId)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </Field>
        <PdfViewer
          key={sourceId}
          file={exam.attachments.find((f) => f.id === sourceId)}
          initialPage={
            spec.sourceRefs.find((s) => s.fileId === sourceId)?.pages[0] || 1
          }
        />
      </details>
      {spec.warnings.map((w, i) => (
        <p className="notice" key={i}>
          {w}
        </p>
      ))}
      <Field label="题面（可修改识别错误）">
        <textarea
          rows={4}
          value={draft.statement}
          onChange={(e) =>
            setDraft((d) => ({ ...d, statement: e.target.value }))
          }
        />
      </Field>
      <Field label="参考答案与关键步骤">
        <textarea
          rows={5}
          value={spec.answer}
          onChange={(e) => patch({ answer: e.target.value })}
        />
      </Field>
      <Field label="给分规则、等价解法及前错后对的处理">
        <textarea
          rows={3}
          value={spec.instructions}
          onChange={(e) => patch({ instructions: e.target.value })}
        />
      </Field>
      {spec.criteria.map((c, i) => (
        <fieldset className="assessment-card" key={c.id}>
          <legend>评分点 {i + 1}</legend>
          <div className="form-row">
            <Field label="小问">
              <input
                value={c.part}
                onChange={(e) => row(i, { part: e.target.value })}
              />
            </Field>
            <Field label="评分点名称">
              <input
                value={c.label}
                onChange={(e) => row(i, { label: e.target.value })}
              />
            </Field>
            <Field label="满分（留空表示只判断表现）">
              <input
                type="number"
                min={0}
                step={q.step}
                value={c.points ?? ""}
                onChange={(e) =>
                  row(i, {
                    points:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>
          <Field label="考查技能（多个用顿号分隔）">
            <input
              value={c.skills.join("、")}
              onChange={(e) =>
                row(i, { skills: e.target.value.split(/[、,，]/) })
              }
            />
          </Field>
          <Field label="应当看到的作答证据">
            <textarea
              rows={2}
              value={c.expected}
              onChange={(e) => row(i, { expected: e.target.value })}
            />
          </Field>
          <Field label="允许的其他解法">
            <textarea
              rows={2}
              value={c.alternatives}
              onChange={(e) => row(i, { alternatives: e.target.value })}
            />
          </Field>
          <Button
            variant="ghost"
            disabled={spec.criteria.length === 1}
            onClick={() =>
              patch({ criteria: spec.criteria.filter((_, j) => j !== i) })
            }
          >
            移除此评分点
          </Button>
        </fieldset>
      ))}
      <Button
        variant="secondary"
        onClick={() =>
          patch({
            criteria: [
              ...spec.criteria,
              {
                id: uid(),
                part: "",
                label: "",
                points: null,
                skills: [""],
                expected: "",
                alternatives: "",
              },
            ],
          })
        }
      >
        添加评分点
      </Button>
      <p>
        评分点合计：
        {spec.criteria.some((c) => c.points == null)
          ? "未分配逐点分值"
          : fmt(spec.criteria.reduce((s, c) => s + (c.points || 0), 0))}{" "}
        / 本题 {fmt(q.max)} 分
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={spec.confirmed}
          onChange={(e) => patch({ confirmed: e.target.checked })}
        />
        我已核对标准，可用于本次预批
      </label>
      {Object.values(exam.evaluations || {}).some(
        (x: any) => x.questionId === q.id,
      ) && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={draft.acknowledgeImpact}
            onChange={(e) =>
              setDraft((d) => ({ ...d, acknowledgeImpact: e.target.checked }))
            }
          />
          我知道修改标准后，旧逐点解释需重新核对；已有最终分数会保留
        </label>
      )}
      <ErrorBox error={error} />
      <p className="muted">{status}</p>
      <Button busy={busy} onClick={save}>
        保存评分标准
      </Button>
    </Modal>
  );
}

export function MappingEditor({
  exam,
  q,
  file,
  onClose,
  onDone,
}: {
  exam: Exam;
  q: Question;
  file: Attachment;
  onClose: () => void;
  onDone: () => void;
}) {
  const old = exam.answerMaps?.[`${file.id}:${q.id}`];
  const [draft, setDraft, status, clear] = useDraft<AnswerMap>(
    `regions:${exam.id}:${file.id}:${q.id}:${old?.version || 0}`,
    old || {
      questionId: q.id,
      studentId: file.studentId || null,
      fileId: file.id,
      regions: [freshRegion(q.page || 1)],
      warnings: [],
      confirmed: false,
      edited: true,
      version: 1,
    },
  );
  const [index, setIndex] = useState(0),
    [count, setCount] = useState(1),
    [preview, setPreview] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const r = draft.regions[index] || draft.regions[0];
  const patch = (v: Partial<AnswerRegion>) =>
    setDraft((d) => ({
      ...d,
      confirmed: false,
      regions: d.regions.map((x, i) => (i === index ? { ...x, ...v } : x)),
    }));
  useEffect(() => {
    let active = true;
    documentPageCount(file)
      .then((n) => {
        if (active) setCount(n);
      })
      .catch((e) => setError(e.message));
    regionImage(file, { ...r, box: whole }, 1200)
      .then((x) => {
        if (active) setPreview(x);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [file.id, r.page, r.rotation]);
  function point(e: React.PointerEvent<HTMLDivElement>) {
    const b = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
      y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
    };
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (draft.regions.some((r) => r.page > count))
        throw Error("页码超出本文件范围。");
      await api(
        `/exams/${exam.id}/answer-map`,
        { mapping: draft, expectedVersion: old?.version || 0 },
        "PUT",
      );
      await clear();
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
      wide
      title={`第 ${q.label} 题 · 调整题目与作答区域`}
      onClose={onClose}
    >
      <Notice>
        拖动框选整道题的作答；续写在其他页时点击“添加续页区域”。也可用下方数字调整，坐标为页面百分比。保存后需要重新预批本题。
      </Notice>
      <Field label="当前区域">
        <select
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
        >
          {draft.regions.map((v, i) => (
            <option value={i} key={v.id}>
              区域 {i + 1} · 第 {v.page} 页
            </option>
          ))}
        </select>
      </Field>
      <div className="form-row">
        <Field label={`页码（共 ${count} 页）`}>
          <input
            type="number"
            min={1}
            max={count}
            value={r.page}
            onChange={(e) =>
              patch({ page: Math.max(1, Number(e.target.value)) })
            }
          />
        </Field>
        <Field label="页面旋转">
          <select
            value={r.rotation}
            onChange={(e) =>
              patch({
                rotation: Number(e.target.value) as AnswerRegion["rotation"],
                box: whole,
              })
            }
          >
            {[0, 90, 180, 270].map((x) => (
              <option key={x} value={x}>
                {x}°
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div
        className="region-canvas"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setStart(point(e));
        }}
        onPointerUp={(e) => {
          if (!start) return;
          const end = point(e),
            w = Math.abs(end.x - start.x),
            h = Math.abs(end.y - start.y);
          if (w > 0.005 && h > 0.005)
            patch({
              box: {
                x: Math.min(start.x, end.x),
                y: Math.min(start.y, end.y),
                w,
                h,
              },
            });
          setStart(null);
        }}
      >
        {preview && (
          <img src={preview} alt={`第 ${r.page} 页原卷，可拖动框选`} />
        )}
        <span
          className="region-overlay"
          style={{
            left: r.box.x * 100 + "%",
            top: r.box.y * 100 + "%",
            width: r.box.w * 100 + "%",
            height: r.box.h * 100 + "%",
          }}
        />
      </div>
      <div className="form-row">
        {(["x", "y", "w", "h"] as const).map((k, i) => (
          <Field
            key={k}
            label={["左边距 %", "上边距 %", "宽度 %", "高度 %"][i]}
          >
            <input
              type="number"
              min={k === "w" || k === "h" ? 0.1 : 0}
              max={100}
              step={0.1}
              value={Math.round(r.box[k] * 1000) / 10}
              onChange={(e) =>
                patch({ box: { ...r.box, [k]: Number(e.target.value) / 100 } })
              }
            />
          </Field>
        ))}
      </div>
      <div className="toolbar">
        <Button variant="secondary" onClick={() => patch({ box: whole })}>
          包含整页
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setDraft((d) => ({
              ...d,
              regions: [...d.regions, freshRegion(Math.min(count, r.page + 1))],
            }));
            setIndex(draft.regions.length);
          }}
        >
          添加续页区域
        </Button>
        <Button
          variant="ghost"
          disabled={draft.regions.length === 1}
          onClick={() => {
            setDraft((d) => ({
              ...d,
              regions: d.regions.filter((_, i) => i !== index),
            }));
            setIndex(0);
          }}
        >
          移除区域
        </Button>
      </div>
      <ErrorBox error={error} />
      <p className="muted">{status}</p>
      <Button busy={busy} onClick={save}>
        保存作答区域
      </Button>
    </Modal>
  );
}

export function AssessmentReview({
  exam,
  task,
  hash,
  onClose,
  onDone,
}: {
  exam: Exam;
  task: Task;
  hash: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const q = exam.questions.find((q) => q.id === task.target?.questionId)!,
    s = exam.students.find((s) => s.id === task.target?.studentId)!,
    file = exam.attachments.find((f) => f.id === task.target?.fileId)!;
  const mapping = exam.answerMaps?.[`${file?.id}:${q.id}`];
  const previous = exam.grades[keyOf(s.id, q.id)];
  const committed = (exam.evaluations || {})[keyOf(s.id, q.id)] as any;
  const [draft, setDraft, status, clear] = useDraft(
    `review:${exam.id}:${task.id}:${hash}`,
    {
      criteria: (committed?.sourceTaskId === task.id &&
      committed.gradeHash === hash
        ? committed.criteria
        : task.result.criteria) as CriterionEvidence[],
      score: previous?.status === "final" ? previous.score : task.result.score,
      scoreAction: previous?.status === "final" ? "keep" : "apply",
      note: previous?.note || "",
      coverageConfirmed: false,
      diagnosticOnly: false,
    },
  );
  const [images, setImages] = useState<string[]>([]),
    [full, setFull] = useState(false),
    [show, setShow] = useState(false),
    [zoom, setZoom] = useState(100),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (mapping && file)
      Promise.all(
        mapping.regions.map((r) =>
          regionImage(file, full ? { ...r, box: whole } : r),
        ),
      )
        .then((x) => {
          if (active) setImages(x);
        })
        .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [file?.id, full]);
  const row = (i: number, v: Partial<CriterionEvidence>) =>
    setDraft((d) => ({
      ...d,
      criteria: d.criteria.map((c, j) =>
        i === j ? { ...c, accepted: false, ...v } : c,
      ),
    }));
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/tasks/${task.id}/review-assessment`, {
        ...draft,
        expectedGradeHash: hash,
      });
      await clear();
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!mapping || !q.rubricSpec)
    return (
      <Modal title="作答区域已改变" onClose={onClose}>
        <Notice>请重新定位并预批后复核。</Notice>
      </Modal>
    );
  return (
    <Modal
      wide
      title={`${s.name} · 第 ${q.label} 题 · 教师复核`}
      onClose={onClose}
    >
      <Notice>
        先看原卷，再展开 AI
        建议。只有确认的分数进入成绩；勾选确认的逐点表现才进入知识分析。未确认的判断不会成为学情结论。
      </Notice>
      <div className="assessment-review">
        <section aria-label="原卷证据">
          <div className="toolbar">
            <Button variant="secondary" onClick={() => setFull(!full)}>
              {full ? "只看作答区域" : "查看所在整页"}
            </Button>
            <Field label="原图大小">
              <select
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              >
                {[75, 100, 150, 200].map((x) => (
                  <option key={x} value={x}>
                    {x}%
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="evidence-images">
            {mapping.regions.map((r, i) => (
              <figure key={r.id} id={`evidence-${r.id}`}>
                <figcaption>
                  区域 {i + 1} · 原卷第 {r.page} 页
                </figcaption>
                {images[i] && (
                  <img
                    style={{ width: zoom + "%", maxWidth: "none" }}
                    src={images[i]}
                    alt={`${s.name} 第 ${q.label} 题第 ${r.page} 页实际作答`}
                  />
                )}
              </figure>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={draft.coverageConfirmed}
              onChange={(e) =>
                setDraft((d) => ({ ...d, coverageConfirmed: e.target.checked }))
              }
            />
            已核对题号和学生，作答区域完整（包括续页）
          </label>
        </section>
        <section aria-label="评分与诊断复核">
          <Button variant="secondary" onClick={() => setShow(!show)}>
            {show ? "收起 AI 建议" : "展开 AI 建议"}
          </Button>
          {show && (
            <>
              <p>{task.result.summary}</p>
              {(task.result.warnings || []).map((w: string, i: number) => (
                <p className="notice" key={i}>
                  {w}
                </p>
              ))}
              <details>
                <summary>识别出的作答与其他解法</summary>
                <pre className="wrap-text">{task.result.transcription}</pre>
                <p>{task.result.alternativeMethod}</p>
              </details>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={draft.criteria.every((c) => c.accepted)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      criteria: d.criteria.map((c) => ({
                        ...c,
                        accepted: e.target.checked,
                      })),
                    }))
                  }
                />
                已逐项核对，确认下列全部表现（仍可逐项取消）
              </label>
              {draft.criteria.map((c, i) => {
                const def = q.rubricSpec!.criteria.find(
                  (x) => x.id === c.criterionId,
                )!;
                return (
                  <fieldset className="assessment-card" key={c.criterionId}>
                    <legend>
                      {def.part} {def.label}
                    </legend>
                    <p className="muted">
                      {def.skills.join("、")} · {def.expected}
                    </p>
                    <div className="form-row">
                      <Field label="本次表现">
                        <select
                          value={c.status}
                          onChange={(e) =>
                            row(i, {
                              status: e.target
                                .value as CriterionEvidence["status"],
                              ...(e.target.value === "unreadable"
                                ? { score: null }
                                : {}),
                            })
                          }
                        >
                          {Object.entries(statusNames).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {def.points != null && (
                        <Field label={`本评分点得分 / ${def.points}`}>
                          <input
                            type="number"
                            min={0}
                            max={def.points}
                            step={q.step}
                            value={c.score ?? ""}
                            onChange={(e) =>
                              row(i, {
                                score:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                      )}
                    </div>
                    <Field label="具体表现或需核对之处">
                      <textarea
                        rows={3}
                        value={c.comment}
                        onChange={(e) => row(i, { comment: e.target.value })}
                      />
                    </Field>
                    <p>
                      分别核对关联技能；只有这一步的整体分数，不能判断每个技能。
                    </p>
                    {def.skills.map((skill) => {
                      const v = c.skillEvidence?.find(
                        (x) => x.skill === skill,
                      ) || {
                        skill,
                        status: "not_observed" as const,
                        comment: "",
                      };
                      const edit = (change: Partial<typeof v>) =>
                        row(i, {
                          skillEvidence: [
                            ...(c.skillEvidence || []).filter(
                              (x) => x.skill !== skill,
                            ),
                            { ...v, ...change },
                          ],
                        });
                      return (
                        <div key={skill}>
                          <Field label={`${skill} · 本次证据`}>
                            <select
                              value={v.status}
                              onChange={(e) =>
                                edit({
                                  status: e.target
                                    .value as CriterionEvidence["status"],
                                })
                              }
                            >
                              {Object.entries(statusNames).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label={`${skill} · 依据说明`}>
                            <input
                              value={v.comment}
                              onChange={(e) =>
                                edit({ comment: e.target.value })
                              }
                            />
                          </Field>
                        </div>
                      );
                    })}
                    <Button
                      variant="ghost"
                      disabled={c.references.length >= 12}
                      onClick={() =>
                        row(i, {
                          references: [
                            ...c.references,
                            {
                              regionId: mapping.regions[0].id,
                              location: "",
                              quote: "",
                            },
                          ],
                        })
                      }
                    >
                      添加原图依据
                    </Button>
                    {c.references.map((r, j) => (
                      <p key={j}>
                        <a
                          href={`#evidence-${r.regionId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            document
                              .getElementById(`evidence-${r.regionId}`)
                              ?.scrollIntoView({ block: "nearest" });
                          }}
                        >
                          查看依据
                        </a>{" "}
                        {r.location} {r.quote}
                      </p>
                    ))}
                    {c.references.map((r, j) => (
                      <div key={"edit-" + j}>
                        <Field label={`证据 ${j + 1} 原图区域`}>
                          <select
                            value={r.regionId}
                            onChange={(e) =>
                              row(i, {
                                references: c.references.map((v, n) =>
                                  n === j
                                    ? { ...v, regionId: e.target.value }
                                    : v,
                                ),
                              })
                            }
                          >
                            {mapping.regions.map((region, n) => (
                              <option key={region.id} value={region.id}>
                                区域 {n + 1} · 第 {region.page} 页
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            row(i, {
                              references: c.references.filter(
                                (_, n) => n !== j,
                              ),
                            })
                          }
                        >
                          移除证据 {j + 1}
                        </Button>
                        <Field label={`证据 ${j + 1} 所在位置`}>
                          <input
                            value={r.location}
                            onChange={(e) =>
                              row(i, {
                                references: c.references.map((v, n) =>
                                  n === j
                                    ? { ...v, location: e.target.value }
                                    : v,
                                ),
                              })
                            }
                          />
                        </Field>
                        <Field label={`证据 ${j + 1} 可见原文（可纠正识别）`}>
                          <textarea
                            rows={2}
                            value={r.quote}
                            onChange={(e) =>
                              row(i, {
                                references: c.references.map((v, n) =>
                                  n === j ? { ...v, quote: e.target.value } : v,
                                ),
                              })
                            }
                          />
                        </Field>
                      </div>
                    ))}
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={c.accepted}
                        onChange={(e) => row(i, { accepted: e.target.checked })}
                      />
                      确认这条表现，用于学情分析
                    </label>
                  </fieldset>
                );
              })}
            </>
          )}
          <Field label="最终分数的处理">
            <select
              value={draft.scoreAction}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  scoreAction: e.target.value,
                  score: e.target.value === "keep" ? previous?.score : d.score,
                }))
              }
            >
              {previous?.status === "final" && (
                <option value="keep">保留教师原分数 {previous.score}</option>
              )}
              <option value="apply">采用下面的最终分数</option>
            </select>
          </Field>
          <Field label={`最终得分 / ${q.max}`}>
            <input
              type="number"
              min={0}
              max={q.max ?? undefined}
              step={q.step}
              disabled={draft.scoreAction === "keep"}
              value={draft.score ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  score: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
            />
          </Field>
          <label className="check-label">
            <input
              type="checkbox"
              checked={draft.diagnosticOnly}
              onChange={(e) =>
                setDraft((d) => ({ ...d, diagnosticOnly: e.target.checked }))
              }
            />
            只保留已确认的表现；逐点合计与最终分数不同则清空逐点分数
          </label>
          <Field label="教师备注（可留空）">
            <textarea
              rows={2}
              value={draft.note}
              onChange={(e) =>
                setDraft((d) => ({ ...d, note: e.target.value }))
              }
            />
          </Field>
        </section>
      </div>
      <ErrorBox error={error} />
      <p className="muted">{status}</p>
      <Button
        busy={busy}
        disabled={!draft.coverageConfirmed || draft.score == null}
        onClick={save}
      >
        确认本题分数与所选表现
      </Button>
    </Modal>
  );
}

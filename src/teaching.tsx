import { EvidenceOverview } from './assessment';
import { useEffect, useState } from "react";
import { api, pct, uid } from "./api";
import { Button, Field, Notice, ErrorBox, Badge, Modal } from "./components";
import { useDraft } from "./drafts";
import type { Exam } from "./types";

const outcomeNames: Record<string, string> = { pending: "尚未复测", independent: "独立达到目标", support: "仍需支持 / 有提示才完成", absent: "未参加", delayed: "需延后再检查" };
export function TeachingPage({ exam, onChanged, onGrade }: { exam: Exam; onChanged: () => void; onGrade: (q?: string, s?: string) => void }) {
  const [view, setView] = useState<any>(null), [error, setError] = useState(""), [editing, setEditing] = useState<any>(null);
  useEffect(() => { void api(`/exams/${exam.id}/teaching`).then(setView).catch(e => setError(e.message)); }, [exam.id, exam.revision]);
  return <>
    <div className="page-heading"><div><span className="eyebrow">第五步 · 讲评、辅导、复测</span><h1>教学与复测</h1><p>从本次题目表现选择目标，安排短练习，再确认谁还需要帮助。</p></div></div>
    <ErrorBox error={error} /><EvidenceOverview exam={exam}/>
    <Notice>知识点已确认 {view?.coverage?.confirmed || 0}/{view?.coverage?.total || 0} 道题。以下为本次题组表现，未考查的知识不作判断；低分不能单独证明具体错因或教学质量。</Notice>
    <section className="panel"><h2>本次优先讲评（最多三项）</h2>{!view?.priorities?.length && <p>暂没有可诊断的失分题组。请先确认知识点并录入最终小分。</p>}
      {view?.priorities?.map((t: any) => <article className="finding" key={t.name}><h3>{t.name}</h3><p>完整完成该题组 {t.n} 人，得分率 {pct(t.rate)}；证据：第 {t.questionLabels.join("、")} 题。</p><p>教学检查：学生能否独立识别适用条件并解释关键步骤？也可能受综合题难度或前置运算影响，先用一道短题区分。</p><Button variant="secondary" onClick={() => setEditing({ id: uid(), topic: t.name, questionIds: t.questionIds, studentIds: t.students.filter((s: any) => s.complete && s.rate < 100).map((s: any) => s.studentId), action: "回看典型步骤，再用同目标短题检查", date: new Date().toLocaleDateString("en-CA"), task: "", criterion: "独立完成并说明关键理由", outcomes: [] })}>安排本题组辅导</Button></article>)}
    </section>
    <section className="panel"><h2>临时辅导名单</h2><p>分组仅使用教师明确选择的问题标签；仅有文字备注或没有错因标签的失分，归入“需补充诊断”。教师可增减名单，同一学生可出现在不同目标组。</p>
      {view?.groups?.map((g: any, i: number) => <details key={i}><summary>{g.topic} · {g.cause} · {g.members.length} 人</summary><div className="toolbar">{g.members.map((m: any) => <Button key={m.studentId} variant="ghost" onClick={() => onGrade(m.questionIds[0], m.studentId)}>{exam.students.find(s => s.id === m.studentId)?.name} · 查看依据</Button>)}</div><Button variant="secondary" onClick={() => setEditing({ id: uid(), topic: g.topic, questionIds: g.questionIds, studentIds: g.members.map((m: any) => m.studentId), action: g.cause === "需补充诊断" ? "先观察一道短题的解题过程，再确定错因" : `围绕${g.cause}进行讲解与独立练习`, date: new Date().toLocaleDateString("en-CA"), task: "", criterion: "独立完成并说明关键理由", outcomes: [] })}>选用此组并调整</Button></details>)}
    </section>
    <section className="panel"><h2>学生 × 知识点</h2><p>只统计完整完成同一题组的学生；“—”表示题组成绩不完整，不表示零分。</p><div className="table-wrap"><table><thead><tr><th>学生</th>{exam.analysis.topics.map(t => <th key={t.name}>{t.name}</th>)}</tr></thead><tbody>{exam.students.map(s => <tr key={s.id}><th>{s.name}</th>{exam.analysis.topics.map(t => <td key={t.name}><button className="text-link" onClick={() => onGrade(t.questionIds[0], s.id)}>{t.students.find(x => x.studentId === s.id)?.rate == null ? "—" : pct(t.students.find(x => x.studentId === s.id)?.rate)}</button></td>)}</tr>)}</tbody></table></div></section>
    <section className="panel"><h2>已安排的辅导与复测</h2><p>达标按教师设定标准记录。“有提示才完成”不会算作独立达标；短期复测结果不能证明长期掌握或教学因果效果。</p>{!view?.interventions?.length && <p>从上面的讲评事项或辅导名单开始，安排第一次检查。</p>}{view?.interventions?.map((v: any) => <article className="finding" key={v.id}><h3>{v.topic} <Badge>{v.date}</Badge></h3><p>{v.action}</p><p>任务：{v.task || "待补充复测题目或来源"}；标准：{v.criterion}</p><p>{Object.entries(outcomeNames).map(([key, name]) => `${name} ${v.studentIds.filter((sid: string) => (v.outcomes.find((o: any) => o.studentId === sid)?.status || "pending") === key).length} 人`).join(" · ")}</p><Button variant="secondary" onClick={() => setEditing(v)}>调整名单 / 录入复测</Button></article>)}</section>
    {editing && <InterventionEditor key={editing.id} exam={exam} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
  </>;
}

function InterventionEditor({ exam, initial, onClose, onSaved }: { exam: Exam; initial: any; onClose: () => void; onSaved: () => void }) {
  const [v, setV, status, clear] = useDraft<any>(`intervention-${exam.id}-${exam.teaching?.some(x => x.id === initial.id) ? initial.id : "new"}`, initial);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  function field(key: string, value: any) { setV((old: any) => ({ ...old, [key]: value })); }
  async function save() { setBusy(true); try { await api(`/exams/${exam.id}/teaching`, { revision: exam.revision, intervention: v }, "PUT"); await clear(); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Modal title="辅导与复测安排" wide onClose={onClose}><p role="status">{status}</p>
    <div className="form-grid"><Field label="教学目标"><input value={v.topic} onChange={e => field("topic", e.target.value)} /></Field><Field label="辅导日期"><input type="date" value={v.date} onChange={e => field("date", e.target.value)} /></Field></div>
    <Field label="课堂或辅导行动"><textarea value={v.action} onChange={e => field("action", e.target.value)} /></Field>
    <Field label="复测题目、任务或校内材料出处"><textarea value={v.task} onChange={e => field("task", e.target.value)} placeholder="例如：校本练习第12页第3题，独立说明条件后求解；需与本次目标相符。" /></Field>
    <Field label="达标标准"><textarea value={v.criterion} onChange={e => field("criterion", e.target.value)} /></Field>
    <details><summary>调整参加学生（{v.studentIds.length} 人）</summary>{exam.students.map(s => <label className="check-label" key={s.id}><input type="checkbox" checked={v.studentIds.includes(s.id)} onChange={e => setV((old: any) => ({ ...old, studentIds: e.target.checked ? [...old.studentIds, s.id] : old.studentIds.filter((id: string) => id !== s.id), outcomes: old.outcomes.filter((o: any) => o.studentId !== s.id) }))} />{s.name} · {s.number}</label>)}</details>
    <div className="table-wrap"><table><thead><tr><th>学生</th><th>复测结果</th><th>可选备注</th></tr></thead><tbody>{exam.students.filter(s => v.studentIds.includes(s.id)).map(s => {
      const o = v.outcomes.find((o: any) => o.studentId === s.id) || { studentId: s.id, status: "pending", note: "" };
      const edit = (key: string, value: string) => field("outcomes", [...v.outcomes.filter((x: any) => x.studentId !== s.id), { ...o, [key]: value }]);
      return <tr key={s.id}><th>{s.name}</th><td><select aria-label={`${s.name}复测结果`} value={o.status} onChange={e => edit("status", e.target.value)}>{Object.entries(outcomeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></td><td><input aria-label={`${s.name}复测备注`} value={o.note} onChange={e => edit("note", e.target.value)} /></td></tr>;
    })}</tbody></table></div>
    <ErrorBox error={error} /><div className="modal-actions"><Button variant="secondary" onClick={onClose}>稍后继续</Button><Button busy={busy} onClick={save}>保存辅导与复测</Button></div>
  </Modal>;
}

export function StructureTool({ exam, onChanged }: { exam: Exam; onChanged: () => void }) {
  const [open, setOpen] = useState(false), [error, setError] = useState(""), [preview, setPreview] = useState<any>(null);
  const [operation, setOperation] = useState("merge"), [ids, setIds] = useState<string[]>([]), [label, setLabel] = useState("合并题"), [parts, setParts] = useState("(1)=5\n(2)=5");
  const [busy, setBusy] = useState(false), [audit, setAudit] = useState<any[]>([]);
  const input = { operation, questionIds: ids, label, ...(operation === "split" ? { children: parts.split("\n").filter(Boolean).map(line => { const [label, max] = line.split("="); return { label, max: Number(max) }; }) } : {}) };
  return <><Button variant="secondary" onClick={() => { setOpen(true); void api<any[]>(`/exams/${exam.id}/audit`).then(setAudit); }}>调整计分结构 / 恢复</Button>{open && <Modal title="调整计分结构" wide onClose={() => setOpen(false)}><Notice>改题号、知识点或满分优先用原题编辑，保留原成绩。合并、拆分或取消计分使用此处预览。原始记录保留在历史中；调整后若尚无其他修改，可立即撤销。</Notice><Field label="操作"><select value={operation} onChange={e => { setOperation(e.target.value); setPreview(null); }}><option value="merge">合并独立计分题</option><option value="split">拆分一道题</option><option value="remove">取消题目计分（改变总分）</option></select></Field><Field label="选择题目"><select multiple value={ids} onChange={e => { setIds(Array.from(e.target.selectedOptions, o => o.value)); setPreview(null); }}>{exam.questions.filter(q => q.type !== "group" && !q.parentId).map(q => <option value={q.id} key={q.id}>第 {q.label} 题 · {q.max ?? "待核对"} 分</option>)}</select></Field>{operation === "merge" && <Field label="合并后题号"><input value={label} onChange={e => { setLabel(e.target.value); setPreview(null); }} /></Field>}{operation === "split" && <Field label="每行填写：小问题号=满分"><textarea value={parts} onChange={e => { setParts(e.target.value); setPreview(null); }} /></Field>}<Button variant="secondary" busy={busy} onClick={async () => { setBusy(true); try { setPreview(await api(`/exams/${exam.id}/structure/preview`, input)); setError(""); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>预览班级影响</Button>{preview && <Notice><p>{preview.message}</p><p>涉及 {preview.impactedCells} 条成绩；完整答卷 {preview.before.complete} → {preview.after.complete}；满分 {preview.before.max ?? "待核对"} → {preview.after.max ?? "待核对"}。</p><Button busy={busy} onClick={async () => { setBusy(true); try { await api(`/exams/${exam.id}/structure/apply`, { input, revision: preview.revision, token: preview.token }); setOpen(false); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>确认按此预览调整</Button></Notice>}<details><summary>结构调整历史</summary>{audit.filter(a => a.action === "调整计分结构").map(a => <p key={a.id}>{a.createdAt} <Button variant="ghost" onClick={async () => { try { await api(`/exams/${exam.id}/structure/undo`, { auditId: a.id }); setOpen(false); onChanged(); } catch (e) { setError((e as Error).message); } }}>撤销这次调整</Button></p>)}</details><ErrorBox error={error} /></Modal>}</>;
}

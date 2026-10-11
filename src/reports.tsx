import { EvidenceOverview } from './assessment';
import { useEffect, useState } from "react";
import {
  Users,
  ChartNoAxesCombined,
  Target,
  ClipboardCheck,
  FileText,
  Sparkles,
  Download,
  Save,
  ArrowUpRight,
  BookOpen,
  Search,
} from "lucide-react";
import { api, fmt, pct, keyOf, dateTime, leafQuestions, download } from "./api";
import {
  Button,
  Metric,
  SectionTitle,
  RateBar,
  Distribution,
  Notice,
  Badge,
  Empty,
  Field,
  Modal,
  ErrorBox,
} from "./components";
import { AITasks } from "./workflows";
import { useDraft } from "./drafts";
import type { Exam, Report, QuestionStat } from "./types";

type Props = {
  exam: Exam;
  onChanged: () => void;
  notify: (s: string) => void;
  onGrade: (q?: string, s?: string) => void;
};
export function AnalyticsPage({
  exam,
  onChanged,
  notify,
  onGrade,
  personal = false,
}: Props & { personal?: boolean }) {
  const [studentId, setStudentId] = useState(exam.students[0]?.id || ""),
    [focus, setFocus] = useState<QuestionStat | null>(null),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tick, setTick] = useState(0),
    [plan, setPlan] = useState(exam.plan || "");
  const a = exam.analysis,
    student = a.students.find((s) => s.id === studentId),
    scope = personal ? studentId : null;
  async function create(ai = false, force = false) {
    setBusy(true);
    setError("");
    try {
      if (ai) {
        const result = await api(`/exams/${exam.id}/tasks`, {
          kind: "report",
          payload: { studentId: scope, force },
        });
        setTick((x) => x + 1);
        notify(
          result.cached
            ? "使用本次数据已有的解读任务，可在归档中查看"
            : "解读任务已创建，完成后保存在报告归档",
        );
      } else {
        setReport(await api(`/exams/${exam.id}/reports`, { studentId: scope }));
        notify("已保存本次成绩版本的报告");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const ordered = [...a.questions].sort(
    (x, y) => (x.rate ?? 101) - (y.rate ?? 101),
  );
  return (
    <>
      <EvidenceOverview exam={exam} studentId={personal ? studentId : undefined}/>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {personal ? "第四步 · 查看这位学生的表现" : "第四步 · 查看全班表现"}
          </span>
          <h1>{personal ? "个人学情" : "班级学情"}</h1>
          <p>
            {personal
              ? "从本次题目表现出发，找到下一步复习的切入点。"
              : "让逐题得分转化为有依据的讲评与教学安排。"}
          </p>
        </div>
        <div className="toolbar">
          <Button
            variant="secondary"
            disabled={!a.confirmedCells}
            busy={busy}
            onClick={() => create()}
          >
            <FileText size={16} />
            保存基础报告
          </Button>
          <Button
            disabled={!a.confirmedCells}
            busy={busy}
            onClick={() => create(true)}
          >
            <Sparkles size={16} />
            生成 AI 解读
          </Button>
          <Button variant="ghost" disabled={!a.confirmedCells} busy={busy} onClick={() => create(true, true)}>重新生成建议（再次调用服务）</Button>
        </div>
      </div>
      <ErrorBox error={error} />
      {personal && (
        <div className="student-switch">
          <Field label="查看学生">
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
            >
              {exam.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} · {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Badge tone={student?.complete ? "teal" : "amber"}>
            {student?.absent
              ? "缺考"
              : student?.complete
                ? "成绩完整"
                : "成绩待完成"}
          </Badge>
          <Button variant="ghost" onClick={() => onGrade(undefined, studentId)}>
            查看原卷与录分
            <ArrowUpRight size={15} />
          </Button>
        </div>
      )}
      <div className="metric-grid">
        {personal ? (
          <>
            <Metric
              title="本次总分"
              value={fmt(student?.total)}
              unit={`/ ${a.max}`}
              detail={
                student?.complete
                  ? "全部题目已确认"
                  : `已确认部分小计 ${fmt(student?.partial)} 分，不计为总分`
              }
              icon={<Target size={18} />}
            />
            <Metric
              title="已确认题目"
              value={String(student?.confirmed || 0)}
              unit={`/ ${a.questions.length}`}
              detail="未录入、草稿与不适用不计入"
              icon={<ClipboardCheck size={18} />}
            />
            <Metric
              title="班级参考均分"
              value={fmt(a.average)}
              unit="分"
              detail={`仅 ${a.complete} 份完整有效答卷`}
              icon={<Users size={18} />}
            />
            <Metric
              title="有备注的题目"
              value={String(student?.noteCount || 0)}
              unit="题"
              detail="备注缺失不表示没有问题"
              icon={<FileText size={18} />}
            />
          </>
        ) : (
          <>
            <Metric
              title="完整有效答卷"
              value={String(a.complete)}
              unit={`/ ${a.expected}`}
              detail={`${a.pending} 人待完成 · ${a.absent} 人缺考`}
              icon={<Users size={18} />}
            />
            <Metric
              title="班级平均分"
              value={fmt(a.average)}
              unit={`/ ${a.max}`}
              detail="仅使用完整有效答卷"
              icon={<ChartNoAxesCombined size={18} />}
            />
            <Metric
              title="中位数"
              value={fmt(a.median)}
              unit="分"
              detail={`最高 ${fmt(a.highest)} · 最低 ${fmt(a.lowest)}`}
              icon={<Target size={18} />}
            />
            <Metric
              title="成绩标准差"
              value={fmt(a.std)}
              unit="分"
              detail="描述本次完整答卷分数的离散程度"
              icon={<ClipboardCheck size={18} />}
            />
          </>
        )}
      </div>
      {a.pending > 0 && (
        <Notice tone="warn">
          还有 {a.pending}{" "}
          名学生的成绩待完成或含不适用项。逐题统计使用该题已确认成绩；总分统计只使用完整答卷。
        </Notice>
      )}
      <div className="analytics-grid">
        <section className="panel">
          <SectionTitle
            title="主要考查知识表现"
            subtitle="按题目满分加权；每个知识题组只纳入该题组成绩完整的学生。"
          />
          {a.topics.length ? (
            a.topics.map((t) => (
              <RateBar
                key={t.name}
                label={t.name}
                value={
                  personal
                    ? (t.students.find((s) => s.studentId === studentId)
                        ?.rate ?? null)
                    : t.rate
                }
                detail={`第 ${t.questionLabels.join("、")} 题 · ${t.count} 个评分单位 · ${personal ? `${t.students.find((s) => s.studentId === studentId)?.n || 0}/${t.count} 项已确认` : `${t.n} 人有效`}${t.count === 1 ? " · 单题证据有限" : ""}`}
                onClick={() =>
                  setFocus(a.questions.find((q) => q.id === t.questionIds[0])!)
                }
              />
            ))
          ) : (
            <Empty
              title="知识点尚未确认"
              detail="在试卷准备中核对主要考查知识点后显示。"
            />
          )}
          <div className="panel-footnote">
            这是本次相关题组的得分表现，不等同于长期掌握水平。相关知识标签不参与分数拆分。
          </div>
        </section>
        <section className="panel">
          <SectionTitle
            title={personal ? "本次复习关注" : "成绩分布"}
            subtitle={
              personal
                ? "只筛选已确认且有失分的题目，具体错因以备注为依据。"
                : `${a.complete} 份完整答卷 · 按全卷得分率分组`
            }
          />
          {personal ? (
            <div className="focus-list">
              {a.questions
                .filter((q) => {
                  const g = exam.grades[keyOf(studentId, q.id)];
                  return g?.status === "final" && q.max != null && g.score! < q.max;
                })
                .slice(0, 5)
                .map((q) => {
                  const g = exam.grades[keyOf(studentId, q.id)];
                  return (
                    <button
                      key={q.id}
                      className="focus-item"
                      onClick={() => setFocus(q)}
                    >
                      <span className="question-index">{q.label}</span>
                      <span>
                        <strong>{q.primary || "对应题目"}</strong>
                        <small>
                          {g.note ||
                            g.tags.join("、") ||
                            "暂无错因备注，可回看原卷进一步确认"}
                        </small>
                      </span>
                      <Badge tone="amber">
                        {g.score}/{q.max}
                      </Badge>
                    </button>
                  );
                })}
              {!a.questions.some((q) => {
                const g = exam.grades[keyOf(studentId, q.id)];
                return g?.status === "final" && q.max != null && g.score! < q.max;
              }) && (
                <Empty
                  title="暂无已确认失分题"
                  detail="成绩未完整时，请先完成录分。"
                />
              )}
            </div>
          ) : (
            <>
              <Distribution data={a.histogram} />
              <div className="distribution-note">
                <span>分组端点左闭右开，最后一组含满分。</span>
                <strong>满分 {a.max}</strong>
              </div>
            </>
          )}
        </section>
      </div>
      <section className="panel">
        <SectionTitle
          title={personal ? "逐题成绩与备注" : "逐题表现"}
          subtitle="点击题号查看题干、样本分母、备注和具体学生。"
          action={
            !personal ? (
              <Button
                variant="ghost"
                onClick={() =>
                  download(
                    `/exams/${exam.id}/export?mode=long`,
                    `${exam.name}-成绩明细.xlsx`,
                  ).catch((e) => setError(e.message))
                }
              >
                <Download size={15} />
                导出明细
              </Button>
            ) : undefined
          }
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>题号</th>
                <th>主要考查</th>
                <th>{personal ? "个人得分" : "平均得分"}</th>
                <th>得分率</th>
                <th>{personal ? "状态" : "有效样本"}</th>
                <th>{personal ? "备注 / 标签" : "失分备注覆盖"}</th>
              </tr>
            </thead>
            <tbody>
              {(personal ? a.questions : ordered).map((q) => {
                const g = exam.grades[keyOf(studentId, q.id)];
                return (
                  <tr key={q.id}>
                    <td>
                      <button className="text-link" onClick={() => setFocus(q)}>
                        第 {q.label} 题
                      </button>
                    </td>
                    <td>
                      {q.primary || "未标注"}
                      {!q.confirmedTopic && <Badge tone="amber">待确认</Badge>}
                    </td>
                    <td className="tabular">
                      {personal
                        ? g?.status === "final"
                          ? fmt(g.score)
                          : "—"
                        : fmt(q.average)}{" "}
                      / {q.max}
                    </td>
                    <td className="tabular">
                      {pct(
                        personal
                          ? g?.status === "final"
                            ? q.max == null ? null : (g.score! / q.max) * 100
                            : null
                          : q.rate,
                      )}
                    </td>
                    <td>
                      {personal
                        ? {
                            final: "已确认",
                            draft: "草稿",
                            absent: "缺考",
                            na: "不适用",
                            ungraded: "未录入",
                          }[g?.status || "ungraded"]
                        : `${q.n} 人`}
                    </td>
                    <td className="remark-cell">
                      {personal
                        ? g?.status === "final"
                          ? [g.note, ...g.tags].filter(Boolean).join(" · ") ||
                            "暂无备注"
                          : "—"
                        : `${q.annotatedLost} / ${q.lost} 名失分学生`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {!personal && (
        <div className="analytics-grid">
          <section className="panel">
            <SectionTitle
              title="已记录的问题标签"
              subtitle="人数跨题去重，次数按题累计；有备注样本不能代表全班。"
              action={
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await api(`/exams/${exam.id}/tasks`, {
                        kind: "classify",
                      });
                      setTick((x) => x + 1);
                      notify("备注归类任务已创建，结果需核对采纳");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <Sparkles size={15} />
                  整理文字备注
                </Button>
              }
            />
            {a.remarks.length ? (
              <div className="remark-list">
                {a.remarks.map((r) => (
                  <div key={`${r.source || "teacher"}-${r.tag}`}>
                    <span className="remark-dot" />
                    <strong>
                      {r.tag}
                      {r.source === "ai" && (
                        <Badge tone="blue">已采用 AI 归类</Badge>
                      )}
                    </strong>
                    <span>{r.students.length} 人</span>
                    <small>
                      {r.occurrences} 次 · {r.questionIds.length} 题
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="还没有问题标签"
                detail="教师录入或采纳的标签会汇总在这里。"
              />
            )}
          </section>
          <section className="panel plan-panel">
            <SectionTitle
              title="下一轮教学安排"
              subtitle="结合题目表现，记下讲评重点与复测方式。"
            />
            <textarea
              aria-label="下一轮教学安排"
              rows={6}
              placeholder="例如：下节课先回顾导数符号与单调区间；用两道短题检查是否仍遗漏参数讨论。"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            />
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await api(`/exams/${exam.id}`, { plan }, "PATCH");
                  onChanged();
                  notify("教学安排已保存");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Save size={15} />
              保存安排
            </Button>
          </section>
        </div>
      )}
      <AITasks
        exam={exam}
        filter={["report", "classify"]}
        tick={tick}
        onChanged={onChanged}
      />
      {focus && (
        <QuestionEvidence
          exam={exam}
          question={focus}
          studentId={scope}
          onClose={() => setFocus(null)}
          onGrade={onGrade}
        />
      )}
      {report && (
        <ReportViewer
          key={report.id}
          report={report}
          currentRevision={exam.revision}
          onClose={() => setReport(null)}
          onSaved={setReport}
          notify={notify}
        />
      )}
    </>
  );
}
function QuestionEvidence({
  exam,
  question: q,
  studentId,
  onClose,
  onGrade,
}: {
  exam: Exam;
  question: QuestionStat;
  studentId: string | null;
  onClose: () => void;
  onGrade: (q?: string, s?: string) => void;
}) {
  const detail = exam.questions.find((x) => x.id === q.id)!;
  return (
    <Modal title={`第 ${q.label} 题 · 数据依据`} wide onClose={onClose}>
      <div className="evidence-stem">
        <Badge>{q.primary || "未标注主要知识点"}</Badge>
        <p className="pre-wrap">{detail.stem || "暂无题干"}</p>
        {detail.related.length > 0 && (
          <small>相关知识：{detail.related.join("、")}（只显示覆盖）</small>
        )}
      </div>
      <Notice>
        {q.n} 名学生有已确认成绩，其中 {q.lost} 人失分，{q.annotatedLost}{" "}
        名失分学生有备注或标签。空白备注不能用于推断具体错因。
      </Notice>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>学生</th>
              <th>得分 / 满分</th>
              <th>备注与标签</th>
              <th>原卷</th>
            </tr>
          </thead>
          <tbody>
            {exam.students
              .filter((s) => !studentId || s.id === studentId)
              .map((s) => {
                const g = exam.grades[keyOf(s.id, q.id)];
                return (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>
                      {g?.status === "final"
                        ? `${g.score} / ${q.max}`
                        : "暂无最终得分"}
                    </td>
                    <td className="pre-wrap">
                      {g?.status === "final"
                        ? [g.note, ...g.tags].filter(Boolean).join("；") ||
                          "暂无备注"
                        : "—"}
                    </td>
                    <td>
                      <button
                        className="text-link"
                        onClick={() => {
                          onClose();
                          onGrade(q.id, s.id);
                        }}
                      >
                        进入阅卷
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function ReportsPage({
  exam,
  notify,
}: {
  exam: Exam;
  notify: (s: string) => void;
}) {
  const [reports, setReports] = useState<Report[]>([]),
    [selected, setSelected] = useState<Report | null>(null),
    [error, setError] = useState("");
  async function refresh() {
    try {
      setReports(await api(`/exams/${exam.id}/reports`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, [exam.id, exam.revision]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">已保存的报告 · 随时查看</span>
          <h1>报告归档</h1>
          <p>每一份报告绑定生成时的成绩与题目版本，后续改分不会改写旧报告。</p>
        </div>
        <Badge>{reports.length} 份报告</Badge>
      </div>
      <ErrorBox error={error} />
      <section className="panel">
        {reports.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>报告对象</th>
                  <th>来源</th>
                  <th>生成时间</th>
                  <th>数据版本</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="report-name">
                        <FileText size={19} />
                        <strong>
                          {r.studentId
                            ? r.display.analysis.students.find(
                                (s) => s.id === r.studentId,
                              )?.name
                            : "全班"}{" "}
                          · 学情报告
                        </strong>
                      </div>
                      {r.teacherText !== null && (
                        <small className="muted">含教师补充</small>
                      )}
                    </td>
                    <td>
                      <Badge tone={r.kind === "ai" ? "blue" : "neutral"}>
                        {r.kind === "ai" ? "AI 解读" : "基础报告"}
                      </Badge>
                    </td>
                    <td>{dateTime(r.createdAt)}</td>
                    <td>
                      <Badge
                        tone={!r.stale ? "teal" : "amber"}
                      >
                        V{r.revision} ·{" "}
                        {!r.stale ? "内容仍适用" : "数据已变，需更新"}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="text-link"
                        onClick={async () => {
                          try {
                            setSelected(await api(`/reports/${r.id}`));
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        查看 / 导出
                      </button>
                      {r.stale && <Button variant="ghost" onClick={async () => {
                        try {
                          if (r.kind === "ai") { await api(`/exams/${exam.id}/tasks`, { kind: "report", payload: { studentId: r.studentId } }); notify("已开始更新此对象报告，将调用智能服务；原报告和教师修改保留。"); }
                          else { await api(`/exams/${exam.id}/reports`, { studentId: r.studentId }); notify("已按当前成绩保存新的基础报告。"); }
                          await refresh();
                        } catch (e) { setError((e as Error).message); }
                      }}>更新此对象报告{r.kind === "ai" ? "（可能收费）" : ""}</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="把一次分析保存下来"
            detail="在班级或个人学情页面保存基础报告，或生成 AI 解读。"
          />
        )}
      </section>
      {selected && (
        <ReportViewer
          key={selected.id}
          report={selected}
          currentRevision={exam.revision}
          notify={notify}
          onClose={() => setSelected(null)}
          onSaved={(r) => {
            setSelected(r);
            void refresh();
          }}
        />
      )}
    </>
  );
}

export function ReportViewer({
  report: r,
  currentRevision,
  onClose,
  onSaved,
  notify,
}: {
  report: Report;
  currentRevision: number;
  onClose: () => void;
  onSaved: (r: Report) => void;
  notify: (s: string) => void;
}) {
  const [draftContent, setDraftContent, contentStatus, clearContent] = useDraft(`report-content-${r.id}`, r.content);
  const [text, setText, , clearText] = useDraft(`report-text-${r.id}`, r.teacherText || "");
  const [evidenceId, setEvidenceId] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const unsaved = text !== (r.teacherText || "") || JSON.stringify(draftContent) !== JSON.stringify(r.content);
  const a = r.display.analysis,
    s = r.studentId ? a.students.find((s) => s.id === r.studentId) : null;
  async function save() {
    setBusy(true);
    try {
      const next = await api<Report>(
          `/reports/${r.id}`,
          { teacherText: text, content: draftContent },
          "PATCH",
        );
      await Promise.all([clearContent(), clearText()]);
      onSaved(next);
      notify("教师补充已保存为新报告版本");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportPdf(compact = false) {
    setError("");
    try {
      if (unsaved) throw Error("请先点击“保存为新版本”，再导出包含本次修改的 PDF。");
      const current = await api<Report>(`/reports/${r.id}`);
      const html = compact ? actionCardHtml(current) : reportHtml(current);
      if (window.desktop) {
        const path = await window.desktop.exportPdf(html);
        if (path) notify("PDF 报告已导出");
      } else {
        const w = window.open("", "_blank");
        if (!w) throw Error("请允许弹出打印窗口。");
        w.document.write(
          html.replace(
            "<body>",
            '<body><button class="print-button" onclick="window.print()">打印或另存为 PDF</button>',
          ),
        );
        w.document.close();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title={`${s?.name || "班级"} · 学情报告`} wide onClose={onClose}>
      <div className="report-toolbar">
        <Badge tone="blue">{r.kind === "ai" ? "AI 解读" : "规则统计"}</Badge>
        {r.editedByTeacher && <Badge tone="teal">教师修订版</Badge>}
        <span>
          V{r.revision} · {dateTime(r.createdAt)}
        </span>
        <Button variant="secondary" onClick={() => exportPdf()}>
          <Download size={15} />
          导出 PDF
        </Button>
        {s && <Button variant="secondary" onClick={() => exportPdf(true)}>导出个人行动卡</Button>}
      </div>
      {(r.stale ?? r.revision !== currentRevision) && (
        <Notice tone="warn">
          这是历史报告。当前考试为 V{currentRevision}，下列统计保留生成时的 V
          {r.revision} 数据。
        </Notice>
      )}
      <p role="status">{contentStatus}{unsaved ? "；尚未保存为正式报告版本" : ""}</p>
      {r.display.demo && <Notice>示例数据，仅用于体验功能。</Notice>}
      <div className="report-sheet">
        <span className="eyebrow">知衡 · 教学反馈</span>
        <h2>{r.display.name}</h2>
        <p className="muted">
          {r.display.className} · {r.display.date} · {s?.name || "全班"}
        </p>
        <div className="report-numbers">
          <div>
            <small>{s ? "个人总分" : "班级均分"}</small>
            <strong>
              {fmt(s ? s.total : a.average)}
              <em> / {a.max}</em>
            </strong>
          </div>
          <div>
            <small>{s ? "已确认题目" : "完整答卷"}</small>
            <strong>
              {s ? s.confirmed : a.complete}
              <em> / {s ? a.questions.length : a.expected}</em>
            </strong>
          </div>
        </div>
        <p className="report-summary pre-wrap">{r.content.summary}</p>
        {r.content.findings.map((f, i) => (
          <article className="finding" key={i}>
            <div className="finding-title">
              <span>{String(i + 1).padStart(2, "0")}</span>
              <h3>{f.title}</h3>
              {f.certainty && (
                <Badge tone={f.certainty === "recorded" ? "teal" : "amber"}>
                  {f.certainty === "recorded" ? "已有核对记录支持" : "待进一步核实"}
                </Badge>
              )}
            </div>
            <p>{f.observation}</p>
            <div className="finding-evidence">
              依据：
              {f.evidence.map((id) => (
                <button
                  className="text-link"
                  key={id}
                  onClick={() => setEvidenceId(id)}
                >
                  第 {a.questions.find((q) => q.id === id)?.label || "?"} 题
                </button>
              ))}
            </div>
            {f.remarkRefs?.length ? (
              <details>
                <summary>查看所引用的原始备注</summary>
                {f.remarkRefs.map((ref) => {
                  const [alias, qid] = ref.split(":");
                  const record = r.snapshot?.finalResults
                    ?.find((x: any) => x.student === alias)
                    ?.grades.find((g: any) => g.questionId === qid);
                  return (
                    <p key={ref}>
                      {alias} · 第{" "}
                      {a.questions.find((q) => q.id === qid)?.label} 题：
                      {record
                        ? [record.note, ...record.tags]
                            .filter(Boolean)
                            .join("；")
                        : "请重新从归档打开以加载原始备注。"}
                    </p>
                  );
                })}
              </details>
            ) : null}
            {!!f.recordedNotes?.length&&<details><summary>教师已核对的证据</summary>{f.recordedNotes.map((x,i)=><p key={i}>{x.note}</p>)}</details>}
            <div className="finding-action">
              <strong>教学 / 复习行动</strong>
              <p>{f.action}</p>
              <strong>后续检查</strong>
              <p>{f.check}</p>
            </div>
          </article>
        ))}
        {!!r.snapshot?.assessment?.skills?.length&&<><h3>逐点表现依据</h3><p>仅统计教师已核对的表现；各状态人数可能交叉，不作为长期掌握率。</p><table><thead><tr><th>技能</th><th>已核对</th><th>已表现</th><th>明确错误</th><th>未能判断</th><th>前错影响</th></tr></thead><tbody>{r.snapshot.assessment.skills.map((x:any)=><tr key={x.name}><th>{x.name}</th><td>{x.reviewedStudents}</td><td>{x.demonstratedStudents}</td><td>{x.errorStudents}</td><td>{x.unknownStudents}</td><td>{x.blockedStudents}</td></tr>)}</tbody></table></>}
        <h3>逐题数据依据</h3>
        <table>
          <thead>
            <tr>
              <th>题目</th>
              <th>主要考查</th>
              <th>{s ? "个人最终得分" : "均分 / 满分"}</th>
              <th>{s ? "个人得分率" : "有效人数"}</th>
            </tr>
          </thead>
          <tbody>
            {a.questions.map((q) => {
              const g = s
                ? r.snapshot?.finalResults?.[0]?.grades.find(
                    (x: any) => x.questionId === q.id,
                  )
                : null;
              return (
                <tr key={q.id}>
                  <td>{q.label}</td>
                  <td>
                    {q.primary || "未标注"}
                    {!q.confirmedTopic ? "（待确认）" : ""}
                  </td>
                  <td>
                    {s
                      ? g
                        ? `${g.score} / ${q.max}`
                        : "—"
                      : `${fmt(q.average)} / ${q.max}`}
                  </td>
                  <td>{s ? pct(g && q.max != null ? (g.score / q.max) * 100 : null) : q.n}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {r.teacherText !== null && (
          <div className="teacher-note">
            <h3>教师补充</h3>
            <p className="pre-wrap">{r.teacherText || "（无）"}</p>
          </div>
        )}
        <p className="report-disclaimer">
          统计由程序计算。解读来自最终成绩、已有备注和已核对作答证据；单次题组表现不代表长期能力。没有备注或已核对的作答证据时不能确认具体错因。
          {r.content.note}
        </p>
      </div>
      <details className="advanced report-edit">
        <summary>修订报告措辞（保存为新版本）</summary>
        <Field label="报告总结">
          <textarea
            rows={3}
            value={draftContent.summary}
            onChange={(e) =>
              setDraftContent((c) => ({ ...c, summary: e.target.value }))
            }
          />
        </Field>
        {draftContent.findings.map((f, i) => (
          <div className="finding" key={i}>
            <strong>建议 {i + 1}</strong>
            {(
              [
                ["title", "标题"],
                ["observation", "观察与解释"],
                ["action", "教学或复习行动"],
                ["check", "后续检查"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={`建议 ${i + 1} ${label}`}>
                <textarea
                  rows={k === "title" ? 1 : 2}
                  value={f[k]}
                  onChange={(e) =>
                    setDraftContent((c) => ({
                      ...c,
                      findings: c.findings.map((x, j) =>
                        j === i ? { ...x, [k]: e.target.value } : x,
                      ),
                    }))
                  }
                />
              </Field>
            ))}
            <Button
              variant="ghost"
              onClick={() =>
                setDraftContent((c) => ({
                  ...c,
                  findings: c.findings.filter((_, j) => j !== i),
                }))
              }
            >
              移除此项建议
            </Button>
            <Field label={`建议 ${i + 1} 引用题目`}><select multiple aria-label={`建议 ${i + 1} 引用题目`} value={f.evidence} onChange={e => {
              const evidence = Array.from(e.target.selectedOptions, x => x.value);
              setDraftContent(c => ({ ...c, findings: c.findings.map((x, j) => j === i ? { ...x, evidence, remarkRefs: [], assessmentRefs: [], skillName: "", certainty: "hypothesis" } : x) }));
            }}>{a.questions.map(q => <option key={q.id} value={q.id}>第 {q.label} 题 · {q.primary || "待核对"}</option>)}</select></Field>
            <Field label={`建议 ${i + 1} 依据类型`}><select value={f.certainty || "hypothesis"} onChange={e => setDraftContent(c => ({ ...c, findings: c.findings.map((x, j) => j === i ? { ...x, certainty: e.target.value } : x) }))}><option value="hypothesis">需要进一步验证</option><option value="recorded">教师已有记录（需选择备注）</option></select></Field>
            <Field label={`建议 ${i + 1} 引用备注`}><select multiple value={f.remarkRefs || []} onChange={e => {
              const refs = Array.from(e.target.selectedOptions, x => x.value);
              setDraftContent(c => ({ ...c, findings: c.findings.map((x, j) => j === i ? { ...x, remarkRefs: refs } : x) }));
            }}>{(r.snapshot?.finalResults || []).flatMap((s: any) => s.grades.filter((g: any) => f.evidence.includes(g.questionId) && (g.note || g.tags?.length)).map((g: any) => <option key={`${s.student}:${g.questionId}`} value={`${s.student}:${g.questionId}`}>{s.student} · {g.note || g.tags.join("、")}</option>))}</select></Field>
          </div>
        ))}
        <Button variant="secondary" disabled={draftContent.findings.length >= 8 || !a.questions.length} onClick={() => setDraftContent(c => ({ ...c, findings: [...c.findings, { title: "教师补充", observation: "", evidence: [a.questions[0].id], remarkRefs: [], certainty: "hypothesis", action: "", check: "" }] }))}>新增教学建议</Button>
      </details>
      <Field label="教师补充或修订意见">
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="补充课堂观察，或注明需要修订的解释。原报告仍会保留。"
        />
      </Field>
      <ErrorBox error={error} />
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          关闭
        </Button>
        <Button
          busy={busy}
          disabled={
            text === (r.teacherText || "") &&
            JSON.stringify(draftContent) === JSON.stringify(r.content)
          }
          onClick={save}
        >
          <Save size={15} />
          保存为新版本
        </Button>
      </div>
      {evidenceId && (
        <SnapshotEvidence
          report={r}
          questionId={evidenceId}
          onClose={() => setEvidenceId(null)}
        />
      )}
    </Modal>
  );
}

function SnapshotEvidence({
  report: r,
  questionId,
  onClose,
}: {
  report: Report;
  questionId: string;
  onClose: () => void;
}) {
  const q = r.snapshot?.questions.find((q: any) => q.id === questionId),
    stat = r.display.analysis.questions.find((q) => q.id === questionId);
  return (
    <Modal
      title={`第 ${q?.label || stat?.label} 题 · 报告生成时的依据`}
      wide
      onClose={onClose}
    >
      <Badge>V{r.revision} 数据快照</Badge>
      <div className="evidence-stem">
        {q?.parentContext?.map((p: any) => (
          <p key={p.label} className="pre-wrap">
            第 {p.label} 题公共条件：{p.stem}
          </p>
        ))}
        <p className="pre-wrap">{q?.stem || "暂无题干"}</p>
      </div>
      <Notice>
        该题 {stat?.n} 名学生有最终成绩，{stat?.lost} 名学生失分，其中{" "}
        {stat?.annotatedLost} 名有已记录备注。下方显示本报告范围内的原始记录。
      </Notice>
      <div className="table-wrap compact">
        <table>
          <thead>
            <tr>
              <th>学生</th>
              <th>得分</th>
              <th>原始备注 / 标签</th>
            </tr>
          </thead>
          <tbody>
            {r.snapshot?.finalResults.map((x: any) => {
              const g = x.grades.find((g: any) => g.questionId === questionId);
              if (!g) return null;
              return (
                <tr key={x.student}>
                  <td>
                    {r.display.analysis.students[Number(x.student.slice(1)) - 1]
                      ?.name || x.student}
                  </td>
                  <td>
                    {g.score} / {q.max}
                  </td>
                  <td className="pre-wrap">
                    {[g.note, ...g.tags].filter(Boolean).join("；") ||
                      "暂无备注"}
                    {g.aiTags?.length > 0 && (
                      <small className="block muted">
                        已采用 AI 归类：{g.aiTags.join("、")}
                      </small>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function actionCardHtml(r: Report) {
  const a = r.display.analysis, s = a.students.find(s => s.id === r.studentId);
  const short = (v: string, n: number) => esc(v.length > n ? v.slice(0, n) + "…（详见完整报告）" : v);
  const strengths = a.topics.filter(t => t.students.some(x => x.studentId === r.studentId && x.rate === 100)).slice(0, 3).map(t => t.name);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>个人行动卡</title><style>@page{size:A4;margin:17mm}body{font:12px/1.7 'Microsoft YaHei',sans-serif;color:#173749}h1{font-size:23px}h2{font-size:16px}article{border-top:1px solid #cbdcdd;padding:8px 0;break-inside:avoid}p{white-space:pre-wrap}small{color:#54717a}.meta{background:#eef6f4;padding:12px}@media print{.print-button{display:none}}</style></head><body><h1>${esc(s?.name || "学生")} · 本次学习行动卡</h1><div class="meta">${esc(r.display.name)} · ${esc(r.display.date)} · V${r.revision}${r.stale ? " · 历史数据，成绩已变化" : ""}<br>最终总分 ${fmt(s?.total)}/${fmt(a.max)} · 已确认 ${s?.confirmed || 0}/${a.questions.length} 题</div><h2>保留优势</h2><p>${esc(strengths.length ? strengths.join("、") + "：本次对应题组取得满分，继续检查迁移运用。" : "结合已确认题目找出做对的关键步骤；证据不足时不判断长期掌握水平。")}</p><h2>下一步最多两个目标</h2>${r.content.findings.slice(0, 2).map(f => `<article><strong>${short(f.title, 80)}</strong><p>${short(f.observation, 190)}</p><p>行动：${short(f.action, 280)}</p><p>检查：${short(f.check, 170)}</p><small>依据：${esc(f.evidence.map(id => '第' + (a.questions.find(q => q.id === id)?.label || '?') + '题').join('、'))} · ${f.certainty === 'recorded' ? '结合教师记录' : '需要进一步验证'}</small></article>`).join("")}${!r.content.findings.length ? "<p>暂无需要支持的有效建议，可由老师补充下一步挑战。</p>" : ""}${r.teacherText ? `<p>教师补充：${short(r.teacherText, 160)}</p>` : ""}<small>本卡是完整报告的行动摘要。单次表现不等于长期能力；复测请区分独立完成和提示后完成。</small></body></html>`;
}
export function reportHtml(r: Report) {
  return reportDocument(r).replace("<body>", `<body>${r.stale ? '<p class="summary">历史报告：相关成绩、知识点或辅导记录已经变化。以下保留生成时的数据，请更新报告后用于当前教学。</p>' : ''}`);
}
function reportDocument(r: Report) {
  const a = r.display.analysis,
    s = r.studentId ? a.students.find((s) => s.id === r.studentId) : null;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(r.display.name)} 学情报告</title><style>@page{size:A4;margin:18mm}.print-button{padding:10px 20px;cursor:pointer;margin-bottom:20px}@media print{.print-button{display:none}}body{font:12px/1.65 "Microsoft YaHei",sans-serif;color:#203647}h1{font-size:24px;margin:8px 0}h2{font-size:17px;break-after:avoid}h3{font-size:14px}.brand{color:#147b75;letter-spacing:3px}.meta{color:#637887}.summary{background:#eef6f4;padding:14px;border-left:3px solid #15877f}article{break-inside:avoid;border-top:1px solid #dce5e8;padding:10px 0}p{white-space:pre-wrap}table{border-collapse:collapse;width:100%;font-size:11px;break-inside:avoid}thead{display:table-header-group}th,td{text-align:left;border-bottom:1px solid #dce5e8;padding:7px}th{background:#eef3f5}tr{break-inside:avoid}small{color:#637887}.table-note{break-after:avoid}footer{break-before:avoid;break-inside:avoid;margin-top:14px;border-top:1px solid #ccc;padding-top:8px;font-size:10px;color:#637887}</style></head><body><div class="brand">知衡 / 教学反馈${r.display.demo ? " · 示例数据" : ""}</div><h1>${esc(r.display.name)}</h1><div class="meta">${esc(r.display.className)} · ${esc(s?.name || "全班")} · ${esc(r.display.date)}${r.editedByTeacher ? " · 教师修订版" : ""} · 数据版本 V${r.revision} · ${esc(dateTime(r.createdAt))}</div><p>${s ? "个人总分" : "班级平均分"}：${fmt(s ? s.total : a.average)} / ${a.max}；${s ? `已确认 ${s.confirmed}/${a.questions.length} 题` : `完整答卷 ${a.complete}/${a.expected} 份，缺考 ${a.absent} 人，待完成 ${a.pending} 人`}。</p><p class="summary">${esc(r.content.summary)}</p>${r.content.findings
    .map(
      (f, i) =>
        `<article><h2>${i + 1}. ${esc(f.title)}</h2><p>${esc(f.observation)}</p><small>依据：${f.evidence.map((id) => `第 ${esc(a.questions.find((q) => q.id === id)?.label || "?")} 题`).join("、")} · ${f.certainty === "recorded" ? "已有核对记录支持" : "进一步核查建议"}</small>${(
          f.remarkRefs || []
        )
          .map((ref) => {
            const [alias, qid] = ref.split(":");
            const g = r.snapshot?.finalResults
              ?.find((x: any) => x.student === alias)
              ?.grades.find((x: any) => x.questionId === qid);
            return g
              ? `<p>原始备注 ${esc(alias)} / 第 ${esc(a.questions.find((q) => q.id === qid)?.label)} 题：${esc([g.note, ...g.tags].filter(Boolean).join("；"))}</p>`
              : "";
          })
          .join(
            "",
          )}${(f.recordedNotes||[]).map(x=>`<p>${esc(x.note)}</p>`).join('')}<p><b>行动：</b>${esc(f.action)}</p><p><b>后续检查：</b>${esc(f.check)}</p></article>`,
    )
    .join(
      "",
    )}${assessmentTableHtml(r)}<h2>逐题数据依据</h2><table><thead><tr><th>题号</th><th>主要考查</th><th>${s ? "个人得分" : "均分"} / 满分</th><th>${s ? "得分率" : "有效样本"}</th></tr></thead><tbody>${a.questions
    .map((q) => {
      const g = s
        ? r.snapshot?.finalResults?.[0]?.grades.find(
            (x: any) => x.questionId === q.id,
          )
        : null;
      return `<tr><td>${esc(q.label)}</td><td>${esc(q.primary || "未标注")}${q.confirmedTopic ? "" : "（待确认）"}</td><td>${fmt(s ? g?.score : q.average)} / ${q.max}</td><td>${s ? pct(g && q.max != null ? (g.score / q.max) * 100 : null) : q.n + " 人"}</td></tr>`;
    })
    .join(
      "",
    )}</tbody></table>${r.teacherText !== null ? `<h2>教师补充</h2><p>${esc(r.teacherText)}</p>` : ""}<footer>本报告保留生成时的数据，统计依据最终成绩及教师已核对的记录。${esc(r.content.note || "")}</footer></body></html>`;
}

function assessmentTableHtml(r:Report){const rows=r.snapshot?.assessment?.skills||[];if(!rows.length)return '';return '<h2>已核对的逐点表现</h2><p class="table-note">状态人数可能交叉，不能相加；未能判断不等于不会，不作为长期掌握率。</p><table><thead><tr><th>技能</th><th>已核对</th><th>已表现</th><th>明确错误</th><th>未能判断</th><th>前错影响</th></tr></thead><tbody>'+rows.map((s:any)=>'<tr><th>'+esc(s.name)+'</th>'+[s.reviewedStudents,s.demonstratedStudents,s.errorStudents,s.unknownStudents,s.blockedStudents].map(n=>'<td>'+esc(n)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}

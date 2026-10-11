import { useEffect, useRef, useState } from "react";
import { version } from "../package.json";
import {
  LayoutDashboard,
  Users,
  Files,
  PenLine,
  ChartNoAxesCombined,
  UserRound,
  FolderClosed,
  Settings,
  Plus,
  ChevronRight,
  CheckCircle2,
  ArrowUpRight,
  BookOpen,
  Sparkles,
  Target,
  ClipboardCheck,
  PanelLeftClose,
  GraduationCap,
  CircleHelp,
} from "lucide-react";
import { api, fmt, leafQuestions } from "./api";
import {
  Button,
  Metric,
  SectionTitle,
  StepCard,
  Completion,
  RateBar,
  ActionLink,
  Empty,
  Notice,
  Badge,
  ErrorBox,
  Distribution,
} from "./components";
import { ClassesPage, NewExam, PreparePage } from "./management";
import { GradePage } from "./grading";
import { AnalyticsPage, ReportsPage } from "./reports";
import { SettingsPage } from "./settings";
import { TeachingPage } from "./teaching";
import { AssessmentPage } from "./assessment";
import { ContextHelp, FirstSteps, HelpCenter, NextStep } from "./help";
import type { Boot, Exam, Page } from "./types";
const navs = [
  { page: "overview", name: "工作概览", icon: LayoutDashboard },
  { page: "classes", name: "班级与学生", icon: Users },
  { page: "prepare", name: "试卷准备", icon: Files },
  { page: "assessment", name: "AI 阅卷与复核", icon: ClipboardCheck },
  { page: "grade", name: "阅卷与录分", icon: PenLine },
  { page: "classReport", name: "班级学情", icon: ChartNoAxesCombined },
  { page: "student", name: "个人学情", icon: UserRound },
  { page: "teaching", name: "教学与复测", icon: ClipboardCheck },
  { page: "reports", name: "报告归档", icon: FolderClosed },
] as const;
export default function App() {
  const [boot, setBoot] = useState<Boot | null>(null),
    [examId, setExamId] = useState(localStorage.getItem("zh-exam") || ""),
    [exam, setExam] = useState<Exam | null>(null),
    [page, setPage] = useState<Page>("overview"),
    [error, setError] = useState(""),
    [newExam, setNewExam] = useState(false),
    [toast, setToast] = useState(""),
    [demoBusy, setDemoBusy] = useState(false),
    [target, setTarget] = useState<{ q?: string; s?: string }>({}),
    [gradeKey, setGradeKey] = useState(0);
  const [help, setHelp] = useState<string | null>(null);
  const [newExamClass, setNewExamClass] = useState<string>();
  const [setupAI, setSetupAI] = useState(false);
  const seq = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function notify(s: string) {
    setToast(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4500);
  }
  async function refresh() {
    const b = await api<Boot>("/bootstrap");
    setBoot(b);
    setExamId((prev) =>
      b.exams.some((e) => e.id === prev) ? prev : b.exams[0]?.id || "",
    );
  }
  async function refreshExam() {
    if (!examId) return;
    const n = ++seq.current;
    try {
      const e = await api<Exam>(`/exams/${examId}`);
      if (n === seq.current) setExam(e);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    localStorage.setItem("zh-exam", examId);
    setExam(null);
    setTarget({});
    void refreshExam();
  }, [examId]);
  function changed() {
    void refreshExam();
    void refresh().catch((e) => setError(e.message));
  }
  function go(p: Page) {
    if (p !== "settings") setSetupAI(false);
    setPage(p);
    window.scrollTo(0, 0);
  }
  function toGrade(q?: string, s?: string) {
    setTarget({ q, s });
    setGradeKey((k) => k + 1);
    go("grade");
  }
  async function demo() {
    setDemoBusy(true);
    setError("");
    try {
      const r = await api<{ id: string }>("/demo", {});
      await refresh();
      setExamId(r.id);
      notify("已载入明确标记的示例数据");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDemoBusy(false);
    }
  }
  const needsExam = !["classes", "settings", "overview"].includes(page);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <BookOpen size={23} />
          </div>
          <div>
            <strong>
              知衡<span>ZH I HENG</span>
            </strong>
            <small>让教学，有据可循</small>
          </div>
        </div>
        <div className="workspace-label">
          教师工作空间 <span>V{version}</span>
        </div>
        <nav aria-label="主导航">
          {navs.map(({ page: p, name, icon: Icon }, i) => (
            <button
              key={p}
              aria-label={name}
              className={`nav-item ${page === p ? "active" : ""} ${i === 4 ? "nav-separated" : ""}`}
              aria-current={page === p ? "page" : undefined}
              onClick={() => go(p)}
            >
              <Icon size={19} strokeWidth={1.7} />
              <span>{name}</span>
              {page === p && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-item help-entry"
            aria-label="使用帮助"
            onClick={() => setHelp("start")}
          >
            <CircleHelp size={19} />
            <span>
              使用帮助<small>第一次用，从这里开始</small>
            </span>
          </button>
          <div className="local-card">
            <span className="status-dot" />
            <div>
              <strong>数据保存在本机</strong>
              <small>人工阅卷 · 离线可用</small>
            </div>
          </div>
          <button
            aria-label="设置与数据"
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => go("settings")}
            aria-current={page === "settings" ? "page" : undefined}
          >
            <Settings size={18} />
            <span>设置与数据</span>
          </button>
          <div className="teacher-identity">
            <span className="avatar">师</span>
            <div>
              <strong>数学教师</strong>
              <small>高中数学 · 本地工作区</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            教师工作台
            <ChevronRight size={14} />
            <strong>
              {navs.find((n) => n.page === page)?.name || "设置与数据"}
            </strong>
          </div>
          <div className="topbar-right">
            <label className="exam-picker">
              <span>当前考试</span>
              <select
                aria-label="当前考试"
                value={examId}
                onChange={(e) => setExamId(e.target.value)}
              >
                {!boot?.exams.length && <option value="">尚无考试</option>}
                {boot?.exams.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.demo ? "[示例] " : ""}
                    {e.name} · {e.className}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              onClick={() => {
                if (boot?.classes.length) setNewExam(true);
                else {
                  go("classes");
                  notify("先创建班级和学生名单");
                }
              }}
            >
              <Plus size={16} />
              新建考试
            </Button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <ErrorBox error={error} />
          {!boot ? (
            <Empty
              title={error ? "工作区连接失败" : "正在打开工作区…"}
              detail={error ? "请重新启动应用或检查本机服务。" : undefined}
            >
              <Button
                variant="secondary"
                onClick={() => void refresh().catch((e) => setError(e.message))}
              >
                重试连接
              </Button>
            </Empty>
          ) : (
            <>
              <ContextHelp page={page} onHelp={setHelp} />
              {exam?.demo && !["classes", "settings"].includes(page) && (
                <div className="demo-banner">
                  <Sparkles size={14} />
                  当前为示例考试，姓名与成绩均为演示数据。
                  <span>创建自己的班级即可开始实际使用。</span>
                </div>
              )}
              {page === "classes" ? (
                <ClassesPage
                  boot={boot}
                  onRefresh={refresh}
                  notify={notify}
                  onNewExam={(classId) => {
                    setNewExamClass(classId);
                    setNewExam(true);
                  }}
                />
              ) : page === "settings" ? (
                <SettingsPage
                  key={boot.dataDir}
                  boot={boot}
                  onRefresh={async () => {
                    await refresh();
                    await refreshExam();
                  }}
                  notify={notify}
                  initialAI={setupAI}
                />
              ) : !exam ? (
                examId ? (
                  <Empty title="正在加载考试…" />
                ) : (
                  <FirstSteps
                    boot={boot}
                    onStart={() => go("classes")}
                    onDemo={demo}
                    demoBusy={demoBusy}
                    onHelp={setHelp}
                  />
                )
              ) : page === "overview" ? (
                <Overview exam={exam} go={go} />
              ) : page === "prepare" ? (
                <PreparePage
                  exam={exam}
                  topics={boot.topics}
                  onChanged={changed}
                  notify={notify}
                  settings={boot.settings}
                  onSettings={() => {
                    setSetupAI(true);
                    go("settings");
                  }}
                  onReady={(e) => {
                    setExam(e);
                    void refresh();
                    go("grade");
                    notify(
                      "题目和知识点已确认，全班录分表已生成。老师只需填写小分和可选错因。",
                    );
                  }}
                />
              ) : page === "assessment" ? (
                <AssessmentPage key={examId} exam={exam} onChanged={changed} go={go}/>
              ) : page === "grade" ? (
                <GradePage
                  key={`${examId}-${gradeKey}`}
                  exam={exam}
                  tags={boot.tags}
                  initialQuestion={target.q}
                  initialStudent={target.s}
                  onChanged={changed}
                  notify={notify}
                />
              ) : page === "classReport" || page === "student" ? (
                <AnalyticsPage
                  key={`${examId}-${page}`}
                  exam={exam}
                  personal={page === "student"}
                  onChanged={changed}
                  notify={notify}
                  onGrade={toGrade}
                />
              ) : page === "teaching" ? (
                <TeachingPage key={exam!.id} exam={exam!} onChanged={changed} onGrade={toGrade} />
              ) : page === "reports" ? (
                <ReportsPage exam={exam} notify={notify} />
              ) : null}
              {exam && (page === "prepare" || page === "grade") && (
                <div className="workflow-footer">
                  <p>
                    {page === "prepare"
                      ? "核对题数和全卷满分后，就可以给学生录成绩了。"
                      : "可以先查看已确认的成绩；未录完的部分会标明人数。"}
                  </p>
                  <Button
                    disabled={!leafQuestions(exam).length}
                    onClick={() =>
                      go(page === "prepare" ? "grade" : "classReport")
                    }
                  >
                    {page === "prepare"
                      ? "下一步：录入成绩"
                      : "下一步：查看学情"}
                    <ChevronRight size={16} />
                  </Button>
                </div>
              )}
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>知衡 · 高中数学教学工作台</span>
          <span>最终成绩驱动分析 · 每次判断可追溯</span>
        </footer>
      </div>
      {newExam && boot && (
        <NewExam
          classes={boot.classes}
          initialClassId={newExamClass}
          onClose={() => {
            setNewExam(false);
            setNewExamClass(undefined);
          }}
          onCreated={(e) => {
            setExam(null);
            setExamId(e.id);
            void refresh();
            go("prepare");
            notify("考试已创建，接下来导入试卷 PDF 自动识别");
          }}
        />
      )}
      {help && (
        <HelpCenter
          initial={help}
          onClose={() => setHelp(null)}
          onNavigate={go}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Overview({ exam, go }: { exam: Exam; go: (p: Page) => void }) {
  const a = exam.analysis,
    topics = [...a.topics].sort((x, y) => (x.rate ?? 101) - (y.rate ?? 101)),
    confirmed = leafQuestions(exam).filter(
      (q) => q.confirmed && q.primary,
    ).length;
  return (
    <>
      <div className="page-heading overview-heading">
        <div>
          <span className="eyebrow">本次考试 · 教学工作概览</span>
          <h1>
            每一次作答，都是下一课的起点<span className="title-period">。</span>
          </h1>
          <p>从可靠的成绩出发，看见学生的进展，让下一轮教学更有方向。</p>
        </div>
        <div className="subject-stamp">
          <GraduationCap size={24} />
          <span>
            高中数学<small>班级与个人学情</small>
          </span>
        </div>
      </div>
      <NextStep exam={exam} go={go} />
      <section className="exam-hero">
        <div className="hero-main">
          <div className="hero-meta">
            <Badge tone="light">当前考试</Badge>
            <span>{exam.date}</span>
            <span>{exam.demo ? "示例工作区" : "本机工作区"}</span>
          </div>
          <h2>{exam.name}</h2>
          <p>
            {exam.className}
            <span>·</span>
            {a.expected} 名学生<span>·</span>
            {a.questions.length} 道计分题<span>·</span>满分 {a.max} 分
          </p>
          <div className="hero-actions">
            <Button onClick={() => go("grade")}>
              <PenLine size={16} />
              继续阅卷
              <ArrowUpRight size={16} />
            </Button>
            <button className="hero-link" onClick={() => go("prepare")}>
              查看试卷模板
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="hero-progress">
          <Completion value={a.confirmedCells} total={a.totalCells} />
          <div className="hero-progress-meta">
            <span>
              <i />
              {a.complete} 份完整答卷
            </span>
            <span>{a.pending} 人待完成</span>
          </div>
          <div className="hero-line-art" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>
      <div className="metric-grid">
        <Metric
          title="完整有效答卷"
          value={String(a.complete)}
          unit={`/ ${a.expected}`}
          detail={`${a.absent} 人缺考 · ${a.pending} 人待完成`}
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
          title="知识点已确认"
          value={String(confirmed)}
          unit={`/ ${a.questions.length}`}
          detail="确认后才统计知识点题组表现"
          icon={<Target size={18} />}
        />
        <Metric
          title="已记录问题类型"
          value={String(a.remarks.length)}
          unit="类"
          detail="来自已采用的备注与标签"
          icon={<ClipboardCheck size={18} />}
        />
      </div>
      <div className="overview-grid">
        <section className="panel">
          <SectionTitle
            title="这场考试的工作进度"
            subtitle="每个环节可独立使用，按自己的节奏完成。"
          />
          <div className="step-list">
            <StepCard
              number="01"
              title="准备统一试卷"
              detail={`${a.questions.length} 道计分题，${confirmed} 项知识点已确认`}
              done={a.questions.length > 0 && confirmed === a.questions.length}
              onClick={() => go("prepare")}
            />
            <StepCard
              number="02"
              title="确认逐题成绩"
              detail="人工录分、表格导入，或采用 AI 评分建议"
              done={a.complete + a.absent === a.expected && a.expected > 0}
              onClick={() => go("grade")}
            />
            <StepCard
              number="03"
              title="分析与安排下一课"
              detail="查看个人与班级表现，保存可追溯报告"
              onClick={() => go("classReport")}
            />
          </div>
          <div className="subtle-note">
            <CheckCircle2 size={16} />
            不需要手写识别，也能完成整套学情分析。
          </div>
        </section>
        <section className="panel focus-panel">
          <SectionTitle
            title="值得优先关注的题组"
            subtitle="按本次主要考查题组得分率排序。"
            action={
              <ActionLink onClick={() => go("classReport")}>
                查看分析
              </ActionLink>
            }
          />
          {topics.length ? (
            topics
              .slice(0, 4)
              .map((t) => (
                <RateBar
                  key={t.name}
                  label={t.name}
                  value={t.rate}
                  detail={`第 ${t.questionLabels.join("、")} 题 · ${t.n} 名有效学生${t.count === 1 ? " · 单题证据有限" : ""}`}
                  onClick={() => go("classReport")}
                />
              ))
          ) : (
            <Empty
              title="等待题目与成绩"
              detail="确认知识点并录入成绩后，关注题组会显示在这里。"
            />
          )}
          <div className="panel-footnote">
            得分率反映本次题组表现，具体错因需结合已记录备注。
          </div>
        </section>
      </div>
      {a.issues.length > 0 && (
        <section className="panel attention-panel">
          <div className="attention-heading">
            <span className="attention-icon">
              <ClipboardCheck size={20} />
            </span>
            <div>
              <h3>分析前，再确认一下</h3>
              <p>{a.issues.length} 项待完善信息，补齐后报告会更完整。</p>
            </div>
          </div>
          <div className="issue-chips">
            {a.issues.slice(0, 3).map((x, i) => (
              <button
                key={i}
                onClick={() =>
                  go(
                    x.kind === "topic" || x.kind === "question"
                      ? "prepare"
                      : "grade",
                  )
                }
              >
                {x.text}
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

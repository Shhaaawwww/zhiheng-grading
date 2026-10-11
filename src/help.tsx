import { useState } from "react";
import {
  BookOpen,
  ArrowRight,
  Download,
  HelpCircle,
  CheckCircle2,
  Play,
} from "lucide-react";
import { Modal, Button, Notice } from "./components";
import { chapters, faqs, contextHelp } from "./help-content";
import type { Boot, Exam, Page } from "./types";

export function HelpCenter({
  initial,
  onClose,
  onNavigate,
}: {
  initial: string;
  onClose: () => void;
  onNavigate: (p: Page) => void;
}) {
  const [selected, setSelected] = useState(initial);
  const chapter = chapters.find((c) => c.id === selected) || chapters[0];
  return (
    <Modal title="使用帮助 · 跟着做一次" wide onClose={onClose}>
      <div className="help-topline">
        <p>不需要懂 AI。先找到正在做的事情，按步骤操作。</p>
        <a
          className="btn secondary"
          href="/help/知衡-教师上手指南.pdf"
          download="知衡-教师上手指南.pdf"
        >
          <Download size={16} />
          下载图文指南 PDF
        </a>
      </div>
      <div className="help-layout">
        <nav className="help-nav" aria-label="帮助目录">
          {[...chapters, { id: "faq", title: "常见问题" }].map((c) => (
            <button
              key={c.id}
              aria-current={selected === c.id ? "page" : undefined}
              className={selected === c.id ? "active" : ""}
              onClick={() => setSelected(c.id)}
            >
              {c.title}
            </button>
          ))}
        </nav>
        <section className="help-content" aria-label="操作说明">
          {selected === "faq" ? (
            <>
              <h3>遇到问题，先看这里</h3>
              <div className="help-faqs">
                {faqs.map((f) => (
                  <details key={f.q}>
                    <summary>{f.q}</summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </div>
            </>
          ) : (
            <>
              <h3>{chapter.title}</h3>
              <p className="muted">{chapter.subtitle}</p>
              <ol className="help-steps">
                {chapter.steps.map((s) => (
                  <li key={s.title}>
                    <strong>{s.title}</strong>
                    <p>{s.text}</p>
                  </li>
                ))}
              </ol>
              <Notice>{chapter.tip}</Notice>
              {chapter.image && (
                <details className="help-illustration">
                  <summary>查看这一步的界面示意</summary>
                  <figure>
                    <img
                      src={`/help/${chapter.image}`}
                      alt={chapter.caption}
                      loading="lazy"
                    />
                    <figcaption>
                      {chapter.caption} 图中资料均为示例。
                    </figcaption>
                  </figure>
                </details>
              )}
              <div className="help-actions">
                <Button
                  onClick={() => {
                    onClose();
                    onNavigate(chapter.page);
                  }}
                >
                  {chapter.action}
                  <ArrowRight size={16} />
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  返回刚才的操作
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}

export function ContextHelp({
  page,
  onHelp,
}: {
  page: Page;
  onHelp: (id: string) => void;
}) {
  const help = contextHelp[page];
  return (
    <div className="context-help">
      <span>
        <BookOpen size={16} aria-hidden="true" />
        {help.text}
      </span>
      <button onClick={() => onHelp(help.chapter)}>
        <HelpCircle size={16} />
        本页怎么用
      </button>
    </div>
  );
}

export function FirstSteps({
  boot,
  onStart,
  onDemo,
  demoBusy,
  onHelp,
}: {
  boot: Boot;
  onStart: () => void;
  onDemo: () => void;
  demoBusy: boolean;
  onHelp: (id: string) => void;
}) {
  const hasClass = boot.classes.some((c) => !c.demo && c.students.length);
  return (
    <section className="welcome-start">
      <span className="welcome-kicker">
        <BookOpen size={20} />
        教师上手指引
      </span>
      <h1>把这次考试，变成下一课的依据</h1>
      <p className="welcome-lead">
        准备学生名单和一份试卷 PDF，AI 自动整理题目、题型和知识点。
        核对全班共用的评分标准后，可上传学生原卷自动预批，再由老师看原卷确认；也可直接填写小分。
      </p>
      <ol className="welcome-flow">
        {[
          "建班级和考试",
          "导入 PDF 自动识别",
          "预批或录分并复核",
          "看学情与报告",
        ].map((t, i) => (
          <li key={t}>
            <span>{i + 1}</span>
            <strong>{t}</strong>
          </li>
        ))}
      </ol>
      <div className="welcome-actions">
        <Button onClick={onStart}>
          {hasClass ? "继续为班级创建考试" : "建立我的班级"}
          <ArrowRight size={17} />
        </Button>
        <Button variant="secondary" busy={demoBusy} onClick={onDemo}>
          <Play size={16} />
          体验示例考试
        </Button>
        <Button variant="ghost" onClick={() => onHelp("start")}>
          先看操作说明
        </Button>
      </div>
      <div className="welcome-scenarios">
        <article>
          <strong>纸卷已经批好了</strong>
          <p>直接输入或导入每道题的分数。备注可留空，学生原卷也可以不上传。</p>
          <button onClick={() => onHelp("grade")}>
            查看录分方法 <ArrowRight size={14} />
          </button>
        </article>
        <article>
          <strong>想让 AI 辅助批卷</strong>
          <p>每个学生准备一份 PDF，可另传参考答案。系统逐点预批，老师看原卷后分别确认分数与错误表现。</p>
          <button onClick={() => onHelp("assessment")}>
            查看辅助阅卷方法 <ArrowRight size={14} />
          </button>
        </article>
      </div>
      <p className="welcome-note">
        还不熟悉时，先用示例练习。示例班级和成绩都是虚构的，并有明确标记。
      </p>
    </section>
  );
}

export function NextStep({ exam, go }: { exam: Exam; go: (p: Page) => void }) {
  const a = exam.analysis;
  const missingTopics = a.questions.filter((q) => !q.confirmedTopic).length;
  const next = !a.questions.length
    ? {
        page: "prepare" as Page,
        title: "下一步：导入试卷 PDF，自动整理题目",
        detail: "AI 一次识别题干、满分、题型和知识点，确认后生成全班录分表。",
        action: "去自动识别试卷",
      }
    : a.confirmedCells === 0
      ? {
          page: "grade" as Page,
          title: "下一步：录入第一份成绩",
          detail: "已经批好可以直接填成绩表，或导入 Excel。",
          action: "去录成绩",
        }
      : a.pending > 0
        ? {
            page: "grade" as Page,
            title: `还有 ${a.pending} 位学生的成绩待完成`,
            detail: "可以继续录分；现在也能查看已经确认的逐题结果。",
            action: "继续录成绩",
          }
        : missingTopics > 0
          ? {
              page: "prepare" as Page,
              title: `还有 ${missingTopics} 道题的知识点待核对`,
              detail: "确认后可查看知识点题组表现；已有逐题成绩仍可正常分析。",
              action: "去核对知识点",
            }
          : {
              page: "classReport" as Page,
              title: "可以查看本次考试的学情了",
              detail: "先检查完整答卷人数，再保存报告和安排下一课。",
              action: "去看学情",
            };
  return (
    <section className="next-step">
      <CheckCircle2 size={22} aria-hidden="true" />
      <div>
        <strong>{next.title}</strong>
        <p>{next.detail}</p>
      </div>
      <Button variant="secondary" onClick={() => go(next.page)}>
        {next.action}
        <ArrowRight size={16} />
      </Button>
    </section>
  );
}

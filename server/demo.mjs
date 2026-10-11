import { id, now, keyOf } from "./domain.mjs";
export function createDemo(store) {
  const existing = store.list("exams").find((e) => e.demo);
  if (existing) return existing;
  const students = [
    "林",
    "陈",
    "苏",
    "周",
    "沈",
    "徐",
    "许",
    "江",
    "陆",
    "顾",
    "方",
    "何",
  ].map((name, i) => ({
    id: id(),
    name: `${name}同学`,
    number: `2026${String(i + 1).padStart(2, "0")}`,
  }));
  const c = {
    id: id(),
    name: "高二（3）班 · 示例",
    grade: "高二",
    students,
    demo: true,
    createdAt: now(),
  };
  const specs = [
    ["1", "已知集合 A={1,2,3}，B={2,3,4}，求 A∩B。", 5, "集合与逻辑", "{2,3}"],
    ["2", "已知 sin α=3/5 且 α 为锐角，求 cos α。", 5, "三角函数", "4/5"],
    ["3", "等差数列首项为 2，公差为 3，求前 10 项和。", 5, "数列", "155"],
    [
      "4",
      "设随机变量 X 的分布为 P(X=0)=0.4，P(X=1)=0.6，求 E(X)。",
      5,
      "概率与统计",
      "0.6",
    ],
    [
      "5",
      "已知函数 f(x)=x³-3x，求其单调区间。",
      10,
      "导数与单调性",
      "增区间 (-∞,-1) 与 (1,+∞)，减区间 (-1,1)",
    ],
    [
      "6",
      "已知直线与平面满足所给垂直条件，请证明另一组线面垂直。",
      10,
      "立体几何",
      "按题设建立线面垂直判定",
    ],
    [
      "7(1)",
      "求函数 f(x)=x³-3ax 的导函数。",
      6,
      "导数与单调性",
      "f′(x)=3x²-3a",
    ],
    [
      "7(2)",
      "分类讨论参数 a 对函数 f(x)=x³-3ax 单调性的影响。",
      14,
      "导数综合应用",
      "区分 a≤0 与 a>0 讨论导数符号及单调性",
    ],
  ];
  const parentId = id();
  const questions = specs.map((s, i) => ({
    id: id(),
    label: s[0],
    stem: s[1],
    max: s[2],
    step: 0.5,
    type: i < 4 ? "fill" : "solve",
    primary: s[3],
    related: i > 5 ? ["分类讨论", "求导运算"] : [],
    confirmed: true,
    answer: s[4],
    rubric: `满分 ${s[2]} 分，依据关键步骤酌情给分。`,
    parentId: i > 5 ? parentId : null,
    page: 1,
    region: null,
  }));
  questions.splice(6, 0, {
    id: parentId,
    label: "7",
    stem: "导数综合题",
    max: 20,
    step: 0.5,
    type: "group",
    primary: "",
    related: [],
    confirmed: true,
    answer: "",
    rubric: "",
    parentId: null,
    page: 1,
    region: null,
  });
  const scores = [
    [5, 5, 5, 5, 9, 8, 6, 10],
    [5, 5, 5, 5, 8, 7, 6, 8],
    [5, 5, 5, 0, 7, 8, 5, 8],
    [5, 0, 5, 5, 8, 6, 6, 6],
    [5, 5, 0, 5, 6, 7, 5, 7],
    [5, 5, 5, 0, 6, 6, 4, 5],
    [5, 0, 5, 5, 5, 6, 5, 4],
    [0, 5, 5, 0, 4, 6, 4, 5],
    [5, 0, 0, 5, 5, 4, 3, 3],
    [0, 5, 0, 0, 4, 4, 3, 2],
    [5, 5, 5, 5, 8, null, null, null],
    Array(8).fill(null),
  ];
  const grades = {};
  const leaf = questions.filter((q) => q.type !== "group");
  students.forEach((s, i) =>
    leaf.forEach((q, j) => {
      let note = "",
        tags = [];
      if (j === 7 && i > 1 && i < 10) {
        note =
          i % 2 ? "参数讨论漏掉 a=0 的边界情况。" : "未完整讨论 a≤0 的情况。";
        tags = ["分类讨论遗漏"];
      }
      if (j === 4 && i > 5 && i < 10) {
        note = "求导后的符号判断有误。";
        tags = ["运算错误"];
      }
      grades[keyOf(s.id, q.id)] = {
        studentId: s.id,
        questionId: q.id,
        score: scores[i][j],
        status:
          i === 11 ? "absent" : scores[i][j] === null ? "ungraded" : "final",
        note,
        tags,
        source: "teacher",
        updatedAt: now(),
      };
    }),
  );
  const exam = {
    id: id(),
    classId: c.id,
    className: c.name,
    name: "函数与导数 · 单元检测",
    date: "2026-09-07",
    students,
    questions,
    grades,
    revision: 1,
    demo: true,
    createdAt: now(),
    updatedAt: now(),
    attachments: [],
    plan: "",
  };
  store.transaction(() => {
    store.put("classes", c);
    store.put("exams", exam);
  });
  return exam;
}

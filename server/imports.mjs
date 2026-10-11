import ExcelJS from "exceljs";
import { id, keyOf, leaves, validateGrade, fail } from "./domain.mjs";

export function parseDelimited(text) {
  text = text.replace(/^\uFEFF/, "");
  const delimiter = text.split(/\r?\n/)[0].includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) fail("表格引号未闭合，请检查 CSV 文件。");
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
export async function readSheet(filename, base64) {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > 25 * 1024 * 1024) fail("表格最大 25 MB。");
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sh = wb.worksheets[0];
    if (!sh) fail("工作簿中没有工作表。");
    const rows = [];
    sh.eachRow({ includeEmpty: false }, (row) => {
      rows.push(
        Array.from({ length: Math.min(sh.columnCount, 220) }, (_, i) => {
          const v = row.getCell(i + 1).value;
          if (v && typeof v === "object") {
            if ("formula" in v)
              fail("成绩导入不接受公式单元格，请先粘贴为数值。");
            if ("richText" in v) return v.richText.map((x) => x.text).join("");
            return String(row.getCell(i + 1).text || "");
          }
          return String(v ?? "");
        }),
      );
    });
    return rows;
  }
  if (!/\.(csv|tsv)$/i.test(filename))
    fail("请使用 .xlsx、.csv 或 .tsv 表格。");
  return parseDelimited(buffer.toString("utf8"));
}
const normalize = (s) => String(s).normalize("NFKC").trim();
const qlabel = (s) => normalize(s).replace(/^Q/i, "").replace(/\s/g, "");
const NUMBER_HEADERS = ["学号", "student_number", "student number", "student_id", "student id", "number"];
const NAME_HEADERS = ["姓名", "name", "student_name", "student name"];
export function previewGrades(exam, rows) {
  if (rows.length < 2) fail("表格需要表头和至少一条数据。");
  if (rows.length > 30001) fail("单次导入最多 30000 行。");
  const header = rows[0].map(normalize),
    idx = (names) => header.findIndex((x) => names.includes(x.toLowerCase()));
  const numberCol = idx(NUMBER_HEADERS),
    nameCol = idx(NAME_HEADERS);
  if (numberCol < 0) fail("表格必须有“学号”列，请使用导入模板。");
  const questionCol = idx(["题号", "question"]),
    scoreCol = idx(["得分", "score"]),
    statusCol = idx(["状态", "status"]),
    noteCol = idx(["备注", "note"]),
    tagsCol = idx(["标签", "tags"]);
  const long = questionCol >= 0;
  if (long && scoreCol < 0) fail("长表必须有“得分”列。");
  const qs = leaves(exam),
    errors = [],
    changes = [],
    seen = new Set();
  const statusMap = {
    已确认: "final",
    缺考: "absent",
    不适用: "na",
    草稿: "draft",
    未录入: "ungraded",
    final: "final",
    absent: "absent",
    na: "na",
    draft: "draft",
    ungraded: "ungraded",
  };
  const wide = header
    .map((h, col) => ({
      col,
      q: qs.find((q) => qlabel(q.label) === qlabel(h)),
    }))
    .filter((x) => x.q);
  if (!long && !wide.length) fail("没有匹配的题号列，请按本场考试模板填写。");
  if (!long)
    header.forEach((h, col) => {
      if (
        h &&
        ![numberCol, nameCol].includes(col) &&
        !wide.some((x) => x.col === col)
      )
        errors.push({
          row: 1,
          message: `未知列“${h}”，请检查题号或改用长表备注模板。`,
        });
    });
  rows.slice(1).forEach((row, i) => {
    const student = exam.students.find(
      (s) => s.number === normalize(row[numberCol] ?? ""),
    );
    if (!student) {
      errors.push({
        row: i + 2,
        message: `学号 ${row[numberCol] || "（空）"} 不在本场考试名单中。`,
      });
      return;
    }
    if (
      nameCol >= 0 &&
      normalize(row[nameCol] ?? "") &&
      normalize(row[nameCol]) !== student.name
    ) {
      errors.push({ row: i + 2, message: "姓名与学号对应的名单不一致。" });
      return;
    }
    const cells = long
      ? [
          {
            q: qs.find(
              (q) => qlabel(q.label) === qlabel(row[questionCol] ?? ""),
            ),
            value: row[scoreCol],
          },
        ]
      : wide.map(({ col, q }) => ({ q, value: row[col] }));
    for (const { q, value } of cells) {
      if (!q) {
        errors.push({
          row: i + 2,
          message: `题号 ${row[questionCol]} 不存在或是汇总题。`,
        });
        continue;
      }
      const prev = exam.grades[keyOf(student.id, q.id)],
        valueText = normalize(value ?? "");
      const stateText =
        long && statusCol >= 0 ? normalize(row[statusCol] ?? "") : "";
      const noteText =
        long && noteCol >= 0 ? normalize(row[noteCol] ?? "") : "";
      const tagsText =
        long && tagsCol >= 0 ? normalize(row[tagsCol] ?? "") : "";
      if (!valueText && !stateText && !noteText && !tagsText) continue;
      const key = keyOf(student.id, q.id);
      if (seen.has(key)) {
        errors.push({
          row: i + 2,
          message: `${student.name} 第 ${q.label} 题重复出现。`,
        });
        continue;
      }
      seen.add(key);
      const status = stateText
        ? statusMap[stateText]
        : valueText
          ? statusMap[valueText] || "final"
          : prev?.status || "ungraded";
      if (!status) {
        errors.push({ row: i + 2, message: `未知状态 ${stateText}。` });
        continue;
      }
      if (
        !["final", "draft"].includes(status) &&
        valueText &&
        !statusMap[valueText]
      ) {
        errors.push({
          row: i + 2,
          message: "非评分状态与数值得分冲突，请核对。",
        });
        continue;
      }
      const score = ["final", "draft"].includes(status)
        ? valueText
          ? Number(valueText)
          : (prev?.score ?? null)
        : null;
      try {
        const grade = validateGrade(exam, {
          studentId: student.id,
          questionId: q.id,
          status,
          score,
          note: noteText || prev?.note || "",
          tags: tagsText
            ? tagsText
                .split(/[;；、]/)
                .map((x) => x.trim())
                .filter(Boolean)
            : prev?.tags || [],
          source: "import",
        });
        const changed =
          !prev ||
          prev.status !== grade.status ||
          prev.score !== grade.score ||
          prev.note !== grade.note ||
          JSON.stringify(prev.tags) !== JSON.stringify(grade.tags);
        if (changed)
          changes.push({
            ...grade,
            studentName: student.name,
            label: q.label,
            row: i + 2,
            previous: prev || null,
            conflict: !!prev && (prev.status !== "ungraded" || !!prev.note),
          });
      } catch (e) {
        errors.push({ row: i + 2, message: e.message });
      }
    }
  });
  return {
    kind: "grades",
    revision: exam.revision,
    changes,
    errors,
    conflicts: changes.filter((c) => c.conflict).length,
    skipped: rows.length - 1,
  };
}
export function previewRoster(existing, rows) {
  const h = rows[0]?.map(normalize) || [],
    n = h.findIndex((x) => NUMBER_HEADERS.includes(x.toLowerCase())),
    name = h.findIndex((x) => NAME_HEADERS.includes(x.toLowerCase()));
  if (n < 0 || name < 0) fail("名单需要“学号”和“姓名”两列。");
  const errors = [],
    students = [],
    seen = new Set();
  rows.slice(1).forEach((r, i) => {
    const number = normalize(r[n] ?? ""),
      studentName = normalize(r[name] ?? "");
    if (!number || !studentName) {
      errors.push({ row: i + 2, message: "学号与姓名不能为空。" });
      return;
    }
    if (seen.has(number)) {
      errors.push({ row: i + 2, message: `重复学号 ${number}。` });
      return;
    }
    seen.add(number);
    const old = existing.find((s) => s.number === number);
    if (old && old.name !== studentName) {
      errors.push({
        row: i + 2,
        message: `学号 ${number} 的姓名与现有名单不同，请先核对。`,
      });
      return;
    }
    if (!old) students.push({ id: id(), number, name: studentName });
  });
  if (existing.length + students.length > 1000) fail("单班最多 1000 名学生。");
  return { kind: "roster", students, errors, existing: existing.length };
}
export async function workbook(exam, mode = "grades") {
  const wb = new ExcelJS.Workbook();
  wb.creator = "知衡";
  const sheet = wb.addWorksheet(
    mode === "roster" ? "学生名单" : mode === "long" ? "逐题明细" : "成绩表",
  );
  const qs = mode === "roster" ? [] : leaves(exam),
    state = {
      final: "已确认",
      ungraded: "未录入",
      draft: "草稿",
      absent: "缺考",
      na: "不适用",
    };
  if (mode === "roster") {
    sheet.addRow(["学号", "姓名"]);
    exam.students.forEach((s) => sheet.addRow([s.number, s.name]));
  } else if (mode === "long") {
    sheet.addRow(["学号", "姓名", "题号", "得分", "状态", "备注", "标签"]);
    for (const s of exam.students)
      for (const q of qs) {
        const g = exam.grades[keyOf(s.id, q.id)];
        sheet.addRow([
          s.number,
          s.name,
          q.label,
          g?.score ?? null,
          state[g?.status || "ungraded"],
          g?.note || "",
          g?.tags.join("；") || "",
        ]);
      }
  } else {
    sheet.addRow(["学号", "姓名", ...qs.map((q) => q.label)]);
    exam.students.forEach((s) =>
      sheet.addRow([
        s.number,
        s.name,
        ...qs.map((q) => {
          if (mode === "template") return null;
          const g = exam.grades[keyOf(s.id, q.id)];
          return g?.status === "final"
            ? g.score
            : g?.status === "absent"
              ? "缺考"
              : g?.status === "na"
                ? "不适用"
                : null;
        }),
      ]),
    );
  }
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF173749" },
  };
  sheet.getRow(1).height = 28;
  sheet.columns.forEach((c, i) => {
    c.width = i < 2 ? 18 : mode === "long" && i === 5 ? 50 : 17;
  });
  const info = wb.addWorksheet("使用说明");
  info.getColumn(1).width = 95;
  [
    "知衡 · 高中数学阅卷与学情分析",
    exam.demo ? "此文件包含虚构示例数据。" : "本文件来自本地考试档案。",
    "空白代表未录入，数字 0 代表零分；缺考与不适用单独记录。",
    "成绩表仅导出最终分数；草稿详见逐题明细。",
    "大题汇总不重复导出为评分列。知识点表现只使用确认的主要标签。",
    "再次导入时请使用成绩表或逐题明细工作表；第一张表会被读取。",
  ].forEach((t) => info.addRow([t]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

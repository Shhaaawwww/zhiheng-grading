// Model suggestions never own the factual narrative or the class population.
export function recordedNotes(input, f) {
  const notes = [];
  for (const ref of f.remarkRefs || [])
    for (const s of input.finalResults)
      for (const g of s.grades)
        if (`${s.student}:${g.questionId}` === ref)
          notes.push({ ref, note: g.note, tags: g.tags });
  const skill = (input.assessment?.skills || []).find(
    (s) => s.name === f.skillName,
  );
  notes.push(
    ...(skill?.examples || [])
      .filter((x) => (f.assessmentRefs || []).includes(x.evidenceRef))
      .map((x) => ({
        ref: x.evidenceRef,
        note: `教师已核对 · ${skill.name} · ${x.criterionLabel}：${x.comment}`,
        tags: [],
      })),
  );
  return notes;
}
export function factObservation(input, ids) {
  return ids
    .map((id) => {
      const q = input.questions.find((q) => q.id === id);
      const s = input.statistics.questions.find((q) => q.id === id);
      const g =
        input.scope === "student"
          ? input.finalResults[0]?.grades.find((g) => g.questionId === id)
          : null;
      const score =
        input.scope === "student"
          ? g
            ? `最终得分 ${g.score}/${q.max ?? "待核对"}。${g.score === q.max ? "本题满分，备注不代表扣分。" : ""}`
            : "本题尚无最终得分。"
          : `已确认 ${s.n} 份，得分率 ${s.rate ?? "待计算"}%，失分 ${s.lost} 人；其中有备注 ${s.annotatedLost} 人。`;
      return `第 ${q.label} 题：${score}${q.confirmed ? `考查 ${q.primary}。` : "知识点待核对，不作知识诊断。"}`;
    })
    .join("\n");
}

export function constrainedReport(raw, input, validate) {
  const rejected = [],
    findings = [];
  for (const [index, candidate] of (Array.isArray(raw.findings)
    ? raw.findings
    : []
  )
    .slice(0, 8)
    .entries()) {
    try {
      const f = validate(
        {
          summary: "",
          findings: [
            {
              ...candidate,
              title: candidate.title || "教学行动",
              observation: "",
            },
          ],
        },
        input,
      ).findings[0];
      if (
        input.scope === "student" &&
        f.evidence.some(
          (id) =>
            !input.finalResults[0]?.grades.some((g) => g.questionId === id),
        )
      )
        throw Error("引用了尚未确认的小分");
      if (
        f.remarkRefs.some(
          (ref) => !f.evidence.some((id) => ref.endsWith(`:${id}`)),
        )
      )
        throw Error("错因备注与引用题目不一致");
      if (
        Array.isArray(input.focusGroups) &&
        !input.focusGroups.some((g) =>
          f.evidence.every((id) => g.evidence.includes(id)),
        )
      )
        throw Error("建议混合了不同教学目标或超出本次优先目标");
      if (/\d+(?:\.\d+)?\s*(?:[%％]|分(?!钟)|人)/.test(f.action + f.check))
        throw Error("建议中夹带未核验的成绩或人数");
      const qs = f.evidence.map((id) =>
        input.questions.find((q) => q.id === id),
      );
      f.title = `${qs.map((q) => `第${q.label}题`).join("、")} · ${f.certainty === "recorded" ? "结合教师记录" : "进一步检查"}`;
      f.observation = factObservation(input, f.evidence);
      if (f.skillName) {
        const s = input.assessment.skills.find((s) => s.name === f.skillName);
        f.title = `${s.name} · 结合已核对的作答表现`;
        f.observation += `\n技能“${s.name}”：已核对 ${s.reviewedStudents} 人，有明确错误 ${s.errorStudents} 人，已表现 ${s.demonstratedStudents} 人，证据不足 ${s.unknownStudents} 人，受前错影响 ${s.blockedStudents} 人。人数可能交叉，不能相加；不代表长期掌握率。`;
      }
      // Verbatim recorded notes are displayed separately from suggested explanations.
      f.recordedNotes = recordedNotes(input, f);
      findings.push(f);
    } catch (e) {
      rejected.push({ index, reason: e.message });
    }
  }
  return {
    summary:
      input.scope === "student"
        ? "以下分数事实由程序根据最终小分生成。教学行动为建议，请结合课堂观察选用。"
        : `本次 ${input.statistics.complete}/${input.statistics.expected} 名学生成绩完整。分数和人数由程序生成，备注样本不代表全班。`,
    findings: findings.slice(0, input.scope === "student" ? 2 : 3),
    note: `${findings.length ? "" : "本次没有通过校验的 AI 建议，请使用基础报告或教师补充。"}${rejected.length ? `已过滤 ${rejected.length} 项证据或格式不合格的建议。` : ""}只有得分不能确定具体错因；一次测评不等于长期掌握程度。`,
    rejected,
  };
}

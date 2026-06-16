import assert from "node:assert/strict";
import test from "node:test";

import {
  applySkillEditPatch,
  editBudgetForTick,
  skillEditPatchSchema,
  TEAM_SKILL_MAX_EDIT_OPS,
  type SkillEditOp
} from "./domain/team-skill.js";

const SKILL = [
  "---",
  "name: quarterly-report",
  "when_to_use: 生成季度业务报告",
  "---",
  "",
  "# 季度报告",
  "",
  "开篇说明。",
  "",
  "## 总则",
  "",
  "先列目标。",
  "",
  "## 套路",
  "",
  "1. 拉数据",
  "2. 写结论"
].join("\n");

test("editBudgetForTick anneals with the active library size", () => {
  assert.equal(editBudgetForTick(0), 3);
  assert.equal(editBudgetForTick(50), 0);
  assert.equal(editBudgetForTick(49), 1);
});

test("applySkillEditPatch modifies an existing section in place, preserving frontmatter + preamble", () => {
  const ops: SkillEditOp[] = [{ op: "modify_section", section: "总则", content_md: "先对齐口径，再列目标。" }];
  const result = applySkillEditPatch(SKILL, ops);
  assert.equal(result.appliedCount, 1);
  assert.equal(result.ops[0]?.status, "applied");
  assert.match(result.content_md, /^---\nname: quarterly-report/u); // frontmatter 保留
  assert.match(result.content_md, /# 季度报告/u); // preamble 保留
  assert.match(result.content_md, /## 总则\n\n先对齐口径，再列目标。/u);
  assert.doesNotMatch(result.content_md, /先列目标。/u); // 旧正文被替换
  assert.match(result.content_md, /## 套路/u); // 其它段落不动
});

test("applySkillEditPatch appends a new section and removes another", () => {
  const ops: SkillEditOp[] = [
    { op: "add_section", section: "边界情况", content_md: "数据缺口时标注假设。" },
    { op: "remove_section", section: "套路" }
  ];
  const result = applySkillEditPatch(SKILL, ops);
  assert.equal(result.appliedCount, 2);
  assert.match(result.content_md, /## 边界情况\n\n数据缺口时标注假设。/u);
  assert.doesNotMatch(result.content_md, /## 套路/u);
});

test("applySkillEditPatch rejects bad ops per-op without dropping the good ones", () => {
  const ops: SkillEditOp[] = [
    { op: "add_section", section: "总则", content_md: "重复段落" }, // 已存在 → section_exists
    { op: "modify_section", section: "不存在的段", content_md: "x" }, // → section_missing
    { op: "remove_section", section: "缺失段" }, // → section_missing
    { op: "modify_section", section: "套路", content_md: "改对了" } // 合法
  ];
  const result = applySkillEditPatch(SKILL, ops);
  assert.equal(result.appliedCount, 1);
  assert.equal(result.ops[0]?.status, "rejected");
  assert.equal(result.ops[0] && "reason" in result.ops[0] ? result.ops[0].reason : "", "section_exists");
  assert.equal(result.ops[1] && "reason" in result.ops[1] ? result.ops[1].reason : "", "section_missing");
  assert.equal(result.ops[3]?.status, "applied");
  assert.match(result.content_md, /## 套路\n\n改对了/u);
});

test("applySkillEditPatch refuses content that smuggles a new ## heading (keeps one-op-one-section)", () => {
  const ops: SkillEditOp[] = [
    { op: "modify_section", section: "总则", content_md: "正文\n## 偷塞的段落\n破坏结构" }
  ];
  const result = applySkillEditPatch(SKILL, ops);
  assert.equal(result.appliedCount, 0);
  assert.equal(result.ops[0] && "reason" in result.ops[0] ? result.ops[0].reason : "", "content_has_section_heading");
  assert.equal(result.content_md, SKILL); // 无 op 应用 → 原文不变
});

test("applySkillEditPatch is re-parseable: a section added then modified lands once", () => {
  const added = applySkillEditPatch(SKILL, [{ op: "add_section", section: "输出格式", content_md: "Markdown 表格。" }]);
  const modified = applySkillEditPatch(added.content_md, [{ op: "modify_section", section: "输出格式", content_md: "改成 CSV。" }]);
  assert.equal(modified.appliedCount, 1);
  const occurrences = modified.content_md.match(/## 输出格式/gu)?.length ?? 0;
  assert.equal(occurrences, 1); // 不重复
  assert.match(modified.content_md, /## 输出格式\n\n改成 CSV。/u);
});

test("skillEditPatchSchema caps ops at the edit budget", () => {
  const tooMany = {
    skill_key: "quarterly-report",
    base_version: 2,
    ops: Array.from({ length: TEAM_SKILL_MAX_EDIT_OPS + 1 }, (_unused, i) => ({
      op: "add_section" as const,
      section: `s${i}`,
      content_md: "x"
    })),
    rationale_md: "太多了",
    confidence_score: 0.9
  };
  assert.equal(skillEditPatchSchema.safeParse(tooMany).success, false);

  const ok = { ...tooMany, ops: tooMany.ops.slice(0, TEAM_SKILL_MAX_EDIT_OPS) };
  assert.equal(skillEditPatchSchema.safeParse(ok).success, true);
});

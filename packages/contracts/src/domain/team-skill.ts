import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";

// 团队级技能状态：
// - draft：刚蒸馏、自验未过（不注入 prompt）
// - active：自验通过、当前生效（合并进 worker 技能目录）
// - deprecated：人类 kill-switch 或被新版本取代（不注入）
export const teamSkillStatusSchema = z.enum(["draft", "active", "deprecated"]);
export type TeamSkillStatus = z.infer<typeof teamSkillStatusSchema>;

export const teamSkillSourceKindSchema = z.enum(["distilled", "authored"]);
export type TeamSkillSourceKind = z.infer<typeof teamSkillSourceKindSchema>;

export const teamSkillRecordSchema = z.object({
  id: idSchema,
  workspace_id: idSchema,
  skill_key: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  when_to_use: z.string().min(1),
  content_md: z.string().min(1),
  status: teamSkillStatusSchema,
  version: z.number().int().positive(),
  source_kind: teamSkillSourceKindSchema,
  created_by_kind: z.enum(["ai", "human"]),
  confidence_score: z.number().min(0).max(1).optional(),
  sample_count: z.number().int().min(0),
  source_run_id: idSchema.optional(),
  deprecated_reason: z.string().optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
});
export type TeamSkillRecord = z.infer<typeof teamSkillRecordSchema>;

// AI 蒸馏单元（LLM 输出 → 自验 → 晋升）。skill_key 须全小写连字符。
export const distilledTeamSkillSchema = z.object({
  skill_key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/u, "skill_key 必须全小写连字符"),
  name: z.string().min(1).max(128),
  when_to_use: z.string().min(5).max(120),
  content_md: z.string().min(40),
  sample_count: z.number().int().min(0),
  confidence_score: z.number().min(0).max(1)
});
export type DistilledTeamSkill = z.infer<typeof distilledTeamSkillSchema>;

export const distilledTeamSkillsResponseSchema = z.object({
  distilled_skills: z.array(distilledTeamSkillSchema).default([]),
  reason_if_none: z.string().optional()
});
export type DistilledTeamSkillsResponse = z.infer<typeof distilledTeamSkillsResponseSchema>;

// 自验门槛（AI 全自主晋升，无人工预审）。
export const TEAM_SKILL_MIN_SAMPLE_COUNT = 5;
export const TEAM_SKILL_MIN_CONFIDENCE = 0.7;
// 每工作空间一次蒸馏最多产出的技能数（防爆）。这是「学习率」的基准值，见 editBudgetForTick。
export const TEAM_SKILL_MAX_PER_CURATION = 3;
// 每工作空间活跃技能硬上限。
export const TEAM_SKILL_MAX_ACTIVE_PER_WORKSPACE = 50;
// 喂回 curation prompt 的「近期被放弃提议」记忆条数上限（K1 rejected-edit buffer）。
export const TEAM_SKILL_DISCARD_MEMORY_LIMIT = 12;
// #20 体积守卫：技能正文会注入每个未来 worker prompt，必须管体积。新增/精修后超此上限即拒（约 2–3k tokens）。
export const TEAM_SKILL_MAX_CONTENT_CHARS = 8000;

// K3（借鉴 SkillOpt 的 edit-budget = 学习率调度）：每次 curation tick 允许「新增」多少技能，
// 随活跃技能库的成熟度线性退火——库越满，每夜新增预算越小，到硬上限归零（只精修/驱逐，不再加）。
// WorkHub 无 ground-truth 分数，所以不去「测量」改进、而是限制每夜改动的爆炸半径（配合 rollback 兜底）。
// 这是 SkillOpt 数值 gate 的 noise-tolerant 替代：静态调度，不依赖任何吵分数。
export function editBudgetForTick(
  activeTeamSkillCount: number,
  options: { base?: number; cap?: number } = {}
): number {
  const base = options.base ?? TEAM_SKILL_MAX_PER_CURATION;
  const cap = options.cap ?? TEAM_SKILL_MAX_ACTIVE_PER_WORKSPACE;
  if (base <= 0) {
    return 0;
  }
  const safeCount = Math.max(0, activeTeamSkillCount);
  const ratio = cap > 0 ? Math.min(safeCount / cap, 1) : 1;
  return Math.max(0, Math.ceil(base * (1 - ratio)));
}

// ── K2：受限编辑补丁（借鉴 SkillOpt 的 edit-patch = 「梯度」）────────────────────────────
// 不再整文档重写激活技能，而是对当前激活版本打「最多 L 个」段落级补丁（Add/Modify/Remove），
// 像深度学习里裁剪过的梯度：可审 diff、保留 provenance（改了哪几段）、爆炸半径受限、可回滚。
// 段落 = SKILL.md 正文里的 `## 标题` 块；frontmatter 与 `# 一级标题`/引言（首个 `##` 之前）永不被段落补丁触碰。

// 每次精修最多允许的补丁操作数（= SkillOpt 的 edit-budget/梯度裁剪在「改」维度的上限）。
export const TEAM_SKILL_MAX_EDIT_OPS = 3;
// 每次 curation tick 最多精修多少个激活技能（限制「改」的每夜爆炸半径，与 K3 的「增」预算并列）。
export const TEAM_SKILL_MAX_REFINES_PER_CURATION = 2;
// 鼓励 curator 使用的「打字化段落」词汇（不强制：applier 接受任意 `## 标题`，prompt 引导用这些）。
export const TEAM_SKILL_CANONICAL_SECTIONS = ["总则", "套路", "边界情况", "输出格式"] as const;

export const skillEditOpSchema = z.object({
  op: z.enum(["add_section", "modify_section", "remove_section"]),
  // 段落标题（不含前导 `## `）。
  section: z.string().min(1).max(80),
  // add/modify 需要正文；remove 忽略。正文里不得再含 `## ` 行（会破坏单 op 单段落的不变量）。
  content_md: z.string().max(4000).optional()
});
export type SkillEditOp = z.infer<typeof skillEditOpSchema>;

export const skillEditPatchSchema = z.object({
  skill_key: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/u, "skill_key 必须全小写连字符"),
  // 针对哪个激活版本打补丁（乐观并发：与当前激活版本不符则整补丁作废）。
  base_version: z.number().int().positive(),
  ops: z.array(skillEditOpSchema).min(1).max(TEAM_SKILL_MAX_EDIT_OPS),
  rationale_md: z.string().min(1),
  confidence_score: z.number().min(0).max(1)
});
export type SkillEditPatch = z.infer<typeof skillEditPatchSchema>;

export const skillEditPatchResponseSchema = z.object({
  patches: z.array(skillEditPatchSchema).default([]),
  reason_if_none: z.string().optional()
});
export type SkillEditPatchResponse = z.infer<typeof skillEditPatchResponseSchema>;

export type AppliedSkillEditOp = { op: SkillEditOp; status: "applied" } | { op: SkillEditOp; status: "rejected"; reason: string };

export type SkillEditPatchApplyResult = {
  content_md: string;
  ops: AppliedSkillEditOp[];
  appliedCount: number;
};

type ParsedSkillDoc = {
  frontmatter: string; // 含尾部换行的完整 frontmatter 块（可能为空串）
  preamble: string; // 首个 `## ` 之前的正文（# 标题/引言）
  sections: Array<{ heading: string; body: string }>;
};

function parseSkillDoc(contentMd: string): ParsedSkillDoc {
  let rest = contentMd;
  let frontmatter = "";
  const fm = /^(---\n[\s\S]*?\n---\n?)/u.exec(contentMd);
  if (fm?.[1]) {
    frontmatter = fm[1];
    rest = contentMd.slice(fm[1].length);
  }
  const lines = rest.split("\n");
  const preambleLines: string[] = [];
  const sections: Array<{ heading: string; body: string[] }> = [];
  let current: { heading: string; body: string[] } | undefined;
  // findings[#low]：围栏代码块（``` / ~~~）内的 `## ` 行不是真段落标题，不能当作分节边界。
  let inFence = false;
  let fenceMarker = "";
  for (const line of lines) {
    const fenceOpen = /^\s*(```+|~~~+)/u.exec(line);
    if (!inFence && fenceOpen) {
      inFence = true;
      fenceMarker = fenceOpen[1]![0]!;
    } else if (inFence && fenceOpen && fenceOpen[1]![0] === fenceMarker) {
      inFence = false;
      fenceMarker = "";
    }
    const headingMatch = inFence ? null : /^##\s+(.*\S)\s*$/u.exec(line);
    if (headingMatch) {
      current = { heading: headingMatch[1]!.trim(), body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  return {
    frontmatter,
    preamble: preambleLines.join("\n"),
    sections: sections.map((section) => ({ heading: section.heading, body: section.body.join("\n").replace(/\n+$/u, "") }))
  };
}

function serializeSkillDoc(doc: ParsedSkillDoc): string {
  const parts: string[] = [];
  const preamble = doc.preamble.replace(/\n+$/u, "");
  let head = doc.frontmatter;
  if (head && !head.endsWith("\n")) {
    head += "\n";
  }
  let body = preamble;
  for (const section of doc.sections) {
    const sectionBody = section.body.replace(/\n+$/u, "");
    body += `${body ? "\n\n" : ""}## ${section.heading}${sectionBody ? `\n\n${sectionBody}` : ""}`;
  }
  parts.push(`${head}${body}`);
  return `${parts.join("")}\n`;
}

// content_md 自身含 `## ` 行会破坏「单 op 单段落」不变量；用 `### ` 子标题代替。
// findings[#low]：与 parseSkillDoc 一致——围栏代码块内的 `## ` 不算真标题，逐行扫描跳过围栏内。
function opContentHasSectionHeading(content: string | undefined): boolean {
  if (content === undefined) {
    return false;
  }
  let inFence = false;
  let fenceMarker = "";
  for (const line of content.split("\n")) {
    const fenceOpen = /^\s*(```+|~~~+)/u.exec(line);
    if (!inFence && fenceOpen) {
      inFence = true;
      fenceMarker = fenceOpen[1]![0]!;
      continue;
    }
    if (inFence && fenceOpen && fenceOpen[1]![0] === fenceMarker) {
      inFence = false;
      fenceMarker = "";
      continue;
    }
    if (!inFence && /^##\s+/u.test(line)) {
      return true;
    }
  }
  return false;
}

/**
 * K2：把受限编辑补丁应用到当前激活技能正文（纯函数、确定性、逐 op 尽力而为）。
 * 每个 op 独立成功/失败，失败的 op 记原因但不连累其余；frontmatter / preamble 永不被段落 op 改写。
 */
export function applySkillEditPatch(currentContentMd: string, ops: SkillEditOp[]): SkillEditPatchApplyResult {
  const doc = parseSkillDoc(currentContentMd);
  const results: AppliedSkillEditOp[] = [];
  let appliedCount = 0;

  const findIndex = (heading: string) => doc.sections.findIndex((section) => section.heading === heading.trim());

  for (const op of ops) {
    const heading = op.section.trim();
    if (!heading) {
      results.push({ op, status: "rejected", reason: "empty_section" });
      continue;
    }
    if ((op.op === "add_section" || op.op === "modify_section")) {
      if (!op.content_md || !op.content_md.trim()) {
        results.push({ op, status: "rejected", reason: "missing_content" });
        continue;
      }
      if (opContentHasSectionHeading(op.content_md)) {
        results.push({ op, status: "rejected", reason: "content_has_section_heading" });
        continue;
      }
    }
    const idx = findIndex(heading);
    if (op.op === "add_section") {
      if (idx >= 0) {
        results.push({ op, status: "rejected", reason: "section_exists" });
        continue;
      }
      doc.sections.push({ heading, body: op.content_md!.trim() });
      results.push({ op, status: "applied" });
      appliedCount += 1;
    } else if (op.op === "modify_section") {
      if (idx < 0) {
        results.push({ op, status: "rejected", reason: "section_missing" });
        continue;
      }
      doc.sections[idx] = { heading, body: op.content_md!.trim() };
      results.push({ op, status: "applied" });
      appliedCount += 1;
    } else {
      if (idx < 0) {
        results.push({ op, status: "rejected", reason: "section_missing" });
        continue;
      }
      doc.sections.splice(idx, 1);
      results.push({ op, status: "applied" });
      appliedCount += 1;
    }
  }

  return { content_md: appliedCount > 0 ? serializeSkillDoc(doc) : currentContentMd, ops: results, appliedCount };
}

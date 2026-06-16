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

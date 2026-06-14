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
// 每工作空间一次蒸馏最多产出的技能数（防爆）。
export const TEAM_SKILL_MAX_PER_CURATION = 3;
// 每工作空间活跃技能硬上限。
export const TEAM_SKILL_MAX_ACTIVE_PER_WORKSPACE = 50;

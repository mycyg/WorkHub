import {
  teamSkillsPageVmSchema,
  type TeamSkillCurationStatusVM,
  type TeamSkillsPageVM,
  type TeamSkillVM
} from "@workhub/contracts";
import type { TeamSkillRow } from "@workhub/db";

import { parseOutputContract } from "./output-contract.js";

export type TeamSkillsPageInput = {
  // 当前激活的团队技能（一 key 一 active），按 skill_key 排序。
  skills: readonly TeamSkillRow[];
  // R23 SA-06：AI 夜间自学的运行状态。刻意做成必填——页面要回答「这台部署到底有没有人在攒技能」，
  // 由路由从 worker 侧读真值传入（读不到就是 running:false / last_run_at:null 的诚实缺省），
  // 页面装配层自己不猜。
  curation: TeamSkillCurationStatusVM;
  generatedAt?: Date;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// 从激活技能的 samplesJson 里抽 K2 精修 provenance（refined_from_version + ops + rationale）。
// 仅精修版本写了这些字段；新增技能的 samplesJson 是 {accepted, escalations}，返回 undefined。
function provenanceFrom(samplesJson: unknown): TeamSkillVM["provenance"] {
  if (!samplesJson || typeof samplesJson !== "object") {
    return undefined;
  }
  const record = samplesJson as Record<string, unknown>;
  const refinedFrom = record["refined_from_version"];
  if (typeof refinedFrom !== "number" || !Number.isInteger(refinedFrom) || refinedFrom < 1) {
    return undefined;
  }
  const ops = Array.isArray(record["ops"]) ? record["ops"] : [];
  const rationale = record["rationale_md"];
  return {
    refined_from_version: refinedFrom,
    op_count: ops.length,
    ...(typeof rationale === "string" && rationale ? { rationale_md: rationale } : {})
  };
}

function toTeamSkillVM(row: TeamSkillRow): TeamSkillVM {
  const provenance = provenanceFrom(row.samplesJson);
  return {
    skill_key: row.skillKey,
    name: row.name,
    when_to_use: row.whenToUse,
    version: row.version,
    source_kind: row.sourceKind,
    created_by_kind: row.createdByKind,
    // findings[#low]：confidenceScore 是 doublePrecision，越界/NaN 会撞 min(0).max(1) schema
    // 把整页 500。夹紧到 [0,1]，非有限值直接跳过该字段而不是毒化整页。
    ...(() => {
      if (row.confidenceScore === null || row.confidenceScore === undefined) return {};
      const score = Number(row.confidenceScore);
      if (!Number.isFinite(score)) return {};
      return { confidence_score: Math.min(1, Math.max(0, score)) };
    })(),
    sample_count: row.sampleCount,
    updated_at: toIso(row.updatedAt),
    ...(provenance ? { provenance } : {})
  };
}

export function buildTeamSkillsPage(input: TeamSkillsPageInput): TeamSkillsPageVM {
  const generatedAt = input.generatedAt ?? new Date();
  const skills = [...input.skills]
    .map(toTeamSkillVM)
    .sort((a, b) => a.skill_key.localeCompare(b.skill_key));
  const refined = skills.filter((skill) => skill.provenance !== undefined).length;
  const aiAuthored = skills.filter((skill) => skill.created_by_kind === "ai").length;

  // findings[#79]：输出边界 parse 失败是服务端装配 bug → InternalContractError(500)，不是客户端 422。
  return parseOutputContract(teamSkillsPageVmSchema, {
    generated_at: generatedAt.toISOString(),
    skills,
    totals: {
      active: skills.length,
      ai_authored: aiAuthored,
      refined
    },
    curation: input.curation,
    ...(skills.length === 0 ? { empty_state: "no_skills" as const } : {})
  }, "team-skills");
}

import {
  distilledTeamSkillSchema,
  distilledTeamSkillsResponseSchema,
  TEAM_SKILL_MAX_PER_CURATION,
  TEAM_SKILL_MIN_CONFIDENCE,
  TEAM_SKILL_MIN_SAMPLE_COUNT,
  type DistilledTeamSkill,
  type DistilledTeamSkillsResponse
} from "@workhub/contracts";
import type { AcceptedDeliverableSignal, EscalationSignal } from "@workhub/db";

export type SkillCurationAnalysis = {
  workspaceId: string;
  acceptedDeliverables: AcceptedDeliverableSignal[];
  escalations: EscalationSignal[];
  existingSkills: string[];
  totalAccepted: number;
};

export type SkillValidationResult = { ok: true } | { ok: false; reason: string };

// content_md 必须带合法 frontmatter（--- name / when_to_use ---），否则无法被 load_skill 解析。
export function hasValidFrontmatter(contentMd: string): boolean {
  const match = /^---\n([\s\S]*?)\n---/u.exec(contentMd);
  if (!match?.[1]) {
    return false;
  }
  const body = match[1];
  return /(^|\n)name\s*:/u.test(body) && /(^|\n)when_to_use\s*:/u.test(body);
}

// 自验：AI 全自主晋升的唯一闸门（无人工预审）。任一不过 → 放弃并记录理由。
export function validateDistilledSkill(
  skill: DistilledTeamSkill,
  options: { existingSkills: string[] }
): SkillValidationResult {
  if (skill.sample_count < TEAM_SKILL_MIN_SAMPLE_COUNT) {
    return { ok: false, reason: "insufficient_samples" };
  }
  if (skill.confidence_score < TEAM_SKILL_MIN_CONFIDENCE) {
    return { ok: false, reason: "low_confidence" };
  }
  if (!/^[a-z0-9-]+$/u.test(skill.skill_key)) {
    return { ok: false, reason: "invalid_skill_key" };
  }
  if (options.existingSkills.includes(skill.skill_key)) {
    return { ok: false, reason: "duplicate_skill_key" };
  }
  if (!hasValidFrontmatter(skill.content_md)) {
    return { ok: false, reason: "invalid_frontmatter" };
  }
  return { ok: true };
}

// 这个工作空间有没有值得蒸馏的活动量（无活动则跳过，省一次 LLM 调用）。
export function hasCurationSignal(analysis: SkillCurationAnalysis): boolean {
  return analysis.totalAccepted > 0 || analysis.escalations.length > 0;
}

export function buildCurationSystemPrompt(): string {
  return [
    "你是 WorkHub 的团队技能策展人（AI，全自主，无人工预审）。",
    "目标：把这个团队最近的真实工作沉淀成可复用的「团队技能」（SKILL.md），让未来的 AI 工人少走弯路。",
    "只在证据充分时提议；证据不足就明确返回不新增，不要硬凑。"
  ].join("\n");
}

export function buildCurationPrompt(analysis: SkillCurationAnalysis): string {
  const accepted = analysis.acceptedDeliverables.length
    ? analysis.acceptedDeliverables.map((row) => `- ${row.targetKind}：被接受 ${row.count} 次`).join("\n")
    : "（无）";
  const escalations = analysis.escalations.length
    ? analysis.escalations.map((row) => `- [${row.trigger}×${row.count}] ${row.reasonMd}`).join("\n")
    : "（无）";
  return [
    "请根据下面这个团队最近 7 天的工作数据，提议 0–3 项新的团队技能。",
    "",
    "【被接受的交付物（正样本，说明这类活高频且被认可）】",
    accepted,
    "",
    "【升级/卡壳信号（说明缺什么能力）】",
    escalations,
    "",
    `【已有技能（不要重复）】\n${analysis.existingSkills.join("、") || "（无）"}`,
    "",
    "硬性要求：",
    `1. 每项技能必须对应至少 ${TEAM_SKILL_MIN_SAMPLE_COUNT} 个样本（sample_count ≥ ${TEAM_SKILL_MIN_SAMPLE_COUNT}）。`,
    "2. skill_key 全小写连字符（如 quarterly-report），不得与已有技能重复。",
    "3. content_md 必须是合法 SKILL.md：以 frontmatter 开头（--- 含 name / when_to_use ---），后接正文。",
    `4. 证据不足时，distilled_skills 留空数组，并在 reason_if_none 说明原因。最多 ${TEAM_SKILL_MAX_PER_CURATION} 项。`,
    "",
    "只返回 JSON，结构：",
    '{ "distilled_skills": [ { "skill_key": "...", "name": "...", "when_to_use": "...", "content_md": "---\\nname: ...\\nwhen_to_use: ...\\n---\\n\\n# ...", "sample_count": 6, "confidence_score": 0.85 } ], "reason_if_none": "..." }'
  ].join("\n");
}

// 从 LLM 文本里抠出 JSON（容忍 ```json 围栏与前后噪声），fail-closed：解析不了就返回空。
export function parseDistilledResponse(text: string): DistilledTeamSkillsResponse {
  const empty: DistilledTeamSkillsResponse = { distilled_skills: [] };
  if (!text) {
    return empty;
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return empty;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return empty;
  }
  const result = distilledTeamSkillsResponseSchema.safeParse(parsed);
  if (!result.success) {
    // 整体 schema 不过时，逐项宽松收集合法技能（一项坏不连累全体）。
    const obj = parsed as { distilled_skills?: unknown[]; reason_if_none?: unknown };
    const skills: DistilledTeamSkill[] = [];
    for (const item of Array.isArray(obj?.distilled_skills) ? obj.distilled_skills : []) {
      const single = distilledTeamSkillSchema.safeParse(item);
      if (single.success) {
        skills.push(single.data);
      }
    }
    return {
      distilled_skills: skills.slice(0, TEAM_SKILL_MAX_PER_CURATION),
      ...(typeof obj?.reason_if_none === "string" ? { reason_if_none: obj.reason_if_none } : {})
    };
  }
  return {
    distilled_skills: result.data.distilled_skills.slice(0, TEAM_SKILL_MAX_PER_CURATION),
    ...(result.data.reason_if_none ? { reason_if_none: result.data.reason_if_none } : {})
  };
}

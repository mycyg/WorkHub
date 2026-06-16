import {
  applySkillEditPatch,
  distilledTeamSkillSchema,
  distilledTeamSkillsResponseSchema,
  skillEditPatchSchema,
  skillEditPatchResponseSchema,
  TEAM_SKILL_CANONICAL_SECTIONS,
  TEAM_SKILL_MAX_EDIT_OPS,
  TEAM_SKILL_MAX_PER_CURATION,
  TEAM_SKILL_MIN_CONFIDENCE,
  TEAM_SKILL_MIN_SAMPLE_COUNT,
  type AppliedSkillEditOp,
  type DistilledTeamSkill,
  type DistilledTeamSkillsResponse,
  type SkillEditPatch,
  type SkillEditPatchResponse
} from "@workhub/contracts";
import type { AcceptedDeliverableSignal, DiscardedSkillSignal, EscalationSignal } from "@workhub/db";

// K2：可被精修的激活技能（喂回当前正文，要 curator 打受限补丁）。
export type ActiveSkillForRefinement = {
  skillKey: string;
  name: string;
  whenToUse: string;
  version: number;
  contentMd: string;
};

export type SkillCurationAnalysis = {
  workspaceId: string;
  acceptedDeliverables: AcceptedDeliverableSignal[];
  escalations: EscalationSignal[];
  existingSkills: string[];
  // K1：近期被放弃的提议（rejected-edit buffer），喂回 prompt 当「勿再原样重提」记忆。
  discardedSkills: DiscardedSkillSignal[];
  // K3：当前活跃「团队」技能数（不含预设技能），用来算本夜 edit-budget（学习率退火）。
  activeTeamSkillCount: number;
  // K2：当前活跃团队技能（带正文），用来做受限编辑补丁式精修。
  activeSkills: ActiveSkillForRefinement[];
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
  // K1：rejected-edit 记忆——把近期蒸馏出来却自验未过的提议列出来，避免每夜重复白烧同一个低质提议。
  const discarded = analysis.discardedSkills.length
    ? analysis.discardedSkills
        .map((row) => `- ${row.skillKey}（曾被放弃 ${row.count} 次，最近原因：${row.reason}）`)
        .join("\n")
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
    "【近期被放弃的提议（除非证据明显变强，否则勿再原样重提相同 skill_key）】",
    discarded,
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

// ── K2：受限编辑补丁式精修（refine existing active skill）────────────────────────────

// git 冲突标记不得出现在精修结果里（与 merge-fusion 同口径，fail-closed）。
function hasConflictMarkers(text: string): boolean {
  return text.includes("<<<<<<<") || text.includes("=======") || text.includes(">>>>>>>");
}

export type SkillEditPatchValidation =
  | { ok: true; contentMd: string; appliedOps: AppliedSkillEditOp[] }
  | { ok: false; reason: string };

// K2 自验：把补丁应用到当前激活正文后再判生死。任一不过 → 放弃并记录理由（与新增技能同纪律）。
export function validateSkillEditPatch(
  patch: SkillEditPatch,
  options: { activeVersion: number; currentContentMd: string }
): SkillEditPatchValidation {
  if (patch.confidence_score < TEAM_SKILL_MIN_CONFIDENCE) {
    return { ok: false, reason: "low_confidence" };
  }
  // 乐观并发：补丁声明的 base_version 必须正是当前激活版本，否则它是对旧底稿的改动，作废。
  if (patch.base_version !== options.activeVersion) {
    return { ok: false, reason: "stale_base_version" };
  }
  const applied = applySkillEditPatch(options.currentContentMd, patch.ops);
  if (applied.appliedCount === 0) {
    return { ok: false, reason: "no_ops_applied" };
  }
  if (!hasValidFrontmatter(applied.content_md)) {
    return { ok: false, reason: "invalid_frontmatter" };
  }
  if (applied.content_md.trim().length < 40) {
    return { ok: false, reason: "too_short" };
  }
  if (hasConflictMarkers(applied.content_md)) {
    return { ok: false, reason: "conflict_markers" };
  }
  // 精修不应把正文改没了（净删导致比原文短一大截时存疑）——保留全删=驱逐走 deprecate，不走精修。
  return { ok: true, contentMd: applied.content_md, appliedOps: applied.ops };
}

// 激活技能正文喂回 prompt 时按此上限截断（控体积——技能会注入每个未来 worker prompt）。
const REFINE_CONTENT_PREVIEW_CHARS = 1600;

export function buildRefinementSystemPrompt(): string {
  return [
    "你是 WorkHub 的团队技能策展人（AI，全自主）。这一步不是新增技能，而是「精修」已有的激活技能。",
    "像给冻结模型打一个裁剪过的梯度：只对确有改进证据的技能，做最小、可审的段落级补丁，绝不整篇重写。",
    "没有把握就不要改——返回空 patches 比乱改更好。"
  ].join("\n");
}

export function buildSkillRefinementPrompt(analysis: SkillCurationAnalysis): string {
  const skills = analysis.activeSkills.length
    ? analysis.activeSkills
        .map((skill) => {
          const preview = skill.contentMd.length > REFINE_CONTENT_PREVIEW_CHARS
            ? `${skill.contentMd.slice(0, REFINE_CONTENT_PREVIEW_CHARS)}\n…（正文已截断）`
            : skill.contentMd;
          return [
            `### ${skill.skillKey}（当前激活版本 v${skill.version}）`,
            "```markdown",
            preview,
            "```"
          ].join("\n");
        })
        .join("\n\n")
    : "（无激活技能可精修）";
  const escalations = analysis.escalations.length
    ? analysis.escalations.map((row) => `- [${row.trigger}×${row.count}] ${row.reasonMd}`).join("\n")
    : "（无）";
  return [
    "下面是这个团队当前激活的技能（含正文）与最近的升级/卡壳信号。",
    "若某个技能的正文存在「会导致这些卡壳」的缺口，请对它打一个受限编辑补丁来补上。",
    "",
    "【激活技能正文】",
    skills,
    "",
    "【升级/卡壳信号（精修方向）】",
    escalations,
    "",
    "硬性要求：",
    "1. 只能精修上面列出的激活技能；patch.skill_key 必须命中其一。",
    "2. patch.base_version 必须等于该技能「当前激活版本」号（上面括号里的 vN）。",
    `3. 每个补丁最多 ${TEAM_SKILL_MAX_EDIT_OPS} 个 op（add_section / modify_section / remove_section）。`,
    `4. 段落标题尽量用规范词汇：${TEAM_SKILL_CANONICAL_SECTIONS.join(" / ")}（也可用已有段落标题）。`,
    "5. op.content_md 是该段落的新正文，里面不得再出现 `## ` 段落标题行（要分层用 `### `）。",
    "6. 不要整篇重写；没有确切改进就别动它。无补丁时 patches 留空，reason_if_none 说明原因。",
    "",
    "只返回 JSON，结构：",
    '{ "patches": [ { "skill_key": "...", "base_version": 2, "ops": [ { "op": "modify_section", "section": "边界情况", "content_md": "..." } ], "rationale_md": "...", "confidence_score": 0.82 } ], "reason_if_none": "..." }'
  ].join("\n");
}

// 从 LLM 文本里抠出 patch JSON（容忍 ```json 围栏与噪声），逐项宽松收集合法补丁，fail-closed。
export function parseSkillEditPatchResponse(text: string): SkillEditPatchResponse {
  const empty: SkillEditPatchResponse = { patches: [] };
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
  const result = skillEditPatchResponseSchema.safeParse(parsed);
  if (result.success) {
    return {
      patches: result.data.patches,
      ...(result.data.reason_if_none ? { reason_if_none: result.data.reason_if_none } : {})
    };
  }
  const obj = parsed as { patches?: unknown[]; reason_if_none?: unknown };
  const patches: SkillEditPatch[] = [];
  for (const item of Array.isArray(obj?.patches) ? obj.patches : []) {
    const single = skillEditPatchSchema.safeParse(item);
    if (single.success) {
      patches.push(single.data);
    }
  }
  return {
    patches,
    ...(typeof obj?.reason_if_none === "string" ? { reason_if_none: obj.reason_if_none } : {})
  };
}

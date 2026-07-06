import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { LlmActor, ProviderRegistry } from "@workhub/agent/providers";
import {
  normalizeWorkHubLocale,
  riskLevelSchema,
  taskPlanItemRoleSchema,
  type RiskLevel,
  type TaskPlanItemRole,
  type WorkHubLocale
} from "@workhub/contracts";

const META_PLANNER_MAX_TOKENS = 2_400;
const META_PLANNER_JUDGE_MAX_TOKENS = 900;
const META_PLANNER_TIMEOUT_MS = 60_000;
const MAX_PLAN_ITEMS = 8;

type JsonObject = Record<string, unknown>;

export class MetaPlannerServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type MetaPlannerWorkItemInput = {
  id: string;
  workspaceId?: string;
  title?: string;
  rawDescription?: string;
  summaryMd?: string;
};

export type MetaPlannerCreateDraftInput = {
  actor: LlmActor;
  locale?: WorkHubLocale;
  workItem: MetaPlannerWorkItemInput;
  acceptance: string[];
  memories?: {
    user?: string[];
    team?: string[];
  };
};

export type MetaPlannerDraftItem = {
  id: string;
  seq: number;
  title: string;
  role: TaskPlanItemRole;
  objectiveMd: string;
  acceptanceMd: string;
  budgetSharePct: number;
  riskLevel?: RiskLevel;
  dependsOn: string[];
};

export type MetaPlannerDraft = {
  items: MetaPlannerDraftItem[];
  decompositionContext: JsonObject;
};

export type MetaPlanner = {
  createDraft: (input: MetaPlannerCreateDraftInput) => Promise<MetaPlannerDraft>;
};

const rawItemSchema = z.object({
  key: z.string().min(1).max(80),
  title: z.string().min(1).max(256),
  role: taskPlanItemRoleSchema,
  objective_md: z.string().min(1),
  acceptance_md: z.string().min(1),
  budget_share_pct: z.number().int().min(0).max(100),
  risk_level: riskLevelSchema.default("medium"),
  depends_on: z.array(z.string().min(1).max(80)).default([])
});

const rawPlanSchema = z.object({
  items: z.array(rawItemSchema).min(1).max(MAX_PLAN_ITEMS)
});

const judgeSchema = z.object({
  decision: z.enum(["approve", "retry", "escalate"]),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  reasons: z.array(z.string().min(1)).default([])
});

type RawPlan = z.infer<typeof rawPlanSchema>;
type JudgeResult = z.infer<typeof judgeSchema>;

export type MetaPlannerOptions = {
  providerRegistry: Pick<ProviderRegistry, "isConfigured" | "get">;
  id?: () => string;
};

function textFromContent(content: unknown[]) {
  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (block && typeof block === "object") {
        const text = (block as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("\n")
    .trim();
}

function parseJsonObject(text: string): unknown {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM response was not a JSON object");
  }
  return parsed;
}

function compactLines(values: readonly string[] | undefined, fallback: string) {
  const lines = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return lines.length ? lines.map((line, index) => `${index + 1}. ${line}`).join("\n") : fallback;
}

function plannerPrompt(input: MetaPlannerCreateDraftInput, feedback: readonly string[] = []) {
  const locale = normalizeWorkHubLocale(input.locale);
  const zh = locale !== "en-US";
  const intent = [
    input.workItem.title ? `Title: ${input.workItem.title}` : undefined,
    input.workItem.rawDescription ? `Raw request: ${input.workItem.rawDescription}` : undefined,
    input.workItem.summaryMd ? `Summary: ${input.workItem.summaryMd}` : undefined
  ].filter(Boolean).join("\n");
  return [
    zh
      ? "把这个 WorkHub 工作项拆成可审计、可派发的任务计划。"
      : "Decompose this WorkHub work item into an auditable dispatch plan.",
    "Return strict JSON only with this shape:",
    "{\"items\":[{\"key\":\"short-stable-key\",\"title\":\"...\",\"role\":\"research|produce|review|integrate\",\"objective_md\":\"...\",\"acceptance_md\":\"...\",\"budget_share_pct\":40,\"risk_level\":\"low|medium|high\",\"depends_on\":[\"other-key\"]}]}",
    zh
      ? "规则：3-5 个原子子任务优先；每个子任务必须有可测验收；role/risk_level 只能来自枚举；depends_on 只能引用前面或同计划 key；预算份额总和必须等于 100；法务、财务、身份、对外发布或不可逆影响标 high，否则默认 medium/low；不要输出泛化模板。"
      : "Rules: prefer 3-5 atomic subtasks; every subtask needs measurable acceptance; role/risk_level must be enum values; depends_on may reference only item keys in this plan; budget shares must sum to exactly 100; mark legal, financial, identity, external-publishing, or irreversible-impact work high, otherwise use medium/low; do not return a generic template.",
    feedback.length ? `Previous draft was rejected:\n${compactLines(feedback, "None")}` : undefined,
    "",
    `Work item:\n${intent || "No description provided."}`,
    "",
    `Acceptance:\n${compactLines(input.acceptance, "No acceptance criteria provided.")}`,
    "",
    `User memories:\n${compactLines(input.memories?.user, "None")}`,
    "",
    `Team memories:\n${compactLines(input.memories?.team, "None")}`
  ].filter((value): value is string => typeof value === "string").join("\n");
}

function judgePrompt(plan: RawPlan, input: MetaPlannerCreateDraftInput) {
  return [
    "Judge this WorkHub task decomposition. Return strict JSON only:",
    "{\"decision\":\"approve|retry|escalate\",\"confidence\":\"high|medium|low\",\"reasons\":[\"...\"]}",
    "Return retry when tasks are template-like, unmeasurable, overlapping, or not tied to the work item acceptance. Return escalate if a human must clarify the plan.",
    "",
    `Work item title: ${input.workItem.title ?? ""}`,
    `Work item request: ${input.workItem.rawDescription ?? input.workItem.summaryMd ?? ""}`,
    `Acceptance:\n${compactLines(input.acceptance, "None")}`,
    "",
    `Plan JSON:\n${JSON.stringify(plan)}`
  ].join("\n");
}

function hasCycle(plan: RawPlan) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const graph = new Map(plan.items.map((item) => [item.key, item.depends_on]));
  const visit = (key: string): boolean => {
    if (visiting.has(key)) {
      return true;
    }
    if (visited.has(key)) {
      return false;
    }
    visiting.add(key);
    for (const dep of graph.get(key) ?? []) {
      if (visit(dep)) {
        return true;
      }
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  return plan.items.some((item) => visit(item.key));
}

function validatePlan(plan: RawPlan): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const item of plan.items) {
    if (keys.has(item.key)) {
      errors.push(`Duplicate item key: ${item.key}`);
    }
    keys.add(item.key);
    if (!item.acceptance_md.trim()) {
      errors.push(`Item ${item.key} is missing acceptance.`);
    }
  }
  for (const item of plan.items) {
    for (const dep of item.depends_on) {
      if (!keys.has(dep)) {
        errors.push(`Item ${item.key} depends on unknown key ${dep}.`);
      }
    }
  }
  const budgetTotal = plan.items.reduce((sum, item) => sum + item.budget_share_pct, 0);
  if (budgetTotal !== 100) {
    errors.push(`Budget shares sum to ${budgetTotal}, not 100.`);
  }
  if (hasCycle(plan)) {
    errors.push("Dependencies contain a cycle.");
  }
  return errors;
}

function toDraft(plan: RawPlan, nextId: () => string): MetaPlannerDraftItem[] {
  const idsByKey = new Map<string, string>();
  for (const item of plan.items) {
    idsByKey.set(item.key, nextId());
  }
  return plan.items.map((item, index) => ({
    id: idsByKey.get(item.key) ?? nextId(),
    seq: index,
    title: item.title,
    role: item.role,
    objectiveMd: item.objective_md,
    acceptanceMd: item.acceptance_md,
    budgetSharePct: item.budget_share_pct,
    riskLevel: item.risk_level,
    dependsOn: item.depends_on.map((key) => idsByKey.get(key)).filter((value): value is string => typeof value === "string")
  }));
}

function needsHuman(locale: WorkHubLocale) {
  return new MetaPlannerServiceError(
    409,
    "task_plan_decomposition_needs_human",
    locale === "en-US"
      ? "The AI could not produce a measurable task plan after one retry. Please review the work item before dispatch."
      : "AI 重拆一次后仍未产出可验收的任务计划，请先由人确认计划。"
  );
}

function invalidResponse(locale: WorkHubLocale, reason: string) {
  return new MetaPlannerServiceError(
    502,
    "task_plan_llm_invalid_response",
    locale === "en-US"
      ? `AI returned an invalid task plan: ${reason}`
      : `AI 返回的任务计划格式无效：${reason}`
  );
}

export function createMetaPlanner(options: MetaPlannerOptions): MetaPlanner {
  const nextId = options.id ?? randomUUID;
  return {
    async createDraft(input) {
      const locale = normalizeWorkHubLocale(input.locale);
      if (!options.providerRegistry.isConfigured()) {
        throw new MetaPlannerServiceError(
          503,
          "task_plan_llm_unavailable",
          locale === "en-US" ? "AI planning is not configured." : "AI 计划拆解尚未配置。"
        );
      }
      const actorId = input.actor.userId ?? input.actor.id;
      const workspaceId = input.workItem.workspaceId ?? input.actor.workspaceId;
      const actor: LlmActor = {
        ...input.actor,
        ...(actorId ? { id: actorId, userId: actorId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        workItemId: input.workItem.id
      };
      const client = options.providerRegistry.get(actor, "decompose");
      let feedback: string[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await client.messages.create({
          maxTokens: META_PLANNER_MAX_TOKENS,
          source: "agent_step",
          timeoutMs: META_PLANNER_TIMEOUT_MS,
          system: "You are WorkHub's meta-planner. Return strict JSON only. Never include secrets, prose outside JSON, or implementation advice unrelated to the task plan.",
          messages: [{ role: "user", content: plannerPrompt(input, feedback) }]
        });
        let plan: RawPlan;
        try {
          plan = rawPlanSchema.parse(parseJsonObject(textFromContent(response.content)));
        } catch (error) {
          feedback = [error instanceof Error ? error.message : String(error)];
          if (attempt === 0) {
            continue;
          }
          throw invalidResponse(locale, feedback[0] ?? "unknown parse error");
        }
        const structuralErrors = validatePlan(plan);
        if (structuralErrors.length > 0) {
          feedback = structuralErrors;
          if (attempt === 0) {
            continue;
          }
          throw needsHuman(locale);
        }
        const judgeResponse = await client.messages.create({
          maxTokens: META_PLANNER_JUDGE_MAX_TOKENS,
          source: "agent_step",
          timeoutMs: META_PLANNER_TIMEOUT_MS,
          system: "You are WorkHub's decomposition judge. Return strict JSON only.",
          messages: [{ role: "user", content: judgePrompt(plan, input) }]
        });
        let judge: JudgeResult;
        try {
          judge = judgeSchema.parse(parseJsonObject(textFromContent(judgeResponse.content)));
        } catch (error) {
          feedback = [error instanceof Error ? error.message : String(error)];
          if (attempt === 0) {
            continue;
          }
          throw invalidResponse(locale, feedback[0] ?? "unknown judge parse error");
        }
        if (judge.decision === "approve") {
          return {
            items: toDraft(plan, nextId),
            decompositionContext: {
              attempts: attempt + 1,
              judge,
              source: "meta-planner"
            }
          };
        }
        feedback = judge.reasons.length ? judge.reasons : [`judge decision: ${judge.decision}`];
      }
      throw needsHuman(locale);
    }
  };
}

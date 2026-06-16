import { settings } from "@workhub/config";
import {
  getSharedDatabaseClient,
  createTeamSkillRepository,
  type AuditLogRepository,
  type TeamSkillRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import { listSkills } from "@workhub/tools";
import {
  editBudgetForTick,
  TEAM_SKILL_MAX_REFINES_PER_CURATION,
  type DistilledTeamSkillsResponse,
  type SkillEditPatchResponse
} from "@workhub/contracts";

import { getDefaultAuditStores } from "../services/audit-stores.js";
import { getDefaultProviderRegistry } from "../services/provider-registry.js";
import { getDefaultAgentRunQueue } from "./agent-runner.js";
import {
  buildCurationPrompt,
  buildCurationSystemPrompt,
  buildRefinementSystemPrompt,
  buildSkillRefinementPrompt,
  hasCurationSignal,
  parseDistilledResponse,
  parseSkillEditPatchResponse,
  validateDistilledSkill,
  validateSkillEditPatch,
  type SkillCurationAnalysis
} from "../services/skill-curation.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type SkillCurationTickResult = {
  workspaces: number;
  promoted: number;
  discarded: number;
  // K3：合格但超出本夜 edit-budget 而推迟（非拒绝；信号仍在则下夜可再晋升）。
  deferred: number;
  // K2：对激活技能成功应用受限编辑补丁、晋升出新版本的次数。
  refined: number;
  started_at: string;
  finished_at: string;
};

export type AgentRunSkillCurationScheduler = {
  tick: () => Promise<SkillCurationTickResult>;
  start: () => void;
  stop: () => void;
  stats: () => {
    running: boolean;
    tick_count: number;
    promoted_count: number;
    discarded_count: number;
    deferred_count: number;
    refined_count: number;
    error_count: number;
    last_tick_at?: string;
    last_error_message?: string;
  };
};

export type SkillCurationSchedulerOptions = {
  repository: Pick<TeamSkillRepository, "promote">;
  auditLog: Pick<AuditLogRepository, "createAuditLog">;
  listWorkspaces: () => Promise<{ id: string }[]>;
  analyze: (workspaceId: string) => Promise<SkillCurationAnalysis>;
  distill: (analysis: SkillCurationAnalysis) => Promise<DistilledTeamSkillsResponse>;
  // K2：可选的「精修」步——给激活技能要受限编辑补丁。未提供则只跑新增（向后兼容）。
  refine?: (analysis: SkillCurationAnalysis) => Promise<SkillEditPatchResponse>;
  intervalMs?: number;
  workQueueIsIdle?: () => Promise<boolean>;
  now?: () => Date;
  onError?: (error: unknown) => void;
};

export function createAgentRunSkillCurationScheduler(
  options: SkillCurationSchedulerOptions
): AgentRunSkillCurationScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  const workQueueIsIdle = options.workQueueIsIdle ?? (async () => true);

  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickCount = 0;
  let promotedCount = 0;
  let discardedCount = 0;
  let deferredCount = 0;
  let refinedCount = 0;
  let errorCount = 0;
  let lastTickAt: string | undefined;
  let lastErrorMessage: string | undefined;

  // K2：精修激活技能——给 curator 当前正文，要受限编辑补丁，应用后晋升新版本。
  async function refineWorkspaceSkills(analysis: SkillCurationAnalysis): Promise<number> {
    if (!options.refine || analysis.activeSkills.length === 0) {
      return 0;
    }
    const response = await options.refine(analysis);
    const byKey = new Map(analysis.activeSkills.map((skill) => [skill.skillKey, skill]));
    const refinedKeys = new Set<string>();
    let refined = 0;
    for (const patch of response.patches) {
      if (refined >= TEAM_SKILL_MAX_REFINES_PER_CURATION) {
        break; // 限制每夜「改」的爆炸半径（与 K3 的「增」预算并列）。
      }
      const active = byKey.get(patch.skill_key);
      if (!active) {
        continue; // 只精修当前激活技能（防 LLM 凭空造 key）。
      }
      if (refinedKeys.has(patch.skill_key)) {
        // 一个技能一夜只精修一次：否则同 key 的第二个补丁会对着已被取代的旧底稿再 promote，双重 churn。
        continue;
      }
      const validation = validateSkillEditPatch(patch, {
        activeVersion: active.version,
        currentContentMd: active.contentMd
      });
      if (!validation.ok) {
        await options.auditLog.createAuditLog({
          workspaceId: analysis.workspaceId,
          actorKind: "ai",
          actorNickname: "skill-curator",
          entityType: "team_skill",
          entityId: patch.skill_key,
          action: "team_skill.refine_discarded",
          detailJson: { skill_key: patch.skill_key, base_version: patch.base_version, reason: validation.reason }
        });
        continue;
      }
      const appliedOps = validation.appliedOps.filter((entry) => entry.status === "applied").map((entry) => entry.op);
      const row = await options.repository.promote({
        workspaceId: analysis.workspaceId,
        skillKey: active.skillKey,
        name: active.name,
        // 受限补丁只改正文段落；name/when_to_use 维持不变（精修≠改身份）。
        whenToUse: active.whenToUse,
        contentMd: validation.contentMd,
        confidenceScore: patch.confidence_score,
        sampleCount: 0,
        samplesJson: {
          refined_from_version: active.version,
          ops: appliedOps,
          rationale_md: patch.rationale_md
        }
      });
      refined += 1;
      refinedKeys.add(active.skillKey);
      await options.auditLog.createAuditLog({
        workspaceId: analysis.workspaceId,
        actorKind: "ai",
        actorNickname: "skill-curator",
        entityType: "team_skill",
        entityId: row.id,
        action: "team_skill.refined_via_patch",
        detailJson: {
          skill_key: active.skillKey,
          from_version: active.version,
          to_version: row.version,
          op_count: appliedOps.length,
          rationale_md: patch.rationale_md
        }
      });
    }
    return refined;
  }

  async function curateWorkspace(
    workspaceId: string
  ): Promise<{ promoted: number; discarded: number; deferred: number; refined: number }> {
    let promoted = 0;
    let discarded = 0;
    let deferred = 0;
    let refined = 0;

    const analysis = await options.analyze(workspaceId);
    if (!hasCurationSignal(analysis)) {
      return { promoted, discarded, deferred, refined };
    }

    const distilled = await options.distill(analysis);
    // K3：本夜 edit-budget = 学习率退火（活跃技能库越满，新增上限越小，到硬上限归零）。
    const budget = editBudgetForTick(analysis.activeTeamSkillCount);
    // 按 confidence 降序——预算紧张时优先晋升把握最大的，其余合格候选推迟而非丢弃。
    const ranked = [...distilled.distilled_skills].sort((a, b) => b.confidence_score - a.confidence_score);
    // L#49：把本批已晋升的 key 也算进"已有"，否则同一批里两个同 key 技能都能通过去重检查、双双晋升。
    const promotedKeysThisBatch: string[] = [];
    for (const skill of ranked) {
      const validation = validateDistilledSkill(skill, {
        existingSkills: [...analysis.existingSkills, ...promotedKeysThisBatch]
      });
      if (!validation.ok) {
        discarded += 1;
        await options.auditLog.createAuditLog({
          workspaceId,
          actorKind: "ai",
          actorNickname: "skill-curator",
          entityType: "team_skill",
          entityId: skill.skill_key,
          action: "team_skill.distilled_but_discarded",
          detailJson: { skill_key: skill.skill_key, reason: validation.reason, confidence: skill.confidence_score }
        });
        continue;
      }
      if (promoted >= budget) {
        // K3：合格但本夜预算已用尽 → 推迟（独立审计动作，不进 K1 的「勿再重提」记忆，下夜可再来）。
        deferred += 1;
        await options.auditLog.createAuditLog({
          workspaceId,
          actorKind: "ai",
          actorNickname: "skill-curator",
          entityType: "team_skill",
          entityId: skill.skill_key,
          action: "team_skill.deferred_over_budget",
          detailJson: { skill_key: skill.skill_key, confidence: skill.confidence_score, edit_budget: budget }
        });
        continue;
      }
      const row = await options.repository.promote({
        workspaceId,
        skillKey: skill.skill_key,
        name: skill.name,
        whenToUse: skill.when_to_use,
        contentMd: skill.content_md,
        confidenceScore: skill.confidence_score,
        sampleCount: skill.sample_count,
        samplesJson: {
          accepted: analysis.totalAccepted,
          escalations: analysis.escalations.length
        }
      });
      promoted += 1;
      promotedKeysThisBatch.push(skill.skill_key);
      await options.auditLog.createAuditLog({
        workspaceId,
        actorKind: "ai",
        actorNickname: "skill-curator",
        entityType: "team_skill",
        entityId: row.id,
        action: "team_skill.distilled_and_promoted",
        detailJson: {
          skill_key: skill.skill_key,
          version: row.version,
          confidence: skill.confidence_score,
          sample_count: skill.sample_count
        }
      });
    }

    // K2：新增之后跑「精修」——对激活技能打受限编辑补丁（best-effort，失败不连累新增结果）。
    try {
      refined = await refineWorkspaceSkills(analysis);
    } catch (error) {
      console.warn(
        "WorkHub skill curation: refine pass failed",
        workspaceId,
        error instanceof Error ? error.message : String(error)
      );
    }

    return { promoted, discarded, deferred, refined };
  }

  async function tick(): Promise<SkillCurationTickResult> {
    const startedAt = now();
    if (running) {
      return {
        workspaces: 0,
        promoted: 0,
        discarded: 0,
        deferred: 0,
        refined: 0,
        started_at: startedAt.toISOString(),
        finished_at: startedAt.toISOString()
      };
    }
    running = true;
    let workspaceCount = 0;
    let promoted = 0;
    let discarded = 0;
    let deferred = 0;
    let refined = 0;
    try {
      const idle = await workQueueIsIdle();
      if (!idle) {
        return {
          workspaces: 0,
          promoted: 0,
          discarded: 0,
          deferred: 0,
          refined: 0,
          started_at: startedAt.toISOString(),
          finished_at: now().toISOString()
        };
      }
      const workspaces = await options.listWorkspaces();
      for (const workspace of workspaces) {
        try {
          const result = await curateWorkspace(workspace.id);
          workspaceCount += 1;
          promoted += result.promoted;
          discarded += result.discarded;
          deferred += result.deferred;
          refined += result.refined;
        } catch (error) {
          // 单工作空间失败不连累其余（蒸馏是尽力而为）。
          console.warn(
            "WorkHub skill curation: workspace failed",
            workspace.id,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
      const finishedAt = now();
      tickCount += 1;
      promotedCount += promoted;
      discardedCount += discarded;
      deferredCount += deferred;
      refinedCount += refined;
      lastTickAt = finishedAt.toISOString();
      return {
        workspaces: workspaceCount,
        promoted,
        discarded,
        deferred,
        refined,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString()
      };
    } catch (error) {
      errorCount += 1;
      lastErrorMessage = error instanceof Error ? error.message : String(error);
      options.onError?.(error);
      throw error;
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer || intervalMs <= 0) {
      return;
    }
    timer = setInterval(() => {
      void tick().catch((error) => {
        console.warn("WorkHub skill curation tick failed", error);
      });
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) {
      return;
    }
    clearInterval(timer);
    timer = undefined;
  }

  return {
    tick,
    start,
    stop,
    stats: () => ({
      running,
      tick_count: tickCount,
      promoted_count: promotedCount,
      discarded_count: discardedCount,
      deferred_count: deferredCount,
      refined_count: refinedCount,
      error_count: errorCount,
      ...(lastTickAt ? { last_tick_at: lastTickAt } : {}),
      ...(lastErrorMessage ? { last_error_message: lastErrorMessage } : {})
    })
  };
}

function extractText(content: unknown[]): string {
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
    )
    .map((block) => block.text)
    .join("\n");
}

let defaultScheduler: AgentRunSkillCurationScheduler | undefined;
let defaultDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultAgentRunSkillCurationScheduler(): AgentRunSkillCurationScheduler {
  if (defaultScheduler) {
    return defaultScheduler;
  }
  defaultDbClient = defaultDbClient ?? getSharedDatabaseClient();
  const db = defaultDbClient.db;
  const repository = createTeamSkillRepository(db);
  const auditStores = getDefaultAuditStores();
  const presetSkillKeys = listSkills().map((skill) => skill.id);
  const providerRegistry = getDefaultProviderRegistry();

  defaultScheduler = createAgentRunSkillCurationScheduler({
    repository,
    auditLog: auditStores.auditLogs,
    intervalMs: settings.agentRun.skillCurationIntervalMs,
    // L#46：worker 队列还有排队/执行中的 run 时，技能蒸馏先让路（idle = listActive 为空）。
    workQueueIsIdle: async () => (await getDefaultAgentRunQueue().listActive()).length === 0,
    listWorkspaces: async () => (await repository.listActiveWorkspaceIds()).map((id) => ({ id })),
    analyze: async (workspaceId) => {
      const since = new Date(Date.now() - SEVEN_DAYS_MS);
      const [acceptedDeliverables, escalations, activeRows, discardedSkills] = await Promise.all([
        repository.acceptedDeliverableSignals(workspaceId, since),
        repository.escalationSignals(workspaceId, since),
        repository.listActive(workspaceId),
        repository.discardedSkillSignals(workspaceId, since)
      ]);
      const activeKeys = activeRows.map((row) => row.skillKey);
      return {
        workspaceId,
        acceptedDeliverables,
        escalations,
        existingSkills: [...presetSkillKeys, ...activeKeys],
        discardedSkills,
        // K3：edit-budget 只按「团队」活跃技能数退火（预设技能固定，不算进演进库）。
        activeTeamSkillCount: activeKeys.length,
        // K2：把激活技能正文喂回，供精修打受限补丁。
        activeSkills: activeRows.map((row) => ({
          skillKey: row.skillKey,
          name: row.name,
          whenToUse: row.whenToUse,
          version: row.version,
          contentMd: row.contentMd
        })),
        totalAccepted: acceptedDeliverables.reduce((sum, row) => sum + row.count, 0)
      };
    },
    distill: async (analysis) => {
      const client = providerRegistry.get({ id: "skill-curator", label: "skill-curator" }, "assistant");
      const response = await client.messages.create({
        maxTokens: 4000,
        // K5：技能蒸馏花费记为 "curation"（自进化），成本面板与「干活」分账。
        source: "curation",
        system: buildCurationSystemPrompt(),
        messages: [{ role: "user", content: buildCurationPrompt(analysis) }]
      });
      return parseDistilledResponse(extractText(response.content));
    },
    // K2：精修步——给激活技能要受限编辑补丁（同样记为 "curation" 自进化花费）。
    refine: async (analysis) => {
      const client = providerRegistry.get({ id: "skill-curator", label: "skill-curator" }, "assistant");
      const response = await client.messages.create({
        maxTokens: 4000,
        source: "curation",
        system: buildRefinementSystemPrompt(),
        messages: [{ role: "user", content: buildSkillRefinementPrompt(analysis) }]
      });
      return parseSkillEditPatchResponse(extractText(response.content));
    }
  });
  return defaultScheduler;
}

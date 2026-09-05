import { settings } from "@workhub/config";
import type { ProviderRegistry } from "@workhub/agent/providers";
import {
  getSharedDatabaseClient,
  createTeamSkillRepository,
  createAiFeedbackRepository,
  createFeedbackSubjectExcerptReader,
  type AiFeedbackRepository,
  type AiFeedbackRow,
  type AuditLogRepository,
  type FeedbackSubjectExcerptReader,
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

import { getDefaultStructuredLogger } from "../logging.js";
import { getDefaultObjectiveService } from "../services/objectives.js";
import { getDefaultAuditStores } from "../services/audit-stores.js";
import { getDefaultProviderRegistry } from "../services/provider-registry.js";
import { getDefaultAgentRunQueue } from "./agent-runner.js";
import { getDefaultCostLedgerStore } from "../services/cost-ledger-store.js";
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
  type AiFeedbackNegativeSample,
  type SkillCurationAnalysis
} from "../services/skill-curation.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

// R14 批 FEEDBACK · W-B：反例池取样上限——比 K1 的 discard 记忆（12）略宽，新信号源起步多给曝光而非
// 一开始就掐紧（见 04-feedback-design.md §6.1）。样本再逐条按 FEEDBACK_EXCERPT_CHARS 截断，双重有界
// 防 curation prompt 膨胀。
const NEGATIVE_FEEDBACK_SAMPLE_LIMIT = 20;
// 单条差评摘要的字符上限——够 curator 认出「是哪类产出」即可，不需要整段正文（比 K2 精修的 1600
// 预览上限短得多，因为反例是「多条并列」的证据而非「单篇精修底稿」）。
const FEEDBACK_EXCERPT_CHARS = 200;
// 主体正文缺失/墓碑时的占位（Cuu 消息理论上不会被删，此为防御性判断，见设计 §6.1）。
const FEEDBACK_EXCERPT_UNAVAILABLE = "（内容不可用）";

function truncateFeedbackExcerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > FEEDBACK_EXCERPT_CHARS ? `${trimmed.slice(0, FEEDBACK_EXCERPT_CHARS)}…` : trimmed;
}

function excerptForNegativeSample(
  sample: AiFeedbackRow,
  lookups: {
    messageTexts: Map<string, string | null>;
    proposalTitles: Map<string, string>;
    itemTitles: Map<string, string>;
  }
): string {
  let raw: string | null | undefined;
  if (sample.subjectType === "conversation_message") {
    raw = lookups.messageTexts.get(sample.subjectId); // null=墓碑/无 text
  } else if (sample.subjectType === "proposal") {
    raw = lookups.proposalTitles.get(sample.subjectId);
  } else {
    raw = lookups.itemTitles.get(sample.subjectId);
  }
  if (raw == null || raw.trim().length === 0) {
    return FEEDBACK_EXCERPT_UNAVAILABLE;
  }
  return truncateFeedbackExcerpt(raw);
}

// R14 批 FEEDBACK · W-B：把差评样本拼成「逐条人话摘要」——先按 workspace 取近窗（updated_at ≥ since，
// 改判即重新计入本轮）的 not_useful 样本，再按 subjectType 分三组、各一条 IN 批量取正文（禁 N+1，
// O(3) 查询而非 O(N)），最后按 negativeSamplesSince 已排好的 updated_at 顺序逐条映射成
// {subjectType, excerpt, note}。纯函数、可单测：DB 依赖（样本查询 + 三组正文查询）全部注入。
export async function negativeFeedbackWithExcerpts(
  deps: {
    feedback: Pick<AiFeedbackRepository, "negativeSamplesSince">;
    excerpts: FeedbackSubjectExcerptReader;
  },
  workspaceId: string,
  since: Date,
  limit: number = NEGATIVE_FEEDBACK_SAMPLE_LIMIT
): Promise<AiFeedbackNegativeSample[]> {
  const samples = await deps.feedback.negativeSamplesSince(workspaceId, since, limit);
  if (samples.length === 0) {
    return [];
  }
  const messageIds: string[] = [];
  const proposalIds: string[] = [];
  const itemIds: string[] = [];
  for (const sample of samples) {
    if (sample.subjectType === "conversation_message") {
      messageIds.push(sample.subjectId);
    } else if (sample.subjectType === "proposal") {
      proposalIds.push(sample.subjectId);
    } else {
      itemIds.push(sample.subjectId);
    }
  }
  const [messageTexts, proposalTitles, itemTitles] = await Promise.all([
    deps.excerpts.conversationMessageTexts(messageIds),
    deps.excerpts.proposalTitles(proposalIds),
    deps.excerpts.actionCardItemTitles(itemIds)
  ]);
  return samples.map((sample) => ({
    subjectType: sample.subjectType,
    excerpt: excerptForNegativeSample(sample, { messageTexts, proposalTitles, itemTitles }),
    note: sample.note
  }));
}

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
  // M13：本轮 curation 是否还在花费预算内。返回 false 则整轮跳过 distill/refine（不烧 token）。
  // 默认（未提供）视为始终允许，保持向后兼容。
  curationBudgetOk?: () => Promise<boolean>;
  // B-R9.5-1：夜间聚合顺带刷新工作区活跃 objective 进度；false=测试显式拔掉。
  refreshObjectives?: ((workspaceId: string) => Promise<number>) | false;
  now?: () => Date;
  onError?: (error: unknown) => void;
};

export function createAgentRunSkillCurationScheduler(
  options: SkillCurationSchedulerOptions
): AgentRunSkillCurationScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  const workQueueIsIdle = options.workQueueIsIdle ?? (async () => true);
  const curationBudgetOk = options.curationBudgetOk ?? (async () => true);
  // B-R9.5-1：夜间聚合顺带刷新各工作区活跃 objective 的进度（refreshObjectiveProgress
  // 此前没有任何调用方）。失败只告警，不打断技能 curation 主流程。
  const refreshObjectives = options.refreshObjectives === false
    ? undefined
    : options.refreshObjectives ?? (async (workspaceId: string) => getDefaultObjectiveService().refreshWorkspaceObjectives(workspaceId));

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

  async function auditSkillCurationAction(input: Parameters<typeof options.auditLog.createAuditLog>[0]) {
    try {
      await options.auditLog.createAuditLog(input);
    } catch (error) {
      getDefaultStructuredLogger().warn("skill_curation_audit_write_failed", {
        action: input.action,
        entityId: input.entityId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

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
        await auditSkillCurationAction({
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
      await auditSkillCurationAction({
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
        await auditSkillCurationAction({
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
        await auditSkillCurationAction({
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
      await auditSkillCurationAction({
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
      getDefaultStructuredLogger().warn("skill_curation_refine_failed", {
        workspaceId,
        error: error instanceof Error ? error.message : String(error)
      });
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
      // M13：curation 花费 gate——当日 curation 预算耗尽则整轮跳过，避免夜间无条件烧 token。
      const budgetOk = await curationBudgetOk();
      if (!budgetOk) {
        getDefaultStructuredLogger().warn("skill_curation_budget_exhausted_skip", {});
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
          if (refreshObjectives) {
            try {
              await refreshObjectives(workspace.id);
            } catch (error) {
              getDefaultStructuredLogger().warn("objective_progress_refresh_failed", { workspaceId: workspace.id, error });
            }
          }
          workspaceCount += 1;
          promoted += result.promoted;
          discarded += result.discarded;
          deferred += result.deferred;
          refined += result.refined;
        } catch (error) {
          // 单工作空间失败不连累其余（蒸馏是尽力而为）。
          getDefaultStructuredLogger().warn("skill_curation_workspace_failed", {
            workspaceId: workspace.id,
            error: error instanceof Error ? error.message : String(error)
          });
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
        getDefaultStructuredLogger().error("skill_curation_tick_failed", { error });
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

function skillCuratorActor(workspaceId: string) {
  return { id: "skill-curator", label: "skill-curator", workspaceId };
}

export function createSkillCurationProviderAdapters(providerRegistry: Pick<ProviderRegistry, "get">) {
  return {
    distill: async (analysis: SkillCurationAnalysis) => {
      const client = providerRegistry.get(skillCuratorActor(analysis.workspaceId), "assistant");
      const response = await client.messages.create({
        maxTokens: 4000,
        // K5：技能蒸馏花费记为 "curation"（自进化），成本面板与「干活」分账。
        source: "curation",
        system: buildCurationSystemPrompt(),
        messages: [{ role: "user", content: buildCurationPrompt(analysis) }]
      });
      return parseDistilledResponse(extractText(response.content));
    },
    refine: async (analysis: SkillCurationAnalysis) => {
      const client = providerRegistry.get(skillCuratorActor(analysis.workspaceId), "assistant");
      const response = await client.messages.create({
        maxTokens: 4000,
        source: "curation",
        system: buildRefinementSystemPrompt(),
        messages: [{ role: "user", content: buildSkillRefinementPrompt(analysis) }]
      });
      return parseSkillEditPatchResponse(extractText(response.content));
    }
  };
}

let defaultScheduler: AgentRunSkillCurationScheduler | undefined;
let defaultDbClient: WorkHubDatabaseClient | undefined;

// R23 SA-06：「今晚到底会不会跑」的唯一判定——三处共用（server.ts 启停、技能页 VM、管理员手动
// 触发端点），避免三份各自为政的口径。开关默认已翻成 true（见 config env.ts），所以这里必须把
// 「没配 LLM 密钥」也算作没启用：否则无 key 的自托管每夜都会对每个工作区白跑一遍 analyze 查询、
// 再被 providerRegistry.get() 的 fail-fast 打回，只刷警告不产出。
export type SkillCurationAvailability =
  | { enabled: true }
  | { enabled: false; reason: "disabled_by_setting" | "llm_provider_not_configured" };

export function skillCurationAvailability(
  deps: {
    enabledSetting?: boolean;
    providerRegistry?: Pick<ProviderRegistry, "isConfigured">;
  } = {}
): SkillCurationAvailability {
  const enabledSetting = deps.enabledSetting ?? settings.agentRun.skillCurationEnabled;
  if (!enabledSetting) {
    return { enabled: false, reason: "disabled_by_setting" };
  }
  const providerRegistry = deps.providerRegistry ?? getDefaultProviderRegistry();
  if (!providerRegistry.isConfigured()) {
    return { enabled: false, reason: "llm_provider_not_configured" };
  }
  return { enabled: true };
}

// 只「看一眼」本进程调度器的运行状态，绝不顺手把默认调度器建出来——技能页每次渲染都会读它，
// 而建单例会连带拉起 DB client / provider registry / 预设技能读盘。没建过 = 本进程没跑过：
// running=false、lastRunAt=null 是诚实答案（时间戳只活在进程内存里，重启后归 null，不拿审计
// 日志里「上次学到新技能的时间」冒充「上次跑过的时间」）。
export function peekSkillCurationRunState(): { running: boolean; lastRunAt: string | null } {
  if (!defaultScheduler) {
    return { running: false, lastRunAt: null };
  }
  const stats = defaultScheduler.stats();
  return { running: stats.running, lastRunAt: stats.last_tick_at ?? null };
}

// R23 SA-06：管理员手动触发一轮自学要用到的最小接口（服务层只认这三件事，测试可整体替身）。
export type SkillCurationManualRunner = {
  availability: () => SkillCurationAvailability;
  runState: () => { running: boolean; lastRunAt: string | null };
  // 调用即同步进入 tick（tick 开头同步置 running=true），调用方据此实现「进行中 → 409」防抖。
  runOnce: () => Promise<SkillCurationTickResult>;
};

export function getDefaultSkillCurationManualRunner(): SkillCurationManualRunner {
  return {
    availability: () => skillCurationAvailability(),
    runState: () => peekSkillCurationRunState(),
    runOnce: () => getDefaultAgentRunSkillCurationScheduler().tick()
  };
}

export function getDefaultAgentRunSkillCurationScheduler(): AgentRunSkillCurationScheduler {
  if (defaultScheduler) {
    return defaultScheduler;
  }
  defaultDbClient = defaultDbClient ?? getSharedDatabaseClient();
  const db = defaultDbClient.db;
  const repository = createTeamSkillRepository(db);
  // R14 批 FEEDBACK · W-B：夜间 curation 消费人类反馈——差评样本仓库 + 三张主体表的正文摘要 reader。
  const feedbackRepo = createAiFeedbackRepository(db);
  const feedbackExcerpts = createFeedbackSubjectExcerptReader(db);
  const auditStores = getDefaultAuditStores();
  const presetSkillKeys = listSkills().map((skill) => skill.id);
  const providerRegistry = getDefaultProviderRegistry();
  const providerAdapters = createSkillCurationProviderAdapters(providerRegistry);

  defaultScheduler = createAgentRunSkillCurationScheduler({
    repository,
    auditLog: auditStores.auditLogs,
    intervalMs: settings.agentRun.skillCurationIntervalMs,
    // L#46：worker 队列还有排队/执行中的 run 时，技能蒸馏先让路（idle = listActive 为空）。
    workQueueIsIdle: async () => (await getDefaultAgentRunQueue().listActive()).length === 0,
    // M13：当日 curation 花费(source=curation 的 usage 记录)超过日上限即整轮跳过，防 interval 配错/跑飞烧钱。
    // findings[#164]：curation usage 确实会进 cost_ledger_entries，但落在独立的 curation scope(见
    // scopesForUsage)，刻意与团队生产预算隔离、不会吃掉生产额度。这里的当日上限是 curation 专属的
    // 独立闸门，按原始 usage_records(listRecords) 的 source=curation 过滤即可，与 scope/预算策略解耦。
    curationBudgetOk: async () => {
      const capCny = Number(settings.budgets.curationDailyCostCny);
      const ledgerStore = getDefaultCostLedgerStore();
      if (!Number.isFinite(capCny) || capCny <= 0) {
        return true;
      }
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      // R4 #26：优先用 SQL 聚合（走 created_at 索引、只回一个累计值），避免每个 tick 把整张 usage_records
      // 拉回内存过滤求和（随时间无界增长）。假仓库/旧实现无聚合方法时回退到 listRecords。
      if (ledgerStore.sumUsageCostSince) {
        const spent = Number(await ledgerStore.sumUsageCostSince({ source: "curation", since: startOfDay }));
        return !Number.isFinite(spent) || spent < capCny;
      }
      if (!ledgerStore.listRecords) {
        return true;
      }
      const records = await ledgerStore.listRecords();
      const spent = records
        .filter((record) => record.source === "curation" && new Date(record.createdAt) >= startOfDay)
        .reduce((sum, record) => sum + Number(record.estimatedCostCny || 0), 0);
      return spent < capCny;
    },
    listWorkspaces: async () => (await repository.listActiveWorkspaceIds()).map((id) => ({ id })),
    analyze: async (workspaceId) => {
      const since = new Date(Date.now() - SEVEN_DAYS_MS);
      const [acceptedDeliverables, escalations, activeRows, discardedSkills, negativeFeedback, positiveFeedback] =
        await Promise.all([
          repository.acceptedDeliverableSignals(workspaceId, since),
          repository.escalationSignals(workspaceId, since),
          repository.listActive(workspaceId),
          repository.discardedSkillSignals(workspaceId, since),
          // R14 批 FEEDBACK · W-B：差评样本（带逐条摘要）+ 好评聚合计数，与既有四条信号并行拉。
          negativeFeedbackWithExcerpts({ feedback: feedbackRepo, excerpts: feedbackExcerpts }, workspaceId, since),
          feedbackRepo.positiveCountsSince(workspaceId, since)
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
        totalAccepted: acceptedDeliverables.reduce((sum, row) => sum + row.count, 0),
        // R14 批 FEEDBACK · W-B：反例池 + 好评强化信号（进 buildCurationPrompt 的两个新小节，
        // 蒸馏调用本身已记 source:"curation"，无新增记账路径，见设计 §6/结论 4）。
        negativeFeedback,
        positiveFeedback
      };
    },
    distill: providerAdapters.distill,
    // K2：精修步——给激活技能要受限编辑补丁（同样记为 "curation" 自进化花费）。
    refine: providerAdapters.refine
  });
  return defaultScheduler;
}

import { evaluateAgentRunConfidence, type AgentLoopResult } from "@workhub/agent";
import { settings as runtimeSettings, type Settings } from "@workhub/config";
import { DEFAULT_USER_AI_PROFILE, type AiMode, type ConfidenceVerdict, type WorkItemStatus } from "@workhub/contracts";
import {
  createAiDecisionRepository,
  createAiSettingsRepository,
  createAuditLogRepository,
  createWorkItemRepository,
  getSharedDatabaseClient,
  type AiDecisionRepository,
  type AiSettingsRepository,
  type AuditLogRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";

import { getDefaultStructuredLogger } from "../logging.js";
import type { AgentRunQueueRecord } from "../workers/agent-runner.js";

// R12 批 4b：模式五档第 5 档「全托管 · AI 审」接现有 auto_merge verdict——只读 run 的 assignee
// （actor_id，等同 agent_runs.actor_user_id，见 agent-run-persistence.ts 的映射）当前的
// user_ai_profiles.default_mode，mode===5 才把 autoMergeAllowed 置真；mode<5 一律 false，
// 让下面 evaluateAgentRunConfidence 的 downgradeAutoMerge 把 auto_merge 降级成 human_spotcheck
// （只开提议、不自动合并）。高风险类别的红线由 matrixVerdict（riskLevel==="high"→escalate）与
// human-reserved-guard.ts 的工具调用分级独立把关，不受这里影响——mode===5 从不解锁高风险类别。
export type UserAiModeResolver = (input: {
  workspaceId?: string;
  userId: string;
}) => Promise<AiMode> | AiMode;

let defaultAiSettingsDbClient: WorkHubDatabaseClient | undefined;
let defaultAiSettingsRepository: AiSettingsRepository | undefined;

function getDefaultAiSettingsRepository() {
  if (!defaultAiSettingsRepository) {
    defaultAiSettingsDbClient ??= getSharedDatabaseClient();
    defaultAiSettingsRepository = createAiSettingsRepository(defaultAiSettingsDbClient.db);
  }
  return defaultAiSettingsRepository;
}

// 默认实现：读 ai-settings 仓库（packages/db 既有的 findUserProfileAccessRecord）。没有工作区/没有
// 有效成员资格/没有自定义档位，一律回落 DEFAULT_USER_AI_PROFILE.default_mode（3）——3 档不满足
// mode===5，天然 fail-closed（不确定就不自动合并，只是收紧不是放宽）。
export function createAgentRunUserAiModeResolver(
  deps: { aiSettings?: Pick<AiSettingsRepository, "findUserProfileAccessRecord"> } = {}
): UserAiModeResolver {
  const aiSettings = deps.aiSettings ?? getDefaultAiSettingsRepository();
  return async ({ workspaceId, userId }) => {
    if (!workspaceId) {
      return DEFAULT_USER_AI_PROFILE.default_mode;
    }
    try {
      const access = await aiSettings.findUserProfileAccessRecord({ workspaceId, userId });
      return (access?.profile?.defaultMode as AiMode | undefined) ?? DEFAULT_USER_AI_PROFILE.default_mode;
    } catch (error) {
      getDefaultStructuredLogger().warn("agent_run_confidence_mode_resolve_failed", { error });
      return DEFAULT_USER_AI_PROFILE.default_mode;
    }
  };
}

export type AgentRunConfidenceRecordInput = {
  run: AgentRunQueueRecord;
  result: AgentLoopResult;
  // FIX#5：本次 run 是否会/已开出可审阅的提议（succeeded + manifest + 接了 proposalSink）。
  // 为真时：低置信 escalate 裁决只记升级/注意力事件，绝不把工作项推到 escalated——有提议要审，
  // 终态由唯一写入者 notifyRunMilestone 落到 in_review（杜绝「escalated 工作项上挂着 open 提议」的矛盾）。
  // 不传（旧调用方/单测）→ 视为 false → 保留「escalate 即推 escalated」的旧行为，零影响。
  proposalWillOpen?: boolean;
};

export type AgentRunConfidenceRecorder = (input: AgentRunConfidenceRecordInput) => Promise<{
  confidenceId: string;
  escalationId?: string;
  // R12 批 4b：把裁决出的 verdict 透传给调用方（agent-runner.ts）——真正触发「自动合并」这个动作
  // 的决定权仍在裁决点（这里），调用方只据此决定要不要在开完提议后接着调 review+merge。
  verdict: ConfidenceVerdict;
}>;

export type AgentRunConfidenceRecorderOptions = {
  decisions?: AiDecisionRepository;
  auditLogs?: AuditLogRepository;
  settings?: Settings;
  // 显式传入时是硬覆盖（测试/未来的组织级开关用），不咨询 modeResolver；不传时按 R12 批 4b 的新规矩，
  // 每次都用 modeResolver 现查 run.actor_id 当前的 default_mode，逐 run 动态判定。
  autoMergeAllowed?: boolean;
  modeResolver?: UserAiModeResolver;
  // findings[H9]：开了升级事件就把工作项 ai_working→escalated（CAS 守卫在仓库层，非法前驱则 no-op）；
  // 让 escalated 死枚举真正活起来。不传则用默认 work-item 仓库；fire-and-forget 不拖垮记账。
  transitionWorkItemStatus?: (input: { workItemId: string; to: WorkItemStatus; at: Date }) => Promise<void>;
};

let defaultDbClient: WorkHubDatabaseClient | undefined;

function defaultStores() {
  defaultDbClient ??= getSharedDatabaseClient();
  return {
    decisions: createAiDecisionRepository(defaultDbClient.db),
    auditLogs: createAuditLogRepository(defaultDbClient.db)
  };
}

let defaultConfidenceStatusWriter: ((input: { workItemId: string; to: WorkItemStatus; at: Date }) => Promise<void>) | undefined;

function getDefaultConfidenceStatusWriter() {
  if (!defaultConfidenceStatusWriter) {
    defaultDbClient ??= getSharedDatabaseClient();
    const repo = createWorkItemRepository(defaultDbClient.db);
    defaultConfidenceStatusWriter = async (input) => {
      await repo.transitionWorkItemStatus(input);
    };
  }
  return defaultConfidenceStatusWriter;
}

function actorOrg(settings: Settings) {
  return {
    orgId: settings.auth.defaultOrgId,
    workspaceId: settings.auth.defaultWorkspaceId
  };
}

async function auditConfidenceAction(
  auditLogs: AuditLogRepository,
  input: Parameters<AuditLogRepository["createAuditLog"]>[0]
) {
  try {
    await auditLogs.createAuditLog(input);
  } catch (error) {
    getDefaultStructuredLogger().warn("agent_run_confidence_audit_write_failed", {
      action: input.action,
      entityId: input.entityId,
      error
    });
  }
}

export function createAgentRunConfidenceRecorder(
  options: AgentRunConfidenceRecorderOptions = {}
): AgentRunConfidenceRecorder {
  const settings = options.settings ?? runtimeSettings;
  const stores = options.decisions && options.auditLogs ? options : defaultStores();
  const decisions = stores.decisions;
  const auditLogs = stores.auditLogs;

  if (!decisions || !auditLogs) {
    throw new Error("AgentRun confidence recorder requires decision and audit stores");
  }

  const transitionWorkItemStatus = options.transitionWorkItemStatus ?? getDefaultConfidenceStatusWriter();
  const resolveMode = options.modeResolver ?? createAgentRunUserAiModeResolver();

  return async ({ run, result, proposalWillOpen }) => {
    // R12 批 4b：`options.autoMergeAllowed` 显式传入时是硬覆盖（组织级开关/测试专用），跳过逐 run
    // 查 mode。不传时按新规矩：每个 run 现查它的 assignee（run.actor_id）此刻的
    // user_ai_profiles.default_mode，只有 mode===5 才把 autoMergeAllowed 置真——mode<5 时即便
    // 评审给了 grade5，也只落到 human_spotcheck（只开提议，不自动合并）。resolveMode 内部已经
    // fail-closed（查不到/出错都回落默认档 3），这里再兜一层 try/catch 防注入的自定义 resolver 抛错。
    let autoMergeAllowed = options.autoMergeAllowed;
    if (autoMergeAllowed === undefined) {
      try {
        const mode = await resolveMode({
          ...(run.workspace_id ? { workspaceId: run.workspace_id } : {}),
          userId: run.actor_id
        });
        autoMergeAllowed = mode === 5;
      } catch (error) {
        getDefaultStructuredLogger().warn("agent_run_confidence_mode_resolve_failed", { error });
        autoMergeAllowed = false;
      }
    }
    const assessment = evaluateAgentRunConfidence({
      runId: run.run_id,
      workItemId: run.work_item_id,
      model: run.budget_decision.model_route.model,
      result,
      autoMergeAllowed
    });
    const tenant = actorOrg(settings);
    const confidence = await decisions.createConfidenceRecord({
      workItemId: run.work_item_id,
      agentRunId: run.run_id,
      confidenceScore: assessment.confidenceScore,
      riskScore: assessment.riskScore,
      grade: assessment.grade,
      riskLevel: assessment.riskLevel,
      verdict: assessment.verdict,
      signalsJson: assessment.signalsJson,
      rationaleMd: assessment.rationaleMd
    });

    await auditConfidenceAction(auditLogs, {
      ...tenant,
      actorKind: "ai",
      actorNickname: "AI 工人",
      entityType: "work_item",
      entityId: run.work_item_id,
      action: "confidence.scored",
      detailJson: {
        run_id: run.run_id,
        confidence_id: confidence.id,
        grade: confidence.grade,
        risk_level: confidence.riskLevel,
        verdict: confidence.verdict,
        rationale_preview: assessment.rationaleMd.slice(0, 160)
      }
    });

    if (!assessment.escalation) {
      return { confidenceId: confidence.id, verdict: assessment.verdict };
    }

    const escalation = await decisions.createEscalationEvent({
      workItemId: run.work_item_id,
      agentRunId: run.run_id,
      confidenceId: confidence.id,
      trigger: assessment.escalation.trigger,
      reasonMd: assessment.escalation.reasonMd,
      handoffJson: assessment.escalation.handoffJson
    });
    await auditConfidenceAction(auditLogs, {
      ...tenant,
      actorKind: "ai",
      actorNickname: "AI 工人",
      entityType: "work_item",
      entityId: run.work_item_id,
      action: "escalation.opened",
      detailJson: {
        run_id: run.run_id,
        confidence_id: confidence.id,
        escalation_id: escalation.id,
        trigger: escalation.trigger,
        reason_preview: escalation.reasonMd.slice(0, 160)
      }
    });

    // findings[H9]：升级即把工作项推进 escalated（即便 run 本身 succeeded 但置信度判定 escalate）。
    // CAS 守卫在仓库层；fire-and-forget——状态写失败不影响已落库的置信度/升级记录。
    // FIX#5：但当本次 run 会开出可审阅的提议（proposalWillOpen）时，绝不在此处把工作项推到 escalated。
    // 否则会产生「escalated 工作项上挂着 open 提议」的矛盾，且抢在 notifyRunMilestone 之前改了状态，
    // 让 ai_working→in_review 的 CAS 落空（escalated 非 in_review 合法前驱）→ 工作项卡死 + 里程碑通知被吞。
    // 此时升级/注意力事件已照常落库（attention 队列仍能浮出这条低置信提议），最终状态交由唯一写入者
    // notifyRunMilestone 落到 in_review。escalated 仅保留给「无可审阅交付物」的 run（失败 / 成功但无 manifest）。
    if (!proposalWillOpen) {
      try {
        await transitionWorkItemStatus({ workItemId: run.work_item_id, to: "escalated", at: new Date() });
      } catch (error) {
        getDefaultStructuredLogger().warn("escalation_work_item_transition_failed", { error });
      }
    }

    return { confidenceId: confidence.id, escalationId: escalation.id, verdict: assessment.verdict };
  };
}

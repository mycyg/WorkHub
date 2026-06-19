import { evaluateAgentRunConfidence, type AgentLoopResult } from "@workhub/agent";
import { settings as runtimeSettings, type Settings } from "@workhub/config";
import type { WorkItemStatus } from "@workhub/contracts";
import {
  createAiDecisionRepository,
  createAuditLogRepository,
  createWorkItemRepository,
  getSharedDatabaseClient,
  type AiDecisionRepository,
  type AuditLogRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type { AgentRunQueueRecord } from "../workers/agent-runner.js";

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
}>;

export type AgentRunConfidenceRecorderOptions = {
  decisions?: AiDecisionRepository;
  auditLogs?: AuditLogRepository;
  settings?: Settings;
  autoMergeAllowed?: boolean;
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

  return async ({ run, result, proposalWillOpen }) => {
    const assessment = evaluateAgentRunConfidence({
      runId: run.run_id,
      workItemId: run.work_item_id,
      model: run.budget_decision.model_route.model,
      result,
      ...(options.autoMergeAllowed !== undefined ? { autoMergeAllowed: options.autoMergeAllowed } : {})
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

    await auditLogs.createAuditLog({
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
      return { confidenceId: confidence.id };
    }

    const escalation = await decisions.createEscalationEvent({
      workItemId: run.work_item_id,
      agentRunId: run.run_id,
      confidenceId: confidence.id,
      trigger: assessment.escalation.trigger,
      reasonMd: assessment.escalation.reasonMd,
      handoffJson: assessment.escalation.handoffJson
    });
    await auditLogs.createAuditLog({
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
        console.warn("WorkHub escalation work-item status transition failed", error);
      }
    }

    return { confidenceId: confidence.id, escalationId: escalation.id };
  };
}

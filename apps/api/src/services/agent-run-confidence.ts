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

  return async ({ run, result }) => {
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
    try {
      await transitionWorkItemStatus({ workItemId: run.work_item_id, to: "escalated", at: new Date() });
    } catch (error) {
      console.warn("WorkHub escalation work-item status transition failed", error);
    }

    return { confidenceId: confidence.id, escalationId: escalation.id };
  };
}

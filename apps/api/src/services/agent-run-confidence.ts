import { evaluateAgentRunConfidence, type AgentLoopResult } from "@workhub/agent";
import { settings as runtimeSettings, type Settings } from "@workhub/config";
import {
  createAiDecisionRepository,
  createAuditLogRepository,
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
};

let defaultDbClient: WorkHubDatabaseClient | undefined;

function defaultStores() {
  defaultDbClient ??= getSharedDatabaseClient();
  return {
    decisions: createAiDecisionRepository(defaultDbClient.db),
    auditLogs: createAuditLogRepository(defaultDbClient.db)
  };
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

    return { confidenceId: confidence.id, escalationId: escalation.id };
  };
}

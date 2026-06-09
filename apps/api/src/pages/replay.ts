import { createHash } from "node:crypto";

import type {
  AgentRun,
  AgentRunLiveVM,
  AgentStep,
  AuditLogFact,
  AcceptedDeliverableVM,
  CostSummaryVM,
  EvidenceRef,
  ManifestFacts,
  ReplayMergeCandidateVM,
  ReplayMergeAttemptVM,
  Snapshot,
  StructuredHandoff
} from "@workhub/contracts";
import { buildManifestFacts, type AuditLogFact as InternalAuditLogFact, type SnapshotRef } from "@workhub/audit";
import type { AuditLogRow, MergeAttemptRow, MergeProposalRow, SnapshotRow } from "@workhub/db";

import type { AgentRunQueueRecord } from "../workers/agent-runner.js";

function stableUuid(input: string) {
  const hex = createHash("sha256").update(input).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32)
  ].join("-");
}

function handoffMd(handoff: AgentRunQueueRecord["handoff"]) {
  if (!handoff) {
    return undefined;
  }
  return [
    handoff.done.length ? `已完成: ${handoff.done.join("；")}` : undefined,
    handoff.remaining.length ? `还剩: ${handoff.remaining.join("；")}` : undefined,
    handoff.next_steps.length ? `下一步: ${handoff.next_steps.join("；")}` : undefined,
    handoff.blockers.length ? `阻塞: ${handoff.blockers.join("；")}` : undefined
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function toAgentRunVm(run: AgentRunQueueRecord): AgentRun {
  const latestOutput = run.trace.at(-1)?.output_excerpt;
  const handoffText = handoffMd(run.handoff);
  return {
    id: run.run_id,
    work_item_id: run.work_item_id,
    mode: run.mode,
    actor: "human",
    status: run.status,
    model: run.budget_decision.model_route.model,
    turns_used: run.usage.steps_used,
    max_turns: run.budget.max_steps,
    token_in: run.usage.token_in,
    token_out: run.usage.token_out,
    cost_estimate: run.usage.estimated_cost_cny,
    ...(latestOutput ? { outcome_reason: latestOutput } : {}),
    ...(handoffText ? { handoff_md: handoffText } : {}),
    created_at: run.created_at,
    updated_at: run.updated_at
  };
}

export function toAgentStepVm(runId: string, step: AgentRunQueueRecord["trace"][number]): AgentStep {
  return {
    id: stableUuid(step.id),
    agent_run_id: runId,
    step_no: step.step_no,
    phase: step.phase,
    input_json: {},
    ...(step.output_excerpt ? { output_excerpt: step.output_excerpt } : {}),
    ...(step.control_signal ? { control_signal: step.control_signal } : {}),
    ...(step.snapshot_id ? { snapshot_id: step.snapshot_id } : {}),
    created_at: step.created_at
  };
}

function toStructuredHandoff(handoff: NonNullable<AgentRunQueueRecord["handoff"]>): StructuredHandoff {
  return {
    done: handoff.done,
    remaining: handoff.remaining,
    next_steps: handoff.next_steps,
    blockers: handoff.blockers,
    artifacts: handoff.artifacts,
    budget_hit: handoff.budget_hit as StructuredHandoff["budget_hit"]
  };
}

export function toAgentRunLiveVm(run: AgentRunQueueRecord): AgentRunLiveVM {
  return {
    run: toAgentRunVm(run),
    run_id: run.run_id,
    work_item_id: run.work_item_id,
    title: run.title,
    status: run.status,
    budget: run.budget,
    budget_decision: run.budget_decision,
    usage: run.usage,
    trace: run.trace.map((step) => toAgentStepVm(run.run_id, step)),
    ...(run.handoff ? { handoff: toStructuredHandoff(run.handoff) } : {}),
    stream_href: `/api/push/stream/run/${run.run_id}`,
    replay_href: `/api/agent-runs/${run.run_id}/replay`
  };
}

export function toSnapshotVm(row: SnapshotRow): Snapshot {
  const snapshot: Snapshot = {
    id: row.id,
    work_item_id: row.workItemId,
    kind: row.kind as Snapshot["kind"],
    ref: row.ref,
    created_by_kind: row.createdByKind as Snapshot["created_by_kind"],
    created_at: row.createdAt.toISOString()
  };
  if (row.branchId) {
    snapshot.branch_id = row.branchId;
  }
  if (row.contentSha256) {
    snapshot.content_sha256 = row.contentSha256;
  }
  if (row.revertedAt) {
    snapshot.reverted_at = row.revertedAt.toISOString();
  }
  return snapshot;
}

export function toAuditLogFact(row: AuditLogRow): AuditLogFact {
  const fact: AuditLogFact = {
    id: row.id,
    actor: {
      actor_kind: row.actorKind as AuditLogFact["actor"]["actor_kind"]
    },
    entity: {
      entity_type: row.entityType,
      entity_id: row.entityId
    },
    action: row.action,
    detail_json: row.detailJson,
    created_at: row.createdAt.toISOString()
  };
  if (row.orgId) {
    fact.org_id = row.orgId;
  }
  if (row.workspaceId) {
    fact.workspace_id = row.workspaceId;
  }
  if (row.actorUserId) {
    fact.actor.actor_user_id = row.actorUserId;
  }
  if (row.actorNickname) {
    fact.actor.actor_nickname = row.actorNickname;
  }
  if (row.snapshotId) {
    fact.snapshot_id = row.snapshotId;
  }
  if (row.undoneAt) {
    fact.undone_at = row.undoneAt.toISOString();
  }
  return fact;
}

function toInternalSnapshot(snapshot: Snapshot): SnapshotRef {
  const ref: SnapshotRef = {
    id: snapshot.id,
    workItemId: snapshot.work_item_id,
    kind: snapshot.kind,
    ref: snapshot.ref,
    createdByKind: snapshot.created_by_kind,
    createdAt: snapshot.created_at
  };
  if (snapshot.branch_id) {
    ref.branchId = snapshot.branch_id;
  }
  if (snapshot.content_sha256) {
    ref.contentSha256 = snapshot.content_sha256;
  }
  if (snapshot.reverted_at) {
    ref.revertedAt = snapshot.reverted_at;
  }
  return ref;
}

function toInternalAuditLog(log: AuditLogFact): InternalAuditLogFact {
  const fact: InternalAuditLogFact = {
    id: log.id,
    actor: {
      actorKind: log.actor.actor_kind
    },
    entity: {
      entityType: log.entity.entity_type,
      entityId: log.entity.entity_id
    },
    action: log.action,
    detailJson: log.detail_json,
    createdAt: log.created_at
  };
  if (log.actor.actor_user_id) {
    fact.actor.actorUserId = log.actor.actor_user_id;
  }
  if (log.actor.actor_nickname) {
    fact.actor.actorNickname = log.actor.actor_nickname;
  }
  if (log.snapshot_id) {
    fact.snapshotId = log.snapshot_id;
  }
  if (log.undone_at) {
    fact.undoneAt = log.undone_at;
  }
  return fact;
}

export function buildReplayManifestFacts(input: {
  snapshots: Snapshot[];
  auditLogs: AuditLogFact[];
  sideEffects?: { sideEffect: "none" | "sandbox_file" | "business_write" | "external_effect"; action?: string }[];
}): ManifestFacts {
  return buildManifestFacts({
    snapshots: input.snapshots.map(toInternalSnapshot),
    auditLogs: input.auditLogs.map(toInternalAuditLog),
    ...(input.sideEffects ? { sideEffects: input.sideEffects } : {})
  });
}

export function buildReplayEvidenceRefs(auditLogs: AuditLogFact[]): EvidenceRef[] {
  return auditLogs.map((log) => ({
    id: log.id,
    source_type: "audit_log",
    source_id: log.id,
    title: `${log.action} audit`,
    href: `/api/workitems/${log.entity.entity_id}/audit`
  }));
}

function optionalRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textHunkDecisionVm(value: unknown) {
  const record = optionalRecord(value);
  if (!record) {
    return undefined;
  }
  const hunkIndex = numberValue(record["hunkIndex"]);
  const startLine = numberValue(record["startLine"]);
  const endLine = numberValue(record["endLine"]);
  const decision = record["decision"];
  if (
    hunkIndex === undefined ||
    startLine === undefined ||
    endLine === undefined ||
    (decision !== "keep_current" && decision !== "accept_incoming" && decision !== "ai_fusion")
  ) {
    return undefined;
  }
  const normalizedDecision: "keep_current" | "accept_incoming" | "ai_fusion" = decision;
  return {
    hunk_index: hunkIndex,
    start_line: startLine,
    end_line: endLine,
    decision: normalizedDecision
  };
}

function replayTextHunkAudit(auditLogs: AuditLogRow[]) {
  for (const row of auditLogs) {
    if (row.action !== "proposal.merged") {
      continue;
    }
    const detail = optionalRecord(row.detailJson);
    const rawDecisions = detail?.["text_hunk_decisions"];
    if (!Array.isArray(rawDecisions)) {
      continue;
    }
    const decisions = rawDecisions
      .map(textHunkDecisionVm)
      .filter((decision): decision is NonNullable<ReturnType<typeof textHunkDecisionVm>> => Boolean(decision));
    if (decisions.length === 0) {
      continue;
    }
    return {
      decisions,
      ...(numberValue(detail?.["text_hunk_count"]) !== undefined
        ? { text_hunk_count: numberValue(detail?.["text_hunk_count"]) }
        : {}),
      ...(typeof detail?.["text_hunk_output_sha256"] === "string" && detail["text_hunk_output_sha256"].length === 64
        ? { text_hunk_output_sha256: detail["text_hunk_output_sha256"] }
        : {})
    };
  }
  return undefined;
}

function replayBulkActionAudit(auditLogs: AuditLogRow[]) {
  const orderedRows = [
    ...auditLogs.filter((row) => row.action === "proposal.bulk_action"),
    ...auditLogs.filter((row) => row.action !== "proposal.bulk_action")
  ];
  for (const row of orderedRows) {
    const detail = optionalRecord(row.detailJson);
    const rawBulk = optionalRecord(detail?.["bulk_action"]);
    if (!rawBulk) {
      continue;
    }
    const action = rawBulk?.["action"];
    if (action !== "keep_current" && action !== "accept_incoming") {
      continue;
    }
    const normalizedAction: "keep_current" | "accept_incoming" = action;
    return {
      action: normalizedAction,
      target_keys: stringArray(rawBulk["target_keys"]),
      ...(numberValue(rawBulk["conflict_count"]) !== undefined
        ? { conflict_count: numberValue(rawBulk["conflict_count"]) }
        : {}),
      ...(typeof detail?.["result"] === "string" ? { result: detail["result"] } : {}),
      accepted_incoming_target_keys: stringArray(detail?.["accepted_incoming_target_keys"]),
      resolved_conflict_target_keys: stringArray(detail?.["resolved_conflict_target_keys"]),
      blocked_target_keys: stringArray(detail?.["blocked_target_keys"]),
      audit_id: row.id
    };
  }
  return undefined;
}

function mergeCandidateVms(row: MergeProposalRow): ReplayMergeCandidateVM[] {
  const candidates = Array.isArray(row.candidatesJson) ? row.candidatesJson : [];
  const result: ReplayMergeCandidateVM[] = [];
  for (const candidate of candidates) {
    const record = optionalRecord(candidate);
    if (!record) {
      continue;
    }
    const optionKey = typeof record.option_key === "string" ? record.option_key : undefined;
    if (!optionKey) {
      continue;
    }
    const mergedValue = optionalRecord(record.merged_value);
    const qualityGate = optionalRecord(record.quality_gate);
    result.push({
      option_key: optionKey,
      ...(typeof record.target_kind === "string" ? { target_kind: record.target_kind } : {}),
      ...(typeof record.rationale_md === "string" ? { rationale_md: record.rationale_md } : {}),
      ...(mergedValue ? { merged_value: mergedValue } : {}),
      ...(typeof record.source === "string" ? { source: record.source } : {}),
      ...(qualityGate ? { quality_gate: qualityGate } : {}),
      recommended: row.recommendedOptionKey === optionKey,
      chosen: row.chosenOptionKey === optionKey
    });
  }
  return result;
}

export function toReplayMergeAttemptVm(input: {
  attempt: MergeAttemptRow;
  mergeProposals: MergeProposalRow[];
  auditLogs?: AuditLogRow[];
}): ReplayMergeAttemptVM {
  const attempt = input.attempt;
  const auditLogs = input.auditLogs ?? [];
  const textHunkAudit = replayTextHunkAudit(auditLogs);
  const bulkAction = replayBulkActionAudit(auditLogs);
  return {
    id: attempt.id,
    proposal_id: attempt.proposalId,
    work_item_id: attempt.workItemId,
    ...(attempt.branchId ? { branch_id: attempt.branchId } : {}),
    actor_kind: attempt.actorKind,
    ...(attempt.actorUserId ? { actor_user_id: attempt.actorUserId } : {}),
    result: attempt.result,
    ...(attempt.mergeSnapshotId ? { merge_snapshot_id: attempt.mergeSnapshotId } : {}),
    conflict_count: attempt.conflictCount,
    target_keys: attempt.targetKeys,
    accepted_target_keys: attempt.acceptedTargetKeys,
    conflicts: attempt.conflictsJson,
    decisions: input.mergeProposals.map((proposal) => ({
      id: proposal.id,
      conflict_key: proposal.conflictKey,
      ...(proposal.recommendedOptionKey ? { recommended_option_key: proposal.recommendedOptionKey } : {}),
      ...(proposal.chosenOptionKey ? { chosen_option_key: proposal.chosenOptionKey } : {}),
      ...(proposal.chosenByUserId ? { chosen_by_user_id: proposal.chosenByUserId } : {}),
      ...(proposal.chosenAt ? { chosen_at: proposal.chosenAt.toISOString() } : {}),
      candidates: mergeCandidateVms(proposal)
    })),
    text_hunk_decisions: textHunkAudit?.decisions ?? [],
    ...(textHunkAudit?.text_hunk_count !== undefined ? { text_hunk_count: textHunkAudit.text_hunk_count } : {}),
    ...(textHunkAudit?.text_hunk_output_sha256
      ? { text_hunk_output_sha256: textHunkAudit.text_hunk_output_sha256 }
      : {}),
    ...(bulkAction ? { bulk_action: bulkAction } : {}),
    created_at: attempt.createdAt.toISOString()
  };
}

export function buildReplayCostSummary(run: AgentRunQueueRecord): CostSummaryVM {
  const totalTokens = run.usage.token_in + run.usage.token_out;
  const maxTokens = run.budget.max_tokens;
  const remainingTokens = Math.max(maxTokens - totalTokens, 0);
  const maxCostCny = Number.parseFloat(run.budget.max_cost_cny);
  const usedCostCny = Number.parseFloat(run.usage.estimated_cost_cny);
  const remainingCostCny = Number.isFinite(maxCostCny) && Number.isFinite(usedCostCny)
    ? Math.max(maxCostCny - usedCostCny, 0).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "")
    : "0";
  const usageRatio = maxTokens > 0 ? totalTokens / maxTokens : 0;
  const status = usageRatio >= 1 ? "exhausted" : usageRatio >= 0.95 ? "critical" : usageRatio >= 0.8 ? "warning" : "ok";
  const workitemUsage: CostSummaryVM["scopes"][number] = {
    scope: { kind: "workitem", workitem_id: run.work_item_id },
    scope_label: run.title,
    policy_id: "pcost-workitem-run-v0",
    period: "run",
    period_start: run.created_at,
    period_end: run.updated_at,
    token_in: run.usage.token_in,
    token_out: run.usage.token_out,
    total_tokens: totalTokens,
    max_tokens: maxTokens,
    remaining_tokens: remainingTokens,
    estimated_cost_cny: run.usage.estimated_cost_cny,
    max_cost_cny: run.budget.max_cost_cny,
    remaining_cost_cny: remainingCostCny,
    warning_ratio: usageRatio,
    status
  };
  const userUsage: CostSummaryVM["me"] = {
    ...workitemUsage,
    scope: { kind: "user", user_id: run.actor_id },
    scope_label: "我的当前 AI 执行预算",
    policy_id: "pcost-user-run-summary-v0"
  };

  return {
    me: userUsage,
    scopes: [workitemUsage, userUsage],
    active_notices:
      usageRatio >= 0.8
        ? [
            {
              code: usageRatio >= 1 ? "budget_exhausted" : "budget_warning",
              severity: usageRatio >= 1 ? "critical" : "warning",
              message: usageRatio >= 1 ? "本次 AI 预算已经用完。" : "本次 AI 预算快用完了。",
              scope: workitemUsage.scope,
              usage_ratio: usageRatio,
              recommended_action: usageRatio >= 1 ? "pause" : "downgrade_model",
              options: [
                { id: "open_cost", label: "查看预算", action_href: `/dashboard/cost?workItemId=${run.work_item_id}` }
              ],
              action_href: `/dashboard/cost?workItemId=${run.work_item_id}`
            }
          ]
        : [],
    generated_at: run.updated_at
  };
}

export function buildReplayTracePage(input: {
  run: AgentRunQueueRecord;
  snapshots?: Snapshot[];
  auditLogs?: AuditLogFact[];
  acceptedDeliverables?: AcceptedDeliverableVM[];
  mergeTimeline?: ReplayMergeAttemptVM[];
  manifestFacts?: ManifestFacts;
}) {
  const snapshots = input.snapshots ?? [];
  const auditLogs = input.auditLogs ?? [];
  return {
    run: toAgentRunVm(input.run),
    steps: input.run.trace.map((step) => toAgentStepVm(input.run.run_id, step)),
    evidence_refs: buildReplayEvidenceRefs(auditLogs),
    snapshots,
    audit_logs: auditLogs,
    accepted_deliverables: input.acceptedDeliverables ?? [],
    merge_timeline: input.mergeTimeline ?? [],
    manifest_facts: input.manifestFacts ?? buildReplayManifestFacts({ snapshots, auditLogs }),
    cost: buildReplayCostSummary(input.run)
  };
}

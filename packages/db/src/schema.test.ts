import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { getTableName } from "drizzle-orm";

import { confidenceGrades, escalationTriggers } from "@workhub/contracts";
import {
  acceptedDeliverableChanges,
  agentRuns,
  agentSteps,
  auditLogs,
  budgetPolicies,
  costLedgerEntries,
  mergeAttempts,
  mergeProposals,
  projectDriveItems,
  projectDriveOperations,
  projectDriveVersions,
  proposals,
  usageRecords,
  workHubTables,
  workItems
} from "./index.js";

const F02_TABLE_COUNT = 50;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      yield* walk(absolute);
    } else if (entry.endsWith(".ts")) {
      yield absolute;
    }
  }
}

test("F02 declares the full table graph expected by the plan", () => {
  const tableNames = Object.values(workHubTables).map((table) => getTableName(table) as string).sort();

  assert.equal(tableNames.length, F02_TABLE_COUNT);
  assert.equal(tableNames.includes("work_items"), true);
  assert.equal(tableNames.includes("proposals"), true);
  assert.equal(tableNames.includes("reviews"), true);
  assert.equal(tableNames.includes("audit_logs"), true);
  assert.equal(tableNames.includes("snapshots"), true);
  assert.equal(tableNames.includes("accepted_deliverable_changes"), true);
  assert.equal(tableNames.includes("merge_attempts"), true);
  assert.equal(tableNames.includes("merge_proposals"), true);
  assert.equal(tableNames.includes("approval_requests"), true);
  assert.equal(tableNames.includes("usage_records"), true);
  assert.equal(tableNames.includes("cost_ledger_entries"), true);
  assert.equal(tableNames.includes("budget_policies"), true);
  assert.equal(tableNames.includes("user_memories"), true);
  assert.equal(tableNames.includes("team_skills"), true);
  assert.equal(tableNames.includes("requirements"), false);
  assert.equal(tableNames.includes("revision_requests"), false);
  assert.equal(tableNames.includes("activity_log"), false);
});

test("merge attempts persist conflict decisions for replayable proposal audit", () => {
  assert.equal(getTableName(mergeAttempts), "merge_attempts");
  assert.equal(mergeAttempts.proposalId.name, "proposal_id");
  assert.equal(mergeAttempts.workItemId.name, "work_item_id");
  assert.equal(mergeAttempts.branchId.name, "branch_id");
  assert.equal(mergeAttempts.actorKind.name, "actor_kind");
  assert.equal(mergeAttempts.result.name, "result");
  assert.equal(mergeAttempts.mergeSnapshotId.name, "merge_snapshot_id");
  assert.equal(mergeAttempts.conflictsJson.name, "conflicts_json");
  assert.equal(mergeAttempts.acceptedTargetKeys.name, "accepted_target_keys");
  assert.equal(mergeAttempts.targetKeys.name, "target_keys");
  assert.equal(mergeAttempts.conflictCount.name, "conflict_count");
});

test("merge proposals persist deterministic and future AI conflict candidates", () => {
  assert.equal(getTableName(mergeProposals), "merge_proposals");
  assert.equal(mergeProposals.mergeAttemptId.name, "merge_attempt_id");
  assert.equal(mergeProposals.conflictKey.name, "conflict_key");
  assert.equal(mergeProposals.candidatesJson.name, "candidates_json");
  assert.equal(mergeProposals.recommendedOptionKey.name, "recommended_option_key");
  assert.equal(mergeProposals.chosenOptionKey.name, "chosen_option_key");
  assert.equal(mergeProposals.chosenByUserId.name, "chosen_by_user_id");
  assert.equal(mergeProposals.chosenAt.name, "chosen_at");
});

test("accepted deliverable changes capture merged proposal targets for replay and conflict gates", () => {
  assert.equal(getTableName(acceptedDeliverableChanges), "accepted_deliverable_changes");
  assert.equal(acceptedDeliverableChanges.workItemId.name, "work_item_id");
  assert.equal(acceptedDeliverableChanges.proposalId.name, "proposal_id");
  assert.equal(acceptedDeliverableChanges.targetKey.name, "target_key");
  assert.equal(acceptedDeliverableChanges.driveItemId.name, "drive_item_id");
  assert.equal(acceptedDeliverableChanges.driveVersionId.name, "drive_version_id");
  assert.equal(acceptedDeliverableChanges.sha256Before.name, "sha256_before");
  assert.equal(acceptedDeliverableChanges.sha256After.name, "sha256_after");
  assert.equal(acceptedDeliverableChanges.supersededAt.name, "superseded_at");
});

test("drive tables expose soft-delete, version pointer, and operation log fields", () => {
  assert.equal(projectDriveItems.currentVersionId.name, "current_version_id");
  assert.equal(projectDriveItems.deletedAt.name, "deleted_at");
  assert.equal(projectDriveItems.deletedByUserId.name, "deleted_by_user_id");
  assert.equal(projectDriveVersions.versionNo.name, "version_no");
  assert.equal(projectDriveVersions.storagePath.name, "storage_path");
  assert.equal(projectDriveOperations.opType.name, "op_type");
  assert.equal(projectDriveOperations.payloadJson.name, "payload_json");
  assert.equal(projectDriveOperations.undoneAt.name, "undone_at");
  const activePathMigration = readFileSync(join(process.cwd(), "migrations", "0011_bitter_magneto.sql"), "utf8");
  assert.match(activePathMigration, /project_drive_items_active_path_uq/u);
  assert.match(activePathMigration, /coalesce\("parent_id"/u);
  assert.match(activePathMigration, /deleted_at" is null/u);
});

test("core renamed fields are present on Drizzle table objects", () => {
  assert.equal(getTableName(workItems), "work_items");
  assert.equal(workItems.workspaceId.name, "workspace_id");
  assert.equal(workItems.sourceWorkItemId.name, "source_work_item_id");
  assert.equal(workItems.status.name, "status");
  assert.equal(proposals.diffManifest.name, "diff_manifest");
  assert.equal(auditLogs.undoneAt.name, "undone_at");
});

test("agent run persistence fields support DB-backed replay recovery", () => {
  assert.equal(agentRuns.title.name, "title");
  assert.equal(agentRuns.actorUserId.name, "actor_user_id");
  assert.equal(agentRuns.totalTimeoutS.name, "total_timeout_s");
  assert.equal(agentRuns.maxTokens.name, "max_tokens");
  assert.equal(agentRuns.maxCostCny.name, "max_cost_cny");
  assert.equal(agentRuns.budgetDecisionJson.name, "budget_decision_json");
  assert.equal(agentRuns.workdirRef.name, "workdir_ref");
  assert.equal(agentRuns.handoffJson.name, "handoff_json");
  assert.equal(agentRuns.claimedBy.name, "claimed_by");
  assert.equal(agentRuns.claimedAt.name, "claimed_at");
  assert.equal(agentRuns.heartbeatAt.name, "heartbeat_at");
  assert.equal(agentRuns.leaseExpiresAt.name, "lease_expires_at");
  assert.equal(agentSteps.seq.name, "seq");
});

test("cost ledger persistence fields support P-COST usage recovery", () => {
  assert.equal(usageRecords.id.name, "id");
  assert.equal(usageRecords.runId.name, "run_id");
  assert.equal(usageRecords.workItemId.name, "work_item_id");
  assert.equal(usageRecords.userId.name, "user_id");
  assert.equal(usageRecords.estimatedCostCny.name, "estimated_cost_cny");
  assert.equal(costLedgerEntries.usageRecordId.name, "usage_record_id");
  assert.equal(costLedgerEntries.scopeKind.name, "scope_kind");
  assert.equal(costLedgerEntries.scopeId.name, "scope_id");
  assert.equal(costLedgerEntries.scopeJson.name, "scope_json");
  assert.equal(costLedgerEntries.periodBucket.name, "period_bucket");
});

test("budget policy persistence fields support P-COST overrides and audit", () => {
  assert.equal(getTableName(budgetPolicies), "budget_policies");
  assert.equal(budgetPolicies.id.name, "id");
  assert.equal(budgetPolicies.scopeKind.name, "scope_kind");
  assert.equal(budgetPolicies.period.name, "period");
  assert.equal(budgetPolicies.maxTokens.name, "max_tokens");
  assert.equal(budgetPolicies.maxCostCny.name, "max_cost_cny");
  assert.equal(budgetPolicies.warningRatio.name, "warning_ratio");
  assert.equal(budgetPolicies.criticalRatio.name, "critical_ratio");
  assert.equal(budgetPolicies.onWarning.name, "on_warning");
  assert.equal(budgetPolicies.onExhausted.name, "on_exhausted");
  assert.equal(budgetPolicies.modelRouteHint.name, "model_route_hint");
  assert.equal(budgetPolicies.enabled.name, "enabled");
  assert.equal(budgetPolicies.version.name, "version");
  assert.equal(budgetPolicies.workspaceId.name, "workspace_id");
  assert.equal(budgetPolicies.updatedByUserId.name, "updated_by_user_id");
});

test("enum drift is closed in the shared contract package", () => {
  assert.deepEqual(confidenceGrades, ["low", "medium", "high"]);
  assert.equal(escalationTriggers.includes("user_unsatisfied"), true);
  assert.equal(escalationTriggers.includes("user_rejected" as never), false);
});

test("schema source does not reintroduce old field/table names", () => {
  const forbidden = ["requirement" + "_id", "requirements" + ".id", "\"requirements\""];
  const sourceRoot = join(process.cwd(), "src");

  for (const file of walk(sourceRoot)) {
    if (file.endsWith(".test.ts")) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.equal(text.includes(pattern), false, `${file} contains ${pattern}`);
    }
  }
});

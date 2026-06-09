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
  costLedgerEntries,
  mergeAttempts,
  proposals,
  usageRecords,
  workHubTables,
  workItems
} from "./index.js";

const F02_TABLE_COUNT = 45;

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
  assert.equal(tableNames.includes("approval_requests"), true);
  assert.equal(tableNames.includes("usage_records"), true);
  assert.equal(tableNames.includes("cost_ledger_entries"), true);
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

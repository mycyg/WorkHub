import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { getTableName } from "drizzle-orm";

import { confidenceGrades, escalationTriggers } from "@workhub/contracts";
import {
  acceptedDeliverableChanges,
  agentMemory,
  agentMemoryVersions,
  agentRuns,
  agentSteps,
  auditLogs,
  budgetPolicies,
  costLedgerEntries,
  mergeAttempts,
  mergeProposals,
  keyResults,
  objectiveWorkItemLinks,
  objectives,
  projectDriveItems,
  projectDriveOperations,
  projectDriveVersions,
  proposals,
  sessions,
  snapshots,
  taskPlanItems,
  taskPlans,
  usageRecords,
  userCredentials,
  users,
  userInvites,
  workHubTables,
  workItems,
  workspaceMemberships
} from "./index.js";

// R9.5.1: the old count (54) was correct before OKR planning lenses existed; this slice
// intentionally adds objectives, key_results, and objective_work_item_links as non-blocking OKR tables.
const F02_TABLE_COUNT = 57;

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
  assert.equal(tableNames.includes("task_plans"), true);
  assert.equal(tableNames.includes("task_plan_items"), true);
  assert.equal(tableNames.includes("agent_memory"), true);
  assert.equal(tableNames.includes("agent_memory_versions"), true);
  assert.equal(tableNames.includes("objectives"), true);
  assert.equal(tableNames.includes("key_results"), true);
  assert.equal(tableNames.includes("objective_work_item_links"), true);
  assert.equal(tableNames.includes("requirements"), false);
  assert.equal(tableNames.includes("revision_requests"), false);
  assert.equal(tableNames.includes("activity_log"), false);
});

test("R9.5 OKR tables expose non-blocking planning and progress fields", () => {
  assert.equal(getTableName(objectives), "objectives");
  assert.equal(objectives.workspaceId.name, "workspace_id");
  assert.equal(objectives.title.name, "title");
  assert.equal(objectives.descriptionMd.name, "description_md");
  assert.equal(objectives.ownerUserId.name, "owner_user_id");
  assert.equal(objectives.status.name, "status");
  assert.equal(objectives.progressPercent.name, "progress_percent");
  assert.equal(objectives.progressUpdatedAt.name, "progress_updated_at");

  assert.equal(getTableName(keyResults), "key_results");
  assert.equal(keyResults.objectiveId.name, "objective_id");
  assert.equal(keyResults.workspaceId.name, "workspace_id");
  assert.equal(keyResults.seq.name, "seq");
  assert.equal(keyResults.title.name, "title");
  assert.equal(keyResults.targetValue.name, "target_value");
  assert.equal(keyResults.currentValue.name, "current_value");
  assert.equal(keyResults.unit.name, "unit");
  assert.equal(keyResults.status.name, "status");
  assert.equal(keyResults.progressPercent.name, "progress_percent");

  assert.equal(getTableName(objectiveWorkItemLinks), "objective_work_item_links");
  assert.equal(objectiveWorkItemLinks.workspaceId.name, "workspace_id");
  assert.equal(objectiveWorkItemLinks.objectiveId.name, "objective_id");
  assert.equal(objectiveWorkItemLinks.workItemId.name, "work_item_id");
  assert.equal(objectiveWorkItemLinks.linkedByUserId.name, "linked_by_user_id");

  const migration = readFileSync(join(process.cwd(), "migrations", "0036_objectives.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "objectives"/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "key_results"/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "objective_work_item_links"/u);
  assert.match(migration, /objective_work_item_links_objective_work_item_uq/u);
  assert.match(migration, /objectives_status_ck/u);
});

test("R9.3 agent memory tables expose L1 private context and append-only versions", () => {
  assert.equal(getTableName(agentMemory), "agent_memory");
  assert.equal(agentMemory.workspaceId.name, "workspace_id");
  assert.equal(agentMemory.agentContextId.name, "agent_context_id");
  assert.equal(agentMemory.category.name, "category");
  assert.equal(agentMemory.key.name, "key");
  assert.equal(agentMemory.valueMd.name, "value_md");
  assert.equal(agentMemory.confidence.name, "confidence");
  assert.equal(agentMemory.sourceRunId.name, "source_run_id");
  assert.equal(agentMemory.baseVersion.name, "base_version");
  assert.equal(agentMemory.currentVersion.name, "current_version");

  assert.equal(getTableName(agentMemoryVersions), "agent_memory_versions");
  assert.equal(agentMemoryVersions.memoryId.name, "memory_id");
  assert.equal(agentMemoryVersions.version.name, "version");
  assert.equal(agentMemoryVersions.baseVersion.name, "base_version");
  assert.equal(agentMemoryVersions.valueMd.name, "value_md");
  assert.equal(agentMemoryVersions.sourceRunId.name, "source_run_id");
});

test("R9.1 task plan tables expose auditable decomposition fields", () => {
  assert.equal(getTableName(taskPlans), "task_plans");
  assert.equal(taskPlans.workItemId.name, "work_item_id");
  assert.equal(taskPlans.workspaceId.name, "workspace_id");
  assert.equal(taskPlans.status.name, "status");
  assert.equal(taskPlans.objectiveId.name, "objective_id");
  assert.equal(taskPlans.budgetJson.name, "budget_json");
  assert.equal(taskPlans.decompositionContextJson.name, "decomposition_context_json");
  assert.equal(taskPlans.createdByUserId.name, "created_by");

  assert.equal(getTableName(taskPlanItems), "task_plan_items");
  assert.equal(taskPlanItems.planId.name, "plan_id");
  assert.equal(taskPlanItems.parentItemId.name, "parent_item_id");
  assert.equal(taskPlanItems.seq.name, "seq");
  assert.equal(taskPlanItems.role.name, "role");
  assert.equal(taskPlanItems.objectiveMd.name, "objective_md");
  assert.equal(taskPlanItems.acceptanceMd.name, "acceptance_md");
  assert.equal(taskPlanItems.budgetSharePct.name, "budget_share_pct");
  assert.equal(taskPlanItems.dependsOn.name, "depends_on");
  assert.equal(taskPlanItems.status.name, "status");
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

test("snapshot refs are wide enough for local absolute snapshot paths", () => {
  assert.equal(getTableName(snapshots), "snapshots");
  assert.equal((snapshots.ref as unknown as { config: { length: number } }).config.length, 1024);
  const migration = readFileSync(join(process.cwd(), "migrations", "0029_snapshot_ref_width.sql"), "utf8");
  assert.match(migration, /ALTER TABLE "snapshots" ALTER COLUMN "ref" TYPE varchar\(1024\)/u);
});

test("agent run persistence fields support DB-backed replay recovery", () => {
  assert.equal(agentRuns.title.name, "title");
  assert.equal(agentRuns.parentRunId.name, "parent_run_id");
  assert.equal(agentRuns.taskPlanId.name, "task_plan_id");
  assert.equal(agentRuns.taskPlanItemId.name, "task_plan_item_id");
  assert.equal(agentRuns.agentRole.name, "agent_role");
  assert.equal(agentRuns.objectiveMd.name, "objective_md");
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

test("R2 auth foundation: credential + session tables expose the password/session contract", () => {
  assert.equal(getTableName(userCredentials), "user_credentials");
  assert.equal(userCredentials.userId.name, "user_id");
  assert.equal(userCredentials.email.name, "email");
  assert.equal(userCredentials.passwordHash.name, "password_hash");
  assert.equal(userCredentials.passwordAlgo.name, "password_algo");
  assert.equal(userCredentials.emailVerifiedAt.name, "email_verified_at");
  assert.equal(userCredentials.failedAttempts.name, "failed_attempts");
  assert.equal(userCredentials.lockedUntil.name, "locked_until");

  assert.equal(getTableName(sessions), "sessions");
  assert.equal(sessions.userId.name, "user_id");
  assert.equal(sessions.tokenHash.name, "token_hash");
  assert.equal(sessions.authMethod.name, "auth_method");
  assert.equal(sessions.oidcProvider.name, "oidc_provider");
  assert.equal(sessions.absoluteExpiresAt.name, "absolute_expires_at");
  assert.equal(sessions.idleExpiresAt.name, "idle_expires_at");
  assert.equal(sessions.revokedAt.name, "revoked_at");

  // offboard 审计列加在 users 上（自引用 set null）。
  assert.equal(users.deletedByUserId.name, "deleted_by_user_id");
});

test("migration 0023 provisions citext email, session token uniqueness, and the users offboard column", () => {
  const migration = readFileSync(
    join(process.cwd(), "migrations", "0023_auth_credentials_sessions.sql"),
    "utf8"
  );
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS citext/u);
  assert.match(migration, /"email" citext NOT NULL/u);
  assert.match(migration, /user_credentials_email_uq/u);
  assert.match(migration, /sessions_token_hash_uq/u);
  // partial index：仅未撤销会话进过期清扫索引。
  assert.match(migration, /sessions_idle_expires_idx[\s\S]*WHERE "revoked_at" IS NULL/u);
  assert.match(migration, /ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_by_user_id"/u);
});

test("R2 multi-tenancy foundation: workspace_memberships exposes the membership contract", () => {
  assert.equal(getTableName(workspaceMemberships), "workspace_memberships");
  assert.equal(workspaceMemberships.workspaceId.name, "workspace_id");
  assert.equal(workspaceMemberships.userId.name, "user_id");
  assert.equal(workspaceMemberships.role.name, "role");
  assert.equal(workspaceMemberships.defaultWorkspace.name, "default_workspace");
  assert.equal(workspaceMemberships.deletedAt.name, "deleted_at");
});

test("migration 0024/0025 provision memberships with one-default-per-user and an idempotent seed", () => {
  const table = readFileSync(join(process.cwd(), "migrations", "0024_workspace_memberships.sql"), "utf8");
  // 每用户至多一个 default workspace（partial unique）。
  assert.match(table, /workspace_memberships_user_default_uq[\s\S]*WHERE "default_workspace" AND "deleted_at" IS NULL/u);
  // 每 (ws,user) 至多一条 active 成员行。
  assert.match(table, /workspace_memberships_ws_user_uq[\s\S]*WHERE "deleted_at" IS NULL/u);

  const seed = readFileSync(join(process.cwd(), "migrations", "0025_seed_default_memberships.sql"), "utf8");
  assert.match(seed, /INSERT INTO "workspace_memberships"/u);
  assert.match(seed, /ON CONFLICT DO NOTHING/u); // 幂等
  assert.match(seed, /EXISTS \(SELECT 1 FROM "workspaces"/u); // FK 守卫
});

test("R2 auth invite foundation: user_invites exposes the out-of-band invite contract", () => {
  assert.equal(getTableName(userInvites), "user_invites");
  assert.equal(userInvites.email.name, "email");
  assert.equal(userInvites.tokenHash.name, "token_hash");
  assert.equal(userInvites.invitedByUserId.name, "invited_by_user_id");
  assert.equal(userInvites.role.name, "role");
  assert.equal(userInvites.workspaceId.name, "workspace_id");
  assert.equal(userInvites.expiresAt.name, "expires_at");
  assert.equal(userInvites.acceptedAt.name, "accepted_at");
  assert.equal(userInvites.acceptedUserId.name, "accepted_user_id");
});

test("migration 0026 provisions citext invite email, unique token hash, and a pending-only index", () => {
  const migration = readFileSync(join(process.cwd(), "migrations", "0026_user_invites.sql"), "utf8");
  assert.match(migration, /"email" citext NOT NULL/u);
  assert.match(migration, /user_invites_token_hash_uq/u);
  // 待接受清单 partial index：未接受 ∧ 未撤销。
  assert.match(migration, /user_invites_pending_idx[\s\S]*WHERE "accepted_at" IS NULL AND "deleted_at" IS NULL/u);
});

test("team-readiness notification prefs: users exposes the per-type mute column with a default-off empty array", () => {
  // 列加在 users 上（jsonb 字符串数组，默认空数组=不静音=DEFAULT-OFF）。
  assert.equal(users.mutedNotificationTypes.name, "muted_notification_types");
});

test("migration 0027 adds the muted notification types column default-off (idempotent)", () => {
  const migration = readFileSync(
    join(process.cwd(), "migrations", "0027_user_notification_prefs.sql"),
    "utf8"
  );
  // 加列、jsonb、NOT NULL、默认空数组、IF NOT EXISTS 幂等。
  assert.match(
    migration,
    /ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "muted_notification_types" jsonb NOT NULL DEFAULT '\[\]'::jsonb/u
  );
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

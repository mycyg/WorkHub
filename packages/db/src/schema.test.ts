import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import { confidenceGrades, escalationTriggers, taskPlanStatuses } from "@workhub/contracts";
import * as dbSchema from "./index.js";
import {
  acceptedDeliverableChanges,
  agentMemory,
  agentMemoryVersions,
  agentRuns,
  agentSteps,
  auditLogs,
  budgetPolicies,
  budgetReservations,
  chatMessages,
  costLedgerEntries,
  mergeAttempts,
  mergeProposals,
  keyResults,
  memoryConflicts,
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

// R12 batch 0: the old count (58) was correct before the conversation foundation existed.
// This slice intentionally adds exactly eight named tables, so the graph contract evolves to 66.
const F02_TABLE_COUNT = 66;

type WorkHubTable = (typeof workHubTables)[keyof typeof workHubTables];

function inlineForeignKeyNames(table: object): string[] {
  const inlineForeignKeysSymbol = Object.getOwnPropertySymbols(table).find((symbol) =>
    String(symbol) === "Symbol(drizzle:PgInlineForeignKeys)"
  );
  if (!inlineForeignKeysSymbol) {
    return [];
  }
  const foreignKeys = (table as { [key: symbol]: Array<{ getName(): string }> })[inlineForeignKeysSymbol] ?? [];
  return foreignKeys.map((foreignKey) => foreignKey.getName()).sort();
}

function chunkRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function columnName(value: unknown): string | undefined {
  const record = chunkRecord(value);
  return typeof record?.["name"] === "string" ? record["name"] : undefined;
}

function sqlChunkText(value: unknown): string {
  const record = chunkRecord(value);
  if (!record) {
    return "";
  }
  const chunkValue = record["value"];
  if (Array.isArray(chunkValue)) {
    return chunkValue.filter((part): part is string => typeof part === "string").join("");
  }
  const queryChunks = record["queryChunks"];
  if (Array.isArray(queryChunks)) {
    return queryChunks.map(sqlChunkText).join("");
  }
  return "";
}

function sqlColumnNames(value: unknown): string[] {
  const direct = columnName(value);
  if (direct) {
    return [direct];
  }
  const record = chunkRecord(value);
  const queryChunks = record?.["queryChunks"];
  if (!Array.isArray(queryChunks)) {
    return [];
  }
  return queryChunks.flatMap(sqlColumnNames);
}

function tableColumnNames(table: WorkHubTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function requiredTable(exportName: string): WorkHubTable {
  const table = (dbSchema as Record<string, unknown>)[exportName];
  assert.ok(table, `missing database table export: ${exportName}`);
  return table as WorkHubTable;
}

function checkSqlText(table: WorkHubTable): string {
  return getTableConfig(table).checks.map((constraint) => sqlChunkText(constraint.value)).join("\n");
}

function foreignKeyShape(table: WorkHubTable, constraintName: string) {
  const foreignKey = getTableConfig(table).foreignKeys.find((candidate) => candidate.getName() === constraintName);
  assert.ok(foreignKey, `missing foreign key ${constraintName}`);
  const reference = foreignKey.reference();
  return {
    columns: reference.columns.map((column) => column.name),
    foreignTable: getTableName(reference.foreignTable),
    foreignColumns: reference.foreignColumns.map((column) => column.name)
  };
}

function foreignKeyActions(table: WorkHubTable, constraintName: string) {
  const foreignKey = getTableConfig(table).foreignKeys.find((candidate) => candidate.getName() === constraintName);
  assert.ok(foreignKey, `missing foreign key ${constraintName}`);
  return {
    onDelete: foreignKey.onDelete,
    onUpdate: foreignKey.onUpdate
  };
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
  assert.equal(tableNames.includes("memory_conflicts"), true);
  assert.equal(tableNames.includes("objectives"), true);
  assert.equal(tableNames.includes("key_results"), true);
  assert.equal(tableNames.includes("objective_work_item_links"), true);
  assert.equal(tableNames.includes("requirements"), false);
  assert.equal(tableNames.includes("revision_requests"), false);
  assert.equal(tableNames.includes("activity_log"), false);
});

test("R12 conversation foundation declares exactly the eight scoped tables", () => {
  const expectedTables = {
    projectConversations: "project_conversations",
    conversationParticipants: "conversation_participants",
    conversationMessages: "conversation_messages",
    actionCards: "action_cards",
    actionCardItems: "action_card_items",
    conversationObserverState: "conversation_observer_state",
    userAiProfiles: "user_ai_profiles",
    projectAiGovernance: "project_ai_governance"
  } as const;

  for (const [exportName, tableName] of Object.entries(expectedTables)) {
    assert.equal(getTableName(requiredTable(exportName)), tableName);
  }
});

test("R12 conversations pin atomic safe-number sequencing and active-main uniqueness", () => {
  const projectConversations = requiredTable("projectConversations") as WorkHubTable & Record<string, any>;
  const columns = tableColumnNames(projectConversations);
  for (const requiredColumn of [
    "workspace_id",
    "project_id",
    "kind",
    "title",
    "parent_conversation_id",
    "source_message_id",
    "visibility",
    "next_seq",
    "created_by",
    "deleted_at"
  ]) {
    assert.equal(columns.includes(requiredColumn), true, `project_conversations missing ${requiredColumn}`);
  }
  assert.equal(projectConversations.workspaceId.notNull, true);
  assert.equal(projectConversations.createdBy.notNull, false);
  assert.equal(projectConversations.nextSeq.notNull, true);
  assert.equal(projectConversations.nextSeq.default, 0);
  assert.equal(projectConversations.nextSeq.dataType, "number");
  assert.equal(projectConversations.nextSeq.columnType, "PgBigInt53");

  const indexes = getTableConfig(projectConversations).indexes;
  const activeMain = indexes.find((candidate) => candidate.config.name === "project_conversations_active_main_uq");
  assert.equal(activeMain?.config.unique, true);
  assert.equal(indexes.some((candidate) => candidate.config.name === "project_conversations_workspace_project_idx"), true);
  assert.equal(indexes.some((candidate) => candidate.config.name === "project_conversations_project_created_idx"), true);
  assert.equal(indexes.some((candidate) => candidate.config.name === "project_conversations_id_project_uq"), true);
  assert.equal(
    indexes.some((candidate) => candidate.config.name === "project_conversations_id_project_workspace_uq"),
    true
  );
  assert.equal(indexes.some((candidate) => candidate.config.name === "project_conversations_id_workspace_uq"), true);

  const projectIndexes = getTableConfig(dbSchema.projects as WorkHubTable).indexes;
  assert.equal(projectIndexes.some((candidate) => candidate.config.name === "projects_id_workspace_uq"), true);
  const foreignKeys = getTableConfig(projectConversations).foreignKeys.map((foreignKey) => foreignKey.getName());
  for (const constraintName of [
    "project_conversations_project_workspace_fk",
    "project_conversations_parent_project_fk",
    "project_conversations_source_message_parent_fk"
  ]) {
    assert.equal(foreignKeys.includes(constraintName), true, `project_conversations missing ${constraintName}`);
  }
  assert.deepEqual(foreignKeyShape(projectConversations, "project_conversations_project_workspace_fk"), {
    columns: ["project_id", "workspace_id"],
    foreignTable: "projects",
    foreignColumns: ["id", "workspace_id"]
  });
  assert.deepEqual(foreignKeyShape(projectConversations, "project_conversations_parent_project_fk"), {
    columns: ["parent_conversation_id", "project_id"],
    foreignTable: "project_conversations",
    foreignColumns: ["id", "project_id"]
  });
  assert.deepEqual(foreignKeyShape(projectConversations, "project_conversations_source_message_parent_fk"), {
    columns: ["parent_conversation_id", "source_message_id"],
    foreignTable: "conversation_messages",
    foreignColumns: ["conversation_id", "id"]
  });

  const checks = checkSqlText(projectConversations);
  for (const value of ["'main'", "'collab'", "'project'", "'private'"]) {
    assert.equal(checks.includes(value), true, `project_conversations checks missing ${value}`);
  }
  assert.equal(checks.includes(String(Number.MAX_SAFE_INTEGER)), true);
});

test("R12 message and participant identities enforce ordered bounded reads", () => {
  const conversationParticipants = requiredTable("conversationParticipants");
  const conversationMessages = requiredTable("conversationMessages") as WorkHubTable & Record<string, any>;

  const participantIndexes = getTableConfig(conversationParticipants).indexes;
  const participantIdentity = participantIndexes.find(
    (candidate) => candidate.config.name === "conversation_participants_conversation_user_uq"
  );
  assert.equal(participantIdentity?.config.unique, true);

  assert.equal(conversationMessages.seq.dataType, "number");
  assert.equal(conversationMessages.seq.columnType, "PgBigInt53");
  const messageIndexes = getTableConfig(conversationMessages).indexes;
  const orderedIdentity = messageIndexes.find(
    (candidate) => candidate.config.name === "conversation_messages_conversation_seq_uq"
  );
  assert.equal(orderedIdentity?.config.unique, true);
  assert.equal(
    messageIndexes.some((candidate) => candidate.config.name === "conversation_messages_cursor_idx"),
    true
  );
  assert.deepEqual(foreignKeyShape(conversationMessages, "conversation_messages_thread_root_conversation_fk"), {
    columns: ["conversation_id", "thread_root_id"],
    foreignTable: "conversation_messages",
    foreignColumns: ["conversation_id", "id"]
  });
  assert.equal(
    messageIndexes.some((candidate) => candidate.config.name === "conversation_messages_conversation_id_uq"),
    true
  );
  assert.equal(
    getTableConfig(conversationMessages).foreignKeys.some(
      (foreignKey) => foreignKey.getName() === "conversation_messages_thread_root_conversation_fk"
    ),
    true
  );
  const checks = checkSqlText(conversationMessages);
  for (const value of ["'user'", "'cuu'", "'system'", "'text'", "'file_card'", "'action_card'", "'system_event'", "'tool_note'"]) {
    assert.equal(checks.includes(value), true, `conversation_messages checks missing ${value}`);
  }
  assert.equal(checks.includes(String(Number.MAX_SAFE_INTEGER)), true);
});

test("R12 action cards, observer state, AI profiles, and governance expose their fixed identities", () => {
  const projectConversations = requiredTable("projectConversations");
  const actionCards = requiredTable("actionCards") as WorkHubTable & Record<string, any>;
  const actionCardItems = requiredTable("actionCardItems") as WorkHubTable & Record<string, any>;
  const conversationObserverState = requiredTable("conversationObserverState") as WorkHubTable & Record<string, any>;
  const userAiProfiles = requiredTable("userAiProfiles") as WorkHubTable & Record<string, any>;
  const projectAiGovernance = requiredTable("projectAiGovernance") as WorkHubTable & Record<string, any>;

  assert.equal(actionCards.analyzedToSeq.columnType, "PgBigInt53");
  assert.equal(conversationObserverState.lastAnalyzedSeq.columnType, "PgBigInt53");
  assert.equal(checkSqlText(actionCards).includes(String(Number.MAX_SAFE_INTEGER)), true);
  assert.equal(checkSqlText(conversationObserverState).includes(String(Number.MAX_SAFE_INTEGER)), true);
  assert.equal(conversationObserverState.conversationId.primary, true);
  assert.equal(projectAiGovernance.projectId.primary, true);

  const profileIdentity = getTableConfig(userAiProfiles).indexes.find(
    (candidate) => candidate.config.name === "user_ai_profiles_workspace_user_uq"
  );
  assert.equal(profileIdentity?.config.unique, true);
  assert.equal(userAiProfiles.workspaceId.notNull, true);
  assert.equal(userAiProfiles.userId.notNull, true);
  assert.equal(userAiProfiles.defaultMode.default, 3);
  assert.equal(userAiProfiles.dispatchPolicy.default, "auto");
  assert.equal(userAiProfiles.cuuProactivity.default, "balanced");
  assert.equal(projectAiGovernance.observerEnabled.default, true);
  assert.equal(projectAiGovernance.silenceWindowSecs.default, 60);
  assert.deepEqual(projectAiGovernance.quietHoursJson.default, { enabled: false });
  assert.equal(
    getTableConfig(actionCards).indexes.some(
      (candidate) => candidate.config.name === "action_cards_conversation_id_uq"
    ),
    true
  );
  assert.equal(
    getTableConfig(actionCards).foreignKeys.some(
      (foreignKey) => foreignKey.getName() === "action_cards_conversation_message_fk"
    ),
    true
  );
  assert.deepEqual(foreignKeyShape(actionCards, "action_cards_conversation_message_fk"), {
    columns: ["conversation_id", "message_id"],
    foreignTable: "conversation_messages",
    foreignColumns: ["conversation_id", "id"]
  });
  assert.equal(
    getTableConfig(conversationObserverState).foreignKeys.some(
      (foreignKey) => foreignKey.getName() === "conversation_observer_state_active_card_conversation_fk"
    ),
    true
  );
  assert.deepEqual(
    foreignKeyShape(conversationObserverState, "conversation_observer_state_active_card_conversation_fk"),
    {
      columns: ["conversation_id", "active_card_id"],
      foreignTable: "action_cards",
      foreignColumns: ["conversation_id", "id"]
    }
  );

  const actionItemColumns = tableColumnNames(actionCardItems);
  for (const scopedColumn of ["workspace_id", "project_id", "conversation_id"]) {
    assert.equal(actionItemColumns.includes(scopedColumn), true, `action_card_items missing ${scopedColumn}`);
  }
  assert.equal(actionCardItems.workspaceId.notNull, true);
  assert.equal(actionCardItems.projectId.notNull, true);
  assert.equal(actionCardItems.conversationId.notNull, true);

  const actionItemIndexes = getTableConfig(actionCardItems).indexes;
  assert.equal(
    actionItemIndexes.some((candidate) => candidate.config.name === "action_card_items_id_conversation_workspace_uq"),
    true
  );
  assert.equal(
    getTableConfig(workItems).indexes.some(
      (candidate) => candidate.config.name === "work_items_id_project_workspace_uq"
    ),
    true
  );
  assert.deepEqual(foreignKeyShape(actionCardItems, "action_card_items_conversation_scope_fk"), {
    columns: ["conversation_id", "project_id", "workspace_id"],
    foreignTable: "project_conversations",
    foreignColumns: ["id", "project_id", "workspace_id"]
  });
  assert.deepEqual(foreignKeyShape(actionCardItems, "action_card_items_action_card_conversation_fk"), {
    columns: ["conversation_id", "action_card_id"],
    foreignTable: "action_cards",
    foreignColumns: ["conversation_id", "id"]
  });
  assert.deepEqual(foreignKeyShape(actionCardItems, "action_card_items_work_item_scope_fk"), {
    columns: ["work_item_id", "project_id", "workspace_id"],
    foreignTable: "work_items",
    foreignColumns: ["id", "project_id", "workspace_id"]
  });
  assert.deepEqual(foreignKeyShape(actionCardItems, "action_card_items_run_scope_fk"), {
    columns: ["run_id", "work_item_id", "workspace_id"],
    foreignTable: "agent_runs",
    foreignColumns: ["id", "work_item_id", "workspace_id"]
  });
  assert.equal(
    foreignKeyActions(actionCardItems, "action_card_items_action_card_id_action_cards_id_fk").onDelete,
    "cascade"
  );
  for (const nullableReference of [
    "action_card_items_work_item_id_work_items_id_fk",
    "action_card_items_run_id_agent_runs_id_fk"
  ]) {
    assert.equal(foreignKeyActions(actionCardItems, nullableReference).onDelete, "set null");
  }
  for (const scopeReference of [
    "action_card_items_conversation_scope_fk",
    "action_card_items_action_card_conversation_fk",
    "action_card_items_work_item_scope_fk",
    "action_card_items_run_scope_fk"
  ]) {
    assert.deepEqual(foreignKeyActions(actionCardItems, scopeReference), {
      onDelete: "no action",
      onUpdate: "no action"
    });
  }
  assert.equal(
    getTableConfig(actionCardItems).checks.some(
      (constraint) => constraint.name === "action_card_items_run_requires_work_item_ck"
    ),
    true
  );
  assert.equal(
    getTableConfig(projectConversations).indexes.some(
      (candidate) => candidate.config.name === "project_conversations_id_project_workspace_uq"
    ),
    true
  );

  const itemChecks = checkSqlText(actionCardItems);
  for (const value of [
    "'execute'",
    "'decide'",
    "'observe'",
    "'high'",
    "'mid'",
    "'low'",
    "'running'",
    "'done'",
    "'undone'",
    "'waiting_decision'",
    "'dismissed'",
    "'escalated'"
  ]) {
    assert.equal(itemChecks.includes(value), true, `action_card_items checks missing ${value}`);
  }
  const profileChecks = checkSqlText(userAiProfiles);
  for (const value of ["'auto'", "'ask'", "'manual'", "'quiet'", "'balanced'", "'proactive'"]) {
    assert.equal(profileChecks.includes(value), true, `user_ai_profiles checks missing ${value}`);
  }
});

test("R12 agent runs carry execution routing and conversation provenance", () => {
  const columns = tableColumnNames(agentRuns);
  for (const column of ["execution_hint", "source_conversation_id", "source_action_card_item_id"]) {
    assert.equal(columns.includes(column), true, `agent_runs missing ${column}`);
  }
  assert.equal((agentRuns as unknown as Record<string, any>).executionHint.default, "server");

  const indexes = getTableConfig(agentRuns).indexes;
  assert.equal(indexes.some((candidate) => candidate.config.name === "agent_runs_execution_claim_idx"), true);
  assert.equal(indexes.some((candidate) => candidate.config.name === "agent_runs_source_conversation_id_idx"), true);
  assert.equal(indexes.some((candidate) => candidate.config.name === "agent_runs_source_action_card_item_id_idx"), true);
  assert.equal(indexes.some((candidate) => candidate.config.name === "agent_runs_id_work_item_workspace_uq"), true);
  assert.deepEqual(foreignKeyShape(agentRuns, "agent_runs_source_conversation_workspace_fk"), {
    columns: ["source_conversation_id", "workspace_id"],
    foreignTable: "project_conversations",
    foreignColumns: ["id", "workspace_id"]
  });
  assert.deepEqual(foreignKeyShape(agentRuns, "agent_runs_source_action_item_conversation_fk"), {
    columns: ["source_action_card_item_id", "source_conversation_id", "workspace_id"],
    foreignTable: "action_card_items",
    foreignColumns: ["id", "conversation_id", "workspace_id"]
  });
  assert.equal(
    foreignKeyActions(agentRuns, "agent_runs_source_conversation_id_project_conversations_id_fk").onDelete,
    "set null"
  );
  assert.equal(
    foreignKeyActions(agentRuns, "agent_runs_source_action_card_item_id_action_card_items_id_fk").onDelete,
    "set null"
  );
  for (const scopeReference of [
    "agent_runs_source_conversation_workspace_fk",
    "agent_runs_source_action_item_conversation_fk"
  ]) {
    assert.deepEqual(foreignKeyActions(agentRuns, scopeReference), {
      onDelete: "no action",
      onUpdate: "no action"
    });
  }
  const checkNames = getTableConfig(agentRuns).checks.map((constraint) => constraint.name);
  assert.equal(checkNames.includes("agent_runs_source_conversation_workspace_ck"), true);
  assert.equal(checkNames.includes("agent_runs_source_action_item_conversation_ck"), true);
});

test("R12 migration 0046 is journaled, replay-safe, and never allocates with max(seq)+1", () => {
  const migrationUrl = new URL("../migrations/0046_r12_conversation_foundation.sql", import.meta.url);
  assert.equal(existsSync(migrationUrl), true, "missing migration 0046");
  const migration = readFileSync(migrationUrl, "utf8");

  for (const tableName of [
    "project_conversations",
    "conversation_participants",
    "conversation_messages",
    "action_cards",
    "action_card_items",
    "conversation_observer_state",
    "user_ai_profiles",
    "project_ai_governance"
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS "${tableName}"`));
  }
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "execution_hint"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "source_conversation_id"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "source_action_card_item_id"/);
  assert.match(migration, /ALTER TABLE "action_card_items" ADD COLUMN IF NOT EXISTS "workspace_id" uuid/);
  assert.match(migration, /ALTER TABLE "action_card_items" ADD COLUMN IF NOT EXISTS "project_id" uuid/);
  assert.match(migration, /ALTER TABLE "action_card_items" ADD COLUMN IF NOT EXISTS "conversation_id" uuid/);
  assert.match(migration, /UPDATE "action_card_items"/);
  for (const columnName of ["workspace_id", "project_id", "conversation_id"]) {
    assert.equal(
      migration.includes(`ALTER COLUMN "${columnName}" SET NOT NULL`),
      true,
      `migration does not make action_card_items.${columnName} non-null`
    );
  }
  const scopeMigrationOrder = [
    'ALTER TABLE "action_card_items" ADD COLUMN IF NOT EXISTS "workspace_id" uuid',
    'UPDATE "action_card_items" AS aci',
    'ALTER TABLE "action_card_items" ALTER COLUMN "conversation_id" SET NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS "project_conversations_id_project_workspace_uq"',
    'ADD CONSTRAINT "action_card_items_conversation_scope_fk"'
  ].map((statement) => migration.indexOf(statement));
  assert.equal(scopeMigrationOrder.every((position) => position >= 0), true);
  assert.deepEqual(scopeMigrationOrder, [...scopeMigrationOrder].sort((left, right) => left - right));
  for (const lifecycleReference of [
    '"action_card_id" uuid NOT NULL REFERENCES "action_cards"("id") ON DELETE cascade',
    '"work_item_id" uuid REFERENCES "work_items"("id") ON DELETE set null',
    '"run_id" uuid REFERENCES "agent_runs"("id") ON DELETE set null',
    'FOREIGN KEY ("source_conversation_id") REFERENCES "project_conversations"("id") ON DELETE set null',
    'FOREIGN KEY ("source_action_card_item_id") REFERENCES "action_card_items"("id") ON DELETE set null'
  ]) {
    assert.equal(migration.includes(lifecycleReference), true, `migration changed lifecycle FK: ${lifecycleReference}`);
  }
  for (const constraintName of [
    "project_conversations_project_workspace_fk",
    "project_conversations_parent_project_fk",
    "project_conversations_source_message_parent_fk",
    "conversation_messages_thread_root_conversation_fk",
    "action_cards_conversation_message_fk",
    "conversation_observer_state_active_card_conversation_fk",
    "action_card_items_conversation_scope_fk",
    "action_card_items_action_card_conversation_fk",
    "action_card_items_work_item_scope_fk",
    "action_card_items_run_scope_fk",
    "agent_runs_source_conversation_workspace_fk",
    "agent_runs_source_action_item_conversation_fk",
    "action_card_items_run_requires_work_item_ck",
    "agent_runs_source_conversation_workspace_ck",
    "agent_runs_source_action_item_conversation_ck"
  ]) {
    assert.equal(migration.includes(`ADD CONSTRAINT "${constraintName}"`), true, `migration missing ${constraintName}`);
  }
  for (const expectedSql of [
    'FOREIGN KEY ("project_id","workspace_id") REFERENCES "projects"("id","workspace_id")',
    'FOREIGN KEY ("parent_conversation_id","project_id") REFERENCES "project_conversations"("id","project_id")',
    'FOREIGN KEY ("parent_conversation_id","source_message_id") REFERENCES "conversation_messages"("conversation_id","id")',
    'FOREIGN KEY ("conversation_id","thread_root_id") REFERENCES "conversation_messages"("conversation_id","id")',
    'FOREIGN KEY ("conversation_id","message_id") REFERENCES "conversation_messages"("conversation_id","id")',
    'FOREIGN KEY ("conversation_id","active_card_id") REFERENCES "action_cards"("conversation_id","id")',
    'FOREIGN KEY ("conversation_id","project_id","workspace_id") REFERENCES "project_conversations"("id","project_id","workspace_id")',
    'FOREIGN KEY ("conversation_id","action_card_id") REFERENCES "action_cards"("conversation_id","id")',
    'FOREIGN KEY ("work_item_id","project_id","workspace_id") REFERENCES "work_items"("id","project_id","workspace_id")',
    'FOREIGN KEY ("run_id","work_item_id","workspace_id") REFERENCES "agent_runs"("id","work_item_id","workspace_id")',
    'FOREIGN KEY ("source_conversation_id","workspace_id") REFERENCES "project_conversations"("id","workspace_id")',
    'FOREIGN KEY ("source_action_card_item_id","source_conversation_id","workspace_id") REFERENCES "action_card_items"("id","conversation_id","workspace_id")'
  ]) {
    assert.equal(migration.includes(expectedSql), true, `migration missing ${expectedSql}`);
  }
  assert.doesNotMatch(migration, /max\s*\(\s*"?seq"?\s*\)\s*\+\s*1/i);

  assert.match(
    migration,
    /"cuu_proactivity" varchar\(32\) NOT NULL DEFAULT 'balanced'/u
  );
  assert.match(
    migration,
    /CONSTRAINT "user_ai_profiles_cuu_proactivity_ck" CHECK \("cuu_proactivity" IN \('quiet','balanced','proactive'\)\)/u
  );
  assert.match(
    migration,
    /ALTER TABLE "user_ai_profiles" ALTER COLUMN "cuu_proactivity" SET DEFAULT 'balanced'/u
  );
  assert.match(migration, /ADD CONSTRAINT "user_ai_profiles_cuu_proactivity_ck"/u);
  assert.match(
    migration,
    /"quiet_hours_json" jsonb NOT NULL DEFAULT '\{"enabled":false\}'::jsonb/u
  );
  assert.match(
    migration,
    /ALTER TABLE "project_ai_governance" ALTER COLUMN "quiet_hours_json" SET DEFAULT '\{"enabled":false\}'::jsonb/u
  );
  assert.match(
    migration,
    /UPDATE "project_ai_governance"\s+SET "quiet_hours_json" = '\{"enabled":false\}'::jsonb\s+WHERE "quiet_hours_json" = '\{\}'::jsonb/u
  );
  assert.match(
    migration,
    /conname = 'user_ai_profiles_cuu_proactivity_ck'[\s\S]+conrelid = 'user_ai_profiles'::regclass/u
  );

  const journal = JSON.parse(
    readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8")
  ) as { entries: Array<{ idx: number; tag: string }> };
  const entry0046 = journal.entries.find((entry) => entry.idx === 46);
  assert.deepEqual(entry0046 && { idx: entry0046.idx, tag: entry0046.tag }, {
    idx: 46,
    tag: "0046_r12_conversation_foundation"
  });
});

test("0047 task plan status migration preserves 0031 and replaces the CHECK in safe order", () => {
  const migrationUrl = new URL("../migrations/0047_task_plan_paused_status.sql", import.meta.url);
  assert.equal(existsSync(migrationUrl), true, "missing migration 0047_task_plan_paused_status.sql");
  const migration = readFileSync(migrationUrl, "utf8");

  const statusCheck = migration.match(/CHECK\s*\(\s*"status"\s+IN\s*\(([^)]*)\)\s*\)/iu);
  assert.ok(statusCheck, "migration 0047 must declare the task plan status CHECK");
  const statusListSql = statusCheck[1];
  assert.ok(statusListSql, "migration 0047 task plan status CHECK must contain a status list");
  assert.deepEqual(
    [...statusListSql.matchAll(/'([^']+)'/gu)].map((match) => match[1]),
    [...taskPlanStatuses],
    "migration 0047 task plan statuses must match the shared contract exactly"
  );

  const operationPatterns = [
    /ALTER TABLE\s+"task_plans"\s+DROP CONSTRAINT\s+IF EXISTS\s+"task_plans_status_with_paused_ck"\s*;/iu,
    /ALTER TABLE\s+"task_plans"\s+ADD CONSTRAINT\s+"task_plans_status_with_paused_ck"\s+CHECK[\s\S]*?NOT VALID\s*;/iu,
    /ALTER TABLE\s+"task_plans"\s+VALIDATE CONSTRAINT\s+"task_plans_status_with_paused_ck"\s*;/iu,
    /ALTER TABLE\s+"task_plans"\s+DROP CONSTRAINT(?:\s+IF EXISTS)?\s+"task_plans_status_ck"\s*;/iu,
    /ALTER TABLE\s+"task_plans"\s+RENAME CONSTRAINT\s+"task_plans_status_with_paused_ck"\s+TO\s+"task_plans_status_ck"\s*;/iu
  ];
  const operationPositions = operationPatterns.map((pattern) => migration.search(pattern));
  assert.equal(
    operationPositions.every((position) => position >= 0),
    true,
    "migration 0047 must drop the stale temporary CHECK, add NOT VALID, validate, drop the old CHECK, and rename the temporary CHECK"
  );
  assert.deepEqual(
    operationPositions,
    [...operationPositions].sort((left, right) => left - right),
    "migration 0047 CHECK replacement operations are out of order"
  );
  assert.doesNotMatch(migration, /0031(?:_task_plans)?(?:\.sql)?/iu, "migration 0047 must not reference migration 0031");

  const publishedMigration0031 = readFileSync(
    new URL("../migrations/0031_task_plans.sql", import.meta.url)
  );
  assert.equal(
    createHash("sha256").update(publishedMigration0031).digest("hex"),
    "549939f8541bde287e4663d11c66b109b73aa25ef9dd92ab6bd5761ff74aac09",
    "published migration 0031 must remain immutable"
  );
});

test("migration journal ends with 0053 default org/workspace seed", () => {
  const journal = JSON.parse(
    readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8")
  ) as {
    entries: Array<{ idx: number; version: string; tag: string; breakpoints: boolean }>;
  };
  const finalEntry = journal.entries.at(-1);
  assert.deepEqual(
    finalEntry && {
      idx: finalEntry.idx,
      version: finalEntry.version,
      tag: finalEntry.tag,
      breakpoints: finalEntry.breakpoints
    },
    {
      // R14 前夜：0050-0052 已预分配给并行施工中的 P1.5/C1/A2 三批，0053（pilot smoke 病根：
      // 默认 org/workspace 种子）由集成者先行落主干。三批合并时把 0050-0052 的 when 归一成
      // 递增序插在 0053 之前，journal 尾保持 0053 不变——所以本断言在合并波次中是稳定的。
      idx: 53,
      version: "7",
      tag: "0053_seed_default_org_workspace",
      breakpoints: true
    }
  );
});

test("R13 G1 migration 0048 adds project_conversations.cuu_enabled as a non-null default-true column", () => {
  const migrationUrl = new URL("../migrations/0048_small_group_cuu_enabled.sql", import.meta.url);
  assert.equal(existsSync(migrationUrl), true, "missing migration 0048_small_group_cuu_enabled.sql");
  const migration = readFileSync(migrationUrl, "utf8");
  assert.match(
    migration,
    /ALTER TABLE\s+"project_conversations"\s+ADD COLUMN IF NOT EXISTS\s+"cuu_enabled"\s+boolean\s+NOT NULL\s+DEFAULT\s+true\s*;/iu
  );

  const projectConversations = requiredTable("projectConversations") as WorkHubTable & Record<string, any>;
  assert.equal(projectConversations.cuuEnabled.notNull, true);
  assert.equal(projectConversations.cuuEnabled.default, true);
  assert.equal(projectConversations.cuuEnabled.columnType, "PgBoolean");
});

test("R12 migration 0046 backfills one active main only for eligible legacy projects", () => {
  const migration = readFileSync(
    new URL("../migrations/0046_r12_conversation_foundation.sql", import.meta.url),
    "utf8"
  );
  const activeMainIndex = migration.indexOf(
    'CREATE UNIQUE INDEX IF NOT EXISTS "project_conversations_active_main_uq"'
  );
  const backfill = migration.indexOf('INSERT INTO "project_conversations"');

  assert.ok(activeMainIndex >= 0, "active-main conflict identity must exist before backfill");
  assert.ok(backfill > activeMainIndex, "legacy main backfill must run after its partial unique index");
  const sql = migration.slice(backfill);
  for (const required of [
    "gen_random_uuid()",
    "p.\"workspace_id\"",
    "p.\"id\"",
    "'main'",
    "'主区'",
    "'project'",
    "p.\"owner_user_id\"",
    'p."workspace_id" IS NOT NULL',
    'p."archived" = false',
    'p."deleted_at" IS NULL',
    "NOT EXISTS",
    'existing_main."project_id" = p."id"',
    'existing_main."kind" = \'main\'',
    'existing_main."deleted_at" IS NULL',
    'ON CONFLICT ("project_id") WHERE "kind" = \'main\' AND "deleted_at" IS NULL DO NOTHING'
  ]) {
    assert.equal(sql.includes(required), true, `legacy main backfill missing: ${required}`);
  }
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
});

test("R9.3 memory conflicts expose durable sync_conflict decision fields", () => {
  assert.equal(getTableName(memoryConflicts), "memory_conflicts");
  assert.equal(memoryConflicts.workspaceId.name, "workspace_id");
  assert.equal(memoryConflicts.userId.name, "user_id");
  assert.equal(memoryConflicts.sourceRunId.name, "source_run_id");
  assert.equal(memoryConflicts.currentValueMd.name, "current_value_md");
  assert.equal(memoryConflicts.incomingValueMd.name, "incoming_value_md");
  assert.equal(memoryConflicts.candidateMemoryIds.name, "candidate_memory_ids");
  assert.equal(memoryConflicts.status.name, "status");
  assert.equal(memoryConflicts.resolution.name, "resolution");
  assert.equal(memoryConflicts.resolvedByUserId.name, "resolved_by_user_id");
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
  assert.equal(inlineForeignKeyNames(taskPlans).includes("task_plans_objective_id_objectives_id_fk"), true);
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

test("task plan status CHECK matches every shared contract value exactly once", () => {
  const statusChecks = getTableConfig(taskPlans).checks.filter(
    (constraint) => constraint.name === "task_plans_status_ck"
  );
  assert.equal(statusChecks.length, 1, "task_plans must declare exactly one task_plans_status_ck");

  const statusCheck = statusChecks[0];
  assert.ok(statusCheck, "task_plans must declare task_plans_status_ck");
  const statusCheckSql = sqlChunkText(statusCheck.value);
  assert.deepEqual(
    [...statusCheckSql.matchAll(/'([^']+)'/gu)].map((match) => match[1]),
    [...taskPlanStatuses],
    "task_plans_status_ck statuses must match the shared contract exactly"
  );
  for (const status of taskPlanStatuses) {
    const quotedStatus = `'${status}'`;
    assert.equal(
      statusCheckSql.split(quotedStatus).length - 1,
      1,
      `task_plans_status_ck must contain ${quotedStatus} exactly once`
    );
  }
});

test("R9.7 budget reservations keep workspace scope referentially valid", () => {
  assert.equal(getTableName(budgetReservations), "budget_reservations");
  assert.equal(budgetReservations.workspaceId.name, "workspace_id");
  assert.equal(
    inlineForeignKeyNames(budgetReservations).includes("budget_reservations_workspace_id_workspaces_id_fk"),
    true
  );
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
  // R9.7: the old assertion grepped migration 0011 for active-path unique-index SQL.
  // That was wrong because migration source text did not prove the current Drizzle schema
  // still enforces one active path per project/folder/name.
  const activePathIndex = getTableConfig(projectDriveItems).indexes.find(
    (index) => index.config.name === "project_drive_items_active_path_uq"
  );
  assert.equal(activePathIndex?.config.unique, true);
  assert.deepEqual(activePathIndex?.config.columns.map(columnName), ["project_id", undefined, "name"]);
  assert.deepEqual(sqlColumnNames(activePathIndex?.config.columns[1]), ["parent_id"]);
  assert.equal(sqlChunkText(activePathIndex?.config.columns[1]).includes("coalesce("), true);
  assert.deepEqual(sqlColumnNames(activePathIndex?.config.where), ["deleted_at"]);
  assert.equal(sqlChunkText(activePathIndex?.config.where).includes("is null"), true);
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
  // R9.7: the old assertion grepped migration 0029 for an ALTER TABLE statement.
  // That was wrong because migration source text did not prove the current schema contract
  // used by runtime snapshot persistence accepts local absolute refs.
  assert.equal((snapshots.ref as unknown as { config: { length: number } }).config.length, 1024);
});

test("chat message kinds fit file-context notice events from real intake", () => {
  assert.equal(getTableName(chatMessages), "chat_messages");
  // R9.7: the old assertion grepped migration 0041 for an ALTER TABLE statement.
  // That was wrong because migration source text did not prove the current schema contract
  // used by intake chat writes accepts the longest runtime notice kind.
  assert.ok(
    (chatMessages.kind as unknown as { config: { length: number } }).config.length >=
      "clarification_file_context_notice".length
  );
});

test("agent run persistence fields support DB-backed replay recovery", () => {
  assert.equal(agentRuns.title.name, "title");
  assert.equal(agentRuns.parentRunId.name, "parent_run_id");
  assert.equal(agentRuns.taskPlanId.name, "task_plan_id");
  assert.equal(agentRuns.taskPlanItemId.name, "task_plan_item_id");
  assert.equal(agentRuns.agentRole.name, "agent_role");
  assert.equal(agentRuns.objectiveId.name, "objective_id");
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
  assert.equal(usageRecords.taskPlanId.name, "task_plan_id");
  assert.equal(usageRecords.objectiveId.name, "objective_id");
  assert.equal(usageRecords.userId.name, "user_id");
  assert.equal(usageRecords.estimatedCostCny.name, "estimated_cost_cny");
  assert.equal(costLedgerEntries.usageRecordId.name, "usage_record_id");
  assert.equal(costLedgerEntries.taskPlanId.name, "task_plan_id");
  assert.equal(costLedgerEntries.objectiveId.name, "objective_id");
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

test("auth credential/session schema config exposes uniqueness, cleanup, and offboard contracts", () => {
  // R9.7: the old assertion grepped migration 0023 for citext/index/offboard SQL.
  // That was wrong because migration source text did not prove the current Drizzle schema
  // used by auth repositories exposes these uniqueness and cleanup contracts.
  const credentialIndexes = getTableConfig(userCredentials).indexes;
  const emailUniqueIndex = credentialIndexes.find((index) => index.config.name === "user_credentials_email_uq");
  assert.equal(emailUniqueIndex?.config.unique, true);
  assert.deepEqual(emailUniqueIndex?.config.columns.map(columnName), ["email"]);

  const sessionIndexes = getTableConfig(sessions).indexes;
  const tokenHashIndex = sessionIndexes.find((index) => index.config.name === "sessions_token_hash_uq");
  assert.equal(tokenHashIndex?.config.unique, true);
  assert.deepEqual(tokenHashIndex?.config.columns.map(columnName), ["token_hash"]);

  const idleExpiresIndex = sessionIndexes.find((index) => index.config.name === "sessions_idle_expires_idx");
  assert.deepEqual(idleExpiresIndex?.config.columns.map(columnName), ["idle_expires_at"]);
  assert.deepEqual(sqlColumnNames(idleExpiresIndex?.config.where), ["revoked_at"]);
  assert.equal(sqlChunkText(idleExpiresIndex?.config.where).includes("is null"), true);
  assert.equal(users.deletedByUserId.name, "deleted_by_user_id");
});

test("R2 multi-tenancy foundation: workspace_memberships exposes the membership contract", () => {
  assert.equal(getTableName(workspaceMemberships), "workspace_memberships");
  assert.equal(workspaceMemberships.workspaceId.name, "workspace_id");
  assert.equal(workspaceMemberships.userId.name, "user_id");
  assert.equal(workspaceMemberships.role.name, "role");
  assert.equal(workspaceMemberships.defaultWorkspace.name, "default_workspace");
  assert.equal(workspaceMemberships.deletedAt.name, "deleted_at");
});

test("workspace membership schema config exposes active and default uniqueness contracts", () => {
  // R9.7: the old assertion grepped migrations 0024/0025 for index and seed SQL.
  // That was wrong because SQL source text did not prove the current Drizzle schema
  // used by membership repositories preserves the active/default uniqueness contracts;
  // seed SQL replay/idempotency belongs to migration-audit rather than a schema unit test.
  const indexes = getTableConfig(workspaceMemberships).indexes;

  const activeMembershipIndex = indexes.find((index) => index.config.name === "workspace_memberships_ws_user_uq");
  assert.equal(activeMembershipIndex?.config.unique, true);
  assert.deepEqual(activeMembershipIndex?.config.columns.map(columnName), ["workspace_id", "user_id"]);
  assert.deepEqual(sqlColumnNames(activeMembershipIndex?.config.where), ["deleted_at"]);
  assert.equal(sqlChunkText(activeMembershipIndex?.config.where).includes("is null"), true);

  const defaultMembershipIndex = indexes.find((index) => index.config.name === "workspace_memberships_user_default_uq");
  assert.equal(defaultMembershipIndex?.config.unique, true);
  assert.deepEqual(defaultMembershipIndex?.config.columns.map(columnName), ["user_id"]);
  assert.deepEqual(sqlColumnNames(defaultMembershipIndex?.config.where), ["default_workspace", "deleted_at"]);
  assert.equal(sqlChunkText(defaultMembershipIndex?.config.where).includes("is null"), true);
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

test("user invite schema config exposes token uniqueness and pending lookup contracts", () => {
  // R9.7: the old assertion grepped migration 0026 for citext and partial-index SQL.
  // That was wrong because migration source text did not prove the current invite
  // repository schema exposes the unique token and pending-invite lookup contracts.
  const indexes = getTableConfig(userInvites).indexes;

  const tokenHashIndex = indexes.find((index) => index.config.name === "user_invites_token_hash_uq");
  assert.equal(tokenHashIndex?.config.unique, true);
  assert.deepEqual(tokenHashIndex?.config.columns.map(columnName), ["token_hash"]);

  const pendingIndex = indexes.find((index) => index.config.name === "user_invites_pending_idx");
  assert.deepEqual(pendingIndex?.config.columns.map(columnName), ["email", "expires_at"]);
  assert.deepEqual(sqlColumnNames(pendingIndex?.config.where), ["accepted_at", "deleted_at"]);
  assert.equal(sqlChunkText(pendingIndex?.config.where).includes("is null and"), true);
});

test("team-readiness notification prefs: users exposes the per-type mute column with a default-off empty array", () => {
  // 列加在 users 上（jsonb 字符串数组，默认空数组=不静音=DEFAULT-OFF）。
  assert.equal(users.mutedNotificationTypes.name, "muted_notification_types");
});

test("notification preference schema config exposes default-off muted types", () => {
  // R9.7: the old assertion grepped migration 0027 for ALTER TABLE text.
  // That was wrong because SQL source text did not prove the current users table
  // schema exposes a non-null default-off muted notification preference column.
  assert.equal(users.mutedNotificationTypes.notNull, true);
  assert.deepEqual(users.mutedNotificationTypes.default, []);
});

test("enum drift is closed in the shared contract package", () => {
  assert.deepEqual(confidenceGrades, ["low", "medium", "high"]);
  assert.equal(escalationTriggers.includes("user_unsatisfied"), true);
  assert.equal(escalationTriggers.includes("user_rejected" as never), false);
});

test("schema metadata keeps retired requirement tables and fields out of the active graph", () => {
  // R9.7: the old assertion walked src text looking for retired names.
  // That was wrong because source-text absence did not prove the live Drizzle schema
  // graph excluded retired tables/columns, while also flagging harmless comments or docs.
  const tableNames = Object.values(workHubTables).map((table) => getTableName(table) as string).sort();
  assert.deepEqual(tableNames.filter((name) => name.includes("requirement")), []);
  assert.equal(tableNames.includes("revision_requests"), false);
  assert.equal(tableNames.includes("activity_log"), false);

  const columnNames = new Set(Object.values(workHubTables).flatMap(tableColumnNames));
  assert.equal(columnNames.has("requirement_id"), false);
});

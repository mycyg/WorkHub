import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { getTableName } from "drizzle-orm";

import { confidenceGrades, escalationTriggers } from "@workhub/contracts";
import { agentRuns, agentSteps, auditLogs, proposals, workHubTables, workItems } from "./index.js";

const F02_TABLE_COUNT = 41;

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
  assert.equal(tableNames.includes("approval_requests"), true);
  assert.equal(tableNames.includes("requirements"), false);
  assert.equal(tableNames.includes("revision_requests"), false);
  assert.equal(tableNames.includes("activity_log"), false);
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

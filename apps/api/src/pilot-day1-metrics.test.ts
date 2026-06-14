import assert from "node:assert/strict";
import test from "node:test";

import type { PilotDay1MetricsRows, PilotMetricsRepository } from "@workhub/db";

import {
  buildPilotDay1MetricsSnapshot,
  createPilotDay1MetricsService,
  PilotDay1MetricsServiceError
} from "./services/pilot-day1-metrics.js";
import type { AuthActor } from "./middleware/auth.js";

const from = new Date("2026-06-13T00:00:00.000Z");
const to = new Date("2026-06-14T00:00:00.000Z");
const generatedAt = new Date("2026-06-13T12:00:00.000Z");
const userA = "70000000-0000-4000-8000-000000000001";
const userB = "70000000-0000-4000-8000-000000000002";
const workItemId = "70000000-0000-4000-8000-000000000010";
const proposalId = "70000000-0000-4000-8000-000000000020";
const runId = "70000000-0000-4000-8000-000000000030";

function rows(): PilotDay1MetricsRows {
  return {
    workItems: [
      {
        id: workItemId,
        code: "DAY1-001",
        submitterUserId: userA,
        createdAt: new Date("2026-06-13T01:00:00.000Z")
      }
    ],
    proposals: [
      {
        id: proposalId,
        workItemId,
        status: "merged",
        openedByKind: "ai",
        openedByUserId: null,
        reviewedAt: new Date("2026-06-13T02:00:00.000Z"),
        mergedAt: new Date("2026-06-13T02:05:00.000Z"),
        createdAt: new Date("2026-06-13T01:40:00.000Z")
      }
    ],
    reviews: [
      {
        id: "70000000-0000-4000-8000-000000000021",
        proposalId,
        reviewerUserId: userB,
        decision: "approve",
        createdAt: new Date("2026-06-13T02:00:00.000Z")
      }
    ],
    agentRuns: [
      {
        id: runId,
        workItemId,
        actorUserId: userA,
        status: "succeeded",
        tokenIn: 1000,
        tokenOut: 2000,
        costEstimate: "0.018",
        createdAt: new Date("2026-06-13T01:10:00.000Z"),
        finishedAt: new Date("2026-06-13T01:35:00.000Z")
      }
    ],
    escalationEvents: [],
    approvalRequests: [],
    mergeAttempts: [
      {
        id: "70000000-0000-4000-8000-000000000040",
        proposalId,
        workItemId,
        result: "conflict",
        conflictCount: 1,
        createdAt: new Date("2026-06-13T02:04:00.000Z")
      }
    ],
    notifications: [
      {
        id: "70000000-0000-4000-8000-000000000050",
        userId: userA,
        type: "agent_run.succeeded",
        severity: "normal",
        createdAt: new Date("2026-06-13T02:06:00.000Z")
      },
      {
        id: "70000000-0000-4000-8000-000000000051",
        userId: userB,
        type: "proposal.ready",
        severity: "normal",
        createdAt: new Date("2026-06-13T02:07:00.000Z")
      }
    ],
    costLedgerEntries: [
      {
        id: "ledger-user",
        usageRecordId: "usage-1",
        runId,
        workItemId,
        userId: userA,
        scope: { kind: "user", userId: userA },
        periodBucket: "2026-06-13",
        tokenIn: 1000,
        tokenOut: 2000,
        estimatedCostCny: "0.018",
        currency: "CNY",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        source: "agent_step",
        createdAt: "2026-06-13T01:12:00.000Z"
      },
      {
        id: "ledger-team",
        usageRecordId: "usage-1",
        runId,
        workItemId,
        teamId: "70000000-0000-4000-8000-000000000099",
        scope: { kind: "team", teamId: "70000000-0000-4000-8000-000000000099" },
        periodBucket: "2026-06-13",
        tokenIn: 1000,
        tokenOut: 2000,
        estimatedCostCny: "0.018",
        currency: "CNY",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        source: "agent_step",
        createdAt: "2026-06-13T01:12:00.000Z"
      }
    ]
  };
}

function actor(isAdmin: boolean): AuthActor {
  return {
    kind: "human",
    id: userA,
    label: "Pilot Host",
    userId: userA,
    isAdmin,
    orgId: "70000000-0000-4000-8000-000000000090",
    workspaceId: "70000000-0000-4000-8000-000000000099"
  };
}

test("Day1 metrics snapshot counts closed loop, adoption, cost, conflicts and notification density", () => {
  const snapshot = buildPilotDay1MetricsSnapshot({ rows: rows(), from, to, generatedAt });
  const byId = new Map(snapshot.metrics.map((item) => [item.id, item]));

  assert.equal(snapshot.raw_counts.closed_loop_work_items, 1);
  assert.equal(snapshot.raw_counts.active_user_count, 2);
  assert.equal(snapshot.cost.total_cost_cny, "0.018");
  assert.equal(snapshot.cost.unique_usage_records, 1);
  assert.equal(byId.get("closed_loop_count")?.value, "1");
  assert.equal(byId.get("proposal_adoption_rate")?.value, "100%");
  assert.equal(byId.get("cost_per_merged_item_cny")?.value, "0.018");
  assert.equal(byId.get("conflict_count")?.value, "1");
  assert.equal(byId.get("notification_density")?.value, "1");
  assert.equal(snapshot.gates.second_user_path_observed, true);
});

test("Day1 metrics service is admin-only and rejects invalid ranges", async () => {
  const repository: PilotMetricsRepository = {
    async readDay1MetricsRows() {
      return rows();
    },
    async readAiWorklogRows() {
      const all = rows();
      return { agentRuns: all.agentRuns, proposals: all.proposals };
    }
  };
  const service = createPilotDay1MetricsService(repository, { now: () => generatedAt });

  await assert.rejects(
    () => service.snapshot({ actor: actor(false), from, to }),
    (error) => error instanceof PilotDay1MetricsServiceError && error.status === 403
  );
  await assert.rejects(
    () => service.snapshot({ actor: actor(true), from: to, to: from }),
    (error) => error instanceof PilotDay1MetricsServiceError && error.code === "invalid_range"
  );

  const snapshot = await service.snapshot({ actor: actor(true), from, to });
  assert.equal(snapshot.gates.metrics_ready, true);
});

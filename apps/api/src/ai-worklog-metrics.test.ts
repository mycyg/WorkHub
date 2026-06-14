import assert from "node:assert/strict";
import test from "node:test";

import type { PilotDay1MetricsRows } from "@workhub/db";

import { buildAiWorklog, createAiWorklogMetricsService } from "./services/ai-worklog-metrics.js";

function emptyRows(): PilotDay1MetricsRows {
  return {
    workItems: [],
    proposals: [],
    reviews: [],
    agentRuns: [],
    escalationEvents: [],
    approvalRequests: [],
    mergeAttempts: [],
    notifications: [],
    costLedgerEntries: []
  };
}

function agentRun(status: string, finishedAt: Date | null, createdAt = finishedAt ?? new Date()): PilotDay1MetricsRows["agentRuns"][number] {
  return {
    id: `run-${Math.random().toString(16).slice(2)}`,
    workItemId: "wi-1",
    actorUserId: "user-1",
    status,
    tokenIn: 0,
    tokenOut: 0,
    costEstimate: null,
    createdAt,
    finishedAt
  };
}

function proposal(mergedAt: Date | null, createdAt = mergedAt ?? new Date()): PilotDay1MetricsRows["proposals"][number] {
  return {
    id: `p-${Math.random().toString(16).slice(2)}`,
    workItemId: "wi-1",
    status: mergedAt ? "merged" : "opened",
    openedByKind: "ai",
    openedByUserId: null,
    reviewedAt: mergedAt,
    mergedAt,
    createdAt
  };
}

test("buildAiWorklog computes autonomy rate, accepted count, and saved-hours estimate for today", () => {
  const now = new Date("2026-06-14T12:00:00");
  const today = new Date("2026-06-14T10:00:00");
  const yesterday = new Date("2026-06-13T10:00:00");

  const rows = emptyRows();
  rows.agentRuns = [
    agentRun("succeeded", today),
    agentRun("succeeded", today),
    agentRun("succeeded", today),
    agentRun("escalated", today),
    agentRun("running", null, today), // non-terminal → excluded
    agentRun("succeeded", yesterday) // out of range → excluded
  ];
  rows.proposals = [
    proposal(today),
    proposal(today),
    proposal(null), // not merged → excluded
    proposal(yesterday) // out of range → excluded
  ];

  const worklog = buildAiWorklog({ rows, from: new Date("2026-06-14T00:00:00"), to: now, now });

  assert.equal(worklog.runs_today, 4, "4 terminal runs landed today");
  assert.equal(worklog.autonomy_rate, 75, "3 of 4 terminal runs succeeded");
  assert.equal(worklog.accepted_today, 2, "2 proposals merged today");
  assert.equal(worklog.saved_hours_estimate, 1, "2 accepted * 0.5h");
  assert.equal(worklog.generated_at, now.toISOString());
  assert.equal(worklog.range_label, "今天");
});

test("buildAiWorklog returns zero autonomy when no terminal runs", () => {
  const now = new Date("2026-06-14T12:00:00");
  const worklog = buildAiWorklog({ rows: emptyRows(), from: new Date("2026-06-14T00:00:00"), to: now, now });
  assert.equal(worklog.runs_today, 0);
  assert.equal(worklog.autonomy_rate, 0);
  assert.equal(worklog.accepted_today, 0);
  assert.equal(worklog.saved_hours_estimate, 0);
});

test("createAiWorklogMetricsService reads today rows from the repository", async () => {
  const now = new Date("2026-06-14T12:00:00");
  const rows = emptyRows();
  rows.agentRuns = [agentRun("succeeded", new Date("2026-06-14T09:00:00"))];
  const service = createAiWorklogMetricsService(
    { readDay1MetricsRows: async () => rows } as never,
    { now: () => now }
  );
  const worklog = await service.getTodayMetrics();
  assert.equal(worklog.runs_today, 1);
  assert.equal(worklog.autonomy_rate, 100);
});

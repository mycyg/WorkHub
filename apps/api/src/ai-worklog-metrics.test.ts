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
    {
      readDay1MetricsRows: async () => rows,
      readAiWorklogRows: async () => ({
        agentRuns: rows.agentRuns,
        proposals: rows.proposals,
        skillCurationEvents: [
          { action: "team_skill.distilled_and_promoted" },
          { action: "team_skill.refined_via_patch" },
          { action: "team_skill.refined_via_patch" }
        ]
      })
    } as never,
    { now: () => now }
  );
  const worklog = await service.getTodayMetrics();
  assert.equal(worklog.runs_today, 1);
  assert.equal(worklog.autonomy_rate, 100);
  // R8：今日自进化计数从审计事件聚合（1 新增 + 2 精修）。
  assert.equal(worklog.skills_promoted_today, 1);
  assert.equal(worklog.skills_refined_today, 2);
});

test("createAiWorklogMetricsService passes start-of-today as the query lower bound", async () => {
  // L7：startOfToday 现在用 UTC 日界，断言改 UTC 且 now 带显式 Z，跨机器时区确定（CI/生产为 UTC）。
  const now = new Date("2026-06-14T12:00:00Z");
  let capturedSince: Date | undefined;
  const service = createAiWorklogMetricsService(
    {
      readDay1MetricsRows: async () => emptyRows(),
      readAiWorklogRows: async (since: Date) => {
        capturedSince = since;
        return { agentRuns: [], proposals: [], skillCurationEvents: [] };
      }
    } as never,
    { now: () => now }
  );
  await service.getTodayMetrics();
  assert.ok(capturedSince);
  assert.equal(capturedSince?.getUTCHours(), 0);
  assert.equal(capturedSince?.getUTCMinutes(), 0);
  assert.equal(capturedSince?.getUTCDate(), 14);
});

test("AUTHZ-2: getTodayMetrics scopes the worklog read by the caller's workspace", async () => {
  const now = new Date("2026-06-14T12:00:00Z");
  const DEFAULT_WS = "00000000-0000-4000-8000-000000000002";
  const OTHER_WS = "11111111-1111-4111-8111-111111111111";
  const captured: Array<unknown> = [];
  const make = () =>
    createAiWorklogMetricsService(
      {
        readDay1MetricsRows: async () => emptyRows(),
        readAiWorklogRows: async (_since: Date, scope?: unknown) => {
          captured.push(scope);
          return { agentRuns: [], proposals: [], skillCurationEvents: [] };
        }
      } as never,
      { now: () => now, defaultWorkspaceId: DEFAULT_WS }
    );

  // 1) 不传 workspaceId → 不收口（向后兼容旧调用/单测）。
  await make().getTodayMetrics();
  assert.equal(captured[0], undefined, "no workspaceId → unscoped read");

  // 2) 默认工作区 → 把未打标(NULL)历史行一并计入。
  await make().getTodayMetrics({ workspaceId: DEFAULT_WS });
  assert.deepEqual(
    captured[1],
    { workspaceId: DEFAULT_WS, includeUntagged: true },
    "default workspace includes untagged legacy rows"
  );

  // 3) 非默认工作区 → 只认显式打标行，NULL 不归你（闭合跨租户聚合泄露）。
  await make().getTodayMetrics({ workspaceId: OTHER_WS });
  assert.deepEqual(
    captured[2],
    { workspaceId: OTHER_WS, includeUntagged: false },
    "non-default workspace excludes untagged rows"
  );
});

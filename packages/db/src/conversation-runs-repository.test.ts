import assert from "node:assert/strict";
import test from "node:test";

import * as dbExports from "./index.js";
import {
  actionCardItems,
  agentRuns,
  agentSteps,
  branches,
  projectConversations,
  projects,
  proposals,
  workItemAssignments,
  workItems,
  workspaceMemberships
} from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryReferences,
  queryTextFragments
} from "./test-query-recorder.js";
import type { WorkHubDb } from "./client.js";
import type {
  ArmyOverviewListResult,
  ConversationRunListResult,
  ConversationRunOutputLinkResult
} from "./repositories/conversation-runs.js";

const workspaceId = "87000000-0000-4000-8000-000000000001";
const conversationId = "87000000-0000-4000-8000-000000000002";
const projectId = "87000000-0000-4000-8000-000000000003";
const viewerUserId = "87000000-0000-4000-8000-000000000004";
const otherUserId = "87000000-0000-4000-8000-000000000005";

function fixtureId(sequence: number) {
  return `87000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

type ConversationRunRepositoryLike = {
  listRunsForConversation(input: {
    workspaceId: string;
    viewerUserId: string;
    conversationId: string;
    limit?: number;
    cursor?: { createdAt: string; id: string };
  }): Promise<ConversationRunListResult | null>;
  listArmyOverviewForUser(input: {
    workspaceId: string;
    viewerUserId: string;
    limit?: number;
    cursor?: { createdAt: string; id: string };
  }): Promise<ArmyOverviewListResult>;
  listOutputLinksForConversation(input: {
    workspaceId: string;
    conversationId: string;
    limit?: number;
  }): Promise<ConversationRunOutputLinkResult>;
};

function repository(db: WorkHubDb): ConversationRunRepositoryLike {
  const factory = (dbExports as Record<string, unknown>).createConversationRunRepository;
  assert.equal(typeof factory, "function", "missing createConversationRunRepository export");
  return (factory as (database: WorkHubDb) => ConversationRunRepositoryLike)(db);
}

function accessRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    conversation: {
      id: conversationId,
      workspaceId,
      projectId,
      kind: "main",
      title: "星尘项目群聊",
      parentConversationId: null,
      sourceMessageId: null,
      visibility: "project",
      nextSeq: 12,
      createdBy: viewerUserId,
      deletedAt: null,
      deletedByUserId: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z")
    },
    projectOwnerUserId: viewerUserId,
    membershipRole: "member",
    participantRole: null,
    ...overrides
  };
}

function runRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: fixtureId(100),
    status: "running",
    title: "AI worker run",
    objectiveMd: "把第三节重写一遍",
    assigneeUserId: otherUserId,
    costEstimateCny: "0.032000",
    executionHint: "server",
    workItemId: fixtureId(200),
    sourceConversationId: conversationId,
    sourceActionCardItemId: fixtureId(300),
    recentStepJson: {
      phase: "tool_call",
      toolName: "search_docs",
      outputExcerpt: "找到 3 处引用",
      stepNo: 4
    },
    createdAt: new Date("2026-07-12T08:00:00.000Z"),
    updatedAt: new Date("2026-07-12T08:00:05.000Z"),
    cursorCreatedAt: "2026-07-12T08:00:00.000000Z",
    ...overrides
  };
}

test("listRunsForConversation reuses the conversation repository access judgment before listing runs", async () => {
  // R13 批 G1：findVisibleAccessRecord 现在附带一次 conversation_participants 的 count(*) 查询
  // （回话判定的 1:1 vs 小群维度，见 packages/db/src/repositories/conversations.ts 顶部注释）——
  // 这是本批改过的既有断言：queries.length 从 2 变成 3（仍是 O(1) 次固定查询，不是 N+1）。
  const { db, queries } = createQueryRecorder([[accessRow()], [{ value: 1 }], [runRow()]]);

  const result = await repository(db).listRunsForConversation({
    workspaceId,
    viewerUserId,
    conversationId,
    limit: 20
  });

  assert.ok(result);
  assert.equal(queries.length, 3, "must run the access check, its participant count, and one run list query, no N+1");
  const accessQuery = queries[0];
  assert.equal(accessQuery?.fromTable, projectConversations, "access check must reuse the conversations repo query");

  const runQuery = queries[2];
  assert.equal(runQuery?.fromTable, agentRuns);
  assert.deepEqual(runQuery?.joins.map((join) => [join.kind, join.table]), [["left", actionCardItems]]);
  assert.equal(runQuery?.limit, 21, "must fetch limit+1 to detect capped pages");
  for (const column of [agentRuns.workspaceId, agentRuns.sourceConversationId]) {
    assert.equal(queryReferences(runQuery?.where, column), true, `run query missing ${String(column)}`);
  }
  const params = queryParamValues(runQuery?.where);
  assert.ok(params.includes(workspaceId));
  assert.ok(params.includes(conversationId));
  assert.equal(runQuery?.orderBy.length, 2, "must order by created_at desc, id desc for stable cursor pagination");

  assert.equal(result?.capped, false);
  assert.equal(result?.nextCursor, null);
  assert.equal(result?.rows.length, 1);
  assert.equal(result?.projectId, projectId, "must surface the project id resolved by the access check, no extra query");
  const [card] = result!.rows;
  assert.equal(card?.id, fixtureId(100));
  assert.equal(card?.status, "running");
  assert.equal(card?.goalSummary, "把第三节重写一遍");
  assert.equal(card?.assigneeUserId, otherUserId);
  assert.equal(card?.costEstimateCny, "0.032000");
  assert.equal(card?.executionHint, "server");
  assert.deepEqual(card?.recentStep, {
    phase: "tool_call",
    toolName: "search_docs",
    outputExcerpt: "找到 3 处引用",
    stepNo: 4
  });
});

test("listRunsForConversation returns null and never queries agent_runs when the conversation is not visible", async () => {
  const { db, queries } = createQueryRecorder([[]]);

  const result = await repository(db).listRunsForConversation({
    workspaceId,
    viewerUserId,
    conversationId
  });

  assert.equal(result, null);
  assert.equal(queries.length, 1, "denied access must short-circuit before the run list query ever fires");
});

test("listRunsForConversation falls back the goal summary to the run title when objective_md is blank", async () => {
  const { db } = createQueryRecorder([
    [accessRow()],
    [{ value: 1 }],
    [runRow({ objectiveMd: null, title: "AI worker run", recentStepJson: null })]
  ]);

  const result = await repository(db).listRunsForConversation({ workspaceId, viewerUserId, conversationId });

  assert.equal(result?.rows[0]?.goalSummary, "AI worker run");
  assert.equal(result?.rows[0]?.recentStep, null);
});

test("listRunsForConversation drops a malformed recent-step payload instead of surfacing a half-built shape", async () => {
  const { db } = createQueryRecorder([
    [accessRow()],
    [{ value: 1 }],
    [runRow({ recentStepJson: { toolName: "search_docs" } })]
  ]);

  const result = await repository(db).listRunsForConversation({ workspaceId, viewerUserId, conversationId });

  assert.equal(result?.rows[0]?.recentStep, null, "missing phase/stepNo must not leak a broken recent-step object");
});

test("listRunsForConversation reports capped pages with a next cursor from the last included row", async () => {
  const rows = [
    runRow({ id: fixtureId(101), createdAt: new Date("2026-07-12T08:02:00.000Z"), cursorCreatedAt: "2026-07-12T08:02:00.000000Z" }),
    runRow({ id: fixtureId(102), createdAt: new Date("2026-07-12T08:01:00.000Z"), cursorCreatedAt: "2026-07-12T08:01:00.000000Z" }),
    runRow({ id: fixtureId(103), createdAt: new Date("2026-07-12T08:00:00.000Z"), cursorCreatedAt: "2026-07-12T08:00:00.000000Z" })
  ];
  const { db } = createQueryRecorder([[accessRow()], [{ value: 1 }], rows]);

  const result = await repository(db).listRunsForConversation({ workspaceId, viewerUserId, conversationId, limit: 2 });

  assert.equal(result?.rows.length, 2);
  assert.equal(result?.capped, true);
  assert.deepEqual(result?.nextCursor, { createdAt: "2026-07-12T08:01:00.000000Z", id: fixtureId(102) });
});

test("listRunsForConversation rejects out-of-range limits and malformed cursors before issuing any query", async () => {
  const { db, queries } = createQueryRecorder();
  const repo = repository(db);

  for (const limit of [0, 51, 1.5]) {
    await assert.rejects(
      repo.listRunsForConversation({ workspaceId, viewerUserId, conversationId, limit }),
      { name: "ConversationRunRepositoryInputError" }
    );
  }
  await assert.rejects(
    repo.listRunsForConversation({
      workspaceId,
      viewerUserId,
      conversationId,
      cursor: { createdAt: "not-a-timestamp", id: fixtureId(1) }
    }),
    { name: "ConversationRunRepositoryInputError" }
  );
  await assert.rejects(
    repo.listRunsForConversation({
      workspaceId,
      viewerUserId,
      conversationId,
      cursor: { createdAt: "2026-07-12T08:00:00.000000Z", id: "not-a-uuid" }
    }),
    { name: "ConversationRunRepositoryInputError" }
  );
  assert.equal(queries.length, 0, "input validation must fail before any DB round trip");
});

test("listArmyOverviewForUser bakes workspace membership into a single query, no N+1 across projects", async () => {
  const { db, queries } = createQueryRecorder([[
    { ...runRow(), projectId, projectName: "星尘短剧" }
  ]]);

  const result = await repository(db).listArmyOverviewForUser({ workspaceId, viewerUserId, limit: 20 });

  assert.equal(queries.length, 1, "army overview must be one SQL statement, not one per project or per run");
  const query = queries[0];
  assert.equal(query?.fromTable, agentRuns);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["inner", workItems],
    ["inner", projects],
    ["inner", workspaceMemberships],
    ["left", actionCardItems]
  ]);
  for (const column of [agentRuns.workspaceId, workItems.workspaceId, projects.workspaceId, agentRuns.actorUserId, actionCardItems.assigneeUserId]) {
    assert.equal(queryReferences(query?.where, column), true, `army overview where clause missing a reference`);
  }
  // Membership fencing lives in the JOIN's ON clause (that's what makes it "baked into SQL" rather than a
  // post-hoc filter) — assert it there, not in WHERE.
  const membershipJoin = query?.joins[2];
  assert.equal(membershipJoin?.table, workspaceMemberships);
  for (const column of [workspaceMemberships.workspaceId, workspaceMemberships.userId, workspaceMemberships.deletedAt]) {
    assert.equal(queryReferences(membershipJoin?.on, column), true, `membership join ON clause missing a reference`);
  }
  assert.match(queryTextFragments(query?.where).join(" "), /exists/iu, "assignment fallback must use EXISTS, not a post-hoc filter");
  const params = queryParamValues(query?.where);
  assert.ok(params.includes(workspaceId));
  assert.ok(params.includes(viewerUserId));

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.projectId, projectId);
  assert.equal(result.rows[0]?.projectName, "星尘短剧");
});

test("listArmyOverviewForUser rejects out-of-range limits and malformed cursors before issuing any query", async () => {
  const { db, queries } = createQueryRecorder();
  const repo = repository(db);

  for (const limit of [0, 51]) {
    await assert.rejects(
      repo.listArmyOverviewForUser({ workspaceId, viewerUserId, limit }),
      { name: "ConversationRunRepositoryInputError" }
    );
  }
  assert.equal(queries.length, 0);
});

test("listOutputLinksForConversation joins proposals through branches to the run's source conversation in one query", async () => {
  const { db, queries } = createQueryRecorder([[
    {
      proposalId: fixtureId(400),
      workItemId: fixtureId(200),
      runId: fixtureId(100),
      title: "重写第三节",
      status: "opened",
      updatedAt: new Date("2026-07-12T08:05:00.000Z")
    }
  ]]);

  const result = await repository(db).listOutputLinksForConversation({ workspaceId, conversationId, limit: 20 });

  assert.equal(queries.length, 1);
  const query = queries[0];
  assert.equal(query?.fromTable, proposals);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["inner", branches],
    ["inner", agentRuns]
  ]);
  for (const column of [agentRuns.workspaceId, agentRuns.sourceConversationId]) {
    assert.equal(queryReferences(query?.where, column), true, `output link query missing ${String(column)}`);
  }
  assert.equal(result.capped, false);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.proposalId, fixtureId(400));
});

test("listOutputLinksForConversation rejects out-of-range limits before issuing any query", async () => {
  const { db, queries } = createQueryRecorder();
  await assert.rejects(
    repository(db).listOutputLinksForConversation({ workspaceId, conversationId, limit: 51 }),
    { name: "ConversationRunRepositoryInputError" }
  );
  assert.equal(queries.length, 0);
});

test("R12 batch5 conversation-run repository real PostgreSQL matrix", {
  skip: process.env.WORKHUB_R12_CONVERSATION_RUNS_REAL_PG !== "1",
  timeout: 1
}, () => {
  // Env-gated, opt-in real-PG matrix intentionally not implemented in this read-side slice (see
  // r12-desktop-workbench/reports/batch-5-server-read.md for the documented gap). The recorder-based
  // tests above cover query shape, N+1 avoidance, auth short-circuiting, and JS-side row normalization;
  // they do not exercise real Postgres semantics for jsonb_build_object/coalesce/to_char. Flip this
  // env var only once that follow-up matrix (fixtures + migrate + scratch DB guard) is written.
  assert.fail("real-PG matrix for conversation-runs is not implemented yet — see batch-5-server-read.md");
});

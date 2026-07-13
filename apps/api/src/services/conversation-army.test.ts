import assert from "node:assert/strict";
import test from "node:test";

import type {
  ArmyOverviewListResult,
  ArmyOverviewRunCardRow,
  ConversationRunCardRow,
  ConversationRunListResult,
  ConversationRunOutputLinkResult
} from "@workhub/db";
import { catCodename } from "@workhub/contracts";

import type { AuthActor } from "../middleware/auth.js";
import { InternalContractError } from "../pages/output-contract.js";
import {
  ConversationArmyServiceError,
  createConversationArmyService,
  type ConversationArmyRepositorySources
} from "./conversation-army.js";

const now = new Date("2026-07-12T09:15:00.000Z");
const workspaceId = "32000000-0000-4000-8000-000000000001";
const conversationId = "32000000-0000-4000-8000-000000000002";
const projectId = "32000000-0000-4000-8000-000000000003";
const runId = "32000000-0000-4000-8000-000000000004";
const workItemId = "32000000-0000-4000-8000-000000000005";
const proposalId = "32000000-0000-4000-8000-000000000006";
const userId = "32000000-0000-4000-8000-000000000007";

function nonHumanActor(): AuthActor {
  return {
    kind: "ai",
    id: userId,
    label: "r12-army-actor",
    isAdmin: false,
    orgId: "32000000-0000-4000-8000-000000000000",
    workspaceId
  };
}

function humanActor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: userId,
    label: "r12-army-actor",
    userId,
    isAdmin: false,
    orgId: "32000000-0000-4000-8000-000000000000",
    workspaceId,
    ...overrides
  };
}

function runCardRow(overrides: Partial<ConversationRunCardRow> = {}): ConversationRunCardRow {
  return {
    id: runId,
    status: "running",
    goalSummary: "把第三节重写一遍",
    assigneeUserId: userId,
    costEstimateCny: "0.032000",
    executionHint: "server",
    workItemId,
    sourceConversationId: conversationId,
    sourceActionCardItemId: null,
    recentStep: { phase: "tool_call", toolName: "search_docs", outputExcerpt: "找到 3 处引用", stepNo: 4 },
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function repo(overrides: Partial<ConversationArmyRepositorySources> = {}): ConversationArmyRepositorySources {
  return {
    async listRunsForConversation(): Promise<ConversationRunListResult | null> {
      return { rows: [runCardRow()], capped: false, nextCursor: null, projectId };
    },
    async listArmyOverviewForUser(): Promise<ArmyOverviewListResult> {
      const row: ArmyOverviewRunCardRow = { ...runCardRow(), projectId, projectName: "星尘短剧" };
      return { rows: [row], capped: false, nextCursor: null };
    },
    async listOutputLinksForConversation(): Promise<ConversationRunOutputLinkResult> {
      return {
        rows: [{ proposalId, workItemId, runId, title: "重写第三节", status: "opened", updatedAt: now, diffStatsJson: null }],
        capped: false
      };
    },
    ...overrides
  };
}

function defaultQuery() {
  return { limit: 20 } as const;
}

test("conversationArmyPanel assembles runs, outputs, and an honest empty background-tasks section", async () => {
  const service = createConversationArmyService({ repo: repo(), now: () => now });

  const panel = await service.conversationArmyPanel({
    actor: humanActor(),
    conversationId,
    query: defaultQuery()
  });

  assert.equal(panel.conversation_id, conversationId);
  assert.equal(panel.project_id, projectId);
  assert.equal(panel.runs.runs.length, 1);
  const [card] = panel.runs.runs;
  assert.equal(card?.id, runId);
  assert.equal(card?.status, "running");
  assert.equal(card?.goal_summary, "把第三节重写一遍");
  assert.equal(card?.assignee_user_id, userId);
  assert.equal(card?.cost_cny, "0.032000");
  assert.equal(card?.execution_hint, "server");
  assert.equal(card?.cat_codename, catCodename(runId), "cat codename must match the pure function for this run id");
  assert.deepEqual(card?.recent_step, {
    phase: "tool_call",
    tool_name: "search_docs",
    output_excerpt: "找到 3 处引用",
    step_no: 4
  });
  assert.equal(panel.runs.capped, false);
  assert.equal(panel.runs.next_cursor, null);
  assert.equal("empty_state" in panel.runs, false);

  assert.equal(panel.outputs.items.length, 1);
  assert.deepEqual(panel.outputs.items[0], {
    proposal_id: proposalId,
    work_item_id: workItemId,
    run_id: runId,
    title: "重写第三节",
    status: "opened",
    proposal_href: `/proposals/${proposalId}`,
    updated_at: now.toISOString()
  });

  // 后台任务区没有真数据源:永远空数组 + not_yet_available,不拿别的数据冒充。
  assert.deepEqual(panel.background_tasks, { items: [], empty_state: "not_yet_available" });
});

// R13 批 P1.5（右栏变动文件区）：diff_stats_json 非空时映射出 changed_files；为 null（历史 proposal/
// 还没跑过统计）时整个字段不出现，不冒充空数组——两条断言分别钉死这两半。
test("conversationArmyPanel maps a populated diff_stats_json onto changed_files, keeping adds/dels absent when a file couldn't be diffed", async () => {
  const service = createConversationArmyService({
    repo: repo({
      async listOutputLinksForConversation() {
        return {
          rows: [{
            proposalId,
            workItemId,
            runId,
            title: "重写第三节",
            status: "opened",
            updatedAt: now,
            diffStatsJson: {
              total: { adds: 3, dels: 1 },
              files: [
                { change_id: "change-1", path: "/outputs/result.md", change_type: "updated", adds: 3, dels: 1 },
                { change_id: "change-2", change_type: "generated" }
              ]
            }
          }],
          capped: false
        };
      }
    }),
    now: () => now
  });

  const panel = await service.conversationArmyPanel({ actor: humanActor(), conversationId, query: defaultQuery() });

  assert.deepEqual(panel.outputs.items[0]?.changed_files, [
    { path: "/outputs/result.md", change_type: "updated", adds: 3, dels: 1 },
    { change_type: "generated" }
  ]);
});

test("conversationArmyPanel omits changed_files entirely for a proposal with no diff stats yet (honest 'unavailable', not a faked empty list)", async () => {
  const service = createConversationArmyService({ repo: repo(), now: () => now });

  const panel = await service.conversationArmyPanel({ actor: humanActor(), conversationId, query: defaultQuery() });

  assert.equal("changed_files" in (panel.outputs.items[0] ?? {}), false);
});

test("conversationArmyPanel sets no_army_runs only when the run list is actually empty", async () => {
  const service = createConversationArmyService({
    repo: repo({
      async listRunsForConversation() {
        return { rows: [], capped: false, nextCursor: null, projectId };
      },
      async listOutputLinksForConversation() {
        return { rows: [], capped: false };
      }
    }),
    now: () => now
  });

  const panel = await service.conversationArmyPanel({ actor: humanActor(), conversationId, query: defaultQuery() });

  assert.equal(panel.runs.runs.length, 0);
  assert.equal(panel.runs.empty_state, "no_army_runs");
});

test("conversationArmyPanel 404s uniformly when the repository denies access, without leaking why", async () => {
  const service = createConversationArmyService({
    repo: repo({
      async listRunsForConversation() {
        return null;
      }
    })
  });

  await assert.rejects(
    service.conversationArmyPanel({ actor: humanActor(), conversationId, query: defaultQuery() }),
    (error: unknown) => {
      assert.ok(error instanceof ConversationArmyServiceError);
      assert.equal(error.status, 404);
      assert.equal(error.code, "conversation_army_not_found");
      return true;
    }
  );
});

test("conversationArmyPanel 404s for non-human actors before ever touching the repository", async () => {
  let calls = 0;
  const service = createConversationArmyService({
    repo: repo({
      async listRunsForConversation() {
        calls += 1;
        return { rows: [], capped: false, nextCursor: null, projectId };
      }
    })
  });

  await assert.rejects(
    service.conversationArmyPanel({
      actor: nonHumanActor(),
      conversationId,
      query: defaultQuery()
    }),
    { name: "ConversationArmyServiceError" }
  );
  assert.equal(calls, 0, "a non-human actor must be rejected before any repository read");
});

test("conversationArmyPanel forwards a query cursor only when both halves are present", async () => {
  const seen: unknown[] = [];
  const service = createConversationArmyService({
    repo: repo({
      async listRunsForConversation(input) {
        seen.push(input);
        return { rows: [], capped: false, nextCursor: null, projectId };
      },
      async listOutputLinksForConversation() {
        return { rows: [], capped: false };
      }
    })
  });

  await service.conversationArmyPanel({
    actor: humanActor(),
    conversationId,
    query: { limit: 10, afterCreatedAt: "2026-07-12T08:00:00.000000Z", afterId: runId }
  });

  assert.equal(seen.length, 1);
  const call = seen[0] as { cursor?: { createdAt: string; id: string } };
  assert.deepEqual(call.cursor, { createdAt: "2026-07-12T08:00:00.000000Z", id: runId });
});

test("armyOverview carries project grouping fields through and defaults the empty state correctly", async () => {
  const service = createConversationArmyService({ repo: repo(), now: () => now });

  const overview = await service.armyOverview({ actor: humanActor(), query: defaultQuery() });

  assert.equal(overview.viewer_user_id, userId);
  assert.equal(overview.runs.runs.length, 1);
  assert.equal(overview.runs.runs[0]?.project_id, projectId);
  assert.equal(overview.runs.runs[0]?.project_name, "星尘短剧");
  assert.equal("empty_state" in overview.runs, false);
});

test("armyOverview reports no_army_runs when there is nothing to show", async () => {
  const service = createConversationArmyService({
    repo: repo({
      async listArmyOverviewForUser() {
        return { rows: [], capped: false, nextCursor: null };
      }
    }),
    now: () => now
  });

  const overview = await service.armyOverview({ actor: humanActor(), query: defaultQuery() });

  assert.equal(overview.runs.runs.length, 0);
  assert.equal(overview.runs.empty_state, "no_army_runs");
});

test("a malformed repository row fails closed as an InternalContractError, not a 200 with garbage", async () => {
  const service = createConversationArmyService({
    repo: repo({
      async listArmyOverviewForUser() {
        const row = { ...runCardRow(), status: "not_a_real_status", projectId, projectName: "星尘短剧" } as unknown as ArmyOverviewRunCardRow;
        return { rows: [row], capped: false, nextCursor: null };
      }
    })
  });

  await assert.rejects(
    service.armyOverview({ actor: humanActor(), query: defaultQuery() }),
    (error: unknown) => error instanceof InternalContractError
  );
});

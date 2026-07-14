import assert from "node:assert/strict";
import test from "node:test";

import { HTTPException } from "hono/http-exception";

import { searchResultsVmSchema } from "@workhub/contracts";
import type {
  ConversationSearchRow,
  DriveSearchRow,
  MeetingSearchRow,
  SearchRepository,
  SearchScopeQuery,
  WorkItemSearchRow
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import {
  buildLikePattern,
  buildSnippet,
  clampSearchLimit,
  createSearchService,
  escapeLikePattern,
  parseSearchScopes,
  validateSearchQuery
} from "./search.js";

// R14 批 SEARCH 服务层穷举单测（无 DB）：纯函数（q/scopes/limit 校验、LIKE 转义、snippet）+ 服务编排
// （limit+1 探测 has_more、固定 scope 顺序、只返回请求的 scope、空结果诚实、VM 契约）。
// 墓碑滤除 / 个人空间围栏 / assignee EXISTS 等 SQL 层围栏行为在真库冒烟 qa/r14-search-smoke.ts 里断言。

const actor: AuthActor = {
  kind: "human",
  id: "11111111-1111-4111-8111-111111111111",
  label: "阿珍",
  userId: "11111111-1111-4111-8111-111111111111",
  isAdmin: false,
  orgId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333"
};

// ── q 校验（CJK 2 字 / ≥3 字 / 越界 / trim）─────────────────────────────────
test("validateSearchQuery accepts a 2-character CJK word (the min boundary is inclusive)", () => {
  assert.equal(validateSearchQuery("预算"), "预算");
});

test("validateSearchQuery accepts a >=3 character query", () => {
  assert.equal(validateSearchQuery("完播率"), "完播率");
});

test("validateSearchQuery trims surrounding whitespace before measuring length", () => {
  assert.equal(validateSearchQuery("  预算  "), "预算");
});

test("validateSearchQuery 400s a single-character query (below the 2-char floor)", () => {
  assert.throws(
    () => validateSearchQuery("预"),
    (error: unknown) => error instanceof HTTPException && error.status === 400
  );
});

test("validateSearchQuery 400s a blank/whitespace-only query", () => {
  assert.throws(
    () => validateSearchQuery("   "),
    (error: unknown) => error instanceof HTTPException && error.status === 400
  );
  assert.throws(
    () => validateSearchQuery(undefined),
    (error: unknown) => error instanceof HTTPException && error.status === 400
  );
});

test("validateSearchQuery 400s a query longer than 64 characters", () => {
  assert.throws(
    () => validateSearchQuery("字".repeat(65)),
    (error: unknown) => error instanceof HTTPException && error.status === 400
  );
  assert.equal(validateSearchQuery("字".repeat(64)).length, 64);
});

// ── LIKE 元字符转义 ─────────────────────────────────────────────────────────
test("escapeLikePattern escapes backslash first, then % and _", () => {
  assert.equal(escapeLikePattern("50%"), "50\\%");
  assert.equal(escapeLikePattern("a_b"), "a\\_b");
  assert.equal(escapeLikePattern("c:\\x"), "c:\\\\x");
  assert.equal(escapeLikePattern("100%_\\done"), "100\\%\\_\\\\done");
});

test("buildLikePattern wraps the escaped query in contains wildcards", () => {
  assert.equal(buildLikePattern("预算"), "%预算%");
  assert.equal(buildLikePattern("50%"), "%50\\%%");
});

// ── snippet 纯函数 ──────────────────────────────────────────────────────────
test("buildSnippet returns the full text when short and the match is present", () => {
  assert.equal(buildSnippet("这季度的预算还没批", "预算"), "这季度的预算还没批");
});

test("buildSnippet opens a window with ellipses around a mid-text match", () => {
  const text = `${"甲".repeat(100)}预算${"乙".repeat(100)}`;
  const snippet = buildSnippet(text, "预算");
  assert.ok(snippet.startsWith("…"), "leading ellipsis when clipped at the head");
  assert.ok(snippet.endsWith("…"), "trailing ellipsis when clipped at the tail");
  assert.ok(snippet.includes("预算"), "the match itself is inside the window");
  assert.ok(snippet.length <= 160 + 2, "snippet body is capped (plus up to two ellipses)");
});

test("buildSnippet does not add a leading ellipsis when the match is at the start", () => {
  const text = `预算${"乙".repeat(200)}`;
  const snippet = buildSnippet(text, "预算");
  assert.ok(!snippet.startsWith("…"), "no leading ellipsis at the head");
  assert.ok(snippet.endsWith("…"), "trailing ellipsis because the tail is clipped");
});

test("buildSnippet collapses whitespace/newlines so markdown minutes stay readable", () => {
  assert.equal(buildSnippet("第一行\n\n  预算口径统一\t为一致", "预算"), "第一行 预算口径统一 为一致");
});

test("buildSnippet returns empty string for empty text and never throws on null", () => {
  assert.equal(buildSnippet("", "预算"), "");
  assert.equal(buildSnippet(null, "预算"), "");
  assert.equal(buildSnippet(undefined, "预算"), "");
});

test("buildSnippet degrades to a leading window when the query is absent from the text", () => {
  const text = "丙".repeat(300);
  const snippet = buildSnippet(text, "预算");
  assert.ok(snippet.endsWith("…"));
  assert.ok(snippet.length <= 160 + 1);
});

// ── scopes 校验 ─────────────────────────────────────────────────────────────
test("parseSearchScopes defaults to all four scopes in fixed order when omitted", () => {
  assert.deepEqual(parseSearchScopes(undefined), ["conversations", "drive", "work_items", "meetings"]);
});

test("parseSearchScopes accepts a valid subset and returns it in fixed scope order", () => {
  assert.deepEqual(parseSearchScopes("meetings,conversations"), ["conversations", "meetings"]);
});

test("parseSearchScopes drops unknown values when at least one valid value remains", () => {
  assert.deepEqual(parseSearchScopes("drive,bogus,work_items"), ["drive", "work_items"]);
});

test("parseSearchScopes dedupes repeated scopes", () => {
  assert.deepEqual(parseSearchScopes("drive,drive,conversations"), ["conversations", "drive"]);
});

test("parseSearchScopes 400s when scopes is present but has no valid value (including empty string)", () => {
  for (const raw of ["", "bogus", ",,", "unknown,other"]) {
    assert.throws(
      () => parseSearchScopes(raw),
      (error: unknown) => error instanceof HTTPException && error.status === 400,
      `expected 400 for scopes=${JSON.stringify(raw)}`
    );
  }
});

// ── limit 夹紧 ──────────────────────────────────────────────────────────────
test("clampSearchLimit defaults to 10 and clamps into [1,25]", () => {
  assert.equal(clampSearchLimit(undefined), 10);
  assert.equal(clampSearchLimit(""), 10);
  assert.equal(clampSearchLimit("not-a-number"), 10);
  assert.equal(clampSearchLimit("0"), 1);
  assert.equal(clampSearchLimit("7"), 7);
  assert.equal(clampSearchLimit("999"), 25);
  assert.equal(clampSearchLimit(-5), 1);
});

// ── 服务编排（fake repo）────────────────────────────────────────────────────
function conversationRow(overrides: Partial<ConversationSearchRow> = {}): ConversationSearchRow {
  return {
    messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    conversationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    projectName: "增长项目",
    conversationTitle: "主群聊",
    seq: 128,
    senderType: "user",
    senderUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    senderLabel: "阿珍",
    text: "这季度的预算还没批",
    createdAt: new Date("2026-07-14T09:00:00.000Z"),
    ...overrides
  };
}

function driveRow(overrides: Partial<DriveSearchRow> = {}): DriveSearchRow {
  return {
    itemId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    projectName: "增长项目",
    name: "Q3预算.xlsx",
    kind: "file",
    parsedText: null,
    updatedAt: new Date("2026-07-14T08:00:00.000Z"),
    ...overrides
  };
}

function workItemRow(overrides: Partial<WorkItemSearchRow> = {}): WorkItemSearchRow {
  return {
    workItemId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    code: "WI-42",
    projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    projectName: "增长项目",
    title: "编制预算表",
    rawDescription: "把三个口径合到一张预算表里",
    status: "ai_working",
    updatedAt: new Date("2026-07-14T07:00:00.000Z"),
    ...overrides
  };
}

function meetingRow(overrides: Partial<MeetingSearchRow> = {}): MeetingSearchRow {
  return {
    meetingId: "99999999-9999-4999-8999-999999999999",
    projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    projectName: "增长项目",
    title: "季度评审",
    minutesMd: "## 结论\n预算口径统一为一致",
    status: "ready",
    createdAt: new Date("2026-07-14T06:00:00.000Z"),
    ...overrides
  };
}

type RepoCall = { scope: string; input: SearchScopeQuery };

function fakeRepo(
  data: {
    conversations?: ConversationSearchRow[];
    drive?: DriveSearchRow[];
    workItems?: WorkItemSearchRow[];
    meetings?: MeetingSearchRow[];
  },
  calls: RepoCall[]
): SearchRepository {
  return {
    async searchConversations(input) {
      calls.push({ scope: "conversations", input });
      return data.conversations ?? [];
    },
    async searchDrive(input) {
      calls.push({ scope: "drive", input });
      return data.drive ?? [];
    },
    async searchWorkItems(input) {
      calls.push({ scope: "work_items", input });
      return data.workItems ?? [];
    },
    async searchMeetings(input) {
      calls.push({ scope: "meetings", input });
      return data.meetings ?? [];
    }
  };
}

test("search returns groups in fixed scope order and only for requested scopes", async () => {
  const calls: RepoCall[] = [];
  const service = createSearchService(fakeRepo({}, calls));
  const vm = await service.search({ actor, q: "预算", scopes: "meetings,drive" });
  assert.deepEqual(vm.groups.map((group) => group.scope), ["drive", "meetings"]);
  assert.deepEqual(calls.map((call) => call.scope).sort(), ["drive", "meetings"]);
  // conversations/work_items not requested → their repo methods are never called.
  assert.equal(calls.some((call) => call.scope === "conversations"), false);
});

test("search passes an escaped contains pattern and a limit+1 fetch to the repository", async () => {
  const calls: RepoCall[] = [];
  const service = createSearchService(fakeRepo({}, calls));
  await service.search({ actor, q: "50%", scopes: "drive", limit: "5" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.input.pattern, "%50\\%%");
  assert.equal(calls[0]!.input.limit, 6, "repo is asked for clamped limit + 1 to probe has_more");
  assert.equal(calls[0]!.input.actor.userId, actor.userId);
  assert.equal(calls[0]!.input.actor.workspaceId, actor.workspaceId);
});

test("search sets has_more and trims the extra probe row when the repo returns limit+1 rows", async () => {
  const calls: RepoCall[] = [];
  const rows = Array.from({ length: 3 }, (_, index) =>
    driveRow({ itemId: `e0000000-0000-4000-8000-00000000000${index}`, name: `预算-${index}.xlsx` })
  );
  const service = createSearchService(fakeRepo({ drive: rows }, calls));
  const vm = await service.search({ actor, q: "预算", scopes: "drive", limit: 2 });
  const group = vm.groups[0]!;
  assert.equal(group.scope, "drive");
  assert.equal(group.has_more, true, "3 rows for a limit of 2 → has_more");
  assert.equal(group.results.length, 2, "the extra probe row is dropped");
});

test("search reports empty groups honestly (results:[] / has_more:false), no scaffolding", async () => {
  const calls: RepoCall[] = [];
  const service = createSearchService(fakeRepo({}, calls));
  const vm = await service.search({ actor, q: "查无此词" });
  assert.equal(vm.groups.length, 4);
  for (const group of vm.groups) {
    assert.deepEqual(group.results, []);
    assert.equal(group.has_more, false);
  }
});

test("search assembles a contract-valid VM across all four scopes with correct matched_in/deep_link", async () => {
  const calls: RepoCall[] = [];
  const service = createSearchService(
    fakeRepo(
      {
        conversations: [conversationRow()],
        drive: [driveRow(), driveRow({ itemId: "e1111111-1111-4111-8111-111111111111", name: "计划.txt", parsedText: "这里提到预算口径" })],
        workItems: [workItemRow(), workItemRow({ workItemId: "f1111111-1111-4111-8111-111111111111", title: "补充说明", rawDescription: "涉及预算的一段描述" })],
        meetings: [meetingRow()]
      },
      calls
    )
  );
  const vm = await service.search({ actor, q: "预算", limit: 10 });
  // contract holds under the strict discriminated-union schema.
  assert.doesNotThrow(() => searchResultsVmSchema.parse(vm));
  assert.equal(vm.query, "预算");

  const conversation = vm.groups.find((group) => group.scope === "conversations")!;
  const conversationResult = conversation.results[0]!;
  assert.equal(conversationResult.matched_in, "text");
  assert.deepEqual(conversationResult.deep_link, {
    project_id: conversationResult.project_id,
    conversation_id: conversationResult.conversation_id,
    seq: conversationResult.seq
  });
  assert.ok(conversationResult.snippet.includes("预算"));

  const drive = vm.groups.find((group) => group.scope === "drive")!;
  assert.equal(drive.results[0]!.matched_in, "name", "name hit takes precedence and snippet is the name");
  assert.equal(drive.results[0]!.snippet, "Q3预算.xlsx");
  assert.equal(drive.results[1]!.matched_in, "body", "no name hit → body match with a built snippet");
  assert.ok(drive.results[1]!.snippet.includes("预算"));

  const workItems = vm.groups.find((group) => group.scope === "work_items")!;
  assert.equal(workItems.results[0]!.matched_in, "title");
  assert.equal(workItems.results[1]!.matched_in, "description");

  const meetings = vm.groups.find((group) => group.scope === "meetings")!;
  // title "季度评审" 无 "预算" → 命中在 minutes（正文），snippet 从 minutes_md 开窗。
  assert.equal(meetings.results[0]!.matched_in, "minutes");
  assert.ok(meetings.results[0]!.snippet.includes("预算"));
});

test("search maps an admin actor's tenant into the repository scope", async () => {
  const calls: RepoCall[] = [];
  const service = createSearchService(fakeRepo({}, calls));
  const adminActor: AuthActor = { ...actor, isAdmin: true };
  await service.search({ actor: adminActor, q: "预算", scopes: "work_items" });
  assert.equal(calls[0]!.input.actor.isAdmin, true);
  assert.equal(calls[0]!.input.actor.orgId, adminActor.orgId);
});

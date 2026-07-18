import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceMembershipRepository } from "./repositories/memberships.js";
import { users, workspaceMemberships } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

// R20 P2A（P1-08 修复 · workspace-scoped roster）：memberships.listActiveRosterPageByWorkspace 的 SQL 形状门。
// 用假 DB（记录查询形状 + 回放 seeded 行）验证：工作区隔离、双软删排除、分页 limit/offset 而非硬 200 截断、
// 稳定排序、总数与取页同口径。真实过滤在真 PG（qa smoke）覆盖；此处只钉查询正确构造。

const WS = "20000000-0000-4000-8000-0000000000a1";

const rowA = {
  userId: "20000000-0000-4000-8000-0000000000b1",
  nickname: "阿黄",
  role: "owner" as const,
  joinedAt: new Date("2026-07-01T00:00:00.000Z"),
  avatarUpdatedAt: new Date("2026-07-10T00:00:00.000Z"),
  isAdmin: true
};
const rowB = {
  userId: "20000000-0000-4000-8000-0000000000b2",
  nickname: "小赵",
  role: "member" as const,
  joinedAt: new Date("2026-07-02T00:00:00.000Z"),
  avatarUpdatedAt: null,
  isAdmin: false
};

test("roster page scopes to the workspace, excludes soft-deleted, joins users and paginates", async () => {
  const { db, queries } = createQueryRecorder([[{ total: 3 }], [rowA, rowB]]);
  const repo = createWorkspaceMembershipRepository(db);
  const listRoster = repo.listActiveRosterPageByWorkspace;
  assert.ok(listRoster, "concrete repository implements the optional roster method");

  const result = await listRoster(WS, { limit: 2, offset: 4 });

  // 映射正确：总数来自计数查询，成员含头像时间戳占位（含 null）+ isAdmin 全局管理员标签。
  assert.equal(result.total, 3);
  assert.deepEqual(result.members, [
    { userId: rowA.userId, nickname: rowA.nickname, role: "owner", joinedAt: rowA.joinedAt, avatarUpdatedAt: rowA.avatarUpdatedAt, isAdmin: true },
    { userId: rowB.userId, nickname: rowB.nickname, role: "member", joinedAt: rowB.joinedAt, avatarUpdatedAt: null, isAdmin: false }
  ]);

  const [countQuery, pageQuery] = queries;
  // 计数查询：join users、按工作区隔离、不带 limit（总数不能被封顶——否则「计数错」重现）。
  assert.ok(countQuery, "count query recorded first");
  assert.ok(
    countQuery.joins.some((join) => join.table === users),
    "count query inner-joins users"
  );
  assert.equal(countQuery.limit, undefined, "count query must not be capped");
  assert.ok(queryParamValues(countQuery.where).includes(WS), "count query binds the workspace id");

  // 取页查询：join users、WHERE 绑定 workspaceId + 排除 membership/user 双软删、排序、分页 limit/offset、
  // 且实际选取 users.isAdmin 列（R20 P1-08 收尾：roster 行补管理员标签）。
  assert.ok(pageQuery, "page query recorded second");
  assert.ok(
    pageQuery.joins.some((join) => join.table === users),
    "page query inner-joins users"
  );
  assert.equal(
    (pageQuery.selection as { isAdmin?: unknown } | undefined)?.isAdmin,
    users.isAdmin,
    "page query selects users.isAdmin so the roster row can carry the global admin label"
  );
  assert.ok(
    queryReferences(pageQuery.where, workspaceMemberships.workspaceId),
    "page query filters by workspace membership workspace id (tenant isolation)"
  );
  assert.ok(
    queryReferences(pageQuery.where, workspaceMemberships.deletedAt),
    "page query excludes soft-deleted memberships"
  );
  assert.ok(
    queryReferences(pageQuery.where, users.deletedAt),
    "page query excludes soft-deleted users"
  );
  assert.ok(queryParamValues(pageQuery.where).includes(WS), "page query binds the workspace id");
  assert.ok(pageQuery.steps.includes("orderBy"), "page query orders for a stable pagination sort");
  assert.equal(pageQuery.limit, 2, "page query applies the requested page size");
  assert.equal(pageQuery.offset, 4, "page query applies the requested offset");
});

test("roster page size is never hard-capped at 200 (reachable past the /api/users truncation)", async () => {
  const { db, queries } = createQueryRecorder([[{ total: 250 }], []]);
  const repo = createWorkspaceMembershipRepository(db);
  const listRoster = repo.listActiveRosterPageByWorkspace;
  assert.ok(listRoster, "concrete repository implements the optional roster method");

  // 请求一个远超 200 的 limit + 深 offset：若仓库像 users.listActiveRefs 那样硬 .limit(200) 就会在这里现形。
  const result = await listRoster(WS, { limit: 500, offset: 400 });

  assert.equal(result.total, 250, "total reflects the workspace count, not a 200 cap");
  const pageQuery = queries[1];
  assert.ok(pageQuery, "page query recorded");
  assert.equal(pageQuery.limit, 500, "repository does not clamp the page size to 200");
  assert.equal(pageQuery.offset, 400, "deep offsets pass through so every member is reachable by paging");
});

test("roster page defensively floors illegal limit/offset", async () => {
  const { db, queries } = createQueryRecorder([[{ total: 0 }], []]);
  const repo = createWorkspaceMembershipRepository(db);
  const listRoster = repo.listActiveRosterPageByWorkspace;
  assert.ok(listRoster, "concrete repository implements the optional roster method");

  await listRoster(WS, { limit: -3, offset: -10 });

  const pageQuery = queries[1];
  assert.ok(pageQuery, "page query recorded");
  assert.equal(pageQuery.limit, 1, "non-positive limit floors to 1");
  assert.equal(pageQuery.offset, 0, "negative offset floors to 0");
});

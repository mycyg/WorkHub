import assert from "node:assert/strict";
import test from "node:test";

import {
  workspaceRosterMemberVmSchema,
  workspaceRosterQuerySchema,
  workspaceRosterResultVmSchema
} from "./auth.js";

// R20 P2A（P1-08 修复 · workspace-scoped roster）：分页查询参数 + 响应 VM 的契约门。

test("roster query defaults to limit 50 / offset 0 when unspecified", () => {
  assert.deepEqual(workspaceRosterQuerySchema.parse({}), { limit: 50, offset: 0 });
  assert.deepEqual(workspaceRosterQuerySchema.parse({ limit: undefined, offset: undefined }), { limit: 50, offset: 0 });
});

test("roster query coerces string query params into bounded integers", () => {
  assert.deepEqual(workspaceRosterQuerySchema.parse({ limit: "20", offset: "40" }), { limit: 20, offset: 40 });
});

test("roster query falls back to defaults on illegal / out-of-range params instead of throwing", () => {
  // 只读列表不因坏参数 422 阻断——越界/非数值一律回退默认（.catch）。
  assert.deepEqual(workspaceRosterQuerySchema.parse({ limit: "999" }), { limit: 50, offset: 0 });
  assert.deepEqual(workspaceRosterQuerySchema.parse({ limit: "0" }), { limit: 50, offset: 0 });
  assert.deepEqual(workspaceRosterQuerySchema.parse({ limit: "abc" }), { limit: 50, offset: 0 });
  assert.deepEqual(workspaceRosterQuerySchema.parse({ offset: "-5" }), { limit: 50, offset: 0 });
});

test("roster member VM accepts avatar/online placeholders (null) and rejects unknown roles", () => {
  const base = {
    user_id: "20000000-0000-4000-8000-0000000000b1",
    nickname: "小赵",
    role: "member" as const,
    joined_at: "2026-07-02T00:00:00.000Z",
    is_self: false,
    avatar_updated_at: null,
    online: null
  };
  assert.equal(workspaceRosterMemberVmSchema.safeParse(base).success, true);
  assert.equal(
    workspaceRosterMemberVmSchema.safeParse({ ...base, avatar_updated_at: "2026-07-14T00:00:00.000Z" }).success,
    true
  );
  assert.equal(workspaceRosterMemberVmSchema.safeParse({ ...base, role: "superuser" }).success, false);
  // strict：禁未知字段混入。
  assert.equal(workspaceRosterMemberVmSchema.safeParse({ ...base, cookie_token: "leak" }).success, false);
});

test("roster result VM carries members plus total/limit/offset paging metadata", () => {
  const result = {
    members: [],
    total: 251,
    limit: 100,
    offset: 200
  };
  assert.equal(workspaceRosterResultVmSchema.safeParse(result).success, true);
  // total 不设上限（工作区可有 >200 成员，正是本次修复要覆盖的规模）。
  assert.equal(workspaceRosterResultVmSchema.safeParse({ ...result, total: 100000 }).success, true);
  // 负数拒。
  assert.equal(workspaceRosterResultVmSchema.safeParse({ ...result, offset: -1 }).success, false);
});

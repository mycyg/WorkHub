import assert from "node:assert/strict";
import test from "node:test";

import { findPgError, isPgErrorCode } from "./pg-error.js";

// R24 S3 严重#7：drizzle-orm 0.45 的 node-postgres 驱动把裸 pg DatabaseError 包进
// DrizzleQueryError 的 `.cause`（顶层没有 `.code`）。这组测试锁死 findPgError/isPgErrorCode
// 两种形状都要接住：历史假错误（顶层直接塞 code）与生产真实的嵌套包装。

test("findPgError matches an error that carries `.code` directly at the top level (legacy fake-error shape)", () => {
  const error = { code: "23505", constraint: "some_uq" };
  assert.deepEqual(findPgError(error), error);
  assert.equal(isPgErrorCode(error, "23505"), true);
  assert.equal(isPgErrorCode(error, "23503"), false);
});

test("findPgError walks a single `.cause` hop (the real drizzle-orm DrizzleQueryError shape)", () => {
  const pgDatabaseError = Object.assign(new Error('duplicate key value violates unique constraint "x_uq"'), {
    code: "23505",
    constraint: "x_uq"
  });
  const drizzleQueryError = Object.assign(new Error('Failed query: insert into "x" ...'), {
    cause: pgDatabaseError
  });

  assert.equal(isPgErrorCode(drizzleQueryError, "23505"), true);
  assert.equal(findPgError(drizzleQueryError)?.constraint, "x_uq");
});

test("findPgError walks multiple `.cause` hops up to the default depth", () => {
  const root = { code: "23503" };
  const wrap1 = { cause: root };
  const wrap2 = { cause: wrap1 };
  const wrap3 = { cause: wrap2 };

  assert.equal(isPgErrorCode(wrap3, "23503"), true);
});

test("findPgError gives up beyond maxDepth (defensive cap, not expected in practice)", () => {
  // 6 层包装，默认上限 5——找不到，返回 undefined/false 而不是无限探底。
  let chain: unknown = { code: "23505" };
  for (let i = 0; i < 6; i += 1) {
    chain = { cause: chain };
  }
  assert.equal(findPgError(chain), undefined);
  assert.equal(isPgErrorCode(chain, "23505"), false);
});

test("findPgError returns undefined for non-pg-shaped input", () => {
  assert.equal(findPgError(new Error("boom")), undefined);
  assert.equal(findPgError(null), undefined);
  assert.equal(findPgError(undefined), undefined);
  assert.equal(findPgError("boom"), undefined);
  assert.equal(findPgError({ cause: null }), undefined);
  assert.equal(isPgErrorCode(new Error("boom"), "23505"), false);
});

test("findPgError does not match a `.code` that isn't a string (e.g. numeric HTTP status)", () => {
  assert.equal(findPgError({ code: 500 }), undefined);
});

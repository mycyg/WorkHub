import assert from "node:assert/strict";
import test from "node:test";

import {
  hasMoreWorkspaceAuditPages,
  humanizeWorkspaceAuditError,
  nextWorkspaceAuditOffset,
  WORKSPACE_AUDIT_PAGE_SIZE
} from "./workspace-audit.js";

// R23 P4（R20 P2A 端点上界面）：服务端只回 { limit, offset, count }，没有 total——「还有没有下一页」
// 只能按「这一页装满了没」判断。差一位就会漏记录或反复拉同一页，所以这段算术单测钉死。
test("workspace audit paging advances by the returned count and stops on a short page", () => {
  assert.equal(WORKSPACE_AUDIT_PAGE_SIZE, 25);

  const full = { limit: 25, offset: 0, count: 25 };
  assert.equal(hasMoreWorkspaceAuditPages(full), true);
  assert.equal(nextWorkspaceAuditOffset(full), 25);

  const partial = { limit: 25, offset: 25, count: 7 };
  assert.equal(hasMoreWorkspaceAuditPages(partial), false);
  assert.equal(nextWorkspaceAuditOffset(partial), 32);

  // 空页收尾：最后一页恰好装满时会多问一次，拿到 count=0 就停——宁可多问一次也不能提前藏掉「加载更多」。
  const empty = { limit: 25, offset: 50, count: 0 };
  assert.equal(hasMoreWorkspaceAuditPages(empty), false);
  assert.equal(nextWorkspaceAuditOffset(empty), 50);

  // 服务端夹紧了 limit（客户端要 200、服务端只给 50）时也不能算错游标。
  const clamped = { limit: 50, offset: 0, count: 50 };
  assert.equal(hasMoreWorkspaceAuditPages(clamped), true);
  assert.equal(nextWorkspaceAuditOffset(clamped), 50);
});

test("humanizeWorkspaceAuditError tells admins-only apart from a transient failure", () => {
  assert.match(humanizeWorkspaceAuditError({ code: "forbidden" }, "zh-CN"), /只有管理员/u);
  // 服务端把它抛成 HTTPException 403，客户端侧未必带 code——status 也要认。
  assert.match(humanizeWorkspaceAuditError({ status: 403 }, "en-US"), /admins only/u);

  const leaky = new Error("fetch failed: ECONNRESET");
  assert.equal(humanizeWorkspaceAuditError(leaky, "zh-CN"), "审计记录没加载出来，稍后重试。");
  assert.equal(humanizeWorkspaceAuditError(leaky, "zh-CN").includes("ECONNRESET"), false);
});

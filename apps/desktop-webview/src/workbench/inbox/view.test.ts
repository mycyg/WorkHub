import assert from "node:assert/strict";
import { test } from "node:test";

import { INBOX_FILTER_GROUPS, inboxFilterGroup, kindMatchesGroup } from "./view.js";

// R17-G5 #29：筛选分组 → kind 映射（纯逻辑，DOM 过滤在挂载层用它按 data-att-kind 隐藏卡）。
test("INBOX_FILTER_GROUPS exposes the six chips with 全部 first and null kinds", () => {
  assert.deepEqual(
    INBOX_FILTER_GROUPS.map((group) => group.id),
    ["all", "approval", "proposal", "escalation", "budget", "conflict"]
  );
  assert.equal(inboxFilterGroup("all").kinds, null);
});

test("kindMatchesGroup routes each kind to its chip group; 全部 matches everything", () => {
  assert.equal(kindMatchesGroup("approval", "approval"), true);
  assert.equal(kindMatchesGroup("approval", "proposal"), false);
  // 提议组含任务计划审阅与提议审阅两 kind。
  assert.equal(kindMatchesGroup("proposal_review", "proposal"), true);
  assert.equal(kindMatchesGroup("plan_review", "proposal"), true);
  assert.equal(kindMatchesGroup("escalation", "escalation"), true);
  assert.equal(kindMatchesGroup("budget", "budget"), true);
  // 偏好/同步冲突统一归 sync_conflict。
  assert.equal(kindMatchesGroup("sync_conflict", "conflict"), true);
  // 无 chip 分组的兜底 kind 只在「全部」下出现。
  assert.equal(kindMatchesGroup("delivery_ready", "all"), true);
  assert.equal(kindMatchesGroup("delivery_ready", "approval"), false);
  assert.equal(kindMatchesGroup("system_health", "all"), true);
});

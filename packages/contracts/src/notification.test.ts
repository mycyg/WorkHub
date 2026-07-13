import assert from "node:assert/strict";
import { test } from "node:test";

import { notificationSchema } from "./notification.js";

const BASE = {
  id: "90000000-0000-4000-8000-000000000001",
  user_id: "90000000-0000-4000-8000-000000000002",
  type: "action_card_item.dispatch_ask",
  severity: "normal" as const,
  title: "有个活想派给你",
  created_at: "2026-07-13T00:00:00.000Z",
  updated_at: "2026-07-13T00:00:00.000Z"
};

// R13 批 P2：conversation_id 是新增的可选字段（additive，见 notification.ts 顶部注释）——
// 老通知/其它通知类型没有这个字段时必须照常解析通过，不能因为新增字段就要求所有调用方回填它。
test("notificationSchema still parses without conversation_id (backward compatible)", () => {
  const parsed = notificationSchema.parse(BASE);
  assert.equal(parsed.conversation_id, undefined);
});

test("notificationSchema accepts an optional conversation_id for dispatch_ask deep links", () => {
  const parsed = notificationSchema.parse({
    ...BASE,
    conversation_id: "90000000-0000-4000-8000-000000000003"
  });
  assert.equal(parsed.conversation_id, "90000000-0000-4000-8000-000000000003");
});

test("notificationSchema rejects a malformed conversation_id", () => {
  assert.throws(() => notificationSchema.parse({ ...BASE, conversation_id: "not-a-uuid" }));
});

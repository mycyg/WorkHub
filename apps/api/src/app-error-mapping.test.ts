import assert from "node:assert/strict";
import test from "node:test";

import app from "./app.js";
import { ConversationTurnServiceError } from "./services/conversation-turns.js";

// R12 final-turns-wiring 回归：routes/conversation-turns.test.ts 里的 withErrors 是本地复刻的错误处理器，
// 自带 ConversationTurnServiceError 分支——路由测试绿并不能证明生产 app.onError 有同款分支（漏掉时
// 所有类型化错误全被压成 500 internal_error，桌面端 turn.ts 的按 code 温和提示全部失效）。
// 这里在真 app 上挂一条 test-only 路由，把服务错误抛进真正的 app.onError，钉死真实 status/code 原样出膛。
// 用 GET 避开 body-limit/CSRF 等带体方法中间件；node --test 每个测试文件独立进程，
// 对共享 app 的这次挂载不会泄漏进 app.test.ts 的 OpenAPI 路由对账门或 route-auth-posture 门。

let thrown: Error = new Error("unset");
app.get("/__test__/conversation-turn-error", () => {
  throw thrown;
});

const typedCases: Array<{ status: 403 | 404 | 409 | 429 | 500; code: string }> = [
  { status: 403, code: "human_required" },
  { status: 404, code: "conversation_not_found" },
  { status: 404, code: "conversation_turn_message_not_found" },
  { status: 409, code: "conversation_turn_busy" },
  { status: 409, code: "conversation_turn_not_collab" },
  { status: 409, code: "conversation_turn_mode_observe_only" },
  { status: 429, code: "conversation_turn_budget_exhausted" },
  { status: 500, code: "conversation_turn_failed" }
];

test("app.onError surfaces every ConversationTurnServiceError with its real status and code", async () => {
  for (const { status, code } of typedCases) {
    thrown = new ConversationTurnServiceError(status, code, `message for ${code}`);
    const response = await app.request("/__test__/conversation-turn-error");
    assert.equal(response.status, status, `${code} lost its ${status} status`);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: { code, message: `message for ${code}` }
    }, `${code} envelope drifted`);
  }
});

test("app.onError still flattens untyped errors to the generic internal_error envelope", async () => {
  thrown = new Error("boom");
  const response = await app.request("/__test__/conversation-turn-error");
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "internal_error", message: "WorkHub hit an unexpected server error." }
  });
});

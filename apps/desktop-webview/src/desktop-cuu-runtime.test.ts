import assert from "node:assert/strict";
import test from "node:test";

import { eventTypes, type AttentionItem, type QuestionCard } from "@workhub/contracts";

import {
  bindDesktopShellCuuRuntime,
  desktopCuuNoticeMessage,
  renderDesktopCuuNotice,
  resolveDesktopCuuAction,
  resolveDesktopShellListen,
  submitDesktopCuuAction,
  type DesktopCuuNotice,
  type DesktopShellEventEnvelope,
  type DesktopShellListen
} from "./desktop-cuu-runtime.js";
import type { DesktopShellPushPayload } from "./shell-events.js";

function shellPayload(event: string, data: unknown): DesktopShellPushPayload {
  return {
    event,
    data: JSON.stringify(data),
    stream_kind: "me",
    stream_path: "/api/push/stream/me"
  };
}

test("desktop Cuu runtime listens to Rust push-event and sse-status channels", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const stopped: string[] = [];
  const notices: DesktopCuuNotice[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => stopped.push(eventName);
  };
  const attention: AttentionItem = {
    id: "attention-runtime",
    kind: "approval",
    priority: "urgent",
    source_ref: { entity_type: "approval_request", entity_id: "approval-runtime" },
    title: "Cuu 等你审批 <不要执行脚本>",
    summary_text: "点选后继续。",
    reason_text: "这次动作需要你确认。",
    actions: [
      {
        id: "approve",
        label: "同意",
        style: "primary",
        method: "POST",
        href: "/api/approvals/approval-runtime/respond"
      }
    ],
    cuu_state: "asking_approval",
    created_at: "2026-06-05T01:00:00.000Z"
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    now: () => new Date("2026-06-05T01:00:00.000Z"),
    notify: (notice) => notices.push(notice)
  });
  handlers.get("push-event")?.({
    payload: shellPayload(eventTypes.permissionAsk, {
      summary_text: attention.summary_text,
      attention
    })
  });
  handlers.get("sse-status")?.({
    payload: {
      stream_kind: "global",
      stream_path: "/api/push/stream",
      state: "closed"
    }
  });

  assert.equal(runtime.subscribed, true);
  assert.equal(notices[0]?.card.state, "asking_approval");
  assert.equal(notices[0]?.message, "Cuu：Cuu 等你审批 <不要执行脚本>");
  assert.match(notices[0]?.html ?? "", /&lt;不要执行脚本&gt;/u);
  assert.match(notices[0]?.html ?? "", /data-method="POST"/u);
  assert.equal(notices[1]?.card.state, "offline");

  await runtime.dispose();
  assert.deepEqual(stopped, ["push-event", "sse-status"]);
});

test("desktop Cuu runtime resolves Tauri and mock listeners without subscribing in plain browsers", async () => {
  const listen: DesktopShellListen = () => undefined;

  assert.equal(resolveDesktopShellListen({ __TAURI__: { event: { listen } } }), listen);
  assert.equal(resolveDesktopShellListen({ __YQGL_MOCK_LISTEN__: listen }), listen);
  assert.equal(resolveDesktopShellListen({}), undefined);

  const runtime = await bindDesktopShellCuuRuntime({
    notify() {
      throw new Error("should not notify without a listener");
    },
    listen: undefined
  });

  assert.equal(runtime.subscribed, false);
});

test("desktop Cuu notice renders compact option-first actions", () => {
  const html = renderDesktopCuuNotice({
    id: "card-1",
    kind: "question",
    state: "asking_approval",
    motion: {
      state: "asking_approval",
      sprite_state: "asking_approval_bounce",
      emphasis: "urgent",
      loop: true,
      reduced_motion_fallback: "Cuu 在等你点选。"
    },
    title: "选一个方向",
    message: "不用打字，点选即可。",
    priority: "high",
    chips: [{ id: "brief", label: "简洁版", recommended: true }],
    actions: [
      {
        id: "submit",
        label: "确认",
        tone: "primary",
        method: "POST",
        href: "/api/sessions/session-1/answer"
      }
    ]
  });

  assert.equal(desktopCuuNoticeMessage({
    id: "card-1",
    kind: "offline",
    state: "offline",
    motion: {
      state: "offline",
      sprite_state: "offline_sleep",
      emphasis: "calm",
      loop: true,
      reduced_motion_fallback: "Cuu 离线休息中。"
    },
    title: "连接断开",
    message: "正在重连。",
    priority: "normal",
    actions: []
  }), "Cuu：连接断开");
  assert.match(html, /data-cuu-state="asking_approval"/u);
  assert.match(html, /不用打字，点选即可。/u);
  assert.match(html, /data-cuu-action-id="submit"/u);
});

test("desktop Cuu actions submit approval choices through the typed API client", async () => {
  const calls: unknown[] = [];
  const client = {
    async respondApproval(id: string, payload: unknown) {
      calls.push({ id, payload });
    },
    async nextQuestion() {
      throw new Error("not needed");
    }
  };
  const allow = resolveDesktopCuuAction("/api/approvals/approval-1/respond", { actionId: "approve" });
  const deny = resolveDesktopCuuAction("/api/approvals/approval-1/respond", {
    actionId: "deny",
    requiresReason: true
  });

  assert.deepEqual(allow, {
    kind: "approval-response",
    approvalId: "approval-1",
    decision: "allow",
    requiresReason: false
  });
  assert.equal(deny?.kind, "approval-response");
  assert.equal(deny && "decision" in deny ? deny.decision : undefined, "deny");

  assert.equal((await submitDesktopCuuAction({ client, action: allow! })).message, "Cuu 已收到：这步已批准。");
  await assert.rejects(() => submitDesktopCuuAction({ client, action: deny! }), /打回需要先选择一个原因/u);
  assert.equal(
    (await submitDesktopCuuAction({ client, action: deny!, reasonMd: "证据不足" })).message,
    "Cuu 已带着原因打回，会继续改。"
  );
  assert.deepEqual(calls, [
    { id: "approval-1", payload: { decision: "allow", remember: "once" } },
    { id: "approval-1", payload: { decision: "deny", reason_md: "证据不足", remember: "once" } }
  ]);
});

test("desktop Cuu actions advance option-first clarification sessions", async () => {
  const calls: string[] = [];
  const client = {
    async respondApproval() {
      throw new Error("not needed");
    },
    async nextQuestion(sessionId: string) {
      calls.push(sessionId);
      const question: QuestionCard = {
        id: "question-next",
        title: "下一步要谁审批？",
        input_mode: "single_choice",
        options: [],
        free_text: { enabled: true, collapsed_by_default: true },
        progress: [],
        submit: { method: "POST", href: `/api/sessions/${sessionId}/next-question` }
      };
      return question;
    }
  };
  const action = resolveDesktopCuuAction("/api/sessions/session-1/next-question", { actionId: "submit_option" });

  assert.deepEqual(action, { kind: "session-next-question", sessionId: "session-1" });
  assert.equal((await submitDesktopCuuAction({ client, action: action! })).message, "下一题：下一步要谁审批？");
  assert.deepEqual(calls, ["session-1"]);
  assert.equal(resolveDesktopCuuAction("/api/proposals/proposal-1/review", { actionId: "approve" }), undefined);
});

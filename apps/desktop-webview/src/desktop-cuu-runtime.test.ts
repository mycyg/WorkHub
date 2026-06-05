import assert from "node:assert/strict";
import test from "node:test";

import { eventTypes, type AttentionItem } from "@workhub/contracts";

import {
  bindDesktopShellCuuRuntime,
  desktopCuuNoticeMessage,
  renderDesktopCuuNotice,
  resolveDesktopShellListen,
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

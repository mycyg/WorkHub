import assert from "node:assert/strict";
import test from "node:test";

import {
  CONVERSATION_MIRROR_LIVE_EVENT_TYPES,
  liveStreamTargetsForRoute,
  type LiveStreamUrlBuilders
} from "./live-stream-targets.js";
import type { WebRouteReadyResult } from "./routes.js";

const streams: LiveStreamUrlBuilders = {
  me: () => "/api/push/stream/me",
  session: (id) => `/api/push/stream/session/${id}`,
  workItem: (id) => `/api/push/stream/workitem/${id}`,
  proposal: (id) => `/api/push/stream/proposal/${id}`,
  run: (id) => `/api/push/stream/run/${id}`,
  conversation: (id) => `/api/push/stream/conversation/${id}`
};

function conversationResult(conversationId: string): WebRouteReadyResult {
  return {
    status: "ready",
    match: {
      key: "conversation",
      pattern: "/conversations/:id",
      pathname: `/conversations/${conversationId}`,
      search: "",
      params: { id: conversationId }
    },
    html: "",
    shell: {} as WebRouteReadyResult["shell"],
    surface: {
      key: "conversation",
      conversationId,
      messages: [],
      members: [],
      isLatest: true,
      refreshHref: `/conversations/${conversationId}`
    }
  };
}

test("R20 P2-06 the web conversation mirror route subscribes to its conversation-specific SSE stream", () => {
  const targets = liveStreamTargetsForRoute(conversationResult("c-1"), streams);
  const conversationTarget = targets.find((target) => target.key === "conversation");
  assert.ok(conversationTarget, "conversation route must add a conversation SSE target");
  assert.equal(conversationTarget.url, "/api/push/stream/conversation/c-1");
  // 订阅面 = 会改动只读镜像可见内容的会话事件（新消息 / 编辑删除置顶 / reaction / 参与者）。
  assert.deepEqual(conversationTarget.eventTypes, [...CONVERSATION_MIRROR_LIVE_EVENT_TYPES]);
  assert.ok(conversationTarget.eventTypes?.includes("conversation.message.created"));
  // R20 P2-04（会话 rename 跨端同步）：会话被改名时镜像页要重渲对齐新标题——conversation.title.updated 必须
  // 在订阅面内。EventSource 按事件名订阅，漏登记 = 事件被静默丢弃、镜像页永远显示旧名字。
  assert.ok(conversationTarget.eventTypes?.includes("conversation.title.updated"));
  // 断线重连的全量补拉已由 live-runtime 对所有流统一兜底（INF-08），不再按 target 开关。
});

test("R20 P2-06 the me stream is always present and non-conversation routes add no conversation target", () => {
  const targets = liveStreamTargetsForRoute(conversationResult("c-9"), streams);
  assert.equal(targets[0]?.key, "me", "me stream is always the first target");
  // me 流不带逐流 eventTypes 覆写——沿用全局窄化面（排除 conversation.*）。
  assert.equal(targets[0]?.eventTypes, undefined);
});

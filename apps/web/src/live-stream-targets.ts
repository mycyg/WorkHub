import { eventTypes } from "@workhub/contracts";
import type { WebLiveStreamTarget } from "@workhub/web-runtime";

import type { WebRouteReadyResult } from "./routes.js";

// 本模块从 browser.ts 抽出，纯函数、无 DOM 依赖，供单测直接覆盖「哪条路由订阅哪些 SSE 窄流」。
// browser.ts 只负责把 client.streams 传进来并把结果交给 liveRuntime.syncTargets。

// 会话专属窄流（/api/push/stream/conversation/:id）的订阅事件面。只订「会改动只读镜像可见内容」的
// 已定型事件——新消息、编辑/删除/置顶（整条替换）、reaction 聚合、参与者集合变化。刻意不订：
//   * message.delta（AI 流式增量，会引发刷新风暴——定型后有 message.created/updated 兜底）；
//   * presence.typing / observer.analyzing（瞬态信号，镜像不渲染）；
//   * read.updated（镜像是只读、不展示未读态）；cuu.updated / action_card.updated（镜像不渲染这些）。
// 收到其一即触发一次全量重渲（renderCurrentRouteOrOnboard 重拉 listConversationMessages）——seq 合并=
// 服务端权威（按 seq 排序、去重、含墓碑），去抖窗口把乱序/重复的一批事件并成一次拉取，天然幂等。
export const CONVERSATION_MIRROR_LIVE_EVENT_TYPES: readonly string[] = [
  eventTypes.conversationMessageCreated,
  eventTypes.conversationMessageUpdated,
  eventTypes.conversationReactionUpdated,
  eventTypes.conversationParticipantsUpdated
];

// browser.ts 的 client.streams 子集——只取本模块会用到的窄流 URL 构造器。
export type LiveStreamUrlBuilders = {
  me: () => string;
  session: (id: string) => string;
  workItem: (id: string) => string;
  proposal: (id: string) => string;
  run: (id: string) => string;
  conversation: (id: string) => string;
};

export function liveStreamTargetsForRoute(
  result: WebRouteReadyResult,
  streams: LiveStreamUrlBuilders
): WebLiveStreamTarget[] {
  const targets: WebLiveStreamTarget[] = [{ key: "me", url: streams.me() }];
  if (result.match.key === "intake") {
    const sessionId = result.match.params["sessionId"];
    if (sessionId) {
      targets.push({ key: "session", url: streams.session(sessionId) });
    }
  } else if (result.match.key === "workitem") {
    const workItemId = result.match.params["id"];
    if (workItemId) {
      targets.push({ key: "workitem", url: streams.workItem(workItemId) });
    }
  } else if (result.match.key === "proposal") {
    const proposalId = result.match.params["id"];
    const workItemId = result.surface.key === "proposal" ? result.surface.proposal.work_item_id : undefined;
    if (proposalId) {
      targets.push({ key: "proposal", url: streams.proposal(proposalId) });
    }
    if (workItemId) {
      targets.push({ key: "workitem", url: streams.workItem(workItemId) });
    }
  } else if (result.match.key === "replay") {
    const runId = result.match.params["id"];
    const workItemId = result.surface.key === "replay" ? result.surface.replay.run.work_item_id : undefined;
    if (runId) {
      targets.push({ key: "run", url: streams.run(runId) });
    }
    if (workItemId) {
      targets.push({ key: "workitem", url: streams.workItem(workItemId) });
    }
  } else if (result.match.key === "conversation") {
    // R20 P2-06：只读会话镜像订阅该会话专属 SSE 窄流。逐流 eventTypes 只订 conversation.*（不污染 me
    // 流的全局窄化面）；refreshOnReconnect 让断线重连补拉全量对账，而不只依赖增量。收到订阅面内任一事件
    // 即触发一次全量重渲（renderCurrentRouteOrOnboard 按当前 pathname+search 重拉会话页 VM）。
    const conversationId = result.match.params["id"];
    if (conversationId) {
      targets.push({
        key: "conversation",
        url: streams.conversation(conversationId),
        eventTypes: [...CONVERSATION_MIRROR_LIVE_EVENT_TYPES],
        refreshOnReconnect: true
      });
    }
  }
  return targets;
}

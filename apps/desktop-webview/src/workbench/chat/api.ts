// WorkHub 桌面 · 主区群聊的数据访问薄层。批 0 的会话消息端点（GET/POST /api/conversations/:id/messages）
// 和批 2 新增的 typing 端点都还没有专门的 WorkHubApiClient 具名方法——不新增（packages/api-client
// 是共享给 apps/web 的公共面，为一个只有工作台窗口用的批次特性扩大它的公共接口面不值得；`request<T>`
// 已经是 WorkHubApiClient 上现成的、供临时/单一消费者端点使用的转发口，apps/web/src/browser.ts:1099
// 的 client.request<DrivePreviewPayload>(href) 是同款先例），这里只是给 client.request 包一层类型安全
// 的薄封装 + 首屏/向上翻页策略。

import type {
  AiMode,
  ConversationMessagePageVM,
  ConversationMessageVM,
  CreateConversationMessageRequest,
  NotificationList,
  UserAiProfileVM
} from "@workhub/contracts";

export type ChatApiClient = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

export type TypingPingResult = {
  published: boolean;
};

function conversationPath(conversationId: string, suffix: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/${suffix}`;
}

export function fetchConversationMessagesPage(
  client: ChatApiClient,
  conversationId: string,
  input: { afterSeq: number; limit?: number }
): Promise<ConversationMessagePageVM> {
  const query = new URLSearchParams({
    afterSeq: String(input.afterSeq),
    limit: String(input.limit ?? 100)
  });
  return client.request<ConversationMessagePageVM>(`${conversationPath(conversationId, "messages")}?${query.toString()}`);
}

export const DEFAULT_INITIAL_HISTORY_PAGE_LIMIT = 100;

// R12 批8：批 0 只给了 afterSeq，批 2 的首屏策略只能"从 afterSeq=0 逐页正向拉到当前"（长会话是
// O(会话长度) 且命中防御上限时只能展示最早一部分，见 batch-2-chat.md 的缺口记录）。批 8 补了
// packages/contracts 的 beforeSeq 反向游标（详见该包 conversationMessageListQuerySchema），首屏改为
// 直接要「最新一页」——beforeSeq 传 Number.MAX_SAFE_INTEGER（契约允许的游标上界，语义就是「早于一切
// 已存在的 seq」），一次请求就拿到最近 limit 条，O(1) 而不是 O(会话长度)。
export function fetchLatestConversationMessagesPage(
  client: ChatApiClient,
  conversationId: string,
  input: { limit?: number } = {}
): Promise<ConversationMessagePageVM> {
  const query = new URLSearchParams({
    beforeSeq: String(Number.MAX_SAFE_INTEGER),
    limit: String(input.limit ?? DEFAULT_INITIAL_HISTORY_PAGE_LIMIT)
  });
  return client.request<ConversationMessagePageVM>(`${conversationPath(conversationId, "messages")}?${query.toString()}`);
}

// R12 批8：「滚到顶加载更早」的网络侧——beforeSeq 传上一页最旧一条的 seq（服务端回的 next_before_seq，
// 空页时保持不变，见 packages/db/src/repositories/conversations.ts 的 listMessagesBefore 注释）。
export function fetchOlderConversationMessagesPage(
  client: ChatApiClient,
  conversationId: string,
  input: { beforeSeq: number; limit?: number }
): Promise<ConversationMessagePageVM> {
  const query = new URLSearchParams({
    beforeSeq: String(input.beforeSeq),
    limit: String(input.limit ?? DEFAULT_INITIAL_HISTORY_PAGE_LIMIT)
  });
  return client.request<ConversationMessagePageVM>(`${conversationPath(conversationId, "messages")}?${query.toString()}`);
}

export function sendConversationTextMessage(
  client: ChatApiClient,
  conversationId: string,
  text: string,
  threadRootId?: string
): Promise<ConversationMessageVM> {
  const payload: CreateConversationMessageRequest = {
    kind: "text",
    content: { text },
    ...(threadRootId ? { thread_root_id: threadRootId } : {})
  };
  return client.request<ConversationMessageVM>(conversationPath(conversationId, "messages"), {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function sendConversationFileCardMessage(
  client: ChatApiClient,
  conversationId: string,
  driveItemId: string,
  threadRootId?: string
): Promise<ConversationMessageVM> {
  const payload: CreateConversationMessageRequest = {
    kind: "file_card",
    content: { drive_item_id: driveItemId },
    ...(threadRootId ? { thread_root_id: threadRootId } : {})
  };
  return client.request<ConversationMessageVM>(conversationPath(conversationId, "messages"), {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function pingConversationTyping(client: ChatApiClient, conversationId: string): Promise<TypingPingResult> {
  return client.request<TypingPingResult>(conversationPath(conversationId, "typing"), { method: "POST" });
}

// R12（final-turns-wiring）：POST /conversations/:id/turns——协同会话（kind='collab'）发一句话之后，
// 请 Cuu 真的回一句。契约见 apps/api/src/services/conversation-turns.ts 顶部注释/
// r12-desktop-workbench/reports/batch-4a-turns.md：请求体只有 { user_message_id }；成功响应直接带回
// 完整的 Cuu 消息 VM（含真实 id/seq）——这一批范围里请求/响应 schema 是路由本地定义，没有被 promote
// 进 @workhub/contracts（批 4a 报告写明了这一点，范围围栏没批准新增 contracts），所以这里同
// TypingPingResult 一样，在这个文件本地声明一个薄类型，不是漏了处理。同上面所有会话端点一致，
// 不为这一个批次特性去扩大 packages/api-client 的具名方法面——继续走 client.request。
export type ConversationTurnResult = {
  turn_id: string;
  message: ConversationMessageVM;
};

export function requestConversationTurn(
  client: ChatApiClient,
  conversationId: string,
  input: { userMessageId: string }
): Promise<ConversationTurnResult> {
  return client.request<ConversationTurnResult>(conversationPath(conversationId, "turns"), {
    method: "POST",
    body: JSON.stringify({ user_message_id: input.userMessageId })
  });
}

// R12（模式五档弹层，2026-07-12 纠偏后归位到单聊）：GET/PATCH /api/me/ai-profile——不是 conversation
// 下的端点，不走 conversationPath。契约见 apps/api/src/routes/ai-settings.ts +
// apps/api/src/services/ai-settings.ts：GET 返回完整的 UserAiProfileVM（含 providers/预算摘要，工作台
// composer 只用得到 default_mode 这一个字段，其余字段留给设置页 · AI 消费）；PATCH 收
// PatchUserAiProfileRequest，这里只发 default_mode（granular_settings/dispatch_policy/
// cuu_proactivity/model_tier_preference 是同一份档案的其它偏好，不在 composer 的模式弹层范围内）。
// 同上面所有会话端点一样，不为这一个特性去扩大 WorkHubApiClient 的具名方法面，继续走 client.request——
// client.request 已经按 apps/api 统一的 {ok,data} 信封解出 data，失败会抛 WorkHubApiError（见
// packages/api-client/src/client.ts），调用方（view.ts）用 error instanceof WorkHubApiError 判断。
const AI_PROFILE_PATH = "/api/me/ai-profile";

export function fetchMyAiProfile(client: ChatApiClient): Promise<UserAiProfileVM> {
  return client.request<UserAiProfileVM>(AI_PROFILE_PATH);
}

export function patchMyAiMode(client: ChatApiClient, mode: AiMode): Promise<UserAiProfileVM> {
  return client.request<UserAiProfileVM>(AI_PROFILE_PATH, {
    method: "PATCH",
    body: JSON.stringify({ default_mode: mode })
  });
}

// R12 P0-A1：行动卡条目的决策(decide)/撤销(undo)。契约见 apps/api/src/routes/action-cards.ts +
// apps/api/src/services/action-cards.ts 的 ActionCardItemVM——这两个端点不是 conversation 下的路由
// （挂在 /api/action-card-items/:id/*），也没有被 promote 进 @workhub/contracts（服务端范围围栏没批准
// 新增 contracts），同上面 ConversationTurnResult/UserAiProfileVM 之外的会话端点一样，这里本地声明一个
// 薄的、镜像服务端 ActionCardItemVM 字段的类型（snake_case——照抄服务端 JSON 形状，不在这层转驼峰），
// 继续走 client.request，不为这两个端点扩大 WorkHubApiClient 的具名方法面。
export type ActionCardItemDecisionAction = "claim" | "reassign" | "defer";

export type ActionCardItemDecisionResult = {
  id: string;
  conversation_id: string;
  action_card_id: string;
  kind: string;
  title_md: string;
  confidence: string;
  status: string;
  assignee_user_id: string | null;
  work_item_id: string | null;
  run_id: string | null;
  undo_deadline_at: string | null;
};

function actionCardItemPath(itemId: string, suffix: string): string {
  return `/api/action-card-items/${encodeURIComponent(itemId)}/${suffix}`;
}

export function decideActionCardItem(
  client: ChatApiClient,
  input: { itemId: string; action: ActionCardItemDecisionAction; assigneeUserId?: string }
): Promise<ActionCardItemDecisionResult> {
  return client.request<ActionCardItemDecisionResult>(actionCardItemPath(input.itemId, "decide"), {
    method: "POST",
    body: JSON.stringify({
      action: input.action,
      ...(input.assigneeUserId ? { assignee_user_id: input.assigneeUserId } : {})
    })
  });
}

export function undoActionCardItem(
  client: ChatApiClient,
  input: { itemId: string }
): Promise<ActionCardItemDecisionResult> {
  return client.request<ActionCardItemDecisionResult>(actionCardItemPath(input.itemId, "undo"), {
    method: "POST"
  });
}

// R13 批 P2（拍板链路收尾）：dispatch_ask 错过补偿——workbench 打开/切项目时用来查"这个项目里有没有
// 我错过的派活问询"（见 dispatch-ask-catchup.ts 的 pickDispatchAskCatchupNotification）。
// GET /api/notifications 是已经挂载的既有端点（服务端 listForUser 自带 200 条硬上限，见
// apps/api/src/services/notifications.ts），这批不新增任何服务端端点/查询参数——同这个文件其它
// 会话端点一样，走 client.request 而不是 WorkHubApiClient 的具名方法 notifications()（虽然那个方法
// 也存在，但为保持这个模块内部调用方式统一，不在这一处单独切换成具名方法）。
export function fetchNotifications(client: ChatApiClient): Promise<NotificationList> {
  return client.request<NotificationList>("/api/notifications");
}

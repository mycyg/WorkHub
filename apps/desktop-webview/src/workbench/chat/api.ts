// WorkHub 桌面 · 主区群聊的数据访问薄层。批 0 的会话消息端点（GET/POST /api/conversations/:id/messages）
// 和批 2 新增的 typing 端点都还没有专门的 WorkHubApiClient 具名方法——不新增（packages/api-client
// 是共享给 apps/web 的公共面，为一个只有工作台窗口用的批次特性扩大它的公共接口面不值得；`request<T>`
// 已经是 WorkHubApiClient 上现成的、供临时/单一消费者端点使用的转发口，apps/web/src/browser.ts:1099
// 的 client.request<DrivePreviewPayload>(href) 是同款先例），这里只是给 client.request 包一层类型安全
// 的薄封装 + 首屏/向上翻页策略。

import type {
  AiFeedbackVerdict,
  AiMode,
  ConversationMessagePageVM,
  ConversationMessageVM,
  ConversationParticipantsVM,
  ConversationPinsVM,
  ConversationReactionKey,
  ConversationReadCursorVM,
  ConversationReadReceiptsVM,
  CreateConversationMessageRequest,
  EditConversationMessageRequest,
  NotificationList,
  PresenceListResponse,
  PutAiFeedbackRequest,
  UpdateConversationCuuResultVM,
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

// R14 批 CHAT：text 变体新增 optional reply_to_message_id（引用回复）——additive，不带这个字段的既有
// 调用点（issueSend 普通发送）行为零回归。threadRootId 仍是第 4 个位置参数保持兼容。
export function sendConversationTextMessage(
  client: ChatApiClient,
  conversationId: string,
  text: string,
  threadRootId?: string,
  replyToMessageId?: string
): Promise<ConversationMessageVM> {
  const payload: CreateConversationMessageRequest = {
    kind: "text",
    content: { text },
    ...(threadRootId ? { thread_root_id: threadRootId } : {}),
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {})
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

// —— R14 批 FEEDBACK（行动卡条目的「有用/没用」轻反馈）—— //
//
// PUT/DELETE /action-card-items/:id/feedback：同消息反馈同款取舍 → 204。不支持 note（行动卡条目只做
// 二值 tile，见 04-feedback-design.md §7.1C，桌面渲染层没有备注输入 UI，这里也就不收 note 参数）。
export function putActionCardItemFeedback(client: ChatApiClient, itemId: string, verdict: AiFeedbackVerdict): Promise<void> {
  const body: PutAiFeedbackRequest = { verdict };
  return client.request<void>(actionCardItemPath(itemId, "feedback"), { method: "PUT", body: JSON.stringify(body) });
}

export function deleteActionCardItemFeedback(client: ChatApiClient, itemId: string): Promise<void> {
  return client.request<void>(actionCardItemPath(itemId, "feedback"), { method: "DELETE" });
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

// —— R14 批 CHAT（消息动作：编辑/删除/反应/置顶/已读/presence） —— //
//
// 全部照本文件既有取舍走 client.request（{ok,data} 信封由 client 解出 data；失败抛 WorkHubApiError），
// 不为这一批特性扩大 packages/api-client 的具名方法面。204 端点（反应/置顶的加减）在 api-client 里
// 走 readJson→空 body→isEnvelope 为 false→返回 undefined，这里类型标 Promise<void>，调用方不读返回值。

// PATCH /messages/:messageId：编辑，body {text} → 200 全量消息 VM（含 edited_at）/ 403 / 404 / 409（窗过期・已删除）。
export function editConversationMessage(
  client: ChatApiClient,
  conversationId: string,
  messageId: string,
  text: string
): Promise<ConversationMessageVM> {
  const payload: EditConversationMessageRequest = { text };
  return client.request<ConversationMessageVM>(conversationPath(conversationId, `messages/${encodeURIComponent(messageId)}`), {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

// DELETE /messages/:messageId：墓碑删除（幂等）→ 200 墓碑 VM（deleted_at 置位、content.text 空串）。
export function deleteConversationMessage(
  client: ChatApiClient,
  conversationId: string,
  messageId: string
): Promise<ConversationMessageVM> {
  return client.request<ConversationMessageVM>(conversationPath(conversationId, `messages/${encodeURIComponent(messageId)}`), {
    method: "DELETE"
  });
}

// PUT/DELETE /messages/:messageId/reactions/:key：加/减反应（各自幂等）→ 204。key 是 ASCII slug
// （approve/disagree/done/question/watch），emoji 字形只在渲染层，见 render.ts 的 REACTION_EMOJI。
export function addConversationReaction(
  client: ChatApiClient,
  conversationId: string,
  messageId: string,
  key: ConversationReactionKey
): Promise<void> {
  return client.request<void>(
    conversationPath(conversationId, `messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(key)}`),
    { method: "PUT" }
  );
}

export function removeConversationReaction(
  client: ChatApiClient,
  conversationId: string,
  messageId: string,
  key: ConversationReactionKey
): Promise<void> {
  return client.request<void>(
    conversationPath(conversationId, `messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(key)}`),
    { method: "DELETE" }
  );
}

// PUT/DELETE /messages/:messageId/pin：置顶/取消置顶（取消幂等）→ 204。
export function pinConversationMessage(client: ChatApiClient, conversationId: string, messageId: string): Promise<void> {
  return client.request<void>(conversationPath(conversationId, `messages/${encodeURIComponent(messageId)}/pin`), {
    method: "PUT"
  });
}

export function unpinConversationMessage(client: ChatApiClient, conversationId: string, messageId: string): Promise<void> {
  return client.request<void>(conversationPath(conversationId, `messages/${encodeURIComponent(messageId)}/pin`), {
    method: "DELETE"
  });
}

// —— R14 批 FEEDBACK（Cuu 文字回复的「有用/没用」轻反馈）—— //
//
// PUT/DELETE /messages/:messageId/feedback：幂等 upsert / 幂等撤销 → 204，无响应体（同 reactions/pin
// 的既有取舍——反馈没有 SSE、没有跨用户可见面，本地乐观状态就是权威，见 04-feedback-design.md §0 结论
// 2/3）。verdict 是唯一必填字段，note 省略即代表「不带备注」（服务端把缺省的 note 当 null，见路由层）。
export function putConversationMessageFeedback(
  client: ChatApiClient,
  conversationId: string,
  messageId: string,
  payload: { verdict: AiFeedbackVerdict; note?: string }
): Promise<void> {
  const body: PutAiFeedbackRequest = { verdict: payload.verdict, ...(payload.note ? { note: payload.note } : {}) };
  return client.request<void>(conversationPath(conversationId, `messages/${encodeURIComponent(messageId)}/feedback`), {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

export function deleteConversationMessageFeedback(client: ChatApiClient, conversationId: string, messageId: string): Promise<void> {
  return client.request<void>(conversationPath(conversationId, `messages/${encodeURIComponent(messageId)}/feedback`), {
    method: "DELETE"
  });
}

// GET /pins：置顶清单（seq 降序 cap 50）→ 200 { messages: [VM] }。
export function fetchConversationPins(client: ChatApiClient, conversationId: string): Promise<ConversationPinsVM> {
  return client.request<ConversationPinsVM>(conversationPath(conversationId, "pins"));
}

// PUT /read：已读游标推进（服务端单调夹紧）→ 200 { last_read_seq }。
export function advanceConversationReadCursor(
  client: ChatApiClient,
  conversationId: string,
  lastReadSeq: number
): Promise<ConversationReadCursorVM> {
  return client.request<ConversationReadCursorVM>(conversationPath(conversationId, "read"), {
    method: "PUT",
    body: JSON.stringify({ last_read_seq: lastReadSeq })
  });
}

// GET /receipts：全部读游标 → 200 { receipts: [{ user_id, last_read_seq }] }。
export function fetchConversationReceipts(client: ChatApiClient, conversationId: string): Promise<ConversationReadReceiptsVM> {
  return client.request<ConversationReadReceiptsVM>(conversationPath(conversationId, "receipts"));
}

// —— R15 批 cuu-toggle：会话级 Cuu 参与开关 + 参与者列表（小群「已读 N/M」分母修复） —— //

// PATCH /cuu：翻转会话级 Cuu 参与开关（body {enabled}）→ 200 翻转后的完整会话 VM。main 一律 409
// conversation_cuu_not_collab；非参与者 403 conversation_cuu_forbidden；幂等（重复翻到同一个值不是错误）。
export function patchConversationCuu(
  client: ChatApiClient,
  conversationId: string,
  enabled: boolean
): Promise<UpdateConversationCuuResultVM> {
  return client.request<UpdateConversationCuuResultVM>(conversationPath(conversationId, "cuu"), {
    method: "PATCH",
    body: JSON.stringify({ enabled })
  });
}

// GET /participants：main 回 scope:"workspace" + 空列表（诚实：主区没有一份"参与者名单"，见服务端
// listParticipants 顶部注释）；collab（含 DM）回 scope:"participants" + 真实参与者。桌面端只在非 DM 的
// collab 会话挂载时调用它（DM 的两名参与者已经由 dm.ts 的 dmMembersFromParticipants 给全了，main 保持
// workspace_members 现状分母，见 view.ts 的 loadParticipants）。
export function fetchConversationParticipants(
  client: ChatApiClient,
  conversationId: string
): Promise<ConversationParticipantsVM> {
  return client.request<ConversationParticipantsVM>(conversationPath(conversationId, "participants"));
}

// 小群「已读 N/M」分母修复的纯逻辑：从 GET /participants 的真实参与者集合里去掉自己，得到"他人成员 id"
// 列表——otherMemberIds 的口径（同 view.ts 挂载时从 input.members 算的既有分母公式一致，只是数据源从
// "整个工作区成员" 换成 "这条会话的真实参与者"）。scope:"workspace"（main）时调用方本就不该调这个函数
// （main 保持 workspace_members 现状），这里不对 scope 做特判，纯粹是一个 participants 数组的 map/filter。
export function otherParticipantUserIds(
  participants: ConversationParticipantsVM["participants"],
  currentUserId: string | undefined
): string[] {
  return participants.map((participant) => participant.user_id).filter((id) => id !== currentUserId);
}

// GET /api/presence?user_ids=：≤50 个逗号分隔 uuid，同工作区过滤 → { presence: [{ user_id, is_online, last_seen_at }] }。
// 不是 conversation 下的端点，不走 conversationPath。空列表直接返回空结果，不打网络。
export function fetchPresence(client: ChatApiClient, userIds: readonly string[]): Promise<PresenceListResponse> {
  const unique = [...new Set(userIds)].slice(0, 50);
  if (unique.length === 0) {
    return Promise.resolve({ presence: [] });
  }
  const query = new URLSearchParams({ user_ids: unique.join(",") });
  return client.request<PresenceListResponse>(`/api/presence?${query.toString()}`);
}

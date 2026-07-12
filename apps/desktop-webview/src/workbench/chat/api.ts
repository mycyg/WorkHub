// WorkHub 桌面 · 主区群聊的数据访问薄层。批 0 的会话消息端点（GET/POST /api/conversations/:id/messages）
// 和批 2 新增的 typing 端点都还没有专门的 WorkHubApiClient 具名方法——不新增（packages/api-client
// 是共享给 apps/web 的公共面，为一个只有工作台窗口用的批次特性扩大它的公共接口面不值得；`request<T>`
// 已经是 WorkHubApiClient 上现成的、供临时/单一消费者端点使用的转发口，apps/web/src/browser.ts:1099
// 的 client.request<DrivePreviewPayload>(href) 是同款先例），这里只是给 client.request 包一层类型安全
// 的薄封装 + 首屏历史翻页策略。

import type {
  ConversationMessagePageVM,
  ConversationMessageVM,
  CreateConversationMessageRequest
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

// 批 0 只给了 afterSeq 正向游标，没有 beforeSeq——不能反向翻页补更早的历史（04 §4 铁律「不改 API」，
// 本批范围围栏明确禁止碰 packages/contracts/apps/api 之外的契约面）。诚实的降级策略：首屏只在
// mount 时，从 afterSeq=0 逐页正向推进拉到「当前」（has_more=false），一次性吃下全部历史再渲染，
// 而不是假装支持"向上翻页补历史"却什么都不做。maxPages 是运行时防御性上限（不是产品设计的截断
// 阈值）——服务端契约保证 next_after_seq 严格递增，正常情况下这个循环靠 has_more=false 终止；
// maxPages 只在服务端出现回归 bug（next_after_seq 不推进）时兜底，避免真的死循环。
// 缺口见 r12-desktop-workbench/reports/batch-2-chat.md：长会话的"回到更早消息"翻页需要批 8 补
// beforeSeq 端点。
export const DEFAULT_INITIAL_HISTORY_PAGE_LIMIT = 100;
export const DEFAULT_INITIAL_HISTORY_MAX_PAGES = 100;

export type InitialHistoryResult = {
  messages: ConversationMessageVM[];
  // true = 命中了 maxPages 防御上限（服务端契约异常，不是正常路径）；不是"这个会话历史被有意截断"。
  truncated: boolean;
};

export async function fetchAllConversationMessagesFromStart(
  client: ChatApiClient,
  conversationId: string,
  input: { pageLimit?: number; maxPages?: number } = {}
): Promise<InitialHistoryResult> {
  const pageLimit = input.pageLimit ?? DEFAULT_INITIAL_HISTORY_PAGE_LIMIT;
  const maxPages = input.maxPages ?? DEFAULT_INITIAL_HISTORY_MAX_PAGES;
  const messages: ConversationMessageVM[] = [];
  let afterSeq = 0;
  let pages = 0;
  for (;;) {
    const page = await fetchConversationMessagesPage(client, conversationId, { afterSeq, limit: pageLimit });
    messages.push(...page.messages);
    pages += 1;
    if (!page.has_more) {
      return { messages, truncated: false };
    }
    if (pages >= maxPages || page.next_after_seq <= afterSeq) {
      return { messages, truncated: true };
    }
    afterSeq = page.next_after_seq;
  }
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

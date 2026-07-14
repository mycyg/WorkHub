// WorkHub 桌面 · 群聊/协同会话共用视图——imperative 挂载/事件绑定层（照 shell.ts/rail.ts 的分工：纯渲染在
// render.ts，这里只负责拉数据、绑 DOM 事件、维护会话内的瞬态状态）。批 2 范围：文本+file_card 发送、
// @ 成员/文件 picker（真实）、# 会话与 / 技能 picker（外壳，「即将可用」灰态，见 render.ts 的
// renderComingSoonPickerHtml）、SSE 接线（断线指数退避重连+重连后 afterSeq 补缺口）、typing 节流。
// R12（final-turns-wiring）起：input.conversationKind === 'collab' 时，发一条文本消息之后会自动请求
// 一轮 Cuu 回应（POST /conversations/:id/turns），流式 delta 拼进临时气泡，落定后换成真消息——
// 逻辑全部下沉进 turn.ts 的纯函数（shouldRequestConversationTurn/appendTurnDelta/
// mapConversationTurnError），这里只接线。kind === 'main' 的主区群聊完全不触碰这条通道（主区归
// 静默观察者/批3处理），@Cuu 在主区里仍然只是把消息原样发出去，不会自动回应。
//
// mountChatView 本身没有直接单测（和 mountWorkbenchShell/mountWorkbenchRail 同样的取舍——这个 workspace
// 的测试运行器没有真实 DOM，见 shell.test.ts/rail.test.ts 只测 render*/纯函数这一既有事实）；真正的逻辑
// 已经拆进 render.ts/api.ts/stream.ts/events.ts/timeline.ts/trigger-parser.ts/typing-state.ts/turn.ts 的
// 纯函数里逐一单测过，这里只是把它们接起来。

import { WorkHubApiError } from "@workhub/api-client";
import type {
  AiFeedbackVerdict,
  AiMode,
  ConversationKind,
  ConversationMessageVM,
  ConversationReactionKey,
  Notification
} from "@workhub/contracts";

import { fetchConversationArmyPanel } from "../army/api.js";
import { driveResourceApiBase, fetchDriveResource } from "../../spotlight/views/drive.js";
import {
  addConversationReaction,
  advanceConversationReadCursor,
  decideActionCardItem,
  deleteActionCardItemFeedback,
  deleteConversationMessage,
  deleteConversationMessageFeedback,
  editConversationMessage,
  fetchConversationMessagesPage,
  fetchConversationPins,
  fetchConversationReceipts,
  fetchLatestConversationMessagesPage,
  fetchMyAiProfile,
  fetchNotifications,
  fetchOlderConversationMessagesPage,
  fetchPresence,
  patchMyAiMode,
  pinConversationMessage,
  pingConversationTyping,
  putActionCardItemFeedback,
  putConversationMessageFeedback,
  removeConversationReaction,
  requestConversationTurn,
  sendConversationFileCardMessage,
  sendConversationTextMessage,
  undoActionCardItem,
  unpinConversationMessage,
  type ActionCardItemDecisionAction,
  type ActionCardItemDecisionResult,
  type ChatApiClient
} from "./api.js";
import { mapActionCardDecisionError, shouldReconcileActionCardOnError } from "./action-card-decision.js";
import { decideFeedbackToggle, normalizeFeedbackNote } from "./feedback.js";
import { pickDispatchAskCatchupNotification, renderDispatchAskCatchupBannerHtml } from "./dispatch-ask-catchup.js";
import {
  parseIncomingActionCardUpdated,
  parseIncomingMessageCreated,
  parseIncomingMessageDelta,
  parseIncomingMessageUpdated,
  parseIncomingObserverAnalyzing,
  parseIncomingReactionUpdated,
  parseIncomingReadUpdated,
  parseIncomingTyping,
  type IncomingReactionUpdate
} from "./events.js";
import { onlineUserIdsFromPresence, type OnlineUserIds } from "./presence-state.js";
import { pickCuuReactionEmotion, type CuuReactionEmotion } from "./reaction-emotion.js";
import { toggleOwnReaction } from "./reactions.js";
import {
  applyReadReceipt,
  highestMessageSeq,
  readReceiptSummary,
  receiptsToCursorMap,
  unreadDividerBeforeMessageId,
  type ReadCursorMap
} from "./read-state.js";
import {
  membersById,
  modePatchFailedText,
  reassignPickerMemberIds,
  renderChatEmptyStateHtml,
  renderComingSoonPickerHtml,
  renderComposerHtml,
  renderConnectionBannerHtml,
  renderConversationAccessDeniedHtml,
  renderCuuTurnErrorHtml,
  renderCuuTurnPendingHtml,
  renderDaySeparatorHtml,
  renderHistoryLoadErrorHtml,
  renderHistoryLoadingHtml,
  renderJumpToUnreadHtml,
  renderLoadEarlierHtml,
  renderMemberBarHtml,
  renderMentionPickerHtml,
  renderMessageHtml,
  renderModeChipHtml,
  renderModeErrorHintHtml,
  renderModeObserveOnlyHintHtml,
  renderModePopoverHtml,
  renderNoAiProviderBannerHtml,
  renderObserverAnalyzingHtml,
  renderPendingOutgoingHtml,
  renderPinBarHtml,
  renderReadReceiptHtml,
  renderStreamingCuuBubbleHtml,
  renderTypingIndicatorHtml,
  renderUnreadDividerHtml,
  type ChatRenderContext,
  type ComposerAttachmentChip,
  type ConnectionBannerState,
  type LoadEarlierState,
  type MentionPickerFile,
  type MentionPickerMember,
  type PendingOutgoingMessage,
  type WorkbenchMemberVM
} from "./render.js";
import {
  inferActionCardRunProgress,
  nextAllowedActionCardRunProgressFetchAtMs,
  shouldRefetchActionCardRunProgressNow,
  type ActionCardRunProgress
} from "./run-progress.js";
import { connectConversationStream, type ConversationStreamHandle } from "./stream.js";
import { applyComposerChipInsertion, detectComposerTrigger, type ComposerTriggerMatch } from "./trigger-parser.js";
import {
  DEFAULT_MESSAGE_RENDER_WINDOW,
  applyActionCardItemFeedbackUpdate,
  applyActionCardUpdate,
  applyMessageFeedbackUpdate,
  applyMessageReplacement,
  applyReactionUpdate,
  capRenderWindowSize,
  findActionCardItemFeedbackVerdict,
  findActionCardMessageIdByTitle,
  findActionCardMessageIdForItem,
  groupMessagesByDay,
  maybeShrinkRenderWindowSize,
  sortAndDedupeMessages,
  windowRecentMessages,
  windowSizeAfterAppend
} from "./timeline.js";
import {
  appendTurnDelta,
  beginTurnPursuit,
  classifyTurnErrorOutcome,
  EMPTY_TURN_DELTA_STATE,
  EMPTY_TURN_QUEUE_STATE,
  mapConversationTurnError,
  queueTurnAnchor,
  renderTurnDeltaText,
  settleTurnPursuit,
  shouldRequestConversationTurn,
  turnQueueGiveUpText,
  type TurnDeltaState,
  type TurnQueueState
} from "./turn.js";
import {
  applyBufferedActionCardUpdates,
  EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE,
  enqueueBufferedActionCardUpdate,
  type BufferedActionCardUpdateQueue
} from "./turn-task-buffer.js";
import { pruneExpiredTypingUsers, upsertTypingUser, type TypingState } from "./typing-state.js";

type Locale = "zh-CN" | "en-US";

export type ChatDrivePageClient = {
  pages: {
    drive: (options: { projectId: string; q?: string }) => Promise<{ items: readonly { id: string; name: string; kind: string }[] }>;
  };
};

export type ChatViewApiClient = ChatApiClient & ChatDrivePageClient;

export type ChatViewHandle = {
  dispose: () => void;
  // rail.ts「主区」树叶点击时调用——把焦点交回 composer（会话点击路由，见批 2 汇报）。
  focusComposer: () => void;
  // R14 批 APPROVE-CHAT（档① 本地乐观回流）：本机在右栏审批过某份提议后，shell 调这个把 id 记进本地
  // settledProposalIds 集合并重渲——对应产出卡追加「已处理」覆盖标（乐观、仅本机，见 render.ts）。
  markProposalSettled: (proposalId: string) => void;
};

type PendingSendRecord = {
  tempId: string;
  kind: "text" | "file_card";
  text?: string;
  driveItemId?: string;
  fileName?: string;
  // R14 批 CHAT（引用回复）：仅 text 记录会带——发送时透传给 reply_to_message_id（重试也保留）。
  replyToMessageId?: string;
  status: "sending" | "error";
};

const TYPING_PING_MIN_INTERVAL_MS = 2000;
const FILE_SEARCH_DEBOUNCE_MS = 250;
const TYPING_PRUNE_INTERVAL_MS = 750;
const MAX_PICKER_RESULTS = 8;
// R13 批4c：Cuu 不是真实 workspace 成员（没有 user_id），@ picker 里用一个固定的 sentinel id 代表她；
// 落库后与其它 @ 提及一样只是纯文本 "@Cuu " 前缀，没有任何结构化标记——服务端的 @Cuu 检测（回话判定器）
// 就是靠对这段文本做词边界匹配，这是已知的、拍过板接受的局限（04 手册铁律#1 精神：不为了显得"更结构化"
// 而虚构一个这个系统本来没有的 user_id）。
const CUU_MENTION_SENTINEL_USER_ID = "cuu";
const CUU_MENTION_DISPLAY_NAME = "Cuu";
// AI 模式弹层的档位数——render.ts 的 AI_MODE_LEVELS 是私有 const（[1,2,3,4,5]），这里不额外导出
// 它来对齐，五档是 00-interaction-design.md 定死的常量，跟既有点击处理器里 `level <= 5` 的魔法数
// 同一个来源。
const MODE_LEVEL_COUNT = 5;
// R12 批8：滚到顶（scrollTop 小于这个像素阈值）自动触发「加载更早」，同「贴底」判定
// （renderScroll 里 wasNearBottom 的 48px）同一档量级。
const SCROLL_TOP_LOAD_EARLIER_PX = 48;
// 本地 DOM 窗口每次展开的步长——不是一次性全展开（那样又变回批 2 的性能问题），小步渐进。
const RENDER_WINDOW_EXPAND_STEP = 150;
// R14 批 CHAT：已读游标 PUT /read 的节流下限（进会话/滚到底/窗口重获焦点都触发，5s 内至多一次）。
const READ_PING_MIN_INTERVAL_MS = 5000;
// presence 轮询周期（GET /api/presence，成员条在线点）——30s，SSE 重连时另外补一次即时刷新。
const PRESENCE_POLL_INTERVAL_MS = 30_000;
// 「贴底」判定像素阈值（滚到底自动标记已读 + 隐藏「跳到未读」浮钮）——同 renderScroll 的 wasNearBottom。
const NEAR_BOTTOM_PX = 48;
// 引用/置顶跳转命中后的高亮闪烁时长（00 §「跳原消息滚动+高亮」，1.5s）。
const FLASH_HIGHLIGHT_MS = 1500;
// 引用跳转「本地无→beforeSeq 翻页加载到为止」的翻页次数硬上限（防跳到一条已被删/根本不存在的目标时
// 无限翻页；照 loadOlderHistory 的既有防御性熔断精神）。
const REPLY_JUMP_MAX_OLDER_PAGES = 20;

function toPendingRenderModel(record: PendingSendRecord): PendingOutgoingMessage {
  return {
    tempId: record.tempId,
    status: record.status,
    ...(record.text !== undefined ? { text: record.text } : {}),
    ...(record.fileName !== undefined ? { fileName: record.fileName } : {})
  };
}

export function addAttachment(list: readonly ComposerAttachmentChip[], next: ComposerAttachmentChip): ComposerAttachmentChip[] {
  if (list.some((attachment) => attachment.driveItemId === next.driveItemId)) {
    return [...list];
  }
  return [...list, next];
}

export function removeAttachment(list: readonly ComposerAttachmentChip[], driveItemId: string): ComposerAttachmentChip[] {
  return list.filter((attachment) => attachment.driveItemId !== driveItemId);
}

// R14 批 PERF（切片①：渲染合帧）：五个高频被动触发点（新消息到达 / reaction 回声 / message.updated 回声 /
// read 游标回声 / Cuu 流式 delta）不再每次都同步整窗 `el.innerHTML = buildScrollBodyHtml()` 重建——同一帧内的
// 多次触发合并成一次渲染。照仓库既有的可注入时钟先例（pet-surface.ts 的 scheduleDesktopPetFirstPaint /
// spotlight/controller.ts 的 window.requestAnimationFrame）做成纯调度器：不碰 DOM，`run` 就是真正的
// renderScroll，flush 时刻才读最新状态拼 HTML（流式文字不丢字——把"来一个字重建一次"变成"攒够一帧的量
// 重建一次"，60fps 下人眼分辨不出 1~2 帧的合并延迟）。用户主动操作路径（发送/翻页/跳转/点反应/编辑/删除/
// 置顶）保持同步 renderScroll，需要一帧不差的即时反馈，不接这个调度器。
export type ChatRenderScrollClock = {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout?: (callback: () => void, timeout: number) => number;
  clearTimeout?: (handle: number) => void;
};

export type RenderScrollScheduler = {
  // 请求一次"下一帧渲染"。已经排了一帧时，本次调用只是把"这一帧要渲"保持为真，不重复排队（合帧的核心）。
  schedule: () => void;
  // dispose 时取消尚未 flush 的那一帧——视图已卸载，别再往已 detach 的滚动容器写 innerHTML。
  cancel: () => void;
};

export function createRenderScrollScheduler(
  run: () => void,
  clock: ChatRenderScrollClock = globalThis as ChatRenderScrollClock
): RenderScrollScheduler {
  let pending = false;
  let rafHandle: number | undefined;
  let timeoutHandle: number | undefined;
  const flush = (): void => {
    rafHandle = undefined;
    timeoutHandle = undefined;
    if (!pending) {
      return; // 已被 cancel（dispose）抢先——这一帧作废，不渲。
    }
    pending = false;
    run();
  };
  return {
    schedule() {
      if (pending) {
        return;
      }
      pending = true;
      const raf = clock.requestAnimationFrame;
      if (raf) {
        rafHandle = raf(flush);
        return;
      }
      // 无 requestAnimationFrame（node 单测环境/非浏览器宿主）时退化成 ~16ms 定时器兜底，桌面 webview 是
      // 真实 Chromium/WebKit，raf 一定在，这条只防"没有 window 时炸"，不是主路径。
      timeoutHandle = clock.setTimeout?.(flush, 16);
    },
    cancel() {
      // pending 置回 false 是权威闸门：即便已排的 raf/timeout 回调还是被宿主/mock 触发了，flush 也会因为
      // !pending 直接返回、不渲。cancelAnimationFrame/clearTimeout 只是顺手回收句柄（宿主没提供也无妨）。
      pending = false;
      if (rafHandle !== undefined) {
        clock.cancelAnimationFrame?.(rafHandle);
        rafHandle = undefined;
      }
      if (timeoutHandle !== undefined) {
        clock.clearTimeout?.(timeoutHandle);
        timeoutHandle = undefined;
      }
    }
  };
}

// R13 H1（键盘可达性）：@ picker / 改派 picker / 模式弹层三处可选行列表共用的高亮索引状态机——纯函数，
// 不碰 DOM。这些列表都不再靠浏览器原生 Tab 逐行移动（render.ts 给每一行都打了 tabindex="-1"，
// roving：容器/keydown 处理函数才是"管理焦点"的那个,不是原生 Tab 顺序),方向键改的是这里算出来的
// 索引，Enter 用它去挑一条，Escape 关闭整个列表。

// ArrowDown/ArrowUp（direction=+1/-1）——越过两端就绕回另一端；count<=0（没有可选项）恒定给
// undefined，没有东西可高亮；从"还没高亮任何一项"开始按下 ArrowDown 落到第一项，ArrowUp 落到最后一项
// （常见列表导航习惯，如 Slack/GitHub 的 @ 建议框）。
export function movePickerHighlight(current: number | undefined, direction: 1 | -1, count: number): number | undefined {
  if (count <= 0) {
    return undefined;
  }
  if (current === undefined) {
    return direction === 1 ? 0 : count - 1;
  }
  return ((current + direction) % count + count) % count;
}

// 列表内容变化后（比如 @ picker 边打字边过滤，候选数量随时在变）把上一次记的高亮索引收进新范围——
// count<=0 时没有东西可高亮；未设置过时默认高亮第一项；越界就夹回最后一项，不做别的猜测。
export function clampPickerHighlight(current: number | undefined, count: number): number | undefined {
  if (count <= 0) {
    return undefined;
  }
  if (current === undefined) {
    return 0;
  }
  return Math.min(Math.max(current, 0), count - 1);
}

// —— R14 FIX#8 前端半（composer 无 key 横幅） —— //
//
// 后端 /api/health 已经把 ai_provider_configured 亮出来（apps/api/src/app.ts）——自托管没配模型密钥时，
// 观察者/判定器/turn 全部会静默失败，用户此前毫无感知。mountChatView 挂载时探一次这个端点，把结果
// 归到三态之一：只有明确探到 false 才算「未配置」，需要展示横幅；探测本身失败（网络抖动/服务端还没
// 起来）或者响应形状不对（防御性——万一将来这个字段被挪走）都归入 unknown，跟"明确没配置"是两个不同
// 信号，不能混为一谈——健康探测失败不该吓用户，这条红线本身就得能被单测钉住，所以拆成两个纯函数：
// mapAiProviderHealthState 只做归类，不摸网络；shouldShowNoAiProviderBanner 只做"这个状态要不要出横幅"
// 这一个布尔判断，真正的 fetch 在下面 mountChatView 内部的 loadAiProviderHealth 里。
export type AiProviderHealthState = "unknown" | "configured" | "not_configured";

export function mapAiProviderHealthState(response: { ai_provider_configured?: boolean } | undefined): AiProviderHealthState {
  if (!response || typeof response.ai_provider_configured !== "boolean") {
    return "unknown";
  }
  return response.ai_provider_configured ? "configured" : "not_configured";
}

export function shouldShowNoAiProviderBanner(state: AiProviderHealthState): boolean {
  return state === "not_configured";
}

// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增）：把 render.ts 打了 data-wb-avatar-user-id
// 标记的色块 tile（消息行/成员条）换成真实头像图（若该用户设了头像）。桌面鉴权是 client-token 走
// 响应体，不是 cookie——<img src="/api/users/:id/avatar"> 直连拿不到鉴权头，必须走 fetchDriveResource
// 那套已有的授权 fetch + 401 自愈重试（同网盘文件预览同一份逻辑），拿字节转 blob URL 再叠一个 <img>
// 到色块之上；无头像（404）/请求失败都静默保留色块，不重试轮询、不报错。
//
// avatarPhotoCache 按 userId 缓存 blob URL 的 Promise（模块级，跨会话/跨挂载复用）——群聊消息列表
// 全量重绘架构下，同一个人发的每一条消息、每一次重渲染都会重新拿到一个"新"色块 tile（旧 DOM 连同
// 已经挂上的 <img> 一起被 innerHTML 整个替换掉），不缓存字节的话会对同一个用户反复发相同的鉴权请求。
// 有意不做缓存失效/blob URL 回收：桌面客户端进程生命周期内，一个工作区的真人成员数量是几十量级，
// 常驻这点 blob URL 的内存开销可忽略；用户中途换头像要等下次启动客户端才能看见新图——同一批设计
// 取舍下可接受（同 mountChatView 本身没有 dispose 时清理网络缓存的既有先例）。
const avatarPhotoCache = new Map<string, Promise<string | null>>();

function fetchAvatarPhotoObjectUrl(userId: string): Promise<string | null> {
  const cached = avatarPhotoCache.get(userId);
  if (cached) {
    return cached;
  }
  const promise = fetchDriveResource(`${driveResourceApiBase()}/api/users/${encodeURIComponent(userId)}/avatar`)
    .then((response) => (response.ok ? response.blob() : null))
    .then((blob) => (blob ? URL.createObjectURL(blob) : null))
    .catch(() => null);
  avatarPhotoCache.set(userId, promise);
  return promise;
}

// 命令式步骤，在任何一次把带 data-wb-avatar-user-id 标记的 HTML 塞进真实 DOM 之后调用
// （renderScroll 的消息列表、成员条的 renderMemberBarHtml）。
export function hydrateAvatarPhotos(root: ParentNode): void {
  const tiles = root.querySelectorAll<HTMLElement>("[data-wb-avatar-user-id]");
  tiles.forEach((tile) => {
    const userId = tile.dataset.wbAvatarUserId;
    if (!userId) {
      return;
    }
    void fetchAvatarPhotoObjectUrl(userId).then((url) => {
      if (!url || !tile.isConnected) {
        return;
      }
      const img = document.createElement("img");
      img.alt = "";
      img.src = url;
      img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover";
      tile.style.position = "relative";
      tile.appendChild(img);
    });
  });
}

export function mountChatView(
  container: HTMLElement,
  input: {
    client: ChatViewApiClient;
    locale: Locale;
    projectId: string;
    projectName: string;
    conversationId: string;
    // R12（final-turns-wiring）：main（主区群聊，归静默观察者/批3处理）还是 collab（协同会话/单聊）——
    // 只有 collab 才会在文本消息发出去之后自动请求一轮 Cuu 回应（见 turn.ts 的
    // shouldRequestConversationTurn，这条判断本身就是"主区绝不调 turns"这条红线的唯一权威位置）。
    // 由挂载方（shell.ts）传入：主区挂载传 "main"，rail.ts 新增的协同会话树叶点开时传 "collab"。
    conversationKind: ConversationKind;
    // R13 终验修复（个人空间单聊必回）：当前项目是否个人空间——main 会话在个人空间里是 1:1 单聊，
    // turn 通道（自动请回应/模式 chip/流式气泡）全部放行；团队项目的 main 不受影响。缺省 false。
    projectIsPersonal?: boolean;
    currentUserId: string;
    members: readonly WorkbenchMemberVM[];
    getClientToken: () => string | undefined;
    streamUrl: string;
    // R12 批7:打扰矩阵的触发源——每条会话 SSE 帧的原始 event.data 都转发给它一份(不只是本视图消费
    // 得了的 message/typing),由调用方(shell.ts)接进 interrupt-broadcast.ts 判断要不要往其它窗口广播
    // 一条"该弹气泡了"。可选:不传就是纯本地渲染,不做任何打扰路由(colocated 测试/未来非工作台宿主场景)。
    onConversationEvent?: (raw: unknown) => void;
    // R12 批 6：file_card 点击 → 右栏预览，和网盘标签共用同一个情境面板控制器（在 shell.ts 挂载一次，
    // 活过项目/标签切换——见 workbench/drive/side-panel.ts 顶部注释）。可选，测试/未来消费者不必补桩。
    onOpenDriveFile?: (input: { itemId: string; itemName: string }) => void;
    // R14 批 APPROVE-CHAT（M1 接活）：产出卡「看提议」点击 → 右栏打开提议详情（proposalPanel，shell.ts 挂载
    // 一次、活过切换，与 drive/army 共用右栏插槽）。可选，测试/未来消费者不必补桩，同 onOpenDriveFile。
    onOpenProposal?: (proposalId: string) => void;
    // R14 批 CHAT（桌宠彩蛋，stretch）：有人给 Cuu 的一条消息新加了个反应时，把该露的情绪信号交出去
    // （celebrating/worried/thinking，见 reaction-emotion.ts 的映射）。detection 在这里做——只有本地持
    // 有上一份 reactions 快照的 view.ts 能 diff 出「新增了哪个键」（reaction.updated 是全量聚合，无增量）。
    // 可选：宿主不接（浏览器预览/桌宠桥不可用）就是纯本地渲染，emit 端后续接线，见完成汇报「桌宠彩蛋」。
    onCuuReactionEmotion?: (emotion: CuuReactionEmotion) => void;
  }
): ChatViewHandle {
  const doc = container.ownerDocument ?? document;
  let disposed = false;
  let messages: ConversationMessageVM[] = [];
  let pending: PendingSendRecord[] = [];
  let typing: TypingState = [];
  let connection: ConnectionBannerState = "idle";
  // R12 批8："denied" 是 00 §9「无权限项目/深链到无权会话」的空态——后端非预言式 404，见
  // renderConversationAccessDeniedHtml 顶部注释。
  let historyLoad: "loading" | "ready" | "error" | "denied" = "loading";
  // R12 批8：向上翻页状态——beforeSeq 反向游标（服务端 next_before_seq，见 api.ts 顶部注释）+
  // DOM 渲染窗口（见 timeline.ts 的 windowRecentMessages）。取代批 2 的 historyTruncated 单一标记。
  let hasOlderHistory = false;
  let oldestKnownBeforeSeq: number | undefined;
  let olderLoad: "idle" | "loading" | "error" = "idle";
  let renderWindowSize = DEFAULT_MESSAGE_RENDER_WINDOW;
  let expandedMessageIds = new Set<string>();
  // R14 批 APPROVE-CHAT（档① 本地乐观回流）：本机在右栏审批过的提议 id——产出卡据此追加「已处理」覆盖标。
  // 瞬态、不落库；重挂 chat 视图（切项目/会话）自然清空，落定态以服务端档③ 的 proposal_settled 系统消息为准。
  const settledProposalIds = new Set<string>();
  let attachments: ComposerAttachmentChip[] = [];
  let activeTrigger: ComposerTriggerMatch | undefined;
  let mentionMembers: MentionPickerMember[] = [];
  let mentionFiles: MentionPickerFile[] = [];
  let mentionFilesLoading = false;
  // R13 H1（键盘可达性）：@ picker 的方向键高亮下标——下标口径是"成员在前、文件在后"拼起来的一条
  // 序列（跟 renderMentionPickerHtml 内部的 optionIndex 计数一致）。每次触发状态变化（新字符、
  // 切换/关闭 trigger）都在 applyTriggerState 里重置成 0——边打字边过滤这种交互，每次结果变化都
  // 该回到"第一条最相关"，不保留上一次的位置。
  let mentionHighlightIndex: number | undefined;
  let draftFallback = "";
  let pendingCounter = 0;
  let lastTypingPingAt = 0;
  let fileSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let fileSearchGeneration = 0;
  let streamHandle: ConversationStreamHandle | undefined;
  // R12（final-turns-wiring）：协同会话 turn 的瞬态 UI 状态——只在 input.conversationKind === "collab"
  // 时才会被置为非初始值（beginTurn 是唯一的写入点，而 beginTurn 只在 shouldRequestConversationTurn
  // 通过之后才被调用，见下 issueSend）。turnActive 覆盖"等第一个 delta"和"delta 正在流"两个阶段
  // （用 turnDeltaState.chunks 是否为空区分要渲染哪一种）；turnErrorText 只在这一轮失败时短暂出现，
  // 下一次发送开始新一轮时清空（不是"点掉"的 dismiss 交互，够温和，见 render.ts 的两个 renderCuuTurn*
  // 函数顶部注释）。
  let turnActive = false;
  let turnDeltaState: TurnDeltaState = EMPTY_TURN_DELTA_STATE;
  let turnErrorText: string | undefined;
  // R14 P1-11：turn 进行中又发出一条新文本消息时不能被晾住——turnQueue 是 turn.ts 那组纯状态机
  // （queueTurnAnchor/beginTurnPursuit/settleTurnPursuit）的唯一持有者，只在 beginTurn 的调用点/
  // settle 回调里被读写（见 beginTurn 顶部注释与其 .then/.catch）。
  let turnQueue: TurnQueueState = EMPTY_TURN_QUEUE_STATE;
  // R12（模式五档弹层，2026-07-12 纠偏后归位到单聊）：见 render.ts"模式五档"一节顶部注释——
  // isCollabConversation 语义=「这个会话支持直接的 Cuu turn 通道」：collab 恒真；main 仅在个人空间
  // （R13 终验修复，1:1 单聊）为真，团队项目的主区永远 false——composer 不渲染模式 chip，
  // 点击/数字键处理函数也都以这个布尔值把关（04 §4 铁律 3 的双重保险：不但不渲染入口，
  // 连事件处理都不会被触发）。myMode undefined = 还没拉到 GET /api/me/ai-profile 或者拉失败——诚实
  // 显示「模式」，不假装知道当前档（见 loadMyAiProfile）。modePopoverOpen/modeErrorText 都是这个
  // 功能自己的瞬态 UI 状态，不落库。
  const isCollabConversation = shouldRequestConversationTurn(input.conversationKind, {
    personalProject: input.projectIsPersonal
  });
  let myMode: AiMode | undefined;
  let modePopoverOpen = false;
  let modeErrorText: string | undefined;
  // R13 H1（键盘可达性）：模式弹层方向键高亮下标（0..4，对应档位 1..5）——弹层一打开就定位到当前
  // 生效的档位（没拉到 myMode 时退回第一档），不强迫用户先按一下方向键才有反应；弹层关闭时清空。
  let modeHighlightIndex: number | undefined;
  // R12 P0-A1：行动卡按钮的瞬态 UI 状态——两个都不落库：
  //  - openReassignItemId：当前展开了"派给别人"极简成员选择器的条目 id（一次只开一个）；
  //  - actionCardItemErrors：decide/undo 失败后的温和行内提示，按条目 id 索引，下一次对同一条目
  //    发起操作时先清掉（见 submitActionCardDecision/submitActionCardUndo）。
  let openReassignItemId: string | undefined;
  let actionCardItemErrors = new Map<string, string>();
  // R13 批 P2（拍板链路收尾）：dispatch_ask 错过补偿——只在主区（群聊）里查，见 dispatch-ask-catchup.ts
  // 顶部注释("群里"派活问询才有这条追赶提醒；协同会话是 1:1 单聊，Cuu 有没有回应本来就在眼前，
  // 没有"错过"的场景)。undefined = 还没查完/查失败（诚实地不渲染，不是查到了"没有"）。
  let catchupNotification: Notification | undefined;
  // R13 H1（键盘可达性）：改派选择器方向键高亮下标——跟 openReassignItemId 的开关同生共死（切换/关闭
  // 时一起重置成 0/undefined），下标口径对齐 render.ts 导出的 reassignPickerMemberIds 顺序。
  let reassignHighlightIndex: number | undefined;
  // R13 批 S2（Cuu 异步化与进度可视）：turn 流式进行期间收到的 action_card.updated 事件先攒在这里，
  // 不立即应用（见 turn-task-buffer.ts 顶部注释）——turnActive 翻回 false 时由 flushBufferedActionCardUpdates
  // 统一重放。main 会话里 turnActive 恒为 false（beginTurn 只在协同会话被调用，见其声明处注释），
  // 这个队列在主区永远不会真的攒上东西。
  let bufferedActionCardUpdates: BufferedActionCardUpdateQueue = EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE;
  // R13 批 S2：execute 条目(status=running)的阶段流进度——按条目 id 索引，从该会话军团面板节流拉取
  // （见 run-progress.ts）。空 map = 还没拉到/这个会话暂时没有可关联的 run，渲染层据此退回既有的纯文字
  // 「进行中」，不强渲染进度行。
  let actionCardRunProgressByItemId: ReadonlyMap<string, ActionCardRunProgress> = new Map();
  let lastActionCardRunProgressFetchAt: number | undefined;
  let actionCardRunProgressRefetchTimer: ReturnType<typeof setTimeout> | undefined;
  // R14 FIX#8 前端半：见上方 mapAiProviderHealthState 顶部注释——"unknown" 是唯一安全的初始值/失败退化值。
  let aiProviderHealthState: AiProviderHealthState = "unknown";
  // R14 批 CHAT 瞬态 UI 状态（都不落库）：
  //  - editingMessageId/editDraft/editError：行内编辑（一次一条）；
  //  - confirmDeleteMessageId：删除二次确认（一次一条）；
  //  - replyingTo：正在引用回复的目标（composer 顶部「正在回复 xxx」条）；
  //  - pinnedMessages/pinBarCollapsed：置顶条（GET /pins 初始化，message.updated 增量维护）；
  //  - readCursors：全员已读游标 Map（GET /receipts 初始化，read.updated 增量）；
  //  - entryReadSeq：进会话那一刻本人的游标——固定住给未读分割线用（读的过程中不移动，免得线往下跑）；
  //  - lastReadPingAt/lastSentReadSeq/readPingTimer：PUT /read 节流；
  //  - onlineUserIds/presencePollTimer：presence 在线点；
  //  - observerAnalyzingUntilMs：观察者「正在整理」指示灯的过期时刻（TTL 到期或行动卡事件即消）；
  //  - bufferedMessageUpdates/bufferedReactionUpdates：turn 流式期间的编辑/反应事件缓冲（照 action_card
  //    的缓冲取舍，turn 落定统一重放，不打断正在阅读的流式气泡；main 会话 turnActive 恒 false 不攒东西）。
  let editingMessageId: string | undefined;
  let editDraft = "";
  let editError: string | undefined;
  let confirmDeleteMessageId: string | undefined;
  // R14 批 FEEDBACK：反馈备注编辑框——点击持久 badge 展开（一次只展开一条），同 editingMessageId 的
  // 「一次一条、瞬态、不落库」纪律。展开/开始编辑正文/请求删除三者互斥（各自的处理函数会清掉另外两个），
  // 避免同一条消息同时冒出两套行内输入。
  let feedbackNoteEditor: { messageId: string; draft: string; error?: string } | undefined;
  let replyingTo: { messageId: string; label: string } | undefined;
  let pinnedMessages: ConversationMessageVM[] = [];
  let pinBarCollapsed = false;
  let readCursors: ReadCursorMap = new Map();
  let entryReadSeq = 0;
  let lastReadPingAt = 0;
  let lastSentReadSeq = 0;
  let readPingTimer: ReturnType<typeof setTimeout> | undefined;
  let onlineUserIds: OnlineUserIds = new Set();
  let presencePollTimer: ReturnType<typeof setInterval> | undefined;
  let observerAnalyzingUntilMs: number | undefined;
  let bufferedMessageUpdates: ConversationMessageVM[] = [];
  let bufferedReactionUpdates: IncomingReactionUpdate[] = [];

  // 成员条里除自己以外的成员 id（已读 N/M 的分母 M；presence 也用得到成员 id 全集）——挂载时算一次，
  // 会话/成员在切项目时整块重挂（shell.ts 的 renderCenter），不会中途变。
  const otherMemberIds = input.members.map((member) => member.user_id).filter((id) => id !== input.currentUserId);
  const memberUserIds = input.members.map((member) => member.user_id);

  const membersMap = membersById(input.members);
  const renderCtx = (): ChatRenderContext => ({
    locale: input.locale,
    members: membersMap,
    currentUserId: input.currentUserId,
    expandedMessageIds,
    actionCardItemErrors,
    // exactOptionalPropertyTypes：openReassignItemId/reassignHighlightIndex 都是可选字段，undefined
    // 时整个键都不出现，不是"键在、值是 undefined"（那样和 currentUserId 那种"键必须在、值可以是
    // undefined"的字段不是一回事，TS 会拒绝后者赋给前者）。
    ...(openReassignItemId !== undefined ? { openReassignItemId } : {}),
    ...(reassignHighlightIndex !== undefined ? { reassignHighlightIndex } : {}),
    actionCardRunProgress: actionCardRunProgressByItemId,
    // R14 批 CHAT：编辑/删除确认瞬态——exactOptionalPropertyTypes 下 undefined 键完全不出现。
    ...(editingMessageId !== undefined
      ? { editing: { messageId: editingMessageId, draft: editDraft, ...(editError !== undefined ? { error: editError } : {}) } }
      : {}),
    ...(confirmDeleteMessageId !== undefined ? { confirmDeleteMessageId } : {}),
    // R14 批 FEEDBACK：反馈备注编辑框瞬态——同上，undefined 时整个键不出现。
    ...(feedbackNoteEditor !== undefined ? { feedbackNoteEditor } : {}),
    settledProposalIds
  });

  container.innerHTML = `<div class="wh-wb-chat">
    <div data-wb-chat-banner></div>
    <div data-wb-chat-head></div>
    <div data-wb-chat-pinbar></div>
    <div data-wb-chat-catchup></div>
    <div class="wh-wb-chat-scroll" data-wb-chat-scroll></div>
    <div class="wh-wb-chat-jump-slot" data-wb-chat-jump></div>
    <div data-wb-chat-observer></div>
    <div data-wb-chat-typing></div>
    <div data-wb-chat-turn-status></div>
    <div data-wb-chat-mode-hint></div>
    <div data-wb-chat-ai-provider-banner></div>
    <div data-wb-chat-composer-wrap></div>
  </div>`;
  const bannerEl = container.querySelector<HTMLElement>("[data-wb-chat-banner]");
  const headEl = container.querySelector<HTMLElement>("[data-wb-chat-head]");
  const pinBarEl = container.querySelector<HTMLElement>("[data-wb-chat-pinbar]");
  const catchupEl = container.querySelector<HTMLElement>("[data-wb-chat-catchup]");
  const scrollEl = container.querySelector<HTMLElement>("[data-wb-chat-scroll]");
  const jumpEl = container.querySelector<HTMLElement>("[data-wb-chat-jump]");
  const observerEl = container.querySelector<HTMLElement>("[data-wb-chat-observer]");
  const typingEl = container.querySelector<HTMLElement>("[data-wb-chat-typing]");
  const turnStatusEl = container.querySelector<HTMLElement>("[data-wb-chat-turn-status]");
  const modeHintEl = container.querySelector<HTMLElement>("[data-wb-chat-mode-hint]");
  const aiProviderBannerEl = container.querySelector<HTMLElement>("[data-wb-chat-ai-provider-banner]");
  const composerWrapEl = container.querySelector<HTMLElement>("[data-wb-chat-composer-wrap]");
  if (
    !bannerEl ||
    !headEl ||
    !pinBarEl ||
    !catchupEl ||
    !scrollEl ||
    !jumpEl ||
    !observerEl ||
    !typingEl ||
    !turnStatusEl ||
    !modeHintEl ||
    !aiProviderBannerEl ||
    !composerWrapEl
  ) {
    throw new Error("workbench chat view markup is missing an expected mount point");
  }

  function renderHead(): void {
    headEl!.innerHTML = renderMemberBarHtml({ members: input.members, locale: input.locale, onlineUserIds });
    hydrateAvatarPhotos(headEl!);
  }
  renderHead();

  function textareaEl(): HTMLTextAreaElement | null {
    return composerWrapEl!.querySelector<HTMLTextAreaElement>("[data-wb-chat-input]");
  }
  function pickerSlotEl(): HTMLElement | null {
    return composerWrapEl!.querySelector<HTMLElement>("[data-wb-chat-picker-slot]");
  }
  function modePopSlotEl(): HTMLElement | null {
    return composerWrapEl!.querySelector<HTMLElement>("[data-wb-chat-mode-pop-slot]");
  }

  function renderBanner(): void {
    bannerEl!.innerHTML = renderConnectionBannerHtml(connection, input.locale);
  }

  // R13 批 P2：dispatch_ask 追赶提醒条——只在主区渲染（见 catchupNotification 声明处的注释）。
  function renderCatchup(): void {
    catchupEl!.innerHTML =
      input.conversationKind === "main" ? renderDispatchAskCatchupBannerHtml(catchupNotification, input.locale) : "";
  }

  // 打开/切到这个项目的主区群聊时查一次"有没有错过的派活问询"——workbench 每次挂载主区 chat 视图都会
  // 调这个（shell.ts 的 renderCenter 只在项目/会话真的变化时才重挂，见其顶部注释），天然满足
  // "workbench 打开/切项目时"这个触发时机，不需要在 shell.ts 另开一条轮询/订阅。best-effort：
  // 拉取失败就静默保持"没有追赶提醒"，不阻塞群聊本身的可用性，也不重试轰炸——下次重新打开这个项目
  // 时会再查一次。
  async function loadDispatchAskCatchup(): Promise<void> {
    if (input.conversationKind !== "main") {
      return;
    }
    try {
      const list = await fetchNotifications(input.client);
      if (disposed) {
        return;
      }
      catchupNotification = pickDispatchAskCatchupNotification(list.items, input.projectId);
      renderCatchup();
    } catch {
      if (disposed) {
        return;
      }
      catchupNotification = undefined;
      renderCatchup();
    }
  }

  // 点开追赶提醒——最佳努力定位到"对应行动卡"（按标题文本精确匹配当前已加载的消息，见 timeline.ts 的
  // findActionCardMessageIdByTitle 顶部注释：契约里没有能直接互相关联的条目 id，这是退而求其次的方案）；
  // 找不到（标题没匹配上，或者那条卡还没被翻页加载进本地/已经滚出了当前 DOM 窗口）就诚实地退化成
  // "滚到会话顶部"——不假装总能精确定位，00 §4 铁律 3 的延伸：宁可诚实降级，不假装接线成功。
  function handleCatchupClick(): void {
    const notification = catchupNotification;
    if (!notification) {
      return;
    }
    const title = notification.body?.trim();
    const messageId = title ? findActionCardMessageIdByTitle(messages, title) : undefined;
    const targetEl = messageId
      ? Array.from(scrollEl!.querySelectorAll<HTMLElement>("[data-wb-chat-message-id]")).find(
          (node) => node.dataset.wbChatMessageId === messageId
        )
      : undefined;
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      scrollEl!.scrollTo({ top: 0, behavior: "smooth" });
    }
    // 点过一次就不用再提醒了——乐观地立刻收起这条提醒条（不等服务端确认），POST /api/notifications/:id/
    // read 是既有端点（走 client.request，不新增任何 API 面），best-effort：标记失败也不影响这次
    // "去看看"已经完成的交互，只是下次重开这个项目时这条提醒可能会再出现一次，不是致命问题。
    catchupNotification = undefined;
    renderCatchup();
    void input.client
      .request(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: "POST" })
      .catch(() => undefined);
  }

  function renderTyping(): void {
    const labels = typing
      .map((entry) => membersMap.get(entry.userId)?.nickname)
      .filter((label): label is string => Boolean(label));
    typingEl!.innerHTML = renderTypingIndicatorHtml(labels, input.locale);
  }

  // R12（final-turns-wiring）：三态——turnErrorText 优先（最新的、需要被看到的信号）；否则只在还没有
  // 任何 delta 文字时显示"Cuu 正在回复…"（一旦 turnDeltaState 有内容，正在生成的气泡本身已经在
  // 消息流里做了"还在继续"的视觉提示，这里不需要重复一份，见 buildScrollBodyHtml）；都不是就清空。
  function renderTurnStatus(): void {
    if (turnErrorText) {
      turnStatusEl!.innerHTML = renderCuuTurnErrorHtml(turnErrorText);
      return;
    }
    if (turnActive && turnDeltaState.chunks.size === 0) {
      turnStatusEl!.innerHTML = renderCuuTurnPendingHtml(input.locale);
      return;
    }
    turnStatusEl!.innerHTML = "";
  }

  // R12（模式五档）：只在协同会话出现——modeErrorText（PATCH 失败的温和提示）优先，其次是「只观察档，
  // Cuu 不会回话」的预告（myMode === 1 时），都不是就清空。main 会话（isCollabConversation 为 false）
  // 永远清空这个挂载点，composer 旁不会出现任何模式相关文字。
  function renderModeHint(): void {
    if (!isCollabConversation) {
      modeHintEl!.innerHTML = "";
      return;
    }
    if (modeErrorText) {
      modeHintEl!.innerHTML = renderModeErrorHintHtml(modeErrorText);
      return;
    }
    if (myMode === 1) {
      modeHintEl!.innerHTML = renderModeObserveOnlyHintHtml(input.locale);
      return;
    }
    modeHintEl!.innerHTML = "";
  }

  // R14 FIX#8 前端半：常驻横幅，独立于 modeHint/turn 错误提示的挂载点（各自的 renderXxx 只重刷自己
  // 那一个 div，互不打架）——只有明确探到「未配置」才渲，其余两态（unknown/configured）都清空。
  // 主区与协同会话都会渲这条（跟 modeHint 不同，modeHint 只在协同会话出现）：AI provider 没配置时，
  // 无论群聊里 @Cuu 还是单聊，Cuu 都不会回应，这是同一个事实。
  function renderAiProviderBanner(): void {
    aiProviderBannerEl!.innerHTML = shouldShowNoAiProviderBanner(aiProviderHealthState)
      ? renderNoAiProviderBannerHtml(input.locale)
      : "";
  }

  // 挂载时探一次 health——best-effort：探测失败（网络抖动/服务端还没起来）静默归入 unknown，不渲染
  // 任何东西，不重试轮询（同 loadMyAiProfile/loadDispatchAskCatchup 这批既有 best-effort 一次性拉取
  // 的取舍一致），不阻塞输入——composer 的发送闸门完全不读这个状态。
  async function loadAiProviderHealth(): Promise<void> {
    try {
      const response = await input.client.request<{ ai_provider_configured?: boolean }>("/api/health");
      if (disposed) {
        return;
      }
      aiProviderHealthState = mapAiProviderHealthState(response);
    } catch {
      if (disposed) {
        return;
      }
      aiProviderHealthState = mapAiProviderHealthState(undefined);
    }
    renderAiProviderBanner();
  }

  // R12 批8：DOM 只挂载最近 renderWindowSize 条（windowRecentMessages，见 timeline.ts）——更早的
  // 留在 messages 数组里（翻页/去重/SSE 合并的权威数据源不变），只是不进 DOM。窗口之外还分两层：
  // 本地已经拉到内存但没展开（"local"，点了立即展开，不发请求）、和内存里也没有、要问服务端要
  // （"server-*"，beforeSeq 反向翻页，见 loadOlderHistory）。
  function currentLoadEarlierState(): LoadEarlierState {
    const { hiddenLocalCount } = windowRecentMessages(messages, renderWindowSize);
    if (hiddenLocalCount > 0) {
      return { kind: "local", hiddenCount: hiddenLocalCount };
    }
    if (olderLoad === "loading") {
      return { kind: "server-loading" };
    }
    if (olderLoad === "error") {
      return { kind: "server-error" };
    }
    if (hasOlderHistory) {
      return { kind: "server-idle" };
    }
    return { kind: "none" };
  }

  function buildScrollBodyHtml(): string {
    const ctx = renderCtx();
    const { visible } = windowRecentMessages(messages, renderWindowSize);
    const groups = groupMessagesByDay(visible, { locale: input.locale });
    // R14 批 CHAT：未读分割线（本人 entryReadSeq 之后第一条他人消息上方）与聚合式「已读 N/M」（自己发的
    // 最后一条消息下方）——都在整段 messages 上算好目标 id，只有目标真的落在可见窗口里才渲（目标滚出
    // DOM 窗口时不硬渲，跳转由 jumpToMessage 负责翻回来，见 timeline.ts 窗口化前置条件）。
    const dividerBeforeId = unreadDividerBeforeMessageId(messages, entryReadSeq, input.currentUserId);
    const readSummary = readReceiptSummary(messages, readCursors, input.currentUserId, otherMemberIds);
    let html = renderLoadEarlierHtml(currentLoadEarlierState(), input.locale);
    for (const group of groups) {
      html += renderDaySeparatorHtml(group.label);
      for (const message of group.messages) {
        if (dividerBeforeId !== undefined && message.id === dividerBeforeId) {
          html += renderUnreadDividerHtml(input.locale);
        }
        html += renderMessageHtml(message, ctx);
        if (readSummary && message.id === readSummary.messageId) {
          html += renderReadReceiptHtml({ readCount: readSummary.readCount, total: readSummary.total, locale: input.locale });
        }
      }
    }
    for (const record of pending) {
      html += renderPendingOutgoingHtml(toPendingRenderModel(record), ctx);
    }
    // R12（final-turns-wiring）：正在生成的 Cuu 回复——只在真的收到过至少一个 delta 时才占一个气泡位置
    // （比 turnActive 更窄；"已经发起 turn 但还没收到第一个字"由 renderTurnStatus 的"Cuu 正在回复…"
    // 状态条覆盖，不需要在消息流里先摆一个空气泡）。
    if (turnActive && turnDeltaState.chunks.size > 0) {
      html += renderStreamingCuuBubbleHtml(renderTurnDeltaText(turnDeltaState), ctx);
    }
    return html;
  }

  // R14 批 PERF（切片③：锚定补全）：唯一的整窗渲染出口。贴底（wasNearBottom）时重新贴底跟随最新；
  // 不贴底时统一走 beforeHeight/beforeTop 高度差补偿——保持用户当前正在看的内容相对不跳动（原来的
  // renderScrollPreservingTopAnchor 只在向上翻页两处调用，其余五个高频被动触发点走的 renderScroll 在
  // 不贴底时完全不管 scrollTop，导致上方内容高度一变就整体跳动，见 08-perf-design.md §0 第 4 点）。
  // 合并后不管触发源是 loadOlderHistory / reaction 回流 / turn delta，不贴底时都做同一套补偿。
  function renderScroll(): void {
    const el = scrollEl!;
    const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    const beforeHeight = el.scrollHeight;
    const beforeTop = el.scrollTop;
    if (historyLoad === "loading") {
      el.innerHTML = renderHistoryLoadingHtml(input.locale);
      return;
    }
    if (historyLoad === "error") {
      el.innerHTML = renderHistoryLoadErrorHtml(input.locale);
      return;
    }
    if (historyLoad === "denied") {
      el.innerHTML = renderConversationAccessDeniedHtml(input.locale);
      return;
    }
    if (messages.length === 0 && pending.length === 0) {
      el.innerHTML = renderChatEmptyStateHtml({ locale: input.locale, projectName: input.projectName });
      return;
    }
    el.innerHTML = buildScrollBodyHtml();
    hydrateAvatarPhotos(el);
    if (wasNearBottom) {
      el.scrollTop = el.scrollHeight;
      // R14 批 PERF（切片②：回缩）：用户贴底回到"看最新"时，收回被翻页撑大的渲染窗口到默认值——下一次
      // 翻页需求发生时再按需撑大，不把"翻过一次历史"的代价长期背在每一次后续渲染上。
      renderWindowSize = maybeShrinkRenderWindowSize(renderWindowSize, wasNearBottom);
    } else {
      // R14 批 PERF（切片③）：不贴底——保持用户正在看的内容相对位置不跳动（同 Slack/Discord 的"向上无限
      // 滚动"手感）。高度不变（如已读回声不改渲染高度）时补偿量为 0，scrollTop 不动。
      el.scrollTop = beforeTop + (el.scrollHeight - beforeHeight);
    }
    renderJump();
  }

  // R14 批 PERF（切片①）：五个高频被动触发点走这个合帧调度器（同一帧多次触发只 renderScroll 一次），
  // 挂载时创建一次、dispose 时 cancel。用户主动操作路径继续直接调 renderScroll（见 createRenderScrollScheduler
  // 顶部注释的取舍）。
  const renderScrollScheduler = createRenderScrollScheduler(renderScroll);
  const scheduleRenderScroll = renderScrollScheduler.schedule;

  // R14 批 CHAT：置顶条（聊天区顶部可折叠）——GET /pins 初始化，message.updated 里 pinned 变化增量维护。
  function renderPinBar(): void {
    pinBarEl!.innerHTML = renderPinBarHtml({
      pins: pinnedMessages,
      collapsed: pinBarCollapsed,
      locale: input.locale,
      members: membersMap
    });
  }

  // R14 批 CHAT：观察者「正在整理」指示灯——瞬态（TTL 30s 或收到行动卡事件即消），照 typing 同款样式，
  // 渲在 typing 指示行区域（独立挂载点，不进滚动区，不打断正在阅读的流式气泡）。
  function renderObserver(): void {
    const active = observerAnalyzingUntilMs !== undefined && observerAnalyzingUntilMs > Date.now();
    observerEl!.innerHTML = active ? renderObserverAnalyzingHtml(input.locale) : "";
  }

  // R14 批 CHAT：底部「跳到未读」浮钮——有未读（本人 entryReadSeq 之后有他人消息）且当前不在底部时才渲。
  function renderJump(): void {
    if (historyLoad !== "ready") {
      jumpEl!.innerHTML = "";
      return;
    }
    const hasUnread = unreadDividerBeforeMessageId(messages, entryReadSeq, input.currentUserId) !== undefined;
    const el = scrollEl!;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    jumpEl!.innerHTML = hasUnread && !nearBottom ? renderJumpToUnreadHtml(input.locale) : "";
  }

  // R13 H1（键盘可达性）：@ picker 当前可选行总数——成员在前、文件在后拼起来的同一条序列（跟
  // renderMentionPickerHtml 内部的 optionIndex 计数口径一致）；mentionMembers/mentionFiles 本身已经
  // 分别封顶到 MAX_PICKER_RESULTS，这里不用再切一刀。
  function mentionOptionCount(): number {
    return mentionMembers.length + mentionFiles.length;
  }

  function renderPicker(): void {
    const slot = pickerSlotEl();
    if (!slot) {
      return;
    }
    if (!activeTrigger) {
      slot.innerHTML = "";
      return;
    }
    if (activeTrigger.kind === "mention") {
      // exactOptionalPropertyTypes：highlightedIndex 是可选字段，undefined 时整个键都不出现
      // （同 renderCtx 里 openReassignItemId 的取舍）。
      const highlightedIndex = clampPickerHighlight(mentionHighlightIndex, mentionOptionCount());
      slot.innerHTML = renderMentionPickerHtml({
        locale: input.locale,
        members: mentionMembers,
        files: mentionFiles,
        filesLoading: mentionFilesLoading,
        ...(highlightedIndex !== undefined ? { highlightedIndex } : {})
      });
      return;
    }
    slot.innerHTML = renderComingSoonPickerHtml({ locale: input.locale, trigger: activeTrigger.trigger as "#" | "/" });
  }

  // R13 H1（键盘可达性）：方向键/Enter 选中 @ picker 当前高亮的那一行——跟鼠标点 data-wb-chat-pick-*
  // 走的是同一条落地路径（pickMember/pickFile），只是入口从 click 换成 keydown。高亮下标越界（比如
  // 列表在异步文件搜索落地前后缩小了）先夹回合法范围，取不到就什么都不做（没有可选项）。
  function selectHighlightedMentionOption(): void {
    const highlighted = clampPickerHighlight(mentionHighlightIndex, mentionOptionCount());
    if (highlighted === undefined) {
      return;
    }
    if (highlighted < mentionMembers.length) {
      pickMember(mentionMembers[highlighted]?.userId);
      return;
    }
    pickFile(mentionFiles[highlighted - mentionMembers.length]?.itemId);
  }

  // 重建整个 composer chrome（attachments 行/send 禁用态变化时才需要）——重建前后原样保留 textarea
  // 的当前值/光标/焦点，innerHTML 重建本身会把它们清空（rail.ts 的新建项目输入框踩过同一个坑）。
  function renderComposerChrome(): void {
    const previousTa = textareaEl();
    const savedValue = previousTa?.value ?? draftFallback;
    const savedStart = previousTa?.selectionStart ?? savedValue.length;
    const savedEnd = previousTa?.selectionEnd ?? savedValue.length;
    const hadFocus = doc.activeElement === previousTa;
    composerWrapEl!.innerHTML = renderComposerHtml({
      locale: input.locale,
      draftText: savedValue,
      attachments,
      sending: false,
      // R12（模式五档）：只有协同会话才算出这个 HTML 传进去——main 会话永远是 undefined，
      // renderComposerHtml 就完全不渲染模式相关标记（见其顶部注释与 colocated 测试）。
      modeChipHtml: isCollabConversation ? renderModeChipHtml(myMode, input.locale) : undefined,
      // R13 批 P2："禁发+文案"——turnActive 只在协同会话里被置位（beginTurn 是唯一写入点，见其
      // 顶部注释），主区这里永远拿到 false，行为不受影响。
      turnActive,
      // R14 批 CHAT（引用回复）：正在引用某条消息时 composer 顶部出现「正在回复 xxx」条（可取消）。
      ...(replyingTo !== undefined ? { replyingToLabel: replyingTo.label } : {})
    });
    const nextTa = textareaEl();
    if (nextTa && hadFocus) {
      nextTa.focus();
      try {
        nextTa.setSelectionRange(savedStart, savedEnd);
      } catch {
        // 部分渲染模式拒绝 setSelectionRange——不是致命错误，焦点已经还回去了。
      }
    }
    renderPicker();
    renderModePopover();
  }

  // R12（模式五档）：独立于 renderPicker 的同款"只重刷这一个子节点"取舍——modePopoverOpen 只在
  // 用户点击模式 chip / 选档 / Escape / 点外时变化，跟 @/#// picker 的开关走的是两条互不相干的状态线，
  // 分开维护更不容易互相踩。
  function renderModePopover(): void {
    const slot = modePopSlotEl();
    if (!slot) {
      return;
    }
    // exactOptionalPropertyTypes：highlightedIndex 是可选字段，undefined 时整个键都不出现。
    slot.innerHTML = isCollabConversation && modePopoverOpen
      ? renderModePopoverHtml({
          mode: myMode,
          locale: input.locale,
          ...(modeHighlightIndex !== undefined ? { highlightedIndex: modeHighlightIndex } : {})
        })
      : "";
  }

  function syncSendButtonDisabled(): void {
    const button = composerWrapEl!.querySelector<HTMLButtonElement>("[data-wb-chat-send]");
    if (!button) {
      return;
    }
    const ta = textareaEl();
    const text = ta?.value ?? draftFallback;
    // R13 批 P2：这个函数是"输入事件里不重建整个 composer、只同步按钮 disabled 属性"的性能快捷路径
    // （见调用点的 input 监听器注释）——turnActive 时必须在这里也把关，否则用户在 turn 进行中继续
    // 打字会让这条快捷路径按"有没有文字"重新推导出 disabled=false，把 renderComposerChrome 刚设好的
    // "禁发" 状态又打开（视觉上的禁用态失效，同 handleSend 内部的硬闸门是同一条红线的两侧）。
    button.disabled = turnActive || (text.trim().length === 0 && attachments.length === 0);
  }

  // —— 历史加载（R12 批8：首屏直接要「最新一页」，不再从 afterSeq=0 正向走全量——见 api.ts 顶部
  // 注释与 batch-2-chat.md 记录的缺口） —— //
  async function loadHistory(): Promise<void> {
    historyLoad = "loading";
    renderScroll();
    try {
      const page = await fetchLatestConversationMessagesPage(input.client, input.conversationId);
      if (disposed) {
        return;
      }
      messages = sortAndDedupeMessages(page.messages);
      hasOlderHistory = page.has_more;
      oldestKnownBeforeSeq = page.next_before_seq;
      olderLoad = "idle";
      historyLoad = "ready";
      renderScroll();
      connectStream();
      // R13 批 S2：首屏就顺带查一次执行进度，不必等第一条 action_card.updated 事件才第一次看到阶段流
      // （否则一张已经在跑的执行卡在这个视图刚打开时会一直显示旧的纯文字"进行中"，直到下一次观察者
      // tick 才补上）。之后的刷新只靠事件触发+节流，见 maybeRefreshActionCardRunProgress 顶部注释。
      maybeRefreshActionCardRunProgress();
      // R14 批 CHAT：首屏顺带拉置顶清单 + 已读游标（初始化未读分割线/已读 N/M 的地基）。已读游标必须
      // 先落地（entryReadSeq 固定成"进会话那一刻我的游标"给未读分割线用，且 lastSentReadSeq 以服务端为
      // 基准），再进会话标记已读一次——否则 mark-read 先跑会把 entryReadSeq 冲成刚读到的最新 seq，未读
      // 分割线就永远出不来。都 best-effort，失败不阻塞群聊本身。
      void loadPins();
      await loadReceipts();
      if (disposed) {
        return;
      }
      maybeMarkRead();
    } catch (error) {
      if (disposed) {
        return;
      }
      // R12 批8：00 §9「无权限项目」——深链到一个 404（不可见/不存在，后端故意同形，见
      // renderConversationAccessDeniedHtml 注释）的会话，给温和的专属空态，不是"网络抖动重试"。
      historyLoad = error instanceof WorkHubApiError && error.status === 404 ? "denied" : "error";
      renderScroll();
    }
  }

  function mergeMessages(incoming: readonly ConversationMessageVM[], nearBottomHint?: boolean): void {
    if (incoming.length === 0) {
      return;
    }
    // R14 批 PERF（切片③-b）：不贴底时冻结窗口起点——见 timeline.ts 的 windowSizeAfterAppend。wasNearBottom
    // 优先复用调用方（SSE handler）已经算好的那份（设计 §2.3-b 的「共享，不必重复计算」），没传就现算一次
    // （廉价 DOM 读）。用实际新增到尾部的条数（去重后 messages 长度差）而不是 incoming.length，这样自广播
    // 回声/补拉替换（净增 0）不会白撑窗口。
    const wasNearBottom =
      nearBottomHint ?? scrollEl!.scrollHeight - scrollEl!.scrollTop - scrollEl!.clientHeight < NEAR_BOTTOM_PX;
    const before = messages.length;
    messages = sortAndDedupeMessages([...messages, ...incoming]);
    const added = messages.length - before;
    renderWindowSize = windowSizeAfterAppend(renderWindowSize, added, wasNearBottom);
    // R14 批 PERF（切片①）：新消息到达是高频被动触发（SSE message.created + turn 落定 + 补缺口），合帧。
    scheduleRenderScroll();
  }

  // —— R14 批 CHAT：置顶条 / 已读游标 / presence 的加载与维护（都 best-effort，失败静默） —— //

  async function loadPins(): Promise<void> {
    try {
      const result = await fetchConversationPins(input.client, input.conversationId);
      if (disposed) {
        return;
      }
      pinnedMessages = [...result.messages];
      renderPinBar();
    } catch {
      // best-effort：拉不到就保持现状，pin/unpin 动作或下一条 message.updated 会再补。
    }
  }

  // message.updated 里 pinned 变化时的增量维护（设计 §5「增量维护」）：现在置顶了→加进 bar（seq 降序、
  // cap 50）；取消置顶或被删除→从 bar 里移除。变化了才重渲。
  function reconcilePinFromMessage(message: ConversationMessageVM): void {
    const idx = pinnedMessages.findIndex((pin) => pin.id === message.id);
    const shouldBePinned = message.pinned !== undefined && message.deleted_at === undefined;
    if (shouldBePinned) {
      const next = idx >= 0 ? [...pinnedMessages] : [...pinnedMessages, message];
      if (idx >= 0) {
        next[idx] = message;
      }
      next.sort((a, b) => b.seq - a.seq);
      pinnedMessages = next.slice(0, 50);
      renderPinBar();
      return;
    }
    if (idx >= 0) {
      pinnedMessages = pinnedMessages.filter((pin) => pin.id !== message.id);
      renderPinBar();
    }
  }

  async function loadReceipts(): Promise<void> {
    try {
      const result = await fetchConversationReceipts(input.client, input.conversationId);
      if (disposed) {
        return;
      }
      readCursors = receiptsToCursorMap(result.receipts);
      // 进会话那一刻本人的游标固定成未读分割线的基准（读的过程中不移动）。
      entryReadSeq = readCursors.get(input.currentUserId) ?? 0;
      lastSentReadSeq = entryReadSeq;
      renderScroll();
    } catch {
      // best-effort：拉不到就当作「都没读过」（entryReadSeq=0），分割线会出现在最早的他人消息上方，
      // 不是致命错误——read.updated 事件或下次进会话会再校准。
    }
  }

  async function loadPresence(): Promise<void> {
    if (memberUserIds.length === 0) {
      return;
    }
    try {
      const result = await fetchPresence(input.client, memberUserIds);
      if (disposed) {
        return;
      }
      onlineUserIds = onlineUserIdsFromPresence(result.presence);
      renderHead();
    } catch {
      // best-effort：拉不到就保持上一次的在线集合（或空集），不清成「全离线」骚扰视觉，也不重试轰炸。
    }
  }

  // —— R14 批 CHAT：已读游标 PUT /read（进会话/滚到底/窗口重获焦点触发，5s 节流；单调，不回退） —— //

  function doMarkRead(): void {
    const seq = highestMessageSeq(messages);
    if (seq <= lastSentReadSeq) {
      return;
    }
    lastReadPingAt = Date.now();
    lastSentReadSeq = seq;
    // 乐观更新本人游标（read.updated 自广播也会回来，applyReadReceipt 幂等），让「已读 N/M」里别人看我
    // 的口径无关、但本地 receipts map 保持新鲜。
    readCursors = applyReadReceipt(readCursors, input.currentUserId, seq);
    void advanceConversationReadCursor(input.client, input.conversationId, seq)
      .then((result) => {
        if (disposed) {
          return;
        }
        // 服务端把游标夹到会话当前最大 seq——以它回的值为准（可能比我报的小）。
        readCursors = applyReadReceipt(readCursors, input.currentUserId, result.last_read_seq);
      })
      .catch(() => undefined);
  }

  function maybeMarkRead(): void {
    if (disposed || historyLoad !== "ready") {
      return;
    }
    if (highestMessageSeq(messages) <= lastSentReadSeq) {
      return;
    }
    const now = Date.now();
    const elapsed = now - lastReadPingAt;
    if (elapsed >= READ_PING_MIN_INTERVAL_MS) {
      doMarkRead();
      return;
    }
    if (readPingTimer !== undefined) {
      return; // 已经安排了一次收尾 mark，不重复安排。
    }
    readPingTimer = setTimeout(() => {
      readPingTimer = undefined;
      if (!disposed) {
        doMarkRead();
      }
    }, READ_PING_MIN_INTERVAL_MS - elapsed);
  }

  // —— R12 批8：「滚到顶加载更早」 —— //

  // 本地 DOM 窗口里还有未展开的已加载消息，就地展开，不发网络请求（见 currentLoadEarlierState 的
  // "local" 分支）；本地已经展开到头、服务端还有更早的，才真的发一次 beforeSeq 请求。
  function handleReachedTop(): void {
    if (disposed) {
      return;
    }
    const { hiddenLocalCount } = windowRecentMessages(messages, renderWindowSize);
    if (hiddenLocalCount > 0) {
      // R14 批 PERF（切片②）：封顶——本地展开也不无限撑大窗口，超上限就让最旧那批保持折叠（用户可再点展开）。
      renderWindowSize = capRenderWindowSize(renderWindowSize + RENDER_WINDOW_EXPAND_STEP);
      renderScroll();
      return;
    }
    if (hasOlderHistory && olderLoad !== "loading") {
      void loadOlderHistory();
    }
  }

  async function loadOlderHistory(): Promise<void> {
    if (olderLoad === "loading" || !hasOlderHistory || oldestKnownBeforeSeq === undefined) {
      return;
    }
    olderLoad = "loading";
    renderScroll();
    let page;
    try {
      page = await fetchOlderConversationMessagesPage(input.client, input.conversationId, {
        beforeSeq: oldestKnownBeforeSeq
      });
    } catch {
      if (disposed) {
        return;
      }
      olderLoad = "error";
      renderScroll();
      return;
    }
    if (disposed) {
      return;
    }
    // 防御性熔断：服务端契约保证空页外 next_before_seq 严格倒退（同 listMessagesAfter 的
    // next_after_seq 前进保证是一对镜像约束），万一没推进（回归 bug）就当作"没有更多了"，
    // 不要在 scroll 事件驱动下反复自动重试出死循环。
    const madeProgress = page.messages.length > 0
      && page.next_before_seq !== undefined
      && page.next_before_seq < oldestKnownBeforeSeq;
    messages = sortAndDedupeMessages([...page.messages, ...messages]);
    // 展开窗口以纳入刚拉到的这批，否则它们会立刻又被本地窗口折叠掉。
    // R14 批 PERF（切片②）：封顶——翻页也不无限撑大窗口。超上限后最旧那批会保持折叠（load-earlier 的
    // local 态），这是 08-perf-design.md §2.2 拍板的取舍：单次上翻会话里挂载条数封顶，跨越 900 条深度的
    // 定点访问交给 jumpToMessage（它允许突破 cap，见其注释）。
    renderWindowSize = capRenderWindowSize(renderWindowSize + page.messages.length);
    hasOlderHistory = madeProgress && page.has_more;
    oldestKnownBeforeSeq = madeProgress ? page.next_before_seq : oldestKnownBeforeSeq;
    olderLoad = "idle";
    renderScroll();
  }

  // 重连成功后补缺口：断线期间的消息只能靠 afterSeq=本地已知最高 seq 重新拉一遍（broker 不存回放日志，
  // 04 §0 与 apps/api/src/sse/stream.ts 顶部注释已经写死这条约束）。
  async function reconcileGap(): Promise<void> {
    let afterSeq = messages.reduce((max, message) => Math.max(max, message.seq), 0);
    for (;;) {
      if (disposed) {
        return;
      }
      let page;
      try {
        page = await fetchConversationMessagesPage(input.client, input.conversationId, { afterSeq });
      } catch {
        return; // best-effort：下一次重连/下一条实时事件会再补一次。
      }
      if (disposed) {
        return;
      }
      mergeMessages(page.messages);
      if (!page.has_more || page.next_after_seq <= afterSeq) {
        return;
      }
      afterSeq = page.next_after_seq;
    }
  }

  // 行动卡快照过期时的按需补拉（契约注释的原话：事件只负责「该刷新了」，完整卡片以 GET 为准）：
  //  - 本地根本没有这条消息（观察者建卡只发 action_card.updated，不重发 message.created）——
  //    新卡消息 seq 必然大于本地最高 seq，走既有 reconcileGap 补进来。批8 之后首屏只拉最新一页，
  //    「本地没有」也可能是这张卡老到还没被向上翻页加载——此时 reconcileGap 无缺口可补=无害 no-op，
  //    等 beforeSeq 翻页真加载到它时再渲（渲的是当时的服务端快照）；
  //  - 本地有但事件里出现快照没有的条目（观察者追加，服务端已重写这条消息的 content 但 seq 不变）——
  //    用 afterSeq=seq-1 定点重拉这一条，mergeMessages 的按 id 去重「后到覆盖先到」把旧快照换掉。
  // best-effort：拉失败就保持现状，下一条事件或断线重连的 reconcile 再补。
  async function refreshActionCardMessage(messageId: string): Promise<void> {
    const local = messages.find((message) => message.id === messageId);
    if (!local) {
      await reconcileGap();
      return;
    }
    try {
      const page = await fetchConversationMessagesPage(input.client, input.conversationId, {
        afterSeq: local.seq - 1,
        limit: 1
      });
      if (disposed) {
        return;
      }
      const fresh = page.messages.find((message) => message.id === messageId);
      if (fresh) {
        mergeMessages([fresh]);
      }
    } catch {
      // best-effort，见上。
    }
  }

  // —— R13 批 S2：execute 条目的阶段流进度（军团面板节流拉取） —— //

  // 节流窗口内真的发一次请求——lastActionCardRunProgressFetchAt 必须在请求发起（而不是拿到响应）时就
  // 更新，否则一个慢请求还没回来时的第二次触发会误判"该发了"而重复发起。best-effort：拉取失败保留
  // 上一次已知快照，不是致命错误——下一次节流窗口/action_card.updated 事件会再试一次。
  async function refreshActionCardRunProgress(): Promise<void> {
    lastActionCardRunProgressFetchAt = Date.now();
    try {
      const panel = await fetchConversationArmyPanel(input.client, input.conversationId);
      if (disposed) {
        return;
      }
      const next = new Map<string, ActionCardRunProgress>();
      for (const run of panel.runs.runs) {
        if (!run.source_action_card_item_id) {
          continue;
        }
        const progress = inferActionCardRunProgress({
          runStatus: run.status,
          recentStepPhase: run.recent_step?.phase ?? null
        });
        if (progress) {
          next.set(run.source_action_card_item_id, progress);
        }
      }
      actionCardRunProgressByItemId = next;
      // turn 正在流式进行时不在这里重渲——这次拉取本来就可能是被 action_card.updated 事件触发的，
      // 若立即 renderScroll 会打断正在阅读的流式气泡，跟 task 1 想避免的是同一件事。已经算出的最新
      // 进度快照会在 turn 落定时随 flushBufferedActionCardUpdates 的 renderScroll 一并呈现；如果那次
      // flush 恰好没有变化（changed=false）而这里又不渲，下一次 renderScroll（新增消息/typing 等任何
      // 触发点）也会用上最新的 actionCardRunProgressByItemId——不会永远卡住。
      if (!turnActive) {
        renderScroll();
      }
    } catch {
      // best-effort，见上。
    }
  }

  // 节流入口——由「聊天视图挂载/历史加载完成」和每一条 action_card.updated 事件触发（不新造 SSE，
  // 数据仍然只走既有的会话军团面板 GET）。窗口内的触发不会被直接丢弃：安排一次收尾重取，见
  // run-progress.ts 顶部注释。
  function maybeRefreshActionCardRunProgress(): void {
    if (disposed) {
      return;
    }
    const now = Date.now();
    if (shouldRefetchActionCardRunProgressNow(lastActionCardRunProgressFetchAt, now)) {
      void refreshActionCardRunProgress();
      return;
    }
    if (actionCardRunProgressRefetchTimer !== undefined) {
      return; // 已经安排了一次收尾重取，不重复安排。
    }
    const delay = Math.max(0, nextAllowedActionCardRunProgressFetchAtMs(lastActionCardRunProgressFetchAt!) - now);
    actionCardRunProgressRefetchTimer = setTimeout(() => {
      actionCardRunProgressRefetchTimer = undefined;
      void refreshActionCardRunProgress();
    }, delay);
  }

  // —— R13 批 S2：turn 期间任务事件缓冲 —— //

  // turn 落定（成功/失败都算）后一次性重放缓冲队列（见 turn-task-buffer.ts 顶部注释）。main 会话
  // 里这个队列永远是空的（beginTurn 只在协同会话被调用），这里对它调用是无害 no-op。
  function flushBufferedActionCardUpdates(): void {
    if (bufferedActionCardUpdates.length === 0) {
      return;
    }
    const queue = bufferedActionCardUpdates;
    bufferedActionCardUpdates = EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE;
    const result = applyBufferedActionCardUpdates(messages, queue);
    if (result.changed) {
      messages = result.messages;
      renderScroll();
    }
    for (const messageId of result.staleMessageIds) {
      void refreshActionCardMessage(messageId);
    }
  }

  // —— R12 P0-A1：行动卡条目 decide/undo 接线 —— //

  function clearActionCardItemError(itemId: string): void {
    if (!actionCardItemErrors.has(itemId)) {
      return;
    }
    const next = new Map(actionCardItemErrors);
    next.delete(itemId);
    actionCardItemErrors = next;
  }

  function setActionCardItemError(itemId: string, text: string): void {
    const next = new Map(actionCardItemErrors);
    next.set(itemId, text);
    actionCardItemErrors = next;
  }

  // decide/undo 成功后用 HTTP 响应的条目 VM 就地更新本地快照——同一条合并函数（timeline.ts 的
  // applyActionCardUpdate）也是 SSE 回流用的那条，见其顶部注释。找不到归属消息（理论上不该发生：
  // 按钮只会渲在本地已经持有的消息上）就静默跳过，不崩——后续 SSE 事件/reconcile 仍会补齐。
  function applyActionCardResultLocally(itemId: string, result: ActionCardItemDecisionResult): void {
    const messageId = findActionCardMessageIdForItem(messages, itemId);
    if (!messageId) {
      return;
    }
    const patchResult = applyActionCardUpdate(messages, {
      messageId,
      items: [
        {
          id: result.id,
          status: result.status,
          assigneeUserId: result.assignee_user_id,
          undoDeadlineAt: result.undo_deadline_at
        }
      ]
    });
    if (patchResult.changed) {
      messages = patchResult.messages;
    }
  }

  // 409 already_decided/already_resolved：本地快照确定过期（另一个人抢先处理了，或者上一次点击其实
  // 成功了但响应丢了）——触发一次消息重取对账，比只展示错误文案更诚实（见 action-card-decision.ts
  // 顶部注释）。其它错误码不代表本地状态过期，不重拉。
  function handleActionCardDecisionError(itemId: string, error: unknown): void {
    if (disposed) {
      return;
    }
    const code = error instanceof WorkHubApiError ? error.code : undefined;
    setActionCardItemError(
      itemId,
      mapActionCardDecisionError(error instanceof WorkHubApiError ? { status: error.status, code: error.code } : undefined, input.locale)
    );
    renderScroll();
    if (shouldReconcileActionCardOnError(code)) {
      const messageId = findActionCardMessageIdForItem(messages, itemId);
      if (messageId) {
        void refreshActionCardMessage(messageId);
      }
    }
  }

  function submitActionCardDecision(itemId: string, action: ActionCardItemDecisionAction, assigneeUserId?: string): void {
    clearActionCardItemError(itemId);
    openReassignItemId = undefined;
    reassignHighlightIndex = undefined;
    renderScroll();
    decideActionCardItem(input.client, { itemId, action, ...(assigneeUserId ? { assigneeUserId } : {}) })
      .then((result) => {
        if (disposed) {
          return;
        }
        applyActionCardResultLocally(itemId, result);
        renderScroll();
      })
      .catch((error) => {
        handleActionCardDecisionError(itemId, error);
      });
  }

  function submitActionCardUndo(itemId: string): void {
    clearActionCardItemError(itemId);
    renderScroll();
    undoActionCardItem(input.client, { itemId })
      .then((result) => {
        if (disposed) {
          return;
        }
        applyActionCardResultLocally(itemId, result);
        renderScroll();
      })
      .catch((error) => {
        handleActionCardDecisionError(itemId, error);
      });
  }

  // —— R14 批 CHAT：反应（乐观切换 + 失败回滚，静默） —— //

  function toggleReaction(messageId: string, key: ConversationReactionKey): void {
    const message = messages.find((entry) => entry.id === messageId);
    if (!message || message.deleted_at !== undefined) {
      return;
    }
    const previous = message.reactions;
    const { reactions: next, action } = toggleOwnReaction(previous, key, input.currentUserId);
    const applied = applyReactionUpdate(messages, { messageId, reactions: next });
    if (applied.changed) {
      messages = applied.messages;
      renderScroll();
    }
    const request =
      action === "add"
        ? addConversationReaction(input.client, input.conversationId, messageId, key)
        : removeConversationReaction(input.client, input.conversationId, messageId, key);
    void request.catch(() => {
      if (disposed) {
        return;
      }
      // 失败回滚到点击前的聚合（服务端幂等，回滚安全）；不弹阻断，静默恢复——下一条 reaction.updated
      // 事件（若有）仍会以服务端全量为准覆盖。
      const rolledBack = applyReactionUpdate(messages, { messageId, reactions: [...(previous ?? [])] });
      if (rolledBack.changed) {
        messages = rolledBack.messages;
        renderScroll();
      }
    });
  }

  // —— R14 批 FEEDBACK：Cuu 文字回复反馈（乐观 PUT/DELETE + 失败回滚，静默；同 toggleReaction 的纪律，
  // 但反馈是单值判定，不需要维护 user_ids 数组，逻辑更简单） —— //

  function toggleMessageFeedback(messageId: string, verdict: AiFeedbackVerdict): void {
    const message = messages.find((entry) => entry.id === messageId);
    if (!message || message.deleted_at !== undefined || message.sender_type !== "cuu" || message.kind !== "text") {
      return;
    }
    const previous = message.my_feedback;
    const decision = decideFeedbackToggle(previous?.verdict, verdict);
    // 改判（点另一个键）时把已有备注带过去——覆盖式 PUT 不带 note 就是清空，静默丢用户已经填过的备注
    // 不是好体验，见 view.ts 顶部 feedback.ts 的既有讨论。
    const carriedNote = previous?.note;
    const nextFeedback =
      decision.mode === "delete"
        ? undefined
        : { verdict: decision.verdict, ...(carriedNote ? { note: carriedNote } : {}), updated_at: new Date().toISOString() };
    const applied = applyMessageFeedbackUpdate(messages, { messageId, feedback: nextFeedback });
    if (applied.changed) {
      messages = applied.messages;
      renderScroll();
    }
    const request =
      decision.mode === "delete"
        ? deleteConversationMessageFeedback(input.client, input.conversationId, messageId)
        : putConversationMessageFeedback(input.client, input.conversationId, messageId, {
            verdict: decision.verdict,
            ...(carriedNote ? { note: carriedNote } : {})
          });
    void request.catch(() => {
      if (disposed) {
        return;
      }
      const rolledBack = applyMessageFeedbackUpdate(messages, { messageId, feedback: previous });
      if (rolledBack.changed) {
        messages = rolledBack.messages;
        renderScroll();
      }
    });
  }

  // —— R14 批 FEEDBACK：反馈备注（点持久 badge 展开的极简单行输入；不做备注是主路径默认状态） —— //

  function toggleFeedbackNoteEditor(messageId: string): void {
    if (feedbackNoteEditor?.messageId === messageId) {
      feedbackNoteEditor = undefined;
      renderScroll();
      return;
    }
    const message = messages.find((entry) => entry.id === messageId);
    // 展开备注编辑器时收起正在进行的编辑正文/删除确认——同一条消息一次只该有一个行内输入在开着。
    editingMessageId = undefined;
    confirmDeleteMessageId = undefined;
    feedbackNoteEditor = { messageId, draft: message?.my_feedback?.note ?? "" };
    renderScroll();
    const ta = scrollEl!.querySelector<HTMLTextAreaElement>("[data-wb-chat-feedback-note-input]");
    if (ta) {
      ta.focus();
      try {
        ta.setSelectionRange(ta.value.length, ta.value.length);
      } catch {
        // ignore — value 已正确。
      }
    }
  }

  function cancelFeedbackNoteEditor(): void {
    if (feedbackNoteEditor === undefined) {
      return;
    }
    feedbackNoteEditor = undefined;
    renderScroll();
  }

  function saveFeedbackNote(messageId: string): void {
    const ta = scrollEl!.querySelector<HTMLTextAreaElement>("[data-wb-chat-feedback-note-input]");
    const draftValue = ta?.value ?? feedbackNoteEditor?.draft ?? "";
    const note = normalizeFeedbackNote(draftValue);
    const message = messages.find((entry) => entry.id === messageId);
    const verdict = message?.my_feedback?.verdict;
    if (!verdict) {
      // 反馈已被别处撤销（极端竞态：另一个窗口/下次拉取把判定清掉了）——没有判定就没有备注的容身之处。
      feedbackNoteEditor = undefined;
      renderScroll();
      return;
    }
    const previous = message?.my_feedback;
    const nextFeedback = { verdict, ...(note ? { note } : {}), updated_at: new Date().toISOString() };
    feedbackNoteEditor = undefined;
    const applied = applyMessageFeedbackUpdate(messages, { messageId, feedback: nextFeedback });
    if (applied.changed) {
      messages = applied.messages;
    }
    renderScroll();
    putConversationMessageFeedback(input.client, input.conversationId, messageId, { verdict, ...(note ? { note } : {}) }).catch(
      (error) => {
        if (disposed) {
          return;
        }
        const rolledBack = applyMessageFeedbackUpdate(messages, { messageId, feedback: previous });
        if (rolledBack.changed) {
          messages = rolledBack.messages;
        }
        // 保存失败（多半是 note 超长/命中注入短语拦截的 400）——重新打开编辑框并带上温和提示，让用户能
        // 看到发生了什么、改一改再试，而不是无声无息地把刚打的字丢掉（同 saveEdit 对 409 的既有纪律）。
        const status = error instanceof WorkHubApiError ? error.status : undefined;
        const zh = input.locale === "zh-CN";
        feedbackNoteEditor = {
          messageId,
          draft: draftValue,
          error:
            status === 400
              ? zh
                ? "这句备注没保存成功，改短一点再试"
                : "Couldn't save that note — try shortening it"
              : zh
                ? "没保存成功，再试一次"
                : "Couldn't save — try again"
        };
        renderScroll();
      }
    );
  }

  // —— R14 批 FEEDBACK：行动卡条目反馈（乐观 PUT/DELETE，无备注 UI，见 04-feedback-design.md §7.1C） —— //

  function toggleActionCardItemFeedback(itemId: string, verdict: AiFeedbackVerdict): void {
    const currentVerdict = findActionCardItemFeedbackVerdict(messages, itemId);
    const decision = decideFeedbackToggle(currentVerdict, verdict);
    const previousFeedback = currentVerdict ? { verdict: currentVerdict } : undefined;
    const nextFeedback = decision.mode === "delete" ? undefined : { verdict: decision.verdict };
    const applied = applyActionCardItemFeedbackUpdate(messages, { itemId, feedback: nextFeedback });
    if (applied.changed) {
      messages = applied.messages;
      renderScroll();
    }
    const request =
      decision.mode === "delete"
        ? deleteActionCardItemFeedback(input.client, itemId)
        : putActionCardItemFeedback(input.client, itemId, decision.verdict);
    void request.catch(() => {
      if (disposed) {
        return;
      }
      const rolledBack = applyActionCardItemFeedbackUpdate(messages, { itemId, feedback: previousFeedback });
      if (rolledBack.changed) {
        messages = rolledBack.messages;
        renderScroll();
      }
    });
  }

  // —— R14 批 CHAT：行内编辑（保存用返回 VM 替换；409 窗过期温和话术） —— //

  function beginEdit(messageId: string): void {
    const message = messages.find((entry) => entry.id === messageId);
    if (!message || message.kind !== "text" || message.deleted_at !== undefined) {
      return;
    }
    if (input.currentUserId === undefined || message.sender_user_id !== input.currentUserId) {
      return;
    }
    editingMessageId = messageId;
    editDraft = message.content.text;
    editError = undefined;
    confirmDeleteMessageId = undefined;
    // R14 批 FEEDBACK：开始编辑正文时收起反馈备注编辑器——同一条消息一次只该有一个行内输入在开着。
    feedbackNoteEditor = undefined;
    renderScroll();
    // 聚焦编辑框并把光标放到末尾（同 renderComposerChrome 的取舍）。
    const ta = scrollEl!.querySelector<HTMLTextAreaElement>("[data-wb-chat-edit-input]");
    if (ta) {
      ta.focus();
      try {
        ta.setSelectionRange(ta.value.length, ta.value.length);
      } catch {
        // ignore — value 已正确。
      }
    }
  }

  function cancelEdit(): void {
    if (editingMessageId === undefined) {
      return;
    }
    editingMessageId = undefined;
    editDraft = "";
    editError = undefined;
    renderScroll();
  }

  function saveEdit(messageId: string): void {
    const ta = scrollEl!.querySelector<HTMLTextAreaElement>("[data-wb-chat-edit-input]");
    const text = (ta?.value ?? editDraft).trim();
    const original = messages.find((entry) => entry.id === messageId);
    if (!text) {
      editError = input.locale === "zh-CN" ? "内容不能为空" : "The message can't be empty.";
      renderScroll();
      return;
    }
    if (original?.kind === "text" && original.content.text === text) {
      cancelEdit();
      return;
    }
    editError = undefined;
    editConversationMessage(input.client, input.conversationId, messageId, text)
      .then((updated) => {
        if (disposed) {
          return;
        }
        const applied = applyMessageReplacement(messages, updated);
        if (applied.changed) {
          messages = applied.messages;
        }
        editingMessageId = undefined;
        editDraft = "";
        editError = undefined;
        renderScroll();
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        const code = error instanceof WorkHubApiError ? error.code : undefined;
        const status = error instanceof WorkHubApiError ? error.status : undefined;
        // 409 = 编辑窗过期 / 目标已删除——温和话术，保持编辑框开着让用户能复制自己的文字再取消。
        editError =
          status === 409
            ? input.locale === "zh-CN"
              ? "这条消息发出超过 15 分钟了，改不了啦。你可以复制内容重新发一条。"
              : "This message is more than 15 minutes old and can no longer be edited. You can copy the text and send a new one."
            : input.locale === "zh-CN"
              ? "没改成功，再试一次。"
              : "Couldn't save the edit — try again.";
        void code;
        renderScroll();
      });
  }

  // —— R14 批 CHAT：删除（二次确认 + 墓碑替换） —— //

  function requestDelete(messageId: string): void {
    confirmDeleteMessageId = messageId;
    editingMessageId = undefined;
    // R14 批 FEEDBACK：请求删除时收起反馈备注编辑器（同 beginEdit 的互斥纪律）。
    feedbackNoteEditor = undefined;
    renderScroll();
  }

  function cancelDelete(): void {
    if (confirmDeleteMessageId === undefined) {
      return;
    }
    confirmDeleteMessageId = undefined;
    renderScroll();
  }

  function confirmDelete(messageId: string): void {
    confirmDeleteMessageId = undefined;
    renderScroll();
    deleteConversationMessage(input.client, input.conversationId, messageId)
      .then((tombstone) => {
        if (disposed) {
          return;
        }
        const applied = applyMessageReplacement(messages, tombstone);
        if (applied.changed) {
          messages = applied.messages;
        }
        // 删除顺带把它从置顶条移除（服务端删除也会清 pinned，双保险）。
        reconcilePinFromMessage(tombstone);
        renderScroll();
      })
      .catch(() => {
        // best-effort：删除失败保持原样（消息还在=真实状态），不弹阻断——用户可再试。
      });
  }

  // —— R14 批 CHAT：引用回复（composer 顶部「正在回复 xxx」+ 发送带 reply_to；点引用块跳原消息） —— //

  function beginReply(messageId: string): void {
    const message = messages.find((entry) => entry.id === messageId);
    if (!message || message.deleted_at !== undefined) {
      return;
    }
    const label =
      message.sender_type === "cuu"
        ? "Cuu"
        : message.sender_type === "system"
          ? input.locale === "zh-CN"
            ? "系统"
            : "System"
          : (message.sender_user_id ? membersMap.get(message.sender_user_id)?.nickname : undefined) ??
            (input.locale === "zh-CN" ? "未知成员" : "Unknown member");
    replyingTo = { messageId, label };
    renderComposerChrome();
    textareaEl()?.focus();
  }

  function cancelReply(): void {
    if (replyingTo === undefined) {
      return;
    }
    replyingTo = undefined;
    renderComposerChrome();
  }

  // —— R14 批 CHAT：置顶/取消置顶（GET /pins 刷新 bar；message.pinned 由 message.updated 事件回流） —— //

  function togglePin(messageId: string, currentlyPinned: boolean): void {
    const request = currentlyPinned
      ? unpinConversationMessage(input.client, input.conversationId, messageId)
      : pinConversationMessage(input.client, input.conversationId, messageId);
    void request
      .then(() => {
        if (disposed) {
          return;
        }
        // 权威刷新置顶条（GET /pins）；工具条上那枚 pin 图标态由 message.updated 事件回流更新 message.pinned。
        void loadPins();
      })
      .catch(() => {
        // best-effort：失败保持现状，不弹阻断。
      });
  }

  // —— R14 批 CHAT：跳到某条消息（引用块/置顶条/跳到未读共用；本地无→beforeSeq 翻页加载到为止） —— //

  function findMessageNode(messageId: string): HTMLElement | undefined {
    return Array.from(scrollEl!.querySelectorAll<HTMLElement>("[data-wb-chat-message-id]")).find(
      (node) => node.dataset.wbChatMessageId === messageId
    );
  }

  function flashMessage(node: HTMLElement): void {
    node.classList.add("wh-wb-chat-msg--flash");
    setTimeout(() => {
      node.classList.remove("wh-wb-chat-msg--flash");
    }, FLASH_HIGHLIGHT_MS);
  }

  async function jumpToMessage(messageId: string): Promise<void> {
    // 1) 已经在 DOM 里（渲染窗口内）——直接滚过去 + 高亮。
    let node = findMessageNode(messageId);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      flashMessage(node);
      return;
    }
    // 2) 在本地 messages 里但被 DOM 窗口折叠了——把窗口撑到包含它，重渲后再滚。
    // R14 批 PERF（切片②）：这里刻意不套 capRenderWindowSize——「用户明确要求跳到某条消息」是一次性主动
    // 操作（引用/置顶/跳到未读），目标就算在 900 条之外也要够得到，否则跳转会静默落空。回到底部时切片②
    // 的 maybeShrinkRenderWindowSize 会把这个临时撑大的窗口回缩到默认值，不会长期累积。
    const localIndex = messages.findIndex((entry) => entry.id === messageId);
    if (localIndex >= 0) {
      const neededFromEnd = messages.length - localIndex;
      if (neededFromEnd > renderWindowSize) {
        renderWindowSize = neededFromEnd + RENDER_WINDOW_EXPAND_STEP;
        renderScroll();
      }
      node = findMessageNode(messageId);
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
        flashMessage(node);
      }
      return;
    }
    // 3) 本地根本没有——照 loadOlderHistory 模式反向翻页加载到为止（有硬上限，防跳到已删/不存在的目标
    // 时无限翻页），加载到后撑窗口再滚；到头还没有就诚实地什么都不做（不假装总能定位）。
    let pages = 0;
    while (!disposed && hasOlderHistory && pages < REPLY_JUMP_MAX_OLDER_PAGES) {
      pages += 1;
      await loadOlderHistory();
      if (messages.some((entry) => entry.id === messageId)) {
        break;
      }
    }
    if (disposed) {
      return;
    }
    const idx = messages.findIndex((entry) => entry.id === messageId);
    if (idx < 0) {
      return;
    }
    const neededFromEnd = messages.length - idx;
    if (neededFromEnd > renderWindowSize) {
      // R14 批 PERF（切片②）：同上，主动跳转允许突破 cap——loadOlderHistory 在上面的循环里已经把目标拉进
      // messages（它自己封顶的只是渲染窗口，不是 messages 数组），这里再无 cap 地撑窗口把目标纳入 DOM。
      renderWindowSize = neededFromEnd + RENDER_WINDOW_EXPAND_STEP;
      renderScroll();
    }
    node = findMessageNode(messageId);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      flashMessage(node);
    }
  }

  function jumpToUnread(): void {
    const dividerBeforeId = unreadDividerBeforeMessageId(messages, entryReadSeq, input.currentUserId);
    if (dividerBeforeId === undefined) {
      return;
    }
    void jumpToMessage(dividerBeforeId);
  }

  // —— R14 批 CHAT：turn 流式期间缓冲的编辑/反应事件，落定后统一重放（照 action_card 缓冲取舍） —— //

  function flushChatBuffers(): void {
    if (bufferedMessageUpdates.length === 0 && bufferedReactionUpdates.length === 0) {
      return;
    }
    const msgQueue = bufferedMessageUpdates;
    const reactionQueue = bufferedReactionUpdates;
    bufferedMessageUpdates = [];
    bufferedReactionUpdates = [];
    let changed = false;
    const staleIds: string[] = [];
    for (const updated of msgQueue) {
      const applied = applyMessageReplacement(messages, updated);
      if (applied.changed) {
        messages = applied.messages;
        changed = true;
      }
      if (applied.unknownId) {
        staleIds.push(updated.id);
      } else {
        reconcilePinFromMessage(updated);
      }
    }
    for (const reaction of reactionQueue) {
      const applied = applyReactionUpdate(messages, reaction);
      if (applied.changed) {
        messages = applied.messages;
        changed = true;
      }
      if (applied.unknownId) {
        staleIds.push(reaction.messageId);
      }
    }
    if (changed) {
      renderScroll();
    }
    for (const id of [...new Set(staleIds)]) {
      void refreshActionCardMessage(id);
    }
  }

  // —— R14 批 CHAT：SSE 事件落地（连接内调用，见 connectStream；turnActive 时缓冲编辑/反应事件） —— //

  function applyIncomingMessageUpdated(updated: ConversationMessageVM): void {
    const applied = applyMessageReplacement(messages, updated);
    if (applied.changed) {
      messages = applied.messages;
      // R14 批 PERF（切片①）：编辑/删除/置顶回流是高频被动触发（群聊里任何人改一条都广播），合帧。
      scheduleRenderScroll();
    }
    if (applied.unknownId) {
      // 本地没有这条消息（翻页还没加载到/补拉边界）——定点补拉，同行动卡快照过期的处理。
      void refreshActionCardMessage(updated.id);
      return;
    }
    // 编辑/删除/置顶都可能改 pinned/deleted——同步维护置顶条。
    reconcilePinFromMessage(updated);
  }

  function applyIncomingReactionUpdate(update: IncomingReactionUpdate): void {
    // R14 批 CHAT（桌宠彩蛋，stretch）：先按上一份本地快照 diff 出「新增了哪个反应键」——我自己的反应
    // 已经乐观应用过了（previous 里已含我），所以这里只会对「别人给 Cuu 消息新加反应」触发情绪信号，
    // 全程 best-effort（回调抛错也不影响反应本身落地）。
    const target = messages.find((entry) => entry.id === update.messageId);
    if (input.onCuuReactionEmotion && target && target.deleted_at === undefined) {
      const emotion = pickCuuReactionEmotion({
        senderType: target.sender_type,
        previous: target.reactions,
        next: update.reactions
      });
      if (emotion) {
        try {
          input.onCuuReactionEmotion(emotion);
        } catch {
          // 彩蛋失败静默——绝不因为一个装饰性情绪信号影响反应聚合的正常落地。
        }
      }
    }
    const applied = applyReactionUpdate(messages, update);
    if (applied.changed) {
      messages = applied.messages;
      // R14 批 PERF（切片①）：反应回声是高频被动触发（群聊里任何人加/取消反应都全量聚合广播），合帧。
      scheduleRenderScroll();
    }
    if (applied.unknownId) {
      void refreshActionCardMessage(update.messageId);
    }
  }

  function connectStream(): void {
    streamHandle = connectConversationStream({
      url: input.streamUrl,
      getClientToken: input.getClientToken,
      onEvent: (event) => {
        if (disposed) {
          return;
        }
        input.onConversationEvent?.(event.data);
        const message = parseIncomingMessageCreated(event.data, input.conversationId);
        if (message) {
          const wasNearBottom = scrollEl!.scrollHeight - scrollEl!.scrollTop - scrollEl!.clientHeight < NEAR_BOTTOM_PX;
          // R14 批 PERF（切片③-b）：把这份已经算好的 wasNearBottom 交给 mergeMessages 冻结窗口起点（设计
          // §2.3-b 的「共享」）——用户在上翻历史时，底部来的这条新消息不该把正在读的最旧那条挤出 DOM。
          mergeMessages([message], wasNearBottom);
          // R14 批 CHAT：如果用户本来就贴着底看最新消息，一条新消息到达即视为"看见了"，节流标记已读——
          // 不在底部（在往上翻历史）时不标记，那条新消息对用户就是"未读"，交给未读分割线/跳到未读浮钮。
          if (wasNearBottom) {
            maybeMarkRead();
          }
          return;
        }
        // R14 批 CHAT：conversation.message.updated（编辑/删除/置顶/取消置顶回流）——按 id 整条替换本地
        // 快照。turn 流式期间缓冲（同 action_card 取舍，落定后重放），不打断正在阅读的流式气泡。
        const messageUpdated = parseIncomingMessageUpdated(event.data, input.conversationId);
        if (messageUpdated) {
          if (turnActive) {
            bufferedMessageUpdates = [...bufferedMessageUpdates, messageUpdated];
            return;
          }
          applyIncomingMessageUpdated(messageUpdated);
          return;
        }
        // R14 批 CHAT：conversation.reaction.updated（全量聚合幂等替换）——同样在 turn 流式期间缓冲。
        const reactionUpdate = parseIncomingReactionUpdated(event.data, input.conversationId);
        if (reactionUpdate) {
          if (turnActive) {
            bufferedReactionUpdates = [...bufferedReactionUpdates, reactionUpdate];
            return;
          }
          applyIncomingReactionUpdate(reactionUpdate);
          return;
        }
        // R14 批 CHAT：conversation.read.updated（已读游标增量）——不缓冲（只动 receipts Map，幂等），
        // 但 turn 流式期间不立刻重渲（避免抖动流式气泡），只更新 Map，turn 落定的 renderScroll 会带出来。
        const readUpdate = parseIncomingReadUpdated(event.data, input.conversationId);
        if (readUpdate) {
          const nextCursors = applyReadReceipt(readCursors, readUpdate.userId, readUpdate.lastReadSeq);
          if (nextCursors !== readCursors) {
            readCursors = nextCursors;
            if (!turnActive) {
              // R14 批 PERF（切片①）：已读游标回声是高频被动触发（群聊里任何成员滚到底都广播），合帧。
              scheduleRenderScroll();
            }
          }
          return;
        }
        // R14 批 CHAT：conversation.observer.analyzing（瞬态指示灯）——不缓冲（渲在独立指示行区域，不进
        // 滚动区），照 typing 静默丢弃模式，设过期时刻并渲指示灯，TTL 到期或收到行动卡事件即消。
        const observerAnalyzing = parseIncomingObserverAnalyzing(event.data, input.conversationId);
        if (observerAnalyzing) {
          observerAnalyzingUntilMs = observerAnalyzing.expiresAtMs;
          renderObserver();
          return;
        }
        // R12 行动卡状态回流（00 §9 撤销后置灰划线）：条目状态就地合并进本地快照，快照缺条目/缺消息
        // 时按需补拉——事件不带 title_md，光靠它渲不出新条目。
        const cardUpdate = parseIncomingActionCardUpdated(event.data, input.conversationId);
        if (cardUpdate) {
          // R14 批 CHAT：行动卡事件到达 = 观察者"整理完了"，指示灯即消（00-interaction-design §2.2）。
          if (observerAnalyzingUntilMs !== undefined) {
            observerAnalyzingUntilMs = undefined;
            renderObserver();
          }
          // R13 批 S2：这类事件也是"该重取一次执行进度了"的信号（节流，见 maybeRefreshActionCardRunProgress
          // 顶部注释）——跟下面 turnActive 缓冲判断是两件独立的事：进度数据本身随时可以去查，只是
          // "查回来之后要不要立刻画出来"才受 turnActive 影响（refreshActionCardRunProgress 内部自己判断）。
          maybeRefreshActionCardRunProgress();
          if (turnActive) {
            // turn 正在流式进行——缓冲这条任务类事件，turn 落定后统一重放，不打断正在阅读的流式气泡
            // （见 turn-task-buffer.ts 顶部注释）。typing/delta 事件不受这条影响，见下方对应分支。
            bufferedActionCardUpdates = enqueueBufferedActionCardUpdate(bufferedActionCardUpdates, cardUpdate);
            return;
          }
          const result = applyActionCardUpdate(messages, cardUpdate);
          if (result.changed) {
            messages = result.messages;
            renderScroll();
          }
          if (result.snapshotStale) {
            void refreshActionCardMessage(cardUpdate.messageId);
          }
          return;
        }
        const typingSignal = parseIncomingTyping(event.data, input.conversationId, input.currentUserId);
        if (typingSignal) {
          typing = upsertTypingUser(typing, typingSignal, Date.now());
          renderTyping();
        }
        // R12（final-turns-wiring）：只在这条会话真的是本地已经发起了一轮 turn（turnActive）时才拼接
        // delta——不靠 conversationKind 二次把关（parseIncomingMessageDelta 已经按 conversation_id 过滤，
        // 主区的 SSE 连接订阅的是主区自己的 topic，物理上收不到协同会话的 delta），turnActive 这层只是
        // 避免把一个跟当前"这次发送"无关的旧/重复 delta 拼进一个已经结束的气泡。
        if (turnActive) {
          const delta = parseIncomingMessageDelta(event.data, input.conversationId);
          if (delta) {
            turnDeltaState = appendTurnDelta(turnDeltaState, delta);
            // R14 批 PERF（切片①，收益最大的一处）：Cuu 流式回复一轮 20~40 个 delta chunk，原本每个字都整窗
            // 重建一次（逐字卡顿）——合帧后收敛到"每帧最多一次"。renderScroll 在 flush 时刻读最新的
            // turnDeltaState，拼出来仍是最新全文，不丢字。renderTurnStatus 是独立小状态条（非整窗），保持即时。
            scheduleRenderScroll();
            renderTurnStatus();
            return;
          }
        }
        // 其它事件名（"connected" 控制帧、批4 的 tool 事件）本批不处理，静默忽略。
      },
      onStatus: (status) => {
        if (disposed) {
          return;
        }
        connection = status.state;
        renderBanner();
      },
      onReconnected: () => {
        void reconcileGap();
        // R14 批 CHAT：重连后即时刷一次 presence（断线期间可能有人上下线，30s 轮询等不及）。
        void loadPresence();
      }
    });
  }

  const typingPruneTimer = setInterval(() => {
    const now = Date.now();
    const next = pruneExpiredTypingUsers(typing, now);
    if (next !== typing) {
      typing = next;
      renderTyping();
    }
    // R14 批 CHAT：观察者「正在整理」指示灯 TTL 过期即消（照 typing 同款惰性清理，不另起计时器）。
    if (observerAnalyzingUntilMs !== undefined && observerAnalyzingUntilMs <= now) {
      observerAnalyzingUntilMs = undefined;
      renderObserver();
    }
  }, TYPING_PRUNE_INTERVAL_MS);

  function maybePingTyping(): void {
    const now = Date.now();
    if (now - lastTypingPingAt < TYPING_PING_MIN_INTERVAL_MS) {
      return;
    }
    lastTypingPingAt = now;
    void pingConversationTyping(input.client, input.conversationId).catch(() => undefined);
  }

  function filterMembers(query: string): MentionPickerMember[] {
    const normalized = query.trim().toLowerCase();
    const all = input.members.map((member) => ({ userId: member.user_id, nickname: member.nickname }));
    // R13 批4c：Cuu 的 sentinel 候选永远排在最前——@ 一下 Cuu 是最常见的意图，不该被淹没在成员列表里。
    const withCuu = [{ userId: CUU_MENTION_SENTINEL_USER_ID, nickname: CUU_MENTION_DISPLAY_NAME }, ...all];
    const matches = normalized ? withCuu.filter((member) => member.nickname.toLowerCase().includes(normalized)) : withCuu;
    return matches.slice(0, MAX_PICKER_RESULTS);
  }

  function scheduleFileSearch(query: string): void {
    if (fileSearchTimer !== undefined) {
      clearTimeout(fileSearchTimer);
    }
    const generation = ++fileSearchGeneration;
    mentionFilesLoading = true;
    renderPicker();
    fileSearchTimer = setTimeout(() => {
      void input.client.pages
        .drive({ projectId: input.projectId, q: query })
        .then((vm) => {
          if (disposed || generation !== fileSearchGeneration) {
            return;
          }
          mentionFiles = vm.items
            .filter((item) => item.kind === "file")
            .slice(0, MAX_PICKER_RESULTS)
            .map((item) => ({ itemId: item.id, name: item.name }));
          mentionFilesLoading = false;
          renderPicker();
        })
        .catch(() => {
          if (disposed || generation !== fileSearchGeneration) {
            return;
          }
          mentionFiles = [];
          mentionFilesLoading = false;
          renderPicker();
        });
    }, FILE_SEARCH_DEBOUNCE_MS);
  }

  function applyTriggerState(text: string, cursor: number): void {
    const trigger = detectComposerTrigger(text, cursor);
    activeTrigger = trigger ?? undefined;
    // R13 H1（键盘可达性）：每次触发状态变化（新字符改了过滤词、切换/关闭 trigger）都回到"第一条
    // 最相关"——边打字边过滤的列表不该保留上一次按键留下的高亮位置。
    mentionHighlightIndex = 0;
    if (trigger?.kind === "mention") {
      mentionMembers = filterMembers(trigger.query);
      scheduleFileSearch(trigger.query);
      return;
    }
    mentionFiles = [];
    mentionFilesLoading = false;
    renderPicker();
  }

  function pickMember(userId: string | undefined): void {
    if (!userId || !activeTrigger) {
      return;
    }
    // R13 批4c：Cuu 是 @ picker 里的一个 sentinel 候选（不是真实 workspace 成员，membersMap 里
    // 查不到），让用户能用同一套 @ 交互点出「@Cuu」；落库后仍然只是纯文本 "@Cuu " 前缀——服务端的
    // @Cuu 检测（回话判定器）按显示名词边界匹配这段文本，不依赖任何结构化 user_id 标记。
    const nickname = userId === CUU_MENTION_SENTINEL_USER_ID ? CUU_MENTION_DISPLAY_NAME : membersMap.get(userId)?.nickname;
    const ta = textareaEl();
    if (!nickname || !ta) {
      return;
    }
    const result = applyComposerChipInsertion(ta.value, activeTrigger, `@${nickname} `);
    ta.value = result.text;
    draftFallback = result.text;
    activeTrigger = undefined;
    mentionFiles = [];
    try {
      ta.setSelectionRange(result.cursor, result.cursor);
    } catch {
      // ignore — value is already correct even if the cursor can't be restored.
    }
    ta.focus();
    renderPicker();
    syncSendButtonDisabled();
  }

  function pickFile(itemId: string | undefined): void {
    if (!itemId || !activeTrigger) {
      return;
    }
    const file = mentionFiles.find((candidate) => candidate.itemId === itemId);
    const ta = textareaEl();
    if (!file || !ta) {
      return;
    }
    const result = applyComposerChipInsertion(ta.value, activeTrigger, "");
    ta.value = result.text;
    draftFallback = result.text;
    activeTrigger = undefined;
    try {
      ta.setSelectionRange(result.cursor, result.cursor);
    } catch {
      // ignore.
    }
    attachments = addAttachment(attachments, { driveItemId: file.itemId, name: file.name });
    renderComposerChrome();
  }

  // R13 批4c：Cuu 的澄清追问带了几个选项按钮（render.ts 的 textMessageBodyHtml）——点一个直接把
  // 选项文本填进输入框并聚焦，不需要用户重新敲一遍；不追加进已有草稿（澄清追问的回答通常就是这几个
  // 词之一，直接替换比追加更符合"选一个答案"的心智）。真正发送仍然要用户自己按发送/回车，这里只是
  // 帮忙填好，不代替用户确认。
  function applyClarifyOptionToComposer(optionText: string | undefined): void {
    if (!optionText) {
      return;
    }
    const ta = textareaEl();
    if (!ta) {
      return;
    }
    ta.value = optionText;
    draftFallback = optionText;
    ta.focus();
    try {
      ta.setSelectionRange(optionText.length, optionText.length);
    } catch {
      // ignore — value is already correct even if the cursor can't be restored.
    }
    syncSendButtonDisabled();
  }

  function insertMentionShortcut(): void {
    const ta = textareaEl();
    if (!ta) {
      return;
    }
    ta.focus();
    const cursor = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, cursor);
    const needsSpace = before.length > 0 && !/\s$/u.test(before);
    const insertion = `${needsSpace ? " " : ""}@`;
    const nextValue = `${before}${insertion}${ta.value.slice(cursor)}`;
    const nextCursor = cursor + insertion.length;
    ta.value = nextValue;
    draftFallback = nextValue;
    try {
      ta.setSelectionRange(nextCursor, nextCursor);
    } catch {
      // ignore.
    }
    applyTriggerState(nextValue, nextCursor);
  }

  function issueSend(record: PendingSendRecord): void {
    const promise =
      record.kind === "text"
        ? sendConversationTextMessage(input.client, input.conversationId, record.text ?? "", undefined, record.replyToMessageId)
        : sendConversationFileCardMessage(input.client, input.conversationId, record.driveItemId ?? "");
    promise
      .then((created) => {
        if (disposed) {
          return;
        }
        pending = pending.filter((entry) => entry.tempId !== record.tempId);
        mergeMessages([created]);
        // R12（final-turns-wiring）：一条文本消息真的落库之后，协同会话（kind='collab'）自动请 Cuu
        // 接一句——shouldRequestConversationTurn 是唯一的判定点（见 turn.ts 顶部注释），主区
        // （kind='main'）在这里永远拿到 false，不会走到 beginTurn 半步。file_card 消息不触发——服务端
        // 契约本来就只认"最近一条 user_message_id 指向的文本消息"当锚点，丢一个文件不构成"该 Cuu 说话了"
        // 的信号。
        //
        // R14 P1-11：composer 的"禁发"闸门（turnActive）只在 beginTurn 已经被调用之后才生效——这条
        // 消息落库的 HTTP 响应和上一条消息落库/开始 turn 的时序完全可能交错（用户在第一条消息还没落库
        // 完、turnActive 还是 false 的窗口里就把第二条也发出去了）。到这里如果发现 turnActive 已经是
        // true（上一条消息的 turn 正在飞），不能像过去那样无脑再调一次 beginTurn——服务端的会话级忙碌闸
        // 只会拒第二个请求（409 conversation_turn_busy），而且没人会再帮这条消息重试，它就被晾住了。
        // 改成把这条消息记成"待回应锚点"（queueTurnAnchor，只记最新一条），等当前这一轮 turn 结束
        // （settleTurnPursuit）时自动补一轮。
        if (record.kind === "text" && shouldRequestConversationTurn(input.conversationKind, { personalProject: input.projectIsPersonal })) {
          if (turnActive) {
            turnQueue = queueTurnAnchor(turnQueue, created.id);
          } else {
            beginTurn(created.id);
          }
        }
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        const found = pending.find((entry) => entry.tempId === record.tempId);
        if (found) {
          found.status = "error";
          renderScroll();
        }
      });
  }

  // R14 P1-11：一轮 turn 结束（成功/失败都算）之后，按 turn.ts 的 settleTurnPursuit 决策把队列状态
  // 推进一步——有排队的新锚点就自动追一轮（beginTurn 会重新触发它自己的 render），没有就什么都不做。
  // 抽成单独函数是因为 .then/.catch 两条路径都要在各自的收尾处调用同一段逻辑。
  function advanceTurnQueue(outcome: "busy" | "settled"): void {
    const decision = settleTurnPursuit(turnQueue, outcome);
    turnQueue = decision.state;
    if (decision.action === "retry_same" || decision.action === "retry_anchor") {
      beginTurn(decision.messageId);
      return;
    }
    if (decision.action === "give_up") {
      turnErrorText = turnQueueGiveUpText(input.locale);
      renderTurnStatus();
    }
  }

  // R12（final-turns-wiring）：POST /conversations/:id/turns 的等待/流式/落定三段。同一会话同时只有
  // 一轮进行中（服务端并发闸，见 conversation-turns.ts）——但客户端不再假设"我自己不会撞见 409 busy"：
  // 上一条消息落库到这条消息落库之间的时序完全可能交错（R14 P1-11），也可能是小群回话判定器的 tick
  // 抢先拿到了锁；beginTurn 每次真正发起请求前先调 beginTurnPursuit 登记"在追哪条消息"，撞见 busy 时
  // 由 advanceTurnQueue/settleTurnPursuit 决定原地重试还是放弃（最多连败 3 次，见 turn.ts 顶部注释），
  // 不是本地要去拦的错误，是要如实处理的服务端状态。
  function beginTurn(userMessageId: string): void {
    if (disposed) {
      return;
    }
    turnQueue = beginTurnPursuit(turnQueue, userMessageId);
    turnActive = true;
    turnDeltaState = EMPTY_TURN_DELTA_STATE;
    turnErrorText = undefined;
    renderTurnStatus();
    // R13 批 P2："禁发+文案"——turnActive 每次翻转都要重刷 composer chrome，不然发送按钮的 disabled
    // 属性/占位提示只会在下一次别的原因触发 renderComposerChrome 时才跟着更新（比如打字触发的是
    // 更轻量的 syncSendButtonDisabled，不会重画 placeholder）。renderComposerChrome 内部会保留当前
    // 已经打的草稿文字与光标位置，不会打断用户在 turn 进行中继续打字。
    renderComposerChrome();
    requestConversationTurn(input.client, input.conversationId, { userMessageId })
      .then((result) => {
        if (disposed) {
          return;
        }
        turnActive = false;
        turnDeltaState = EMPTY_TURN_DELTA_STATE;
        // R13 批 S2：turn 落定——把流式期间攒下的任务类事件一次性重放（见 flushBufferedActionCardUpdates
        // 顶部注释）。放在 mergeMessages 之前/之后都行（两者改的是不相交的消息 id），这里选在它之前，
        // 让"后台任务的事"先归位，再落这一轮对话本身的最终消息。
        flushBufferedActionCardUpdates();
        flushChatBuffers();
        // 服务端设计决策：Cuu 落库的回复不会触发任何 message.created 广播（见 turn.ts 顶部注释）——
        // 这次 HTTP 响应本身就是唯一的权威"这一轮说完了"信号。mergeMessages 按 id 去重，真把它排进
        // 消息流该在的位置，同时（内部调用 renderScroll）把上面的临时气泡换成这条真消息。
        mergeMessages([result.message]);
        renderTurnStatus();
        renderComposerChrome();
        // R14 P1-11：这一轮成功落定——如果这期间又有新消息把锚点排上了队，自动追一轮。
        advanceTurnQueue("settled");
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        turnActive = false;
        turnDeltaState = EMPTY_TURN_DELTA_STATE;
        const code = error instanceof WorkHubApiError ? error.code : undefined;
        const classification = classifyTurnErrorOutcome(code);
        // R14 P1-11：409 busy 转入自动重试队列，界面不展示任何文字（重试对用户透明）；
        // conversation_turn_not_warranted 是回话判定器的正常业务态，保持静默；其它错误码照旧展示
        // mapConversationTurnError 的温和文案（见 turn.ts 顶部注释三种分类的取舍）。
        turnErrorText =
          classification === "error"
            ? mapConversationTurnError(
                error instanceof WorkHubApiError ? { status: error.status, code: error.code } : undefined,
                input.locale
              )
            : undefined;
        // R13 批 S2：turn 落定（这一轮失败也算数）——同样要重放缓冲队列，见上。
        flushBufferedActionCardUpdates();
        flushChatBuffers();
        // mergeMessages 在成功路径里已经会 renderScroll；失败路径没有新消息可合并，这里手动补一次
        // 好让临时气泡从消息流里消失（turnActive 已经是 false，buildScrollBodyHtml 不会再画它）。
        renderScroll();
        renderTurnStatus();
        renderComposerChrome();
        // R14 P1-11：busy 就走自动重试链（原地重试同一条消息，连败到上限才放弃）；其它收场方式
        // （成功/silent/error）只检查有没有排队的新锚点。advanceTurnQueue 内部会在 give_up 时重设
        // turnErrorText 并重渲染——覆盖掉上面刚设的 undefined/普通错误文案是有意的：连败放弃的提示
        // 优先级更高，得盖过去（give_up 只会在 classification === "busy" 时发生，不会跟"error"分支的
        // 文案打架）。
        advanceTurnQueue(classification === "busy" ? "busy" : "settled");
      });
  }

  // R12（模式五档）：挂载时拉一次「我的模式」——只有协同会话才拉（主区 composer 根本不渲染这个控件，
  // 拉了也没地方展示）。失败就让 myMode 保持 undefined，chip 诚实显示「模式」，不瞎猜一个默认档；
  // 04 §4 铁律 3 的"不假接线"延伸到"不假装知道状态"。
  async function loadMyAiProfile(): Promise<void> {
    if (!isCollabConversation) {
      return;
    }
    try {
      const profile = await fetchMyAiProfile(input.client);
      if (disposed) {
        return;
      }
      myMode = profile.default_mode;
    } catch {
      if (disposed) {
        return;
      }
      myMode = undefined;
    }
    renderComposerChrome();
    renderModeHint();
  }

  function closeModePopover(): void {
    if (!modePopoverOpen) {
      return;
    }
    modePopoverOpen = false;
    modeHighlightIndex = undefined;
    renderComposerChrome();
  }

  function toggleModePopover(): void {
    if (!isCollabConversation) {
      return;
    }
    modePopoverOpen = !modePopoverOpen;
    // R13 H1（键盘可达性）：一打开就定位到当前生效的档位（没拉到 myMode 时退回第一档）——不强迫
    // 用户先按一下方向键才看到高亮在哪；关闭时清空，不留一个不再有意义的下标。
    modeHighlightIndex = modePopoverOpen ? (myMode ?? 1) - 1 : undefined;
    renderComposerChrome();
  }

  // 乐观更新 + 失败回滚：chip/弹层立刻切到 nextMode，PATCH 在背后跑；失败就把 myMode 换回去、弹一句
  // 温和的行内提示（renderModeHint 里的 modeErrorText 分支），不是阻断式对话框（同 turn.ts 的
  // "不弹阻断"取舍）。选中当前已经生效的档位也会关掉弹层，但不会发一次没意义的 PATCH。
  function selectMode(nextMode: number): void {
    if (!isCollabConversation) {
      return;
    }
    modePopoverOpen = false;
    modeHighlightIndex = undefined;
    modeErrorText = undefined;
    if (nextMode === myMode) {
      renderComposerChrome();
      renderModeHint();
      return;
    }
    const previousMode = myMode;
    myMode = nextMode;
    renderComposerChrome();
    renderModeHint();
    patchMyAiMode(input.client, nextMode)
      .then((profile) => {
        if (disposed) {
          return;
        }
        myMode = profile.default_mode;
        renderComposerChrome();
        renderModeHint();
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        myMode = previousMode;
        modeErrorText = modePatchFailedText(input.locale);
        renderComposerChrome();
        renderModeHint();
      });
  }

  function enqueueSend(
    kind: "text" | "file_card",
    payload: { text?: string; driveItemId?: string; fileName?: string; replyToMessageId?: string }
  ): void {
    pendingCounter += 1;
    const record: PendingSendRecord = {
      tempId: `pending-${input.conversationId}-${pendingCounter}`,
      kind,
      status: "sending",
      ...(payload.text !== undefined ? { text: payload.text } : {}),
      ...(payload.driveItemId !== undefined ? { driveItemId: payload.driveItemId } : {}),
      ...(payload.fileName !== undefined ? { fileName: payload.fileName } : {}),
      ...(payload.replyToMessageId !== undefined ? { replyToMessageId: payload.replyToMessageId } : {})
    };
    pending = [...pending, record];
    renderScroll();
    issueSend(record);
  }

  function retryPending(tempId: string | undefined): void {
    if (!tempId) {
      return;
    }
    const record = pending.find((entry) => entry.tempId === tempId);
    if (!record) {
      return;
    }
    record.status = "sending";
    renderScroll();
    issueSend(record);
  }

  function handleSend(): void {
    // R13 批 P2："禁发"的权威闸门——按钮的 disabled 属性只挡得住鼠标点击，Enter 键的 keydown 监听器
    // 从来不看按钮状态、直接调这个函数（见下面 composerWrapEl 的 keydown 监听器），turnActive 时必须
    // 在这里再把一次关，不能只依赖 UI 层的视觉禁用态。
    if (turnActive) {
      return;
    }
    const ta = textareaEl();
    const text = (ta?.value ?? draftFallback).trim();
    const toAttach = attachments;
    if (!text && toAttach.length === 0) {
      return;
    }
    if (ta) {
      ta.value = "";
    }
    draftFallback = "";
    attachments = [];
    activeTrigger = undefined;
    // R14 批 CHAT（引用回复）：把当前引用目标绑到这条 text 消息上，然后清掉回复态（banner 随 chrome 重渲
    // 消失）。文件卡消息不带引用（服务端只让 text 变体带 reply_to_message_id）。
    const replyToMessageId = replyingTo?.messageId;
    replyingTo = undefined;
    renderComposerChrome();
    for (const attachment of toAttach) {
      enqueueSend("file_card", { driveItemId: attachment.driveItemId, fileName: attachment.name });
    }
    if (text) {
      enqueueSend("text", { text, ...(replyToMessageId !== undefined ? { replyToMessageId } : {}) });
    }
  }

  renderComposerChrome();

  composerWrapEl.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.matches("[data-wb-chat-input]")) {
      return;
    }
    const ta = event.target;
    draftFallback = ta.value;
    maybePingTyping();
    const cursor = ta.selectionStart ?? ta.value.length;
    applyTriggerState(ta.value, cursor);
    syncSendButtonDisabled();
  });

  composerWrapEl.addEventListener("keydown", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.matches("[data-wb-chat-input]")) {
      return;
    }
    // R13 H1（键盘可达性）：@ picker 打开着的时候，方向键/Enter/Escape 先喂给它——焦点仍然留在
    // textarea 里（边打字边过滤这条 UX 不能丢，见 mentionHighlightIndex 顶部注释），只是这几个键
    // 从"移动文本光标/发送/什么都不做"临时改道成"picker 导航"。「即将上线」的 #// picker 没有可选
    // 行，Escape 仍然生效（关掉它），方向键/Enter 对它是 no-op（activeTrigger.kind !== "mention"）。
    if (activeTrigger?.kind === "mention") {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        mentionHighlightIndex = movePickerHighlight(mentionHighlightIndex, event.key === "ArrowDown" ? 1 : -1, mentionOptionCount());
        renderPicker();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        selectHighlightedMentionOption();
        return;
      }
    }
    if (activeTrigger && event.key === "Escape") {
      event.preventDefault();
      activeTrigger = undefined;
      mentionFiles = [];
      mentionFilesLoading = false;
      renderPicker();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  });

  composerWrapEl.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    if (target.closest("[data-wb-chat-send]")) {
      handleSend();
      return;
    }
    // R14 批 CHAT（引用回复）：取消「正在回复 xxx」。
    if (target.closest("[data-wb-chat-cancel-reply]")) {
      cancelReply();
      return;
    }
    if (target.closest('[data-wb-chat-tool-trigger="@"]')) {
      insertMentionShortcut();
      return;
    }
    if (target.closest("[data-wb-chat-mode-toggle]")) {
      toggleModePopover();
      return;
    }
    const modeOption = target.closest<HTMLElement>("[data-wb-chat-mode-option]");
    if (modeOption?.dataset.wbChatModeOption) {
      const level = Number(modeOption.dataset.wbChatModeOption);
      if (Number.isInteger(level) && level >= 1 && level <= 5) {
        selectMode(level);
      }
      return;
    }
    const removeBtn = target.closest<HTMLElement>("[data-wb-chat-remove-attachment]");
    if (removeBtn?.dataset.wbChatRemoveAttachment) {
      attachments = removeAttachment(attachments, removeBtn.dataset.wbChatRemoveAttachment);
      renderComposerChrome();
      return;
    }
    const memberRow = target.closest<HTMLElement>("[data-wb-chat-pick-member]");
    if (memberRow) {
      pickMember(memberRow.dataset.wbChatPickMember);
      return;
    }
    const fileRow = target.closest<HTMLElement>("[data-wb-chat-pick-file]");
    if (fileRow) {
      pickFile(fileRow.dataset.wbChatPickFile);
    }
  });

  scrollEl.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    if (target.closest("[data-wb-chat-retry-history]")) {
      void loadHistory();
      return;
    }
    if (target.closest("[data-wb-chat-load-earlier]")) {
      handleReachedTop();
      return;
    }
    const expandBtn = target.closest<HTMLElement>("[data-wb-chat-expand-message]");
    if (expandBtn?.dataset.wbChatExpandMessage) {
      expandedMessageIds = new Set(expandedMessageIds).add(expandBtn.dataset.wbChatExpandMessage);
      renderScroll();
      return;
    }
    const collapseBtn = target.closest<HTMLElement>("[data-wb-chat-collapse-message]");
    if (collapseBtn?.dataset.wbChatCollapseMessage) {
      const next = new Set(expandedMessageIds);
      next.delete(collapseBtn.dataset.wbChatCollapseMessage);
      expandedMessageIds = next;
      renderScroll();
      return;
    }
    const retryBtn = target.closest<HTMLElement>("[data-wb-chat-retry-pending]");
    if (retryBtn) {
      retryPending(retryBtn.dataset.wbChatRetryPending);
      return;
    }
    const fileCardBtn = target.closest<HTMLElement>("[data-wb-chat-open-file]");
    if (fileCardBtn?.dataset.wbChatOpenFile) {
      input.onOpenDriveFile?.({
        itemId: fileCardBtn.dataset.wbChatOpenFile,
        itemName: fileCardBtn.dataset.wbChatOpenFileName ?? ""
      });
      return;
    }
    // R14 批 APPROVE-CHAT（M1 接活）：产出卡「看提议」点击 → 右栏打开提议详情（同 file_card 的抛给 shell 模式）。
    const openProposalBtn = target.closest<HTMLElement>("[data-wb-chat-open-proposal]");
    if (openProposalBtn?.dataset.wbChatOpenProposal) {
      input.onOpenProposal?.(openProposalBtn.dataset.wbChatOpenProposal);
      return;
    }
    const clarifyOptionBtn = target.closest<HTMLElement>("[data-wb-chat-clarify-option]");
    if (clarifyOptionBtn) {
      applyClarifyOptionToComposer(clarifyOptionBtn.dataset.wbChatClarifyOption);
      return;
    }
    // —— R14 批 CHAT：消息行 hover 工具条 + 反应行 + 引用块跳转 + 行内编辑/删除确认 —— //
    // 反应（工具条五键快捷加 + 气泡下反应行 chip 走同一条 data-wb-chat-react 路径，切换语义一致）。
    const reactBtn = target.closest<HTMLElement>("[data-wb-chat-react]");
    if (reactBtn?.dataset.wbChatReact) {
      const key = reactBtn.dataset.wbChatReact as ConversationReactionKey;
      const msgId = reactBtn.dataset.wbChatReactMsg;
      if (msgId) {
        toggleReaction(msgId, key);
      }
      return;
    }
    const replyBtn = target.closest<HTMLElement>("[data-wb-chat-reply]");
    if (replyBtn?.dataset.wbChatReply) {
      beginReply(replyBtn.dataset.wbChatReply);
      return;
    }
    const replyJumpBtn = target.closest<HTMLElement>("[data-wb-chat-reply-jump]");
    if (replyJumpBtn?.dataset.wbChatReplyJump) {
      void jumpToMessage(replyJumpBtn.dataset.wbChatReplyJump);
      return;
    }
    const editBtn = target.closest<HTMLElement>("[data-wb-chat-edit]");
    if (editBtn?.dataset.wbChatEdit) {
      beginEdit(editBtn.dataset.wbChatEdit);
      return;
    }
    const editSaveBtn = target.closest<HTMLElement>("[data-wb-chat-edit-save]");
    if (editSaveBtn?.dataset.wbChatEditSave) {
      saveEdit(editSaveBtn.dataset.wbChatEditSave);
      return;
    }
    if (target.closest("[data-wb-chat-edit-cancel]")) {
      cancelEdit();
      return;
    }
    const deleteBtn = target.closest<HTMLElement>("[data-wb-chat-delete]");
    if (deleteBtn?.dataset.wbChatDelete) {
      requestDelete(deleteBtn.dataset.wbChatDelete);
      return;
    }
    const deleteConfirmBtn = target.closest<HTMLElement>("[data-wb-chat-delete-confirm]");
    if (deleteConfirmBtn?.dataset.wbChatDeleteConfirm) {
      confirmDelete(deleteConfirmBtn.dataset.wbChatDeleteConfirm);
      return;
    }
    if (target.closest("[data-wb-chat-delete-cancel]")) {
      cancelDelete();
      return;
    }
    const pinBtn = target.closest<HTMLElement>("[data-wb-chat-pin]");
    if (pinBtn?.dataset.wbChatPin) {
      togglePin(pinBtn.dataset.wbChatPin, pinBtn.dataset.wbChatPinState === "on");
      return;
    }
    // —— R14 批 FEEDBACK：Cuu 文字回复反馈（工具条 ✓/✗ 切换 + 持久 badge 点击展开/收起备注编辑器） —— //
    const feedbackBtn = target.closest<HTMLElement>("[data-wb-chat-feedback]");
    if (feedbackBtn?.dataset.wbChatFeedback) {
      const verdict = feedbackBtn.dataset.wbChatFeedback as AiFeedbackVerdict;
      const msgId = feedbackBtn.dataset.wbChatFeedbackMsg;
      if (msgId) {
        toggleMessageFeedback(msgId, verdict);
      }
      return;
    }
    const feedbackNoteToggleBtn = target.closest<HTMLElement>("[data-wb-chat-feedback-note-toggle]");
    if (feedbackNoteToggleBtn?.dataset.wbChatFeedbackNoteToggle) {
      toggleFeedbackNoteEditor(feedbackNoteToggleBtn.dataset.wbChatFeedbackNoteToggle);
      return;
    }
    const feedbackNoteSaveBtn = target.closest<HTMLElement>("[data-wb-chat-feedback-note-save]");
    if (feedbackNoteSaveBtn?.dataset.wbChatFeedbackNoteSave) {
      saveFeedbackNote(feedbackNoteSaveBtn.dataset.wbChatFeedbackNoteSave);
      return;
    }
    if (target.closest("[data-wb-chat-feedback-note-cancel]")) {
      cancelFeedbackNoteEditor();
      return;
    }
    // —— R14 批 FEEDBACK：行动卡条目反馈 tile（同款乐观切换，无备注） —— //
    const actionCardFeedbackBtn = target.closest<HTMLElement>("[data-wb-chat-actioncard-feedback]");
    if (actionCardFeedbackBtn?.dataset.wbChatActioncardFeedback) {
      const verdict = actionCardFeedbackBtn.dataset.wbChatActioncardFeedback as AiFeedbackVerdict;
      const itemId = actionCardFeedbackBtn.dataset.wbChatActioncardItem;
      if (itemId) {
        toggleActionCardItemFeedback(itemId, verdict);
      }
      return;
    }
    // R12 P0-A1：行动卡条目的操作按钮——decide 三键（交给我干/派给别人/先不动）、reassign 极简成员
    // 选择器的展开/选中提交、execute 的撤销。
    const decideBtn = target.closest<HTMLElement>("[data-wb-chat-actioncard-decide]");
    if (decideBtn) {
      const action = decideBtn.dataset.wbChatActioncardDecide as ActionCardItemDecisionAction | undefined;
      const itemId = decideBtn.dataset.wbChatActioncardItem;
      if (action && itemId) {
        submitActionCardDecision(itemId, action);
      }
      return;
    }
    const reassignToggleBtn = target.closest<HTMLElement>("[data-wb-chat-actioncard-reassign-toggle]");
    if (reassignToggleBtn) {
      const itemId = reassignToggleBtn.dataset.wbChatActioncardReassignToggle;
      if (itemId) {
        openReassignItemId = openReassignItemId === itemId ? undefined : itemId;
        // R13 H1（键盘可达性）：开/关这个极简选择器的同时重置方向键高亮——0（第一行）打开时，
        // undefined（没有可选项要高亮）关闭时。
        reassignHighlightIndex = openReassignItemId !== undefined ? 0 : undefined;
        renderScroll();
      }
      return;
    }
    const reassignToBtn = target.closest<HTMLElement>("[data-wb-chat-actioncard-reassign-to]");
    if (reassignToBtn) {
      const assigneeUserId = reassignToBtn.dataset.wbChatActioncardReassignTo;
      const itemId = reassignToBtn.dataset.wbChatActioncardItem;
      if (assigneeUserId && itemId) {
        submitActionCardDecision(itemId, "reassign", assigneeUserId);
      }
      return;
    }
    const undoBtn = target.closest<HTMLElement>("[data-wb-chat-actioncard-undo]");
    if (undoBtn?.dataset.wbChatActioncardUndo) {
      submitActionCardUndo(undoBtn.dataset.wbChatActioncardUndo);
    }
  });

  // R12 批8：滚到顶自动触发「加载更早」（00 §9 交互约定），和上面的手动按钮走同一个 handleReachedTop——
  // 按钮是为了可发现性/无障碍（不是每个人都知道滚动到顶有效），滚动是为了老用户的肌肉记忆（同类聊天
  // 应用的既有习惯）。
  scrollEl.addEventListener("scroll", () => {
    if (scrollEl!.scrollTop <= SCROLL_TOP_LOAD_EARLIER_PX) {
      handleReachedTop();
    }
    // R14 批 CHAT：滚到底=看到了最新消息，节流标记已读；同时刷新「跳到未读」浮钮的显隐。
    const nearBottom = scrollEl!.scrollHeight - scrollEl!.scrollTop - scrollEl!.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) {
      maybeMarkRead();
    }
    renderJump();
  });

  // R14 批 CHAT：行内编辑框——input 同步 editDraft（这样任何原因触发的 renderScroll 都能保住已输入的
  // 文字，同 composer 的 draftFallback 取舍）；Escape 取消、Cmd/Ctrl+Enter 保存（普通 Enter 是换行——
  // 编辑多半是改一段话，换行比发送更常用）。
  scrollEl.addEventListener("input", (event) => {
    if (event.target instanceof HTMLTextAreaElement && event.target.matches("[data-wb-chat-edit-input]")) {
      editDraft = event.target.value;
    }
    // R14 批 FEEDBACK：反馈备注输入框——同上，input 同步 draft 保住已输入的文字。
    if (event.target instanceof HTMLTextAreaElement && event.target.matches("[data-wb-chat-feedback-note-input]") && feedbackNoteEditor) {
      feedbackNoteEditor = { ...feedbackNoteEditor, draft: event.target.value };
    }
  });
  scrollEl.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLTextAreaElement && event.target.matches("[data-wb-chat-edit-input]")) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEdit();
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && editingMessageId) {
        event.preventDefault();
        saveEdit(editingMessageId);
      }
      return;
    }
    // R14 批 FEEDBACK：反馈备注是单行输入（rows=1）——普通 Enter 就保存（不像编辑框那样把 Enter 留给
    // 换行，一句话备注没有多行的必要），Escape 跳过/取消。
    if (event.target instanceof HTMLTextAreaElement && event.target.matches("[data-wb-chat-feedback-note-input]")) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelFeedbackNoteEditor();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && feedbackNoteEditor) {
        event.preventDefault();
        saveFeedbackNote(feedbackNoteEditor.messageId);
      }
    }
  });

  // R14 批 CHAT：置顶条——折叠切换 / 点击跳消息 / 取消置顶（挂在独立的 pinBarEl 上，不跟消息流一起重建）。
  pinBarEl.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    if (target.closest("[data-wb-chat-pinbar-toggle]")) {
      pinBarCollapsed = !pinBarCollapsed;
      renderPinBar();
      return;
    }
    const jumpBtn = target.closest<HTMLElement>("[data-wb-chat-pin-jump]");
    if (jumpBtn?.dataset.wbChatPinJump) {
      void jumpToMessage(jumpBtn.dataset.wbChatPinJump);
      return;
    }
    const removeBtn = target.closest<HTMLElement>("[data-wb-chat-pin-remove]");
    if (removeBtn?.dataset.wbChatPinRemove) {
      togglePin(removeBtn.dataset.wbChatPinRemove, true);
    }
  });

  // R14 批 CHAT：底部「跳到未读」浮钮——挂在独立的 jumpEl 上。
  jumpEl.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("[data-wb-chat-jump-unread]")) {
      jumpToUnread();
    }
  });

  // R14 批 CHAT：窗口重获焦点时标记已读（用户从别的窗口切回来=正在看这个会话）。
  function handleWindowFocus(): void {
    maybeMarkRead();
  }
  (doc.defaultView ?? window).addEventListener("focus", handleWindowFocus);

  // R12（模式五档）：点外关闭 + Escape 关闭 + 弹层开着时数字键 1-5 快切——都是弹层开着才生效
  // （modePopoverOpen 把关），不会抢主区/其它会话种类里任何一次点击或按键。这两个监听器挂在
  // ownerDocument 上而不是 composerWrapEl 上，因为"点外"本来就要能听到 composer 之外的点击。
  function handleDocumentModeClick(event: MouseEvent): void {
    if (!modePopoverOpen || !(event.target instanceof Node)) {
      return;
    }
    // R12 验收 D-01 修复：点击 chip 会让 composer 整块 innerHTML 重建，同一次点击冒泡到 document
    // 时 event.target 已经从 DOM 上拆下——新渲染的 chip 不 contains 旧节点，会被误判成「点在外面」，
    // 弹层开了又立刻关（真机表现=永远点不开；单测只断言 HTML 字符串抓不到这条时序）。target 已断开
    // 即说明这次点击落在 composer 内部并触发过重渲染，绝不是「点外」，直接放行。
    if (!event.target.isConnected) {
      return;
    }
    const chip = composerWrapEl!.querySelector("[data-wb-chat-mode-toggle]");
    const pop = composerWrapEl!.querySelector("[data-wb-chat-mode-pop]");
    if (chip?.contains(event.target) || pop?.contains(event.target)) {
      return; // 这条点击本身就是触发弹层开合的那次点击，composerWrapEl 自己的监听器已经处理过。
    }
    closeModePopover();
  }

  function handleDocumentModeKeydown(event: KeyboardEvent): void {
    if (!modePopoverOpen) {
      return;
    }
    if (event.key === "Escape") {
      closeModePopover();
      return;
    }
    // R12 自审修复：数字快捷键只在焦点不在可编辑区时生效——弹层开着时用户 Tab 回输入框继续打字，
    // "1"-"5" 是正常文本输入，不能被劫持成切档（Escape 不受此限：从输入框里关弹层是合理操作）。
    // R13 H1：方向键/Enter 的键盘导航同一条守卫——editable 目标里 ArrowUp/Down/Enter 都是正常的
    // 光标移动/换行，不该被弹层劫持。
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)
    ) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      modeHighlightIndex = movePickerHighlight(modeHighlightIndex, event.key === "ArrowDown" ? 1 : -1, MODE_LEVEL_COUNT);
      renderModePopover();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const highlighted = clampPickerHighlight(modeHighlightIndex, MODE_LEVEL_COUNT);
      if (highlighted !== undefined) {
        selectMode(highlighted + 1);
      }
      return;
    }
    if (event.key >= "1" && event.key <= "5") {
      event.preventDefault();
      selectMode(Number(event.key));
    }
  }

  // R13 H1（键盘可达性）：改派选择器的方向键/Enter/Escape——跟模式弹层同一套"挂在 document 上、
  // 靠自己的开关状态把关"取舍（openReassignItemId 是它的开关），焦点仍然停在触发它的那个「派给
  // 别人」按钮上（点击不会主动挪走焦点），不强求真的把 DOM 焦点搬进 scrollEl 里的某一行。
  function handleDocumentReassignKeydown(event: KeyboardEvent): void {
    const itemId = openReassignItemId;
    if (itemId === undefined) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      openReassignItemId = undefined;
      reassignHighlightIndex = undefined;
      renderScroll();
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)
    ) {
      return;
    }
    const candidateIds = reassignPickerMemberIds(membersMap, input.currentUserId);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      reassignHighlightIndex = movePickerHighlight(reassignHighlightIndex, event.key === "ArrowDown" ? 1 : -1, candidateIds.length);
      renderScroll();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const highlighted = clampPickerHighlight(reassignHighlightIndex, candidateIds.length);
      const userId = highlighted !== undefined ? candidateIds[highlighted] : undefined;
      if (userId) {
        submitActionCardDecision(itemId, "reassign", userId);
      }
    }
  }

  doc.addEventListener("click", handleDocumentModeClick);
  doc.addEventListener("keydown", handleDocumentModeKeydown);
  doc.addEventListener("keydown", handleDocumentReassignKeydown);

  // R13 批 P2：追赶提醒条本身是一个独立的小挂载点（不跟消息流一起被 renderScroll 整块重建），
  // 单独绑一个点击监听器，同 sideToggleBtn 在 shell.ts 里的既有取舍一致。
  catchupEl.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    if (event.target.closest("[data-wb-chat-catchup-open]")) {
      handleCatchupClick();
    }
  });

  renderCatchup();
  renderPinBar();
  void loadHistory();
  void loadMyAiProfile();
  void loadDispatchAskCatchup();
  void loadAiProviderHealth();
  // R14 批 CHAT：挂载时拉一次 presence + 30s 轮询（成员条在线点）。SSE 重连时另有即时刷新（见 onReconnected）。
  void loadPresence();
  presencePollTimer = setInterval(() => {
    if (!disposed) {
      void loadPresence();
    }
  }, PRESENCE_POLL_INTERVAL_MS);

  return {
    dispose() {
      disposed = true;
      streamHandle?.close();
      // R14 批 PERF（切片①）：取消尚未 flush 的那一帧，别在视图卸载后往已 detach 的滚动容器写 innerHTML。
      renderScrollScheduler.cancel();
      clearInterval(typingPruneTimer);
      doc.removeEventListener("click", handleDocumentModeClick);
      doc.removeEventListener("keydown", handleDocumentModeKeydown);
      doc.removeEventListener("keydown", handleDocumentReassignKeydown);
      (doc.defaultView ?? window).removeEventListener("focus", handleWindowFocus);
      if (fileSearchTimer !== undefined) {
        clearTimeout(fileSearchTimer);
      }
      if (actionCardRunProgressRefetchTimer !== undefined) {
        clearTimeout(actionCardRunProgressRefetchTimer);
      }
      if (readPingTimer !== undefined) {
        clearTimeout(readPingTimer);
      }
      if (presencePollTimer !== undefined) {
        clearInterval(presencePollTimer);
      }
    },
    focusComposer() {
      textareaEl()?.focus();
    },
    markProposalSettled(proposalId: string) {
      if (disposed || settledProposalIds.has(proposalId)) {
        return;
      }
      settledProposalIds.add(proposalId);
      renderScroll();
    }
  };
}

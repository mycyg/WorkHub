// WorkHub 桌面 · 主区群聊的纯 HTML 渲染函数（照 shell.ts/rail.ts 的 render*/mount* 分工：这里全部是
// 无副作用的字符串拼装，可单测；imperative 的 DOM 挂载/事件绑定在 view.ts）。

import type { AiMode, ConversationMessageVM, WorkbenchPageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { workbenchIcons } from "../icons.js";
import {
  ACTION_CARD_RUN_PROGRESS_STAGES,
  type ActionCardRunProgress,
  type ActionCardRunProgressStage,
  type ActionCardRunProgressTerminal
} from "./run-progress.js";
import { computeUndoRemainingMinutes, formatMessageTime } from "./timeline.js";

type Locale = "zh-CN" | "en-US";
export type WorkbenchMemberVM = WorkbenchPageVM["workspace_members"]["items"][number];
export type ChatRenderMembers = ReadonlyMap<string, { nickname: string }>;
export type ConnectionBannerState = "connecting" | "open" | "reconnect_scheduled" | "closed" | "idle";

export function membersById(members: readonly WorkbenchMemberVM[]): ChatRenderMembers {
  return new Map(members.map((member) => [member.user_id, { nickname: member.nickname }]));
}

function hueForId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function avatarTileHtml(input: { label: string; id: string; variant?: "cuu" | undefined }): string {
  if (input.variant === "cuu") {
    return `<span class="wh-wb-chat-avatar wh-wb-chat-avatar--cuu">${workbenchIcons.cat}</span>`;
  }
  const trimmed = input.label.trim();
  const initial = trimmed ? trimmed[0]!.toUpperCase() : "?";
  const hue = hueForId(input.id);
  return `<span class="wh-wb-chat-avatar" style="background:hsl(${hue},55%,42%)">${escapeHtml(initial)}</span>`;
}

// —— 成员条 —— //

export function renderMemberBarHtml(input: { members: readonly WorkbenchMemberVM[]; locale: Locale }): string {
  const zh = input.locale === "zh-CN";
  const avatars = input.members
    .slice(0, 6)
    .map((member) => avatarTileHtml({ label: member.nickname, id: member.user_id }))
    .join("");
  const cuuAvatar = avatarTileHtml({ label: "Cuu", id: "cuu", variant: "cuu" });
  const count = input.members.length;
  const label = zh ? `${count} 位成员 + Cuu · 全员群聊` : `${count} member${count === 1 ? "" : "s"} + Cuu · everyone`;
  return `<div class="wh-wb-chat-head"><div class="wh-wb-chat-avs">${avatars}${cuuAvatar}</div><span class="wh-wb-chat-head-label">${escapeHtml(label)}</span></div>`;
}

// —— 日期分隔 —— //

export function renderDaySeparatorHtml(label: string): string {
  return `<div class="wh-wb-chat-daysep">${escapeHtml(label)}</div>`;
}

// —— 消息气泡 —— //

export type ChatRenderContext = {
  locale: Locale;
  members: ChatRenderMembers;
  currentUserId: string | undefined;
  // R12 批8：长文本折叠——展开态是瞬态 UI 状态，由 view.ts 维护一个 message id 集合，不落库。
  // 可选：既有调用点（现有测试）不用管这个字段，折叠只在文本超过阈值时才生效。
  expandedMessageIds?: ReadonlySet<string>;
  // R12 P0-A1：行动卡条目的操作按钮——都可选，既有调用点（现有测试）不用管：
  //  - now：算撤销窗口剩余分钟数的基准时刻，纯函数、渲染时刻为准（见 timeline.ts 的
  //    computeUndoRemainingMinutes），缺省用真实"现在"；
  //  - openReassignItemId：当前展开了"派给别人"极简成员选择器的条目 id（一次只开一个，
  //    瞬态 UI 状态，由 view.ts 持有，不落库）；
  //  - actionCardItemErrors：decide/undo 失败后的温和行内提示，按条目 id 索引（见
  //    action-card-decision.ts 的 mapActionCardDecisionError），瞬态、不落库，下一次对同一条目的
  //    操作发起时 view.ts 会先清掉旧提示。
  //  - reassignHighlightIndex（R13 H1 键盘可达性）：改派选择器当前方向键高亮到第几行（下标对齐
  //    reassignPickerMemberIds 的返回顺序），瞬态、不落库，只在 openReassignItemId 有值时才有意义。
  now?: Date;
  openReassignItemId?: string;
  actionCardItemErrors?: ReadonlyMap<string, string>;
  reassignHighlightIndex?: number;
  // R13 批 S2（Cuu 异步化与进度可视）：execute 条目(status=running)的阶段流进度——按条目 id 索引，
  // 由 view.ts 从该会话军团面板节流拉取后喂进来（见 chat/run-progress.ts 的
  // inferActionCardRunProgress）。这个 map 里没有对应条目 id 的 key（还没关联到 run / 面板还没拉回来 /
  // 拉取失败），就退回既有的纯文字「进行中」标签，不强渲染进度行——04 §4 铁律 3 的延伸。
  actionCardRunProgress?: ReadonlyMap<string, ActionCardRunProgress>;
};

function senderLabel(message: ConversationMessageVM, ctx: ChatRenderContext): string {
  if (message.sender_type === "cuu") {
    return "Cuu";
  }
  if (message.sender_type === "system") {
    return ctx.locale === "zh-CN" ? "系统" : "System";
  }
  const member = message.sender_user_id ? ctx.members.get(message.sender_user_id) : undefined;
  return member?.nickname ?? (ctx.locale === "zh-CN" ? "未知成员" : "Unknown member");
}

// @成员昵称 高亮——纯展示层面的便利（不是结构化引用，wisp 安全红线只管"chip 只存 id 不存内容"这条
// 真正的引用通道；这里只是把已经发出去的纯文本里，恰好等于真实成员昵称的 @xxx 子串标个颜色）。
function highlightMentions(escapedText: string, members: ChatRenderMembers): string {
  let result = escapedText;
  for (const { nickname } of members.values()) {
    const escapedName = escapeHtml(nickname);
    if (!escapedName.trim()) {
      continue;
    }
    const pattern = new RegExp(`@${escapeRegExp(escapedName)}(?=\\s|$)`, "gu");
    result = result.replace(pattern, (match) => `<span class="wh-wb-chat-mention">${match}</span>`);
  }
  return result;
}

function bestEffortNoteText(content: Record<string, unknown>, fallback: string): string {
  const summary = content["summary"];
  if (typeof summary === "string" && summary.trim()) {
    return summary;
  }
  const text = content["text"];
  if (typeof text === "string" && text.trim()) {
    return text;
  }
  return fallback;
}

// 行动卡条目状态 → 展示文案（契约枚举见 packages/contracts/src/events.ts 的
// actionCardUpdatedItemSummarySchema）。契约将来新增状态时返回 undefined——不瞎编文案，条目照常
// 渲标题、只是不带状态标。
function actionCardItemStatusLabel(status: string, zh: boolean): string | undefined {
  switch (status) {
    case "running":
      return zh ? "进行中" : "In progress";
    case "done":
      return zh ? "已完成" : "Done";
    case "undone":
      return zh ? "已撤销" : "Undone";
    case "waiting_decision":
      return zh ? "待拍板" : "Awaiting decision";
    case "dismissed":
      return zh ? "先不动" : "Set aside";
    case "escalated":
      return zh ? "已升级" : "Escalated";
    default:
      return undefined;
  }
}

// R13 批 S2（Cuu 异步化与进度可视）：execute 条目从静态「进行中」升级出来的阶段流进度行——四段
// 认领→干活→产出→提议（run-progress.ts 的 inferActionCardRunProgress 负责推断走到哪一段，这里只管
// 把它拼成 HTML）。当前段加粗上色（--ds-accent，跟终态的成功/失败/升级三色区分开，避免读者把"正在
// 进行"误认成某种终态）；已经走过的段降到 .55 透明度，还没到的段降到 .3——一眼能看出方向感，不需要
// 图例。
const ACTION_CARD_RUN_PROGRESS_STAGE_LABEL: Record<ActionCardRunProgressStage, { zh: string; en: string }> = {
  claim: { zh: "认领", en: "Claimed" },
  work: { zh: "干活", en: "Working" },
  produce: { zh: "产出", en: "Wrapping up" },
  propose: { zh: "提议", en: "Proposing" }
};

function renderActionCardRunProgressStageHtml(stage: ActionCardRunProgressStage, zh: boolean): string {
  const currentIndex = ACTION_CARD_RUN_PROGRESS_STAGES.indexOf(stage);
  const segments = ACTION_CARD_RUN_PROGRESS_STAGES.map((candidate, index) => {
    const label = escapeHtml(ACTION_CARD_RUN_PROGRESS_STAGE_LABEL[candidate][zh ? "zh" : "en"]);
    if (index === currentIndex) {
      return `<b style="color:var(--ds-accent)">${label}</b>`;
    }
    return `<span style="opacity:${index < currentIndex ? ".55" : ".3"}">${label}</span>`;
  });
  return `<span class="wh-wb-chat-actioncard-item-status" style="display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap">${segments.join('<span style="opacity:.3">→</span>')}</span>`;
}

// 三终态各有明确视觉（00 §「异步心智模型」的要求）：完成=成功绿（跟批 4b 产出卡的 --ds-success 同一个
// 颜色语汇——这个条目的 run 已经成功，提议正在等审，跟 renderDeliverableCardHtml 是同一件事的两个
// 视角）；失败=危险红；升级=警示黄，措辞照「Cuu = 项目经理」的汇报口吻，不使用技术术语。
function renderActionCardRunProgressTerminalHtml(terminal: ActionCardRunProgressTerminal, zh: boolean): string {
  const text =
    terminal === "done"
      ? zh
        ? "已完成 · 提议在等审"
        : "Done · proposal awaiting review"
      : terminal === "failed"
        ? zh
          ? "没干成"
          : "Didn't land"
        : zh
          ? "已升级 · 等你拍板"
          : "Escalated · awaiting your call";
  const color = terminal === "done" ? "var(--ds-success)" : terminal === "failed" ? "var(--ds-danger)" : "var(--ds-warn)";
  return `<span class="wh-wb-chat-actioncard-item-status" style="color:${color};font-weight:700">${escapeHtml(text)}</span>`;
}

// execute+running 条目优先尝试用军团面板喂进来的实时进度渲染阶段流/终态；查不到（还没关联 run、面板
// 还没拉回来、拉取失败）或者不是这种条目，退回既有的纯文字状态标（actionCardItemStatusLabel），
// 不强渲染一行编造的进度。
function renderActionCardItemStatusHtml(row: ActionCardItemRow, ctx: ChatRenderContext, zh: boolean): string {
  if (row.kind === "execute" && row.status === "running") {
    const progress = ctx.actionCardRunProgress?.get(row.id);
    if (progress?.kind === "stage") {
      return renderActionCardRunProgressStageHtml(progress.stage, zh);
    }
    if (progress?.kind === "terminal") {
      return renderActionCardRunProgressTerminalHtml(progress.terminal, zh);
    }
  }
  const label = actionCardItemStatusLabel(row.status, zh);
  return label ? `<span class="wh-wb-chat-actioncard-item-status">${escapeHtml(label)}</span>` : "";
}

type ActionCardItemRow = {
  id: string;
  title: string;
  kind: string;
  status: string;
  assigneeUserId: string | null;
  undoDeadlineAt: string | null;
};

// R12 P0-A1：「派给别人」的极简成员选择——列出除当前用户以外的活跃工作区成员（当前用户已经是这条
// 决策的 assignee，选它自己没有意义，「交给我干」已经覆盖那条路径），选中即提交，不需要二次确认。
// 复用 mention picker 同款 .wh-wb-chat-picker-row 行样式（本批范围围栏不许改 css.ts，这个类已经是
// 通用的"可点成员行"外观，不必新造一个）。
const REASSIGN_PICKER_MEMBER_CAP = 20;

// R13 H1（键盘可达性）：view.ts 需要跟渲染这里完全同一份「除自己以外、封顶 20 个」的成员 id 顺序，
// 才能把方向键算出来的高亮下标换算成 Enter 要提交的用户 id——单独导出这份顺序，不在 view.ts 里
// 重新拼一遍同样的 filter/cap（两处一旦各写一份很容易悄悄漂移）。
export function reassignPickerMemberIds(members: ChatRenderMembers, currentUserId: string | undefined): string[] {
  return [...members.keys()].filter((userId) => userId !== currentUserId).slice(0, REASSIGN_PICKER_MEMBER_CAP);
}

function renderReassignPickerHtml(
  itemId: string,
  members: ChatRenderMembers,
  currentUserId: string | undefined,
  zh: boolean,
  highlightedIndex?: number
): string {
  const rows = reassignPickerMemberIds(members, currentUserId)
    .map((userId, index) => {
      const member = members.get(userId);
      if (!member) {
        return "";
      }
      const isHighlighted = index === highlightedIndex;
      // roving tabindex：这一行不再靠原生 Tab 单独停留（tabindex="-1"），方向键由 view.ts 的
      // handleDocumentReassignKeydown 管理高亮下标，Enter 提交当前高亮的那一行。
      const highlightAttr = isHighlighted ? ' style="outline:2px solid rgba(10,132,255,.55);outline-offset:-2px"' : "";
      return `<button type="button" class="wh-wb-chat-picker-row" tabindex="-1" role="option" aria-selected="${isHighlighted}"${highlightAttr} data-wb-chat-actioncard-reassign-to="${escapeHtml(userId)}" data-wb-chat-actioncard-item="${escapeHtml(itemId)}">${avatarTileHtml({ label: member.nickname, id: userId })}<span>${escapeHtml(member.nickname)}</span></button>`;
    })
    .join("");
  if (!rows) {
    return `<div class="wh-wb-chat-actioncard-reassign" style="margin-top:6px"><div class="wh-wb-chat-picker-empty">${zh ? "没有其他成员可选" : "No other members to pick"}</div></div>`;
  }
  return `<div class="wh-wb-chat-actioncard-reassign" style="margin-top:6px" role="listbox">${rows}</div>`;
}

// R12 P0-A1：一个 decide 条目的操作区——只有「这条卡当前指给我」时才摆得出可点的按钮（服务端
// assertCanActOnItem 的授权红线：仅当前 assignee 或管理员；前端这里更窄，不做管理员旁路，管理员目前
// 也只能走「等 @xxx 拍板」的纯文字态——04 §4 铁律 3 的延伸：没有把握判断的权限分支，先不摆按钮）。
// 非本人：温和的纯文字「等 @谁 拍板」，找不到昵称就写「负责人」，不编造更具体的话术。
function renderDecideItemActionsHtml(row: ActionCardItemRow, ctx: ChatRenderContext, zh: boolean): string {
  if (row.assigneeUserId && row.assigneeUserId === ctx.currentUserId) {
    const reassignOpen = ctx.openReassignItemId === row.id;
    const actions = `<div class="wh-wb-chat-actioncard-actions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">` +
      `<button type="button" class="wh-wb-act" data-wb-chat-actioncard-decide="claim" data-wb-chat-actioncard-item="${escapeHtml(row.id)}">${zh ? "交给我干" : "I'll do it"}</button>` +
      `<button type="button" class="wh-wb-act" data-wb-chat-actioncard-reassign-toggle="${escapeHtml(row.id)}">${zh ? "派给别人" : "Assign to someone else"}</button>` +
      `<button type="button" class="wh-wb-act" data-wb-chat-actioncard-decide="defer" data-wb-chat-actioncard-item="${escapeHtml(row.id)}">${zh ? "先不动" : "Leave it for now"}</button>` +
      `</div>`;
    const picker = reassignOpen
      ? renderReassignPickerHtml(row.id, ctx.members, ctx.currentUserId, zh, ctx.reassignHighlightIndex)
      : "";
    return `${actions}${picker}`;
  }
  const nickname = row.assigneeUserId ? ctx.members.get(row.assigneeUserId)?.nickname : undefined;
  const label = nickname ?? (zh ? "负责人" : "the assignee");
  const waitingText = zh ? `等 @${label} 拍板` : `Waiting on @${label} to decide`;
  return `<div class="wh-wb-chat-actioncard-note">${escapeHtml(waitingText)}</div>`;
}

// R12 P0-A1：一个 execute 条目的撤销区——只有「这条卡当前指给我」+「还在撤销窗口内」才摆得出按钮；
// 过期不渲染（不是渲染一个会点出 409 的死按钮——04 §4 铁律 3），真晚一步点到的边界情况（渲染那一刻
// 还没过期、提交时刚好过期）交给服务端 409 兜底，view.ts 温和提示。
function renderExecuteItemActionsHtml(row: ActionCardItemRow, ctx: ChatRenderContext, zh: boolean): string {
  if (!row.assigneeUserId || row.assigneeUserId !== ctx.currentUserId || !row.undoDeadlineAt) {
    return "";
  }
  const now = ctx.now ?? new Date();
  const remaining = computeUndoRemainingMinutes(row.undoDeadlineAt, now.getTime());
  if (remaining === undefined) {
    return "";
  }
  const label = zh ? `撤销（${remaining} 分钟内）` : `Undo (within ${remaining} min)`;
  return `<div class="wh-wb-chat-actioncard-actions" style="margin-top:6px"><button type="button" class="wh-wb-act wh-wb-act--danger" data-wb-chat-actioncard-undo="${escapeHtml(row.id)}">${escapeHtml(label)}</button></div>`;
}

// decide/undo 失败后的温和行内提示（见 action-card-decision.ts 的 mapActionCardDecisionError）——
// 不用红色报错样式，跟 turn.ts 的 renderCuuTurnErrorHtml 同一个"不弹阻断"的取舍，直接复用
// .wh-wb-chat-actioncard-note 的既有中性文字样式。
function actionCardItemErrorHtml(row: ActionCardItemRow, ctx: ChatRenderContext): string {
  const text = ctx.actionCardItemErrors?.get(row.id);
  return text ? `<div class="wh-wb-chat-actioncard-note">${escapeHtml(text)}</div>` : "";
}

function actionCardItemActionsHtml(row: ActionCardItemRow, ctx: ChatRenderContext): string {
  const zh = ctx.locale === "zh-CN";
  if (row.kind === "decide" && row.status === "waiting_decision") {
    return `${renderDecideItemActionsHtml(row, ctx, zh)}${actionCardItemErrorHtml(row, ctx)}`;
  }
  if (row.kind === "execute" && row.status === "running") {
    return `${renderExecuteItemActionsHtml(row, ctx, zh)}${actionCardItemErrorHtml(row, ctx)}`;
  }
  return "";
}

// 00 §9：行动卡撤销后「卡片该项置灰划线 +『已撤销』，不删卡（留痕）」——undone 条目加
// --undone 修饰类（css.ts：标题划线、整行置灰），其它状态只带一枚状态标。快照是建卡时点数据，
// 实时状态由 view.ts 消费 conversation.action_card.updated 事件后就地合并进来（timeline.ts 的
// applyActionCardUpdate），decide/undo 的 HTTP 响应也走同一条合并函数（见其顶部注释）。
//
// R12 P0-A1：条目摘要现在带 assignee_user_id/undo_deadline_at（packages/db 的
// buildActionCardMessageContent 已经把这两个只增字段塞进消息 content），这里按 kind/status/身份
// 渲染真实可点的操作区——不再是「操作按钮由后续批次接入」的占位文案。
function renderActionCardSummaryHtml(content: Record<string, unknown>, ctx: ChatRenderContext): string {
  const zh = ctx.locale === "zh-CN";
  const rawItems = Array.isArray(content["items"]) ? (content["items"] as unknown[]) : [];
  const rows = rawItems
    .slice(0, 8)
    .map((item): ActionCardItemRow | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const titleMd = record["title_md"];
      const id = record["id"];
      if (typeof titleMd !== "string" || !titleMd || typeof id !== "string" || !id) {
        return undefined;
      }
      const status = typeof record["status"] === "string" ? (record["status"] as string) : "";
      const kind = typeof record["kind"] === "string" ? (record["kind"] as string) : "";
      const assigneeUserId = typeof record["assignee_user_id"] === "string" ? (record["assignee_user_id"] as string) : null;
      const undoDeadlineAt = typeof record["undo_deadline_at"] === "string" ? (record["undo_deadline_at"] as string) : null;
      return { id, title: titleMd, kind, status, assigneeUserId, undoDeadlineAt };
    })
    .filter((row): row is ActionCardItemRow => Boolean(row));
  const header = zh
    ? `Cuu 从讨论里拎出 ${rawItems.length} 件事`
    : `Cuu pulled ${rawItems.length} item${rawItems.length === 1 ? "" : "s"} out of the discussion`;
  const list = rows
    .map((row) => {
      const undone = row.status === "undone";
      const liClass = undone ? "wh-wb-chat-actioncard-item wh-wb-chat-actioncard-item--undone" : "wh-wb-chat-actioncard-item";
      const statusHtml = renderActionCardItemStatusHtml(row, ctx, zh);
      const actionsHtml = undone ? "" : actionCardItemActionsHtml(row, ctx);
      return `<li class="${liClass}"><span class="wh-wb-chat-actioncard-item-title">${escapeHtml(row.title)}</span>${statusHtml}${actionsHtml}</li>`;
    })
    .join("");
  return `<div class="wh-wb-chat-actioncard"><div class="wh-wb-chat-actioncard-h">${escapeHtml(header)}</div>${
    list ? `<ul class="wh-wb-chat-actioncard-list">${list}</ul>` : ""
  }</div>`;
}

// R12 批 4b：产出卡回灌——一个带来源会话的 run 开出提议/自动合并时，服务端往会话里落一条
// system_event，content 形如 {event:'proposal_opened'|'proposal_auto_merged', proposal_id, run_id,
// title, adds, dels}（见 apps/api/src/workers/agent-runner.ts 的 postDeliverableSystemMessage）。
// 这里识别出这类事件，渲成 prototype 的 editcard 样式（标题+加减行数），auto_merged 变体多一行
// 「已自动采纳 · 全托管」。其它 system_event（如批 6 的 drive_version_restored）仍走下面
// renderSystemEventLineHtml 的普通折叠行，不受影响。
type DeliverableSystemEvent = "proposal_opened" | "proposal_auto_merged";

function deliverableSystemEventKind(content: Record<string, unknown>): DeliverableSystemEvent | undefined {
  const event = content["event"];
  return event === "proposal_opened" || event === "proposal_auto_merged" ? event : undefined;
}

function renderDeliverableCardHtml(
  message: Extract<ConversationMessageVM, { kind: "system_event" }>,
  event: DeliverableSystemEvent,
  ctx: ChatRenderContext
): string {
  const zh = ctx.locale === "zh-CN";
  const content = message.content;
  const rawTitle = content["title"];
  const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle : (zh ? "一份变更申请" : "a change request");
  const adds = typeof content["adds"] === "number" ? content["adds"] : undefined;
  const dels = typeof content["dels"] === "number" ? content["dels"] : undefined;
  const header = zh ? `已起草 ${title}` : `Drafted ${title}`;
  const diffLine = adds !== undefined && dels !== undefined
    ? `<div class="wh-wb-chat-actioncard-note"><span style="color:var(--ds-success);font-weight:700">+${adds}</span> <span style="color:var(--ds-danger);font-weight:700">-${dels}</span></div>`
    : "";
  // 不新做撤销按钮（撤销走既有提议/回滚通道，见批 4b 设计），也不摆一个没接线的「看提议」按钮——
  // 跨窗口打开提议详情页需要工作台外壳（shell.ts）配合，这批范围只到产出卡渲染，先给诚实的纯文字状态，
  // 照批 2 行动卡「完整交互由后续批次接入」的同款取舍，不假装这里已经可点。
  const statusLine = event === "proposal_auto_merged"
    ? `<div class="wh-wb-chat-actioncard-note" style="color:var(--ds-warn);font-weight:700">${zh ? "已自动采纳 · 全托管" : "Auto-adopted · Full autonomy"}</div>`
    : `<div class="wh-wb-chat-actioncard-note">${zh
        ? "已生成变更申请，等待人工确认后采纳。提议详情页由后续批次接入这个窗口。"
        : "Change request opened — waiting for review before it's adopted. The proposal detail view lands in a later batch."
      }</div>`;
  const timestamp = `<div class="wh-wb-chat-actioncard-note">${formatMessageTime(message.created_at, ctx.locale)}</div>`;
  return `<div class="wh-wb-chat-actioncard wh-wb-chat-actioncard--deliverable"><div class="wh-wb-chat-actioncard-h">${escapeHtml(header)}</div>${diffLine}${statusLine}${timestamp}</div>`;
}

// R13 批 S2（Cuu 异步化与进度可视，run 终态 PM 汇报）：一个带 source_conversation_id 的 run 到达
// failed/escalated 终态时，服务端（apps/api/src/services/run-conversation-report.ts，挂进
// agent-runner.ts 的 runSettled 组合链）往会话里 post 一条 system_event，content 形如
// {event:'run_settled_report', run_id, work_item_id, outcome:'failed'|'escalated', title, reason}。
// succeeded 终态不会出现这个事件——批 4b 的 proposal_opened/proposal_auto_merged 已经在 run 结算之前
// 播报过「提议在等审/已自动采纳」，服务端故意不重复发（见该模块顶部的终态矩阵注释），这里也就没有
// "done" 这个变体要渲染。
type RunSettledReportOutcome = "failed" | "escalated";

function runSettledReportOutcome(content: Record<string, unknown>): RunSettledReportOutcome | undefined {
  const outcome = content["outcome"];
  if (content["event"] !== "run_settled_report") {
    return undefined;
  }
  return outcome === "failed" || outcome === "escalated" ? outcome : undefined;
}

function renderRunSettledReportHtml(
  message: Extract<ConversationMessageVM, { kind: "system_event" }>,
  outcome: RunSettledReportOutcome,
  ctx: ChatRenderContext
): string {
  const zh = ctx.locale === "zh-CN";
  const content = message.content;
  const rawTitle = content["title"];
  const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle : zh ? "这件事" : "this task";
  const rawReason = content["reason"];
  const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim() : undefined;
  const header = zh ? `${title} · 这次没干成` : `${title} · didn't land this time`;
  const escalatedHeader = zh ? `${title} · 需要你拍板` : `${title} · needs your call`;
  const bodyText =
    outcome === "failed"
      ? zh
        ? reason
          ? `原因：${reason}。我先记下了，你有空再看。`
          : "具体原因还在整理，我先记下了，你有空再看。"
        : reason
          ? `Reason: ${reason}. I've made a note of it — take a look when you can.`
          : "Still sorting out why — I've made a note of it for you to look at when you can."
      : zh
        ? "我拿不准该怎么走，已经放进你的待拍板里了。"
        : "I'm not sure how to proceed — I've put it in your queue for a decision.";
  const color = outcome === "failed" ? "var(--ds-danger)" : "var(--ds-warn)";
  const timestamp = `<div class="wh-wb-chat-actioncard-note">${formatMessageTime(message.created_at, ctx.locale)}</div>`;
  return `<div class="wh-wb-chat-actioncard wh-wb-chat-actioncard--deliverable"><div class="wh-wb-chat-actioncard-h" style="color:${color}">${escapeHtml(
    outcome === "failed" ? header : escalatedHeader
  )}</div><div class="wh-wb-chat-actioncard-note">${escapeHtml(bodyText)}</div>${timestamp}</div>`;
}

// R12 批8：长消息折叠——超过阈值的文本消息默认只渲染预览片段 + 「展开全文」，避免超长粘贴/观察者
// 摘要把单条气泡撑成整屏。展开态由 view.ts 的 expandedMessageIds 驱动（纯函数，这里不持有状态）。
const LONG_TEXT_FOLD_THRESHOLD_CHARS = 800;
const LONG_TEXT_PREVIEW_CHARS = 400;

function textMessageFoldedBodyHtml(
  message: Extract<ConversationMessageVM, { kind: "text" }>,
  ctx: ChatRenderContext
): string {
  const text = message.content.text;
  const zh = ctx.locale === "zh-CN";
  const isLong = text.length > LONG_TEXT_FOLD_THRESHOLD_CHARS;
  if (!isLong) {
    return `<div class="wh-wb-chat-txt">${highlightMentions(escapeHtml(text), ctx.members).replace(/\n/gu, "<br>")}</div>`;
  }
  const expanded = ctx.expandedMessageIds?.has(message.id) ?? false;
  if (expanded) {
    return `<div class="wh-wb-chat-txt">${highlightMentions(escapeHtml(text), ctx.members).replace(/\n/gu, "<br>")}</div><button type="button" class="wh-wb-chat-text-toggle" data-wb-chat-collapse-message="${escapeHtml(message.id)}">${zh ? "收起" : "Show less"}</button>`;
  }
  const preview = text.slice(0, LONG_TEXT_PREVIEW_CHARS);
  return `<div class="wh-wb-chat-txt wh-wb-chat-txt--folded">${highlightMentions(escapeHtml(preview), ctx.members).replace(/\n/gu, "<br>")}<span class="wh-wb-chat-txt-fade"></span></div><button type="button" class="wh-wb-chat-text-toggle" data-wb-chat-expand-message="${escapeHtml(message.id)}">${zh ? "展开全文" : "Show full message"}</button>`;
}

// R13 批4c（Cuu 对话工具面 · 澄清反问）：is_clarifying_question 是 conversationTextContentSchema 上
// 的 additive 标记（没有新增 DB kind，复用既有 kind='text'，见 packages/contracts 的
// domain/conversation.ts 顶部注释）——渲染层只需要认出这个标记，给它一个不同于普通文字气泡的视觉
// （左侧强调条 + 「Cuu 在问」标签），并把 clarify_options 摆成可点的选项按钮，点了直接把选项文本填进
// 输入框（view.ts 的 data-wb-chat-clarify-option 处理），不是摆一个中看不中用的静态列表。没有定义
// 新 CSS 类（css.ts 不在本批范围围栏内），视觉全部走行内样式，复用 design-system 的 CSS 自定义属性。
function textMessageBodyHtml(
  message: Extract<ConversationMessageVM, { kind: "text" }>,
  ctx: ChatRenderContext
): string {
  const foldedHtml = textMessageFoldedBodyHtml(message, ctx);
  if (message.content.is_clarifying_question !== true) {
    return foldedHtml;
  }
  const zh = ctx.locale === "zh-CN";
  const options = message.content.clarify_options ?? [];
  const optionsHtml =
    options.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${options
          .map(
            (option) =>
              `<button type="button" data-wb-chat-clarify-option="${escapeHtml(option)}" style="padding:4px 10px;border-radius:999px;border:1px solid var(--ds-border, rgba(0,0,0,.16));background:transparent;color:inherit;font:inherit;cursor:pointer">${escapeHtml(option)}</button>`
          )
          .join("")}</div>`
      : "";
  const badge = `<div style="font-size:12px;font-weight:700;color:var(--ds-accent, #5b8def);margin-bottom:4px">${zh ? "Cuu 在问" : "Cuu is asking"}</div>`;
  return `<div style="border-left:2px solid var(--ds-accent, #5b8def);padding-left:10px">${badge}${foldedHtml}${optionsHtml}</div>`;
}

function messageBodyHtml(message: ConversationMessageVM, ctx: ChatRenderContext): string {
  switch (message.kind) {
    case "text":
      return textMessageBodyHtml(message, ctx);
    case "file_card":
      // R12 批 6：file_card 点击 → 右栏预览（和网盘标签共用同一个情境面板组件，见
      // workbench/drive/side-panel.ts）。只有已落库的确认消息才可点——发送中的乐观渲染
      // （renderPendingOutgoingHtml）还没有服务端确认的 drive_item_id 归属，继续保持非交互。
      return `<button type="button" class="wh-wb-chat-filecard wh-wb-chat-filecard--live" data-wb-chat-open-file="${escapeHtml(message.content.drive_item_id)}" data-wb-chat-open-file-name="${escapeHtml(message.content.snapshot_name)}">${workbenchIcons.folder}<span class="wh-wb-chat-filecard-name">${escapeHtml(message.content.snapshot_name)}</span></button>`;
    case "action_card":
      return renderActionCardSummaryHtml(message.content, ctx);
    case "tool_note":
      return `<div class="wh-wb-chat-note">${escapeHtml(bestEffortNoteText(message.content, ctx.locale === "zh-CN" ? "（一次工具调用）" : "(a tool call)"))}</div>`;
    case "system_event":
      // system_event 走 renderSystemEventLineHtml 的独立折叠行布局，renderMessageHtml 在调用
      // messageBodyHtml 之前已经把它分流出去了，这个分支运行时不可达——留着只是为了穷举 switch。
      return "";
    default:
      // 契约新增 kind 时的安全网：不崩，渲染空内容而不是让整条消息流炸掉。
      return "";
  }
}

function renderSystemEventLineHtml(
  message: Extract<ConversationMessageVM, { kind: "system_event" }>,
  ctx: ChatRenderContext
): string {
  const fallback = ctx.locale === "zh-CN" ? "系统事件" : "System update";
  const text = bestEffortNoteText(message.content, fallback);
  return `<div class="wh-wb-chat-sysline"><span>${escapeHtml(text)}</span><span class="wh-wb-chat-sysline-tm">${formatMessageTime(message.created_at, ctx.locale)}</span></div>`;
}

export function renderMessageHtml(message: ConversationMessageVM, ctx: ChatRenderContext): string {
  if (message.kind === "system_event") {
    const deliverableEvent = deliverableSystemEventKind(message.content);
    if (deliverableEvent) {
      return renderDeliverableCardHtml(message, deliverableEvent, ctx);
    }
    const settledReportOutcome = runSettledReportOutcome(message.content);
    if (settledReportOutcome) {
      return renderRunSettledReportHtml(message, settledReportOutcome, ctx);
    }
    return renderSystemEventLineHtml(message, ctx);
  }
  const isCuu = message.sender_type === "cuu";
  const isSelf = ctx.currentUserId !== undefined && message.sender_user_id === ctx.currentUserId;
  const avatar = isCuu
    ? avatarTileHtml({ label: "Cuu", id: "cuu", variant: "cuu" })
    : avatarTileHtml({ label: senderLabel(message, ctx), id: message.sender_user_id ?? message.id });
  const rowClass = ["wh-wb-chat-msg", isCuu ? "wh-wb-chat-msg--cuu" : "", isSelf ? "wh-wb-chat-msg--self" : ""]
    .filter(Boolean)
    .join(" ");
  // R13 批 P2：data-wb-chat-message-id——dispatch_ask 追赶提醒条点击后想把对应的行动卡滚进视口
  // （见 dispatch-ask-catchup.ts 顶部注释 + timeline.ts 的 findActionCardMessageIdByTitle），
  // 需要一个稳定的 DOM 锚点定位到具体是哪条消息。之前完全没有——view.ts 只能重建 innerHTML，
  // 没法用消息 id 反查 DOM 节点。
  return `<div class="${rowClass}" data-wb-chat-message-id="${escapeHtml(message.id)}">${avatar}<div class="wh-wb-chat-bub"><div class="wh-wb-chat-who">${escapeHtml(senderLabel(message, ctx))}<span class="wh-wb-chat-tm">${formatMessageTime(message.created_at, ctx.locale)}</span></div>${messageBodyHtml(message, ctx)}</div></div>`;
}

// —— 发送中乐观渲染（以服务端 message.created 回执为准去重，见 view.ts）—— //

export type PendingOutgoingMessage = {
  tempId: string;
  text?: string;
  fileName?: string;
  status: "sending" | "error";
};

export function renderPendingOutgoingHtml(pending: PendingOutgoingMessage, ctx: ChatRenderContext): string {
  const zh = ctx.locale === "zh-CN";
  const avatar = ctx.currentUserId
    ? avatarTileHtml({ label: ctx.members.get(ctx.currentUserId)?.nickname ?? "?", id: ctx.currentUserId })
    : avatarTileHtml({ label: "?", id: "self" });
  const body = pending.fileName
    ? `<div class="wh-wb-chat-filecard">${workbenchIcons.folder}<span class="wh-wb-chat-filecard-name">${escapeHtml(pending.fileName)}</span></div>`
    : `<div class="wh-wb-chat-txt">${escapeHtml(pending.text ?? "").replace(/\n/gu, "<br>")}</div>`;
  const status =
    pending.status === "sending"
      ? `<span class="wh-wb-chat-pending-status">${zh ? "发送中…" : "Sending…"}</span>`
      : `<span class="wh-wb-chat-pending-status wh-wb-chat-pending-status--error">${zh ? "没发出去" : "Couldn't send"} <button type="button" class="wh-wb-chat-pending-retry" data-wb-chat-retry-pending="${escapeHtml(pending.tempId)}">${zh ? "重试" : "Retry"}</button></span>`;
  return `<div class="wh-wb-chat-msg wh-wb-chat-msg--self wh-wb-chat-msg--pending" data-wb-chat-pending-id="${escapeHtml(pending.tempId)}">${avatar}<div class="wh-wb-chat-bub">${body}${status}</div></div>`;
}

// —— R12（final-turns-wiring）：协同会话 turn 状态 —— //
//
// 只在 kind='collab' 的会话里出现（view.ts 用 turn.ts 的 shouldRequestConversationTurn 判定，主区
// 永远不会进到这两个函数）。两态复用同一块视觉语言、不新增 CSS 规则：
// - "pending"（等待第一个 delta）：直接复用 renderTypingIndicatorHtml 同款 class
//   （.wh-wb-chat-typing/-dots），措辞换成"Cuu 正在回复…"。
// - "error"（409/429/500 → turn.ts 的 mapConversationTurnError 温和文案）：同一个容器 class，
//   不用红色报错样式——这是"不弹阻断"的直接体现，视觉上应该像一条安静的状态提示，不是一个警报。

export function renderCuuTurnPendingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  const text = zh ? "Cuu 正在回复…" : "Cuu is replying…";
  return `<div class="wh-wb-chat-typing" data-wb-chat-turn-pending>${escapeHtml(text)}<span class="wh-wb-chat-typing-dots"><i></i><i></i><i></i></span></div>`;
}

export function renderCuuTurnErrorHtml(message: string): string {
  return `<div class="wh-wb-chat-typing" data-wb-chat-turn-error>${escapeHtml(message)}</div>`;
}

// 流式增量拼出的临时"正在生成"气泡——挂在消息流末尾（pending outgoing 消息之后），用真实消息气泡的
// 视觉语言（wh-wb-chat-msg--cuu 头像/配色），套 --pending 的半透明态标出"还没定"，同批 8
// renderPendingOutgoingHtml 的处理是同一个视觉语汇。turn.ts 的 renderTurnDeltaText 已经按 ordinal
// 排好序拼好了文本，这里只管渲染；没有 mention 高亮（Cuu 自己的话没有"@某人"需要标记的场景）。
export function renderStreamingCuuBubbleHtml(text: string, ctx: ChatRenderContext): string {
  const avatar = avatarTileHtml({ label: "Cuu", id: "cuu", variant: "cuu" });
  const body = text
    ? `<div class="wh-wb-chat-txt">${escapeHtml(text).replace(/\n/gu, "<br>")}</div>`
    : `<div class="wh-wb-chat-typing-dots"><i></i><i></i><i></i></div>`;
  return `<div class="wh-wb-chat-msg wh-wb-chat-msg--cuu wh-wb-chat-msg--pending" data-wb-chat-streaming-cuu>${avatar}<div class="wh-wb-chat-bub"><div class="wh-wb-chat-who">Cuu</div>${body}</div></div>`;
}

// —— 正在输入 —— //

export function renderTypingIndicatorHtml(labels: readonly string[], locale: Locale): string {
  if (labels.length === 0) {
    return "";
  }
  const zh = locale === "zh-CN";
  const names = labels.join(zh ? "、" : ", ");
  const text = zh
    ? `${names} 正在输入`
    : labels.length === 1
      ? `${names} is typing`
      : `${names} are typing`;
  return `<div class="wh-wb-chat-typing">${escapeHtml(text)}<span class="wh-wb-chat-typing-dots"><i></i><i></i><i></i></span></div>`;
}

// —— 连接状态横幅（00 §9：SSE 断线→顶部细横幅「连接中断，正在重连」） —— //

export function renderConnectionBannerHtml(state: ConnectionBannerState, locale: Locale): string {
  const zh = locale === "zh-CN";
  if (state === "reconnect_scheduled") {
    return `<div class="wh-wb-chat-banner">${zh ? "连接中断，正在重连…" : "Connection lost — reconnecting…"}</div>`;
  }
  if (state === "connecting") {
    return `<div class="wh-wb-chat-banner">${zh ? "正在连接…" : "Connecting…"}</div>`;
  }
  return "";
}

// —— 空态（照 00 §9：新项目空群聊 → Cuu 开场白，引导第一条消息） —— //

export function renderChatEmptyStateHtml(input: { locale: Locale; projectName: string }): string {
  const zh = input.locale === "zh-CN";
  const title = zh ? `欢迎来到「${input.projectName}」` : `Welcome to "${input.projectName}"`;
  const body = zh
    ? "这里是项目的主区——进展、决定、文件都在这聊。丢个文件或说句话，我是 Cuu，会盯着帮你们拎重点。"
    : "This is the project's main chat — progress, decisions, and files all live here. Drop a file or say something to get started. I'm Cuu, and I'll keep an eye on things for you.";
  return `<div class="wh-wb-chat-empty ds-anim-fade-in"><span class="wh-wb-chat-empty-icon">${workbenchIcons.cat}</span><h3 class="wh-wb-chat-empty-title">${escapeHtml(title)}</h3><p class="wh-wb-chat-empty-body">${escapeHtml(body)}</p></div>`;
}

// R12 批8：无权限深链空态（00 §9「无权限项目」行的后半句：深链到无权会话→温和的「你不在这个项目里」
// +申请入口）。后端对"会话不存在"和"会话存在但你没权限"故意用同一个非预言式 404（见
// apps/api/src/services/conversations.ts 的 conversation_not_found），前端也没法、也不该替它区分
// 到底是哪种——"你不在这个项目里"这句话对两种情况都成立、都不算说谎。没有真实的"申请加入"后端流程
// （仓库现状只有管理员发起的邀请，没有自助申请端点），所以这里不摆一个点了没反应的按钮（04 §4 铁律
// 3），只给文字指引去找已经在项目里的人帮忙拉。retry 按钮也不给——权限问题重试不会变好，给一个
// 只会一直失败的按钮不是诚实的加固。
export function renderConversationAccessDeniedHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  const title = zh ? "你不在这个项目里" : "You're not in this project";
  const body = zh
    ? "这个会话对你不可见——可能链接过期，也可能你还没被拉进这个项目。找项目里的同事帮你加进来。"
    : "This conversation isn't visible to you — the link may be stale, or you haven't been added to this project yet. Ask someone already on the project to add you.";
  return `<div class="wh-wb-chat-empty ds-anim-fade-in"><span class="wh-wb-chat-empty-icon">${workbenchIcons.lock}</span><h3 class="wh-wb-chat-empty-title">${escapeHtml(title)}</h3><p class="wh-wb-chat-empty-body">${escapeHtml(body)}</p></div>`;
}

export function renderHistoryLoadErrorHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-chat-error">${zh ? "没加载出聊天记录，稍后重试" : "Couldn't load the chat history — retry"}<div style="margin-top:13px"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-chat-retry-history>${zh ? "重试" : "Retry"}</button></div></div>`;
}

export function renderHistoryLoadingHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  return `<div class="wh-wb-wb-loading wh-wb-loading"><span class="wh-wb-spinner"></span>${zh ? "正在加载聊天记录…" : "Loading chat history…"}</div>`;
}

// R12 批8：「滚到顶加载更早」的占位——批 8 补了 beforeSeq，替换掉批 2 的
// renderHistoryTruncatedNoticeHtml（那个只能诚实承认"翻不上去"）。四态：
// - "none"：本地没有隐藏消息，服务端也没有更早的了——真的到最开头，不渲染任何东西。
// - "local"：本地 messages 数组里还有 DOM 窗口之外的消息（批 8 §2 的 DOM 窗口化），点一下就地展开，
//   不发网络请求。
// - "server-idle"/"server-loading"/"server-error"：本地已经展开到头，要不要继续问服务端要更早一页。
export type LoadEarlierState =
  | { kind: "none" }
  | { kind: "local"; hiddenCount: number }
  | { kind: "server-idle" }
  | { kind: "server-loading" }
  | { kind: "server-error" };

export function renderLoadEarlierHtml(state: LoadEarlierState, locale: Locale): string {
  const zh = locale === "zh-CN";
  if (state.kind === "none") {
    return "";
  }
  if (state.kind === "local") {
    const label = zh
      ? `展开更早的 ${state.hiddenCount} 条消息`
      : `Show ${state.hiddenCount} earlier message${state.hiddenCount === 1 ? "" : "s"}`;
    return `<div class="wh-wb-chat-load-earlier"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-chat-load-earlier>${escapeHtml(label)}</button></div>`;
  }
  if (state.kind === "server-loading") {
    return `<div class="wh-wb-chat-load-earlier wh-wb-chat-load-earlier--loading"><span class="wh-wb-spinner"></span>${zh ? "正在加载更早的消息…" : "Loading earlier messages…"}</div>`;
  }
  if (state.kind === "server-error") {
    return `<div class="wh-wb-chat-load-earlier wh-wb-chat-load-earlier--error">${zh ? "没加载出更早的消息" : "Couldn't load earlier messages"}<button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-chat-load-earlier>${zh ? "重试" : "Retry"}</button></div>`;
  }
  return `<div class="wh-wb-chat-load-earlier"><button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-chat-load-earlier>${zh ? "加载更早的消息" : "Load earlier messages"}</button></div>`;
}

// —— composer —— //

export type ComposerAttachmentChip = { driveItemId: string; name: string };

export function renderComposerHtml(input: {
  locale: Locale;
  draftText: string;
  attachments: readonly ComposerAttachmentChip[];
  sending: boolean;
  sendError?: string | undefined;
  // R12（模式五档，2026-07-12 纠偏后归位到单聊）：只有协同会话（conversationKind === 'collab'）的
  // 调用方才会传——由 view.ts 用下面的 renderModeChipHtml 算好 HTML 再传进来，这个函数本身不关心
  // mode 的具体值，只负责把它摆在 @/#// chip 之后、发送按钮之前（照 prototype 的 .ctools 顺序）。
  // 省略这个参数（主区群聊）时不渲染任何模式相关标记——见"模式五档"一节顶部注释与其 colocated 测试，
  // 这条测试就是 04 §4 铁律要求的"主区不渲染,写测试锁死"。
  modeChipHtml?: string | undefined;
  // R13 批 P2（拍板链路收尾）：turn（协同会话对 Cuu 的一轮请求）进行中时的「禁发+文案」方案——
  // 采用禁发而不是本地排队重试（00 §3 交互设计没有承诺过排队语义，禁发更诚实：这一轮还没落定前
  // 发第二条只会撞服务端 409 conversation_turn_busy，见 turn.ts 顶部注释）。只有协同会话才会真的把
  // 这个参数传成 true（view.ts 的 turnActive 只在 collab 会话里被置位，见 turn.ts 的
  // shouldRequestConversationTurn 唯一判定点）——主区省略这个参数，行为与升级前完全一致，不受影响。
  turnActive?: boolean | undefined;
}): string {
  const zh = input.locale === "zh-CN";
  const turnActive = input.turnActive === true;
  const attachmentsHtml = input.attachments.length
    ? `<div class="wh-wb-chat-attachments">${input.attachments
        .map(
          (attachment) =>
            `<span class="wh-wb-chat-attachment-chip">${workbenchIcons.folder}<span>${escapeHtml(attachment.name)}</span><button type="button" data-wb-chat-remove-attachment="${escapeHtml(attachment.driveItemId)}" aria-label="${zh ? "移除" : "Remove"}">${workbenchIcons.close}</button></span>`
        )
        .join("")}</div>`
    : "";
  const errorHtml = input.sendError
    ? `<div class="wh-wb-chat-send-error">${escapeHtml(input.sendError)}<button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-chat-retry-send>${zh ? "重试" : "Retry"}</button></div>`
    : "";
  const canSend = !input.sending && !turnActive && (input.draftText.trim().length > 0 || input.attachments.length > 0);
  const placeholder = turnActive
    ? zh
      ? "Cuu 回完这条就好…"
      : "Just a moment — Cuu is replying to the last one…"
    : zh
      ? "发消息给项目组和 Cuu…(@ 引用网盘文件/成员 · # 会话 · / 技能)"
      : "Message the team and Cuu… (@ file/member · # conversation · / skill)";
  const modeChip = input.modeChipHtml ?? "";
  // data-wb-chat-picker-slot：@/#// picker 的挂载点，特意留空——view.ts 单独更新这一个子节点的
  // innerHTML（每次按键都可能要开关/刷新 picker），绝不重建整个 composer（那会打断 textarea 的
  // 焦点/光标位置，rail.ts 的「新建项目」输入框已经踩过这个坑，见其 input 事件里的注释）。
  // data-wb-chat-mode-pop-slot：模式五档弹层的挂载点，同一套"独立子节点刷新"取舍——主区会话里这个
  // 节点永远是空的（view.ts 从不在那里写入），有节点但不写内容，比"这个节点本身按会话种类条件渲染"
  // 更简单也更安全（不会因为切换会话种类漏挂/漏卸载一个挂载点）。
  return `<div class="wh-wb-chat-composer">${errorHtml}${attachmentsHtml}<div class="wh-wb-chat-cbox"><textarea class="wh-wb-chat-input" rows="1" placeholder="${escapeHtml(placeholder)}" data-wb-chat-input${input.sending ? " disabled" : ""}>${escapeHtml(input.draftText)}</textarea><div class="wh-wb-chat-ctools"><button type="button" class="wh-wb-chat-ctag" data-wb-chat-tool-trigger="@"><b>@</b> ${zh ? "文件·成员" : "file · member"}</button><span class="wh-wb-chat-ctag wh-wb-chat-ctag--soon" title="${zh ? "即将上线" : "Coming soon"}"><b>#</b> ${zh ? "会话" : "conversation"}</span><span class="wh-wb-chat-ctag wh-wb-chat-ctag--soon" title="${zh ? "即将上线" : "Coming soon"}"><b>/</b> ${zh ? "技能" : "skill"}</span>${modeChip}<button type="button" class="wh-wb-chat-send" data-wb-chat-send${canSend ? "" : " disabled"} aria-label="${zh ? "发送" : "Send"}">${workbenchIcons.send}</button></div><div data-wb-chat-mode-pop-slot></div><div data-wb-chat-picker-slot></div></div></div>`;
}

// —— R12（模式五档）：仅协同会话（conversationKind === 'collab'）composer 出现——2026-07-12 纠偏后
// 模式五档只属于单聊，主区群聊固定走项目治理的静默观察者档，composer 不渲染这个控件。视觉/文案照抄
// r12-desktop-workbench/prototype/index.html 的 .power chip + #powerPop 弹层与
// 00-interaction-design.md §3 的模式五档表（两者一致，这里以原型的逐字文案为准）。

const AI_MODE_LEVELS = [1, 2, 3, 4, 5] as const;
type AiModeLevel = (typeof AI_MODE_LEVELS)[number];

// chip 上的短名——不带"(默认)"后缀（那只出现在弹层第 3 档的选项标题里；原型里 chip 文本和弹层选项
// 标题本来就是两份不同的字符串，setLvl() 的第二个参数没有"(默认)"，.lvl 列表的 .lt 才有）。
const AI_MODE_CHIP_LABEL: Record<AiModeLevel, { zh: string; en: string }> = {
  1: { zh: "只观察", en: "Observe only" },
  2: { zh: "全部先问", en: "Ask first" },
  3: { zh: "分级自动", en: "Tiered auto" },
  4: { zh: "全自动 · 人审", en: "Full auto · human review" },
  5: { zh: "全托管 · AI 审", en: "Fully managed · AI review" }
};

const AI_MODE_OPTION: Record<AiModeLevel, { titleZh: string; titleEn: string; descZh: string; descEn: string }> = {
  1: {
    titleZh: "只观察",
    titleEn: "Observe only",
    descZh: "只总结讨论，不提出也不执行",
    descEn: "Only summarizes the discussion — no proposals, no execution"
  },
  2: {
    titleZh: "全部先问",
    titleEn: "Ask first",
    descZh: "提出方案，任何执行都等人点头",
    descEn: "Proposes a plan — any execution waits for your go-ahead"
  },
  3: {
    titleZh: "分级自动(默认)",
    titleEn: "Tiered auto (default)",
    descZh: "有把握的直接干(可撤销)；拿不准的先问你",
    descEn: "Acts directly when confident (undoable) — asks first when unsure"
  },
  4: {
    titleZh: "全自动 · 人审",
    titleEn: "Full auto · human review",
    descZh: "拎出的事全都干，合并前仍由人审提议",
    descEn: "Does everything it pulls out — a human still reviews before merge"
  },
  5: {
    titleZh: "全托管 · AI 审",
    titleEn: "Fully managed · AI review",
    descZh: "AI 复核通过即自动合并；法务/财务/身份类永远升级给人",
    descEn: "Auto-merges once AI review passes — legal/finance/identity always escalate to a human"
  }
};

function isKnownAiModeLevel(mode: AiMode | undefined): mode is AiModeLevel {
  return mode !== undefined && (AI_MODE_LEVELS as readonly number[]).includes(mode);
}

// chip：mode 未知（还没拉到 GET /api/me/ai-profile，或者拉失败）时诚实显示「模式」，不瞎猜一个默认档
// 糊弄过去——见 chat/view.ts loadMyAiProfile 顶部注释（04 §4 铁律 3 的"不假接线"延伸：宁可看起来
// 没加载完，也不能显示一个不一定真的当前档）。
export function renderModeChipHtml(mode: AiMode | undefined, locale: Locale): string {
  const zh = locale === "zh-CN";
  const known = isKnownAiModeLevel(mode);
  const label = known ? (zh ? AI_MODE_CHIP_LABEL[mode]!.zh : AI_MODE_CHIP_LABEL[mode]!.en) : undefined;
  const warn = mode === 5;
  const cls = ["wh-wb-mode-chip", warn ? "wh-wb-mode-chip--warn" : ""].filter(Boolean).join(" ");
  const prefix = zh ? "我的模式" : "My mode";
  // 半角冒号、无空格——照原型 .power chip 的原文「我的模式:分级自动」（prototype/index.html:599），
  // 不是全角「：」。
  const separator = zh ? ":" : ": ";
  const body = label
    ? `${escapeHtml(prefix)}${separator}<span class="wh-wb-mode-chip-lv">${escapeHtml(label)}</span>`
    : `<span class="wh-wb-mode-chip-lv">${escapeHtml(zh ? "模式" : "Mode")}</span>`;
  return `<button type="button" class="${cls}" data-wb-chat-mode-toggle aria-haspopup="true">${body}</button>`;
}

// 弹层：五档单选行（数字键 1-5 由 view.ts 的 keydown 处理，这里只渲染 .num 徽标提示快捷键）+
// 「按能力细分」灰字（照原型 .gran，纯说明文字，不是按钮——批次范围不含真正的按能力粒度开关，见
// AiGranularSettings，摆一个看起来能点却什么都不做的入口违反 04 §4 铁律 3，所以这里既没有 cursor:pointer
// 也没有 data-* 挂钩）+ 服务端下发说明行（照原型 .srv，忠于原型的锁图标 + 加粗「服务端下发」）。
export function renderModePopoverHtml(input: {
  mode: AiMode | undefined;
  locale: Locale;
  // R13 H1（键盘可达性）：方向键当前高亮到第几档（下标 0..4，对应 AI_MODE_LEVELS[0..4] = 1..5）。
  // 跟 aria-checked 反映的"当前生效档位"是两回事——可选，既有调用点（现有测试）不用管，不传就是
  // "没有键盘高亮"（比如鼠标点开弹层、还没按过方向键的那一刻）。
  highlightedIndex?: number;
}): string {
  const zh = input.locale === "zh-CN";
  const title = zh ? "我的 AI 模式 · 与 Cuu 单聊" : "My AI mode · 1:1 with Cuu";
  const sub = zh
    ? "只影响你的协同会话；主区观察者由项目治理管。按 1-5 快切"
    : "Only affects your 1:1 conversations — the main-chat observer is governed at the project level. Press 1-5 to switch.";
  const rows = AI_MODE_LEVELS.map((level, index) => {
    const opt = AI_MODE_OPTION[level];
    const isOn = input.mode === level;
    const isWarn = level === 5;
    const isHighlighted = index === input.highlightedIndex;
    const cls = ["wh-wb-mode-lvl", isOn ? "wh-wb-mode-lvl--on" : "", isWarn ? "wh-wb-mode-lvl--warn" : ""]
      .filter(Boolean)
      .join(" ");
    const titleText = zh ? opt.titleZh : opt.titleEn;
    const descText = zh ? opt.descZh : opt.descEn;
    // roving tabindex：这一行不靠原生 Tab 单独停留（tabindex="-1"），方向键由 view.ts 的
    // handleDocumentModeKeydown 管理高亮下标（跟既有的数字键 1-5 快切共用同一个 selectMode）。
    const highlightAttr = isHighlighted ? ' style="outline:2px solid rgba(10,132,255,.55);outline-offset:-2px"' : "";
    return `<div class="${cls}" data-wb-chat-mode-option="${level}" role="radio" aria-checked="${isOn}" tabindex="-1"${highlightAttr}><span class="wh-wb-mode-lvl-r"></span><span class="wh-wb-mode-lvl-body"><span class="wh-wb-mode-lvl-title">${escapeHtml(titleText)}</span><span class="wh-wb-mode-lvl-desc">${escapeHtml(descText)}</span></span><span class="wh-wb-mode-lvl-num">${level}</span></div>`;
  }).join("");
  const gran = zh
    ? "按能力细分：建任务 / 派 run / 动网盘 / 发通知…"
    : "Break down by capability: create task / dispatch run / touch drive / send notification…";
  const srvLead = zh ? "模型与密钥由" : "Model & keys are ";
  const srvStrong = zh ? "服务端下发" : "issued by the server";
  const srvTail = zh ? "，桌面不保存任何 API key。" : " — the desktop app never stores an API key.";
  return `<div class="wh-wb-mode-pop" data-wb-chat-mode-pop role="menu"><div class="wh-wb-mode-pop-title">${escapeHtml(title)}</div><div class="wh-wb-mode-pop-sub">${escapeHtml(sub)}</div>${rows}<div class="wh-wb-mode-gran">${escapeHtml(gran)}</div><div class="wh-wb-mode-srv">${workbenchIcons.lock}<span>${escapeHtml(srvLead)}<b>${escapeHtml(srvStrong)}</b>${escapeHtml(srvTail)}</span></div></div>`;
}

// 只观察档(1)预告——composer 旁的诚实预告，免得用户发完一句话才被服务端 409
// conversation_turn_mode_observe_only 拒了才知道 Cuu 不会回话；那条 409 文案（turn.ts 的
// mapConversationTurnError）是事后补救，这条是事先预告，两者互补，不重复渲染。
export function renderModeObserveOnlyHintHtml(locale: Locale): string {
  const zh = locale === "zh-CN";
  const text = zh ? "当前是只观察档，Cuu 不会回话" : "You're in observe-only mode — Cuu won't reply";
  return `<div class="wh-wb-mode-hint">${escapeHtml(text)}</div>`;
}

// PATCH /api/me/ai-profile 失败后的温和行内提示——通用文案，不按服务端 code 分支（ai-settings.ts
// 当前的失败码只有访问权限/模型档位不可用这类跟"切个人模式档"关系不大的错误，没有专属文案表可维护；
// 照 turn.ts 的 fallback 文案同一个取舍：不暴露内部错误码，只给一句诚实的重试建议）。
export function modePatchFailedText(locale: Locale): string {
  return locale === "zh-CN" ? "模式没保存成功，再试一次。" : "Couldn't save the mode change — try again.";
}

export function renderModeErrorHintHtml(message: string): string {
  return `<div class="wh-wb-mode-hint wh-wb-mode-hint--error">${escapeHtml(message)}</div>`;
}

// —— @ picker（真实：成员本地过滤 + 网盘文件复用既有搜索端点） —— //

export type MentionPickerMember = { userId: string; nickname: string };
export type MentionPickerFile = { itemId: string; name: string };

export function renderMentionPickerHtml(input: {
  locale: Locale;
  members: readonly MentionPickerMember[];
  files: readonly MentionPickerFile[];
  filesLoading: boolean;
  // R13 H1（键盘可达性）：下标对齐"成员在前、文件在后"这一整条拼起来的选项序列（跟 view.ts 的
  // mentionOptionCount/selectHighlightedMentionOption 用的是同一套下标口径）。可选——既有调用点
  // （现有测试）不用管，不传就等于"没有高亮"。
  highlightedIndex?: number;
}): string {
  const zh = input.locale === "zh-CN";
  let optionIndex = 0;
  const memberRows = input.members
    .slice(0, 8)
    .map((member) => {
      const isHighlighted = optionIndex === input.highlightedIndex;
      optionIndex += 1;
      // roving tabindex：不再靠原生 Tab 单独停留（tabindex="-1"），方向键由 view.ts 的
      // composer keydown 处理函数管理高亮下标，焦点仍留在 textarea 里（边打字边过滤这条 UX 不能丢——
      // 移走真实焦点会打断输入），Enter 提交当前高亮的那一行。
      const highlightAttr = isHighlighted ? ' style="outline:2px solid rgba(10,132,255,.55);outline-offset:-2px"' : "";
      // R13 批4c：Cuu 的 sentinel 候选（userId==="cuu"）用她在气泡里同款的猫头像变体，不是随机色块——
      // 一眼能认出这是 @ Cuu，不是 @ 了一个叫 "Cuu" 的真人成员。
      const avatar =
        member.userId === "cuu"
          ? avatarTileHtml({ label: member.nickname, id: member.userId, variant: "cuu" })
          : avatarTileHtml({ label: member.nickname, id: member.userId });
      return `<button type="button" class="wh-wb-chat-picker-row" tabindex="-1" role="option" aria-selected="${isHighlighted}"${highlightAttr} data-wb-chat-pick-member="${escapeHtml(member.userId)}">${avatar}<span>${escapeHtml(member.nickname)}</span></button>`;
    })
    .join("");
  const fileRows = input.files
    .slice(0, 8)
    .map((file) => {
      const isHighlighted = optionIndex === input.highlightedIndex;
      optionIndex += 1;
      const highlightAttr = isHighlighted ? ' style="outline:2px solid rgba(10,132,255,.55);outline-offset:-2px"' : "";
      return `<button type="button" class="wh-wb-chat-picker-row" tabindex="-1" role="option" aria-selected="${isHighlighted}"${highlightAttr} data-wb-chat-pick-file="${escapeHtml(file.itemId)}">${workbenchIcons.folder}<span>${escapeHtml(file.name)}</span></button>`;
    })
    .join("");
  const memberSection = memberRows
    ? `<div class="wh-wb-chat-picker-section-title">${zh ? "成员" : "Members"}</div>${memberRows}`
    : "";
  const fileSection = input.filesLoading
    ? `<div class="wh-wb-chat-picker-section-title">${zh ? "网盘文件" : "Drive files"}</div><div class="wh-wb-chat-picker-loading">${zh ? "搜索中…" : "Searching…"}</div>`
    : fileRows
      ? `<div class="wh-wb-chat-picker-section-title">${zh ? "网盘文件" : "Drive files"}</div>${fileRows}`
      : "";
  const empty = !memberSection && !fileSection ? `<div class="wh-wb-chat-picker-empty">${zh ? "没有匹配结果" : "No matches"}</div>` : "";
  return `<div class="wh-wb-chat-picker" data-wb-chat-picker="mention" role="listbox">${memberSection}${fileSection}${empty}</div>`;
}

// —— # / picker：本批只做外壳，「即将可用」灰态，不发真实搜索请求（见批 2 汇报的范围说明）。 —— //

export function renderComingSoonPickerHtml(input: { locale: Locale; trigger: "#" | "/" }): string {
  const zh = input.locale === "zh-CN";
  const title = input.trigger === "#" ? (zh ? "会话引用" : "Conversation reference") : zh ? "技能唤起" : "Skill invocation";
  const note = zh ? "即将上线" : "Coming soon";
  return `<div class="wh-wb-chat-picker wh-wb-chat-picker--soon" data-wb-chat-picker="soon"><div class="wh-wb-chat-picker-title">${escapeHtml(title)}</div><div class="wh-wb-chat-picker-soon-note">${escapeHtml(note)}</div></div>`;
}

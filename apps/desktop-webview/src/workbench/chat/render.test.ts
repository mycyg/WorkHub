import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationMessageVM, WorkbenchPageVM } from "@workhub/contracts";

import {
  avatarTileHtml,
  membersById,
  modePatchFailedText,
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
  type WorkbenchMemberVM
} from "./render.js";

function member(input: Partial<WorkbenchMemberVM> & { user_id: string; nickname: string }): WorkbenchMemberVM {
  return {
    membership_role: "member",
    is_project_owner: false,
    is_self: false,
    ...input
  };
}

function ctxWith(
  members: WorkbenchMemberVM[],
  currentUserId?: string,
  extra?: Partial<Pick<ChatRenderContext, "now" | "openReassignItemId" | "actionCardRunProgress">>
): ChatRenderContext {
  return { locale: "zh-CN", members: membersById(members), currentUserId, ...extra };
}

function actionCardItem(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "i1",
    kind: "decide",
    title_md: "预算是否砍半",
    confidence: "low",
    status: "waiting_decision",
    ...overrides
  };
}

function baseMessage(overrides: Partial<ConversationMessageVM> = {}): ConversationMessageVM {
  return {
    id: "m1",
    conversation_id: "conv-1",
    seq: 1,
    sender_type: "user",
    sender_user_id: "user-1",
    kind: "text",
    content: { text: "hello" },
    thread_root_id: null,
    created_at: "2026-07-12T09:00:00.000000Z",
    ...overrides
  } as ConversationMessageVM;
}

// —— member bar —— //

test("renderMemberBarHtml shows a member count plus Cuu, no fabricated online indicator", () => {
  const html = renderMemberBarHtml({
    members: [member({ user_id: "u1", nickname: "张三" }), member({ user_id: "u2", nickname: "阿曼" })],
    locale: "zh-CN"
  });
  assert.match(html, /2 位成员 \+ Cuu/u);
  // No fake presence claim — batch 2 does not derive real online status.
  assert.doesNotMatch(html, /在线/u);
});

test("renderMemberBarHtml caps the rendered avatar row at 6 members but keeps the true count in the label", () => {
  const members = Array.from({ length: 10 }, (_, i) => member({ user_id: `u${i}`, nickname: `成员${i}` }));
  const html = renderMemberBarHtml({ members, locale: "zh-CN" });
  assert.match(html, /10 位成员/u);
  assert.equal((html.match(/class="wh-wb-chat-avatar"/gu) ?? []).length, 6);
});

// R13 批 G1（小群）：senderLabel/renderMessageHtml 按 sender_user_id 查 ctx.members（一个纯 Map 查找，
// 见 render.ts 的 senderLabel），对小群（3+ 位真人参与者）天然成立，不需要为群聊场景额外改造——这条
// 补一条回归测试钉死这个事实（同批设计稿"多人昵称解析不是风险点"一节的结论）。
test("renderMessageHtml resolves each of three distinct human senders in a small group to their own nickname (multi-sender nickname resolution)", () => {
  const ctx = ctxWith([
    member({ user_id: "u1", nickname: "张三" }),
    member({ user_id: "u2", nickname: "李四" }),
    member({ user_id: "u3", nickname: "王五" })
  ]);
  const zhangHtml = renderMessageHtml(baseMessage({ id: "m1", sender_user_id: "u1", content: { text: "第一条" } }), ctx);
  const liHtml = renderMessageHtml(baseMessage({ id: "m2", sender_user_id: "u2", content: { text: "第二条" } }), ctx);
  const wangHtml = renderMessageHtml(baseMessage({ id: "m3", sender_user_id: "u3", content: { text: "第三条" } }), ctx);

  assert.match(zhangHtml, /张三/u);
  assert.doesNotMatch(zhangHtml, /李四|王五/u);
  assert.match(liHtml, /李四/u);
  assert.doesNotMatch(liHtml, /张三|王五/u);
  assert.match(wangHtml, /王五/u);
  assert.doesNotMatch(wangHtml, /张三|李四/u);
});

// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增）：真人消息行的头像 tile 带
// data-wb-avatar-user-id——view.ts 的 hydrateAvatarPhotos 据此把真实头像图片叠进色块之上，
// onerror/无头像时回退到已有的首字母色块（这条测试只钉字符串产出，不测 hydrate 本身——那部分
// 需要真 DOM，覆盖在 view.test.ts）。Cuu 消息不带这个属性——猫头像不受影响。
test("renderMessageHtml marks a human sender's avatar tile with data-wb-avatar-user-id for later photo hydration", () => {
  const ctx = ctxWith([member({ user_id: "u1", nickname: "张三" })]);
  const html = renderMessageHtml(baseMessage({ sender_user_id: "u1", content: { text: "hi" } }), ctx);
  assert.match(html, /data-wb-avatar-user-id="u1"/u);
});

test("renderMessageHtml does not mark Cuu's avatar tile with data-wb-avatar-user-id (the cat icon is not a photo)", () => {
  const ctx = ctxWith([]);
  const html = renderMessageHtml(baseMessage({ sender_type: "cuu", sender_user_id: null, content: { text: "hi" } }), ctx);
  assert.doesNotMatch(html, /data-wb-avatar-user-id/u);
  assert.match(html, /wh-wb-chat-avatar--cuu/u);
});

test("renderMemberBarHtml marks each member's avatar tile with data-wb-avatar-user-id, but not Cuu's", () => {
  const html = renderMemberBarHtml({
    members: [member({ user_id: "u1", nickname: "张三" }), member({ user_id: "u2", nickname: "阿曼" })],
    locale: "zh-CN"
  });
  assert.match(html, /data-wb-avatar-user-id="u1"/u);
  assert.match(html, /data-wb-avatar-user-id="u2"/u);
  // Two member tiles + the Cuu tile share the class; only the two members get the data hook.
  assert.equal((html.match(/data-wb-avatar-user-id="/gu) ?? []).length, 2);
});

// —— day separator —— //

test("renderDaySeparatorHtml escapes and wraps the label", () => {
  assert.equal(renderDaySeparatorHtml("今天 · 周六"), '<div class="wh-wb-chat-daysep">今天 · 周六</div>');
});

// —— messages —— //

test("renderMessageHtml renders a text message with sender name, time, and body", () => {
  const html = renderMessageHtml(baseMessage(), ctxWith([member({ user_id: "user-1", nickname: "张三" })]));
  assert.match(html, /张三/u);
  assert.match(html, /hello/u);
  assert.match(html, /wh-wb-chat-msg/u);
});

test("renderMessageHtml marks the current user's own messages with a distinct class", () => {
  const html = renderMessageHtml(baseMessage({ sender_user_id: "me" }), ctxWith([], "me"));
  assert.match(html, /wh-wb-chat-msg--self/u);
});

test("renderMessageHtml does not mark another user's message as self", () => {
  const html = renderMessageHtml(baseMessage({ sender_user_id: "other" }), ctxWith([], "me"));
  assert.doesNotMatch(html, /wh-wb-chat-msg--self/u);
});

test("renderMessageHtml highlights @mentions of real members but leaves unmatched @text alone", () => {
  const html = renderMessageHtml(
    baseMessage({ content: { text: "@张三 请看一下 @不存在的人" } }),
    ctxWith([member({ user_id: "user-1", nickname: "张三" })])
  );
  assert.match(html, /<span class="wh-wb-chat-mention">@张三<\/span>/u);
  assert.doesNotMatch(html, /<span class="wh-wb-chat-mention">@不存在的人/u);
});

test("renderMessageHtml converts newlines in text content to <br>", () => {
  const html = renderMessageHtml(baseMessage({ content: { text: "line1\nline2" } }), ctxWith([]));
  assert.match(html, /line1<br>line2/u);
});

test("renderMessageHtml escapes text content — no raw HTML injection from message bodies", () => {
  const html = renderMessageHtml(baseMessage({ content: { text: "<img src=x onerror=alert(1)>" } }), ctxWith([]));
  assert.doesNotMatch(html, /<img/u);
  assert.match(html, /&lt;img/u);
});

// —— R12 批8：超长文本消息折叠 —— //

test("renderMessageHtml renders a short text message unfolded, with no toggle affordance", () => {
  const html = renderMessageHtml(baseMessage({ content: { text: "short message" } }), ctxWith([]));
  assert.doesNotMatch(html, /wh-wb-chat-text-toggle/u);
  assert.doesNotMatch(html, /wh-wb-chat-txt--folded/u);
});

test("renderMessageHtml folds a long text message behind a Show-full-message toggle by default", () => {
  const longText = "长".repeat(900);
  const html = renderMessageHtml(baseMessage({ id: "m-long", content: { text: longText } }), ctxWith([]));
  assert.match(html, /wh-wb-chat-txt--folded/u);
  assert.match(html, /data-wb-chat-expand-message="m-long"/u);
  assert.doesNotMatch(html, /data-wb-chat-collapse-message/u);
  // the folded preview must not contain the full 900-char text verbatim.
  assert.ok(!html.includes(longText));
});

test("renderMessageHtml renders a long text message in full once its id is in expandedMessageIds", () => {
  const longText = "长".repeat(900);
  const ctx: ChatRenderContext = { ...ctxWith([]), expandedMessageIds: new Set(["m-long"]) };
  const html = renderMessageHtml(baseMessage({ id: "m-long", content: { text: longText } }), ctx);
  assert.doesNotMatch(html, /wh-wb-chat-txt--folded/u);
  assert.match(html, /data-wb-chat-collapse-message="m-long"/u);
  assert.ok(html.includes(longText));
});

// —— R13 批4c：Cuu 主动发起的澄清追问（additive is_clarifying_question 标记，复用 text kind）—— //

test("renderMessageHtml gives a clarifying question a distinct 'Cuu is asking' badge that a plain reply does not get", () => {
  const question = renderMessageHtml(
    baseMessage({ sender_type: "cuu", sender_user_id: null, content: { text: "你要 PPT 还是 Word？", is_clarifying_question: true } }),
    ctxWith([])
  );
  assert.match(question, /Cuu 在问/u);
  const plain = renderMessageHtml(baseMessage({ sender_type: "cuu", sender_user_id: null, content: { text: "看过了，整体不错" } }), ctxWith([]));
  assert.doesNotMatch(plain, /Cuu 在问/u);
});

test("renderMessageHtml renders clarify_options as clickable chips carrying the option text as their payload", () => {
  const html = renderMessageHtml(
    baseMessage({
      sender_type: "cuu",
      sender_user_id: null,
      content: { text: "你要 PPT 还是 Word？", is_clarifying_question: true, clarify_options: ["PPT", "Word"] }
    }),
    ctxWith([])
  );
  assert.match(html, /data-wb-chat-clarify-option="PPT"/u);
  assert.match(html, /data-wb-chat-clarify-option="Word"/u);
});

test("renderMessageHtml renders a clarifying question with no options and no empty chip row", () => {
  const html = renderMessageHtml(
    baseMessage({ sender_type: "cuu", sender_user_id: null, content: { text: "你具体想改哪部分？", is_clarifying_question: true } }),
    ctxWith([])
  );
  assert.match(html, /Cuu 在问/u);
  assert.doesNotMatch(html, /data-wb-chat-clarify-option/u);
});

test("renderMessageHtml escapes clarify_options — no raw HTML injection from option text", () => {
  const html = renderMessageHtml(
    baseMessage({
      sender_type: "cuu",
      sender_user_id: null,
      content: { text: "选一个", is_clarifying_question: true, clarify_options: ["<img src=x onerror=alert(1)>"] }
    }),
    ctxWith([])
  );
  assert.doesNotMatch(html, /<img/u);
  assert.match(html, /&lt;img/u);
});

// —— R13 批4c：@ picker 里 Cuu 的 sentinel 候选 —— //

test("renderMentionPickerHtml puts a Cuu sentinel candidate first, ahead of real members", () => {
  const html = renderMentionPickerHtml({
    locale: "zh-CN",
    members: [
      { userId: "cuu", nickname: "Cuu" },
      { userId: "u1", nickname: "张三" }
    ],
    files: [],
    filesLoading: false
  });
  const cuuIndex = html.indexOf('data-wb-chat-pick-member="cuu"');
  const memberIndex = html.indexOf('data-wb-chat-pick-member="u1"');
  assert.ok(cuuIndex >= 0 && memberIndex >= 0 && cuuIndex < memberIndex);
});

// R13 批 P2：每条消息的外层气泡现在带 data-wb-chat-message-id——dispatch_ask 追赶提醒条点击后靠这个
// 属性反查 DOM 节点滚进视口（见 dispatch-ask-catchup.ts）。
test("renderMessageHtml carries the message id as a stable DOM anchor for scroll-to-message", () => {
  const html = renderMessageHtml(baseMessage({ id: "m-42" }), ctxWith([]));
  assert.match(html, /data-wb-chat-message-id="m-42"/u);
});

test("renderMessageHtml renders a cuu-sent message with the cuu avatar variant and label", () => {
  const html = renderMessageHtml(
    baseMessage({ sender_type: "cuu", sender_user_id: null, content: { text: "我记下了" } }),
    ctxWith([])
  );
  assert.match(html, /wh-wb-chat-msg--cuu/u);
  assert.match(html, /wh-wb-chat-avatar--cuu/u);
  assert.match(html, />Cuu</u);
});

// R12 批 6：file_card 点击 → 右栏预览（和网盘标签共用同一个情境面板组件）——上面批 2 的原始测试
// 名字就叫"no click affordance yet"，本来就预告了这次升级在批 6 发生；这不是迁就实现改断言，
// 是照原定计划把断言换成新行为（真按钮 + 携带 drive_item_id，不是 onclick 内联脚本那种假接线）。
test("renderMessageHtml renders a confirmed file_card message as a real, clickable button carrying its drive item id", () => {
  const html = renderMessageHtml(
    baseMessage({ kind: "file_card", content: { drive_item_id: "drive-1", snapshot_name: "投放周报 W27.xlsx" } }),
    ctxWith([])
  );
  assert.match(html, /投放周报 W27\.xlsx/u);
  assert.match(html, /<button[^>]*wh-wb-chat-filecard[^>]*data-wb-chat-open-file="drive-1"[^>]*data-wb-chat-open-file-name="投放周报 W27\.xlsx"/u);
});

test("renderMessageHtml renders a system_event message as a collapsed single line, not a full bubble", () => {
  const html = renderMessageHtml(
    baseMessage({ kind: "system_event", sender_type: "system", sender_user_id: null, content: { summary: "提议「会议纪要归档」已被张三采纳" } }),
    ctxWith([])
  );
  assert.match(html, /wh-wb-chat-sysline/u);
  assert.match(html, /提议「会议纪要归档」已被张三采纳/u);
  assert.doesNotMatch(html, /wh-wb-chat-bub/u);
});

test("renderMessageHtml falls back to an honest generic label when a system_event has no summary field", () => {
  const html = renderMessageHtml(
    baseMessage({ kind: "system_event", sender_type: "system", sender_user_id: null, content: {} }),
    ctxWith([])
  );
  assert.match(html, /系统事件/u);
});

// R12 批 4b：产出卡回灌——system_event 的 content.event 是 proposal_opened/proposal_auto_merged 时，
// 渲成 editcard 样式（标题+加减行数），不是普通折叠灰线。
test("renderMessageHtml renders a proposal_opened system_event as a deliverable card with title and +adds/-dels, not the plain collapsed sysline", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "system_event",
      sender_type: "system",
      sender_user_id: null,
      content: {
        event: "proposal_opened",
        proposal_id: "proposal-1",
        run_id: "run-1",
        title: "选题报告 · 第三节",
        adds: 86,
        dels: 12
      }
    }),
    ctxWith([])
  );
  assert.match(html, /wh-wb-chat-actioncard/u);
  assert.match(html, /选题报告 · 第三节/u);
  assert.match(html, /\+86/u);
  assert.match(html, /-12/u);
  // 等待人工确认——不是「已自动采纳」话术。
  assert.match(html, /等待人工确认后采纳/u);
  assert.doesNotMatch(html, /已自动采纳/u);
  // R14 批 APPROVE-CHAT（M1 接活）：产出卡现在有一个真接线的「看提议」深链按钮（此前是「后续批次接入」死
  // 文本）——点击 → 右栏打开提议详情。断言从「不许有 button」翻成「必须有这个深链按钮」，是 M1 的正当行为变更。
  assert.match(html, /<button[^>]*data-wb-chat-open-proposal="proposal-1"[^>]*>/u);
  assert.match(html, /看提议/u);
  assert.doesNotMatch(html, /wh-wb-chat-sysline"/u);
  // 没有本机审批记录（settledProposalIds 未传）时不渲覆盖标。
  assert.doesNotMatch(html, /已处理 · 见落定消息/u);
});

test("renderMessageHtml renders a proposal_auto_merged system_event with the full-autonomy badge instead of the pending-review note", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "system_event",
      sender_type: "system",
      sender_user_id: null,
      content: {
        event: "proposal_auto_merged",
        proposal_id: "proposal-2",
        run_id: "run-2",
        title: "选题报告 · 第三节",
        adds: 86,
        dels: 12
      }
    }),
    ctxWith([])
  );
  assert.match(html, /wh-wb-chat-actioncard/u);
  assert.match(html, /已自动采纳 · 全托管/u);
  assert.doesNotMatch(html, /等待人工确认后采纳/u);
  // auto_merged 变体的深链按钮文案是「看已采纳的提议」（打开即 merged 只读态）。
  assert.match(html, /<button[^>]*data-wb-chat-open-proposal="proposal-2"[^>]*>/u);
  assert.match(html, /看已采纳的提议/u);
});

// R14 批 APPROVE-CHAT 档③：服务端审批落定回流——system_event content.event === 'proposal_settled' 渲成
// 落定行（标题 + 已通过/已合并/已打回 + 「看提议」深链），不是普通折叠灰线。
test("renderMessageHtml renders a proposal_settled system_event as a settled line with the outcome and a real view-proposal button", () => {
  const settledMessage = (outcome: string) =>
    baseMessage({
      kind: "system_event",
      sender_type: "system",
      sender_user_id: null,
      content: { event: "proposal_settled", proposal_id: "proposal-7", outcome, title: "选题报告 · 第三节" }
    });
  const approved = renderMessageHtml(settledMessage("approved"), ctxWith([]));
  assert.match(approved, /选题报告 · 第三节 · 已通过/u);
  assert.match(approved, /<button[^>]*data-wb-chat-open-proposal="proposal-7"[^>]*>/u);
  assert.doesNotMatch(approved, /wh-wb-chat-sysline"/u);
  const merged = renderMessageHtml(settledMessage("merged"), ctxWith([]));
  assert.match(merged, /已合并/u);
  assert.match(merged, /正式版本/u);
  const rejected = renderMessageHtml(settledMessage("rejected"), ctxWith([]));
  assert.match(rejected, /已打回/u);
  assert.match(rejected, /下一轮 AI/u);
  // 未知 outcome 不假装认识——落回普通折叠系统行。
  const unknown = renderMessageHtml(settledMessage("vanished"), ctxWith([]));
  assert.match(unknown, /wh-wb-chat-sysline"/u);
});

test("renderMessageHtml overlays a local settled marker on a deliverable card when its proposal is in settledProposalIds", () => {
  const message = baseMessage({
    kind: "system_event",
    sender_type: "system",
    sender_user_id: null,
    content: {
      event: "proposal_opened",
      proposal_id: "proposal-9",
      run_id: "run-9",
      title: "选题报告 · 第三节",
      adds: 4,
      dels: 1
    }
  });
  const withoutSettle = renderMessageHtml(message, ctxWith([]));
  assert.doesNotMatch(withoutSettle, /已处理 · 见落定消息/u);
  const withSettle = renderMessageHtml(message, { ...ctxWith([]), settledProposalIds: new Set(["proposal-9"]) });
  assert.match(withSettle, /已处理 · 见落定消息/u);
  // 覆盖标只针对命中的提议——别的提议 id 命中不影响这张卡。
  const otherSettled = renderMessageHtml(message, { ...ctxWith([]), settledProposalIds: new Set(["proposal-other"]) });
  assert.doesNotMatch(otherSettled, /已处理 · 见落定消息/u);
});

test("renderMessageHtml still renders a non-deliverable system_event (e.g. drive_version_restored) as the plain collapsed sysline", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "system_event",
      sender_type: "system",
      sender_user_id: null,
      content: { event: "drive_version_restored", summary: "《报告.md》找回了旧版本" }
    }),
    ctxWith([])
  );
  assert.match(html, /wh-wb-chat-sysline"/u);
  assert.doesNotMatch(html, /wh-wb-chat-actioncard/u);
});

// —— R13 批 S2：run 终态 PM 汇报（run_settled_report system_event） —— //

test("renderMessageHtml renders a failed run_settled_report as a distinct danger-colored card with the one-line reason", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "system_event",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        event: "run_settled_report",
        run_id: "run-1",
        work_item_id: "wi-1",
        outcome: "failed",
        title: "重写选题报告第三节",
        reason: "沙箱写文件权限被拒绝"
      }
    }),
    ctxWith([])
  );
  assert.match(html, /wh-wb-chat-actioncard/u);
  assert.match(html, /重写选题报告第三节/u);
  assert.match(html, /没干成/u);
  assert.match(html, /沙箱写文件权限被拒绝/u);
  assert.match(html, /var\(--ds-danger\)/u);
});

test("renderMessageHtml renders an escalated run_settled_report asking for a decision, without inventing a reason when none is given", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "system_event",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        event: "run_settled_report",
        run_id: "run-2",
        work_item_id: "wi-2",
        outcome: "escalated",
        title: "预算复核",
        reason: null
      }
    }),
    ctxWith([])
  );
  assert.match(html, /wh-wb-chat-actioncard/u);
  assert.match(html, /预算复核/u);
  assert.match(html, /需要你拍板/u);
  assert.match(html, /var\(--ds-warn\)/u);
});

test("renderMessageHtml falls back to an honest generic reason line for a failed run_settled_report with no reason text", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "system_event",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        event: "run_settled_report",
        run_id: "run-3",
        work_item_id: "wi-3",
        outcome: "failed",
        title: "整理会议纪要",
        reason: null
      }
    }),
    ctxWith([])
  );
  assert.match(html, /具体原因还在整理/u);
});

test("renderMessageHtml renders a real, minimal action_card summary from the actual item titles", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [
          { id: "i1", kind: "execute", title_md: "重写选题报告第三节", confidence: "high", status: "running" },
          { id: "i2", kind: "decide", title_md: "预算是否砍半", confidence: "low", status: "waiting_decision" }
        ]
      }
    }),
    ctxWith([])
  );
  assert.match(html, /Cuu 从讨论里拎出 2 件事/u);
  assert.match(html, /重写选题报告第三节/u);
  assert.match(html, /预算是否砍半/u);
  assert.match(html, /wh-wb-chat-actioncard/u);
});

// R12 行动卡状态回流（00 §9：撤销后「卡片该项置灰划线 +『已撤销』，不删卡」）。
test("renderMessageHtml marks an undone action_card item grey + strikethrough with the 已撤销 label, and keeps it on the card", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [
          { id: "i1", kind: "execute", title_md: "重写选题报告第三节", confidence: "high", status: "undone" },
          { id: "i2", kind: "decide", title_md: "预算是否砍半", confidence: "low", status: "waiting_decision" }
        ]
      }
    }),
    ctxWith([])
  );
  // 撤销的条目不删（留痕）：标题还在，行上带 --undone 修饰类（css.ts 置灰+标题划线），状态标是「已撤销」。
  assert.match(html, /重写选题报告第三节/u);
  assert.match(
    html,
    /<li class="wh-wb-chat-actioncard-item wh-wb-chat-actioncard-item--undone"><span class="wh-wb-chat-actioncard-item-title">重写选题报告第三节<\/span><span class="wh-wb-chat-actioncard-item-status">已撤销<\/span>/u
  );
  // 卡片头部计数不因撤销而缩水——两件事还是两件事。
  assert.match(html, /Cuu 从讨论里拎出 2 件事/u);
  // 未撤销的条目不划线不置灰。
  assert.match(html, /<li class="wh-wb-chat-actioncard-item"><span class="wh-wb-chat-actioncard-item-title">预算是否砍半<\/span>/u);
});

test("renderMessageHtml renders per-status labels for non-undone action_card items without the undone treatment", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [
          { id: "i1", kind: "execute", title_md: "重写第三节", confidence: "high", status: "running" },
          { id: "i2", kind: "decide", title_md: "预算是否砍半", confidence: "low", status: "waiting_decision" },
          { id: "i3", kind: "execute", title_md: "整理会议纪要", confidence: "high", status: "done" },
          { id: "i4", kind: "decide", title_md: "换不换供应商", confidence: "mid", status: "dismissed" }
        ]
      }
    }),
    ctxWith([])
  );
  assert.match(html, />进行中</u);
  assert.match(html, />待拍板</u);
  assert.match(html, />已完成</u);
  assert.match(html, />先不动</u);
  assert.doesNotMatch(html, /已撤销/u);
  assert.doesNotMatch(html, /--undone/u);
});

// —— R13 批 S2：execute 条目的阶段流进度行 —— //

function executeRunningActionCardMessage(itemId: string): ConversationMessageVM {
  return baseMessage({
    kind: "action_card",
    sender_type: "cuu",
    sender_user_id: null,
    content: {
      card_id: "card-1",
      items: [{ id: itemId, kind: "execute", title_md: "重写第三节", confidence: "high", status: "running" }]
    }
  });
}

test("renderMessageHtml renders the four-stage progress row for an execute item whose run is still working, highlighting the current stage", () => {
  const html = renderMessageHtml(
    executeRunningActionCardMessage("i1"),
    ctxWith([], undefined, { actionCardRunProgress: new Map([["i1", { kind: "stage", stage: "work" }]]) })
  );
  assert.doesNotMatch(html, />进行中</u);
  assert.match(html, /<b style="color:var\(--ds-accent\)">干活<\/b>/u);
  assert.match(html, /认领/u);
  assert.match(html, /产出/u);
  assert.match(html, /提议/u);
});

test("renderMessageHtml renders the claim stage as current when the run hasn't started stepping yet", () => {
  const html = renderMessageHtml(
    executeRunningActionCardMessage("i1"),
    ctxWith([], undefined, { actionCardRunProgress: new Map([["i1", { kind: "stage", stage: "claim" }]]) })
  );
  assert.match(html, /<b style="color:var\(--ds-accent\)">认领<\/b>/u);
});

test("renderMessageHtml renders a distinct danger-colored terminal line for a failed execute item, replacing the stage row", () => {
  const html = renderMessageHtml(
    executeRunningActionCardMessage("i1"),
    ctxWith([], undefined, { actionCardRunProgress: new Map([["i1", { kind: "terminal", terminal: "failed" }]]) })
  );
  assert.match(html, /没干成/u);
  assert.match(html, /var\(--ds-danger\)/u);
  assert.doesNotMatch(html, /干活|产出|提议|认领/u);
});

test("renderMessageHtml renders a distinct warn-colored terminal line for an escalated execute item", () => {
  const html = renderMessageHtml(
    executeRunningActionCardMessage("i1"),
    ctxWith([], undefined, { actionCardRunProgress: new Map([["i1", { kind: "terminal", terminal: "escalated" }]]) })
  );
  assert.match(html, /已升级 · 等你拍板/u);
  assert.match(html, /var\(--ds-warn\)/u);
});

test("renderMessageHtml renders a success-colored terminal line for a succeeded execute item (propose stage)", () => {
  const html = renderMessageHtml(
    executeRunningActionCardMessage("i1"),
    ctxWith([], undefined, { actionCardRunProgress: new Map([["i1", { kind: "stage", stage: "propose" }]]) })
  );
  assert.match(html, /<b style="color:var\(--ds-accent\)">提议<\/b>/u);
});

test("renderMessageHtml falls back to the plain 进行中 label when no run progress is known for this item yet (honest, no fabricated story)", () => {
  const html = renderMessageHtml(executeRunningActionCardMessage("i1"), ctxWith([], undefined, { actionCardRunProgress: new Map() }));
  assert.match(html, />进行中</u);
});

test("renderMessageHtml falls back to the plain 进行中 label when actionCardRunProgress isn't wired up at all", () => {
  const html = renderMessageHtml(executeRunningActionCardMessage("i1"), ctxWith([]));
  assert.match(html, />进行中</u);
});

test("renderMessageHtml does not apply run progress to a decide item even when a matching id happens to be present", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [{ id: "i1", kind: "decide", title_md: "预算是否砍半", confidence: "low", status: "waiting_decision" }]
      }
    }),
    ctxWith([], undefined, { actionCardRunProgress: new Map([["i1", { kind: "stage", stage: "work" }]]) })
  );
  assert.match(html, />待拍板</u);
  assert.doesNotMatch(html, /干活/u);
});

test("renderMessageHtml leaves an action_card item without a recognized status label-free instead of inventing copy", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [{ id: "i1", kind: "execute", title_md: "重写第三节", confidence: "high", status: "some_future_status" }]
      }
    }),
    ctxWith([])
  );
  assert.match(html, /重写第三节/u);
  assert.doesNotMatch(html, /wh-wb-chat-actioncard-item-status/u);
});

test("renderMessageHtml escapes action_card item titles even when the item carries a status", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [{ id: "i1", kind: "execute", title_md: "<img src=x onerror=alert(1)>", confidence: "high", status: "undone" }]
      }
    }),
    ctxWith([])
  );
  assert.doesNotMatch(html, /<img/u);
  assert.match(html, /&lt;img/u);
});

// —— R12 P0-A1：行动卡条目的操作按钮（decide 三键 / execute 撤销 / 非本人纯文字） —— //

test("renderMessageHtml renders claim/reassign/defer buttons for a decide item assigned to the current user", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: { card_id: "card-1", items: [actionCardItem({ assignee_user_id: "me" })] }
    }),
    ctxWith([member({ user_id: "me", nickname: "张三" })], "me")
  );
  assert.match(html, /data-wb-chat-actioncard-decide="claim"/u);
  assert.match(html, /data-wb-chat-actioncard-reassign-toggle="i1"/u);
  assert.match(html, /data-wb-chat-actioncard-decide="defer"/u);
  assert.match(html, /交给我干/u);
  assert.match(html, /派给别人/u);
  assert.match(html, /先不动/u);
  // 未展开成员选择器时不渲染任何成员行。
  assert.doesNotMatch(html, /data-wb-chat-actioncard-reassign-to=/u);
});

test("renderMessageHtml renders a plain 等 @昵称 拍板 text (no buttons) for a decide item assigned to someone else", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: { card_id: "card-1", items: [actionCardItem({ assignee_user_id: "other" })] }
    }),
    ctxWith([member({ user_id: "other", nickname: "李四" })], "me")
  );
  assert.match(html, /等 @李四 拍板/u);
  // R14 批 CHAT：消息行现在带一条 hover 工具条（回复/五键反应/编辑/删除/置顶），每条非墓碑消息都有
  // <button>。这条断言的原意是「这个行动卡条目不摆决策/撤销/改派按钮」——收窄成只查行动卡动作
  // 属性，不再误伤新的消息级工具条（01-chat-design.md §5 点名批准的既有断言正当扩展）。
  assert.doesNotMatch(html, /data-wb-chat-actioncard-(decide|undo|reassign)/u);
});

test("renderMessageHtml falls back to 负责人 when the assignee's nickname can't be resolved", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: { card_id: "card-1", items: [actionCardItem({ assignee_user_id: "ghost" })] }
    }),
    ctxWith([], "me")
  );
  assert.match(html, /等 @负责人 拍板/u);
});

test("renderMessageHtml gives an unassigned decide item the same honest waiting text instead of a stray button", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: { card_id: "card-1", items: [actionCardItem({ assignee_user_id: null })] }
    }),
    ctxWith([], "me")
  );
  // R14 批 CHAT：消息行现在带一条 hover 工具条（回复/五键反应/编辑/删除/置顶），每条非墓碑消息都有
  // <button>。这条断言的原意是「这个行动卡条目不摆决策/撤销/改派按钮」——收窄成只查行动卡动作
  // 属性，不再误伤新的消息级工具条（01-chat-design.md §5 点名批准的既有断言正当扩展）。
  assert.doesNotMatch(html, /data-wb-chat-actioncard-(decide|undo|reassign)/u);
  assert.match(html, /等 @负责人 拍板/u);
});

test("renderMessageHtml renders no action row for a decide item that's already been claimed (status moved past waiting_decision)", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: { card_id: "card-1", items: [actionCardItem({ assignee_user_id: "me", status: "running" })] }
    }),
    ctxWith([], "me")
  );
  // R14 批 CHAT：消息行现在带一条 hover 工具条（回复/五键反应/编辑/删除/置顶），每条非墓碑消息都有
  // <button>。这条断言的原意是「这个行动卡条目不摆决策/撤销/改派按钮」——收窄成只查行动卡动作
  // 属性，不再误伤新的消息级工具条（01-chat-design.md §5 点名批准的既有断言正当扩展）。
  assert.doesNotMatch(html, /data-wb-chat-actioncard-(decide|undo|reassign)/u);
  assert.doesNotMatch(html, /拍板/u);
});

test("renderMessageHtml opens the reassign member picker when openReassignItemId matches, listing members other than self", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: { card_id: "card-1", items: [actionCardItem({ assignee_user_id: "me" })] }
    }),
    ctxWith(
      [member({ user_id: "me", nickname: "张三" }), member({ user_id: "other", nickname: "李四" })],
      "me",
      { openReassignItemId: "i1" }
    )
  );
  assert.match(html, /data-wb-chat-actioncard-reassign-to="other"/u);
  assert.match(html, /李四/u);
  // 自己不出现在"派给别人"的候选列表里——claim 已经覆盖那条路径。
  assert.doesNotMatch(html, /data-wb-chat-actioncard-reassign-to="me"/u);
});

test("renderMessageHtml shows an honest empty state in the reassign picker when there's no one else to pick", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: { card_id: "card-1", items: [actionCardItem({ assignee_user_id: "me" })] }
    }),
    ctxWith([member({ user_id: "me", nickname: "张三" })], "me", { openReassignItemId: "i1" })
  );
  assert.match(html, /没有其他成员可选/u);
});

test("renderMessageHtml renders an undo button with remaining minutes for a running execute item assigned to the current user within the undo window", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [
          actionCardItem({
            id: "i2",
            kind: "execute",
            status: "running",
            assignee_user_id: "me",
            undo_deadline_at: "2026-07-12T09:09:00.000Z"
          })
        ]
      }
    }),
    ctxWith([], "me", { now: new Date("2026-07-12T09:00:00.000Z") })
  );
  assert.match(html, /data-wb-chat-actioncard-undo="i2"/u);
  assert.match(html, /9 分钟内/u);
  assert.match(html, /wh-wb-act--danger/u);
});

test("renderMessageHtml renders no undo button once the undo window has passed", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [
          actionCardItem({
            id: "i2",
            kind: "execute",
            status: "running",
            assignee_user_id: "me",
            undo_deadline_at: "2026-07-12T08:59:00.000Z"
          })
        ]
      }
    }),
    ctxWith([], "me", { now: new Date("2026-07-12T09:00:00.000Z") })
  );
  // R14 批 CHAT：消息行现在带一条 hover 工具条（回复/五键反应/编辑/删除/置顶），每条非墓碑消息都有
  // <button>。这条断言的原意是「这个行动卡条目不摆决策/撤销/改派按钮」——收窄成只查行动卡动作
  // 属性，不再误伤新的消息级工具条（01-chat-design.md §5 点名批准的既有断言正当扩展）。
  assert.doesNotMatch(html, /data-wb-chat-actioncard-(decide|undo|reassign)/u);
});

test("renderMessageHtml renders no undo button for an execute item that's running but has no undo deadline", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [actionCardItem({ id: "i2", kind: "execute", status: "running", assignee_user_id: "me", undo_deadline_at: null })]
      }
    }),
    ctxWith([], "me")
  );
  // R14 批 CHAT：消息行现在带一条 hover 工具条（回复/五键反应/编辑/删除/置顶），每条非墓碑消息都有
  // <button>。这条断言的原意是「这个行动卡条目不摆决策/撤销/改派按钮」——收窄成只查行动卡动作
  // 属性，不再误伤新的消息级工具条（01-chat-design.md §5 点名批准的既有断言正当扩展）。
  assert.doesNotMatch(html, /data-wb-chat-actioncard-(decide|undo|reassign)/u);
});

test("renderMessageHtml renders no undo button for someone else's running execute item, even within the undo window", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [
          actionCardItem({
            id: "i2",
            kind: "execute",
            status: "running",
            assignee_user_id: "other",
            undo_deadline_at: "2026-07-12T09:09:00.000Z"
          })
        ]
      }
    }),
    ctxWith([], "me", { now: new Date("2026-07-12T09:00:00.000Z") })
  );
  // R14 批 CHAT：消息行现在带一条 hover 工具条（回复/五键反应/编辑/删除/置顶），每条非墓碑消息都有
  // <button>。这条断言的原意是「这个行动卡条目不摆决策/撤销/改派按钮」——收窄成只查行动卡动作
  // 属性，不再误伤新的消息级工具条（01-chat-design.md §5 点名批准的既有断言正当扩展）。
  assert.doesNotMatch(html, /data-wb-chat-actioncard-(decide|undo|reassign)/u);
});

test("renderMessageHtml never renders an action row for an undone item, even if it would otherwise qualify", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [
          actionCardItem({
            id: "i2",
            kind: "execute",
            status: "undone",
            assignee_user_id: "me",
            undo_deadline_at: "2026-07-12T09:09:00.000Z"
          })
        ]
      }
    }),
    ctxWith([], "me", { now: new Date("2026-07-12T09:00:00.000Z") })
  );
  // R14 批 CHAT：消息行现在带一条 hover 工具条（回复/五键反应/编辑/删除/置顶），每条非墓碑消息都有
  // <button>。这条断言的原意是「这个行动卡条目不摆决策/撤销/改派按钮」——收窄成只查行动卡动作
  // 属性，不再误伤新的消息级工具条（01-chat-design.md §5 点名批准的既有断言正当扩展）。
  assert.doesNotMatch(html, /data-wb-chat-actioncard-(decide|undo|reassign)/u);
  assert.match(html, /已撤销/u);
});

test("renderMessageHtml drops an item missing an id rather than rendering a button with no target", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [{ kind: "decide", title_md: "没有 id 的条目", confidence: "low", status: "waiting_decision", assignee_user_id: "me" }]
      }
    }),
    ctxWith([], "me")
  );
  // R14 批 CHAT：消息行现在带一条 hover 工具条（回复/五键反应/编辑/删除/置顶），每条非墓碑消息都有
  // <button>。这条断言的原意是「这个行动卡条目不摆决策/撤销/改派按钮」——收窄成只查行动卡动作
  // 属性，不再误伤新的消息级工具条（01-chat-design.md §5 点名批准的既有断言正当扩展）。
  assert.doesNotMatch(html, /data-wb-chat-actioncard-(decide|undo|reassign)/u);
  assert.doesNotMatch(html, /没有 id 的条目/u);
});

test("renderMessageHtml shows a mild inline error hint under the decide actions when actionCardItemErrors has an entry for that item", () => {
  const ctx = ctxWith([member({ user_id: "me", nickname: "张三" })], "me");
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: { card_id: "card-1", items: [actionCardItem({ assignee_user_id: "me" })] }
    }),
    { ...ctx, actionCardItemErrors: new Map([["i1", "这条已经被处理过了。"]]) }
  );
  assert.match(html, /这条已经被处理过了。/u);
});

test("renderMessageHtml shows the inline error hint under the execute/undo actions too, escaped", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: {
        card_id: "card-1",
        items: [
          actionCardItem({
            id: "i2",
            kind: "execute",
            status: "running",
            assignee_user_id: "me",
            undo_deadline_at: "2026-07-12T09:09:00.000Z"
          })
        ]
      }
    }),
    { ...ctxWith([], "me", { now: new Date("2026-07-12T09:00:00.000Z") }), actionCardItemErrors: new Map([["i2", "<b>x</b>"]]) }
  );
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/u);
  assert.doesNotMatch(html, /<b>x<\/b>/u);
});

test("renderMessageHtml renders no error hint for an item that isn't in actionCardItemErrors", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: { card_id: "card-1", items: [actionCardItem({ assignee_user_id: "me" })] }
    }),
    { ...ctxWith([], "me"), actionCardItemErrors: new Map([["some-other-item", "不相关的错误"]]) }
  );
  assert.doesNotMatch(html, /不相关的错误/u);
});

test("renderMessageHtml no longer renders the stale 后续批次接入 placeholder note", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "action_card",
      sender_type: "cuu",
      sender_user_id: null,
      content: { card_id: "card-1", items: [actionCardItem({ assignee_user_id: "me" })] }
    }),
    ctxWith([], "me")
  );
  assert.doesNotMatch(html, /后续批次接入/u);
});

test("renderMessageHtml gives tool_note a minimal, honest fallback label", () => {
  const html = renderMessageHtml(baseMessage({ kind: "tool_note", content: {} }), ctxWith([]));
  assert.match(html, /（一次工具调用）/u);
});

// —— pending outgoing (optimistic send) —— //

test("renderPendingOutgoingHtml shows a sending indicator and no retry affordance while in flight", () => {
  const html = renderPendingOutgoingHtml(
    { tempId: "t1", text: "hello", status: "sending" },
    ctxWith([], "me")
  );
  assert.match(html, /发送中/u);
  assert.doesNotMatch(html, /data-wb-chat-retry-pending/u);
  assert.match(html, /wh-wb-chat-msg--pending/u);
});

test("renderPendingOutgoingHtml shows a real retry affordance carrying the tempId once it fails", () => {
  const html = renderPendingOutgoingHtml(
    { tempId: "t1", text: "hello", status: "error" },
    ctxWith([], "me")
  );
  assert.match(html, /data-wb-chat-retry-pending="t1"/u);
  assert.match(html, /没发出去/u);
});

test("renderPendingOutgoingHtml renders a pending file attachment as a file card, not raw text", () => {
  const html = renderPendingOutgoingHtml(
    { tempId: "t2", fileName: "周报.xlsx", status: "sending" },
    ctxWith([], "me")
  );
  assert.match(html, /wh-wb-chat-filecard/u);
  assert.match(html, /周报\.xlsx/u);
  // 发送中的乐观渲染还没有服务端确认的 drive_item_id 归属——不给「点了但打不开预览」的假点击反馈。
  assert.doesNotMatch(html, /wh-wb-chat-filecard--live/u);
  assert.doesNotMatch(html, /data-wb-chat-open-file/u);
});

// —— typing —— //

test("renderTypingIndicatorHtml is empty when nobody is typing", () => {
  assert.equal(renderTypingIndicatorHtml([], "zh-CN"), "");
});

test("renderTypingIndicatorHtml names a single typer", () => {
  assert.match(renderTypingIndicatorHtml(["张三"], "zh-CN"), /张三 正在输入/u);
});

test("renderTypingIndicatorHtml joins multiple typers with a locale-appropriate separator", () => {
  assert.match(renderTypingIndicatorHtml(["张三", "阿曼"], "zh-CN"), /张三、阿曼 正在输入/u);
  assert.match(renderTypingIndicatorHtml(["Zhang", "Aman"], "en-US"), /Zhang, Aman are typing/u);
});

// —— R12（final-turns-wiring）：协同会话 turn 状态 —— //

test("renderCuuTurnPendingHtml reuses the typing indicator's class/dots but says Cuu is replying", () => {
  const html = renderCuuTurnPendingHtml("zh-CN");
  assert.match(html, /class="wh-wb-chat-typing"/u);
  assert.match(html, /wh-wb-chat-typing-dots/u);
  assert.match(html, /Cuu 正在回复/u);
});

test("renderCuuTurnPendingHtml has an English variant", () => {
  assert.match(renderCuuTurnPendingHtml("en-US"), /Cuu is replying/u);
});

test("renderCuuTurnErrorHtml renders the given gentle message, not a raw error code, and no alarming style hook", () => {
  const html = renderCuuTurnErrorHtml("Cuu 正忙着上一轮，等它说完再试。");
  assert.match(html, /Cuu 正忙着上一轮/u);
  assert.doesNotMatch(html, /conversation_turn_busy/u);
  assert.doesNotMatch(html, /wh-wb-chat-send-error/u);
});

test("renderCuuTurnErrorHtml escapes its message (defense in depth, even though the source is our own mapped copy)", () => {
  const html = renderCuuTurnErrorHtml("<script>bad</script>");
  assert.doesNotMatch(html, /<script>/u);
});

test("renderStreamingCuuBubbleHtml shows typing dots while there is no text yet", () => {
  const html = renderStreamingCuuBubbleHtml("", ctxWith([]));
  assert.match(html, /wh-wb-chat-typing-dots/u);
  assert.match(html, /wh-wb-chat-msg--cuu/u);
  assert.match(html, /wh-wb-chat-msg--pending/u);
});

test("renderStreamingCuuBubbleHtml renders the accumulated delta text once it arrives, escaped and newline-safe", () => {
  const html = renderStreamingCuuBubbleHtml("line one\nline two <b>", ctxWith([]));
  assert.match(html, /line one<br>line two &lt;b&gt;/u);
  assert.doesNotMatch(html, /<b>/u);
});

test("renderStreamingCuuBubbleHtml carries a stable marker attribute so view.ts can target it for removal", () => {
  assert.match(renderStreamingCuuBubbleHtml("hi", ctxWith([])), /data-wb-chat-streaming-cuu/u);
});

// —— connection banner —— //

test("renderConnectionBannerHtml shows nothing while the connection is healthy", () => {
  assert.equal(renderConnectionBannerHtml("open", "zh-CN"), "");
  assert.equal(renderConnectionBannerHtml("idle", "zh-CN"), "");
});

test("renderConnectionBannerHtml shows the 00 §9 reconnect banner copy exactly", () => {
  assert.match(renderConnectionBannerHtml("reconnect_scheduled", "zh-CN"), /连接中断，正在重连/u);
});

// —— R14 FIX#8 前端半：无 key 横幅 —— //

test("renderNoAiProviderBannerHtml names the DEPLOY.md remedy and marks itself with a stable data hook", () => {
  const html = renderNoAiProviderBannerHtml("zh-CN");
  assert.match(html, /data-wb-chat-no-ai-provider-banner="true"/u);
  assert.match(html, /DEPLOY\.md/u);
  assert.match(html, /AI 服务未配置/u);
  assert.match(html, /Cuu 不会回应/u);
});

test("renderNoAiProviderBannerHtml has an English copy too", () => {
  const html = renderNoAiProviderBannerHtml("en-US");
  // escapeHtml turns the apostrophe into &#39; — match around it rather than the literal glyph.
  assert.match(html, /AI service isn.{0,6}t configured/u);
  assert.match(html, /DEPLOY\.md/u);
});

// —— empty / loading / error / truncated —— //

test("renderChatEmptyStateHtml gives a Cuu-voiced onboarding line naming the project (00 §9 empty-state spec)", () => {
  const html = renderChatEmptyStateHtml({ locale: "zh-CN", projectName: "星尘短剧" });
  assert.match(html, /星尘短剧/u);
  assert.match(html, /Cuu/u);
});

test("renderHistoryLoadErrorHtml offers a real retry affordance", () => {
  assert.match(renderHistoryLoadErrorHtml("zh-CN"), /data-wb-chat-retry-history/u);
});

// R12 批8：00 §9「无权限项目」——深链到无权会话的温和空态。后端故意用非预言式 404（存在但无权 vs
// 真不存在同一响应），所以这里也不给一个只会一直失败的重试按钮——权限问题重试不会变好。
test("renderConversationAccessDeniedHtml gives a gentle you're-not-in-this-project message with no dead retry button", () => {
  const html = renderConversationAccessDeniedHtml("zh-CN");
  assert.match(html, /你不在这个项目里/u);
  assert.doesNotMatch(html, /data-wb-chat-retry-history/u);
});

test("renderConversationAccessDeniedHtml is available in en-US too", () => {
  const html = renderConversationAccessDeniedHtml("en-US");
  assert.match(html, /not in this project/u);
});

test("renderHistoryLoadingHtml is distinct from the error state", () => {
  assert.notEqual(renderHistoryLoadingHtml("zh-CN"), renderHistoryLoadErrorHtml("zh-CN"));
});

// —— R12 批8：加载更早（beforeSeq 反向翻页 + 本地 DOM 窗口展开） —— //

test("renderLoadEarlierHtml renders nothing when there is truly nothing earlier", () => {
  assert.equal(renderLoadEarlierHtml({ kind: "none" }, "zh-CN"), "");
});

test("renderLoadEarlierHtml offers an instant local-expand affordance naming the hidden count", () => {
  const html = renderLoadEarlierHtml({ kind: "local", hiddenCount: 42 }, "zh-CN");
  assert.match(html, /data-wb-chat-load-earlier/u);
  assert.match(html, /42/u);
});

test("renderLoadEarlierHtml shows a loading state while fetching an older page from the server", () => {
  const html = renderLoadEarlierHtml({ kind: "server-loading" }, "zh-CN");
  assert.match(html, /正在加载更早/u);
  assert.doesNotMatch(html, /data-wb-chat-load-earlier/u);
});

test("renderLoadEarlierHtml offers a real retry affordance after a failed older-page fetch", () => {
  const html = renderLoadEarlierHtml({ kind: "server-error" }, "zh-CN");
  assert.match(html, /data-wb-chat-load-earlier/u);
  assert.match(html, /没加载出/u);
});

test("renderLoadEarlierHtml offers an idle load-earlier button when the server still has more history", () => {
  const html = renderLoadEarlierHtml({ kind: "server-idle" }, "en-US");
  assert.match(html, /data-wb-chat-load-earlier/u);
  assert.match(html, /Load earlier/u);
});

// —— composer —— //

test("renderComposerHtml disables send when there is no text and no attachments", () => {
  const html = renderComposerHtml({ locale: "zh-CN", draftText: "", attachments: [], sending: false });
  assert.match(html, /data-wb-chat-send disabled/u);
});

test("renderComposerHtml enables send once there is text", () => {
  const html = renderComposerHtml({ locale: "zh-CN", draftText: "hi", attachments: [], sending: false });
  assert.doesNotMatch(html, /data-wb-chat-send disabled/u);
});

test("renderComposerHtml enables send with only a staged attachment and no text", () => {
  const html = renderComposerHtml({
    locale: "zh-CN",
    draftText: "",
    attachments: [{ driveItemId: "drive-1", name: "周报.xlsx" }],
    sending: false
  });
  assert.doesNotMatch(html, /data-wb-chat-send disabled/u);
  assert.match(html, /周报\.xlsx/u);
});

test("renderComposerHtml disables the textarea and send button while sending", () => {
  const html = renderComposerHtml({ locale: "zh-CN", draftText: "hi", attachments: [], sending: true });
  assert.match(html, /data-wb-chat-input disabled/u);
  assert.match(html, /data-wb-chat-send disabled/u);
});

test("renderComposerHtml shows a retry affordance when there is a send error", () => {
  const html = renderComposerHtml({ locale: "zh-CN", draftText: "hi", attachments: [], sending: false, sendError: "网络错误" });
  assert.match(html, /网络错误/u);
  assert.match(html, /data-wb-chat-retry-send/u);
});

// R13 批 P2（拍板链路收尾）："禁发+文案"——turn（协同会话对 Cuu 的一轮请求）进行中时发送按钮禁用，
// 但输入框保持可打字（不带 disabled），占位提示换成"Cuu 回完这条就好"。turnActive 结束后（省略这个
// 参数或显式传 false）行为完全恢复成升级前的样子——下面这条覆盖主区（永远不传 turnActive）不受影响。
test("renderComposerHtml disables send but keeps the textarea typable while a collab turn is active", () => {
  const html = renderComposerHtml({ locale: "zh-CN", draftText: "还有一件事", attachments: [], sending: false, turnActive: true });
  assert.match(html, /data-wb-chat-send disabled/u);
  assert.doesNotMatch(html, /data-wb-chat-input disabled/u);
  assert.match(html, /placeholder="Cuu 回完这条就好…"/u);
});

test("renderComposerHtml keeps send disabled while a turn is active even with an empty draft (not just re-deriving from text)", () => {
  const html = renderComposerHtml({ locale: "zh-CN", draftText: "", attachments: [], sending: false, turnActive: true });
  assert.match(html, /data-wb-chat-send disabled/u);
});

test("renderComposerHtml localizes the turn-active placeholder to English", () => {
  const html = renderComposerHtml({ locale: "en-US", draftText: "", attachments: [], sending: false, turnActive: true });
  assert.match(html, /Just a moment/u);
});

test("renderComposerHtml behaves exactly as before when turnActive is omitted (main conversation is unaffected)", () => {
  const withoutTurnActive = renderComposerHtml({ locale: "zh-CN", draftText: "hi", attachments: [], sending: false });
  const withExplicitFalse = renderComposerHtml({
    locale: "zh-CN",
    draftText: "hi",
    attachments: [],
    sending: false,
    turnActive: false
  });
  assert.doesNotMatch(withoutTurnActive, /data-wb-chat-send disabled/u);
  assert.equal(withoutTurnActive, withExplicitFalse);
});

// R14 批 CHAT：撤掉「/ 技能」灰 chip（01-chat-design.md §5 点名的顺路项——技能唤起归 SEARCH 批，不摆
// 点了没反应的假 affordance）。`#会话` 灰态保留；`/` chip 必须不再出现。这条断言从「# 和 / 都在」收窄成
// 「# 在、/ 不在」，属设计点名批准的既有断言修改。
test("renderComposerHtml keeps the # tag as not-yet-available but no longer renders the / skill tag", () => {
  const html = renderComposerHtml({ locale: "zh-CN", draftText: "", attachments: [], sending: false });
  assert.match(html, /data-wb-chat-tool-trigger="@"/u);
  assert.match(html, /wh-wb-chat-ctag--soon"[^>]*><b>#<\/b>/u);
  assert.doesNotMatch(html, /wh-wb-chat-ctag--soon"[^>]*><b>\/<\/b>/u);
  assert.doesNotMatch(html, /技能/u);
});

// —— pickers —— //

test("renderMentionPickerHtml lists real members and marks drive search as loading", () => {
  const html = renderMentionPickerHtml({
    locale: "zh-CN",
    members: [{ userId: "u1", nickname: "张三" }],
    files: [],
    filesLoading: true
  });
  assert.match(html, /张三/u);
  assert.match(html, /搜索中/u);
  assert.match(html, /data-wb-chat-pick-member="u1"/u);
});

test("renderMentionPickerHtml lists real drive search results with the drive item id as the chip payload", () => {
  const html = renderMentionPickerHtml({
    locale: "zh-CN",
    members: [],
    files: [{ itemId: "drive-9", name: "投放周报.xlsx" }],
    filesLoading: false
  });
  assert.match(html, /data-wb-chat-pick-file="drive-9"/u);
  assert.match(html, /投放周报\.xlsx/u);
});

test("renderMentionPickerHtml shows an honest empty state when nothing matches", () => {
  const html = renderMentionPickerHtml({ locale: "zh-CN", members: [], files: [], filesLoading: false });
  assert.match(html, /没有匹配结果/u);
});

test("renderComingSoonPickerHtml for # is clearly labeled coming-soon, not a live search box", () => {
  const html = renderComingSoonPickerHtml({ locale: "zh-CN", trigger: "#" });
  assert.match(html, /会话引用/u);
  assert.match(html, /即将上线/u);
  assert.match(html, /即将上线/u);
});

test("renderComingSoonPickerHtml for / is clearly labeled coming-soon", () => {
  const html = renderComingSoonPickerHtml({ locale: "zh-CN", trigger: "/" });
  assert.match(html, /技能唤起/u);
  assert.match(html, /即将上线/u);
});

// —— R12（模式五档弹层，仅协同会话 composer）—— //

test("renderComposerHtml renders no mode chip / mode markup when the caller omits modeChipHtml (main conversation)", () => {
  const html = renderComposerHtml({ locale: "zh-CN", draftText: "", attachments: [], sending: false });
  assert.doesNotMatch(html, /wh-wb-mode-chip/u);
  assert.doesNotMatch(html, /data-wb-chat-mode-toggle/u);
  // The mount point for the popover is always present (view.ts only ever writes into it for collab
  // conversations — see render.ts's renderComposerHtml doc comment), but it stays empty here.
  assert.match(html, /<div data-wb-chat-mode-pop-slot><\/div>/u);
});

test("renderComposerHtml embeds a caller-supplied mode chip in the composer tools row (collab conversation)", () => {
  const chip = renderModeChipHtml(3, "zh-CN");
  const html = renderComposerHtml({
    locale: "zh-CN",
    draftText: "",
    attachments: [],
    sending: false,
    modeChipHtml: chip
  });
  assert.match(html, /data-wb-chat-mode-toggle/u);
  assert.match(html, /分级自动/u);
});

test("renderModeChipHtml shows the honest 'Mode' fallback (not a guessed level) when the mode hasn't loaded yet", () => {
  const html = renderModeChipHtml(undefined, "zh-CN");
  assert.match(html, /模式/u);
  assert.doesNotMatch(html, /只观察|全部先问|分级自动|全自动|全托管/u);
});

test("renderModeChipHtml shows the compact level label for each of the five modes (zh-CN)", () => {
  assert.match(renderModeChipHtml(1, "zh-CN"), />只观察</u);
  assert.match(renderModeChipHtml(2, "zh-CN"), />全部先问</u);
  // The chip label for level 3 has no "(default)" suffix — that only appears in the popover's option
  // title, not the compact chip text (matches the prototype: setLvl()'s label argument vs. .lt text).
  assert.match(renderModeChipHtml(3, "zh-CN"), />分级自动</u);
  assert.doesNotMatch(renderModeChipHtml(3, "zh-CN"), /默认/u);
  assert.match(renderModeChipHtml(4, "zh-CN"), />全自动 · 人审</u);
  assert.match(renderModeChipHtml(5, "zh-CN"), />全托管 · AI 审</u);
});

test("renderModeChipHtml has an English label table too", () => {
  assert.match(renderModeChipHtml(1, "en-US"), />Observe only</u);
  assert.match(renderModeChipHtml(5, "en-US"), />Fully managed/u);
});

test("renderModeChipHtml applies the warn variant only for the fifth (fully-managed) level", () => {
  assert.doesNotMatch(renderModeChipHtml(4, "zh-CN"), /wh-wb-mode-chip--warn/u);
  assert.match(renderModeChipHtml(5, "zh-CN"), /wh-wb-mode-chip--warn/u);
});

test("renderModePopoverHtml renders all five levels with 1-5 shortcut numbers", () => {
  const html = renderModePopoverHtml({ mode: 3, locale: "zh-CN" });
  for (let level = 1; level <= 5; level += 1) {
    assert.match(html, new RegExp(`data-wb-chat-mode-option="${level}"[^>]*>`, "u"));
    assert.match(html, new RegExp(`wh-wb-mode-lvl-num">${level}<`, "u"));
  }
});

test("renderModePopoverHtml highlights the currently selected level and no other", () => {
  const html = renderModePopoverHtml({ mode: 2, locale: "zh-CN" });
  assert.match(html, /class="wh-wb-mode-lvl wh-wb-mode-lvl--on" data-wb-chat-mode-option="2"/u);
  const onCount = (html.match(/wh-wb-mode-lvl--on/gu) ?? []).length;
  assert.equal(onCount, 1);
  assert.doesNotMatch(html, /class="wh-wb-mode-lvl" data-wb-chat-mode-option="1"[^>]*wh-wb-mode-lvl--on/u);
});

test("renderModePopoverHtml renders no highlighted level when the current mode hasn't loaded", () => {
  const html = renderModePopoverHtml({ mode: undefined, locale: "zh-CN" });
  assert.doesNotMatch(html, /wh-wb-mode-lvl--on/u);
});

test("renderModePopoverHtml always marks the fifth level with the warn class, selected or not", () => {
  const notSelected = renderModePopoverHtml({ mode: 3, locale: "zh-CN" });
  const selected = renderModePopoverHtml({ mode: 5, locale: "zh-CN" });
  assert.match(notSelected, /class="wh-wb-mode-lvl wh-wb-mode-lvl--warn" data-wb-chat-mode-option="5"/u);
  assert.match(selected, /class="wh-wb-mode-lvl wh-wb-mode-lvl--on wh-wb-mode-lvl--warn" data-wb-chat-mode-option="5"/u);
});

test("renderModePopoverHtml includes the per-level descriptions from the interaction design table", () => {
  const html = renderModePopoverHtml({ mode: 3, locale: "zh-CN" });
  assert.match(html, /只总结讨论，不提出也不执行/u);
  assert.match(html, /提出方案，任何执行都等人点头/u);
  assert.match(html, /有把握的直接干\(可撤销\)；拿不准的先问你/u);
  assert.match(html, /拎出的事全都干，合并前仍由人审提议/u);
  assert.match(html, /AI 复核通过即自动合并；法务\/财务\/身份类永远升级给人/u);
  // Only the third level's option title carries the "(default)" suffix.
  assert.match(html, /分级自动\(默认\)/u);
});

test("renderModePopoverHtml states the server-issued model/key line and never implies a local API key", () => {
  const html = renderModePopoverHtml({ mode: 3, locale: "zh-CN" });
  assert.match(html, /服务端下发/u);
  assert.match(html, /桌面不保存任何 API key/u);
});

test("renderModePopoverHtml includes the granular-breakdown note as plain text, not a fake button", () => {
  const html = renderModePopoverHtml({ mode: 3, locale: "zh-CN" });
  assert.match(html, /按能力细分/u);
  // No data-* hook and no <button> wrapper — this line isn't wired to anything real yet, so it must
  // not look clickable (04 §4 rule 3: don't render an affordance with no real destination).
  assert.doesNotMatch(html, /<button[^>]*按能力细分/u);
});

test("renderModeObserveOnlyHintHtml warns that Cuu will not reply, before the user hits the 409", () => {
  const html = renderModeObserveOnlyHintHtml("zh-CN");
  assert.match(html, /只观察/u);
  assert.match(html, /不会回话/u);
});

test("modePatchFailedText / renderModeErrorHintHtml surface a gentle retry message without leaking codes", () => {
  const zh = modePatchFailedText("zh-CN");
  const en = modePatchFailedText("en-US");
  assert.match(zh, /再试一次/u);
  assert.match(en, /try again/u);
  const html = renderModeErrorHintHtml(zh);
  assert.match(html, /wh-wb-mode-hint--error/u);
  assert.match(html, /再试一次/u);
});

// —— R14 批 CHAT：presence 在线点 / hover 工具条 / 反应 / 编辑 / 墓碑 / 引用 / 置顶条 / 已读 —— //

test("avatarTileHtml adds a pure-CSS online dot only when online, never on Cuu, and never new text", () => {
  const on = avatarTileHtml({ label: "张三", id: "u1", online: true });
  const off = avatarTileHtml({ label: "张三", id: "u1" });
  const cuu = avatarTileHtml({ label: "Cuu", id: "cuu", variant: "cuu", online: true });
  assert.match(on, /wh-wb-chat-avatar-dot/u);
  assert.doesNotMatch(off, /wh-wb-chat-avatar-dot/u);
  assert.doesNotMatch(cuu, /wh-wb-chat-avatar-dot/u);
  // 在线态只用视觉点，绝不写「在线」文字（render.test.ts:80 同一红线的本意）。
  assert.doesNotMatch(on, /在线/u);
});

test("renderMemberBarHtml paints an online dot for online members only and still has no 在线 text", () => {
  const html = renderMemberBarHtml({
    members: [member({ user_id: "u1", nickname: "张三" }), member({ user_id: "u2", nickname: "阿曼" })],
    locale: "zh-CN",
    onlineUserIds: new Set(["u1"])
  });
  assert.equal((html.match(/wh-wb-chat-avatar-dot/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /在线/u);
});

test("renderMessageHtml renders a hover toolbar with reply + five reaction quick-adds for any message", () => {
  const html = renderMessageHtml(baseMessage({ sender_user_id: "other" }), ctxWith([], "me"));
  assert.match(html, /wh-wb-chat-tools/u);
  assert.match(html, /data-wb-chat-reply="m1"/u);
  assert.equal((html.match(/data-wb-chat-react="/gu) ?? []).length, 5);
  assert.match(html, /data-wb-chat-pin="m1"/u);
});

test("renderMessageHtml shows edit + delete in the toolbar for the current user's own text message, but not for others'", () => {
  const own = renderMessageHtml(baseMessage({ sender_user_id: "me" }), ctxWith([], "me"));
  const other = renderMessageHtml(baseMessage({ sender_user_id: "other" }), ctxWith([], "me"));
  assert.match(own, /data-wb-chat-edit="m1"/u);
  assert.match(own, /data-wb-chat-delete="m1"/u);
  assert.doesNotMatch(other, /data-wb-chat-edit=/u);
  assert.doesNotMatch(other, /data-wb-chat-delete=/u);
});

test("renderMessageHtml offers delete but not edit for the current user's own non-text (file_card) message", () => {
  const html = renderMessageHtml(
    baseMessage({ sender_user_id: "me", kind: "file_card", content: { drive_item_id: "d1", snapshot_name: "报告.xlsx" } }),
    ctxWith([], "me")
  );
  assert.match(html, /data-wb-chat-delete="m1"/u);
  assert.doesNotMatch(html, /data-wb-chat-edit=/u);
});

test("renderMessageHtml renders a reaction row only when there are reactions, highlighting my own", () => {
  const none = renderMessageHtml(baseMessage({ sender_user_id: "other" }), ctxWith([], "me"));
  assert.doesNotMatch(none, /wh-wb-chat-reactions/u);
  const withReactions = renderMessageHtml(
    baseMessage({ sender_user_id: "other", reactions: [{ key: "approve", user_ids: ["me", "other"] }, { key: "watch", user_ids: ["x"] }] }),
    ctxWith([], "me")
  );
  assert.match(withReactions, /wh-wb-chat-reactions/u);
  // approve 里有我 → own 高亮；watch 里没有我 → 普通态。
  assert.match(withReactions, /wh-wb-chat-reaction wh-wb-chat-reaction--mine[^"]*"[^>]*data-wb-chat-react="approve"/u);
  assert.match(withReactions, /data-wb-chat-react="approve"[^>]*aria-pressed="true"/u);
  assert.match(withReactions, /data-wb-chat-react="watch"[^>]*aria-pressed="false"/u);
  // 计数展示。
  assert.match(withReactions, /wh-wb-chat-reaction-count">2</u);
});

test("renderMessageHtml renders reaction emoji glyphs only in the reaction chip / toolbar (emoji live in render, not css)", () => {
  const html = renderMessageHtml(
    baseMessage({ sender_user_id: "other", reactions: [{ key: "approve", user_ids: ["x"] }] }),
    ctxWith([], "me")
  );
  assert.match(html, /👍/u);
});

test("renderMessageHtml shows an 已编辑 label once edited_at is set, not before", () => {
  const before = renderMessageHtml(baseMessage(), ctxWith([]));
  const after = renderMessageHtml(baseMessage({ edited_at: "2026-07-12T09:05:00.000000Z" }), ctxWith([]));
  assert.doesNotMatch(before, /已编辑/u);
  assert.match(after, /wh-wb-chat-edited">已编辑/u);
});

test("renderMessageHtml renders a tombstone placeholder with no avatar/toolbar/reactions once deleted_at is set", () => {
  const html = renderMessageHtml(
    baseMessage({ sender_user_id: "me", deleted_at: "2026-07-12T10:00:00.000000Z", content: { text: "" } }),
    ctxWith([], "me")
  );
  assert.match(html, /此消息已删除/u);
  assert.match(html, /data-wb-chat-message-id="m1"/u);
  assert.doesNotMatch(html, /wh-wb-chat-tools/u);
  assert.doesNotMatch(html, /wh-wb-chat-avatar/u);
  assert.doesNotMatch(html, /data-wb-chat-react/u);
});

test("renderMessageHtml renders a clickable reply reference above the bubble, with a jump target", () => {
  const html = renderMessageHtml(
    baseMessage({
      sender_user_id: "other",
      reply_to: { message_id: "m0", sender_type: "user", sender_user_id: "u1", preview_text: "原来那句话", deleted: false }
    }),
    ctxWith([member({ user_id: "u1", nickname: "李四" })], "me")
  );
  assert.match(html, /data-wb-chat-reply-jump="m0"/u);
  assert.match(html, /李四/u);
  assert.match(html, /原来那句话/u);
});

test("renderMessageHtml shows a deleted-original placeholder for a reply whose target was later deleted", () => {
  const html = renderMessageHtml(
    baseMessage({
      sender_user_id: "other",
      reply_to: { message_id: "m0", sender_type: "user", sender_user_id: "u1", preview_text: "", deleted: true }
    }),
    ctxWith([member({ user_id: "u1", nickname: "李四" })], "me")
  );
  assert.match(html, /data-wb-chat-reply-jump="m0"/u);
  assert.match(html, /原消息已删除/u);
});

test("renderMessageHtml renders an inline edit textarea (not the body) when editing this message", () => {
  const ctx: ChatRenderContext = { ...ctxWith([], "me"), editing: { messageId: "m1", draft: "改一半的内容" } };
  const html = renderMessageHtml(baseMessage({ sender_user_id: "me", content: { text: "原文" } }), ctx);
  assert.match(html, /data-wb-chat-edit-input/u);
  assert.match(html, /改一半的内容/u);
  assert.match(html, /data-wb-chat-edit-save="m1"/u);
  assert.match(html, /data-wb-chat-edit-cancel/u);
  // 编辑态不再摆 hover 工具条。
  assert.doesNotMatch(html, /wh-wb-chat-tools/u);
});

test("renderMessageHtml surfaces the edit error (e.g. 15-minute window) inside the edit box", () => {
  const ctx: ChatRenderContext = { ...ctxWith([], "me"), editing: { messageId: "m1", draft: "x", error: "改不了啦" } };
  const html = renderMessageHtml(baseMessage({ sender_user_id: "me" }), ctx);
  assert.match(html, /wh-wb-chat-edit-error">改不了啦/u);
});

test("renderMessageHtml swaps the toolbar for an inline delete confirm when confirming this message", () => {
  const ctx: ChatRenderContext = { ...ctxWith([], "me"), confirmDeleteMessageId: "m1" };
  const html = renderMessageHtml(baseMessage({ sender_user_id: "me" }), ctx);
  assert.match(html, /删除这条消息？/u);
  assert.match(html, /data-wb-chat-delete-confirm="m1"/u);
  assert.match(html, /data-wb-chat-delete-cancel/u);
});

// —— R14 批 FEEDBACK：Cuu 文字消息的「有用/没用」轻反馈 —— //

function cuuTextMessage(overrides: Partial<ConversationMessageVM> = {}): ConversationMessageVM {
  return {
    id: "m1",
    conversation_id: "conv-1",
    seq: 1,
    sender_type: "cuu",
    sender_user_id: null,
    kind: "text",
    content: { text: "看过了，整体不错" },
    thread_root_id: null,
    created_at: "2026-07-12T09:00:00.000000Z",
    ...overrides
  } as ConversationMessageVM;
}

test("renderMessageHtml renders the feedback toolbar tiles only for a Cuu text message, not for a human or non-text message", () => {
  const cuu = renderMessageHtml(cuuTextMessage(), ctxWith([], "me"));
  assert.match(cuu, /data-wb-chat-feedback="useful" data-wb-chat-feedback-msg="m1"/u);
  assert.match(cuu, /data-wb-chat-feedback="not_useful" data-wb-chat-feedback-msg="m1"/u);

  const human = renderMessageHtml(baseMessage({ sender_user_id: "other" }), ctxWith([], "me"));
  assert.doesNotMatch(human, /data-wb-chat-feedback=/u);

  const actionCard = renderMessageHtml(
    baseMessage({ kind: "action_card", sender_type: "cuu", sender_user_id: null, content: { card_id: "card-1", items: [] } }),
    ctxWith([], "me")
  );
  assert.doesNotMatch(actionCard, /data-wb-chat-feedback=/u);
});

test("renderMessageHtml renders the feedback tiles unselected (aria-pressed=false) when there is no judgement yet", () => {
  const html = renderMessageHtml(cuuTextMessage(), ctxWith([], "me"));
  assert.match(html, /data-wb-chat-feedback="useful"[^>]*aria-pressed="false"/u);
  assert.match(html, /data-wb-chat-feedback="not_useful"[^>]*aria-pressed="false"/u);
  assert.doesNotMatch(html, /wh-wb-chat-tool--fb-on-useful/u);
  assert.doesNotMatch(html, /wh-wb-chat-tool--fb-on-not-useful/u);
});

test("renderMessageHtml highlights exactly the matching feedback tile once judged", () => {
  const useful = renderMessageHtml(
    cuuTextMessage({ my_feedback: { verdict: "useful", updated_at: "2026-07-14T00:00:00.000000Z" } }),
    ctxWith([], "me")
  );
  assert.match(useful, /data-wb-chat-feedback="useful"[^>]*aria-pressed="true"/u);
  assert.match(useful, /data-wb-chat-feedback="not_useful"[^>]*aria-pressed="false"/u);
  assert.match(useful, /wh-wb-chat-tool--fb-on-useful/u);
  assert.doesNotMatch(useful, /wh-wb-chat-tool--fb-on-not-useful/u);
});

test("renderMessageHtml renders the ✓/✗ character glyphs, not emoji, for the feedback tiles", () => {
  const html = renderMessageHtml(cuuTextMessage(), ctxWith([], "me"));
  assert.match(html, /wh-wb-chat-fb-glyph">✓</u);
  assert.match(html, /wh-wb-chat-fb-glyph">✗</u);
});

test("renderMessageHtml renders a persistent feedback badge only once judged, coloured by verdict", () => {
  const none = renderMessageHtml(cuuTextMessage(), ctxWith([], "me"));
  assert.doesNotMatch(none, /wh-wb-chat-fb-badge/u);

  const useful = renderMessageHtml(
    cuuTextMessage({ my_feedback: { verdict: "useful", updated_at: "2026-07-14T00:00:00.000000Z" } }),
    ctxWith([], "me")
  );
  assert.match(useful, /wh-wb-chat-fb-badge wh-wb-chat-fb-badge--useful" data-wb-chat-feedback-note-toggle="m1">✓/u);

  const notUseful = renderMessageHtml(
    cuuTextMessage({ my_feedback: { verdict: "not_useful", updated_at: "2026-07-14T00:00:00.000000Z" } }),
    ctxWith([], "me")
  );
  assert.match(notUseful, /wh-wb-chat-fb-badge wh-wb-chat-fb-badge--not-useful" data-wb-chat-feedback-note-toggle="m1">✗/u);
});

test("renderMessageHtml never renders the feedback badge for a human sender, even if my_feedback were somehow present (defensive gate)", () => {
  const html = renderMessageHtml(
    baseMessage({ sender_user_id: "other", my_feedback: { verdict: "useful", updated_at: "2026-07-14T00:00:00.000000Z" } }),
    ctxWith([], "me")
  );
  assert.doesNotMatch(html, /wh-wb-chat-fb-badge/u);
  assert.doesNotMatch(html, /data-wb-chat-feedback=/u);
});

test("renderMessageHtml opens the note editor only for the message named in ctx.feedbackNoteEditor, with the draft prefilled", () => {
  const judged = cuuTextMessage({ id: "m1", my_feedback: { verdict: "useful", updated_at: "2026-07-14T00:00:00.000000Z" } });
  const other = cuuTextMessage({ id: "m2", my_feedback: { verdict: "useful", updated_at: "2026-07-14T00:00:00.000000Z" } });
  const ctx: ChatRenderContext = { ...ctxWith([], "me"), feedbackNoteEditor: { messageId: "m1", draft: "回复很到位" } };
  const openHtml = renderMessageHtml(judged, ctx);
  assert.match(openHtml, /data-wb-chat-feedback-note-input/u);
  assert.match(openHtml, /回复很到位/u);
  assert.match(openHtml, /data-wb-chat-feedback-note-save="m1"/u);
  assert.match(openHtml, /data-wb-chat-feedback-note-cancel/u);
  const closedHtml = renderMessageHtml(other, ctx);
  assert.doesNotMatch(closedHtml, /data-wb-chat-feedback-note-input/u);
});

test("renderMessageHtml surfaces a feedback note save error inside the note box", () => {
  const judged = cuuTextMessage({ my_feedback: { verdict: "useful", updated_at: "2026-07-14T00:00:00.000000Z" } });
  const ctx: ChatRenderContext = {
    ...ctxWith([], "me"),
    feedbackNoteEditor: { messageId: "m1", draft: "x", error: "备注太长了" }
  };
  const html = renderMessageHtml(judged, ctx);
  assert.match(html, /wh-wb-chat-edit-error">备注太长了/u);
});

test("renderMessageHtml renders no feedback affordance at all on a tombstoned message", () => {
  const html = renderMessageHtml(
    cuuTextMessage({ deleted_at: "2026-07-12T10:00:00.000000Z", content: { text: "" }, my_feedback: { verdict: "useful", updated_at: "2026-07-14T00:00:00.000000Z" } }),
    ctxWith([], "me")
  );
  assert.doesNotMatch(html, /data-wb-chat-feedback/u);
  assert.doesNotMatch(html, /wh-wb-chat-fb-badge/u);
});

// —— R14 批 FEEDBACK：行动卡条目的「有用/没用」轻反馈 —— //

function actionCardMessageWithItem(overrides: Partial<Record<string, unknown>> = {}): ConversationMessageVM {
  return baseMessage({
    kind: "action_card",
    sender_type: "cuu",
    sender_user_id: null,
    content: { card_id: "card-1", items: [actionCardItem({ status: "done", ...overrides })] }
  });
}

test("renderMessageHtml renders the action_card item feedback tile only for terminal (done/escalated) items", () => {
  const done = renderMessageHtml(actionCardMessageWithItem({ status: "done" }), ctxWith([]));
  assert.match(done, /data-wb-chat-actioncard-feedback="useful" data-wb-chat-actioncard-item="i1"/u);
  const escalated = renderMessageHtml(actionCardMessageWithItem({ status: "escalated" }), ctxWith([]));
  assert.match(escalated, /data-wb-chat-actioncard-feedback="useful" data-wb-chat-actioncard-item="i1"/u);
  const waiting = renderMessageHtml(actionCardMessageWithItem({ status: "waiting_decision" }), ctxWith([]));
  assert.doesNotMatch(waiting, /data-wb-chat-actioncard-feedback=/u);
  const running = renderMessageHtml(actionCardMessageWithItem({ status: "running" }), ctxWith([]));
  assert.doesNotMatch(running, /data-wb-chat-actioncard-feedback=/u);
});

test("renderMessageHtml never offers a feedback tile on an undone action_card item, even if it's otherwise 'done'", () => {
  const html = renderMessageHtml(actionCardMessageWithItem({ status: "undone" }), ctxWith([]));
  assert.doesNotMatch(html, /data-wb-chat-actioncard-feedback=/u);
});

test("renderMessageHtml highlights the matching action_card item feedback tile from content.items[i].feedback", () => {
  const html = renderMessageHtml(actionCardMessageWithItem({ status: "done", feedback: { verdict: "not_useful" } }), ctxWith([]));
  assert.match(html, /data-wb-chat-actioncard-feedback="useful"[^>]*aria-pressed="false"/u);
  assert.match(html, /data-wb-chat-actioncard-feedback="not_useful"[^>]*aria-pressed="true"/u);
  assert.match(html, /wh-wb-chat-actioncard-fb-tile--on-not-useful/u);
});

test("renderMessageHtml renders no note input for action_card item feedback (two-way tile only, no free text)", () => {
  const html = renderMessageHtml(actionCardMessageWithItem({ status: "done" }), ctxWith([]));
  assert.doesNotMatch(html, /data-wb-chat-actioncard-feedback-note/u);
});

test("renderPinBarHtml renders nothing with no pins, a collapsed head, and an expandable list", () => {
  const members = membersById([member({ user_id: "u1", nickname: "张三" })]);
  assert.equal(renderPinBarHtml({ pins: [], collapsed: false, locale: "zh-CN", members }), "");
  const pin = baseMessage({ id: "p1", sender_user_id: "u1", content: { text: "锁死这条" } });
  const collapsed = renderPinBarHtml({ pins: [pin], collapsed: true, locale: "zh-CN", members });
  assert.match(collapsed, /1 条置顶消息/u);
  assert.match(collapsed, /data-wb-chat-pinbar-toggle/u);
  assert.doesNotMatch(collapsed, /data-wb-chat-pin-jump/u);
  const open = renderPinBarHtml({ pins: [pin], collapsed: false, locale: "zh-CN", members });
  assert.match(open, /data-wb-chat-pin-jump="p1"/u);
  assert.match(open, /data-wb-chat-pin-remove="p1"/u);
  assert.match(open, /锁死这条/u);
});

test("renderUnreadDividerHtml / renderReadReceiptHtml / renderJumpToUnreadHtml render their honest markers", () => {
  assert.match(renderUnreadDividerHtml("zh-CN"), /以下是新消息/u);
  assert.match(renderReadReceiptHtml({ readCount: 1, total: 3, locale: "zh-CN" }), /已读 1\/3/u);
  assert.match(renderJumpToUnreadHtml("zh-CN"), /跳到未读/u);
  assert.match(renderJumpToUnreadHtml("zh-CN"), /data-wb-chat-jump-unread/u);
});

test("renderObserverAnalyzingHtml renders the 'Cuu is tidying up' indicator in the typing style", () => {
  const html = renderObserverAnalyzingHtml("zh-CN");
  assert.match(html, /Cuu 正在整理刚才的讨论/u);
  assert.match(html, /wh-wb-chat-typing/u);
});

test("renderComposerHtml renders a 'replying to' banner with a cancel control when replyingToLabel is set", () => {
  const withReply = renderComposerHtml({ locale: "zh-CN", draftText: "", attachments: [], sending: false, replyingToLabel: "李四" });
  assert.match(withReply, /正在回复 李四/u);
  assert.match(withReply, /data-wb-chat-cancel-reply/u);
  const without = renderComposerHtml({ locale: "zh-CN", draftText: "", attachments: [], sending: false });
  assert.doesNotMatch(without, /wh-wb-chat-reply-banner/u);
});

// —— R14 批 RISK：风险巡检 digest（risk_digest system_event）—— //

function riskDigestMessage(overrides: Partial<Record<string, unknown>> = {}): ConversationMessageVM {
  return baseMessage({
    id: "m-risk-1",
    kind: "system_event",
    sender_type: "cuu",
    sender_user_id: null,
    content: {
      event: "risk_digest",
      project_id: "project-1",
      summary: "今天巡检发现 3 项风险信号——2 项工单停滞、1 项临期未动工",
      stalled_count: 2,
      deadline_count: 1,
      cost_spike: false,
      target_url: "/projects/project-1",
      ...overrides
    }
  });
}

test("renderMessageHtml renders a risk_digest system_event as a collapsed card with the one-line PM summary by default", () => {
  const html = renderMessageHtml(riskDigestMessage(), ctxWith([]));
  assert.match(html, /wh-wb-risk-digest/u);
  assert.match(html, /今日风险巡检/u);
  assert.match(html, /2 项工单停滞、1 项临期未动工/u);
  assert.match(html, /data-wb-chat-expand-message="m-risk-1"/u);
  assert.doesNotMatch(html, /data-wb-chat-collapse-message/u);
  // 默认折叠——不铺开三节明细。
  assert.doesNotMatch(html, /wh-wb-risk-digest-list/u);
  assert.doesNotMatch(html, /wh-wb-chat-sysline"/u);
});

test("renderMessageHtml expands a risk_digest into per-signal sections once its id is in expandedMessageIds, with only the triggered signals shown (multi-signal case)", () => {
  const ctx: ChatRenderContext = { ...ctxWith([]), expandedMessageIds: new Set(["m-risk-1"]) };
  const html = renderMessageHtml(
    riskDigestMessage({ stalled_count: 2, deadline_count: 1, cost_spike: true }),
    ctx
  );
  assert.match(html, /wh-wb-risk-digest-list/u);
  assert.match(html, /工单停滞 · 2 项/u);
  assert.match(html, /临期未动工 · 1 项/u);
  assert.match(html, /项目成本异常放量/u);
  assert.match(html, /data-wb-chat-collapse-message="m-risk-1"/u);
  assert.doesNotMatch(html, /data-wb-chat-expand-message/u);
});

test("renderMessageHtml expands a risk_digest with a single triggered signal without inventing zero-count sections for the others", () => {
  const ctx: ChatRenderContext = { ...ctxWith([]), expandedMessageIds: new Set(["m-risk-1"]) };
  const html = renderMessageHtml(
    riskDigestMessage({
      summary: "今天巡检发现 1 项风险信号——1 项工单停滞",
      stalled_count: 1,
      deadline_count: 0,
      cost_spike: false
    }),
    ctx
  );
  assert.match(html, /工单停滞 · 1 项/u);
  assert.doesNotMatch(html, /临期未动工/u);
  assert.doesNotMatch(html, /成本异常放量/u);
});

test("renderMessageHtml falls back to the plain collapsed sysline for a risk_digest with a malformed/missing field (honest degrade, not a broken card)", () => {
  const missingCount = renderMessageHtml(
    riskDigestMessage({ stalled_count: "two" }),
    ctxWith([])
  );
  assert.match(missingCount, /wh-wb-chat-sysline"/u);
  assert.doesNotMatch(missingCount, /wh-wb-risk-digest/u);
  // The plain sysline still reads the summary field honestly.
  assert.match(missingCount, /2 项工单停滞、1 项临期未动工/u);

  const missingCostSpike = renderMessageHtml(
    riskDigestMessage({ cost_spike: undefined }),
    ctxWith([])
  );
  assert.match(missingCostSpike, /wh-wb-chat-sysline"/u);
  assert.doesNotMatch(missingCostSpike, /wh-wb-risk-digest/u);
});

test("renderMessageHtml does not mistake an unrelated system_event for a risk_digest just because it shares a field name", () => {
  const html = renderMessageHtml(
    baseMessage({
      kind: "system_event",
      sender_type: "system",
      sender_user_id: null,
      content: { event: "drive_version_restored", summary: "《报告.md》找回了旧版本", stalled_count: 3 }
    }),
    ctxWith([])
  );
  assert.match(html, /wh-wb-chat-sysline"/u);
  assert.doesNotMatch(html, /wh-wb-risk-digest/u);
});

// —— R14 批 PERF（§3 方案 B）：渲染输出的结构性哨兵 —— //
// 不断言绝对毫秒数（CI 硬件方差会 flaky，见 08-perf-design.md §3）——只断言"一份固定的混合消息窗口拼出来
// 的标签数不超过一个上限"，作为"有人把工具条从 10 个按钮涨到 50 个"或"折叠判断改坏导致长文本不再折叠"
// 这类会连带放大整窗渲染成本的结构性回归的哨兵。当前实测 300 条混合窗口 ≈ 9600 标签（设计 §1 基准表同量级），
// 15000 的上限留 ~1.5x 头寸；真实浏览器 parse+layout+paint 的综合成本只能真机验（§3 方案 C，本批不跑）。

function countHtmlTags(html: string): number {
  return (html.match(/<[a-zA-Z][^>]*>/gu) ?? []).length;
}

function syntheticWindowMessage(seq: number): ConversationMessageVM {
  const pick = seq % 3;
  if (pick === 0) {
    return baseMessage({
      id: `card-${seq}`,
      seq,
      sender_type: "cuu",
      sender_user_id: null,
      kind: "action_card",
      content: {
        card_id: `card-${seq}`,
        items: [
          actionCardItem({ id: `${seq}-a`, kind: "execute", title_md: "重写选题报告第三节", status: "running" }),
          actionCardItem({ id: `${seq}-b`, kind: "decide", title_md: "预算是否砍半", status: "waiting_decision" })
        ]
      }
    });
  }
  if (pick === 1) {
    return baseMessage({
      id: `file-${seq}`,
      seq,
      kind: "file_card",
      content: { drive_item_id: `d-${seq}`, snapshot_name: `投放周报 W${seq}.xlsx` }
    });
  }
  return baseMessage({
    id: `text-${seq}`,
    seq,
    sender_user_id: "user-1",
    content: { text: `第 ${seq} 条讨论 @张三 一些较长的正文，逼近真实气泡复杂度` },
    reactions: [{ key: "approve", user_ids: ["user-1"] }]
  });
}

test("a 300-message mixed render window stays under the structural tag-count ceiling (bloat sentinel)", () => {
  const ctx = ctxWith([member({ user_id: "user-1", nickname: "张三" })], "user-1");
  let html = "";
  for (let seq = 1; seq <= 300; seq += 1) {
    html += renderMessageHtml(syntheticWindowMessage(seq), ctx);
  }
  const tags = countHtmlTags(html);
  assert.ok(tags > 0, "sanity: the window actually rendered something");
  assert.ok(
    tags < 15000,
    `300 mixed messages rendered ${tags} tags — expected < 15000; a jump here means per-message render bloat`
  );
});

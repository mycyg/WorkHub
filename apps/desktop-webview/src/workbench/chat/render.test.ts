import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationMessageVM, WorkbenchPageVM } from "@workhub/contracts";

import {
  membersById,
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
  renderLoadEarlierHtml,
  renderMemberBarHtml,
  renderMentionPickerHtml,
  renderMessageHtml,
  renderPendingOutgoingHtml,
  renderStreamingCuuBubbleHtml,
  renderTypingIndicatorHtml,
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

function ctxWith(members: WorkbenchMemberVM[], currentUserId?: string): ChatRenderContext {
  return { locale: "zh-CN", members: membersById(members), currentUserId };
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
  // 等待人工确认——不是「已自动采纳」话术，也不假装有个能点的撤销/交给审核按钮。
  assert.match(html, /等待人工确认后采纳/u);
  assert.doesNotMatch(html, /已自动采纳/u);
  assert.doesNotMatch(html, /<button/u);
  assert.doesNotMatch(html, /wh-wb-chat-sysline"/u);
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

test("renderComposerHtml marks the # and / composer tags as not-yet-available, distinctly from the live @ tag", () => {
  const html = renderComposerHtml({ locale: "zh-CN", draftText: "", attachments: [], sending: false });
  assert.match(html, /data-wb-chat-tool-trigger="@"/u);
  assert.match(html, /wh-wb-chat-ctag--soon"[^>]*><b>#<\/b>/u);
  assert.match(html, /wh-wb-chat-ctag--soon"[^>]*><b>\/<\/b>/u);
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
  assert.match(html, /即将可用/u);
  assert.match(html, /批 4/u);
});

test("renderComingSoonPickerHtml for / is clearly labeled coming-soon", () => {
  const html = renderComingSoonPickerHtml({ locale: "zh-CN", trigger: "/" });
  assert.match(html, /技能唤起/u);
  assert.match(html, /即将可用/u);
});

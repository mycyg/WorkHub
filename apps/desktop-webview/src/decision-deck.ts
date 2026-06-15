// R7 P3 · 今日待办「决策卡牌」(桌面专属,液态玻璃)。
// 纯渲染:把 AttentionItem[] 渲染成一叠会飞走的玻璃卡(顶卡 + 最多 2 张 peek + Cuu 反应行 + 全清空态)。
// 卡上的动作按钮带 href + data-action-id,直接复用 browser.ts 既有 bindGoldPathNavigation 点击管线
// (审批 respond / 提议 review·merge),不需新交互代码;滑动手势是后续 polish。
// 不进共享 @workhub/ui;只在桌面注入,Web 与 web-live-route-smoke 不受影响。

import type { AttentionItem, WorkHubLocale } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

type DeckTagTone = "approval" | "choice" | "permission" | "handoff" | "info";

function tagToneForKind(kind: AttentionItem["kind"]): DeckTagTone {
  switch (kind) {
    case "approval":
    case "proposal_review":
      return "approval";
    case "clarification":
      return "choice";
    case "budget":
      return "permission";
    case "escalation":
      return "handoff";
    default:
      return "info";
  }
}

function tagLabel(tone: DeckTagTone, zh: boolean) {
  switch (tone) {
    case "approval":
      return zh ? "待审批" : "Approve";
    case "choice":
      return zh ? "帮我拿个主意" : "Pick one";
    case "permission":
      return zh ? "要你授权" : "Allow?";
    case "handoff":
      return zh ? "派给谁好" : "Assign";
    default:
      return zh ? "看一眼" : "Heads-up";
  }
}

const accentByTone: Record<DeckTagTone, string> = {
  approval: "linear-gradient(90deg,#7c83ff,#b57bff)",
  choice: "linear-gradient(90deg,#7c83ff,#34c79a)",
  permission: "linear-gradient(90deg,#34c79a,#5fd6a8)",
  handoff: "linear-gradient(90deg,#ff9bb0,#b57bff)",
  info: "linear-gradient(90deg,#b3abce,#c3bce0)"
};

function actionButtonClass(style: AttentionItem["actions"][number]["style"]) {
  if (style === "primary") {
    return "wh-deck-btn wh-deck-btn--primary";
  }
  if (style === "danger") {
    return "wh-deck-btn wh-deck-btn--danger";
  }
  if (style === "quiet") {
    return "wh-deck-btn wh-deck-btn--quiet";
  }
  return "wh-deck-btn";
}

function renderDeckAction(action: AttentionItem["actions"][number]) {
  const attrs = [
    `class="${actionButtonClass(action.style)} gl-press"`,
    `href="${escapeHtml(action.href)}"`,
    `data-action-id="${escapeHtml(action.id)}"`,
    `data-deck-action="${escapeHtml(action.id)}"`,
    action.method ? `data-method="${escapeHtml(action.method)}"` : "",
    action.requires_reason ? "data-requires-reason=\"true\"" : "",
    action.requires_desktop ? "data-requires-desktop=\"true\"" : ""
  ].filter(Boolean).join(" ");
  return `<a ${attrs}>${escapeHtml(action.label)}</a>`;
}

function doneState(zh: boolean) {
  return `<div class="wh-deck" data-deck-empty="true">
    <div class="wh-deck-done">
      <div class="wh-deck-done-face gl-avatar">٩(◜◡◝)۶</div>
      <h3 class="wh-deck-done-title">${zh ? "全部搞定啦！" : "All clear!"}</h3>
      <p class="wh-deck-done-sub">${zh ? "今天也辛苦你啦～有要你拍板的，Cuu 会第一时间端过来 (=^･ω･^=)" : "Nice work today — Cuu will bring the next call straight to you (=^･ω･^=)"}</p>
    </div>
  </div>`;
}

export function renderDecisionDeckHtml(input: {
  items: AttentionItem[];
  locale: WorkHubLocale;
  cuuLine?: string;
}): string {
  const zh = input.locale === "zh-CN";
  const items = input.items;
  if (items.length === 0) {
    return doneState(zh);
  }
  const top = items[0]!;
  const tone = tagToneForKind(top.kind);
  const remaining = items.length;
  const showPeek1 = items.length >= 2;
  const showPeek2 = items.length >= 3;
  const body = top.reason_text ?? top.summary_text;
  const cuuLine = input.cuuLine ?? (zh ? "这件你定了我就接着跑 (=^･ω･^=)" : "Call it and I'll run with it (=^･ω･^=)");
  return `<div class="wh-deck" data-deck-count="${items.length}">
    <div class="wh-deck-stack">
      ${showPeek2 ? "<div class=\"wh-deck-peek wh-deck-peek2\" aria-hidden=\"true\"></div>" : ""}
      ${showPeek1 ? "<div class=\"wh-deck-peek wh-deck-peek1\" aria-hidden=\"true\"></div>" : ""}
      <article class="wh-deck-card" data-deck-card-id="${escapeHtml(top.id)}" data-deck-tone="${tone}">
        <div class="wh-deck-accent" style="background:${accentByTone[tone]}"></div>
        <div class="wh-deck-cardbody">
          <div class="wh-deck-tagrow">
            <span class="wh-deck-tag wh-deck-tag--${tone}">${escapeHtml(tagLabel(tone, zh))}</span>
            <span class="wh-deck-count">${zh ? "待办" : "To do"} <b>${remaining}</b></span>
          </div>
          <h3 class="wh-deck-title">${escapeHtml(top.title)}</h3>
          <p class="wh-deck-desc">${escapeHtml(body)}</p>
          <div class="wh-deck-actions">${top.actions.map(renderDeckAction).join("")}</div>
        </div>
      </article>
    </div>
    <div class="wh-deck-cuu"><span class="wh-deck-cuu-face gl-avatar">(=^･ω･^=)</span><span class="wh-deck-cuu-line">${escapeHtml(cuuLine)}</span></div>
  </div>`;
}

// 决策卡牌液态玻璃样式(桌面注入)。
export const decisionDeckCss = [
  ".wh-deck{max-width:600px;margin:0 auto;font-family:'M PLUS Rounded 1c','Noto Sans SC',sans-serif}",
  ".wh-deck-stack{position:relative;min-height:240px}",
  ".wh-deck-peek{position:absolute;left:0;right:0;top:0;height:100%;border-radius:24px;border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.4);box-shadow:0 18px 40px -26px rgba(70,54,140,.4)}",
  ".wh-deck-peek1{transform:translateY(11px) scale(.95);transform-origin:top center;z-index:2}",
  ".wh-deck-peek2{transform:translateY(22px) scale(.9);transform-origin:top center;background:rgba(255,255,255,.32);z-index:1}",
  ".wh-deck-card{position:relative;z-index:3;border-radius:24px;overflow:hidden;background:rgba(255,255,255,.6);backdrop-filter:blur(34px) saturate(185%);-webkit-backdrop-filter:blur(34px) saturate(185%);border:1px solid rgba(255,255,255,.8);box-shadow:0 30px 66px -28px rgba(70,54,140,.6),inset 0 1px 0 rgba(255,255,255,.8)}",
  ".wh-deck-accent{height:5px}",
  ".wh-deck-cardbody{padding:22px 24px 24px}",
  ".wh-deck-tagrow{display:flex;align-items:center;justify-content:space-between;gap:8px}",
  ".wh-deck-tag{font:800 11px/1 'M PLUS Rounded 1c','Noto Sans SC',sans-serif;color:#5a45d8;background:rgba(124,131,255,.16);border-radius:8px;padding:5px 9px}",
  ".wh-deck-tag--permission{color:#1faf86;background:rgba(52,199,154,.16)}",
  ".wh-deck-tag--handoff{color:#c4567f;background:rgba(255,155,176,.2)}",
  ".wh-deck-tag--info{color:#6b6488;background:rgba(255,255,255,.6)}",
  ".wh-deck-count{font:800 12px/1 'M PLUS Rounded 1c','Noto Sans SC',sans-serif;color:#8b84ad}.wh-deck-count b{color:#7c83ff;font-size:15px}",
  ".wh-deck-title{margin:15px 0 0;font-size:19px;line-height:1.4;font-weight:800;color:#2c2746;overflow-wrap:anywhere}",
  ".wh-deck-desc{margin:13px 0 0;font-size:14px;line-height:1.6;color:#5d567e;overflow-wrap:anywhere}",
  ".wh-deck-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}",
  ".wh-deck-btn{border:1px solid rgba(255,255,255,.8);border-radius:14px;background:rgba(255,255,255,.5);color:#5d567e;font:700 14px/1 'Noto Sans SC',sans-serif;padding:13px 16px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}",
  ".wh-deck-btn--primary{flex:1;min-width:120px;justify-content:center;border:0;background:linear-gradient(135deg,#7c83ff,#b57bff);color:#fff;font-weight:800;box-shadow:0 14px 26px -8px rgba(124,131,255,.7)}",
  ".wh-deck-btn--danger{border-color:rgba(255,122,138,.5);color:#e85d70;font-weight:800}",
  ".wh-deck-btn--quiet{background:rgba(255,255,255,.4);color:#8b84ad}",
  ".wh-deck-cuu{display:flex;align-items:center;gap:12px;justify-content:center;margin-top:26px}",
  ".wh-deck-cuu-face{font:700 22px/1 'M PLUS Rounded 1c',sans-serif}",
  ".wh-deck-cuu-line{font:700 13.5px/1.4 'Noto Sans SC',sans-serif;color:#6b6488;background:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.7);border-radius:14px;border-bottom-left-radius:4px;padding:9px 14px}",
  ".wh-deck-done{max-width:560px;margin:8px auto 0;border-radius:24px;padding:46px 30px;text-align:center;background:rgba(255,255,255,.5);backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%);border:1px solid rgba(255,255,255,.75);box-shadow:0 26px 60px -28px rgba(70,54,140,.5),inset 0 1px 0 rgba(255,255,255,.7)}",
  ".wh-deck-done-face{font:700 34px/1 'M PLUS Rounded 1c',sans-serif}",
  ".wh-deck-done-title{margin:18px 0 0;font-size:21px;font-weight:900;color:#2c2746}",
  ".wh-deck-done-sub{margin:10px 0 0;font-size:14px;line-height:1.6;color:#6b6488}"
].join("");

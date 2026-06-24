// R7 P3 · 今日待办「决策卡牌」(桌面专属,液态玻璃)。
// 纯渲染:把 AttentionItem[] 渲染成一叠会飞走的玻璃卡(顶卡 + 最多 2 张 peek + Cuu 反应行 + 全清空态)。
// 卡上的动作按钮带 href + data-action-id,直接复用 browser.ts 既有 bindGoldPathNavigation 点击管线
// (审批 respond / 提议 review·merge),不需新交互代码;滑动手势是后续 polish。
// 不进共享 @workhub/ui;只在桌面注入,Web 与 web-live-route-smoke 不受影响。

import type { AiWorklogVM, AttentionItem, WorkHubLocale } from "@workhub/contracts";
import { escapeHtml, safeHref } from "@workhub/web-runtime";

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
    `href="${escapeHtml(safeHref(action.href))}"`,
    `data-action-id="${escapeHtml(action.id)}"`,
    `data-deck-action="${escapeHtml(action.id)}"`,
    action.method ? `data-method="${escapeHtml(action.method)}"` : "",
    action.requires_reason ? "data-requires-reason=\"true\"" : "",
    action.requires_desktop ? "data-requires-desktop=\"true\"" : ""
  ].filter(Boolean).join(" ");
  return `<a ${attrs}>${escapeHtml(action.label)}</a>`;
}

// R7 P3:卡牌底部「Cuu 正在干 N 件活」条——展示在跑的后台 AI(running/queued),只读,信息性。
type DeckBackgroundRun = { run_id: string; work_item_id?: string | undefined; title: string; state: string; preview_text: string };

function backgroundRunsFooter(runs: DeckBackgroundRun[], zh: boolean): string {
  const active = runs.filter((run) => run.state === "running" || run.state === "queued");
  if (active.length === 0) {
    return "";
  }
  const chips = active.slice(0, 3)
    .map((run) => `<span class="wh-deck-run"><span class="wh-deck-run-dot"></span><span class="wh-deck-run-title">${escapeHtml(run.title)}</span></span>`)
    .join("");
  const more = active.length > 3 ? `<span class="wh-deck-run-more">+${active.length - 3}</span>` : "";
  const label = zh ? `Cuu 正在干 ${active.length} 件活` : `Cuu is on ${active.length} task${active.length > 1 ? "s" : ""}`;
  return `<div class="wh-deck-runs"><span class="wh-deck-runs-label"><span class="wh-deck-runs-spark gl-avatar">(=ΦωΦ=)</span>${label}</span><div class="wh-deck-runs-list">${chips}${more}</div></div>`;
}

function doneState(zh: boolean, footer: string, worklogStrip: string) {
  return `<div class="wh-deck" data-deck-empty="true">
    ${worklogStrip}
    <div class="wh-deck-done">
      <div class="wh-deck-done-face gl-avatar">٩(◜◡◝)۶</div>
      <h3 class="wh-deck-done-title">${zh ? "全部搞定啦！" : "All clear!"}</h3>
      <p class="wh-deck-done-sub">${zh ? "今天也辛苦你啦～有要你拍板的，Cuu 会第一时间端过来 (=^･ω･^=)" : "Nice work today — Cuu will bring the next call straight to you (=^･ω･^=)"}</p>
    </div>
    ${footer}
  </div>`;
}

// 今日 AI 战绩条(与 web 首页横幅对齐:干活 + 自主率 + 约省 + R8 自进化「技能 +X · 精修 Y」)。无数据不渲染。
function worklogStripHtml(worklog: AiWorklogVM | undefined, zh: boolean): string {
  if (!worklog) {
    return "";
  }
  const selfEvolved = worklog.skills_promoted_today + worklog.skills_refined_today;
  const evolve = selfEvolved > 0
    ? `<span class="wh-deck-worklog-evolve" data-deck-self-evolve="true" data-deck-skills-promoted="${escapeHtml(String(worklog.skills_promoted_today))}" data-deck-skills-refined="${escapeHtml(String(worklog.skills_refined_today))}">${escapeHtml(zh ? `· 自我精进 技能 +${worklog.skills_promoted_today} · 精修 ${worklog.skills_refined_today}` : `· leveled up: skills +${worklog.skills_promoted_today} · refined ${worklog.skills_refined_today}`)}</span>`
    : "";
  const main = zh
    ? `今天我替你扛了 <b>${worklog.accepted_today}</b> 件 · 自主率 <b>${worklog.autonomy_rate}%</b> · 约省 <b>${worklog.saved_hours_estimate}</b> 小时`
    : `AI handled <b>${worklog.accepted_today}</b> today · autonomy <b>${worklog.autonomy_rate}%</b> · saved ≈ <b>${worklog.saved_hours_estimate}</b>h`;
  return `<div class="wh-deck-worklog" data-deck-worklog="true"><span class="wh-deck-worklog-cat gl-avatar">(=^･ω･^=)</span><span class="wh-deck-worklog-text">${main} ${evolve}</span></div>`;
}

export function renderDecisionDeckHtml(input: {
  items: AttentionItem[];
  locale: WorkHubLocale;
  cuuLine?: string;
  backgroundRuns?: DeckBackgroundRun[];
  worklog?: AiWorklogVM;
}): string {
  const zh = input.locale === "zh-CN";
  const items = input.items;
  const footer = backgroundRunsFooter(input.backgroundRuns ?? [], zh);
  const worklogStrip = worklogStripHtml(input.worklog, zh);
  if (items.length === 0) {
    return doneState(zh, footer, worklogStrip);
  }
  const top = items[0]!;
  const tone = tagToneForKind(top.kind);
  const remaining = items.length;
  const showPeek1 = items.length >= 2;
  const showPeek2 = items.length >= 3;
  const body = top.reason_text ?? top.summary_text;
  const cuuLine = input.cuuLine ?? (zh ? "这件你定了我就接着跑 (=^･ω･^=)" : "Call it and I'll run with it (=^･ω･^=)");
  return `<div class="wh-deck" data-deck-count="${items.length}">
    ${worklogStrip}
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
    ${footer}
  </div>`;
}

// 决策卡牌液态玻璃样式(桌面注入)。
export const decisionDeckCss = [
  ".wh-deck{max-width:600px;margin:0 auto;font-family:'M PLUS Rounded 1c','Noto Sans SC',sans-serif}",
  ".wh-deck-worklog{display:flex;align-items:center;gap:10px;max-width:600px;margin:0 auto 16px;border-radius:16px;padding:11px 16px;background:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.7);backdrop-filter:blur(24px) saturate(165%);-webkit-backdrop-filter:blur(24px) saturate(165%);box-shadow:inset 0 1px 0 rgba(255,255,255,.6)}",
  ".wh-deck-worklog-cat{font:700 18px/1 'M PLUS Rounded 1c',sans-serif;flex:0 0 auto}",
  ".wh-deck-worklog-text{font:700 13px/1.5 'Noto Sans SC',sans-serif;color:#6b6488;overflow-wrap:anywhere}.wh-deck-worklog-text b{color:#5a45d8;font-weight:900}",
  ".wh-deck-worklog-evolve{color:#1faf86}",
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
  // M10：决策按钮要有苹果级悬浮/按压触感（之前完全没反馈）。
  ".wh-deck-btn{transition:transform 120ms cubic-bezier(.34,1.56,.64,1),filter 120ms ease,box-shadow 120ms ease}",
  ".wh-deck-btn:hover{filter:brightness(1.04)}",
  ".wh-deck-btn:active{transform:scale(.96)}",
  // M9：gl-press / gl-avatar 此前全局未定义（死类，毫无效果）。在此补上按压缩放 + 头像微动基底。
  ".gl-press{transition:transform 120ms cubic-bezier(.34,1.56,.64,1)}",
  ".gl-press:active{transform:scale(.95)}",
  ".gl-avatar{display:inline-block;will-change:transform}",
  // M8：决策卡/空态卡此前是硬 DOM swap 出现（无任何过渡），对挑剔的苹果用户是最扎眼的缺口。
  // 给卡片一个克制的「升起淡入 + 微缩放」spring-out 入场，让新决策像活的玻璃卡浮现而非页面重排。
  "@keyframes wh-deck-card-in{from{opacity:0;transform:translateY(12px) scale(.984)}to{opacity:1;transform:none}}",
  ".wh-deck-card,.wh-deck-done{animation:wh-deck-card-in .42s cubic-bezier(.22,1,.36,1) both}",
  "@media (prefers-reduced-motion:reduce){.wh-deck-btn,.gl-press{transition-duration:.01ms!important}.wh-deck-btn:active,.gl-press:active{transform:none}.wh-deck-card,.wh-deck-done{animation:none!important}}",
  ".wh-deck-cuu{display:flex;align-items:center;gap:12px;justify-content:center;margin-top:26px}",
  ".wh-deck-cuu-face{font:700 22px/1 'M PLUS Rounded 1c',sans-serif}",
  ".wh-deck-cuu-line{font:700 13.5px/1.4 'Noto Sans SC',sans-serif;color:#6b6488;background:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.7);border-radius:14px;border-bottom-left-radius:4px;padding:9px 14px}",
  ".wh-deck-done{max-width:560px;margin:8px auto 0;border-radius:24px;padding:46px 30px;text-align:center;background:rgba(255,255,255,.5);backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%);border:1px solid rgba(255,255,255,.75);box-shadow:0 26px 60px -28px rgba(70,54,140,.5),inset 0 1px 0 rgba(255,255,255,.7)}",
  ".wh-deck-done-face{font:700 34px/1 'M PLUS Rounded 1c',sans-serif}",
  ".wh-deck-done-title{margin:18px 0 0;font-size:21px;font-weight:900;color:#2c2746}",
  ".wh-deck-done-sub{margin:10px 0 0;font-size:14px;line-height:1.6;color:#6b6488}",
  ".wh-deck-runs{margin:22px auto 0;max-width:600px;border-radius:16px;padding:13px 16px;background:rgba(255,255,255,.42);border:1px solid rgba(255,255,255,.6);backdrop-filter:blur(24px) saturate(160%);-webkit-backdrop-filter:blur(24px) saturate(160%);box-shadow:inset 0 1px 0 rgba(255,255,255,.6)}",
  ".wh-deck-runs-label{display:flex;align-items:center;gap:8px;font:800 12px/1 'M PLUS Rounded 1c','Noto Sans SC',sans-serif;color:#6b6488}",
  ".wh-deck-runs-spark{font-size:15px}",
  ".wh-deck-runs-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}",
  ".wh-deck-run{display:inline-flex;align-items:center;gap:7px;max-width:100%;font:700 12px/1.3 'Noto Sans SC',sans-serif;color:#5d567e;background:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.7);border-radius:10px;padding:6px 10px}",
  ".wh-deck-run-dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:linear-gradient(135deg,#7c83ff,#34c79a);box-shadow:0 0 0 3px rgba(124,131,255,.16)}",
  ".wh-deck-run-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}",
  ".wh-deck-run-more{display:inline-flex;align-items:center;font:800 12px/1 'M PLUS Rounded 1c',sans-serif;color:#8b84ad;padding:6px 8px}"
].join("");

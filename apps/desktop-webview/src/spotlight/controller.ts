// WorkHub 桌面 · Spotlight 控制器：把一个会生长的玻璃盒挂进主窗，就是整个 app。
// launcher（能力网格/搜索）↔ capability（能力内联页）在同一个盒子里 morph；选能力只切状态、不碰 hash。
// 每次渲染后测量内容高度 → 通过 resize 回调缩放原生窗口（盒子随内容生长/收缩，苹果聚焦风）。

import { escapeHtml } from "@workhub/web-runtime";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

import {
  ASK_CUU_MIN_QUERY_LENGTH,
  askCuuReducer,
  buildAskCuuRequestPayload,
  decideAskCuuPresentation,
  initialAskCuuState,
  renderAskCuuAnswerHtml,
  type AskCuuPresentation,
  type AskCuuResult,
  type AskCuuUiState
} from "./ask-cuu.js";
import { commandRegistry, type CommandId, type CommandMatch } from "../command-palette.js";
import { renderWorkHubLiquidGlassLayer, scheduleWorkHubLiquidGlassFilterRebuild } from "../liquid-glass-filter.js";
import { noAiProviderConfiguredText } from "../ai-provider-banner-copy.js";
import { desktopConnectionBannerText } from "../connection-banner-copy.js";
import { resolveDesktopTauriInvoke } from "../desktop-window-controls.js";
import { applyGlassAlphaOverride, readGlassAlphaSource } from "../desktop-glass-alpha.js";
import type { DesktopShellConnectionChangedPayload } from "../shell-events.js";
import { stashPendingWorkbenchDeepLink } from "../workbench/pending-deep-link.js";
import { resolveCapabilityView } from "./registry.js";
import {
  initialSpotlightState,
  launcherMatches,
  openCapabilityId,
  spotlightReducer,
  topMatchId,
  type SpotlightState
} from "./state.js";
import type { SpotlightApiClient, SpotlightTarget, SpotlightViewContext } from "./view-context.js";

export type SpotlightResizeFn = (width: number, height: number) => void;
export type SpotlightManualDragFn = (deltaX: number, deltaY: number) => void;

export type MountSpotlightInput = {
  host: HTMLElement;
  client: SpotlightApiClient;
  locale: WorkHubLocale;
  // 角标（如 approvals: 待办数）。可后续更新。
  badges?: Partial<Record<CommandId, number>>;
  // 缩放原生窗口（browser.ts 注入 → invoke set_spotlight_size）。浏览器开发态可为空（no-op）。
  resize?: SpotlightResizeFn;
  // 顶栏拖动/边缘缩放（browser.ts 注入 → 原生 frameless 窗口手势）。浏览器开发态可为空（no-op）。
  drag?: () => void;
  dragMove?: SpotlightManualDragFn;
  // 关闭/隐藏盒子（browser.ts 注入 → invoke hide_main_window）。M2：让 launcher 顶层 Esc 真正关闭盒子，
  // 兑现 hello 卡「Esc 关闭」的承诺。浏览器开发态可为空（no-op）。
  dismiss?: () => void;
  // 能力页写动作成功后通知壳层刷新外部入口（角标、桌宠卡片等）。
  onActionSettled?: () => void;
  // R24 S6（E-10）：首次登录（browser.ts 据 desktop-first-run.ts 的 isDesktopFirstRun 判定）→ launcher
  // 空查询时不落空网格，落一张「建你的第一个项目」引导卡；非首次/已建过项目 → 保持现有启动器。
  firstRun?: boolean;
  // 引导卡建好项目后调用（browser.ts 落 markDesktopOnboarded）——同一次会话内立刻回落到普通启动器，
  // 不需要 reload 才能摆脱这张卡。
  onFirstRunComplete?: () => void;
  // R24 S6（E-11）：health.ai_provider_configured 的探测结果。false 才在盒子顶部渲横幅；true/未知
  // （health 探测失败，见 browser.ts bootSpotlight 的 best-effort 取舍）都不渲——探测失败不是「没配置」。
  aiProviderConfigured?: boolean;
};

export type SpotlightHandle = {
  // 外部（如 Cuu 决策信箱点击、托盘/深链）请求打开某能力，可带目标实体 id（让目标 view 直接展开该项）。
  openCapability: (id: CommandId, target?: SpotlightTarget) => void;
  // 回到 launcher。
  reset: () => void;
  // 更新角标并（若在 launcher）刷新网格。
  setBadges: (badges: Partial<Record<CommandId, number>>) => void;
  // R25-Q：连接状态"单一真相"——boot 时拉一次 get_connection_state 初值 + 运行期收到
  // workhub-connection-changed 广播都调这个，驱动顶部细条（同 AI 未配置横幅样式）的文案/显隐。
  // undefined = 还没有任何判定（不渲，同 aiProviderConfigured 未知时不渲的既有取舍）。
  setConnectionState: (payload: DesktopShellConnectionChangedPayload | undefined) => void;
  // 卸载：断开 controller 自身的 window 监听器 + 当前 view，幂等。供未来重挂/多宿主场景。
  dispose: () => void;
};

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/></svg>';
const BACK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
// R13 批 S1：「问问 Cuu」行的图标——一个带三点的对话气泡（"正在想"的视觉隐喻），非 emoji，字符 tile 风格。
const ASK_CUU_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5a8.2 8.2 0 0 0-7 12.4L4 20l4.4-1.2A8.2 8.2 0 1 0 12 3.5z"/><path d="M8.7 12h.01M12 12h.01M15.3 12h.01"/></svg>';
const DRAG_EXCLUDED_SELECTOR = "input,textarea,button,a,select,[contenteditable=true]";
// UX-M15：军团 plan 详情的「← 返回小队列表」也算内部回退层——Esc 先回列表再回 launcher。
export const SPOTLIGHT_INTERNAL_BACK_SELECTOR = "[data-att-detail-collapse],[data-wi-back],[data-prop-back],[data-run-back],[data-back-to-projects],[data-back-to-agent-armies]";

type SpotlightInternalBackHost = {
  querySelector(selector: string): { click: () => void } | null;
};

export function isSpotlightDragExcludedTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(DRAG_EXCLUDED_SELECTOR));
}

export function handleSpotlightCapabilityEscape(body: SpotlightInternalBackHost, topLevelBack: () => void) {
  const internalBack = body.querySelector(SPOTLIGHT_INTERNAL_BACK_SELECTOR);
  if (internalBack) {
    internalBack.click();
    return "internal_back" as const;
  }
  topLevelBack();
  return "top_back" as const;
}

// M-01（R24 S3 走查）：顶栏徽章此前写死"⌘K"，但真正注册的全局唤起热键是 Option+Space
// （client-tauri/src-tauri/src/main.rs install_workhub_global_hotkey：Modifiers::ALT + Code::Space）。
// Esc 把主窗整个隐藏后按 ⌘K 毫无反应——徽章名不副实，新用户只能去翻托盘菜单。改成真实热键；
// Cmd+K 在窗口已打开时仍然有效（见下面 window "keydown" 里的 resetLauncher 分支），只是不再谎称
// 它能在盒子隐藏时把它唤回来。
export function renderSpotlightShellHtml(locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  const placeholder = zh ? "想做点什么？新任务 / 审批 / 网盘 / 项目…" : "What do you need? new task / approve / drive…";
  return `
    <div class="wh-spot ds-anim-spring-in" data-spot-box data-mode="launcher">
      ${renderWorkHubLiquidGlassLayer("spotlight")}
      <span class="wh-liquid-glass-rim" aria-hidden="true"></span>
      <div class="wh-liquid-glass-content">
        <div class="wh-spot-top">
          <button type="button" class="wh-spot-back" data-spot-back aria-label="${zh ? "返回" : "Back"}">${BACK_ICON}</button>
          <div class="wh-spot-field-wrap">
            <span class="wh-spot-field-icon">${SEARCH_ICON}</span>
            <input class="wh-spot-field" type="search" data-spot-input role="combobox" aria-expanded="true" aria-controls="wh-spot-listbox" aria-autocomplete="list" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" />
          </div>
          <div class="wh-spot-titlewrap">
            <span class="wh-spot-title" data-spot-title></span>
            <span class="wh-spot-subtitle" data-spot-subtitle></span>
          </div>
          <kbd class="wh-spot-kbd" title="${zh ? "随时按这个组合键唤起（隐藏后也一样）" : "Press this anytime to bring the box back — even while hidden"}">⌥Space</kbd>
          <button type="button" aria-hidden="true" tabindex="-1" class="wh-spot-drag-sheet" data-spot-drag-sheet></button>
        </div>
        <div class="wh-spot-ask-banner" data-spot-ask-banner hidden role="status" aria-live="polite">
          <span class="wh-spot-ask-banner-text" data-spot-ask-banner-text></span>
          <button type="button" class="wh-spot-ask-banner-undo ds-pressable" data-spot-ask-banner-undo>${zh ? "撤回" : "Undo"}</button>
        </div>
        <div class="wh-spot-ai-banner" data-spot-ai-banner hidden role="status"></div>
        <div class="wh-spot-connection-banner" data-spot-connection-banner hidden role="status" aria-live="polite"></div>
        <div class="wh-spot-body" data-spot-body></div>
      </div>
    </div>`;
}

// R13 批 S1：命令面板无命中时的「问问 Cuu」区块——按 askCuu 微状态机的当前阶段渲染四种形态
// （idle 的入口行 / asking 的呼吸态 / presenting 的确认条或内联回答 / error 的重试）。纯渲染函数，
// 决策本身（该不该自动执行、该不该先确认）已经在 ask-cuu.ts 的 decideAskCuuPresentation 里做完，
// 这里只管把决策结果画出来。
function renderAskCuuBlock(askCuu: AskCuuUiState, query: string, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  const trimmed = query.trim();

  if (askCuu.phase === "asking") {
    return `<div class="wh-spot-ask-cuu-asking" role="status" aria-live="polite">
      <span class="wh-spot-ask-cuu-breathe" aria-hidden="true"></span>
      ${zh ? `Cuu 正在想「${escapeHtml(askCuu.query)}」…` : `Cuu is thinking about "${escapeHtml(askCuu.query)}"…`}
    </div>`;
  }
  if (askCuu.phase === "error") {
    return `<div class="wh-spot-error">${escapeHtml(askCuu.message)}
      <div style="margin-top:13px"><button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-spot-ask-cuu-retry>${zh ? "重试" : "Retry"}</button></div>
    </div>`;
  }
  if (askCuu.phase === "presenting") {
    const presentation = askCuu.presentation;
    if (presentation.kind === "answer") {
      return `<div class="wh-spot-ask-cuu-answer">
        <p class="wh-spot-ask-cuu-answer-text">${renderAskCuuAnswerHtml(presentation.answerMd)}</p>
        <p class="wh-spot-ask-cuu-disclaimer">${zh ? "这不是会话，不会保存" : "Not a conversation — nothing is saved"}</p>
        <div class="wh-spot-intake-actions" style="justify-content:flex-end"><button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-spot-ask-cuu-dismiss>${zh ? "知道了" : "Got it"}</button></div>
      </div>`;
    }
    // confirm_open_page / confirm_new_project / confirm_create_task：低把握或本就该多问一句的动作，
    // 先展示「Cuu 理解为：XX」，等用户点确认才真正执行（见 ask-cuu.ts 的低把握先确认矩阵）。
    return `<div class="wh-spot-ask-cuu-confirm">
      <p class="wh-spot-ask-cuu-understood">${escapeHtml(presentation.understoodText)}</p>
      <div class="wh-spot-intake-actions">
        <button type="button" class="wh-spot-act wh-spot-act--quiet" data-spot-ask-cuu-cancel>${zh ? "取消" : "Cancel"}</button>
        <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-spot-ask-cuu-confirm>${zh ? "确认" : "Confirm"}</button>
      </div>
    </div>`;
  }
  // idle：只有输入达到最短字数才露出这一行——太短的残词不值得一次网络往返。
  if (trimmed.length < ASK_CUU_MIN_QUERY_LENGTH) {
    return "";
  }
  return `<div class="wh-spot-ask-cuu-row-wrap">
    <button type="button" class="wh-spot-ask-cuu-row ds-pressable" data-spot-ask-cuu>
      <span class="wh-spot-ask-cuu-icon" aria-hidden="true">${ASK_CUU_ICON}</span>
      <span class="wh-spot-ask-cuu-text">
        <span class="wh-spot-ask-cuu-label">${zh ? "问问 Cuu" : "Ask Cuu"}</span>
        <span class="wh-spot-ask-cuu-hint">${zh ? `“${escapeHtml(trimmed)}”` : `"${escapeHtml(trimmed)}"`}</span>
      </span>
      <kbd class="wh-spot-ask-cuu-kbd">${zh ? "回车" : "Enter"}</kbd>
    </button>
  </div>`;
}

// exported for M-04/M-05 unit coverage (controller.test.ts) — mountSpotlight() itself has no test
// harness (no jsdom in this repo; see workbench/chat/view.test.ts's "无 jsdom" note), but this render
// function is pure and safe to call directly with a matches array + a stub AskCuu state.
export function renderLauncherGrid(
  matches: CommandMatch[],
  locale: WorkHubLocale,
  badges: Partial<Record<CommandId, number>>,
  showHello: boolean,
  askCuu: AskCuuUiState,
  query: string
): string {
  const zh = locale === "zh-CN";
  if (matches.length === 0) {
    // R13 批 S1：一旦「问问 Cuu」进入 asking/presenting/error，这块区域整体交给它（避免和下面的
    // 「当新任务交给 Cuu」旧出口同时出现、抢注意力）；只有 idle 阶段才是「没有匹配」+ 两个出口并存。
    if (askCuu.phase !== "idle") {
      return `<div class="wh-spot-grid"><div class="wh-spot-empty-grid">${renderAskCuuBlock(askCuu, query, locale)}</div></div>`;
    }
    // 普通用户审查 R2：搜索框邀请自然语言，整句需求却落「没有匹配」死路——给「当新任务交给 Cuu」出口。
    // M-05（R24 S3 走查）："capability"是开发者黑话，且原文案自相矛盾（说"没有匹配"又紧接着给两个
    // 可执行入口）——改成人话，直接指向下面已经给出的出口，不留没头没脑的一句判决。
    return `<div class="wh-spot-grid"><div class="wh-spot-empty-grid">${zh ? "没找到对应的功能，你可以直接问问 Cuu" : "Nothing matched — you can ask Cuu directly"}
      ${renderAskCuuBlock(askCuu, query, locale)}
      <div class="wh-spot-intake-actions"><button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-spot-fallback-intake>${zh ? "把这句话当新任务交给 Cuu" : "Hand this to Cuu as a new task"}</button></div>
    </div></div>`;
  }
  // 空查询时给一无所知的新用户一句温和的引导：先亮身份(WorkHub·Cuu)，再说怎么用 + Esc 关闭提示
  // （搜索框无 header，保持聚焦盒观感；全局唤起热键已在右上角标出）。
  const hello = showHello
    ? `<div class="wh-spot-hello ds-anim-fade-in">${
        zh
          ? "WorkHub · 把活交给 Cuu，你来拍板<br>输入关键词，或选一个开始；Esc 关闭"
          : "WorkHub · hand work to Cuu, you decide<br>Type or pick one to start; Esc to close"
      }</div>`
    : "";
  const loc = zh ? "zh-CN" : "en";
  const cards = matches
    .map(({ command }, index) => {
      const badge = badges[command.id];
      // L7：角标(如待处理审批数)给无障碍标签,屏幕阅读器能播报「N 待处理」而非只读一个孤立数字。
      const badgeHtml = typeof badge === "number" && badge > 0 ? `<span class="wh-spot-cap-badge" aria-label="${badge} ${zh ? "待处理" : "pending"}">${badge}</span>` : "";
      const active = index === 0;
      // rank5：组合框/列表框 ARIA——每张能力卡是 option、可读 aria-selected；输入框(combobox)
      // 用 aria-activedescendant 指向当前项，箭头键移动时屏幕阅读器能播报，无需移动 DOM 焦点。
      return `<button type="button" tabindex="-1" id="wh-spot-opt-${index}" role="option" aria-selected="${active ? "true" : "false"}" class="wh-spot-cap" data-spot-cap="${command.id}" data-active="${active ? "true" : "false"}">
        <span class="wh-spot-cap-icon" aria-hidden="true">${command.icon}</span>
        <span class="wh-spot-cap-text">
          <span class="wh-spot-cap-label">${escapeHtml(command.label[loc])}</span>
          <span class="wh-spot-cap-hint">${escapeHtml(command.hint[loc])}</span>
        </span>
        ${badgeHtml}
      </button>`;
    })
    .join("");
  // M7：错落入场只在初始/空查询的 launcher 播一次；边打字边过滤时不要每个按键都重放 stagger（读起来发抖）。
  return `${hello}<div class="wh-spot-grid${showHello ? " ds-stagger" : ""}" id="wh-spot-listbox" role="listbox" aria-label="${zh ? "能力列表" : "Capabilities"}">${cards}</div>`;
}

export type SpotlightFirstRunCardState = { kind: "idle" } | { kind: "creating" } | { kind: "error"; message: string };

// R24 S6（E-10）：首次登录的落地页——不落空网格，落一张「建你的第一个项目」引导卡；建好直接打开工作台。
// 复用命令面板既有的 wh-spot-intake-*（卡片壳）/ wh-spot-freetext--line（单行输入，见 settings.ts /
// memory.ts 同款用法）视觉词汇，不新造一套样式。
export function renderFirstRunCardHtml(locale: WorkHubLocale, state: SpotlightFirstRunCardState): string {
  const zh = locale === "zh-CN";
  const busy = state.kind === "creating";
  const title = zh ? "建你的第一个项目" : "Create your first project";
  const sub = zh
    ? "项目是团队协作和 Cuu 干活的地方——建好就直接带你进去。"
    : "A project is where your team and Cuu get to work — we'll open it as soon as it's ready.";
  const namePlaceholder = zh ? "项目名称，例如：市场部日常" : "Project name, e.g. Marketing ops";
  const submitLabel = busy ? (zh ? "创建中…" : "Creating…") : zh ? "创建并打开" : "Create and open";
  const errorHtml =
    state.kind === "error"
      ? `<p data-spot-first-run-error style="margin:0;font-size:12px;color:#E5484D" role="alert">${escapeHtml(state.message)}</p>`
      : `<p data-spot-first-run-error hidden style="margin:0;font-size:12px;color:#E5484D" role="alert"></p>`;
  return `<div class="wh-spot-grid"><div class="wh-spot-intake ds-anim-fade-in">
    <h3 class="wh-spot-intake-title">${escapeHtml(title)}</h3>
    <p class="wh-spot-intake-body">${escapeHtml(sub)}</p>
    <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-spot-first-run-name maxlength="80" placeholder="${escapeHtml(namePlaceholder)}" aria-label="${escapeHtml(namePlaceholder)}" ${busy ? "disabled" : ""} />
    <div class="wh-spot-intake-actions">
      <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-spot-first-run-create ${busy ? "disabled" : ""}>${escapeHtml(submitLabel)}</button>
    </div>
    ${errorHtml}
  </div></div>`;
}

export function mountSpotlight(input: MountSpotlightInput): SpotlightHandle {
  const { host, client, locale } = input;
  const doc = host.ownerDocument ?? document;
  const zh = locale === "zh-CN";
  let badges: Partial<Record<CommandId, number>> = { ...(input.badges ?? {}) };
  let state: SpotlightState = initialSpotlightState();
  // 苹果聚焦盒：没点击(搜索框未聚焦)且空查询时,盒子只露一条搜索框;点击聚焦或输入才展开能力网格。
  // R24 S6：首次登录例外——引导卡要一开机就可见，不该藏在「先点一下」的收起态背后。
  let searchActive = Boolean(input.firstRun);
  // R24 S6（E-10）：首次登录的落地页状态——建完项目或用户开始搜索/切到某个能力后就不再是首次了
  // （不持久化"搜索过一次就永久退出首启"——只在本次挂载会话内生效，reload 后仍由 input.firstRun 决定）。
  let firstRunActive = Boolean(input.firstRun);
  let firstRunState: SpotlightFirstRunCardState = { kind: "idle" };
  let disposeView: (() => void) | undefined;
  // 待消费的跳转目标实体：open(id, target) 设置 → 下一次 renderCapability 读入该能力 ctx 后清空（rank13/14）。
  let pendingTarget: SpotlightTarget | undefined;
  // controller 自身的 window 监听器（⌘K/ESC/resize）统一挂这个 signal，dispose 时一并断开（rank25）。
  const controllerAbort = new AbortController();

  host.className = "wh-ds wh-spot-stage";
  // R24 调试开关：玻璃白底 alpha 的运行期覆写（没置位=不写任何内联样式，走 css.ts 的默认 token）。
  // 挂在宿主元素上而不是 :root——它同时带着 .wh-ds，内联自定义属性才压得住 .wh-ds 上的 --ds-glass-strong。
  applyGlassAlphaOverride(host, readGlassAlphaSource(typeof window === "undefined" ? undefined : window));
  host.innerHTML = renderSpotlightShellHtml(locale);

  const box = host.querySelector<HTMLElement>("[data-spot-box]")!;
  const topEl = host.querySelector<HTMLElement>(".wh-spot-top")!;
  const dragSheet = host.querySelector<HTMLElement>("[data-spot-drag-sheet]")!;
  const input2 = host.querySelector<HTMLInputElement>("[data-spot-input]")!;
  const body = host.querySelector<HTMLElement>("[data-spot-body]")!;
  const titleEl = host.querySelector<HTMLElement>("[data-spot-title]")!;
  const subtitleEl = host.querySelector<HTMLElement>("[data-spot-subtitle]")!;
  const askBanner = host.querySelector<HTMLElement>("[data-spot-ask-banner]")!;
  const askBannerText = host.querySelector<HTMLElement>("[data-spot-ask-banner-text]")!;
  const aiBanner = host.querySelector<HTMLElement>("[data-spot-ai-banner]")!;
  // R24 S6（E-11）：只用聚焦盒的人此前完全看不到「AI 未配置」这件事（那条提示只在工作台聊天区）。
  // 只有明确探到 false 才渲——探测失败/未知（input.aiProviderConfigured === undefined）都不渲，
  // 同工作台聊天区 shouldShowNoAiProviderBanner 的既有取舍：探测失败不等于没配置，不能吓用户。
  const showAiProviderBanner = input.aiProviderConfigured === false;
  if (showAiProviderBanner) {
    aiBanner.textContent = noAiProviderConfiguredText(locale);
  }
  // 横幅只在盒子展开时显示（收起态只留一条搜索框，不该被一条常驻横幅撑大）；launcher/能力页都算展开，
  // 两处渲染各自在设完 data-collapsed 后调用它同步。
  const updateAiBannerVisibility = () => {
    aiBanner.hidden = !showAiProviderBanner || box.dataset.collapsed === "true";
  };
  // R25-Q：连接状态"单一真相"细条——同 AI 未配置横幅一样只在盒子展开时显示，但内容是活的（boot 拉
  // 初值 + 运行期广播都会更新，见下面 setConnectionState），不像 AI 横幅那样挂载时烘死一次。
  const connectionBanner = host.querySelector<HTMLElement>("[data-spot-connection-banner]")!;
  let connectionState: DesktopShellConnectionChangedPayload | undefined;
  const updateConnectionBannerVisibility = () => {
    const text = connectionState ? desktopConnectionBannerText(connectionState.state, locale) : undefined;
    if (text !== undefined) {
      connectionBanner.textContent = text;
    }
    connectionBanner.hidden = text === undefined || box.dataset.collapsed === "true";
  };
  let suppressNextFocusExpansion = false;
  let suppressSearchFocusUntil = 0;
  let suppressSearchClickUntil = 0;

  // R13 批 S1：「问问 Cuu」微状态机——idle/asking/presenting/error，纯 reducer 在 ask-cuu.ts。
  // askCuuRequestSeq 是竞态令牌：请求发出后用户又改了查询/发起新一次 ask，旧请求落地时按令牌判断
  // 是否已经过期（过期就丢弃，不覆盖更新的状态）。
  let askCuuState: AskCuuUiState = initialAskCuuState;
  let askCuuRequestSeq = 0;
  const hideAskBanner = () => {
    askBanner.hidden = true;
    askBannerText.textContent = "";
  };
  const showAskBanner = (text: string) => {
    askBannerText.textContent = text;
    askBanner.hidden = false;
  };

  // —— 原生窗口缩放：测内容高度，clamp 到屏幕上限，超出则盒内滚动。去抖合并多次请求。 ——
  let resizeRaf = 0;
  let lastSentW = 0;
  let lastSentH = 0;
  const nowMs = () => window.performance.now();
  const focusSearch = (options: { expand: boolean }) => {
    if (options.expand) {
      searchActive = true;
    }
    suppressNextFocusExpansion = !options.expand;
    if (doc.activeElement === input2) {
      return;
    }
    input2.focus({ preventScroll: true });
    if (doc.activeElement !== input2) {
      suppressNextFocusExpansion = false;
    }
  };
  const applyResize = () => {
    resizeRaf = 0;
    if (!input.resize) {
      return;
    }
    const stagePad = 0; // .wh-spot-stage 现无 padding，玻璃盒自身贴边收边。
    const collapsed = box.dataset.mode === "launcher" && box.dataset.collapsed === "true";
    body.style.maxHeight = "none";
    const top = collapsed ? Math.max(48, topEl.offsetHeight) : box.offsetHeight - body.offsetHeight; // 顶栏 + 边框
    const natural = collapsed ? top + stagePad : box.offsetHeight + stagePad;
    const screenMax = Math.round((window.screen?.availHeight ?? 900) * 0.86);
    // 收起态(只有搜索框)时窗口要缩到搜索条本身(~56px),不能被 180 的下限撑出一截空白(用户反馈"未点击只有搜索框")。
    // 下限取一个搜索条高度兜底,实际高度由 natural(随内容)决定。
    const minH = collapsed ? top : 120;
    const winH = Math.max(minH, Math.min(natural, screenMax));
    const bodyMax = Math.max(80, winH - stagePad - top);
    body.style.maxHeight = collapsed ? "0px" : `${bodyMax}px`;
    const width = Math.max(360, Math.round(window.innerWidth));
    // M1：缓存上次下发尺寸——set_size 会回弹一个 window resize 事件，若不去重就会
    // set_size→resize→requestResize→set_size 抖动。尺寸没变就不再下发。
    if (width === lastSentW && winH === lastSentH) {
      return;
    }
    lastSentW = width;
    lastSentH = winH;
    input.resize(width, winH);
    scheduleWorkHubLiquidGlassFilterRebuild(doc);
  };
  const requestResize = () => {
    if (resizeRaf) {
      return;
    }
    resizeRaf = window.requestAnimationFrame(applyResize);
  };
  const requestResizeFromWindowResize = () => {
    scheduleWorkHubLiquidGlassFilterRebuild(doc);
    requestResize();
  };

  // rank5：网格(重)渲后让 combobox 输入框的 aria-activedescendant 指向首个(默认高亮)能力项；无项则清除。
  const syncLauncherActiveDescendant = () => {
    const first = body.querySelector<HTMLElement>("[data-spot-cap]");
    if (first?.id) {
      input2.setAttribute("aria-activedescendant", first.id);
    } else {
      input2.removeAttribute("aria-activedescendant");
    }
  };

  const renderLauncherBody = () => {
    // 未主动交互且空查询 → 收起,只留搜索框(data-collapsed=true);点击或输入后才展开能力网格。
    const expanded = searchActive || state.query.trim().length > 0;
    box.dataset.collapsed = expanded ? "false" : "true";
    // R24 S6：首次登录且还没开始搜索 → 落地页是「建你的第一个项目」引导卡，不是能力网格/hello。
    // 一旦开始搜索（有查询词）就让位给正常的搜索结果——首启不该拦住"我就是想找个东西"的用户。
    const showFirstRun = firstRunActive && state.query.trim().length === 0;
    body.innerHTML = !expanded
      ? ""
      : showFirstRun
        ? renderFirstRunCardHtml(locale, firstRunState)
        : renderLauncherGrid(launcherMatches(state, locale), locale, badges, state.query.trim().length === 0, askCuuState, state.query);
    syncLauncherActiveDescendant();
    updateAiBannerVisibility();
    updateConnectionBannerVisibility();
  };

  // 「问问 Cuu」区块随 askCuuState 变化时的重渲——只重画能力网格区，不动 mode/顶栏（还在 launcher 内）。
  const refreshAskCuuArea = () => {
    renderLauncherBody();
    scheduleWorkHubLiquidGlassFilterRebuild(doc);
    requestResize();
  };

  const renderLauncher = () => {
    if (disposeView) {
      disposeView();
      disposeView = undefined;
    }
    box.dataset.mode = "launcher";
    // 回到（真正的）launcher 时，之前留下的撤回条 / 未完成的 ask（asking·presenting·error）都不该
    // 继续挂着——正常的 runAskCuu/applyAskCuuAction 流程在导航走之前已经自己 dismiss 过，这里的兜底
    // 只在「外部入口（托盘/深链/桌宠卡）在 ask 尚未落定时直接跳到某个能力」这种边界情形下才真正起作用：
    // 令牌自增让任何仍在飞的响应落地时判定过期，避免用户几经辗转回到 launcher 时又冒出一条陈旧确认条。
    askCuuRequestSeq += 1;
    askCuuState = initialAskCuuState;
    hideAskBanner();
    renderLauncherBody();
    scheduleWorkHubLiquidGlassFilterRebuild(doc);
    requestResize();
  };

  const renderCapability = (id: CommandId) => {
    if (disposeView) {
      disposeView();
      disposeView = undefined;
    }
    // 消费一次性跳转目标（open()/深链设置的）：归属本次 mount 的 ctx.target，随后清空，避免泄漏到下个能力。
    const target = pendingTarget;
    pendingTarget = undefined;
    box.dataset.mode = "capability";
    // SM-1：从外部入口(托盘/系统通知/Cuu 决策卡/深链)直接 openCapability 时,盒子可能仍停在 launcher
    // mount 设的 data-collapsed="true"（idle 细搜索条）。renderCapability 不经过 render()，永不复位它，
    // 于是 css 的 [data-collapsed=true] .wh-spot-body{display:none} + applyResize 的 52px 钳制会把整个能力
    // 内容(审批/工作项/diff/网盘)藏起来,只剩标题栏。能力态从不是收起态,这里显式展开(同时解 52px 钳制)。
    box.dataset.collapsed = "false";
    updateAiBannerVisibility();
    updateConnectionBannerVisibility();
    const cmd = commandRegistry.find((c) => c.id === id);
    titleEl.textContent = cmd ? cmd.label[zh ? "zh-CN" : "en"] : id;
    subtitleEl.textContent = "";
    // H1：每个能力一个全新内容节点 + AbortController。view 把监听器挂在这个节点(ctx.body)上；
    // 切走能力时 replaceChildren 移除该节点（监听器随节点销毁，不在持久 body 上累积）+ abort 信号
    // 兜住任何挂到 window/document 的监听器。disposeView 同步建好，异步 mount 未 resolve 就切走也能清理。
    const viewRoot = doc.createElement("div");
    viewRoot.className = "ds-anim-fade-in";
    body.replaceChildren(viewRoot);
    scheduleWorkHubLiquidGlassFilterRebuild(doc);
    requestResize();
    // L1：进入能力后搜索框被 display:none 隐藏,焦点会掉到 <body>,键盘用户失去锚点。把焦点移到内容容器——
    // 下一次 Tab 即落到视图第一个可交互元素,屏幕阅读器焦点也随之进入新内容。tabindex=-1 仅供编程聚焦、
    // 不进 Tab 序列;编程聚焦不触发 :focus-visible,不会给整块内容画焦点环。
    viewRoot.tabIndex = -1;
    viewRoot.focus?.({ preventScroll: true });
    const viewAbort = new AbortController();
    let viewCleanup: (() => void) | undefined;
    disposeView = () => {
      viewCleanup?.();
      viewAbort.abort();
    };
    const ctx: SpotlightViewContext = {
      client,
      locale,
      body: viewRoot,
      back: () => dispatch({ type: "back" }),
      // M-04/S-05（R24 S3 走查）：此前走 dispatch({type:"reset"}) → 通用 render() 的 launcher 分支，
      // 那条路径会强制 searchActive=true（展开成全高网格，压在刚打开的工作台窗口上）且从不清空
      // input2.value——state.query 已经归零但输入框还留着上一次的查询字，网格却按空查询显示全量
      // 能力表，两者对不上。resetLauncher() 才是"事情办完了，真正退回 idle 条"的既有实现（Cmd+K/
      // 顶层 Esc/SpotlightHandle.reset 都用它），resetShell 改接它，同时把这两个视觉 bug 一起解决。
      resetShell: () => resetLauncher(),
      open: (nextId, nextTarget) => openCapabilityWithTarget(nextId, nextTarget),
      ...(target ? { target } : {}),
      setSubtitle: (text) => {
        subtitleEl.textContent = text;
      },
      toast: (message, tone) => showToast(message, tone),
      requestResize,
      refocusBody: () => {
        viewRoot.tabIndex = -1;
        viewRoot.focus({ preventScroll: true });
      },
      ...(input.onActionSettled ? { onActionSettled: input.onActionSettled } : {}),
      signal: viewAbort.signal
    };
    const view = resolveCapabilityView(id);
    const result = view.mount(ctx);
    if (result instanceof Promise) {
      void result.then((cleanup) => {
        if (typeof cleanup === "function") {
          viewCleanup = cleanup;
        }
      });
    } else if (typeof result === "function") {
      viewCleanup = result;
    }
  };

  const render = () => {
    const capId = openCapabilityId(state);
    if (capId) {
      renderCapability(capId);
    } else {
      // 从能力返回 launcher：视为已激活,展开网格 + 聚焦输入(无收起闪烁)。
      searchActive = true;
      renderLauncher();
      focusSearch({ expand: true });
    }
  };
  const resetLauncher = () => {
    input2.value = "";
    searchActive = false;
    pendingTarget = undefined;
    // askCuu 的令牌自增/状态复位由 renderLauncher() 统一兜底（见其内部注释），这里不重复。
    state = initialSpotlightState();
    box.dataset.kbd = "false";
    renderLauncher();
    focusSearch({ expand: false });
  };

  let toastTimer = 0;
  // #20 退场动画的内层定时器——单独跟踪,以便替换/dispose 时清掉,避免悬挂回调/竞态(虽各自无害,从严)。
  let toastInnerTimer = 0;
  const clearToastTimers = () => {
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = 0;
    }
    if (toastInnerTimer) {
      window.clearTimeout(toastInnerTimer);
      toastInnerTimer = 0;
    }
  };
  const showToast = (message: string, tone: "ok" | "error" | "info" = "info") => {
    clearToastTimers();
    box.querySelector(".wh-spot-toast")?.remove();
    const el = doc.createElement("div");
    el.className = `wh-spot-toast wh-spot-toast--${tone}`;
    // rank6：动作回执/错误要被屏幕阅读器播报——错误用 assertive(alert)，成功/提示用 polite(status)。
    el.setAttribute("role", tone === "error" ? "alert" : "status");
    el.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
    el.textContent = message;
    box.appendChild(el);
    // R6（桌面交互）：toast 绝对定位悬浮在盒底，恰好盖住可滚动 body 底部的提交按钮——
    // 显示期给 body 垫底部空隙让位，退场时复原。
    const bodyEl = box.querySelector<HTMLElement>(".wh-spot-body");
    if (bodyEl) {
      bodyEl.style.paddingBottom = "56px";
    }
    // #20：到期先播退场动画(约 1 帧)再移除,toast 不再生硬消失。reduced-motion 下动画近 0ms,行为不变。
    toastTimer = window.setTimeout(() => {
      el.classList.add("wh-spot-toast--leaving");
      toastInnerTimer = window.setTimeout(() => {
        el.remove();
        if (bodyEl) {
          bodyEl.style.paddingBottom = "";
        }
        // M-03（R24 S3 走查）：显示时那 56px 的 paddingBottom 让位已经算进了窗口高度里——但退场只
        // 复原了 padding，从没重新测量过，窗口高度就停在"含 toast"的那一档，留一条空灰带。退场后
        // 必须再请求一次 resize，让盒子跟着收缩回真实内容高度。
        requestResize();
      }, 220);
    }, 3200);
  };

  const dispatch = (action: Parameters<typeof spotlightReducer>[1]) => {
    const next = spotlightReducer(state, action);
    if (next === state) {
      return;
    }
    const prevMode = state.mode.kind;
    state = next;
    const nextCap = openCapabilityId(state);
    // rank6：同一能力被再次请求(桌宠/托盘/深链 navigate 到已打开的能力)也要重渲——
    // renderCapability 会先 disposeView 再全新挂载+重拉数据，否则外部入口看起来「点了没反应」。
    if (nextCap) {
      renderCapability(nextCap);
    } else if (!nextCap && prevMode === "capability") {
      render();
    } else if (!nextCap) {
      // launcher 内查询变化：同步收起/展开状态，保输入焦点。
      renderLauncherBody();
      scheduleWorkHubLiquidGlassFilterRebuild(doc);
      requestResize();
    }
  };

  // 带目标实体打开某能力：先设 pendingTarget（renderCapability 会读入该能力 ctx.target），再 dispatch。
  const openCapabilityWithTarget = (id: CommandId, target?: SpotlightTarget) => {
    pendingTarget = target;
    dispatch({ type: "openCapability", id });
  };

  // R13 批 S1：真正执行一次 askCuu 分类结果——open_page/new_project 跳到既有能力入口，create_task
  // 复用既有 intake 澄清流程（prefill 走 R2 审查已有的 "spotlight-intent:" 前缀约定，见 intake.ts
  // renderStart 的 prefillIntent 解析），answer 不落到这里（它没有可执行的动作）。执行后统一亮出
  // 「Cuu 理解为」撤回条——撤回条的「撤回」按钮只做一件事：dispatch back 回 launcher，对三种动作都成立
  // （关掉打开的能力 / 关掉预填的意图草稿），这也是它对新建项目场景里"撤回"的诚实含义：撤回条不能、
  // 也不假装能关掉已经打开的原生工作台窗口，只回到聚焦盒的搜索起点。
  const applyAskCuuAction = (presentation: AskCuuPresentation) => {
    switch (presentation.kind) {
      case "auto":
      case "confirm_open_page":
        openCapabilityWithTarget(presentation.commandId);
        showAskBanner(presentation.understoodText);
        return;
      case "auto_new_project":
      case "confirm_new_project":
        openCapabilityWithTarget("new_project");
        showAskBanner(presentation.understoodText);
        return;
      case "confirm_create_task":
        openCapabilityWithTarget("intake", { route: `spotlight-intent:${presentation.taskTitle}` });
        showAskBanner(presentation.understoodText);
        return;
      case "answer":
        return;
    }
  };

  // R13 批 S1：command-palette 无命中、输入达到最短字数时的「问问 Cuu」——调服务端一次轻量意图分类
  // （POST /api/spotlight/intent，桌面零 key，走 client.request 复用既有鉴权/超时/信封解包，不新增
  // api-client 方法）。竞态用 askCuuRequestSeq 令牌：请求期间用户改了查询或又发起一次 ask，旧响应
  // 落地时发现令牌已经不是自己的，直接丢弃，不覆盖更新的状态。
  const runAskCuu = () => {
    const trimmed = input2.value.trim();
    if (trimmed.length < ASK_CUU_MIN_QUERY_LENGTH || askCuuState.phase === "asking") {
      return;
    }
    const seq = (askCuuRequestSeq += 1);
    askCuuState = askCuuReducer(askCuuState, { type: "ask", query: trimmed });
    refreshAskCuuArea();
    const payload = buildAskCuuRequestPayload(trimmed, zh ? "zh-CN" : "en");
    void client
      .request<AskCuuResult>("/api/spotlight/intent", {
        method: "POST",
        body: JSON.stringify(payload)
      })
      .then((result) => {
        if (seq !== askCuuRequestSeq) {
          return;
        }
        const presentation = decideAskCuuPresentation(result, zh ? "zh-CN" : "en");
        if (presentation.kind === "auto" || presentation.kind === "auto_new_project") {
          askCuuState = askCuuReducer(askCuuState, { type: "dismiss" });
          applyAskCuuAction(presentation);
          return;
        }
        askCuuState = askCuuReducer(askCuuState, { type: "resolved", presentation });
        refreshAskCuuArea();
      })
      .catch(() => {
        if (seq !== askCuuRequestSeq) {
          return;
        }
        const message = zh
          ? "Cuu 没能理解这句话，请再试一次或换个说法。"
          : "Cuu couldn't work that out — try again or rephrase.";
        askCuuState = askCuuReducer(askCuuState, { type: "failed", message });
        refreshAskCuuArea();
      });
  };

  // —— 交互 —— //
  input2.addEventListener("input", () => {
    if (!openCapabilityId(state)) {
      searchActive = true;
    }
    if (askCuuState.phase !== "idle") {
      // 用户改了查询：之前那一次 ask（呼吸中/已呈现/已出错）不再对应当前输入，失效并回到干净状态。
      askCuuRequestSeq += 1;
      askCuuState = askCuuReducer(askCuuState, { type: "dismiss" });
    }
    dispatch({ type: "setQuery", query: input2.value });
    box.dataset.kbd = "true"; // L5：打字也是键盘交互 → 高亮 Enter 将选中的首项(box 跨重渲存活)
  });
  // L5：鼠标一动就退出键盘高亮模式,避免「箭头选了 A、又去 hover B」时两张都像被选中。
  body.addEventListener("pointermove", () => {
    if (box.dataset.kbd === "true") {
      box.dataset.kbd = "false";
    }
  }, { passive: true });
  // 程序性聚焦/窗口激活不展开；用户点击或输入才展开，避免 App 被唤起时从搜索条跳成大面板。
  input2.addEventListener("focus", () => {
    if (suppressNextFocusExpansion || nowMs() < suppressSearchFocusUntil) {
      suppressNextFocusExpansion = false;
    }
  });
  input2.addEventListener("click", () => {
    if (nowMs() < suppressSearchClickUntil) {
      return;
    }
    if (openCapabilityId(state) || searchActive || state.query.trim().length > 0) {
      return;
    }
    searchActive = true;
    renderLauncher();
    focusSearch({ expand: true });
  });
  // 失焦且空查询 → 收回成"只有搜索框";但若焦点移到盒内(点能力卡)则保持展开,让卡片点击照常生效。
  input2.addEventListener("blur", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && box.contains(next)) {
      return;
    }
    if (openCapabilityId(state) || !searchActive || state.query.trim().length > 0) {
      return;
    }
    searchActive = false;
    renderLauncher();
  });

  host.querySelector<HTMLElement>("[data-spot-back]")?.addEventListener("click", () => {
    dispatch({ type: "back" });
  });

  // R13 批 S1：撤回条的「撤回」——banner 是壳层常驻节点（renderCapability 只替换 body，不碰它），
  // 所以这个监听器只绑一次；语义统一是「回到 launcher」，见 applyAskCuuAction 顶部注释。
  host.querySelector<HTMLElement>("[data-spot-ask-banner-undo]")?.addEventListener(
    "click",
    () => {
      hideAskBanner();
      dispatch({ type: "back" });
    },
    { signal: controllerAbort.signal }
  );

  let manualDrag:
    | {
        startClientX: number;
        startClientY: number;
        lastScreenX: number;
        lastScreenY: number;
        dragging: boolean;
      }
    | undefined;
  topEl.addEventListener(
    "mousedown",
    (event) => {
      if (event.button !== 0 || isSpotlightDragExcludedTarget(event.target)) {
        return;
      }
      manualDrag = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastScreenX: event.screenX,
        lastScreenY: event.screenY,
        dragging: false
      };
      suppressSearchFocusUntil = nowMs() + 700;
      suppressSearchClickUntil = nowMs() + 900;
    },
    { capture: true }
  );
  // DSK-09：拖拽 mousemove 的 IPC（dragMove → move_main_window_by）按 rAF 合帧——高频 mousemove
  // 事件（可达每秒数百个）不再每个都发一次 IPC，只在每帧把累计位移发一次。
  let dragMoveFramePending = false;
  let dragMoveAccumX = 0;
  let dragMoveAccumY = 0;
  const flushDragMove = () => {
    dragMoveFramePending = false;
    const deltaX = dragMoveAccumX;
    const deltaY = dragMoveAccumY;
    dragMoveAccumX = 0;
    dragMoveAccumY = 0;
    if (deltaX !== 0 || deltaY !== 0) {
      input.dragMove?.(deltaX, deltaY);
    }
  };
  const scheduleDragMove = (deltaX: number, deltaY: number) => {
    dragMoveAccumX += deltaX;
    dragMoveAccumY += deltaY;
    if (!dragMoveFramePending) {
      dragMoveFramePending = true;
      requestAnimationFrame(flushDragMove);
    }
  };
  window.addEventListener(
    "mousemove",
    (event) => {
      if (!manualDrag || (event.buttons & 1) !== 1) {
        return;
      }
      const moved = Math.hypot(event.clientX - manualDrag.startClientX, event.clientY - manualDrag.startClientY);
      if (moved < 4) {
        return;
      }
      manualDrag.dragging = true;
      suppressSearchFocusUntil = nowMs() + 900;
      suppressSearchClickUntil = nowMs() + 900;
      event.preventDefault();
      event.stopPropagation();
      if (input.dragMove) {
        scheduleDragMove(event.screenX - manualDrag.lastScreenX, event.screenY - manualDrag.lastScreenY);
        manualDrag.lastScreenX = event.screenX;
        manualDrag.lastScreenY = event.screenY;
      } else {
        input.drag?.();
      }
    },
    { capture: true, signal: controllerAbort.signal }
  );
  window.addEventListener(
    "mouseup",
    (event) => {
      if (!manualDrag) {
        return;
      }
      // 抬起时把合帧里还没发出去的尾量补发——不丢最后一段位移。
      if (dragMoveFramePending) {
        flushDragMove();
      }
      const moved = Math.hypot(event.clientX - manualDrag.startClientX, event.clientY - manualDrag.startClientY);
      if (!manualDrag.dragging && moved < 4) {
        suppressSearchClickUntil = 0;
      } else {
        suppressSearchFocusUntil = nowMs() + 700;
        suppressSearchClickUntil = nowMs() + 700;
        event.preventDefault();
        event.stopPropagation();
      }
      manualDrag = undefined;
    },
    { capture: true, signal: controllerAbort.signal }
  );
  topEl.addEventListener("click", (event) => {
    if (nowMs() >= suppressSearchClickUntil) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, { capture: true, signal: controllerAbort.signal });

  let dragSheetDrag:
    | {
        startClientX: number;
        startClientY: number;
        lastScreenX: number;
        lastScreenY: number;
        pointerId: number;
        dragging: boolean;
      }
    | undefined;
  dragSheet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    dragSheetDrag = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      pointerId: event.pointerId,
      dragging: false
    };
    suppressSearchFocusUntil = nowMs() + 900;
    suppressSearchClickUntil = nowMs() + 1100;
    event.preventDefault();
    event.stopPropagation();
    try {
      dragSheet.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in embedded webviews; window movement still falls back below.
    }
  }, { signal: controllerAbort.signal });
  dragSheet.addEventListener("pointermove", (event) => {
    if (!dragSheetDrag || (event.buttons & 1) !== 1) {
      return;
    }
    if (Math.hypot(event.clientX - dragSheetDrag.startClientX, event.clientY - dragSheetDrag.startClientY) < 4) {
      return;
    }
    dragSheetDrag.dragging = true;
    suppressSearchFocusUntil = nowMs() + 900;
    suppressSearchClickUntil = nowMs() + 900;
    event.preventDefault();
    event.stopPropagation();
    if (input.dragMove) {
      // DSK-09：与主拖拽区同一套 rAF 合帧（scheduleDragMove/flushDragMove，见上方 mousemove 注释）。
      scheduleDragMove(event.screenX - dragSheetDrag.lastScreenX, event.screenY - dragSheetDrag.lastScreenY);
      dragSheetDrag.lastScreenX = event.screenX;
      dragSheetDrag.lastScreenY = event.screenY;
    } else {
      input.drag?.();
    }
  }, { signal: controllerAbort.signal });
  const finishDragSheet = (event: PointerEvent) => {
    if (!dragSheetDrag) {
      return;
    }
    // 抬起/取消时补发合帧里还没发出去的尾量。
    if (dragMoveFramePending) {
      flushDragMove();
    }
    const wasDragging = dragSheetDrag.dragging;
    try {
      dragSheet.releasePointerCapture(dragSheetDrag.pointerId);
    } catch {
      // Harmless if the platform already ended capture during native movement.
    }
    dragSheetDrag = undefined;
    event.preventDefault();
    event.stopPropagation();
    if (!wasDragging) {
      searchActive = true;
      renderLauncher();
      focusSearch({ expand: true });
      return;
    }
    suppressSearchFocusUntil = nowMs() + 700;
    suppressSearchClickUntil = nowMs() + 700;
  };
  dragSheet.addEventListener("pointerup", finishDragSheet, { signal: controllerAbort.signal });
  dragSheet.addEventListener("pointercancel", finishDragSheet, { signal: controllerAbort.signal });

  let dragStart:
    | {
        x: number;
        y: number;
        pointerId: number;
      }
    | undefined;
  topEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (isSpotlightDragExcludedTarget(event.target)) {
      return;
    }
    if (input.dragMove) {
      return;
    }
    suppressSearchFocusUntil = nowMs() + 800;
    suppressSearchClickUntil = nowMs() + 1000;
    dragStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    try {
      topEl.setPointerCapture(event.pointerId);
    } catch {
      // Some embedded webviews refuse capture once native drag starts; harmless.
    }
  });
  topEl.addEventListener("pointermove", (event) => {
    if (!dragStart || (event.buttons & 1) !== 1) {
      return;
    }
    if (Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 4) {
      return;
    }
    suppressSearchClickUntil = nowMs() + 700;
    event.preventDefault();
    input.drag?.();
    try {
      topEl.releasePointerCapture(dragStart.pointerId);
    } catch {
      // Native dragging takes over pointer handling.
    }
    dragStart = undefined;
  });
  const clearDragStart = () => {
    dragStart = undefined;
  };
  topEl.addEventListener("pointerup", clearDragStart);
  topEl.addEventListener("pointercancel", clearDragStart);

  // R24 S6（E-10）：首启引导卡「创建并打开」——建项目 → 标记首启完成（落地页从此走普通启动器）→
  // stash 深链目标 + invoke open_workbench 直接打开该项目（同 spotlight/views/workbench-open.ts 的
  // 既有 stash+invoke 手法，避免冷启动深链竞态，见其顶部注释）。非 Tauri 环境（浏览器 dev 预览）没有
  // 原生窗口可开——项目仍然建成功，用 toast 如实说明，不假装打开了工作台。
  const submitFirstRunProject = async () => {
    if (firstRunState.kind === "creating") {
      return;
    }
    const nameEl = body.querySelector<HTMLInputElement>("[data-spot-first-run-name]");
    const name = nameEl?.value.trim() ?? "";
    if (!name) {
      firstRunState = { kind: "error", message: zh ? "请先填写项目名称。" : "Please enter a project name first." };
      renderLauncherBody();
      return;
    }
    firstRunState = { kind: "creating" };
    renderLauncherBody();
    try {
      const result = await client.bootstrapProject({ name });
      const projectId = result.project.id;
      firstRunActive = false;
      input.onFirstRunComplete?.();
      const invoke = resolveDesktopTauriInvoke();
      if (invoke) {
        stashPendingWorkbenchDeepLink({ projectId });
        void Promise.resolve(invoke("open_workbench", { projectId })).catch(() => undefined);
      } else {
        showToast(
          zh
            ? "项目已创建，这个预览环境打不开工作台窗口。"
            : "Project created — this preview can't open the workbench window.",
          "info"
        );
      }
      resetLauncher();
    } catch (error) {
      firstRunState = {
        kind: "error",
        message:
          error instanceof Error ? error.message : zh ? "创建失败，请重试。" : "Couldn't create the project — retry."
      };
      renderLauncherBody();
    }
  };

  body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.closest<HTMLElement>("[data-spot-first-run-create]")) {
      void submitFirstRunProject();
      return;
    }
    const cap = target.closest<HTMLElement>("[data-spot-cap]");
    if (cap?.dataset.spotCap) {
      dispatch({ type: "openCapability", id: cap.dataset.spotCap as CommandId });
      return;
    }
    // 普通用户审查 R2：无匹配兜底——整句查询原话带进 intake 意图框（route 前缀约定 spotlight-intent:）。
    if (target.closest<HTMLElement>("[data-spot-fallback-intake]")) {
      const query = input2.value.trim();
      openCapabilityWithTarget("intake", query ? { route: `spotlight-intent:${query}` } : undefined);
      return;
    }
    // R13 批 S1：「问问 Cuu」行 / 出错重试——同一个触发函数（runAskCuu 内部会拒绝重复并发请求）。
    if (target.closest<HTMLElement>("[data-spot-ask-cuu],[data-spot-ask-cuu-retry]")) {
      runAskCuu();
      return;
    }
    if (target.closest<HTMLElement>("[data-spot-ask-cuu-cancel],[data-spot-ask-cuu-dismiss]")) {
      askCuuState = askCuuReducer(askCuuState, { type: "dismiss" });
      refreshAskCuuArea();
      return;
    }
    if (target.closest<HTMLElement>("[data-spot-ask-cuu-confirm]") && askCuuState.phase === "presenting") {
      const presentation = askCuuState.presentation;
      askCuuState = askCuuReducer(askCuuState, { type: "dismiss" });
      applyAskCuuAction(presentation);
    }
  });

  // R24 S6：首启引导卡的项目名称输入框没有包在 <form> 里（同网格里其它单行输入的既有写法），
  // Enter 键需要委托监听补上「打字后直接回车提交」，不用非得去点按钮。
  body.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && target.matches("[data-spot-first-run-name]")) {
      event.preventDefault();
      void submitFirstRunProject();
    }
  });

  // 键盘：launcher 下 ↑↓ 选中、Enter 开最优；ESC 返回/清空；⌘K/Ctrl+K 回到搜索。
  const moveActive = (delta: number) => {
    const caps = Array.from(body.querySelectorAll<HTMLElement>("[data-spot-cap]"));
    if (caps.length === 0) {
      return;
    }
    box.dataset.kbd = "true"; // L5：进入键盘导航模式 → 才显默认高亮 accent 环
    let current = caps.findIndex((c) => c.dataset.active === "true");
    if (current < 0) {
      current = 0;
    }
    const nextIndex = (current + delta + caps.length) % caps.length;
    caps.forEach((c, i) => {
      const on = i === nextIndex;
      c.dataset.active = String(on);
      // rank5：同步 aria-selected + 让 combobox 输入框的 aria-activedescendant 指向当前项，屏幕阅读器随箭头播报。
      c.setAttribute("aria-selected", on ? "true" : "false");
    });
    const activeCap = caps[nextIndex];
    if (activeCap?.id) {
      input2.setAttribute("aria-activedescendant", activeCap.id);
    }
    activeCap?.scrollIntoView({ block: "nearest" });
  };

  input2.addEventListener("keydown", (event) => {
    // 普通用户审查 R2：中文输入法组合态的回车是「选字」不是「确认」——组合中一律不当快捷键。
    if (event.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      const active = body.querySelector<HTMLElement>('[data-spot-cap][data-active="true"]');
      const id = (active?.dataset.spotCap as CommandId | undefined) ?? topMatchId(state, locale);
      if (id) {
        event.preventDefault();
        dispatch({ type: "openCapability", id });
        return;
      }
      // R13 批 S1：无命中时 Enter 触发/确认「问问 Cuu」——asking/answer 阶段 Enter 没有意义（answer
      // 只有「知道了」，asking 已经在飞），confirm_* 阶段 Enter 等同点确认按钮，idle/error 阶段
      // Enter 等同点「问问 Cuu」/「重试」行。
      if (askCuuState.phase === "presenting" && askCuuState.presentation.kind !== "answer") {
        event.preventDefault();
        const presentation = askCuuState.presentation;
        askCuuState = askCuuReducer(askCuuState, { type: "dismiss" });
        applyAskCuuAction(presentation);
        return;
      }
      if ((askCuuState.phase === "idle" || askCuuState.phase === "error") && input2.value.trim().length >= ASK_CUU_MIN_QUERY_LENGTH) {
        event.preventDefault();
        runAskCuu();
      }
    }
  });

  let escapeArmedUntil = 0;
  window.addEventListener(
    "keydown",
    (event) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        // rank20：清掉搜索框残留文本（否则框里旧词与下方全量网格对不上），dispatch 自己负责重渲，
        // 不再额外 render() 造成 launcher 连画两遍。
        resetLauncher();
      } else if (event.key === "Escape") {
        if (event.isComposing || event.keyCode === 229) {
          return;
        }
        // R13 批 S1：askCuu 面板（呼吸中/确认条/回答/出错）优先吃掉第一个 Esc——先退出这一层，
        // 再谈是否清空查询/关闭盒子，与下面 capability 内部详情"先退一级"的分层退出同一套纪律。
        if (askCuuState.phase !== "idle") {
          event.preventDefault();
          askCuuRequestSeq += 1;
          askCuuState = askCuuReducer(askCuuState, { type: "dismiss" });
          refreshAskCuuArea();
          return;
        }
        // 普通用户审查 R2：capability 内有未提交的输入（打回说明/合并草稿/需求文本）时，
        // Esc 无条件回退会静默丢字——第一次 Esc 提示，2 秒内再按才真正回退。
        const dirtyInput = openCapabilityId(state)
          ? [...body.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea, input[type=text], input[type=search]")]
            .find((field) => field.value.trim().length > 0)
          : undefined;
        if (dirtyInput && escapeArmedUntil < Date.now()) {
          event.preventDefault();
          escapeArmedUntil = Date.now() + 2000;
          // R6（桌面交互）：此前武装态零反馈——用户按了 Esc 什么都没发生，以为坏了。
          showToast(zh ? "再按一次 Esc 放弃未提交的内容" : "Press Esc again to discard your input", "info");
          return;
        }
        escapeArmedUntil = 0;
        if (openCapabilityId(state)) {
          event.preventDefault();
          // M3：若当前能力视图正处于内部详情(list→detail),先退一级——点它已渲染好的「返回列表」按钮,
          // 让 Esc 与屏幕上的面包屑返回逐级一致;只有视图没有内部详情层时,Esc 才退回 launcher(能力网格)。
          // 这些 data-*-back 仅在各 view 的 detail HTML 里出现,list 态查不到 → 自然退回顶层。
          handleSpotlightCapabilityEscape(body, () => {
            dispatch({ type: "back" });
          });
        } else if (input2.value) {
          event.preventDefault();
          input2.value = "";
          dispatch({ type: "setQuery", query: "" });
        } else {
          // M2：launcher 顶层（无能力打开、查询为空）按 Esc → 真正关闭盒子，兑现「Esc 关闭」承诺。
          event.preventDefault();
          resetLauncher();
          input.dismiss?.();
        }
      }
    },
    { signal: controllerAbort.signal }
  );

  window.addEventListener("resize", requestResizeFromWindowResize, { signal: controllerAbort.signal });

    // 首屏：launcher——搜索框直接接键盘，但保持"只有搜索框"的收起态；输入时再自然展开能力网格。
    renderLauncher();
    focusSearch({ expand: false });

  return {
    openCapability: (id, target) => {
      openCapabilityWithTarget(id, target);
    },
    reset: () => {
      resetLauncher();
    },
    setBadges: (next) => {
      badges = { ...badges, ...next };
      if (!openCapabilityId(state)) {
        // R24 S6：复用 renderLauncherBody 而不是重复内联同一段渲染逻辑——它已经知道该渲首启卡
        // 还是能力网格（角标刷新在首启卡还没让位时触发也不该把卡片错渲成网格）。
        renderLauncherBody();
        requestResize();
      }
    },
    setConnectionState: (payload) => {
      connectionState = payload;
      updateConnectionBannerVisibility();
    },
    dispose: () => {
      controllerAbort.abort();
      // 任何仍在飞的「问问 Cuu」请求落地时会看到令牌已经不匹配（自增后不可能再等于任何后续读到的
      // 值），据此丢弃响应，不在已卸载的 host 上继续操作 DOM。
      askCuuRequestSeq += 1;
      if (resizeRaf) {
        window.cancelAnimationFrame(resizeRaf);
        resizeRaf = 0;
      }
      clearToastTimers();
      disposeView?.();
      disposeView = undefined;
    }
  };
}

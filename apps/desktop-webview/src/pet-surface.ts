import { WorkHubApiError, createApiClient } from "@workhub/api-client/client";
import {
  cardFromAgentRunLive,
  cardFromAttentionItem,
  cardFromProposalConflict,
  createCuuController,
  createCuuIdleScheduler,
  cuuBubbleKindForState,
  cuuEmotionForState,
  cuuFormat,
  cuuMotionForState,
  cuuT,
  type CuuBubbleKind,
  type CuuCard,
  type CuuEmotion,
  type CuuController,
  type CuuControllerDecision,
  type CuuControllerPreferences,
  type CuuIdleMicroAction,
  type CuuIdleScheduler,
  type CuuIdleSchedulerPolicy,
  type CuuLocaleOptions,
  type CuuMotionHint
} from "@workhub/cuu";
import {
  normalizeWorkHubLocale,
  workHubLocaleStorageKey,
  type AgentRunLiveVM,
  type AttentionItem,
  type CuuState,
  type ProposalConflict,
  type WorkHubLocale
} from "@workhub/contracts";
import { delegateTargetFromHref } from "@workhub/web-runtime";

import {
  renderDesktopCuuCatLive2DForIdleAction,
  renderDesktopCuuCatLive2DForMotion,
  resolveDesktopCuuCatLive2DBehaviorState,
  setDesktopCuuCatLive2DBehaviorState,
  type DesktopCuuCatLive2DRender
} from "./cuu-cat-live2d-runtime.js";
import { writeDesktopPetQaDomSnapshot } from "./cuu-qa-dom-report.js";
import { readDesktopClientToken } from "./desktop-client-token.js";
import { readDesktopConnectionState, resolveDesktopTauriInvoke } from "./desktop-window-controls.js";
import { liquidGlassHeadHtml } from "./liquid-glass.js";
import {
  liquidGlassFilterCss,
  liquidGlassFilterHtml,
  renderWorkHubLiquidGlassLayer,
  scheduleWorkHubLiquidGlassFilterRebuild
} from "./liquid-glass-filter.js";
import {
  desktopPetSettingsPayloadFromPreferences,
  desktopPetSettingsPreferencesFromPayload,
  loadCuuPreferences,
  saveCuuPreferences,
  type DesktopPetSettingsPayload
} from "./cuu-preferences.js";
import {
  bindDesktopShellCuuRuntime,
  cardFromDesktopCuuRuntimeError,
  createDesktopCuuAnalysisCard,
  createDesktopCuuAgentLauncherCard,
  decideDesktopCuuAbortConfirmation,
  loadDesktopCuuProjectContext,
  resolveDesktopCuuAction,
  resolveDesktopShellEmitter,
  resolveDesktopShellListen,
  subscribeDesktopCuuAgentRunStream,
  submitDesktopCuuAction,
  type DesktopCuuActionRequest,
  type DesktopCuuNotice,
  type DesktopCuuRunStreamStatus,
  type DesktopCuuRunStreamSubscription,
  type DesktopShellEmitter,
  type DesktopShellListen,
  type DesktopShellUnlisten
} from "./desktop-cuu-runtime.js";
import { createDesktopPetQaShellListenFromGlobal, desktopPetQaScenarioFromGlobal } from "./cuu-qa-scenarios.js";
import {
  createDesktopPetPointerSensor,
  desktopPetPointerSnapshotFromSample,
  desktopPetWindowModeForCard,
  desktopPetWindowSettingsFromPreferences,
  normalizeDesktopPetPointerSnapshot,
  resolveDesktopPetWindowBridge,
  type DesktopPetPointerSensor,
  type DesktopPetPointerSnapshot,
  type DesktopPetWindowBridge,
  type DesktopPetWindowMode,
  type DesktopPetWindowSettings
} from "./pet-window-bridge.js";
import { parseWorkbenchDeepLinkHref } from "./workbench/cuu-bubble-deeplink.js";
import { openWorkbenchRouteFromPet } from "./workbench/cuu-bubble-open.js";
import {
  parseDesktopShellConnectionChangedPayload,
  type DesktopShellConnectionChangedPayload,
  type DesktopShellSystemNotificationPlan,
  primeDesktopConnectionState
} from "./shell-events.js";

import { desktopT } from "./locales.js";

export type DesktopSurface = "main" | "pet";

export type DesktopPetSurfaceRender = {
  html: string;
  css: string;
  live2d: DesktopCuuCatLive2DRender;
  visual_mode: "live2d_cat";
};

export type DesktopPetSurfaceRuntime = {
  controller: CuuController;
  idleScheduler: CuuIdleScheduler;
  pointerSensor?: DesktopPetPointerSensor;
  subscribed: boolean;
  dispose: () => Promise<void>;
};

export type DesktopPetSurfaceClient = ReturnType<typeof createApiClient>;

export const desktopPetRunRestoreStorageKey = "workhub.cuu.currentRun.v1";

export type DesktopPetRuntimeSetCard = (
  card: CuuCard | undefined,
  message?: string | undefined,
  options?: { persist?: boolean }
) => void;

export type DesktopPetRuntimeDecision = {
  reason: CuuControllerDecision["reason"];
  snapshot: {
    active_card?: CuuCard;
  };
};

export function handleDesktopPetRuntimeNotice(
  notice: DesktopCuuNotice,
  setCard: DesktopPetRuntimeSetCard
) {
  setCard(notice.card, undefined, { persist: !notice.card.id.startsWith("sse-status:") });
}

export function handleDesktopPetRuntimeDecision(
  decision: DesktopPetRuntimeDecision,
  setCard: DesktopPetRuntimeSetCard
) {
  if (decision.reason === "dismissed_current" && !decision.snapshot.active_card) {
    setCard(undefined);
    return true;
  }
  return false;
}

type DesktopPetRestoreState =
  | {
      version: 1;
      entity_type: "agent_run";
      entity_id: string;
      href?: string | undefined;
      updated_at_ms: number;
    }
  | {
      version: 1;
      entity_type: "session";
      entity_id: string;
      href?: string | undefined;
      card: CuuCard;
      updated_at_ms: number;
    };

export const desktopPetSurfaceCss = [
  liquidGlassFilterCss,
  ":root{--wh-pet-font:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"Helvetica Neue\",\"PingFang SC\",\"Noto Sans CJK SC\",Arial,sans-serif;--wh-pet-accent:#0a84ff;--wh-pet-accent-strong:#0066cc;--wh-pet-ink:#1d1d1f;--wh-pet-muted:#6e6e73}",
  "html,body,#root{margin:0;width:100%;height:100%;background:rgba(0,0,0,0)!important;overflow:hidden}",
  "*,*::before,*::after{box-sizing:border-box}",
  "body{font-family:var(--wh-pet-font);color:var(--wh-pet-ink);background:rgba(0,0,0,0)!important}",
  ".wh-pet-surface{position:relative;display:block;box-sizing:border-box;width:var(--wh-pet-window-w,260px);height:var(--wh-pet-window-h,340px);border:0;background:rgba(0,0,0,0)!important;box-shadow:none;pointer-events:none;overflow:hidden;opacity:var(--wh-pet-opacity,1)}",
  ".wh-pet-surface[data-pet-window-mode=card]{width:var(--wh-pet-window-w,520px);height:var(--wh-pet-window-h,720px)}",
  ".wh-pet-body{position:absolute;right:calc(4px * var(--wh-pet-scale,1));bottom:calc(4px * var(--wh-pet-scale,1));width:calc(240px * var(--wh-pet-scale,1));height:calc(320px * var(--wh-pet-scale,1));display:flex;align-items:flex-end;justify-content:center;border:0;background:rgba(0,0,0,0)!important;box-shadow:none;padding:0;margin:0;appearance:none;cursor:grab;pointer-events:none;opacity:var(--wh-pet-hide-opacity,1);transform:translate(calc(var(--wh-pet-avoid-x-px,0px) + var(--wh-pet-hide-x-px,0px)),calc(var(--wh-pet-avoid-y-px,0px) + var(--wh-pet-hide-y-px,0px))) scale(var(--wh-pet-hide-scale,1));transition:transform 160ms ease-out,opacity 160ms ease-out}",
  // R8 穿透修复：命中区从整窗(inset:0,占 94%)收成猫身轮廓(上留 22% 头顶空、左右各留 18% 边)，
  // 配合 .wh-pet-body{pointer-events:none}：只有猫身这块捕获(可点可拖)，四周透明区 elementFromPoint
  // 落到 none 的底层→命中测试判非交互→ignore_cursor_events(true)→点击穿透到下方窗口。
  ".wh-pet-body::after{content:\"\";position:absolute;inset:22% 18% 0 18%;z-index:3;background:rgba(0,0,0,0);pointer-events:auto}",
  ".wh-pet-body:active{cursor:grabbing}",
  ".wh-pet-surface[data-pet-hovered=true] .wh-pet-body{cursor:pointer}",
  ".wh-pet-surface[data-pet-dragging=true] .wh-pet-body{cursor:grabbing}",
  ".wh-pet-surface[data-pet-hover-avoidance=soft]:not([data-pet-dragging=true]) .wh-pet-body{transition-duration:120ms}",
  ".wh-pet-surface[data-pet-hover-hidden=true] .wh-pet-body{transition-duration:140ms}",
  // 气泡本体就是磨砂白玻璃卡：半透白渐变底 + backdrop blur 给真实毛玻璃，深色字直接读在白底上。
  // (透明窗口里 backdrop-filter 没东西可糊，所以磨砂靠这层不透明白底兜底；warp/rim 折射层在气泡内关掉。)
  ".wh-pet-bubble{position:absolute;right:calc(254px * var(--wh-pet-scale,1));bottom:calc(36px * var(--wh-pet-scale,1));box-sizing:border-box;width:min(286px,calc(100vw - 254px));min-width:0;display:block;font-family:var(--wh-pet-font);border:1px solid rgba(255,255,255,.7);border-radius:24px;background:linear-gradient(135deg,rgba(255,255,255,.82),rgba(255,255,255,.52));box-shadow:0 24px 64px -26px rgba(31,35,53,.42),inset 0 1px 0 rgba(255,255,255,.75);padding:11px 13px;pointer-events:none;overflow:hidden;backdrop-filter:blur(40px) saturate(185%);-webkit-backdrop-filter:blur(40px) saturate(185%);overflow-wrap:anywhere;word-break:break-word}",
  ".wh-pet-bubble>.wh-liquid-glass-warp,.wh-pet-bubble>.wh-liquid-glass-rim{display:none}",
  ".wh-pet-bubble>.wh-liquid-glass-content{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}",
  // R7.1 桌宠穿透修复：气泡/卡片容器本身改 pointer-events:none —— 浅蓝空白处的点击直接穿透到下方窗口
  // （之前整块 auto 把报价单挡住）。只有真正可点的子元素重新 auto：按钮 / 动作链接 / 选项 / 理由 / 输入框。
  // 惰性 <span class=wh-pet-chip|wh-pet-action> 标签不匹配 → 保持穿透；猫(.wh-pet-body)与右键菜单(.wh-pet-menu)
  // 是气泡的兄弟节点、不受影响。命中测试 closest 仍含 .wh-pet-bubble：落在按钮上时 closest 为真→接管，
  // 落在空白(now none)上时 elementFromPoint 穿过气泡返回透明底→closest 为 null→穿透。
  ".wh-pet-bubble button,.wh-pet-bubble a[data-cuu-action-id],.wh-pet-bubble [data-pet-option-id],.wh-pet-bubble [data-pet-reason],.wh-pet-bubble [data-pet-free-text]{pointer-events:auto}",
  // Cuu card content can update frequently while an agent is running; opacity animation on each
  // DOM replacement makes the glass surface flash. Keep geometry stable and let content update in place.
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-body{right:calc(72px * var(--wh-pet-scale,1));bottom:calc(48px * var(--wh-pet-scale,1));width:calc(240px * var(--wh-pet-scale,1));height:calc(320px * var(--wh-pet-scale,1))}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-bubble{left:calc(88px * var(--wh-pet-scale,1));right:auto;top:auto;bottom:calc(392px * var(--wh-pet-scale,1));width:calc(300px * var(--wh-pet-scale,1));max-width:calc(100% - calc(128px * var(--wh-pet-scale,1)));max-height:calc(268px * var(--wh-pet-scale,1));overflow:hidden;padding:12px 14px}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-bubble[data-pet-bubble-kind=bubble],.wh-pet-surface[data-pet-window-mode=card] .wh-pet-bubble[data-pet-bubble-kind=offline],.wh-pet-surface[data-pet-window-mode=card] .wh-pet-bubble[data-pet-bubble-kind=trace]{min-height:calc(268px * var(--wh-pet-scale,1))}",
  ".wh-pet-surface[data-pet-window-mode=card][data-pet-card-has-context=true] .wh-pet-bubble{left:calc(72px * var(--wh-pet-scale,1));right:auto;bottom:calc(380px * var(--wh-pet-scale,1));width:calc(328px * var(--wh-pet-scale,1));max-width:calc(100% - calc(104px * var(--wh-pet-scale,1)));min-height:0;max-height:calc(336px * var(--wh-pet-scale,1));overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin;pointer-events:auto;gap:6px;padding:10px 12px 12px}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-title{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-message{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-card-has-context=true] .wh-pet-title{-webkit-line-clamp:2;font-size:13px;line-height:1.28}",
  ".wh-pet-surface[data-pet-card-has-context=true] .wh-pet-message{-webkit-line-clamp:2;font-size:11px;line-height:1.35}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-actions{max-width:100%}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-body{right:calc(4px * var(--wh-pet-scale,1));bottom:calc(4px * var(--wh-pet-scale,1));width:calc(156px * var(--wh-pet-scale,1));height:calc(218px * var(--wh-pet-scale,1))}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-bubble{left:auto;right:calc(8px * var(--wh-pet-scale,1));top:auto;bottom:calc(224px * var(--wh-pet-scale,1));width:calc(150px * var(--wh-pet-scale,1));max-height:calc(86px * var(--wh-pet-scale,1));overflow:hidden;gap:5px;padding:7px 8px}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-title{font-size:12px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-kicker,.wh-pet-surface[data-pet-card-layout=compact] .wh-pet-status{font-size:10px}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-status{line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-action{font-size:11px;padding:5px 7px;max-width:112px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  // R26 真机验收（W-QA，连接状态单一真相那一批）：「没有卡片、只有状态文本」的紧凑气泡——连接状态提示
  // （desktopPetConnectionStatusText 产出的「连不上服务器 <地址> · 重连中（第 N 次）/ 已离线」）走的就是
  // 这条路径——此前与"带卡片的紧凑气泡"共用上面那条 86px*scale 上限 + 2 行钳制。真机实测（75% 缩放）
  // 这一行需要 3 行才排得下：服务器地址被 "…" 截掉、"· 重连中（第 N 次）/已离线"整段看不见，重连中与
  // 已离线两态在屏幕上一模一样，用户无从判断。
  // 只放宽这一种气泡（`:not([data-pet-bubble-kind])` —— 有卡片时那个属性必然存在，见 renderPetBubble）：
  // 上限改成"气泡底边到窗口顶边之间的可用高度"，跟着 --wh-pet-scale 与窗口高度自适应，任何缩放档
  // （75/100/125/150）下都不越窗；行数钳制同步放到 4 行。窗口尺寸仍由 body_only（260×340）钉死，
  // 一个像素都没碰——L-06 的根治点在那里，不在这里。
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-bubble:not([data-pet-bubble-kind]){max-height:calc(100% - calc(232px * var(--wh-pet-scale,1)))}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-bubble:not([data-pet-bubble-kind]) .wh-pet-status{-webkit-line-clamp:4}",
  ".wh-pet-bubble .wh-liquid-glass-content>*{min-width:0;max-width:100%}",
  "@keyframes wh-pet-bubble-in{from{opacity:0}to{opacity:1}}",
  ".wh-pet-bubble{animation:wh-pet-bubble-in .34s ease-out both}",
  "@media (prefers-reduced-motion:reduce){.wh-pet-bubble{animation:none!important}}",
  ".wh-pet-surface[data-pet-suppress-bubble-intro=true] .wh-pet-bubble{animation:none}",
  ".wh-pet-kicker{display:flex;align-items:center;gap:7px;color:#667085;font-size:11px;font-weight:800;min-width:0;max-width:100%;flex-wrap:wrap}",
  // 普通用户审查 R2：每张卡给「知道了」退路——不许猫被一张卡占住没法脱身。
  ".wh-pet-dismiss{margin-left:auto;border:1px solid rgba(60,60,67,.16);border-radius:999px;background:rgba(255,255,255,.92);color:#667085;width:18px;height:18px;line-height:1;font-size:12px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}",
  ".wh-pet-dot{width:8px;height:8px;border-radius:999px;background:#ff9d58;box-shadow:0 0 0 3px rgba(255,157,88,.18)}",
  ".wh-pet-emotion{max-width:100%;color:#475467;font-size:10px;line-height:1;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  // 气泡直接复用聚焦盒(.wh-spot)的玻璃配方：同样的半透白底/亮描边/投影/blur。语气不再改底色或描边色，
  // 只留圆点 + 表情文字色做语义提示，避免出现暖奶油底 + 黄描边那种和搜索框割裂的画风。
  ".wh-pet-bubble[data-pet-bubble-tone=approval] .wh-pet-emotion{color:#a15c07}",
  ".wh-pet-bubble[data-pet-bubble-tone=approval] .wh-pet-dot{background:#e0892a;box-shadow:0 0 0 3px rgba(224,137,42,.18)}",
  ".wh-pet-bubble[data-pet-bubble-tone=search] .wh-pet-emotion{color:#1f6fb2}",
  ".wh-pet-bubble[data-pet-bubble-tone=search] .wh-pet-dot{background:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.18)}",
  ".wh-pet-bubble[data-pet-bubble-emotion=celebrating] .wh-pet-emotion{color:#15a05a}",
  ".wh-pet-bubble[data-pet-bubble-emotion=worried] .wh-pet-emotion{color:#b42318}",
  ".wh-pet-kind,.wh-pet-priority{max-width:100%;border:1px solid rgba(38,49,70,.12);border-radius:8px;background:#fff;padding:3px 6px;color:#344054;font-size:10px;line-height:1;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-pet-priority[data-priority=urgent],.wh-pet-priority[data-priority=high]{background:#fff4f3;border-color:rgba(238,107,95,.28);color:#b42318}",
  ".wh-pet-title{min-width:0;max-width:100%;width:100%;font-size:14px;line-height:1.35;font-weight:850;overflow-wrap:anywhere;word-break:break-word;white-space:normal}",
  ".wh-pet-message{min-width:0;max-width:100%;width:100%;margin:0;color:#667085;font-size:12px;line-height:1.45;font-weight:650;overflow-wrap:anywhere;word-break:break-word;white-space:normal}",
  ".wh-pet-context{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;min-width:0;max-width:100%;width:100%}",
  ".wh-pet-progress{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:0;padding:0;list-style:none;min-width:0;max-width:100%;width:100%}",
  ".wh-pet-progress-step{display:grid;gap:3px;min-width:0;color:#98a2b3;font-size:9px;font-weight:850;line-height:1.15}",
  ".wh-pet-progress-dot{height:4px;border-radius:8px;background:rgba(152,162,179,.24)}",
  ".wh-pet-progress-step[data-state=done] .wh-pet-progress-dot,.wh-pet-progress-step[data-state=active] .wh-pet-progress-dot{background:var(--wh-pet-accent)}",
  ".wh-pet-progress-step[data-state=active]{color:#344054}",
  ".wh-pet-progress-label{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-pet-section{display:grid;grid-template-columns:minmax(0,1fr);gap:3px;border-top:1px solid rgba(38,49,70,.1);padding-top:7px;min-width:0;max-width:100%;width:100%}",
  ".wh-pet-section-title,.wh-pet-evidence-title,.wh-pet-input-hint{min-width:0;max-width:100%;width:100%;color:#344054;font-size:11px;font-weight:900;line-height:1.2;white-space:normal;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-pet-section-line,.wh-pet-evidence-item{min-width:0;max-width:100%;width:100%;color:#667085;font-size:11px;font-weight:700;line-height:1.35;overflow-wrap:anywhere;word-break:break-word;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-card-has-context=true] .wh-pet-section{gap:2px;padding-top:5px}",
  ".wh-pet-surface[data-pet-card-has-context=true] .wh-pet-section-line,.wh-pet-surface[data-pet-card-has-context=true] .wh-pet-evidence-item{-webkit-line-clamp:1}",
  ".wh-pet-evidence{display:grid;grid-template-columns:minmax(0,1fr);gap:3px;border-top:1px solid rgba(38,49,70,.1);padding-top:7px;min-width:0;max-width:100%;width:100%}",
  ".wh-pet-input-hint{border-top:1px solid rgba(38,49,70,.1);padding-top:7px;color:#667085}",
  ".wh-pet-free-text{box-sizing:border-box;width:100%;min-height:62px;max-height:104px;resize:none;border:1px solid rgba(60,60,67,.14);border-radius:10px;background:rgba(255,255,255,.72);box-shadow:inset 0 1px 0 rgba(255,255,255,.7);padding:8px 9px;color:var(--wh-pet-ink);font:650 12px/1.36 var(--wh-pet-font);outline:none;overflow:auto}",
  ".wh-pet-free-text:focus{border-color:rgba(10,132,255,.44);box-shadow:0 0 0 3px rgba(10,132,255,.13),inset 0 1px 0 rgba(255,255,255,.7)}",
  ".wh-pet-free-text::placeholder{color:#8a93a3}",
  ".wh-pet-surface[data-pet-card-kind=question] .wh-pet-progress{grid-template-columns:repeat(4,16px);width:auto;max-width:88px}",
  ".wh-pet-surface[data-pet-card-kind=question] .wh-pet-progress-label{display:none}",
  ".wh-pet-surface[data-pet-card-kind=question] .wh-pet-input-hint{display:none}",
  ".wh-pet-chips,.wh-pet-actions,.wh-pet-reasons{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start;min-width:0;max-width:100%;width:100%}",
  ".wh-pet-chip,.wh-pet-action,.wh-pet-reason{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:28px;min-width:0;max-width:100%;border:1px solid rgba(60,60,67,.14);border-radius:10px;background:rgba(255,255,255,.72);padding:6px 8px;color:var(--wh-pet-ink);font:760 12px/1.2 var(--wh-pet-font);text-align:left;text-decoration:none;white-space:normal;overflow-wrap:anywhere;word-break:break-word;appearance:none}",
  ".wh-pet-action{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-pet-chip[data-pet-option-first=true]{cursor:pointer;text-align:left}",
  ".wh-pet-chip[data-tone=success]{background:#f0faf6;border-color:rgba(22,163,74,.2);color:#067647}",
  ".wh-pet-chip[data-tone=warning]{background:#fff7ed;border-color:rgba(245,158,11,.26);color:#a15c07}",
  ".wh-pet-chip[data-tone=danger]{background:#fff4f3;border-color:rgba(238,107,95,.34);color:#b42318}",
  ".wh-pet-chip[data-recommended=true]{border-color:rgba(10,132,255,.34);box-shadow:inset 3px 0 0 var(--wh-pet-accent)}",
  ".wh-pet-chip[data-selected=true]{background:rgba(10,132,255,.12);border-color:var(--wh-pet-accent);color:var(--wh-pet-accent-strong)}",
  ".wh-pet-action[data-tone=primary],.wh-pet-reason{background:var(--wh-pet-accent);border-color:var(--wh-pet-accent);color:#fff}",
  // L10：「先不打回」是退路,不是第四个拒绝理由——用安静的白底次要样式，与蓝色理由按钮区分开。
  ".wh-pet-reason--cancel{background:#fff;border-color:rgba(38,49,70,.14);color:#5b6472;font-weight:700}",
  ".wh-pet-action[data-tone=danger]{background:#fff4f3;border-color:rgba(238,107,95,.34);color:#b42318}",
  ".wh-pet-status{min-width:0;max-width:100%;width:100%;margin:0;color:#344054;font-size:12px;line-height:1.45;font-weight:750;overflow-wrap:anywhere;word-break:break-word;white-space:normal}",
  // 气泡是磨砂白底，正文走原本的深色(kicker/message #667085、status/section #344054…)；不再强制白字+黑描边。
  ".wh-pet-menu{position:absolute;right:88px;bottom:72px;z-index:8;box-sizing:border-box;width:164px;display:grid;gap:8px;border:1px solid rgba(255,255,255,.6);border-radius:14px;background:rgba(255,255,255,.92);box-shadow:0 18px 48px -18px rgba(31,35,53,.34),inset 0 1px 0 rgba(255,255,255,.8);padding:10px;pointer-events:auto;backdrop-filter:blur(30px) saturate(180%);-webkit-backdrop-filter:blur(30px) saturate(180%);overflow:hidden}",
  ".wh-pet-menu[hidden]{display:none}",
  ".wh-pet-menu-title{font-size:12px;line-height:1.2;font-weight:900;color:#222b38}",
  ".wh-pet-menu-group{display:grid;gap:5px;min-width:0}",
  ".wh-pet-menu-label{font-size:10px;line-height:1.1;font-weight:900;color:#667085;text-transform:uppercase}",
  ".wh-pet-menu-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;min-width:0}",
  ".wh-pet-menu button{min-width:0;max-width:100%;border:1px solid rgba(60,60,67,.14);border-radius:10px;background:rgba(255,255,255,.72);color:var(--wh-pet-ink);padding:6px 8px;font:760 11px/1.15 var(--wh-pet-font);cursor:pointer;min-height:28px;white-space:normal;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-pet-menu-row button{width:auto;min-width:0;flex:1 1 0;padding-left:6px;padding-right:6px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-pet-menu button[aria-pressed=true]{border-color:rgba(10,132,255,.34);background:rgba(10,132,255,.12);color:var(--wh-pet-accent-strong);box-shadow:inset 3px 0 0 var(--wh-pet-accent)}",
  ".wh-pet-menu button[data-pet-menu-danger=true]{background:#fff4f3;border-color:rgba(238,107,95,.3);color:#b42318}",
  ".wh-pet-menu-action{width:100%;text-align:left}"
].join("");

export const desktopPetInitialIdleAction: CuuIdleMicroAction = "idle_tail_sway";
export const desktopPetPointerSmoothingAlpha = 0.58;

export const desktopPetAliveIdlePolicy = {
  breathe_interval_ms: [2800, 4200],
  blink_interval_ms: [1200, 1800],
  tail_interval_ms: [2200, 3200],
  look_interval_ms: [3200, 4600],
  sleep_after_ms: 5 * 60 * 1000,
  sleeping_loop_interval_ms: 12000
} satisfies Partial<CuuIdleSchedulerPolicy>;

export type DesktopPetFirstPaintClock = {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  setTimeout?: (callback: () => void, timeout: number) => number;
  clearTimeout?: (handle: number) => void;
};

export function scheduleDesktopPetFirstPaint(
  callback: () => void,
  clock: DesktopPetFirstPaintClock = globalThis as DesktopPetFirstPaintClock
): () => void {
  let cancelled = false;
  const run = () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    callback();
  };
  const timeout = clock.setTimeout?.(run, 64);
  const raf = clock.requestAnimationFrame;

  if (raf) {
    raf(() => {
      raf(run);
    });
  }

  return () => {
    cancelled = true;
    if (timeout !== undefined) {
      clock.clearTimeout?.(timeout);
    }
  };
}

export function createDesktopPetIdleScheduler(now_ms = Date.now()): CuuIdleScheduler {
  return createCuuIdleScheduler({
    now_ms,
    policy: desktopPetAliveIdlePolicy
  });
}

export function resolveDesktopSurface(input: { pathname?: string; search?: string; hash?: string } = {}): DesktopSurface {
  const target = globalThis as typeof globalThis & {
    __WORKHUB_SURFACE__?: string;
    __TAURI__?: {
      window?: { getCurrentWindow?: () => { label?: string } };
      webviewWindow?: { getCurrentWebviewWindow?: () => { label?: string } };
    };
    location?: Location;
  };
  const pathname = input.pathname ?? target.location?.pathname ?? "/";
  const search = input.search ?? target.location?.search ?? "";
  const hash = input.hash ?? target.location?.hash ?? "";
  const surface = new URLSearchParams(search).get("surface");
  return target.__WORKHUB_SURFACE__ === "pet" ||
    currentTauriWindowLabel(target) === "pet" ||
    surface === "pet" ||
    hash === "#surface=pet" ||
    pathname === "/pet"
    ? "pet"
    : "main";
}

function currentTauriWindowLabel(target: {
  __TAURI__?: {
    window?: { getCurrentWindow?: () => { label?: string } };
    webviewWindow?: { getCurrentWebviewWindow?: () => { label?: string } };
  };
}) {
  try {
    return target.__TAURI__?.window?.getCurrentWindow?.()?.label ??
      target.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.()?.label;
  } catch {
    return undefined;
  }
}

export function renderDesktopPetSurface(input: {
  card?: CuuCard | undefined;
  idle_action?: CuuIdleMicroAction | undefined;
  status_text?: string | undefined;
  include_reject_reasons?: boolean | undefined;
  display_width_px?: number | undefined;
  pet_window_settings?: DesktopPetWindowSettings | undefined;
  pointer_snapshot?: DesktopPetPointerSnapshot | undefined;
  pointer_smoothing_alpha?: number | undefined;
  window_mode_error?: string | undefined;
  window_mode_status?: "syncing" | "failed" | undefined;
  requested_model_pack_id?: string | undefined;
  suppress_bubble_intro?: boolean | undefined;
  locale?: CuuLocaleOptions["locale"];
} = {}): DesktopPetSurfaceRender {
  const locale = input.locale ?? desktopPetLocale();
  const card = normalizeDesktopPetCard(input.card, locale);
  const compactStatusOnly = !card && Boolean(input.status_text);
  const compactCard = Boolean(card && input.window_mode_error) || compactStatusOnly;
  const windowMode = compactCard
    ? "body_only"
    : desktopPetWindowModeForCard(card, { requested_model_pack_id: input.requested_model_pack_id });
  const settings = input.pet_window_settings ?? defaultDesktopPetWindowSettings();
  const pointer = normalizeDesktopPetPointerSnapshot(input.pointer_snapshot ?? defaultDesktopPetPointerSnapshot());
  const pointerSmoothingAlpha = input.pointer_smoothing_alpha ?? desktopPetPointerSmoothingAlpha;
  const scaleRatio = settings.scale_percent / 100;
  const hoverHidden = settings.hide_on_hover && pointer.hovered && !pointer.dragging && windowMode === "body_only" && !card;
  const hideX = hoverHidden ? (pointer.avoidance_x || -0.45) * 42 * scaleRatio : 0;
  const hideY = hoverHidden ? (pointer.avoidance_y || 0.24) * 24 * scaleRatio : 0;
  const avoidX = hoverHidden ? pointer.avoidance_x * 22 * scaleRatio : 0;
  const avoidY = hoverHidden ? pointer.avoidance_y * 12 * scaleRatio : 0;
  const baseWindowSize = petWindowSize(windowMode);
  const scaledWindowSize = {
    width: Math.round(baseWindowSize.width * scaleRatio),
    height: Math.round(baseWindowSize.height * scaleRatio)
  };
  const motion = desktopPetVisibleMotion(card?.motion ?? cuuMotionForState("idle"), {
    has_card: Boolean(card),
    compact_card: compactCard
  }, locale);
  const displayWidth = input.display_width_px ?? Math.round((compactCard ? 150 : 230) * scaleRatio);
  const live2d = card
    ? renderDesktopCuuCatLive2DForMotion(motion, {
        display_width_px: displayWidth,
        requested_model_pack_id: input.requested_model_pack_id
      })
    : renderDesktopCuuCatLive2DForIdleAction(input.idle_action ?? "idle_breathe", {
        display_width_px: displayWidth,
        requested_model_pack_id: input.requested_model_pack_id
      });
  const visualMode = "live2d_cat";
  const suppressTransientCompactBubble = compactCard && input.window_mode_status === "syncing";
  const bubble = !suppressTransientCompactBubble && (card || input.status_text || input.include_reject_reasons)
    ? renderDesktopPetBubble({
        card,
        status_text: input.status_text,
        include_reject_reasons: input.include_reject_reasons,
        compact: compactCard,
        window_mode_error: input.window_mode_error
      }, locale)
    : "";
  const menu = renderDesktopPetSettingsMenu({
    locale,
    requested_model_pack_id: input.requested_model_pack_id,
    hide_on_hover: settings.hide_on_hover
  });
  const cardAttrs = card
    ? ` data-pet-card-kind="${escapeHtml(card.kind)}" data-pet-card-priority="${escapeHtml(card.priority)}" data-pet-card-has-context="${petCardHasContext(card) ? "true" : "false"}"`
    : "";
  const surfaceStyle = [
    `--wh-pet-scale:${scaleRatio}`,
    `--wh-pet-opacity:${settings.opacity_percent / 100}`,
    `--wh-pet-window-w:${scaledWindowSize.width}px`,
    `--wh-pet-window-h:${scaledWindowSize.height}px`,
    `--wh-pet-look-x:${formatPointerNumber(pointer.look_x)}`,
    `--wh-pet-look-y:${formatPointerNumber(pointer.look_y)}`,
    `--wh-pet-pointer-smoothing-alpha:${formatPointerNumber(pointerSmoothingAlpha)}`,
    `--wh-pet-avoid-x:${formatPointerNumber(pointer.avoidance_x)}`,
    `--wh-pet-avoid-y:${formatPointerNumber(pointer.avoidance_y)}`,
    `--wh-pet-avoid-x-px:${formatPointerNumber(avoidX)}px`,
    `--wh-pet-avoid-y-px:${formatPointerNumber(avoidY)}px`,
    `--wh-pet-hide-x-px:${formatPointerNumber(hideX)}px`,
    `--wh-pet-hide-y-px:${formatPointerNumber(hideY)}px`,
    `--wh-pet-hide-scale:${hoverHidden ? "0.92" : "1"}`,
    `--wh-pet-hide-opacity:${hoverHidden ? "0.36" : "1"}`,
    `--wh-pet-look-head-x-px:${formatPointerNumber(pointer.look_x * 9 * scaleRatio)}px`,
    `--wh-pet-look-head-y-px:${formatPointerNumber(pointer.look_y * 4 * scaleRatio)}px`,
    `--wh-pet-look-eye-x-px:${formatPointerNumber(pointer.look_x * 9 * scaleRatio)}px`,
    `--wh-pet-look-eye-y-px:${formatPointerNumber(pointer.look_y * 4 * scaleRatio)}px`,
    `--wh-pet-look-face-x-px:${formatPointerNumber(pointer.look_x * 4 * scaleRatio)}px`,
    `--wh-pet-look-face-y-px:${formatPointerNumber(pointer.look_y * 2 * scaleRatio)}px`,
    `--wh-pet-look-rotate-deg:${formatPointerNumber(pointer.look_x * 5)}deg`
  ].join(";");

  return {
    live2d,
    visual_mode: visualMode,
    css: `${desktopPetSurfaceCss}${live2d.css}`,
    html: `<section class="wh-pet-surface" style="${surfaceStyle}" data-wh-surface="pet" data-pet-window-mode="${windowMode}" data-pet-card-layout="${compactCard ? "compact" : input.card ? "full" : "body"}" data-pet-scale-percent="${settings.scale_percent}" data-pet-opacity-percent="${settings.opacity_percent}" data-pet-pass-through="${settings.pass_through ? "true" : "false"}" data-pet-hide-on-hover="${settings.hide_on_hover ? "true" : "false"}" data-pet-hover-hidden="${hoverHidden ? "true" : "false"}" data-pet-hover-hide-mode="${settings.hide_on_hover ? "soft" : "off"}" data-pet-window-width="${scaledWindowSize.width}" data-pet-window-height="${scaledWindowSize.height}" data-pet-cursor-near="${pointer.cursor_near ? "true" : "false"}" data-pet-hovered="${pointer.hovered ? "true" : "false"}" data-pet-dragging="${pointer.dragging ? "true" : "false"}" data-pet-look-x="${formatPointerNumber(pointer.look_x)}" data-pet-look-y="${formatPointerNumber(pointer.look_y)}" data-pet-hover-avoidance="${pointer.hover_avoidance}" data-pet-pointer-smoothing-alpha="${formatPointerNumber(pointerSmoothingAlpha)}" data-pet-suppress-bubble-intro="${input.suppress_bubble_intro ? "true" : "false"}"${pointer.last_pointer_ms !== undefined ? ` data-pet-last-pointer-ms="${escapeHtml(pointer.last_pointer_ms)}"` : ""}${cardAttrs}${input.window_mode_status ? ` data-pet-window-mode-status="${escapeHtml(input.window_mode_status)}"` : ""}${input.window_mode_error ? ` data-pet-window-mode-error="${escapeHtml(input.window_mode_error)}"` : ""} data-cuu-state="${escapeHtml(motion.state)}" data-cuu-idle-action="${escapeHtml(input.idle_action ?? "idle_breathe")}" data-cuu-visual-mode="${visualMode}" data-cuu-live2d-runtime="${escapeHtml(live2d.runtime_kind)}" data-cuu-live2d-status="${escapeHtml(live2d.status)}" data-cuu-live2d-model="${escapeHtml(live2d.model_key)}" data-cuu-live2d-appearance="${escapeHtml(live2d.appearance)}" data-cuu-live2d-motion="${escapeHtml(live2d.motion_state)}" data-cuu-live2d-renderer-state="${escapeHtml(live2d.renderer_state)}" data-cuu-live2d-layer-count="native_moc" data-cuu-behavior-manifest-version="${live2d.behavior_manifest_version}" data-cuu-behavior-state="${escapeHtml(live2d.behavior_state)}" data-cuu-behavior-phase="${escapeHtml(live2d.behavior_phase)}" data-cuu-behavior-coverage="${escapeHtml(live2d.behavior_coverage)}" data-cuu-behavior-priority="${escapeHtml(live2d.behavior_priority)}" data-cuu-behavior-expected-window-mode="${escapeHtml(live2d.behavior_window_mode)}" data-cuu-behavior-expected-bubble-mode="${escapeHtml(live2d.behavior_bubble_mode)}" data-cuu-live2d-frame-url="${escapeHtml(live2d.iframe_url)}" data-cuu-live2d-model-url="${escapeHtml(live2d.model_url)}" data-cuu-model-pack="${escapeHtml(live2d.model_pack_id)}" data-cuu-model-pack-selection-reason="${escapeHtml(live2d.model_pack_selection_reason)}">
      <button class="wh-pet-body" type="button" data-pet-drag-handle="true" aria-label="${escapeHtml(cuuT(locale, "pet.aria"))}" title="${escapeHtml(locale === "en-US" ? "Right-click for settings" : "右键打开桌宠设置")}">
        ${live2d.html}
      </button>
      ${menu}
      ${bubble}
    </section>`
  };
}

export function desktopPetLocale(input?: unknown): WorkHubLocale {
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
    localStorage?: Storage;
    navigator?: Navigator;
  };
  return normalizeWorkHubLocale(
    input
    ?? target.__WORKHUB_CUU_QA_LOCALE__
    ?? target.localStorage?.getItem(workHubLocaleStorageKey)
    ?? target.navigator?.language
  );
}

export function replaceDesktopPetRootHtmlPreservingLive2DFrame(root: HTMLElement, html: string) {
  const previousFrame = root.querySelector<HTMLIFrameElement>(".wh-cuu-cat-live2d-frame");
  const previousFrameSrc = previousFrame?.getAttribute("src");
  root.innerHTML = html;
  const nextFrame = root.querySelector<HTMLIFrameElement>(".wh-cuu-cat-live2d-frame");
  if (
    previousFrame &&
    previousFrameSrc &&
    nextFrame &&
    previousFrameSrc === nextFrame.getAttribute("src") &&
    typeof nextFrame.replaceWith === "function"
  ) {
    nextFrame.replaceWith(previousFrame);
    return true;
  }
  return false;
}

function renderDesktopPetSettingsMenu(input: {
  locale: WorkHubLocale;
  requested_model_pack_id?: string | undefined;
  hide_on_hover: boolean;
}) {
  const copy = desktopPetSettingsMenuCopy[input.locale];
  const selectedModel = input.requested_model_pack_id === "cuu-tororo-live2d-cubism2"
    ? "cuu-tororo-live2d-cubism2"
    : "cuu-hijiki-live2d-cubism2";
  const modelButton = (id: "cuu-hijiki-live2d-cubism2" | "cuu-tororo-live2d-cubism2", label: string) =>
    `<button type="button" data-pet-menu-model="${id}" aria-pressed="${selectedModel === id ? "true" : "false"}">${escapeHtml(label)}</button>`;
  const localeButton = (locale: WorkHubLocale, label: string) =>
    `<button type="button" data-pet-menu-locale="${locale}" aria-pressed="${input.locale === locale ? "true" : "false"}">${escapeHtml(label)}</button>`;

  return `<nav class="wh-pet-menu" data-pet-settings-menu="true" aria-label="${escapeHtml(copy.aria)}" hidden>
    <div class="wh-pet-menu-title">${escapeHtml(copy.title)}</div>
    <div class="wh-pet-menu-group">
      <div class="wh-pet-menu-label">${escapeHtml(copy.model)}</div>
      <div class="wh-pet-menu-row">
        ${modelButton("cuu-hijiki-live2d-cubism2", copy.blackCat)}
        ${modelButton("cuu-tororo-live2d-cubism2", copy.whiteCat)}
      </div>
    </div>
    <div class="wh-pet-menu-group">
      <div class="wh-pet-menu-label">${escapeHtml(copy.language)}</div>
      <div class="wh-pet-menu-row">
        ${localeButton("zh-CN", "中文")}
        ${localeButton("en-US", "EN")}
      </div>
    </div>
    <div class="wh-pet-menu-group">
      <button type="button" class="wh-pet-menu-action" data-pet-menu-toggle-hover="true" aria-pressed="${input.hide_on_hover ? "true" : "false"}">${escapeHtml(copy.hideOnHover)}</button>
      <button type="button" class="wh-pet-menu-action" data-pet-menu-open-settings="true">${escapeHtml(copy.openSettings)}</button>
      <button type="button" class="wh-pet-menu-action" data-pet-menu-hide="true" data-pet-menu-danger="true">${escapeHtml(copy.hideCuu)}</button>
    </div>
  </nav>`;
}

const desktopPetSettingsMenuCopy = {
  "zh-CN": {
    aria: "Cuu 桌宠设置菜单",
    title: "Cuu 设置",
    model: "形象",
    blackCat: "黑猫",
    whiteCat: "白猫",
    language: "语言",
    hideOnHover: "悬停避让",
    openSettings: "打开设置",
    hideCuu: "隐藏 Cuu",
    modelChanged: "Cuu 形象已更新。",
    localeChanged: "语言已更新。",
    localeChangeFailed: "语言没保存到服务端，已恢复原语言。",
    hoverEnabled: "悬停避让已开启。",
    hoverDisabled: "悬停避让已关闭。",
    openSettingsFallback: "请从托盘打开设置。",
    hideFallback: "请从托盘隐藏 Cuu。",
    restoredFromTray: "已恢复交互。"
  },
  "en-US": {
    aria: "Cuu desktop pet settings menu",
    title: "Cuu settings",
    model: "Look",
    blackCat: "Black cat",
    whiteCat: "White cat",
    language: "Language",
    hideOnHover: "Dodge hover",
    openSettings: "Open settings",
    hideCuu: "Hide Cuu",
    modelChanged: "Cuu look updated.",
    localeChanged: "Language updated.",
    localeChangeFailed: "Couldn't save the language — reverted.",
    hoverEnabled: "Dodge hover is on.",
    hoverDisabled: "Dodge hover is off.",
    openSettingsFallback: "Open settings from the tray.",
    hideFallback: "Hide Cuu from the tray.",
    restoredFromTray: "Interaction restored."
  }
} as const;

function setPetSettingsMenuOpen(root: HTMLElement, open: boolean) {
  const surface = root.querySelector<HTMLElement>("[data-wh-surface=pet]");
  const menu = root.querySelector<HTMLElement>("[data-pet-settings-menu]");
  if (!surface || !menu) {
    return;
  }
  menu.hidden = !open;
  const transientBubble = root.querySelector<HTMLElement>("[data-pet-bubble][data-pet-bubble-transient=true]");
  if (transientBubble) {
    transientBubble.hidden = open;
  }
  surface.dataset.petMenuOpen = open ? "true" : "false";
  writeDesktopPetQaDomSnapshot(root, "patch");
}

function desktopTrayActionId(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

export function defaultDesktopPetWindowSettings(): DesktopPetWindowSettings {
  return {
    scale_percent: 100,
    opacity_percent: 100,
    pass_through: false,
    hide_on_hover: false
  };
}

export function defaultDesktopPetPointerSnapshot(): DesktopPetPointerSnapshot {
  return normalizeDesktopPetPointerSnapshot({});
}

function patchDesktopPetSurfaceRuntimeState(
  root: HTMLElement,
  input: {
    idle_action: CuuIdleMicroAction;
    card?: CuuCard | undefined;
    pet_window_settings: DesktopPetWindowSettings;
    pointer_snapshot: DesktopPetPointerSnapshot;
    pointer_smoothing_alpha: number;
  }
): boolean {
  const surface = root.querySelector<HTMLElement>(".wh-pet-surface");
  if (!surface) {
    return false;
  }
  const settings = input.pet_window_settings;
  const pointer = normalizeDesktopPetPointerSnapshot(input.pointer_snapshot);
  const scaleRatio = settings.scale_percent / 100;
  const windowMode = surface.dataset.petWindowMode === "card" ? "card" : "body_only";
  const hoverHidden = settings.hide_on_hover && pointer.hovered && !pointer.dragging && windowMode === "body_only" && !input.card;
  const hideX = hoverHidden ? (pointer.avoidance_x || -0.45) * 42 * scaleRatio : 0;
  const hideY = hoverHidden ? (pointer.avoidance_y || 0.24) * 24 * scaleRatio : 0;
  const avoidX = hoverHidden ? pointer.avoidance_x * 22 * scaleRatio : 0;
  const avoidY = hoverHidden ? pointer.avoidance_y * 12 * scaleRatio : 0;
  const dynamicVars: Record<string, string> = {
    "--wh-pet-look-x": formatPointerNumber(pointer.look_x),
    "--wh-pet-look-y": formatPointerNumber(pointer.look_y),
    "--wh-pet-pointer-smoothing-alpha": formatPointerNumber(input.pointer_smoothing_alpha),
    "--wh-pet-avoid-x": formatPointerNumber(pointer.avoidance_x),
    "--wh-pet-avoid-y": formatPointerNumber(pointer.avoidance_y),
    "--wh-pet-avoid-x-px": `${formatPointerNumber(avoidX)}px`,
    "--wh-pet-avoid-y-px": `${formatPointerNumber(avoidY)}px`,
    "--wh-pet-hide-x-px": `${formatPointerNumber(hideX)}px`,
    "--wh-pet-hide-y-px": `${formatPointerNumber(hideY)}px`,
    "--wh-pet-hide-scale": hoverHidden ? "0.92" : "1",
    "--wh-pet-hide-opacity": hoverHidden ? "0.36" : "1",
    "--wh-pet-look-head-x-px": `${formatPointerNumber(pointer.look_x * 9 * scaleRatio)}px`,
    "--wh-pet-look-head-y-px": `${formatPointerNumber(pointer.look_y * 4 * scaleRatio)}px`,
    "--wh-pet-look-eye-x-px": `${formatPointerNumber(pointer.look_x * 9 * scaleRatio)}px`,
    "--wh-pet-look-eye-y-px": `${formatPointerNumber(pointer.look_y * 4 * scaleRatio)}px`,
    "--wh-pet-look-face-x-px": `${formatPointerNumber(pointer.look_x * 4 * scaleRatio)}px`,
    "--wh-pet-look-face-y-px": `${formatPointerNumber(pointer.look_y * 2 * scaleRatio)}px`,
    "--wh-pet-look-rotate-deg": `${formatPointerNumber(pointer.look_x * 5)}deg`
  };
  for (const [name, value] of Object.entries(dynamicVars)) {
    surface.style.setProperty(name, value);
  }
  surface.dataset.petCursorNear = pointer.cursor_near ? "true" : "false";
  surface.dataset.petHovered = pointer.hovered ? "true" : "false";
  surface.dataset.petDragging = pointer.dragging ? "true" : "false";
  surface.dataset.petLookX = formatPointerNumber(pointer.look_x);
  surface.dataset.petLookY = formatPointerNumber(pointer.look_y);
  surface.dataset.petHoverAvoidance = pointer.hover_avoidance;
  surface.dataset.petPointerSmoothingAlpha = formatPointerNumber(input.pointer_smoothing_alpha);
  surface.dataset.petHoverHidden = hoverHidden ? "true" : "false";
  if (pointer.last_pointer_ms !== undefined) {
    surface.dataset.petLastPointerMs = String(pointer.last_pointer_ms);
  } else {
    delete surface.dataset.petLastPointerMs;
  }
  if (!input.card) {
    const behavior = resolveDesktopCuuCatLive2DBehaviorState({
      state: "idle",
      motion_state: input.idle_action,
      phase: "idle_random",
      requested_model_pack_id: surface.dataset.cuuModelPack
    });
    surface.dataset.cuuIdleAction = input.idle_action;
    surface.dataset.cuuState = behavior.behavior_state;
    surface.dataset.cuuLive2dMotion = input.idle_action;
    surface.dataset.cuuLive2dRendererState = behavior.renderer_state;
    surface.dataset.cuuBehaviorManifestVersion = String(behavior.behavior_manifest_version);
    surface.dataset.cuuBehaviorState = behavior.behavior_state;
    surface.dataset.cuuBehaviorPhase = behavior.behavior_phase;
    surface.dataset.cuuBehaviorCoverage = behavior.behavior_coverage;
    surface.dataset.cuuBehaviorPriority = String(behavior.behavior_priority);
    surface.dataset.cuuBehaviorExpectedWindowMode = behavior.behavior_window_mode;
    surface.dataset.cuuBehaviorExpectedBubbleMode = behavior.behavior_bubble_mode;
    setDesktopCuuCatLive2DBehaviorState(root, {
      state: "idle",
      motion_state: input.idle_action,
      phase: "idle_random",
      requested_model_pack_id: surface.dataset.cuuModelPack
    });
  }
  return true;
}

function petWindowSize(mode: DesktopPetWindowMode) {
  return mode === "card"
    ? { width: 520, height: 720 }
    : { width: 260, height: 340 };
}

function desktopPetVisibleMotion(
  motion: CuuMotionHint,
  input: { has_card: boolean; compact_card: boolean },
  locale: WorkHubLocale
): CuuMotionHint {
  if (input.has_card && !input.compact_card && motion.sprite_state === "offline_sleep") {
    return {
      ...motion,
      sprite_state: "worried_ears",
      emphasis: "urgent",
      loop: true,
      reduced_motion_fallback: cuuT(locale, "pet.reducedMotionOffline")
    };
  }
  return motion;
}

function selectPetCardOption(card: CuuCard, optionId: string): { card: CuuCard; label?: string } {
  if (!card.chips?.length || !optionId) {
    return { card };
  }
  const multi = card.input?.mode === "multi_choice" || card.input?.mode === "rank";
  let selectedLabel: string | undefined;
  const chips = card.chips.map((chip) => {
    if (chip.id !== optionId) {
      return multi ? chip : { ...chip, selected: false };
    }
    selectedLabel = chip.label;
    return {
      ...chip,
      selected: multi ? !chip.selected : true
    };
  });
  return {
    card: {
      ...card,
      chips
    },
    ...(selectedLabel ? { label: selectedLabel } : {})
  };
}

function selectedOptionIdsFromCard(card: CuuCard | undefined) {
  return (card?.chips ?? []).filter((chip) => chip.selected).map((chip) => chip.id);
}

function desktopPetMainRouteFromHref(href: string | null | undefined) {
  const raw = href?.trim();
  if (!raw || raw.startsWith("#") || /^javascript:/iu.test(raw)) {
    return undefined;
  }
  try {
    const parsed = new URL(raw, "tauri://localhost");
    const hasScheme = /^[a-z][a-z\d+.-]*:/iu.test(raw);
    const isRelative = !hasScheme || raw.startsWith("/");
    const isTauriLocal = parsed.protocol === "tauri:" && (!parsed.hostname || parsed.hostname === "localhost");
    const isWorkHubLocal =
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "workhub.local");
    if (!isRelative && !isTauriLocal && !isWorkHubLocal) {
      return undefined;
    }
    const route = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return /^\/(?:approvals|dashboard|drive|files|projects|settings|workitems|agent-runs|proposals)(?:[/?#]|$)/u.test(route)
      ? route
      : undefined;
  } catch {
    return undefined;
  }
}

function desktopPetOpenMainRouteFallback(locale: WorkHubLocale) {
  return locale === "en-US" ? "Cuu could not open this in WorkHub." : "Cuu 暂时打不开主窗口。";
}

// R23 F-04（升级转交端到端）：桌宠气泡里塞不下一份花名册下拉，但也不该像以前那样把「转交他人」
// 整个剥掉（rank8）——那让升级转交在桌宠这一端彻底没有入口。改为把主窗口的决策队列打开到这张卡，
// 选人在那边完成（主窗 attention 视图有内联选人器）。
// 决策卡的 id 就是审批/升级本身的 id（见服务端 attention item 的 id 字段），?id= 会被
// entityIdFromShellRoute 抠成 SpotlightTarget.id，主窗据此把这张卡滚进视野并高亮。
export function desktopPetDelegateMainRoute(href: string | null | undefined): string | undefined {
  const target = href ? delegateTargetFromHref(href) : undefined;
  return target ? `/approvals?id=${encodeURIComponent(target.id)}` : undefined;
}

function desktopPetDelegateOpenedNotice(locale: WorkHubLocale) {
  return locale === "en-US"
    ? "Transferring needs a name — opened it in the main window."
    : "转交要先选人，已在主窗口打开这条待办。";
}

// MRG-20：system-notification 计划按「路由 path」暂存/消费——通知 route 可能带查询串
//（/approvals?approvalId=…），而卡片动作 href 常是裸路径；对齐到 path 才能认出同一件事。
export function desktopSystemNotificationPlanRouteKey(route: string | null | undefined): string | undefined {
  const raw = route?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = new URL(raw, "tauri://localhost");
    return parsed.pathname || undefined;
  } catch {
    return undefined;
  }
}

function desktopPetOpenWorkbenchRouteFallback(locale: WorkHubLocale) {
  return locale === "en-US" ? "Cuu could not open the workbench window." : "Cuu 暂时打不开工作台窗口。";
}

function primaryDesktopCuuAction(card: CuuCard, actionId: string, freeText?: string): DesktopCuuActionRequest {
  const action = card.actions.find((candidate) => candidate.id === actionId);
  if (!action) {
    throw new Error(`Unable to find Cuu action ${actionId} for ${card.id}.`);
  }
  const resolved = action?.href
    ? resolveDesktopCuuAction(action.href, { actionId: action.id, card, freeText })
    : undefined;
  if (!resolved) {
    throw new Error(`Unable to resolve Cuu action ${actionId} for ${card.id}.`);
  }
  return resolved;
}

// G-desktop 止血批 3（跨窗口登出广播）：登出发生在主窗（spotlight 设置视图）时,主窗自己
// `window.location.reload()` 就够了——重新走 bootSpotlight() 会自然命中登出标记的重新绑定屏（DSK-01）。但桌宠窗是
// 一个已经在跑的独立进程,不会跟着主窗一起 reload,原来完全没有 handler 去处理"我手里的 client token 刚被
// 主窗清空了"这件事,只会在下一次调用时静默拿着空 token 打 401。现在监听同一个 workhub-logged-out 事件
// （见 boot.ts/workbench/interrupt-broadcast.ts 同款 emit/listen 通路),换成一张诚实的「已登出」卡片——
// 不再假装 Cuu 还能干活,也把 setCard 里"新卡没有 run id 就关掉旧 run 订阅"的既有逻辑顺带用上,不用
// 另外手写一次 close()。
// R24 S4：这张卡也服务首启（这台设备从没连接过、还没有可用的 client token）——同一份「没法在桌宠这
// 260×340 的小窗里放一张登录表单，去主窗口」道理，只是标题/说明换成欢迎文案而不是「已登出」。
// context 默认 "logged-out"（向后兼容既有调用方/既有测试）。
export function createDesktopPetLoggedOutCard(
  locale: WorkHubLocale,
  context: "first-run" | "logged-out" = "logged-out"
): CuuCard {
  const zh = locale === "zh-CN";
  const state: CuuState = "offline";
  const title = context === "first-run" ? (desktopT(locale, "welcomeToWorkhub")) : desktopT(locale, "signedOut");
  const message =
    context === "first-run"
      ? desktopT(locale, "thisDeviceHasnTConnectedBefore")
      : desktopT(locale, "thisDeviceSignedOutSignBack");
  return {
    id: context === "first-run" ? "pet-first-run" : "pet-logged-out",
    kind: "offline",
    state,
    motion: cuuMotionForState(state),
    title,
    message,
    priority: "high",
    actions: [],
    chips: []
  };
}

// R25-Q（L-06 根治）：连接状态"单一真相"（workhub-connection-changed）驱动的桌宠提示——诚实点名
// 连不上的服务器地址 + 重连计次/已离线，不再靠旧的 sse-status 离线卡（已撤，见
// desktop-cuu-runtime.ts 顶部注释）。这行文字走 renderDesktopPetSurface 既有的"无卡片、只有
// status_text"紧凑气泡路径（compactStatusOnly），窗口尺寸维持 body_only（260×340）不变——旧离线卡
// 的 CuuState 是"offline"，非 idle 态一律走 windowModeForState 的"card"分支撑到 520×720、原生窗口
// 跟着挪位置，这正是 r24-S5-reverify.md 记录的 L-06。state === "connected"（或还没收到任何判定）
// 时返回 undefined——恢复后这行提示随下一次 render() 自然消失，桌宠回到正常待命态，不需要额外的
// "收起提示"代码。
export function desktopPetConnectionStatusText(
  payload: DesktopShellConnectionChangedPayload | undefined,
  locale: WorkHubLocale
): string | undefined {
  if (!payload || payload.state === "connected") {
    return undefined;
  }
  const zh = locale === "zh-CN";
  const unreachable = zh ? `连不上服务器 ${payload.server_url}` : `Can't reach the server ${payload.server_url}`;
  const status =
    payload.state === "offline"
      ? desktopT(locale, "offline")
      : zh ? `重连中（第 ${payload.attempt} 次）` : `Reconnecting (attempt ${payload.attempt})`;
  return `${unreachable} · ${status}`;
}

export async function bootDesktopPetSurface(
  root: HTMLElement,
  input: {
    listen?: DesktopShellListen | undefined;
    controller?: CuuController | undefined;
    idleScheduler?: CuuIdleScheduler | undefined;
    petWindowBridge?: DesktopPetWindowBridge | undefined;
    shellEmitter?: DesktopShellEmitter | undefined;
    client?: DesktopPetSurfaceClient | undefined;
    // R24 S4：调用方（browser.ts）已经探过鉴权门——不是 "ready" 时传对应上下文，桌宠开机就直接亮
    // 「去主窗口登录」卡，不再尝试恢复卡片/浮现待拍板（那些请求反正会因为没有 token 静默失败）。
    signInNeededContext?: "first-run" | "logged-out" | undefined;
    // R24 S5（N-03 根治）：收到 workhub-logged-in 广播后执行的动作——默认真 window.location.reload()，
    // 单测注入假函数断言被调用，不用摸真 window.location（同 client/listen/petWindowBridge 等既有的
    // 依赖注入取舍）。
    reload?: () => void;
  } = {}
): Promise<DesktopPetSurfaceRuntime> {
  let locale = desktopPetLocale();
  const controller = input.controller ?? createCuuController({ preferences: loadCuuPreferences() });
  const idleScheduler = input.idleScheduler ?? createDesktopPetIdleScheduler(Date.now());
  const petWindowBridge = input.petWindowBridge ?? resolveDesktopPetWindowBridge();
  const shellEmitter = input.shellEmitter ?? resolveDesktopShellEmitter();
  const qaScenario = desktopPetQaScenarioFromGlobal();
  const shellListen = input.listen ?? createDesktopPetQaShellListenFromGlobal() ?? resolveDesktopShellListen();
  const reload = input.reload ?? (() => window.location.reload());
  const client = input.client ?? createApiClient({
    baseUrl: "",
    getClientToken: clientToken
  });
  const createLauncherCard = () => {
    const projectId = loadDesktopCuuProjectContext()?.project_id;
    return createDesktopCuuAgentLauncherCard({
      locale,
      ...(projectId ? { projectId } : {})
    });
  };
  let currentCard: CuuCard | undefined;
  // L#83：卡片内容只在 setCard 时变；用单调递增的版本号代表结构身份，避免每帧(4Hz) JSON.stringify 整张卡片。
  let cardRevision = 0;
  let idleAction: CuuIdleMicroAction = input.idleScheduler
    ? idleScheduler.snapshot().last_action ?? "idle_breathe"
    : desktopPetInitialIdleAction;
  let statusText: string | undefined;
  // R25-Q：连接状态"单一真相"——boot 拉一次 get_connection_state 初值 + 订阅 workhub-connection-changed
  // 写入，独立于 statusText（那是右键菜单会清掉的瞬态动作反馈，这个是持续性的连接状态，两者不能共用
  // 同一个变量，否则右键打开设置菜单会意外清掉"服务器连不上"的提示）。render() 里两者合并成一行：
  // 有 statusText 优先显示它（动作反馈），否则在没有 currentCard 时退回连接状态提示。
  let connectionStatus: DesktopShellConnectionChangedPayload | undefined;
  let pendingAction: DesktopCuuActionRequest | undefined;
  // WIRE-07：中止执行的两段式确认武装态（5 秒窗口，判定见 desktop-cuu-runtime 的
  // decideDesktopCuuAbortConfirmation）——纯变量记忆，渲染层不重画按钮。
  let armedAbortRunId: string | undefined;
  let armedAbortTimer: ReturnType<typeof setTimeout> | undefined;
  let runStreamSubscription: DesktopCuuRunStreamSubscription | undefined;
  let confirmedPetWindowMode: DesktopPetWindowMode | undefined;
  let syncingPetWindowMode: DesktopPetWindowMode | undefined;
  let failedPetWindowMode: DesktopPetWindowMode | undefined;
  let failedPetWindowModeAt: number | undefined;
  let petWindowModeError: string | undefined;
  let confirmedPetWindowSettingsKey: string | undefined;
  let syncingPetWindowSettingsKey: string | undefined;
  let failedPetWindowSettingsKey: string | undefined;
  let failedPetWindowSettingsKeyAt: number | undefined;
  // M33/M34：失败后只在冷却期内拦截重试（防每次 render 刷屏调用 Tauri），冷却过后允许再试，恢复瞬时失败。
  const PET_WINDOW_RETRY_COOLDOWN_MS = 5000;
  let pointerSnapshot = defaultDesktopPetPointerSnapshot();
  let lastCursorNear = false;
  let pointerSensor: DesktopPetPointerSensor | undefined;
  let renderGeneration = 0;
  let cancelPendingFirstPaintSync: (() => void) | undefined;
  let lastStructuralRenderKey: string | undefined;
  let lastBubbleIntroIdentityKey: string | undefined;
  let lastRunStreamStatus: DesktopCuuRunStreamStatus | undefined;

  const applyRunStreamStatusAttributes = () => {
    const surface = root.querySelector<HTMLElement>("[data-wh-surface=pet]");
    if (!surface || !lastRunStreamStatus) {
      return;
    }
    surface.setAttribute("data-cuu-run-stream-state", lastRunStreamStatus.state);
    surface.setAttribute("data-cuu-run-stream-run-id", lastRunStreamStatus.runId);
    surface.setAttribute(
      "data-cuu-run-stream-event-type",
      lastRunStreamStatus.state === "event" ? lastRunStreamStatus.eventType : ""
    );
    surface.setAttribute(
      "data-cuu-run-stream-refreshed-status",
      lastRunStreamStatus.state === "refreshed" ? lastRunStreamStatus.status : ""
    );
    surface.setAttribute(
      "data-cuu-run-stream-message",
      lastRunStreamStatus.state === "error" ? lastRunStreamStatus.message : ""
    );
    surface.setAttribute(
      "data-cuu-run-stream-close-reason",
      lastRunStreamStatus.state === "closed" ? lastRunStreamStatus.reason : ""
    );
  };

  const render = () => {
    const petWindowSettings = desktopPetWindowSettingsFromPreferences(controller.snapshot().preferences);
    const preferences = controller.snapshot().preferences;
    const desiredMode = desktopPetWindowModeForCard(currentCard, { requested_model_pack_id: preferences.pet_model_pack_id });
    const compactCard = Boolean(currentCard && petWindowBridge && desiredMode === "card" && confirmedPetWindowMode !== "card");
    const windowModeError = compactCard ? petWindowModeError ?? cuuT(locale, "pet.windowModeExpanding") : undefined;
    const windowModeStatus = compactCard ? petWindowModeError ? "failed" : "syncing" : undefined;
    // R25-Q：statusText（右键菜单会清掉的瞬态动作反馈）优先；没有它、也没有真实卡片占着窗口时，
    // 退回连接状态提示——两者都走同一个 status_text 槽位（既有的 compactStatusOnly 紧凑气泡），
    // 有真实卡片时不叠加连接提示（卡片已经在用这块气泡空间，见 desktopPetConnectionStatusText 顶注）。
    const effectiveStatusText = statusText ?? (currentCard ? undefined : desktopPetConnectionStatusText(connectionStatus, locale));
    const bubbleIntroIdentityKey = desktopPetBubbleIntroIdentityKey(currentCard, {
      compact_card: compactCard,
      window_mode_status: windowModeStatus
    });
    const suppressBubbleIntro = Boolean(
      bubbleIntroIdentityKey &&
      bubbleIntroIdentityKey === lastBubbleIntroIdentityKey
    );
    const structuralRenderKey = desktopPetStructuralRenderKey({
      card_revision: currentCard ? cardRevision : 0,
      card_id: currentCard?.id,
      status_text: effectiveStatusText,
      include_reject_reasons: Boolean(pendingAction),
      pet_window_settings: petWindowSettings,
      requested_model_pack_id: preferences.pet_model_pack_id,
      compact_card: compactCard,
      window_mode_error: windowModeError,
      window_mode_status: windowModeStatus,
      locale
    });
    if (
      structuralRenderKey === lastStructuralRenderKey &&
      patchDesktopPetSurfaceRuntimeState(root, {
        idle_action: idleAction,
        card: currentCard,
        pet_window_settings: petWindowSettings,
        pointer_snapshot: pointerSnapshot,
        pointer_smoothing_alpha: desktopPetPointerSmoothingAlpha
      })
    ) {
      applyRunStreamStatusAttributes();
      scheduleWorkHubLiquidGlassFilterRebuild(root.ownerDocument);
      writeDesktopPetQaDomSnapshot(root, "patch");
      syncPetWindowSettings(petWindowSettings);
      return;
    }

    renderGeneration += 1;
    const generation = renderGeneration;
    const surface = renderDesktopPetSurface({
      card: currentCard,
      idle_action: idleAction,
      status_text: effectiveStatusText,
      include_reject_reasons: Boolean(pendingAction),
      pet_window_settings: petWindowSettings,
      requested_model_pack_id: preferences.pet_model_pack_id,
      pointer_snapshot: pointerSnapshot,
      window_mode_error: windowModeError,
      window_mode_status: windowModeStatus,
      suppress_bubble_intro: suppressBubbleIntro,
      locale
    });
    replaceDesktopPetRootHtmlPreservingLive2DFrame(root, `${liquidGlassHeadHtml}${liquidGlassFilterHtml}<style>${surface.css}</style>${surface.html}`);
    applyRunStreamStatusAttributes();
    scheduleWorkHubLiquidGlassFilterRebuild(root.ownerDocument);
    writeDesktopPetQaDomSnapshot(root, "render");
    lastStructuralRenderKey = structuralRenderKey;
    lastBubbleIntroIdentityKey = bubbleIntroIdentityKey;
    syncPetWindowSettings(petWindowSettings);
    cancelPendingFirstPaintSync?.();
    cancelPendingFirstPaintSync = scheduleDesktopPetFirstPaint(() => {
      if (generation !== renderGeneration) {
        return;
      }
      cancelPendingFirstPaintSync = undefined;
      syncPetWindowMode(desiredMode);
    });
  };

  const setCard = (rawCard: CuuCard | undefined, status?: string, options: { persist?: boolean } = {}) => {
    const card = normalizeDesktopPetCard(rawCard, locale);
    const nextRunId = agentRunIdFromPetCard(card);
    if (runStreamSubscription && nextRunId !== runStreamSubscription.runId) {
      runStreamSubscription.close();
      runStreamSubscription = undefined;
    }
    if (card) {
      idleScheduler.observeWorkEvent(Date.now());
    }
    currentCard = card;
    cardRevision += 1;
    statusText = status;
    pendingAction = undefined;
    // R9（Cuu 行为链 high）：本地动作路径直接换卡此前不记账——controller.activeCard 与屏上真卡
    // 脱节，push 气泡按「无当前卡」误判 outcome:show 抢断用户正在处理的高优先级卡。对齐单一事实源。
    controller.noteExternalCard(card);
    if (options.persist !== false) {
      writeDesktopPetRestoreState(card);
    }
    render();
  };

  const subscribeToAgentRun = (result: { agentRun?: Parameters<typeof subscribeDesktopCuuAgentRunStream>[0]["run"] }) => {
    if (!result.agentRun) {
      return;
    }
    runStreamSubscription?.close();
    const subscription = subscribeDesktopCuuAgentRunStream({
      client,
      run: result.agentRun,
      get locale() {
        return locale;
      },
      onCard(card, message) {
        setCard(card, message);
      },
      onStatus(status) {
        lastRunStreamStatus = status;
        applyRunStreamStatusAttributes();
        writeDesktopPetQaDomSnapshot(root, "patch");
        if (status.state === "closed" && runStreamSubscription?.runId === status.runId) {
          runStreamSubscription = undefined;
        }
      }
    });
    runStreamSubscription = subscription.streamUrl ? subscription : undefined;
  };

  async function restoreDesktopPetCard() {
    const restore = readDesktopPetRestoreState();
    if (!restore || currentCard || desktopPetQaScenarioSkipsLocalRestore(qaScenario)) {
      return;
    }
    if (restore.entity_type === "session") {
      setCard(restore.card, cuuFormat(locale, "cuuStart.restored", { title: restore.card.title }), { persist: false });
      return;
    }
    try {
      const run = await client.getAgentRun(restore.entity_id);
      if (currentCard) {
        return;
      }
      setCard(cardFromAgentRunLive(run, { locale }), cuuFormat(locale, "cuuStart.restored", { title: run.title }));
      if (desktopPetAgentRunIsActive(run)) {
        subscribeToAgentRun({ agentRun: run });
      }
    } catch (error) {
      if (currentCard) {
        return;
      }
      setCard(cardFromDesktopCuuRuntimeError(error, { locale }), actionMessage(error, locale), { persist: false });
    }
  }

  // S2「待拍板进桌宠」：首屏主动拉 pages.attention。桌宠空闲(无卡)且有待你拍板时，把头条决策作为 Cuu 卡端上来——
  // 卡上的通过/打回走既有 submitDesktopCuuAction 管线，可在桌宠就地拍板；SSE 后续会实时更新。Cuu 即决策浮现面。
  async function surfacePendingDecision() {
    if (currentCard) {
      return;
    }
    try {
      const attention = await client.pages.attention({ locale });
      if (currentCard) {
        return;
      }
      const item = attention.primary ?? attention.queue[0];
      if (item) {
        setCard(cardFromAttentionItem(item, { locale }), attentionStatusMessage(item, locale), { persist: false });
      }
    } catch {
      // 拉不到就保持空闲，不打断。
    }
  }

  const currentAttentionCardId = () => {
    return currentCard?.payload_ref?.entity_type === "attention" ? currentCard.payload_ref.entity_id : undefined;
  };

  const attentionReadyToMerge = (item: AttentionItem) => {
    return item.actions.some((action) => action.id === "merge");
  };

  const attentionStatusMessage = (item: AttentionItem, messageLocale: WorkHubLocale) => {
    return attentionReadyToMerge(item)
      ? cuuT(messageLocale, "proposal.mergeStatus")
      : messageLocale === "en-US" ? "You have a decision waiting" : "有一件待你拍板";
  };

  const visibleAttentionMessage = (item?: AttentionItem) => {
    if (item) {
      return attentionStatusMessage(item, locale);
    }
    return locale === "en-US" ? "Decision list updated" : "待拍板已同步";
  };

  async function refreshVisibleAttentionCard() {
    const currentId = currentAttentionCardId();
    if (currentCard && !currentId) {
      return;
    }
    try {
      const attention = await client.pages.attention({ locale });
      const items = [attention.primary, ...attention.queue].filter((item): item is AttentionItem => Boolean(item));
      const next = currentId ? items.find((item) => item.id === currentId) ?? items[0] : items[0];
      if (next) {
        // R6（桌面交互）：SSE/轮询刷新会整卡重渲——用户正往自由文本框里打的字会被静默清空。
        // 框里有未提交内容时跳过本次静默刷新。CHAT-09：跳过记脏——否则若之后再无事件到达，
        // 卡片会永久停在旧帧；用户清空文本框（input 监听，见下）或提交动作落定后补刷一次。
        const pendingFreeText = root.querySelector<HTMLTextAreaElement>("[data-pet-free-text]")?.value.trim();
        if (pendingFreeText) {
          attentionRefreshSkippedForFreeText = true;
          return;
        }
        setCard(cardFromAttentionItem(next, { locale }), visibleAttentionMessage(next), { persist: false });
        return;
      }
      if (currentId) {
        setCard(undefined, visibleAttentionMessage(), { persist: false });
      }
    } catch {
      // 刷新失败不打断桌宠当前状态，下一次事件/轮询还会再同步。
    }
  }

  // CHAT-09：被自由文本框挡下的静默刷新记脏后，由这里补偿——清空文本框 / 提交动作落定都会调到。
  // refreshVisibleAttentionCard 自身有「当前卡不是 attention 卡就早退」的守卫，多补一次无害。
  let attentionRefreshSkippedForFreeText = false;
  const flushSkippedAttentionRefresh = () => {
    if (!attentionRefreshSkippedForFreeText) {
      return;
    }
    attentionRefreshSkippedForFreeText = false;
    void refreshVisibleAttentionCard();
  };

  const broadcastPetSettings = (
    preferences: CuuControllerPreferences,
    source: DesktopPetSettingsPayload["source"] = "pet-menu"
  ) => {
    const payload = desktopPetSettingsPayloadFromPreferences(preferences, source);
    const sent = shellEmitter?.emitTo?.("main", "pet-settings", payload);
    if (!shellEmitter?.emitTo && shellEmitter?.emit) {
      void Promise.resolve(shellEmitter.emit("pet-settings", payload)).catch(() => undefined);
      return;
    }
    void Promise.resolve(sent).catch(() => undefined);
  };

  const openMainRouteFromPet = async (route: string) => {
    if (petWindowBridge?.focusMainRoute) {
      await petWindowBridge.focusMainRoute(route);
      return;
    }
    if (shellEmitter?.emitTo) {
      await shellEmitter.emitTo("main", "navigate", { route });
      return;
    }
    if (shellEmitter?.emit) {
      await shellEmitter.emit("navigate", { route });
      return;
    }
    throw new Error("Desktop main route bridge is unavailable.");
  };

  const updatePetPreferences = (
    preferences: Partial<CuuControllerPreferences>,
    message?: string,
    options: { broadcast?: boolean; source?: DesktopPetSettingsPayload["source"] } = {}
  ) => {
    const snapshot = controller.setPreferences(preferences);
    saveCuuPreferences(snapshot.preferences);
    if (message) {
      statusText = message;
    }
    render();
    if (options.broadcast !== false) {
      broadcastPetSettings(snapshot.preferences, options.source);
    }
  };

  async function startRunStreamQaScenario() {
    try {
      const demand = "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。";
      const clarificationAnswer = "以 workhub-app-upload.txt 的 smoke 记录作为验收标准，输出给验收同学。";
      const launcher = createLauncherCard();
      setCard(launcher);
      const launcherAction = primaryDesktopCuuAction(launcher, "start_agent_from_cuu", demand);
      if (launcherAction.kind !== "cuu-start-agent") {
        throw new Error("run-stream QA expected a Cuu start action.");
      }
      setCard(createDesktopCuuAnalysisCard(launcherAction, { locale }), cuuT(locale, "cuuStart.analysisMessage"));
      const clarification = await submitDesktopCuuAction({ client, action: launcherAction, locale });
      if (!clarification.card) {
        throw new Error("run-stream QA expected a clarification card.");
      }
      setCard(clarification.card, clarification.message);
      const scopeAction = primaryDesktopCuuAction(clarification.card, "submit_option", clarificationAnswer);
      const confirmation = await submitDesktopCuuAction({ client, action: scopeAction, locale });
      if (!confirmation.card) {
        throw new Error("run-stream QA expected a confirmation card.");
      }
      const confirmCard = selectPetCardOption(confirmation.card, "create-workitem").card;
      setCard(confirmCard, confirmation.message);
      const confirmAction = primaryDesktopCuuAction(confirmCard, "submit_option");
      const started = await submitDesktopCuuAction({ client, action: confirmAction, locale });
      setCard(started.card ?? confirmCard, started.message);
      subscribeToAgentRun(started);
    } catch (error) {
      setCard(cardFromDesktopCuuRuntimeError(error, { locale }), actionMessage(error, locale));
    }
  }

  const setLocalePreference = (nextLocale: WorkHubLocale) => {
    const previousLocale = locale;
    locale = nextLocale;
    try {
      globalThis.localStorage?.setItem(workHubLocaleStorageKey, nextLocale);
    } catch {
      // Local storage may be unavailable in isolated test surfaces.
    }
    statusText = desktopPetSettingsMenuCopy[locale].localeChanged;
    // R10（偏好同步）：①失败要回滚+提示（此前静默吞掉，与主窗/web 的失败处理不对称）；
    // ②成功后用新 locale 重取当前 attention 卡（卡文案是创建时烘焙的，不重取会中英混语）；
    // ③广播主窗——两窗语言态不再长期漂移。
    void client.updatePreferences({ locale: nextLocale })
      .then(() => {
        // D1（R19-13 托盘语言联动补线）：同 spotlight/views/settings.ts——桌宠窗切语言成功后
        // 也要让原生外壳（托盘菜单/tooltip/通知兜底文案）跟着换，否则只有主窗改了偏好、壳层
        // 停在启动语言。best-effort、fire-and-forget，非 Tauri 环境没有 invoke 时直接跳过。
        const invokeShell = resolveDesktopTauriInvoke();
        if (invokeShell) {
          void Promise.resolve(invokeShell("set_shell_locale", { locale: nextLocale })).catch(() => undefined);
        }
        void refreshVisibleAttentionCard();
        try {
          shellEmitter?.emitTo?.("main", "pet-locale-changed", { locale: nextLocale });
        } catch {
          // emit 失败不影响本窗切换。
        }
      })
      .catch(() => {
        locale = previousLocale;
        try {
          globalThis.localStorage?.setItem(workHubLocaleStorageKey, previousLocale);
        } catch {
          // ignore
        }
        statusText = desktopPetSettingsMenuCopy[locale].localeChangeFailed;
        render();
      });
    render();
  };

  render();
  if (input.signInNeededContext) {
    // R24 S4：调用方已经探明这台设备没有可用身份（首启或真登出）——直接亮「去主窗口登录」卡，
    // 不再尝试恢复卡片/浮现待拍板：那些请求反正会因为没有 client token 静默失败，不如诚实告知现状。
    setCard(createDesktopPetLoggedOutCard(locale, input.signInNeededContext), undefined, { persist: false });
  } else if (!desktopPetQaScenarioSkipsLocalRestore(qaScenario)) {
    // 先尝试恢复上次会话/运行卡；没有可恢复的卡时，主动浮现一条待拍板（S2）。QA 场景跳过，避免干扰固定卡。
    void restoreDesktopPetCard().then(() => surfacePendingDecision());
  }

  pointerSensor = createDesktopPetPointerSensor(root, {
    bridge: petWindowBridge,
    onInteraction(interaction, nowMs) {
      pointerSnapshot = pointerSensor?.snapshot() ?? pointerSnapshot;
      lastCursorNear = pointerSnapshot.cursor_near;
      if (currentCard || controller.snapshot().preferences.reduced_motion) {
        render();
        return;
      }
      const decision = idleScheduler.observeInteraction(interaction, nowMs);
      if (decision.action) {
        idleAction = decision.action;
      }
      render();
    }
  });

  // rank8：决策卡动作单飞守卫——双击审批/合并/打回会发两发 POST，第二发服务端 409 approval_race。
  let petActionBusy = false;
  root.addEventListener("click", async (event) => {
    const menuTarget = event.target instanceof Element ? event.target : null;
    const modelButton = menuTarget?.closest<HTMLButtonElement>("[data-pet-menu-model]");
    if (modelButton) {
      event.preventDefault();
      setPetSettingsMenuOpen(root, false);
      const modelPackId = modelButton.dataset.petMenuModel === "cuu-tororo-live2d-cubism2"
        ? "cuu-tororo-live2d-cubism2"
        : "cuu-hijiki-live2d-cubism2";
      updatePetPreferences({ pet_model_pack_id: modelPackId }, desktopPetSettingsMenuCopy[locale].modelChanged);
      return;
    }

    const localeButton = menuTarget?.closest<HTMLButtonElement>("[data-pet-menu-locale]");
    if (localeButton) {
      event.preventDefault();
      setPetSettingsMenuOpen(root, false);
      setLocalePreference(normalizeWorkHubLocale(localeButton.dataset.petMenuLocale));
      return;
    }

    const hoverToggle = menuTarget?.closest<HTMLButtonElement>("[data-pet-menu-toggle-hover]");
    if (hoverToggle) {
      event.preventDefault();
      setPetSettingsMenuOpen(root, false);
      const enabled = controller.snapshot().preferences.pet_hide_on_hover;
      updatePetPreferences(
        { pet_hide_on_hover: !enabled },
        !enabled ? desktopPetSettingsMenuCopy[locale].hoverEnabled : desktopPetSettingsMenuCopy[locale].hoverDisabled
      );
      return;
    }

    const openSettingsButton = menuTarget?.closest<HTMLButtonElement>("[data-pet-menu-open-settings]");
    if (openSettingsButton) {
      event.preventDefault();
      setPetSettingsMenuOpen(root, false);
      if (!petWindowBridge?.focusMainRoute) {
        statusText = desktopPetSettingsMenuCopy[locale].openSettingsFallback;
        render();
        return;
      }
      try {
        await petWindowBridge.focusMainRoute("/settings");
      } catch {
        statusText = desktopPetSettingsMenuCopy[locale].openSettingsFallback;
        render();
      }
      return;
    }

    const hideButton = menuTarget?.closest<HTMLButtonElement>("[data-pet-menu-hide]");
    if (hideButton) {
      event.preventDefault();
      setPetSettingsMenuOpen(root, false);
      if (!petWindowBridge?.hidePetWindow) {
        statusText = desktopPetSettingsMenuCopy[locale].hideFallback;
        render();
        return;
      }
      try {
        await petWindowBridge.hidePetWindow();
      } catch {
        statusText = desktopPetSettingsMenuCopy[locale].hideFallback;
        render();
      }
      return;
    }

    if (menuTarget && !menuTarget.closest("[data-pet-settings-menu]")) {
      setPetSettingsMenuOpen(root, false);
    }

    const optionButton = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pet-option-id]") : null;
    if (optionButton && currentCard?.input) {
      event.preventDefault();
      const selection = selectPetCardOption(currentCard, optionButton.dataset.petOptionId ?? "");
      currentCard = selection.card;
      statusText = selection.label
        ? cuuFormat(locale, "pet.selectedWithLabel", { label: selection.label })
        : cuuT(locale, "pet.selectedFallback");
      pendingAction = undefined;
      render();
      return;
    }

    // L10：打回理由里的「先不打回」——清掉待提交的拒绝、复位状态、重渲回原卡片(approve/deny 按钮还在),
    // 让用户能从这个「破坏性确认」里全身而退,而不是被三个理由按钮困住。
    const rejectCancel = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pet-reject-cancel]") : null;
    if (rejectCancel && pendingAction) {
      event.preventDefault();
      pendingAction = undefined;
      statusText = "";
      render();
      return;
    }

    const reasonButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-pet-reason]") : null;
    if (reasonButton && pendingAction) {
      if (petActionBusy) {
        return;
      }
      petActionBusy = true;
      // findings[#low]：currentCard 在 await 期间可能被改写，await 后再读会用到新值（TOCTOU）。
      // 捕获 await 前的卡片做兜底。
      const fallbackCard = currentCard;
      try {
        const result = await submitDesktopCuuAction({
          client,
          action: pendingAction,
          reasonMd: reasonButton.dataset.petReason ?? cuuT(locale, "pet.reasonDefault"),
          locale
        });
        if (!result.card && !result.agentRun) {
          setCard(undefined, result.message);
          void surfacePendingDecision();
        } else {
          setCard(result.card ?? fallbackCard, result.message);
          subscribeToAgentRun(result);
        }
      } catch (error) {
        setCard(cardFromDesktopPetActionError(error, locale), actionMessage(error, locale));
      } finally {
        petActionBusy = false;
        // CHAT-09：提交落定后补一次被自由文本框挡下的静默刷新（无脏标记则空操作）。
        flushSkippedAttentionRefresh();
      }
      return;
    }

    // 普通用户审查 R2：「知道了」关闭钮——先于 anchor 守卫处理（它是 button 不是链接）。
    const dismissBtn = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-pet-dismiss]") : null;
    if (dismissBtn) {
      event.preventDefault();
      // 收起当前卡并主动端出下一条待拍板（节流/队列里的不再被永久压住）。
      setCard(undefined, undefined);
      void surfacePendingDecision();
      return;
    }
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    const petBody = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pet-drag-handle]") : null;
    if (petBody && !anchor) {
      if (!currentCard) {
        setCard(createLauncherCard());
        return;
      }
      // findings[#low]：有卡片在显示时点击不该冒出 tap_bubble 闲置微动作（与指针传感器守卫相反）。
      // 走 tick({active_card:true})→active_card_controls_motion，不产生 action。
      const decision = idleScheduler.tick({ now_ms: Date.now(), interaction: "tap", active_card: true });
      if (decision.action) {
        idleAction = decision.action;
        render();
      }
      return;
    }
    if (!anchor) {
      return;
    }
    if (anchor.dataset.cuuActionId === "restart_cuu") {
      event.preventDefault();
      pendingAction = undefined;
      setCard(createLauncherCard(), cuuT(locale, "cuuStart.restartReady"), { persist: false });
      return;
    }
    if (
      (anchor.dataset.cuuActionId === "submit_option" || anchor.dataset.cuuActionId === "start_agent_from_cuu")
      && currentCard?.input
    ) {
      const freeText = root.querySelector<HTMLTextAreaElement>("[data-pet-free-text]")?.value.trim() ?? "";
      if (!currentCard.input.option_first && currentCard.input.free_text_enabled && !freeText) {
        event.preventDefault();
        statusText = cuuT(locale, "pet.input.textNeeded");
        pendingAction = undefined;
        render();
        return;
      }
      const selectedOptionIds = selectedOptionIdsFromCard(currentCard);
      if (currentCard.input.option_first && (currentCard.chips?.length ?? 0) > 0 && selectedOptionIds.length === 0) {
        event.preventDefault();
        statusText = cuuT(locale, "pet.optionRequired");
        pendingAction = undefined;
        render();
        return;
      }
    }
    const action = resolveDesktopCuuAction(anchor.getAttribute("href") ?? "", {
      actionId: anchor.dataset.cuuActionId,
      requiresReason: anchor.dataset.requiresReason === "true",
      card: currentCard,
      freeText: root.querySelector<HTMLTextAreaElement>("[data-pet-free-text]")?.value.trim()
    });
    if (!action) {
      // R23 F-04：「转交他人」——桌宠没有选人 UI，把主窗口的决策队列打开到这张卡，让人在那边选。
      // 先于下面两个分类检查：delegate href 是 /api/… 前缀，它们都不认，顺序只影响可读性。
      const delegateRoute = desktopPetDelegateMainRoute(anchor.getAttribute("href"));
      if (delegateRoute) {
        event.preventDefault();
        try {
          await openMainRouteFromPet(delegateRoute);
          statusText = desktopPetDelegateOpenedNotice(locale);
        } catch {
          statusText = desktopPetOpenMainRouteFallback(locale);
        }
        render();
        return;
      }
      // R12 批7:Cuu 气泡点击 → 深链定位工作台会话/行动卡(dispatch_ask/workbench-interrupt 卡的
      // "去工作台看看"动作，见 buildDesktopDispatchAskCuuCard/buildDesktopWorkbenchInterruptCuuCard)。
      // 先于 desktopPetMainRouteFromHref 检查——两者的 href 前缀不重叠，顺序不影响正确性。
      const workbenchTarget = parseWorkbenchDeepLinkHref(anchor.getAttribute("href"));
      if (workbenchTarget) {
        event.preventDefault();
        // MRG-20：这条深链若对应刚到达的 OS 通知（同路由已暂存计划），优先把计划回传原生
        // focus_system_notification 走统一深链落地；否则按既有方式开工作台。
        const notificationPlan = takeSystemNotificationPlanForRoute(anchor.getAttribute("href"));
        if (notificationPlan && petWindowBridge?.focusSystemNotification) {
          focusSystemNotificationPlan(notificationPlan);
          return;
        }
        const opened = await openWorkbenchRouteFromPet(workbenchTarget).catch(() => false);
        if (!opened) {
          statusText = desktopPetOpenWorkbenchRouteFallback(locale);
          render();
        }
        return;
      }
      const route = desktopPetMainRouteFromHref(anchor.getAttribute("href"));
      if (route) {
        event.preventDefault();
        // MRG-20：同上——主窗路由若对应暂存的通知计划，走 focus_system_notification 落地。
        const notificationPlan = takeSystemNotificationPlanForRoute(route);
        if (notificationPlan && petWindowBridge?.focusSystemNotification) {
          focusSystemNotificationPlan(notificationPlan);
          return;
        }
        try {
          await openMainRouteFromPet(route);
        } catch {
          statusText = desktopPetOpenMainRouteFallback(locale);
          render();
        }
      }
      return;
    }
    event.preventDefault();
    // WIRE-07：中止执行是破坏性动作——两段式确认（沿用网盘回滚 decideRollbackConfirmation 同款先例）：
    // 第一次点只武装（状态行换确认文案，5 秒自动解除），武装窗口内再点同一颗才真正提交中止。
    if (action.kind === "abort-agent-run") {
      const abortDecision = decideDesktopCuuAbortConfirmation(armedAbortRunId, action.runId);
      if (abortDecision.kind === "arm") {
        armedAbortRunId = action.runId;
        statusText = cuuT(locale, "pet.abortRunConfirm");
        render();
        if (armedAbortTimer !== undefined) {
          clearTimeout(armedAbortTimer);
        }
        armedAbortTimer = setTimeout(() => {
          armedAbortTimer = undefined;
          if (armedAbortRunId === action.runId) {
            armedAbortRunId = undefined;
          }
        }, 5000);
        return;
      }
      armedAbortRunId = undefined;
      if (armedAbortTimer !== undefined) {
        clearTimeout(armedAbortTimer);
        armedAbortTimer = undefined;
      }
    }
    // findings[30]：reason 收集触发要与 approvalDecisionFromAction 的 deny 判定一致（关键词集 OR requiresReason），
    // 而不是只看 requiresReason 标志——否则一个 requiresReason=false 的 deny 会跳过 reason 提示，到 /respond 时
    // 因缺 reason 在客户端抛错。凡 deny 一律先走 reason 提示。
    if (
      (action.kind === "approval-response" && action.decision === "deny") ||
      (action.kind === "proposal-review" && action.decision === "request_changes")
    ) {
      pendingAction = action;
      statusText = cuuT(locale, "pet.reasonRequired");
      render();
      return;
    }
    if (petActionBusy) {
      return;
    }
    // 走到这里=本次点击决定真提交——残留的中止武装态作废（点了别的动作就别留着一个看不见的 5 秒窗，
    // 否则窗口内再点中止会跳过武装直接执行）。
    armedAbortRunId = undefined;
    petActionBusy = true;
    // findings[#low]：同上——捕获 await 前的卡片做兜底，避免 await 期间 currentCard 被改写。
    const fallbackCard = currentCard;
    if (action.kind === "cuu-start-agent") {
      setCard(createDesktopCuuAnalysisCard(action, { locale }), cuuT(locale, "cuuStart.analysisMessage"));
    }
    try {
      const result = await submitDesktopCuuAction({ client, action, locale });
      if (!result.card && !result.agentRun) {
        // rank2：终态决策动作(审批/合并/打回)无后续卡/流——清掉已处置的卡(否则按钮还在、会重复 POST、
        // 下一条待拍板也永不浮现)，再主动端出下一条待你拍板，对齐 Spotlight attention 的 refresh() 行为。
        setCard(undefined, result.message);
        void surfacePendingDecision();
      } else {
        setCard(result.card ?? fallbackCard, result.message);
        subscribeToAgentRun(result);
      }
    } catch (error) {
      setCard(cardFromDesktopPetActionError(error, locale), actionMessage(error, locale));
    } finally {
      petActionBusy = false;
      // CHAT-09：提交落定后补一次被自由文本框挡下的静默刷新（无脏标记则空操作）。
      flushSkippedAttentionRefresh();
    }
  });

  // CHAT-10：自由文本框 Enter 发送（Shift+Enter 换行），与主流聊天习惯一致。isComposing 守卫：
  // 中文输入法选词上屏的 Enter 绝不触发发送。复用既有点击管线（找到卡片的主提交动作转发一次 click），
  // 不复制提交逻辑。找不到可提交动作（卡没有输入区）时不拦默认行为（保持换行）。
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
      return;
    }
    const textarea = event.target instanceof Element ? event.target.closest("[data-pet-free-text]") : null;
    if (!textarea) {
      return;
    }
    const submit = root.querySelector<HTMLAnchorElement>(
      '[data-cuu-action-id="submit_option"], [data-cuu-action-id="start_agent_from_cuu"]'
    );
    if (!submit) {
      return;
    }
    event.preventDefault();
    submit.click();
  });

  // CHAT-09：自由文本框被清空（用户删掉未提交内容）时，补一次此前被挡下的静默刷新——
  // 否则跳过之后若再无事件到达，卡片会永久停在旧帧。
  root.addEventListener("input", (event) => {
    const textarea = event.target instanceof Element
      ? event.target.closest<HTMLTextAreaElement>("[data-pet-free-text]")
      : null;
    if (textarea && !textarea.value.trim()) {
      flushSkippedAttentionRefresh();
    }
  });

  root.addEventListener("contextmenu", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-wh-surface=pet]")) {
      return;
    }
    event.preventDefault();
    if (statusText && !currentCard) {
      statusText = undefined;
      render();
    }
    setPetSettingsMenuOpen(root, true);
  });

  let petSettingsUnlisten: DesktopShellUnlisten | undefined;
  const maybePetSettingsUnlisten = await shellListen?.("pet-settings", (event) => {
    const preferences = desktopPetSettingsPreferencesFromPayload(event.payload);
    if (!preferences) {
      return;
    }
    updatePetPreferences(preferences, undefined, { broadcast: false });
  });
  if (typeof maybePetSettingsUnlisten === "function") {
    petSettingsUnlisten = maybePetSettingsUnlisten;
  }

  let trayActionUnlisten: DesktopShellUnlisten | undefined;
  const maybeTrayActionUnlisten = await shellListen?.("tray-action", (event) => {
    if (desktopTrayActionId(event.payload) !== "restore-pet-interaction") {
      return;
    }
    // DSK-02：只复位穿透/悬停隐藏——透明度从当前偏好原样带回（Rust 侧特意保留用户自调的透明度，
    // 之前这里硬重置成 100 并落盘，把用户的设置冲掉了）。
    updatePetPreferences(
      {
        pet_pass_through: false,
        pet_hide_on_hover: false,
        pet_opacity_percent: controller.snapshot().preferences.pet_opacity_percent
      },
      desktopPetSettingsMenuCopy[locale].restoredFromTray,
      { source: "tray" }
    );
  });
  if (typeof maybeTrayActionUnlisten === "function") {
    trayActionUnlisten = maybeTrayActionUnlisten;
  }

  let attentionRefreshUnlisten: DesktopShellUnlisten | undefined;
  const maybeAttentionRefreshUnlisten = await shellListen?.("attention-refresh", () => {
    void refreshVisibleAttentionCard();
  });
  if (typeof maybeAttentionRefreshUnlisten === "function") {
    attentionRefreshUnlisten = maybeAttentionRefreshUnlisten;
  }

  // G-desktop 止血批 3：跨窗口登出广播——见 createDesktopPetLoggedOutCard 顶部注释。换卡即可，
  // setCard 已有的"新卡没有关联 run id 就关掉旧订阅"逻辑顺带停掉这个窗口手里可能还开着的 run 流，
  // 不用另外手写一次 runStreamSubscription?.close()。
  let loggedOutUnlisten: DesktopShellUnlisten | undefined;
  const maybeLoggedOutUnlisten = await shellListen?.("workhub-logged-out", () => {
    setCard(createDesktopPetLoggedOutCard(locale), undefined, { persist: false });
  });
  if (typeof maybeLoggedOutUnlisten === "function") {
    loggedOutUnlisten = maybeLoggedOutUnlisten;
  }

  // R24 S5（N-03 根治）：主窗登录/重新绑定成功此前只 reload 主窗自己那一扇窗口——桌宠窗（一直挂着
  // input.signInNeededContext 渲的那张"去主窗登录"卡，见上面 setCard(createDesktopPetLoggedOutCard(...))
  // 那次调用）全程收不到信号，本次会话内永远装死，直到用户自己重启应用才会偶然读到新落的 token。
  // 直接 reload 就够：render() 的结构化渲染分支每次 boot 都会用当时真实的 currentCard 重新算一遍
  // desiredMode 并调 syncPetWindowMode（见下方 render 定义），这次 reload 后 signInNeededContext 不再
  // 成立（已经有 token），窗口尺寸/卡片自然回到正常态——不需要额外的"收起卡片/恢复尺寸"代码。
  let loggedInUnlisten: DesktopShellUnlisten | undefined;
  const maybeLoggedInUnlisten = await shellListen?.("workhub-logged-in", () => {
    reload();
  });
  if (typeof maybeLoggedInUnlisten === "function") {
    loggedInUnlisten = maybeLoggedInUnlisten;
  }

  // R25-Q：连接状态"单一真相"——订阅与快照都只更新 connectionStatus + render()，不碰 currentCard/
  // 窗口尺寸（见 desktopPetConnectionStatusText 顶注——L-06 根治的关键就是这条提示完全独立于卡片/
  // resize 管线）。顺序由 primeDesktopConnectionState 钉死：先订阅、订阅落地后再拉一次 get_connection_state
  // 补初值、事件永远比快照新（真机验收 DEFECT-1）。best-effort：拉取失败/无 __TAURI__ 时
  // connectionStatus 保持 undefined，不渲任何提示。
  let connectionChangedUnlisten: DesktopShellUnlisten | undefined;
  void primeDesktopConnectionState({
    subscribe: async (onPayload) => {
      const maybeUnlisten = await shellListen?.("workhub-connection-changed", (event) => {
        const payload = parseDesktopShellConnectionChangedPayload(event.payload);
        if (payload) {
          onPayload(payload);
        }
      });
      if (typeof maybeUnlisten === "function") {
        connectionChangedUnlisten = maybeUnlisten;
      }
    },
    read: () => readDesktopConnectionState(),
    apply: (payload) => {
      connectionStatus = payload;
      render();
    }
  });

  // MRG-20：OS 通知到达不再抢焦点/强制导航。壳层广播的 system-notification 计划先按路由暂存；
  // 用户在桌宠 Cuu 卡上点出同一目标路由的动作时，才把计划回传原生 focus_system_notification
  // → handle_deep_link_plan 落地（审批通知落审批面板、消息通知落对应会话，含 workbench 按需建窗）。
  const pendingSystemNotificationPlans = new Map<string, DesktopShellSystemNotificationPlan>();
  const rememberSystemNotificationPlan = (plan: DesktopShellSystemNotificationPlan) => {
    const key = desktopSystemNotificationPlanRouteKey(plan.route);
    if (!key) {
      return;
    }
    // 重插到最新位置；上限防御——通知只进不出（用户不点）时不至于无限攒，超出丢最旧的一条。
    pendingSystemNotificationPlans.delete(key);
    pendingSystemNotificationPlans.set(key, plan);
    while (pendingSystemNotificationPlans.size > 20) {
      const oldest = pendingSystemNotificationPlans.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      pendingSystemNotificationPlans.delete(oldest);
    }
  };
  // 用户点了卡片动作 → 取出同路由的通知计划（一次性消费）；返回 undefined 时由调用方走既有导航兜底。
  const takeSystemNotificationPlanForRoute = (route: string | null | undefined) => {
    const key = desktopSystemNotificationPlanRouteKey(route);
    if (!key) {
      return undefined;
    }
    const plan = pendingSystemNotificationPlans.get(key);
    if (plan) {
      pendingSystemNotificationPlans.delete(key);
    }
    return plan;
  };
  const focusSystemNotificationPlan = (plan: DesktopShellSystemNotificationPlan) => {
    void Promise.resolve(petWindowBridge?.focusSystemNotification?.(plan)).catch(() => undefined);
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen: shellListen,
    controller,
    notify(notice) {
      // R9（Cuu 行为链）：用户正处于二次确认（pendingAction，如选打回理由）时，push 新卡不抢占——
      // 卡在 controller 队列里没丢，用户处理完当前卡自然轮到。
      if (pendingAction && notice.card.id !== currentCard?.id) {
        return;
      }
      handleDesktopPetRuntimeNotice(notice, setCard);
    },
    onDecision(decision) {
      handleDesktopPetRuntimeDecision(decision, setCard);
    },
    onSystemNotification(plan) {
      // MRG-20：通知到达只按路由暂存计划，不再立刻 focus_system_notification 抢焦点/强制导航——
      // 同一事件的 Cuu 卡已由 push-event 渲出，等用户点击卡片上指向同一路由的动作时再落地
      //（见 click 处理里 workbench 深链 / 主窗路由两个分支）。桥不可用时计划留着也无害，
      // 届时点击走既有的 openWorkbenchRouteFromPet / openMainRouteFromPet 兜底。
      rememberSystemNotificationPlan(plan);
    },
    // INF-08：SSE 断线重连成功即全量重拉待拍板卡——断线窗口漏掉的 push 事件（后端无回放）不再靠
    // 下一条增量才补齐。refreshVisibleAttentionCard 自带「当前卡不是 attention 卡就早退」守卫，多补无害。
    onSseReconnected: () => {
      void refreshVisibleAttentionCard();
    },
    get locale() {
      return locale;
    }
  });
  let samplingCursor = false;
  if (desktopPetQaScenarioStartsRunApiFlow(qaScenario)) {
    window.setTimeout(() => {
      void startRunStreamQaScenario();
    }, 160);
  }
  const idleTimer = window.setInterval(() => {
    if (samplingCursor) {
      return;
    }
    samplingCursor = true;
    void tickIdle().finally(() => {
      samplingCursor = false;
    });
  }, 250);

  // R7.1 桌宠动态穿透：默认让 pet 窗口忽略鼠标（点击穿透到下方应用/报价单），仅当原生光标落在
  // .wh-pet-body / .wh-pet-bubble / .wh-pet-menu（CSS pointer-events:auto）上时才接管点击。
  // 穿透开启时 webview 收不到任何鼠标事件，故命中测试必须用「原生光标坐标 + elementFromPoint」，
  // 不能靠 webview 内的 mousemove。仅在真正的 pet 窗口跑（主窗口的 Cuu 预览不触发）。
  let clickThroughTimer: number | undefined;
  let syncingClickThrough = false;
  let lastClickThroughIgnore: boolean | undefined;
  async function syncPetClickThrough() {
    const probe = petWindowBridge?.cursorClientPosition;
    const apply = petWindowBridge?.setClickThrough;
    if (!probe || !apply) {
      return;
    }
    const position = await Promise.resolve(probe()).catch(() => undefined);
    if (!position) {
      return;
    }
    let interactive = false;
    if (position.inside) {
      const doc = root.ownerDocument ?? document;
      const hit = doc.elementFromPoint(position.x, position.y);
      interactive = Boolean(hit && hit.closest(".wh-pet-body,.wh-pet-bubble,.wh-pet-menu"));
    }
    const ignore = !interactive;
    if (ignore === lastClickThroughIgnore) {
      return;
    }
    lastClickThroughIgnore = ignore;
    await Promise.resolve(apply(ignore)).catch(() => {
      // 失败则清掉缓存，下一拍重试，避免卡在错误状态。
      lastClickThroughIgnore = undefined;
    });
  }
  if (resolveDesktopSurface() === "pet" && petWindowBridge?.setClickThrough && petWindowBridge?.cursorClientPosition) {
    clickThroughTimer = window.setInterval(() => {
      if (syncingClickThrough) {
        return;
      }
      syncingClickThrough = true;
      void syncPetClickThrough().finally(() => {
        syncingClickThrough = false;
      });
    }, 80);
  }

  async function tickIdle() {
    const pointer = pointerSensor?.snapshot() ?? pointerSnapshot;
    const sampledPointer = await Promise.resolve(petWindowBridge?.sampleCursorNear?.()).catch(() => undefined);
    const nextPointerSnapshot = desktopPetPointerSnapshotFromSample(sampledPointer, pointer, {
      smoothing_alpha: desktopPetPointerSmoothingAlpha,
      snap_threshold: 0.018
    });
    const pointerChanged = !desktopPetPointerStateEqual(pointerSnapshot, nextPointerSnapshot);
    const cursorNear = nextPointerSnapshot.cursor_near;
    const enteredCursorNear = cursorNear && !lastCursorNear;
    pointerSnapshot = nextPointerSnapshot;
    lastCursorNear = cursorNear;
    if (nextPointerSnapshot.dragging) {
      const nextIdleAction = controller.snapshot().preferences.reduced_motion ? idleAction : "drag_hold";
      const actionChanged = idleAction !== nextIdleAction;
      idleAction = nextIdleAction;
      if (pointerChanged || actionChanged) {
        render();
      }
      return;
    }
    const decision = idleScheduler.tick({
      now_ms: Date.now(),
      active_card: Boolean(currentCard),
      cursor_near: cursorNear,
      ...(enteredCursorNear ? { interaction: "cursor_near" } : {}),
      reduced_motion: controller.snapshot().preferences.reduced_motion
    });
    if (decision.action) {
      idleAction = decision.action;
      render();
      return;
    }
    if (pointerChanged) {
      render();
    }
  }

  // L11：尊重 OS 的「减弱动态效果」。把系统 prefers-reduced-motion 接进控制器的 reduced_motion——开了就静默 Cuu 的
  // 4Hz 闲置微动作(不必再单独翻应用内开关);仅运行时生效、不写盘(不污染用户应用内偏好);OS 关掉时回落到应用内设的值。
  // Tauri webview 支持 matchMedia;测试/无 matchMedia 环境安全跳过。
  const baseReduceMotion = controller.snapshot().preferences.reduced_motion;
  const reduceMotionQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : undefined;
  const applyOsReduceMotion = (osReduce: boolean) => {
    controller.setPreferences({ reduced_motion: osReduce || baseReduceMotion });
    render();
  };
  const onReduceMotionChange = (event: MediaQueryListEvent) => applyOsReduceMotion(event.matches);
  if (reduceMotionQuery) {
    if (reduceMotionQuery.matches) {
      applyOsReduceMotion(true);
    }
    reduceMotionQuery.addEventListener?.("change", onReduceMotionChange);
  }

  return {
    controller,
    idleScheduler,
    pointerSensor,
    subscribed: runtime.subscribed,
    async dispose() {
      reduceMotionQuery?.removeEventListener?.("change", onReduceMotionChange);
      window.clearInterval(idleTimer);
      if (clickThroughTimer !== undefined) {
        window.clearInterval(clickThroughTimer);
        // 释放时把 pet 窗口恢复为可交互，避免停留在「整窗穿透」状态。
        void petWindowBridge?.setClickThrough?.(false).catch(() => {});
      }
      cancelPendingFirstPaintSync?.();
      pointerSensor?.dispose();
      runStreamSubscription?.close();
      petSettingsUnlisten?.();
      trayActionUnlisten?.();
      attentionRefreshUnlisten?.();
      loggedOutUnlisten?.();
      loggedInUnlisten?.();
      connectionChangedUnlisten?.();
      await runtime.dispose();
    }
  };

  function syncPetWindowMode(mode: DesktopPetWindowMode) {
    if (!petWindowBridge) {
      confirmedPetWindowMode = mode;
      return;
    }
    if (confirmedPetWindowMode === mode || syncingPetWindowMode === mode) {
      return;
    }
    if (
      failedPetWindowMode === mode &&
      petWindowModeError &&
      failedPetWindowModeAt !== undefined &&
      Date.now() - failedPetWindowModeAt < PET_WINDOW_RETRY_COOLDOWN_MS
    ) {
      return;
    }
    syncingPetWindowMode = mode;
    failedPetWindowMode = undefined;
    failedPetWindowModeAt = undefined;
    petWindowModeError = undefined;
    void Promise.resolve(petWindowBridge.setMode?.(mode))
      .then(() => {
        if (syncingPetWindowMode !== mode) {
          return;
        }
        confirmedPetWindowMode = mode;
        syncingPetWindowMode = undefined;
        failedPetWindowMode = undefined;
        petWindowModeError = undefined;
        render();
      })
      .catch((error: unknown) => {
        if (syncingPetWindowMode !== mode) {
          return;
        }
        syncingPetWindowMode = undefined;
        failedPetWindowMode = mode;
        failedPetWindowModeAt = Date.now();
        petWindowModeError = actionMessage(error, locale);
      render();
    });
  }

  function syncPetWindowSettings(settings: DesktopPetWindowSettings) {
    const key = desktopPetWindowSettingsKey(settings);
    if (!petWindowBridge) {
      confirmedPetWindowSettingsKey = key;
      return;
    }
    if (confirmedPetWindowSettingsKey === key || syncingPetWindowSettingsKey === key) {
      return;
    }
    if (
      failedPetWindowSettingsKey === key &&
      failedPetWindowSettingsKeyAt !== undefined &&
      Date.now() - failedPetWindowSettingsKeyAt < PET_WINDOW_RETRY_COOLDOWN_MS
    ) {
      return;
    }
    syncingPetWindowSettingsKey = key;
    failedPetWindowSettingsKey = undefined;
    failedPetWindowSettingsKeyAt = undefined;
    void Promise.resolve(petWindowBridge.setSettings?.(settings))
      .then(() => {
        if (syncingPetWindowSettingsKey !== key) {
          return;
        }
        confirmedPetWindowSettingsKey = key;
        syncingPetWindowSettingsKey = undefined;
        failedPetWindowSettingsKey = undefined;
      })
      .catch(() => {
        if (syncingPetWindowSettingsKey !== key) {
          return;
        }
        syncingPetWindowSettingsKey = undefined;
        failedPetWindowSettingsKey = key;
        failedPetWindowSettingsKeyAt = Date.now();
      });
  }
}

function desktopPetWindowSettingsKey(settings: DesktopPetWindowSettings) {
  return `${settings.scale_percent}:${settings.opacity_percent}:${settings.pass_through ? "1" : "0"}:${settings.hide_on_hover ? "1" : "0"}`;
}

function desktopPetBubbleIntroIdentityKey(
  card: CuuCard | undefined,
  input: { compact_card: boolean; window_mode_status?: "syncing" | "failed" | undefined }
) {
  if (!card || input.window_mode_status === "syncing") {
    return undefined;
  }
  return `${card.kind}:${card.id}:${input.compact_card ? "compact" : "full"}`;
}

function desktopPetStructuralRenderKey(input: {
  // L#83：用卡片版本号+id 代表结构身份，不再每帧序列化整张卡片（热路径 4Hz）。
  card_revision: number;
  card_id?: string | undefined;
  status_text?: string | undefined;
  include_reject_reasons: boolean;
  pet_window_settings: DesktopPetWindowSettings;
  requested_model_pack_id?: string | undefined;
  compact_card: boolean;
  window_mode_error?: string | undefined;
  window_mode_status?: "syncing" | "failed" | undefined;
  locale: WorkHubLocale;
}) {
  return [
    input.card_revision,
    input.card_id ?? "",
    input.status_text ?? "",
    input.include_reject_reasons ? "1" : "0",
    desktopPetWindowSettingsKey(input.pet_window_settings),
    input.requested_model_pack_id ?? "",
    input.compact_card ? "1" : "0",
    input.window_mode_error ?? "",
    input.window_mode_status ?? "",
    input.locale
  ].join("|");
}

function desktopPetPointerStateEqual(a: DesktopPetPointerSnapshot, b: DesktopPetPointerSnapshot) {
  return a.cursor_near === b.cursor_near &&
    a.hovered === b.hovered &&
    a.dragging === b.dragging &&
    a.hover_avoidance === b.hover_avoidance &&
    formatPointerNumber(a.look_x) === formatPointerNumber(b.look_x) &&
    formatPointerNumber(a.look_y) === formatPointerNumber(b.look_y) &&
    formatPointerNumber(a.avoidance_x) === formatPointerNumber(b.avoidance_x) &&
    formatPointerNumber(a.avoidance_y) === formatPointerNumber(b.avoidance_y);
}

function formatPointerNumber(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.001) {
    return "0";
  }
  return String(Math.round(value * 1000) / 1000);
}

function renderDesktopPetBubble(input: {
  card?: CuuCard | undefined;
  status_text?: string | undefined;
  include_reject_reasons?: boolean | undefined;
  compact?: boolean | undefined;
  window_mode_error?: string | undefined;
}, locale: WorkHubLocale) {
  const card = input.card;
  const compact = Boolean(input.compact);
  const kind = card && !compact ? `<span class="wh-pet-kind">${escapeHtml(petCardKindLabel(card.kind, locale))}</span>` : "";
  const priority =
    card && !compact && card.priority !== "normal"
      ? `<span class="wh-pet-priority" data-priority="${escapeHtml(card.priority)}">${escapeHtml(petPriorityLabel(card.priority, locale))}</span>`
      : "";
  const chips = compact ? "" : (card?.chips ?? []).slice(0, 4).map((chip) => renderPetChip(chip, card)).join("");
  const actions = (card?.actions ?? []).slice(0, compact ? 1 : 3).map(renderPetAction).join("");
  const liftActionsBeforeOptions = shouldLiftPetActionsBeforeOptions(card, compact);
  const freeText = !compact && card?.input ? renderPetFreeText(card.input, locale) : "";
  const progress = !compact && card?.progress?.length ? renderPetProgress(card.progress) : "";
  const sections = !compact && card?.sections?.length ? renderPetSections(card.sections) : "";
  const evidence = !compact && card?.evidence_refs?.length ? renderPetEvidence(card.evidence_refs, locale) : "";
  const inputHint = !compact && card?.input ? renderPetInputHint(card.input, locale) : "";
  const context = [progress, sections, evidence, inputHint].filter(Boolean).join("");
  const contextBeforeActions = shouldRenderPetContextBeforeActions(card, compact, context);
  const suppressStatusForContext = shouldSuppressPetStatusForContext(card, compact, context);
  const reasons = !compact && input.include_reject_reasons ? renderRejectReasons(locale) : "";
  const payloadAttrs = card?.payload_ref
    ? ` data-pet-payload-ref-entity-type="${escapeHtml(card.payload_ref.entity_type)}" data-pet-payload-ref-entity-id="${escapeHtml(card.payload_ref.entity_id)}"${card.payload_ref.href ? ` data-pet-payload-ref-href="${escapeHtml(safeHref(card.payload_ref.href))}"` : ""}`
    : "";
  const transientAttrs = input.status_text && !card ? ` data-pet-bubble-transient="true"` : "";
  // R6.P3：5 情绪 + 3 气泡（cream 审批 / white 对话 / light-blue 检索），由协议态收敛而来。
  // L#82：离线整卡（非 compact）时精灵已重映射为 worried，气泡情绪也用同一有效态，避免"忧虑猫 + 待命气泡"不一致。
  const effectiveState = card && !compact && card.state === "offline" ? "worried" : card?.state;
  const emotion = effectiveState ? cuuEmotionForState(effectiveState) : undefined;
  const tone = effectiveState ? petBubbleToneForCard(card, effectiveState) : undefined;
  const emotionAttrs = emotion && tone ? ` data-pet-bubble-emotion="${emotion}" data-pet-bubble-tone="${tone}"` : "";
  const emotionLabel = emotion && !compact ? `<span class="wh-pet-emotion">${escapeHtml(petEmotionLabel(emotion, locale))}</span>` : "";
  return `<aside class="wh-pet-bubble" data-pet-bubble="true" role="status" aria-live="polite" aria-atomic="true"${transientAttrs} ${card ? `data-cuu-card-id="${escapeHtml(card.id)}"` : ""}${card ? ` data-pet-bubble-kind="${escapeHtml(card.kind)}" data-pet-bubble-priority="${escapeHtml(card.priority)}"` : ""}${emotionAttrs}${payloadAttrs}>
    ${renderWorkHubLiquidGlassLayer("pet")}
    <span class="wh-liquid-glass-rim" aria-hidden="true"></span>
    <div class="wh-liquid-glass-content">
      <div class="wh-pet-kicker"><span class="wh-pet-dot" aria-hidden="true"></span><span>Cuu</span>${emotionLabel}${kind}${priority}${card ? `<button type="button" class="wh-pet-dismiss ds-pressable" data-pet-dismiss="${escapeHtml(card.id)}" aria-label="${escapeHtml(locale === "en-US" ? "Dismiss" : "知道了")}">×</button>` : ""}</div>
      ${card ? `<strong class="wh-pet-title">${escapeHtml(card.title)}</strong>` : ""}
      ${card && !compact ? `<p class="wh-pet-message">${escapeHtml(card.message)}</p>` : ""}
      ${input.status_text && (!compact || !card) && !suppressStatusForContext ? `<p class="wh-pet-status">${escapeHtml(input.status_text)}</p>` : ""}
      ${input.window_mode_error && !actions ? `<p class="wh-pet-status">${escapeHtml(input.window_mode_error)}</p>` : ""}
      ${contextBeforeActions && context ? `<div class="wh-pet-context" data-pet-context="true">${context}</div>` : ""}
      ${liftActionsBeforeOptions && actions ? `<div class="wh-pet-actions">${actions}</div>` : ""}
      ${chips ? `<div class="wh-pet-chips">${chips}</div>` : ""}
      ${freeText}
      ${!liftActionsBeforeOptions && actions ? `<div class="wh-pet-actions">${actions}</div>` : ""}
      ${reasons}
      ${!contextBeforeActions && context ? `<div class="wh-pet-context" data-pet-context="true">${context}</div>` : ""}
    </div>
  </aside>`;
}

function petCardHasContext(card: CuuCard) {
  return Boolean(card.sections?.length || card.progress?.length || card.input || card.evidence_refs?.length);
}

function petBubbleToneForCard(card: CuuCard | undefined, state: CuuCard["state"]): CuuBubbleKind {
  if (card?.kind === "question") {
    return "chat";
  }
  return cuuBubbleKindForState(state);
}

function shouldLiftPetActionsBeforeOptions(card: CuuCard | undefined, compact: boolean) {
  return Boolean(
    card &&
    !compact &&
    card.kind === "question" &&
    card.actions.length > 0 &&
    (card.chips ?? []).some((chip) => chip.selected)
  );
}

function shouldSuppressPetStatusForContext(card: CuuCard | undefined, compact: boolean, context: string) {
  return Boolean(
    card &&
    !compact &&
    context &&
    (card.kind === "budget" || (card.kind === "trace" && card.state === "worried"))
  );
}

function shouldRenderPetContextBeforeActions(card: CuuCard | undefined, compact: boolean, context: string) {
  return Boolean(
    card &&
    !compact &&
    context &&
    (card.kind === "proposal" || card.payload_ref?.entity_type === "proposal" || card.source?.entity_type === "proposal")
  );
}

function renderPetChip(chip: NonNullable<CuuCard["chips"]>[number], card?: CuuCard | undefined) {
  const text = chip.description ? `${chip.label} · ${chip.description}` : chip.label;
  const optionAttrs =
    card?.kind === "question" || card?.input
      ? ` data-pet-option-id="${escapeHtml(chip.id)}" data-pet-option-first="true"`
      : "";
  const attrs = `class="wh-pet-chip" data-chip-id="${escapeHtml(chip.id)}" data-tone="${escapeHtml(chip.tone ?? "neutral")}" data-recommended="${chip.recommended ? "true" : "false"}" data-selected="${chip.selected ? "true" : "false"}"${optionAttrs}${chip.href ? ` data-chip-href="${escapeHtml(safeHref(chip.href))}"` : ""}`;
  if (optionAttrs) {
    return `<button ${attrs} type="button" aria-pressed="${chip.selected ? "true" : "false"}">${escapeHtml(text)}</button>`;
  }
  return `<span ${attrs}>${escapeHtml(text)}</span>`;
}

function renderPetAction(action: CuuCard["actions"][number]) {
  if (!action.href) {
    return `<span class="wh-pet-action" data-tone="${escapeHtml(action.tone)}">${escapeHtml(action.label)}</span>`;
  }
  return `<a class="wh-pet-action" href="${escapeHtml(safeHref(action.href))}" data-cuu-action-id="${escapeHtml(action.id)}" data-tone="${escapeHtml(action.tone)}" data-method="${escapeHtml(action.method ?? "GET")}" data-requires-reason="${action.requires_reason ? "true" : "false"}">${escapeHtml(action.label)}</a>`;
}

function renderRejectReasons(locale: WorkHubLocale) {
  const reasons = [
    cuuT(locale, "pet.reject.evidence"),
    cuuT(locale, "pet.reject.scope"),
    cuuT(locale, "pet.reject.format")
  ];
  // L10：打回理由里必须有一条退路——否则用户点了「打回」只看到三个理由,每个都立即提交拒绝,没法反悔退回卡片。
  const cancel = `<button class="wh-pet-reason wh-pet-reason--cancel" type="button" data-pet-reject-cancel>${escapeHtml(cuuT(locale, "pet.reject.cancel"))}</button>`;
  return `<div class="wh-pet-reasons">${reasons
    .map((reason) => `<button class="wh-pet-reason" type="button" data-pet-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`)
    .join("")}${cancel}</div>`;
}

function renderPetProgress(steps: NonNullable<CuuCard["progress"]>) {
  const items = steps.slice(0, 4).map(
    (step) =>
      `<li class="wh-pet-progress-step" data-state="${escapeHtml(step.state)}" data-index="${escapeHtml(step.index)}" data-step-key="${escapeHtml(step.key)}"><span class="wh-pet-progress-dot" aria-hidden="true"></span><span class="wh-pet-progress-label">${escapeHtml(step.label)}</span></li>`
  );
  return `<ol class="wh-pet-progress">${items.join("")}</ol>`;
}

function renderPetSections(sections: NonNullable<CuuCard["sections"]>) {
  return sections
    .slice(0, 2)
    .map((section) => {
      const lines = section.lines
        .filter(Boolean)
        .slice(0, 2)
        .map((line) => `<span class="wh-pet-section-line">${escapeHtml(line)}</span>`)
        .join("");
      return `<div class="wh-pet-section" data-pet-section-id="${escapeHtml(section.id)}"><span class="wh-pet-section-title">${escapeHtml(section.title)}</span>${lines}</div>`;
    })
    .join("");
}

function renderPetEvidence(evidenceRefs: NonNullable<CuuCard["evidence_refs"]>, locale: WorkHubLocale) {
  const refs = evidenceRefs.slice(0, 2);
  const hiddenCount = evidenceRefs.length - refs.length;
  const items = refs
    .map((ref) => `<span class="wh-pet-evidence-item" data-evidence-ref-id="${escapeHtml(ref.id)}">${escapeHtml(evidenceLabel(ref))}</span>`)
    .join("");
  const suffix = hiddenCount > 0
    ? `<span class="wh-pet-evidence-item">${escapeHtml(cuuFormat(locale, "pet.evidenceMore", { count: hiddenCount }))}</span>`
    : "";
  return `<div class="wh-pet-evidence" data-pet-evidence-count="${escapeHtml(evidenceRefs.length)}"><span class="wh-pet-evidence-title">${escapeHtml(cuuT(locale, "pet.evidenceTitle"))}</span>${items}${suffix}</div>`;
}

function renderPetInputHint(input: NonNullable<CuuCard["input"]>, locale: WorkHubLocale) {
  const text = input.option_first
    ? input.free_text_enabled
      ? cuuT(locale, "pet.input.optionWithText")
      : cuuT(locale, "pet.input.optionOnly")
    : cuuT(locale, "pet.input.textNeeded");
  return `<div class="wh-pet-input-hint" data-pet-input-mode="${escapeHtml(input.mode)}" data-pet-option-first="${input.option_first ? "true" : "false"}" data-pet-free-text-collapsed="${input.free_text_collapsed_by_default ? "true" : "false"}">${escapeHtml(text)}</div>`;
}

function renderPetFreeText(input: NonNullable<CuuCard["input"]>, locale: WorkHubLocale) {
  if (!input.free_text_enabled || input.option_first) {
    return "";
  }
  const placeholder = input.free_text_placeholder ?? cuuT(locale, "pet.input.textNeeded");
  const maxLength = input.free_text_max_length ? ` maxlength="${escapeHtml(String(input.free_text_max_length))}"` : "";
  return `<textarea class="wh-pet-free-text" data-pet-free-text="true" data-pet-input-mode="${escapeHtml(input.mode)}" data-pet-option-first="${input.option_first ? "true" : "false"}" placeholder="${escapeHtml(placeholder)}"${maxLength} aria-label="${escapeHtml(placeholder)}"></textarea>`;
}

function evidenceLabel(ref: NonNullable<CuuCard["evidence_refs"]>[number]) {
  const locator = ref.locator?.path ?? (ref.locator?.page ? `p.${ref.locator.page}` : ref.locator?.sheet ?? "");
  return locator ? `${ref.title} · ${locator}` : ref.title;
}

function petEmotionLabel(emotion: CuuEmotion, locale: WorkHubLocale) {
  switch (emotion) {
    case "idle":
      return cuuT(locale, "pet.emotion.idle");
    case "thinking":
      return cuuT(locale, "pet.emotion.thinking");
    case "approval":
      return cuuT(locale, "pet.emotion.approval");
    case "worried":
      return cuuT(locale, "pet.emotion.worried");
    case "celebrating":
      return cuuT(locale, "pet.emotion.celebrating");
  }
}

function petCardKindLabel(kind: CuuCard["kind"], locale: WorkHubLocale) {
  switch (kind) {
    case "question":
      return cuuT(locale, "pet.kind.question");
    case "approval":
      return cuuT(locale, "pet.kind.approval");
    case "proposal":
      return cuuT(locale, "pet.kind.proposal");
    case "evidence":
      return cuuT(locale, "pet.kind.evidence");
    case "budget":
      return cuuT(locale, "pet.kind.budget");
    case "sync":
      return cuuT(locale, "pet.kind.sync");
    case "trace":
      return cuuT(locale, "pet.kind.trace");
    case "completion":
      return cuuT(locale, "pet.kind.completion");
    case "offline":
      return cuuT(locale, "pet.kind.offline");
    case "bubble":
      return cuuT(locale, "pet.kind.bubble");
  }
}

function petPriorityLabel(priority: CuuCard["priority"], locale: WorkHubLocale) {
  switch (priority) {
    case "urgent":
      return cuuT(locale, "pet.priority.urgent");
    case "high":
      return cuuT(locale, "pet.priority.high");
    case "low":
      return cuuT(locale, "pet.priority.low");
    case "normal":
      return cuuT(locale, "pet.priority.normal");
  }
}

// DSK-06：令牌读取走 desktop-client-token.ts 单一收口。
function clientToken() {
  const storage = globalThis.localStorage;
  return storage ? readDesktopClientToken(storage) : undefined;
}

function agentRunIdFromPetCard(card: CuuCard | undefined) {
  return card?.payload_ref?.entity_type === "agent_run" ? card.payload_ref.entity_id : undefined;
}

function normalizeDesktopPetCard(card: CuuCard | undefined, locale: WorkHubLocale) {
  if (!card) {
    return card;
  }
  let next = card;
  if (card.kind === "question" && card.input?.mode === "long_text") {
    const submitLabel = cuuT(locale, "question.submitAnswer");
    const actions = card.actions.map((action) =>
      action.id === "submit_option" && action.label !== submitLabel ? { ...action, label: submitLabel } : action
    );
    if (!actions.every((action, index) => action === card.actions[index])) {
      next = { ...next, actions };
    }
  }
  if (isDesktopPetProposalCard(next)) {
    const openLabel = cuuT(locale, "proposal.openReview");
    const actions = next.actions.map((action) =>
      (action.id === "open" || action.id === "open_proposal" || action.id === "view") && action.label !== openLabel
        ? { ...action, label: openLabel }
        : action
    );
	    const message = desktopPetPublicProposalSummary(next.message, locale);
	    const title = desktopPetPublicProposalTitle(next.title, locale);
	    const sections = (next.sections ?? []).filter((section) => section.id !== "summary");
	    next = {
	      ...next,
	      title,
	      message,
	      actions,
	      sections
	    };
  }
  return next;
}

function isDesktopPetProposalCard(card: CuuCard) {
  return card.kind === "proposal" ||
    card.payload_ref?.entity_type === "proposal" ||
    card.source?.entity_type === "proposal";
}

function desktopPetStripProposalOpenedPrefix(text: string) {
  return text.replace(/^(?:AI|Cuu)\s*已(?:生成|创建|准备好)?变更申请[：:\s]+/iu, "").trim();
}

function desktopPetIsModelSelfNarration(text: string) {
  return /deliverable is written|(?:deliverable|file) looks (?:good and )?complete|well-structured|let me now provide|summary in chinese|as require|接下来我|我会先|我已经|完成了?[。.!！\s]*(?:让?我来?|接下来我|我(?:会|要|将|可以|已经)).{0,24}(?:总结|说明|整理|输出|回复)/iu.test(text);
}

function desktopPetPublicProposalTitle(title: string, locale: WorkHubLocale) {
  const compact = desktopPetStripProposalOpenedPrefix(title).replace(/\s+/g, " ").trim();
  return !compact || desktopPetIsModelSelfNarration(compact) ? cuuT(locale, "proposal.reviewTitle") : compact;
}

function desktopPetPublicProposalSummary(message: string, locale: WorkHubLocale) {
  const compact = desktopPetStripProposalOpenedPrefix(message).replace(/\s+/g, " ").trim();
  return !compact || desktopPetIsModelSelfNarration(compact) ? cuuT(locale, "proposal.summaryFallback") : compact;
}

function desktopPetAgentRunIsActive(run: AgentRunLiveVM) {
  return run.status === "queued" || run.status === "running";
}

function writeDesktopPetRestoreState(card: CuuCard | undefined) {
  try {
    const state = desktopPetRestoreStateFromCard(card);
    if (!state) {
      globalThis.localStorage?.removeItem(desktopPetRunRestoreStorageKey);
      return;
    }
    globalThis.localStorage?.setItem(desktopPetRunRestoreStorageKey, JSON.stringify(state));
  } catch {
    // localStorage may be disabled in privacy-mode webviews or test DOMs.
  }
}

function readDesktopPetRestoreState(): DesktopPetRestoreState | undefined {
  let raw: string | null | undefined;
  try {
    raw = globalThis.localStorage?.getItem(desktopPetRunRestoreStorageKey);
  } catch {
    return undefined;
  }
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DesktopPetRestoreState> | undefined;
    if (!parsed || parsed.version !== 1 || typeof parsed.entity_id !== "string" || !parsed.entity_id) {
      return undefined;
    }
    if (parsed.entity_type === "agent_run") {
      return {
        version: 1,
        entity_type: "agent_run",
        entity_id: parsed.entity_id,
        href: typeof parsed.href === "string" ? parsed.href : undefined,
        updated_at_ms: typeof parsed.updated_at_ms === "number" ? parsed.updated_at_ms : Date.now()
      };
    }
    if (parsed.entity_type === "session" && isRestorableCuuSessionCard(parsed.card, parsed.entity_id)) {
      return {
        version: 1,
        entity_type: "session",
        entity_id: parsed.entity_id,
        href: typeof parsed.href === "string" ? parsed.href : undefined,
        card: parsed.card,
        updated_at_ms: typeof parsed.updated_at_ms === "number" ? parsed.updated_at_ms : Date.now()
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function desktopPetRestoreStateFromCard(card: CuuCard | undefined): DesktopPetRestoreState | undefined {
  const ref = card?.payload_ref;
  if (!ref) {
    return undefined;
  }
  if (ref.entity_type === "agent_run") {
    return {
      version: 1,
      entity_type: "agent_run",
      entity_id: ref.entity_id,
      href: ref.href,
      updated_at_ms: Date.now()
    };
  }
  if (ref.entity_type === "session") {
    return {
      version: 1,
      entity_type: "session",
      entity_id: ref.entity_id,
      href: ref.href,
      card,
      updated_at_ms: Date.now()
    };
  }
  return undefined;
}

function isRestorableCuuSessionCard(value: unknown, sessionId: string): value is CuuCard {
  if (!value || typeof value !== "object") {
    return false;
  }
  const card = value as Partial<CuuCard>;
  return typeof card.id === "string" &&
    typeof card.title === "string" &&
    typeof card.message === "string" &&
    Array.isArray(card.actions) &&
    card.payload_ref?.entity_type === "session" &&
    card.payload_ref.entity_id === sessionId;
}

function actionMessage(error: unknown, locale: WorkHubLocale) {
  if (error instanceof WorkHubApiError) {
    return cardFromDesktopPetActionError(error, locale).message;
  }
  return error instanceof Error ? error.message : cuuT(locale, "pet.actionFail");
}

function proposalConflictCardFromApiError(error: unknown, locale: WorkHubLocale) {
  if (!(error instanceof WorkHubApiError) || error.code !== "merge_conflict") {
    return undefined;
  }
  const details = error.details as { conflicts?: unknown[] } | undefined;
  const conflict = details?.conflicts?.[0];
  if (!conflict || typeof conflict !== "object") {
    return undefined;
  }
  return cardFromProposalConflict(conflict as ProposalConflict, { locale });
}

function cardFromDesktopPetActionError(error: unknown, locale: WorkHubLocale) {
  return proposalConflictCardFromApiError(error, locale) ?? cardFromDesktopCuuRuntimeError(error, { locale });
}

function desktopPetQaScenarioStartsRunApiFlow(scenario: ReturnType<typeof desktopPetQaScenarioFromGlobal>) {
  return scenario === "run-stream" ||
    scenario === "run-failure" ||
    scenario === "permission-401" ||
    scenario === "permission-403" ||
    scenario === "generic-runtime-error" ||
    scenario === "stream-offline";
}

function desktopPetQaScenarioUsesRestoreSeed(scenario: ReturnType<typeof desktopPetQaScenarioFromGlobal>) {
  return scenario === "reload-session" ||
    scenario === "reload-active-run" ||
    scenario === "reload-terminal-run";
}

function desktopPetQaScenarioSkipsLocalRestore(scenario: ReturnType<typeof desktopPetQaScenarioFromGlobal>) {
  return Boolean(scenario) && !desktopPetQaScenarioUsesRestoreSeed(scenario);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    // rank20：补单引号转义，与 @workhub/web-runtime 的规范 escapeHtml 对齐（防单引号属性逃逸，纵深防御）。
    .replace(/'/gu, "&#39;");
}

// 外部/契约来源的 href 可能带 javascript:/data: → 点击即 XSS。只放行相对路径与 http(s)/mailto，其余拦成 "#"。
function safeHref(value: unknown): string {
  const v = String(value ?? "").trim();
  if ((v.startsWith("/") && !v.startsWith("//")) || /^(?:https?:|mailto:)/iu.test(v)) {
    return v;
  }
  return "#";
}

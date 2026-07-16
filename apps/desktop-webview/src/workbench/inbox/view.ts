// WorkHub 桌面 · 工作台「决策收件箱」中栏视图（R15 批 I1）。
// 双端零导流的收尾：Spotlight 的 attention 视图（approval/plan_review/proposal_review/budget/escalation/
// sync_conflict/memory_conflict 全类型 + 通过/打回理由/详情/评论/合并冲突编辑）此前是全桌面最完整的决策面，
// 工作台却只能从聊天点开单个 proposal 右栏。这里把那套渲染 + 动作逻辑（已抽成 spotlight/views/attention.ts
// 的 mountAttentionInbox 共用入口）挂进工作台中栏，做一层薄壳适配：
//   * open → proposal 详情走右栏（onOpenProposal → shell 的 proposalPanel.showForProposal，与聊天产出卡
//     「看提议」同一个控制器），其它导航型目标（工作项/回放/设置/成本）诚实提示去主窗口对应能力看；
//   * requestResize → no-op（工作台中栏是固定栏，不是会生长的聚焦盒）；
//   * toast → 中栏顶部一条内联轻提示（工作台没有聚焦盒那套浮层 toast）；
//   * onActionSettled → 上抛宿主（刷新左栏「待拍板」计数徽标 + 军团面板）。
// 样式随工作台玻璃体系（workbench/inbox/css.ts，全 --ds-* token 作用域在 .wh-wb-inbox）。

import {
  mountAttentionInbox,
  type AttentionInboxApiClient,
  type AttentionInboxNavView
} from "../../spotlight/views/attention.js";
import { workbenchInboxCss } from "./css.js";

type Locale = "zh-CN" | "en-US";

export type InboxViewApiClient = AttentionInboxApiClient;

export type InboxViewHandle = {
  dispose: () => void;
  // #17：宿主（shell.refreshInboxBadge，当 centerTab==='inbox' 时）在角标随 SSE/轮询刷新时同步调这个，
  // 让开着的收件箱列表随角标一起活——不必切走再切回。
  refresh: () => void;
};

export function mountInboxView(
  container: HTMLElement,
  input: {
    client: InboxViewApiClient;
    locale: Locale;
    // proposal「看详情」→ 右栏提议详情（与聊天产出卡「看提议」汇流到同一个 shell 控制器）。可选：不接
    // （测试/其它宿主）时导航型 proposal 动作退回诚实提示，不摆一个点了没反应的假入口（04 §4 铁律 3）。
    onOpenProposal?: (proposalId: string) => void;
    // 写动作落定后回流宿主：刷新左栏「待拍板」计数徽标 + 军团面板（与右栏审批的 onSettled 同源语义）。
    onActionSettled?: () => void;
  }
): InboxViewHandle {
  const zh = input.locale === "zh-CN";

  container.className = "wh-wb-center wh-wb-center--inbox";
  container.innerHTML = `<style>${workbenchInboxCss}</style>
    <div class="wh-wb-inbox">
      <div class="wh-wb-inbox-head">
        <h2 class="wh-wb-inbox-title">${zh ? "待拍板" : "Decisions"}</h2>
        <p class="wh-wb-inbox-sub" data-wb-inbox-sub>${zh ? "所有要你拍板的，都汇到这里" : "Everything waiting on your call, in one place"}</p>
      </div>
      <div class="wh-wb-inbox-toast" data-wb-inbox-toast hidden></div>
      <div data-wb-inbox-body></div>
    </div>`;

  const bodyEl = container.querySelector<HTMLElement>("[data-wb-inbox-body]");
  const subEl = container.querySelector<HTMLElement>("[data-wb-inbox-sub]");
  const toastEl = container.querySelector<HTMLElement>("[data-wb-inbox-toast]");
  if (!bodyEl) {
    throw new Error("workbench inbox markup is missing its body mount point");
  }

  // 内联轻提示：贴顶一条，短暂自动隐去（工作台无聚焦盒那套浮层 toast）。多次触发只保留最后一条。
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = (message: string, tone: "ok" | "error" | "info" = "info") => {
    if (!toastEl) {
      return;
    }
    toastEl.className = `wh-wb-inbox-toast${tone === "ok" ? " wh-wb-inbox-toast--ok" : tone === "error" ? " wh-wb-inbox-toast--error" : ""}`;
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      if (toastEl) {
        toastEl.hidden = true;
      }
    }, 2600);
  };

  // 导航型动作路由：proposal 详情走右栏；其余目标工作台没有对等能力承接，诚实提示去主窗口对应能力看，
  // 不静默无效（04 §4 铁律 3：不摆点了没反应的假按钮，也不假装能就地打开）。
  const open = (view: AttentionInboxNavView, target?: { id?: string; route?: string }) => {
    if (view === "proposals" && target?.id && input.onOpenProposal) {
      input.onOpenProposal(target.id);
      return;
    }
    toast(zh ? "这项去主窗口对应能力查看" : "Open this in its capability in the main window", "info");
  };

  const mountHandle = mountAttentionInbox({
    client: input.client,
    locale: input.locale,
    body: bodyEl,
    setSubtitle: (text: string) => {
      if (subEl) {
        subEl.textContent = text;
      }
    },
    toast,
    // 工作台中栏是固定滚动栏，不随内容缩放原生窗口——no-op。
    requestResize: () => {},
    open,
    onActionSettled: () => input.onActionSettled?.()
  });

  return {
    dispose: () => {
      mountHandle.dispose();
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = undefined;
      }
    },
    // #17：透传共用 mount 的重拉句柄——shell 在角标刷新且中栏正是收件箱时调它同步列表。
    refresh: () => mountHandle.refresh()
  };
}

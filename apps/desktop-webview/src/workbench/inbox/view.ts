// WorkHub 桌面 · 工作台「决策收件箱」中栏视图（R15 批 I1 + R17-G5 #29）。
// 双端零导流的收尾：Spotlight 的 attention 视图（approval/plan_review/proposal_review/budget/escalation/
// sync_conflict/memory_conflict 全类型 + 通过/打回理由/详情/评论/合并冲突编辑）此前是全桌面最完整的决策面，
// 工作台却只能从聊天点开单个 proposal 右栏。这里把那套渲染 + 动作逻辑（已抽成 spotlight/views/attention.ts
// 的 mountAttentionInbox 共用入口）挂进工作台中栏，做一层薄壳适配：
//   * open → proposal 详情走右栏（onOpenProposal → shell 的 proposalPanel.showForProposal，与聊天产出卡
//     「看提议」同一个控制器），其它导航型目标（工作项/回放/设置/成本）诚实提示去主窗口对应能力看；
//   * requestResize → no-op（工作台中栏是固定栏，不是会生长的聚焦盒）；
//   * toast → 中栏顶部一条内联轻提示（工作台没有聚焦盒那套浮层 toast）；
//   * onActionSettled → 上抛宿主（刷新左栏「待拍板」计数徽标 + 军团面板）。
//
// R17-G5 #29（按 kind 筛选 + 批量通过）：筛选态刻意**只活在工作台壳层**（activeFilter/batch），不进共享
// mountAttentionInbox 的内部状态——共享 mount 照旧只负责渲队列 + 动作，spotlight 聚焦盒零改。壳层用一个
// MutationObserver 观察共享 mount 每次重渲后的 body：重算各 kind 计数、按当前筛选隐藏不匹配的卡、把批量
// 失败逐条标注回贴到对应卡（refresh 后仍在）。批量只对 approval 类提供「全部通过」——其它 kind 语义不适合
// 批量（升级要选处理方式、提议要看 diff、预算要看额度、冲突要逐条挑方案），不做（见报告）。
// 样式随工作台玻璃体系（workbench/inbox/css.ts，全 --ds-* token 作用域在 .wh-wb-inbox）。

import { approvalRespondIdFromHref } from "@workhub/web-runtime";

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

// #29：筛选分组 → 归属的 AttentionItem kind 集合（kinds=null＝「全部」）。memory-conflict 在契约里
// 归 sync_conflict（无独立 memory_conflict kind），故「冲突」组只列 sync_conflict。clarification/
// knowledge_result/delivery_ready/system_health 不落任一分组 chip——只在「全部」下出现（穷举兜底）。
export type InboxFilterGroupId = "all" | "approval" | "proposal" | "escalation" | "budget" | "conflict";

export const INBOX_FILTER_GROUPS: {
  id: InboxFilterGroupId;
  zh: string;
  en: string;
  kinds: string[] | null;
}[] = [
  { id: "all", zh: "全部", en: "All", kinds: null },
  { id: "approval", zh: "审批", en: "Approvals", kinds: ["approval"] },
  { id: "proposal", zh: "提议", en: "Proposals", kinds: ["proposal_review", "plan_review"] },
  { id: "escalation", zh: "升级", en: "Escalations", kinds: ["escalation"] },
  { id: "budget", zh: "预算", en: "Budget", kinds: ["budget"] },
  { id: "conflict", zh: "冲突", en: "Conflicts", kinds: ["sync_conflict"] }
];

export function inboxFilterGroup(id: InboxFilterGroupId): { kinds: string[] | null } {
  return INBOX_FILTER_GROUPS.find((group) => group.id === id) ?? { kinds: null };
}

export function kindMatchesGroup(kind: string, id: InboxFilterGroupId): boolean {
  const kinds = inboxFilterGroup(id).kinds;
  return kinds === null || kinds.includes(kind);
}

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
      <div class="wh-wb-inbox-controls" data-wb-inbox-controls hidden>
        <div class="wh-wb-inbox-chips" data-wb-inbox-chips></div>
        <div class="wh-wb-inbox-batch" data-wb-inbox-batch></div>
      </div>
      <p class="wh-wb-inbox-filternote" data-wb-inbox-filternote hidden></p>
      <div class="wh-wb-inbox-toast" data-wb-inbox-toast hidden></div>
      <div data-wb-inbox-body></div>
    </div>`;

  const bodyEl = container.querySelector<HTMLElement>("[data-wb-inbox-body]");
  const subEl = container.querySelector<HTMLElement>("[data-wb-inbox-sub]");
  const toastEl = container.querySelector<HTMLElement>("[data-wb-inbox-toast]");
  const controlsEl = container.querySelector<HTMLElement>("[data-wb-inbox-controls]");
  const chipsEl = container.querySelector<HTMLElement>("[data-wb-inbox-chips]");
  const batchEl = container.querySelector<HTMLElement>("[data-wb-inbox-batch]");
  const filterNoteEl = container.querySelector<HTMLElement>("[data-wb-inbox-filternote]");
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

  // —— #29 壳层筛选 + 批量（不进共享 mount 内部状态）—— //
  let activeFilter: InboxFilterGroupId = "all";
  let batchState: "idle" | "confirm" | "busy" = "idle";
  // 批量失败的 AttentionItem id（refresh 后共享 mount 重渲，观察器据此把「未通过」标注回贴到对应卡）。
  let failedItemIds = new Set<string>();

  const cardsInBody = (): HTMLElement[] =>
    Array.from(bodyEl.querySelectorAll<HTMLElement>("[data-att-id][data-att-kind]"));

  // 从一张 approval 卡里取出「通过」动作对应的审批 id（非 deny、非「需理由」的那颗，其 href 形如
  // /api/approvals/:id/respond）。取不到（结构异常）返回 undefined，批量时跳过、不误提交。
  const approvalIdFromCard = (card: HTMLElement): string | undefined => {
    if (card.dataset.attKind !== "approval") {
      return undefined;
    }
    for (const btn of card.querySelectorAll<HTMLElement>("[data-att-href]")) {
      if (btn.dataset.attActionId === "deny" || btn.dataset.attRequiresReason === "true") {
        continue;
      }
      const id = approvalRespondIdFromHref(btn.dataset.attHref ?? "");
      if (id) {
        return id;
      }
    }
    return undefined;
  };

  const renderChips = (cards: HTMLElement[]): void => {
    if (!chipsEl) {
      return;
    }
    const kinds = cards.map((card) => card.dataset.attKind ?? "");
    // 只渲当前队列里真实出现的分组（外加常驻「全部」），避免摆一堆 0 计数的死 chip。
    const chips = INBOX_FILTER_GROUPS.filter((group) => {
      if (group.id === "all") {
        return true;
      }
      return kinds.some((kind) => kindMatchesGroup(kind, group.id));
    }).map((group) => {
      const count = group.kinds === null ? cards.length : kinds.filter((kind) => kindMatchesGroup(kind, group.id)).length;
      const active = group.id === activeFilter;
      return `<button type="button" class="wh-wb-inbox-chip${active ? " wh-wb-inbox-chip--active" : ""}" data-wb-inbox-chip="${group.id}"${
        active ? ' aria-pressed="true"' : ""
      }>${zh ? group.zh : group.en}<span class="wh-wb-inbox-chip-n">${count}</span></button>`;
    });
    chipsEl.innerHTML = chips.join("");
  };

  const renderBatch = (cards: HTMLElement[]): void => {
    if (!batchEl) {
      return;
    }
    const approvalCount = cards.filter((card) => card.dataset.attKind === "approval").length;
    // 批量只在「全部/审批」视图下、且有 approval 卡时出现（其它筛选下批量按钮与在看的内容不相干）。
    const relevant = approvalCount > 0 && (activeFilter === "all" || activeFilter === "approval");
    if (!relevant) {
      batchEl.innerHTML = "";
      return;
    }
    if (batchState === "busy") {
      batchEl.innerHTML = `<button type="button" class="wh-wb-inbox-batchbtn" disabled>${zh ? "处理中…" : "Working…"}</button>`;
      return;
    }
    if (batchState === "confirm") {
      batchEl.innerHTML = `<span class="wh-wb-inbox-batch-q">${
        zh ? `确认通过全部 ${approvalCount} 条审批？` : `Approve all ${approvalCount} approvals?`
      }</span>
        <button type="button" class="wh-wb-inbox-batchbtn wh-wb-inbox-batchbtn--go" data-wb-inbox-batch-confirm>${zh ? "全部通过" : "Approve all"}</button>
        <button type="button" class="wh-wb-inbox-batchbtn" data-wb-inbox-batch-cancel>${zh ? "取消" : "Cancel"}</button>`;
      return;
    }
    batchEl.innerHTML = `<button type="button" class="wh-wb-inbox-batchbtn" data-wb-inbox-batch-start>${
      zh ? `全部通过（${approvalCount}）` : `Approve all (${approvalCount})`
    }</button>`;
  };

  // 观察共享 mount 每次重渲后的 body → 重算 chip 计数、按当前筛选隐藏不匹配的卡、回贴批量失败标注。
  // 自身的 DOM 改动会再触发观察器——用 disconnect/observe 包住，避免自激循环。
  let observer: MutationObserver | undefined;
  let reconciling = false;
  const reconcile = (): void => {
    if (reconciling) {
      return;
    }
    reconciling = true;
    observer?.disconnect();
    try {
      const cards = cardsInBody();
      if (cards.length === 0) {
        // 加载 / 空态 / 错误 / 冲突面板——没有可筛的卡，收起筛选条与失败标注。
        if (controlsEl) {
          controlsEl.hidden = true;
        }
        if (filterNoteEl) {
          filterNoteEl.hidden = true;
        }
        return;
      }
      if (controlsEl) {
        controlsEl.hidden = false;
      }
      // 当前筛选分组在队列里已无卡（都被处理掉了）——退回「全部」。
      if (activeFilter !== "all" && !cards.some((card) => kindMatchesGroup(card.dataset.attKind ?? "", activeFilter))) {
        activeFilter = "all";
      }
      let visible = 0;
      for (const card of cards) {
        const match = kindMatchesGroup(card.dataset.attKind ?? "", activeFilter);
        card.classList.toggle("wh-wb-inbox-cardhidden", !match);
        if (match) {
          visible += 1;
        }
        // 批量失败标注：先清旧标，命中失败集则贴一条（refresh 后仍能重新贴上）。
        card.querySelector("[data-wb-inbox-failmark]")?.remove();
        if (failedItemIds.has(card.dataset.attId ?? "")) {
          const host = card.querySelector<HTMLElement>(".wh-spot-card-main") ?? card;
          host.insertAdjacentHTML(
            "beforeend",
            `<p class="wh-wb-inbox-failmark" data-wb-inbox-failmark>${
              zh ? "批量通过时这条没成功，单独再试一次。" : "This one didn't go through in the batch — try it individually."
            }</p>`
          );
        }
      }
      if (filterNoteEl) {
        if (visible === 0) {
          filterNoteEl.textContent = zh ? "当前筛选下没有待办。" : "Nothing under this filter.";
          filterNoteEl.hidden = false;
        } else {
          filterNoteEl.hidden = true;
        }
      }
      renderChips(cards);
      renderBatch(cards);
    } finally {
      reconciling = false;
      observer?.observe(bodyEl, { childList: true, subtree: true });
    }
  };

  const runBatchApprove = async (): Promise<void> => {
    const targets: { itemId: string; approvalId: string }[] = [];
    for (const card of cardsInBody()) {
      const approvalId = approvalIdFromCard(card);
      const itemId = card.dataset.attId;
      if (approvalId && itemId) {
        targets.push({ itemId, approvalId });
      }
    }
    if (targets.length === 0) {
      batchState = "idle";
      reconcile();
      return;
    }
    batchState = "busy";
    failedItemIds = new Set();
    reconcile();
    const failed = new Set<string>();
    // 逐条调用现有单条端点（不用聚合的 respond-batch，好让失败逐条定位到卡）；单条失败不翻整批。
    for (const target of targets) {
      try {
        await input.client.respondApproval(target.approvalId, { decision: "allow", remember: "once" });
      } catch {
        failed.add(target.itemId);
      }
    }
    failedItemIds = failed;
    batchState = "idle";
    const okCount = targets.length - failed.size;
    if (okCount > 0 && failed.size === 0) {
      toast(zh ? `已通过 ${okCount} 条审批` : `Approved ${okCount} approval${okCount === 1 ? "" : "s"}`, "ok");
    } else if (okCount > 0) {
      toast(
        zh ? `已通过 ${okCount} 条，${failed.size} 条未通过` : `Approved ${okCount}, ${failed.size} failed`,
        "info"
      );
    } else {
      toast(zh ? "没有审批通过（可能都已被处理）" : "None approved (they may already be handled)", "error");
    }
    input.onActionSettled?.();
    // 重拉队列：通过的掉出、失败的仍在——观察器 reconcile 会把失败标注重新贴上。
    mountHandle.refresh();
  };

  // 筛选/批量的点击（壳层控件，不落进共享 mount 的 body 监听）。
  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const chip = event.target.closest<HTMLElement>("[data-wb-inbox-chip]");
    if (chip?.dataset.wbInboxChip) {
      activeFilter = chip.dataset.wbInboxChip as InboxFilterGroupId;
      batchState = "idle";
      reconcile();
      return;
    }
    if (event.target.closest("[data-wb-inbox-batch-start]")) {
      batchState = "confirm";
      reconcile();
      return;
    }
    if (event.target.closest("[data-wb-inbox-batch-cancel]")) {
      batchState = "idle";
      reconcile();
      return;
    }
    if (event.target.closest("[data-wb-inbox-batch-confirm]")) {
      void runBatchApprove();
    }
  });

  observer = new MutationObserver(() => reconcile());
  observer.observe(bodyEl, { childList: true, subtree: true });
  // 首帧共享 mount 已同步写了 loading——先跑一次 reconcile（收起筛选条），队列到达时观察器再刷。
  reconcile();

  return {
    dispose: () => {
      observer?.disconnect();
      observer = undefined;
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

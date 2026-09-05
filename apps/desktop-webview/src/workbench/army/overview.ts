// WorkHub 桌面 · 军团总览——工作台中栏视图（centerTab === "army-overview"）。跨项目的军团 run 卡片流
// （GET /api/me/army，按 project_name 分组），不依赖 selectedProjectId/workbench VM。照
// drive/view.ts 的 imperative 挂载/事件绑定分工（纯渲染在 render.ts，这里只管拉数据 + 绑 DOM 事件 +
// 维护翻页/刷新这点瞬态状态）。
//
// 刷新策略（02 计划 P1 原话「总览视图手动『刷新』按钮」）：这是一个跨项目聚合视图，不属于任何单个
// 会话的 SSE topic，没有天然的事件可以拿来触发重拉——所以只在挂载时拉一次 + 一个手动刷新按钮，
// 不新开轮询/SSE 连接（04 §4 铁律 4：不许无界轮询）。

import type { WorkHubApiClient } from "@workhub/api-client";
import type { ArmyOverviewPageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { fetchArmyOverview } from "./api.js";
import { armyDataAgeLabel, mergeArmyRunPages, renderArmyOverviewHtml, type ArmyOverviewViewState } from "./render.js";

import { armyT } from "./locales.js";
import { withErrorDetail } from "../../load-state-copy.js";

type Locale = "zh-CN" | "en-US";

export type ArmyOverviewApiClient = Pick<WorkHubApiClient, "request">;

// R17 G3(#21)：总览卡片下钻——把项目/会话/run id 抛给 shell，由它 selectProject(该项目) + 右栏定位该 run
// 详情。conversationId 可选：系统派发、无血缘会话的 run 只能 selectProject，无从定位右栏详情。
export type ArmyOverviewOpenRunInput = {
  projectId: string;
  runId: string;
  conversationId?: string;
};

export type ArmyOverviewViewHandle = {
  dispose: () => void;
  refresh: () => void;
};

// S-4：产品文案在前，原始报错只作次级信息（旧写法真出错时把服务端裸串顶替了产品句子）。
function errorMessage(error: unknown, locale: Locale): string {
  return withErrorDetail(locale, armyT(locale, "couldnTLoadTheArmyOverview"), error);
}

export function mountArmyOverviewView(
  container: HTMLElement,
  input: { client: ArmyOverviewApiClient; locale: Locale; onOpenRun?: (input: ArmyOverviewOpenRunInput) => void }
): ArmyOverviewViewHandle {
  let disposed = false;
  let state: ArmyOverviewViewState = { mode: "loading" };
  let loadGeneration = 0;

  function render(): void {
    if (disposed) {
      return;
    }
    const zh = input.locale === "zh-CN";
    const refreshing = state.mode === "loading";
    // R17 G3(#32)：头部标注「数据加载于 N 分钟前」——总览是跨项目聚合、无天然 SSE 刷新，让用户知道手里
    // 这份是多久前的快照（配合既有的手动刷新按钮）。只在有数据时标注。
    const ageLabel = state.mode === "ready" ? armyDataAgeLabel(state.vm.generated_at, Date.now(), zh) : "";
    const ageHtml = ageLabel ? `<span class="wh-wb-army-ov-age">${escapeHtml(ageLabel)}</span>` : "";
    container.innerHTML = `<div class="wh-wb-army-overview">
      <div class="wh-wb-army-ov-bar">
        <div class="wh-wb-army-ov-title">${armyT(input.locale, "armyOverview")}</div>
        ${ageHtml}
        <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-army-ov-refresh ${refreshing ? "disabled" : ""}>${armyT(input.locale, "refresh")}</button>
      </div>
      <div class="wh-wb-army-ov-body">${renderArmyOverviewHtml(state, input.locale)}</div>
    </div>`;
  }

  function load(): void {
    const generation = ++loadGeneration;
    state = { mode: "loading" };
    render();
    void fetchArmyOverview(input.client)
      .then((vm) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        state = { mode: "ready", vm, loadingMore: false };
        render();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        state = { mode: "error", message: errorMessage(error, input.locale) };
        render();
      });
  }

  function loadMore(): void {
    if (state.mode !== "ready" || state.loadingMore || !state.vm.runs.next_cursor) {
      return;
    }
    const cursor = state.vm.runs.next_cursor;
    const generation = ++loadGeneration;
    // exactOptionalPropertyTypes：loadMoreError 是 string?，不接受显式 undefined——构造一个全新对象
    // 而不是 {...state, loadMoreError: undefined} 来清掉上一次的错误。
    state = { mode: "ready", vm: state.vm, loadingMore: true };
    render();
    void fetchArmyOverview(input.client, { afterCreatedAt: cursor.after_created_at, afterId: cursor.after_id })
      .then((vm: ArmyOverviewPageVM) => {
        if (disposed || generation !== loadGeneration || state.mode !== "ready") {
          return;
        }
        const mergedRuns = mergeArmyRunPages(state.vm.runs.runs, vm.runs.runs);
        state = {
          mode: "ready",
          vm: { ...vm, runs: { ...vm.runs, runs: mergedRuns } },
          loadingMore: false
        };
        render();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration || state.mode !== "ready") {
          return;
        }
        state = { ...state, loadingMore: false, loadMoreError: errorMessage(error, input.locale) };
        render();
      });
  }

  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const el = event.target;
    if (el.closest("[data-wb-army-ov-refresh],[data-wb-army-ov-retry]")) {
      load();
      return;
    }
    if (el.closest("[data-wb-army-ov-load-more]")) {
      loadMore();
      return;
    }
    // R17 G3(#21)：卡片下钻——把 project/run/conversation id 抛给 shell（selectProject + 右栏定位该 run 详情）。
    const drilldown = el.closest<HTMLElement>("[data-wb-army-ov-drilldown]");
    if (drilldown) {
      const projectId = drilldown.dataset.wbArmyProjectId;
      const runId = drilldown.dataset.wbArmyRunId;
      const conversationId = drilldown.dataset.wbArmyConversationId;
      if (projectId && runId) {
        input.onOpenRun?.({ projectId, runId, ...(conversationId ? { conversationId } : {}) });
      }
    }
  });

  load();

  return {
    dispose: () => {
      disposed = true;
    },
    refresh: () => {
      load();
    }
  };
}

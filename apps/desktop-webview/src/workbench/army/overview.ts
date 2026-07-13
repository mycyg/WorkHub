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

import { fetchArmyOverview } from "./api.js";
import { mergeArmyRunPages, renderArmyOverviewHtml, type ArmyOverviewViewState } from "./render.js";

type Locale = "zh-CN" | "en-US";

export type ArmyOverviewApiClient = Pick<WorkHubApiClient, "request">;

export type ArmyOverviewViewHandle = {
  dispose: () => void;
  refresh: () => void;
};

function errorMessage(error: unknown, locale: Locale): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return locale === "zh-CN" ? "没拉到，请重试" : "Couldn't load — try again";
}

export function mountArmyOverviewView(
  container: HTMLElement,
  input: { client: ArmyOverviewApiClient; locale: Locale }
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
    container.innerHTML = `<div class="wh-wb-army-overview">
      <div class="wh-wb-army-ov-bar">
        <div class="wh-wb-army-ov-title">${zh ? "军团总览" : "Army overview"}</div>
        <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-army-ov-refresh ${refreshing ? "disabled" : ""}>${zh ? "刷新" : "Refresh"}</button>
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

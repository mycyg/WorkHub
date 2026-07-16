// WorkHub 桌面 · 工作台变更编辑器的 imperative 挂载层（取数 / 事件 / 瞬态状态；纯渲染在 render.ts）。R16-W3。
// 中栏全宽视图，随 centerTab==="editor" 挂载/卸载（不像右栏 owner 那样常驻）。语义映射到 P-COLLAB：
// 编辑器只读渲染 base↔proposed 的 tracked changes（body 走新增的 diff 端点），动作是既有提议
// review/merge 的「新皮」——批准=reviewProposalWithoutMerge、合并=mergeProposal，都走既有端点；打回要写
// 理由，不在编辑器里再造一份理由器，而是抛给右栏既有的提议详情理由面板（onRequestChanges）。

import type { PageRequestOptions, WorkHubApiClient } from "@workhub/api-client";
import { WorkHubApiError } from "@workhub/api-client";
import type { MergeProposalRequest, ProposalDetailVM } from "@workhub/contracts";

import { reviewProposalWithoutMerge } from "../../spotlight/views/proposals.js";
import { fetchProposalChangeDiff, fetchProposalDetail } from "./api.js";
import {
  renderEditorHtml,
  type EditorProposalStatus,
  type EditorReadyActions,
  type EditorViewState
} from "./render.js";

type Locale = "zh-CN" | "en-US";

export type EditorViewApiClient = Pick<WorkHubApiClient, "request" | "pages" | "mergeProposal" | "reviewProposal">;

export type EditorViewTarget = {
  proposalId: string;
  // manifest change 的 target_ref.path（右栏变动文件行点击时带过来）。
  path: string;
  filename: string;
};

export type EditorViewHandle = {
  dispose: () => void;
};

function pageOptions(locale: Locale): PageRequestOptions {
  return { locale };
}

function actionsFromDetail(detail: ProposalDetailVM): EditorReadyActions {
  const status = detail.status as EditorProposalStatus;
  return status === "reviewed" && detail.review_actions.merge
    ? { status, mergeLabel: detail.review_actions.merge.label || "合入交付物" }
    : { status };
}

function mergePayloadFromDetail(detail: ProposalDetailVM): MergeProposalRequest | undefined {
  return (detail.review_actions.merge?.request_json ?? undefined) as MergeProposalRequest | undefined;
}

export function mountEditorView(
  container: HTMLElement,
  input: {
    client: EditorViewApiClient;
    locale: Locale;
    target: EditorViewTarget;
    // 打回要写理由——抛给右栏既有提议详情的理由面板（shell 转 proposalPanel.showForProposal focusReason）。
    onRequestChanges: (proposalId: string) => void;
    // 批准/合并在本机落定后：让聊天产出卡覆盖标 + 军团面板/变动文件后台重拉（shell 统一转发，与右栏
    // proposalPanel.onSettled 同一条回流管线）。
    onSettled: (proposalId: string) => void;
    // 关闭编辑器——回到打开前的中栏视图（shell 维护返回栈）。
    onClose: () => void;
  }
): EditorViewHandle {
  let disposed = false;
  let state: EditorViewState = { mode: "loading", filename: input.target.filename };
  let detail: ProposalDetailVM | undefined;
  let mergePayload: MergeProposalRequest | undefined;
  const expanded = new Set<number>();
  let busy = false;
  let loadGeneration = 0;

  function render(): void {
    if (disposed) {
      return;
    }
    container.className = "wh-wb-center wh-wb-center--editor";
    container.innerHTML = renderEditorHtml(state, input.locale);
  }

  function setReadyUi(patch: { busy?: "approve" | "merge"; notice?: string } = {}): void {
    if (state.mode !== "ready") {
      return;
    }
    state = {
      mode: "ready",
      diff: state.diff,
      actions: state.actions,
      ui: {
        expanded,
        ...(patch.busy ? { busy: patch.busy } : {}),
        ...(patch.notice ? { notice: patch.notice } : {})
      }
    };
    render();
  }

  function load(): void {
    const generation = ++loadGeneration;
    busy = false;
    state = { mode: "loading", filename: input.target.filename };
    render();
    void Promise.all([
      fetchProposalChangeDiff(input.client, input.target.proposalId, input.target.path),
      fetchProposalDetail(input.client, input.target.proposalId, pageOptions(input.locale))
    ])
      .then(([diff, loadedDetail]) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        detail = loadedDetail;
        mergePayload = mergePayloadFromDetail(loadedDetail);
        state = { mode: "ready", diff, actions: actionsFromDetail(loadedDetail), ui: { expanded } };
        render();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        if (error instanceof WorkHubApiError && error.status === 415) {
          state = { mode: "unsupported", filename: input.target.filename };
          render();
          return;
        }
        state = {
          mode: "error",
          filename: input.target.filename,
          message:
            error instanceof Error && error.message
              ? error.message
              : input.locale === "zh-CN"
                ? "变更没打开，稍后重试"
                : "Couldn't open the change — retry"
        };
        render();
      });
  }

  // 批准/合并后重拉（status 翻新：opened→reviewed 出「合并」、reviewed→merged 终态只读），复用同一条
  // loadGeneration 防竞态。不回退成错误页（动作已成功、onSettled 已触发），失败就保留当前一帧。
  function reload(): void {
    const generation = ++loadGeneration;
    void Promise.all([
      fetchProposalChangeDiff(input.client, input.target.proposalId, input.target.path),
      fetchProposalDetail(input.client, input.target.proposalId, pageOptions(input.locale))
    ])
      .then(([diff, loadedDetail]) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        detail = loadedDetail;
        mergePayload = mergePayloadFromDetail(loadedDetail);
        state = { mode: "ready", diff, actions: actionsFromDetail(loadedDetail), ui: { expanded } };
        render();
      })
      .catch(() => undefined);
  }

  function approve(): void {
    if (busy || state.mode !== "ready" || state.actions.status !== "opened") {
      return;
    }
    const proposalId = input.target.proposalId;
    busy = true;
    setReadyUi({ busy: "approve" });
    void reviewProposalWithoutMerge(input.client, proposalId, pageOptions(input.locale))
      .then(() => {
        busy = false;
        if (disposed) {
          return;
        }
        input.onSettled(proposalId);
        reload();
      })
      .catch((error: unknown) => {
        busy = false;
        if (disposed || state.mode !== "ready") {
          return;
        }
        setReadyUi({ notice: actionErrorText(error, input.locale) });
      });
  }

  function merge(): void {
    if (busy || state.mode !== "ready" || !detail || state.actions.status !== "reviewed") {
      return;
    }
    const proposalId = input.target.proposalId;
    busy = true;
    setReadyUi({ busy: "merge" });
    void input.client
      .mergeProposal(proposalId, mergePayload, pageOptions(input.locale))
      .then(() => {
        busy = false;
        if (disposed) {
          return;
        }
        input.onSettled(proposalId);
        reload();
      })
      .catch((error: unknown) => {
        busy = false;
        if (disposed || state.mode !== "ready") {
          return;
        }
        setReadyUi({ notice: actionErrorText(error, input.locale) });
      });
  }

  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const el = event.target;
    if (el.closest("[data-wb-ed-close]")) {
      input.onClose();
      return;
    }
    if (el.closest("[data-wb-ed-retry]")) {
      load();
      return;
    }
    if (el.closest("[data-wb-ed-approve]")) {
      approve();
      return;
    }
    if (el.closest("[data-wb-ed-merge]")) {
      merge();
      return;
    }
    if (el.closest("[data-wb-ed-deny]")) {
      input.onRequestChanges(input.target.proposalId);
      return;
    }
    const expandBtn = el.closest<HTMLElement>("[data-wb-ed-expand]");
    if (expandBtn?.dataset.wbEdExpand) {
      expanded.add(Number(expandBtn.dataset.wbEdExpand));
      render();
      return;
    }
    const collapseBtn = el.closest<HTMLElement>("[data-wb-ed-collapse]");
    if (collapseBtn?.dataset.wbEdCollapse) {
      expanded.delete(Number(collapseBtn.dataset.wbEdCollapse));
      render();
    }
  });

  load();

  return {
    dispose: () => {
      disposed = true;
      ++loadGeneration;
    }
  };
}

function actionErrorText(error: unknown, locale: Locale): string {
  const zh = locale === "zh-CN";
  if (error instanceof WorkHubApiError) {
    if (error.status === 403) {
      return zh ? "这份提议不归你审（可能不是你的工作区，或已交给别人）。" : "This proposal isn't yours to review.";
    }
    if (error.status === 409) {
      return zh ? "这份提议的状态已经变了，刷新后再看。" : "This proposal's status already changed — reload to see the latest.";
    }
  }
  return zh ? "没提交成功，稍后重试。" : "That didn't go through — try again in a moment.";
}

// WorkHub 桌面 · 工作台变更编辑器的 imperative 挂载层（取数 / 事件 / 瞬态状态；纯渲染在 render.ts）。R16-W3。
// 中栏全宽视图，随 centerTab==="editor" 挂载/卸载（不像右栏 owner 那样常驻）。语义映射到 P-COLLAB：
// 编辑器只读渲染 base↔proposed 的 tracked changes（body 走新增的 diff 端点），动作是既有提议
// review/merge 的「新皮」——批准=reviewProposalWithoutMerge、合并=mergeProposal，都走既有端点；打回要写
// 理由，不在编辑器里再造一份理由器，而是抛给右栏既有的提议详情理由面板（onRequestChanges）。

import type { PageRequestOptions, WorkHubApiClient } from "@workhub/api-client";
import { WorkHubApiError } from "@workhub/api-client";
import type { MergeProposalRequest, ProposalChangeDiffVM, ProposalDetailVM } from "@workhub/contracts";
import {
  actionElementApplyPayload,
  actionElementMergePayload,
  actionHrefFromElement,
  chooseThenApplyMergeCandidate,
  selectedConflictChooserCandidate
} from "@workhub/web-runtime";

import {
  classifyProposalConflictActionHref,
  proposalMergeConflictHtml,
  reviewProposalWithoutMerge
} from "../../spotlight/views/proposals.js";
import { fetchProposalChangeDiff, fetchProposalDetail } from "./api.js";
import {
  renderEditorHtml,
  type EditorFileTab,
  type EditorFilesState,
  type EditorProposalStatus,
  type EditorReadyActions,
  type EditorViewState
} from "./render.js";

type Locale = "zh-CN" | "en-US";

// #12 合并冲突逐条解决要用到 applyMergeProposalCandidate（apply 候选合入方案）——additive 扩客户端切面，
// shell 传的是全量 WorkHubApiClient，运行时本就有。
// F-05：撞车「先选稿再采纳」选择器确认后先 choose 再 apply，同样 additive 补 chooseMergeProposalCandidate。
export type EditorViewApiClient = Pick<
  WorkHubApiClient,
  "request" | "pages" | "mergeProposal" | "reviewProposal" | "applyMergeProposalCandidate" | "chooseMergeProposalCandidate"
>;

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

// #13：从 diff 的 segments 数出 +新增 / −删除 行数（context 段不计）。
function diffStat(diff: ProposalChangeDiffVM): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const segment of diff.segments) {
    if (segment.type === "add") {
      adds += segment.lines.length;
    } else if (segment.type === "del") {
      dels += segment.lines.length;
    }
  }
  return { adds, dels };
}

function filenameFromPath(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1]! : path;
}

// #13：从提议详情的 manifest.changes 里挑出「可逐行对照的文本变动文件」（有 path + generated_content_md，
// 与 shell.openProposalInEditor 挑第一个可对照文件的口径一致），去重、保序，作为切换条的文件集合。
function fileTabsFromDetail(detail: ProposalDetailVM): EditorFileTab[] {
  const tabs: EditorFileTab[] = [];
  const seen = new Set<string>();
  for (const change of detail.manifest.changes) {
    const path = change.target_ref.path;
    if (!path || typeof change.machine_summary?.generated_content_md !== "string" || seen.has(path)) {
      continue;
    }
    seen.add(path);
    tabs.push({ path, filename: filenameFromPath(path), changeType: change.change_type });
  }
  return tabs;
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
  const proposalId = input.target.proposalId;
  // #13：当前激活的变动文件路径（首屏＝打开时那个），文件集合，以及每个文件 diff 的按需缓存
  // （逐访问 + 首屏后台预取——文件数由 manifest 天然有界，非无上限翻页）。
  let activePath = input.target.path;
  let fileTabs: EditorFileTab[] = [];
  let currentDiff: ProposalChangeDiffVM | undefined;
  const diffCache = new Map<string, ProposalChangeDiffVM>();

  function render(): void {
    if (disposed) {
      return;
    }
    container.className = "wh-wb-center wh-wb-center--editor";
    container.innerHTML = renderEditorHtml(state, input.locale);
  }

  function filesState(): EditorFilesState | undefined {
    return fileTabs.length > 1 ? { tabs: fileTabs, activePath } : undefined;
  }

  // 把某文件已加载的 diff 行数回填到它的切换条格子上（其它未加载的格子退回 change_type 短标签）。
  function applyStatToTab(path: string, diff: ProposalChangeDiffVM): void {
    const tab = fileTabs.find((candidate) => candidate.path === path);
    if (tab) {
      const stat = diffStat(diff);
      tab.adds = stat.adds;
      tab.dels = stat.dels;
    }
  }

  // 依当前 currentDiff/detail/文件集合构建 ready 帧（合并/批准动作是提议级，与当前看哪个文件无关）。
  function toReady(): void {
    if (!currentDiff || !detail) {
      return;
    }
    const files = filesState();
    state = {
      mode: "ready",
      diff: currentDiff,
      actions: actionsFromDetail(detail),
      ui: { expanded },
      ...(files ? { files } : {})
    };
  }

  function setReadyUi(patch: { busy?: "approve" | "merge"; notice?: string } = {}): void {
    if (state.mode !== "ready") {
      return;
    }
    const files = state.files;
    state = {
      mode: "ready",
      diff: state.diff,
      actions: state.actions,
      ui: {
        expanded,
        ...(patch.busy ? { busy: patch.busy } : {}),
        ...(patch.notice ? { notice: patch.notice } : {})
      },
      ...(files ? { files } : {})
    };
    render();
  }

  // 首屏后台预取其它文件的 diff——填满各 chip 的真实 diffstat + 让切换瞬时命中缓存。失败静默降级
  // （该 chip 退回 change_type 标签），不影响主流程。generation 绑当前一轮加载，切换/重拉后作废。
  function prefetchOtherDiffs(generation: number): void {
    for (const tab of fileTabs) {
      if (tab.path === activePath || diffCache.has(tab.path)) {
        continue;
      }
      void fetchProposalChangeDiff(input.client, proposalId, tab.path)
        .then((diff) => {
          if (disposed || generation !== loadGeneration) {
            return;
          }
          diffCache.set(tab.path, diff);
          applyStatToTab(tab.path, diff);
          if (state.mode === "ready") {
            toReady();
            render();
          }
        })
        .catch(() => undefined);
    }
  }

  function rebuildFileTabs(loadedDetail: ProposalDetailVM, activeDiff: ProposalChangeDiffVM): void {
    const rebuilt = fileTabsFromDetail(loadedDetail);
    fileTabs = rebuilt.length > 0 ? rebuilt : [];
    // 打开的文件理应在 manifest 里；万一不在（历史提议口径差异），补一格保证切换条与实际一致。
    if (!fileTabs.some((tab) => tab.path === activePath)) {
      fileTabs.unshift({ path: activePath, filename: input.target.filename, changeType: activeDiff.change_type });
    }
    // 已缓存过 diff 的文件回填真实 diffstat（重拉后不丢已知统计）。
    for (const tab of fileTabs) {
      const cached = diffCache.get(tab.path);
      if (cached) {
        applyStatToTab(tab.path, cached);
      }
    }
  }

  function load(): void {
    const generation = ++loadGeneration;
    busy = false;
    activePath = input.target.path;
    fileTabs = [];
    currentDiff = undefined;
    diffCache.clear();
    state = { mode: "loading", filename: input.target.filename };
    render();
    void Promise.all([
      fetchProposalChangeDiff(input.client, proposalId, activePath),
      fetchProposalDetail(input.client, proposalId, pageOptions(input.locale))
    ])
      .then(([diff, loadedDetail]) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        detail = loadedDetail;
        mergePayload = mergePayloadFromDetail(loadedDetail);
        diffCache.set(activePath, diff);
        currentDiff = diff;
        rebuildFileTabs(loadedDetail, diff);
        toReady();
        render();
        prefetchOtherDiffs(generation);
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
  // 保留当前激活文件（不重置回打开时那个），并刷新它的 diff。
  function reload(): void {
    const generation = ++loadGeneration;
    void Promise.all([
      fetchProposalChangeDiff(input.client, proposalId, activePath),
      fetchProposalDetail(input.client, proposalId, pageOptions(input.locale))
    ])
      .then(([diff, loadedDetail]) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        detail = loadedDetail;
        mergePayload = mergePayloadFromDetail(loadedDetail);
        diffCache.set(activePath, diff);
        currentDiff = diff;
        rebuildFileTabs(loadedDetail, diff);
        if (!fileTabs.some((tab) => tab.path === activePath) && fileTabs[0]) {
          activePath = fileTabs[0].path;
          const first = diffCache.get(activePath);
          if (first) {
            currentDiff = first;
          }
        }
        toReady();
        render();
        prefetchOtherDiffs(generation);
      })
      .catch(() => undefined);
  }

  // #13：切到另一个变动文件——命中缓存瞬时切；未命中则拉该文件 diff（loadGeneration 防竞态）。
  // 动作条不变（提议级）；只换中栏 diff 与高亮的 chip。
  function switchFile(path: string): void {
    if (disposed || path === activePath) {
      return;
    }
    const tab = fileTabs.find((candidate) => candidate.path === path);
    if (!tab) {
      return;
    }
    activePath = path;
    const cached = diffCache.get(path);
    if (cached) {
      currentDiff = cached;
      applyStatToTab(path, cached);
      toReady();
      render();
      return;
    }
    const generation = ++loadGeneration;
    state = { mode: "loading", filename: tab.filename };
    render();
    void fetchProposalChangeDiff(input.client, proposalId, path)
      .then((diff) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        diffCache.set(path, diff);
        currentDiff = diff;
        applyStatToTab(path, diff);
        toReady();
        render();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        state = {
          mode: "error",
          filename: tab.filename,
          message:
            error instanceof Error && error.message
              ? error.message
              : input.locale === "zh-CN"
                ? "这个文件没打开，稍后重试"
                : "Couldn't open this file — retry"
        };
        render();
      });
  }

  function stepFile(delta: number): void {
    if (fileTabs.length <= 1) {
      return;
    }
    const idx = fileTabs.findIndex((tab) => tab.path === activePath);
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= fileTabs.length) {
      return;
    }
    const next = fileTabs[nextIdx];
    if (next) {
      switchFile(next.path);
    }
  }

  function approve(): void {
    if (busy || state.mode !== "ready" || state.actions.status !== "opened") {
      return;
    }
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

  // #12：合并撞真实冲突时切到逐冲突解决面板（conflict 模式），其它 409 保持既有「状态变了刷新看看」文案。
  function showConflictOr(error: unknown, fallback: () => void): void {
    const zh = input.locale === "zh-CN";
    const conflictHtml = proposalMergeConflictHtml(error, zh);
    if (conflictHtml) {
      state = { mode: "conflict", filename: currentDiff?.filename ?? input.target.filename, conflictHtml };
      render();
      return;
    }
    fallback();
  }

  function merge(): void {
    if (busy || state.mode !== "ready" || !detail || state.actions.status !== "reviewed") {
      return;
    }
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
        if (disposed) {
          return;
        }
        showConflictOr(error, () => {
          if (state.mode === "ready") {
            setReadyUi({ notice: actionErrorText(error, input.locale) });
          }
        });
      });
  }

  // #12：冲突面板里的逐条动作（apply 候选 / 直接 merge / 看详情）——复用 Spotlight 那套 href 分类器 +
  // web-runtime 载荷解析 + client 方法，行为与 proposals.ts/attention.ts 的 runConflictAction 一致。
  // 成功 → onSettled + reload 回到（已合并的）diff；再撞冲突 → 重渲面板；其它错误 → 回 diff 并给提示。
  async function runConflictAction(targetEl: HTMLElement): Promise<void> {
    const zh = input.locale === "zh-CN";
    const href = actionHrefFromElement(targetEl);
    const action = classifyProposalConflictActionHref(href);
    if (action.kind === "detail") {
      // 编辑器本就在看这份提议——回到 diff 即可（不另开右栏详情）。
      reload();
      return;
    }
    if (busy) {
      return;
    }
    // F-05：多处冲突各自带融合稿时，选择器（renderConflictChooser）把它们折进一个单选 + 确认按钮，
    // 提交时先读勾选的 radio 拿 merge_proposal_id；没选中就点亮选择器自带的提示条，不静默失败
    // （编辑器的 conflict 态没有独立的行内提示槽，复用选择器自带的 hidden 提示条最省事）。
    const chooserSubmit = targetEl.dataset.proposalConflictChooserSubmit === "true" ? targetEl : undefined;
    const chooserContainer = chooserSubmit?.closest<HTMLElement>("[data-proposal-conflict-chooser]");
    const chooserSelection = chooserContainer ? selectedConflictChooserCandidate(chooserContainer) : undefined;
    if (chooserSubmit && !chooserSelection) {
      chooserContainer?.querySelector<HTMLElement>("[data-proposal-conflict-chooser-warning]")?.removeAttribute("hidden");
      return;
    }
    busy = true;
    try {
      let result: unknown;
      if (chooserSelection) {
        result = await chooseThenApplyMergeCandidate(input.client, chooserSelection.mergeProposalId, pageOptions(input.locale));
      } else if (action.kind === "apply") {
        const payload = actionElementApplyPayload(targetEl);
        if (!payload.ok) {
          return;
        }
        result = await input.client.applyMergeProposalCandidate(action.applyId, payload.payload, pageOptions(input.locale));
      } else if (action.kind === "merge") {
        const payload = actionElementMergePayload(targetEl);
        if (!payload.ok) {
          return;
        }
        result = await input.client.mergeProposal(action.proposalId, payload.payload, pageOptions(input.locale));
      }
      if (!result || disposed) {
        return;
      }
      input.onSettled(proposalId);
      reload();
    } catch (error) {
      if (disposed) {
        return;
      }
      showConflictOr(error, () => {
        reload();
      });
    } finally {
      busy = false;
    }
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
    // #12：冲突面板内的动作——返回把手回到 diff；逐条冲突动作链接走 runConflictAction。
    if (state.mode === "conflict") {
      if (el.closest("[data-prop-back]")) {
        reload();
        return;
      }
      const conflictAction = el.closest<HTMLElement>(
        "[data-prop-conflict-panel] a[href],[data-prop-conflict-panel] [data-action-href],[data-prop-conflict-panel] [data-href]"
      );
      if (conflictAction) {
        event.preventDefault();
        void runConflictAction(conflictAction);
      }
      return;
    }
    // #13：文件切换条——上一个/下一个 + 点 chip 直切。
    if (el.closest("[data-wb-ed-file-prev]")) {
      stepFile(-1);
      return;
    }
    if (el.closest("[data-wb-ed-file-next]")) {
      stepFile(1);
      return;
    }
    const fileTab = el.closest<HTMLElement>("[data-wb-ed-file]");
    if (fileTab?.dataset.wbEdFile) {
      switchFile(fileTab.dataset.wbEdFile);
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

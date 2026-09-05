// WorkHub 桌面 · 工作台右栏「情境面板」的提议详情控制器（06 批 APPROVE-CHAT · M1 只读 + M2 审批闭环）。
// 右栏第四个 owner（ownerId="proposal"），与 drive/army 两控制器共用同一块 store.sidePanelContent 插槽——
// 照 army/panel.ts、drive/side-panel.ts 的同一种设计：直接持有 sideBodyEl 真实 DOM 节点（不是只拿字符串），
// 这样才能在打回理由器里从 DOM 直接读 textarea/预设，以及审批成功后手动把焦点交回。
//
// 互斥语义（06 §1.2/§5.5）：谁最后把自己的 ownerId 写进 store.sidePanelContent 谁就是当前展示的内容。
// 用户点产出卡/军团输出行 → 本控制器强制发布、盖过军团面板；军团面板的被动后台刷新（收到
// conversation.action_card.updated）会检查当前 owner，正被 proposal 占着就只更内部缓存不动 DOM
// （army/panel.ts 的 publish background 守卫已把 proposal 纳入，见那里）。onBack 交回军团面板。
//
// 审批交互循环移植自 spotlight/views/proposals.ts 的 createProposalsView，但落点是右栏内联（store publish +
// 面板内联温和话术），不是 spotlight 的聚焦盒（ctx.body/ctx.toast/ctx.requestResize）。复用的是那边的纯逻辑
// 原语（proposalRequestChangesReason / reviewProposalWithoutMerge），不复用它的 wh-spot 渲染（detailHtml）。

import type { PageRequestOptions, WorkHubApiClient } from "@workhub/api-client";
import type { MergeProposalRequest } from "@workhub/contracts";

import { proposalRequestChangesReason, reviewProposalWithoutMerge } from "../../spotlight/views/proposals.js";
import type { WorkbenchStore } from "../store.js";
import {
  classifyProposalActionError,
  renderProposalSidePanelHtml,
  type ProposalDetailUiState,
  type ProposalSidePanelState
} from "./render.js";

import { proposalT } from "./locales.js";

type Locale = "zh-CN" | "en-US";

export type ProposalSidePanelApiClient = Pick<WorkHubApiClient, "pages" | "reviewProposal" | "mergeProposal">;

export type ProposalSidePanelHandle = {
  // 群聊产出卡「看提议」/ 军团输出行点击都汇流到这里——用户主动把焦点定到某份提议上，强制发布盖过军团面板。
  // R15 批 A6：focusReason=true（产出卡内联「打回」点击）——详情加载完后直接摊开理由输入器并聚焦（打回要
  // 写理由，不内联提交，见 workbench/chat/render.ts 的产出卡内联按钮）。缺省 false = 只打开详情（既有「看提议」）。
  showForProposal: (input: { proposalId: string; focusReason?: boolean }) => void;
  // 切走会话情境/项目时清空（只在自己仍是当前 owner 时才动 DOM）。
  clear: () => void;
  dispose: () => void;
};

const PROPOSAL_OWNER_ID = "proposal";

function pageOptions(locale: Locale): PageRequestOptions {
  return { locale };
}

export function mountProposalSidePanel(
  sideBodyEl: HTMLElement,
  store: WorkbenchStore,
  input: {
    client: ProposalSidePanelApiClient;
    locale: Locale;
    // onBack：返回军团面板（shell 让 armyPanel 重新发布当前会话缓存态、重新认领右栏）。
    onBack: () => void;
    // onSettled：某份提议在本机被通过/打回/合并后回调——shell 据此把 id 转发给当前 chat view（产出卡覆盖标）
    // + 令军团面板后台重拉（输出行 status 自然翻新）。跨客户端回流是服务端档③的活，不在本控制器。
    onSettled: (proposalId: string) => void;
  }
): ProposalSidePanelHandle {
  let disposed = false;
  let currentProposalId: string | undefined;
  let state: ProposalSidePanelState | undefined;
  // 单调代次防竞态（照 army/drive）——list↔detail↔审批往返间，晚到的 await 不覆盖更新的一帧。
  let loadGeneration = 0;
  // 审批往返忙态锁：一次只允许一个 approve/deny/merge 在飞（避免连点重复提交）。
  let busy = false;
  // R15 批 A6：产出卡内联「打回」→ showForProposal({ focusReason:true }) 时置真——详情加载完（异步）后
  // 由 loadDetail 的成功回调消费一次，摊开理由输入器并聚焦。用后即清，不影响后续普通「看提议」。
  let pendingOpenReason = false;

  function publish(): void {
    if (disposed || !state) {
      return;
    }
    store.setState({ sidePanelContent: { ownerId: PROPOSAL_OWNER_ID, html: renderProposalSidePanelHtml(state, input.locale) } });
  }

  // 整体替换 UI 叠加层（不是合并 patch）——每次交互转换（发起动作/失败/开理由器）本就要把上一层的
  // busy/notice/reasonOpen 全部重置；整体替换也顺便绕开 exactOptionalPropertyTypes 对「显式 undefined 键」
  // 的拒绝（见 army/panel.ts loadMore 的同款注释）。
  function setDetailUi(ui: ProposalDetailUiState): void {
    if (state?.mode !== "detail") {
      return;
    }
    state = { mode: "detail", vm: state.vm, ui };
    publish();
  }

  function loadDetail(proposalId: string): void {
    const generation = ++loadGeneration;
    currentProposalId = proposalId;
    state = { mode: "loading" };
    publish();
    void input.client.pages
      .proposal(proposalId, pageOptions(input.locale))
      .then((vm) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        state = { mode: "detail", vm, ui: {} };
        publish();
        // R15 批 A6：产出卡内联「打回」带来的一次性「加载完就摊开理由器」——openReason 自己会守
        // status==='opened'（已落定的提议摊不开理由，只是打开只读详情），这里不重复判定。
        if (pendingOpenReason) {
          pendingOpenReason = false;
          openReason();
        }
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        state = {
          mode: "error",
          proposalId,
          message: error instanceof Error && error.message ? error.message : proposalT(input.locale, "couldnTLoadTheProposal")
        };
        publish();
      });
  }

  // 审批往返后重拉详情：status 会翻新（approve→reviewed 出「合入」/ request_changes→rejected 终态只读 /
  // merge→merged 终态只读），面板据新 vm 自然渲成对应态。用同一条 loadGeneration 防竞态。
  function reloadDetail(proposalId: string): void {
    const generation = ++loadGeneration;
    void input.client.pages
      .proposal(proposalId, pageOptions(input.locale))
      .then((vm) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        state = { mode: "detail", vm, ui: {} };
        publish();
      })
      .catch(() => {
        // 重拉失败不回退成错误页（动作本身已成功、onSettled 已触发）——保留当前详情，下次交互再刷新。
        if (disposed || generation !== loadGeneration) {
          return;
        }
      });
  }

  function showForProposal(next: { proposalId: string; focusReason?: boolean }): void {
    busy = false;
    pendingOpenReason = next.focusReason === true;
    loadDetail(next.proposalId);
  }

  function approve(): void {
    if (busy || state?.mode !== "detail" || !currentProposalId) {
      return;
    }
    const proposalId = currentProposalId;
    busy = true;
    setDetailUi({ busy: "approve" });
    void reviewProposalWithoutMerge(input.client, proposalId, pageOptions(input.locale))
      .then(() => {
        busy = false;
        if (disposed || currentProposalId !== proposalId) {
          return;
        }
        input.onSettled(proposalId);
        reloadDetail(proposalId);
      })
      .catch((error: unknown) => {
        busy = false;
        if (disposed || currentProposalId !== proposalId || state?.mode !== "detail") {
          return;
        }
        setDetailUi({ notice: classifyProposalActionError(error, "approve", input.locale) });
      });
  }

  function merge(): void {
    if (busy || state?.mode !== "detail" || !currentProposalId) {
      return;
    }
    const proposalId = currentProposalId;
    const payload = (state.vm.review_actions.merge?.request_json ?? undefined) as MergeProposalRequest | undefined;
    busy = true;
    setDetailUi({ busy: "merge" });
    void input.client
      .mergeProposal(proposalId, payload, pageOptions(input.locale))
      .then(() => {
        busy = false;
        if (disposed || currentProposalId !== proposalId) {
          return;
        }
        input.onSettled(proposalId);
        reloadDetail(proposalId);
      })
      .catch((error: unknown) => {
        busy = false;
        if (disposed || currentProposalId !== proposalId || state?.mode !== "detail") {
          return;
        }
        setDetailUi({ notice: classifyProposalActionError(error, "merge", input.locale) });
      });
  }

  function submitDeny(reasonMd: string): void {
    if (busy || state?.mode !== "detail" || !currentProposalId) {
      return;
    }
    const proposalId = currentProposalId;
    busy = true;
    setDetailUi({ busy: "deny" });
    void input.client
      .reviewProposal(proposalId, { decision: "request_changes", reason_md: reasonMd, remember: "once" }, pageOptions(input.locale))
      .then(() => {
        busy = false;
        if (disposed || currentProposalId !== proposalId) {
          return;
        }
        input.onSettled(proposalId);
        reloadDetail(proposalId);
      })
      .catch((error: unknown) => {
        busy = false;
        if (disposed || currentProposalId !== proposalId || state?.mode !== "detail") {
          return;
        }
        // 打回失败：重新摊开理由器 + 温和话术，用户改一改再发（理由文本已随重渲丢，属可接受——失败态本就要
        // 用户重新确认这段反馈；成功路径才是主路径）。
        setDetailUi({ reasonOpen: true, notice: classifyProposalActionError(error, "deny", input.locale) });
      });
  }

  function openReason(): void {
    if (state?.mode !== "detail" || state.vm.status !== "opened") {
      return;
    }
    setDetailUi({ reasonOpen: true });
    sideBodyEl.querySelector<HTMLTextAreaElement>("[data-wb-prop-reason-text]")?.focus();
  }

  // 预设理由 chip 点选：直接改 DOM（aria-pressed/data-sel + 空 textarea 时回填），不整体重渲——重渲会把
  // 用户已经打的字冲掉（照 spotlight createProposalsView 的既有取法）。
  function selectReasonPreset(pressed: HTMLElement): void {
    const composer = pressed.closest<HTMLElement>("[data-wb-prop-reasons]");
    for (const candidate of composer?.querySelectorAll<HTMLElement>("[data-wb-prop-reason]") ?? []) {
      const isSel = candidate === pressed;
      candidate.dataset.sel = isSel ? "true" : "false";
      candidate.setAttribute("aria-pressed", isSel ? "true" : "false");
    }
    const preset = pressed.dataset.wbPropReason;
    const textarea = composer?.querySelector<HTMLTextAreaElement>("[data-wb-prop-reason-text]");
    if (preset && textarea && !textarea.value.trim()) {
      textarea.value = preset;
      textarea.focus();
    }
  }

  function handleSubmitDenyClick(submitBtn: HTMLElement): void {
    const composer = submitBtn.closest<HTMLElement>("[data-wb-prop-reasons]");
    const preset = composer?.querySelector<HTMLElement>('[data-wb-prop-reason][data-sel="true"]')?.dataset.wbPropReason;
    const detail = composer?.querySelector<HTMLTextAreaElement>("[data-wb-prop-reason-text]")?.value;
    const reasonMd = proposalRequestChangesReason(preset, detail);
    if (!reasonMd) {
      // 空理由拦截：把提示塞进理由器里的错误容器（直接改 textContent，不整体重渲）+ 聚焦，绝不发请求。
      const errorEl = composer?.querySelector<HTMLElement>("[data-wb-prop-reason-error]");
      if (errorEl) {
        errorEl.textContent = proposalT(input.locale, "addAShortReasonFirst");
      }
      composer?.querySelector<HTMLTextAreaElement>("[data-wb-prop-reason-text]")?.focus();
      return;
    }
    submitDeny(reasonMd);
  }

  function retry(action: string): void {
    if (action === "approve") {
      approve();
    } else if (action === "merge") {
      merge();
    } else if (action === "deny") {
      // network 失败重试打回：重开理由器让用户确认这段反馈（理由文本已随失败重渲丢，重开是诚实的）。
      setDetailUi({ reasonOpen: true });
      sideBodyEl.querySelector<HTMLTextAreaElement>("[data-wb-prop-reason-text]")?.focus();
    }
  }

  sideBodyEl.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const el = event.target;
    if (el.closest("[data-wb-prop-back]")) {
      input.onBack();
      return;
    }
    const reloadBtn = el.closest<HTMLElement>("[data-wb-prop-reload]");
    if (reloadBtn) {
      if (currentProposalId) {
        loadDetail(currentProposalId);
      }
      return;
    }
    const retryBtn = el.closest<HTMLElement>("[data-wb-prop-retry]");
    if (retryBtn?.dataset.wbPropRetry) {
      retry(retryBtn.dataset.wbPropRetry);
      return;
    }
    if (el.closest("[data-wb-prop-approve]")) {
      approve();
      return;
    }
    if (el.closest("[data-wb-prop-merge]")) {
      merge();
      return;
    }
    if (el.closest("[data-wb-prop-deny]")) {
      openReason();
      return;
    }
    const submitDenyBtn = el.closest<HTMLElement>("[data-wb-prop-submit-deny]");
    if (submitDenyBtn) {
      handleSubmitDenyClick(submitDenyBtn);
      return;
    }
    const presetBtn = el.closest<HTMLElement>("[data-wb-prop-reason]");
    if (presetBtn) {
      selectReasonPreset(presetBtn);
    }
  });

  function clear(): void {
    currentProposalId = undefined;
    state = undefined;
    busy = false;
    ++loadGeneration;
    if (store.getState().sidePanelContent?.ownerId === PROPOSAL_OWNER_ID) {
      store.setState({ sidePanelContent: undefined });
    }
  }

  return {
    showForProposal,
    clear,
    dispose: () => {
      disposed = true;
      if (store.getState().sidePanelContent?.ownerId === PROPOSAL_OWNER_ID) {
        store.setState({ sidePanelContent: undefined });
      }
    }
  };
}

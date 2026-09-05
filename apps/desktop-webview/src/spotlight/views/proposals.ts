// WorkHub 桌面 · Spotlight「看改动 / diff」能力内联视图（S4，核心闭环的「审阅 + 合并」）。
// 列表源 = pages.attention 队列里的 proposal_review 项（无全局 proposal 列表端点）→ 点开 pages.proposal(id)
// 渲统一玻璃 diff（改动清单 + 校验 + 风险）→ 确认通过 → 合入交付物 / 打回。
// list→detail 全在盒子内联 morph。

import type { PageRequestOptions } from "@workhub/api-client";
import type { AttentionItem, DeliverableChange, ProposalDetailVM } from "@workhub/contracts";
import { publicProposalDisplayTitle, publicProposalSummaryText, renderProposalConflictCards } from "@workhub/ui/proposal";
import {
  actionElementApplyPayload,
  actionElementMergePayload,
  actionHrefFromElement,
  chooseThenApplyMergeCandidate,
  conflictsFromMergeError,
  escapeHtml,
  mergeProposalCandidateApplyIdFromHref,
  proposalActionFromHref,
  selectedConflictChooserCandidate
} from "@workhub/web-runtime";

import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";

import { spotlightViewsT } from "./locales.js";

function proposalIdFromItem(item: AttentionItem): string | undefined {
  for (const action of item.actions) {
    const parsed = proposalActionFromHref(action.href);
    if (parsed?.proposalId) {
      return parsed.proposalId;
    }
  }
  return undefined;
}

export function proposalListDisplayTitle(title: string, zh: boolean) {
  return publicProposalDisplayTitle(title, zh ? "zh-CN" : "en-US");
}

function changeTypeLabel(t: DeliverableChange["change_type"], zh: boolean): string {
  const map: Record<string, [string, string]> = {
    created: ["新增", "Added"],
    updated: ["修改", "Updated"],
    deleted: ["删除", "Deleted"],
    renamed: ["重命名", "Renamed"],
    moved: ["移动", "Moved"],
    replaced: ["替换", "Replaced"],
    generated: ["生成", "Generated"]
  };
  const e = map[t];
  return e ? (zh ? e[0] : e[1]) : t;
}

function changeHtml(c: DeliverableChange, zh: boolean): string {
  const path = c.target_ref.path ?? c.target_ref.entity_type;
  const before = c.machine_summary?.before_excerpt;
  const after = c.machine_summary?.after_excerpt;
  const diff =
    before || after
      ? `<div class="wh-spot-diff">${before ? `<div class="wh-spot-diff-line wh-spot-diff-line--del">${escapeHtml(before)}</div>` : ""}${after ? `<div class="wh-spot-diff-line wh-spot-diff-line--add">${escapeHtml(after)}</div>` : ""}</div>`
      : "";
  return `<div class="wh-spot-change">
    <div class="wh-spot-change-head"><span class="wh-spot-chip wh-spot-chip--info">${escapeHtml(changeTypeLabel(c.change_type, zh))}</span><span class="wh-spot-change-path">${escapeHtml(path)}</span></div>
    <div class="wh-spot-change-sum">${escapeHtml(c.human_summary)}</div>
    ${diff}
  </div>`;
}

function stripMarkdownLine(value: string) {
  return value
    .replace(/^#{1,6}\s*/u, "")
    .replace(/^>\s*/u, "")
    .replace(/^[-*]\s+/u, "")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/[_*]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function publicProposalSummary(markdown: string, zh: boolean) {
  const locale = zh ? "zh-CN" : "en-US";
  const headingPattern = zh
    ? /^(?:变更摘要|审查提示|审查建议|总结)$/u
    : /^(?:change summary|review notes?|review hints?|summary)$/iu;
  const lines = markdown
    .split(/\r?\n/u)
    .map(stripMarkdownLine)
    .filter((line) => line && !headingPattern.test(line));
  return publicProposalSummaryText(lines.join(" ").replace(/\s+/gu, " ").trim(), locale, 320) ||
    (spotlightViewsT(zh, "reviewTheSummaryAndChangesBefore"));
}

function checkText(check: ProposalDetailVM["manifest"]["checks"][number], zh: boolean) {
  const detail = check.status === "passed" ? "" : check.detail?.trim();
  const base = detail ? `${check.label}：${detail}` : check.label;
  // API-02：HTTP 自供 manifest 的 checks 被服务端标为 self_reported——评审时明示「提交者自报」。
  return check.source === "self_reported" ? `${base}（${spotlightViewsT(zh, "selfReported")}）` : base;
}

export function detailHtml(vm: ProposalDetailVM, zh: boolean): string {
  const m = vm.manifest;
  const locale = zh ? "zh-CN" : "en-US";
  const displayTitle = publicProposalDisplayTitle(vm.title, locale);
  const summary = publicProposalSummary(m.summary_md, zh);
  const riskTone = m.risk.level === "high" ? "handoff" : m.risk.level === "medium" ? "permission" : "info";
  const checks = m.checks.length
    ? `<div class="wh-spot-checks">${m.checks
        .map((ck) => `<span class="wh-spot-check wh-spot-check--${ck.status}">${escapeHtml(checkText(ck, zh))}</span>`)
        .join("")}</div>`
    : "";
  const isOpen = vm.status === "opened";
  // 已审阅(approved 但未合并)：下一步只做合入，避免把“确认通过”和“打回”混在同一状态里。
  const canMerge = vm.status === "reviewed" && !!vm.review_actions.merge;
  const mergePayload = vm.review_actions.merge?.request_json
    ? ` data-request-json="${escapeHtml(JSON.stringify(vm.review_actions.merge.request_json))}"`
    : "";
  const holdAction = vm.review_actions.approve_hold;
  const holdButton = holdAction
    ? `<button type="button" class="wh-spot-act ds-pressable" data-prop-merge${holdAction.request_json ? ` data-request-json="${escapeHtml(JSON.stringify(holdAction.request_json))}"` : ""}>${escapeHtml(holdAction.label)}</button>`
    : "";
  const statusLabel: Record<string, [string, string]> = {
    opened: ["待审阅", "Open"],
    reviewed: ["已审阅", "Reviewed"],
    merged: ["已合并", "Merged"],
    rejected: ["已打回", "Rejected"]
  };
  const actions = isOpen
    ? `<div class="wh-spot-card-actions" data-prop-actions>
        <p class="wh-spot-action-note">${spotlightViewsT(zh, "approveFirstThenMergeThisDeliverable")}</p>
        <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-prop-approve>${spotlightViewsT(zh, "markApproved")}</button>
        <button type="button" class="wh-spot-act wh-spot-act--danger ds-pressable" data-prop-deny>${spotlightViewsT(zh, "requestChanges")}</button>
      </div>`
    : canMerge
      ? `<div class="wh-spot-card-actions" data-prop-actions>
        <p class="wh-spot-action-note">${holdAction ? (spotlightViewsT(zh, "approvedStartNowOrHoldIt")) : (spotlightViewsT(zh, "approvedOnlyTheDeliverableMergeRemains"))}</p>
        <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-prop-merge${mergePayload}>${escapeHtml(vm.review_actions.merge?.label ?? (spotlightViewsT(zh, "mergeDeliverable")))}</button>
        ${holdButton}
      </div>`
      : `<div class="wh-spot-card-actions"><span class="wh-spot-chip wh-spot-chip--info">${escapeHtml((zh ? statusLabel[vm.status]?.[0] : statusLabel[vm.status]?.[1]) ?? vm.status)}</span></div>`;
  return `<div class="wh-spot-dash ds-anim-fade-in">
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-prop-back style="align-self:flex-start">${spotlightViewsT(zh, "backToChanges")}</button>
    <div>
      <div class="wh-spot-card-head"><span class="wh-spot-chip wh-spot-chip--${riskTone}">${escapeHtml(m.risk.human_label)}</span><span class="wh-spot-change-path">${m.changes.length} ${spotlightViewsT(zh, "changes")}</span></div>
      <h3 class="wh-spot-card-title" style="margin-top:10px">${escapeHtml(displayTitle)}</h3>
      <div class="wh-spot-change" data-prop-summary="true">
        <div class="wh-spot-change-head"><span class="wh-spot-chip wh-spot-chip--info">${spotlightViewsT(zh, "summary")}</span></div>
        <div class="wh-spot-change-sum">${escapeHtml(summary)}</div>
      </div>
    </div>
    ${checks}
    <div class="wh-spot-changes">${m.changes.map((c) => changeHtml(c, zh)).join("")}</div>
    ${actions}
  </div>`;
}

export function proposalMergeConflictHtml(error: unknown, zh: boolean): string | undefined {
  const conflicts = conflictsFromMergeError(error);
  if (!conflicts.length) {
    return undefined;
  }
  const rendered = renderProposalConflictCards(conflicts, { locale: zh ? "zh-CN" : "en-US" });
  return `<div class="wh-spot-dash ds-anim-fade-in" data-prop-conflict-panel="true">
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-prop-back style="align-self:flex-start">${spotlightViewsT(zh, "backToChanges")}</button>
    <div>
      <h3 class="wh-spot-card-title">${spotlightViewsT(zh, "thisChangeHasConflicts")}</h3>
      <p class="wh-spot-action-note">${spotlightViewsT(zh, "chooseHowToResolveEachConflict")}</p>
    </div>
    ${rendered.html}
  </div>`;
}

export function reasonComposerHtml(zh: boolean): string {
  // 同 attention 视图：「先放一放」提交的是打回，语义误导——移除。
  const reasons = zh ? ["方向不对", "细节要调整", "缺少依据"] : ["Wrong direction", "Needs tweaks", "Insufficient evidence"];
  return `<div class="wh-spot-reasons" data-prop-reasons>
    <p class="wh-spot-reasons-q">${spotlightViewsT(zh, "feedbackForChanges")}</p>
    <div class="wh-spot-reasons-row">${reasons
      .map((r) => `<button type="button" class="wh-spot-reason ds-pressable" data-prop-reason="${escapeHtml(r)}" aria-pressed="false">${escapeHtml(r)}</button>`)
      .join("")}</div>
    <textarea class="wh-spot-reason-text" data-prop-reason-text rows="3" placeholder="${spotlightViewsT(zh, "describeWhatNeedsToChangeCuu")}"></textarea>
    <div class="wh-spot-reason-actions">
      <button type="button" class="wh-spot-act wh-spot-act--danger ds-pressable" data-prop-submit-deny>${spotlightViewsT(zh, "sendFeedback")}</button>
    </div>
  </div>`;
}

export function proposalRequestChangesReason(preset?: string, detail?: string): string | undefined {
  const cleanPreset = preset?.trim();
  const cleanDetail = detail?.trim();
  if (cleanPreset && cleanDetail && cleanDetail !== cleanPreset) {
    return `${cleanPreset}\n\n${cleanDetail}`;
  }
  return cleanDetail || cleanPreset || undefined;
}

function summaryText(result: unknown): string | undefined {
  if (result && typeof result === "object" && "attention" in result) {
    const att = (result as { attention?: { summary_text?: string } }).attention;
    if (att && typeof att.summary_text === "string") return att.summary_text;
  }
  return undefined;
}

function detailProposalIdFromHref(href: string) {
  const path = new URL(href, globalThis.location?.origin ?? "http://workhub.local").pathname;
  const match = /^\/proposals\/([^/]+)$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function classifyProposalConflictActionHref(href: string):
  | { kind: "detail"; proposalId: string }
  | { kind: "apply"; applyId: string }
  | { kind: "merge"; proposalId: string }
  | { kind: "unsupported" } {
  const detailProposalId = detailProposalIdFromHref(href);
  if (detailProposalId) {
    return { kind: "detail", proposalId: detailProposalId };
  }
  const applyId = mergeProposalCandidateApplyIdFromHref(href);
  if (applyId) {
    return { kind: "apply", applyId };
  }
  const mergeAction = proposalActionFromHref(href);
  if (mergeAction?.action === "merge") {
    return { kind: "merge", proposalId: mergeAction.proposalId };
  }
  return { kind: "unsupported" };
}

export type ProposalReviewOnlyClient = {
  reviewProposal: (
    proposalId: string,
    payload: { decision: "approve"; remember: "once" },
    options?: PageRequestOptions
  ) => Promise<unknown>;
};

export function reviewProposalWithoutMerge(client: ProposalReviewOnlyClient, proposalId: string, options?: PageRequestOptions) {
  return client.reviewProposal(proposalId, { decision: "approve", remember: "once" }, options);
}

export function proposalDetailRefreshTargetAfterReview(startedProposalId: string, currentProposalId: string | undefined) {
  return startedProposalId === currentProposalId ? startedProposalId : undefined;
}

export function createProposalsView(): SpotlightCapabilityView {
  return {
    id: "proposals",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      const { client, body } = ctx;
      let disposed = false;
      let busy = false;
      let currentId: string | undefined;
      // rank7：上次失败的加载器，点「重试」即重跑。
      let retry: (() => void) | undefined;
      // M4：单调代次——list↔detail 间快速切换时，晚到的 await 不得覆盖更新的一帧。
      let loadGen = 0;

      const showList = async () => {
        const gen = ++loadGen;
        currentId = undefined;
        ctx.setSubtitle(spotlightViewsT(ctx.locale, "changesToReview"));
        body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loading2")}</div>`;
        ctx.requestResize();
        try {
          const vm = await client.pages.attention({ locale: ctx.locale });
          if (disposed || gen !== loadGen) return;
          // 只保留能解析出 proposalId 的项——否则渲染出可点却点不开的死行(rank19)。
          const items = (vm.queue ?? []).filter((it) => !!proposalIdFromItem(it));
          if (!items.length) {
            body.innerHTML = `<div class="wh-spot-empty"><div class="wh-spot-empty-face">٩(◜◡◝)۶</div><h3 class="wh-spot-empty-title">${spotlightViewsT(ctx.locale, "noChangesToReview")}</h3><p class="wh-spot-empty-sub">${spotlightViewsT(ctx.locale, "aiChangesShowHereAndIn")}</p></div>`;
          } else {
            ctx.setSubtitle(zh ? `${items.length} 处待审阅` : `${items.length} to review`);
            body.innerHTML = `<div class="wh-spot-list ds-stagger">${items
              .map((it) => {
                const pid = proposalIdFromItem(it);
                const title = proposalListDisplayTitle(it.title, zh);
                return `<button type="button" class="wh-spot-row" data-prop-open="${escapeHtml(pid ?? "")}" style="cursor:pointer;width:100%;text-align:left">
                  <span class="wh-spot-card-bar wh-spot-card-bar--approval" style="border-radius:3px"></span>
                  <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(title)}</div><div class="wh-spot-row-sub">${escapeHtml(it.summary_text ?? "")}</div></div>
                </button>`;
              })
              .join("")}</div>`;
          }
        } catch {
          if (!disposed && gen === loadGen) {
            retry = () => void showList();
            body.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoad"));
          }
        }
        ctx.requestResize();
        // R11（键盘全程）：innerHTML 重渲后焦点掉回 body——交还内容区，Tab 起点可预期。
        ctx.refocusBody();
      };

      const showDetail = async (id: string) => {
        const gen = ++loadGen;
        currentId = id;
        body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loadingDiff")}</div>`;
        ctx.requestResize();
        try {
          const vm = await client.pages.proposal(id, { locale: ctx.locale });
          if (disposed || gen !== loadGen) return;
          ctx.setSubtitle(spotlightViewsT(ctx.locale, "changeDetail"));
          body.innerHTML = detailHtml(vm, zh);
        } catch {
          if (!disposed && gen === loadGen) {
            retry = () => void showDetail(id);
            body.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoadDiff"));
          }
        }
        ctx.requestResize();
        // R11（键盘全程）：innerHTML 重渲后焦点掉回 body——交还内容区，Tab 起点可预期。
        ctx.refocusBody();
      };

      // M13：approve/merge/deny 都是网络往返。期间给被点按钮即时忙态(禁用 + 文案换「…中」),
      // 否则用户点完按钮看起来毫无反应、以为没点上(workitem 视图已有此模式)。成功会重渲列表/详情
      // 把按钮换掉,故只在出错路径复原按钮。
      const markBusy = (btn: HTMLButtonElement | null, label: string) => {
        if (!btn) return () => {};
        const prevText = btn.textContent;
        const prevDisabled = btn.disabled;
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        btn.textContent = label;
        return () => {
          btn.disabled = prevDisabled;
          btn.removeAttribute("aria-busy");
          btn.textContent = prevText;
        };
      };

      const approve = async (btn: HTMLButtonElement | null = null) => {
        if (busy || !currentId) return;
        const startedProposalId = currentId;
        busy = true;
        const restore = markBusy(btn, spotlightViewsT(ctx.locale, "approving"));
        try {
          const review = await reviewProposalWithoutMerge(client, startedProposalId, { locale: ctx.locale });
          ctx.toast(summaryText(review) ?? (spotlightViewsT(ctx.locale, "approvedYouCanMergeTheDeliverable")), "ok");
          ctx.onActionSettled?.();
          busy = false;
          const refreshId = proposalDetailRefreshTargetAfterReview(startedProposalId, currentId);
          if (refreshId) {
            void showDetail(refreshId);
          }
        } catch {
          busy = false;
          restore();
          ctx.toast(spotlightViewsT(ctx.locale, "approvalFailedTryAgain"), "error");
        }
      };

      // 已审阅项的直接合并（不再走 review，只 merge）。
      const mergeOnly = async (btn: HTMLButtonElement | null = null) => {
        if (busy || !currentId) return;
        busy = true;
        const restore = markBusy(btn, spotlightViewsT(ctx.locale, "working"));
        try {
          const payload = btn ? actionElementMergePayload(btn) : { ok: true as const };
          if (!payload.ok) {
            ctx.toast(spotlightViewsT(ctx.locale, "thisMergeActionIsMissingDetails"), "error");
            busy = false;
            restore();
            return;
          }
          const merge = await client.mergeProposal(currentId, payload.payload, { locale: ctx.locale });
          ctx.toast(summaryText(merge) ?? (spotlightViewsT(ctx.locale, "merged")), "ok");
          ctx.onActionSettled?.();
          busy = false;
          void showList();
        } catch (error) {
          busy = false;
          restore();
          const conflictHtml = proposalMergeConflictHtml(error, zh);
          if (conflictHtml) {
            body.innerHTML = conflictHtml;
            ctx.toast(spotlightViewsT(ctx.locale, "resolveConflictsFirst"), "info");
            ctx.requestResize();
            return;
          }
          ctx.toast(spotlightViewsT(ctx.locale, "mergeFailedMaybeAConflict"), "error");
        }
      };

      const runConflictAction = async (target: HTMLElement) => {
        const href = actionHrefFromElement(target);
        const action = classifyProposalConflictActionHref(href);
        if (action.kind === "detail") {
          void showDetail(action.proposalId);
          return;
        }
        if (busy) return;
        // F-05：多处冲突各自带融合稿时，选择器（renderConflictChooser）把它们折进一个单选 + 确认按钮，
        // 提交时先读勾选的 radio 拿 merge_proposal_id，没选中就点亮选择器自带的提示条，不静默失败。
        const chooserSubmit = target.dataset.proposalConflictChooserSubmit === "true" ? target : undefined;
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
            result = await chooseThenApplyMergeCandidate(client, chooserSelection.mergeProposalId, { locale: ctx.locale });
          } else if (action.kind === "apply") {
            const payload = actionElementApplyPayload(target);
            if (!payload.ok) {
              ctx.toast(spotlightViewsT(ctx.locale, "thisConflictOptionIsMissingDetails"), "error");
              return;
            }
            result = await client.applyMergeProposalCandidate(action.applyId, payload.payload, { locale: ctx.locale });
          } else if (action.kind === "merge") {
            const payload = actionElementMergePayload(target);
            if (!payload.ok) {
              ctx.toast(spotlightViewsT(ctx.locale, "thisConflictOptionIsMissingDetails"), "error");
              return;
            }
            result = await client.mergeProposal(action.proposalId, payload.payload, { locale: ctx.locale });
          }
          if (!result) {
            ctx.toast(spotlightViewsT(ctx.locale, "thisConflictActionIsNotAvailable"), "error");
            return;
          }
          ctx.toast(summaryText(result) ?? (spotlightViewsT(ctx.locale, "conflictResolved")), "ok");
          ctx.onActionSettled?.();
          void showList();
        } catch (error) {
          const conflictHtml = proposalMergeConflictHtml(error, zh);
          if (conflictHtml) {
            body.innerHTML = conflictHtml;
            ctx.toast(spotlightViewsT(ctx.locale, "moreConflictHandlingIsNeeded"), "info");
            ctx.requestResize();
          } else {
            ctx.toast(spotlightViewsT(ctx.locale, "conflictActionFailedTryAgain"), "error");
          }
        } finally {
          busy = false;
        }
      };

      const deny = async (reason: string, btn: HTMLButtonElement | null = null) => {
        if (busy || !currentId) return;
        busy = true;
        const restore = markBusy(btn, spotlightViewsT(ctx.locale, "sendingBack"));
        try {
          const res = await client.reviewProposal(currentId, { decision: "request_changes", reason_md: reason, remember: "once" }, { locale: ctx.locale });
          ctx.toast(summaryText(res) ?? (spotlightViewsT(ctx.locale, "sentBack")), "ok");
          ctx.onActionSettled?.();
          busy = false;
          void showList();
        } catch {
          busy = false;
          restore();
          ctx.toast(spotlightViewsT(ctx.locale, "failedRetry"), "error");
        }
      };

      body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("[data-spot-retry]")) {
          retry?.();
          return;
        }
        if (target.closest("[data-prop-back]")) {
          void showList();
          return;
        }
        const open = target.closest<HTMLElement>("[data-prop-open]");
        if (open) {
          const id = open.dataset.propOpen;
          if (id) void showDetail(id);
          return;
        }
        const conflictAction = target.closest<HTMLElement>("[data-prop-conflict-panel] a[href],[data-prop-conflict-panel] [data-action-href],[data-prop-conflict-panel] [data-href]");
        if (conflictAction) {
          event.preventDefault();
          void runConflictAction(conflictAction);
          return;
        }
        const approveBtn = target.closest<HTMLButtonElement>("[data-prop-approve]");
        if (approveBtn) {
          void approve(approveBtn);
          return;
        }
        const mergeBtn = target.closest<HTMLButtonElement>("[data-prop-merge]");
        if (mergeBtn) {
          void mergeOnly(mergeBtn);
          return;
        }
        if (target.closest("[data-prop-deny]")) {
          const row = target.closest<HTMLElement>("[data-prop-actions]");
          if (row && !body.querySelector("[data-prop-reasons]")) {
            row.insertAdjacentHTML("afterend", reasonComposerHtml(zh));
            ctx.requestResize();
            body.querySelector<HTMLTextAreaElement>("[data-prop-reason-text]")?.focus();
          }
          return;
        }
        const reason = target.closest<HTMLButtonElement>("[data-prop-reason]");
        if (reason?.dataset.propReason) {
          const composer = reason.closest<HTMLElement>("[data-prop-reasons]");
          for (const candidate of composer?.querySelectorAll<HTMLButtonElement>("[data-prop-reason]") ?? []) {
            candidate.dataset.sel = candidate === reason ? "true" : "false";
            candidate.setAttribute("aria-pressed", candidate === reason ? "true" : "false");
          }
          const input = composer?.querySelector<HTMLTextAreaElement>("[data-prop-reason-text]");
          if (input && !input.value.trim()) {
            input.value = reason.dataset.propReason;
            input.focus();
          }
          return;
        }
        const submitDeny = target.closest<HTMLButtonElement>("[data-prop-submit-deny]");
        if (submitDeny) {
          const composer = submitDeny.closest<HTMLElement>("[data-prop-reasons]");
          const preset = composer?.querySelector<HTMLButtonElement>("[data-prop-reason][data-sel=\"true\"]")?.dataset.propReason;
          const detail = composer?.querySelector<HTMLTextAreaElement>("[data-prop-reason-text]")?.value;
          const reasonMd = proposalRequestChangesReason(preset, detail);
          if (!reasonMd) {
            ctx.toast(spotlightViewsT(ctx.locale, "addAShortReasonFirst"), "error");
            composer?.querySelector<HTMLTextAreaElement>("[data-prop-reason-text]")?.focus();
            return;
          }
          void deny(reasonMd, submitDeny);
        }
      });

      // rank13：深链/托盘带了提议 id → 直接开 diff 详情；否则从列表起。
      if (ctx.target?.id) {
        void showDetail(ctx.target.id);
      } else {
        void showList();
      }
      return () => {
        disposed = true;
      };
    }
  };
}

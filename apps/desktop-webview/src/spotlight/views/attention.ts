// WorkHub 桌面 · Spotlight「审批/待拍板」能力内联视图（S1 证明片）。
// 苹果聚焦盒里直接拉 client.pages.attention 的 queue，渲成统一玻璃决策卡，approve/deny/看改动·合入
// 全部内联打真 API（复用 web-runtime 的 href 分类器 + client 方法），处置后回拉 queue、盒子随内容缩放。
// 这一片证明是「真·内联重构」而非换入口：没有 hash、没有全屏壳、动作就地落库。

import type { AttentionHomeVM, AttentionItem } from "@workhub/contracts";
import {
  actionElementApplyPayload,
  actionElementMergePayload,
  actionHrefFromElement,
  approvalRespondIdFromHref,
  escapeHtml,
  escalationActionFromHref,
  proposalActionFromHref,
  safeHref
} from "@workhub/web-runtime";

import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";
import {
  classifyProposalConflictActionHref,
  proposalListDisplayTitle,
  proposalMergeConflictHtml,
  reviewProposalWithoutMerge,
  type ProposalReviewOnlyClient
} from "./proposals.js";

// 决策卡的动作 href 分两类:导航型(看改动「查看变更」GET /proposals/:id、工作项 /workitems/:id —— 该内联打开对应能力)
// 与提交型(POST /api/... —— 走 runAction 落库)。导航型若被当提交处理,会落到 runAction 末尾的「请到对应能力处理」
// 死 toast(对抗审查 HIGH:决策卡「查看变更」是死按钮)。纯函数,便于单测。
export function classifyAttentionActionHref(href: string):
  | { kind: "navigate"; view: "proposals" | "workitem"; id: string }
  | { kind: "submit" } {
  const proposalId = /^\/proposals\/([^/?#]+)$/.exec(href)?.[1];
  if (proposalId) {
    return { kind: "navigate", view: "proposals", id: proposalId };
  }
  const workitemId = /^\/workitems\/([^/?#]+)$/.exec(href)?.[1];
  if (workitemId) {
    return { kind: "navigate", view: "workitem", id: workitemId };
  }
  return { kind: "submit" };
}

type Tone = "approval" | "choice" | "permission" | "handoff" | "info";

function escalationResolvePayloadFromActionId(actionId: string | undefined) {
  if (actionId === "escalation_retry") {
    return { action: "retry" as const };
  }
  if (actionId === "escalation_pm_mode") {
    return { action: "pm_mode" as const };
  }
  if (actionId === "escalation_cancel") {
    return { action: "cancel" as const };
  }
  return undefined;
}

function toneForKind(kind: AttentionItem["kind"]): Tone {
  switch (kind) {
    case "approval":
    case "proposal_review":
      return "approval";
    case "clarification":
      return "choice";
    case "budget":
      return "permission";
    case "escalation":
      return "handoff";
    default:
      return "info";
  }
}

function tagLabel(tone: Tone, zh: boolean): string {
  switch (tone) {
    case "approval":
      return zh ? "待审批" : "Approve";
    case "choice":
      return zh ? "帮我拿主意" : "Pick one";
    case "permission":
      return zh ? "要你授权" : "Allow?";
    case "handoff":
      return zh ? "需处理" : "Needs action";
    default:
      return zh ? "看一眼" : "Heads-up";
  }
}

export function attentionTagLabelForKind(kind: AttentionItem["kind"], zh: boolean): string {
  return tagLabel(toneForKind(kind), zh);
}

function actionBtnClass(style: AttentionItem["actions"][number]["style"]): string {
  if (style === "primary") return "wh-spot-act wh-spot-act--primary";
  if (style === "danger") return "wh-spot-act wh-spot-act--danger";
  if (style === "quiet") return "wh-spot-act wh-spot-act--quiet";
  return "wh-spot-act";
}

function renderAction(action: AttentionItem["actions"][number]): string {
  const attrs = [
    `type="button"`,
    `class="${actionBtnClass(action.style)} ds-pressable"`,
    `data-att-action-id="${escapeHtml(action.id)}"`,
    `data-att-href="${escapeHtml(safeHref(action.href))}"`,
    action.method ? `data-att-method="${escapeHtml(action.method)}"` : "",
    action.requires_reason ? `data-att-requires-reason="true"` : ""
  ]
    .filter(Boolean)
    .join(" ");
  return `<button ${attrs}>${escapeHtml(action.label)}</button>`;
}

// 桌面暂不支持「转交他人」（需要选人 UI，且没有任何能力承接）——与其渲染一个点了
// 静默无效/误导 toast 的按钮，不如先不显示(rank8)。href 形如 /api/approvals/{id}/delegate。
function isUnsupportedDesktopAction(href: string): boolean {
  return /\/delegate(?:[/?#]|$)/u.test(href);
}

function renderCard(item: AttentionItem, zh: boolean): string {
  const tone = toneForKind(item.kind);
  const desc = item.reason_text ?? item.summary_text ?? "";
  const actions = item.actions.filter((a) => !isUnsupportedDesktopAction(a.href));
  const title = attentionCardDisplayTitle(item, zh);
  return `<article class="wh-spot-card ds-glass" data-att-id="${escapeHtml(item.id)}" data-att-tone="${tone}">
    <span class="wh-spot-card-bar wh-spot-card-bar--${tone}"></span>
    <div class="wh-spot-card-main">
      <div class="wh-spot-card-head">
        <span class="wh-spot-chip wh-spot-chip--${tone}">${escapeHtml(attentionTagLabelForKind(item.kind, zh))}</span>
      </div>
      <h3 class="wh-spot-card-title">${escapeHtml(title)}</h3>
      ${desc ? `<p class="wh-spot-card-desc">${escapeHtml(desc)}</p>` : ""}
      <div class="wh-spot-card-actions" data-att-actionrow>${actions.map(renderAction).join("")}</div>
    </div>
  </article>`;
}

export function attentionCardDisplayTitle(item: Pick<AttentionItem, "kind" | "title">, zh: boolean) {
  return item.kind === "proposal_review" ? proposalListDisplayTitle(item.title, zh) : item.title;
}

function renderQueue(vm: AttentionHomeVM, zh: boolean): string {
  const items = vm.queue ?? [];
  if (items.length === 0) {
    return `<div class="wh-spot-empty">
      <div class="wh-spot-empty-face">٩(◜◡◝)۶</div>
      <h3 class="wh-spot-empty-title">${zh ? "全部搞定啦" : "All clear"}</h3>
      <p class="wh-spot-empty-sub">${zh ? "有要你拍板的，Cuu 会第一时间端过来" : "Cuu will bring the next call straight to you"}</p>
    </div>`;
  }
  return `<div class="wh-spot-cards ds-stagger">${items.map((item) => renderCard(item, zh)).join("")}</div>`;
}

function loadingHtml(zh: boolean): string {
  return `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉取待拍板…" : "Loading decisions…"}</div>`;
}

// 内联打回理由（统一玻璃小弹层），点选即以该理由把这条打回。href 存在容器上——审批项的动作 id 是
// "deny"、看改动项是 "request_changes"，不能靠 id 反查按钮（H2 之前就是写死 deny 才失效）。
function reasonChips(zh: boolean, href: string): string {
  const reasons = zh
    ? ["方向不对，重做", "细节需要调整", "先放一放", "缺少依据"]
    : ["Wrong direction", "Needs tweaks", "Hold for now", "Insufficient evidence"];
  return `<div class="wh-spot-reasons" data-att-reasons data-att-reason-href="${escapeHtml(href)}">
    <p class="wh-spot-reasons-q">${zh ? "打回理由（点一个）" : "Reason for sending back"}</p>
    <div class="wh-spot-reasons-row">${reasons
      .map((r) => `<button type="button" class="wh-spot-reason ds-pressable" data-att-reason="${escapeHtml(r)}">${escapeHtml(r)}</button>`)
      .join("")}</div>
  </div>`;
}

function summaryText(result: unknown): string | undefined {
  if (result && typeof result === "object" && "attention" in result) {
    const att = (result as { attention?: { summary_text?: string } }).attention;
    if (att && typeof att.summary_text === "string") {
      return att.summary_text;
    }
  }
  return undefined;
}

export function reviewAttentionProposalWithoutMerge(client: ProposalReviewOnlyClient, proposalId: string) {
  return reviewProposalWithoutMerge(client, proposalId);
}

export function attentionConflictHtmlFromError(error: unknown, zh: boolean) {
  return proposalMergeConflictHtml(error, zh);
}

export function createAttentionView(): SpotlightCapabilityView {
  return {
    id: "approvals",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      const { body, client } = ctx;
      let disposed = false;
      // 单飞守卫：处置中禁止再次点击，避免重复 POST（第二发会 409 approval_race）。
      let busy = false;
      // rank7：上次失败的加载器，点「重试」即重跑。
      let retry: (() => void) | undefined;

      const setSubtitleFromVm = (vm: AttentionHomeVM) => {
        const n = vm.queue?.length ?? 0;
        ctx.setSubtitle(n > 0 ? (zh ? `${n} 条待你拍板` : `${n} waiting on you`) : zh ? "都处理完了" : "all done");
      };

      const render = (vm: AttentionHomeVM) => {
        if (disposed) return;
        body.innerHTML = renderQueue(vm, zh);
        setSubtitleFromVm(vm);
        ctx.requestResize();
      };

      const refresh = async () => {
        try {
          const vm = await client.pages.attention({ locale: ctx.locale });
          render(vm);
        } catch {
          if (!disposed) {
            retry = () => void refresh();
            body.innerHTML = spotlightErrorHtml(zh, zh ? "待拍板没拉到" : "Couldn't load decisions");
            ctx.requestResize();
          }
        }
      };

      const showConflictPanel = (error: unknown) => {
        const conflictHtml = attentionConflictHtmlFromError(error, zh);
        if (!conflictHtml) return false;
        body.innerHTML = conflictHtml;
        ctx.toast(zh ? "需要先处理冲突" : "Resolve conflicts first", "info");
        ctx.requestResize();
        return true;
      };

      const runConflictAction = async (target: HTMLElement) => {
        const href = actionHrefFromElement(target);
        const action = classifyProposalConflictActionHref(href);
        if (action.kind === "detail") {
          ctx.open("proposals", { id: action.proposalId, route: href });
          return;
        }
        if (busy) return;
        busy = true;
        try {
          let result: unknown;
          if (action.kind === "apply") {
            const payload = actionElementApplyPayload(target);
            if (!payload.ok) {
              ctx.toast(zh ? "冲突选项缺少必要参数" : "This conflict option is missing details", "error");
              return;
            }
            result = await client.applyMergeProposalCandidate(action.applyId, payload.payload);
          } else if (action.kind === "merge") {
            const payload = actionElementMergePayload(target);
            if (!payload.ok) {
              ctx.toast(zh ? "冲突选项缺少必要参数" : "This conflict option is missing details", "error");
              return;
            }
            result = await client.mergeProposal(action.proposalId, payload.payload);
          }
          if (!result) {
            ctx.toast(zh ? "这个冲突动作暂时不可执行" : "This conflict action is not available", "error");
            return;
          }
          ctx.toast(summaryText(result) ?? (zh ? "冲突已处理" : "Conflict resolved"), "ok");
          ctx.onActionSettled?.();
          await refresh();
        } catch (error) {
          if (!showConflictPanel(error)) {
            ctx.toast(zh ? "冲突处理失败，稍后重试" : "Conflict action failed. Try again.", "error");
          }
        } finally {
          busy = false;
        }
      };

      // 执行一个卡片动作（approve / deny / 看改动合入）。复用 href 分类器 → client 方法。
      const runAction = async (
        href: string,
        actionId: string | undefined,
        reasonMd: string | undefined
      ): Promise<boolean> => {
        const escalation = escalationActionFromHref(href);
        if (escalation?.action === "resolve") {
          const payload = escalationResolvePayloadFromActionId(actionId);
          if (!payload) {
            ctx.toast(zh ? "这个升级动作暂不可用" : "This escalation action is not available", "error");
            return false;
          }
          const res = await client.resolveEscalation(escalation.escalationId, payload);
          ctx.toast(summaryText(res) ?? (zh ? "升级已处理" : "Escalation handled"), "ok");
          return true;
        }
        const approvalId = approvalRespondIdFromHref(href);
        if (approvalId) {
          if (actionId === "deny" || reasonMd) {
            const res = await client.respondApproval(approvalId, {
              decision: "deny",
              ...(reasonMd ? { reason_md: reasonMd } : {}),
              remember: "once"
            });
            ctx.toast(summaryText(res) ?? (zh ? "已打回" : "Sent back"), "ok");
            return true;
          }
          const res = await client.respondApproval(approvalId, { decision: "allow", remember: "once" });
          ctx.toast(summaryText(res) ?? (zh ? "已通过" : "Approved"), "ok");
          return true;
        }
        const proposal = proposalActionFromHref(href);
        if (proposal?.action === "review") {
          if (actionId === "deny" || reasonMd) {
            const res = await client.reviewProposal(proposal.proposalId, {
              decision: "request_changes",
              ...(reasonMd ? { reason_md: reasonMd } : {}),
              remember: "once"
            });
            ctx.toast(summaryText(res) ?? (zh ? "已打回改改" : "Changes requested"), "ok");
            return true;
          }
          const review = await reviewAttentionProposalWithoutMerge(client, proposal.proposalId);
          ctx.toast(summaryText(review) ?? (zh ? "已确认通过，下一步可合入交付物" : "Approved. You can merge the deliverable next."), "ok");
          return true;
        }
        if (proposal?.action === "merge") {
          const merge = await client.mergeProposal(proposal.proposalId);
          ctx.toast(summaryText(merge) ?? (zh ? "已合并" : "Merged"), "ok");
          return true;
        }
        // 其它种类（澄清继续/升级派人等）：S1 暂引导到对应能力处理，不在审批片里强接。
        ctx.toast(zh ? "这类请到对应能力处理" : "Handle this in its own capability", "info");
        return false;
      };

      // M13：动作期间给被点按钮即时忙态(禁用 + 文案换「…中」),否则一/两段网络往返里按钮看着毫无反应,
      // 用户以为没点上。成功会 refresh 重渲队列把按钮换掉,失败/无操作则在 finally 复原(对已分离节点是无害空操作)。
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

      // 统一提交入口：单飞守卫 + 失败兜底 toast + 成功回拉队列。runAction 自身不再裸 await，
      // 双击/合并冲突等失败不再被静默吞掉（rank3）。
      const submit = async (href: string, actionId: string | undefined, reasonMd: string | undefined, btn: HTMLButtonElement | null = null) => {
        if (busy) return;
        busy = true;
        const restore = markBusy(btn, actionId === "deny" ? (zh ? "打回中…" : "Sending back…") : (zh ? "处理中…" : "Working…"));
        try {
          const ok = await runAction(href, actionId, reasonMd);
          if (ok) {
            ctx.onActionSettled?.();
          }
          if (ok && !disposed) await refresh();
        } catch (error) {
          if (!disposed) {
            if (!showConflictPanel(error)) {
              ctx.toast(zh ? "操作失败（可能有冲突或已处理过），稍后重试" : "Action failed (conflict or already handled) — retry", "error");
            }
          }
        } finally {
          busy = false;
          restore();
        }
      };

      body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        // 0) 重试上次失败的加载（rank7）。
        if (target.closest("[data-spot-retry]")) {
          retry?.();
          return;
        }
        if (target.closest("[data-prop-back]")) {
          void refresh();
          return;
        }
        const conflictAction = target.closest<HTMLElement>("[data-prop-conflict-panel] a[href],[data-prop-conflict-panel] [data-action-href],[data-prop-conflict-panel] [data-href]");
        if (conflictAction) {
          event.preventDefault();
          void runConflictAction(conflictAction);
          return;
        }
        // 1) 选了打回理由 → 以该理由打回（href 从理由层容器取，审批/看改动通用）。
        const reasonBtn = target.closest<HTMLButtonElement>("[data-att-reason]");
        if (reasonBtn) {
          const reasonsEl = reasonBtn.closest<HTMLElement>("[data-att-reasons]");
          const href = reasonsEl?.dataset.attReasonHref;
          const reason = reasonBtn.dataset.attReason;
          if (href) {
            void submit(href, "deny", reason, reasonBtn);
          }
          return;
        }
        // 2) 卡片动作按钮。
        const actionBtn = target.closest<HTMLButtonElement>("[data-att-action-id]");
        if (!actionBtn) {
          return;
        }
        const href = actionBtn.dataset.attHref;
        const actionId = actionBtn.dataset.attActionId;
        if (!href) {
          return;
        }
        // 需要理由（打回）：就地展开理由小层，不立即提交。
        if (actionBtn.dataset.attRequiresReason === "true" || actionId === "deny") {
          const row = actionBtn.closest<HTMLElement>("[data-att-actionrow]");
          // 理由层是 actionrow 的兄弟节点（afterend），去重要查父容器而非 row 后代——
          // 否则守卫恒过，重复点击会叠出多个理由层（rank10）。
          if (row && !row.parentElement?.querySelector("[data-att-reasons]")) {
            row.insertAdjacentHTML("afterend", reasonChips(zh, href));
            ctx.requestResize();
          }
          return;
        }
        // 导航型动作(「查看变更」GET /proposals/:id、/workitems/:id)内联打开对应能力,不当 POST 动作提交。
        const nav = classifyAttentionActionHref(href);
        if (nav.kind === "navigate") {
          ctx.open(nav.view, { id: nav.id, route: href });
          return;
        }
        void submit(href, actionId, undefined, actionBtn);
      });

      body.innerHTML = loadingHtml(zh);
      ctx.requestResize();
      void refresh();

      return () => {
        disposed = true;
      };
    }
  };
}

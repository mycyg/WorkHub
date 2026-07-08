// WorkHub 桌面 · Spotlight「审批/待拍板」能力内联视图（S1 证明片）。
// 苹果聚焦盒里直接拉 client.pages.attention 的 queue，渲成统一玻璃决策卡，approve/deny/看改动·合入
// 全部内联打真 API（复用 web-runtime 的 href 分类器 + client 方法），处置后回拉 queue、盒子随内容缩放。
// 这一片证明是「真·内联重构」而非换入口：没有 hash、没有全屏壳、动作就地落库。

import type { PageRequestOptions } from "@workhub/api-client";
import type { ApprovalDetailVM, AttentionHomeVM, AttentionItem } from "@workhub/contracts";
import {
  actionElementApplyPayload,
  actionElementMergePayload,
  actionHrefFromElement,
  approvalRespondIdFromHref,
  escapeHtml,
  escalationActionFromHref,
  memoryConflictActionFromHref,
  proposalActionFromHref,
  skipPlanProposalIdFromHref,
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
  | { kind: "navigate"; view: "proposals" | "workitem" | "replay" | "settings" | "cost"; id?: string }
  | { kind: "submit" } {
  const proposalId = /^\/proposals\/([^/?#]+)$/.exec(href)?.[1];
  if (proposalId) {
    return { kind: "navigate", view: "proposals", id: proposalId };
  }
  const workitemId = /^\/workitems\/([^/?#]+)$/.exec(href)?.[1];
  if (workitemId) {
    return { kind: "navigate", view: "workitem", id: workitemId };
  }
  // UX-M7（桌面死按钮）：sync_conflict「看 B 的出处」/「打开设置」与 budget「查看预算」
  // 是 GET 导航，之前落进提交路径的死 toast——分别路由到 replay/settings/cost 能力。
  const replayId = /^\/agent-runs\/([^/?#]+)\/replay$/.exec(href)?.[1];
  if (replayId) {
    return { kind: "navigate", view: "replay", id: replayId };
  }
  if (/^\/settings(?:[/?#]|$)/.test(href)) {
    return { kind: "navigate", view: "settings" };
  }
  if (/^\/dashboard\/cost(?:[/?#]|$)/.test(href)) {
    return { kind: "navigate", view: "cost" };
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
    case "plan_review":
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
  if (kind === "plan_review") {
    return zh ? "计划审阅" : "Plan review";
  }
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
    action.requires_reason ? `data-att-requires-reason="true"` : "",
    action.request_json ? `data-request-json="${escapeHtml(JSON.stringify(action.request_json))}"` : ""
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

// UX-M6（桌面可编辑合并）：sync_conflict 卡「合并成一条（可编辑）」在桌面也要真可编辑——
// merge 动作的 request_json.value_md 草稿渲成文本框，提交时读框内内容。
function mergeDraftEditor(item: AttentionItem, zh: boolean): string {
  if (item.kind !== "sync_conflict") {
    return "";
  }
  const draft = item.actions.find((action) => action.id === "merge_both")?.request_json?.["value_md"];
  if (typeof draft !== "string") {
    return "";
  }
  return `<label class="wh-spot-card-desc">${escapeHtml(zh ? "合并草稿（可编辑，点「合并成一条」提交）" : "Merge draft (editable — submit via Merge into one)")}</label>
    <textarea class="wh-spot-merge-draft" data-att-merge-value rows="3">${escapeHtml(draft)}</textarea>`;
}

// 普通用户审查 R2：web 同一张审批卡有依据链接、桌面却要凭空拍板——压缩渲前 2 条证据（标题+摘录）。
function renderCardEvidence(item: AttentionItem, zh: boolean): string {
  const refs = item.evidence_refs ?? [];
  if (refs.length === 0) {
    return "";
  }
  const rows = refs.slice(0, 2).map((ref) => `<p class="wh-spot-card-desc" data-att-evidence="${escapeHtml(ref.id)}">${escapeHtml(zh ? "依据：" : "Evidence: ")}${escapeHtml(ref.title)}${ref.excerpt ? ` — ${escapeHtml(ref.excerpt.slice(0, 80))}` : ""}</p>`).join("");
  const more = refs.length > 2
    ? `<p class="wh-spot-card-desc">${escapeHtml(zh ? `还有 ${refs.length - 2} 条依据，去主窗口细看` : `${refs.length - 2} more in the main window`)}</p>`
    : "";
  return rows + more;
}

// R5 双端一致（high）：web 审批详情有 AI 理由/预期收益/风险标签、流程时间线（含 SLA）与评论讨论，
// 桌面此前只有标题+两条证据=「盲拍板」。审批卡加「详情」就地展开，数据取 client.pages.approvals
// 的 items_detail（与 web 审批工作台同源），评论可读可发（postApprovalComment）。
export function renderApprovalDetailInline(detail: ApprovalDetailVM, itemId: string, zh: boolean): string {
  const ts = (iso: string | undefined) => {
    const m = iso ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(iso) : null;
    return m ? `${m[1]} ${m[2]}` : "";
  };
  const aiRows = [
    detail.ai_reason ? `<p class="wh-spot-card-desc">${escapeHtml(zh ? "AI 理由：" : "AI reason: ")}${escapeHtml(detail.ai_reason)}</p>` : "",
    detail.expected_benefit ? `<p class="wh-spot-card-desc">${escapeHtml(zh ? "预期收益：" : "Expected benefit: ")}${escapeHtml(detail.expected_benefit)}</p>` : "",
    detail.risk_label ? `<p class="wh-spot-card-desc">${escapeHtml(zh ? "风险：" : "Risk: ")}${escapeHtml(detail.risk_label)}</p>` : ""
  ].filter(Boolean).join("");
  const timeline = detail.timeline.length
    ? `<p class="wh-spot-card-desc">${escapeHtml(zh ? "流程：" : "Timeline: ")}${detail.timeline.map((step) => `${escapeHtml(step.label)}${step.sla_due_at ? escapeHtml(`（${zh ? "SLA " : "SLA "}${ts(step.sla_due_at)}）`) : ""}${step.at ? ` ${escapeHtml(ts(step.at))}` : ""}`).join(" → ")}</p>`
    : "";
  const comments = detail.comments.length
    ? detail.comments.slice(-3).map((comment) => `<p class="wh-spot-card-desc" data-att-detail-comment="${escapeHtml(comment.id)}">${escapeHtml(comment.author_label)}：${escapeHtml(comment.body)}</p>`).join("")
    : `<p class="wh-spot-card-desc">${escapeHtml(zh ? "还没有讨论。" : "No discussion yet.")}</p>`;
  return `<div class="wh-spot-card-detail" data-att-detail="${escapeHtml(itemId)}">
    ${aiRows}
    ${timeline}
    <p class="wh-spot-card-desc"><strong>${escapeHtml(zh ? "讨论" : "Discussion")}</strong></p>
    ${comments}
    <div class="wh-spot-reasons-row"><button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-att-detail-collapse="${escapeHtml(itemId)}">${escapeHtml(zh ? "收起" : "Collapse")}</button></div>
    <div class="wh-spot-reasons-row"><input class="wh-spot-merge-draft" data-att-detail-comment-input="${escapeHtml(itemId)}" placeholder="${escapeHtml(zh ? "写句评论…" : "Add a comment…")}" /><button type="button" class="wh-spot-act ds-pressable" data-att-detail-comment-submit="${escapeHtml(itemId)}">${escapeHtml(zh ? "发出" : "Post")}</button></div>
  </div>`;
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
      ${renderCardEvidence(item, zh)}
      ${mergeDraftEditor(item, zh)}
      <div class="wh-spot-card-actions" data-att-actionrow>${actions.map(renderAction).join("")}${item.kind === "approval" ? `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-att-detail-toggle="${escapeHtml(item.id)}">${escapeHtml(zh ? "详情" : "Details")}</button>` : ""}</div>
    </div>
  </article>`;
}

export function attentionCardDisplayTitle(item: Pick<AttentionItem, "kind" | "title">, zh: boolean) {
  return item.kind === "proposal_review" ? proposalListDisplayTitle(item.title, zh) : item.title;
}

function renderSourceWarnings(vm: AttentionHomeVM, zh: boolean): string {
  const sourceWarnings = vm.source_warnings ?? [];
  if (sourceWarnings.length === 0) {
    return "";
  }
  return `<div class="wh-spot-list" data-spot-attention-source-warnings="${escapeHtml(String(sourceWarnings.length))}">
    ${sourceWarnings.map((warning) => `<div class="wh-spot-row" data-spot-attention-source-warning="${escapeHtml(warning.source)}">
      <div class="wh-spot-row-main">
        <div class="wh-spot-row-title">${escapeHtml(zh ? "决策来源未完全加载" : "Decision sources are partially loaded")}</div>
        <div class="wh-spot-row-sub">${escapeHtml(warning.message)}</div>
      </div>
    </div>`).join("")}
  </div>`;
}

function renderQueue(vm: AttentionHomeVM, zh: boolean, hasSourceWarnings = false): string {
  const items = vm.queue ?? [];
  if (items.length === 0) {
    return `<div class="wh-spot-empty">
      <div class="wh-spot-empty-face">٩(◜◡◝)۶</div>
      <h3 class="wh-spot-empty-title">${hasSourceWarnings ? (zh ? "当前没有已加载的待办" : "No loaded decisions") : (zh ? "全部搞定啦" : "All clear")}</h3>
      <p class="wh-spot-empty-sub">${hasSourceWarnings ? (zh ? "部分来源暂时不可用，请稍后重试。" : "Some sources are unavailable. Retry in a moment.") : (zh ? "有要你拍板的，Cuu 会第一时间端过来" : "Cuu will bring the next call straight to you")}</p>
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
  // 普通用户审查 R2 high：「先放一放」听起来是延后，点了却提交 deny 打回且不可撤——语义误导，移除。
  const reasons = zh
    ? ["方向不对，重做", "细节需要调整", "缺少依据"]
    : ["Wrong direction", "Needs tweaks", "Insufficient evidence"];
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

export function reviewAttentionProposalWithoutMerge(client: ProposalReviewOnlyClient, proposalId: string, options?: PageRequestOptions) {
  return reviewProposalWithoutMerge(client, proposalId, options);
}

type MemoryConflictActionClient = {
  resolveMemoryConflict: (
    id: string,
    payload: {
      resolution: "keep_current" | "accept_incoming" | "merge_both" | "edit_memory" | "discard_both";
      expected_updated_at: string;
      value_md?: string;
    }
  ) => Promise<unknown>;
};

export function resolveAttentionMemoryConflictAction(client: MemoryConflictActionClient, href: string, valueMd?: string) {
  const action = memoryConflictActionFromHref(href);
  if (!action) {
    return undefined;
  }
  // UX-M6：merge_both 带上桌面卡文本框里的编辑稿；空白/非 merge 不传（服务端回落默认合并）。
  const trimmed = valueMd?.trim();
  return client.resolveMemoryConflict(action.conflictId, {
    resolution: action.resolution,
    expected_updated_at: action.expectedUpdatedAt,
    ...(action.resolution === "merge_both" && trimmed ? { value_md: trimmed } : {})
  });
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
      // R5：审批详情取自 pages.approvals 的 items_detail——同一次会话内缓存，refresh 后失效。
      let approvalDetailCache: Awaited<ReturnType<typeof client.pages.approvals>> | undefined;

      const setSubtitleFromVm = (vm: AttentionHomeVM) => {
        const n = vm.queue?.length ?? 0;
        const hasSourceWarnings = (vm.source_warnings?.length ?? 0) > 0;
        if (n === 0 && hasSourceWarnings) {
          ctx.setSubtitle(zh ? "部分待办未加载" : "partially loaded");
          return;
        }
        ctx.setSubtitle(n > 0 ? (zh ? `${n} 条待你拍板` : `${n} waiting on you`) : zh ? "都处理完了" : "all done");
      };

      const render = (vm: AttentionHomeVM) => {
        if (disposed) return;
        const hasSourceWarnings = (vm.source_warnings?.length ?? 0) > 0;
        body.innerHTML = `${renderSourceWarnings(vm, zh)}${renderQueue(vm, zh, hasSourceWarnings)}`;
        setSubtitleFromVm(vm);
        ctx.requestResize();
      };

      const refresh = async () => {
        approvalDetailCache = undefined;
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
            result = await client.applyMergeProposalCandidate(action.applyId, payload.payload, { locale: ctx.locale });
          } else if (action.kind === "merge") {
            const payload = actionElementMergePayload(target);
            if (!payload.ok) {
              ctx.toast(zh ? "冲突选项缺少必要参数" : "This conflict option is missing details", "error");
              return;
            }
            result = await client.mergeProposal(action.proposalId, payload.payload, { locale: ctx.locale });
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
        reasonMd: string | undefined,
        actionTarget?: HTMLElement
      ): Promise<boolean> => {
        const escalation = escalationActionFromHref(href);
        if (escalation?.action === "budget") {
          const res = await client.resolveBudgetDecision(escalation.escalationId, escalation.budgetActionId, { locale: ctx.locale });
          ctx.toast(summaryText(res) ?? (zh ? "预算选择已记录" : "Budget decision recorded"), "ok");
          return true;
        }
        if (escalation?.action === "resolve") {
          const payload = escalationResolvePayloadFromActionId(actionId);
          if (!payload) {
            ctx.toast(zh ? "这个升级动作暂不可用" : "This escalation action is not available", "error");
            return false;
          }
          const res = await client.resolveEscalation(escalation.escalationId, payload, { locale: ctx.locale });
          ctx.toast(summaryText(res) ?? (zh ? "升级已处理" : "Escalation handled"), "ok");
          return true;
        }
        const mergeDraft = actionTarget
          ?.closest("[data-att-id]")
          ?.querySelector<HTMLTextAreaElement>("[data-att-merge-value]")?.value;
        const memoryConflict = await resolveAttentionMemoryConflictAction(client, href, mergeDraft);
        if (memoryConflict) {
          ctx.toast(summaryText(memoryConflict) ?? (zh ? "偏好冲突已处理" : "Memory conflict handled"), "ok");
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
        // B-R9.6 UX 审计（skip-plan 假接线）：plan_review 卡「先不拆，单个 AI 跑」。
        const skipPlanProposalId = skipPlanProposalIdFromHref(href);
        if (skipPlanProposalId) {
          const skipped = await client.skipTaskPlanProposal(skipPlanProposalId, { locale: ctx.locale });
          ctx.toast(skipped.attention.summary_text || (zh ? "已改为单个 AI 直接执行" : "Switched to a single AI run"), "ok");
          return true;
        }
        const proposal = proposalActionFromHref(href);
        if (proposal?.action === "review") {
          if (actionId === "deny" || reasonMd) {
            const res = await client.reviewProposal(proposal.proposalId, {
              decision: "request_changes",
              ...(reasonMd ? { reason_md: reasonMd } : {}),
              remember: "once"
            }, { locale: ctx.locale });
            ctx.toast(summaryText(res) ?? (zh ? "已打回改改" : "Changes requested"), "ok");
            return true;
          }
          const review = await reviewAttentionProposalWithoutMerge(client, proposal.proposalId, { locale: ctx.locale });
          ctx.toast(summaryText(review) ?? (zh ? "已确认通过，下一步可合入交付物" : "Approved. You can merge the deliverable next."), "ok");
          return true;
        }
        if (proposal?.action === "merge") {
          const payload = actionTarget ? actionElementMergePayload(actionTarget) : { ok: true as const };
          if (!payload.ok) {
            ctx.toast(zh ? "这个计划动作缺少必要参数" : "This plan action is missing details", "error");
            return false;
          }
          const merge = await client.mergeProposal(proposal.proposalId, payload.payload, { locale: ctx.locale });
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
          const ok = await runAction(href, actionId, reasonMd, btn ?? undefined);
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
        // R8：详情面板「收起」——可见按钮 + 纳入 Esc 逐级回退（controller 的 back selector）。
        const detailCollapse = target.closest<HTMLButtonElement>("[data-att-detail-collapse]");
        if (detailCollapse) {
          detailCollapse.closest("[data-att-detail]")?.remove();
          ctx.requestResize();
          return;
        }
        // R5 双端一致：审批卡「详情」——就地展开 AI 理由/时间线/评论（数据与 web 审批工作台同源）。
        const detailToggle = target.closest<HTMLButtonElement>("[data-att-detail-toggle]");
        if (detailToggle) {
          const itemId = detailToggle.dataset.attDetailToggle ?? "";
          const card = detailToggle.closest<HTMLElement>("[data-att-id]");
          const existing = card?.querySelector<HTMLElement>("[data-att-detail]");
          if (existing) {
            existing.remove();
            ctx.requestResize();
            return;
          }
          // R9：详情互斥展开——收起其它卡已展开的详情，保证同一时刻至多一个「收起」钮，
          // Esc 逐级回退（单例 querySelector）收起的就是用户正看的这层。
          for (const other of body.querySelectorAll<HTMLElement>("[data-att-detail]")) {
            other.remove();
          }
          const restore = markBusy(detailToggle, zh ? "加载中…" : "Loading…");
          void (async () => {
            try {
              const center = approvalDetailCache ?? await client.pages.approvals({ locale: ctx.locale });
              approvalDetailCache = center;
              // R8：用户可能在 await 期间切走能力——disposed 后不再对新视图弹 toast/改 DOM。
              if (disposed) {
                return;
              }
              const detail = center.items_detail?.[itemId];
              if (!detail) {
                ctx.toast(zh ? "这条的详情暂时拉不到" : "Details are unavailable for this item", "info");
                return;
              }
              // R8：挂到 .wh-spot-card-main（内容列）而非 article 本体——后者是 flex 行，
              // 详情块会被当成第三个 flex 子项挤成无内边距窄条。
              (card?.querySelector<HTMLElement>(".wh-spot-card-main") ?? card)?.insertAdjacentHTML("beforeend", renderApprovalDetailInline(detail, itemId, zh));
              ctx.requestResize();
            } catch {
              if (!disposed) {
                ctx.toast(zh ? "详情没拉到，稍后重试" : "Couldn't load details. Try again.", "error");
              }
            } finally {
              restore();
            }
          })();
          return;
        }
        const detailCommentSubmit = target.closest<HTMLButtonElement>("[data-att-detail-comment-submit]");
        if (detailCommentSubmit) {
          const itemId = detailCommentSubmit.dataset.attDetailCommentSubmit ?? "";
          const input = body.querySelector<HTMLInputElement>(`[data-att-detail-comment-input="${itemId}"]`);
          const text = input?.value.trim();
          if (!text) {
            ctx.toast(zh ? "先写点内容再发" : "Write something first", "info");
            return;
          }
          const restore = markBusy(detailCommentSubmit, zh ? "发送中…" : "Posting…");
          void (async () => {
            try {
              await client.postApprovalComment(itemId, { body: text });
              if (disposed) {
                return;
              }
              if (input) {
                input.value = "";
              }
              approvalDetailCache = undefined;
              const detailEl = body.querySelector<HTMLElement>(`[data-att-detail="${itemId}"]`);
              detailEl?.insertAdjacentHTML("beforeend", `<p class="wh-spot-card-desc">${escapeHtml(zh ? "我：" : "Me: ")}${escapeHtml(text)}</p>`);
              ctx.toast(zh ? "评论已发出" : "Comment posted", "ok");
              ctx.requestResize();
            } catch {
              if (!disposed) {
                ctx.toast(zh ? "评论没发出去，稍后重试" : "Comment failed. Try again.", "error");
              }
            } finally {
              restore();
            }
          })();
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
          ctx.open(nav.view, nav.id ? { id: nav.id, route: href } : { route: href });
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

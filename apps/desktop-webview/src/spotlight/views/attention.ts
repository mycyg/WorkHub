// WorkHub 桌面 · Spotlight「审批/待拍板」能力内联视图（S1 证明片）。
// 苹果聚焦盒里直接拉 client.pages.attention 的 queue，渲成统一玻璃决策卡，approve/deny/看改动·合入
// 全部内联打真 API（复用 web-runtime 的 href 分类器 + client 方法），处置后回拉 queue、盒子随内容缩放。
// 这一片证明是「真·内联重构」而非换入口：没有 hash、没有全屏壳、动作就地落库。

import type { PageRequestOptions, WorkHubApiClient } from "@workhub/api-client";
import type { ApprovalDetailVM, AttentionHomeVM, AttentionItem } from "@workhub/contracts";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import {
  actionElementApplyPayload,
  actionElementMergePayload,
  actionHrefFromElement,
  approvalRespondIdFromHref,
  delegateResultSummaryText,
  delegateTargetFromHref,
  chooseThenApplyMergeCandidate,
  escapeHtml,
  escalationActionFromHref,
  fetchWorkspaceRosterMembers,
  isDelegateActionHref,
  memoryConflictActionFromHref,
  proposalActionFromHref,
  selectedConflictChooserCandidate,
  skipPlanProposalIdFromHref,
  safeHref,
  submitDelegateAction
} from "@workhub/web-runtime";

import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";
import {
  classifyProposalConflictActionHref,
  proposalListDisplayTitle,
  proposalMergeConflictHtml,
  reviewProposalWithoutMerge,
  type ProposalReviewOnlyClient
} from "./proposals.js";

import { spotlightViewsT } from "./locales.js";
import { pendingDecisionCount } from "../../pending-decision-count.js";

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
      return spotlightViewsT(zh, "approve");
    case "choice":
      return spotlightViewsT(zh, "pickOne");
    case "permission":
      return spotlightViewsT(zh, "allow");
    case "handoff":
      return spotlightViewsT(zh, "needsAction");
    default:
      return spotlightViewsT(zh, "headsUp");
  }
}

export function attentionTagLabelForKind(kind: AttentionItem["kind"], zh: boolean): string {
  if (kind === "plan_review") {
    return spotlightViewsT(zh, "planReview");
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

// R23 F-04（升级转交端到端）：桌面此前把「转交他人」整个剥掉（rank8：没有选人 UI，点了只会落到
// runAction 末尾那句「这类请到对应能力处理」的死 toast）。现在按钮留着，点它先就地展开这个选人层
// ——与打回理由层同款做法（actionrow 的兄弟节点），选完再提交。成员来自本工作区花名册
// （GET /api/workspace/roster，翻页翻到底），与 web 选人器同一份实现。
function delegatePicker(zh: boolean, href: string): string {
  return `<div class="wh-spot-reasons" data-att-delegate data-att-delegate-href="${escapeHtml(safeHref(href))}">
    <p class="wh-spot-reasons-q">${spotlightViewsT(zh, "handOffToWhom")}</p>
    <select class="wh-spot-delegate-select" data-att-delegate-select aria-label="${escapeHtml(spotlightViewsT(zh, "pickATeammate"))}"><option value="">${escapeHtml(spotlightViewsT(zh, "loadingMembers"))}</option></select>
    <div class="wh-spot-reasons-row"><button type="button" class="wh-spot-act ds-pressable" data-att-delegate-submit>${escapeHtml(spotlightViewsT(zh, "handOff"))}</button></div>
  </div>`;
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
  return `<label class="wh-spot-card-desc">${escapeHtml(spotlightViewsT(zh, "mergeDraftEditableSubmitViaMerge"))}</label>
    <textarea class="wh-spot-merge-draft" data-att-merge-value rows="3">${escapeHtml(draft)}</textarea>`;
}

// 普通用户审查 R2：web 同一张审批卡有依据链接、桌面却要凭空拍板——压缩渲前 2 条证据（标题+摘录）。
function renderCardEvidence(item: AttentionItem, zh: boolean): string {
  const refs = item.evidence_refs ?? [];
  if (refs.length === 0) {
    return "";
  }
  const rows = refs.slice(0, 2).map((ref) => `<p class="wh-spot-card-desc" data-att-evidence="${escapeHtml(ref.id)}">${escapeHtml(spotlightViewsT(zh, "evidence"))}${escapeHtml(ref.title)}${ref.excerpt ? ` — ${escapeHtml(ref.excerpt.slice(0, 80))}` : ""}</p>`).join("");
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
    detail.ai_reason ? `<p class="wh-spot-card-desc">${escapeHtml(spotlightViewsT(zh, "aiReason"))}${escapeHtml(detail.ai_reason)}</p>` : "",
    detail.expected_benefit ? `<p class="wh-spot-card-desc">${escapeHtml(spotlightViewsT(zh, "expectedBenefit"))}${escapeHtml(detail.expected_benefit)}</p>` : "",
    detail.risk_label ? `<p class="wh-spot-card-desc">${escapeHtml(spotlightViewsT(zh, "risk"))}${escapeHtml(detail.risk_label)}</p>` : ""
  ].filter(Boolean).join("");
  const timeline = detail.timeline.length
    ? `<p class="wh-spot-card-desc">${escapeHtml(spotlightViewsT(zh, "timeline"))}${detail.timeline.map((step) => `${escapeHtml(step.label)}${step.sla_due_at ? escapeHtml(`（${zh ? "SLA " : "SLA "}${ts(step.sla_due_at)}）`) : ""}${step.at ? ` ${escapeHtml(ts(step.at))}` : ""}`).join(" → ")}</p>`
    : "";
  const comments = detail.comments.length
    ? detail.comments.slice(-3).map((comment) => `<p class="wh-spot-card-desc" data-att-detail-comment="${escapeHtml(comment.id)}">${escapeHtml(comment.author_label)}：${escapeHtml(comment.body)}</p>`).join("")
    : `<p class="wh-spot-card-desc">${escapeHtml(spotlightViewsT(zh, "noDiscussionYet"))}</p>`;
  return `<div class="wh-spot-card-detail" data-att-detail="${escapeHtml(itemId)}">
    ${aiRows}
    ${timeline}
    <p class="wh-spot-card-desc"><strong>${escapeHtml(spotlightViewsT(zh, "discussion"))}</strong></p>
    ${comments}
    <div class="wh-spot-reasons-row"><button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-att-detail-collapse="${escapeHtml(itemId)}">${escapeHtml(spotlightViewsT(zh, "collapse"))}</button></div>
    <div class="wh-spot-reasons-row"><input class="wh-spot-merge-draft" data-att-detail-comment-input="${escapeHtml(itemId)}" placeholder="${escapeHtml(spotlightViewsT(zh, "addAComment"))}" /><button type="button" class="wh-spot-act ds-pressable" data-att-detail-comment-submit="${escapeHtml(itemId)}">${escapeHtml(spotlightViewsT(zh, "post"))}</button></div>
  </div>`;
}

function renderCard(item: AttentionItem, zh: boolean): string {
  const tone = toneForKind(item.kind);
  const desc = item.reason_text ?? item.summary_text ?? "";
  const actions = item.actions;
  const title = attentionCardDisplayTitle(item, zh);
  return `<article class="wh-spot-card ds-glass" data-att-id="${escapeHtml(item.id)}" data-att-kind="${escapeHtml(item.kind)}" data-att-tone="${tone}">
    <span class="wh-spot-card-bar wh-spot-card-bar--${tone}"></span>
    <div class="wh-spot-card-main">
      <div class="wh-spot-card-head">
        <span class="wh-spot-chip wh-spot-chip--${tone}">${escapeHtml(attentionTagLabelForKind(item.kind, zh))}</span>
        ${item.project_name ? `<span class="wh-spot-chip" data-att-project="true">${escapeHtml(item.project_name)}</span>` : ""}
      </div>
      <h3 class="wh-spot-card-title">${escapeHtml(title)}</h3>
      ${desc ? `<p class="wh-spot-card-desc">${escapeHtml(desc)}</p>` : ""}
      ${renderCardEvidence(item, zh)}
      ${mergeDraftEditor(item, zh)}
      <div class="wh-spot-card-actions" data-att-actionrow>${actions.map(renderAction).join("")}${item.kind === "approval" ? `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-att-detail-toggle="${escapeHtml(item.id)}">${escapeHtml(spotlightViewsT(zh, "details"))}</button>` : ""}</div>
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
        <div class="wh-spot-row-title">${escapeHtml(spotlightViewsT(zh, "decisionSourcesArePartiallyLoaded"))}</div>
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
      <h3 class="wh-spot-empty-title">${hasSourceWarnings ? (spotlightViewsT(zh, "noLoadedDecisions")) : (spotlightViewsT(zh, "allClear"))}</h3>
      <p class="wh-spot-empty-sub">${hasSourceWarnings ? (spotlightViewsT(zh, "someSourcesAreUnavailableRetryIn")) : (spotlightViewsT(zh, "cuuWillBringTheNextCall"))}</p>
    </div>`;
  }
  return `<div class="wh-spot-cards ds-stagger">${items.map((item) => renderCard(item, zh)).join("")}</div>`;
}

function loadingHtml(zh: boolean): string {
  return `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(zh, "loadingDecisions")}</div>`;
}

// 内联打回理由（统一玻璃小弹层），点选即以该理由把这条打回。href 存在容器上——审批项的动作 id 是
// "deny"、看改动项是 "request_changes"，不能靠 id 反查按钮（H2 之前就是写死 deny 才失效）。
function reasonChips(zh: boolean, href: string): string {
  // 普通用户审查 R2 high：「先放一放」听起来是延后，点了却提交 deny 打回且不可撤——语义误导，移除。
  const reasons = zh
    ? ["方向不对，重做", "细节需要调整", "缺少依据"]
    : ["Wrong direction", "Needs tweaks", "Insufficient evidence"];
  return `<div class="wh-spot-reasons" data-att-reasons data-att-reason-href="${escapeHtml(href)}">
    <p class="wh-spot-reasons-q">${spotlightViewsT(zh, "reasonForSendingBack")}</p>
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

// R15 批 I1（决策收件箱进 workbench）：把这套「渲染 + 动作」逻辑抽成两窗共用的纯函数入口。Spotlight
// 聚焦盒与工作台中栏收件箱都调用它——只依赖下面这个最小上下文契约（SpotlightViewContext 在结构上
// 天然满足它，见 createAttentionView 的零改造委托；工作台侧另建一层薄适配把 open→右栏提议详情、
// requestResize→no-op、toast→工作台内联提示，见 workbench/inbox/view.ts）。抽取边界刻意收在「哪些
// ctx 能力真被 mount 用到」：client（下面这组读/写端点）、locale、body、setSubtitle、toast、
// requestResize、open（导航型动作路由的 5 个目标）、onActionSettled。back/refocusBody/signal/target/
// resetShell 都没被这套逻辑用到，故不进契约。
export type AttentionInboxApiClient = Pick<
  WorkHubApiClient,
  | "pages"
  | "respondApproval"
  | "reviewProposal"
  | "mergeProposal"
  | "applyMergeProposalCandidate"
  // F-05：撞车「先选稿再采纳」——多候选融合稿分组选择器确认后先 choose 再 apply。
  | "chooseMergeProposalCandidate"
  | "resolveBudgetDecision"
  | "resolveEscalation"
  | "resolveMemoryConflict"
  | "skipTaskPlanProposal"
  | "postApprovalComment"
  // R23 F-04：转交动作（审批 + 升级）与选人器的花名册拉取。request 是花名册翻页要的通用出口
  // （fetchWorkspaceRosterMembers 只要求 { request }），不是给这套逻辑开的任意后门。
  | "delegateApproval"
  | "delegateEscalation"
  | "request"
>;

// 导航型动作 href 分类出的跳转目标（classifyAttentionActionHref 的 view 联合）——刻意不复用 spotlight
// 的 CommandId，让共用模块与 command-palette 解耦；这五个字面量都是 CommandId 的子集，故 spotlight 侧
// 的 ctx.open(CommandId, SpotlightTarget) 结构上仍能承接（见 createAttentionView 的委托）。
export type AttentionInboxNavView = "proposals" | "workitem" | "replay" | "settings" | "cost";

export type AttentionInboxContext = {
  client: AttentionInboxApiClient;
  locale: WorkHubLocale;
  body: HTMLElement;
  setSubtitle: (text: string) => void;
  toast: (message: string, tone?: "ok" | "error" | "info") => void;
  requestResize: () => void;
  open: (view: AttentionInboxNavView, target?: { id?: string; route?: string }) => void;
  onActionSettled?: (() => void) | undefined;
  // R23 F-04：进来时要直奔哪张卡（桌宠「转交他人」把主窗打开到 /approvals?id=<决策 id>，
  // 见 pet-surface 的 desktopPetDelegateMainRoute）。首屏渲完滚到那张卡并高亮一次，之后的刷新不再跳。
  target?: { id?: string } | undefined;
};

// R17 #17：mount 句柄——dispose 卸载 + refresh 重拉列表。spotlight 侧只取 .dispose（见 createAttentionView），
// 行为零变化；工作台收件箱额外用 refresh() 让开着的列表随角标一起活（不必切走再切回）。
export type AttentionInboxHandle = {
  dispose: () => void;
  refresh: () => void;
};

// 两窗共用的收件箱挂载逻辑（S1 证明片的 mount 主体，行为逐字保持）。返回卸载清理 + 重拉句柄。
export function mountAttentionInbox(ctx: AttentionInboxContext): AttentionInboxHandle {
  {
      const zh = ctx.locale === "zh-CN";
      const { body, client } = ctx;
      let disposed = false;
      // 单飞守卫：处置中禁止再次点击，避免重复 POST（第二发会 409 approval_race）。
      let busy = false;
      // rank7：上次失败的加载器，点「重试」即重跑。
      let retry: (() => void) | undefined;
      // R5：审批详情取自 pages.approvals 的 items_detail——同一次会话内缓存，refresh 后失效。
      let approvalDetailCache: Awaited<ReturnType<typeof client.pages.approvals>> | undefined;
      // R23 F-04：外部入口带进来的目标卡（只认一次——用完清空，之后的 refresh 不该再把人拽回去）。
      let pendingFocusItemId = ctx.target?.id;

      const setSubtitleFromVm = (vm: AttentionHomeVM) => {
        const n = pendingDecisionCount(vm);
        const hasSourceWarnings = (vm.source_warnings?.length ?? 0) > 0;
        if (n === 0 && hasSourceWarnings) {
          ctx.setSubtitle(spotlightViewsT(ctx.locale, "partiallyLoaded"));
          return;
        }
        ctx.setSubtitle(n > 0 ? (zh ? `${n} 条待你拍板` : `${n} waiting on you`) : spotlightViewsT(ctx.locale, "allDone"));
      };

      // R23 F-04：把外部入口指名的那张卡滚进视野并高亮。找不到就安静放过（队列可能已经被处理掉了），
      // 不弹「没找到」——用户看到的是一个正常队列，没必要为一次导航提示解释。
      const focusPendingItem = () => {
        const itemId = pendingFocusItemId;
        if (!itemId) {
          return;
        }
        pendingFocusItemId = undefined;
        const card = [...body.querySelectorAll<HTMLElement>("[data-att-id]")]
          .find((node) => node.dataset.attId === itemId);
        if (!card) {
          return;
        }
        card.dataset.attFocus = "true";
        card.scrollIntoView?.({ block: "nearest" });
      };

      const render = (vm: AttentionHomeVM) => {
        if (disposed) return;
        const hasSourceWarnings = (vm.source_warnings?.length ?? 0) > 0;
        body.innerHTML = `${renderSourceWarnings(vm, zh)}${renderQueue(vm, zh, hasSourceWarnings)}`;
        focusPendingItem();
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
            body.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoadDecisions"));
            ctx.requestResize();
          }
        }
      };

      const showConflictPanel = (error: unknown) => {
        const conflictHtml = attentionConflictHtmlFromError(error, zh);
        if (!conflictHtml) return false;
        body.innerHTML = conflictHtml;
        ctx.toast(spotlightViewsT(ctx.locale, "resolveConflictsFirst"), "info");
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
          await refresh();
        } catch (error) {
          if (!showConflictPanel(error)) {
            ctx.toast(spotlightViewsT(ctx.locale, "conflictActionFailedTryAgain"), "error");
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
          ctx.toast(summaryText(res) ?? (spotlightViewsT(ctx.locale, "budgetDecisionRecorded")), "ok");
          return true;
        }
        if (escalation?.action === "resolve") {
          const payload = escalationResolvePayloadFromActionId(actionId);
          if (!payload) {
            ctx.toast(spotlightViewsT(ctx.locale, "thisEscalationActionIsNotAvailable"), "error");
            return false;
          }
          const res = await client.resolveEscalation(escalation.escalationId, payload, { locale: ctx.locale });
          ctx.toast(summaryText(res) ?? (spotlightViewsT(ctx.locale, "escalationHandled")), "ok");
          return true;
        }
        // R23 F-04：转交（审批 /api/approvals/:id/delegate、升级 /api/escalations/:id/delegate）。
        // 必须排在下面的通用分类之前——否则会一路落到末尾那句「这类请到对应能力处理」的兜底 toast，
        // 新动作等于白发。转交对象取自本卡展开的选人层（DOM 就是这次点击的上下文，与 mergeDraft 同款取法）。
        if (isDelegateActionHref(href)) {
          const picker = actionTarget?.closest<HTMLElement>("[data-att-delegate]");
          const toUserId = picker?.querySelector<HTMLSelectElement>("[data-att-delegate-select]")?.value ?? "";
          if (!toUserId) {
            ctx.toast(spotlightViewsT(ctx.locale, "pickATeammateFirst"), "error");
            return false;
          }
          const delegated = await submitDelegateAction(client, href, toUserId, { locale: ctx.locale });
          ctx.toast(
            delegateResultSummaryText(delegated)
              ?? (delegateTargetFromHref(href)?.kind === "escalation"
                ? (spotlightViewsT(ctx.locale, "handedOffThisDecisionNowWaits"))
                : (spotlightViewsT(ctx.locale, "approvalHandedOffItNowRoutes"))),
            "ok"
          );
          return true;
        }
        const mergeDraft = actionTarget
          ?.closest("[data-att-id]")
          ?.querySelector<HTMLTextAreaElement>("[data-att-merge-value]")?.value;
        const memoryConflict = await resolveAttentionMemoryConflictAction(client, href, mergeDraft);
        if (memoryConflict) {
          ctx.toast(summaryText(memoryConflict) ?? (spotlightViewsT(ctx.locale, "memoryConflictHandled")), "ok");
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
            ctx.toast(summaryText(res) ?? (spotlightViewsT(ctx.locale, "sentBack")), "ok");
            return true;
          }
          const res = await client.respondApproval(approvalId, { decision: "allow", remember: "once" });
          ctx.toast(summaryText(res) ?? (spotlightViewsT(ctx.locale, "approved")), "ok");
          return true;
        }
        // B-R9.6 UX 审计（skip-plan 假接线）：plan_review 卡「先不拆，单个 AI 跑」。
        const skipPlanProposalId = skipPlanProposalIdFromHref(href);
        if (skipPlanProposalId) {
          const skipped = await client.skipTaskPlanProposal(skipPlanProposalId, { locale: ctx.locale });
          ctx.toast(skipped.attention.summary_text || (spotlightViewsT(ctx.locale, "switchedToASingleAiRun")), "ok");
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
            ctx.toast(summaryText(res) ?? (spotlightViewsT(ctx.locale, "changesRequested")), "ok");
            return true;
          }
          const review = await reviewAttentionProposalWithoutMerge(client, proposal.proposalId, { locale: ctx.locale });
          ctx.toast(summaryText(review) ?? (spotlightViewsT(ctx.locale, "approvedYouCanMergeTheDeliverable")), "ok");
          return true;
        }
        if (proposal?.action === "merge") {
          const payload = actionTarget ? actionElementMergePayload(actionTarget) : { ok: true as const };
          if (!payload.ok) {
            ctx.toast(spotlightViewsT(ctx.locale, "thisPlanActionIsMissingDetails"), "error");
            return false;
          }
          const merge = await client.mergeProposal(proposal.proposalId, payload.payload, { locale: ctx.locale });
          ctx.toast(summaryText(merge) ?? (spotlightViewsT(ctx.locale, "merged")), "ok");
          return true;
        }
        // 其它种类（澄清继续/升级派人等）：S1 暂引导到对应能力处理，不在审批片里强接。
        ctx.toast(spotlightViewsT(ctx.locale, "handleThisInItsOwnCapability"), "info");
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
        const restore = markBusy(btn, actionId === "deny" ? (spotlightViewsT(ctx.locale, "sendingBack")) : (spotlightViewsT(ctx.locale, "working")));
        try {
          const ok = await runAction(href, actionId, reasonMd, btn ?? undefined);
          if (ok) {
            ctx.onActionSettled?.();
          }
          if (ok && !disposed) await refresh();
        } catch (error) {
          if (!disposed) {
            if (!showConflictPanel(error)) {
              ctx.toast(spotlightViewsT(ctx.locale, "actionFailedConflictOrAlreadyHandled"), "error");
            }
          }
        } finally {
          busy = false;
          restore();
        }
      };

      // R23 F-04：选人层展开后懒加载工作区成员（不进首屏加载，不改 attention 拉取次数）。选项用
      // textContent 逐个建节点——昵称是用户可改的自由文本，拼 innerHTML 就是把它当标记解析。
      const loadDelegateMembers = async (select: HTMLSelectElement) => {
        const doc = select.ownerDocument;
        const statusOption = (text: string) => {
          const option = doc.createElement("option");
          option.value = "";
          option.textContent = text;
          return option;
        };
        try {
          const members = await fetchWorkspaceRosterMembers(client);
          if (disposed || !select.isConnected) {
            return;
          }
          if (members.length === 0) {
            select.replaceChildren(statusOption(spotlightViewsT(ctx.locale, "noOtherMembersInThisWorkspace")));
            return;
          }
          select.replaceChildren(...members.map((member) => {
            const option = doc.createElement("option");
            option.value = member.user_id;
            option.textContent = `${member.nickname}${member.is_admin ? (spotlightViewsT(ctx.locale, "admin")) : ""}`;
            return option;
          }));
        } catch {
          if (!disposed && select.isConnected) {
            select.replaceChildren(statusOption(spotlightViewsT(ctx.locale, "couldnTLoadMembersReopenTo")));
          }
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
          const restore = markBusy(detailToggle, spotlightViewsT(ctx.locale, "loading"));
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
                ctx.toast(spotlightViewsT(ctx.locale, "detailsAreUnavailableForThisItem"), "info");
                return;
              }
              // R8：挂到 .wh-spot-card-main（内容列）而非 article 本体——后者是 flex 行，
              // 详情块会被当成第三个 flex 子项挤成无内边距窄条。
              (card?.querySelector<HTMLElement>(".wh-spot-card-main") ?? card)?.insertAdjacentHTML("beforeend", renderApprovalDetailInline(detail, itemId, zh));
              ctx.requestResize();
            } catch {
              if (!disposed) {
                ctx.toast(spotlightViewsT(ctx.locale, "couldnTLoadDetailsTryAgain"), "error");
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
            ctx.toast(spotlightViewsT(ctx.locale, "writeSomethingFirst"), "info");
            return;
          }
          const restore = markBusy(detailCommentSubmit, spotlightViewsT(ctx.locale, "posting"));
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
              detailEl?.insertAdjacentHTML("beforeend", `<p class="wh-spot-card-desc">${escapeHtml(spotlightViewsT(ctx.locale, "me"))}${escapeHtml(text)}</p>`);
              ctx.toast(spotlightViewsT(ctx.locale, "commentPosted"), "ok");
              ctx.requestResize();
            } catch {
              if (!disposed) {
                ctx.toast(spotlightViewsT(ctx.locale, "commentFailedTryAgain"), "error");
              }
            } finally {
              restore();
            }
          })();
          return;
        }
        // R23 F-04：选人层的「确认转交」——href 存在选人层容器上（与理由层同款），提交走统一 submit，
        // 具体调哪个 SDK 方法由 runAction 的 delegate 分支按 href 分派。
        const delegateSubmit = target.closest<HTMLButtonElement>("[data-att-delegate-submit]");
        if (delegateSubmit) {
          const pickerHref = delegateSubmit.closest<HTMLElement>("[data-att-delegate]")?.dataset.attDelegateHref;
          if (pickerHref) {
            void submit(pickerHref, "delegate", undefined, delegateSubmit);
          }
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
        // R23 F-04：转交要先选人——点「转交他人」只就地展开选人层（不提交），成员懒加载。
        // 必须排在下面的导航分类与 submit 之前。
        if (isDelegateActionHref(href)) {
          const row = actionBtn.closest<HTMLElement>("[data-att-actionrow]");
          const host = row?.parentElement;
          if (row && host && !host.querySelector("[data-att-delegate]")) {
            row.insertAdjacentHTML("afterend", delegatePicker(zh, href));
            ctx.requestResize();
            const select = host.querySelector<HTMLSelectElement>("[data-att-delegate] [data-att-delegate-select]");
            if (select) {
              void loadDelegateMembers(select);
            }
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

      return {
        dispose: () => {
          disposed = true;
        },
        // #17：宿主在角标随 SSE/轮询刷新时同步调这个重拉列表——单飞守卫（busy）与 disposed 保护都在 refresh
        // 内部，已卸载后再调是无害空操作。
        refresh: () => {
          if (disposed) {
            return;
          }
          void refresh();
        }
      };
  }
}

// Spotlight 侧零改造：能力视图外壳只是把 mount 委托给共用逻辑（SpotlightViewContext 结构上满足
// AttentionInboxContext——client 是全量 WorkHubApiClient、open 的 CommandId/SpotlightTarget 分别是
// AttentionInboxNavView/{id,route} 的超集，逆变承接）。行为与抽取前逐字相同，spotlight 既有测试原样绿。
export function createAttentionView(): SpotlightCapabilityView {
  return {
    id: "approvals",
    mount(ctx: SpotlightViewContext) {
      // spotlight 只需要卸载清理函数——取 .dispose，refresh 句柄不外露，聚焦盒行为逐字不变。
      return mountAttentionInbox(ctx).dispose;
    }
  };
}

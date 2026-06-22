// WorkHub 桌面 · Spotlight「审批/待拍板」能力内联视图（S1 证明片）。
// 苹果聚焦盒里直接拉 client.pages.attention 的 queue，渲成统一玻璃决策卡，approve/deny/看改动·合并
// 全部内联打真 API（复用 web-runtime 的 href 分类器 + client 方法），处置后回拉 queue、盒子随内容缩放。
// 这一片证明是「真·内联重构」而非换入口：没有 hash、没有全屏壳、动作就地落库。

import type { AttentionHomeVM, AttentionItem } from "@workhub/contracts";
import {
  approvalRespondIdFromHref,
  escapeHtml,
  proposalActionFromHref,
  safeHref
} from "@workhub/web-runtime";

import type { SpotlightCapabilityView, SpotlightViewContext } from "../view-context.js";

type Tone = "approval" | "choice" | "permission" | "handoff" | "info";

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
      return zh ? "派给谁" : "Assign";
    default:
      return zh ? "看一眼" : "Heads-up";
  }
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

function renderCard(item: AttentionItem, zh: boolean): string {
  const tone = toneForKind(item.kind);
  const desc = item.reason_text ?? item.summary_text ?? "";
  return `<article class="wh-spot-card ds-glass" data-att-id="${escapeHtml(item.id)}" data-att-tone="${tone}">
    <span class="wh-spot-card-bar wh-spot-card-bar--${tone}"></span>
    <div class="wh-spot-card-main">
      <div class="wh-spot-card-head">
        <span class="wh-spot-chip wh-spot-chip--${tone}">${escapeHtml(tagLabel(tone, zh))}</span>
      </div>
      <h3 class="wh-spot-card-title">${escapeHtml(item.title)}</h3>
      ${desc ? `<p class="wh-spot-card-desc">${escapeHtml(desc)}</p>` : ""}
      <div class="wh-spot-card-actions" data-att-actionrow>${item.actions.map(renderAction).join("")}</div>
    </div>
  </article>`;
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

export function createAttentionView(): SpotlightCapabilityView {
  return {
    id: "approvals",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      const { body, client } = ctx;
      let disposed = false;
      // 单飞守卫：处置中禁止再次点击，避免重复 POST（第二发会 409 approval_race）。
      let busy = false;

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
            body.innerHTML = `<div class="wh-spot-error">${zh ? "待拍板没拉到，稍后重试" : "Couldn't load decisions — retry shortly"}</div>`;
            ctx.requestResize();
          }
        }
      };

      // 执行一个卡片动作（approve / deny / 看改动通过+合并）。复用 href 分类器 → client 方法。
      const runAction = async (
        href: string,
        actionId: string | undefined,
        reasonMd: string | undefined
      ): Promise<boolean> => {
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
          const review = await client.reviewProposal(proposal.proposalId, { decision: "approve", remember: "once" });
          const merge = await client.mergeProposal(proposal.proposalId);
          ctx.toast(
            `${summaryText(review) ?? (zh ? "已通过" : "Approved")} · ${summaryText(merge) ?? (zh ? "已合并" : "Merged")}`,
            "ok"
          );
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

      // 统一提交入口：单飞守卫 + 失败兜底 toast + 成功回拉队列。runAction 自身不再裸 await，
      // 双击/合并冲突等失败不再被静默吞掉（rank3）。
      const submit = async (href: string, actionId: string | undefined, reasonMd: string | undefined) => {
        if (busy) return;
        busy = true;
        try {
          const ok = await runAction(href, actionId, reasonMd);
          if (ok && !disposed) await refresh();
        } catch {
          if (!disposed) {
            ctx.toast(zh ? "操作失败（可能有冲突或已处理过），稍后重试" : "Action failed (conflict or already handled) — retry", "error");
          }
        } finally {
          busy = false;
        }
      };

      body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        // 1) 选了打回理由 → 以该理由打回（href 从理由层容器取，审批/看改动通用）。
        const reasonBtn = target.closest<HTMLElement>("[data-att-reason]");
        if (reasonBtn) {
          const reasonsEl = reasonBtn.closest<HTMLElement>("[data-att-reasons]");
          const href = reasonsEl?.dataset.attReasonHref;
          const reason = reasonBtn.dataset.attReason;
          if (href) {
            void submit(href, "deny", reason);
          }
          return;
        }
        // 2) 卡片动作按钮。
        const actionBtn = target.closest<HTMLElement>("[data-att-action-id]");
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
        void submit(href, actionId, undefined);
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

// WorkHub 桌面 · Spotlight「看改动 / diff」能力内联视图（S4，核心闭环的「审阅 + 合并」）。
// 列表源 = pages.attention 队列里的 proposal_review 项（无全局 proposal 列表端点）→ 点开 pages.proposal(id)
// 渲统一玻璃 diff（改动清单 + 校验 + 风险）→ 通过并合并 / 打回（复用 reviewProposal/mergeProposal）。
// list→detail 全在盒子内联 morph。

import type { AttentionItem, DeliverableChange, ProposalDetailVM } from "@workhub/contracts";
import { escapeHtml, proposalActionFromHref } from "@workhub/web-runtime";

import type { SpotlightCapabilityView, SpotlightViewContext } from "../view-context.js";

function proposalIdFromItem(item: AttentionItem): string | undefined {
  for (const action of item.actions) {
    const parsed = proposalActionFromHref(action.href);
    if (parsed?.proposalId) {
      return parsed.proposalId;
    }
  }
  return undefined;
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

function detailHtml(vm: ProposalDetailVM, zh: boolean): string {
  const m = vm.manifest;
  const riskTone = m.risk.level === "high" ? "handoff" : m.risk.level === "medium" ? "permission" : "info";
  const checks = m.checks.length
    ? `<div class="wh-spot-checks">${m.checks
        .map((ck) => `<span class="wh-spot-check wh-spot-check--${ck.status}">${escapeHtml(ck.label)}</span>`)
        .join("")}</div>`
    : "";
  const open = vm.status === "opened";
  const statusLabel: Record<string, [string, string]> = {
    opened: ["待审阅", "Open"],
    reviewed: ["已审阅", "Reviewed"],
    merged: ["已合并", "Merged"],
    rejected: ["已打回", "Rejected"]
  };
  const actions = open
    ? `<div class="wh-spot-card-actions" data-prop-actions>
        <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-prop-approve>${zh ? "通过并合并" : "Approve & merge"}</button>
        <button type="button" class="wh-spot-act wh-spot-act--danger ds-pressable" data-prop-deny>${zh ? "打回" : "Request changes"}</button>
      </div>`
    : `<div class="wh-spot-card-actions"><span class="wh-spot-chip wh-spot-chip--info">${escapeHtml((zh ? statusLabel[vm.status]?.[0] : statusLabel[vm.status]?.[1]) ?? vm.status)}</span></div>`;
  return `<div class="wh-spot-dash">
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-prop-back style="align-self:flex-start">${zh ? "← 返回列表" : "← Back"}</button>
    <div>
      <div class="wh-spot-card-head"><span class="wh-spot-chip wh-spot-chip--${riskTone}">${escapeHtml(m.risk.human_label)}</span><span class="wh-spot-change-path">${m.changes.length} ${zh ? "处改动" : "changes"}</span></div>
      <h3 class="wh-spot-card-title" style="margin-top:10px">${escapeHtml(vm.title)}</h3>
      <p class="wh-spot-card-desc">${escapeHtml(m.summary_md)}</p>
    </div>
    ${checks}
    <div class="wh-spot-changes">${m.changes.map((c) => changeHtml(c, zh)).join("")}</div>
    ${actions}
  </div>`;
}

function reasonChips(zh: boolean): string {
  const reasons = zh ? ["方向不对", "细节要调整", "缺少依据", "先放一放"] : ["Wrong direction", "Needs tweaks", "Insufficient evidence", "Hold"];
  return `<div class="wh-spot-reasons" data-prop-reasons><p class="wh-spot-reasons-q">${zh ? "打回理由（点一个）" : "Reason"}</p><div class="wh-spot-reasons-row">${reasons
    .map((r) => `<button type="button" class="wh-spot-reason ds-pressable" data-prop-reason="${escapeHtml(r)}">${escapeHtml(r)}</button>`)
    .join("")}</div></div>`;
}

function summaryText(result: unknown): string | undefined {
  if (result && typeof result === "object" && "attention" in result) {
    const att = (result as { attention?: { summary_text?: string } }).attention;
    if (att && typeof att.summary_text === "string") return att.summary_text;
  }
  return undefined;
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

      const showList = async () => {
        ctx.setSubtitle(zh ? "待审阅的改动" : "Changes to review");
        body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉改动…" : "Loading…"}</div>`;
        ctx.requestResize();
        try {
          const vm = await client.pages.attention({ locale: ctx.locale });
          if (disposed) return;
          const items = (vm.queue ?? []).filter((it) => it.kind === "proposal_review" || proposalIdFromItem(it));
          if (!items.length) {
            body.innerHTML = `<div class="wh-spot-empty"><div class="wh-spot-empty-face">٩(◜◡◝)۶</div><h3 class="wh-spot-empty-title">${zh ? "没有待看的改动" : "No changes to review"}</h3><p class="wh-spot-empty-sub">${zh ? "AI 产出改动后会出现在这里和审批队列" : "AI changes show here and in approvals"}</p></div>`;
          } else {
            ctx.setSubtitle(zh ? `${items.length} 处待审阅` : `${items.length} to review`);
            body.innerHTML = `<div class="wh-spot-list ds-stagger">${items
              .map((it) => {
                const pid = proposalIdFromItem(it);
                return `<button type="button" class="wh-spot-row" data-prop-open="${escapeHtml(pid ?? "")}" style="cursor:pointer;width:100%;text-align:left">
                  <span class="wh-spot-card-bar wh-spot-card-bar--approval" style="border-radius:3px"></span>
                  <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(it.title)}</div><div class="wh-spot-row-sub">${escapeHtml(it.summary_text ?? "")}</div></div>
                </button>`;
              })
              .join("")}</div>`;
          }
        } catch {
          if (!disposed) body.innerHTML = `<div class="wh-spot-error">${zh ? "改动没拉到，稍后重试" : "Couldn't load — retry"}</div>`;
        }
        ctx.requestResize();
      };

      const showDetail = async (id: string) => {
        currentId = id;
        body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉 diff…" : "Loading diff…"}</div>`;
        ctx.requestResize();
        try {
          const vm = await client.pages.proposal(id, { locale: ctx.locale });
          if (disposed) return;
          ctx.setSubtitle(zh ? "改动详情" : "Change detail");
          body.innerHTML = detailHtml(vm, zh);
        } catch {
          if (!disposed) body.innerHTML = `<div class="wh-spot-error">${zh ? "diff 没拉到，稍后重试" : "Couldn't load diff — retry"}</div>`;
        }
        ctx.requestResize();
      };

      const approve = async () => {
        if (busy || !currentId) return;
        busy = true;
        try {
          const review = await client.reviewProposal(currentId, { decision: "approve", remember: "once" });
          const merge = await client.mergeProposal(currentId);
          ctx.toast(`${summaryText(review) ?? (zh ? "已通过" : "Approved")} · ${summaryText(merge) ?? (zh ? "已合并" : "Merged")}`, "ok");
          busy = false;
          void showList();
        } catch {
          busy = false;
          ctx.toast(zh ? "合并失败（可能有冲突），稍后重试" : "Merge failed (maybe a conflict)", "error");
        }
      };

      const deny = async (reason: string) => {
        if (busy || !currentId) return;
        busy = true;
        try {
          const res = await client.reviewProposal(currentId, { decision: "request_changes", reason_md: reason, remember: "once" });
          ctx.toast(summaryText(res) ?? (zh ? "已打回" : "Sent back"), "ok");
          busy = false;
          void showList();
        } catch {
          busy = false;
          ctx.toast(zh ? "打回失败，稍后重试" : "Failed — retry", "error");
        }
      };

      body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
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
        if (target.closest("[data-prop-approve]")) {
          void approve();
          return;
        }
        if (target.closest("[data-prop-deny]")) {
          const row = target.closest<HTMLElement>("[data-prop-actions]");
          if (row && !body.querySelector("[data-prop-reasons]")) {
            row.insertAdjacentHTML("afterend", reasonChips(zh));
            ctx.requestResize();
          }
          return;
        }
        const reason = target.closest<HTMLElement>("[data-prop-reason]");
        if (reason?.dataset.propReason) {
          void deny(reason.dataset.propReason);
        }
      });

      void showList();
      return () => {
        disposed = true;
      };
    }
  };
}

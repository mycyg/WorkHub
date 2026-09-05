import assert from "node:assert/strict";
import test from "node:test";

import type { WorkHubApiClient } from "@workhub/api-client";
import type { ProposalConflict } from "@workhub/contracts";
import type { ReplayRevertButton, ReplayRevertClickEvent, ReplayRevertRoot } from "@workhub/ui/replay";

import {
  bindDesktopAgentRunReplayRevert,
  loadDesktopAgentRunReplay,
  renderDesktopAgentRunReplay,
  renderDesktopProposalDetail
} from "./route-render.js";

// D-01（R23 精简批）：这几条用例原来是 apps/desktop-webview/src/main.test.ts 里「desktop webview surface
// advertises and loads the shared P0.5 gold path page VM」这条巨型测试、以及文件末尾两条
// bindDesktopAgentRunReplayRevert 测试，随 main.ts 死 barrel 一起搬过来的（同一条巨型测试里的
// gold-path/workitem/intake/agent-run-live/agent-army/Cuu 卡断言测的是零生产调用的包装函数，已随
// barrel 删除，不迁移）。fakeClient 只补桩 renderDesktopProposalDetail/renderDesktopAgentRunReplay
// 实际会调用的三个方法。

const proposalVm = {
  proposal_id: "proposal",
  work_item_id: "work",
  title: "周报草稿变更申请",
  status: "opened",
  manifest: {
    version: 0,
    work_item_id: "work",
    title: "周报草稿变更申请",
    summary_md: "新增一份周报草稿。",
    author: { actor_kind: "ai", label: "Cuu" },
    base: {},
    risk: { level: "low", human_label: "低风险", reversible: true },
    rollback: { available: true, description: "删除生成草稿即可回滚。" },
    evidence_refs: [],
    review: { reason_required_on_reject: true },
    changes: [
      {
        id: "change",
        human_summary: "新增 weekly-report.md",
        target_kind: "text_doc",
        change_type: "generated",
        target_ref: { entity_type: "drive_item", path: "docs/weekly-report.md" }
      }
    ],
    checks: [{ id: "scope", label: "范围检查", status: "passed", detail: "仅文件改动。" }]
  },
  review_actions: {
    approve: { id: "approve", label: "批准", method: "POST", href: "/approvals/approve" },
    request_changes: {
      id: "changes",
      label: "要求修改",
      method: "POST",
      href: "/approvals/changes",
      requires_reason: true
    }
  },
  evidence_refs: [],
  comments: []
};

const replayVm = {
  run: { handoff_md: "Cuu 完成了草稿生成。" },
  steps: [
    { step_no: 1, phase: "plan", output_excerpt: "列出章节。" },
    { step_no: 2, phase: "draft", output_excerpt: "生成草稿。" }
  ],
  cost: {
    me: {
      scope: { kind: "user", user_id: "10000000-0000-4000-8000-000000000001" },
      scope_label: "我的今日 AI 预算",
      policy_id: "pcost-user-day-v0",
      period: "day",
      period_start: "2026-06-05T00:00:00.000Z",
      period_end: "2026-06-06T00:00:00.000Z",
      token_in: 900,
      token_out: 300,
      total_tokens: 1200,
      max_tokens: 500000,
      remaining_tokens: 498800,
      estimated_cost_cny: "0.08",
      max_cost_cny: "20",
      remaining_cost_cny: "19.92",
      warning_ratio: 0.12,
      status: "ok"
    },
    scopes: [],
    active_notices: [],
    generated_at: "2026-06-05T01:00:00.000Z"
  },
  snapshots: [],
  evidence_refs: []
};

function proposalConflict(workItemId: string, proposalId: string): ProposalConflict {
  return {
    id: "conflict-weekly-report",
    work_item_id: workItemId,
    proposal_id: proposalId,
    change_id: "10000000-0000-4000-8000-000000000502",
    target_key: "drive_item:docs/weekly-report.md",
    target_kind: "text_doc",
    change_type: "updated",
    target_path: "docs/weekly-report.md",
    headline: "weekly-report.md 已经被另一份变更更新",
    summary_text: "正式版和这次版本都改了同一个文档，先选保留正式版还是采纳这次版本。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000511",
      change_id: "10000000-0000-4000-8000-000000000512",
      sha256: "a".repeat(64)
    },
    incoming: {
      sha256_before: "b".repeat(64),
      sha256_after: "c".repeat(64)
    },
    recommended_option_id: "keep_current",
    options: [
      {
        id: "keep_current",
        label: "保留正式版",
        summary_text: "保留已正式采纳的版本。",
        recommended: true,
        action: {
          id: "keep_current",
          label: "保留正式版",
          method: "POST",
          href: `/api/proposals/${proposalId}/merge`,
          request_json: { conflict_resolution: { accept_incoming_target_keys: [] } }
        }
      },
      {
        id: "accept_incoming",
        label: "采纳这次版本",
        summary_text: "用这次版本覆盖正式版。",
        action: {
          id: "accept_incoming",
          label: "采纳这次版本",
          method: "POST",
          href: `/api/proposals/${proposalId}/merge`,
          request_json: {
            conflict_resolution: { accept_incoming_target_keys: ["drive_item:docs/weekly-report.md"] }
          }
        }
      }
    ]
  };
}

function fakeClient(conflicts: ProposalConflict[] = []): WorkHubApiClient {
  return {
    pages: {
      async proposal() {
        return proposalVm;
      }
    },
    async listWorkItemConflicts(workItemId: string) {
      const filtered = conflicts.filter((conflict) => conflict.work_item_id === workItemId);
      return filtered.length > 0 ? { conflicts: filtered } : { conflicts: filtered, empty_state: "no_conflicts" as const };
    },
    async replayAgentRun() {
      return replayVm;
    }
  } as unknown as WorkHubApiClient;
}

test("desktop route-render renders proposal detail through the typed client", async () => {
  assert.equal((await renderDesktopProposalDetail(fakeClient(), "proposal")).surface, "desktop");
  assert.equal((await renderDesktopProposalDetail(fakeClient(), "proposal")).html.includes("这次改了什么"), true);
  assert.equal((await renderDesktopProposalDetail(fakeClient(), "proposal", "en-US")).html.includes("What changed"), true);

  const renderedConflict = await renderDesktopProposalDetail(fakeClient([proposalConflict("work", "proposal")]), "proposal");
  assert.equal(renderedConflict.conflictCount, 1);
  assert.equal(renderedConflict.html.includes("data-conflict-option-id=\"accept_incoming\""), true);
});

test("desktop route-render renders agent run replay through the typed client", async () => {
  assert.equal((await loadDesktopAgentRunReplay(fakeClient(), "run")).run.handoff_md, "Cuu 完成了草稿生成。");
  assert.equal((await renderDesktopAgentRunReplay(fakeClient(), "run")).html.includes("查看 AI 怎么做的"), true);
  assert.equal((await renderDesktopAgentRunReplay(fakeClient(), "run", "en-US")).html.includes("See how AI did it"), true);
});

// ── R20 DSK-UX（R19-3）：桌面 replay 撤销接线 ─────────────────────────────────────────────
class FakeRevertButton implements ReplayRevertButton {
  dataset: { [key: string]: string | undefined };
  textContent: string | null = "撤销此次改动";
  private handlers: Array<(event: ReplayRevertClickEvent) => void> = [];
  constructor(dataset: Record<string, string>) {
    this.dataset = { ...dataset };
  }
  setAttribute(): void {}
  removeAttribute(name: string): void {
    delete this.dataset[name];
  }
  addEventListener(_type: string, handler: (event: ReplayRevertClickEvent) => void): void {
    this.handlers.push(handler);
  }
  click(): void {
    const event: ReplayRevertClickEvent = { preventDefault() {}, stopPropagation() {} };
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}

class FakeRevertRoot implements ReplayRevertRoot {
  constructor(private readonly buttons: FakeRevertButton[]) {}
  querySelectorAll(): Iterable<ReplayRevertButton> {
    return this.buttons;
  }
}

test("bindDesktopAgentRunReplayRevert forwards a confirmed undo and fires the re-fetch callback", async () => {
  const button = new FakeRevertButton({ replayRevertSnapshot: "snap-1", replayRevertRun: "run-7" });
  const calls: Array<{ runId: string; payload: { snapshot_id: string } }> = [];
  const reFetched: Array<true> = [];
  const client = {
    revertAgentRun: (runId: string, payload: { snapshot_id: string }) => {
      calls.push({ runId, payload });
      return Promise.resolve({ status: "reverted" as const, snapshot: {} as never });
    }
  } as unknown as WorkHubApiClient;

  // 基线：没绑定前点击不发任何请求（对齐 live 壳「渲了按钮但无 handler」的修前态）。
  button.click();
  button.click();
  assert.equal(calls.length, 0);

  // 绑定后：桌面挂载点传的正是 client + onReverted 重拉回调（renderLiveGoldPathPanel 的 replay 分支即此形状）。
  bindDesktopAgentRunReplayRevert(new FakeRevertRoot([button]), client, {
    onReverted: () => reFetched.push(true)
  });
  button.click(); // 武装
  assert.equal(calls.length, 0);
  button.click(); // 执行
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [{ runId: "run-7", payload: { snapshot_id: "snap-1" } }]);
  // 成功后触发重拉——live 壳据此重渲 replay 面板，让被撤销的快照翻「已回滚」。
  assert.deepEqual(reFetched, [true]);
});

test("bindDesktopAgentRunReplayRevert is a no-op when the client lacks revertAgentRun", () => {
  const button = new FakeRevertButton({ replayRevertSnapshot: "snap-1", replayRevertRun: "run-7" });
  const dispose = bindDesktopAgentRunReplayRevert(new FakeRevertRoot([button]), {} as unknown as WorkHubApiClient);
  button.click();
  button.click();
  assert.equal(typeof dispose, "function");
  dispose();
  button.click();
  assert.equal(typeof dispose, "function");
});

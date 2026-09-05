import assert from "node:assert/strict";
import test from "node:test";

import type { WorkHubApiClient } from "@workhub/api-client";
import type { ReplayTraceVM } from "@workhub/contracts";
import type { ReplayRevertButton, ReplayRevertClickEvent, ReplayRevertRoot } from "@workhub/ui/replay";

import {
  bindDesktopAgentRunReplayRevert,
  loadDesktopAgentRunReplay,
  renderDesktopAgentRunReplay
} from "./desktop-agent-run-replay.js";

// F-06：这三个函数原来活在 main.ts（正被作为死码整体移除的 barrel），只被 main.test.ts 引用、没有任何
// 真实外壳调用——搬到独立模块后，测试也搬过来并保持等价覆盖，不让 main.ts 的删除悄悄丢掉这份验证。

function minimalReplay(overrides: Partial<ReplayTraceVM> = {}): ReplayTraceVM {
  return {
    run: {
      id: "10000000-0000-4000-8000-000000000501",
      work_item_id: "10000000-0000-4000-8000-000000000401",
      mode: "worker",
      actor: "AI",
      status: "succeeded",
      model: "deepseek-v4-flash",
      turns_used: 3,
      max_turns: 15,
      token_in: 100,
      token_out: 200,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:05:00.000Z",
      handoff_md: "Cuu 完成了草稿生成。"
    },
    steps: [],
    evidence_refs: [],
    snapshots: [],
    accepted_deliverables: [],
    merge_timeline: [],
    ...overrides
  } as unknown as ReplayTraceVM;
}

function fakeClient(replay: ReplayTraceVM): Pick<WorkHubApiClient, "replayAgentRun"> {
  return {
    async replayAgentRun() {
      return replay;
    }
  };
}

test("loadDesktopAgentRunReplay forwards to client.replayAgentRun and returns its VM as-is", async () => {
  const replay = minimalReplay();
  const client = fakeClient(replay) as unknown as WorkHubApiClient;

  const result = await loadDesktopAgentRunReplay(client, replay.run.id!);

  assert.equal(result, replay);
});

test("renderDesktopAgentRunReplay renders the desktop surface with locale-correct copy", async () => {
  const client = fakeClient(minimalReplay()) as unknown as WorkHubApiClient;

  const zh = await renderDesktopAgentRunReplay(client, "run-1");
  assert.equal(zh.surface, "desktop");
  assert.equal(zh.html.includes("查看 AI 怎么做的"), true);
  assert.equal(zh.html.includes("Cuu 完成了草稿生成。"), true);

  const en = await renderDesktopAgentRunReplay(client, "run-1", "en-US");
  assert.equal(en.html.includes("See how AI did it"), true);
});

// ── R20 DSK-UX（R19-3）：桌面 replay 撤销接线——从 main.test.ts 原样搬来 ──────────────────────
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

  // 绑定后：桌面挂载点传的正是 client + onReverted 重拉回调（spotlight/views/replay.ts 的
  // renderDetailNow 即此形状）。
  bindDesktopAgentRunReplayRevert(new FakeRevertRoot([button]), client, {
    onReverted: () => reFetched.push(true)
  });
  button.click(); // 武装
  assert.equal(calls.length, 0);
  button.click(); // 执行
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [{ runId: "run-7", payload: { snapshot_id: "snap-1" } }]);
  // 成功后触发重拉——宿主据此重渲快照区，让被撤销的快照翻「已回滚」。
  assert.deepEqual(reFetched, [true]);
});

test("bindDesktopAgentRunReplayRevert is a no-op when the client lacks revertAgentRun", () => {
  const button = new FakeRevertButton({ replayRevertSnapshot: "snap-1", replayRevertRun: "run-7" });
  const dispose = bindDesktopAgentRunReplayRevert(new FakeRevertRoot([button]), {} as unknown as WorkHubApiClient);
  button.click();
  button.click();
  assert.equal(typeof dispose, "function");
  dispose();
});

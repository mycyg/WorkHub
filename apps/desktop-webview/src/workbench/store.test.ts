import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorkbenchStore, initialWorkbenchStoreState } from "./store.js";

test("initialWorkbenchStoreState starts empty with the side panel open and no modal", () => {
  const state = initialWorkbenchStoreState();
  assert.deepEqual(state.projects, []);
  assert.equal(state.projectsLoad, "idle");
  assert.equal(state.selectedProjectId, undefined);
  assert.equal(state.vm, undefined);
  assert.equal(state.sidePanelOpen, true);
  assert.equal(state.newProjectModalOpen, false);
  assert.equal(state.centerTab, "chat");
  assert.equal(state.activeConversationId, undefined);
});

test("setState merges a patch and returns the merged state", () => {
  const store = createWorkbenchStore();
  const next = store.setState({ selectedProjectId: "project-1" });
  assert.equal(next.selectedProjectId, "project-1");
  // 未被 patch 的字段保持不变。
  assert.equal(next.sidePanelOpen, true);
  assert.equal(store.getState().selectedProjectId, "project-1");
});

test("subscribe notifies listeners on every setState call with the latest state", () => {
  const store = createWorkbenchStore();
  const seen: Array<string | undefined> = [];
  const unsubscribe = store.subscribe((state) => {
    seen.push(state.selectedProjectId);
  });

  store.setState({ selectedProjectId: "project-1" });
  store.setState({ selectedProjectId: "project-2" });
  unsubscribe();
  store.setState({ selectedProjectId: "project-3" });

  assert.deepEqual(seen, ["project-1", "project-2"]);
});

test("a listener that unsubscribes itself mid-notification does not break the current dispatch", () => {
  const store = createWorkbenchStore();
  const calls: string[] = [];
  let unsubscribeSelf: () => void = () => {};
  unsubscribeSelf = store.subscribe(() => {
    calls.push("self");
    unsubscribeSelf();
  });
  store.subscribe(() => {
    calls.push("other");
  });

  store.setState({ sidePanelOpen: false });
  assert.deepEqual(calls, ["self", "other"]);

  calls.length = 0;
  store.setState({ sidePanelOpen: true });
  assert.deepEqual(calls, ["other"]);
});

test("createWorkbenchStore accepts initial overrides for tests/deep-link bootstrapping", () => {
  const store = createWorkbenchStore({ selectedProjectId: "seed-project", sidePanelOpen: false });
  assert.equal(store.getState().selectedProjectId, "seed-project");
  assert.equal(store.getState().sidePanelOpen, false);
});

// R12 批 6：一个监听器（比如 shell.ts 的 renderCenter）在自己执行期间同步调用 store.setState
// （比如 driveSidePanel.showIdle()）——这不是假设性场景,shell.ts 真的这样用。没有这个保护时,
// 同一次监听器调用里,setState 之后紧接着的下一行代码（比如 renderCenter 完了接着跑的
// renderSide(state)）还会用上一刻捕获的旧 state 参数，把刚写进去的新内容覆盖回去（JS 函数参数
// 按值绑定，不会因为外层闭包变量被重新赋值就跟着变）。见 store.ts 的 notifying/pendingRenotify 注释。
test("a listener that synchronously calls setState mid-notification does not get overwritten by its own stale continuation", () => {
  const store = createWorkbenchStore();
  const observedByCall: Array<{ tag: string; sidePanelContent: unknown }> = [];
  let reentered = false;

  store.subscribe((state) => {
    observedByCall.push({ tag: "before", sidePanelContent: state.sidePanelContent });
    if (state.centerTab === "drive" && !reentered) {
      reentered = true;
      // 模拟 renderCenter 里同步调 driveSidePanel.showIdle() -> store.setState(...)。
      store.setState({ sidePanelContent: { ownerId: "drive", html: "IDLE_HTML" } });
    }
    // 模拟同一个监听器函数体里，setState 调用之后还会继续跑的代码（renderSide(state)）——
    // 这里用的还是这次 listener 调用一开始拿到的 state 参数，不是重入之后的新值。
    observedByCall.push({ tag: "after", sidePanelContent: state.sidePanelContent });
  });

  store.setState({ centerTab: "drive" });

  // 修复前：最后一次 "after" 观测到的是 undefined（被旧快照覆盖）。修复后：一定有一次干净的、
  // 完全体现最新 state 的监听器调用（before 和 after 都带着 IDLE_HTML），不存在半新半旧的撕裂状态。
  const cleanPass = observedByCall.filter(
    (entry) => (entry.sidePanelContent as { html?: string } | undefined)?.html === "IDLE_HTML"
  );
  assert.ok(cleanPass.length >= 2, "must see at least one before+after pair with the fully-merged state");
  assert.deepEqual(store.getState().sidePanelContent, { ownerId: "drive", html: "IDLE_HTML" });
});

test("nested setState calls during notification do not cause infinite recursion or duplicate unrelated dispatches", () => {
  const store = createWorkbenchStore();
  let calls = 0;
  let nested = false;
  store.subscribe(() => {
    calls += 1;
    if (!nested) {
      nested = true;
      store.setState({ sidePanelOpen: false });
    }
  });

  store.setState({ centerTab: "drive" });

  // 一次外层 setState + 一次内层重入触发的补发 = 恰好 2 次监听器调用，不是无限递归也不是丢通知。
  assert.equal(calls, 2);
});

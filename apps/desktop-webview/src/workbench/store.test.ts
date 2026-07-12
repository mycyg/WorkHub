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

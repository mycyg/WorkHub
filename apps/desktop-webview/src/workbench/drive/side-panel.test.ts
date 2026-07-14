import assert from "node:assert/strict";
import { test } from "node:test";

import { decideRollbackConfirmation } from "./side-panel.js";

// R14（网盘回滚两端对齐）：mountDriveSidePanel 本身没有直接单测——这个 workspace 的测试运行器没有
// 真实 DOM（node --import tsx --test，无 jsdom；见 chat/view.test.ts 顶部注释同款先例），它的
// sideBodyEl.addEventListener 点击处理器里有 `event.target instanceof HTMLElement` 这种运行时 DOM
// 全局判断，在这里跑会直接 ReferenceError。所以把两段式确认的判定拆成一个不碰任何 DOM/网络的纯函数
// （decideRollbackConfirmation），单独把它的分支逻辑钉死——这正是回滚从「一点就发请求」改成「先武装、
// 再点一次才执行」的核心契约。

test("decideRollbackConfirmation arms an un-armed version instead of executing it", () => {
  assert.deepEqual(decideRollbackConfirmation(undefined, "v1"), { kind: "arm", versionId: "v1" });
});

test("decideRollbackConfirmation executes when the same version is clicked a second time", () => {
  assert.deepEqual(decideRollbackConfirmation("v1", "v1"), { kind: "execute", versionId: "v1" });
});

test("decideRollbackConfirmation re-arms a different version instead of executing the previously armed one", () => {
  assert.deepEqual(decideRollbackConfirmation("v1", "v2"), { kind: "arm", versionId: "v2" });
});

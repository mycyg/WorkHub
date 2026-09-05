import assert from "node:assert/strict";
import { test } from "node:test";

import { decideDriveDeleteConfirmation, driveViewDeletedItems } from "./view.js";

// R20 DSK-UX（R19-23）：mountDriveView 本身没有直接单测——这个 workspace 的测试运行器没有真实 DOM
// （node --import tsx --test，无 jsdom；见 side-panel.test.ts / chat/view.test.ts 顶部同款注释）。所以把
// 删除两段式确认的判定抽成不碰 DOM 的纯函数（decideDriveDeleteConfirmation），单独把它的分支钉死——
// 这正是删除从「一点即删」改成「先武装、再点一次才执行」的核心契约。

test("decideDriveDeleteConfirmation arms an un-armed item instead of deleting it", () => {
  assert.deepEqual(decideDriveDeleteConfirmation(undefined, "file-1"), { kind: "arm", itemId: "file-1" });
});

test("decideDriveDeleteConfirmation deletes when the same item is clicked a second time", () => {
  assert.deepEqual(decideDriveDeleteConfirmation("file-1", "file-1"), { kind: "execute", itemId: "file-1" });
});

test("decideDriveDeleteConfirmation re-arms a different item instead of deleting the previously armed one", () => {
  assert.deepEqual(decideDriveDeleteConfirmation("file-1", "file-2"), { kind: "arm", itemId: "file-2" });
});

test("driveViewDeletedItems tolerates VMs from older servers that lack deleted_items (MRG-28)", () => {
  assert.deepEqual(driveViewDeletedItems({}), []);
  assert.deepEqual(driveViewDeletedItems({ deleted_items: undefined }), []);
  const item = { id: "file-1" };
  assert.deepEqual(driveViewDeletedItems({ deleted_items: [item] as never }), [item]);
});

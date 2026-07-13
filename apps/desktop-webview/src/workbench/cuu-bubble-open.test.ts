import assert from "node:assert/strict";
import { test } from "node:test";

import { openWorkbenchRouteFromPet } from "./cuu-bubble-open.js";
import type { PendingWorkbenchDeepLinkTarget } from "./pending-deep-link.js";

test("openWorkbenchRouteFromPet degrades gracefully to false when no Tauri invoke is available", async () => {
  const opened = await openWorkbenchRouteFromPet({ projectId: "project-1" }, { scope: {} });
  assert.equal(opened, false);
});

test("openWorkbenchRouteFromPet stashes the pending deep link before invoking open_workbench (cold-start race guard)", async () => {
  const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const stashed: PendingWorkbenchDeepLinkTarget[] = [];
  const order: string[] = [];

  const opened = await openWorkbenchRouteFromPet(
    { projectId: "project-1", conversationId: "conv-1" },
    {
      invoke: (command, args) => {
        order.push("invoke");
        calls.push({ command, args });
        return Promise.resolve();
      },
      stash: (target) => {
        order.push("stash");
        stashed.push(target);
      }
    }
  );

  assert.equal(opened, true);
  assert.deepEqual(order, ["stash", "invoke"]);
  assert.deepEqual(stashed, [{ projectId: "project-1", conversationId: "conv-1" }]);
  assert.deepEqual(calls, [{ command: "open_workbench", args: { projectId: "project-1", conversationId: "conv-1" } }]);
});

test("openWorkbenchRouteFromPet omits conversationId from the invoke payload and stash when absent", async () => {
  const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const stashed: PendingWorkbenchDeepLinkTarget[] = [];

  await openWorkbenchRouteFromPet(
    { projectId: "project-1" },
    {
      invoke: (command, args) => {
        calls.push({ command, args });
        return Promise.resolve();
      },
      stash: (target) => stashed.push(target)
    }
  );

  assert.deepEqual(stashed, [{ projectId: "project-1" }]);
  assert.deepEqual(calls, [{ command: "open_workbench", args: { projectId: "project-1" } }]);
});

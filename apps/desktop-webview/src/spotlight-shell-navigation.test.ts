import { strict as assert } from "node:assert";
import { test } from "node:test";

import { handleDesktopSpotlightShellNavigate } from "./spotlight-shell-navigation.js";

test("production Spotlight shell navigate saves project context before opening a capability", () => {
  const projectId = "10000000-0000-4000-8000-000000000002";
  const route = `/drive?project_id=${projectId}`;
  const savedRoutes: string[] = [];
  const opened: Array<{ id: string; target?: { id?: string; route?: string } }> = [];
  let resetCount = 0;

  const result = handleDesktopSpotlightShellNavigate(
    { route },
    {
      saveProjectContextFromRoute: (nextRoute) => {
        savedRoutes.push(nextRoute);
      },
      spotlight: {
        openCapability(id, target) {
          opened.push(target ? { id, target } : { id });
        },
        reset() {
          resetCount += 1;
        }
      }
    }
  );

  assert.deepEqual(savedRoutes, [route]);
  assert.deepEqual(opened, [{ id: "drive", target: { id: projectId, route } }]);
  assert.equal(resetCount, 0);
  assert.equal(result.kind, "open");
});

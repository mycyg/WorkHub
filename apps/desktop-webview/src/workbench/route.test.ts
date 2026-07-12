import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isWorkbenchWindowControlPlan,
  parseWorkbenchDeepLinkPlan,
  parseWorkbenchRoute,
  type WorkbenchDeepLinkPlan
} from "./route.js";

test("parseWorkbenchRoute returns an empty context for the bare /workbench route", () => {
  assert.deepEqual(parseWorkbenchRoute("/workbench"), {});
});

test("parseWorkbenchRoute extracts the project id from /workbench/<projectId>", () => {
  assert.deepEqual(parseWorkbenchRoute("/workbench/86000000-0000-4000-8000-000000000001"), {
    projectId: "86000000-0000-4000-8000-000000000001"
  });
});

test("parseWorkbenchRoute extracts project and conversation ids from the full route", () => {
  assert.deepEqual(
    parseWorkbenchRoute("/workbench/86000000-0000-4000-8000-000000000001/86000000-0000-4000-8000-000000000002"),
    {
      projectId: "86000000-0000-4000-8000-000000000001",
      conversationId: "86000000-0000-4000-8000-000000000002"
    }
  );
});

test("parseWorkbenchRoute ignores routes that target other windows/capabilities", () => {
  assert.equal(parseWorkbenchRoute("/workitems/86000000-0000-4000-8000-000000000001"), undefined);
  assert.equal(parseWorkbenchRoute("/approvals"), undefined);
  assert.equal(parseWorkbenchRoute("/workbenchwrong"), undefined);
});

test("parseWorkbenchRoute tolerates a trailing slash without inventing an empty conversation id", () => {
  assert.deepEqual(parseWorkbenchRoute("/workbench/project-1/"), { projectId: "project-1" });
});

function deepLinkPayload(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    rawUrl: "workhub://workbench/project-1",
    scheme: "workhub",
    route: "/workbench/project-1",
    windowControl: {
      label: "workbench",
      action: "show_and_focus",
      source: "deep_link",
      focus: true,
      reason: "deep_link"
    },
    ...overrides
  };
}

test("parseWorkbenchDeepLinkPlan accepts a well-formed Rust ShellDeepLinkPlan payload", () => {
  const plan = parseWorkbenchDeepLinkPlan(deepLinkPayload());
  assert.ok(plan);
  assert.equal(plan?.route, "/workbench/project-1");
  assert.equal(plan?.windowControl.label, "workbench");
  assert.equal(plan?.windowControl.action, "show_and_focus");
});

test("parseWorkbenchDeepLinkPlan passes through an optional windowControl.route", () => {
  const plan = parseWorkbenchDeepLinkPlan(
    deepLinkPayload({
      windowControl: {
        label: "main",
        action: "show_and_focus",
        source: "deep_link",
        focus: true,
        reason: "deep_link",
        route: "/approvals"
      }
    })
  );
  assert.equal(plan?.windowControl.route, "/approvals");
});

test("parseWorkbenchDeepLinkPlan rejects malformed payloads instead of guessing", () => {
  assert.equal(parseWorkbenchDeepLinkPlan(undefined), undefined);
  assert.equal(parseWorkbenchDeepLinkPlan(null), undefined);
  assert.equal(parseWorkbenchDeepLinkPlan("workhub://workbench"), undefined);
  assert.equal(parseWorkbenchDeepLinkPlan({}), undefined);
  assert.equal(parseWorkbenchDeepLinkPlan(deepLinkPayload({ route: undefined })), undefined);
  assert.equal(parseWorkbenchDeepLinkPlan(deepLinkPayload({ windowControl: undefined })), undefined);
  assert.equal(
    parseWorkbenchDeepLinkPlan(deepLinkPayload({ windowControl: { label: "workbench" } })),
    undefined
  );
  assert.equal(
    parseWorkbenchDeepLinkPlan(
      deepLinkPayload({
        windowControl: {
          label: "workbench",
          action: "not-a-real-action",
          source: "deep_link",
          focus: true,
          reason: "deep_link"
        }
      })
    ),
    undefined
  );
});

test("isWorkbenchWindowControlPlan only matches plans targeting the workbench window", () => {
  const workbenchPlan = parseWorkbenchDeepLinkPlan(deepLinkPayload()) as WorkbenchDeepLinkPlan;
  assert.equal(isWorkbenchWindowControlPlan(workbenchPlan), true);

  const mainPlan = parseWorkbenchDeepLinkPlan(
    deepLinkPayload({
      route: "/approvals",
      windowControl: {
        label: "main",
        action: "show_and_focus",
        source: "deep_link",
        focus: true,
        reason: "deep_link"
      }
    })
  ) as WorkbenchDeepLinkPlan;
  assert.equal(isWorkbenchWindowControlPlan(mainPlan), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  actionErrorNotice,
  actionPendingNotice,
  actionSuccessNotice,
  desktopRequiredNotice,
  dirtyGuardRefreshAction,
  fieldValueRequiredNotice,
  intakeOptionRequiredNotice,
  localePersistenceFailedNotice,
  mergeConflictNotice,
  reasonRequiredNotice,
  selectionNotice,
  sseDirtyGuardNotice,
  sseRefreshNotice
} from "./notice.js";

test("R4.21 notice factories produce structured bilingual QA hooks", () => {
  assert.equal(actionSuccessNotice("en-US", "Done", "approve").kind, "action_success");
  assert.equal(actionErrorNotice("zh-CN", new Error("失败"), "merge").tone, "danger");
  assert.equal(actionPendingNotice("en-US").source, "client");
  assert.equal(desktopRequiredNotice("zh-CN").kind, "desktop_required");
  assert.equal(reasonRequiredNotice("en-US").kind, "reason_required");
  assert.equal(fieldValueRequiredNotice("en-US").kind, "field_value_required");
  assert.equal(intakeOptionRequiredNotice("zh-CN").kind, "intake_option_required");
  assert.equal(localePersistenceFailedNotice("en-US").kind, "locale_persistence_failed");
  assert.equal(selectionNotice("en-US", "Risk first").actionId, "select_option");
  assert.equal(mergeConflictNotice("zh-CN", "merge").actionId, "merge");
  assert.equal(sseDirtyGuardNotice("en-US", "proposal.merged", "proposal").kind, "sse_dirty_guard");
});

test("R4.21 SSE notice classifies budget warning separately", () => {
  assert.equal(sseRefreshNotice("en-US", "budget.warning", "me").kind, "budget_warning");
  assert.equal(sseRefreshNotice("en-US", "proposal.merged", "proposal").kind, "sse_refresh");
});

test("R4.21 dirty guard refresh action escapes href and label", () => {
  const html = dirtyGuardRefreshAction("en-US", "/proposals/p-1?x=<bad>");
  assert.match(html, /data-r4-dirty-refresh="true"/u);
  assert.match(html, /\/proposals\/p-1\?x=&lt;bad&gt;/u);
});

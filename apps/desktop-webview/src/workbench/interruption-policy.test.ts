import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyWorkbenchInterruptionCategory,
  createWorkbenchBubbleMergeThrottle,
  createWorkbenchNotificationDeduper,
  decideWorkbenchInterruption,
  extractWorkbenchDeepLinkTarget,
  type WorkbenchInterruptionCategory,
  type WorkbenchInterruptionOutcome
} from "./interruption-policy.js";

const CATEGORIES: readonly WorkbenchInterruptionCategory[] = ["message", "action_card", "dispatch_ask", "proposal"];

// 核心交付:打扰矩阵全组合(2 前台态 × 4 事件类别 = 8 条),照 00 §8——正看着的会话=窗内不打扰;
// 没看着=行动卡/派活问询/提议气泡,普通聊天消息静默(大流量群聊不能条条弹气泡)。
test("decideWorkbenchInterruption covers the full 2x4 interruption matrix", () => {
  const expected: Record<WorkbenchInterruptionCategory, WorkbenchInterruptionOutcome> = {
    message: "silent",
    action_card: "cuu_bubble",
    dispatch_ask: "cuu_bubble",
    proposal: "cuu_bubble"
  };

  for (const category of CATEGORIES) {
    assert.equal(
      decideWorkbenchInterruption({ isForegroundAndWatching: true, category }),
      "in_window",
      `${category} must render in-window when the workbench is foreground and watching`
    );
    assert.equal(
      decideWorkbenchInterruption({ isForegroundAndWatching: false, category }),
      expected[category],
      `${category} unwatched outcome mismatch`
    );
  }
});

test("decideWorkbenchInterruption always prefers in_window over bubbling, even for high-signal categories", () => {
  // 正看着这个会话时,行动卡/派活/提议也不该在气泡里重复冒一遍——已经在窗内看到了。
  assert.equal(decideWorkbenchInterruption({ isForegroundAndWatching: true, category: "dispatch_ask" }), "in_window");
  assert.equal(decideWorkbenchInterruption({ isForegroundAndWatching: true, category: "proposal" }), "in_window");
});

test("classifyWorkbenchInterruptionCategory recognizes conversation event types", () => {
  assert.equal(
    classifyWorkbenchInterruptionCategory({ eventType: "conversation.message.created" }),
    "message"
  );
  assert.equal(
    classifyWorkbenchInterruptionCategory({ eventType: "conversation.action_card.updated" }),
    "action_card"
  );
});

test("classifyWorkbenchInterruptionCategory recognizes proposal-flavored event types", () => {
  for (const eventType of ["proposal.opened", "proposal.reviewed", "proposal.merged", "revision.fedback"]) {
    assert.equal(classifyWorkbenchInterruptionCategory({ eventType }), "proposal", eventType);
  }
});

test("classifyWorkbenchInterruptionCategory recognizes the dispatch_ask notification type over event type", () => {
  assert.equal(
    classifyWorkbenchInterruptionCategory({
      eventType: "notification.created",
      notificationType: "action_card_item.dispatch_ask"
    }),
    "dispatch_ask"
  );
});

test("classifyWorkbenchInterruptionCategory recognizes proposal-flavored notification types", () => {
  assert.equal(
    classifyWorkbenchInterruptionCategory({ eventType: "notification.created", notificationType: "proposal.reviewed" }),
    "proposal"
  );
});

test("classifyWorkbenchInterruptionCategory returns undefined for unrelated event/notification types", () => {
  assert.equal(classifyWorkbenchInterruptionCategory({}), undefined);
  assert.equal(classifyWorkbenchInterruptionCategory({ eventType: "budget.warning" }), undefined);
  assert.equal(
    classifyWorkbenchInterruptionCategory({ eventType: "notification.created", notificationType: "system.health" }),
    undefined
  );
});

test("extractWorkbenchDeepLinkTarget reads project/conversation ids from a WorkHubEvent-shaped envelope", () => {
  const target = extractWorkbenchDeepLinkTarget({
    event_id: "evt-1",
    type: "conversation.action_card.updated",
    project_id: "project-1",
    data: { conversation_id: "conv-1" }
  });
  assert.deepEqual(target, { projectId: "project-1", conversationId: "conv-1" });
});

test("extractWorkbenchDeepLinkTarget reads project id only from a Notification-row-shaped payload", () => {
  const target = extractWorkbenchDeepLinkTarget({
    id: "n1",
    type: "action_card_item.dispatch_ask",
    project_id: "project-2",
    work_item_id: "work-1"
  });
  assert.deepEqual(target, { projectId: "project-2" });
});

test("extractWorkbenchDeepLinkTarget tolerates camelCase field names", () => {
  const target = extractWorkbenchDeepLinkTarget({ projectId: "project-3", data: { conversationId: "conv-3" } });
  assert.deepEqual(target, { projectId: "project-3", conversationId: "conv-3" });
});

test("extractWorkbenchDeepLinkTarget returns an empty object for null/non-object/missing fields — never invents ids", () => {
  assert.deepEqual(extractWorkbenchDeepLinkTarget(null), {});
  assert.deepEqual(extractWorkbenchDeepLinkTarget("not an object"), {});
  assert.deepEqual(extractWorkbenchDeepLinkTarget({}), {});
  assert.deepEqual(extractWorkbenchDeepLinkTarget({ project_id: "" }), {});
});

test("createWorkbenchBubbleMergeThrottle surfaces the first bubble in a 60s window and merges the rest", () => {
  let clock = 0;
  const throttle = createWorkbenchBubbleMergeThrottle({ now: () => clock });

  const first = throttle.evaluate("conversation-1");
  assert.deepEqual(first, { surface: true, mergedCount: 1 });

  clock += 10_000;
  const second = throttle.evaluate("conversation-1");
  assert.deepEqual(second, { surface: false, mergedCount: 2 });

  clock += 20_000;
  const third = throttle.evaluate("conversation-1");
  assert.deepEqual(third, { surface: false, mergedCount: 3 });
});

test("createWorkbenchBubbleMergeThrottle opens a fresh window once the previous one expires", () => {
  let clock = 0;
  const throttle = createWorkbenchBubbleMergeThrottle({ now: () => clock, windowMs: 60_000 });

  assert.deepEqual(throttle.evaluate("conversation-1"), { surface: true, mergedCount: 1 });
  clock += 60_000; // exactly at the boundary — no longer "within" the window (< check)
  assert.deepEqual(throttle.evaluate("conversation-1"), { surface: true, mergedCount: 1 });
});

test("createWorkbenchBubbleMergeThrottle tracks separate groups (conversations) independently", () => {
  let clock = 0;
  const throttle = createWorkbenchBubbleMergeThrottle({ now: () => clock });

  assert.deepEqual(throttle.evaluate("conversation-a"), { surface: true, mergedCount: 1 });
  assert.deepEqual(throttle.evaluate("conversation-b"), { surface: true, mergedCount: 1 });
  clock += 1000;
  assert.deepEqual(throttle.evaluate("conversation-a"), { surface: false, mergedCount: 2 });
  assert.deepEqual(throttle.evaluate("conversation-b"), { surface: false, mergedCount: 2 });
});

test("createWorkbenchBubbleMergeThrottle reset() clears a single group or the whole map", () => {
  let clock = 0;
  const throttle = createWorkbenchBubbleMergeThrottle({ now: () => clock });

  throttle.evaluate("conversation-a");
  throttle.evaluate("conversation-b");
  throttle.reset("conversation-a");
  assert.deepEqual(throttle.evaluate("conversation-a"), { surface: true, mergedCount: 1 });
  assert.deepEqual(throttle.evaluate("conversation-b"), { surface: false, mergedCount: 2 });

  throttle.reset();
  assert.deepEqual(throttle.evaluate("conversation-b"), { surface: true, mergedCount: 1 });
});

test("createWorkbenchNotificationDeduper delivers an id once and drops repeats", () => {
  const deduper = createWorkbenchNotificationDeduper();
  assert.equal(deduper.shouldDeliver("n1"), true);
  assert.equal(deduper.shouldDeliver("n1"), false);
  assert.equal(deduper.shouldDeliver("n2"), true);
});

test("createWorkbenchNotificationDeduper evicts the oldest key once the cap is exceeded (FIFO)", () => {
  const deduper = createWorkbenchNotificationDeduper({ maxKeys: 2 });
  assert.equal(deduper.shouldDeliver("a"), true); // order: [a]
  assert.equal(deduper.shouldDeliver("b"), true); // order: [a, b]
  assert.equal(deduper.shouldDeliver("c"), true); // evicts "a" — order: [b, c]
  assert.equal(deduper.shouldDeliver("a"), true); // "a" was evicted, delivers again — evicts "b" — order: [c, a]
  assert.equal(deduper.shouldDeliver("c"), false); // "c" is still remembered
  assert.equal(deduper.shouldDeliver("b"), true); // "b" was evicted two steps ago, delivers again
});

test("createWorkbenchNotificationDeduper with maxKeys 0 disables dedupe entirely (always delivers)", () => {
  const deduper = createWorkbenchNotificationDeduper({ maxKeys: 0 });
  assert.equal(deduper.shouldDeliver("n1"), true);
  assert.equal(deduper.shouldDeliver("n1"), true);
});

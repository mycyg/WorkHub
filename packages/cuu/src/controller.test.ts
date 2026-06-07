import assert from "node:assert/strict";
import test from "node:test";

import { createCuuController, defaultCuuControllerPreferences } from "./controller.js";
import { cuuMotionForState, type CuuCard } from "./index.js";

function card(input: {
  id: string;
  priority: CuuCard["priority"];
  state: CuuCard["state"];
  title?: string;
}): CuuCard {
  return {
    id: input.id,
    kind: "bubble",
    state: input.state,
    motion: cuuMotionForState(input.state),
    title: input.title ?? input.id,
    message: "Cuu 收到一条桌宠提醒。",
    priority: input.priority,
    actions: []
  };
}

test("Cuu controller replaces lower priority notices and promotes queued cards", () => {
  const controller = createCuuController();
  const normal = card({ id: "normal", priority: "normal", state: "thinking" });
  const urgent = card({ id: "urgent", priority: "urgent", state: "asking_approval" });
  const low = card({ id: "low", priority: "low", state: "idle" });

  const first = controller.enqueue(normal);
  const second = controller.enqueue(urgent);
  const third = controller.enqueue(low);

  assert.equal(first.outcome, "show");
  assert.equal(first.presentation.surface, "notice");
  assert.equal(first.presentation.play_motion, true);
  assert.equal(second.outcome, "replace");
  assert.equal(second.replaced_card?.id, "normal");
  assert.equal(second.snapshot.active_card?.id, "urgent");
  assert.deepEqual(second.snapshot.queue.map((item) => item.id), ["normal"]);
  assert.equal(second.presentation.play_sound, true);
  assert.equal(third.outcome, "badge");
  assert.equal(third.reason, "low_priority_badge");
  assert.equal(third.snapshot.badge_count, 1);

  const dismissed = controller.dismiss("urgent");

  assert.equal(dismissed.outcome, "show");
  assert.equal(dismissed.reason, "dismissed_current");
  assert.equal(dismissed.card?.id, "normal");
  assert.equal(dismissed.snapshot.queue.length, 0);
});

test("Cuu controller turns quiet and do-not-disturb interruptions into badges", () => {
  const quiet = createCuuController({ preferences: { attention_mode: "quiet" } });
  const dnd = createCuuController({ preferences: { attention_mode: "do_not_disturb" } });

  const quietNormal = quiet.enqueue(card({ id: "quiet-normal", priority: "normal", state: "thinking" }));
  const quietUrgent = quiet.enqueue(card({ id: "quiet-urgent", priority: "urgent", state: "asking_approval" }));
  const dndUrgent = dnd.enqueue(card({ id: "dnd-urgent", priority: "urgent", state: "asking_approval" }));

  assert.equal(quietNormal.outcome, "badge");
  assert.equal(quietNormal.reason, "quiet_mode_badge");
  assert.equal(quietUrgent.outcome, "show");
  assert.equal(quietUrgent.presentation.os_notification, true);
  assert.equal(dndUrgent.outcome, "badge");
  assert.equal(dndUrgent.reason, "do_not_disturb_badge");
  assert.equal(dndUrgent.presentation.os_notification, true);
  assert.equal(dnd.snapshot().active_card, undefined);
  assert.equal(dnd.snapshot().badges[0]?.id, "dnd-urgent");

  const promoted = dnd.dismiss();

  assert.equal(promoted.outcome, "show");
  assert.equal(promoted.reason, "promoted_badge");
  assert.equal(promoted.card?.id, "dnd-urgent");
  assert.equal(promoted.snapshot.badge_count, 0);
});

test("Cuu controller drops duplicates and respects queue limits", () => {
  const controller = createCuuController({ preferences: { queue_limit: 1 } });

  controller.enqueue(card({ id: "active", priority: "normal", state: "thinking" }));
  const duplicate = controller.enqueue(card({ id: "active", priority: "high", state: "worried" }));
  const queued = controller.enqueue(card({ id: "queued", priority: "normal", state: "syncing_files" }));
  const overflow = controller.enqueue(card({ id: "overflow", priority: "normal", state: "searching_evidence" }));

  assert.equal(duplicate.outcome, "drop");
  assert.equal(duplicate.reason, "duplicate_dropped");
  assert.equal(queued.outcome, "queue");
  assert.equal(overflow.outcome, "queue");
  assert.equal(overflow.reason, "queue_overflow_dropped");
  assert.equal(overflow.dropped_card?.id, "queued");
  assert.deepEqual(controller.snapshot().queue.map((item) => item.id), ["overflow"]);
});

test("Cuu controller can disable motion and sound without changing visual notices", () => {
  const controller = createCuuController({
    preferences: {
      reduced_motion: true,
      sound_mode: "muted"
    }
  });
  const decision = controller.enqueue(card({ id: "approval", priority: "urgent", state: "asking_approval" }));

  assert.equal(decision.outcome, "show");
  assert.equal(decision.presentation.surface, "notice");
  assert.equal(decision.presentation.play_motion, false);
  assert.equal(decision.presentation.play_sound, false);
  assert.equal(decision.presentation.timeout_ms, 12000);
});

test("Cuu controller normalizes desktop pet window preferences", () => {
  assert.deepEqual(defaultCuuControllerPreferences(), {
    attention_mode: "normal",
    sound_mode: "on",
    reduced_motion: false,
    queue_limit: 5,
    pet_scale_percent: 100,
    pet_opacity_percent: 100,
    pet_pass_through: false,
    pet_hide_on_hover: false
  });

  const controller = createCuuController({
    preferences: {
      pet_scale_percent: 125,
      pet_opacity_percent: 80,
      pet_pass_through: true,
      pet_hide_on_hover: true
    }
  });

  assert.equal(controller.snapshot().preferences.pet_scale_percent, 125);
  assert.equal(controller.snapshot().preferences.pet_opacity_percent, 80);
  assert.equal(controller.snapshot().preferences.pet_pass_through, true);
  assert.equal(controller.snapshot().preferences.pet_hide_on_hover, true);

  const normalized = controller.setPreferences({
    pet_scale_percent: 111 as 100,
    pet_opacity_percent: 42 as 100,
    pet_pass_through: false,
    pet_hide_on_hover: false
  });

  assert.equal(normalized.preferences.pet_scale_percent, 100);
  assert.equal(normalized.preferences.pet_opacity_percent, 100);
  assert.equal(normalized.preferences.pet_pass_through, false);
  assert.equal(normalized.preferences.pet_hide_on_hover, false);
});

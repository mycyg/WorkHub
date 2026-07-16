import assert from "node:assert/strict";
import test from "node:test";

import type { NotificationRepository, UserAuthRow } from "@workhub/db";

import { CARE_MESSAGE_MUTE_TYPE, createNotificationService } from "./notifications.js";

const userId = "90000000-0000-4000-8000-0000000000aa";

// 有状态的假 users 仓库：getMuted 读、setMuted 覆盖写并回传新行。
function statefulUsers(initial: string[] = []) {
  let stored = [...initial];
  return {
    repo: {
      async getMutedNotificationTypes() {
        return [...stored];
      },
      async setMutedNotificationTypes(_id: string, types: string[]) {
        stored = [...types];
        return { mutedNotificationTypes: stored } as unknown as UserAuthRow;
      }
    },
    current: () => [...stored]
  };
}

function serviceWith(users: ReturnType<typeof statefulUsers>) {
  return createNotificationService({
    notifications: {} as unknown as NotificationRepository,
    users: users.repo
  });
}

test("care opt-out: getPreferences defaults care_messages_enabled to true with no muted entries", async () => {
  const users = statefulUsers([]);
  const prefs = await serviceWith(users).getPreferences(userId);
  assert.deepEqual(prefs, { muted_notification_types: [], care_messages_enabled: true });
});

test("care opt-out: the care pseudo-type is stripped from the visible muted list and surfaced as care_messages_enabled=false", async () => {
  const users = statefulUsers(["workitem.escalated", CARE_MESSAGE_MUTE_TYPE]);
  const prefs = await serviceWith(users).getPreferences(userId);
  assert.deepEqual(prefs.muted_notification_types, ["workitem.escalated"], "care.message must not leak into the visible list");
  assert.equal(prefs.care_messages_enabled, false);
});

test("care opt-out: setPreferences care_messages_enabled=false persists the pseudo-type", async () => {
  const users = statefulUsers([]);
  const service = serviceWith(users);
  const data = await service.setPreferences(userId, [], { careMessagesEnabled: false });
  assert.equal(data.care_messages_enabled, false);
  assert.deepEqual(data.muted_notification_types, []);
  assert.ok(users.current().includes(CARE_MESSAGE_MUTE_TYPE), "pseudo-type is persisted so care-scan skips this user");
});

test("care opt-out: re-enabling care removes the pseudo-type", async () => {
  const users = statefulUsers([CARE_MESSAGE_MUTE_TYPE]);
  const service = serviceWith(users);
  const data = await service.setPreferences(userId, [], { careMessagesEnabled: true });
  assert.equal(data.care_messages_enabled, true);
  assert.ok(!users.current().includes(CARE_MESSAGE_MUTE_TYPE));
});

test("care opt-out: a preferences write that omits care_messages_enabled preserves the existing care state", async () => {
  const users = statefulUsers([CARE_MESSAGE_MUTE_TYPE]); // 已关掉关怀
  const service = serviceWith(users);
  // 用户只想静音一个通知类型，没碰关怀开关 → 关怀仍应保持关闭。
  const data = await service.setPreferences(userId, ["comment.mention"]);
  assert.equal(data.care_messages_enabled, false, "care opt-out must survive an unrelated preferences save");
  assert.deepEqual(data.muted_notification_types, ["comment.mention"]);
  assert.ok(users.current().includes(CARE_MESSAGE_MUTE_TYPE));
});

test("care opt-out: setPreferences ignores a care pseudo-type smuggled into the visible list, using only the boolean", async () => {
  const users = statefulUsers([]);
  const service = serviceWith(users);
  // 可见清单里混入伪类型但显式开启关怀 → 伪类型不被持久化。
  const data = await service.setPreferences(userId, [CARE_MESSAGE_MUTE_TYPE, "workitem.escalated"], { careMessagesEnabled: true });
  assert.equal(data.care_messages_enabled, true);
  assert.deepEqual(data.muted_notification_types, ["workitem.escalated"]);
  assert.ok(!users.current().includes(CARE_MESSAGE_MUTE_TYPE));
});

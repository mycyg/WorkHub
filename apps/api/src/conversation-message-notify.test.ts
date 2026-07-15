import assert from "node:assert/strict";
import test from "node:test";

import {
  notifyConversationMessage,
  type ConversationMessageNotifyDeps,
  type ConversationMessageNotifyInput
} from "./services/conversation-message-notify.js";

const conversationId = "40000000-0000-4000-8000-000000000001";
const projectId = "40000000-0000-4000-8000-000000000002";
const alice = "40000000-0000-4000-8000-00000000000a";
const bob = "40000000-0000-4000-8000-00000000000b";
const carol = "40000000-0000-4000-8000-00000000000c";

type NotifyCall = Parameters<
  ConversationMessageNotifyDeps["notifications"]["createConversationMessageNotification"]
>[0];

function harness(
  overrides: {
    participants?: string[];
    unread?: Map<string, number> | (() => Promise<Map<string, number>>);
    viewing?: Set<string>;
    isViewingThrows?: boolean;
  } = {}
) {
  const created: NotifyCall[] = [];
  const deps: ConversationMessageNotifyDeps = {
    repository: {
      async listParticipantUserIds() {
        return overrides.participants ?? [alice, bob, carol];
      },
      async unreadCountsForRecipients() {
        if (typeof overrides.unread === "function") {
          return overrides.unread();
        }
        return overrides.unread ?? new Map();
      }
    },
    presence: {
      async isViewingConversation(userId) {
        if (overrides.isViewingThrows) {
          throw new Error("presence down");
        }
        return overrides.viewing?.has(userId) ?? false;
      }
    },
    notifications: {
      async createConversationMessageNotification(input) {
        created.push(input);
        return null;
      }
    },
    logger: { warn() {} }
  };
  return { deps, created };
}

const baseInput: ConversationMessageNotifyInput = {
  conversationId,
  projectId,
  conversationTitle: "设计讨论",
  senderUserId: alice,
  senderLabel: "Alice",
  messageKind: "text",
  previewText: "看下这版稿"
};

test("A5 notifies every other participant but never the sender", async () => {
  const { deps, created } = harness({ participants: [alice, bob, carol], unread: new Map([[bob, 2], [carol, 1]]) });
  await notifyConversationMessage(deps, baseInput);
  const recipients = created.map((call) => call.userId).sort();
  assert.deepEqual(recipients, [bob, carol].sort());
  assert.equal(created.find((c) => c.userId === alice), undefined, "sender must not be notified");
  assert.equal(created.find((c) => c.userId === bob)?.unreadCount, 2);
});

test("A5 Cuu messages (null sender) notify all participants", async () => {
  const { deps, created } = harness({ participants: [alice, bob] });
  await notifyConversationMessage(deps, { ...baseInput, senderUserId: null, senderLabel: "Cuu" });
  assert.deepEqual(created.map((c) => c.userId).sort(), [alice, bob].sort());
});

test("A5 suppresses the durable notification for a recipient actively viewing the conversation", async () => {
  const { deps, created } = harness({ participants: [alice, bob, carol], viewing: new Set([bob]) });
  await notifyConversationMessage(deps, baseInput);
  // bob 正在看 → 抑制；carol 不在看 → 落通知。sender alice 恒不发。
  assert.deepEqual(created.map((c) => c.userId), [carol]);
});

test("A5 fails open (still notifies) when the presence check throws", async () => {
  const { deps, created } = harness({ participants: [alice, bob], isViewingThrows: true });
  await notifyConversationMessage(deps, baseInput);
  assert.deepEqual(created.map((c) => c.userId), [bob], "presence hiccup must not drop the notification");
});

test("A5 does not notify for non-message kinds (tool_note / system_event)", async () => {
  for (const messageKind of ["tool_note", "system_event"]) {
    const { deps, created } = harness();
    await notifyConversationMessage(deps, { ...baseInput, messageKind });
    assert.equal(created.length, 0, `${messageKind} must not generate a message notification`);
  }
});

test("A5 defaults the unread count to 1 when the aggregate is unavailable", async () => {
  const { deps, created } = harness({
    participants: [alice, bob],
    unread: async () => {
      throw new Error("aggregate down");
    }
  });
  await notifyConversationMessage(deps, baseInput);
  assert.equal(created.find((c) => c.userId === bob)?.unreadCount, 1);
});

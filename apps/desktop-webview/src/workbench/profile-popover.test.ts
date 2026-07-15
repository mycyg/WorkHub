import assert from "node:assert/strict";
import { test } from "node:test";

import type { DmListItemVM, WorkbenchPageVM } from "@workhub/contracts";

import {
  profileTargetFor,
  renderProfilePopoverHtml,
  resolveProfileFromState,
  type ProfileCardData
} from "./profile-popover.js";

const selfId = "60000000-0000-4000-8000-000000000001";
const peerId = "60000000-0000-4000-8000-000000000002";
const strangerId = "60000000-0000-4000-8000-000000000009";

function member(over: Partial<WorkbenchPageVM["workspace_members"]["items"][number]> = {}) {
  return {
    user_id: selfId,
    nickname: "me",
    membership_role: "member" as const,
    is_project_owner: false,
    is_self: true,
    ...over
  };
}

function vmWith(members: WorkbenchPageVM["workspace_members"]["items"]): WorkbenchPageVM {
  return {
    workspace_members: { scope: "workspace", total: members.length, returned: members.length, capped: false, items: members }
  } as unknown as WorkbenchPageVM;
}

function dmItem(): DmListItemVM {
  return {
    conversation: {
      id: "30000000-0000-4000-8000-000000000003",
      workspace_id: "80000000-0000-4000-8000-000000000008",
      project_id: "20000000-0000-4000-8000-000000000009",
      kind: "collab",
      title: "私聊",
      parent_conversation_id: null,
      source_message_id: null,
      visibility: "private",
      next_seq: 0,
      created_by: selfId,
      participant_role: "owner",
      cuu_enabled: false,
      is_dm: true,
      created_at: "2026-07-15T08:30:00.123Z",
      updated_at: "2026-07-15T08:31:00.123Z"
    },
    participants: [
      { user_id: selfId, nickname: "me", is_self: true },
      { user_id: strangerId, nickname: "from-dm-only", is_self: false }
    ]
  };
}

// closest() 只认预置好的 selector → 命中元素映射，其余返回 null——够 profileTargetFor 用。
function fakeTarget(matches: Record<string, { dataset?: Record<string, string> } | null>): Element {
  return {
    closest: (selector: string) => matches[selector] ?? null
  } as unknown as Element;
}

test("resolveProfileFromState resolves nickname from workspace_members, marks online + self", () => {
  const state = {
    vm: vmWith([member({ user_id: selfId, nickname: "me", is_self: true }), member({ user_id: peerId, nickname: "peer", is_self: false })]),
    dmList: [] as DmListItemVM[],
    onlineUserIds: [peerId],
    currentUserId: selfId
  };
  assert.deepEqual(resolveProfileFromState(state, peerId), {
    userId: peerId,
    nickname: "peer",
    online: true,
    isSelf: false
  });
  // 自己：isSelf=true，离线（不在 onlineUserIds）。
  assert.deepEqual(resolveProfileFromState(state, selfId), {
    userId: selfId,
    nickname: "me",
    online: false,
    isSelf: true
  });
});

test("resolveProfileFromState falls back to a DM participant nickname when not in the VM members", () => {
  const state = {
    vm: vmWith([member({ user_id: selfId, nickname: "me", is_self: true })]),
    dmList: [dmItem()],
    onlineUserIds: [] as string[],
    currentUserId: selfId
  };
  const resolved = resolveProfileFromState(state, strangerId);
  assert.equal(resolved?.nickname, "from-dm-only");
  assert.equal(resolved?.isSelf, false);
});

test("resolveProfileFromState returns undefined when the nickname cannot be resolved anywhere", () => {
  const state = {
    vm: vmWith([member({ user_id: selfId, is_self: true })]),
    dmList: [] as DmListItemVM[],
    onlineUserIds: [] as string[],
    currentUserId: selfId
  };
  assert.equal(resolveProfileFromState(state, peerId), undefined);
});

test("resolveProfileFromState derives isSelf from is_self flags when currentUserId is missing", () => {
  const state = {
    vm: vmWith([member({ user_id: selfId, nickname: "me", is_self: true })]),
    dmList: [] as DmListItemVM[],
    onlineUserIds: [] as string[],
    currentUserId: undefined
  };
  assert.equal(resolveProfileFromState(state, selfId)?.isSelf, true);
});

test("profileTargetFor prefers roster rows, then avatars, and skips the group picker + Cuu", () => {
  // roster 行（data-wb-open-profile）优先。
  assert.equal(
    profileTargetFor(
      fakeTarget({
        ".wh-wb-new-collab-member-row": null,
        "[data-wb-open-profile]": { dataset: { wbOpenProfile: peerId } }
      })
    ),
    peerId
  );
  // 聊天气泡/成员条头像（data-wb-avatar-user-id）。
  assert.equal(
    profileTargetFor(
      fakeTarget({
        ".wh-wb-new-collab-member-row": null,
        "[data-wb-open-profile]": null,
        "[data-wb-avatar-user-id]": { dataset: { wbAvatarUserId: peerId } }
      })
    ),
    peerId
  );
  // 建群选人器行内的头像——勾选语义不动，不弹卡。
  assert.equal(
    profileTargetFor(
      fakeTarget({
        ".wh-wb-new-collab-member-row": { dataset: {} },
        "[data-wb-avatar-user-id]": { dataset: { wbAvatarUserId: peerId } }
      })
    ),
    undefined
  );
  // Cuu 头像/其它非头像元素——都不命中。
  assert.equal(
    profileTargetFor(fakeTarget({ ".wh-wb-new-collab-member-row": null, "[data-wb-open-profile]": null, "[data-wb-avatar-user-id]": null })),
    undefined
  );
});

test("renderProfilePopoverHtml shows a Message button for others (carrying the user id) and hides it for self", () => {
  const other: ProfileCardData = { userId: peerId, nickname: "peer", online: true, isSelf: false };
  const otherHtml = renderProfilePopoverHtml({ data: other, locale: "zh-CN" });
  assert.match(otherHtml, /data-wb-popover-dm="60000000-0000-4000-8000-000000000002"/);
  assert.match(otherHtml, /发私聊/);
  // 在线态：绿点 class + 在线文字。
  assert.match(otherHtml, /wh-wb-profile-status--online/);
  assert.match(otherHtml, /在线/);

  const self: ProfileCardData = { userId: selfId, nickname: "me", online: false, isSelf: true };
  const selfHtml = renderProfilePopoverHtml({ data: self, locale: "zh-CN" });
  assert.doesNotMatch(selfHtml, /data-wb-popover-dm/);
  assert.match(selfHtml, /这是你/);
});

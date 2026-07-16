import assert from "node:assert/strict";
import { test } from "node:test";

import type { DmListItemVM, WorkbenchPageVM } from "@workhub/contracts";

import {
  MAX_OPEN_CONVERSATION_TABS,
  closeConversationTab,
  openConversationTab,
  refreshTabs,
  type ConversationTabDescriptor,
  type OpenConversationTab,
  type TabLiveContext
} from "./model.js";

const PROJECT_A = "90000000-0000-4000-8000-0000000000a1";
const PROJECT_B = "90000000-0000-4000-8000-0000000000b1";
const SELF = "90000000-0000-4000-8000-000000000009";

function descriptor(over: Partial<ConversationTabDescriptor> & { conversationId: string }): ConversationTabDescriptor {
  return { kind: "collab", projectId: PROJECT_A, title: over.conversationId, ...over };
}

type TabOver = {
  conversationId: string;
  kind?: OpenConversationTab["kind"];
  projectId?: string | undefined;
  title?: string;
  unread?: number;
  lastActiveAt?: number;
};

function tab(over: TabOver): OpenConversationTab {
  const projectId = "projectId" in over ? over.projectId : PROJECT_A;
  return {
    kind: over.kind ?? "collab",
    conversationId: over.conversationId,
    ...(projectId !== undefined ? { projectId } : {}),
    title: over.title ?? over.conversationId,
    unread: over.unread ?? 0,
    lastActiveAt: over.lastActiveAt ?? 1
  };
}

// —— openConversationTab：去重 / 激活 / 幂等 —— //

test("openConversationTab appends a brand-new tab at the end, preserving insertion order", () => {
  let tabs: OpenConversationTab[] = [];
  tabs = openConversationTab(tabs, descriptor({ conversationId: "a" }), 1);
  tabs = openConversationTab(tabs, descriptor({ conversationId: "b" }), 2);
  assert.deepEqual(
    tabs.map((t) => t.conversationId),
    ["a", "b"]
  );
});

test("openConversationTab on an already-open conversation only re-activates it (no duplicate row, order kept)", () => {
  let tabs: OpenConversationTab[] = [];
  tabs = openConversationTab(tabs, descriptor({ conversationId: "a" }), 1);
  tabs = openConversationTab(tabs, descriptor({ conversationId: "b" }), 2);
  tabs = openConversationTab(tabs, descriptor({ conversationId: "a" }), 3);
  assert.equal(tabs.length, 2);
  assert.deepEqual(
    tabs.map((t) => t.conversationId),
    ["a", "b"]
  );
  assert.equal(tabs.find((t) => t.conversationId === "a")!.lastActiveAt, 3);
});

test("openConversationTab is idempotent when re-opening the already-front tab with the same metadata (same reference)", () => {
  const tabs = [tab({ conversationId: "a", lastActiveAt: 5 }), tab({ conversationId: "b", lastActiveAt: 2 })];
  const next = openConversationTab(tabs, descriptor({ conversationId: "a", title: "a" }), 6);
  assert.equal(next, tabs, "re-opening the front tab with unchanged metadata must return the same array reference");
});

test("openConversationTab refreshes metadata (title) even when the tab is already front", () => {
  const tabs = [tab({ conversationId: "a", lastActiveAt: 5, title: "old" })];
  const next = openConversationTab(tabs, descriptor({ conversationId: "a", title: "renamed" }), 6);
  assert.notEqual(next, tabs);
  assert.equal(next[0]!.title, "renamed");
});

// —— 上限 8 + 最久未激活淘汰 —— //

test("openConversationTab caps the collection at 8, evicting the least-recently-active non-current tab", () => {
  let tabs: OpenConversationTab[] = [];
  for (let i = 1; i <= MAX_OPEN_CONVERSATION_TABS; i += 1) {
    tabs = openConversationTab(tabs, descriptor({ conversationId: `c${i}` }), i);
  }
  assert.equal(tabs.length, MAX_OPEN_CONVERSATION_TABS);
  // Open a 9th: the oldest (c1, lastActiveAt=1) is evicted; the newcomer stays.
  tabs = openConversationTab(tabs, descriptor({ conversationId: "c9" }), 9);
  assert.equal(tabs.length, MAX_OPEN_CONVERSATION_TABS);
  assert.equal(
    tabs.some((t) => t.conversationId === "c1"),
    false
  );
  assert.equal(
    tabs.some((t) => t.conversationId === "c9"),
    true
  );
});

test("recently re-activated tabs survive eviction; a stale one is dropped instead", () => {
  let tabs: OpenConversationTab[] = [];
  for (let i = 1; i <= MAX_OPEN_CONVERSATION_TABS; i += 1) {
    tabs = openConversationTab(tabs, descriptor({ conversationId: `c${i}` }), i);
  }
  // Re-activate the oldest (c1) so it is no longer the least-recently-active.
  tabs = openConversationTab(tabs, descriptor({ conversationId: "c1" }), 9);
  // Now open a new tab: c2 (lastActiveAt=2) is the least-recently-active and gets evicted, not c1.
  tabs = openConversationTab(tabs, descriptor({ conversationId: "c9" }), 10);
  assert.equal(
    tabs.some((t) => t.conversationId === "c1"),
    true
  );
  assert.equal(
    tabs.some((t) => t.conversationId === "c2"),
    false
  );
});

// —— closeConversationTab：移除 + 邻居激活 —— //

test("closeConversationTab removes the tab and points at the right-hand neighbor to activate", () => {
  const tabs = [tab({ conversationId: "a" }), tab({ conversationId: "b" }), tab({ conversationId: "c" })];
  const result = closeConversationTab(tabs, "b");
  assert.deepEqual(
    result.tabs.map((t) => t.conversationId),
    ["a", "c"]
  );
  assert.equal(result.neighborConversationId, "c");
});

test("closeConversationTab falls back to the left-hand neighbor when closing the last tab", () => {
  const tabs = [tab({ conversationId: "a" }), tab({ conversationId: "b" }), tab({ conversationId: "c" })];
  const result = closeConversationTab(tabs, "c");
  assert.equal(result.neighborConversationId, "b");
});

test("closeConversationTab returns no neighbor when the collection empties", () => {
  const result = closeConversationTab([tab({ conversationId: "a" })], "a");
  assert.deepEqual(result.tabs, []);
  assert.equal(result.neighborConversationId, undefined);
});

test("closeConversationTab on an unknown id is a no-op (same reference, no neighbor)", () => {
  const tabs = [tab({ conversationId: "a" })];
  const result = closeConversationTab(tabs, "missing");
  assert.equal(result.tabs, tabs);
  assert.equal(result.neighborConversationId, undefined);
});

// —— refreshTabs：从活数据镜像标题/未读 + 剔除失效（与 rail 红点同源，不双写） —— //

function vmFixture(): WorkbenchPageVM {
  return {
    generated_at: "2026-07-15T00:00:00.000Z",
    project: {
      id: PROJECT_A,
      workspace_id: "90000000-0000-4000-8000-000000000000",
      name: "星尘短剧",
      slug: "xingchen",
      description: null,
      owner_label: "阿曼"
    },
    viewer: { user_id: SELF, membership_role: "member", is_project_owner: false },
    conversations: {
      conversations: [
        {
          id: "m1",
          workspace_id: "90000000-0000-4000-8000-000000000000",
          project_id: PROJECT_A,
          kind: "main",
          title: "主区",
          parent_conversation_id: null,
          source_message_id: null,
          visibility: "project",
          next_seq: 4,
          created_by: null,
          participant_role: null,
          cuu_enabled: true,
          unread_count: 5,
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-01T00:00:00.000Z"
        },
        {
          id: "c1",
          workspace_id: "90000000-0000-4000-8000-000000000000",
          project_id: PROJECT_A,
          kind: "collab",
          title: "隐私区文案讨论",
          parent_conversation_id: null,
          source_message_id: null,
          visibility: "project",
          next_seq: 9,
          created_by: SELF,
          participant_role: "owner",
          cuu_enabled: true,
          unread_count: 2,
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-01T00:00:00.000Z"
        }
      ],
      capped: false,
      next_cursor: null
    },
    workspace_members: {
      scope: "workspace",
      total: 1,
      returned: 1,
      capped: false,
      items: [{ user_id: SELF, nickname: "阿曼", membership_role: "member", is_project_owner: false, is_self: true }]
    },
    army_summary: { active_plan_count: 0, empty_state: "no_active_armies" },
    recent_project_files: { items: [], empty_state: "no_recent_files" }
  };
}

function dmFixture(conversationId: string, unread: number): DmListItemVM {
  return {
    conversation: {
      id: conversationId,
      workspace_id: "90000000-0000-4000-8000-000000000000",
      project_id: "20000000-0000-4000-8000-000000000009",
      kind: "collab",
      title: "私聊",
      parent_conversation_id: null,
      source_message_id: null,
      visibility: "private",
      next_seq: 0,
      created_by: SELF,
      participant_role: "owner",
      cuu_enabled: false,
      is_dm: true,
      unread_count: unread,
      created_at: "2026-07-15T00:00:00.000Z",
      updated_at: "2026-07-15T00:00:00.000Z"
    },
    participants: [
      { user_id: SELF, nickname: "阿曼", is_self: true },
      { user_id: "peer-1", nickname: "小林", is_self: false }
    ]
  };
}

function liveContext(over: Partial<TabLiveContext> = {}): TabLiveContext {
  return {
    selectedProjectId: PROJECT_A,
    vm: vmFixture(),
    dmList: [dmFixture("dm1", 3)],
    dmListReady: true,
    currentUserId: SELF,
    ...over
  };
}

test("refreshTabs mirrors title + unread from the live vm/dmList (single source, in sync with the rail badge)", () => {
  const tabs = [
    tab({ conversationId: "m1", kind: "main", title: "stale", unread: 99 }),
    tab({ conversationId: "c1", kind: "collab", title: "stale", unread: 99 }),
    tab({ conversationId: "dm1", kind: "dm", projectId: "20000000-0000-4000-8000-000000000009", title: "stale", unread: 99 })
  ];
  const next = refreshTabs(tabs, liveContext());
  const byId = Object.fromEntries(next.map((t) => [t.conversationId, t]));
  assert.equal(byId.m1!.title, "星尘短剧"); // main → project name
  assert.equal(byId.m1!.unread, 5);
  assert.equal(byId.c1!.title, "隐私区文案讨论");
  assert.equal(byId.c1!.unread, 2);
  assert.equal(byId.dm1!.title, "小林"); // dm → peer nickname
  assert.equal(byId.dm1!.unread, 3);
});

test("refreshTabs clears a tab's unread when the live conversation was read (rail-clear stays in sync)", () => {
  const vm = vmFixture();
  vm.conversations.conversations[0]!.unread_count = 0; // main read → unread cleared upstream
  const next = refreshTabs([tab({ conversationId: "m1", kind: "main", unread: 5 })], liveContext({ vm }));
  assert.equal(next[0]!.unread, 0);
});

test("refreshTabs silently drops a tab whose conversation vanished from the current project's vm", () => {
  const tabs = [tab({ conversationId: "c1", kind: "collab" }), tab({ conversationId: "gone", kind: "collab" })];
  const next = refreshTabs(tabs, liveContext());
  assert.deepEqual(
    next.map((t) => t.conversationId),
    ["c1"]
  );
});

test("refreshTabs drops a dm tab absent from a ready dm list, but keeps it while the list is still loading", () => {
  const dropped = refreshTabs([tab({ conversationId: "dmX", kind: "dm", projectId: undefined })], liveContext());
  assert.deepEqual(dropped, []);
  const kept = refreshTabs(
    [tab({ conversationId: "dmX", kind: "dm", projectId: undefined })],
    liveContext({ dmListReady: false })
  );
  assert.equal(kept.length, 1);
});

test("refreshTabs keeps cross-project tabs untouched (no vm in hand to validate them)", () => {
  const crossProjectTab = tab({ conversationId: "other-main", kind: "main", projectId: PROJECT_B, title: "别的项目" });
  const next = refreshTabs([crossProjectTab], liveContext());
  assert.equal(next.length, 1);
  assert.equal(next[0]!.title, "别的项目");
});

test("refreshTabs is idempotent: a second pass over already-fresh tabs returns the same reference", () => {
  const first = refreshTabs(
    [tab({ conversationId: "m1", kind: "main" }), tab({ conversationId: "c1", kind: "collab" })],
    liveContext()
  );
  const second = refreshTabs(first, liveContext());
  assert.equal(second, first);
});

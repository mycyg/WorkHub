import assert from "node:assert/strict";
import { test } from "node:test";

import type { DmListItemVM } from "@workhub/contracts";

import type { OpenConversationTab } from "./model.js";
import { renderConversationTabsHtml } from "./render.js";

const SELF = "90000000-0000-4000-8000-000000000009";

type TabOver = {
  conversationId: string;
  kind?: OpenConversationTab["kind"];
  projectId?: string | undefined;
  title?: string;
  unread?: number;
  lastActiveAt?: number;
};

function tab(over: TabOver): OpenConversationTab {
  const projectId = "projectId" in over ? over.projectId : "90000000-0000-4000-8000-0000000000a1";
  return {
    kind: over.kind ?? "collab",
    conversationId: over.conversationId,
    ...(projectId !== undefined ? { projectId } : {}),
    title: over.title ?? over.conversationId,
    unread: over.unread ?? 0,
    lastActiveAt: over.lastActiveAt ?? 1
  };
}

function dmFixture(conversationId: string, peerOnlineId: string): DmListItemVM {
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
      created_at: "2026-07-15T00:00:00.000Z",
      updated_at: "2026-07-15T00:00:00.000Z"
    },
    participants: [
      { user_id: SELF, nickname: "阿曼", is_self: true },
      { user_id: peerOnlineId, nickname: "小林", is_self: false }
    ]
  };
}

test("renderConversationTabsHtml renders each tab's title, an activate button, and a close button", () => {
  const html = renderConversationTabsHtml({
    tabs: [tab({ conversationId: "c1", title: "隐私区文案讨论" })],
    activeConversationId: undefined,
    dmList: [],
    currentUserId: SELF,
    onlineUserIds: new Set(),
    locale: "zh-CN"
  });
  assert.match(html, /隐私区文案讨论/u);
  assert.match(html, /data-wb-tab="c1"/u);
  assert.match(html, /data-wb-tab-close="c1"/u);
});

test("renderConversationTabsHtml marks the active tab and hides its unread badge (you are reading it)", () => {
  const html = renderConversationTabsHtml({
    tabs: [tab({ conversationId: "c1", unread: 4 })],
    activeConversationId: "c1",
    dmList: [],
    currentUserId: SELF,
    onlineUserIds: new Set(),
    locale: "zh-CN"
  });
  assert.match(html, /wh-wb-sess-tab is-active/u);
  assert.match(html, /aria-current="true"/u);
  // The active tab is being read — no unread badge on it.
  assert.doesNotMatch(html, /wh-wb-sess-unread/u);
});

test("renderConversationTabsHtml shows the unread badge on an inactive tab with unread > 0", () => {
  const html = renderConversationTabsHtml({
    tabs: [tab({ conversationId: "c1", unread: 4 })],
    activeConversationId: "other",
    dmList: [],
    currentUserId: SELF,
    onlineUserIds: new Set(),
    locale: "zh-CN"
  });
  assert.match(html, /wh-wb-sess-unread">4</u);
});

test("renderConversationTabsHtml renders an online presence dot for a dm tab whose peer is online", () => {
  const online = renderConversationTabsHtml({
    tabs: [tab({ conversationId: "dm1", kind: "dm", projectId: undefined, title: "小林" })],
    activeConversationId: undefined,
    dmList: [dmFixture("dm1", "peer-1")],
    currentUserId: SELF,
    onlineUserIds: new Set(["peer-1"]),
    locale: "zh-CN"
  });
  assert.match(online, /wh-wb-sess-dot is-online/u);

  const offline = renderConversationTabsHtml({
    tabs: [tab({ conversationId: "dm1", kind: "dm", projectId: undefined, title: "小林" })],
    activeConversationId: undefined,
    dmList: [dmFixture("dm1", "peer-1")],
    currentUserId: SELF,
    onlineUserIds: new Set(),
    locale: "zh-CN"
  });
  assert.match(offline, /wh-wb-sess-dot"/u);
  assert.doesNotMatch(offline, /wh-wb-sess-dot is-online/u);
});

test("renderConversationTabsHtml escapes tab titles (no raw HTML injection from conversation names)", () => {
  const html = renderConversationTabsHtml({
    tabs: [tab({ conversationId: "c1", title: "<img src=x onerror=alert(1)>" })],
    activeConversationId: undefined,
    dmList: [],
    currentUserId: SELF,
    onlineUserIds: new Set(),
    locale: "zh-CN"
  });
  assert.doesNotMatch(html, /<img src=x/u);
  assert.match(html, /&lt;img/u);
});

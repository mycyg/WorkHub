import assert from "node:assert/strict";
import { test } from "node:test";

import type { OpenConversationTab } from "./model.js";
import { loadOpenConversationTabs, openTabsStorageKey, saveOpenConversationTabs } from "./storage.js";

const WORKSPACE = "ws-1";
const USER = "user-1";

function fakeStorage(seed: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    }
  };
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
  const projectId = "projectId" in over ? over.projectId : "proj-a";
  return {
    kind: over.kind ?? "collab",
    conversationId: over.conversationId,
    ...(projectId !== undefined ? { projectId } : {}),
    title: over.title ?? over.conversationId,
    unread: over.unread ?? 0,
    lastActiveAt: over.lastActiveAt ?? 1
  };
}

test("save + load round-trips the collection under a per-user, per-workspace key", () => {
  const storage = fakeStorage();
  const tabs = [
    tab({ conversationId: "m1", kind: "main", title: "星尘短剧", lastActiveAt: 2 }),
    tab({ conversationId: "dm1", kind: "dm", projectId: undefined, title: "小林", lastActiveAt: 3 })
  ];
  saveOpenConversationTabs({ storage, workspaceId: WORKSPACE, userId: USER, tabs });
  assert.equal(storage.map.has(openTabsStorageKey(WORKSPACE, USER)), true);

  const loaded = loadOpenConversationTabs({ storage, workspaceId: WORKSPACE, userId: USER });
  assert.deepEqual(
    loaded.map((t) => ({ id: t.conversationId, kind: t.kind, title: t.title })),
    [
      { id: "m1", kind: "main", title: "星尘短剧" },
      { id: "dm1", kind: "dm", title: "小林" }
    ]
  );
  // unread is never persisted — restored tabs start at 0 (recomputed live by refreshTabs).
  assert.equal(loaded.every((t) => t.unread === 0), true);
});

test("saving an empty collection removes the stored key rather than leaving an empty array behind", () => {
  const storage = fakeStorage();
  saveOpenConversationTabs({ storage, workspaceId: WORKSPACE, userId: USER, tabs: [tab({ conversationId: "a" })] });
  saveOpenConversationTabs({ storage, workspaceId: WORKSPACE, userId: USER, tabs: [] });
  assert.equal(storage.map.has(openTabsStorageKey(WORKSPACE, USER)), false);
});

test("load returns an empty array for a missing key or corrupt JSON", () => {
  assert.deepEqual(loadOpenConversationTabs({ storage: fakeStorage(), workspaceId: WORKSPACE, userId: USER }), []);
  const corrupt = fakeStorage({ [openTabsStorageKey(WORKSPACE, USER)]: "{ not json" });
  assert.deepEqual(loadOpenConversationTabs({ storage: corrupt, workspaceId: WORKSPACE, userId: USER }), []);
});

test("load silently drops malformed entries: unknown kind, missing id/title, and main/collab without a projectId", () => {
  const payload = JSON.stringify([
    { kind: "main", conversationId: "m1", projectId: "proj-a", title: "ok" },
    { kind: "banana", conversationId: "bad-kind", projectId: "proj-a", title: "x" },
    { kind: "collab", conversationId: "no-title", projectId: "proj-a" },
    { kind: "collab", title: "no-id", projectId: "proj-a" },
    { kind: "collab", conversationId: "no-project", title: "needs project" },
    { kind: "dm", conversationId: "dm1", title: "小林" }
  ]);
  const storage = fakeStorage({ [openTabsStorageKey(WORKSPACE, USER)]: payload });
  const loaded = loadOpenConversationTabs({ storage, workspaceId: WORKSPACE, userId: USER });
  assert.deepEqual(
    loaded.map((t) => t.conversationId),
    ["m1", "dm1"] // dm keeps no projectId; the rest are dropped as invalid.
  );
});

test("load de-duplicates by conversationId and caps the restored collection at 8", () => {
  const many = Array.from({ length: 12 }, (_unused, i) => ({
    kind: "collab",
    conversationId: `c${i}`,
    projectId: "proj-a",
    title: `c${i}`
  }));
  const withDup = [...many, { kind: "collab", conversationId: "c0", projectId: "proj-a", title: "dup" }];
  const storage = fakeStorage({ [openTabsStorageKey(WORKSPACE, USER)]: JSON.stringify(withDup) });
  const loaded = loadOpenConversationTabs({ storage, workspaceId: WORKSPACE, userId: USER });
  assert.equal(loaded.length, 8);
  assert.equal(new Set(loaded.map((t) => t.conversationId)).size, 8);
});

test("save/load are no-ops (never throw) when no storage is available", () => {
  assert.doesNotThrow(() =>
    saveOpenConversationTabs({ storage: undefined, workspaceId: WORKSPACE, userId: USER, tabs: [tab({ conversationId: "a" })] })
  );
  assert.deepEqual(loadOpenConversationTabs({ storage: undefined, workspaceId: WORKSPACE, userId: USER }), []);
});

test("storage keys are isolated per workspace and per user", () => {
  assert.notEqual(openTabsStorageKey("ws-1", "user-1"), openTabsStorageKey("ws-2", "user-1"));
  assert.notEqual(openTabsStorageKey("ws-1", "user-1"), openTabsStorageKey("ws-1", "user-2"));
});

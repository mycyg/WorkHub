import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyPendingWorkbenchDeepLink,
  bindWorkbenchDeepLinkListener,
  bindWorkbenchLoggedOutListener,
  clientToken,
  isWorkbenchDesktopLoggedOut,
  resolveWorkbenchApiBase,
  resolveWorkbenchTauriListen
} from "./boot.js";
import { stashPendingWorkbenchDeepLink } from "./pending-deep-link.js";

function fakeStorage(values: Record<string, string> = {}): Pick<Storage, "getItem"> {
  return { getItem: (key: string) => values[key] ?? null };
}

function fakeReadWriteStorage(initial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    }
  };
}

test("clientToken reads workhub_client_token first, then falls back to the legacy yqgl key", () => {
  assert.equal(clientToken(fakeStorage({ workhub_client_token: "new-token" })), "new-token");
  assert.equal(clientToken(fakeStorage({ yqgl_client_token: "legacy-token" })), "legacy-token");
  assert.equal(
    clientToken(fakeStorage({ workhub_client_token: "new-token", yqgl_client_token: "legacy-token" })),
    "new-token"
  );
  assert.equal(clientToken(fakeStorage({})), undefined);
});

test("resolveWorkbenchApiBase defaults to the local API port and honors a stored override", () => {
  assert.equal(resolveWorkbenchApiBase(fakeStorage({})), "http://127.0.0.1:8787");
  assert.equal(
    resolveWorkbenchApiBase(fakeStorage({ workhub_api_base: "http://192.168.1.5:9000/" })),
    "http://192.168.1.5:9000"
  );
  // Blank overrides don't count — still fall back to the local default.
  assert.equal(resolveWorkbenchApiBase(fakeStorage({ workhub_api_base: "   " })), "http://127.0.0.1:8787");
});

test("isWorkbenchDesktopLoggedOut only trips on the exact logged-out sentinel value", () => {
  assert.equal(isWorkbenchDesktopLoggedOut(fakeStorage({})), false);
  assert.equal(isWorkbenchDesktopLoggedOut(fakeStorage({ workhub_desktop_logged_out: "0" })), false);
  assert.equal(isWorkbenchDesktopLoggedOut(fakeStorage({ workhub_desktop_logged_out: "1" })), true);
});

test("resolveWorkbenchTauriListen returns undefined outside a Tauri webview (browser dev preview)", () => {
  assert.equal(resolveWorkbenchTauriListen({}), undefined);
});

test("resolveWorkbenchTauriListen resolves the real __TAURI__.event.listen function when present", () => {
  const listen = () => () => {};
  const resolved = resolveWorkbenchTauriListen({ __TAURI__: { event: { listen } } });
  assert.equal(resolved, listen);
});

test("bindWorkbenchDeepLinkListener no-ops without a Tauri listen bridge instead of throwing", () => {
  const calls: Array<[string, string | undefined]> = [];
  const shell = {
    selectProject: (projectId: string, conversationId?: string) => {
      calls.push([projectId, conversationId]);
    }
  };
  assert.doesNotThrow(() => bindWorkbenchDeepLinkListener(shell, {}));
  assert.deepEqual(calls, []);
});

test("applyPendingWorkbenchDeepLink selects the stashed project when a cold-start stash is present", () => {
  const storage = fakeReadWriteStorage();
  stashPendingWorkbenchDeepLink({ projectId: "project-1", conversationId: "conv-1" }, { storage, now: () => 0 });
  const calls: Array<[string, string | undefined]> = [];
  const shell = {
    selectProject: (projectId: string, conversationId?: string) => {
      calls.push([projectId, conversationId]);
    }
  };

  applyPendingWorkbenchDeepLink(shell, storage, () => 0);

  assert.deepEqual(calls, [["project-1", "conv-1"]]);
  // 一次性消费：storage 里不应再残留这条 stash。
  assert.equal(storage.getItem("workhub_workbench_pending_deep_link"), null);
});

test("applyPendingWorkbenchDeepLink is a no-op when there is nothing stashed (normal cold start)", () => {
  const storage = fakeReadWriteStorage();
  const calls: unknown[] = [];
  const shell = { selectProject: (...args: unknown[]) => calls.push(args) };

  assert.doesNotThrow(() => applyPendingWorkbenchDeepLink(shell, storage));
  assert.deepEqual(calls, []);
});

// MRG-22：登出态/凭据门等落不了地的场合不许消费 stash——consume 是一次性删除，删了而 selectProject
// 被拦就等于把深链目标吞了。enabled === false 时连读都不读，stash 原样留给登录后的干净 boot。
test("applyPendingWorkbenchDeepLink keeps the stash untouched when disabled (logged-out boot)", () => {
  const storage = fakeReadWriteStorage();
  stashPendingWorkbenchDeepLink({ projectId: "project-1", conversationId: "conv-1" }, { storage, now: () => 0 });
  const calls: Array<[string, string | undefined]> = [];
  const shell = {
    selectProject: (projectId: string, conversationId?: string) => {
      calls.push([projectId, conversationId]);
    }
  };

  applyPendingWorkbenchDeepLink(shell, storage, () => 0, { enabled: false });

  assert.deepEqual(calls, []);
  assert.ok(storage.getItem("workhub_workbench_pending_deep_link"), "stash must survive a disabled boot");
  // 恢复路径（重新登录后 reload → 干净 boot）：enabled 默认开启，stash 被原样接回。
  applyPendingWorkbenchDeepLink(shell, storage, () => 0);
  assert.deepEqual(calls, [["project-1", "conv-1"]]);
  assert.equal(storage.getItem("workhub_workbench_pending_deep_link"), null);
});

test("bindWorkbenchDeepLinkListener selects the project from a workbench-targeted deep-link plan", () => {
  const calls: Array<[string, string | undefined]> = [];
  const shell = {
    selectProject: (projectId: string, conversationId?: string) => {
      calls.push([projectId, conversationId]);
    }
  };
  let handler: ((event: { payload: unknown }) => void) | undefined;
  const scope = {
    __TAURI__: {
      event: {
        listen: (eventName: string, cb: (event: { payload: unknown }) => void) => {
          assert.equal(eventName, "deep-link");
          handler = cb;
          return () => {};
        }
      }
    }
  };

  bindWorkbenchDeepLinkListener(shell, scope);
  assert.ok(handler);
  handler?.({
    payload: {
      rawUrl: "workhub://workbench/project-1/conversation-1",
      scheme: "workhub",
      route: "/workbench/project-1/conversation-1",
      windowControl: { label: "workbench", action: "show_and_focus", source: "deep_link", focus: true, reason: "deep_link" }
    }
  });

  assert.deepEqual(calls, [["project-1", "conversation-1"]]);
});

test("bindWorkbenchDeepLinkListener ignores deep links that target a different window (e.g. main)", () => {
  const calls: unknown[] = [];
  const shell = { selectProject: (...args: unknown[]) => calls.push(args) };
  let handler: ((event: { payload: unknown }) => void) | undefined;
  const scope = {
    __TAURI__: {
      event: {
        listen: (_eventName: string, cb: (event: { payload: unknown }) => void) => {
          handler = cb;
          return () => {};
        }
      }
    }
  };

  bindWorkbenchDeepLinkListener(shell, scope);
  handler?.({
    payload: {
      rawUrl: "workhub://open/approvals",
      scheme: "workhub",
      route: "/approvals",
      windowControl: { label: "main", action: "show_and_focus", source: "deep_link", focus: true, reason: "deep_link" }
    }
  });

  assert.deepEqual(calls, []);
});

// G-desktop 止血批 3（跨窗口登出广播）——照 bindWorkbenchDeepLinkListener 同一套断言纪律：
// 无 Tauri 时优雅降级、有 Tauri 时订阅正确的事件名并把回调转发给调用方。
test("bindWorkbenchLoggedOutListener no-ops without a Tauri listen bridge instead of throwing", () => {
  const calls: number[] = [];
  assert.doesNotThrow(() => bindWorkbenchLoggedOutListener(() => calls.push(1), {}));
  assert.deepEqual(calls, []);
});

test("bindWorkbenchLoggedOutListener subscribes to the workhub-logged-out event and forwards it to the callback", () => {
  const calls: number[] = [];
  let handler: ((event: { payload: unknown }) => void) | undefined;
  const scope = {
    __TAURI__: {
      event: {
        listen: (eventName: string, cb: (event: { payload: unknown }) => void) => {
          assert.equal(eventName, "workhub-logged-out");
          handler = cb;
          return () => {};
        }
      }
    }
  };

  bindWorkbenchLoggedOutListener(() => calls.push(1), scope);
  assert.ok(handler);
  handler?.({ payload: undefined });

  assert.deepEqual(calls, [1]);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyPendingWorkbenchDeepLink,
  applyReplayedShellDeepLink,
  bindWorkbenchConnectionChangedListener,
  bindWorkbenchDeepLinkListener,
  bindWorkbenchLoggedInListener,
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

// MRG-23：壳层暂存的深链重放——窗口创建期间错过的 emit 由 boot 后的 take_pending_deep_link 补回。
test("applyReplayedShellDeepLink applies the shell-stashed deep link once the webview is up", async () => {
  const calls: Array<[string, string | undefined]> = [];
  const shell = {
    selectProject: (projectId: string, conversationId?: string) => {
      calls.push([projectId, conversationId]);
    }
  };
  const plan = {
    rawUrl: "workhub://workbench/project-9",
    scheme: "workhub",
    route: "/workbench/project-9",
    windowControl: { label: "workbench", action: "show_and_focus", source: "deep_link", focus: true, reason: "deep_link" }
  };

  await applyReplayedShellDeepLink(shell, { takePendingDeepLink: async () => plan });

  assert.deepEqual(calls, [["project-9", undefined]]);
});

test("applyReplayedShellDeepLink no-ops on missing stash, wrong window, errors, and disabled (logged-out) boots", async () => {
  const calls: unknown[] = [];
  const shell = { selectProject: (...args: unknown[]) => calls.push(args) };

  // 无暂存 / 取失败 / 目标是别的窗口 / 登出态禁用——全部安静跳过。
  await applyReplayedShellDeepLink(shell, { takePendingDeepLink: async () => null });
  await applyReplayedShellDeepLink(shell, { takePendingDeepLink: async () => { throw new Error("no shell"); } });
  await applyReplayedShellDeepLink(shell, {
    takePendingDeepLink: async () => ({
      rawUrl: "workhub://open/approvals",
      scheme: "workhub",
      route: "/approvals",
      windowControl: { label: "main", action: "show_and_focus", source: "deep_link", focus: true, reason: "deep_link" }
    })
  });
  await applyReplayedShellDeepLink(shell, {
    enabled: false,
    takePendingDeepLink: async () => ({
      rawUrl: "workhub://workbench/project-9",
      scheme: "workhub",
      route: "/workbench/project-9",
      windowControl: { label: "workbench", action: "show_and_focus", source: "deep_link", focus: true, reason: "deep_link" }
    })
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

// R24 S5（N-03 根治）——反方向的同一条桥：主窗登录/重新绑定成功广播 workhub-logged-in，工作台
// 订阅后 reload 一次重新走鉴权门判定。断言纪律与上面的 workhub-logged-out 测试完全对称。
test("bindWorkbenchLoggedInListener no-ops without a Tauri listen bridge instead of throwing", () => {
  const calls: number[] = [];
  assert.doesNotThrow(() => bindWorkbenchLoggedInListener(() => calls.push(1), {}));
  assert.deepEqual(calls, []);
});

test("bindWorkbenchLoggedInListener subscribes to the workhub-logged-in event and forwards it to the callback", () => {
  const calls: number[] = [];
  let handler: ((event: { payload: unknown }) => void) | undefined;
  const scope = {
    __TAURI__: {
      event: {
        listen: (eventName: string, cb: (event: { payload: unknown }) => void) => {
          assert.equal(eventName, "workhub-logged-in");
          handler = cb;
          return () => {};
        }
      }
    }
  };

  bindWorkbenchLoggedInListener(() => calls.push(1), scope);
  assert.ok(handler);
  handler?.({ payload: undefined });

  assert.deepEqual(calls, [1]);
});

// R25-Q：主窗现在也可能收到"工作台自己发起的"这次广播（反过来同理）——payload 带 source，
// 回调必须把它原样透传给调用方，调用方（boot.ts 底部）据此决定要不要跳过 reload。
test("bindWorkbenchLoggedInListener forwards the payload's source field to the callback", () => {
  const sources: (string | undefined)[] = [];
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

  bindWorkbenchLoggedInListener((source) => sources.push(source), scope);
  handler?.({ payload: { source: "main" } });
  handler?.({ payload: { source: "workbench" } });
  handler?.({ payload: undefined });

  assert.deepEqual(sources, ["main", "workbench", undefined]);
});

// R25-Q：连接状态"单一真相"——工作台头部状态词只从 workhub-connection-changed 取值，这里钉死
// 订阅桥本身的降级/转发行为，与上面 workhub-logged-out/workhub-logged-in 两条既有测试同一套纪律。
test("bindWorkbenchConnectionChangedListener no-ops without a Tauri listen bridge instead of throwing", () => {
  const payloads: unknown[] = [];
  assert.doesNotThrow(() => bindWorkbenchConnectionChangedListener((payload) => payloads.push(payload), {}));
  assert.deepEqual(payloads, []);
});

test("bindWorkbenchConnectionChangedListener subscribes and forwards a parsed payload to the callback", () => {
  const payloads: unknown[] = [];
  let handler: ((event: { payload: unknown }) => void) | undefined;
  const scope = {
    __TAURI__: {
      event: {
        listen: (eventName: string, cb: (event: { payload: unknown }) => void) => {
          assert.equal(eventName, "workhub-connection-changed");
          handler = cb;
          return () => {};
        }
      }
    }
  };

  bindWorkbenchConnectionChangedListener((payload) => payloads.push(payload), scope);
  assert.ok(handler);
  handler?.({
    payload: { state: "reconnecting", server_url: "http://127.0.0.1:8787", since_ms: 1_000, attempt: 2 }
  });

  assert.deepEqual(payloads, [
    { state: "reconnecting", server_url: "http://127.0.0.1:8787", since_ms: 1_000, attempt: 2 }
  ]);
});

test("bindWorkbenchConnectionChangedListener drops a malformed payload without calling the callback", () => {
  const payloads: unknown[] = [];
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

  bindWorkbenchConnectionChangedListener((payload) => payloads.push(payload), scope);
  handler?.({ payload: { state: "not-a-real-state", server_url: "http://127.0.0.1:8787", since_ms: 1_000, attempt: 0 } });
  handler?.({ payload: undefined });

  assert.deepEqual(payloads, []);
});

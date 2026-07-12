import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bindWorkbenchDeepLinkListener,
  clientToken,
  isWorkbenchDesktopLoggedOut,
  resolveWorkbenchApiBase,
  resolveWorkbenchTauriListen
} from "./boot.js";

function fakeStorage(values: Record<string, string> = {}): Pick<Storage, "getItem"> {
  return { getItem: (key: string) => values[key] ?? null };
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

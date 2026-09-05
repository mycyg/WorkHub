import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";

import {
  describeDesktopRebindError,
  renderDesktopRebindScreenHtml,
  runDesktopRebind,
  type DesktopRebindClient
} from "./desktop-rebind.js";
import { isDesktopFirstRun } from "./desktop-first-run.js";

// DSK-01：登出后的「输入昵称重新绑定这台设备」屏。这个 workspace 的测试运行器没有真实 DOM
//（node --import tsx --test）——只测纯渲染字符串 + 纯编排逻辑，bindDesktopRebindScreen 的 DOM 接线
// 不在此单测（同 desktop-login.test.ts / browser-offline-card.test.ts 的既有取舍）。

function fakeReadWriteStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const removed: string[] = [];
  return {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
        removed.push(key);
      }
    },
    values,
    removed
  };
}

function fakeRebindClient(calls: Array<unknown>): DesktopRebindClient {
  return {
    bootstrapDesktop: async (payload) => {
      calls.push(payload);
      return {
        identity: {
          id: "u1",
          nickname: "alice",
          display_name: "alice",
          created: false,
          locale: "zh-CN",
          preferences: { locale: "zh-CN" },
          is_admin: false,
          availability_status: "online"
        },
        device: {
          id: "d1",
          user_id: "u1",
          device_name: "WorkHub Desktop",
          platform: "desktop",
          created_at: "2026-08-19T00:00:00.000Z",
          updated_at: "2026-08-19T00:00:00.000Z"
        },
        client_token: "device-token-that-is-long-enough-000000"
      };
    }
  };
}

test("renderDesktopRebindScreenHtml renders the nickname re-bind form (logged-out state)", () => {
  const html = renderDesktopRebindScreenHtml({ locale: "zh-CN" });
  // 昵称输入 + 提交按钮 + 错误行 + 表单挂钩。
  assert.match(html, /data-desktop-rebind-nickname/u);
  assert.match(html, /data-desktop-rebind/u);
  assert.match(html, /data-desktop-rebind-error/u);
  assert.match(html, /data-desktop-rebind-form/u);
  // 中文文案：已登出 + 重新绑定这台设备。
  assert.match(html, /已登出/u);
  assert.match(html, /重新绑定这台设备/u);
});

test("renderDesktopRebindScreenHtml localizes to English and can seed a visible error", () => {
  const html = renderDesktopRebindScreenHtml({ locale: "en-US", error: "Sign-in failed — check the backend connection and retry." });
  assert.match(html, /Signed out/u);
  assert.match(html, /re-bind this device/u);
  assert.match(html, /Sign in/u);
  // 预置错误可见（不 hidden），且写进 aria-live 错误行。
  assert.match(html, /data-desktop-rebind-error[^>]*role="alert"/u);
  assert.match(html, /Sign-in failed/u);
  assert.doesNotMatch(html, /data-desktop-rebind-error hidden/u);
});

test("runDesktopRebind bootstraps with the entered nickname, stores the token and clears the logged-out flag", async () => {
  const calls: Array<unknown> = [];
  const { storage, values, removed } = fakeReadWriteStorage({ workhub_desktop_logged_out: "1" });

  const result = await runDesktopRebind({
    client: fakeRebindClient(calls),
    nickname: "  alice  ",
    storage
  });

  assert.equal(result.client_token, "device-token-that-is-long-enough-000000");
  // 昵称去空白后提交给 desktop-bootstrap（identify + 设备注册一步到位）。
  assert.deepEqual(calls, [{ nickname: "alice", device_name: "WorkHub Desktop", platform: "desktop" }]);
  // 令牌落库；登出标记被清（重新绑定成功后不该再停在登出态）。
  assert.equal(values.get("workhub_client_token"), "device-token-that-is-long-enough-000000");
  assert.ok(removed.includes("workhub_desktop_logged_out"));
});

test("runDesktopRebind rejects an empty nickname without calling bootstrap", async () => {
  const calls: Array<unknown> = [];
  const { storage } = fakeReadWriteStorage();

  await assert.rejects(() =>
    runDesktopRebind({ client: fakeRebindClient(calls), nickname: "   ", storage })
  );
  assert.equal(calls.length, 0, "empty nickname must not hit the network");
});

test("runDesktopRebind propagates a backend failure and does not clear the logged-out flag", async () => {
  const client: DesktopRebindClient = {
    bootstrapDesktop: async () => {
      throw new WorkHubApiError(500, "server_error", "boom");
    }
  };
  const { storage, values, removed } = fakeReadWriteStorage({ workhub_desktop_logged_out: "1" });

  await assert.rejects(() =>
    runDesktopRebind({ client, nickname: "alice", storage })
  );
  assert.equal(values.get("workhub_client_token"), undefined, "no token stored on failed re-bind");
  assert.equal(removed.includes("workhub_desktop_logged_out"), false, "logged-out flag stays on failure");
});

test("runDesktopRebind fails loudly when bootstrap returns no client token", async () => {
  const client = {
    bootstrapDesktop: async () => ({ client_token: "" })
  } as unknown as DesktopRebindClient;
  const { storage, values } = fakeReadWriteStorage();

  await assert.rejects(() =>
    runDesktopRebind({ client, nickname: "alice", storage })
  );
  assert.equal(values.get("workhub_client_token"), undefined);
});

test("describeDesktopRebindError returns a retryable, non-leaky message", () => {
  assert.match(describeDesktopRebindError(new WorkHubApiError(500, "server_error", "x"), "zh-CN"), /登录失败/u);
  assert.match(describeDesktopRebindError(new Error("Failed to fetch"), "en-US"), /check the backend connection/u);
});

// —— R24 S4：首启（first-run）复用同一张屏，只换标题/说明 —— //

test("renderDesktopRebindScreenHtml defaults to the signed-out copy and swaps to first-run welcome copy on request", () => {
  const loggedOut = renderDesktopRebindScreenHtml({ locale: "en-US" });
  assert.match(loggedOut, /Signed out/u);
  assert.match(loggedOut, /re-bind this device/u);

  const loggedOutExplicit = renderDesktopRebindScreenHtml({ locale: "en-US", context: "logged-out" });
  assert.match(loggedOutExplicit, /Signed out/u);

  const firstRun = renderDesktopRebindScreenHtml({ locale: "en-US", context: "first-run" });
  assert.match(firstRun, /Welcome to WorkHub/u);
  assert.doesNotMatch(firstRun, /Signed out/u);
  // 表单挂钩不随 context 变——同一套 DOM 接线服务两种上下文。
  assert.match(firstRun, /data-desktop-rebind-nickname/u);
  assert.match(firstRun, /data-desktop-rebind-form/u);

  const firstRunZh = renderDesktopRebindScreenHtml({ locale: "zh-CN", context: "first-run" });
  assert.match(firstRunZh, /欢迎使用 WorkHub/u);
});

// —— R24 S4：runDesktopRebind 落首启标记（供 Spotlight 落地页判定「建你的第一个项目」卡） —— //

test("runDesktopRebind marks the first-run identity flag when desktop-bootstrap reports a freshly created user", async () => {
  const calls: Array<unknown> = [];
  const client: DesktopRebindClient = {
    bootstrapDesktop: async (payload) => {
      calls.push(payload);
      return {
        identity: {
          id: "u9",
          nickname: "dana",
          display_name: "dana",
          created: true,
          locale: "zh-CN",
          preferences: { locale: "zh-CN" },
          is_admin: false,
          availability_status: "online"
        },
        device: {
          id: "d9",
          user_id: "u9",
          device_name: "WorkHub Desktop",
          platform: "desktop",
          created_at: "2026-09-05T00:00:00.000Z",
          updated_at: "2026-09-05T00:00:00.000Z"
        },
        client_token: "device-token-that-is-long-enough-333333"
      };
    }
  };
  const { storage } = fakeReadWriteStorage();

  const result = await runDesktopRebind({ client, nickname: "dana", storage });

  assert.equal(result.created, true);
  assert.equal(isDesktopFirstRun(storage), true);
});

test("runDesktopRebind does not mark first-run when the nickname resolves to an existing account", async () => {
  const { storage } = fakeReadWriteStorage({ workhub_desktop_identity_created: "1" });

  const result = await runDesktopRebind({ client: fakeRebindClient([]), nickname: "alice", storage });

  assert.equal(result.created, false);
  // 复用已有账号：即便这台设备之前残留过一个（可能属于另一个昵称的）首启标记，也要如实清掉——
  // 这个账号是不是真的第一次用，以这次探明的事实为准，不能让陈旧标记继续误导落地页。
  assert.equal(isDesktopFirstRun(storage), false);
});

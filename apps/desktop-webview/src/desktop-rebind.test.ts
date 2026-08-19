import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";

import {
  describeDesktopRebindError,
  renderDesktopRebindScreenHtml,
  runDesktopRebind,
  type DesktopRebindClient
} from "./desktop-rebind.js";

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

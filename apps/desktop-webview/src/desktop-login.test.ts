import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";

import {
  describeDesktopLoginError,
  isPasswordModeBootstrapError,
  readDesktopAuthModeHint,
  rememberDesktopAuthModeHint,
  renderDesktopCredentialGateHtml,
  runDesktopCredentialLogin,
  type DesktopLoginClient
} from "./desktop-login.js";

// 这个 workspace 的测试运行器没有真实 DOM（node --import tsx --test）——只测纯渲染字符串 + 纯编排逻辑，
// bindDesktopCredentialGate 的 DOM 接线不在此单测（同 desktop-offline-card 只测 renderXHtml 的取舍）。

function fakeReadWriteStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const removed: string[] = [];
  const set: Array<[string, string]> = [];
  return {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
        set.push([key, value]);
      },
      removeItem: (key: string) => {
        values.delete(key);
        removed.push(key);
      }
    },
    values,
    removed,
    set
  };
}

test("renderDesktopCredentialGateHtml renders an email + password credential form (password mode)", () => {
  const html = renderDesktopCredentialGateHtml({ locale: "zh-CN" });
  // 邮箱 + 密码字段可挂钩；密码用 type=password（不明文回显）。
  assert.match(html, /data-desktop-login-email[^>]+type="email"/u);
  assert.match(html, /data-desktop-login-password[^>]+type="password"/u);
  assert.match(html, /data-desktop-login-submit/u);
  assert.match(html, /data-desktop-login-error/u);
  assert.match(html, /data-desktop-login-form/u);
  // 中文文案。
  assert.match(html, /登录/u);
  assert.match(html, /密码/u);
});

test("renderDesktopCredentialGateHtml localizes to English and can seed a visible error", () => {
  const html = renderDesktopCredentialGateHtml({ locale: "en-US", error: "Email or password is incorrect." });
  assert.match(html, /Password/u);
  assert.match(html, /Sign in/u);
  // 预置错误可见（不 hidden），且被 HTML 转义写入错误行。
  assert.match(html, /data-desktop-login-error[^>]*role="alert"/u);
  assert.match(html, /Email or password is incorrect\./u);
  assert.doesNotMatch(html, /data-desktop-login-error hidden/u);
});

test("isPasswordModeBootstrapError detects the desktop-bootstrap 404 (password mode) and nothing else", () => {
  assert.equal(isPasswordModeBootstrapError(new WorkHubApiError(404, "not_found", "n/a")), true);
  assert.equal(isPasswordModeBootstrapError(new WorkHubApiError(403, "forbidden", "n/a")), false);
  assert.equal(isPasswordModeBootstrapError(new WorkHubApiError(500, "server_error", "n/a")), false);
  assert.equal(isPasswordModeBootstrapError(new Error("Failed to fetch")), false);
  assert.equal(isPasswordModeBootstrapError(undefined), false);
});

test("runDesktopCredentialLogin logs in, exchanges for a device token, stores it and clears the logged-out flag", async () => {
  const calls: { login?: unknown; bootstrap?: unknown } = {};
  const client: DesktopLoginClient = {
    login: async (payload) => {
      calls.login = payload;
      return {
        id: "u1",
        nickname: "alice",
        display_name: "alice",
        created: false,
        locale: "zh-CN",
        preferences: { locale: "zh-CN" },
        is_admin: false,
        availability_status: "online"
      };
    },
    bootstrapDesktop: async (payload) => {
      calls.bootstrap = payload;
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
          created_at: "2026-07-17T00:00:00.000Z",
          updated_at: "2026-07-17T00:00:00.000Z"
        },
        client_token: "device-token-that-is-long-enough-000000"
      };
    }
  };
  const { storage, values, removed } = fakeReadWriteStorage({ workhub_desktop_logged_out: "1" });

  const result = await runDesktopCredentialLogin({
    client,
    credentials: { email: "  alice@example.com  ", password: "hunter2-strong-pass" },
    storage
  });

  assert.equal(result.client_token, "device-token-that-is-long-enough-000000");
  // 邮箱去空白后作为请求体传给 login；密码原样（明文只走请求体）。
  assert.deepEqual(calls.login, { email: "alice@example.com", password: "hunter2-strong-pass" });
  // exchange 调 bootstrapDesktop（密码模式据会话换令牌）。
  assert.ok(calls.bootstrap, "must call bootstrapDesktop to exchange the session for a device token");
  // 令牌落库；登出标记被清（成功登录后不该再停在登出态）。
  assert.equal(values.get("workhub_client_token"), "device-token-that-is-long-enough-000000");
  assert.ok(removed.includes("workhub_desktop_logged_out"));
});

test("runDesktopCredentialLogin propagates a bad-credentials error and does not store a token", async () => {
  const client: DesktopLoginClient = {
    login: async () => {
      throw new WorkHubApiError(401, "auth_error", "邮箱或密码不正确");
    },
    bootstrapDesktop: async () => {
      throw new Error("must not reach exchange when login fails");
    }
  };
  const { storage, values } = fakeReadWriteStorage();

  await assert.rejects(
    () =>
      runDesktopCredentialLogin({
        client,
        credentials: { email: "alice@example.com", password: "wrong" },
        storage
      }),
    (error) => error instanceof WorkHubApiError && error.status === 401
  );
  assert.equal(values.get("workhub_client_token"), undefined, "no token stored on failed login");
});

test("runDesktopCredentialLogin fails loudly when the exchange returns no client token", async () => {
  const client = {
    login: async () => ({
      id: "u1",
      nickname: "alice",
      display_name: "alice",
      created: false,
      locale: "zh-CN" as const,
      preferences: { locale: "zh-CN" as const },
      is_admin: false,
      availability_status: "online"
    }),
    bootstrapDesktop: async () => ({ client_token: "" }) as never
  } as unknown as DesktopLoginClient;
  const { storage, values } = fakeReadWriteStorage();

  await assert.rejects(() =>
    runDesktopCredentialLogin({
      client,
      credentials: { email: "alice@example.com", password: "hunter2-strong-pass" },
      storage
    })
  );
  assert.equal(values.get("workhub_client_token"), undefined);
});

test("describeDesktopLoginError maps backend statuses to retryable, non-leaky messages", () => {
  assert.match(describeDesktopLoginError(new WorkHubApiError(401, "auth_error", "x"), "zh-CN"), /不正确/u);
  assert.match(describeDesktopLoginError(new WorkHubApiError(429, "rate_limited", "x"), "en-US"), /Too many/u);
  assert.match(describeDesktopLoginError(new WorkHubApiError(404, "not_found", "x"), "en-US"), /isn't enabled/u);
  // 网络错误（非 WorkHubApiError）：通用连接错误提示，可重试。
  assert.match(describeDesktopLoginError(new Error("Failed to fetch"), "zh-CN"), /登录失败/u);
});

test("desktop auth-mode hint round-trips through storage and rejects junk", () => {
  const { storage } = fakeReadWriteStorage();
  assert.equal(readDesktopAuthModeHint(storage), null);
  rememberDesktopAuthModeHint(storage, "password");
  assert.equal(readDesktopAuthModeHint(storage), "password");
  rememberDesktopAuthModeHint(storage, "nickname");
  assert.equal(readDesktopAuthModeHint(storage), "nickname");
  storage.setItem("workhub_auth_mode", "bogus");
  assert.equal(readDesktopAuthModeHint(storage), null);
});

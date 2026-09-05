import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";

import {
  describeDesktopLoginError,
  desktopBootScreenForGate,
  forgetDesktopAuthModeHint,
  isPasswordModeBootstrapError,
  readDesktopAuthModeHint,
  rememberDesktopAuthModeHint,
  renderDesktopCredentialGateHtml,
  runDesktopBootstrapWithLock,
  runDesktopCredentialLogin,
  type DesktopLoginClient
} from "./desktop-login.js";

// 这个 workspace 的测试运行器没有真实 DOM（node --import tsx --test）——只测纯渲染字符串 + 纯编排逻辑，
// bindDesktopCredentialGate 的 DOM 接线不在此单测（同 desktop-rebind 只测 renderXHtml 的取舍）。

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

// —— DSK-07：跨窗启动锁（localStorage lease） —— //

function lockTestHarness(initial: Record<string, string> = {}) {
  const { storage, values } = fakeReadWriteStorage(initial);
  let now = 1_000;
  return {
    storage,
    values,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    sleep: async (ms: number) => {
      now += ms;
    }
  };
}

test("runDesktopBootstrapWithLock: first caller acquires, runs, and releases its own lock", async () => {
  const h = lockTestHarness();
  const runs: string[] = [];

  const result = await runDesktopBootstrapWithLock({
    storage: h.storage,
    readToken: () => undefined,
    run: async () => {
      runs.push("run");
      return "ready";
    },
    now: h.now,
    sleep: h.sleep
  });

  assert.deepEqual(result, { kind: "ran", result: "ready" });
  assert.deepEqual(runs, ["run"]);
  // 释放：锁不残留（别的窗口之后能正常抢）。
  assert.equal(h.values.get("workhub_desktop_bootstrap_lock"), undefined);
});

test("runDesktopBootstrapWithLock: loser of the lock polls and picks up the winner's token instead of re-running", async () => {
  const h = lockTestHarness();
  // 模拟胜者持有锁（新鲜）。
  h.storage.setItem("workhub_desktop_bootstrap_lock", `winner@${h.now() + 10_000}`);
  let polls = 0;
  const runs: string[] = [];

  const result = await runDesktopBootstrapWithLock({
    storage: h.storage,
    readToken: () => {
      polls += 1;
      // 第二次重读时胜者已落盘。
      return polls >= 2 ? "winner-token" : undefined;
    },
    run: async () => {
      runs.push("run");
      return "ready";
    },
    now: h.now,
    sleep: h.sleep,
    pollMs: 50
  });

  assert.deepEqual(result, { kind: "token-ready", token: "winner-token" });
  assert.deepEqual(runs, [], "loser must not bootstrap again");
  // 败者不碰别人的锁。
  assert.ok(h.values.get("workhub_desktop_bootstrap_lock")?.startsWith("winner@"));
});

test("runDesktopBootstrapWithLock: takes over an expired lock when the winner died without releasing", async () => {
  const h = lockTestHarness();
  // 胜者崩了：锁已过期、token 没落盘。
  h.storage.setItem("workhub_desktop_bootstrap_lock", `dead-winner@${h.now() - 1}`);
  const runs: string[] = [];

  const result = await runDesktopBootstrapWithLock({
    storage: h.storage,
    readToken: () => undefined,
    run: async () => {
      runs.push("run");
      return "ready";
    },
    now: h.now,
    sleep: h.sleep
  });

  assert.deepEqual(result, { kind: "ran", result: "ready" });
  assert.deepEqual(runs, ["run"]);
  assert.equal(h.values.get("workhub_desktop_bootstrap_lock"), undefined, "own lock released after takeover run");
});

test("runDesktopBootstrapWithLock: gives up as busy when the lock stays fresh and no token lands", async () => {
  const h = lockTestHarness();
  // 胜者持有锁且在整个等待窗口内保持新鲜。
  h.storage.setItem("workhub_desktop_bootstrap_lock", `winner@${h.now() + 60_000}`);
  let runs = 0;
  const result = await runDesktopBootstrapWithLock({
    storage: h.storage,
    readToken: () => undefined,
    run: async () => {
      runs += 1;
      return "ready";
    },
    now: h.now,
    sleep: (ms) => {
      h.advance(ms);
      return Promise.resolve();
    },
    waitMs: 500,
    pollMs: 100
  });

  assert.deepEqual(result, { kind: "busy" });
  assert.equal(runs, 0);
  // 败者不碰别人的锁。
  assert.ok(h.values.get("workhub_desktop_bootstrap_lock")?.startsWith("winner@"));
});

test("runDesktopBootstrapWithLock: run failure still releases the lock (TTL is only a backstop)", async () => {
  const h = lockTestHarness();
  await assert.rejects(() =>
    runDesktopBootstrapWithLock({
      storage: h.storage,
      readToken: () => undefined,
      run: async () => {
        throw new Error("backend offline");
      },
      now: h.now,
      sleep: h.sleep
    })
  );
  assert.equal(h.values.get("workhub_desktop_bootstrap_lock"), undefined);
});

// R24 S2：鉴权门 → 该渲哪一屏。主窗与工作台窗此前各写一遍 if 链并且已经漂移过——
// 两边都没有「连不上后端」分支，工作台连登出态分支也没有。这张表是唯一事实。
test("desktopBootScreenForGate routes every gate state, including the offline one both surfaces used to drop", () => {
  assert.equal(desktopBootScreenForGate("ready", "spotlight"), "mount");
  assert.equal(desktopBootScreenForGate("ready", "workbench"), "mount");

  assert.equal(desktopBootScreenForGate("needs-credentials", "spotlight"), "credential-gate");
  assert.equal(desktopBootScreenForGate("needs-credentials", "workbench"), "credential-gate");

  // 连不上后端：两个窗口都渲「连接到你的服务器」屏（此前主窗挂空聚焦盒、工作台直接挂外壳）。
  assert.equal(desktopBootScreenForGate("offline", "spotlight"), "connect-server");
  assert.equal(desktopBootScreenForGate("offline", "workbench"), "connect-server");

  // 登出态是唯一一处刻意的差异：主窗渲重新绑定屏，工作台交给外壳自己的「已登出」整窗态。
  assert.equal(desktopBootScreenForGate("logged-out", "spotlight"), "rebind");
  assert.equal(desktopBootScreenForGate("logged-out", "workbench"), "mount");
});

test("forgetDesktopAuthModeHint drops the previous server's mode hint and tolerates a broken storage", () => {
  const store = new Map<string, string>([["workhub_auth_mode", "password"]]);
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    }
  };
  forgetDesktopAuthModeHint(storage);
  assert.equal(readDesktopAuthModeHint(storage), null);

  assert.doesNotThrow(() =>
    forgetDesktopAuthModeHint({
      removeItem: () => {
        throw new Error("storage unavailable");
      }
    })
  );
});

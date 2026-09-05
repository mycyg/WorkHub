import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";

import {
  completeDesktopLoginSuccess,
  describeDesktopInviteError,
  describeDesktopLoginError,
  desktopBootScreenForGate,
  forgetDesktopAuthModeHint,
  describeDesktopRegisterError,
  isPasswordModeBootstrapError,
  probeDesktopAuthMode,
  readDesktopAuthModeHint,
  rememberDesktopAuthModeHint,
  renderDesktopCredentialGateHtml,
  resolveDesktopFirstRunGate,
  resolveDesktopFirstRunGateWithLock,
  runDesktopBootstrapWithLock,
  runDesktopCredentialLogin,
  runDesktopCredentialRegister,
  runDesktopInviteAccept,
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
    },
    register: async () => {
      throw new Error("login flow must not call register");
    },
    request: async () => {
      throw new Error("login flow must not call the raw request path");
    }
  };
  const { storage, values, removed } = fakeReadWriteStorage({ workhub_desktop_logged_out: "1" });

  const result = await runDesktopCredentialLogin({
    client,
    credentials: { email: "  alice@example.com  ", password: "hunter2-strong-pass" },
    locale: "zh-CN",
    storage
  });

  assert.equal(result.client_token, "device-token-that-is-long-enough-000000");
  // 邮箱去空白后作为请求体传给 login；密码原样（明文只走请求体）；login 没有 locale 字段（既有用户）。
  assert.deepEqual(calls.login, { email: "alice@example.com", password: "hunter2-strong-pass" });
  // exchange 调 bootstrapDesktop（密码模式据会话换令牌），仍带上 locale（R24 S4：四个 bootstrapDesktop
  // 调用点形状统一，密码模式该分支服务端忽略它）。
  assert.deepEqual(calls.bootstrap, {
    nickname: "WorkHub Desktop",
    device_name: "WorkHub Desktop",
    platform: "desktop",
    locale: "zh-CN"
  });
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
    },
    register: async () => {
      throw new Error("unused");
    },
    request: async () => {
      throw new Error("unused");
    }
  };
  const { storage, values } = fakeReadWriteStorage();

  await assert.rejects(
    () =>
      runDesktopCredentialLogin({
        client,
        credentials: { email: "alice@example.com", password: "wrong" },
        locale: "zh-CN",
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
      locale: "zh-CN",
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

// —— R24 S4：三页签凭据门渲染 —— //

test("renderDesktopCredentialGateHtml renders sign-in, register, and invite-token tabs with correct field types", () => {
  const html = renderDesktopCredentialGateHtml({ locale: "zh-CN" });
  // 三个页签按钮 + 三个表单面板。
  assert.match(html, /data-desktop-login-tab="signin"/u);
  assert.match(html, /data-desktop-login-tab="register"/u);
  assert.match(html, /data-desktop-login-tab="invite"/u);
  // 登录页签：既有字段原样保留（向后兼容）。
  assert.match(html, /data-desktop-login-email[^>]+type="email"/u);
  assert.match(html, /data-desktop-login-password[^>]+type="password"/u);
  assert.match(html, /data-desktop-login-submit/u);
  assert.match(html, /data-desktop-login-error/u);
  assert.match(html, /data-desktop-login-form/u);
  // 注册页签：邮箱 + 昵称 + 密码。
  assert.match(html, /data-desktop-register-email[^>]+type="email"/u);
  assert.match(html, /data-desktop-register-nickname/u);
  assert.match(html, /data-desktop-register-password[^>]+type="password"/u);
  assert.match(html, /data-desktop-register-submit/u);
  assert.match(html, /data-desktop-register-error/u);
  // 邀请页签：令牌 + 昵称 + 密码。
  assert.match(html, /data-desktop-invite-token/u);
  assert.match(html, /data-desktop-invite-nickname/u);
  assert.match(html, /data-desktop-invite-password[^>]+type="password"/u);
  assert.match(html, /data-desktop-invite-submit/u);
  assert.match(html, /data-desktop-invite-error/u);
  // 登录仍是默认可见页签（其余两个 hidden）。
  assert.match(html, /data-desktop-login-panel="signin"[^>]*novalidate/u);
  assert.match(html, /data-desktop-register-form[^>]*data-desktop-login-panel="register" hidden/u);
  assert.match(html, /data-desktop-invite-form[^>]*data-desktop-login-panel="invite" hidden/u);
  // 中文文案。
  assert.match(html, /登录/u);
  assert.match(html, /密码/u);
});

test("renderDesktopCredentialGateHtml defaults to the signed-out copy and swaps to first-run welcome copy on request", () => {
  const loggedOut = renderDesktopCredentialGateHtml({ locale: "en-US" });
  assert.match(loggedOut, /Sign in to WorkHub/u);

  const loggedOutExplicit = renderDesktopCredentialGateHtml({ locale: "en-US", context: "logged-out" });
  assert.match(loggedOutExplicit, /Sign in to WorkHub/u);

  const firstRun = renderDesktopCredentialGateHtml({ locale: "en-US", context: "first-run" });
  assert.match(firstRun, /Welcome to WorkHub/u);
  assert.doesNotMatch(firstRun, /Sign in to WorkHub/u);

  const firstRunZh = renderDesktopCredentialGateHtml({ locale: "zh-CN", context: "first-run" });
  assert.match(firstRunZh, /欢迎使用 WorkHub/u);
});

test("renderDesktopCredentialGateHtml can still seed a visible sign-in error (existing behavior)", () => {
  const html = renderDesktopCredentialGateHtml({ locale: "en-US", error: "Email or password is incorrect." });
  assert.match(html, /data-desktop-login-error[^>]*role="alert"/u);
  assert.match(html, /Email or password is incorrect\./u);
  assert.doesNotMatch(html, /data-desktop-login-error hidden/u);
});

// —— R24 S4：首启模式探测（不再盲打 desktop-bootstrap，见 E-03） —— //

function fakeAuthModeProbeClient(response: unknown, error?: unknown) {
  return {
    request: async <T>() => {
      if (error) {
        throw error;
      }
      return response as T;
    }
  };
}

// R24 S5（N-02 根治）：probeDesktopAuthMode 现在回三态而不是一个可能是 null 的字符串——「可达 + 认识
// 的 mode」「可达 + 不认识/缺字段（老服务端）」「根本不可达」必须能互相区分,见 desktop-login.ts 顶注。
test("probeDesktopAuthMode reads a valid auth_mode off /api/health when reachable", async () => {
  assert.deepEqual(await probeDesktopAuthMode(fakeAuthModeProbeClient({ auth_mode: "password" })), {
    reachable: true,
    mode: "password"
  });
  assert.deepEqual(await probeDesktopAuthMode(fakeAuthModeProbeClient({ auth_mode: "hybrid" })), {
    reachable: true,
    mode: "hybrid"
  });
  assert.deepEqual(await probeDesktopAuthMode(fakeAuthModeProbeClient({ auth_mode: "nickname" })), {
    reachable: true,
    mode: "nickname"
  });
});

test("probeDesktopAuthMode is reachable but mode:null for a junk/missing field (old server that answers but doesn't know auth_mode)", async () => {
  assert.deepEqual(await probeDesktopAuthMode(fakeAuthModeProbeClient({ auth_mode: "bogus" })), {
    reachable: true,
    mode: null
  });
  assert.deepEqual(await probeDesktopAuthMode(fakeAuthModeProbeClient({})), { reachable: true, mode: null });
});

test("probeDesktopAuthMode reports reachable:false for a network error, a timeout, and a non-2xx status alike", async () => {
  assert.deepEqual(await probeDesktopAuthMode(fakeAuthModeProbeClient(undefined, new TypeError("Failed to fetch"))), {
    reachable: false
  });
  assert.deepEqual(
    await probeDesktopAuthMode(fakeAuthModeProbeClient(undefined, new WorkHubApiError(408, "request_timeout", "timed out"))),
    { reachable: false }
  );
  assert.deepEqual(
    await probeDesktopAuthMode(fakeAuthModeProbeClient(undefined, new WorkHubApiError(502, "http_error", "bad gateway"))),
    { reachable: false }
  );
});

test("resolveDesktopFirstRunGate trusts a remembered hint before probing the network", async () => {
  const { storage } = fakeReadWriteStorage({ workhub_auth_mode: "password" });
  let probed = false;
  const client = {
    request: async <T>() => {
      probed = true;
      return { auth_mode: "nickname" } as T;
    }
  };
  assert.equal(await resolveDesktopFirstRunGate({ client, storage }), "needs-credentials");
  assert.equal(probed, false, "a remembered hint must skip the network probe entirely");
});

test("resolveDesktopFirstRunGate probes and remembers password/hybrid as needing credentials", async () => {
  for (const mode of ["password", "hybrid"]) {
    const { storage, values } = fakeReadWriteStorage();
    const client = fakeAuthModeProbeClient({ auth_mode: mode });
    assert.equal(await resolveDesktopFirstRunGate({ client, storage }), "needs-credentials");
    assert.equal(values.get("workhub_auth_mode"), "password");
  }
});

test("resolveDesktopFirstRunGate probes and remembers nickname as the logged-out (rebind) gate", async () => {
  const { storage, values } = fakeReadWriteStorage();
  const client = fakeAuthModeProbeClient({ auth_mode: "nickname" });
  assert.equal(await resolveDesktopFirstRunGate({ client, storage }), "logged-out");
  assert.equal(values.get("workhub_auth_mode"), "nickname");
});

test("resolveDesktopFirstRunGate defaults to the nickname rebind screen when reachable but the server is too old to know auth_mode", async () => {
  const { storage, values } = fakeReadWriteStorage();
  const client = fakeAuthModeProbeClient({});
  assert.equal(await resolveDesktopFirstRunGate({ client, storage }), "logged-out");
  // 探测失败不落任何 hint——不确定的事不该被当成确定的记下来。
  assert.equal(values.get("workhub_auth_mode"), undefined);
});

// R24 S5（N-02 根治）：这是被真机复验揪出来的回归——旧代码把"根本连不上"跟上面那条"老服务端可达但
// 缺字段"混成同一个分支,都猜成 nickname,把用户扔进一张注定连不上的登录门。现在必须回 offline，
// 让 ensureDesktopClientToken/ensureWorkbenchClientToken 的既有兜底浮出连接服务器屏。
test("resolveDesktopFirstRunGate returns offline when the backend is unreachable (network error/timeout/non-2xx)", async () => {
  const { storage, values } = fakeReadWriteStorage();
  const client = fakeAuthModeProbeClient(undefined, new TypeError("Failed to fetch"));
  assert.equal(await resolveDesktopFirstRunGate({ client, storage }), "offline");
  // 不可达同样不落任何 hint——它甚至比"探到了但不认识"更不确定。
  assert.equal(values.get("workhub_auth_mode"), undefined);
});

test("resolveDesktopFirstRunGateWithLock adopts a sibling window's freshly-stored token instead of re-probing", async () => {
  const h = lockTestHarness();
  h.storage.setItem("workhub_desktop_bootstrap_lock", `winner@${h.now() + 10_000}`);
  let polls = 0;
  const client = {
    request: async () => {
      throw new Error("must not probe when a sibling window already holds the lock");
    }
  };
  const result = await resolveDesktopFirstRunGateWithLock({
    client,
    storage: h.storage,
    readToken: () => {
      polls += 1;
      return polls >= 2 ? "winner-token" : undefined;
    },
    now: h.now,
    sleep: h.sleep
  });
  assert.equal(result, "ready");
});

test("resolveDesktopFirstRunGateWithLock falls back to offline when the lock stays busy with no token", async () => {
  const h = lockTestHarness();
  h.storage.setItem("workhub_desktop_bootstrap_lock", `winner@${h.now() + 60_000}`);
  const client = { request: async <T>() => ({ auth_mode: "nickname" } as T) };
  const result = await resolveDesktopFirstRunGateWithLock({
    client,
    storage: h.storage,
    readToken: () => undefined,
    now: h.now,
    sleep: (ms: number) => {
      h.advance(ms);
      return Promise.resolve();
    },
    waitMs: 500,
    pollMs: 100
  });
  assert.equal(result, "offline");
});

// R24 S5（N-02 根治）：与上面那条不同——这里锁是空的（这扇窗口自己抢到并真的跑了探测），
// offline 来自 resolveDesktopFirstRunGate 本身探测不可达，不是锁超时兜底。两条路径都会落到同一个
// "offline"值,但走的是完全不同的代码分支,分开断言防止其中一条悄悄失效而不被发现。
test("resolveDesktopFirstRunGateWithLock propagates offline when this window wins the lock but the backend is unreachable", async () => {
  const h = lockTestHarness();
  const client = fakeAuthModeProbeClient(undefined, new TypeError("Failed to fetch"));
  const result = await resolveDesktopFirstRunGateWithLock({
    client,
    storage: h.storage,
    readToken: () => undefined,
    now: h.now,
    sleep: h.sleep
  });
  assert.equal(result, "offline");
});

// R24 S5（N-03 根治）：登录/重新绑定成功此前只 reload 发起动作的那一扇窗口——桌宠/工作台收不到任何
// 信号，本次会话内一直挂着旧状态装死。这条测试钉死顺序：先广播（跨窗事件，桌宠/工作台订阅后各自
// reload），再本窗 reload——顺序颠倒会让"本窗已经在 reload 路上、事件却还没发出去"这种竞态成为可能
// （虽然本窗即将卸载不受影响，但同一份 effects 未来若被复用到不 reload 的场景就会露馅）。
test("completeDesktopLoginSuccess broadcasts workhub-logged-in before reloading this window", () => {
  const order: string[] = [];
  completeDesktopLoginSuccess({
    broadcastLoggedIn: () => order.push("broadcast"),
    reload: () => order.push("reload")
  });
  assert.deepEqual(order, ["broadcast", "reload"]);
});

// —— R24 S4：注册页签 —— //

test("runDesktopCredentialRegister registers, exchanges for a device token, and marks the identity as freshly created", async () => {
  const calls: { register?: unknown; bootstrap?: unknown } = {};
  const client: DesktopLoginClient = {
    login: async () => {
      throw new Error("register flow must not call login");
    },
    register: async (payload) => {
      calls.register = payload;
      return {
        id: "u1",
        nickname: "bob",
        display_name: "bob",
        created: true,
        locale: "zh-CN",
        preferences: { locale: "zh-CN" },
        is_admin: true,
        availability_status: "online"
      };
    },
    bootstrapDesktop: async (payload) => {
      calls.bootstrap = payload;
      return {
        identity: {
          id: "u1",
          nickname: "bob",
          display_name: "bob",
          // 密码模式 exchange 分支恒回 created:false——不能拿这个当「是不是新用户」的信号（见函数顶注）。
          created: false,
          locale: "zh-CN",
          preferences: { locale: "zh-CN" },
          is_admin: true,
          availability_status: "online"
        },
        device: {
          id: "d1",
          user_id: "u1",
          device_name: "WorkHub Desktop",
          platform: "desktop",
          created_at: "2026-09-05T00:00:00.000Z",
          updated_at: "2026-09-05T00:00:00.000Z"
        },
        client_token: "device-token-that-is-long-enough-000000"
      };
    },
    request: async () => {
      throw new Error("register flow must not call the raw request path");
    }
  };
  const { storage, values, removed } = fakeReadWriteStorage({ workhub_desktop_logged_out: "1" });

  const result = await runDesktopCredentialRegister({
    client,
    registration: { email: "  bob@example.com  ", nickname: "  bob  ", password: "hunter2-strong-pass" },
    locale: "en-US",
    storage
  });

  assert.equal(result.client_token, "device-token-that-is-long-enough-000000");
  assert.equal(result.created, true);
  // register 总是新建用户——locale 直接落请求体（R24 S4，服务端 resolveNewUserLocale 优先用它）。
  assert.deepEqual(calls.register, {
    email: "bob@example.com",
    nickname: "bob",
    password: "hunter2-strong-pass",
    locale: "en-US"
  });
  assert.deepEqual(calls.bootstrap, {
    nickname: "WorkHub Desktop",
    device_name: "WorkHub Desktop",
    platform: "desktop",
    locale: "en-US"
  });
  assert.equal(values.get("workhub_client_token"), "device-token-that-is-long-enough-000000");
  assert.ok(removed.includes("workhub_desktop_logged_out"));
  // 首启标记：register 恒 created=true，落地页据此渲「建你的第一个项目」。
  assert.equal(values.get("workhub_desktop_identity_created"), "1");
});

test("runDesktopCredentialRegister propagates a duplicate-email conflict and does not store a token", async () => {
  const client: DesktopLoginClient = {
    login: async () => {
      throw new Error("unused");
    },
    register: async () => {
      throw new WorkHubApiError(409, "conflict", "该邮箱已注册");
    },
    bootstrapDesktop: async () => {
      throw new Error("must not reach exchange when register fails");
    },
    request: async () => {
      throw new Error("unused");
    }
  };
  const { storage, values } = fakeReadWriteStorage();

  await assert.rejects(
    () =>
      runDesktopCredentialRegister({
        client,
        registration: { email: "bob@example.com", nickname: "bob", password: "hunter2-strong-pass" },
        locale: "zh-CN",
        storage
      }),
    (error) => error instanceof WorkHubApiError && error.status === 409
  );
  assert.equal(values.get("workhub_client_token"), undefined);
  assert.equal(values.get("workhub_desktop_identity_created"), undefined);
});

test("describeDesktopRegisterError maps backend statuses to retryable, non-leaky messages", () => {
  assert.match(describeDesktopRegisterError(new WorkHubApiError(409, "conflict", "x"), "zh-CN"), /已注册/u);
  assert.match(describeDesktopRegisterError(new WorkHubApiError(400, "validation_error", "x"), "en-US"), /at least 8 characters/u);
  assert.match(describeDesktopRegisterError(new WorkHubApiError(429, "rate_limited", "x"), "en-US"), /Too many/u);
  assert.match(describeDesktopRegisterError(new WorkHubApiError(404, "not_found", "x"), "en-US"), /isn't enabled/u);
  assert.match(describeDesktopRegisterError(new Error("Failed to fetch"), "zh-CN"), /注册失败/u);
});

// —— R24 S4：我有邀请码页签 —— //

test("runDesktopInviteAccept posts the token/nickname/password to invites/accept, exchanges for a device token, and marks the identity as created", async () => {
  const calls: { request?: { path: string; body: unknown }; bootstrap?: unknown } = {};
  const client: DesktopLoginClient = {
    login: async () => {
      throw new Error("unused");
    },
    register: async () => {
      throw new Error("unused");
    },
    bootstrapDesktop: async (payload) => {
      calls.bootstrap = payload;
      return {
        identity: {
          id: "u2",
          nickname: "carol",
          display_name: "carol",
          created: false,
          locale: "zh-CN",
          preferences: { locale: "zh-CN" },
          is_admin: false,
          availability_status: "online"
        },
        device: {
          id: "d2",
          user_id: "u2",
          device_name: "WorkHub Desktop",
          platform: "desktop",
          created_at: "2026-09-05T00:00:00.000Z",
          updated_at: "2026-09-05T00:00:00.000Z"
        },
        client_token: "device-token-that-is-long-enough-111111"
      };
    },
    request: async <T>(path: string, init?: RequestInit) => {
      calls.request = { path, body: init?.body ? JSON.parse(init.body as string) : undefined };
      return {
        id: "u2",
        nickname: "carol",
        display_name: "carol",
        created: true,
        locale: "zh-CN",
        preferences: { locale: "zh-CN" },
        is_admin: false,
        availability_status: "online"
      } as T;
    }
  };
  const { storage, values, removed } = fakeReadWriteStorage({ workhub_desktop_logged_out: "1" });

  const result = await runDesktopInviteAccept({
    client,
    invite: { token: "  invite-token-abc  ", nickname: "  carol  ", password: "hunter2-strong-pass" },
    locale: "en-US",
    storage
  });

  assert.equal(result.client_token, "device-token-that-is-long-enough-111111");
  assert.equal(result.created, true);
  assert.equal(calls.request?.path, "/api/auth/invites/accept");
  // 接受邀请总是新建用户——locale 直接落请求体（R24 S4，服务端 resolveNewUserLocale 优先用它）。
  assert.deepEqual(calls.request?.body, {
    token: "invite-token-abc",
    nickname: "carol",
    password: "hunter2-strong-pass",
    locale: "en-US"
  });
  assert.deepEqual(calls.bootstrap, {
    nickname: "WorkHub Desktop",
    device_name: "WorkHub Desktop",
    platform: "desktop",
    locale: "en-US"
  });
  assert.equal(values.get("workhub_client_token"), "device-token-that-is-long-enough-111111");
  assert.ok(removed.includes("workhub_desktop_logged_out"));
  assert.equal(values.get("workhub_desktop_identity_created"), "1");
});

test("runDesktopInviteAccept propagates an expired/invalid invite error and does not store a token", async () => {
  const client: DesktopLoginClient = {
    login: async () => {
      throw new Error("unused");
    },
    register: async () => {
      throw new Error("unused");
    },
    bootstrapDesktop: async () => {
      throw new Error("must not reach exchange when invite accept fails");
    },
    request: async () => {
      throw new WorkHubApiError(404, "not_found", "邀请无效或已过期");
    }
  };
  const { storage, values } = fakeReadWriteStorage();

  await assert.rejects(
    () =>
      runDesktopInviteAccept({
        client,
        invite: { token: "expired", nickname: "carol", password: "hunter2-strong-pass" },
        locale: "zh-CN",
        storage
      }),
    (error) => error instanceof WorkHubApiError && error.status === 404
  );
  assert.equal(values.get("workhub_client_token"), undefined);
});

test("describeDesktopInviteError maps backend statuses to retryable, non-leaky messages", () => {
  assert.match(describeDesktopInviteError(new WorkHubApiError(404, "not_found", "x"), "zh-CN"), /无效或已过期/u);
  assert.match(describeDesktopInviteError(new WorkHubApiError(409, "conflict", "x"), "en-US"), /already registered/u);
  assert.match(describeDesktopInviteError(new WorkHubApiError(422, "validation_error", "x"), "en-US"), /at least 8 characters/u);
  assert.match(describeDesktopInviteError(new Error("Failed to fetch"), "zh-CN"), /接受邀请失败/u);
});

test("runDesktopCredentialLogin does not touch the first-run identity marker either way (signing in is never a first run)", async () => {
  const client: DesktopLoginClient = {
    login: async () => ({
      id: "u1",
      nickname: "alice",
      display_name: "alice",
      created: false,
      locale: "zh-CN",
      preferences: { locale: "zh-CN" },
      is_admin: false,
      availability_status: "online"
    }),
    register: async () => {
      throw new Error("unused");
    },
    bootstrapDesktop: async () => ({
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
        created_at: "2026-09-05T00:00:00.000Z",
        updated_at: "2026-09-05T00:00:00.000Z"
      },
      client_token: "device-token-that-is-long-enough-222222"
    }),
    request: async () => {
      throw new Error("unused");
    }
  };
  const { storage, values } = fakeReadWriteStorage({ workhub_desktop_identity_created: "1" });

  await runDesktopCredentialLogin({
    client,
    credentials: { email: "alice@example.com", password: "hunter2-strong-pass" },
    locale: "zh-CN",
    storage
  });

  // 标记原样留着——login 不是首次注册，但也不该替用户清掉一个可能仍然有效的"还没建过项目"事实。
  assert.equal(values.get("workhub_desktop_identity_created"), "1");
});

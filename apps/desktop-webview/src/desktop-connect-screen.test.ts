import assert from "node:assert/strict";
import test from "node:test";

import type { HealthResponse } from "@workhub/api-client";

import {
  applyDesktopServerChoice,
  bindDesktopConnectScreen,
  bindDesktopServerChangedReload,
  createDesktopServerChoiceEffects,
  DESKTOP_SERVER_CHANGED_EVENT,
  desktopConnectResultHtml,
  probeDesktopServer,
  renderDesktopConnectScreenHtml,
  type DesktopServerChoiceEffects
} from "./desktop-connect-screen.js";

function health(overrides: Partial<HealthResponse> = {}): HealthResponse {
  return {
    ok: true,
    service: "workhub-api",
    env: "production",
    runtime: "node",
    port: 8787,
    ai_provider_configured: true,
    auth_mode: "nickname",
    version: "0.1.0",
    instance_name: "研发一组",
    ...overrides
  } as HealthResponse;
}

// --- 渲染 -------------------------------------------------------------------

test("renderDesktopConnectScreenHtml prefills the current address and disables confirm until a test succeeds", () => {
  const html = renderDesktopConnectScreenHtml({ locale: "zh-CN", apiBase: "http://192.168.1.10:8787" });
  assert.match(html, /data-desktop-connect-form/u);
  assert.match(html, /data-desktop-connect-address[^>]+value="http:\/\/192\.168\.1\.10:8787"/u);
  assert.match(html, /data-desktop-connect-test/u);
  // C2：显式确认按钮初始禁用——探测通过之前不可能"顺手"换掉服务器。
  assert.match(html, /data-desktop-connect-confirm[^>]+disabled/u);
  assert.match(html, /连接到你的服务器/u);
  // C2 对用户讲明白：地址只从这里手敲。
  assert.match(html, /不会从链接、剪贴板/u);
});

test("renderDesktopConnectScreenHtml falls back to the local default address and localizes to English", () => {
  const html = renderDesktopConnectScreenHtml({ locale: "en-US" });
  assert.match(html, /Connect to your server/u);
  assert.match(html, /Test connection/u);
  assert.match(html, /Use this server/u);
  assert.match(html, /value="http:\/\/127\.0\.0\.1:8787"/u);
});

test("renderDesktopConnectScreenHtml folds the boot error into a details block instead of dropping it", () => {
  const html = renderDesktopConnectScreenHtml({
    locale: "zh-CN",
    apiBase: "http://127.0.0.1:8787",
    detail: "TypeError: Failed to <fetch>"
  });
  assert.match(html, /data-desktop-connect-boot-detail/u);
  // 原始错误必须转义后写入，不允许原样注入标签。
  assert.match(html, /Failed to &lt;fetch&gt;/u);
});

test("desktopConnectResultHtml shows server name, version, sign-in mode and AI status on success", () => {
  const html = desktopConnectResultHtml(
    { kind: "ready", base: "http://192.168.1.10:8787", health: health() },
    "zh-CN"
  );
  assert.match(html, /连上了：研发一组/u);
  assert.match(html, /0\.1\.0/u);
  assert.match(html, /昵称登录/u);
  assert.match(html, /已配置/u);
  assert.match(html, /http:\/\/192\.168\.1\.10:8787/u);
});

test("desktopConnectResultHtml degrades to a plain unknown label when an older server omits the new fields", () => {
  const stale = { ok: true, service: "workhub-api", runtime: "node", port: 8787, ai_provider_configured: false } as HealthResponse;
  const html = desktopConnectResultHtml({ kind: "ready", base: "http://127.0.0.1:8787", health: stale }, "zh-CN");
  // 缺 instance_name → 退回产品名，不渲空标题。
  assert.match(html, /连上了：WorkHub/u);
  assert.match(html, /这台服务器没说/u);
  // AI 没配置这件事必须说出来（自托管最常见的静默死）。
  assert.match(html, /Cuu 不会回应/u);
});

test("desktopConnectResultHtml states the failure in plain words and keeps the raw error foldable", () => {
  const invalid = desktopConnectResultHtml({ kind: "invalid-address" }, "zh-CN");
  assert.match(invalid, /http:\/\/ 或 https:\/\//u);

  const unreachable = desktopConnectResultHtml(
    { kind: "unreachable", base: "http://192.168.1.10:8787", detail: "TypeError: Failed to fetch" },
    "zh-CN"
  );
  assert.match(unreachable, /连不上这个地址/u);
  assert.match(unreachable, /TypeError: Failed to fetch/u);

  const notWorkHub = desktopConnectResultHtml(
    { kind: "not-workhub", base: "http://192.168.1.10:80", detail: "unexpected health payload: {}" },
    "en-US"
  );
  assert.match(notWorkHub, /not a WorkHub server/u);
});

// --- 探测 -------------------------------------------------------------------

test("probeDesktopServer rejects malformed addresses without sending any request", async () => {
  let called = 0;
  for (const raw of ["", "   ", "not-a-url", "javascript:fetch('x')", "http://user:pass@host", "http://host?x=1"]) {
    const outcome = await probeDesktopServer({
      raw,
      probe: async () => {
        called += 1;
        return health();
      }
    });
    assert.equal(outcome.kind, "invalid-address", `expected ${raw} to be rejected`);
  }
  assert.equal(called, 0, "an invalid address must never reach the network");
});

test("probeDesktopServer normalizes the address before probing and reports the healthy server", async () => {
  let probed: string | undefined;
  const outcome = await probeDesktopServer({
    raw: "  https://workhub.example.com/  ",
    probe: async (base) => {
      probed = base;
      return health({ auth_mode: "password", instance_name: "公司服务器" });
    }
  });
  assert.equal(probed, "https://workhub.example.com");
  assert.equal(outcome.kind, "ready");
  assert.equal(outcome.kind === "ready" ? outcome.base : undefined, "https://workhub.example.com");
  assert.equal(outcome.kind === "ready" ? outcome.health.instance_name : undefined, "公司服务器");
});

test("probeDesktopServer separates 'cannot reach' from 'answered but is not WorkHub'", async () => {
  const unreachable = await probeDesktopServer({
    raw: "http://192.168.1.10:8787",
    probe: async () => {
      throw new TypeError("Failed to fetch");
    }
  });
  assert.equal(unreachable.kind, "unreachable");
  assert.match(unreachable.kind === "unreachable" ? unreachable.detail : "", /Failed to fetch/u);

  const foreign = await probeDesktopServer({
    raw: "http://192.168.1.10:80",
    probe: async () => ({ ok: true, service: "nginx" }) as unknown as HealthResponse
  });
  assert.equal(foreign.kind, "not-workhub");
});

// --- 确认顺序（C3） ---------------------------------------------------------

function recordingEffects(overrides: Partial<DesktopServerChoiceEffects> = {}) {
  const order: string[] = [];
  const effects: DesktopServerChoiceEffects = {
    clearIdentity: () => {
      order.push("clearIdentity");
    },
    rememberServer: () => {
      order.push("rememberServer");
    },
    notifyShell: async () => {
      order.push("notifyShell");
      return { url: "http://192.168.1.10:8787" };
    },
    ...overrides
  };
  return { order, effects };
}

test("applyDesktopServerChoice clears the identity before writing the address and only then tells the shell", async () => {
  const { order, effects } = recordingEffects();
  const result = await applyDesktopServerChoice("http://192.168.1.10:8787", effects, health());
  // C3：顺序即安全属性——A 服务器的令牌绝不能在地址切过去之后还留着。
  assert.deepEqual(order, ["clearIdentity", "rememberServer", "notifyShell"]);
  assert.deepEqual(result, { base: "http://192.168.1.10:8787", shellAccepted: true, unchanged: false });
});

// R24 S5（N-07 根治）：真机复验发现——设置页「更换服务器」哪怕选中的地址和当前一模一样，也照样
// 清令牌+通知壳层（涨 endpoint generation），把「点错了再点一次」变成一次货真价实的掉线重登。
test("applyDesktopServerChoice short-circuits (no clearIdentity/rememberServer/notifyShell) when the address is unchanged", async () => {
  const { order, effects } = recordingEffects();
  const result = await applyDesktopServerChoice(
    "http://192.168.1.10:8787",
    effects,
    health(),
    "http://192.168.1.10:8787"
  );
  assert.deepEqual(order, []);
  assert.deepEqual(result, { base: "http://192.168.1.10:8787", shellAccepted: true, unchanged: true });
});

test("applyDesktopServerChoice treats a currentBase that only differs by a trailing slash as unchanged", async () => {
  const { order, effects } = recordingEffects();
  const result = await applyDesktopServerChoice(
    "http://192.168.1.10:8787",
    effects,
    health(),
    "http://192.168.1.10:8787/"
  );
  assert.deepEqual(order, []);
  assert.equal(result.unchanged, true);
});

test("applyDesktopServerChoice still runs the full switch when currentBase genuinely differs", async () => {
  const { order, effects } = recordingEffects();
  const result = await applyDesktopServerChoice(
    "http://192.168.1.10:8787",
    effects,
    health(),
    "http://127.0.0.1:8787"
  );
  assert.deepEqual(order, ["clearIdentity", "rememberServer", "notifyShell"]);
  assert.equal(result.unchanged, false);
});

test("applyDesktopServerChoice still switches the webview side when the shell command is missing", async () => {
  const { order, effects } = recordingEffects({
    notifyShell: async () => {
      order.push("notifyShell");
      throw new Error("command set_server_url not found");
    }
  });
  const result = await applyDesktopServerChoice("http://192.168.1.10:8787", effects);
  assert.deepEqual(order, ["clearIdentity", "rememberServer", "notifyShell"]);
  assert.equal(result.shellAccepted, false);
});

test("createDesktopServerChoiceEffects clears both token keys, rewrites the auth-mode hint and invokes set_server_url", async () => {
  const store = new Map<string, string>([
    ["workhub_client_token", "server-a-token"],
    ["yqgl_client_token", "legacy-token"],
    ["workhub_auth_mode", "password"]
  ]);
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const effects = createDesktopServerChoiceEffects({
    storage: {
      setItem: (key, value) => {
        store.set(key, value);
      },
      removeItem: (key) => {
        store.delete(key);
      }
    },
    invoke: (command, args) => {
      invoked.push({ command, ...(args ? { args } : {}) });
      return Promise.resolve({ url: "http://192.168.1.10:8787" });
    }
  });

  await applyDesktopServerChoice("http://192.168.1.10:8787", effects, health({ auth_mode: "nickname" }));

  assert.equal(store.has("workhub_client_token"), false);
  assert.equal(store.has("yqgl_client_token"), false);
  // 新服务器是昵称模式：提示直接落准确值，不再留着 A 服务器的 password。
  assert.equal(store.get("workhub_auth_mode"), "nickname");
  assert.equal(store.get("workhub_api_base"), "http://192.168.1.10:8787");
  assert.deepEqual(invoked, [
    { command: "set_server_url", args: { url: "http://192.168.1.10:8787" } }
  ]);
});

test("createDesktopServerChoiceEffects drops a stale auth-mode hint when the new server does not report one", async () => {
  const store = new Map<string, string>([["workhub_auth_mode", "password"]]);
  const effects = createDesktopServerChoiceEffects({
    storage: {
      setItem: (key, value) => {
        store.set(key, value);
      },
      removeItem: (key) => {
        store.delete(key);
      }
    }
  });
  const result = await applyDesktopServerChoice(
    "http://192.168.1.10:8787",
    effects,
    { ok: true, service: "workhub-api", runtime: "node", port: 8787, ai_provider_configured: false } as HealthResponse
  );
  assert.equal(store.has("workhub_auth_mode"), false);
  // 没有 Tauri 壳层（浏览器 dev 态）时不阻断切换。
  assert.equal(result.shellAccepted, false);
});

// --- DOM 接线 ---------------------------------------------------------------

type FakeEvent = { preventDefault?: () => void };

type FakeElement = {
  value?: string;
  disabled?: boolean;
  textContent?: string;
  innerHTML?: string;
  focus?: (options?: unknown) => void;
  addEventListener: (type: string, handler: (event: FakeEvent) => void) => void;
  dispatch: (type: string, event?: FakeEvent) => Promise<void>;
};

function fakeElement(extra: Partial<FakeElement> = {}): FakeElement {
  const listeners = new Map<string, (event: FakeEvent) => void>();
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    async dispatch(type, event = { preventDefault: () => undefined }) {
      listeners.get(type)?.(event);
      // 处理器里的 promise 链（探测/确认）要跑完再断言。
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    ...extra
  };
}

function fakeRoot(nodes: Record<string, FakeElement | null>) {
  return {
    innerHTML: "",
    querySelector: (selector: string) => nodes[selector] ?? null
  } as unknown as HTMLElement;
}

test("bindDesktopConnectScreen enables confirm only after a successful test and runs the switch in order", async () => {
  const form = fakeElement();
  const address = fakeElement({ value: "http://192.168.1.10:8787", focus: () => undefined });
  const testButton = fakeElement({ disabled: false, textContent: "" });
  const confirm = fakeElement({ disabled: true });
  const status = fakeElement({ innerHTML: "" });
  const root = fakeRoot({
    "[data-desktop-connect-form]": form,
    "[data-desktop-connect-address]": address,
    "[data-desktop-connect-test]": testButton,
    "[data-desktop-connect-confirm]": confirm,
    "[data-desktop-connect-status]": status
  });

  const order: string[] = [];
  let reloaded = 0;
  bindDesktopConnectScreen(root, {
    locale: "zh-CN",
    apiBase: "http://127.0.0.1:8787",
    probe: async () => health({ instance_name: "研发一组" }),
    effects: {
      clearIdentity: () => order.push("clearIdentity"),
      rememberServer: (base) => order.push(`rememberServer:${base}`),
      notifyShell: async (base) => {
        order.push(`notifyShell:${base}`);
        return { url: base };
      }
    },
    reload: () => {
      reloaded += 1;
    }
  });

  // C2：还没测过 → 点确认什么都不做。
  await confirm.dispatch("click");
  assert.deepEqual(order, []);
  assert.equal(reloaded, 0);

  await form.dispatch("submit");
  assert.match(status.innerHTML ?? "", /研发一组/u);
  assert.equal(confirm.disabled, false, "a healthy probe must unlock the confirm button");
  assert.equal(testButton.disabled, false, "the test button must be usable again");

  await confirm.dispatch("click");
  assert.deepEqual(order, [
    "clearIdentity",
    "rememberServer:http://192.168.1.10:8787",
    "notifyShell:http://192.168.1.10:8787"
  ]);
  assert.equal(reloaded, 1);
});

test("bindDesktopConnectScreen keeps confirm locked when the probe fails, and re-locks it when the address is edited", async () => {
  const form = fakeElement();
  const address = fakeElement({ value: "http://192.168.1.10:8787" });
  const testButton = fakeElement({ disabled: false });
  const confirm = fakeElement({ disabled: true });
  const status = fakeElement({ innerHTML: "" });
  const root = fakeRoot({
    "[data-desktop-connect-form]": form,
    "[data-desktop-connect-address]": address,
    "[data-desktop-connect-test]": testButton,
    "[data-desktop-connect-confirm]": confirm,
    "[data-desktop-connect-status]": status
  });

  let probes = 0;
  let switched = 0;
  bindDesktopConnectScreen(root, {
    locale: "zh-CN",
    probe: async () => {
      probes += 1;
      if (probes === 1) {
        throw new TypeError("Failed to fetch");
      }
      return health();
    },
    effects: {
      clearIdentity: () => {
        switched += 1;
      },
      rememberServer: () => undefined,
      notifyShell: async () => undefined
    },
    reload: () => undefined
  });

  await form.dispatch("submit");
  assert.match(status.innerHTML ?? "", /连不上这个地址/u);
  assert.equal(confirm.disabled, true);
  await confirm.dispatch("click");
  assert.equal(switched, 0);

  // 第二次测通 → 解锁；随后编辑地址 → 立刻重新锁上（测的是 A、确认的却是 B 这条路必须堵死）。
  await form.dispatch("submit");
  assert.equal(confirm.disabled, false);
  await address.dispatch("input", {});
  assert.equal(confirm.disabled, true);
  await confirm.dispatch("click");
  assert.equal(switched, 0);
});

// R24 S5（N-07 根治）：设置页「更换服务器」入口会传 onUnchanged——地址跟 apiBase 一样时必须收起
// 这一屏而不是 reload，且三个 effects 一个都不该被调用（见 applyDesktopServerChoice 的短路）。
test("bindDesktopConnectScreen calls onUnchanged instead of reloading when the confirmed address matches apiBase", async () => {
  const form = fakeElement();
  const address = fakeElement({ value: "http://127.0.0.1:8787", focus: () => undefined });
  const testButton = fakeElement({ disabled: false, textContent: "" });
  const confirm = fakeElement({ disabled: true });
  const status = fakeElement({ innerHTML: "" });
  const root = fakeRoot({
    "[data-desktop-connect-form]": form,
    "[data-desktop-connect-address]": address,
    "[data-desktop-connect-test]": testButton,
    "[data-desktop-connect-confirm]": confirm,
    "[data-desktop-connect-status]": status
  });

  const order: string[] = [];
  let reloaded = 0;
  let unchangedCalls = 0;
  bindDesktopConnectScreen(root, {
    locale: "zh-CN",
    // 这一屏打开时正在用的地址——跟下面测通/确认的地址完全一样。
    apiBase: "http://127.0.0.1:8787",
    probe: async () => health({ instance_name: "研发一组" }),
    effects: {
      clearIdentity: () => order.push("clearIdentity"),
      rememberServer: (base) => order.push(`rememberServer:${base}`),
      notifyShell: async (base) => {
        order.push(`notifyShell:${base}`);
        return { url: base };
      }
    },
    reload: () => {
      reloaded += 1;
    },
    onUnchanged: () => {
      unchangedCalls += 1;
    }
  });

  await form.dispatch("submit");
  assert.equal(confirm.disabled, false, "a healthy probe must unlock the confirm button even when unchanged");

  await confirm.dispatch("click");
  assert.deepEqual(order, [], "no effect may run when the address did not actually change");
  assert.equal(reloaded, 0, "onUnchanged must be preferred over a hard reload");
  assert.equal(unchangedCalls, 1);
});

// 首启/离线兜底两个调用方（browser.ts/workbench/boot.ts）没有传 onUnchanged——没有"原来的屏"可退回，
// 必须保留旧行为照样 reload，靠它重新走一遍鉴权门判定（否则用户会卡在一张确认过的静止连接屏上）。
test("bindDesktopConnectScreen still reloads on an unchanged address when no onUnchanged is provided", async () => {
  const form = fakeElement();
  const address = fakeElement({ value: "http://127.0.0.1:8787", focus: () => undefined });
  const testButton = fakeElement({ disabled: false, textContent: "" });
  const confirm = fakeElement({ disabled: true });
  const status = fakeElement({ innerHTML: "" });
  const root = fakeRoot({
    "[data-desktop-connect-form]": form,
    "[data-desktop-connect-address]": address,
    "[data-desktop-connect-test]": testButton,
    "[data-desktop-connect-confirm]": confirm,
    "[data-desktop-connect-status]": status
  });

  let reloaded = 0;
  bindDesktopConnectScreen(root, {
    locale: "zh-CN",
    apiBase: "http://127.0.0.1:8787",
    probe: async () => health(),
    effects: {
      clearIdentity: () => undefined,
      rememberServer: () => undefined,
      notifyShell: async () => undefined
    },
    reload: () => {
      reloaded += 1;
    }
  });

  await form.dispatch("submit");
  await confirm.dispatch("click");
  assert.equal(reloaded, 1);
});

// --- 跨窗跟随 ---------------------------------------------------------------

test("bindDesktopServerChangedReload subscribes to the shell broadcast and reloads, and no-ops without Tauri", () => {
  const seen: string[] = [];
  let reloaded = 0;
  bindDesktopServerChangedReload((eventName, handler) => {
    seen.push(eventName);
    handler({ payload: { url: "http://192.168.1.10:8787" } });
    return () => undefined;
  }, () => {
    reloaded += 1;
  });
  assert.deepEqual(seen, [DESKTOP_SERVER_CHANGED_EVENT]);
  assert.equal(reloaded, 1);

  // 浏览器 dev 预览（无 __TAURI__）：静默 no-op，不崩。
  assert.doesNotThrow(() => bindDesktopServerChangedReload(undefined, () => undefined));
});

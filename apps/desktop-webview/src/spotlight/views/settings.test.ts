import assert from "node:assert/strict";
import test from "node:test";

import type { HealthResponse } from "@workhub/api-client";
import type {
  ClientDeviceResponse,
  McpServerActionResult,
  McpServerVM,
  PluginVM,
  SettingsPageVM,
  UserAiProfileVM,
  UserProfileVM
} from "@workhub/contracts";

import {
  createSettingsView,
  decidePolicyRevokeConfirmation,
  devicesSectionHtml,
  logoutErrorPanelHtml,
  permissionPoliciesSectionHtml,
  permissionPolicyFormHtml,
  pluginInstallErrorText,
  pluginsSectionHtml,
  runDesktopLogout,
  serverSectionHtml,
  type DesktopDevicesSectionState,
  type DesktopLogoutEffects,
  type DesktopLogoutStage,
  type DesktopLogoutView,
  type DesktopPluginsSectionState,
  type DesktopServerSectionState,
  type PermissionPolicyFormState
} from "./settings.js";
import type { SpotlightViewContext } from "../view-context.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

class FakeElement {
  public dataset: Record<string, string> = {};
  public value = "";
  // R14 批 AVATAR：hydrateAvatarPreview/remove/upload 都会摸 el.hidden / el.textContent / el.src——
  // 给通用假元素补这三个属性，绝大多数既有测试从不设置查询结果（见 queryResults 默认空），
  // 因此 ctx.body.querySelector("[data-spot-avatar-*]") 照旧返回 null，hydrateAvatarPreview 直接
  // 短路 return，不影响任何既有断言；只有专门测头像的新用例会显式注册查询结果。
  public hidden = false;
  public textContent: string | null = null;
  public src = "";
  private readonly queryResults = new Map<string, FakeElement>();

  constructor(
    private readonly selectors = new Set<string>(),
    dataset: Record<string, string> = {},
    value = ""
  ) {
    this.dataset = dataset;
    this.value = value;
  }

  closest<T extends Element = Element>(selector: string): T | null {
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    return (this.queryResults.get(selector) as unknown as T) ?? null;
  }

  setQueryResult(selector: string, element: FakeElement): void {
    this.queryResults.set(selector, element);
  }
}

class FakeBody extends FakeElement {
  public innerHTML = "";
  private readonly clickListeners: Array<(event: { target: unknown }) => void> = [];
  // R13 批 A2（派人推荐 v2）："我的资料"分区的三个自由文本字段用 focusout（不是 click）保存——
  // 这个假 body 需要同时支持两种委托事件类型才能测那条保存路径。
  private readonly focusoutListeners: Array<(event: { target: unknown }) => void> = [];
  // R14 批 AVATAR：头像文件选择器用 change（不是 click/focusout）触发裁剪层。
  private readonly changeListeners: Array<(event: { target: unknown }) => void> = [];

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const bucket =
      type === "click" ? this.clickListeners : type === "focusout" ? this.focusoutListeners : type === "change" ? this.changeListeners : undefined;
    if (!bucket) return;
    bucket.push((event) => {
      if (typeof listener === "function") {
        listener(event as unknown as Event);
      } else {
        listener.handleEvent(event as unknown as Event);
      }
    });
  }

  click(target: FakeElement) {
    for (const listener of this.clickListeners) {
      listener({ target });
    }
  }

  focusOutOn(target: FakeElement) {
    for (const listener of this.focusoutListeners) {
      listener({ target });
    }
  }

  changeOn(target: FakeElement) {
    for (const listener of this.changeListeners) {
      listener({ target });
    }
  }
}

// The click delegation handler in settings.ts does `target instanceof HTMLElement` — plain Node has
// no DOM global, so tests that dispatch clicks must stand FakeElement in for it (same trick as
// attention.test.ts) and restore the previous value afterwards, even on failure.
async function withFakeHtmlElement<T>(run: () => Promise<T>): Promise<T> {
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement };
  const previous = globals.HTMLElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  try {
    return await run();
  } finally {
    globals.HTMLElement = previous;
  }
}

function settingsVm(): SettingsPageVM {
  return {
    generated_at: "2026-07-13T00:00:00.000Z",
    locale: "zh-CN",
    runtime: {
      app_env: "development",
      runtime_status: "ready",
      worker_count: 1,
      broker_backend: "memory",
      broker_configured: true,
      database_configured: true,
      agent_run_lease_ms: 1000,
      agent_run_recovery_interval_ms: 1000
    },
    llm_runtime: {
      default_provider: "anthropic",
      default_model: "claude",
      provider_count: 1,
      api_key_configured: true,
      base_url_configured: false,
      secret_safe: true
    },
    budgets: {
      run_tokens: 1,
      user_daily_tokens: 1,
      team_daily_tokens: 1,
      team_monthly_tokens: 1,
      run_cost_cny: "0",
      user_daily_cost_cny: "0",
      team_daily_cost_cny: "0",
      team_monthly_cost_cny: "0"
    },
    language: {
      active_locale: "zh-CN",
      preference_locale: "zh-CN",
      preference_source: "server",
      preference_synced: true,
      supported_locales: ["zh-CN", "en-US"],
      storage_key: "workhub_locale",
      update_href: "/api/auth/preferences"
    },
    device: {
      desktop_client: "tauri",
      local_execution_boundary: true,
      independent_pet_window: true,
      pet_model_settings_in_web: false,
      restore_href: "/settings?panel=desktop",
      restore_requires_desktop: true,
      web_local_actions_enabled: false
    }
  } as unknown as SettingsPageVM;
}

function aiProfileVm(over: Partial<UserAiProfileVM> = {}): UserAiProfileVM {
  return {
    workspace_id: "60000000-0000-4000-8000-000000000001",
    user_id: "60000000-0000-4000-8000-000000000002",
    default_mode: 3,
    granular_settings: {},
    dispatch_policy: "auto",
    cuu_proactivity: "balanced",
    model_tier_preference: null,
    providers: [],
    budget_summary: {
      daily_quota: null,
      usage: {
        day: { period: "day", token_in: 0, token_out: 0, total_tokens: 0, estimated_cost_cny: "0" },
        month: { period: "month", token_in: 0, token_out: 0, total_tokens: 0, estimated_cost_cny: "0" }
      }
    },
    generated_at: "2026-07-13T00:00:00.000Z",
    updated_at: null,
    ...over
  } as unknown as UserAiProfileVM;
}

// R13 批 A2（派人推荐 v2）："我的资料"（title/bio_md/skill_tags），独立于上面的 AI profile fixture。
function userProfileVm(over: Partial<UserProfileVM> = {}): UserProfileVM {
  return {
    user_id: "60000000-0000-4000-8000-000000000002",
    nickname: "张三",
    title: null,
    bio_md: null,
    skill_tags: [],
    onboarded_at: null,
    ...over
  } as unknown as UserProfileVM;
}

function baseCtx(body: FakeBody, overrides: Partial<SpotlightViewContext> = {}): SpotlightViewContext {
  return {
    body: body as unknown as HTMLElement,
    locale: "zh-CN",
    back() {},
    open() {},
    setSubtitle() {},
    toast() {},
    requestResize() {},
    refocusBody() {},
    signal: new AbortController().signal,
    ...overrides
  } as unknown as SpotlightViewContext;
}

test("settings view renders the AI section with the profile's current selections", async () => {
  const body = new FakeBody();
  const vm = settingsVm();
  const profile = aiProfileVm({ default_mode: 4, dispatch_policy: "ask", cuu_proactivity: "proactive" });

  await createSettingsView().mount(
    baseCtx(body, {
      client: {
        pages: { async settings() { return vm; } },
        async request<T>(path: string) {
          if (path === "/api/me/profile") {
            return userProfileVm() as unknown as T;
          }
          assert.equal(path, "/api/me/ai-profile");
          return profile as unknown as T;
        }
      } as unknown as SpotlightViewContext["client"]
    })
  );
  await tick();

  assert.match(body.innerHTML, /data-spot-ai-section="true"/u);
  assert.match(body.innerHTML, /data-set-ai-mode="4" data-sel="true"/u);
  assert.match(body.innerHTML, /data-set-ai-dispatch="ask" data-sel="true"/u);
  assert.match(body.innerHTML, /data-set-ai-proactivity="proactive" data-sel="true"/u);
  // Granular fields default to "允许" (allowed) when unset.
  assert.match(body.innerHTML, /建任务 · 允许/u);
});

// —— M-06（R24 S3 走查）：「AI assistant · Not set up」此前是个死状态——没有说明也没有入口。 ——

function settingsVmWithAi(apiKeyConfigured: boolean): SettingsPageVM {
  const vm = settingsVm();
  return { ...vm, llm_runtime: { ...vm.llm_runtime, api_key_configured: apiKeyConfigured } };
}

test("M-06: settings explains an unconfigured AI assistant with an actionable link, and mounts nothing extra once it's ready", async () => {
  const notConfigured = new FakeBody();
  await createSettingsView().mount(
    baseCtx(notConfigured, {
      client: {
        pages: { async settings() { return settingsVmWithAi(false); } },
        async request<T>(path: string) {
          if (path === "/api/me/profile") return userProfileVm() as unknown as T;
          return aiProfileVm() as unknown as T;
        }
      } as unknown as SpotlightViewContext["client"]
    })
  );
  await tick();

  assert.match(notConfigured.innerHTML, /data-spot-ai-not-configured="true"/u);
  // 部署细节（环境变量名 / .env 路径）属于部署文档，旁边的「查看部署说明」按钮才是它的位置。
  assert.doesNotMatch(notConfigured.innerHTML, /LLM_API_KEY|\.env/u, "deployment details belong in the docs, not in product copy");
  assert.match(notConfigured.innerHTML, /请让管理员在服务器上配置模型密钥/u, "tells the user who can fix it");
  assert.match(notConfigured.innerHTML, /data-set-ai-deploy-docs="true"/u, "gives a link to the deployment docs");

  const configured = new FakeBody();
  await createSettingsView().mount(
    baseCtx(configured, {
      client: {
        pages: { async settings() { return settingsVmWithAi(true); } },
        async request<T>(path: string) {
          if (path === "/api/me/profile") return userProfileVm() as unknown as T;
          return aiProfileVm() as unknown as T;
        }
      } as unknown as SpotlightViewContext["client"]
    })
  );
  await tick();

  assert.doesNotMatch(configured.innerHTML, /data-spot-ai-not-configured/u, "the note only shows up when AI really isn't configured");
});

test("M-06: clicking 'view deployment instructions' copies the DEPLOY.md link and confirms it, instead of a dead target=_blank (Tauri webview has no external-link handler)", async () => {
  await withFakeHtmlElement(async () => {
    const toasts: Array<{ message: string; tone?: string | undefined }> = [];
    const body = new FakeBody();
    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return settingsVmWithAi(false); } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"],
        toast: (message: string, tone?: string) => {
          toasts.push({ message, tone });
        }
      })
    );
    await tick();

    // Node 21+ defines a getter-only global `navigator` — plain assignment throws
    // ("Cannot set property navigator ... which has only a getter"). Same trick as
    // controller-drag.test.ts uses for `Element`: redefine the property.
    const copiedUrls: string[] = [];
    const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText: async (text: string) => {
            copiedUrls.push(text);
          }
        }
      }
    });
    try {
      body.click(new FakeElement(new Set(["[data-set-ai-deploy-docs]"])));
      await tick();
    } finally {
      if (previousNavigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", previousNavigatorDescriptor);
      } else {
        delete (globalThis as { navigator?: unknown }).navigator;
      }
    }

    assert.deepEqual(copiedUrls, ["https://github.com/mycyg/WorkHub/blob/main/DEPLOY.md"]);
    assert.ok(
      toasts.some((t) => t.tone === "ok" && (/copied|paste/iu.test(t.message) || /已复制/u.test(t.message))),
      "confirms the copy so the user knows the click did something"
    );
  });
});

test("L-04: the signed-in devices explanation wraps instead of being clipped to one ellipsized line", () => {
  const html = devicesSectionHtml(devicesState({ devices: [] }), true);
  assert.match(html, /class="wh-spot-row-sub wh-spot-row-sub--wrap"/u);
});

test("clicking a mode chip optimistically updates and PATCHes only default_mode", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const profile = aiProfileVm({ default_mode: 3 });
    const patchCalls: Array<{ path: string; init: RequestInit | undefined }> = [];

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string, init?: RequestInit) {
            if (init?.method === "PATCH") {
              patchCalls.push({ path, init });
              return aiProfileVm({ default_mode: 5 }) as unknown as T;
            }
            if (path === "/api/me/profile") {
              return userProfileVm() as unknown as T;
            }
            return profile as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();

    body.click(new FakeElement(new Set(["[data-set-ai-mode]"]), { setAiMode: "5" }));
    // Optimistic update should show immediately, before the PATCH promise settles.
    assert.match(body.innerHTML, /data-set-ai-mode="5" data-sel="true"/u);
    await tick();
    await tick();

    assert.equal(patchCalls.length, 1);
    assert.equal(patchCalls[0]!.path, "/api/me/ai-profile");
    assert.deepEqual(JSON.parse(String(patchCalls[0]!.init?.body)), { default_mode: 5 });
    assert.match(body.innerHTML, /data-set-ai-mode="5" data-sel="true"/u);
  });
});

test("a failed PATCH rolls the mode back and shows a gentle inline error, not a blocking dialog", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const profile = aiProfileVm({ default_mode: 3 });

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string, init?: RequestInit) {
            if (init?.method === "PATCH") {
              throw new Error("network down");
            }
            if (path === "/api/me/profile") {
              return userProfileVm() as unknown as T;
            }
            return profile as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();

    body.click(new FakeElement(new Set(["[data-set-ai-mode]"]), { setAiMode: "1" }));
    await tick();
    await tick();

    // Rolled back to the original mode 3, not stuck on the optimistic mode 1.
    assert.match(body.innerHTML, /data-set-ai-mode="3" data-sel="true"/u);
    assert.match(body.innerHTML, /data-spot-ai-error="true"/u);
  });
});

test("toggling one granular switch resends all four keys explicitly (PATCH replaces the whole object)", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const profile = aiProfileVm({ granular_settings: { mutate_drive: false } });
    const patchCalls: unknown[] = [];

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string, init?: RequestInit) {
            if (init?.method === "PATCH") {
              const body2 = JSON.parse(String(init.body));
              patchCalls.push(body2);
              return aiProfileVm({ granular_settings: body2.granular_settings }) as unknown as T;
            }
            if (path === "/api/me/profile") {
              return userProfileVm() as unknown as T;
            }
            return profile as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();

    body.click(new FakeElement(new Set(["[data-toggle-ai-granular]"]), { toggleAiGranular: "create_work_item" }));
    await tick();
    await tick();

    assert.equal(patchCalls.length, 1);
    assert.deepEqual(patchCalls[0], {
      granular_settings: {
        create_work_item: false,
        dispatch_run: true,
        mutate_drive: false,
        send_notification: true
      }
    });
  });
});

test("a failed AI profile fetch does not block the rest of settings, and offers a scoped retry", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    let profileCalls = 0;

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            // R13 批 A2：这条计数只跟踪 AI profile 路径的失败/重试，"我的资料" fetch 是一条独立的、
            // 与本用例无关的并行请求——一律安静成功，不参与这条计数（否则并行加入的第二条请求会
            // 抢走"第一次调用失败"的名额，让下面的 profileCalls 断言错位）。
            if (path === "/api/me/profile") {
              return userProfileVm() as unknown as T;
            }
            profileCalls += 1;
            if (profileCalls === 1) {
              throw new Error("boom");
            }
            return aiProfileVm() as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();

    // The rest of settings (language, runtime) still renders even though AI profile failed.
    assert.match(body.innerHTML, /data-set-locale="zh-CN"/u);
    assert.match(body.innerHTML, /data-spot-ai-retry/u);
    assert.doesNotMatch(body.innerHTML, /data-set-ai-mode=/u);

    body.click(new FakeElement(new Set(["[data-spot-ai-retry]"])));
    await tick();
    await tick();

    assert.equal(profileCalls, 2);
    assert.match(body.innerHTML, /data-set-ai-mode="3" data-sel="true"/u);
  });
});

// D1（R19-13 托盘语言联动补线）：主窗设置页切语言此前只更新偏好 + reload，从没通知原生外壳——
// 托盘菜单/tooltip/通知兜底文案永远停在启动语言。现在 reload 前真调 set_shell_locale，与
// pet-surface.ts 桌宠菜单切语言同一份修法（对应用例见 pet-surface.test.ts）。plain Node 没有
// window 全局，故这里连同 __TAURI__ 一起临时打桩，覆盖「storage 写入 → invoke → reload」全链。
test("clicking a locale option syncs the native shell via set_shell_locale before reloading", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const invokeCalls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
    const reloadCalls: number[] = [];
    const storageCalls: Array<{ key: string; value: string }> = [];

    const globals = globalThis as unknown as { __TAURI__?: unknown; window?: unknown };
    const originalTauri = globals.__TAURI__;
    const originalWindow = globals.window;
    globals.__TAURI__ = {
      core: {
        async invoke(command: string, args?: Record<string, unknown>) {
          invokeCalls.push({ command, args });
          return undefined;
        }
      }
    };
    globals.window = {
      localStorage: {
        setItem(key: string, value: string) {
          storageCalls.push({ key, value });
        }
      },
      location: {
        reload() {
          reloadCalls.push(1);
        }
      }
    };

    try {
      await createSettingsView().mount(
        baseCtx(body, {
          client: {
            pages: { async settings() { return vm; } },
            async request<T>(path: string) {
              if (path === "/api/me/profile") {
                return userProfileVm() as unknown as T;
              }
              return aiProfileVm() as unknown as T;
            },
            async updatePreferences() {
              return {} as never;
            }
          } as unknown as SpotlightViewContext["client"]
        })
      );
      await tick();

      body.click(new FakeElement(new Set(["[data-set-locale]"]), { setLocale: "en-US" }));
      await tick();
      await tick();
      await tick();

      assert.deepEqual(storageCalls, [{ key: "workhub_locale", value: "en-US" }]);
      // invoke 必须发生——且是在 reload 之前调用的语句序（见 settings.ts 的 .then() 回调顺序）。
      assert.deepEqual(invokeCalls, [{ command: "set_shell_locale", args: { locale: "en-US" } }]);
      assert.deepEqual(reloadCalls, [1]);
    } finally {
      if (originalTauri === undefined) {
        delete globals.__TAURI__;
      } else {
        globals.__TAURI__ = originalTauri;
      }
      if (originalWindow === undefined) {
        delete globals.window;
      } else {
        globals.window = originalWindow;
      }
    }
  });
});

test("clicking a locale option still reloads when no Tauri invoke is available (web/non-desktop degrade)", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const reloadCalls: number[] = [];

    const globals = globalThis as unknown as { __TAURI__?: unknown; window?: unknown };
    const originalTauri = globals.__TAURI__;
    const originalWindow = globals.window;
    delete globals.__TAURI__;
    globals.window = {
      localStorage: { setItem() {} },
      location: {
        reload() {
          reloadCalls.push(1);
        }
      }
    };

    try {
      await createSettingsView().mount(
        baseCtx(body, {
          client: {
            pages: { async settings() { return vm; } },
            async request<T>(path: string) {
              if (path === "/api/me/profile") {
                return userProfileVm() as unknown as T;
              }
              return aiProfileVm() as unknown as T;
            },
            async updatePreferences() {
              return {} as never;
            }
          } as unknown as SpotlightViewContext["client"]
        })
      );
      await tick();

      body.click(new FakeElement(new Set(["[data-set-locale]"]), { setLocale: "en-US" }));
      await tick();
      await tick();
      await tick();

      // best-effort：没有 invoke 时安静跳过，绝不阻塞 reload。
      assert.deepEqual(reloadCalls, [1]);
    } finally {
      if (originalTauri === undefined) {
        delete globals.__TAURI__;
      } else {
        globals.__TAURI__ = originalTauri;
      }
      if (originalWindow === undefined) {
        delete globals.window;
      } else {
        globals.window = originalWindow;
      }
    }
  });
});

// ── R13 批 A2（派人推荐 v2）："我的资料"分区 ──────────────────────────────────────────────

test("settings view renders the my-profile section with the profile's current values", async () => {
  const body = new FakeBody();
  const vm = settingsVm();
  const profile = userProfileVm({ title: "前端负责人", bio_md: "做过三个交付项目", skill_tags: ["react", "typescript"] });

  await createSettingsView().mount(
    baseCtx(body, {
      client: {
        pages: { async settings() { return vm; } },
        async request<T>(path: string) {
          if (path === "/api/me/profile") {
            return profile as unknown as T;
          }
          return aiProfileVm() as unknown as T;
        }
      } as unknown as SpotlightViewContext["client"]
    })
  );
  await tick();

  assert.match(body.innerHTML, /data-spot-profile-section="true"/u);
  assert.match(body.innerHTML, /data-set-profile-title[^>]*value="前端负责人"/u);
  assert.match(body.innerHTML, /做过三个交付项目/u);
  assert.match(body.innerHTML, /data-set-profile-skills[^>]*value="react, typescript"/u);
  assert.match(body.innerHTML, /Cuu 派活会参考这些信息/u);
});

test("leaving the title field (focusout) with a changed value optimistically updates and PATCHes only title", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const profile = userProfileVm({ title: "前端负责人" });
    const patchCalls: Array<{ path: string; init: RequestInit | undefined }> = [];

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string, init?: RequestInit) {
            if (init?.method === "PATCH") {
              patchCalls.push({ path, init });
              return userProfileVm({ title: "后端负责人" }) as unknown as T;
            }
            if (path === "/api/me/profile") {
              return profile as unknown as T;
            }
            return aiProfileVm() as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();

    body.focusOutOn(new FakeElement(new Set(["[data-set-profile-title]"]), {}, "后端负责人"));
    // Optimistic update should show immediately, before the PATCH promise settles.
    assert.match(body.innerHTML, /data-set-profile-title[^>]*value="后端负责人"/u);
    await tick();
    await tick();

    assert.equal(patchCalls.length, 1);
    assert.equal(patchCalls[0]!.path, "/api/me/profile");
    assert.deepEqual(JSON.parse(String(patchCalls[0]!.init?.body)), { title: "后端负责人" });
    assert.match(body.innerHTML, /data-set-profile-title[^>]*value="后端负责人"/u);
  });
});

test("leaving the skills field with an unchanged value (round-tripped through the comma-split/join) does not PATCH", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const profile = userProfileVm({ skill_tags: ["react", "typescript"] });
    let patchCount = 0;

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string, init?: RequestInit) {
            if (init?.method === "PATCH") {
              patchCount += 1;
              return profile as unknown as T;
            }
            if (path === "/api/me/profile") {
              return profile as unknown as T;
            }
            return aiProfileVm() as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();

    body.focusOutOn(new FakeElement(new Set(["[data-set-profile-skills]"]), {}, "react, typescript"));
    await tick();
    await tick();

    assert.equal(patchCount, 0, "unchanged skill tags must not trigger a PATCH");
  });
});

test("a failed profile PATCH rolls the title back and shows a gentle inline error, not a blocking dialog", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const profile = userProfileVm({ title: "前端负责人" });

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string, init?: RequestInit) {
            if (init?.method === "PATCH") {
              throw new Error("network down");
            }
            if (path === "/api/me/profile") {
              return profile as unknown as T;
            }
            return aiProfileVm() as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();

    body.focusOutOn(new FakeElement(new Set(["[data-set-profile-title]"]), {}, "后端负责人"));
    await tick();
    await tick();

    // Rolled back to the original saved title, not stuck on the optimistic value.
    assert.match(body.innerHTML, /data-set-profile-title[^>]*value="前端负责人"/u);
    assert.match(body.innerHTML, /data-spot-profile-error="true"/u);
  });
});

test("a failed my-profile fetch does not block the rest of settings, and offers a scoped retry", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    let profileFetchCalls = 0;

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") {
              profileFetchCalls += 1;
              if (profileFetchCalls === 1) {
                throw new Error("boom");
              }
              return userProfileVm({ title: "前端负责人" }) as unknown as T;
            }
            return aiProfileVm() as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();

    // The rest of settings (AI section) still renders even though the my-profile fetch failed.
    assert.match(body.innerHTML, /data-spot-ai-section="true"/u);
    assert.match(body.innerHTML, /data-spot-profile-retry/u);
    assert.doesNotMatch(body.innerHTML, /data-set-profile-title=/u);

    body.click(new FakeElement(new Set(["[data-spot-profile-retry]"])));
    await tick();
    await tick();

    assert.equal(profileFetchCalls, 2);
    assert.match(body.innerHTML, /data-set-profile-title[^>]*value="前端负责人"/u);
  });
});

// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增）——本节起的测试覆盖头像分区：
// SSR 骨架渲染、移除头像的 DELETE 接线、以及预览水合（hydrateAvatarPreview）成功/失败两态。
// 上传裁剪层本身（选图→裁剪→确认→上传）的集成测试在同目录的 avatar-crop-modal.test.ts，
// 这里不重复——因为 openSpotlightAvatarCropModal 走真 document/Image/canvas 的默认 deps，
// 而这个文件的假 body 不是真 DOM，change 监听器一旦触发真的会调用默认 deps 而不是测试注入的假 deps
// （settings.ts 的生产代码本来就不该、也没有对外暴露"从这里注入裁剪层假 deps"的口子）。

test("settings view renders the avatar section: fallback tile initial + upload label + hidden remove button", async () => {
  const body = new FakeBody();
  const vm = settingsVm();
  const profile = userProfileVm({ nickname: "王五" });

  await createSettingsView().mount(
    baseCtx(body, {
      client: {
        pages: { async settings() { return vm; } },
        async request<T>(path: string) {
          if (path === "/api/me/profile") {
            return profile as unknown as T;
          }
          return aiProfileVm() as unknown as T;
        }
      } as unknown as SpotlightViewContext["client"]
    })
  );
  await tick();

  assert.match(body.innerHTML, /data-spot-avatar-section="true"/u);
  // Fallback tile shows the first character of the nickname, uppercased.
  assert.match(body.innerHTML, /data-spot-avatar-fallback="true"[^>]*>王</u);
  assert.match(body.innerHTML, /data-spot-avatar-img="true"[^>]*hidden/u);
  assert.match(body.innerHTML, /data-spot-avatar-file-input="true"/u);
  assert.match(body.innerHTML, /accept="image\/png,image\/jpeg,image\/webp"/u);
  assert.match(body.innerHTML, /data-spot-avatar-remove-btn="true"[^>]*hidden/u);
  assert.match(body.innerHTML, /更换头像/u);
  assert.match(body.innerHTML, /移除头像/u);
});

test("clicking remove-avatar issues DELETE /api/me/avatar and hides the image + button", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const profile = userProfileVm();
    const deleteCalls: string[] = [];

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string, init?: RequestInit) {
            if (init?.method === "DELETE") {
              deleteCalls.push(path);
              return { avatar_updated_at: null } as unknown as T;
            }
            if (path === "/api/me/profile") {
              return profile as unknown as T;
            }
            return aiProfileVm() as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();

    const img = new FakeElement();
    body.setQueryResult("[data-spot-avatar-img]", img);
    const status = new FakeElement();
    body.setQueryResult("[data-spot-avatar-status]", status);

    const removeBtn = new FakeElement(new Set(["[data-spot-avatar-remove-btn]"]));
    body.click(removeBtn);
    await tick();
    await tick();

    assert.deepEqual(deleteCalls, ["/api/me/avatar"]);
    assert.equal(img.hidden, true, "the <img> must be hidden after removal");
    assert.equal(removeBtn.hidden, true, "the remove button itself hides once there's nothing to remove");
    assert.equal(status.hidden, false);
    assert.equal(status.textContent, "已移除头像");
  });
});

test("a failed DELETE shows a gentle inline error and does not hide the existing avatar", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const profile = userProfileVm();

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string, init?: RequestInit) {
            if (init?.method === "DELETE") {
              throw new Error("boom");
            }
            if (path === "/api/me/profile") {
              return profile as unknown as T;
            }
            return aiProfileVm() as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();

    const status = new FakeElement();
    body.setQueryResult("[data-spot-avatar-status]", status);
    const removeBtn = new FakeElement(new Set(["[data-spot-avatar-remove-btn]"]));

    body.click(removeBtn);
    await tick();
    await tick();

    assert.equal(removeBtn.hidden, false, "a failed removal must not hide the button — nothing actually changed");
    assert.equal(status.hidden, false);
    assert.match(String(status.textContent), /请重试/u);
  });
});

test("hydrateAvatarPreview reveals the <img> + remove button on a successful fetch of the avatar bytes", async () => {
  const body = new FakeBody();
  const vm = settingsVm();
  const profile = userProfileVm();
  const img = new FakeElement();
  const removeBtn = new FakeElement();
  body.setQueryResult("[data-spot-avatar-img]", img);
  body.setQueryResult("[data-spot-avatar-remove-btn]", removeBtn);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new Blob(["fake-bytes"], { type: "image/png" }), { status: 200 })) as typeof fetch;
  try {
    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") {
              return profile as unknown as T;
            }
            return aiProfileVm() as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    assert.equal(img.hidden, false, "a real avatar must reveal the <img>");
    assert.match(img.src, /^blob:/u, "the preview must be set from a locally-created object URL, not a bare authenticated href");
    assert.equal(removeBtn.hidden, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hydrateAvatarPreview stays on the fallback tile (no crash, no error flash) when the user has no avatar (404)", async () => {
  const body = new FakeBody();
  const vm = settingsVm();
  const profile = userProfileVm();
  // The real SSR markup starts the <img> as `hidden` (renderSettingsMyProfileCard/avatarSectionHtml);
  // the fake element defaults to `hidden = false`, so set it explicitly to mirror that real starting
  // state and prove hydrateAvatarPreview does NOT flip it to visible on a 404.
  const img = new FakeElement();
  img.hidden = true;
  body.setQueryResult("[data-spot-avatar-img]", img);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
  try {
    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") {
              return profile as unknown as T;
            }
            return aiProfileVm() as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    assert.equal(img.hidden, true, "a 404 (no avatar) must leave the <img> hidden — the fallback tile stays visible underneath");
    assert.equal(img.src, "", "a 404 (no avatar) must never set an <img> src");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── R20 SEC P1-01（桌面 logout 吞错伪装成功）──────────────────────────────────────────────
// 登出必须是有序状态机：①服务端登出（失败即停、可见、可重试）②清 Rust 壳层令牌 ③清本地→广播→reload。
// 副作用注入，故可脱离真实 window/__TAURI__ 直接断言顺序与失败停位。

function recordingLogout(opts: { failServer?: boolean; failShell?: boolean } = {}) {
  const calls: string[] = [];
  const effects: DesktopLogoutEffects = {
    serverLogout: async () => {
      calls.push("serverLogout");
      if (opts.failServer) throw new Error("network down");
    },
    clearShellToken: async () => {
      calls.push("clearShellToken");
      if (opts.failShell) throw new Error("tauri ipc unavailable");
    },
    clearLocalIdentity: () => {
      calls.push("clearLocalIdentity");
    },
    broadcastLoggedOut: () => {
      calls.push("broadcastLoggedOut");
    },
    reload: () => {
      calls.push("reload");
    }
  };
  return { calls, effects };
}

function recordingLogoutView() {
  const errors: DesktopLogoutStage[] = [];
  let progressShown = 0;
  const view: DesktopLogoutView = {
    showProgress: () => {
      progressShown += 1;
    },
    showError: (stage) => {
      errors.push(stage);
    }
  };
  return { errors, view, progress: () => progressShown };
}

test("runDesktopLogout success path runs server → shell → local → broadcast → reload in order", async () => {
  const { calls, effects } = recordingLogout();
  const { errors, view } = recordingLogoutView();

  const result = await runDesktopLogout(effects, view, { force: false });

  assert.equal(result, "done");
  assert.deepEqual(calls, [
    "serverLogout",
    "clearShellToken",
    "clearLocalIdentity",
    "broadcastLoggedOut",
    "reload"
  ]);
  assert.deepEqual(errors, [], "a clean logout shows no error");
});

test("runDesktopLogout stops before touching the local identity when the server logout fails", async () => {
  const { calls, effects } = recordingLogout({ failServer: true });
  const { errors, view } = recordingLogoutView();

  const result = await runDesktopLogout(effects, view, { force: false });

  assert.equal(result, "server-failed");
  // 关键：服务端登出失败 → 只尝试了服务端一步，绝不清壳层令牌/本地/广播/reload（那正是"伪装成功"缺陷）。
  assert.deepEqual(calls, ["serverLogout"], "no local state may be cleared when the server sign-out failed");
  assert.ok(!calls.includes("clearLocalIdentity") && !calls.includes("reload"));
  assert.deepEqual(errors, ["server"], "the failure is surfaced, not swallowed");
});

test("runDesktopLogout stops before clearing local identity when the shell-token clear fails", async () => {
  const { calls, effects } = recordingLogout({ failShell: true });
  const { errors, view } = recordingLogoutView();

  const result = await runDesktopLogout(effects, view, { force: false });

  assert.equal(result, "shell-failed");
  // 服务端已登出，但清壳层令牌失败 → 停在本地清理之前，错误可见可重试。
  assert.deepEqual(calls, ["serverLogout", "clearShellToken"]);
  assert.ok(!calls.includes("clearLocalIdentity") && !calls.includes("reload"));
  assert.deepEqual(errors, ["shell"]);
});

test("runDesktopLogout with force=true skips the server call (explicit local-only fallback)", async () => {
  // 即便服务端仍不可达，force 也不调用它——用户显式选择"仍要本地退出"。
  const { calls, effects } = recordingLogout({ failServer: true });
  const { errors, view } = recordingLogoutView();

  const result = await runDesktopLogout(effects, view, { force: true });

  assert.equal(result, "done");
  // force 跳过①：不调 serverLogout，直接做本地清理。
  assert.deepEqual(calls, [
    "clearShellToken",
    "clearLocalIdentity",
    "broadcastLoggedOut",
    "reload"
  ]);
  assert.equal(calls.includes("serverLogout"), false);
  assert.deepEqual(errors, []);
});

test("logoutErrorPanelHtml surfaces a visible error with a retry, and a local-only fallback only for server failures", () => {
  const server = logoutErrorPanelHtml(true, "server");
  assert.match(server, /data-spot-logout-error="server"/u);
  // server 阶段警示：服务端登录可能仍有效。
  assert.match(server, /可能仍然有效/u);
  // 重试重跑完整流程（含服务端）→ force=false。
  assert.match(server, /data-set-logout-retry data-logout-force="false"/u);
  // 服务端不可达兜底：仍要本地退出。
  assert.match(server, /data-set-logout-local/u);
  assert.match(server, /仍要本地退出/u);

  const shell = logoutErrorPanelHtml(true, "shell");
  assert.match(shell, /data-spot-logout-error="shell"/u);
  // shell 阶段服务端已登出，重试只重跑本地清理 → force=true；不提供"仍要本地退出"（服务端已安全）。
  assert.match(shell, /data-set-logout-retry data-logout-force="true"/u);
  assert.doesNotMatch(shell, /data-set-logout-local/u);
});

test("clicking Sign out with a failing server logout renders a visible, retryable error and does not clear anything", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    let logoutCalls = 0;

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async logout() {
            logoutCalls += 1;
            throw new Error("network down");
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();

    assert.match(body.innerHTML, /data-set-logout="true"/u);

    body.click(new FakeElement(new Set(["[data-set-logout]"])));
    await tick();
    await tick();

    assert.equal(logoutCalls, 1, "the server logout must actually be attempted");
    // 服务端失败 → 渲错误面板（可见 + 可重试 + 本地退出兜底）；因为没走到 window.* 本地清理，node 无 window 也不炸。
    assert.match(body.innerHTML, /data-spot-logout-error="server"/u);
    assert.match(body.innerHTML, /data-set-logout-retry/u);
    assert.match(body.innerHTML, /data-set-logout-local/u);
  });
});

// R14 批 MEM：设置区旁挂的「Cuu 的记忆」导航行——独立能力视图（views/memory.ts），settings.ts 本身
// 不渲染记忆内容，点击只需要转发给 ctx.open("memory")（03-mem-design §6.2）。
test("settings view renders a 'Cuu's memory' nav row that opens the independent memory capability", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const opened: Array<{ id: string }> = [];

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"],
        open(id: string) {
          opened.push({ id });
        }
      })
    );
    await tick();
    await tick();

    assert.match(body.innerHTML, /data-set-open-memory="true"/u);
    assert.match(body.innerHTML, /Cuu 的记忆/u);

    body.click(new FakeElement(new Set(["[data-set-open-memory]"])));

    assert.deepEqual(opened, [{ id: "memory" }]);
  });
});

// —— R20 DSK-UX（R19-5 撤销学到的自动通过策略）—— //

function policyVm(over: Record<string, unknown> = {}) {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    action_pattern: "drive.write:*",
    effect: "allow" as const,
    learned_from_session: true,
    created_at: "2026-07-16T00:00:00.000Z",
    revoke_href: "/api/permissions/70000000-0000-4000-8000-000000000001",
    ...over
  };
}

test("permissionPoliciesSectionHtml renders nothing for a non-admin (no permission_policies in the VM)", () => {
  assert.equal(
    permissionPoliciesSectionHtml({ policies: undefined, armedId: undefined, busyId: undefined, errorText: undefined, zh: true }),
    ""
  );
});

test("permissionPoliciesSectionHtml lists each policy with a revoke control (R19-5 governance dead-end fixed)", () => {
  const html = permissionPoliciesSectionHtml({
    policies: [policyVm()],
    armedId: undefined,
    busyId: undefined,
    errorText: undefined,
    zh: true
  });
  assert.match(html, /data-spot-policies-section="true"/u);
  assert.match(html, /drive\.write:\*/u);
  assert.match(html, /自动通过/u);
  assert.match(html, /data-set-revoke-policy="70000000-0000-4000-8000-000000000001"/u);
});

test("permissionPoliciesSectionHtml arms exactly the targeted policy's revoke button into a confirm prompt", () => {
  const armed = permissionPoliciesSectionHtml({
    policies: [policyVm({ id: "p1" }), policyVm({ id: "p2" })],
    armedId: "p1",
    busyId: undefined,
    errorText: undefined,
    zh: true
  });
  assert.match(armed, /data-set-revoke-policy="p1"[^>]*wh-spot-act--danger|wh-spot-act--danger[^>]*data-set-revoke-policy="p1"/u);
  assert.equal((armed.match(/确定？再点一次撤销/gu) ?? []).length, 1, "only the armed policy shows the confirm prompt");
});

test("permissionPoliciesSectionHtml shows an empty-state note for an admin with no learned policies", () => {
  const html = permissionPoliciesSectionHtml({ policies: [], armedId: undefined, busyId: undefined, errorText: undefined, zh: true });
  assert.match(html, /data-spot-policies-section="true"/u);
  assert.match(html, /还没有学到的自动通过策略/u);
});

test("decidePolicyRevokeConfirmation arms first, executes on the second click of the same policy, re-arms on a different one", () => {
  assert.deepEqual(decidePolicyRevokeConfirmation(undefined, "p1"), { kind: "arm", id: "p1" });
  assert.deepEqual(decidePolicyRevokeConfirmation("p1", "p1"), { kind: "execute", id: "p1" });
  assert.deepEqual(decidePolicyRevokeConfirmation("p1", "p2"), { kind: "arm", id: "p2" });
});

test("the settings view revokes a policy only on the confirmed second click, calling DELETE /api/permissions/:id once", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = { ...settingsVm(), permission_policies: [policyVm({ id: "pol-1" })] } as unknown as SettingsPageVM;
    const revokeCalls: string[] = [];

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async revokePermissionPolicy(id: string) {
            revokeCalls.push(id);
            return policyVm({ id, deleted_at: "2026-07-17T00:00:00.000Z" }) as unknown as never;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    assert.match(body.innerHTML, /data-set-revoke-policy="pol-1"/u);

    // First click only arms — no DELETE yet.
    body.click(new FakeElement(new Set(["[data-set-revoke-policy]"]), { setRevokePolicy: "pol-1" }));
    assert.equal(revokeCalls.length, 0, "the first click must not delete anything");
    assert.match(body.innerHTML, /确定？再点一次撤销/u);

    // Second click confirms — DELETE fires once, then the policy drops out of the list.
    body.click(new FakeElement(new Set(["[data-set-revoke-policy]"]), { setRevokePolicy: "pol-1" }));
    await tick();
    await tick();
    assert.deepEqual(revokeCalls, ["pol-1"]);
    assert.doesNotMatch(body.innerHTML, /data-set-revoke-policy="pol-1"/u, "the revoked policy must disappear from the list");
  });
});

test("MRG-25: a client without revokePermissionPolicy degrades quietly (no stuck 撤销中…, no throw)", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = { ...settingsVm(), permission_policies: [policyVm({ id: "pol-1" })] } as unknown as SettingsPageVM;

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          }
          // 故意不带 revokePermissionPolicy（旧版 api-client，可选方法缺失）。
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    // 两次点击（武装 + 确认）都不该抛错、按钮不该永久卡「撤销中…」。
    body.click(new FakeElement(new Set(["[data-set-revoke-policy]"]), { setRevokePolicy: "pol-1" }));
    body.click(new FakeElement(new Set(["[data-set-revoke-policy]"]), { setRevokePolicy: "pol-1" }));
    await tick();
    await tick();

    assert.doesNotMatch(body.innerHTML, /撤销中/u, "busy label must not stick when the method is missing");
    assert.match(body.innerHTML, /当前客户端版本不支持撤销/u);
  });
});

// —— R23 F-02（权限策略新增/调整）—— //

function policyFormState(over: Partial<PermissionPolicyFormState> = {}): PermissionPolicyFormState {
  return {
    scopeKind: "workspace",
    scopeId: "ws-1",
    actionPattern: "drive.write:*",
    effect: "ask",
    priority: "0",
    busy: false,
    errorText: undefined,
    supported: true,
    ...over
  };
}

test("permissionPolicyFormHtml marks the selected scope-kind/effect chips, and only shows the priority kill-switch hint for deny", () => {
  const askHtml = permissionPolicyFormHtml(policyFormState({ effect: "ask" }), true);
  assert.match(askHtml, /data-set-policy-scope-kind="workspace" data-sel="true"/u);
  assert.match(askHtml, /data-set-policy-effect="ask" data-sel="true"/u);
  assert.doesNotMatch(askHtml, /一票否决/u);

  const denyHtml = permissionPolicyFormHtml(policyFormState({ effect: "deny" }), true);
  assert.match(denyHtml, /data-set-policy-effect="deny" data-sel="true"/u);
  assert.match(denyHtml, /一票否决/u, "the OVERRIDE_DENY_PRIORITY warning must only show for a deny rule");
});

test("permissionPolicyFormHtml disables inputs and shows a submitting label while busy, and surfaces errorText", () => {
  const html = permissionPolicyFormHtml(policyFormState({ busy: true, errorText: "保存失败，请重试。" }), true);
  assert.match(html, /正在提交…/u);
  assert.match(html, /data-set-policy-submit="true" disabled/u);
  assert.match(html, /保存失败，请重试。/u);
});

test("permissionPoliciesSectionHtml renders the new/adjust form alongside the list when a form state is given", () => {
  const html = permissionPoliciesSectionHtml({
    policies: [policyVm()],
    armedId: undefined,
    busyId: undefined,
    errorText: undefined,
    zh: true,
    form: policyFormState()
  });
  assert.match(html, /data-spot-policy-form-section="true"/u);
  assert.match(html, /新增 \/ 调整策略/u);
});

test("R23 F-02: submitting the new-policy form calls createPermissionPolicy with the entered fields and merges the result into the list", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    // 表单跟列表共用同一个 admin-only 门（vm.permission_policies 非 undefined 才渲，见
    // permissionPoliciesSectionHtml）——这里需要一个非 undefined 的（哪怕是空）数组来模拟管理员视角。
    const vm = { ...settingsVm(), permission_policies: [] } as unknown as SettingsPageVM;
    const createCalls: Array<Record<string, unknown>> = [];

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm({ workspace_id: "ws-9" }) as unknown as T;
          },
          async createPermissionPolicy(payload: Record<string, unknown>) {
            createCalls.push(payload);
            return policyVm({ id: "new-pol", action_pattern: payload.action_pattern, effect: payload.effect }) as unknown as never;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    body.focusOutOn(new FakeElement(new Set(["[data-set-policy-scope-id]"]), {}, "ws-custom"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-policy-action-pattern]"]), {}, "drive.write:*"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-policy-priority]"]), {}, "5"));
    body.click(new FakeElement(new Set(["[data-set-policy-effect]"]), { setPolicyEffect: "deny" }));
    body.click(new FakeElement(new Set(["[data-set-policy-submit]"])));
    await tick();
    await tick();

    assert.deepEqual(createCalls, [
      {
        scope_kind: "workspace",
        scope_id: "ws-custom",
        action_pattern: "drive.write:*",
        effect: "deny",
        priority: 5,
        learned_from_session: false
      }
    ]);
    assert.match(body.innerHTML, /data-set-revoke-policy="new-pol"/u, "the newly created policy must appear in the list without a full page reload");
  });
});

test("R23 F-02: clicking the 'workspace' scope chip prefills scope_id from the AI profile's workspace_id when still empty", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = { ...settingsVm(), permission_policies: [] } as unknown as SettingsPageVM;

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm({ workspace_id: "ws-prefill" }) as unknown as T;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-set-policy-scope-kind]"]), { setPolicyScopeKind: "role" }));
    body.click(new FakeElement(new Set(["[data-set-policy-scope-kind]"]), { setPolicyScopeKind: "workspace" }));
    await tick();

    assert.match(body.innerHTML, /data-set-policy-scope-id value="ws-prefill"/u);
  });
});

test("R23 F-02: submitting the new-policy form with empty fields shows a validation error and never calls createPermissionPolicy", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = { ...settingsVm(), permission_policies: [] } as unknown as SettingsPageVM;
    let createCalls = 0;

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async createPermissionPolicy() {
            createCalls += 1;
            return policyVm() as unknown as never;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-set-policy-submit]"])));
    await tick();

    assert.equal(createCalls, 0, "blank scope_id/action_pattern must never reach the server");
    assert.match(body.innerHTML, /请填写组织 \/ 工作区 \/ 角色 \/ 会话的标识与动作模式/u);
  });
});

test("MRG-25: a client without createPermissionPolicy degrades quietly when submitting the new-policy form", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = { ...settingsVm(), permission_policies: [] } as unknown as SettingsPageVM;

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          }
          // 故意不带 createPermissionPolicy（旧版 api-client，可选方法缺失）。
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    body.focusOutOn(new FakeElement(new Set(["[data-set-policy-scope-id]"]), {}, "ws-1"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-policy-action-pattern]"]), {}, "drive.write:*"));
    body.click(new FakeElement(new Set(["[data-set-policy-submit]"])));
    await tick();

    assert.match(body.innerHTML, /当前客户端版本不支持新增策略/u);
  });
});

// —— R23 F-03（设备管理收尾 · 桌面镜像）—— //

function clientDevice(over: Partial<ClientDeviceResponse> = {}): ClientDeviceResponse {
  return {
    id: "d0000000-0000-4000-8000-000000000001",
    user_id: "u0000000-0000-4000-8000-000000000001",
    device_name: "Ica's MacBook Pro",
    platform: "desktop",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    last_seen_at: "2026-07-18T03:04:00.000Z",
    ...over
  };
}

function devicesState(over: Partial<DesktopDevicesSectionState> = {}): DesktopDevicesSectionState {
  return {
    devices: [clientDevice()],
    failed: false,
    currentDeviceId: null,
    armedId: undefined,
    busyId: undefined,
    errorText: undefined,
    revokeCurrentArmed: false,
    revokeCurrentBusy: false,
    ...over
  };
}

test("devicesSectionHtml renders a failed state with a retry button", () => {
  const html = devicesSectionHtml(devicesState({ failed: true, devices: undefined }), true);
  assert.match(html, /data-set-devices-retry="true"/u);
  assert.match(html, /设备没加载出来/u);
});

test("devicesSectionHtml shows an empty-state note when there are no devices", () => {
  const html = devicesSectionHtml(devicesState({ devices: [] }), true);
  assert.match(html, /还没有已登录的设备/u);
});

test("devicesSectionHtml marks the current device with a distinct revoke-and-sign-out action, not the plain per-id revoke button", () => {
  const html = devicesSectionHtml(
    devicesState({ devices: [clientDevice({ id: "dev-1" })], currentDeviceId: "dev-1" }),
    true
  );
  assert.match(html, /本机/u);
  assert.match(html, /data-set-revoke-current-device="true"/u);
  assert.doesNotMatch(html, /data-set-revoke-device="dev-1"/u, "the current device row must not carry the plain per-id revoke action");
});

test("devicesSectionHtml gives a non-current device the plain two-step revoke action", () => {
  const html = devicesSectionHtml(
    devicesState({ devices: [clientDevice({ id: "dev-2" })], currentDeviceId: "some-other-id" }),
    true
  );
  assert.match(html, /data-set-revoke-device="dev-2"/u);
  assert.doesNotMatch(html, /data-set-revoke-current-device/u);
});

test("devicesSectionHtml never marks a revoked device as current or revocable, even if its id matches the probe", () => {
  const html = devicesSectionHtml(
    devicesState({ devices: [clientDevice({ id: "dev-1", revoked_at: "2026-07-18T04:00:00.000Z" })], currentDeviceId: "dev-1" }),
    true
  );
  assert.match(html, /已撤销/u);
  assert.doesNotMatch(html, /data-set-revoke-current-device/u);
  assert.doesNotMatch(html, /data-set-revoke-device="dev-1"/u, "a revoked device gets no revoke action at all");
});

test("the settings view renders the signed-in devices list from listClientDevices/currentClientDevice", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listClientDevices() {
            return [clientDevice({ id: "dev-1", device_name: "This Mac" }), clientDevice({ id: "dev-2", device_name: "Old iPad" })];
          },
          async currentClientDevice() {
            return clientDevice({ id: "dev-1" });
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    assert.match(body.innerHTML, /This Mac/u);
    assert.match(body.innerHTML, /Old iPad/u);
    assert.match(body.innerHTML, /data-set-revoke-current-device="true"/u);
    assert.match(body.innerHTML, /data-set-revoke-device="dev-2"/u);
  });
});

test("the settings view revokes another device only on the confirmed second click, calling revokeClientDevice once, and keeps the row visible as 已撤销", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const revokeCalls: string[] = [];

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listClientDevices() {
            return [clientDevice({ id: "dev-1" }), clientDevice({ id: "dev-2", device_name: "Old iPad" })];
          },
          async currentClientDevice() {
            return clientDevice({ id: "dev-1" });
          },
          async revokeClientDevice(id: string) {
            revokeCalls.push(id);
            return clientDevice({ id, device_name: "Old iPad", revoked_at: "2026-07-18T04:00:00.000Z" });
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-set-revoke-device]"]), { setRevokeDevice: "dev-2" }));
    assert.equal(revokeCalls.length, 0, "the first click must only arm, not revoke");
    assert.match(body.innerHTML, /确定？再点一次/u);

    body.click(new FakeElement(new Set(["[data-set-revoke-device]"]), { setRevokeDevice: "dev-2" }));
    await tick();
    await tick();

    assert.deepEqual(revokeCalls, ["dev-2"]);
    assert.match(body.innerHTML, /Old iPad/u, "a revoked device stays visible (audit trail), unlike a revoked permission policy");
    assert.match(body.innerHTML, /已撤销/u);
    assert.doesNotMatch(body.innerHTML, /data-set-revoke-device="dev-2"/u, "a revoked device loses its revoke action");
  });
});

test("R23 F-03: revoking the current device (two-step) routes through the existing sign-out flow, never the plain per-device revoke calls", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    const revokeClientDeviceCalls: string[] = [];
    const revokeCurrentClientDeviceCalls: number[] = [];
    let logoutCalls = 0;

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listClientDevices() {
            return [clientDevice({ id: "dev-1" })];
          },
          async currentClientDevice() {
            return clientDevice({ id: "dev-1" });
          },
          async revokeClientDevice(id: string) {
            revokeClientDeviceCalls.push(id);
            return clientDevice({ id, revoked_at: "2026-07-18T04:00:00.000Z" });
          },
          async revokeCurrentClientDevice() {
            revokeCurrentClientDeviceCalls.push(1);
            return clientDevice({ id: "dev-1", revoked_at: "2026-07-18T04:00:00.000Z" });
          },
          // 服务端登出会按 client-token 顺带撤销这台设备（见 apps/api/src/routes/auth.ts 的 logout
          // 处理器）——真正要验证的是"撤销本机"点了两下之后跑的是这条登出状态机，而不是任何单独的
          // 设备撤销调用。这里让 logout 失败（同既有登出失败路径测试的取舍），停在服务端阶段之前，
          // 不必在 node 测试环境里伪造真实的 window.localStorage/window.location.reload。
          async logout() {
            logoutCalls += 1;
            throw new Error("network down");
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    assert.match(body.innerHTML, /data-set-revoke-current-device="true"/u);
    assert.match(body.innerHTML, /撤销本机并登出/u);

    body.click(new FakeElement(new Set(["[data-set-revoke-current-device]"])));
    assert.equal(logoutCalls, 0, "the first click must only arm, not sign out yet");
    assert.match(body.innerHTML, /确定？再点一次/u);

    body.click(new FakeElement(new Set(["[data-set-revoke-current-device]"])));
    await tick();
    await tick();

    assert.equal(logoutCalls, 1, "confirming must run the existing sign-out flow");
    assert.deepEqual(revokeClientDeviceCalls, [], "must never call the plain per-device revoke for the current device");
    assert.deepEqual(revokeCurrentClientDeviceCalls, [], "must not call revokeCurrentClientDevice directly either — logout already revokes the device server-side by client-token");
  });
});

test("the settings view retries loading devices after a failure", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    let listCalls = 0;

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listClientDevices() {
            listCalls += 1;
            if (listCalls === 1) {
              throw new Error("network down");
            }
            return [clientDevice({ id: "dev-1" })];
          },
          async currentClientDevice() {
            return clientDevice({ id: "dev-1" });
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    assert.match(body.innerHTML, /data-set-devices-retry="true"/u);

    body.click(new FakeElement(new Set(["[data-set-devices-retry]"])));
    await tick();
    await tick();

    assert.equal(listCalls, 2);
    assert.doesNotMatch(body.innerHTML, /data-set-devices-retry/u);
  });
});

// ── R24 S5（N-02/E-02 补齐）：设置页「服务器」行 ──────────────────────────────────────────

function serverHealth(overrides: Partial<HealthResponse> = {}): HealthResponse {
  return {
    ok: true,
    service: "workhub-api",
    runtime: "node",
    port: 8787,
    ai_provider_configured: true,
    auth_mode: "nickname",
    version: "0.1.0",
    instance_name: "研发一组",
    ...overrides
  } as HealthResponse;
}

test("serverSectionHtml shows the address alone when health couldn't be fetched", () => {
  const html = serverSectionHtml({ apiBase: "http://127.0.0.1:8787", health: undefined } as DesktopServerSectionState, true);
  assert.match(html, /data-spot-server-section="true"/u);
  assert.match(html, /http:\/\/127\.0\.0\.1:8787/u);
  assert.match(html, /服务器/u);
  assert.match(html, /data-set-change-server="true"/u);
  assert.match(html, /更换服务器/u);
  assert.doesNotMatch(html, /研发一组/u);
});

test("serverSectionHtml appends the instance name and version once health is known, and escapes them", () => {
  const html = serverSectionHtml(
    { apiBase: "http://192.168.1.10:8787", health: serverHealth({ instance_name: "<b>x</b>" }) } as DesktopServerSectionState,
    false
  );
  assert.match(html, /http:\/\/192\.168\.1\.10:8787/u);
  assert.match(html, /v0\.1\.0/u);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/u);
  assert.doesNotMatch(html, /<b>x<\/b>/u);
  assert.match(html, /Change server/u);
});

test("the settings view renders the server row with the current api base and, best-effort, the server's name/version", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async health() {
            return serverHealth();
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    assert.match(body.innerHTML, /data-spot-server-section="true"/u);
    // 没有 window 全局时 driveResourceApiBase() 落回本机默认地址——这就是桌面首启的真实取值。
    assert.match(body.innerHTML, /http:\/\/127\.0\.0\.1:8787/u);
    assert.match(body.innerHTML, /研发一组/u);
    assert.match(body.innerHTML, /v0\.1\.0/u);
  });
});

test("the settings view still renders the server row (address only) when GET /api/health fails", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async health() {
            throw new Error("network down");
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    assert.match(body.innerHTML, /data-spot-server-section="true"/u);
    assert.match(body.innerHTML, /http:\/\/127\.0\.0\.1:8787/u);
  });
});

// 点「更换服务器」必须就地渲连接服务器屏（同首启/离线兜底那同一套 bindDesktopConnectScreen），
// 而不是另起一份"设置页专属"实现。document/window 都要打桩——scheduleWorkHubLiquidGlassFilterRebuild
// 眼下是个彻底空转的桩（SVG 折射整体关着），但它的参数是裸 `document` 引用，真调用一次就得让这个
// 标识符能解析，同 D1 那条"plain Node 没有 window 全局"注释同款取舍。
test("clicking 更换服务器/Change server mounts the connect-server screen in place and re-measures the box", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = settingsVm();
    let resizeCalls = 0;

    const globals = globalThis as unknown as { window?: unknown; document?: unknown };
    const originalWindow = globals.window;
    const originalDocument = globals.document;
    globals.window = { localStorage: { setItem() {}, removeItem() {} } };
    globals.document = {};

    try {
      await createSettingsView().mount(
        baseCtx(body, {
          requestResize() {
            resizeCalls += 1;
          },
          client: {
            pages: { async settings() { return vm; } },
            async request<T>(path: string) {
              if (path === "/api/me/profile") return userProfileVm() as unknown as T;
              return aiProfileVm() as unknown as T;
            },
            async health() {
              return serverHealth();
            }
          } as unknown as SpotlightViewContext["client"]
        })
      );
      await tick();
      await tick();
      const resizeCallsAfterLoad = resizeCalls;

      body.click(new FakeElement(new Set(["[data-set-change-server]"])));
      await tick();

      assert.match(body.innerHTML, /data-desktop-connect-form/u);
      assert.match(body.innerHTML, /连接到你的服务器/u);
      assert.ok(resizeCalls > resizeCallsAfterLoad, "mounting the connect screen must re-measure the box");
    } finally {
      if (originalWindow === undefined) {
        delete globals.window;
      } else {
        globals.window = originalWindow;
      }
      if (originalDocument === undefined) {
        delete globals.document;
      } else {
        globals.document = originalDocument;
      }
    }
  });
});

// —— R24-P 阶段 1：插件（桌面端是这块的主场：安装要给一台机器上的目录绝对路径） —— //

function pluginVm(over: Partial<PluginVM> = {}): PluginVM {
  return {
    id: "80000000-0000-4000-8000-000000000001",
    name: "dsh-plugin-echo",
    version: "0.1.0",
    source_kind: "local_path",
    source_path: "/srv/plugins/dsh-plugin-echo",
    enabled: true,
    status: "installed",
    trust_level: "external_effect",
    tool_count: 2,
    compat_report: { verdict: "ok", checks: [{ id: "manifest", level: "pass" }], checked_at: "2026-09-05T09:00:00.000Z" },
    created_at: "2026-09-05T09:00:00.000Z",
    updated_at: "2026-09-05T09:00:00.000Z",
    ...over
  } as unknown as PluginVM;
}

function pluginsState(over: Partial<DesktopPluginsSectionState> = {}): DesktopPluginsSectionState {
  return {
    visible: true,
    plugins: [pluginVm()],
    failed: false,
    hostDshToolsVersion: "0.1.0-rc.8",
    bootstrapPathCount: 0,
    armedKey: undefined,
    busyId: undefined,
    errorText: undefined,
    installPath: "",
    installBusy: false,
    installOutcome: undefined,
    supported: true,
    ...over
  };
}

test("pluginsSectionHtml renders nothing for a non-admin (the settings VM structurally has no plugins field)", () => {
  assert.equal(pluginsSectionHtml(pluginsState({ visible: false }), true), "");
});

test("pluginsSectionHtml lists name/version/status/tool count/path with enable-disable and remove controls", () => {
  const html = pluginsSectionHtml(pluginsState(), true);
  assert.match(html, /data-spot-plugins-section="true"/u);
  assert.match(html, /dsh-plugin-echo 0\.1\.0/u);
  assert.match(html, /已启用 · 2 个工具/u);
  assert.match(html, /\/srv\/plugins\/dsh-plugin-echo/u);
  assert.match(html, /data-set-plugin-toggle="80000000-0000-4000-8000-000000000001"/u);
  assert.match(html, /data-set-plugin-remove="80000000-0000-4000-8000-000000000001"/u);
  assert.match(html, /data-set-plugin-install="true"/u);
});

test("pluginsSectionHtml 说清这个插件被断言成什么，并给管理员一个改它的入口", () => {
  const highest = pluginsSectionHtml(pluginsState(), true);
  // 默认那一档：说的是上限（每次调用都要人确认），按钮请你把它断言成只读。
  assert.match(highest, /data-spot-plugin-trust="external_effect"/u);
  assert.match(highest, /按最高风险运行 · 每次调用都要人确认/u);
  assert.match(highest, /data-set-plugin-trust="80000000-0000-4000-8000-000000000001"/u);
  assert.match(highest, /断言为只读/u);

  const readOnly = pluginsSectionHtml(
    pluginsState({ plugins: [pluginVm({ trust_level: "read_only" } as unknown as Partial<PluginVM>)] }),
    true
  );
  assert.match(readOnly, /data-spot-plugin-trust="read_only"/u);
  // 只读断言只对**自述只读**的工具生效，这句话必须在界面上说出来，否则会被读成「整个插件都安全了」。
  assert.match(readOnly, /已断言为只读 · 自述只读的工具不再逐次转人/u);
  assert.match(readOnly, /收回只读断言/u);
});

test("pluginsSectionHtml 对反复弄崩宿主而被停下的插件另有说法，不混成「还好好跑着」", () => {
  const html = pluginsSectionHtml(
    pluginsState({ plugins: [pluginVm({ status: "crashed", tool_count: 0 } as unknown as Partial<PluginVM>)] }),
    true
  );
  assert.match(html, /反复出错已被停下 · 修好后可重新启用/u);
  assert.doesNotMatch(html, /已启用 · 0 个工具/u);
});

test("pluginsSectionHtml says 'won't load' with the host's reason — not the same thing as 'disabled'", () => {
  const html = pluginsSectionHtml(
    pluginsState({
      plugins: [
        pluginVm({
          status: "load_failed",
          tool_count: 0,
          load_report: {
            ok: false,
            tool_count: 0,
            prompt_section_count: 0,
            error: "unsupported JSON schema",
            loaded_at: "2026-09-05T09:00:00.000Z"
          }
        } as unknown as Partial<PluginVM>)
      ]
    }),
    true
  );
  assert.match(html, /装不上：unsupported JSON schema/u);
  assert.doesNotMatch(html, /已停用/u);
});

test("pluginsSectionHtml arms exactly one control at a time — enable-disable and remove never share an armed state", () => {
  const armed = pluginsSectionHtml(pluginsState({ armedKey: "remove:80000000-0000-4000-8000-000000000001" }), true);
  assert.equal((armed.match(/确定？再点一次移除/gu) ?? []).length, 1);
  assert.doesNotMatch(armed, /确定？再点一次<\/button>/u);
  // 信任级别的武装态也自成一格，不会顺手把启停/移除也武装上。
  const trustArmed = pluginsSectionHtml(
    pluginsState({ armedKey: "trust:80000000-0000-4000-8000-000000000001" }),
    true
  );
  assert.equal((trustArmed.match(/确定？再点一次断言只读/gu) ?? []).length, 1);
  assert.doesNotMatch(trustArmed, /确定？再点一次移除/u);
});

test("pluginsSectionHtml turns the compatibility report into plain language, not an English diagnostic", () => {
  const html = pluginsSectionHtml(
    pluginsState({
      plugins: [
        pluginVm({
          compat_report: {
            verdict: "warn",
            checks: [
              { id: "manifest", level: "pass" },
              { id: "dsh_tools_peer", level: "warn", detail: "wants ^0.2.0, host bundles 0.1.0-rc.8" }
            ],
            peer_dsh_tools_range: "^0.2.0",
            host_dsh_tools_version: "0.1.0-rc.8",
            checked_at: "2026-09-05T09:00:00.000Z"
          }
        } as unknown as Partial<PluginVM>)
      ]
    }),
    true
  );
  assert.match(html, /它对着另一个版本的插件工具库发布/u);
  assert.match(html, /它需要 \^0\.2\.0，当前自带的是 0\.1\.0-rc\.8/u);
  // pass 的检查不占一行——没问题的事不值得说（manifest 那条是 pass，它的诊断句不该出现）。
  assert.doesNotMatch(html, /这个目录里没有可读的 package\.json/u);
});

test("pluginsSectionHtml says how many plugin directories still come from the server's environment", () => {
  const html = pluginsSectionHtml(pluginsState({ bootstrapPathCount: 2 }), true);
  assert.match(html, /另有 2 个插件由服务器直接加载/u);
});

test("pluginsSectionHtml degrades to an explanation (not a dead button) against a server without the endpoints", () => {
  const html = pluginsSectionHtml(pluginsState({ supported: false }), true);
  assert.doesNotMatch(html, /data-set-plugin-install="true"/u);
  assert.match(html, /当前服务端版本还没有插件管理接口/u);
});

test("pluginInstallErrorText explains each refusal in the viewer's language, not by echoing the server string", () => {
  assert.match(pluginInstallErrorText("plugin_client_surface_unsupported", true), /界面\/主题类插件/u);
  assert.match(pluginInstallErrorText("plugin_client_surface_unsupported", false), /UI\/theme plugin/u);
  assert.match(pluginInstallErrorText("plugin_install_scripts_refused", true), /安装期脚本/u);
  assert.match(pluginInstallErrorText("plugin_manifest_unreadable", true), /package\.json/u);
  assert.match(pluginInstallErrorText("plugin_already_installed", true), /已经装过/u);
  assert.match(pluginInstallErrorText(undefined, true), /没装成/u);
});

test("the settings view installs a plugin from a path and renders the outcome card", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = { ...settingsVm(), plugins: [] } as unknown as SettingsPageVM;
    const installed: Array<{ source_path: string }> = [];

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listPlugins() {
            return { plugins: [], host_dsh_tools_version: "0.1.0-rc.8", bootstrap_path_count: 0 } as unknown as never;
          },
          async installPlugin(payload: { source_path: string }) {
            installed.push(payload);
            return pluginVm() as unknown as never;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();
    assert.match(body.innerHTML, /data-spot-plugins-section="true"/u);
    assert.match(body.innerHTML, /还没有装任何插件/u);

    // 路径走 focusout 收值（全量重绘架构下 input 事件会打断输入焦点），再点安装。
    body.focusOutOn(
      new FakeElement(new Set(["[data-set-plugin-install-path]"]), {}, "/srv/plugins/dsh-plugin-echo")
    );
    body.click(new FakeElement(new Set(["[data-set-plugin-install]"])));
    await tick();
    await tick();

    assert.deepEqual(installed, [{ source_path: "/srv/plugins/dsh-plugin-echo" }]);
    assert.match(body.innerHTML, /data-spot-plugin-outcome="installed"/u);
    assert.match(body.innerHTML, /装好了，上线 2 个工具/u);
    assert.match(body.innerHTML, /data-set-plugin-toggle="80000000-0000-4000-8000-000000000001"/u);
  });
});

test("a refused install renders the reason card and never adds a row to the list", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = { ...settingsVm(), plugins: [] } as unknown as SettingsPageVM;

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listPlugins() {
            return { plugins: [], bootstrap_path_count: 0 } as unknown as never;
          },
          async installPlugin() {
            throw Object.assign(new Error("refused"), { status: 422, code: "plugin_install_scripts_refused" });
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    body.focusOutOn(new FakeElement(new Set(["[data-set-plugin-install-path]"]), {}, "/srv/plugins/hooked"));
    body.click(new FakeElement(new Set(["[data-set-plugin-install]"])));
    await tick();
    await tick();

    assert.match(body.innerHTML, /data-spot-plugin-outcome="refused"/u);
    assert.match(body.innerHTML, /安装期脚本/u);
    assert.doesNotMatch(body.innerHTML, /data-set-plugin-toggle=/u);
  });
});

test("disabling a plugin takes two clicks and replaces the row with the server's answer", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = { ...settingsVm(), plugins: [] } as unknown as SettingsPageVM;
    const disabled: string[] = [];

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listPlugins() {
            return { plugins: [pluginVm()], bootstrap_path_count: 0 } as unknown as never;
          },
          async disablePlugin(id: string) {
            disabled.push(id);
            return pluginVm({ enabled: false, status: "disabled", tool_count: 0 }) as unknown as never;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    const toggle = new FakeElement(new Set(["[data-set-plugin-toggle]"]), {
      setPluginToggle: "80000000-0000-4000-8000-000000000001"
    });
    body.click(toggle);
    assert.equal(disabled.length, 0, "第一下只武装，不真的停用");
    assert.match(body.innerHTML, /确定？再点一次/u);

    body.click(toggle);
    await tick();
    await tick();
    assert.deepEqual(disabled, ["80000000-0000-4000-8000-000000000001"]);
    assert.match(body.innerHTML, /已停用/u);
    // 服务端是唯一事实源：停用后的状态用回执替换，本地不猜。
    assert.match(body.innerHTML, /data-spot-plugin="80000000-0000-4000-8000-000000000001"/u);
  });
});

test("removing a plugin takes two clicks and drops the row", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const vm = { ...settingsVm(), plugins: [] } as unknown as SettingsPageVM;
    const removed: string[] = [];

    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return vm; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listPlugins() {
            return { plugins: [pluginVm()], bootstrap_path_count: 0 } as unknown as never;
          },
          async removePlugin(id: string) {
            removed.push(id);
            return { removed: true } as unknown as never;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    const remove = new FakeElement(new Set(["[data-set-plugin-remove]"]), {
      setPluginRemove: "80000000-0000-4000-8000-000000000001"
    });
    body.click(remove);
    assert.equal(removed.length, 0, "第一下只武装");
    body.click(remove);
    await tick();
    await tick();
    assert.deepEqual(removed, ["80000000-0000-4000-8000-000000000001"]);
    assert.doesNotMatch(body.innerHTML, /data-set-plugin-remove=/u);
    assert.match(body.innerHTML, /还没有装任何插件/u);
  });
});

test("a non-admin settings view never fetches the plugin list at all", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    let listed = 0;
    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return settingsVm(); } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listPlugins() {
            listed += 1;
            return { plugins: [], bootstrap_path_count: 0 } as unknown as never;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();
    assert.equal(listed, 0, "省一次注定 403 的请求");
    assert.doesNotMatch(body.innerHTML, /data-spot-plugins-section/u);
  });
});

// —— R26 M7：MCP 服务器分区（接线面。纯渲染面在 settings-mcp.test.ts） —— //

const MCP_ID = "90000000-0000-4000-8000-000000000001";

function mcpServerVm(over: Record<string, unknown> = {}): McpServerVM {
  return {
    id: MCP_ID,
    server_name: "gh",
    transport: "stdio",
    command: "/usr/local/bin/mcp-server-github",
    args: [],
    env: {},
    secret_refs: {},
    tool_call_timeout_ms: 60000,
    enabled: true,
    status: "connected",
    trust_level: "external_effect",
    precheck_report: { verdict: "ok", checks: [], checked_at: "2026-09-06T00:00:00.000Z" },
    tool_count: 2,
    tools: ["create_issue", "list_issues"],
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    ...over
  } as unknown as McpServerVM;
}

function mcpActionResult(server: McpServerVM, over: Record<string, unknown> = {}): McpServerActionResult {
  return {
    server,
    connection: { live: true, tool_count: server.tool_count },
    risk_tokens: [],
    ...over
  } as unknown as McpServerActionResult;
}

/** 管理员的 settings VM：服务端只给管理员填 plugins 与 mcp_servers，两个区各据自己那个字段。 */
function adminSettingsVm(): SettingsPageVM {
  return { ...settingsVm(), plugins: [], mcp_servers: [] } as unknown as SettingsPageVM;
}

function mcpListVm(servers: McpServerVM[], over: Record<string, unknown> = {}) {
  return {
    servers,
    connections: Object.fromEntries(
      servers.map((server) => [
        server.id,
        {
          live: true,
          tool_count: server.tool_count,
          tool_ids: (server.tools ?? []).map((tool) => `mcp__${server.server_name}__${tool}`)
        }
      ])
    ),
    secret_ref_env_prefix: "WORKHUB_MCP_SECRET_",
    available_secret_refs: ["WORKHUB_MCP_SECRET_GITHUB_TOKEN"],
    ...over
  } as unknown as never;
}

function mcpCtx(body: FakeBody, client: Record<string, unknown>): SpotlightViewContext {
  return baseCtx(body, {
    client: {
      pages: { async settings() { return adminSettingsVm(); } },
      async request<T>(path: string) {
        if (path === "/api/me/profile") return userProfileVm() as unknown as T;
        return aiProfileVm() as unknown as T;
      },
      async listPlugins() {
        return { plugins: [], bootstrap_path_count: 0 } as unknown as never;
      },
      ...client
    } as unknown as SpotlightViewContext["client"]
  });
}

test("a non-admin settings view never fetches the MCP server list either", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    let listed = 0;
    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return settingsVm(); } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listMcpServers() {
            listed += 1;
            return mcpListVm([]);
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();
    assert.equal(listed, 0, "省一次注定 403 的请求");
    assert.doesNotMatch(body.innerHTML, /data-spot-mcp-section/u);
  });
});

test("R26 F3: the MCP section follows mcp_servers, not the plugins field it borrowed in M7", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    let listed = 0;
    // 一个填了 plugins、却没有 mcp_servers 的 VM：M7 借 plugins 时这里会渲出一个必然 403 的分区。
    const pluginsOnly = { ...settingsVm(), plugins: [] } as unknown as SettingsPageVM;
    await createSettingsView().mount(
      baseCtx(body, {
        client: {
          pages: { async settings() { return pluginsOnly; } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listPlugins() {
            return { plugins: [], bootstrap_path_count: 0 } as unknown as never;
          },
          async listMcpServers() {
            listed += 1;
            return mcpListVm([]);
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();
    assert.equal(listed, 0);
    assert.doesNotMatch(body.innerHTML, /data-spot-mcp-section/u);
    assert.match(body.innerHTML, /data-spot-plugins-section/u, "插件区仍据 plugins 渲染，两个门互不牵连");
  });
});

test("the settings view lists MCP servers for an admin and renders every action", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    await createSettingsView().mount(
      mcpCtx(body, { async listMcpServers() { return mcpListVm([mcpServerVm()]); } })
    );
    await tick();
    await tick();
    assert.match(body.innerHTML, /data-spot-mcp-section="true"/u);
    assert.match(body.innerHTML, new RegExp(`data-spot-mcp-server="${MCP_ID}"`, "u"));
    assert.match(body.innerHTML, /已连接 · 2 个工具/u);
    assert.match(body.innerHTML, new RegExp(`data-set-mcp-test="${MCP_ID}"`, "u"));
  });
});

test("adding an MCP server sends exactly the fields that were filled and renders the outcome", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const added: unknown[] = [];
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() { return mcpListVm([]); },
        async addMcpServer(payload: unknown) {
          added.push(payload);
          return mcpActionResult(mcpServerVm({ server_name: "finance" }), { risk_tokens: ["finance"] });
        }
      })
    );
    await tick();
    await tick();
    assert.match(body.innerHTML, /还没有接入 MCP 服务器/u);

    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-name]"]), {}, "finance"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-command]"]), {}, "/usr/local/bin/mcp-fin"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-args]"]), {}, "--stdio\n--verbose"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-env]"]), {}, "LOG_LEVEL=debug"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-cwd]"]), {}, "/srv/fin"));
    body.click(new FakeElement(new Set(["[data-set-mcp-add]"])));
    await tick();
    await tick();

    assert.deepEqual(added, [
      {
        server_name: "finance",
        command: "/usr/local/bin/mcp-fin",
        trust_level: "external_effect",
        tool_call_timeout_ms: 60000,
        args: ["--stdio", "--verbose"],
        env: { LOG_LEVEL: "debug" },
        cwd: "/srv/fin"
      }
    ]);
    assert.match(body.innerHTML, /data-spot-mcp-outcome="connected"/u);
    // 名字里的高风险词按回执回显具体命中的那个词，不是一句泛泛的警告。
    assert.match(body.innerHTML, /名字里命中的高风险词：finance/u);
    assert.match(body.innerHTML, new RegExp(`data-set-mcp-toggle="${MCP_ID}"`, "u"));
  });
});

test("typing a server name previews the tool-name prefix before anything is submitted", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() { return mcpListVm([]); },
        async addMcpServer() { return mcpActionResult(mcpServerVm()); }
      })
    );
    await tick();
    await tick();
    assert.doesNotMatch(body.innerHTML, /data-spot-mcp-name-preview/u);

    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-name]"]), {}, "gh"));
    assert.match(body.innerHTML, /data-spot-mcp-name-preview="true"/u);
    assert.match(body.innerHTML, /mcp__gh__/u);
  });
});

test("a refused add explains the refusal by code and adds no row", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() { return mcpListVm([]); },
        async addMcpServer() {
          throw Object.assign(new Error("refused"), { status: 422, code: "mcp_remote_exec_refused" });
        }
      })
    );
    await tick();
    await tick();

    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-name]"]), {}, "gh"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-command]"]), {}, "npx"));
    body.click(new FakeElement(new Set(["[data-set-mcp-add]"])));
    await tick();
    await tick();

    assert.match(body.innerHTML, /data-spot-mcp-outcome="refused"/u);
    assert.match(body.innerHTML, /先在这台机器上把它装好/u);
    assert.doesNotMatch(body.innerHTML, /data-set-mcp-toggle=/u);
  });
});

test("a name that is already taken comes back as a 409 the form explains, not a generic failure", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() { return mcpListVm([mcpServerVm()]); },
        async addMcpServer() {
          throw Object.assign(new Error("taken"), { status: 409, code: "mcp_server_name_taken" });
        }
      })
    );
    await tick();
    await tick();
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-name]"]), {}, "gh"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-command]"]), {}, "/usr/local/bin/x"));
    body.click(new FakeElement(new Set(["[data-set-mcp-add]"])));
    await tick();
    await tick();
    assert.match(body.innerHTML, /已经被另一台服务器用了/u);
  });
});

test("the add form refuses locally on the three shapes the server would only answer with a 422", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    let calls = 0;
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() { return mcpListVm([]); },
        async addMcpServer() {
          calls += 1;
          return mcpActionResult(mcpServerVm());
        }
      })
    );
    await tick();
    await tick();

    // ① 名字/命令为空。
    body.click(new FakeElement(new Set(["[data-set-mcp-add]"])));
    await tick();
    assert.match(body.innerHTML, /先把服务器名和启动命令填上/u);

    // ② 环境变量读不了的那一行被点名。
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-name]"]), {}, "gh"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-command]"]), {}, "/usr/local/bin/x"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-env]"]), {}, "GITHUB_TOKEN"));
    body.click(new FakeElement(new Set(["[data-set-mcp-add]"])));
    await tick();
    assert.match(body.innerHTML, /GITHUB_TOKEN/u);
    assert.match(body.innerHTML, /一行写一条 KEY=VALUE/u);

    // ③ 超时越界。
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-env]"]), {}, ""));
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-timeout-new]"]), {}, "10"));
    body.click(new FakeElement(new Set(["[data-set-mcp-add]"])));
    await tick();
    assert.match(body.innerHTML, /1000 到 300000/u);

    assert.equal(calls, 0, "三种一定被拒的填法，一次请求都不发");
  });
});

test("a secret reference is picked by variable name and travels as a pointer, never as a value", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const added: unknown[] = [];
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() { return mcpListVm([]); },
        async addMcpServer(payload: unknown) {
          added.push(payload);
          return mcpActionResult(mcpServerVm());
        }
      })
    );
    await tick();
    await tick();
    // 下拉里只有名字——服务端从来不把值交给这一层。
    assert.match(body.innerHTML, /WORKHUB_MCP_SECRET_GITHUB_TOKEN/u);

    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-secret-child]"]), {}, "GITHUB_TOKEN"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-secret-var]"]), {}, "WORKHUB_MCP_SECRET_GITHUB_TOKEN"));
    body.click(new FakeElement(new Set(["[data-set-mcp-secret-add]"])));
    assert.match(body.innerHTML, /data-spot-mcp-secret-ref="GITHUB_TOKEN"/u);

    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-name]"]), {}, "gh"));
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-command]"]), {}, "/usr/local/bin/x"));
    body.click(new FakeElement(new Set(["[data-set-mcp-add]"])));
    await tick();
    await tick();

    assert.deepEqual((added[0] as { secret_refs?: unknown }).secret_refs, {
      GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB_TOKEN"
    });
  });
});

test("half a secret reference is refused before it can become a server that starts without its credential", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() { return mcpListVm([]); },
        async addMcpServer() { return mcpActionResult(mcpServerVm()); }
      })
    );
    await tick();
    await tick();
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-secret-child]"]), {}, "GITHUB_TOKEN"));
    body.click(new FakeElement(new Set(["[data-set-mcp-secret-add]"])));
    assert.match(body.innerHTML, /两边都要填/u);
    assert.doesNotMatch(body.innerHTML, /data-spot-mcp-secret-ref=/u);
  });
});

test("disabling an MCP server takes two clicks and replaces the row with the server's answer", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const disabled: string[] = [];
    const reEnabled: string[] = [];
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() { return mcpListVm([mcpServerVm()]); },
        async disableMcpServer(id: string) {
          disabled.push(id);
          // 停用的服务器整体没有连接快照（不是 live:false 那种「连过但没活着」）。
          return { server: mcpServerVm({ enabled: false, status: "disabled", tool_count: 0 }), risk_tokens: [] } as unknown as never;
        },
        async enableMcpServer(id: string) {
          reEnabled.push(id);
          // 启用之后的真实结果只会由连接监督写回；这一次它连不上，回执里也就没有连接快照。
          return {
            server: mcpServerVm({ status: "connect_failed", tool_count: 0, tools: [], last_error: "spawn ENOENT" }),
            risk_tokens: []
          } as unknown as never;
        }
      })
    );
    await tick();
    await tick();

    const toggle = new FakeElement(new Set(["[data-set-mcp-toggle]"]), { setMcpToggle: MCP_ID });
    body.click(toggle);
    assert.equal(disabled.length, 0, "第一下只武装，不真的停用");
    assert.match(body.innerHTML, /确定？再点一次/u);

    body.click(toggle);
    await tick();
    await tick();
    assert.deepEqual(disabled, [MCP_ID]);
    assert.match(body.innerHTML, /data-spot-mcp-status="disabled"/u);
    assert.doesNotMatch(body.innerHTML, /已连接/u);

    // 停用把连接快照一并丢掉：再启用时如果服务端说「连不上」，那一行不能拿停用前的旧快照
    // 复活出一句「已连接 · 2 个工具」。
    const enabled = new FakeElement(new Set(["[data-set-mcp-toggle]"]), { setMcpToggle: MCP_ID });
    body.click(enabled);
    body.click(enabled);
    await tick();
    await tick();
    assert.deepEqual(reEnabled, [MCP_ID]);
    assert.match(body.innerHTML, /data-spot-mcp-status="connect_failed"/u);
    assert.doesNotMatch(body.innerHTML, /2 个工具/u);
    assert.doesNotMatch(body.innerHTML, /mcp__gh__create_issue/u, "工具预览不能从停用前的旧快照里复活");
  });
});

test("testing a connection is a single click, and a 200 that says can't connect is not reported as a broken request", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const reloaded: string[] = [];
    const errors: string[] = [];
    await createSettingsView().mount(
      baseCtx(body, {
        toast(text: string, tone?: "error" | "ok" | "info") {
          if (tone === "error") errors.push(text);
        },
        client: {
          pages: { async settings() { return adminSettingsVm(); } },
          async request<T>(path: string) {
            if (path === "/api/me/profile") return userProfileVm() as unknown as T;
            return aiProfileVm() as unknown as T;
          },
          async listPlugins() { return { plugins: [], bootstrap_path_count: 0 } as unknown as never; },
          async listMcpServers() { return mcpListVm([mcpServerVm()]); },
          async reloadMcpServer(id: string) {
            reloaded.push(id);
            return {
              server: mcpServerVm({ status: "connect_failed", tool_count: 0, tools: [], last_error: "spawn ENOENT" }),
              connection: { live: false, tool_count: 0, last_error: "spawn ENOENT" },
              risk_tokens: []
            } as unknown as never;
          }
        } as unknown as SpotlightViewContext["client"]
      })
    );
    await tick();
    await tick();

    body.click(new FakeElement(new Set(["[data-set-mcp-test]"]), { setMcpTest: MCP_ID }));
    await tick();
    await tick();
    assert.deepEqual(reloaded, [MCP_ID], "测试连接不改配置，一下就走");
    assert.match(body.innerHTML, /data-spot-mcp-status="connect_failed"/u);
    assert.match(body.innerHTML, /连不上这台服务器/u);
    assert.match(body.innerHTML, /spawn ENOENT/u);
    assert.deepEqual(errors, [], "连不上是一条结论，不是一次失败的请求");
  });
});

test("loosening the trust level takes two clicks; tightening it back takes one", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const patches: Array<{ id: string; payload: unknown }> = [];
    let current = mcpServerVm();
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() { return mcpListVm([current]); },
        async updateMcpServer(id: string, payload: { trust_level?: string }) {
          patches.push({ id, payload });
          current = mcpServerVm({ trust_level: payload.trust_level });
          return mcpActionResult(current);
        }
      })
    );
    await tick();
    await tick();

    // external_effect → read_only 是在撤掉一道人工门：两段式。
    const trust = new FakeElement(new Set(["[data-set-mcp-trust]"]), { setMcpTrust: MCP_ID });
    body.click(trust);
    assert.equal(patches.length, 0);
    body.click(trust);
    await tick();
    await tick();
    assert.deepEqual(patches, [{ id: MCP_ID, payload: { trust_level: "read_only" } }]);
    assert.match(body.innerHTML, /data-spot-mcp-trust="read_only"/u);

    // read_only → external_effect 是把门装回去：不再拦一次。
    body.click(new FakeElement(new Set(["[data-set-mcp-trust]"]), { setMcpTrust: MCP_ID }));
    await tick();
    await tick();
    assert.equal(patches.length, 2);
    assert.deepEqual(patches[1], { id: MCP_ID, payload: { trust_level: "external_effect" } });
  });
});

test("leaving the timeout field saves it; an out-of-range value is refused without a request", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const patches: unknown[] = [];
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() { return mcpListVm([mcpServerVm()]); },
        async updateMcpServer(id: string, payload: unknown) {
          patches.push(payload);
          return mcpActionResult(mcpServerVm({ tool_call_timeout_ms: 90000 }));
        }
      })
    );
    await tick();
    await tick();

    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-timeout]"]), { setMcpTimeout: MCP_ID }, "90000"));
    await tick();
    await tick();
    assert.deepEqual(patches, [{ tool_call_timeout_ms: 90000 }]);

    // 同一个值再离开一次不该再发一次空转的 PATCH。
    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-timeout]"]), { setMcpTimeout: MCP_ID }, "90000"));
    await tick();
    assert.equal(patches.length, 1);

    body.focusOutOn(new FakeElement(new Set(["[data-set-mcp-timeout]"]), { setMcpTimeout: MCP_ID }, "10"));
    await tick();
    assert.equal(patches.length, 1, "越界的值不发请求");
    assert.match(body.innerHTML, /1000 到 300000/u);
  });
});

test("removing an MCP server takes two clicks and drops the row", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const removed: string[] = [];
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() { return mcpListVm([mcpServerVm()]); },
        async removeMcpServer(id: string) {
          removed.push(id);
        }
      })
    );
    await tick();
    await tick();

    const remove = new FakeElement(new Set(["[data-set-mcp-remove]"]), { setMcpRemove: MCP_ID });
    body.click(remove);
    assert.equal(removed.length, 0, "第一下只武装");
    body.click(remove);
    await tick();
    await tick();
    assert.deepEqual(removed, [MCP_ID]);
    assert.doesNotMatch(body.innerHTML, /data-set-mcp-remove=/u);
    assert.match(body.innerHTML, /还没有接入 MCP 服务器/u);
  });
});

test("a failed list offers a retry that really refetches", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    let attempts = 0;
    await createSettingsView().mount(
      mcpCtx(body, {
        async listMcpServers() {
          attempts += 1;
          if (attempts === 1) throw new Error("network");
          return mcpListVm([mcpServerVm()]);
        }
      })
    );
    await tick();
    await tick();
    assert.match(body.innerHTML, /data-set-mcp-retry="true"/u);

    body.click(new FakeElement(new Set(["[data-set-mcp-retry]"])));
    await tick();
    await tick();
    assert.equal(attempts, 2);
    assert.match(body.innerHTML, new RegExp(`data-spot-mcp-server="${MCP_ID}"`, "u"));
  });
});

test("against a backend without the MCP endpoints the section explains instead of offering a dead button", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    await createSettingsView().mount(mcpCtx(body, {}));
    await tick();
    await tick();
    assert.match(body.innerHTML, /data-spot-mcp-section="true"/u);
    assert.doesNotMatch(body.innerHTML, /data-set-mcp-add="true"/u);
    assert.match(body.innerHTML, /还没有 MCP 服务器管理接口/u);
  });
});

test("the plugin section carries the same warning that words in a name are graded before any trust level", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    await createSettingsView().mount(
      mcpCtx(body, {
        async listPlugins() { return { plugins: [], bootstrap_path_count: 0 } as unknown as never; },
        async listMcpServers() { return mcpListVm([]); },
        async addMcpServer() { return mcpActionResult(mcpServerVm()); }
      })
    );
    await tick();
    await tick();
    assert.match(body.innerHTML, /这类名字的插件/u);
    assert.match(body.innerHTML, /这类名字的服务器/u);
  });
});

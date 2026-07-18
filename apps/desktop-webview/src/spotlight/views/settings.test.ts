import assert from "node:assert/strict";
import test from "node:test";

import type { SettingsPageVM, UserAiProfileVM, UserProfileVM } from "@workhub/contracts";

import {
  createSettingsView,
  decidePolicyRevokeConfirmation,
  logoutErrorPanelHtml,
  permissionPoliciesSectionHtml,
  runDesktopLogout,
  type DesktopLogoutEffects,
  type DesktopLogoutStage,
  type DesktopLogoutView
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

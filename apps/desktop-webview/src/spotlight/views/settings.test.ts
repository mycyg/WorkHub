import assert from "node:assert/strict";
import test from "node:test";

import type { SettingsPageVM, UserAiProfileVM } from "@workhub/contracts";

import { createSettingsView } from "./settings.js";
import type { SpotlightViewContext } from "../view-context.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

class FakeElement {
  public dataset: Record<string, string> = {};

  constructor(private readonly selectors = new Set<string>(), dataset: Record<string, string> = {}) {
    this.dataset = dataset;
  }

  closest<T extends Element = Element>(selector: string): T | null {
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }
}

class FakeBody extends FakeElement {
  public innerHTML = "";
  private readonly clickListeners: Array<(event: { target: unknown }) => void> = [];

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type !== "click") return;
    this.clickListeners.push((event) => {
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
          async request<T>() {
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

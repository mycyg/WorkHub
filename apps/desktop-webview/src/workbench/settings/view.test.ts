import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";
import type { GithubBindingStatusVM, GithubTestConnectionResult, ProjectAiGovernanceVM } from "@workhub/contracts";

import { defaultEnabledQuietHours, mountProjectSettingsView } from "./view.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

class FakeElement {
  public dataset: Record<string, string> = {};
  public value = "";

  constructor(private readonly selectors = new Set<string>(), dataset: Record<string, string> = {}) {
    this.dataset = dataset;
  }

  closest<T extends Element = Element>(selector: string): T | null {
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }

  matches(selector: string): boolean {
    return this.selectors.has(selector);
  }
}

class FakeContainer extends FakeElement {
  public innerHTML = "";
  private readonly listeners = new Map<string, Array<(event: { target: unknown }) => void>>();
  private readonly queryResults = new Map<string, FakeElement>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push((event) => {
      if (typeof listener === "function") {
        listener(event as unknown as Event);
      } else {
        listener.handleEvent(event as unknown as Event);
      }
    });
    this.listeners.set(type, bucket);
  }

  setQueryResult(selector: string, element: FakeElement) {
    this.queryResults.set(selector, element);
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    return (this.queryResults.get(selector) as unknown as T) ?? null;
  }

  dispatch(type: string, target: FakeElement) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target });
    }
  }
}

function governanceVm(over: Partial<ProjectAiGovernanceVM> = {}): ProjectAiGovernanceVM {
  return {
    project_id: "90000000-0000-4000-8000-000000000001",
    observer_enabled: true,
    silence_window_seconds: 60,
    quiet_hours: { enabled: false },
    granular_settings: {},
    // R14 批 RISK：ProjectAiGovernanceVM 加了必填 risk_monitor（读侧完整默认值合并输出）——
    // 不是本文件测的功能改动，纯粹是共享契约加字段牵连的机械补齐（设置分区 UI 归 RISK-B 工包）。
    risk_monitor: {
      enabled: true,
      stall_days_threshold: 5,
      deadline_lookahead_days: 2,
      cost_spike_ratio_pct: 300,
      cost_spike_min_cny: 20
    },
    updated_at: null,
    ...over
  };
}

type RecordedRequest = { path: string; init: RequestInit | undefined };

function githubBindingVm(over: Partial<GithubBindingStatusVM> = {}): GithubBindingStatusVM {
  return { project_id: "90000000-0000-4000-8000-000000000001", bound: false, ...over };
}

// R14 批 GH：clientReturning 现在也要路由 /github-binding 请求——mountProjectSettingsView 挂载时
// 会并行拉 GH 绑定卡的独立状态（见 view.ts 顶部注释：两个分区权限口径不同，不能共用一个 loadState）。
// 现有（非 GH 相关）测试没有提供任何 onGithub* 处理器，此时默认回落"未绑定"，让它们的 governance
// 断言不受影响；GH 专项测试通过 onGithub* 覆盖默认值。
function clientReturning(input: {
  onGet?: () => ProjectAiGovernanceVM | Promise<ProjectAiGovernanceVM>;
  onPatch?: (body: Record<string, unknown>) => ProjectAiGovernanceVM | Promise<ProjectAiGovernanceVM>;
  onGithubGet?: () => GithubBindingStatusVM | Promise<GithubBindingStatusVM>;
  onGithubPut?: (body: Record<string, unknown>) => GithubBindingStatusVM | Promise<GithubBindingStatusVM>;
  onGithubDelete?: () => void | Promise<void>;
  onGithubTest?: (body: Record<string, unknown>) => GithubTestConnectionResult | Promise<GithubTestConnectionResult>;
  requests?: RecordedRequest[];
}) {
  return {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      input.requests?.push({ path, init });
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path.includes("/github-binding")) {
        if (path.endsWith("/test")) {
          if (!input.onGithubTest) {
            throw new Error("unexpected github test");
          }
          return (await input.onGithubTest(body)) as unknown as T;
        }
        if (init?.method === "PUT") {
          if (!input.onGithubPut) {
            throw new Error("unexpected github PUT");
          }
          return (await input.onGithubPut(body)) as unknown as T;
        }
        if (init?.method === "DELETE") {
          if (!input.onGithubDelete) {
            throw new Error("unexpected github DELETE");
          }
          await input.onGithubDelete();
          return undefined as unknown as T;
        }
        return (await (input.onGithubGet ? input.onGithubGet() : githubBindingVm())) as unknown as T;
      }
      if (init?.method === "PATCH") {
        if (!input.onPatch) {
          throw new Error("unexpected PATCH");
        }
        return (await input.onPatch(body)) as unknown as T;
      }
      if (!input.onGet) {
        throw new Error("unexpected GET");
      }
      return (await input.onGet()) as unknown as T;
    }
  };
}

async function withFakeDomGlobals<T>(run: () => Promise<T>): Promise<T> {
  const globals = globalThis as typeof globalThis & {
    HTMLElement: typeof HTMLElement;
    HTMLInputElement: typeof HTMLInputElement;
  };
  const previousElement = globals.HTMLElement;
  const previousInput = globals.HTMLInputElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  globals.HTMLInputElement = FakeElement as unknown as typeof HTMLInputElement;
  try {
    return await run();
  } finally {
    globals.HTMLElement = previousElement;
    globals.HTMLInputElement = previousInput;
  }
}

test("mounts, loads governance over the real endpoint path, and renders the editable form", async () => {
  const requests: RecordedRequest[] = [];
  const container = new FakeContainer();
  mountProjectSettingsView(container as unknown as HTMLElement, {
    client: clientReturning({ onGet: () => governanceVm(), requests }),
    locale: "zh-CN",
    projectId: "90000000-0000-4000-8000-000000000001",
    projectName: "星尘短剧",
    editable: true
  });
  await tick();

  assert.equal(requests[0]?.path, "/api/projects/90000000-0000-4000-8000-000000000001/ai-governance");
  assert.match(container.innerHTML, /data-wb-pset-observer\b/u);
  assert.match(container.innerHTML, /项目设置 · 星尘短剧/u);
});

test("a 404 load renders the honest owner-only state instead of a retry dead end", async () => {
  const container = new FakeContainer();
  mountProjectSettingsView(container as unknown as HTMLElement, {
    client: clientReturning({
      onGet: () => {
        throw new WorkHubApiError(404, "ai_governance_not_found", "没有找到可管理的项目 AI 设置。");
      }
    }),
    locale: "zh-CN",
    projectId: "90000000-0000-4000-8000-000000000001",
    projectName: "星尘短剧",
    editable: false
  });
  await tick();

  assert.match(container.innerHTML, /data-wb-pset-owner-only="true"/u);
  assert.doesNotMatch(container.innerHTML, /data-wb-pset-retry/u);
});

test("toggling the observer switch PATCHes observer_enabled with optimistic update and rollback on failure", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    let failPatch = false;
    const patched: Record<string, unknown>[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm({ observer_enabled: true }),
        onPatch: (body) => {
          patched.push(body);
          if (failPatch) {
            throw new WorkHubApiError(500, "internal_error", "boom");
          }
          return governanceVm({ observer_enabled: body.observer_enabled as boolean });
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-observer]"])));
    // Optimistic flip to off before the PATCH settles.
    assert.match(container.innerHTML, /data-on="false"[^>]*data-wb-pset-observer/u);
    await tick();
    assert.deepEqual(patched, [{ observer_enabled: false }]);
    assert.match(container.innerHTML, /data-on="false"[^>]*data-wb-pset-observer/u);

    // Second toggle fails server-side: rolls back to off and shows the inline error.
    failPatch = true;
    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-observer]"])));
    await tick();
    await tick();
    assert.match(container.innerHTML, /data-on="false"[^>]*data-wb-pset-observer/u);
    assert.match(container.innerHTML, /data-wb-pset-error="true"/u);
  });
});

test("the silence-window save button validates the range client-side and PATCHes only the field", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const patched: Record<string, unknown>[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm({ silence_window_seconds: 60 }),
        onPatch: (body) => {
          patched.push(body);
          return governanceVm({ silence_window_seconds: body.silence_window_seconds as number });
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    const field = new FakeElement();
    field.value = "90000";
    container.setQueryResult("[data-wb-pset-silence-input]", field);
    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-silence-save]"])));
    await tick();
    // Out of range: no PATCH, inline error instead.
    assert.equal(patched.length, 0);
    assert.match(container.innerHTML, /data-wb-pset-error="true"/u);

    field.value = "120";
    container.setQueryResult("[data-wb-pset-silence-input]", field);
    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-silence-save]"])));
    await tick();
    assert.deepEqual(patched, [{ silence_window_seconds: 120 }]);
    assert.match(container.innerHTML, /value="120" data-wb-pset-silence-input/u);
  });
});

test("enabling quiet hours sends a full valid quiet_hours object; the last weekday cannot be removed", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const patched: Record<string, unknown>[] = [];
    let current = governanceVm({ quiet_hours: { enabled: false } });
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => current,
        onPatch: (body) => {
          patched.push(body);
          current = governanceVm({ quiet_hours: body.quiet_hours as ProjectAiGovernanceVM["quiet_hours"] });
          return current;
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-quiet-toggle]"])));
    await tick();
    assert.equal(patched.length, 1);
    const sent = patched[0]!.quiet_hours as { enabled: boolean; weekdays: number[]; start_minute: number; end_minute: number };
    assert.equal(sent.enabled, true);
    assert.deepEqual(sent.weekdays, [0, 1, 2, 3, 4, 5, 6]);
    assert.notEqual(sent.start_minute, sent.end_minute);

    // Remove weekdays down to one, then confirm the guard blocks removing the last one.
    for (const day of [1, 2, 3, 4, 5, 6]) {
      container.dispatch(
        "click",
        new FakeElement(new Set(["[data-wb-pset-quiet-weekday]"]), { wbPsetQuietWeekday: String(day) })
      );
      await tick();
    }
    const before = patched.length;
    container.dispatch(
      "click",
      new FakeElement(new Set(["[data-wb-pset-quiet-weekday]"]), { wbPsetQuietWeekday: "0" })
    );
    await tick();
    assert.equal(patched.length, before, "removing the final weekday must not produce a PATCH");
    assert.match(container.innerHTML, /至少保留一天/u);
  });
});

test("toggling one granular capability resends all four keys explicitly", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const patched: Record<string, unknown>[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm({ granular_settings: { send_notification: false } }),
        onPatch: (body) => {
          patched.push(body);
          return governanceVm({ granular_settings: body.granular_settings as ProjectAiGovernanceVM["granular_settings"] });
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.dispatch(
      "click",
      new FakeElement(new Set(["[data-wb-pset-granular]"]), { wbPsetGranular: "dispatch_run" })
    );
    await tick();
    assert.deepEqual(patched, [
      {
        granular_settings: {
          create_work_item: true,
          dispatch_run: false,
          mutate_drive: true,
          send_notification: false
        }
      }
    ]);
  });
});

test("a non-editable mount never issues a PATCH no matter what is clicked", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const requests: RecordedRequest[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({ onGet: () => governanceVm(), requests }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: false
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-observer]"])));
    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-quiet-toggle]"])));
    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-granular]"]), { wbPsetGranular: "mutate_drive" }));
    await tick();

    assert.equal(requests.filter((request) => request.init?.method === "PATCH").length, 0);
    assert.match(container.innerHTML, /只有项目负责人能修改这些设置。/u);
  });
});

// —— R14 批 GH（07-gh-design.md §3 UI 节）：GitHub 绑定卡是独立分区、独立状态机——GET 权限口径
// 比上面 governance 松（项目可见者皆可读），所以下面几个用例故意让 governance 走 owner_only/404，
// 验证 GH 分区仍能独立加载/展示，不被 governance 的早退早死带着一起挂掉。 —— //

test("R14 GH: an unbound project renders the honest placeholder with a bind CTA for the owner", async () => {
  const container = new FakeContainer();
  mountProjectSettingsView(container as unknown as HTMLElement, {
    client: clientReturning({ onGet: () => governanceVm() }),
    locale: "zh-CN",
    projectId: "90000000-0000-4000-8000-000000000001",
    projectName: "星尘短剧",
    editable: true
  });
  await tick();

  assert.match(container.innerHTML, /还没有关联 GitHub 仓库/u);
  assert.match(container.innerHTML, /data-wb-gh-bind-cta/u);
});

test("R14 GH: a bound project renders repo/sync/activity status for a non-owner (whose governance section is owner-only) with no write hooks", async () => {
  const container = new FakeContainer();
  mountProjectSettingsView(container as unknown as HTMLElement, {
    client: clientReturning({
      onGet: () => {
        throw new WorkHubApiError(404, "ai_governance_not_found", "没有找到可管理的项目 AI 设置。");
      },
      onGithubGet: () =>
        githubBindingVm({
          bound: true,
          repo_full_name: "octocat/Hello-World",
          last_synced_at: "2026-07-14T09:00:00.000Z",
          activity_count_7d: 12
        })
    }),
    locale: "zh-CN",
    projectId: "90000000-0000-4000-8000-000000000001",
    projectName: "星尘短剧",
    editable: false
  });
  await tick();

  // Governance still shows its own owner-only explanation...
  assert.match(container.innerHTML, /data-wb-pset-owner-only="true"/u);
  // ...but the GH section renders independently, proving it isn't gated on governance's loadState.
  assert.match(container.innerHTML, /octocat\/Hello-World/u);
  assert.match(container.innerHTML, /近 7 天活动 12 条/u);
  assert.doesNotMatch(container.innerHTML, /data-wb-gh-unbind\b/u);
  assert.doesNotMatch(container.innerHTML, /data-wb-gh-edit-cta\b/u);
  assert.match(container.innerHTML, /只有项目负责人能管理 GitHub 绑定。/u);
});

test("R14 GH: a load failure renders a scoped retry that reloads only the GitHub section", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    let fail = true;
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm(),
        onGithubGet: () => {
          if (fail) {
            throw new WorkHubApiError(500, "internal_error", "boom");
          }
          return githubBindingVm();
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    assert.match(container.innerHTML, /GitHub 绑定状态没拉到，稍后重试/u);
    fail = false;
    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-retry]"])));
    await tick();
    assert.match(container.innerHTML, /还没有关联 GitHub 仓库/u);
  });
});

test("R14 GH: owner opens the bind form, tests the connection, links the repo, and the typed PAT is never echoed back afterward", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const putBodies: Record<string, unknown>[] = [];
    const testBodies: Record<string, unknown>[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm(),
        onGithubGet: () => githubBindingVm(),
        onGithubTest: (body) => {
          testBodies.push(body);
          return { ok: true, repo_full_name: "octocat/Hello-World", repo_default_branch: "main", repo_private: false };
        },
        onGithubPut: (body) => {
          putBodies.push(body);
          return githubBindingVm({ bound: true, repo_full_name: body.repo_full_name as string, activity_count_7d: 0 });
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-bind-cta]"])));
    await tick();
    assert.match(container.innerHTML, /data-wb-gh-form="true"/u);

    const repoField = new FakeElement();
    repoField.value = "octocat/Hello-World";
    const patField = new FakeElement();
    patField.value = "ghp_1234567890abcdef1234";
    container.setQueryResult("[data-wb-gh-repo-input]", repoField);
    container.setQueryResult("[data-wb-gh-pat-input]", patField);

    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-test]"])));
    await tick();
    assert.deepEqual(testBodies, [{ repo_full_name: "octocat/Hello-World", personal_access_token: "ghp_1234567890abcdef1234" }]);
    assert.match(container.innerHTML, /连接成功/u);

    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-submit]"])));
    await tick();
    assert.deepEqual(putBodies, [{ repo_full_name: "octocat/Hello-World", personal_access_token: "ghp_1234567890abcdef1234" }]);
    assert.match(container.innerHTML, /octocat\/Hello-World/u);
    assert.doesNotMatch(container.innerHTML, /ghp_1234567890abcdef1234/u);
    assert.doesNotMatch(container.innerHTML, /data-wb-gh-form="true"/u);
  });
});

test("R14 GH: submitting with an empty PAT is blocked client-side and never issues a PUT", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const putBodies: Record<string, unknown>[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm(),
        onGithubGet: () => githubBindingVm(),
        onGithubPut: (body) => {
          putBodies.push(body);
          return githubBindingVm({ bound: true });
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-bind-cta]"])));
    await tick();
    const repoField = new FakeElement();
    repoField.value = "octocat/Hello-World";
    container.setQueryResult("[data-wb-gh-repo-input]", repoField);
    container.setQueryResult("[data-wb-gh-pat-input]", new FakeElement());

    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-submit]"])));
    await tick();
    assert.equal(putBodies.length, 0);
    assert.match(container.innerHTML, /仓库和 PAT 都要填。/u);
  });
});

test("R14 GH: a 503 from an unconfigured encryption key surfaces the self-host guidance, not a generic error", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm(),
        onGithubGet: () => githubBindingVm(),
        onGithubPut: () => {
          throw new WorkHubApiError(503, "github_binding_encryption_unconfigured", "GitHub 集成未配置加密密钥");
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-bind-cta]"])));
    await tick();
    const repoField = new FakeElement();
    repoField.value = "octocat/Hello-World";
    const patField = new FakeElement();
    patField.value = "ghp_1234567890abcdef1234";
    container.setQueryResult("[data-wb-gh-repo-input]", repoField);
    container.setQueryResult("[data-wb-gh-pat-input]", patField);

    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-submit]"])));
    await tick();
    assert.match(container.innerHTML, /GitHub 集成未配置加密密钥，请联系管理员查看部署文档完成配置。/u);
  });
});

test("R14 GH: unbind requires two clicks (armed confirmation) before DELETE fires", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    let deleteCalls = 0;
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm(),
        onGithubGet: () => githubBindingVm({ bound: true, repo_full_name: "octocat/Hello-World" }),
        onGithubDelete: () => {
          deleteCalls += 1;
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-unbind]"])));
    await tick();
    assert.equal(deleteCalls, 0, "first click only arms the confirmation");
    assert.match(container.innerHTML, /确认解绑？/u);

    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-unbind]"])));
    await tick();
    assert.equal(deleteCalls, 1);
    assert.match(container.innerHTML, /还没有关联 GitHub 仓库/u);
  });
});

test("R14 GH: a non-owner viewer never issues a write request no matter what write hook is clicked (none are even rendered)", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const requests: RecordedRequest[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => {
          throw new WorkHubApiError(404, "ai_governance_not_found", "没有找到可管理的项目 AI 设置。");
        },
        onGithubGet: () => githubBindingVm({ bound: true, repo_full_name: "octocat/Hello-World" }),
        requests
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: false
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-unbind]"])));
    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-bind-cta]"])));
    container.dispatch("click", new FakeElement(new Set(["[data-wb-gh-edit-cta]"])));
    await tick();

    assert.equal(requests.filter((request) => request.init?.method && request.init.method !== "GET").length, 0);
    assert.doesNotMatch(container.innerHTML, /确认解绑/u);
  });
});

test("defaultEnabledQuietHours produces a contract-valid enabled block", () => {
  const quiet = defaultEnabledQuietHours("Asia/Shanghai");
  assert.equal(quiet.enabled, true);
  assert.equal(quiet.timezone, "Asia/Shanghai");
  assert.notEqual(quiet.start_minute, quiet.end_minute);
  assert.equal(new Set(quiet.weekdays).size, quiet.weekdays.length);
  assert.ok(quiet.weekdays.length >= 1);
});
